// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Local Desktop Agent Bridge for In-Browser and Remote Co-Simulation.
 *
 * Industrial Context & Problem:
 * Web browsers and cloud sandboxes cannot directly load native 64-bit platform binaries
 * (.dll on Windows, .so on Linux, .dylib on macOS) or interface with commercial engineering
 * suites (MATLAB/Simulink, Amesim, CarSim, Ansys Twin Builder, LabVIEW, Adams) or local HIL
 * DAQ hardware due to OS security sandboxing.
 *
 * The Local Desktop Agent Bridge connects an in-browser ModelScript Web IDE, remote cloud runner,
 * or distributed co-simulation orchestrator to a native background daemon running locally on the
 * user's engineering workstation (e.g. `localhost:9876`).
 *
 * It provides:
 * 1. Full `CoSimParticipant` compliance: The co-simulation master treats desktop models identically
 *    to pure JS or WebAssembly models.
 * 2. Zero-latency pipelined step exchanges: Batches inputs, step execution, and output collection
 *    into a single micro-RPC per macro-step, minimizing localhost IPC latency (< 0.2ms RTT).
 * 3. Bidirectional state rollback & directional derivatives: Supports FMI state save/restore
 *    (`fmi2GetFMUstate`/`fmi2SetFMUstate`) and directional derivatives over RPC so implicit Newton-Raphson
 *    solvers function seamlessly across the web-to-desktop boundary.
 * 4. Dual transport: Standard WebSocket in browsers and Node.js, plus direct in-memory transport
 *    for testing and CI/CD without opening network ports.
 */

import type { CosimValue } from "../coupling.js";
import type { ParticipantMetadata, ParticipantVariable } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

// ── Protocol Schemas ──

/** RPC request frame from Orchestrator -> Desktop Agent */
export interface LocalAgentRpcRequest<T = unknown> {
  id: number;
  cmd: string;
  payload?: T | undefined;
}

/** RPC response frame from Desktop Agent -> Orchestrator */
export interface LocalAgentRpcResponse<T = unknown> {
  id: number;
  status: "OK" | "ERROR";
  payload?: T | undefined;
  error?: string | undefined;
}

/** Hardware and solver capabilities reported by the desktop agent. */
export interface DesktopAgentCapabilities {
  version: string;
  platform: "win32" | "linux" | "darwin";
  arch: "x64" | "arm64";
  supportedSolvers: string[];
  canGetAndSetState: boolean;
  providesDirectionalDerivatives: boolean;
  uptimeSeconds?: number | undefined;
}

/** Initialization payload sent to the desktop agent. */
export interface AgentInitPayload {
  modelIdentifier: string;
  startTime: number;
  stopTime: number;
  stepSize: number;
  parameters?: Record<string, CosimValue> | undefined;
  authToken?: string | undefined;
}

/** Model metadata returned by the desktop agent after initialization. */
export interface AgentInitResponse {
  modelName: string;
  variables: ParticipantVariable[];
  canGetAndSetState?: boolean | undefined;
  providesDirectionalDerivatives?: boolean | undefined;
  directFeedthrough?: Record<string, string[]> | undefined;
}

/** Pipelined step exchange payload. */
export interface AgentStepExchangePayload {
  currentTime: number;
  stepSize: number;
  inputs?: Record<string, CosimValue> | undefined;
}

/** Pipelined step exchange response. */
export interface AgentStepExchangeResponse {
  time: number;
  outputs: Record<string, CosimValue>;
  solverStatus?: "OK" | "WARNING" | "ERROR" | undefined;
  cpuDurationMs?: number | undefined;
}

// ── Transport Abstraction ──

/** Transport interface for the desktop agent bridge. */
export interface ILocalAgentTransport {
  connect(): Promise<void>;
  send(message: string): Promise<void>;
  onMessage(callback: (data: string) => void): void;
  onClose(callback: (code: number, reason: string) => void): void;
  onError(callback: (err: Error) => void): void;
  close(): Promise<void>;
  readonly isConnected: boolean;
}

interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener?(type: string, listener: (event: unknown) => void): void;
  removeEventListener?(type: string, listener: (event: unknown) => void): void;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * WebSocket transport implementation supporting both Browser (`window.WebSocket`)
 * and Node.js (`ws` package).
 */
