// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Structural Reliability & Rare-Event Uncertainty Quantification:
 *   - FORM (First-Order Reliability Method via iHLRF in standard-normal u-space)
 *   - SORM (Second-Order Reliability Method via Breitung curvature correction)
 *   - Subset Simulation (Au & Beck, 2001) for non-smooth / multi-modal rare events
 *
 * Limit-state convention: g(x) <= 0 denotes the failure domain; g(x) > 0 is safe.
 */

import { DAEBuilder } from "@modelscript/runtime";
import { simulateArena, type ArenaSimulateOptions, type ArenaSimulationResult } from "../core/simulate-arena.js";
import { choleskyDecompose, type AnalyticalUqRigor } from "./fosm.js";
import { Xoshiro256pp, inverseCDF, normalQuantile, type RandomVariable } from "./monte-carlo.js";
import { jacobiEigenSymmetric } from "./pce.js";
import { normalCDF } from "./unscented.js";

// ─────────────────────────────────────────────────────────────────────
// Isoprobabilistic Transformation: u-space (N(0, I)) -> x-space
// ─────────────────────────────────────────────────────────────────────

function buildUtoXTransform(
  randomVars: RandomVariable[],
  correlations?: number[][] | undefined,
): (u: number[]) => Map<string, number> {
  const n = randomVars.length;
  const L = correlations ? choleskyDecompose(correlations) : null;

  return (u: number[]): Map<string, number> => {
    const z = new Array<number>(n);
    if (L) {
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j <= i; j++) sum += L[i]![j]! * u[j]!;
        z[i] = sum;
      }
    } else {
      for (let i = 0; i < n; i++) z[i] = u[i]!;
    }

    const xMap = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const rv = randomVars[i]!;
      if (rv.distribution.type === "gaussian") {
        xMap.set(rv.name, rv.distribution.mean + rv.distribution.stddev * z[i]!);
      } else if (rv.distribution.type === "lognormal") {
        xMap.set(rv.name, Math.exp(rv.distribution.mu + rv.distribution.sigma * z[i]!));
      } else {
        const p = Math.min(1 - 1e-15, Math.max(1e-15, normalCDF(z[i]!)));
        xMap.set(rv.name, inverseCDF(rv.distribution, p));
      }
    }
    return xMap;
  };
}

function vecNorm(v: number[]): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  return Math.sqrt(s);
}

function vecDot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

// ─────────────────────────────────────────────────────────────────────
// FORM (iHLRF) & SORM (Breitung)
// ─────────────────────────────────────────────────────────────────────

export interface FORMOptions {
  /** Optional correlation matrix in standard-normal space (n x n). */
  correlations?: number[][] | undefined;
  /** Maximum iHLRF iterations (default: 60). */
  maxIterations?: number | undefined;
  /** Convergence tolerance on ||u_{k+1} - u_k|| and |G(u)| (default: 1e-6). */
  tolerance?: number | undefined;
  /** Finite-difference step in u-space for gradient evaluation (default: 1e-5). */
  gradStep?: number | undefined;
  /** Initial guess in u-space (default: origin [0, ..., 0]). */
  initialU?: number[] | undefined;
}

export interface FORMResult {
  /** Signed Hasofer–Lind reliability index beta (> 0 if mean/origin is safe). */
  beta: number;
  /** First-order failure probability estimate: Phi(-beta). */
  failureProbability: number;
  /** Most Probable Point (MPP) in uncorrelated standard-normal u-space. */
  mppU: number[];
  /** Most Probable Point (MPP) in physical parameter space. */
  mppX: Map<string, number>;
  /** Unit direction cosines alpha_i = -(grad_u G)_i / ||grad_u G|| pointing toward failure. */
  alpha: number[];
  /** Squared importance factors alpha_i^2 keyed by parameter name (sum to 1). */
  importanceFactors: Map<string, number>;
  /** Limit-state value G(u*) at the converged MPP. */
  limitStateAtMpp: number;
  converged: boolean;
  iterations: number;
  numEvaluations: number;
  rigor: AnalyticalUqRigor;
}

export interface SORMOptions extends FORMOptions {
  /** Finite-difference step in u-space for Hessian estimation at MPP (default: 1e-3). */
  hessianStep?: number | undefined;
}

