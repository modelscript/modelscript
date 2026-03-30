// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Model Exchange co-simulation participant.
 *
 * Wraps a pure Model Exchange FMU (no fmi2DoStep) and provides a
 * CoSimParticipant-compatible interface by running a local RK4 ODE
 * solver that drives the FMU's derivative calculations.
 *
 * Architecture:
 *   Orchestrator → ModelExchangeParticipant.doStep(t, h)
 *                      │
 *                      ├─ setTime(t)
 *                      ├─ setContinuousStates(x)
 *                      ├─ getDerivatives() → k1
 *                      ├─ ... RK4 stages ...
 *                      ├─ completedIntegratorStep()
 *                      └─ (event handling if needed)
 *
 * Reuses the FmuNativeParticipant's subprocess harness for loading
 * the FMU shared library — extends it with ME-specific RPC calls.
 */

import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createInterface, type Interface } from "readline";
import type { CosimValue } from "../coupling.js";
import type { FmiModelDescription, FmiScalarVariable } from "../fmu/model-description.js";
import type { FmuStorage } from "../fmu/storage.js";
import type { ParticipantMetadata, ParticipantVariable } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

/** JSON-RPC request to the harness. */
interface HarnessRequest {
  method: string;
  params?: Record<string, unknown>;
  id: number;
}

/** JSON-RPC response from the harness. */
interface HarnessResponse {
  result?: unknown;
  error?: { code: number; message: string };
  id: number;
}

/** Event info returned by newDiscreteStates. */
interface EventInfo {
  newDiscreteStatesNeeded: boolean;
  terminateSimulation: boolean;
  nominalsChanged: boolean;
  valuesChanged: boolean;
  nextEventTimeDefined: boolean;
  nextEventTime: number;
}

/** Result from completedIntegratorStep. */
interface IntegratorStepResult {
  enterEventMode: boolean;
  terminateSimulation: boolean;
}

/**
 * Options for creating a Model Exchange participant.
 */
export interface ModelExchangeParticipantOptions {
  /** Unique participant ID. */
  id: string;
  /** FMU ID in the FmuStorage. */
  fmuId: string;
  /** FmuStorage instance. */
  storage: FmuStorage;
  /** Path to the FMU harness binary. Default: "fmu-harness" on PATH. */
  harnessPath?: string | undefined;
  /** Number of continuous states in this FMU. */
  nStates: number;
  /** Number of event indicators. Default: 0. */
  nEventIndicators?: number | undefined;
  /** Optional SVG icon override. */
  iconSvg?: string | undefined;
}

/**
 * Co-simulation participant that wraps a Model Exchange FMU with a
 * local RK4 numerical integrator.
 */
export class ModelExchangeParticipant implements CoSimParticipant {
  readonly id: string;
  readonly modelName: string;
  readonly metadata: ParticipantMetadata;
  readonly canGetAndSetState = true;

  private readonly fmuArchivePath: string;
  private readonly harnessPath: string;
  private readonly modelDesc: FmiModelDescription;
  private readonly nStates: number;
  private readonly nEventIndicators: number;

  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();

  /** Current continuous state vector. */
  private states: number[] = [];
  /** Previous event indicator values (for sign-change detection). */
  private prevIndicators: number[] = [];

