// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly Bridge and Linear Memory Manager for GENSYS Contact Mechanics Kernel.
 *
 * Provides high-performance, zero-allocation solving of Kalker's FASTSIM algorithm
 * and Polach's non-linear wheel-rail creep force theory in WebAssembly linear memory.
 */

import type { FastsimContactInput, FastsimContactOutput } from "../types.js";
import type { PolachContactInput, PolachContactOutput } from "./polach.js";
import { getContactWasmBinary } from "./wasm-binary.js";

export interface ContactWasmExports {
  memory: WebAssembly.Memory;
  contact_alloc(size: number): number;
  contact_free(ptr: number): void;
  contact_get_scratch_base(): number;
  contact_get_scratch_buffer(): number;
  contact_fastsim(inputPtr: number, strips: number, outPtr: number): void;
  contact_polach(inputPtr: number, outPtr: number): void;
  contact_batch_fastsim(count: number, inputsPtr: number, strips: number, outputsPtr: number): void;
  contact_batch_polach(count: number, inputsPtr: number, outputsPtr: number): void;
}

export class WasmContactBridge {
  readonly instance: WebAssembly.Instance;
  readonly exports: ContactWasmExports;

  private readonly scratchBase: number;
  private readonly scratchFastsimIn: number;
  private readonly scratchFastsimOut: number;
  private readonly scratchPolachIn: number;
  private readonly scratchPolachOut: number;

  private f64View: Float64Array;

  private constructor(instance: WebAssembly.Instance) {
    this.instance = instance;
    this.exports = instance.exports as unknown as ContactWasmExports;

    this.scratchBase = this.exports.contact_get_scratch_base();
    this.scratchFastsimIn = this.scratchBase;
    this.scratchFastsimOut = this.scratchBase + 128;
    this.scratchPolachIn = this.scratchBase + 256;
    this.scratchPolachOut = this.scratchBase + 384;

    this.f64View = new Float64Array(this.exports.memory.buffer);
  }

  static create(): WasmContactBridge {
    const wasmBytes = getContactWasmBinary();
    const module = new WebAssembly.Module(wasmBytes.buffer as ArrayBuffer);
    const instance = new WebAssembly.Instance(module, {
      env: {
        abort: (msg: number, file: number, line: number, col: number) => {
          throw new Error(`AssemblyScript abort in contact.wasm at ${file}:${line}:${col} (msg: ${msg})`);
        },
      },
    });
    return new WasmContactBridge(instance);
  }

  private refreshViews(): void {
    if (this.f64View.buffer !== this.exports.memory.buffer) {
      this.f64View = new Float64Array(this.exports.memory.buffer);
    }
  }

  get memoryBuffer(): ArrayBuffer {
    return this.exports.memory.buffer;
  }

  alloc(size: number): number {
    const ptr = this.exports.contact_alloc(size);
    this.refreshViews();
    return ptr;
  }

  free(ptr: number): void {
    this.exports.contact_free(ptr);
  }

  /**
   * Solves Kalker's FASTSIM tangential contact algorithm in WebAssembly.
   */
  solveFastsim(input: FastsimContactInput, strips: number = 20): FastsimContactOutput {
    this.refreshViews();
    const f64 = this.f64View;
    const inOff = this.scratchFastsimIn >> 3;

    f64[inOff + 0] = input.normalForce;
    f64[inOff + 1] = input.longitudinalCreep;
    f64[inOff + 2] = input.lateralCreep;
    f64[inOff + 3] = input.spin;
    f64[inOff + 4] = input.ellipseSemiMajor;
    f64[inOff + 5] = input.ellipseSemiMinor;
    f64[inOff + 6] = input.shearModulus;
    f64[inOff + 7] = input.poissonRatio;
    f64[inOff + 8] = input.frictionCoeff;

    this.exports.contact_fastsim(this.scratchFastsimIn, strips, this.scratchFastsimOut);

    const outOff = this.scratchFastsimOut >> 3;
    return {
      fx: f64[outOff + 0]!,
      fy: f64[outOff + 1]!,
      mz: f64[outOff + 2]!,
      adhesionRatio: f64[outOff + 3]!,
    };
  }