export interface SORMResult extends FORMResult {
  /** First-order failure probability Phi(-beta) for comparison. */
  formFailureProbability: number;
  /** Second-order Breitung failure probability correction. */
  sormFailureProbability: number;
  /** Principal curvatures kappa_1..kappa_{n-1} of the limit-state surface at the MPP. */
  principalCurvatures: number[];
}

/**
 * First-Order Reliability Method (FORM) using the improved Hasofer–Lind–Rackwitz–Fiessler
 * (iHLRF) algorithm with Armijo merit-function line search.
 *
 * Limit-state convention: limitState(x) <= 0 is failure.
 */
export function runFORM(
  limitState: (x: Map<string, number>) => number,
  randomVars: RandomVariable[],
  options?: FORMOptions,
): FORMResult {
  const n = randomVars.length;
  const maxIter = options?.maxIterations ?? 60;
  const tol = options?.tolerance ?? 1e-6;
  const h = options?.gradStep ?? 1e-5;
  const uToX = buildUtoXTransform(randomVars, options?.correlations);

  let numEvaluations = 0;
  const evalG = (u: number[]): number => {
    numEvaluations++;
    return limitState(uToX(u));
  };

  const evalGradG = (u: number[]): number[] => {
    const grad = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const up = u.slice();
      const um = u.slice();
      up[i] = u[i]! + h;
      um[i] = u[i]! - h;
      grad[i] = (evalG(up) - evalG(um)) / (2 * h);
    }
    return grad;
  };

  let u = options?.initialU ? options.initialU.slice() : new Array<number>(n).fill(0);
  let gVal = evalG(u);
  const g0Scale = Math.max(1.0, Math.abs(gVal));
  let grad = evalGradG(u);
  let converged = false;
  let iter = 0;

  for (iter = 1; iter <= maxIter; iter++) {
    const gradNorm = vecNorm(grad);
    if (gradNorm < 1e-14) break;

    // Direction cosine pointing toward failure: alpha = -grad / ||grad||
    const alpha = grad.map((gi) => -gi / gradNorm);
    const uDotGrad = vecDot(u, grad);

    // Classic HLRF target point: u_hlrf = ((u . grad - g) / ||grad||^2) * grad
    const coeff = (uDotGrad - gVal) / (gradNorm * gradNorm);
    const d = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      d[i] = coeff * grad[i]! - u[i]!;
    }

    // Armijo line search on iHLRF merit function m(u) = 0.5 * ||u||^2 + c * |G(u)|
    const uNorm = vecNorm(u);
    const cMerit = Math.max(uNorm / gradNorm, 1.0) * 2.0 + 10.0;
    const merit0 = 0.5 * uNorm * uNorm + cMerit * Math.abs(gVal);

    let step = 1.0;
    let uNext = u.slice();
    let gNext = gVal;
    for (let ls = 0; ls < 12; ls++) {
      for (let i = 0; i < n; i++) uNext[i] = u[i]! + step * d[i]!;
      gNext = evalG(uNext);
      const uNextNorm = vecNorm(uNext);
      const meritNext = 0.5 * uNextNorm * uNextNorm + cMerit * Math.abs(gNext);
      if (meritNext < merit0 || step < 1e-3) break;
      step *= 0.5;
    }

    const stepDiff = vecNorm(uNext.map((v, i) => v - u[i]!));
    u = uNext;
    gVal = gNext;
    grad = evalGradG(u);

    // Check convergence: on surface |G(u)| ~ 0 and u parallel to alpha
    const nextGradNorm = vecNorm(grad);
    const uNextNorm = vecNorm(u);
    const aligned =
      uNextNorm < 1e-12 ||
      nextGradNorm < 1e-14 ||
      Math.abs(Math.abs(vecDot(u, alpha)) - uNextNorm) < tol * Math.max(1, uNextNorm);

    if (Math.abs(gVal) <= tol * g0Scale && (stepDiff <= tol * Math.max(1, uNextNorm) || aligned)) {
      converged = true;
      break;
    }
  }

  const gradNorm = vecNorm(grad);
  const alpha = gradNorm > 1e-14 ? grad.map((gi) => -gi / gradNorm) : new Array<number>(n).fill(0);
  // Signed reliability index beta = alpha . u* (positive if origin is on safe side)
  const beta = vecDot(alpha, u);
  const failureProbability = normalCDF(-beta);

  const importanceFactors = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    importanceFactors.set(randomVars[i]!.name, alpha[i]! * alpha[i]!);
  }

  return {
    beta,
    failureProbability,
    mppU: u,
    mppX: uToX(u),
    alpha,
    importanceFactors,
    limitStateAtMpp: gVal,
    converged,
    iterations: iter,
    numEvaluations,
    rigor: "approximate",
  };
}

