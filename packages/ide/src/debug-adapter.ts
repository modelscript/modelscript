// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module @modelscript/ide-client/debug-adapter
 *
 * In-process Debug Adapter Protocol (DAP) implementation for ModelScript simulations.
 * Bridges VS Code's debugging UI (breakpoints, stepping, stack frames, variable inspection,
 * and hover expression evaluation) to the LSP server's interactive simulation debugger.
 */

import {
  Breakpoint,
  InitializedEvent,
  LoggingDebugSession,
  Scope,
  Source,
  StackFrame,
  TerminatedEvent,
  Thread,
} from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";

/** Currently active in-process DAP debug session instance, if one is running. */
export let activeDebugSession: ModelScriptDebugSession | undefined;
/** Callback registered by the LSP client to launch a debugged simulation for a model URI/path. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let startLspDebugSession: ((program: string) => Promise<any>) | undefined;
/** Callback registered by the LSP client to resume simulation execution from a breakpoint. */
export let continueLspDebugSession: (() => Promise<void>) | undefined;
/** Callback registered by the LSP client to inspect current variable values at a paused step. */
export let getLspDebugVariables:
  | (() => Promise<{ name: string; value: string; variablesReference: number }[]>)
  | undefined;
/** Callback registered by the LSP client to synchronize source breakpoints with the simulator. */
export let setLspBreakpoints:
  | ((program: string, breakpoints: { line: number; column?: number | undefined }[]) => Promise<void>)
  | undefined;
/** Callback registered by the LSP client to advance the simulation by a single statement/step. */
export let nextLspDebugSession: (() => Promise<void>) | undefined;

/**
 * Registers the LSP-backed simulation control callbacks invoked by `ModelScriptDebugSession`.
 */
export function setLspDebugCallbacks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  start: (program: string) => Promise<any>,
  cont: () => Promise<void>,
  getVars: () => Promise<{ name: string; value: string; variablesReference: number }[]>,
  setBps: (program: string, bps: { line: number; column?: number | undefined }[]) => Promise<void>,
  next: () => Promise<void>,
) {
  startLspDebugSession = start;
  continueLspDebugSession = cont;
  getLspDebugVariables = getVars;
  setLspBreakpoints = setBps;
  nextLspDebugSession = next;
}

/**
 * In-process Debug Adapter Session for ModelScript.
 * Maps VS Code debug commands (step, pause, continue) to the ModelicaSimulator
 * asynchronously yielding `SimulationDebugger`.
 */
export class ModelScriptDebugSession extends LoggingDebugSession {
  /** Reference to the active `ModelicaSimulator` or LSP Simulation Manager instance. */
  public _runtime: unknown;

  /** Document URI where the simulation debugger most recently paused. */
  public lastStoppedUri?: string | undefined;
  /** 1-based source line number where the simulation debugger most recently paused. */
  public lastStoppedLine?: number | undefined;
  /** 1-based source column number where the simulation debugger most recently paused. */
  public lastStoppedColumn?: number | undefined;

  /** Initializes a new DAP session with 1-based line and column indexing. */
  public constructor() {
    super();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    activeDebugSession = this;
    // This debugger uses 1-based lines and columns matching LSP/OMC diagnostics
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(true);
  }

  /** Declares supported DAP capabilities (configurationDone, hover evaluation) and emits `InitializedEvent`. */
  protected override initializeRequest(response: DebugProtocol.InitializeResponse): void {
    response.body = response.body || {};

    // We support basic capabilities
    response.body.supportsConfigurationDoneRequest = true;
    response.body.supportsEvaluateForHovers = true;
    response.body.supportsStepBack = false;
    response.body.supportsDataBreakpoints = false;

    this.sendResponse(response);

    // Since we communicate directly via an inline factory, emit initialized immediately
    this.sendEvent(new InitializedEvent());
  }

