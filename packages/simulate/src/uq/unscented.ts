// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Scaled Unscented Transform (UT) / Sigma-Point Uncertainty Propagation
 * (Wan & van der Merwe, 2000).
 *
 * Propagates mean and covariance through nonlinear maps and DAE arena
 * simulations using 2n + 1 deterministic sigma points, capturing up to
 * third-order Taylor accuracy for Gaussian inputs (and second-order for
 * arbitrary distributions) without computing Jacobians or Hessians.
 */

import { DAEBuilder } from "@modelscript/runtime";
import { simulateArena, type ArenaSimulateOptions, type ArenaSimulationResult } from "../core/simulate-arena.js";
import {
  buildInputMoments,
  choleskyDecompose,
  interpolateTrajectoryAt,
  symmetrizeMatrix,
  type AnalyticalUqRigor,
} from "./fosm.js";
import { inverseCDF, normalQuantile, type RandomVariable } from "./monte-carlo.js";

// ─────────────────────────────────────────────────────────────────────
// Normal CDF (for optional isoprobabilistic standard-normal mapping)
// ─────────────────────────────────────────────────────────────────────

export function normalCDF(z: number): number {
  // Abramowitz & Stegun 7.1.26 erf approximation
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

// ─────────────────────────────────────────────────────────────────────
// Sigma Point Generation
// ─────────────────────────────────────────────────────────────────────

export interface UnscentedOptions {
  /** Spread of sigma points around the mean (default: 1.0 for standard UT; 1e-3..1 for scaled UT). */
  alpha?: number | undefined;
  /** Prior distribution knowledge parameter (default: 2.0, optimal for Gaussian distributions). */
  beta?: number | undefined;
  /** Secondary scaling parameter (default: 0). */
  kappa?: number | undefined;
}

export interface SigmaPointSet {
  /** 2n + 1 sigma points, each of dimension n. */
  points: number[][];
  /** Mean weights W_m (length 2n + 1, sum to 1). */
  weightsMean: number[];
  /** Covariance weights W_c (length 2n + 1). */
  weightsCov: number[];
  /** Composite scaling parameter lambda = alpha^2 * (n + kappa) - n. */
  lambda: number;
}

/**
 * Generate 2n + 1 scaled Unscented Transform sigma points and weights
 * for a distribution with given mean vector and covariance matrix.
 */
export function generateSigmaPoints(mean: number[], covariance: number[][], options?: UnscentedOptions): SigmaPointSet {
  const n = mean.length;
  const alpha = options?.alpha ?? 1.0;
  const beta = options?.beta ?? 2.0;
  const kappa = options?.kappa ?? 0.0;

  const lambda = alpha * alpha * (n + kappa) - n;
  const scale = n + lambda;
  if (scale <= 0) {
    throw new Error(`Invalid Unscented Transform scaling: n + lambda = ${scale} must be > 0`);
  }

  const sqrtScale = Math.sqrt(scale);
  const L = choleskyDecompose(covariance);

  const points: number[][] = new Array(2 * n + 1);
  const weightsMean: number[] = new Array(2 * n + 1);
  const weightsCov: number[] = new Array(2 * n + 1);

  points[0] = mean.slice();
  weightsMean[0] = lambda / scale;
  weightsCov[0] = lambda / scale + (1 - alpha * alpha + beta);

  const wSide = 0.5 / scale;
  for (let i = 0; i < n; i++) {
    const pPlus = new Array<number>(n);
    const pMinus = new Array<number>(n);
    for (let r = 0; r < n; r++) {
      const delta = sqrtScale * L[r]![i]!;
      pPlus[r] = mean[r]! + delta;
      pMinus[r] = mean[r]! - delta;
    }
    points[1 + i] = pPlus;
    points[1 + n + i] = pMinus;
    weightsMean[1 + i] = wSide;
    weightsMean[1 + n + i] = wSide;
    weightsCov[1 + i] = wSide;
    weightsCov[1 + n + i] = wSide;
  }

  return { points, weightsMean, weightsCov, lambda };
}

// ─────────────────────────────────────────────────────────────────────
// Static Map Unscented Propagation
// ─────────────────────────────────────────────────────────────────────

export interface UnscentedResult {
  mean: number[];
  covariance: number[][];
  stddev: number[];
  /** Cross-covariance Cov(x, y) (n x m). */
  crossCovariance: number[][];
  sigmaPoints: SigmaPointSet;
  numEvaluations: number;
  rigor: AnalyticalUqRigor;
}

/**
 * Propagate input mean and covariance through a nonlinear vector map y = fn(x)
 * using the scaled Unscented Transform (2n + 1 evaluations).
 */
export function propagateUnscented(
  fn: (x: number[]) => number[],
  inputMean: number[],
  inputCov: number[][],
  options?: UnscentedOptions,
): UnscentedResult {
  const sigma = generateSigmaPoints(inputMean, inputCov, options);
  const n = inputMean.length;
  const numPts = sigma.points.length;

  const yPts: number[][] = new Array(numPts);
  for (let k = 0; k < numPts; k++) {
    yPts[k] = fn(sigma.points[k]!);
  }

  const m = yPts[0]?.length ?? 0;
  const mean = new Array<number>(m).fill(0);
  for (let k = 0; k < numPts; k++) {
    const wm = sigma.weightsMean[k]!;
    const yk = yPts[k]!;
    for (let i = 0; i < m; i++) {
      mean[i]! += wm * yk[i]!;
    }
  }

  const covRaw: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const crossCovariance: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(0));

  for (let k = 0; k < numPts; k++) {
    const wc = sigma.weightsCov[k]!;
    const xk = sigma.points[k]!;
    const yk = yPts[k]!;

    for (let i = 0; i < m; i++) {
      const dyi = yk[i]! - mean[i]!;
      for (let j = i; j < m; j++) {
        const dyj = yk[j]! - mean[j]!;
        covRaw[i]![j]! += wc * dyi * dyj;
      }
      for (let r = 0; r < n; r++) {
        const dxr = xk[r]! - inputMean[r]!;
        crossCovariance[r]![i]! += wc * dxr * dyi;
      }
    }
  }

  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      covRaw[j]![i] = covRaw[i]![j]!;
    }
  }

  const covariance = symmetrizeMatrix(covRaw);
  const stddev = new Array<number>(m);
  for (let i = 0; i < m; i++) {
    stddev[i] = Math.sqrt(Math.max(0, covariance[i]![i]!));
  }

  return {
    mean,
    covariance,
    stddev,
    crossCovariance,
    sigmaPoints: sigma,
    numEvaluations: numPts,
    rigor: "approximate",
  };
}

