// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Typed Stochastic Differential Equation (SDE) Facet backed directly by WASM `DaeBuilder`.
 */

import {
  type DiffusionSpec,
  type FacetHost,
  SdeCalculus,
  type SdeConfig,
  SdeNoiseType,
  WASM_NULL_ID,
  type WasmSdeTrajectoryResult,
} from "../problem_types.js";

export class StochasticFacet {
  constructor(private readonly host: FacetHost) {}

  get diffusionCount(): number {
    return this.host.exports.dae_sde_getDiffusionCount(this.host.ptr) >>> 0;
  }

  addDiffusion(stateVarId: number, exprId: number, noiseChannelId?: number, flags: number = 0): number {
    const ch = noiseChannelId ?? this.diffusionCount;
    return this.host.exports.dae_sde_addDiffusion(this.host.ptr, stateVarId >>> 0, ch >>> 0, exprId >>> 0, flags) >>> 0;
  }

  setConfig(config: Partial<SdeConfig>): void {
    const cur = this.getConfig();
    this.host.exports.dae_sde_setConfig(
      this.host.ptr,
      config.noiseType ?? cur.noiseType,
      config.calculus ?? cur.calculus,
      (config.brownianDim ?? cur.brownianDim) >>> 0,
      (config.seed ?? cur.seed) >>> 0,
      (config.ensemblePaths ?? cur.ensemblePaths) >>> 0,
    );
  }

  getConfig(): SdeConfig {
    const ex = this.host.exports;
    return {
      noiseType: ex.dae_sde_getNoiseType(this.host.ptr) as SdeNoiseType,
      calculus: ex.dae_sde_getCalculus(this.host.ptr) as SdeCalculus,
      brownianDim: ex.dae_sde_getBrownianDim(this.host.ptr) >>> 0,
      seed: ex.dae_sde_getSeed(this.host.ptr) >>> 0,
      ensemblePaths: ex.dae_sde_getEnsemblePaths(this.host.ptr) >>> 0,
    };
  }

  getDiffusions(): DiffusionSpec[] {
    const n = this.diffusionCount;
    const ex = this.host.exports;
    const out: DiffusionSpec[] = [];
    for (let i = 0; i < n; i++) {
      const e = ex.dae_sde_getDiffusionExpr(this.host.ptr, i) >>> 0;
      out.push({
        index: i,
        stateVarId: ex.dae_sde_getDiffusionStateVar(this.host.ptr, i) >>> 0,
        noiseChannelId: ex.dae_sde_getDiffusionNoiseChannel(this.host.ptr, i) >>> 0,
        exprId: e === WASM_NULL_ID ? -1 : e,
        flags: ex.dae_sde_getDiffusionFlags(this.host.ptr, i) as number,
      });
    }
    return out;
  }