export class WebSocketAgentTransport implements ILocalAgentTransport {
  private readonly url: string;
  private socket: WebSocketLike | null = null;
  private messageHandlers: ((data: string) => void)[] = [];
  private closeHandlers: ((code: number, reason: string) => void)[] = [];
  private errorHandlers: ((err: Error) => void)[] = [];
  private connected = false;

  constructor(url = "ws://127.0.0.1:9876/cosim") {
    this.url = url;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    let WsConstructor: new (url: string) => WebSocketLike;
    if (typeof globalThis.WebSocket !== "undefined") {
      WsConstructor = globalThis.WebSocket as unknown as new (url: string) => WebSocketLike;
    } else {
      const wsModule = await import("ws");
      WsConstructor = (wsModule.WebSocket || wsModule.default) as unknown as new (url: string) => WebSocketLike;
    }

    return new Promise((resolve, reject) => {
      try {
        const ws = new WsConstructor(this.url);
        this.socket = ws;

        const onOpen = () => {
          this.connected = true;
          cleanupConnectListeners();
          resolve();
        };

        const onError = (err: unknown) => {
          cleanupConnectListeners();
          const error =
            err instanceof Error ? err : new Error(`Failed to connect to Local Desktop Agent at ${this.url}`);
          reject(error);
        };

        const cleanupConnectListeners = () => {
          if (ws.removeEventListener) {
            ws.removeEventListener("open", onOpen);
            ws.removeEventListener("error", onError);
          } else if (ws.off) {
            ws.off("open", onOpen);
            ws.off("error", onError);
          }
        };

        if (ws.addEventListener) {
          ws.addEventListener("open", onOpen);
          ws.addEventListener("error", onError);
          ws.addEventListener("message", (event: unknown) => {
            const data = (event as { data?: unknown })?.data;
            const dataStr = typeof data === "string" ? data : String(data ?? "");
            for (const h of this.messageHandlers) h(dataStr);
          });
          ws.addEventListener("close", (event: unknown) => {
            this.connected = false;
            const ev = event as { code?: number; reason?: string } | undefined;
            for (const h of this.closeHandlers) h(ev?.code ?? 1000, ev?.reason ?? "");
          });
        } else if (ws.on) {
          ws.on("open", onOpen);
          ws.on("error", onError);
          ws.on("message", (data: unknown) => {
            const dataStr = typeof data === "string" ? data : String(data ?? "");
            for (const h of this.messageHandlers) h(dataStr);
          });
          ws.on("close", (code: unknown, reason: unknown) => {
            this.connected = false;
            const numCode = typeof code === "number" ? code : 1000;
            const strReason = typeof reason === "string" ? reason : String(reason ?? "");
            for (const h of this.closeHandlers) h(numCode, strReason);
          });
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async send(message: string): Promise<void> {
    if (!this.connected || !this.socket) {
      throw new Error("Cannot send message: LocalAgentTransport is not connected");
    }
    this.socket.send(message);
  }

  onMessage(callback: (data: string) => void): void {
    this.messageHandlers.push(callback);
  }

  onClose(callback: (code: number, reason: string) => void): void {
    this.closeHandlers.push(callback);
  }

  onError(callback: (err: Error) => void): void {
    this.errorHandlers.push(callback);
  }

  async close(): Promise<void> {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* ignore cleanup errors */
      }
    }
    this.connected = false;
  }
}

/**
 * In-memory loopback transport for unit testing and CI pipelines without open ports.
 */
export class InMemoryAgentTransport implements ILocalAgentTransport {
  private peer: InMemoryAgentTransport | null = null;
  private messageHandlers: ((data: string) => void)[] = [];
  private closeHandlers: ((code: number, reason: string) => void)[] = [];
  private connected = false;

  setPeer(peer: InMemoryAgentTransport): void {
    this.peer = peer;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async send(message: string): Promise<void> {
    if (!this.connected || !this.peer) {
      throw new Error("InMemoryAgentTransport: Peer not connected");
    }
    queueMicrotask(() => {
      this.peer?.receive(message);
    });
  }

  receive(message: string): void {
    for (const h of this.messageHandlers) h(message);
  }

  onMessage(callback: (data: string) => void): void {
    this.messageHandlers.push(callback);
  }

  onClose(callback: (code: number, reason: string) => void): void {
    this.closeHandlers.push(callback);
  }

  onError(_callback: (err: Error) => void): void {}

  async close(): Promise<void> {
    this.connected = false;
    for (const h of this.closeHandlers) h(1000, "Closed");
  }
}

// ── Local Agent Proxy Participant ──

export interface LocalAgentProxyOptions {
  /** Unique co-simulation participant ID (e.g. "NativeSimulinkPlant"). */
  id: string;
  /**
   * Native model identifier:
   * - Path to native FMU (e.g. "C:/Models/Engine_win64.fmu")
   * - Simulink model reference (e.g. "simulink:Powertrain")
   * - Native DLL/so path or solver script
   */
  modelIdentifier: string;
  /** WebSocket URL to the local desktop agent daemon. Default: "ws://127.0.0.1:9876/cosim" */
  url?: string | undefined;
  /** Optional security bearer token or session key. */
  authToken?: string | undefined;
  /** Custom transport (e.g. InMemoryAgentTransport for tests). */
  transport?: ILocalAgentTransport | undefined;
  /** RPC timeout in milliseconds. Default: 10000ms. */
  timeoutMs?: number | undefined;
  /**
   * Whether to use pipelined single-RTT step exchanges (inputs + step + outputs in 1 message).
   * Default: true.
   */
  pipelinedExchange?: boolean | undefined;
  /** Initial parameter overrides passed to the desktop model on init. */
  initialParameters?: Record<string, CosimValue> | undefined;
  /** Optional SVG icon for UI visualization. */
  iconSvg?: string | undefined;
}

/**
 * CoSimParticipant that bridges across WebSocket IPC to a native desktop agent daemon.
 */
export class LocalAgentProxyParticipant implements CoSimParticipant {
  readonly id: string;
  readonly modelName: string;
  metadata: ParticipantMetadata;

  private readonly modelIdentifier: string;
  private readonly authToken?: string | undefined;
  private readonly transport: ILocalAgentTransport;
  private readonly timeoutMs: number;
  private readonly pipelinedExchange: boolean;
  private readonly initialParameters?: Record<string, CosimValue> | undefined;

  private messageIdCounter = 0;
  private readonly pendingRpc = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  // Cached state for zero-latency stepping
  private readonly cachedOutputs = new Map<string, CosimValue>();
  private readonly pendingInputs = new Map<string, CosimValue>();

  // Participant capabilities (populated on probe/init)
  canGetAndSetState = false;
  providesDirectionalDerivatives = false;
  directFeedthrough?: Record<string, string[]> | undefined;

  // Telemetry metrics
  readonly telemetry = {
    totalSteps: 0,
    totalRpcDurationMs: 0,
    lastCpuDurationMs: 0,
    averageRttMs: 0,
  };

  constructor(options: LocalAgentProxyOptions) {
    this.id = options.id;
    this.modelIdentifier = options.modelIdentifier;
    this.modelName = options.modelIdentifier.replace(/^.*[/\\]/, "").replace(/\.[^/.]+$/, "");
    this.authToken = options.authToken;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.pipelinedExchange = options.pipelinedExchange ?? true;
    this.initialParameters = options.initialParameters;

    this.transport = options.transport ?? new WebSocketAgentTransport(options.url ?? "ws://127.0.0.1:9876/cosim");
    this.transport.onMessage((msg) => this.handleMessage(msg));

    this.metadata = {
      participantId: this.id,
      modelName: this.modelName,
      type: "fmu-native",
      classKind: "model",
      description: `Native Desktop Model (${this.modelIdentifier}) via Local Desktop Agent`,
      variables: [],
      iconSvg: options.iconSvg,
      timestamp: new Date().toISOString(),
    };
  }

  /** Send an RPC command to the local desktop agent and wait for the response. */
  private async rpc<TRes = unknown, TReq = unknown>(cmd: string, payload?: TReq): Promise<TRes> {
    if (!this.transport.isConnected) {
      await this.transport.connect();
    }

    const id = ++this.messageIdCounter;
    const req: LocalAgentRpcRequest<TReq> = { id, cmd, payload };

    return new Promise<TRes>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpc.delete(id);
        reject(new Error(`Local desktop agent RPC timeout for command '${cmd}' (id: ${id}) after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pendingRpc.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });

      this.transport.send(JSON.stringify(req)).catch((err) => {
        clearTimeout(timer);
        this.pendingRpc.delete(id);
        reject(err);
      });
    });
  }

  private handleMessage(dataStr: string): void {
    try {
      const res: LocalAgentRpcResponse = JSON.parse(dataStr);
      const pending = this.pendingRpc.get(res.id);
      if (!pending) return;

      this.pendingRpc.delete(res.id);
      clearTimeout(pending.timer);

      if (res.status === "ERROR") {
        pending.reject(new Error(res.error ?? "Unknown desktop agent RPC error"));
      } else {
        pending.resolve(res.payload);
      }
    } catch {
      // Discard invalid framing
    }
  }

  /**
   * Probe desktop agent capabilities and liveness.
   */
  async probe(): Promise<DesktopAgentCapabilities> {
    return await this.rpc<DesktopAgentCapabilities>("AGENT_PROBE");
  }

  /**
   * Measure network ping round-trip time (RTT) to the local desktop agent.
   */
  async ping(): Promise<number> {
    const start = Date.now();
    await this.rpc<{ timestamp: number }>("AGENT_PING");
    return Date.now() - start;
  }

  // ── CoSimParticipant Lifecycle Implementation ──

  async initialize(startTime: number, stopTime: number, stepSize: number): Promise<void> {
    if (!this.transport.isConnected) {
      await this.transport.connect();
    }

    // Probe daemon capabilities
    try {
      const caps = await this.probe();
      this.canGetAndSetState = caps.canGetAndSetState;
      this.providesDirectionalDerivatives = caps.providesDirectionalDerivatives;
    } catch {
      // Fallback if probe not implemented by minimal daemon
    }

    // Send initialization command
    const initPayload: AgentInitPayload = {
      modelIdentifier: this.modelIdentifier,
      startTime,
      stopTime,
      stepSize,
      parameters: this.initialParameters,
      authToken: this.authToken,
    };

    const res = await this.rpc<AgentInitResponse>("AGENT_INIT", initPayload);

    // Update metadata from native model descriptors
    if (res.variables && res.variables.length > 0) {
      this.metadata.variables = res.variables;
      for (const v of res.variables) {
        if (v.causality === "output" && v.start !== undefined) {
          this.cachedOutputs.set(v.name, v.start);
        }
      }
    }

    if (res.canGetAndSetState !== undefined) {
      this.canGetAndSetState = res.canGetAndSetState;
    }
    if (res.providesDirectionalDerivatives !== undefined) {
      this.providesDirectionalDerivatives = res.providesDirectionalDerivatives;
    }
    if (res.directFeedthrough) {
      this.directFeedthrough = res.directFeedthrough;
    }
  }

  async setInputs(values: Map<string, CosimValue>): Promise<void> {
    for (const [k, v] of values) {
      this.pendingInputs.set(k, v);
    }

    // In non-pipelined mode, dispatch immediately
    if (!this.pipelinedExchange) {
      const record: Record<string, CosimValue> = {};
      for (const [k, v] of this.pendingInputs) record[k] = v;
      this.pendingInputs.clear();
      await this.rpc("AGENT_SET_INPUTS", record);
    }
  }

  async doStep(currentTime: number, stepSize: number): Promise<void> {
    const t0 = Date.now();

    if (this.pipelinedExchange) {
      // Pipelined mode: single round-trip step exchange
      const inRecord: Record<string, CosimValue> = {};
      for (const [k, v] of this.pendingInputs) inRecord[k] = v;
      this.pendingInputs.clear();

      const payload: AgentStepExchangePayload = {
        currentTime,
        stepSize,
        inputs: inRecord,
      };

      const res = await this.rpc<AgentStepExchangeResponse>("AGENT_STEP_EXCHANGE", payload);

      // Cache returned outputs for zero-latency retrieval
      if (res.outputs) {
        for (const [k, v] of Object.entries(res.outputs)) {
          this.cachedOutputs.set(k, v);
        }
      }

      this.telemetry.lastCpuDurationMs = res.cpuDurationMs ?? 0;
    } else {
      // Non-pipelined explicit mode
      await this.rpc("AGENT_DO_STEP", {
        currentTime,
        stepSize,
      });

      const res = await this.rpc<Record<string, CosimValue>>("AGENT_GET_OUTPUTS");
      if (res) {
        for (const [k, v] of Object.entries(res)) {
          this.cachedOutputs.set(k, v);
        }
      }
    }

    const rtt = Date.now() - t0;
    this.telemetry.totalSteps++;
    this.telemetry.totalRpcDurationMs += rtt;
    this.telemetry.averageRttMs = this.telemetry.totalRpcDurationMs / this.telemetry.totalSteps;
  }

  async getOutputs(): Promise<Map<string, CosimValue>> {
    return new Map(this.cachedOutputs);
  }

  async getState(): Promise<unknown> {
    if (!this.canGetAndSetState) {
      throw new Error(`Participant '${this.id}' does not support getState()`);
    }
    const res = await this.rpc<{ stateHandle: string | number }>("AGENT_GET_STATE");
    return res.stateHandle;
  }

  async setState(state: unknown): Promise<void> {
    if (!this.canGetAndSetState) {
      throw new Error(`Participant '${this.id}' does not support setState()`);
    }
    await this.rpc("AGENT_SET_STATE", { stateHandle: state });
  }

  async freeState(state: unknown): Promise<void> {
    await this.rpc("AGENT_FREE_STATE", { stateHandle: state });
  }

  async getDirectionalDerivative(unknownRefs: number[], knownRefs: number[], dvKnown: number[]): Promise<number[]> {
    if (!this.providesDirectionalDerivatives) {
      throw new Error(`Participant '${this.id}' does not provide directional derivatives`);
    }
    const res = await this.rpc<{ dvUnknown: number[] }>("AGENT_DIRECTIONAL_DERIVATIVE", {
      unknownRefs,
      knownRefs,
      dvKnown,
    });

    return res.dvUnknown;
  }

  async setParameters(values: Map<string, CosimValue>): Promise<void> {
    const record: Record<string, CosimValue> = {};
    for (const [k, v] of values) record[k] = v;
    await this.rpc("AGENT_SET_PARAMETERS", record);
  }

  async terminate(): Promise<void> {
    try {
      if (this.transport.isConnected) {
        await this.rpc("AGENT_TERMINATE");
      }
    } catch {
      // Ignore termination errors during shutdown
    } finally {
      for (const pending of this.pendingRpc.values()) {
        clearTimeout(pending.timer);
      }
      this.pendingRpc.clear();
      await this.transport.close();
      this.cachedOutputs.clear();
      this.pendingInputs.clear();
    }
  }
}

// ── Mock Desktop Agent Daemon (for Unit Testing & Headless CI) ──

/**
 * In-process mock server emulating a native desktop agent daemon (Simulink, Amesim, or native FMU).
 */
export class MockLocalAgentServer {
  private readonly transport: InMemoryAgentTransport;
  private stateVal = 0.0;
  private inputs: Record<string, number> = { u: 0.0 };
  private outputs: Record<string, number> = { y: 0.0 };
  private stateCounter = 0;
  private savedStates = new Map<number, { stateVal: number; inputs: Record<string, number> }>();

  constructor() {
    this.transport = new InMemoryAgentTransport();
    void this.transport.connect();
    this.transport.onMessage((msg) => this.handleMessage(msg));
  }

  createClientTransport(): InMemoryAgentTransport {
    const client = new InMemoryAgentTransport();
    void client.connect();
    this.transport.setPeer(client);
    client.setPeer(this.transport);
    return client;
  }

  private handleMessage(msgStr: string): void {
    const req = JSON.parse(msgStr) as LocalAgentRpcRequest<Record<string, unknown>>;
    let status: "OK" | "ERROR" = "OK";
    let payload: unknown = undefined;
    let error: string | undefined = undefined;

    try {
      switch (req.cmd) {
        case "AGENT_PROBE":
          payload = {
            version: "1.0.0-mock",
            platform: "linux",
            arch: "x64",
            supportedSolvers: ["fmu-native", "simulink", "amesim"],
            canGetAndSetState: true,
            providesDirectionalDerivatives: true,
            uptimeSeconds: 120,
          };
          break;

        case "AGENT_PING":
          payload = { timestamp: Date.now() };
          break;

        case "AGENT_INIT":
          this.stateVal = 0.0;
          this.inputs = { u: 0.0 };
          this.outputs = { y: 0.0 };
          payload = {
            modelName: "MockDesktopPlant",
            canGetAndSetState: true,
            providesDirectionalDerivatives: true,
            directFeedthrough: { y: ["u"] },
            variables: [
              { name: "u", causality: "input", type: "Real" },
              { name: "y", causality: "output", type: "Real", start: 0.0 },
            ],
          };
          break;

        case "AGENT_SET_INPUTS":
          for (const [k, v] of Object.entries(req.payload ?? {})) {
            if (typeof v === "number") this.inputs[k] = v;
          }
          payload = {};
          break;

        case "AGENT_DO_STEP": {
          const stepSize = Number(req.payload?.["stepSize"] ?? 0.0);
          // Simulated state integration: dx/dt = -0.5*x + u, y = 2.0*u + x
          this.stateVal += (-0.5 * this.stateVal + (this.inputs["u"] ?? 0.0)) * stepSize;
          this.outputs["y"] = 2.0 * (this.inputs["u"] ?? 0.0) + this.stateVal;
          payload = {};
          break;
        }

        case "AGENT_GET_OUTPUTS":
          payload = { ...this.outputs };
          break;

        case "AGENT_STEP_EXCHANGE": {
          const stepInputs = req.payload?.["inputs"];
          if (stepInputs && typeof stepInputs === "object") {
            for (const [k, v] of Object.entries(stepInputs as Record<string, unknown>)) {
              if (typeof v === "number") this.inputs[k] = v;
            }
          }
          const stepSize = Number(req.payload?.["stepSize"] ?? 0.0);
          const currentTime = Number(req.payload?.["currentTime"] ?? 0.0);
          this.stateVal += (-0.5 * this.stateVal + (this.inputs["u"] ?? 0.0)) * stepSize;
          this.outputs["y"] = 2.0 * (this.inputs["u"] ?? 0.0) + this.stateVal;
          payload = {
            time: currentTime + stepSize,
            outputs: { ...this.outputs },
            solverStatus: "OK",
            cpuDurationMs: 0.1,
          };
          break;
        }

        case "AGENT_GET_STATE": {
          const handle = ++this.stateCounter;
          this.savedStates.set(handle, {
            stateVal: this.stateVal,
            inputs: { ...this.inputs },
          });
          payload = { stateHandle: handle };
          break;
        }

        case "AGENT_SET_STATE": {
          const handle = Number(req.payload?.["stateHandle"]);
          const saved = this.savedStates.get(handle);
          if (saved) {
            this.stateVal = saved.stateVal;
            this.inputs = { ...saved.inputs };
          }
          payload = {};
          break;
        }

        case "AGENT_FREE_STATE": {
          this.savedStates.delete(Number(req.payload?.["stateHandle"]));
          payload = {};
          break;
        }

        case "AGENT_DIRECTIONAL_DERIVATIVE": {
          // dy/du = 2.0
          const dvKnown = Array.isArray(req.payload?.["dvKnown"]) ? (req.payload["dvKnown"] as number[]) : [1.0];
          payload = {
            dvUnknown: dvKnown.map((du) => 2.0 * du),
          };
          break;
        }

        case "AGENT_SET_PARAMETERS":
          payload = {};
          break;

        case "AGENT_TERMINATE":
          this.savedStates.clear();
          payload = {};
          break;

        default:
          status = "ERROR";
          error = `Unsupported desktop agent command: ${req.cmd}`;
      }
    } catch (e: unknown) {
      status = "ERROR";
      error = e instanceof Error ? e.message : String(e);
    }

    const res: LocalAgentRpcResponse = {
      id: req.id,
      status,
      payload,
      error,
    };

    this.transport.send(JSON.stringify(res));
  }
}
