// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Discrete-State Stochastic Jump Process Solvers (Gillespie SSA & Tau-Leaping).
 *
 * Implements exact and approximate continuous-time Markov chain (CTMC) jump solvers
 * for biochemical reaction networks (`SBML`, `BNGL`, `Antimony`), gene regulatory kinetics,
 * and epidemiological compartment models:
 *   1. Gillespie Direct Method (`gillespieSSA`)
 *   2. Exact First-Reaction Method (`firstReactionSSA`)
 *   3. Adaptive Poisson Tau-Leaping (`tauLeaping`) with Cao-Gillespie-Petzold step control
 *   4. Seeded Monte Carlo Jump Ensemble Aggregation (`simulateJumpEnsemble`)
 *
 * Academic Citations:
 * - Gillespie, D. T. (1976). "A general method for numerically simulating the stochastic
 *   time evolution of coupled chemical reactions." Journal of Computational Physics, 22(4),
 *   403-434. https://doi.org/10.1016/0021-9991(76)90041-3
 * - Gillespie, D. T. (1977). "Exact stochastic simulation of coupled chemical reactions."
 *   The Journal of Physical Chemistry, 81(25), 2340-2361. https://doi.org/10.1021/j100540a008
 * - Gillespie, D. T. (2001). "Approximate accelerated stochastic simulation of chemically
 *   reacting systems." The Journal of Chemical Physics, 115(4), 1716-1733.
 * - Cao, Y., Gillespie, D. T., & Petzold, L. R. (2006). "Efficient step size selection for
 *   the tau-leaping simulation method." The Journal of Chemical Physics, 124(4), 044109.
 */

import { getDefaultWasmExports } from "@modelscript/runtime";
import { WasmScratchPool, type WasmMemoryHost, type WasmScratchScope } from "@modelscript/solve";
import { Xoshiro256pp } from "../uq/monte-carlo.js";
import { getSimulateWasmSync } from "../wasm/simulate-wasm.js";

interface JumpProcessWasmExports extends WasmMemoryHost {
  jump_rng_seed?: (rngStatePtr: number, seedLo: number, seedHi: number) => void;
  jump_propensity_prefix_sum?: (m: number, propensitiesPtr: number, prefixOutPtr: number) => number;
  jump_select_reaction?: (m: number, prefixPtr: number, threshold: number) => number;
  jump_direct_select_step?: (m: number, propensitiesPtr: number, rngStatePtr: number, outDtPtr: number) => number;
  jump_first_reaction_select?: (
    m: number,
    propensitiesPtr: number,
    rngStatePtr: number,
    outMinTauPtr: number,
  ) => number;
  jump_apply_stoichiometry?: (n: number, statePtr: number, stoichRowPtr: number, count: number) => void;
  jump_check_critical?: (
    n: number,
    m: number,
    statePtr: number,
    propensitiesPtr: number,
    stoichPtr: number,
    nc: number,
  ) => number;
  jump_compute_cgp_tau?: (
    n: number,
    m: number,
    statePtr: number,
    propensitiesPtr: number,
    stoichPtr: number,
    eps: number,
    maxTau: number,
    muHatPtr: number,
    sigmaSqHatPtr: number,
  ) => number;
  jump_sample_poisson_batch?: (
    m: number,
    propensitiesPtr: number,
    tau: number,
    rngStatePtr: number,
    firingsOutPtr: number,
  ) => number;
  jump_tau_leap_attempt_loop?: (
    n: number,
    m: number,
    statePtr: number,
    propensitiesPtr: number,
    stoichPtr: number,
    initialTau: number,
    maxHalvings: number,
    rngStatePtr: number,
    trialStatePtr: number,
    firingsOutPtr: number,
    outTauPtr: number,
  ) => number;
  jump_eval_mass_action_propensities?: (
    m: number,
    statePtr: number,
    ratesPtr: number,
    reactRowPtr: number,
    reactSpPtr: number,
    reactOrdPtr: number,
    propensitiesOutPtr: number,
  ) => number;
  jump_gillespie_mass_action_trajectory?: (
    n: number,
    m: number,
    initStatePtr: number,
    ratesPtr: number,
    reactRowPtr: number,
    reactSpPtr: number,
    reactOrdPtr: number,
    stoichRowPtr: number,
    stoichSpPtr: number,
    stoichDelPtr: number,
    t0: number,
    tEnd: number,
    dtSave: number,
    maxOutputs: number,
    maxSteps: number,
    seedLo: number,
    seedHi: number,
    outTimesPtr: number,
    outStatesPtr: number,
    outChannelCountsPtr: number,
    outNumWrittenPtr: number,
    stateWorkPtr: number,
    propWorkPtr: number,
    rngStatePtr: number,
  ) => number;
  jump_ensemble_moments?: (
    numTrajectories: number,
    nTimes: number,
    nSpecies: number,
    trajStatesPtr: number,
    meanOutPtr: number,
    varOutPtr: number,
  ) => void;
}

const _jumpScratchPools = new WeakMap<object, WasmScratchPool>();
function getJumpPool(wasm: WasmMemoryHost): WasmScratchPool {
  let pool = _jumpScratchPools.get(wasm);
  if (!pool) {
    pool = new WasmScratchPool(wasm, 65536);
    _jumpScratchPools.set(wasm, pool);
  }
  return pool;
}

function getJumpWasm(): JumpProcessWasmExports | null {
  const raw = getDefaultWasmExports() as JumpProcessWasmExports | null;
  if (!raw || !raw.memory) return null;
  return raw;
}

function splitSeedU32(seed: number): [number, number] {
  const s = Math.trunc(seed);
  const lo = s >>> 0;
  const hi = Math.floor(Math.abs(s) / 0x100000000) >>> 0;
  return [lo, hi];
}

function packDenseStoichiometry(channels: readonly JumpReactionChannel[], n: number): Float64Array {
  const M = channels.length;
  const out = new Float64Array(M * n);
  for (let j = 0; j < M; j++) {
    const nu = channels[j]!.netStoichiometry;
    const base = j * n;
    for (let i = 0; i < n; i++) {
      out[base + i] = nu[i] ?? 0;
    }
  }
  return out;
}

