// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Typed Jump Process / Stochastic Simulation Algorithm (SSA) Facet backed by WASM `DaeBuilder`.
 */

import {
  type FacetHost,
  JumpAffectMode,
  type JumpAffectSpec,
  JumpRateKind,
  type JumpSpec,
  type WasmJumpTrajectoryResult,
} from "../problem_types.js";

export class JumpFacet {
  constructor(private readonly host: FacetHost) {}

  get count(): number {
    return this.host.exports.dae_jump_getCount(this.host.ptr) >>> 0;
  }

  addJump(
    propensityExprId: number,
    affects: readonly { targetVarId: number; deltaExprId: number; mode?: JumpAffectMode | undefined }[],
    flags: number = JumpRateKind.MassAction,
  ): number {
    const ex = this.host.exports;
    const jIdx = ex.dae_jump_add(this.host.ptr, propensityExprId >>> 0, flags) >>> 0;
    for (let i = 0; i < affects.length; i++) {
      const a = affects[i]!;
      ex.dae_jump_addAffect(
        this.host.ptr,
        jIdx,
        a.targetVarId >>> 0,
        a.deltaExprId >>> 0,
        a.mode ?? JumpAffectMode.Additive,
      );
    }
    return jIdx;
  }

  getJumps(): JumpSpec[] {
    const n = this.count;
    const ex = this.host.exports;
    const out: JumpSpec[] = [];
    for (let i = 0; i < n; i++) {
      const start = ex.dae_jump_getAffectStart(this.host.ptr, i) >>> 0;
      const cnt = ex.dae_jump_getAffectCount(this.host.ptr, i) >>> 0;
      const affects: JumpAffectSpec[] = [];
      for (let a = 0; a < cnt; a++) {
        affects.push({
          targetVarId: ex.dae_jump_getAffectVar(this.host.ptr, start + a) >>> 0,
          deltaExprId: ex.dae_jump_getAffectExpr(this.host.ptr, start + a) >>> 0,
          mode: ex.dae_jump_getAffectMode(this.host.ptr, start + a) as JumpAffectMode,
        });
      }
      out.push({
        index: i,
        propensityExprId: ex.dae_jump_getPropensityExpr(this.host.ptr, i) >>> 0,
        flags: ex.dae_jump_getFlags(this.host.ptr, i) as number,
        affects,
      });
    }
    return out;
  }

