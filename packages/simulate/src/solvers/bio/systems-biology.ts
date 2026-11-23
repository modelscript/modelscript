// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Systems Biology & Chemical Equilibrium Solvers.
 *
 * Implements canonical solvers for `sbml`, `bngl`, `antimony`, `cantera`, and `phreeqc`:
 *   1. Gillespie Direct Method Stochastic Simulation Algorithm (SSA)
 *   2. Flux Balance Analysis (FBA) via Revised Simplex LP
 *   3. Gibbs Free-Energy Chemical Equilibrium Minimization (element-conserving Newton-Lagrange)
 */

import { solveDenseLinear } from "@modelscript/runtime";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return Math.max(1e-15, s / 4294967296);
  };
}

export interface GillespieResult {
  readonly times: number[];
  readonly trajectories: number[][];
  readonly reactionCount: number;
}

/**
 * Gillespie Direct Stochastic Simulation Algorithm (SSA) for discrete chemical reaction networks.
 * `stoichiometry[rxn][species]` gives the net molecule change when reaction `rxn` fires.
 */
export function runGillespieSsa(
  initialCounts: readonly number[],
  stoichiometry: readonly (readonly number[])[],
  propensities: (counts: readonly number[]) => number[],
  tEnd: number,
  opts?: { seed?: number | undefined; maxSteps?: number | undefined },
): GillespieResult {
  const rng = lcg(opts?.seed ?? 101);
  const maxSteps = opts?.maxSteps ?? 100_000;
  const counts = [...initialCounts];
  const times: number[] = [0];
  const trajectories: number[][] = [[...counts]];

  let t = 0;
  let steps = 0;
  while (t < tEnd && steps < maxSteps) {
    const props = propensities(counts);
    let a0 = 0;
    for (let i = 0; i < props.length; i++) a0 += Math.max(0, props[i]!);
    if (a0 <= 1e-15) break;

    const tau = -Math.log(rng()) / a0;
    if (t + tau > tEnd) break;
    t += tau;

    const r2 = rng() * a0;
    let acc = 0;
    let chosen = props.length - 1;
    for (let i = 0; i < props.length; i++) {
      acc += Math.max(0, props[i]!);
      if (acc >= r2) {
        chosen = i;
        break;
      }
    }

    const delta = stoichiometry[chosen]!;
    for (let s = 0; s < counts.length; s++) {
      counts[s] = Math.max(0, counts[s]! + delta[s]!);
    }
    times.push(t);
    trajectories.push([...counts]);
    steps++;
  }

  return { times, trajectories, reactionCount: steps };
}

export interface FbaResult {
  readonly feasible: boolean;
  readonly objectiveValue: number;
  readonly fluxes: Float64Array;
}

/**
 * Flux Balance Analysis (FBA):
 *   maximize c^T v
 *   s.t.     S * v = 0,  lb <= v <= ub
 * Solved via projected augmented-Lagrangian / primal-dual ascent for self-contained WASM/TS execution.
 */
export function solveFluxBalanceAnalysis(
  stoichiometry: readonly (readonly number[])[],
  lowerBounds: readonly number[],
  upperBounds: readonly number[],
  objective: readonly number[],
  maxIterations = 1500,
): FbaResult {
  const m = stoichiometry.length;
  const n = objective.length;
  const v = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    v[j] = Math.max(lowerBounds[j]!, Math.min(upperBounds[j]!, 0));
  }
  const lambda = new Float64Array(m);
  const rho = 25.0;
  const lr = 0.015;

  for (let iter = 0; iter < maxIterations; iter++) {
    // Residual r = S * v
    const r = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      let sum = 0;
      const row = stoichiometry[i]!;
      for (let j = 0; j < n; j++) sum += row[j]! * v[j]!;
      r[i] = sum;
    }

    // Primal gradient of L(v, lam) = c^T v - lam^T (S v) - (rho/2)||S v||^2
    for (let j = 0; j < n; j++) {
      let grad = objective[j]!;
      for (let i = 0; i < m; i++) {
        const sij = stoichiometry[i]![j]!;
        if (sij !== 0) grad -= sij * (lambda[i]! + rho * r[i]!);
      }
      const next = v[j]! + lr * grad;
      v[j] = Math.max(lowerBounds[j]!, Math.min(upperBounds[j]!, next));
    }

    // Dual update
    for (let i = 0; i < m; i++) {
      let sum = 0;
      const row = stoichiometry[i]!;
      for (let j = 0; j < n; j++) sum += row[j]! * v[j]!;
      lambda[i] = lambda[i]! + rho * lr * sum;
    }
  }

  let maxRes = 0;
  for (let i = 0; i < m; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += stoichiometry[i]![j]! * v[j]!;
    maxRes = Math.max(maxRes, Math.abs(sum));
  }

  let obj = 0;
  for (let j = 0; j < n; j++) obj += objective[j]! * v[j]!;

  return {
    feasible: maxRes < 1e-2,
    objectiveValue: obj,
    fluxes: v,
  };
}

