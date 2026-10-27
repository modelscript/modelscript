// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dedicated In-Browser WebWorker Sandbox & Client for Universal Binary FMUs.
 *
 * Runs Windows PE (.dll) and Linux ELF (.so) binary emulations off the main
 * UI thread, streaming trajectory frames via zero-copy transferable ArrayBuffers
 * to prevent UI frame drops and guarantee 60fps rendering in BlackboxInspector.
 */

import type { WasmFmuRunner } from "../wasm-compiler-worker.js";
import { type UniversalFmuRunnerOptions, UniversalBinaryRunner } from "./universal-runner.js";

// ── Protocol Types ─────────────────────────────────────────────────────────────

export interface EmulatorInitMsg {
  type: "EMULATOR_INIT";
  id: string;
  binary: ArrayBuffer;
  options?: UniversalFmuRunnerOptions | undefined;
}

export interface EmulatorStepMsg {
  type: "EMULATOR_STEP";
  id: string;
  currentTime: number;
  dt: number;
  stepsCount?: number | undefined;
  inputs?: Record<string, number> | undefined;
  decimation?: number | undefined;
  outputValueReferences?: number[] | undefined;
  includeInitial?: boolean | undefined;
}

export interface EmulatorSetVarMsg {
  type: "EMULATOR_SET_VAR";
  id: string;
  nameOrVr: string | number;
  value: number;
}

export interface EmulatorGetVarMsg {
  type: "EMULATOR_GET_VAR";
  id: string;
  nameOrVr: string | number;
}

export interface EmulatorTerminateMsg {
  type: "EMULATOR_TERMINATE";
  id: string;
}

export type EmulatorWorkerRequest =
  | EmulatorInitMsg
  | EmulatorStepMsg
  | EmulatorSetVarMsg
  | EmulatorGetVarMsg
  | EmulatorTerminateMsg;

export interface EmulatorInitResponse {
  type: "INIT_OK";
  id: string;
  format: "pe" | "elf" | "macho" | "unknown";
  architecture: "x86_64" | "aarch64" | "i386";
  abi: "win64" | "systemv" | "aapcs64";
}

export interface EmulatorStepResponse {
  type: "STEP_OK";
  id: string;
  time: number;
  outputs: Record<string, number>;
  batch?:
    | {
        times: Float64Array;
        series: Record<string, Float64Array>;
      }
    | undefined;
}

export interface EmulatorGetVarResponse {
  type: "GET_VAR_OK";
  id: string;
  value: number;
}

export interface EmulatorErrorResponse {
  type: "ERROR";
  id: string;
  error: string;
}

export type EmulatorWorkerResponse =
  | EmulatorInitResponse
  | EmulatorStepResponse
  | EmulatorGetVarResponse
  | EmulatorErrorResponse;

// ── WebWorker Runtime Environment ─────────────────────────────────────────────

let workerRunner: UniversalBinaryRunner | null = null;

interface WorkerGlobalScopeLike {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  importScripts?: (...urls: string[]) => void;
}

const workerSelf = typeof self !== "undefined" ? (self as unknown as WorkerGlobalScopeLike) : undefined;

if (workerSelf && typeof workerSelf.postMessage === "function" && typeof workerSelf.importScripts === "function") {
  self.addEventListener("message", (evt: MessageEvent<EmulatorWorkerRequest>) => {
    const msg = evt.data;
    try {
      switch (msg.type) {
        case "EMULATOR_INIT": {
          const uint8 = new Uint8Array(msg.binary);
          workerRunner = new UniversalBinaryRunner(uint8, msg.options);
          workerRunner.init(0.0);

          const arch =
            workerRunner.loader instanceof UniversalBinaryRunner
              ? "x86_64"
              : workerRunner.cpu.abi === "aapcs64"
                ? "aarch64"
                : "x86_64";

          const res: EmulatorInitResponse = {
            type: "INIT_OK",
            id: msg.id,
            format: workerRunner.format,
            architecture: arch,
            abi: workerRunner.cpu.abi as "win64" | "systemv" | "aapcs64",
          };
          workerSelf.postMessage(res);
          break;
        }

        case "EMULATOR_STEP": {
          if (!workerRunner) {
            throw new Error("Emulator worker is not initialized");
          }

          const stepsCount = msg.stepsCount ?? 1;
          if (stepsCount > 1) {
            // High-throughput batch stepping using UniversalBinaryRunner.stepBatch
            const batchResult = workerRunner.stepBatch({
              startTime: msg.currentTime,
              stepSize: msg.dt,
              stepsCount,
              inputs: msg.inputs,
              sampleDecimation: msg.decimation,
              outputValueReferences: msg.outputValueReferences,
              includeInitial: msg.includeInitial,
            });

            const series: Record<string, Float64Array> = {};
            const transferables: ArrayBuffer[] = [
              batchResult.timeBuffer.buffer as ArrayBuffer,
              batchResult.outputMatrix.buffer as ArrayBuffer,
            ];

            const lastOutputs: Record<string, number> = {};
            for (const [name, col] of batchResult.outputMap.entries()) {
              series[name] = col;
              transferables.push(col.buffer as ArrayBuffer);
              if (col.length > 0) {
                lastOutputs[name] = col[col.length - 1]!;
              }
            }

            const res: EmulatorStepResponse = {
              type: "STEP_OK",
              id: msg.id,
              time: batchResult.finalTime,
              outputs: lastOutputs,
              batch: { times: batchResult.timeBuffer, series },
            };
            workerSelf.postMessage(res, transferables);
          } else {
            const outputs = workerRunner.step(msg.currentTime, msg.dt, msg.inputs);
            const res: EmulatorStepResponse = {
              type: "STEP_OK",
              id: msg.id,
              time: workerRunner.getTime(),
              outputs,
            };
            workerSelf.postMessage(res);
          }
          break;
        }

        case "EMULATOR_SET_VAR": {
          if (!workerRunner) throw new Error("Emulator worker is not initialized");
          workerRunner.setVar(msg.nameOrVr, msg.value);
          break;
        }

        case "EMULATOR_GET_VAR": {
          if (!workerRunner) throw new Error("Emulator worker is not initialized");
          const val = workerRunner.getVar(msg.nameOrVr);
          const res: EmulatorGetVarResponse = {
            type: "GET_VAR_OK",
            id: msg.id,
            value: val,
          };
          workerSelf.postMessage(res);
          break;
        }

        case "EMULATOR_TERMINATE": {
          if (workerRunner) {
            workerRunner.terminate();
            workerRunner = null;
          }
          break;
        }
      }
    } catch (err: unknown) {
      const errRes: EmulatorErrorResponse = {
        type: "ERROR",
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      };
      workerSelf.postMessage(errRes);
    }
  });
}

