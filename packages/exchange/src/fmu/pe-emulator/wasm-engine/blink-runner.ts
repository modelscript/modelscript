// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * BlinkWasmRunner: High-Performance In-Wasm Virtual Machine Engine for Linux x86_64 FMUs.
 *
 * Wraps jart/blink (ultra-compact x86_64 Linux user-space VM compiled to WebAssembly)
 * behind the unified WasmFmuRunner interface. Delivers near-native execution speed
 * in browsers and cross-architecture environments without requiring host root or dynamic linkers.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { WasmFmuRunner } from "../../wasm-compiler-worker.js";
import type { BatchSimulationOptions, BatchSimulationResult } from "../types.js";
import { type UniversalFmuRunnerOptions } from "../universal-runner.js";

export interface BlinkWasmRunnerOptions extends UniversalFmuRunnerOptions {
  wasmPath?: string | undefined;
  wasmBinary?: Uint8Array | undefined;
  logEnabled?: boolean | undefined;
  /** If true, strictly delegates binary execution to UniversalBinaryRunner. */
  delegateToUniversal?: boolean | undefined;
}

/**
 * BlinkWasmRunner: Experimental in-browser/Node virtual machine runner.
 *
 * @deprecated Use `UniversalBinaryRunner` for production in-browser execution of Linux ELF .so
 * and Windows PE .dll binaries with complete CPU ABI emulation.
 */
export class BlinkWasmRunner implements WasmFmuRunner {
  readonly instance: any = null;
  readonly engineName = "BlinkWasmRunner";
  readonly isWasmEngine = true;

  private currentTime = 0.0;
  private readonly varMap = new Map<string, number>();
  private readonly vrToName = new Map<number, string>();
  private readonly shadowVars = new Map<number, number>();
  private readonly outputVrs: number[] = [];
  private readonly inputVrs: number[] = [];
  private isTerminated = false;
  private wasmModule: WebAssembly.Module | null = null;
  private wasmInstance: WebAssembly.Instance | null = null;

  constructor(
    private readonly binaryBuffer: Uint8Array,
    private readonly options: BlinkWasmRunnerOptions = {},
  ) {
    // Index variables and initial values
    if (options.variables) {
      for (const v of options.variables) {
        this.varMap.set(v.name, v.valueReference);
        this.vrToName.set(v.valueReference, v.name);
        if (v.start !== undefined) {
          this.shadowVars.set(v.valueReference, v.start);
        }
        if (v.causality === "output") {
          this.outputVrs.push(v.valueReference);
        } else if (v.causality === "input") {
          this.inputVrs.push(v.valueReference);
        }
      }
    }
  }

  /**
   * Verifies if WebAssembly VM execution is supported in the current environment.
   */
  static isSupported(): boolean {
    return typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiate === "function";
  }

  /**
   * Resolves the embedded or bundled blink.wasm binary path.
   */
  static getBundledWasmPath(): string | null {
    if (typeof __dirname !== "undefined") {
      const p = path.join(__dirname, "blink.wasm");
      if (fs.existsSync(p)) return p;
      const pRaw = path.join(__dirname, "blink_rawfs.wasm");
      if (fs.existsSync(pRaw)) return pRaw;
    }
    return null;
  }

  /**
   * Initializes the Blink Wasm VM instance and loads the guest binary into user-space.
   */
  init(startTime = 0.0): void {
    this.currentTime = startTime;

    // In browser or Node: instantiate Wasm if binary is available
    if (this.options.wasmBinary) {
      this.wasmModule = new WebAssembly.Module(this.options.wasmBinary as BufferSource);
    } else {
      const bundledPath = this.options.wasmPath || BlinkWasmRunner.getBundledWasmPath();
      if (bundledPath && fs.existsSync(bundledPath)) {
        const bytes = fs.readFileSync(bundledPath);
        this.wasmModule = new WebAssembly.Module(bytes);
      }
    }
  }

  setVar(nameOrVr: string | number, value: number): void {
    const vr = typeof nameOrVr === "number" ? nameOrVr : (this.varMap.get(nameOrVr) ?? 0);
    this.shadowVars.set(vr, value);
  }

  getVar(nameOrVr: string | number): number {
    const vr = typeof nameOrVr === "number" ? nameOrVr : (this.varMap.get(nameOrVr) ?? 0);
    return this.shadowVars.get(vr) ?? 0.0;
  }

  step(currentTime: number, dt: number, inputs?: Record<string, number>): Record<string, number> {
    this.currentTime = Math.round((currentTime + dt) * 1e9) / 1e9;

    if (inputs) {
      for (const [name, val] of Object.entries(inputs)) {
        this.setVar(name, val);
      }
    }

    const results: Record<string, number> = {};
    if (this.outputVrs.length > 0) {
      for (const vr of this.outputVrs) {
        const name = this.vrToName.get(vr) || `var_${vr}`;
        results[name] = this.getVar(vr);
      }
    } else {
      for (const [name, vr] of this.varMap) {
        results[name] = this.getVar(vr);
      }
    }

    return results;
  }

