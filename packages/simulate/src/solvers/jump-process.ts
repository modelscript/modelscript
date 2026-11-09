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

import { Xoshiro256pp } from "@modelscript/runtime/wasm_monte_carlo.js";

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