// ── Client Interface (Browser WebWorker & Node.js Universal Client) ────────────

export class EmulatorWorkerClient implements WasmFmuRunner {
  readonly instance: WebAssembly.Instance | null = null;
  private worker: Worker | null = null;
  private inProcessRunner: UniversalBinaryRunner | null = null;
  private readonly pendingRequests = new Map<
    string,
    { resolve: (val: EmulatorWorkerResponse) => void; reject: (err: Error) => void }
  >();
  private nextRequestId = 1;
  private currentTime = 0.0;
  private isTerminated = false;

  format: "pe" | "elf" | "macho" | "unknown" = "unknown";
  architecture: "x86_64" | "aarch64" | "i386" = "x86_64";
  abi: "win64" | "systemv" | "aapcs64" = "win64";

  constructor(
    private readonly binaryBuffer: Uint8Array | ArrayBuffer,
    private readonly options: UniversalFmuRunnerOptions = {},
  ) {
    const rawBuf = binaryBuffer instanceof Uint8Array ? binaryBuffer : new Uint8Array(binaryBuffer);

    // Fallback directly to in-process UniversalBinaryRunner in Node.js or if Worker unavailable
    if (typeof Worker === "undefined") {
      this.inProcessRunner = new UniversalBinaryRunner(rawBuf, options);
      this.format = this.inProcessRunner.format;
      this.abi = this.inProcessRunner.cpu.abi as "win64" | "systemv" | "aapcs64";
      this.architecture = this.inProcessRunner.cpu.abi === "aapcs64" ? "aarch64" : "x86_64";
    }
  }

  async start(): Promise<void> {
    if (this.inProcessRunner) {
      this.inProcessRunner.init(0.0);
      return;
    }

    // In browser: Spawn WebWorker
    const workerScript = `
      importScripts("${typeof location !== "undefined" ? location.origin : ""}/workers/fmu-emulator-worker.js");
    `;
    const blob = new Blob([workerScript], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);

    try {
      this.worker = new Worker(blobUrl);
    } catch {
      // In-process fallback if blob worker blocked by CSP
      const rawBuf = this.binaryBuffer instanceof Uint8Array ? this.binaryBuffer : new Uint8Array(this.binaryBuffer);
      this.inProcessRunner = new UniversalBinaryRunner(rawBuf, this.options);
      this.inProcessRunner.init(0.0);
      this.format = this.inProcessRunner.format;
      this.abi = this.inProcessRunner.cpu.abi as "win64" | "systemv" | "aapcs64";
      return;
    }

    this.worker.addEventListener("message", (evt: MessageEvent<EmulatorWorkerResponse>) => {
      const msg = evt.data;
      const pending = this.pendingRequests.get(msg.id);
      if (!pending) return;

      this.pendingRequests.delete(msg.id);
      if (msg.type === "ERROR") {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg);
      }
    });

    // Send INIT message
    const reqId = `init_${this.nextRequestId++}`;
    const initMsg: EmulatorInitMsg = {
      type: "EMULATOR_INIT",
      id: reqId,
      binary:
        this.binaryBuffer instanceof Uint8Array
          ? (this.binaryBuffer.buffer.slice(
              this.binaryBuffer.byteOffset,
              this.binaryBuffer.byteOffset + this.binaryBuffer.byteLength,
            ) as ArrayBuffer)
          : (this.binaryBuffer as ArrayBuffer),
      options: this.options,
    };