  evalDiffusions(values: ArrayLike<number>): number[] {
    const n = this.diffusionCount;
    if (n === 0) return [];
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, values.length);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    const outPtr = ex.atomicChunkAlloc(n * 8);
    try {
      const f64 = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < values.length; i++) f64[i] = values[i]!;
      ex.dae_sde_evalDiffusions(this.host.ptr, valsPtr, outPtr);
      return Array.from(new Float64Array(ex.memory.buffer, outPtr, n));
    } finally {
      ex.atomicChunkFree(outPtr);
      ex.atomicChunkFree(valsPtr);
    }
  }

  private _runWasmStepper(
    fnName: "dae_sde_runEulerMaruyama" | "dae_sde_runMilstein" | "dae_sde_runSRIW1",
    stateVarIds: readonly number[],
    driftExprIds: readonly number[],
    t0: number,
    tEnd: number,
    steps: number,
    seed: number = 0,
    initialValues?: ArrayLike<number>,
  ): WasmSdeTrajectoryResult {
    const nStates = stateVarIds.length;
    if (nStates === 0 || steps <= 0) return { times: [], states: [] };
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, initialValues?.length ?? 0);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    const stIdsPtr = ex.atomicChunkAlloc(nStates * 4);
    const driftPtr = ex.atomicChunkAlloc(nStates * 4);
    const outTimesPtr = ex.atomicChunkAlloc((steps + 1) * 8);
    const outStatesPtr = ex.atomicChunkAlloc((steps + 1) * nStates * 8);
    try {
      const vals = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < vc; i++) {
        vals[i] = initialValues && i < initialValues.length ? initialValues[i]! : this.host.getVarStartValue(i);
      }
      const stIds = new Uint32Array(ex.memory.buffer, stIdsPtr, nStates);
      const drifts = new Uint32Array(ex.memory.buffer, driftPtr, nStates);
      for (let i = 0; i < nStates; i++) {
        stIds[i] = stateVarIds[i]! >>> 0;
        drifts[i] = driftExprIds[i]! >= 0 ? driftExprIds[i]! >>> 0 : WASM_NULL_ID;
      }
      const count =
        ex[fnName](
          this.host.ptr,
          stIdsPtr,
          driftPtr,
          nStates >>> 0,
          t0,
          tEnd,
          steps >>> 0,
          seed >>> 0,
          valsPtr,
          outTimesPtr,
          outStatesPtr,
        ) >>> 0;
      const times = Array.from(new Float64Array(ex.memory.buffer, outTimesPtr, count));
      const flatStates = new Float64Array(ex.memory.buffer, outStatesPtr, count * nStates);
      const states: number[][] = [];
      for (let k = 0; k < count; k++) {
        states.push(Array.from(flatStates.subarray(k * nStates, (k + 1) * nStates)));
      }
      return { times, states };
    } finally {
      ex.atomicChunkFree(outStatesPtr);
      ex.atomicChunkFree(outTimesPtr);
      ex.atomicChunkFree(driftPtr);
      ex.atomicChunkFree(stIdsPtr);
      ex.atomicChunkFree(valsPtr);
    }
  }

  runEulerMaruyama(
    stateVarIds: readonly number[],
    driftExprIds: readonly number[],
    t0: number,
    tEnd: number,
    steps: number,
    seed: number = 0,
    initialValues?: ArrayLike<number>,
  ): WasmSdeTrajectoryResult {
    return this._runWasmStepper(
      "dae_sde_runEulerMaruyama",
      stateVarIds,
      driftExprIds,
      t0,
      tEnd,
      steps,
      seed,
      initialValues,
    );
  }

  runMilstein(
    stateVarIds: readonly number[],
    driftExprIds: readonly number[],
    t0: number,
    tEnd: number,
    steps: number,
    seed: number = 0,
    initialValues?: ArrayLike<number>,
  ): WasmSdeTrajectoryResult {
    return this._runWasmStepper("dae_sde_runMilstein", stateVarIds, driftExprIds, t0, tEnd, steps, seed, initialValues);
  }

  runSRIW1(
    stateVarIds: readonly number[],
    driftExprIds: readonly number[],
    t0: number,
    tEnd: number,
    steps: number,
    seed: number = 0,
    initialValues?: ArrayLike<number>,
  ): WasmSdeTrajectoryResult {
    return this._runWasmStepper("dae_sde_runSRIW1", stateVarIds, driftExprIds, t0, tEnd, steps, seed, initialValues);
  }

  runEnsemble(
    stateVarIds: readonly number[],
    driftExprIds: readonly number[],
    t0: number,
    tEnd: number,
    steps: number,
    numPaths: number = 64,
    options?: {
      seed?: number | undefined;
      useMilstein?: boolean | undefined;
      initialValues?: ArrayLike<number> | undefined;
    },
  ): { times: number[]; mean: number[][]; variance: number[][]; numPaths: number } {
    const nStates = stateVarIds.length;
    if (nStates === 0 || steps <= 0 || numPaths <= 0) {
      return { times: [], mean: [], variance: [], numPaths: 0 };
    }
    const ex = this.host.exports;
    const initVals = options?.initialValues;
    const vc = Math.max(this.host.varCount, initVals?.length ?? 0);
    const total = (steps + 1) * nStates;
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    const stIdsPtr = ex.atomicChunkAlloc(nStates * 4);
    const driftPtr = ex.atomicChunkAlloc(nStates * 4);
    const outTimesPtr = ex.atomicChunkAlloc((steps + 1) * 8);
    const outMeanPtr = ex.atomicChunkAlloc(total * 8);
    const outVarPtr = ex.atomicChunkAlloc(total * 8);
    try {
      const vals = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < vc; i++) {
        vals[i] = initVals && i < initVals.length ? initVals[i]! : this.host.getVarStartValue(i);
      }
      const stIds = new Uint32Array(ex.memory.buffer, stIdsPtr, nStates);
      const drifts = new Uint32Array(ex.memory.buffer, driftPtr, nStates);
      for (let i = 0; i < nStates; i++) {
        stIds[i] = stateVarIds[i]! >>> 0;
        drifts[i] = driftExprIds[i]! >= 0 ? driftExprIds[i]! >>> 0 : WASM_NULL_ID;
      }
      const count =
        ex.dae_sde_runEnsemble(
          this.host.ptr,
          stIdsPtr,
          driftPtr,
          nStates >>> 0,
          t0,
          tEnd,
          steps >>> 0,
          numPaths >>> 0,
          (options?.seed ?? this.getConfig().seed ?? 1337) >>> 0,
          options?.useMilstein !== false ? 1 : 0,
          valsPtr,
          outTimesPtr,
          outMeanPtr,
          outVarPtr,
        ) >>> 0;
      const times = Array.from(new Float64Array(ex.memory.buffer, outTimesPtr, count));
      const flatMean = new Float64Array(ex.memory.buffer, outMeanPtr, count * nStates);
      const flatVar = new Float64Array(ex.memory.buffer, outVarPtr, count * nStates);
      const mean: number[][] = [];
      const variance: number[][] = [];
      for (let k = 0; k < count; k++) {
        mean.push(Array.from(flatMean.subarray(k * nStates, (k + 1) * nStates)));
        variance.push(Array.from(flatVar.subarray(k * nStates, (k + 1) * nStates)));
      }
      return { times, mean, variance, numPaths };
    } finally {
      ex.atomicChunkFree(outVarPtr);
      ex.atomicChunkFree(outMeanPtr);
      ex.atomicChunkFree(outTimesPtr);
      ex.atomicChunkFree(driftPtr);
      ex.atomicChunkFree(stIdsPtr);
      ex.atomicChunkFree(valsPtr);
    }
  }
}
