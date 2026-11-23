// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Typed Uncertainty, Formal Reachability & STL Verification Facet backed by WASM `DaeBuilder`.
 */

import {
  type FacetHost,
  type StateInvariantSpec,
  type StlNodeSpec,
  StlOp,
  UncertaintyDistKind,
  type VarUncertaintySpec,
  WASM_NULL_ID,
} from "../problem_types.js";

export class UncertaintyFacet {
  constructor(private readonly host: FacetHost) {}

  get uncertaintyCount(): number {
    return this.host.exports.dae_unc_getCount(this.host.ptr) >>> 0;
  }

  get stlCount(): number {
    return this.host.exports.dae_stl_getCount(this.host.ptr) >>> 0;
  }

  get stateInvariantCount(): number {
    return this.host.exports.dae_inv_getCount(this.host.ptr) >>> 0;
  }

  setInterval(varId: number, lo: number, hi: number): number {
    return this.setDistribution(varId, UncertaintyDistKind.Interval, lo, hi);
  }

  setDistribution(varId: number, distKind: UncertaintyDistKind, p1: number, p2: number): number {
    return this.host.exports.dae_unc_addVar(this.host.ptr, varId >>> 0, distKind, p1, p2) >>> 0;
  }

  getUncertainties(): VarUncertaintySpec[] {
    const n = this.uncertaintyCount;
    const ex = this.host.exports;
    const out: VarUncertaintySpec[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        index: i,
        varId: ex.dae_unc_getVarId(this.host.ptr, i) >>> 0,
        distKind: ex.dae_unc_getDistKind(this.host.ptr, i) as UncertaintyDistKind,
        p1: ex.dae_unc_getP1(this.host.ptr, i) as number,
        p2: ex.dae_unc_getP2(this.host.ptr, i) as number,
      });
    }
    return out;
  }

  // ── STL Specification Builders ──

  addStlAtomic(exprId: number, flags: number = 0): number {
    return (
      this.host.exports.dae_stl_addNode(this.host.ptr, StlOp.Atomic, exprId >>> 0, WASM_NULL_ID, 0, 0, flags) >>> 0
    );
  }

  addStlNot(childIdx: number): number {
    return this.host.exports.dae_stl_addNode(this.host.ptr, StlOp.Not, childIdx >>> 0, WASM_NULL_ID, 0, 0, 0) >>> 0;
  }

  addStlAnd(leftIdx: number, rightIdx: number): number {
    return this.host.exports.dae_stl_addNode(this.host.ptr, StlOp.And, leftIdx >>> 0, rightIdx >>> 0, 0, 0, 0) >>> 0;
  }

  addStlOr(leftIdx: number, rightIdx: number): number {
    return this.host.exports.dae_stl_addNode(this.host.ptr, StlOp.Or, leftIdx >>> 0, rightIdx >>> 0, 0, 0, 0) >>> 0;
  }

  addStlAlways(childIdx: number, tLo: number, tHi: number): number {
    return (
      this.host.exports.dae_stl_addNode(this.host.ptr, StlOp.Always, childIdx >>> 0, WASM_NULL_ID, tLo, tHi, 0) >>> 0
    );
  }

  addStlEventually(childIdx: number, tLo: number, tHi: number): number {
    return (
      this.host.exports.dae_stl_addNode(this.host.ptr, StlOp.Eventually, childIdx >>> 0, WASM_NULL_ID, tLo, tHi, 0) >>>
      0
    );
  }

  addStlUntil(leftIdx: number, rightIdx: number, tLo: number, tHi: number): number {
    return (
      this.host.exports.dae_stl_addNode(this.host.ptr, StlOp.Until, leftIdx >>> 0, rightIdx >>> 0, tLo, tHi, 0) >>> 0
    );
  }

  getStlNodes(): StlNodeSpec[] {
    const n = this.stlCount;
    const ex = this.host.exports;
    const out: StlNodeSpec[] = [];
    for (let i = 0; i < n; i++) {
      const r = ex.dae_stl_getRight(this.host.ptr, i) >>> 0;
      out.push({
        index: i,
        op: ex.dae_stl_getOp(this.host.ptr, i) as StlOp,
        leftId: ex.dae_stl_getLeft(this.host.ptr, i) >>> 0,
        rightId: r === WASM_NULL_ID ? -1 : r,
        tLo: ex.dae_stl_getTLo(this.host.ptr, i) as number,
        tHi: ex.dae_stl_getTHi(this.host.ptr, i) as number,
        flags: ex.dae_stl_getFlags(this.host.ptr, i) as number,
      });
    }
    return out;
  }

  // ── Hybrid State Invariants ──

  addStateInvariant(stateId: number, varId: number, lo: number, hi: number): number {
    return this.host.exports.dae_inv_addStateInvariant(this.host.ptr, stateId >>> 0, varId >>> 0, lo, hi) >>> 0;
  }

  getStateInvariants(): StateInvariantSpec[] {
    const n = this.stateInvariantCount;
    const ex = this.host.exports;
    const out: StateInvariantSpec[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        index: i,
        stateId: ex.dae_inv_getStateId(this.host.ptr, i) >>> 0,
        varId: ex.dae_inv_getVarId(this.host.ptr, i) >>> 0,
        lo: ex.dae_inv_getLo(this.host.ptr, i) as number,
        hi: ex.dae_inv_getHi(this.host.ptr, i) as number,
      });
    }
    return out;
  }

  // ── WASM Verification Kernels ──

  evalTrajectoryRobustness(
    rootStlIdx: number,
    times: ArrayLike<number>,
    trajectory: readonly ArrayLike<number>[],
  ): number {
    const numTimes = times.length;
    if (numTimes === 0 || trajectory.length === 0) return 0;
    const vc = Math.max(this.host.varCount, trajectory[0]!.length);
    const ex = this.host.exports;
    const timesPtr = ex.atomicChunkAlloc(numTimes * 8);
    const trajPtr = ex.atomicChunkAlloc(numTimes * vc * 8);
    try {
      const tBuf = new Float64Array(ex.memory.buffer, timesPtr, numTimes);
      const yBuf = new Float64Array(ex.memory.buffer, trajPtr, numTimes * vc);
      for (let k = 0; k < numTimes; k++) {
        tBuf[k] = times[k]!;
        const row = trajectory[k]!;
        const base = k * vc;
        for (let v = 0; v < row.length; v++) {
          yBuf[base + v] = row[v]!;
        }
      }
      return ex.dae_stl_evalTrajectoryRobustness(
        this.host.ptr,
        rootStlIdx >>> 0,
        timesPtr,
        trajPtr,
        numTimes >>> 0,
        vc >>> 0,
      ) as number;
    } finally {
      ex.atomicChunkFree(trajPtr);
      ex.atomicChunkFree(timesPtr);
    }
  }

  checkStateInvariantMargin(stateId: number, values: ArrayLike<number>): number {
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, values.length);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    try {
      const f64 = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < values.length; i++) f64[i] = values[i]!;
      return ex.dae_inv_checkStateMargin(this.host.ptr, stateId >>> 0, valsPtr) as number;
    } finally {
      ex.atomicChunkFree(valsPtr);
    }
  }

  evalExprInterval(exprId: number, nominalValues?: ArrayLike<number>): { lo: number; hi: number; issueMask: number } {
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, nominalValues?.length ?? 0);
    const nomPtr = ex.atomicChunkAlloc(vc * 8);
    const outLoPtr = ex.atomicChunkAlloc(8);
    const outHiPtr = ex.atomicChunkAlloc(8);
    try {
      const f64 = new Float64Array(ex.memory.buffer, nomPtr, vc);
      for (let i = 0; i < vc; i++) {
        f64[i] = nominalValues && i < nominalValues.length ? nominalValues[i]! : this.host.getVarStartValue(i);
      }
      const issueMask = ex.dae_unc_evalExprInterval(this.host.ptr, exprId >>> 0, nomPtr, outLoPtr, outHiPtr) >>> 0;
      const lo = new Float64Array(ex.memory.buffer, outLoPtr, 1)[0]!;
      const hi = new Float64Array(ex.memory.buffer, outHiPtr, 1)[0]!;
      return { lo, hi, issueMask };
    } finally {
      ex.atomicChunkFree(outHiPtr);
      ex.atomicChunkFree(outLoPtr);
      ex.atomicChunkFree(nomPtr);
    }
  }
}
