// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Typed Delay & Neutral Delay Differential Equation (DDE / NDDE) Facet backed by WASM `DaeBuilder`.
 */

import { type DelayChannelSpec, type FacetHost, FLAG_DELAY_CONSTANT, WASM_NULL_ID } from "../problem_types.js";

export class DelayFacet {
  constructor(private readonly host: FacetHost) {}

  get count(): number {
    return this.host.exports.dae_delay_getCount(this.host.ptr) >>> 0;
  }

  addChannel(
    targetExprId: number,
    tauExprId: number,
    historyExprId: number = -1,
    historyDerivExprId: number = -1,
    flags: number = FLAG_DELAY_CONSTANT,
  ): number {
    return (
      this.host.exports.dae_delay_addChannel(
        this.host.ptr,
        targetExprId >>> 0,
        tauExprId >>> 0,
        historyExprId >= 0 ? historyExprId >>> 0 : WASM_NULL_ID,
        historyDerivExprId >= 0 ? historyDerivExprId >>> 0 : WASM_NULL_ID,
        flags,
      ) >>> 0
    );
  }

  addDelayExpr(
    targetExprId: number,
    tauExprId: number,
    historyExprId: number = -1,
    historyDerivExprId: number = -1,
    flags: number = FLAG_DELAY_CONSTANT,
  ): { channelIdx: number; exprId: number } {
    const channelIdx = this.addChannel(targetExprId, tauExprId, historyExprId, historyDerivExprId, flags);
    const exprId =
      this.host.exports.dae_delay_addExpr(this.host.ptr, channelIdx >>> 0, targetExprId >>> 0, tauExprId >>> 0) >>> 0;
    return { channelIdx, exprId };
  }

  getChannels(): DelayChannelSpec[] {
    const n = this.count;
    const ex = this.host.exports;
    const out: DelayChannelSpec[] = [];
    for (let i = 0; i < n; i++) {
      const h = ex.dae_delay_getHistoryExpr(this.host.ptr, i) >>> 0;
      const hd = ex.dae_delay_getHistoryDerivExpr(this.host.ptr, i) >>> 0;
      out.push({
        index: i,
        targetExprId: ex.dae_delay_getTargetExpr(this.host.ptr, i) >>> 0,
        tauExprId: ex.dae_delay_getTauExpr(this.host.ptr, i) >>> 0,
        historyExprId: h === WASM_NULL_ID ? -1 : h,
        historyDerivExprId: hd === WASM_NULL_ID ? -1 : hd,
        flags: ex.dae_delay_getFlags(this.host.ptr, i) as number,
      });
    }
    return out;
  }

  evalTau(channelIdx: number, values: ArrayLike<number>): number {
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, values.length);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    try {
      const f64 = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < values.length; i++) f64[i] = values[i]!;
      return ex.dae_delay_evalTau(this.host.ptr, channelIdx >>> 0, valsPtr) as number;
    } finally {
      ex.atomicChunkFree(valsPtr);
    }
  }

  evalHistory(channelIdx: number, values: ArrayLike<number>): number {
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, values.length);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    try {
      const f64 = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < values.length; i++) f64[i] = values[i]!;
      return ex.dae_delay_evalHistory(this.host.ptr, channelIdx >>> 0, valsPtr) as number;
    } finally {
      ex.atomicChunkFree(valsPtr);
    }
  }
}
