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

export let activeDebugSession: ModelScriptDebugSession | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let startLspDebugSession: ((program: string) => Promise<any>) | undefined;
export let continueLspDebugSession: (() => Promise<void>) | undefined;
export let getLspDebugVariables:
  | (() => Promise<{ name: string; value: string; variablesReference: number }[]>)
  | undefined;
export let setLspBreakpoints:
  | ((program: string, breakpoints: { line: number; column?: number }[]) => Promise<void>)
  | undefined;
export let nextLspDebugSession: (() => Promise<void>) | undefined;

export function setLspDebugCallbacks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  start: (program: string) => Promise<any>,
  cont: () => Promise<void>,
  getVars: () => Promise<{ name: string; value: string; variablesReference: number }[]>,
  setBps: (program: string, bps: { line: number; column?: number }[]) => Promise<void>,
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
  private _runtime: unknown; // Will hold a reference to ModelicaSimulator or the LSP Simulation Manager

  public lastStoppedUri?: string;
  public lastStoppedLine?: number;
  public lastStoppedColumn?: number;

  public constructor() {
    super();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    activeDebugSession = this;
    // This debugger uses zero-based lines and columns
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(true);
  }

  protected initializeRequest(response: DebugProtocol.InitializeResponse): void {
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

  protected async launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: DebugProtocol.LaunchRequestArguments,
  ): Promise<void> {
    const program = (args as Record<string, string>).program;

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

  protected async setBreakPointsRequest(
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

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    // We run simulation in a single conceptual thread
    response.body = {
      threads: [new Thread(1, "ModelScript Simulator")],
    };
    this.sendResponse(response);
  }

  protected stackTraceRequest(response: DebugProtocol.StackTraceResponse): void {
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

  protected scopesRequest(response: DebugProtocol.ScopesResponse): void {
    response.body = {
      scopes: [new Scope("Local", 1, false)],
    };
    this.sendResponse(response);
  }

  protected async variablesRequest(response: DebugProtocol.VariablesResponse): Promise<void> {
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

  protected async continueRequest(response: DebugProtocol.ContinueResponse): Promise<void> {
    if (continueLspDebugSession) {
      await continueLspDebugSession();
    }
    response.body = { allThreadsContinued: true };
    this.sendResponse(response);
  }

  protected async nextRequest(response: DebugProtocol.NextResponse): Promise<void> {
    if (nextLspDebugSession) {
      await nextLspDebugSession();
    }
    this.sendResponse(response);
  }

  protected async stepInRequest(response: DebugProtocol.StepInResponse): Promise<void> {
    // In flattened ModelScript, Step Into is the same as Step Over because functions are inlined
    if (nextLspDebugSession) {
      await nextLspDebugSession();
    }
    this.sendResponse(response);
  }

  protected async evaluateRequest(
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

  protected async disconnectRequest(response: DebugProtocol.DisconnectResponse): Promise<void> {
    // If the user stops the debugger while execution is paused on a breakpoint,
    // the LSP simulator will be hung waiting indefinitely on the `debuggerResumeCallback` Promise.
    // We send a final 'continue' signal before terminating to unblock the simulation loop.
    if (continueLspDebugSession) {
      await continueLspDebugSession();
    }
    this.sendResponse(response);
  }
}
