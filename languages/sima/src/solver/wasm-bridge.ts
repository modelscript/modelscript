// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly Bridge and Linear Memory Manager for SIMA Marine Catenary Solvers.
 *
 * Executes analytical and shooting catenary calculations with zero allocations
 * in WebAssembly linear memory.
 */

import type { CatenaryResult, CatenarySolveParams } from "./catenary-solver.js";
import { getCatenaryWasmBinary } from "./wasm-binary.js";

export interface CatenaryWasmExports {
  memory: WebAssembly.Memory;
  catenary_get_buffer_base(): number;
  catenary_solve(h: number, X: number, L: number, w: number, ea: number): number;
}

export class WasmCatenaryBridge {
  private static instance: WasmCatenaryBridge | null = null;
  private readonly exports: CatenaryWasmExports;

  private constructor(wasmInstance: WebAssembly.Instance) {
    this.exports = wasmInstance.exports as unknown as CatenaryWasmExports;
  }

  public static getInstance(): WasmCatenaryBridge | null {
    if (WasmCatenaryBridge.instance) {
      return WasmCatenaryBridge.instance;
    }
    try {
      const bytes = getCatenaryWasmBinary();
      const module = new WebAssembly.Module(bytes as unknown as BufferSource);
      const wasmInstance = new WebAssembly.Instance(module, {});
      WasmCatenaryBridge.instance = new WasmCatenaryBridge(wasmInstance);
      return WasmCatenaryBridge.instance;
    } catch {
      return null;
    }
  }

  public solve(params: CatenarySolveParams): CatenaryResult | null {
    const { waterDepth: h, horizontalSpan: X, lineLength: L, submergedWeight: w } = params;
    const ea = params.axialStiffnessEA ?? 1e9;

    const res = this.exports.catenary_solve(h, X, L, w, ea);
    if (res !== 0) {
      return null;
    }

    const base = this.exports.catenary_get_buffer_base();
    const memBuffer = this.exports.memory.buffer;
    const f64 = new Float64Array(memBuffer, base, 12);

    const horizontalTension = f64[0]!;
    const fairleadVerticalTension = f64[1]!;
    const fairleadTotalTension = f64[2]!;
    const anchorVerticalTension = f64[3]!;
    const anchorTotalTension = f64[4]!;
    const suspendedLength = f64[5]!;
    const groundedLength = f64[6]!;
    const touchdownDistance = f64[7]!;
    const fairleadAngleDeg = f64[8]!;
    const anchorAngleDeg = f64[9]!;
    const isLiftedOff = f64[10]! > 0.5;
    const profileCount = Math.floor(f64[11]!);

    const ptsF64 = new Float64Array(memBuffer, base + 12 * 8, profileCount * 2);
    const profile: { x: number; z: number }[] = new Array(profileCount);
    for (let i = 0; i < profileCount; i++) {
      profile[i] = {
        x: ptsF64[i * 2 + 0]!,
        z: ptsF64[i * 2 + 1]!,
      };
    }

    return {
      horizontalTension,
      fairleadVerticalTension,
      fairleadTotalTension,
      anchorVerticalTension,
      anchorTotalTension,
      suspendedLength,
      groundedLength,
      touchdownDistance,
      fairleadAngleDeg,
      anchorAngleDeg,
      isLiftedOff,
      profile,
    };
  }
}
