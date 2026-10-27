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

import { MultiBodyAnimationPanel } from "./multibody-animation-panel.js";

/** Currently active in-process DAP debug session instance, if one is running. */
export let activeDebugSession: ModelScriptDebugSession | undefined;
function setActiveDebugSession(session: ModelScriptDebugSession | undefined): void {
  activeDebugSession = session;
}
/** Callback registered by the LSP client to launch a debugged simulation for a model URI/path. */

export let startLspDebugSession: ((program: string) => Promise<unknown>) | undefined;
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
  start: (program: string) => Promise<unknown>,
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
    setActiveDebugSession(this);
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

  /** Returns categorized variable scopes (States, Algebraic, Parameters, Metrics) for the simulation frame. */
  protected override scopesRequest(response: DebugProtocol.ScopesResponse): void {
    response.body = {
      scopes: [
        new Scope("States & Derivatives", 1, false),
        new Scope("Algebraic Variables", 2, false),
        new Scope("Parameters", 3, false),
        new Scope("Solver Metrics", 4, false),
      ],
    };
    this.sendResponse(response);
  }

  /** Fetches and filters simulation variables by scope category. */
  protected override async variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments,
  ): Promise<void> {
    if (getLspDebugVariables) {
      try {
        const allVars = await getLspDebugVariables();
        if (MultiBodyAnimationPanel.currentPanel) {
          MultiBodyAnimationPanel.currentPanel.syncWithDebugger(allVars);
        }
        let filtered = allVars;
        if (args.variablesReference === 1) {
          // States & Derivatives
          filtered = allVars.filter(
            (v) => v.name.startsWith("der(") || v.name.endsWith(".state") || /^(?:x|v|omega|theta)\b/i.test(v.name),
          );
          if (filtered.length === 0) filtered = allVars;
        } else if (args.variablesReference === 2) {
          // Algebraic Variables
          filtered = allVars.filter(
            (v) =>
              !v.name.startsWith("der(") &&
              !/^(?:time|dt|step|iterations?|residual)\b/i.test(v.name) &&
              !v.name.startsWith("param_"),
          );
        } else if (args.variablesReference === 3) {
          // Parameters
          filtered = allVars.filter(
            (v) => v.name.startsWith("param_") || v.name.includes(".param") || /^[A-Z_0-9]+$/.test(v.name),
          );
        } else if (args.variablesReference === 4) {
          // Solver Metrics
          filtered = allVars.filter((v) => /^(?:time|dt|step|iterations?|residual|solver|converged)\b/i.test(v.name));
        }
        response.body = { variables: filtered };
      } catch {
        response.body = { variables: [] };
      }
    } else {
      response.body = { variables: [] };
    }
    this.sendResponse(response);
  }

  /** Helper to synchronize current simulation step variables to the 3D Multibody Animation Panel if active. */
  public async syncAnimationViewport(): Promise<void> {
    if (MultiBodyAnimationPanel.currentPanel && getLspDebugVariables) {
      try {
        const vars = await getLspDebugVariables();
        MultiBodyAnimationPanel.currentPanel.syncWithDebugger(vars);
      } catch {}
    }
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
    await this.syncAnimationViewport();
    this.sendResponse(response);
  }

  /** Advances the simulation debugger by one step (identical to Step Over because flattened functions are inlined). */
  protected override async stepInRequest(response: DebugProtocol.StepInResponse): Promise<void> {
    // In flattened ModelScript, Step Into is the same as Step Over because functions are inlined
    if (nextLspDebugSession) {
      await nextLspDebugSession();
    }
    await this.syncAnimationViewport();
    this.sendResponse(response);
  }

  /** Evaluates a watched expression, dot-path, or arithmetic formula against simulation variables. */
  protected override async evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments,
  ): Promise<void> {
    if (getLspDebugVariables) {
      try {
        const vars = await getLspDebugVariables();
        const expr = (args.expression || "").trim();

        // 1. Direct match
        const found = vars.find((v) => v.name === expr || v.name.toLowerCase() === expr.toLowerCase());
        if (found) {
          response.body = { result: found.value, variablesReference: 0 };
          this.sendResponse(response);
          return;
        }

        // 2. Hierarchical dot-path suffix match (e.g., "resistor.v" matching "circuit.resistor.v")
        const suffixMatch = vars.find((v) => v.name.endsWith("." + expr));
        if (suffixMatch) {
          response.body = { result: suffixMatch.value, variablesReference: 0 };
          this.sendResponse(response);
          return;
        }

        // 3. Simple arithmetic evaluation with variable substitution (e.g., "a + b" or "2 * x")
        let evaluatedExpr = expr;
        for (const v of vars) {
          if (!isNaN(Number(v.value))) {
            const varPattern = new RegExp(`\\b${v.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
            evaluatedExpr = evaluatedExpr.replace(varPattern, v.value);
          }
        }
        if (/^[\d.\s+\-*/()]+$/.test(evaluatedExpr)) {
          try {
            const evalFn = Object.getPrototypeOf(function () {}).constructor as (body: string) => () => unknown;
            const mathResult = evalFn(`"use strict"; return (${evaluatedExpr});`)();
            response.body = { result: String(mathResult), variablesReference: 0 };
            this.sendResponse(response);
            return;
          } catch {}
        }

        response.body = { result: "undefined", variablesReference: 0 };
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
