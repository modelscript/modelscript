// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU-native co-simulation participant.
 *
 * Spawns a thin harness subprocess that loads the FMU shared library
 * and communicates via a simple JSON-RPC protocol over stdin/stdout.
 *
 * Architecture:
 *   Orchestrator ↔ FmuNativeParticipant ↔ [stdin/stdout] ↔ fmu-harness binary ↔ FMU .so/.dll
 *
 * The harness binary must be pre-built and available on PATH or at
 * a configured location. It implements a simple protocol:
 *
 *   → {"method":"initialize", "params":{"startTime":0,"stopTime":10,"stepSize":0.01}}
 *   ← {"result":"ok"}
 *   → {"method":"setInputs", "params":{"values":{"x":1.0}}}
 *   ← {"result":"ok"}
 *   → {"method":"doStep", "params":{"currentTime":0,"stepSize":0.01}}
 *   ← {"result":"ok"}
 *   → {"method":"getOutputs"}
 *   ← {"result":{"y":2.0}}
 *   → {"method":"terminate"}
 *   ← {"result":"ok"}
 */

import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createInterface, type Interface } from "readline";
import type { FmiModelDescription, FmiScalarVariable } from "../../fmu/model-description.js";
import type { FmuStorage } from "../../fmu/storage.js";
import type { CosimValue } from "../coupling.js";
import type { ParticipantMetadata, ParticipantVariable } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

/** JSON-RPC request to the harness. */
interface HarnessRequest {
  method: string;
  params?: Record<string, unknown> | undefined;
  id: number;
}

/** JSON-RPC response from the harness. */
interface HarnessResponse {
  result?: unknown;
  error?: { code: number; message: string } | undefined;
  id: number;
}

/**
 * Options for creating an FMU-native participant.
 */
export interface FmuNativeParticipantOptions {
  /** Unique participant ID. */
  id: string;
  /** FMU ID in the FmuStorage. */
  fmuId: string;
  /** FmuStorage instance. */
  storage: FmuStorage;
  /** Path to the FMU harness binary. Default: "fmu-harness" on PATH. */
  harnessPath?: string | undefined;
  /** FMI interface type: 'cs' (Co-Simulation) or 'me' (Model Exchange). */
  interfaceType?: "cs" | "me" | undefined;
  /** ODE solver when running in Model Exchange mode ('rk4' | 'euler'). */
  solver?: string | undefined;
  /** Enable FMI call logging to stderr. */
  logFmiCalls?: boolean | undefined;
  /** Optional SVG icon override. */
  iconSvg?: string | undefined;
}

/**
 * Co-simulation participant backed by a native FMU shared library.
 *
 * Uses a subprocess harness to dlopen() the FMU and communicate
 * via JSON-RPC over stdin/stdout. Supports concurrent step execution
 * and graceful shutdown with timeout.
 */
export class FmuNativeParticipant implements CoSimParticipant {
  /** Unique co-simulation participant identifier. */
  readonly id: string;
  /** FMI model name extracted from `modelDescription.xml`. */
  readonly modelName: string;
  /** Participant variable and port metadata advertised to the orchestrator. */
  readonly metadata: ParticipantMetadata;

  /** Temporary filesystem path to the extracted `.fmu` archive passed to the harness binary. */
  private readonly fmuArchivePath: string;
  /** Path or binary name of the native `fmu-harness` executable. */
  private readonly harnessPath: string;
  /** Parsed FMI 2.0/3.0 `modelDescription.xml` descriptor. */
  private readonly modelDesc: FmiModelDescription;
  /** Selected FMI interface type ('cs' or 'me'). */
  private readonly interfaceType: "cs" | "me";
  /** Solver for Model Exchange mode. */
  private readonly solver: string;
  /** Whether to log FMI calls. */
  private readonly logFmiCalls: boolean;
  /** Variable lookup by name. */
  private readonly varByName = new Map<string, FmiScalarVariable>();
  /** Variable lookup by VR. */
  private readonly varByVr = new Map<number, FmiScalarVariable>();

  /** Active child process running the native `fmu-harness` binary. */
  private process: ChildProcess | null = null;
  /** Line-delimited stdout reader for JSON-RPC responses from the harness. */
  private readline: Interface | null = null;
  /** Monotonically increasing JSON-RPC request counter. */
  private requestId = 0;
  /** In-flight JSON-RPC requests awaiting a response line from the harness subprocess. */
  private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();