  /**
   * Solves Polach's non-linear wheel-rail creep force theory in WebAssembly.
   */
  solvePolach(input: PolachContactInput): PolachContactOutput {
    this.refreshViews();
    const f64 = this.f64View;
    const inOff = this.scratchPolachIn >> 3;

    f64[inOff + 0] = input.normalForce;
    f64[inOff + 1] = input.longitudinalCreep;
    f64[inOff + 2] = input.lateralCreep;
    f64[inOff + 3] = input.wheelVelocity;
    f64[inOff + 4] = input.ellipseSemiMajor;
    f64[inOff + 5] = input.ellipseSemiMinor;
    f64[inOff + 6] = input.shearModulus ?? 8.2e10;
    f64[inOff + 7] = input.poissonRatio ?? 0.28;
    f64[inOff + 8] = input.staticFriction ?? 0.4;
    f64[inOff + 9] = input.kineticFrictionRatio ?? 0.75;
    f64[inOff + 10] = input.frictionDecayRate ?? 0.4;

    this.exports.contact_polach(this.scratchPolachIn, this.scratchPolachOut);

    const outOff = this.scratchPolachOut >> 3;
    return {
      fx: f64[outOff + 0]!,
      fy: f64[outOff + 1]!,
      resultantForce: f64[outOff + 2]!,
      effectiveFrictionCoeff: f64[outOff + 3]!,
      adhesionRatio: f64[outOff + 4]!,
    };
  }

  /**
   * Batched FASTSIM evaluation for multi-axle trains.
   */
  batchFastsim(inputs: FastsimContactInput[], strips: number = 20): FastsimContactOutput[] {
    const count = inputs.length;
    if (count === 0) return [];

    this.refreshViews();

    const inBytes = count * 72;
    const outBytes = count * 32;

    const inPtr = this.alloc(inBytes);
    const outPtr = this.alloc(outBytes);
    const f64 = this.f64View;

    let inOff = inPtr >> 3;
    for (let i = 0; i < count; i++) {
      const inp = inputs[i]!;
      f64[inOff + 0] = inp.normalForce;
      f64[inOff + 1] = inp.longitudinalCreep;
      f64[inOff + 2] = inp.lateralCreep;
      f64[inOff + 3] = inp.spin;
      f64[inOff + 4] = inp.ellipseSemiMajor;
      f64[inOff + 5] = inp.ellipseSemiMinor;
      f64[inOff + 6] = inp.shearModulus;
      f64[inOff + 7] = inp.poissonRatio;
      f64[inOff + 8] = inp.frictionCoeff;
      inOff += 9;
    }

    this.exports.contact_batch_fastsim(count, inPtr, strips, outPtr);

    const results: FastsimContactOutput[] = new Array(count);
    let outOff = outPtr >> 3;
    for (let i = 0; i < count; i++) {
      results[i] = {
        fx: f64[outOff + 0]!,
        fy: f64[outOff + 1]!,
        mz: f64[outOff + 2]!,
        adhesionRatio: f64[outOff + 3]!,
      };
      outOff += 4;
    }

    this.free(inPtr);
    this.free(outPtr);

    return results;
  }

  /**
   * Batched Polach evaluation for multi-axle trains.
   */
  batchPolach(inputs: PolachContactInput[]): PolachContactOutput[] {
    const count = inputs.length;
    if (count === 0) return [];

    this.refreshViews();

    const inBytes = count * 88;
    const outBytes = count * 40;

    const inPtr = this.alloc(inBytes);
    const outPtr = this.alloc(outBytes);
    const f64 = this.f64View;

    let inOff = inPtr >> 3;
    for (let i = 0; i < count; i++) {
      const inp = inputs[i]!;
      f64[inOff + 0] = inp.normalForce;
      f64[inOff + 1] = inp.longitudinalCreep;
      f64[inOff + 2] = inp.lateralCreep;
      f64[inOff + 3] = inp.wheelVelocity;
      f64[inOff + 4] = inp.ellipseSemiMajor;
      f64[inOff + 5] = inp.ellipseSemiMinor;
      f64[inOff + 6] = inp.shearModulus ?? 8.2e10;
      f64[inOff + 7] = inp.poissonRatio ?? 0.28;
      f64[inOff + 8] = inp.staticFriction ?? 0.4;
      f64[inOff + 9] = inp.kineticFrictionRatio ?? 0.75;
      f64[inOff + 10] = inp.frictionDecayRate ?? 0.4;
      inOff += 11;
    }

    this.exports.contact_batch_polach(count, inPtr, outPtr);

    const results: PolachContactOutput[] = new Array(count);
    let outOff = outPtr >> 3;
    for (let i = 0; i < count; i++) {
      results[i] = {
        fx: f64[outOff + 0]!,
        fy: f64[outOff + 1]!,
        resultantForce: f64[outOff + 2]!,
        effectiveFrictionCoeff: f64[outOff + 3]!,
        adhesionRatio: f64[outOff + 4]!,
      };
      outOff += 5;
    }

    this.free(inPtr);
    this.free(outPtr);

    return results;
  }
}

// Global cached instance
let cachedBridge: WasmContactBridge | null = null;

export function getWasmContactBridge(): WasmContactBridge {
  if (!cachedBridge) {
    cachedBridge = WasmContactBridge.create();
  }
  return cachedBridge;
}