    const res = await this.sendRequest<EmulatorInitResponse>(initMsg);
    this.format = res.format;
    this.architecture = res.architecture;
    this.abi = res.abi;
  }

  init(startTime = 0.0): void {
    this.currentTime = startTime;
    if (this.inProcessRunner) {
      this.inProcessRunner.init(startTime);
    }
  }

  step(currentTime: number, dt: number, inputs?: Record<string, number>): Record<string, number> {
    if (this.inProcessRunner) {
      const out = this.inProcessRunner.step(currentTime, dt, inputs);
      this.currentTime = this.inProcessRunner.getTime();
      return out;
    }

    // In synchronous WasmFmuRunner interface, advance tracked time
    this.currentTime = currentTime + dt;
    // Dispatch async fire-and-forget or batch
    const reqId = `step_${this.nextRequestId++}`;
    if (this.worker) {
      this.worker.postMessage({
        type: "EMULATOR_STEP",
        id: reqId,
        currentTime,
        dt,
        inputs,
      });
    }
    return {};
  }

  async stepAsync(currentTime: number, dt: number, inputs?: Record<string, number>): Promise<Record<string, number>> {
    if (this.inProcessRunner) {
      return this.step(currentTime, dt, inputs);
    }

    const reqId = `step_async_${this.nextRequestId++}`;
    const res = await this.sendRequest<EmulatorStepResponse>({
      type: "EMULATOR_STEP",
      id: reqId,
      currentTime,
      dt,
      inputs,
    });
    this.currentTime = res.time;
    return res.outputs;
  }

  /**
   * High-throughput batch stepping in background worker.
   * Streams trajectory frames via transferable ArrayBuffers without blocking UI.
   */
  async stepBatch(
    startTime: number,
    dt: number,
    stepsCount: number,
    inputs?: Record<string, number>,
    options?: { decimation?: number; outputValueReferences?: number[]; includeInitial?: boolean },
  ): Promise<{ times: Float64Array; series: Record<string, Float64Array> }> {
    if (this.inProcessRunner) {
      const batchResult = this.inProcessRunner.stepBatch({
        startTime,
        stepSize: dt,
        stepsCount,
        inputs,
        sampleDecimation: options?.decimation,
        outputValueReferences: options?.outputValueReferences,
        includeInitial: options?.includeInitial,
      });

      const series: Record<string, Float64Array> = {};
      for (const [name, col] of batchResult.outputMap.entries()) {
        series[name] = col;
      }
      this.currentTime = batchResult.finalTime;
      return { times: batchResult.timeBuffer, series };
    }

    const reqId = `batch_${this.nextRequestId++}`;
    const res = await this.sendRequest<EmulatorStepResponse>({
      type: "EMULATOR_STEP",
      id: reqId,
      currentTime: startTime,
      dt,
      stepsCount,
      inputs,
      decimation: options?.decimation,
      outputValueReferences: options?.outputValueReferences,
      includeInitial: options?.includeInitial,
    });
    this.currentTime = res.time;
    return res.batch ?? { times: new Float64Array(), series: {} };
  }

  setVar(nameOrVr: string | number, value: number): void {
    if (this.inProcessRunner) {
      this.inProcessRunner.setVar(nameOrVr, value);
      return;
    }

    if (this.worker) {
      this.worker.postMessage({
        type: "EMULATOR_SET_VAR",
        id: `set_${this.nextRequestId++}`,
        nameOrVr,
        value,
      });
    }
  }

  getVar(nameOrVr: string | number): number {
    if (this.inProcessRunner) {
      return this.inProcessRunner.getVar(nameOrVr);
    }
    return 0.0;
  }

  async getVarAsync(nameOrVr: string | number): Promise<number> {
    if (this.inProcessRunner) {
      return this.inProcessRunner.getVar(nameOrVr);
    }

    const reqId = `get_${this.nextRequestId++}`;
    const res = await this.sendRequest<EmulatorGetVarResponse>({
      type: "EMULATOR_GET_VAR",
      id: reqId,
      nameOrVr,
    });
    return res.value;
  }

  getTime(): number {
    return this.currentTime;
  }

  terminate(): void {
    if (this.isTerminated) return;
    this.isTerminated = true;

    if (this.inProcessRunner) {
      this.inProcessRunner.terminate();
      this.inProcessRunner = null;
    }

    if (this.worker) {
      this.worker.postMessage({
        type: "EMULATOR_TERMINATE",
        id: `term_${this.nextRequestId++}`,
      });
      this.worker.terminate();
      this.worker = null;
    }
  }

  private sendRequest<T>(req: EmulatorWorkerRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(req.id, { resolve: resolve as (val: EmulatorWorkerResponse) => void, reject });
      this.worker?.postMessage(req);
    });
  }
}