function packMassActionCsr(channels: readonly JumpReactionChannel[]): {
  rates: Float64Array;
  reactRow: Int32Array;
  reactSp: Int32Array;
  reactOrd: Int32Array;
  stoichRow: Int32Array;
  stoichSp: Int32Array;
  stoichDel: Float64Array;
} {
  const M = channels.length;
  const reactRow = new Int32Array(M + 1);
  const reactSpList: number[] = [];
  const reactOrdList: number[] = [];
  const stoichRow = new Int32Array(M + 1);
  const stoichSpList: number[] = [];
  const stoichDelList: number[] = [];
  const rates = new Float64Array(M);

  for (let j = 0; j < M; j++) {
    const ch = channels[j]!;
    rates[j] = ch._massActionRate!;
    reactRow[j] = reactSpList.length;
    for (const r of ch.reactants!) {
      reactSpList.push(r.speciesIndex);
      reactOrdList.push(r.count);
    }
    stoichRow[j] = stoichSpList.length;
    for (let s = 0; s < ch.netStoichiometry.length; s++) {
      const d = ch.netStoichiometry[s]!;
      if (d !== 0) {
        stoichSpList.push(s);
        stoichDelList.push(d);
      }
    }
  }
  reactRow[M] = reactSpList.length;
  stoichRow[M] = stoichSpList.length;

  return {
    rates,
    reactRow,
    reactSp: Int32Array.from(reactSpList),
    reactOrd: Int32Array.from(reactOrdList),
    stoichRow,
    stoichSp: Int32Array.from(stoichSpList),
    stoichDel: Float64Array.from(stoichDelList),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface JumpReactionChannel {
  /** Optional human-readable reaction name (e.g., `"transcription"`). */
  name?: string | undefined;
  /** Net stoichiometric state-change vector $\boldsymbol{\nu}_j \in \mathbb{Z}^N$ applied when reaction $j$ fires. */
  netStoichiometry: readonly number[];
  /** Propensity function $a_j(\mathbf{X}, t) \ge 0$ returning hazard rate per unit time. */
  propensity: (state: readonly number[], t: number) => number;
  /** Optional reactant stoichiometry metadata used by Cao-Gillespie-Petzold adaptive $\tau$-leaping. */
  reactants?: readonly { speciesIndex: number; count: number }[] | undefined;
  /** Internal rate constant for mass-action channels eligible for the simulate.wasm SSA fast-path. */
  _massActionRate?: number | undefined;
}

export interface MassActionChannelSpec {
  name?: string | undefined;
  /** Stochastic rate constant $c_j > 0$. */
  rate: number;
  /** Total number of species $N$ in the state vector. */
  numSpecies: number;
  /** Reactant species and stoichiometric counts consumed in the reaction. */
  reactants: readonly { speciesIndex: number; count: number }[];
  /** Product species and stoichiometric counts produced in the reaction. */
  products: readonly { speciesIndex: number; count: number }[];
}

export interface JumpProblem {
  /** Time interval `[t0, tEnd]`. */
  tSpan: [number, number];
  /** Initial discrete species population vector $\mathbf{X}(t_0) \in \mathbb{Z}_{\ge 0}^N$. */
  u0: number[];
  /** Reaction channels $j = 0 \dots M-1$. */
  channels: JumpReactionChannel[];
  /** Optional PRNG seed for deterministic reproducibility. */
  seed?: number | undefined;
}

export interface JumpOptions {
  /** PRNG seed override. */
  seed?: number | undefined;
  /** Maximum number of reaction events or steps before termination (default: 500000). */
  maxSteps?: number | undefined;
  /** Optional uniform time interval for recording states (if omitted, records every jump up to 10000 points). */
  dtSave?: number | undefined;
  /** Fixed leap interval $\tau$ for `tauLeaping` (if omitted, uses adaptive Cao-Gillespie-Petzold selection). */
  tau?: number | undefined;
  /** Relative propensity change bound $\epsilon \in (0, 1)$ for adaptive $\tau$-leaping (default: 0.03). */
  epsilon?: number | undefined;
  /** Critical population threshold $n_c$ below which `tauLeaping` falls back to exact SSA steps (default: 10). */
  criticalThreshold?: number | undefined;
}

export interface JumpSimulationResult {
  /** Recorded time points. */
  times: number[];
  /** Recorded species copy-number states at each time point. */
  states: number[][];
  /** Total individual reaction firings across the trajectory. */
  totalReactions: number;
  /** Total firings broken down by reaction channel index $j = 0 \dots M-1$. */
  channelCounts: number[];
}

export interface JumpEnsembleResult {
  /** Uniform time grid across the ensemble. */
  times: number[];
  /** Sample mean $\mathbb{E}[\mathbf{X}(t)]$ at each grid point. */
  mean: number[][];
  /** Sample variance $\text{Var}[\mathbf{X}(t)]$ at each grid point. */
  variance: number[][];
  /** Individual stochastic trajectories. */
  trajectories: JumpSimulationResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Combinatorial Mass-Action Channel Builder & Poisson Sampler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constructs a `JumpReactionChannel` obeying exact discrete combinatorial mass-action kinetics:
 *   $$a_j(\mathbf{X}) = c_j \prod_{r} \prod_{k=0}^{\nu_{rj}^- - 1} \frac{\max(0, X_r - k)}{k + 1}$$
 */
export function massActionChannel(spec: MassActionChannelSpec): JumpReactionChannel {
  const net = new Array<number>(spec.numSpecies).fill(0);
  for (const r of spec.reactants) {
    net[r.speciesIndex] = (net[r.speciesIndex] ?? 0) - r.count;
  }
  for (const p of spec.products) {
    net[p.speciesIndex] = (net[p.speciesIndex] ?? 0) + p.count;
  }

  return {
    name: spec.name,
    netStoichiometry: net,
    reactants: spec.reactants,
    _massActionRate: spec.rate,
    propensity: (state: readonly number[]): number => {
      let rate = spec.rate;
      for (const r of spec.reactants) {
        const x = state[r.speciesIndex] ?? 0;
        if (x < r.count) return 0.0;
        if (r.count === 1) {
          rate *= x;
        } else if (r.count === 2) {
          rate *= 0.5 * x * (x - 1);
        } else {
          let comb = 1.0;
          for (let k = 0; k < r.count; k++) {
            comb *= (x - k) / (k + 1);
          }
          rate *= comb;
        }
      }
      return Math.max(0.0, rate);
    },
  };
}

export const createMassActionChannel = massActionChannel;

/**
 * Draws a Poisson random variate $K \sim \text{Poisson}(\lambda)$ using Knuth's exact
 * multiplication algorithm for $\lambda < 30$ and Normal-transformed rejection/approximation
 * for large $\lambda \ge 30$.
 */
export function samplePoisson(rng: Xoshiro256pp, lambda: number): number {
  if (lambda <= 0.0) return 0;
  if (lambda < 30.0) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1.0;
    do {
      k++;
      p *= Math.max(1e-16, rng.random());
    } while (p > L);
    return k - 1;
  }
  // Normal approximation with continuity correction for large lambda >= 30
  const z = rng.randn();
  const val = Math.floor(lambda + Math.sqrt(lambda) * z + 0.5);
  return Math.max(0, val);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Gillespie Direct Method (Exact SSA)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulates a discrete-state Markov jump process using Gillespie's Exact Direct Method (1977).
 */
export function gillespieSSA(problem: JumpProblem, options: JumpOptions = {}): JumpSimulationResult {
  const [t0, tEnd] = problem.tSpan;
  const n = problem.u0.length;
  const M = problem.channels.length;
  const maxSteps = options.maxSteps ?? 500000;
  const dtSave = options.dtSave;
  const seed = options.seed ?? problem.seed ?? 42;

  const isAllMassAction =
    n > 0 && M > 0 && problem.channels.every((ch) => ch._massActionRate !== undefined && ch.reactants !== undefined);

  const wasm = getJumpWasm();

  // Fast-path 1: full Gillespie Direct Method in @modelscript/runtime WASM linear memory
  if (dtSave !== undefined && dtSave > 0 && isAllMassAction && wasm?.jump_gillespie_mass_action_trajectory) {
    const maxOutputs = Math.max(2, Math.floor((tEnd - t0) / dtSave) + 2);
    const csr = packMassActionCsr(problem.channels);
    const [seedLo, seedHi] = splitSeedU32(seed);
    const scope: WasmScratchScope = getJumpPool(wasm).scope();
    try {
      const initPtr = scope.allocF64(n).ptr;
      const ratePtr = scope.allocF64(M).ptr;
      const rRowPtr = scope.allocI32(M + 1).ptr;
      const rSpPtr = scope.allocI32(Math.max(1, csr.reactSp.length)).ptr;
      const rOrdPtr = scope.allocI32(Math.max(1, csr.reactOrd.length)).ptr;
      const sRowPtr = scope.allocI32(M + 1).ptr;
      const sSpPtr = scope.allocI32(Math.max(1, csr.stoichSp.length)).ptr;
      const sDelPtr = scope.allocF64(Math.max(1, csr.stoichDel.length)).ptr;
      const outTPtr = scope.allocF64(maxOutputs).ptr;
      const outXPtr = scope.allocF64(maxOutputs * n).ptr;
      const outCountsPtr = scope.allocI32(M).ptr;
      const outWrittenPtr = scope.allocI32(1).ptr;
      const stateWorkPtr = scope.allocF64(n).ptr;
      const propWorkPtr = scope.allocF64(M).ptr;
      const rngStatePtr = scope.allocF64(4).ptr;

      const buf = wasm.memory.buffer;
      new Float64Array(buf, initPtr, n).set(problem.u0);
      new Float64Array(buf, ratePtr, M).set(csr.rates);
      new Int32Array(buf, rRowPtr, M + 1).set(csr.reactRow);
      if (csr.reactSp.length > 0) {
        new Int32Array(buf, rSpPtr, csr.reactSp.length).set(csr.reactSp);
        new Int32Array(buf, rOrdPtr, csr.reactOrd.length).set(csr.reactOrd);
      }
      new Int32Array(buf, sRowPtr, M + 1).set(csr.stoichRow);
      if (csr.stoichSp.length > 0) {
        new Int32Array(buf, sSpPtr, csr.stoichSp.length).set(csr.stoichSp);
        new Float64Array(buf, sDelPtr, csr.stoichDel.length).set(csr.stoichDel);
      }

      const totalReactions = wasm.jump_gillespie_mass_action_trajectory(
        n,
        M,
        initPtr,
        ratePtr,
        rRowPtr,
        rSpPtr,
        rOrdPtr,
        sRowPtr,
        sSpPtr,
        sDelPtr,
        t0,
        tEnd,
        dtSave,
        maxOutputs,
        maxSteps,
        seedLo,
        seedHi,
        outTPtr,
        outXPtr,
        outCountsPtr,
        outWrittenPtr,
        stateWorkPtr,
        propWorkPtr,
        rngStatePtr,
      );

      const postBuf = wasm.memory.buffer;
      const numWritten = new Int32Array(postBuf, outWrittenPtr, 1)[0] ?? 0;
      const tView = new Float64Array(postBuf, outTPtr, numWritten);
      const xView = new Float64Array(postBuf, outXPtr, numWritten * n);
      const cView = new Int32Array(postBuf, outCountsPtr, M);
      const times = Array.from(tView);
      const states: number[][] = new Array(numWritten);
      for (let i = 0; i < numWritten; i++) {
        const row = new Array<number>(n);
        for (let s = 0; s < n; s++) row[s] = xView[i * n + s]!;
        states[i] = row;
      }
      return {
        times,
        states,
        totalReactions,
        channelCounts: Array.from(cView),
      };
    } finally {
      scope.dispose();
    }
  }

  // Fast-path 2: run full Gillespie Direct Method in simulate.wasm linear memory for mass-action networks
  if (dtSave !== undefined && dtSave > 0 && isAllMassAction) {
    const w = getSimulateWasmSync();
    if (w) {
      const numOutputs = Math.max(2, Math.floor((tEnd - t0) / dtSave) + 1);
      const csr = packMassActionCsr(problem.channels);

      const initPtr = w.alloc(n * 8);
      const ratePtr = w.alloc(M * 8);
      const rRowPtr = w.alloc((M + 1) * 4);
      const rSpPtr = w.alloc(Math.max(4, csr.reactSp.length * 4));
      const rOrdPtr = w.alloc(Math.max(4, csr.reactOrd.length * 4));
      const sRowPtr = w.alloc((M + 1) * 4);
      const sSpPtr = w.alloc(Math.max(4, csr.stoichSp.length * 4));
      const sDelPtr = w.alloc(Math.max(8, csr.stoichDel.length * 8));
      const outTPtr = w.alloc(numOutputs * 8);
      const outXPtr = w.alloc(numOutputs * n * 8);

      try {
        new Float64Array(w.memory.buffer, initPtr, n).set(problem.u0);
        new Float64Array(w.memory.buffer, ratePtr, M).set(csr.rates);
        new Int32Array(w.memory.buffer, rRowPtr, M + 1).set(csr.reactRow);
        if (csr.reactSp.length > 0) {
          new Int32Array(w.memory.buffer, rSpPtr, csr.reactSp.length).set(csr.reactSp);
          new Int32Array(w.memory.buffer, rOrdPtr, csr.reactOrd.length).set(csr.reactOrd);
        }
        new Int32Array(w.memory.buffer, sRowPtr, M + 1).set(csr.stoichRow);
        if (csr.stoichSp.length > 0) {
          new Int32Array(w.memory.buffer, sSpPtr, csr.stoichSp.length).set(csr.stoichSp);
          new Float64Array(w.memory.buffer, sDelPtr, csr.stoichDel.length).set(csr.stoichDel);
        }

        const totalReactions = w.ssa_gillespieTrajectory(
          n,
          M,
          initPtr,
          ratePtr,
          rRowPtr,
          rSpPtr,
          rOrdPtr,
          sRowPtr,
          sSpPtr,
          sDelPtr,
          t0,
          tEnd,
          numOutputs,
          maxSteps,
          BigInt(Math.trunc(seed) >>> 0),
          outTPtr,
          outXPtr,
        );

        const tView = new Float64Array(w.memory.buffer, outTPtr, numOutputs);
        const xView = new Float64Array(w.memory.buffer, outXPtr, numOutputs * n);
        const times = Array.from(tView);
        const states: number[][] = new Array(numOutputs);
        for (let i = 0; i < numOutputs; i++) {
          const row = new Array<number>(n);
          for (let s = 0; s < n; s++) row[s] = xView[i * n + s]!;
          states[i] = row;
        }
        return {
          times,
          states,
          totalReactions,
          channelCounts: new Array<number>(M).fill(0),
        };
      } finally {
        w.free(initPtr);
        w.free(ratePtr);
        w.free(rRowPtr);
        w.free(rSpPtr);
        w.free(rOrdPtr);
        w.free(sRowPtr);
        w.free(sSpPtr);
        w.free(sDelPtr);
        w.free(outTPtr);
        w.free(outXPtr);
      }
    }
  }

  // Step-level WASM path for general propensity callbacks or ungridded recording
  if (n > 0 && M > 0 && wasm?.jump_rng_seed && wasm.jump_direct_select_step && wasm.jump_apply_stoichiometry) {
    const scope: WasmScratchScope = getJumpPool(wasm).scope();
    try {
      const statePtr = scope.allocF64(n).ptr;
      const propPtr = scope.allocF64(M).ptr;
      const stoichPtr = scope.allocF64(M * n).ptr;
      const rngPtr = scope.allocF64(4).ptr;
      const dtPtr = scope.allocF64(1).ptr;

      const useMassActionEval = isAllMassAction && !!wasm.jump_eval_mass_action_propensities;
      let ratePtr = 0;
      let rRowPtr = 0;
      let rSpPtr = 0;
      let rOrdPtr = 0;
      const csr = useMassActionEval ? packMassActionCsr(problem.channels) : null;
      if (csr) {
        ratePtr = scope.allocF64(M).ptr;
        rRowPtr = scope.allocI32(M + 1).ptr;
        rSpPtr = scope.allocI32(Math.max(1, csr.reactSp.length)).ptr;
        rOrdPtr = scope.allocI32(Math.max(1, csr.reactOrd.length)).ptr;
      }

      const buf = wasm.memory.buffer;
      const stateView = new Float64Array(buf, statePtr, n);
      const propView = new Float64Array(buf, propPtr, M);
      const stoichView = new Float64Array(buf, stoichPtr, M * n);
      const dtView = new Float64Array(buf, dtPtr, 1);

      stateView.set(problem.u0);
      stoichView.set(packDenseStoichiometry(problem.channels, n));
      if (csr) {
        new Float64Array(buf, ratePtr, M).set(csr.rates);
        new Int32Array(buf, rRowPtr, M + 1).set(csr.reactRow);
        if (csr.reactSp.length > 0) {
          new Int32Array(buf, rSpPtr, csr.reactSp.length).set(csr.reactSp);
          new Int32Array(buf, rOrdPtr, csr.reactOrd.length).set(csr.reactOrd);
        }
      }

      const [seedLo, seedHi] = splitSeedU32(seed);
      wasm.jump_rng_seed(rngPtr, seedLo, seedHi);

      let t = t0;
      const state = [...problem.u0];
      const channelCounts = new Array<number>(M).fill(0);
      const times: number[] = [t0];
      const states: number[][] = [[...state]];
      let nextSaveTime = dtSave !== undefined && dtSave > 0 ? t0 + dtSave : Infinity;
      let totalReactions = 0;

      for (let step = 0; step < maxSteps && t < tEnd; step++) {
        if (useMassActionEval) {
          wasm.jump_eval_mass_action_propensities!(M, statePtr, ratePtr, rRowPtr, rSpPtr, rOrdPtr, propPtr);
        } else {
          for (let j = 0; j < M; j++) {
            propView[j] = Math.max(0.0, problem.channels[j]!.propensity(state, t));
          }
        }

        const chosen = wasm.jump_direct_select_step(M, propPtr, rngPtr, dtPtr);
        if (chosen < 0) {
          while (nextSaveTime <= tEnd + 1e-12) {
            times.push(nextSaveTime);
            states.push([...state]);
            nextSaveTime += dtSave!;
          }
          if (times[times.length - 1]! < tEnd - 1e-12) {
            times.push(tEnd);
            states.push([...state]);
          }
          break;
        }

        const dt = dtView[0]!;
        const tNext = t + dt;

        if (dtSave !== undefined && dtSave > 0) {
          while (nextSaveTime <= Math.min(tNext, tEnd) + 1e-12) {
            times.push(nextSaveTime);
            states.push([...state]);
            nextSaveTime += dtSave;
          }
        }

        if (tNext > tEnd) {
          if (dtSave === undefined && times[times.length - 1]! < tEnd) {
            times.push(tEnd);
            states.push([...state]);
          }
          t = tEnd;
          break;
        }

        wasm.jump_apply_stoichiometry(n, statePtr, stoichPtr + chosen * n * 8, 1.0);
        for (let i = 0; i < n; i++) state[i] = stateView[i]!;
        t = tNext;
        totalReactions++;
        channelCounts[chosen] = channelCounts[chosen]! + 1;

        if (dtSave === undefined && times.length < 10000) {
          times.push(t);
          states.push([...state]);
        }
      }

      return { times, states, totalReactions, channelCounts };
    } finally {
      scope.dispose();
    }
  }

  const rng = new Xoshiro256pp(seed);

  let t = t0;
  const state = [...problem.u0];
  const channelCounts = new Array<number>(M).fill(0);
  const propensities = new Float64Array(M);

  const times: number[] = [t0];
  const states: number[][] = [[...state]];

  let nextSaveTime = dtSave !== undefined && dtSave > 0 ? t0 + dtSave : Infinity;
  let totalReactions = 0;

  for (let step = 0; step < maxSteps && t < tEnd; step++) {
    let a0 = 0.0;
    for (let j = 0; j < M; j++) {
      const aj = Math.max(0.0, problem.channels[j]!.propensity(state, t));
      propensities[j] = aj;
      a0 += aj;
    }

    if (a0 <= 1e-15) {
      // No reactions can fire; advance directly to tEnd
      while (nextSaveTime <= tEnd + 1e-12) {
        times.push(nextSaveTime);
        states.push([...state]);
        nextSaveTime += dtSave!;
      }
      if (times[times.length - 1]! < tEnd - 1e-12) {
        times.push(tEnd);
        states.push([...state]);
      }
      break;
    }

    const u1 = Math.max(1e-16, rng.random());
    const dt = -Math.log(u1) / a0;
    const tNext = t + dt;

    // Record any uniform save points prior to tNext
    if (dtSave !== undefined && dtSave > 0) {
      while (nextSaveTime <= Math.min(tNext, tEnd) + 1e-12) {
        times.push(nextSaveTime);
        states.push([...state]);
        nextSaveTime += dtSave;
      }
    }

    if (tNext > tEnd) {
      if (dtSave === undefined && times[times.length - 1]! < tEnd) {
        times.push(tEnd);
        states.push([...state]);
      }
      t = tEnd;
      break;
    }

    // Select reaction channel j with probability propensities[j] / a0
    const threshold = rng.random() * a0;
    let cum = 0.0;
    let chosen = M - 1;
    for (let j = 0; j < M; j++) {
      cum += propensities[j]!;
      if (cum >= threshold) {
        chosen = j;
        break;
      }
    }

    // Apply stoichiometric state jump
    const nu = problem.channels[chosen]!.netStoichiometry;
    for (let i = 0; i < n; i++) {
      state[i] = state[i]! + (nu[i] ?? 0);
    }
    t = tNext;
    totalReactions++;
    channelCounts[chosen] = channelCounts[chosen]! + 1;

    if (dtSave === undefined && times.length < 10000) {
      times.push(t);
      states.push([...state]);
    }
  }

  return {
    times,
    states,
    totalReactions,
    channelCounts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Gillespie First-Reaction Method (Exact SSA)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulates a discrete-state Markov jump process using Gillespie's Exact First-Reaction Method (1976).
 */
export function firstReactionSSA(problem: JumpProblem, options: JumpOptions = {}): JumpSimulationResult {
  const [t0, tEnd] = problem.tSpan;
  const n = problem.u0.length;
  const M = problem.channels.length;
  const maxSteps = options.maxSteps ?? 500000;
  const dtSave = options.dtSave;
  const seed = options.seed ?? problem.seed ?? 42;
  const wasm = getJumpWasm();

  if (n > 0 && M > 0 && wasm?.jump_rng_seed && wasm.jump_first_reaction_select && wasm.jump_apply_stoichiometry) {
    const isAllMassAction = problem.channels.every(
      (ch) => ch._massActionRate !== undefined && ch.reactants !== undefined,
    );
    const useMassActionEval = isAllMassAction && !!wasm.jump_eval_mass_action_propensities;
    const scope: WasmScratchScope = getJumpPool(wasm).scope();
    try {
      const statePtr = scope.allocF64(n).ptr;
      const propPtr = scope.allocF64(M).ptr;
      const stoichPtr = scope.allocF64(M * n).ptr;
      const rngPtr = scope.allocF64(4).ptr;
      const minTauPtr = scope.allocF64(1).ptr;

      let ratePtr = 0;
      let rRowPtr = 0;
      let rSpPtr = 0;
      let rOrdPtr = 0;
      const csr = useMassActionEval ? packMassActionCsr(problem.channels) : null;
      if (csr) {
        ratePtr = scope.allocF64(M).ptr;
        rRowPtr = scope.allocI32(M + 1).ptr;
        rSpPtr = scope.allocI32(Math.max(1, csr.reactSp.length)).ptr;
        rOrdPtr = scope.allocI32(Math.max(1, csr.reactOrd.length)).ptr;
      }

      const buf = wasm.memory.buffer;
      const stateView = new Float64Array(buf, statePtr, n);
      const propView = new Float64Array(buf, propPtr, M);
      const stoichView = new Float64Array(buf, stoichPtr, M * n);
      const minTauView = new Float64Array(buf, minTauPtr, 1);

      stateView.set(problem.u0);
      stoichView.set(packDenseStoichiometry(problem.channels, n));
      if (csr) {
        new Float64Array(buf, ratePtr, M).set(csr.rates);
        new Int32Array(buf, rRowPtr, M + 1).set(csr.reactRow);
        if (csr.reactSp.length > 0) {
          new Int32Array(buf, rSpPtr, csr.reactSp.length).set(csr.reactSp);
          new Int32Array(buf, rOrdPtr, csr.reactOrd.length).set(csr.reactOrd);
        }
      }

      const [seedLo, seedHi] = splitSeedU32(seed);
      wasm.jump_rng_seed(rngPtr, seedLo, seedHi);

      let t = t0;
      const state = [...problem.u0];
      const channelCounts = new Array<number>(M).fill(0);
      const times: number[] = [t0];
      const states: number[][] = [[...state]];
      let nextSaveTime = dtSave !== undefined && dtSave > 0 ? t0 + dtSave : Infinity;
      let totalReactions = 0;

      for (let step = 0; step < maxSteps && t < tEnd; step++) {
        if (useMassActionEval) {
          wasm.jump_eval_mass_action_propensities!(M, statePtr, ratePtr, rRowPtr, rSpPtr, rOrdPtr, propPtr);
        } else {
          for (let j = 0; j < M; j++) {
            propView[j] = Math.max(0.0, problem.channels[j]!.propensity(state, t));
          }
        }

        const chosen = wasm.jump_first_reaction_select(M, propPtr, rngPtr, minTauPtr);
        const minTau = minTauView[0]!;

        if (chosen < 0 || !isFinite(minTau)) {
          while (nextSaveTime <= tEnd + 1e-12) {
            times.push(nextSaveTime);
            states.push([...state]);
            nextSaveTime += dtSave!;
          }
          if (times[times.length - 1]! < tEnd - 1e-12) {
            times.push(tEnd);
            states.push([...state]);
          }
          break;
        }

        const tNext = t + minTau;

        if (dtSave !== undefined && dtSave > 0) {
          while (nextSaveTime <= Math.min(tNext, tEnd) + 1e-12) {
            times.push(nextSaveTime);
            states.push([...state]);
            nextSaveTime += dtSave;
          }
        }

        if (tNext > tEnd) {
          if (dtSave === undefined && times[times.length - 1]! < tEnd) {
            times.push(tEnd);
            states.push([...state]);
          }
          t = tEnd;
          break;
        }

        wasm.jump_apply_stoichiometry(n, statePtr, stoichPtr + chosen * n * 8, 1.0);
        for (let i = 0; i < n; i++) state[i] = stateView[i]!;
        t = tNext;
        totalReactions++;
        channelCounts[chosen] = channelCounts[chosen]! + 1;

        if (dtSave === undefined && times.length < 10000) {
          times.push(t);
          states.push([...state]);
        }
      }

      return { times, states, totalReactions, channelCounts };
    } finally {
      scope.dispose();
    }
  }

  const rng = new Xoshiro256pp(seed);

  let t = t0;
  const state = [...problem.u0];
  const channelCounts = new Array<number>(M).fill(0);

  const times: number[] = [t0];
  const states: number[][] = [[...state]];

  let nextSaveTime = dtSave !== undefined && dtSave > 0 ? t0 + dtSave : Infinity;
  let totalReactions = 0;

  for (let step = 0; step < maxSteps && t < tEnd; step++) {
    let minTau = Infinity;
    let chosen = -1;

    for (let j = 0; j < M; j++) {
      const aj = Math.max(0.0, problem.channels[j]!.propensity(state, t));
      if (aj > 1e-15) {
        const u = Math.max(1e-16, rng.random());
        const tauJ = -Math.log(u) / aj;
        if (tauJ < minTau) {
          minTau = tauJ;
          chosen = j;
        }
      }
    }

    if (chosen === -1 || !isFinite(minTau)) {
      while (nextSaveTime <= tEnd + 1e-12) {
        times.push(nextSaveTime);
        states.push([...state]);
        nextSaveTime += dtSave!;
      }
      if (times[times.length - 1]! < tEnd - 1e-12) {
        times.push(tEnd);
        states.push([...state]);
      }
      break;
    }

    const tNext = t + minTau;

    if (dtSave !== undefined && dtSave > 0) {
      while (nextSaveTime <= Math.min(tNext, tEnd) + 1e-12) {
        times.push(nextSaveTime);
        states.push([...state]);
        nextSaveTime += dtSave;
      }
    }

    if (tNext > tEnd) {
      if (dtSave === undefined && times[times.length - 1]! < tEnd) {
        times.push(tEnd);
        states.push([...state]);
      }
      t = tEnd;
      break;
    }

    const nu = problem.channels[chosen]!.netStoichiometry;
    for (let i = 0; i < n; i++) {
      state[i] = state[i]! + (nu[i] ?? 0);
    }
    t = tNext;
    totalReactions++;
    channelCounts[chosen] = channelCounts[chosen]! + 1;

    if (dtSave === undefined && times.length < 10000) {
      times.push(t);
      states.push([...state]);
    }
  }

  return {
    times,
    states,
    totalReactions,
    channelCounts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Adaptive Poisson Tau-Leaping (Cao-Gillespie-Petzold)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulates a discrete-state jump process using Adaptive Poisson Tau-Leaping
 * with Cao-Gillespie-Petzold step selection and non-negativity step-halving protection.
 */
export function tauLeaping(problem: JumpProblem, options: JumpOptions = {}): JumpSimulationResult {
  const [t0, tEnd] = problem.tSpan;
  const n = problem.u0.length;
  const M = problem.channels.length;
  const maxSteps = options.maxSteps ?? 200000;
  const dtSave = options.dtSave;
  const eps = options.epsilon ?? 0.03;
  const nc = options.criticalThreshold ?? 10;
  const seed = options.seed ?? problem.seed ?? 42;
  const wasm = getJumpWasm();

  if (
    n > 0 &&
    M > 0 &&
    wasm?.jump_rng_seed &&
    wasm.jump_check_critical &&
    wasm.jump_compute_cgp_tau &&
    wasm.jump_tau_leap_attempt_loop &&
    wasm.jump_direct_select_step &&
    wasm.jump_apply_stoichiometry
  ) {
    const isAllMassAction = problem.channels.every(
      (ch) => ch._massActionRate !== undefined && ch.reactants !== undefined,
    );
    const useMassActionEval = isAllMassAction && !!wasm.jump_eval_mass_action_propensities;
    const scope: WasmScratchScope = getJumpPool(wasm).scope();
    try {
      const statePtr = scope.allocF64(n).ptr;
      const trialStatePtr = scope.allocF64(n).ptr;
      const propPtr = scope.allocF64(M).ptr;
      const stoichPtr = scope.allocF64(M * n).ptr;
      const muHatPtr = scope.allocF64(n).ptr;
      const sigmaSqHatPtr = scope.allocF64(n).ptr;
      const firingsPtr = scope.allocI32(M).ptr;
      const rngPtr = scope.allocF64(4).ptr;
      const scalarOutPtr = scope.allocF64(1).ptr;

      let ratePtr = 0;
      let rRowPtr = 0;
      let rSpPtr = 0;
      let rOrdPtr = 0;
      const csr = useMassActionEval ? packMassActionCsr(problem.channels) : null;
      if (csr) {
        ratePtr = scope.allocF64(M).ptr;
        rRowPtr = scope.allocI32(M + 1).ptr;
        rSpPtr = scope.allocI32(Math.max(1, csr.reactSp.length)).ptr;
        rOrdPtr = scope.allocI32(Math.max(1, csr.reactOrd.length)).ptr;
      }

      const buf = wasm.memory.buffer;
      const stateView = new Float64Array(buf, statePtr, n);
      const trialStateView = new Float64Array(buf, trialStatePtr, n);
      const propView = new Float64Array(buf, propPtr, M);
      const stoichView = new Float64Array(buf, stoichPtr, M * n);
      const firingsView = new Int32Array(buf, firingsPtr, M);
      const scalarOutView = new Float64Array(buf, scalarOutPtr, 1);

      stateView.set(problem.u0);
      stoichView.set(packDenseStoichiometry(problem.channels, n));
      if (csr) {
        new Float64Array(buf, ratePtr, M).set(csr.rates);
        new Int32Array(buf, rRowPtr, M + 1).set(csr.reactRow);
        if (csr.reactSp.length > 0) {
          new Int32Array(buf, rSpPtr, csr.reactSp.length).set(csr.reactSp);
          new Int32Array(buf, rOrdPtr, csr.reactOrd.length).set(csr.reactOrd);
        }
      }

      const [seedLo, seedHi] = splitSeedU32(seed);
      wasm.jump_rng_seed(rngPtr, seedLo, seedHi);

      let t = t0;
      const state = [...problem.u0];
      const channelCounts = new Array<number>(M).fill(0);
      const times: number[] = [t0];
      const states: number[][] = [[...state]];
      let nextSaveTime = dtSave !== undefined && dtSave > 0 ? t0 + dtSave : Infinity;
      let totalReactions = 0;

      for (let step = 0; step < maxSteps && t < tEnd - 1e-14; step++) {
        let a0 = 0.0;
        if (useMassActionEval) {
          a0 = wasm.jump_eval_mass_action_propensities!(M, statePtr, ratePtr, rRowPtr, rSpPtr, rOrdPtr, propPtr);
        } else {
          for (let j = 0; j < M; j++) {
            const aj = Math.max(0.0, problem.channels[j]!.propensity(state, t));
            propView[j] = aj;
            a0 += aj;
          }
        }

        if (a0 <= 1e-15) {
          while (nextSaveTime <= tEnd + 1e-12) {
            times.push(nextSaveTime);
            states.push([...state]);
            nextSaveTime += dtSave!;
          }
          if (times[times.length - 1]! < tEnd - 1e-12) {
            times.push(tEnd);
            states.push([...state]);
          }
          break;
        }

        const hasCritical = wasm.jump_check_critical(n, M, statePtr, propPtr, stoichPtr, nc) !== 0;

        if (hasCritical && options.tau === undefined) {
          const chosen = wasm.jump_direct_select_step(M, propPtr, rngPtr, scalarOutPtr);
          if (chosen < 0) {
            t = tEnd;
            break;
          }
          const dt = scalarOutView[0]!;
          const tNext = t + dt;

          if (dtSave !== undefined && dtSave > 0) {
            while (nextSaveTime <= Math.min(tNext, tEnd) + 1e-12) {
              times.push(nextSaveTime);
              states.push([...state]);
              nextSaveTime += dtSave;
            }
          }

          if (tNext > tEnd) {
            t = tEnd;
            break;
          }

          wasm.jump_apply_stoichiometry(n, statePtr, stoichPtr + chosen * n * 8, 1.0);
          for (let i = 0; i < n; i++) state[i] = stateView[i]!;
          t = tNext;
          totalReactions++;
          channelCounts[chosen] = channelCounts[chosen]! + 1;
          if (dtSave === undefined && times.length < 10000) {
            times.push(t);
            states.push([...state]);
          }
          continue;
        }

        const maxTau = tEnd - t;
        const initialTau =
          options.tau === undefined
            ? wasm.jump_compute_cgp_tau(n, M, statePtr, propPtr, stoichPtr, eps, maxTau, muHatPtr, sigmaSqHatPtr)
            : Math.min(options.tau, maxTau);

        wasm.jump_tau_leap_attempt_loop(
          n,
          M,
          statePtr,
          propPtr,
          stoichPtr,
          initialTau,
          8,
          rngPtr,
          trialStatePtr,
          firingsPtr,
          scalarOutPtr,
        );

        const tau = scalarOutView[0]!;
        const tNext = t + tau;
        if (dtSave !== undefined && dtSave > 0) {
          while (nextSaveTime <= tNext + 1e-12 && nextSaveTime <= tEnd + 1e-12) {
            times.push(nextSaveTime);
            states.push([...state]);
            nextSaveTime += dtSave;
          }
        }

        for (let i = 0; i < n; i++) {
          const v = trialStateView[i]!;
          stateView[i] = v;
          state[i] = v;
        }
        for (let j = 0; j < M; j++) {
          const kj = firingsView[j]!;
          totalReactions += kj;
          channelCounts[j] = channelCounts[j]! + kj;
        }
        t = tNext;

        if (dtSave === undefined && times.length < 10000) {
          times.push(t);
          states.push([...state]);
        }
      }

      return { times, states, totalReactions, channelCounts };
    } finally {
      scope.dispose();
    }
  }

  const rng = new Xoshiro256pp(seed);

  let t = t0;
  const state = [...problem.u0];
  const trialState = new Array<number>(n);
  const channelCounts = new Array<number>(M).fill(0);
  const propensities = new Float64Array(M);
  const firings = new Int32Array(M);
  const muHat = new Float64Array(n);
  const sigmaSqHat = new Float64Array(n);

  const times: number[] = [t0];
  const states: number[][] = [[...state]];

  let nextSaveTime = dtSave !== undefined && dtSave > 0 ? t0 + dtSave : Infinity;
  let totalReactions = 0;

  for (let step = 0; step < maxSteps && t < tEnd - 1e-14; step++) {
    let a0 = 0.0;
    let hasCritical = false;

    for (let j = 0; j < M; j++) {
      const ch = problem.channels[j]!;
      const aj = Math.max(0.0, ch.propensity(state, t));
      propensities[j] = aj;
      a0 += aj;

      if (aj > 0.0) {
        for (let i = 0; i < n; i++) {
          const nuIJ = ch.netStoichiometry[i] ?? 0;
          if (nuIJ < 0 && state[i]! < nc * Math.abs(nuIJ)) {
            hasCritical = true;
            break;
          }
        }
      }
    }

    if (a0 <= 1e-15) {
      while (nextSaveTime <= tEnd + 1e-12) {
        times.push(nextSaveTime);
        states.push([...state]);
        nextSaveTime += dtSave!;
      }
      if (times[times.length - 1]! < tEnd - 1e-12) {
        times.push(tEnd);
        states.push([...state]);
      }
      break;
    }

    // If any active reaction is close to exhausting a species, execute an exact Direct SSA step
    if (hasCritical && options.tau === undefined) {
      const u1 = Math.max(1e-16, rng.random());
      const dt = -Math.log(u1) / a0;
      const tNext = t + dt;

      if (dtSave !== undefined && dtSave > 0) {
        while (nextSaveTime <= Math.min(tNext, tEnd) + 1e-12) {
          times.push(nextSaveTime);
          states.push([...state]);
          nextSaveTime += dtSave;
        }
      }

      if (tNext > tEnd) {
        t = tEnd;
        break;
      }

      const threshold = rng.random() * a0;
      let cum = 0.0;
      let chosen = M - 1;
      for (let j = 0; j < M; j++) {
        cum += propensities[j]!;
        if (cum >= threshold) {
          chosen = j;
          break;
        }
      }
      const nu = problem.channels[chosen]!.netStoichiometry;
      for (let i = 0; i < n; i++) state[i] = state[i]! + (nu[i] ?? 0);
      t = tNext;
      totalReactions++;
      channelCounts[chosen] = channelCounts[chosen]! + 1;
      if (dtSave === undefined && times.length < 10000) {
        times.push(t);
        states.push([...state]);
      }
      continue;
    }

    // Compute Cao-Gillespie-Petzold adaptive leap size tau
    let tau = options.tau ?? tEnd - t;
    if (options.tau === undefined) {
      muHat.fill(0.0);
      sigmaSqHat.fill(0.0);
      for (let j = 0; j < M; j++) {
        const aj = propensities[j]!;
        if (aj <= 0.0) continue;
        const nu = problem.channels[j]!.netStoichiometry;
        for (let i = 0; i < n; i++) {
          const v = nu[i] ?? 0;
          if (v !== 0) {
            muHat[i] = muHat[i]! + v * aj;
            sigmaSqHat[i] = sigmaSqHat[i]! + v * v * aj;
          }
        }
      }

      for (let i = 0; i < n; i++) {
        const xi = state[i]!;
        const bound = Math.max(1.0, eps * xi * 0.5);
        const absMu = Math.abs(muHat[i]!);
        const sigSq = sigmaSqHat[i]!;
        if (absMu > 1e-15) {
          tau = Math.min(tau, bound / absMu);
        }
        if (sigSq > 1e-15) {
          tau = Math.min(tau, (bound * bound) / sigSq);
        }
      }
    }

    tau = Math.min(tau, tEnd - t);

    // Sample Poisson firings with step-halving protection against negative populations
    let acceptedLeap = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      let allNonNegative = true;
      for (let i = 0; i < n; i++) trialState[i] = state[i]!;

      for (let j = 0; j < M; j++) {
        const kj = samplePoisson(rng, propensities[j]! * tau);
        firings[j] = kj;
        if (kj > 0) {
          const nu = problem.channels[j]!.netStoichiometry;
          for (let i = 0; i < n; i++) {
            trialState[i] = trialState[i]! + kj * (nu[i] ?? 0);
          }
        }
      }

      for (let i = 0; i < n; i++) {
        if (trialState[i]! < 0) {
          allNonNegative = false;
          break;
        }
      }

      if (allNonNegative) {
        acceptedLeap = true;
        break;
      }
      tau *= 0.5;
    }

    if (!acceptedLeap) {
      // Clamp to non-negative if still negative after 8 halvings
      for (let i = 0; i < n; i++) trialState[i] = Math.max(0, trialState[i]!);
    }

    const tNext = t + tau;
    if (dtSave !== undefined && dtSave > 0) {
      while (nextSaveTime <= tNext + 1e-12 && nextSaveTime <= tEnd + 1e-12) {
        times.push(nextSaveTime);
        states.push([...state]);
        nextSaveTime += dtSave;
      }
    }

    for (let i = 0; i < n; i++) state[i] = trialState[i]!;
    for (let j = 0; j < M; j++) {
      const kj = firings[j]!;
      totalReactions += kj;
      channelCounts[j] = channelCounts[j]! + kj;
    }
    t = tNext;

    if (dtSave === undefined && times.length < 10000) {
      times.push(t);
      states.push([...state]);
    }
  }

  return {
    times,
    states,
    totalReactions,
    channelCounts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Ensemble Jump Process Aggregation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes an ensemble of `numTrajectories` independent seeded stochastic jump simulations
 * and computes time-gridded sample means $\mathbb{E}[\mathbf{X}(t)]$ and variances $\text{Var}[\mathbf{X}(t)]$.
 */
export function simulateJumpEnsemble(
  problem: JumpProblem,
  numTrajectories: number,
  options: JumpOptions & {
    method?: "direct" | "first-reaction" | "tau-leaping" | undefined;
    gridSteps?: number | undefined;
  } = {},
): JumpEnsembleResult {
  const [t0, tEnd] = problem.tSpan;
  const n = problem.u0.length;
  const gridSteps = options.gridSteps ?? 50;
  const dtSave = options.dtSave ?? (tEnd - t0) / gridSteps;
  const baseSeed = options.seed ?? problem.seed ?? 1001;
  const method = options.method ?? "direct";

  const solverFn =
    method === "tau-leaping" ? tauLeaping : method === "first-reaction" ? firstReactionSSA : gillespieSSA;

  const trajectories: JumpSimulationResult[] = [];
  for (let r = 0; r < numTrajectories; r++) {
    const traj = solverFn(problem, {
      ...options,
      dtSave,
      seed: baseSeed + r * 7919,
    });
    trajectories.push(traj);
  }

  const times = trajectories[0]?.times ?? [t0];
  const nTimes = times.length;
  const mean: number[][] = Array.from({ length: nTimes }, () => new Array<number>(n).fill(0.0));
  const variance: number[][] = Array.from({ length: nTimes }, () => new Array<number>(n).fill(0.0));

  const wasm = getJumpWasm();
  if (numTrajectories > 0 && nTimes > 0 && n > 0 && wasm?.jump_ensemble_moments) {
    const gridSize = nTimes * n;
    const scope: WasmScratchScope = getJumpPool(wasm).scope();
    try {
      const trajPtr = scope.allocF64(numTrajectories * gridSize).ptr;
      const meanPtr = scope.allocF64(gridSize).ptr;
      const varPtr = scope.allocF64(gridSize).ptr;

      const buf = wasm.memory.buffer;
      const trajView = new Float64Array(buf, trajPtr, numTrajectories * gridSize);
      for (let r = 0; r < numTrajectories; r++) {
        const trajStates = trajectories[r]!.states;
        const lastIdx = trajStates.length - 1;
        const rBase = r * gridSize;
        for (let ti = 0; ti < nTimes; ti++) {
          const row = trajStates[Math.min(ti, lastIdx)]!;
          const tBase = rBase + ti * n;
          for (let i = 0; i < n; i++) {
            trajView[tBase + i] = row[i]!;
          }
        }
      }

      wasm.jump_ensemble_moments(numTrajectories, nTimes, n, trajPtr, meanPtr, varPtr);

      const postBuf = wasm.memory.buffer;
      const meanView = new Float64Array(postBuf, meanPtr, gridSize);
      const varView = new Float64Array(postBuf, varPtr, gridSize);
      for (let ti = 0; ti < nTimes; ti++) {
        const base = ti * n;
        for (let i = 0; i < n; i++) {
          mean[ti]![i] = meanView[base + i]!;
          variance[ti]![i] = varView[base + i]!;
        }
      }

      return { times, mean, variance, trajectories };
    } finally {
      scope.dispose();
    }
  }

  for (let ti = 0; ti < nTimes; ti++) {
    for (let r = 0; r < numTrajectories; r++) {
      const row = trajectories[r]!.states[Math.min(ti, trajectories[r]!.states.length - 1)]!;
      for (let i = 0; i < n; i++) {
        mean[ti]![i] = mean[ti]![i]! + row[i]! / numTrajectories;
      }
    }
    if (numTrajectories > 1) {
      for (let r = 0; r < numTrajectories; r++) {
        const row = trajectories[r]!.states[Math.min(ti, trajectories[r]!.states.length - 1)]!;
        for (let i = 0; i < n; i++) {
          const diff = row[i]! - mean[ti]![i]!;
          variance[ti]![i] = variance[ti]![i]! + (diff * diff) / (numTrajectories - 1);
        }
      }
    }
  }

  return {
    times,
    mean,
    variance,
    trajectories,
  };
}