  constructor(options: ModelExchangeParticipantOptions) {
    this.id = options.id;
    this.harnessPath = options.harnessPath ?? "fmu-harness";
    this.nStates = options.nStates;
    this.nEventIndicators = options.nEventIndicators ?? 0;

    // Load metadata from storage
    const stored = options.storage.get(options.fmuId);
    if (!stored) {
      throw new Error(`FMU '${options.fmuId}' not found in storage`);
    }

    const archive = options.storage.getArchive(options.fmuId);
    if (!archive) {
      throw new Error(`FMU archive for '${options.fmuId}' not found`);
    }

    this.modelDesc = stored.modelDescription;
    this.modelName = this.modelDesc.modelName;

    // Write archive to temp file for harness
    this.fmuArchivePath = join(tmpdir(), `fmu-me-${options.fmuId}-${Date.now()}.fmu`);
    writeFileSync(this.fmuArchivePath, archive);

    // Build participant metadata
    const variables: ParticipantVariable[] = this.modelDesc.variables
      .filter((v) => v.causality !== "local")
      .map((v: FmiScalarVariable) => ({
        name: v.name,
        causality:
          v.causality === "calculatedParameter"
            ? ("parameter" as const)
            : (v.causality as ParticipantVariable["causality"]),
        type: (v.type === "Enumeration" ? "Integer" : v.type) as ParticipantVariable["type"],
        unit: v.unit,
        start: typeof v.start === "number" ? v.start : undefined,
        description: v.description,
      }));

    this.metadata = {
      participantId: this.id,
      modelName: this.modelName,
      type: "fmu-native",
      classKind: "model",
      description: this.modelDesc.description,
      variables,
      iconSvg: options.iconSvg,
      timestamp: new Date().toISOString(),
    };
  }

  async initialize(startTime: number, stopTime: number, stepSize: number): Promise<void> {
    // Spawn the harness subprocess
    this.process = spawn(this.harnessPath, [this.fmuArchivePath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Set up readline for JSON-RPC responses
    if (this.process.stdout) {
      this.readline = createInterface({ input: this.process.stdout });
      this.readline.on("line", (line: string) => {
        try {
          const response = JSON.parse(line) as HarnessResponse;
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(`Harness error: ${response.error.message}`));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch {
          // Malformed response
        }
      });
    }

    this.process.on("exit", (code) => {
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error(`Harness process exited with code ${code}`));
        this.pendingRequests.delete(id);
      }
    });

    // Initialize as Model Exchange
    await this.rpc("initialize", { startTime, stopTime, stepSize, fmuType: "me" });

    // Read initial continuous states
    this.states = (await this.rpc("getContinuousStates", { nx: this.nStates })) as number[];

    // Initialize event indicators
    if (this.nEventIndicators > 0) {
      this.prevIndicators = (await this.rpc("getEventIndicators", { nz: this.nEventIndicators })) as number[];
    }
  }

  /**
   * Advance by one communication step using RK4 integration.
   *
   * The solver evaluates derivatives at four points per sub-step:
   *   k1 = f(t, x)
   *   k2 = f(t + h/2, x + h/2·k1)
   *   k3 = f(t + h/2, x + h/2·k2)
   *   k4 = f(t + h, x + h·k3)
   *   x_new = x + h/6·(k1 + 2k2 + 2k3 + k4)
   */
  async doStep(currentTime: number, stepSize: number): Promise<void> {
    const nx = this.nStates;
    let t = currentTime;
    const tEnd = currentTime + stepSize;
    let h = stepSize;
    const x = [...this.states];

    while (t < tEnd - 1e-15) {
      if (t + h > tEnd) h = tEnd - t;

      // k1 = f(t, x)
      await this.rpc("setTime", { time: t });
      await this.rpc("setContinuousStates", { states: x });
      const k1 = (await this.rpc("getDerivatives", { nx })) as number[];

      // k2 = f(t + h/2, x + h/2·k1)
      await this.rpc("setTime", { time: t + 0.5 * h });
      const xk2 = x.map((xi, i) => xi + 0.5 * h * (k1[i] ?? 0));
      await this.rpc("setContinuousStates", { states: xk2 });
      const k2 = (await this.rpc("getDerivatives", { nx })) as number[];

      // k3 = f(t + h/2, x + h/2·k2)
      const xk3 = x.map((xi, i) => xi + 0.5 * h * (k2[i] ?? 0));
      await this.rpc("setContinuousStates", { states: xk3 });
      const k3 = (await this.rpc("getDerivatives", { nx })) as number[];

      // k4 = f(t + h, x + h·k3)
      await this.rpc("setTime", { time: t + h });
      const xk4 = x.map((xi, i) => xi + h * (k3[i] ?? 0));
      await this.rpc("setContinuousStates", { states: xk4 });
      const k4 = (await this.rpc("getDerivatives", { nx })) as number[];

      // Update state: x += h/6·(k1 + 2k2 + 2k3 + k4)
      for (let i = 0; i < nx; i++) {
        const xi = x[i] ?? 0;
        x[i] = xi + (h / 6) * ((k1[i] ?? 0) + 2 * (k2[i] ?? 0) + 2 * (k3[i] ?? 0) + (k4[i] ?? 0));
      }

      // Set final state
      await this.rpc("setContinuousStates", { states: x });

      // Notify FMU that integrator step completed
      const stepResult = (await this.rpc("completedIntegratorStep")) as IntegratorStepResult;

      // Handle events
      if (stepResult.enterEventMode || this.nEventIndicators > 0) {
        await this.handleEvents(stepResult.enterEventMode);
      }

      t += h;
    }

    this.states = x;
  }