  /** Creates a native FMU co-simulation participant and stages its `.fmu` archive to a temporary file. */
  constructor(options: FmuNativeParticipantOptions) {
    this.id = options.id;
    this.harnessPath = options.harnessPath ?? "fmu-harness";
    this.solver = options.solver ?? "rk4";
    this.logFmiCalls = options.logFmiCalls ?? false;

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
    this.interfaceType =
      options.interfaceType ??
      (!this.modelDesc.supportsCoSimulation && this.modelDesc.supportsModelExchange ? "me" : "cs");

    for (const v of this.modelDesc.variables) {
      this.varByName.set(v.name, v);
      if (!this.varByVr.has(v.valueReference)) {
        this.varByVr.set(v.valueReference, v);
      }
    }

    // Write archive to temp file for harness
    this.fmuArchivePath = join(tmpdir(), `fmu-${options.fmuId}-${Date.now()}.fmu`);
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

  /** Spawns the `fmu-harness` subprocess and initializes the FMU for `[startTime, stopTime]`. */
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
      // Reject all pending requests on process exit
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error(`Harness process exited with code ${code}`));
        this.pendingRequests.delete(id);
      }
    });

    // Send initialize command
    await this.rpc("initialize", {
      startTime,
      stopTime,
      stepSize,
      fmuType: this.interfaceType,
      nx: this.modelDesc.modelStructure?.derivatives.length ?? 0,
      nz: this.modelDesc.numberOfEventIndicators ?? 0,
      logFmiCalls: this.logFmiCalls ? 1 : 0,
    });
  }

  /** Advances the native FMU from `currentTime` by `stepSize` (`fmi2DoStep` / `fmi3DoStep` or ME RK4/Euler). */
  async doStep(currentTime: number, stepSize: number): Promise<void> {
    const result = await this.rpc("doStep", { currentTime, stepSize, solver: this.solver });
    // Handle async FMUs that return fmi2Pending
    if (result === "pending") {
      // Poll until step completes
      let resolved = false;
      while (!resolved) {
        await new Promise((r) => setTimeout(r, 50));
        const status = await this.rpc("getStepStatus");
        if (status === "ok") resolved = true;
      }
    }
  }

  /** Cancel an in-progress async step (for FMUs that return fmi2Pending). */
  async cancelStep(): Promise<void> {
    await this.rpc("cancelStep");
  }

  /** Retrieves all current output variable values from the native FMU instance. */
  async getOutputs(): Promise<Map<string, CosimValue>> {
    const queryVars = this.modelDesc.variables.filter((v) => v.type !== "Clock" && v.causality !== "independent");
    const realRefs = queryVars.filter((v) => v.type === "Real").map((v) => v.valueReference);
    const intRefs = queryVars
      .filter((v) => v.type === "Integer" || v.type === "Enumeration")
      .map((v) => v.valueReference);
    const boolRefs = queryVars.filter((v) => v.type === "Boolean").map((v) => v.valueReference);
    const stringRefs = queryVars.filter((v) => v.type === "String").map((v) => v.valueReference);

    const result = (await this.rpc("getOutputs", {
      valueReferences: realRefs,
      intRefs,
      boolRefs,
      stringRefs,
    })) as Record<string, number | string | boolean>;
    const out = new Map<string, CosimValue>();
    for (const [k, v] of Object.entries(result)) {
      out.set(k, v);
      const vr = Number(k);
      if (!Number.isNaN(vr)) {
        const sv = this.varByVr.get(vr);
        if (sv) out.set(sv.name, v);
      }
    }
    return out;
  }

  /** Sets input variable values on the native FMU instance prior to the next communication step. */
  async setInputs(values: Map<string, CosimValue>): Promise<void> {
    const vrValues: Record<string, CosimValue> = {};
    const intValues: Record<string, number> = {};
    for (const [k, v] of values) {
      const sv = this.varByName.get(k);
      if (sv) {
        if ((sv.type === "Integer" || sv.type === "Enumeration") && typeof v === "number") {
          intValues[String(sv.valueReference)] = Math.trunc(v);
        } else {
          vrValues[String(sv.valueReference)] = v;
        }
      } else {
        vrValues[k] = v;
      }
    }
    await this.rpc("setInputs", { values: vrValues, intValues });
  }

  /** Saves the current FMU state to a binary file on disk. */
  async saveStateToFile(filePath: string): Promise<void> {
    await this.rpc("saveStateToFile", { filePath });
  }

  /** Restores the FMU state from a binary file on disk. */
  async loadStateFromFile(filePath: string): Promise<void> {
    await this.rpc("loadStateFromFile", { filePath });
  }

  /** Terminates the FMU instance, kills the `fmu-harness` subprocess, and deletes the temporary `.fmu` file. */
  async terminate(): Promise<void> {
    try {
      await this.rpc("terminate");
    } catch {
      // Process may have already exited
    }

    // Clean up
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    if (this.process) {
      this.process.kill("SIGTERM");
      // Force kill after 5s
      const timeout = setTimeout(() => {
        this.process?.kill("SIGKILL");
      }, 5000);
      this.process.on("exit", () => clearTimeout(timeout));
      this.process = null;
    }

    // Clean up temp archive file
    try {
      unlinkSync(this.fmuArchivePath);
    } catch {
      // Best-effort cleanup
    }
  }

  // ── JSON-RPC ──

  /** Sends a newline-delimited JSON-RPC request to the harness over stdin with a 30-second timeout. */
  private rpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("Harness process not running"));
        return;
      }

      const id = ++this.requestId;
      const request: HarnessRequest = { method, id };
      if (params) request.params = params;

      // Timeout after 30s
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

  // ── State management ──

  /** Indicates support for `fmi2GetFMUstate` / `fmi2SetFMUstate` rollback snapshots. */
  readonly canGetAndSetState = true;
  /** Indicates support for `fmi2GetDirectionalDerivative` Jacobian-vector products. */
  readonly providesDirectionalDerivatives = true;

  /** Captures and returns an opaque handle (`stateId`) to the FMU's current internal state. */
  async getState(): Promise<unknown> {
    const result = (await this.rpc("getState")) as { stateId: number };
    return result.stateId;
  }

  /** Restores the FMU's internal state from a previously captured `stateId` handle. */
  async setState(state: unknown): Promise<void> {
    await this.rpc("setState", { stateId: state as number });
  }

  /** Releases memory associated with a previously captured FMU `stateId` handle. */
  async freeState(state: unknown): Promise<void> {
    await this.rpc("freeState", { stateId: state as number });
  }

  // ── Directional derivatives ──

  /** Computes directional derivatives $\Delta v_{\text{unknown}} = J \cdot \Delta v_{\text{known}}$ via `fmi2GetDirectionalDerivative`. */
  async getDirectionalDerivative(unknownRefs: number[], knownRefs: number[], dvKnown: number[]): Promise<number[]> {
    const result = await this.rpc("getDirectionalDerivative", {
      unknownRefs,
      knownRefs,
      dvKnown,
    });
    return result as number[];
  }
}