  evalPropensities(values: ArrayLike<number>): { propensities: number[]; total: number } {
    const n = this.count;
    if (n === 0) return { propensities: [], total: 0 };
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, values.length);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    const outPtr = ex.atomicChunkAlloc(n * 8);
    try {
      const f64 = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < values.length; i++) f64[i] = values[i]!;
      const total = ex.dae_jump_evalPropensities(this.host.ptr, valsPtr, outPtr) as number;
      const propensities = Array.from(new Float64Array(ex.memory.buffer, outPtr, n));
      return { propensities, total };
    } finally {
      ex.atomicChunkFree(outPtr);
      ex.atomicChunkFree(valsPtr);
    }
  }

  runGillespie(
    trackedVarIds: readonly number[],
    t0: number,
    tEnd: number,
    maxEvents: number = 10000,
    seed: number = 42,
    initialValues?: ArrayLike<number>,
  ): WasmJumpTrajectoryResult {
    const nTracked = trackedVarIds.length;
    if (this.count === 0 || nTracked === 0 || maxEvents <= 0) {
      return { times: [], states: [], jumpIds: [] };
    }
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, initialValues?.length ?? 0);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    const trackedPtr = ex.atomicChunkAlloc(nTracked * 4);
    const outTimesPtr = ex.atomicChunkAlloc(maxEvents * 8);
    const outStatesPtr = ex.atomicChunkAlloc(maxEvents * nTracked * 8);
    const outJumpsPtr = ex.atomicChunkAlloc(maxEvents * 4);
    try {
      const vals = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < vc; i++) {
        vals[i] = initialValues && i < initialValues.length ? initialValues[i]! : this.host.getVarStartValue(i);
      }
      const tr = new Uint32Array(ex.memory.buffer, trackedPtr, nTracked);
      for (let i = 0; i < nTracked; i++) tr[i] = trackedVarIds[i]! >>> 0;

      const recorded =
        ex.dae_jump_runGillespie(
          this.host.ptr,
          trackedPtr,
          nTracked >>> 0,
          t0,
          tEnd,
          maxEvents >>> 0,
          seed >>> 0,
          valsPtr,
          outTimesPtr,
          outStatesPtr,
          outJumpsPtr,
        ) >>> 0;

      const times = Array.from(new Float64Array(ex.memory.buffer, outTimesPtr, recorded));
      const jumpIds = Array.from(new Int32Array(ex.memory.buffer, outJumpsPtr, recorded));
      const flatStates = new Float64Array(ex.memory.buffer, outStatesPtr, recorded * nTracked);
      const states: number[][] = [];
      for (let k = 0; k < recorded; k++) {
        states.push(Array.from(flatStates.subarray(k * nTracked, (k + 1) * nTracked)));
      }
      return { times, states, jumpIds };
    } finally {
      ex.atomicChunkFree(outJumpsPtr);
      ex.atomicChunkFree(outStatesPtr);
      ex.atomicChunkFree(outTimesPtr);
      ex.atomicChunkFree(trackedPtr);
      ex.atomicChunkFree(valsPtr);
    }
  }

  runTauLeaping(
    trackedVarIds: readonly number[],
    t0: number,
    tEnd: number,
    steps: number = 200,
    seed: number = 42,
    initialValues?: ArrayLike<number>,
  ): { times: number[]; states: number[][] } {
    const nTracked = trackedVarIds.length;
    if (this.count === 0 || nTracked === 0 || steps <= 0) return { times: [], states: [] };
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, initialValues?.length ?? 0);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    const trackedPtr = ex.atomicChunkAlloc(nTracked * 4);
    const outTimesPtr = ex.atomicChunkAlloc((steps + 1) * 8);
    const outStatesPtr = ex.atomicChunkAlloc((steps + 1) * nTracked * 8);
    try {
      const vals = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < vc; i++) {
        vals[i] = initialValues && i < initialValues.length ? initialValues[i]! : this.host.getVarStartValue(i);
      }
      const tr = new Uint32Array(ex.memory.buffer, trackedPtr, nTracked);
      for (let i = 0; i < nTracked; i++) tr[i] = trackedVarIds[i]! >>> 0;

      const count =
        ex.dae_jump_runTauLeaping(
          this.host.ptr,
          trackedPtr,
          nTracked >>> 0,
          t0,
          tEnd,
          steps >>> 0,
          seed >>> 0,
          valsPtr,
          outTimesPtr,
          outStatesPtr,
        ) >>> 0;

      const times = Array.from(new Float64Array(ex.memory.buffer, outTimesPtr, count));
      const flatStates = new Float64Array(ex.memory.buffer, outStatesPtr, count * nTracked);
      const states: number[][] = [];
      for (let k = 0; k < count; k++) {
        states.push(Array.from(flatStates.subarray(k * nTracked, (k + 1) * nTracked)));
      }
      return { times, states };
    } finally {
      ex.atomicChunkFree(outStatesPtr);
      ex.atomicChunkFree(outTimesPtr);
      ex.atomicChunkFree(trackedPtr);
      ex.atomicChunkFree(valsPtr);
    }
  }

  runHybridOdeSsa(
    odeStateVarIds: readonly number[],
    odeDriftExprIds: readonly number[],
    trackedVarIds: readonly number[],
    t0: number,
    tEnd: number,
    steps: number = 200,
    seed: number = 42,
    initialValues?: ArrayLike<number>,
  ): { times: number[]; states: number[][] } {
    const nOde = odeStateVarIds.length;
    const nTracked = trackedVarIds.length;
    if (nTracked === 0 || steps <= 0) return { times: [], states: [] };
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, initialValues?.length ?? 0);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    const odeStPtr = ex.atomicChunkAlloc(Math.max(1, nOde) * 4);
    const odeDriftPtr = ex.atomicChunkAlloc(Math.max(1, nOde) * 4);
    const trackedPtr = ex.atomicChunkAlloc(nTracked * 4);
    const outTimesPtr = ex.atomicChunkAlloc((steps + 1) * 8);
    const outStatesPtr = ex.atomicChunkAlloc((steps + 1) * nTracked * 8);
    try {
      const vals = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < vc; i++) {
        vals[i] = initialValues && i < initialValues.length ? initialValues[i]! : this.host.getVarStartValue(i);
      }
      const oSt = new Uint32Array(ex.memory.buffer, odeStPtr, Math.max(1, nOde));
      const oDr = new Uint32Array(ex.memory.buffer, odeDriftPtr, Math.max(1, nOde));
      for (let i = 0; i < nOde; i++) {
        oSt[i] = odeStateVarIds[i]! >>> 0;
        oDr[i] = odeDriftExprIds[i]! >>> 0;
      }
      const tr = new Uint32Array(ex.memory.buffer, trackedPtr, nTracked);
      for (let i = 0; i < nTracked; i++) tr[i] = trackedVarIds[i]! >>> 0;

      const count =
        ex.dae_jump_runHybridOdeSsa(
          this.host.ptr,
          odeStPtr,
          odeDriftPtr,
          nOde >>> 0,
          trackedPtr,
          nTracked >>> 0,
          t0,
          tEnd,
          steps >>> 0,
          seed >>> 0,
          valsPtr,
          outTimesPtr,
          outStatesPtr,
        ) >>> 0;
      const times = Array.from(new Float64Array(ex.memory.buffer, outTimesPtr, count));
      const flatStates = new Float64Array(ex.memory.buffer, outStatesPtr, count * nTracked);
      const states: number[][] = [];
      for (let k = 0; k < count; k++) {
        states.push(Array.from(flatStates.subarray(k * nTracked, (k + 1) * nTracked)));
      }
      return { times, states };
    } finally {
      ex.atomicChunkFree(outStatesPtr);
      ex.atomicChunkFree(outTimesPtr);
      ex.atomicChunkFree(trackedPtr);
      ex.atomicChunkFree(odeDriftPtr);
      ex.atomicChunkFree(odeStPtr);
      ex.atomicChunkFree(valsPtr);
    }
  }
}