  async getOutputs(): Promise<Map<string, CosimValue>> {
    const result = (await this.rpc("getOutputs")) as Record<string, number | string | boolean>;
    return new Map(Object.entries(result));
  }

  async setInputs(values: Map<string, CosimValue>): Promise<void> {
    await this.rpc("setInputs", { values: Object.fromEntries(values) });
  }

  async terminate(): Promise<void> {
    try {
      await this.rpc("terminate");
    } catch {
      // Process may have already exited
    }

    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    if (this.process) {
      this.process.kill("SIGTERM");
      const timeout = setTimeout(() => {
        this.process?.kill("SIGKILL");
      }, 5000);
      this.process.on("exit", () => clearTimeout(timeout));
      this.process = null;
    }

    try {
      unlinkSync(this.fmuArchivePath);
    } catch {
      // Best-effort cleanup
    }
  }

  // ── State management ──

  async getState(): Promise<unknown> {
    const result = (await this.rpc("getState")) as { stateId: number };
    return { stateId: result.stateId, states: [...this.states] };
  }

  async setState(state: unknown): Promise<void> {
    const s = state as { stateId: number; states: number[] };
    await this.rpc("setState", { stateId: s.stateId });
    this.states = [...s.states];
  }

  async freeState(state: unknown): Promise<void> {
    const s = state as { stateId: number };
    await this.rpc("freeState", { stateId: s.stateId });
  }

  // ── Event handling ──

  private async handleEvents(forceEventMode: boolean): Promise<void> {
    let needEvent = forceEventMode;

    // Check event indicators for sign changes
    if (this.nEventIndicators > 0) {
      const indicators = (await this.rpc("getEventIndicators", { nz: this.nEventIndicators })) as number[];
      for (let i = 0; i < this.nEventIndicators; i++) {
        const prev = this.prevIndicators[i] ?? 0;
        const curr = indicators[i] ?? 0;
        if ((prev <= 0 && curr > 0) || (prev > 0 && curr <= 0)) {
          needEvent = true;
          break;
        }
      }
      this.prevIndicators = indicators;
    }

    if (!needEvent) return;

    // Enter event mode
    await this.rpc("enterEventMode");

    // Iterate discrete state updates until stable.
    // FMI 3.0 uses "updateDiscreteStates" instead of "newDiscreteStates".
    // We try FMI 3.0 first, and fall back to FMI 2.0 on error.
    let iterating = true;
    while (iterating) {
      try {
        const info = (await this.rpc("updateDiscreteStates")) as EventInfo;
        iterating = info.newDiscreteStatesNeeded;
        if (info.terminateSimulation) break;
      } catch {
        // Fall back to FMI 2.0 API
        const info = (await this.rpc("newDiscreteStates")) as EventInfo;
        iterating = info.newDiscreteStatesNeeded;
        if (info.terminateSimulation) break;
      }
    }

    // Re-enter continuous time mode
    await this.rpc("enterContinuousTimeMode");

    // Re-read states (they may have changed during event handling)
    this.states = (await this.rpc("getContinuousStates", { nx: this.nStates })) as number[];
  }

  // ── JSON-RPC ──

  private rpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("Harness process not running"));
        return;
      }

      const id = ++this.requestId;
      const request: HarnessRequest = { method, id };
      if (params) request.params = params;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC timeout for '${method}'`));
      }, 30_000);

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.process.stdin.write(JSON.stringify(request) + "\n");
    });
  }
}