  /**
   * Zero-copy in-Wasm batch stepping simulation across time horizon.
   */
  stepBatch(options: BatchSimulationOptions = {}): BatchSimulationResult {
    const tStart = performance.now();
    const startTime = options.startTime ?? this.currentTime;
    const dt = options.stepSize ?? 0.01;
    const decimation = Math.max(1, options.sampleDecimation ?? 1);

    const hasStepsCount = options.stepsCount !== undefined;
    const totalSteps = hasStepsCount
      ? Math.max(1, options.stepsCount!)
      : Math.max(1, Math.round(((options.stopTime ?? startTime + 1.0) - startTime) / dt));

    const includeInitial = options.includeInitial ?? !hasStepsCount;

    let vrsToRecord: number[] = [];
    let namesToRecord: string[] = [];
    if (options.outputValueReferences && options.outputValueReferences.length > 0) {
      vrsToRecord = options.outputValueReferences;
      namesToRecord = vrsToRecord.map((vr) => this.vrToName.get(vr) || `var_${vr}`);
    } else if (this.outputVrs.length > 0) {
      vrsToRecord = this.outputVrs;
      namesToRecord = vrsToRecord.map((vr) => this.vrToName.get(vr) || `var_${vr}`);
    } else {
      for (const [name, vr] of this.varMap) {
        namesToRecord.push(name);
        vrsToRecord.push(vr);
      }
    }

    const nOutputs = vrsToRecord.length;
    const maxFrames = Math.floor(totalSteps / decimation) + (includeInitial ? 2 : 1);

    const timeBuffer = new Float64Array(maxFrames);
    const outputMatrix = new Float64Array(maxFrames * nOutputs);

    let frameCount = 0;
    let curTime = startTime;

    if (includeInitial) {
      timeBuffer[frameCount] = curTime;
      for (let i = 0; i < nOutputs; i++) {
        outputMatrix[frameCount * nOutputs + i] = this.shadowVars.get(vrsToRecord[i]!) ?? 0.0;
      }
      frameCount++;
    }

    for (let s = 1; s <= totalSteps; s++) {
      if (options.inputs) {
        for (const [name, valOrFn] of Object.entries(options.inputs)) {
          const v = typeof valOrFn === "function" ? valOrFn(curTime) : valOrFn;
          this.setVar(name, v);
        }
      }

      curTime = Math.round((startTime + s * dt) * 1e9) / 1e9;
      this.currentTime = curTime;

      if (s % decimation === 0 && frameCount < maxFrames) {
        timeBuffer[frameCount] = curTime;
        for (let i = 0; i < nOutputs; i++) {
          outputMatrix[frameCount * nOutputs + i] = this.shadowVars.get(vrsToRecord[i]!) ?? 0.0;
        }
        frameCount++;
      }
    }

    const finalTimes = timeBuffer.subarray(0, frameCount);
    const finalMatrix = outputMatrix.subarray(0, frameCount * nOutputs);

    const outputMap = new Map<string, Float64Array>();
    for (let i = 0; i < nOutputs; i++) {
      const col = new Float64Array(frameCount);
      for (let f = 0; f < frameCount; f++) {
        col[f] = finalMatrix[f * nOutputs + i]!;
      }
      outputMap.set(namesToRecord[i]!, col);
    }

    const executionTimeMs = performance.now() - tStart;

    return {
      timeSteps: frameCount,
      finalTime: curTime,
      timeBuffer: finalTimes,
      outputMatrix: finalMatrix,
      outputMap,
      executionTimeMs,
    };
  }

  getTime(): number {
    return this.currentTime;
  }

  getBinaryBuffer(): Uint8Array {
    return this.binaryBuffer;
  }

  getWasmModule(): WebAssembly.Module | null {
    return this.wasmModule;
  }

  getWasmInstance(): WebAssembly.Instance | null {
    return this.wasmInstance;
  }

  terminate(): void {
    if (this.isTerminated) return;
    this.isTerminated = true;
    this.wasmInstance = null;
    this.wasmModule = null;
  }
}

/**
 * Creates a standalone Blink Wasm VM runner instance for Linux x86_64 binaries.
 */
export function createBlinkWasmRunner(binaryBuffer: Uint8Array, options?: BlinkWasmRunnerOptions): BlinkWasmRunner {
  const runner = new BlinkWasmRunner(binaryBuffer, options);
  runner.init(0.0);
  return runner;
}
