// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Typed Boundary Value Problem (BVP) Facet backed directly by WASM `DaeBuilder`.
 */

import { type BvpConfig, BvpMethod, type FacetHost } from "../problem_types.js";

export class BvpFacet {
  constructor(private readonly host: FacetHost) {}

  addBoundaryEquation(lhsExprId: number, rhsExprId: number, flags: number = 0): number {
    return this.host.exports.dae_bvp_addBoundaryEquation(this.host.ptr, lhsExprId >>> 0, rhsExprId >>> 0, flags) >>> 0;
  }

  atStart(varId: number): number {
    return this.atPoint(varId, 0);
  }

  atEnd(varId: number): number {
    return this.atPoint(varId, 1);
  }

  atPoint(varId: number, boundaryPointIdx: number): number {
    return this.host.exports.dae_bvp_addAtBoundaryExpr(this.host.ptr, varId >>> 0, boundaryPointIdx >>> 0) >>> 0;
  }

  setConfig(config: { method?: BvpMethod | undefined; intervals?: number | undefined }): void {
    const cur = this.getConfig();
    this.host.exports.dae_bvp_setConfig(
      this.host.ptr,
      config.method ?? cur.method,
      (config.intervals ?? cur.intervals) >>> 0,
    );
  }

  addBoundaryPoint(tVal: number): number {
    return this.host.exports.dae_bvp_addBoundaryPoint(this.host.ptr, tVal) >>> 0;
  }

  getBoundaryPoints(): number[] {
    const ex = this.host.exports;
    const count = ex.dae_bvp_getBoundaryPointCount(this.host.ptr) >>> 0;
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      out.push(ex.dae_bvp_getBoundaryPoint(this.host.ptr, i) as number);
    }
    return out;
  }

  getConfig(): BvpConfig {
    const ex = this.host.exports;
    return {
      method: ex.dae_bvp_getMethod(this.host.ptr) as BvpMethod,
      intervals: ex.dae_bvp_getIntervals(this.host.ptr) >>> 0,
      boundaryPoints: this.getBoundaryPoints(),
    };
  }

  evalBoundaryResiduals(ya: ArrayLike<number>, yb: ArrayLike<number>, params?: ArrayLike<number>): number[] {
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, ya.length, yb.length, params?.length ?? 0);
    const eqCount = ex.dae_getEqCount(this.host.ptr) >>> 0;
    const yaPtr = ex.atomicChunkAlloc(vc * 8);
    const ybPtr = ex.atomicChunkAlloc(vc * 8);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    const outPtr = ex.atomicChunkAlloc(Math.max(1, eqCount) * 8);
    try {
      const yaBuf = new Float64Array(ex.memory.buffer, yaPtr, vc);
      const ybBuf = new Float64Array(ex.memory.buffer, ybPtr, vc);
      const valsBuf = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < vc; i++) {
        yaBuf[i] = i < ya.length ? ya[i]! : 0;
        ybBuf[i] = i < yb.length ? yb[i]! : 0;
        valsBuf[i] = params && i < params.length ? params[i]! : this.host.getVarStartValue(i);
      }
      const nBc = ex.dae_bvp_evalBoundaryResiduals(this.host.ptr, yaPtr, ybPtr, valsPtr, outPtr) >>> 0;
      return Array.from(new Float64Array(ex.memory.buffer, outPtr, nBc));
    } finally {
      ex.atomicChunkFree(outPtr);
      ex.atomicChunkFree(valsPtr);
      ex.atomicChunkFree(ybPtr);
      ex.atomicChunkFree(yaPtr);
    }
  }
}