// ─────────────────────────────────────────────────────────────────────
// Arena Trajectory Unscented Propagation
// ─────────────────────────────────────────────────────────────────────

export interface ArenaUnscentedOptions extends UnscentedOptions {
  /** Base simulation options forwarded to simulateArena(). */
  simulateOptions?: ArenaSimulateOptions | undefined;
  /** Optional parameter correlation matrix (nParams x nParams). */
  correlations?: number[][] | undefined;
  /**
   * When true, generate sigma points in standard-normal u-space and map each
   * coordinate through the distribution's inverse CDF (Nataf-like transform).
   * Prevents sigma points from leaving bounded supports (Uniform, Beta, LogNormal).
   * Default: false (direct moment-space UT).
   */
  isoprobabilistic?: boolean | undefined;
  /** Confidence level for +/- z*sigma intervals (default: 0.95). */
  confidenceLevel?: number | undefined;
  /** Store full state covariance matrix at every time step (default: false). */
  includeFullCovariance?: boolean | undefined;
}

export interface ArenaUnscentedResult {
  t: number[];
  states: string[];
  /** Nonlinear unscented mean trajectory: [timeIdx][stateIdx]. */
  mean: number[][];
  /** Unscented variance trajectory: [timeIdx][stateIdx]. */
  variance: number[][];
  /** Unscented standard deviation trajectory: [timeIdx][stateIdx]. */
  stddev: number[][];
  /** Lower Gaussian confidence bound: [timeIdx][stateIdx]. */
  ciLo: number[][];
  /** Upper Gaussian confidence bound: [timeIdx][stateIdx]. */
  ciHi: number[][];
  /** Optional full state covariance matrices: [timeIdx][state_i][state_j]. */
  covariance?: number[][][] | undefined;
  numEvaluations: number;
  rigor: AnalyticalUqRigor;
}

/**
 * Propagate parameter uncertainty through a DAE arena trajectory using
 * the scaled Unscented Transform (2p + 1 simulations).
 */