  /** Launches the target ModelScript program in the LSP simulation debugger and emits `TerminatedEvent` on completion. */
  protected override async launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: DebugProtocol.LaunchRequestArguments,
  ): Promise<void> {
    const program = (args as Record<string, string>)["program"];

    if (program && startLspDebugSession) {
      // Must send the launch response BEFORE events or it hangs
      this.sendResponse(response);

      startLspDebugSession(program)
        .then(() => {
          this.sendEvent(new TerminatedEvent());
        })
        .catch(() => {
          this.sendEvent(new TerminatedEvent());
        });
    } else {
      this.sendResponse(response);
      this.sendEvent(new TerminatedEvent());
    }
  }

  /** Registers source line/column breakpoints for the given file path with the LSP simulation debugger. */
  protected override async setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments,
  ): Promise<void> {
    const path = args.source.path;
    const clientLines = args.breakpoints || [];

    const actualBreakpoints = clientLines.map((l) => {
      const bp = new Breakpoint(
        true,
        l.line,
        l.column,
        new Source(path ? (path.split("/").pop() as string) : "virtual", path),
      );
      return bp;
    });

    if (setLspBreakpoints && path) {
      // Send the breakpoints to the LSP Simulator
      await setLspBreakpoints(
        path,
        clientLines.map((l) => ({ line: l.line, column: l.column })),
      );
    }

    response.body = { breakpoints: actualBreakpoints };
    this.sendResponse(response);
  }

  /** Returns the single conceptual simulation execution thread. */
  protected override threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    // We run simulation in a single conceptual thread
    response.body = {
      threads: [new Thread(1, "ModelScript Simulator")],
    };
    this.sendResponse(response);
  }

  /** Constructs a single-frame call stack pointing to `lastStoppedUri`, `lastStoppedLine`, and `lastStoppedColumn`. */
  protected override stackTraceRequest(response: DebugProtocol.StackTraceResponse): void {
    let source: Source | undefined;
    if (this.lastStoppedUri) {
      // Create a vscode.Uri-like representation depending on whether it's file:// or memfs://
      let pathStr = this.lastStoppedUri;
      if (pathStr.startsWith("file://")) pathStr = pathStr.replace("file://", "");
      else if (pathStr.startsWith("memfs:/")) pathStr = pathStr.replace("memfs:/", "");

      const basename = pathStr.split("/").pop() || "unknown.mo";
      // We pass the full URI instead of the raw path to ensure virtual filesystems open correctly
      source = new Source(basename, this.lastStoppedUri);
    }

    // Fallbacks if line/col are not reported correctly
    const line = this.lastStoppedLine || 1;
    const col = this.lastStoppedColumn || 1;

    response.body = {
      stackFrames: [new StackFrame(1, "algorithm block", source, line, col)],
      totalFrames: 1,
    };
    this.sendResponse(response);
  }

  /** Returns the single `"Local"` variable scope for the paused simulation frame. */
  protected override scopesRequest(response: DebugProtocol.ScopesResponse): void {
    response.body = {
      scopes: [new Scope("Local", 1, false)],
    };
    this.sendResponse(response);
  }

  /** Fetches the current DAE state, algebraic, and parameter variable values from the LSP simulator. */
  protected override async variablesRequest(response: DebugProtocol.VariablesResponse): Promise<void> {
    if (getLspDebugVariables) {
      try {
        const vars = await getLspDebugVariables();
        response.body = { variables: vars };
      } catch {
        response.body = { variables: [] };
      }
    } else {
      response.body = { variables: [] };
    }
    this.sendResponse(response);
  }

  /** Resumes simulation execution until the next breakpoint or end of simulation. */
  protected override async continueRequest(response: DebugProtocol.ContinueResponse): Promise<void> {
    if (continueLspDebugSession) {
      await continueLspDebugSession();
    }
    response.body = { allThreadsContinued: true };
    this.sendResponse(response);
  }

  /** Advances the simulation debugger by one statement or integration step (Step Over). */
  protected override async nextRequest(response: DebugProtocol.NextResponse): Promise<void> {
    if (nextLspDebugSession) {
      await nextLspDebugSession();
    }
    this.sendResponse(response);
  }

  /** Advances the simulation debugger by one step (identical to Step Over because flattened functions are inlined). */
  protected override async stepInRequest(response: DebugProtocol.StepInResponse): Promise<void> {
    // In flattened ModelScript, Step Into is the same as Step Over because functions are inlined
    if (nextLspDebugSession) {
      await nextLspDebugSession();
    }
    this.sendResponse(response);
  }

  /** Evaluates a watched or hovered variable name against the current simulation state table. */
  protected override async evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments,
  ): Promise<void> {
    if (getLspDebugVariables) {
      try {
        const vars = await getLspDebugVariables();
        // Exact match for the variable name in the environment
        const found = vars.find((v) => v.name === args.expression);
        if (found) {
          response.body = {
            result: found.value,
            variablesReference: 0,
          };
        } else {
          // Fallback for non-matching expressions
          response.body = { result: "undefined", variablesReference: 0 };
        }
      } catch {
        response.body = { result: "error", variablesReference: 0 };
      }
    } else {
      response.body = { result: "none", variablesReference: 0 };
    }
    this.sendResponse(response);
  }

  /** Unblocks any paused simulation loop and disconnects the debug adapter session. */
  protected override async disconnectRequest(response: DebugProtocol.DisconnectResponse): Promise<void> {
    // If the user stops the debugger while execution is paused on a breakpoint,
    // the LSP simulator will be hung waiting indefinitely on the `debuggerResumeCallback` Promise.
    // We send a final 'continue' signal before terminating to unblock the simulation loop.
    if (continueLspDebugSession) {
      await continueLspDebugSession();
    }
    this.sendResponse(response);
  }
}