/**
 * Second-Order Reliability Method (SORM) using Breitung's asymptotic curvature formula.
 * Runs FORM to locate the MPP u*, computes the Hessian of G in u-space, projects onto
 * the (n-1)-dimensional tangent hyperplane orthogonal to alpha via Householder reflection,
 * and applies:
 *
 *   P_f^SORM = Phi(-beta) * prod_{i=1}^{n-1} (1 + beta * kappa_i)^(-1/2)
 */
export function runSORM(
  limitState: (x: Map<string, number>) => number,
  randomVars: RandomVariable[],
  options?: SORMOptions,
): SORMResult {
  const form = runFORM(limitState, randomVars, options);
  const n = randomVars.length;

  if (n <= 1) {
    return {
      ...form,
      formFailureProbability: form.failureProbability,
      sormFailureProbability: form.failureProbability,
      principalCurvatures: [],
    };
  }

  const h = options?.hessianStep ?? 1e-3;
  const uToX = buildUtoXTransform(randomVars, options?.correlations);
  const uStar = form.mppU;
  let extraEvals = 0;
  const evalG = (u: number[]): number => {
    extraEvals++;
    return limitState(uToX(u));
  };

  const gStar = form.limitStateAtMpp;
  // Compute gradient norm and full Hessian H_ij = d^2 G / (du_i du_j) at u*
  const grad = new Array<number>(n);
  const H: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const gPlus = new Array<number>(n);
  const gMinus = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const up = uStar.slice();
    const um = uStar.slice();
    up[i] = uStar[i]! + h;
    um[i] = uStar[i]! - h;
    gPlus[i] = evalG(up);
    gMinus[i] = evalG(um);
    grad[i] = (gPlus[i]! - gMinus[i]!) / (2 * h);
    H[i]![i] = (gPlus[i]! - 2 * gStar + gMinus[i]!) / (h * h);
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const upp = uStar.slice();
      upp[i] = uStar[i]! + h;
      upp[j] = uStar[j]! + h;
      const upm = uStar.slice();
      upm[i] = uStar[i]! + h;
      upm[j] = uStar[j]! - h;
      const ump = uStar.slice();
      ump[i] = uStar[i]! - h;
      ump[j] = uStar[j]! + h;
      const umm = uStar.slice();
      umm[i] = uStar[i]! - h;
      umm[j] = uStar[j]! - h;
      const val = (evalG(upp) - evalG(upm) - evalG(ump) + evalG(umm)) / (4 * h * h);
      H[i]![j] = val;
      H[j]![i] = val;
    }
  }

  const gradNorm = vecNorm(grad);
  if (gradNorm < 1e-14) {
    return {
      ...form,
      numEvaluations: form.numEvaluations + extraEvals,
      formFailureProbability: form.failureProbability,
      sormFailureProbability: form.failureProbability,
      principalCurvatures: new Array<number>(n - 1).fill(0),
    };
  }

  // Construct orthogonal rotation matrix R whose last row is alpha = -grad / ||grad||
  // via Householder reflection mapping alpha -> e_{n-1}
  const alpha = form.alpha;
  const v = alpha.slice();
  const sign = alpha[n - 1]! >= 0 ? 1 : -1;
  v[n - 1] = alpha[n - 1]! + sign; // v = alpha + sign * e_{n-1}
  const vNormSq = vecDot(v, v);

  const R: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => {
      const delta = i === j ? 1 : 0;
      const hVal = vNormSq > 1e-20 ? delta - (2 * v[i]! * v[j]!) / vNormSq : delta;
      return -sign * hVal;
    }),
  );

  // Rotated scaled Hessian: A_rot = (R * H * R^T) / ||grad||
  // Leading (n-1) x (n-1) submatrix eigenvalues are the principal curvatures kappa_i
  const RH: number[][] = Array.from({ length: n - 1 }, (_, i) =>
    Array.from({ length: n }, (__, j) => {
      let s = 0;
      for (let k = 0; k < n; k++) s += R[i]![k]! * H[k]![j]!;
      return s;
    }),
  );

  const ASub: number[][] = Array.from({ length: n - 1 }, (_, i) =>
    Array.from({ length: n - 1 }, (__, j) => {
      let s = 0;
      for (let k = 0; k < n; k++) s += RH[i]![k]! * R[j]![k]!;
      return s / gradNorm;
    }),
  );

  const { values: principalCurvatures } = jacobiEigenSymmetric(ASub);

  // Breitung (1984) formula: Pf_SORM = Phi(-beta) * prod (1 + beta * kappa_i)^(-1/2)
  let factor = 1.0;
  for (const kappa of principalCurvatures) {
    const term = 1 + form.beta * kappa;
    if (term > 1e-6) {
      factor *= 1 / Math.sqrt(term);
    }
  }
  const sormFailureProbability = Math.min(1.0, Math.max(0.0, form.failureProbability * factor));

  return {
    ...form,
    failureProbability: sormFailureProbability,
    formFailureProbability: form.failureProbability,
    sormFailureProbability,
    principalCurvatures,
    numEvaluations: form.numEvaluations + extraEvals,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Subset Simulation (Au & Beck, 2001)
// ─────────────────────────────────────────────────────────────────────

export interface SubsetSimulationOptions {
  /** Samples per subset level N (default: 500). */
  samplesPerLevel?: number | undefined;
  /** Intermediate conditional failure probability p0 in (0, 1) (default: 0.1). */
  conditionalProb?: number | undefined;
  /** Maximum number of subset levels (default: 10). */
  maxLevels?: number | undefined;
  /** Proposal standard deviation in u-space for Modified Metropolis–Hastings (default: 1.0). */
  proposalStd?: number | undefined;
  /** Optional correlation matrix in standard-normal space. */
  correlations?: number[][] | undefined;
  /** Deterministic PRNG seed (default: 42). */
  seed?: number | undefined;
}

export interface SubsetLevelSummary {
  level: number;
  threshold: number;
  conditionalProbability: number;
  numFailures: number;
}

export interface SubsetSimulationResult {
  /** Estimated rare-event failure probability P(g(x) <= 0). */
  failureProbability: number;
  /** Equivalent generalized reliability index -Phi^{-1}(Pf). */
  reliabilityIndex: number;
  /** Approximate coefficient of variation of the Pf estimate. */
  covEstimate: number;
  levels: SubsetLevelSummary[];
  numEvaluations: number;
  rigor: "statistical";
}

/**
 * Subset Simulation (Au & Beck, 2001) for rare-event failure probability estimation
 * P(limitState(x) <= 0) using component-wise Modified Metropolis–Hastings in u-space.
 */
export function runSubsetSimulation(
  limitState: (x: Map<string, number>) => number,
  randomVars: RandomVariable[],
  options?: SubsetSimulationOptions,
): SubsetSimulationResult {
  const n = randomVars.length;
  const N = Math.max(20, options?.samplesPerLevel ?? 500);
  const p0 = Math.min(0.5, Math.max(0.05, options?.conditionalProb ?? 0.1));
  const maxLevels = Math.max(1, options?.maxLevels ?? 10);
  const propStd = options?.proposalStd ?? 1.0;
  const rng = new Xoshiro256pp(options?.seed ?? 42);
  const uToX = buildUtoXTransform(randomVars, options?.correlations);

  const numSeeds = Math.max(1, Math.round(p0 * N));
  const chainLen = Math.ceil(N / numSeeds);

  let numEvaluations = 0;
  const evalG = (u: number[]): number => {
    numEvaluations++;
    return limitState(uToX(u));
  };

  // Level 0: crude Monte Carlo in standard-normal u-space
  let samplesU: number[][] = new Array(N);
  let samplesG: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const u = new Array<number>(n);
    for (let j = 0; j < n; j++) u[j] = rng.randn();
    samplesU[i] = u;
    samplesG[i] = evalG(u);
  }

  const levels: SubsetLevelSummary[] = [];
  let pf = 1.0;
  let covSqSum = 0;

  for (let level = 0; level < maxLevels; level++) {
    // Count direct failures g(x) <= 0
    let failCount = 0;
    for (let i = 0; i < N; i++) {
      if (samplesG[i]! <= 0) failCount++;
    }

    // Sort sample indices by g ascending (smallest g = closest to / inside failure)
    const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => samplesG[a]! - samplesG[b]!);
    const threshold = samplesG[order[numSeeds - 1]!]!;

    if (threshold <= 0 || level === maxLevels - 1) {
      const pLast = failCount / N;
      pf *= pLast;
      levels.push({
        level,
        threshold: Math.max(0, threshold),
        conditionalProbability: pLast,
        numFailures: failCount,
      });
      if (pLast > 0 && pLast < 1) {
        covSqSum += (1 - pLast) / (pLast * N);
      }
      break;
    }

    // Intermediate level
    const pLevel = numSeeds / N;
    pf *= pLevel;
    levels.push({
      level,
      threshold,
      conditionalProbability: pLevel,
      numFailures: numSeeds,
    });
    covSqSum += (1 - pLevel) / (pLevel * N);

    // Generate next level via component-wise Modified Metropolis–Hastings (MMH)
    const nextU: number[][] = [];
    const nextG: number[] = [];

    for (let s = 0; s < numSeeds && nextU.length < N; s++) {
      let currU = samplesU[order[s]!]!.slice();
      let currG = samplesG[order[s]!]!;
      nextU.push(currU.slice());
      nextG.push(currG);

      for (let step = 1; step < chainLen && nextU.length < N; step++) {
        const candU = new Array<number>(n);
        for (let j = 0; j < n; j++) {
          const uj = currU[j]!;
          const prop = uj + propStd * rng.randn();
          // Standard normal ratio: exp(-0.5 * (prop^2 - uj^2))
          const logRatio = -0.5 * (prop * prop - uj * uj);
          if (logRatio >= 0 || Math.log(Math.max(1e-300, rng.random())) < logRatio) {
            candU[j] = prop;
          } else {
            candU[j] = uj;
          }
        }
        const candG = evalG(candU);
        if (candG <= threshold) {
          currU = candU;
          currG = candG;
        }
        nextU.push(currU.slice());
        nextG.push(currG);
      }
    }

    samplesU = nextU;
    samplesG = nextG;
  }

  const reliabilityIndex = pf <= 0 ? Infinity : pf >= 1 ? -Infinity : -normalQuantile(pf);

  return {
    failureProbability: pf,
    reliabilityIndex,
    covEstimate: Math.sqrt(covSqSum),
    levels,
    numEvaluations,
    rigor: "statistical",
  };
}