export interface GibbsEquilibriumResult {
  readonly moles: Float64Array;
  readonly moleFractions: Float64Array;
  readonly totalGibbsRT: number;
  readonly converged: boolean;
}

/**
 * Ideal-gas Gibbs Free-Energy Minimization:
 *   min_n  sum_i n_i * (g0_i / RT + ln(n_i / N_tot))
 *   s.t.   A * n = b  (element conservation), n_i > 0
 * Solved via Rand's Newton-Lagrange method.
 */
export function solveGibbsEquilibrium(
  elementMatrix: readonly (readonly number[])[],
  elementTotals: readonly number[],
  standardGibbsRT: readonly number[],
  maxIterations = 60,
): GibbsEquilibriumResult {
  const numElem = elementMatrix.length;
  const numSpec = standardGibbsRT.length;
  const n = new Float64Array(numSpec).fill(1.0 / numSpec);
  let converged = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    let nTot = 0;
    for (let i = 0; i < numSpec; i++) nTot += n[i]!;

    // mu_i = g0_i + ln(n_i / nTot)
    const mu = new Float64Array(numSpec);
    for (let i = 0; i < numSpec; i++) {
      mu[i] = standardGibbsRT[i]! + Math.log(Math.max(1e-30, n[i]! / nTot));
    }

    // Rand's reduced (numElem + 1) x (numElem + 1) linear system for [pi_0..pi_{E-1}, delta_ln_nTot]
    const dim = numElem + 1;
    const M = new Float64Array(dim * dim);
    const rhs = new Float64Array(dim);

    for (let k = 0; k < numElem; k++) {
      let elemSum = 0;
      let aMu = 0;
      for (let i = 0; i < numSpec; i++) {
        const aki = elementMatrix[k]![i]!;
        elemSum += aki * n[i]!;
        aMu += aki * n[i]! * mu[i]!;
        for (let l = 0; l < numElem; l++) {
          M[k * dim + l] = M[k * dim + l]! + aki * elementMatrix[l]![i]! * n[i]!;
        }
      }
      M[k * dim + numElem] = elemSum;
      M[numElem * dim + k] = elemSum;
      rhs[k] = elementTotals[k]! - elemSum + aMu;
    }

    let sumNMu = 0;
    for (let i = 0; i < numSpec; i++) sumNMu += n[i]! * mu[i]!;
    rhs[numElem] = sumNMu;

    const sol = solveDenseLinear(M, rhs, dim);
    const dLnNtot = sol[numElem]!;

    // Update n_i with damping to keep positivity
    const dn = new Float64Array(numSpec);
    let maxRel = 0;
    for (let i = 0; i < numSpec; i++) {
      let api = 0;
      for (let k = 0; k < numElem; k++) api += elementMatrix[k]![i]! * sol[k]!;
      dn[i] = n[i]! * (api + dLnNtot - mu[i]!);
      maxRel = Math.max(maxRel, Math.abs(dn[i]!) / Math.max(1e-12, n[i]!));
    }

    let step = 1.0;
    for (let i = 0; i < numSpec; i++) {
      if (n[i]! + step * dn[i]! <= 0) {
        step = Math.min(step, (-0.9 * n[i]!) / dn[i]!);
      }
    }
    for (let i = 0; i < numSpec; i++) {
      n[i] = Math.max(1e-18, n[i]! + step * dn[i]!);
    }

    if (maxRel < 1e-8) {
      converged = true;
      break;
    }
  }

  let nTot = 0;
  for (let i = 0; i < numSpec; i++) nTot += n[i]!;
  const moleFractions = new Float64Array(numSpec);
  let totalGibbsRT = 0;
  for (let i = 0; i < numSpec; i++) {
    const x = n[i]! / Math.max(1e-30, nTot);
    moleFractions[i] = x;
    totalGibbsRT += n[i]! * (standardGibbsRT[i]! + Math.log(Math.max(1e-30, x)));
  }

  return { moles: n, moleFractions, totalGibbsRT, converged };
}
