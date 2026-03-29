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
  readonly id: string;
  readonly modelName: string;
  readonly metadata: ParticipantMetadata;

  private readonly fmuArchivePath: string;
  private readonly harnessPath: string;
  private readonly modelDesc: FmiModelDescription;

  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();

  constructor(options: FmuNativeParticipantOptions) {
    this.id = options.id;
    this.harnessPath = options.harnessPath ?? "fmu-harness";

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
    await this.rpc("initialize", { startTime, stopTime, stepSize });
  }

  async doStep(currentTime: number, stepSize: number): Promise<void> {
    await this.rpc("doStep", { currentTime, stepSize });
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

  readonly canGetAndSetState = true;

  async getState(): Promise<unknown> {
    const result = (await this.rpc("getState")) as { stateId: number };
    return result.stateId;
  }

  async setState(state: unknown): Promise<void> {
    await this.rpc("setState", { stateId: state as number });
  }

  async freeState(state: unknown): Promise<void> {
    await this.rpc("freeState", { stateId: state as number });
  }
}