export function propagateUnscentedArena(
  arena: DAEBuilder,
  randomVars: RandomVariable[],
  options?: ArenaUnscentedOptions,
): ArenaUnscentedResult {
  const p = randomVars.length;
  const isoprob = options?.isoprobabilistic ?? false;
  const conf = options?.confidenceLevel ?? 0.95;
  const z = normalQuantile((1 + conf) / 2);
  const baseOverrides = options?.simulateOptions?.parameterOverrides;

  let sigma: SigmaPointSet;
  let paramVectors: number[][];

  if (isoprob) {
    const uMean = new Array<number>(p).fill(0);
    const uCov: number[][] = Array.from({ length: p }, (_, i) =>
      Array.from({ length: p }, (__, j) => (i === j ? 1 : (options?.correlations?.[i]?.[j] ?? 0))),
    );
    sigma = generateSigmaPoints(uMean, uCov, options);
    paramVectors = sigma.points.map((uPt) =>
      uPt.map((uz, j) => {
        const u = Math.min(1 - 1e-12, Math.max(1e-12, normalCDF(uz)));
        return inverseCDF(randomVars[j]!.distribution, u);
      }),
    );
  } else {
    const { mean, covariance } = buildInputMoments(randomVars, options?.correlations);
    sigma = generateSigmaPoints(mean, covariance, options);
    paramVectors = sigma.points;
  }

  const numPts = paramVectors.length;
  const simResults: ArenaSimulationResult[] = new Array(numPts);

  for (let k = 0; k < numPts; k++) {
    const merged = new Map<string, number>();
    if (baseOverrides) {
      for (const [key, val] of baseOverrides) merged.set(key, val);
    }
    const pv = paramVectors[k]!;
    for (let j = 0; j < p; j++) {
      merged.set(randomVars[j]!.name, pv[j]!);
    }
    simResults[k] = simulateArena(arena, {
      ...options?.simulateOptions,
      parameterOverrides: merged,
    });
  }

  const refRes = simResults[0]!;
  const nT = refRes.t.length;
  const nS = refRes.states.length;

  const mean: number[][] = Array.from({ length: nT }, () => new Array<number>(nS).fill(0));
  const variance: number[][] = Array.from({ length: nT }, () => new Array<number>(nS).fill(0));
  const stddev: number[][] = Array.from({ length: nT }, () => new Array<number>(nS).fill(0));
  const ciLo: number[][] = Array.from({ length: nT }, () => new Array<number>(nS).fill(0));
  const ciHi: number[][] = Array.from({ length: nT }, () => new Array<number>(nS).fill(0));
  const fullCov: number[][][] | undefined = options?.includeFullCovariance ? new Array(nT) : undefined;

  for (let ti = 0; ti < nT; ti++) {
    const tTarget = refRes.t[ti]!;
    const yAtT: number[][] = new Array(numPts);
    for (let k = 0; k < numPts; k++) {
      yAtT[k] = k === 0 ? refRes.y[ti]!.slice(0, nS) : interpolateTrajectoryAt(simResults[k]!, tTarget, nS);
    }

    // Weighted mean
    for (let k = 0; k < numPts; k++) {
      const wm = sigma.weightsMean[k]!;
      const yk = yAtT[k]!;
      for (let si = 0; si < nS; si++) {
        mean[ti]![si]! += wm * yk[si]!;
      }
    }

    // Weighted covariance
    const covT: number[][] = fullCov ? Array.from({ length: nS }, () => new Array<number>(nS).fill(0)) : [];

    for (let si = 0; si < nS; si++) {
      let varS = 0;
      for (let k = 0; k < numPts; k++) {
        const wc = sigma.weightsCov[k]!;
        const dsi = yAtT[k]![si]! - mean[ti]![si]!;
        varS += wc * dsi * dsi;
        if (fullCov) {
          for (let sj = si; sj < nS; sj++) {
            const dsj = yAtT[k]![sj]! - mean[ti]![sj]!;
            covT[si]![sj]! += wc * dsi * dsj;
          }
        }
      }
      const clampedVar = Math.max(0, varS);
      const sd = Math.sqrt(clampedVar);
      variance[ti]![si] = clampedVar;
      stddev[ti]![si] = sd;
      ciLo[ti]![si] = mean[ti]![si]! - z * sd;
      ciHi[ti]![si] = mean[ti]![si]! + z * sd;
    }

    if (fullCov) {
      fullCov[ti] = symmetrizeMatrix(covT);
    }
  }

  return {
    t: refRes.t.slice(),
    states: refRes.states.slice(),
    mean,
    variance,
    stddev,
    ciLo,
    ciHi,
    ...(fullCov ? { covariance: fullCov } : {}),
    numEvaluations: numPts,
    rigor: "approximate",
  };
}