// ─────────────────────────────────────────────────────────────────────
// Arena Wrappers for FORM, SORM, and Subset Simulation
// ─────────────────────────────────────────────────────────────────────

export interface ArenaReliabilityOptions {
  /** Base simulation options forwarded to simulateArena(). */
  simulateOptions?: ArenaSimulateOptions | undefined;
}

function makeArenaLimitState(
  arena: DAEBuilder,
  limitState: (sim: ArenaSimulationResult) => number,
  simOpts?: ArenaSimulateOptions | undefined,
): (x: Map<string, number>) => number {
  const baseOverrides = simOpts?.parameterOverrides;
  return (sample: Map<string, number>): number => {
    const merged = new Map<string, number>();
    if (baseOverrides) {
      for (const [k, v] of baseOverrides) merged.set(k, v);
    }
    for (const [k, v] of sample) merged.set(k, v);
    const sim = simulateArena(arena, {
      ...simOpts,
      parameterOverrides: merged,
    });
    return limitState(sim);
  };
}

export function runFORMArena(
  arena: DAEBuilder,
  randomVars: RandomVariable[],
  limitState: (sim: ArenaSimulationResult) => number,
  options?: FORMOptions & ArenaReliabilityOptions,
): FORMResult {
  return runFORM(makeArenaLimitState(arena, limitState, options?.simulateOptions), randomVars, options);
}

export function runSORMArena(
  arena: DAEBuilder,
  randomVars: RandomVariable[],
  limitState: (sim: ArenaSimulationResult) => number,
  options?: SORMOptions & ArenaReliabilityOptions,
): SORMResult {
  return runSORM(makeArenaLimitState(arena, limitState, options?.simulateOptions), randomVars, options);
}

export function runSubsetSimulationArena(
  arena: DAEBuilder,
  randomVars: RandomVariable[],
  limitState: (sim: ArenaSimulationResult) => number,
  options?: SubsetSimulationOptions & ArenaReliabilityOptions,
): SubsetSimulationResult {
  return runSubsetSimulation(makeArenaLimitState(arena, limitState, options?.simulateOptions), randomVars, options);
}
