// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * First-Order & Second-Order Moment Propagation (FOSM / SOSM) and
 * Continuous-Time Lyapunov/EKF Covariance ODE Propagation.
 *
 * All methods in this module are analytical approximations (`rigor: "approximate"`):
 * they do NOT produce guaranteed set enclosures and must never emit a `proven`
 * formal verification verdict.
 */

import { DAEBuilder } from "@modelscript/runtime";
import { simulateArena, type ArenaSimulateOptions, type ArenaSimulationResult } from "../core/simulate-arena.js";
import { distributionMean, distributionVariance, normalQuantile, type RandomVariable } from "./monte-carlo.js";

// ─────────────────────────────────────────────────────────────────────
// Shared Rigor & Linear Algebra Utilities
// ─────────────────────────────────────────────────────────────────────

/** Rigor classification for analytical UQ propagation results. */
export type AnalyticalUqRigor = "approximate";

/** Symmetrize a square matrix in place of numerical drift: 0.5 * (M + M^T). */
export function symmetrizeMatrix(M: number[][]): number[][] {
  const n = M.length;
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const avg = 0.5 * ((M[i]?.[j] ?? 0) + (M[j]?.[i] ?? 0));
      out[i]![j] = avg;
      out[j]![i] = avg;
    }
  }
  return out;
}

/**
 * Lower-triangular Cholesky decomposition L such that L * L^T = M.
 * Supports positive-semidefinite matrices via optional adaptive diagonal jitter.
 */
export function choleskyDecompose(matrix: number[][], jitter = 1e-12): number[][] {
  const n = matrix.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += L[i]![k]! * L[j]![k]!;
      }
      if (i === j) {
        const diag = (matrix[i]?.[i] ?? 0) - sum;
        if (diag > 0) {
          L[i]![j] = Math.sqrt(diag);
        } else if (diag >= -Math.max(jitter, 1e-12) * Math.max(1, Math.abs(matrix[i]?.[i] ?? 0))) {
          L[i]![j] = 0;
        } else {
          // Retry with small diagonal regularization for near-PSD covariance matrices
          const reg = Math.abs(diag) + jitter;
          L[i]![j] = Math.sqrt(reg);
        }
      } else {
        const ljj = L[j]![j]!;
        L[i]![j] = ljj > 0 ? ((matrix[i]?.[j] ?? 0) - sum) / ljj : 0;
      }
    }
  }

  return L;
}

/**
 * Build an input mean vector and covariance matrix from RandomVariable definitions
 * and an optional correlation matrix (defaults to uncorrelated / diagonal).
 */
export function buildInputMoments(
  vars: RandomVariable[],
  correlations?: number[][] | undefined,
): { mean: number[]; covariance: number[][] } {
  const n = vars.length;
  const mean = vars.map((v) => distributionMean(v.distribution));
  const stddevs = vars.map((v) => Math.sqrt(Math.max(0, distributionVariance(v.distribution))));
  const covariance: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let i = 0; i < n; i++) {
    covariance[i]![i] = stddevs[i]! * stddevs[i]!;
    if (correlations) {
      for (let j = i + 1; j < n; j++) {
        const rho = correlations[i]?.[j] ?? 0;
        const covIJ = rho * stddevs[i]! * stddevs[j]!;
        covariance[i]![j] = covIJ;
        covariance[j]![i] = covIJ;
      }
    }
  }

  return { mean, covariance };
}

function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length;
  const kDim = A[0]?.length ?? 0;
  const n = B[0]?.length ?? 0;
  const C: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let k = 0; k < kDim; k++) {
      const aik = A[i]![k]!;
      if (aik === 0) continue;
      for (let j = 0; j < n; j++) {
        C[i]![j]! += aik * B[k]![j]!;
      }
    }
  }
  return C;
}

function matMulTransposeRight(A: number[][], B: number[][]): number[][] {
  // Computes A * B^T
  const m = A.length;
  const kDim = A[0]?.length ?? 0;
  const n = B.length;
  const C: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < kDim; k++) {
        sum += A[i]![k]! * B[j]![k]!;
      }
      C[i]![j] = sum;
    }
  }
  return C;
}

function traceProduct(A: number[][], B: number[][]): number {
  const n = A.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sum += A[i]![j]! * B[j]![i]!;
    }
  }
  return sum;
}

// ─────────────────────────────────────────────────────────────────────
// Static Map FOSM & SOSM Propagation
// ─────────────────────────────────────────────────────────────────────

export interface FOSMOptions {
  /** Optional analytical Jacobian df/dx (m x n). If omitted, central finite differences are used. */
  jacobian?: ((x: number[]) => number[][]) | undefined;
  /** Relative finite-difference step size (default: 1e-6). */
  stepSize?: number | undefined;
  /** Use forward differences instead of central differences (cheaper, O(h) vs O(h^2)). */
  forwardDifference?: boolean | undefined;
}

export interface FOSMResult {
  mean: number[];
  covariance: number[][];
  stddev: number[];
  jacobian: number[][];
  /**
   * Variance contribution fraction [outputIdx][inputIdx] for diagonal input variance:
   * (J_ij^2 * Sigma_jj) / Sigma_y_ii. Sums to 1 when inputs are uncorrelated.
   */
  varianceContributions: number[][];
  numEvaluations: number;
  rigor: AnalyticalUqRigor;
}

export interface SOSMOptions extends FOSMOptions {
  /** Optional analytical Hessians H[outputIdx][i][j] = d^2 f_k / (dx_i dx_j). */
  hessian?: ((x: number[]) => number[][][]) | undefined;
  /** Finite-difference step size for Hessian estimation (default: 1e-4). */
  hessianStepSize?: number | undefined;
}

export interface SOSMResult extends FOSMResult {
  /** Second-order mean correction: 0.5 * tr(H_k * Sigma_x). */
  meanCorrection: number[];
  /** Second-order covariance correction: 0.5 * tr(H_k * Sigma_x * H_l * Sigma_x). */
  covarianceCorrection: number[][];
  hessians: number[][][];
}

/**
 * Compute numerical Jacobian J (m x n) of f at x using central (or forward) differences.
 */
function computeFiniteDiffJacobian(
  fn: (x: number[]) => number[],
  x: number[],
  y0: number[],
  stepSize: number,
  forward: boolean,
): { J: number[][]; evals: number } {
  const n = x.length;
  const m = y0.length;
  const J: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  let evals = 0;

  for (let j = 0; j < n; j++) {
    const h = stepSize * Math.max(1, Math.abs(x[j]!));
    const xPlus = x.slice();
    xPlus[j] = x[j]! + h;
    const yPlus = fn(xPlus);
    evals++;

    if (forward) {
      for (let i = 0; i < m; i++) {
        J[i]![j] = (yPlus[i]! - y0[i]!) / h;
      }
    } else {
      const xMinus = x.slice();
      xMinus[j] = x[j]! - h;
      const yMinus = fn(xMinus);
      evals++;
      for (let i = 0; i < m; i++) {
        J[i]![j] = (yPlus[i]! - yMinus[i]!) / (2 * h);
      }
    }
  }

  return { J, evals };
}

/**
 * Compute numerical Hessians H[k][i][j] of f at x using central finite differences.
 */
function computeFiniteDiffHessians(
  fn: (x: number[]) => number[],
  x: number[],
  y0: number[],
  stepSize: number,
): { H: number[][][]; evals: number } {
  const n = x.length;
  const m = y0.length;
  const H: number[][][] = Array.from({ length: m }, () =>
    Array.from({ length: n }, () => new Array<number>(n).fill(0)),
  );
  const steps = x.map((xi) => stepSize * Math.max(1, Math.abs(xi)));
  let evals = 0;

  // Cache single-axis perturbations for diagonal entries
  const yPlusAxis: number[][] = [];
  const yMinusAxis: number[][] = [];
  for (let i = 0; i < n; i++) {
    const xp = x.slice();
    xp[i] = x[i]! + steps[i]!;
    yPlusAxis.push(fn(xp));
    const xm = x.slice();
    xm[i] = x[i]! - steps[i]!;
    yMinusAxis.push(fn(xm));
    evals += 2;

    const h2 = steps[i]! * steps[i]!;
    for (let k = 0; k < m; k++) {
      H[k]![i]![i] = (yPlusAxis[i]![k]! - 2 * y0[k]! + yMinusAxis[i]![k]!) / h2;
    }
  }

  // Off-diagonal mixed partial derivatives
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const hi = steps[i]!;
      const hj = steps[j]!;

      const xpp = x.slice();
      xpp[i] = x[i]! + hi;
      xpp[j] = x[j]! + hj;
      const ypp = fn(xpp);

      const xpm = x.slice();
      xpm[i] = x[i]! + hi;
      xpm[j] = x[j]! - hj;
      const ypm = fn(xpm);

      const xmp = x.slice();
      xmp[i] = x[i]! - hi;
      xmp[j] = x[j]! + hj;
      const ymp = fn(xmp);

      const xmm = x.slice();
      xmm[i] = x[i]! - hi;
      xmm[j] = x[j]! - hj;
      const ymm = fn(xmm);

      evals += 4;
      const denom = 4 * hi * hj;
      for (let k = 0; k < m; k++) {
        const val = (ypp[k]! - ypm[k]! - ymp[k]! + ymm[k]!) / denom;
        H[k]![i]![j] = val;
        H[k]![j]![i] = val;
      }
    }
  }

  return { H, evals };
}

/**
 * First-Order Second-Moment (FOSM) uncertainty propagation through y = fn(x).
 *
 *   mu_y    ≈ f(mu_x)
 *   Sigma_y ≈ J * Sigma_x * J^T
 */
export function propagateFOSM(
  fn: (x: number[]) => number[],
  inputMean: number[],
  inputCov: number[][],
  options?: FOSMOptions,
): FOSMResult {
  const y0 = fn(inputMean);
  let numEvaluations = 1;

  let J: number[][];
  if (options?.jacobian) {
    J = options.jacobian(inputMean);
  } else {
    const fd = computeFiniteDiffJacobian(
      fn,
      inputMean,
      y0,
      options?.stepSize ?? 1e-6,
      options?.forwardDifference ?? false,
    );
    J = fd.J;
    numEvaluations += fd.evals;
  }

  const JSigma = matMul(J, inputCov);
  const covariance = symmetrizeMatrix(matMulTransposeRight(JSigma, J));
  const m = y0.length;
  const n = inputMean.length;
  const stddev = new Array<number>(m);
  const varianceContributions: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));

  for (let i = 0; i < m; i++) {
    const varI = Math.max(0, covariance[i]![i]!);
    stddev[i] = Math.sqrt(varI);
    if (varI > 0) {
      for (let j = 0; j < n; j++) {
        const contrib = J[i]![j]! * J[i]![j]! * Math.max(0, inputCov[j]?.[j] ?? 0);
        varianceContributions[i]![j] = contrib / varI;
      }
    }
  }

  return {
    mean: y0,
    covariance,
    stddev,
    jacobian: J,
    varianceContributions,
    numEvaluations,
    rigor: "approximate",
  };
}

/**
 * Second-Order Second-Moment (SOSM) uncertainty propagation through y = fn(x).
 * Includes Gaussian fourth-moment Hessian corrections for nonlinear maps:
 *
 *   mu_y[k]       ≈ f_k(mu_x) + 0.5 * tr(H_k * Sigma_x)
 *   Sigma_y[k, l] ≈ (J * Sigma_x * J^T)[k, l] + 0.5 * tr(H_k * Sigma_x * H_l * Sigma_x)
 */
export function propagateSOSM(
  fn: (x: number[]) => number[],
  inputMean: number[],
  inputCov: number[][],
  options?: SOSMOptions,
): SOSMResult {
  const fosm = propagateFOSM(fn, inputMean, inputCov, options);
  const m = fosm.mean.length;
  let numEvaluations = fosm.numEvaluations;

  let H: number[][][];
  if (options?.hessian) {
    H = options.hessian(inputMean);
  } else {
    const fd = computeFiniteDiffHessians(fn, inputMean, fosm.mean, options?.hessianStepSize ?? 1e-4);
    H = fd.H;
    numEvaluations += fd.evals;
  }

  // Precompute H_k * Sigma_x for each output k
  const HSigma: number[][][] = new Array(m);
  const meanCorrection = new Array<number>(m).fill(0);
  const mean = new Array<number>(m);
  for (let k = 0; k < m; k++) {
    HSigma[k] = matMul(H[k]!, inputCov);
    let tr = 0;
    for (let i = 0; i < inputMean.length; i++) {
      tr += HSigma[k]![i]![i]!;
    }
    meanCorrection[k] = 0.5 * tr;
    mean[k] = fosm.mean[k]! + meanCorrection[k]!;
  }

  const covarianceCorrection: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const covariance: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let k = 0; k < m; k++) {
    for (let l = k; l < m; l++) {
      const corr = 0.5 * traceProduct(HSigma[k]!, HSigma[l]!);
      covarianceCorrection[k]![l] = corr;
      covarianceCorrection[l]![k] = corr;
      const total = fosm.covariance[k]![l]! + corr;
      covariance[k]![l] = total;
      covariance[l]![k] = total;
    }
  }

  const stddev = new Array<number>(m);
  for (let k = 0; k < m; k++) {
    stddev[k] = Math.sqrt(Math.max(0, covariance[k]![k]!));
  }

  return {
    ...fosm,
    mean,
    covariance,
    stddev,
    meanCorrection,
    covarianceCorrection,
    hessians: H,
    numEvaluations,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Arena Trajectory FOSM Propagation
// ─────────────────────────────────────────────────────────────────────

export interface ArenaFOSMOptions {
  /** Base simulation options forwarded to simulateArena(). */
  simulateOptions?: ArenaSimulateOptions | undefined;
  /** Optional parameter correlation matrix (nParams x nParams). */
  correlations?: number[][] | undefined;
  /** Relative finite-difference step size for parameter perturbations (default: 1e-4). */
  stepSize?: number | undefined;
  /** Use forward differences (p+1 sims) instead of central differences (2p+1 sims). */
  forwardDifference?: boolean | undefined;
  /** Confidence level for Gaussian +/- z*sigma intervals (default: 0.95). */
  confidenceLevel?: number | undefined;
  /** Store full state covariance matrix at every time step (default: false). */
  includeFullCovariance?: boolean | undefined;
}

export interface ArenaFOSMResult {
  t: number[];
  states: string[];
  /** Nominal / first-order mean trajectory: [timeIdx][stateIdx]. */
  mean: number[][];
  /** First-order variance trajectory: [timeIdx][stateIdx]. */
  variance: number[][];
  /** First-order standard deviation trajectory: [timeIdx][stateIdx]. */
  stddev: number[][];
  /** Lower Gaussian confidence bound: [timeIdx][stateIdx]. */
  ciLo: number[][];
  /** Upper Gaussian confidence bound: [timeIdx][stateIdx]. */
  ciHi: number[][];
  /** Optional full state covariance matrices: [timeIdx][state_i][state_j]. */
  covariance?: number[][][] | undefined;
  /** Per-state, per-parameter variance contribution fractions over time. */
  varianceContributions: Map<string, Map<string, number[]>>;
  numEvaluations: number;
  rigor: AnalyticalUqRigor;
}

function mergeOverrides(base: Map<string, number> | undefined, updates: Map<string, number>): Map<string, number> {
  const merged = new Map<string, number>();
  if (base) {
    for (const [k, v] of base) merged.set(k, v);
  }
  for (const [k, v] of updates) merged.set(k, v);
  return merged;
}

/**
 * Propagate parameter uncertainty through a DAE arena trajectory using FOSM.
 *
 * Performs 2p + 1 (central) or p + 1 (forward) simulations of `simulateArena`
 * and computes time-varying mean, variance, standard deviation, confidence bands,
 * and per-parameter variance attribution for every state.
 */
export function propagateFOSMArena(
  arena: DAEBuilder,
  randomVars: RandomVariable[],
  options?: ArenaFOSMOptions,
): ArenaFOSMResult {
  const p = randomVars.length;
  const { mean: pMean, covariance: pCov } = buildInputMoments(randomVars, options?.correlations);
  const stepSize = options?.stepSize ?? 1e-4;
  const forward = options?.forwardDifference ?? false;
  const conf = options?.confidenceLevel ?? 0.95;
  const z = normalQuantile((1 + conf) / 2);
  const baseOverrides = options?.simulateOptions?.parameterOverrides;

  const nominalParams = new Map<string, number>();
  for (let j = 0; j < p; j++) {
    nominalParams.set(randomVars[j]!.name, pMean[j]!);
  }

  const runSim = (params: Map<string, number>): ArenaSimulationResult =>
    simulateArena(arena, {
      ...options?.simulateOptions,
      parameterOverrides: mergeOverrides(baseOverrides, params),
    });

  const baseRes = runSim(nominalParams);
  let numEvaluations = 1;

  const nT = baseRes.t.length;
  const nS = baseRes.states.length;

  // Compute sensitivity trajectories dY/dp_j at every time point: sens[j][tIdx][sIdx]
  const sens: number[][][] = [];
  for (let j = 0; j < p; j++) {
    const rv = randomVars[j]!;
    const v0 = pMean[j]!;
    const h = stepSize * Math.max(1, Math.abs(v0));

    const plusMap = new Map(nominalParams);
    plusMap.set(rv.name, v0 + h);
    const resPlus = runSim(plusMap);
    numEvaluations++;

    let resMinus: ArenaSimulationResult | undefined;
    if (!forward) {
      const minusMap = new Map(nominalParams);
      minusMap.set(rv.name, v0 - h);
      resMinus = runSim(minusMap);
      numEvaluations++;
    }

    const trajJ: number[][] = Array.from({ length: nT }, () => new Array<number>(nS).fill(0));
    for (let ti = 0; ti < nT; ti++) {
      const tTarget = baseRes.t[ti]!;
      const yPlus = interpolateTrajectoryAt(resPlus, tTarget, nS);
      if (forward || !resMinus) {
        for (let si = 0; si < nS; si++) {
          trajJ[ti]![si] = (yPlus[si]! - (baseRes.y[ti]?.[si] ?? 0)) / h;
        }
      } else {
        const yMinus = interpolateTrajectoryAt(resMinus, tTarget, nS);
        for (let si = 0; si < nS; si++) {
          trajJ[ti]![si] = (yPlus[si]! - yMinus[si]!) / (2 * h);
        }
      }
    }
    sens.push(trajJ);
  }

  const mean: number[][] = Array.from({ length: nT }, (_, ti) => baseRes.y[ti]!.slice());
  const variance: number[][] = Array.from({ length: nT }, () => new Array<number>(nS).fill(0));
  const stddev: number[][] = Array.from({ length: nT }, () => new Array<number>(nS).fill(0));
  const ciLo: number[][] = Array.from({ length: nT }, () => new Array<number>(nS).fill(0));
  const ciHi: number[][] = Array.from({ length: nT }, () => new Array<number>(nS).fill(0));
  const fullCov: number[][][] | undefined = options?.includeFullCovariance ? new Array(nT) : undefined;

  const varianceContributions = new Map<string, Map<string, number[]>>();
  for (let si = 0; si < nS; si++) {
    const stateName = baseRes.states[si] ?? `x${si}`;
    const pMap = new Map<string, number[]>();
    for (let j = 0; j < p; j++) {
      pMap.set(randomVars[j]!.name, new Array<number>(nT).fill(0));
    }
    varianceContributions.set(stateName, pMap);
  }

  for (let ti = 0; ti < nT; ti++) {
    // Build J_t (nS x p)
    const Jt: number[][] = Array.from({ length: nS }, (_, si) =>
      Array.from({ length: p }, (__, j) => sens[j]![ti]![si]!),
    );
    const JtSigma = matMul(Jt, pCov);
    const covT = symmetrizeMatrix(matMulTransposeRight(JtSigma, Jt));
    if (fullCov) {
      fullCov[ti] = covT;
    }

    for (let si = 0; si < nS; si++) {
      const v = Math.max(0, covT[si]![si]!);
      const sd = Math.sqrt(v);
      const mu = mean[ti]![si]!;
      variance[ti]![si] = v;
      stddev[ti]![si] = sd;
      ciLo[ti]![si] = mu - z * sd;
      ciHi[ti]![si] = mu + z * sd;

      const stateName = baseRes.states[si] ?? `x${si}`;
      const pMap = varianceContributions.get(stateName)!;
      if (v > 0) {
        for (let j = 0; j < p; j++) {
          const jVal = Jt[si]![j]!;
          const frac = (jVal * jVal * Math.max(0, pCov[j]![j]!)) / v;
          pMap.get(randomVars[j]!.name)![ti] = frac;
        }
      }
    }
  }

  return {
    t: baseRes.t.slice(),
    states: baseRes.states.slice(),
    mean,
    variance,
    stddev,
    ciLo,
    ciHi,
    ...(fullCov ? { covariance: fullCov } : {}),
    varianceContributions,
    numEvaluations,
    rigor: "approximate",
  };
}

/** Linear interpolation of a simulation trajectory at an arbitrary target time t. */
export function interpolateTrajectoryAt(
  res: { t: number[]; y: number[][] },
  tTarget: number,
  numStates: number,
): number[] {
  const n = res.t.length;
  if (n === 0) return new Array<number>(numStates).fill(0);
  if (tTarget <= res.t[0]!) return res.y[0]!.slice(0, numStates);
  if (tTarget >= res.t[n - 1]!) return res.y[n - 1]!.slice(0, numStates);

  // Binary search for bracketing interval [lo, hi]
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (res.t[mid]! <= tTarget) lo = mid;
    else hi = mid;
  }

  const t0 = res.t[lo]!;
  const t1 = res.t[hi]!;
  const alpha = t1 > t0 ? (tTarget - t0) / (t1 - t0) : 0;
  const out = new Array<number>(numStates);
  for (let s = 0; s < numStates; s++) {
    const y0 = res.y[lo]?.[s] ?? 0;
    const y1 = res.y[hi]?.[s] ?? 0;
    out[s] = y0 + alpha * (y1 - y0);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Continuous-Time Covariance ODE Propagation (Lyapunov / EKF)
// ─────────────────────────────────────────────────────────────────────

export interface CovarianceODEProblem {
  /** Drift vector field f(t, x) -> dx/dt. */
  drift: (t: number, x: number[]) => number[];
  /** Optional analytical state Jacobian df/dx at (t, x). Uses central FD if omitted. */
  jacobian?: ((t: number, x: number[]) => number[][]) | undefined;
  /** Initial state mean mu(t0). */
  initialMean: number[];
  /** Initial state covariance P(t0) (n x n symmetric PSD). */
  initialCovariance: number[][];
  /**
   * Optional continuous-time process noise spectral density Q (q x q),
   * either constant or time-varying Q(t). Default: zero (deterministic ODE with uncertain IC).
   */
  processNoiseQ?: number[][] | ((t: number) => number[][]) | undefined;
  /**
   * Optional noise input matrix G (n x q) in dx = f(t,x)dt + G(t) dW_t.
   * Defaults to the identity matrix I_n when processNoiseQ is provided.
   */
  noiseMatrixG?: number[][] | ((t: number, x: number[]) => number[][]) | undefined;
}

export interface CovarianceODEOptions {
  /** Start time (default: 0). */
  t0?: number | undefined;
  /** End time (default: 1). */
  tEnd?: number | undefined;
  /** Fixed RK4 integration step size (default: (tEnd - t0) / 200). */
  dt?: number | undefined;
  /** Finite-difference step size when analytical Jacobian is omitted (default: 1e-6). */
  jacobianStepSize?: number | undefined;
}

export interface CovarianceODEResult {
  t: number[];
  /** State mean trajectory: [timeIdx][stateIdx]. */
  mean: number[][];
  /** State covariance trajectory: [timeIdx][i][j]. */
  covariance: number[][][];
  /** State standard deviation trajectory: [timeIdx][stateIdx]. */
  stddev: number[][];
  rigor: AnalyticalUqRigor;
}

/**
 * Continuous-time mean and covariance propagation via coupled RK4 integration of:
 *
 *   d(mu)/dt = f(t, mu)
 *   dP/dt    = A(t, mu) P + P A(t, mu)^T + G(t, mu) Q(t) G(t, mu)^T
 *
 * Exact for linear time-varying (LTV) SDEs / Ornstein–Uhlenbeck processes;
 * first-order (extended Kalman) approximation for nonlinear dynamics.
 */
export function propagateCovarianceODE(
  problem: CovarianceODEProblem,
  options?: CovarianceODEOptions,
): CovarianceODEResult {
  const n = problem.initialMean.length;
  const t0 = options?.t0 ?? 0;
  const tEnd = options?.tEnd ?? 1;
  const defaultSteps = 200;
  const dtRequested = options?.dt ?? (tEnd - t0) / defaultSteps;
  const numSteps = Math.max(1, Math.ceil((tEnd - t0) / dtRequested));
  const dt = (tEnd - t0) / numSteps;
  const jacStep = options?.jacobianStepSize ?? 1e-6;

  const evalJacobian = (t: number, x: number[]): number[][] => {
    if (problem.jacobian) {
      return problem.jacobian(t, x);
    }
    const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let j = 0; j < n; j++) {
      const h = jacStep * Math.max(1, Math.abs(x[j]!));
      const xp = x.slice();
      xp[j] = x[j]! + h;
      const xm = x.slice();
      xm[j] = x[j]! - h;
      const fp = problem.drift(t, xp);
      const fm = problem.drift(t, xm);
      for (let i = 0; i < n; i++) {
        A[i]![j] = (fp[i]! - fm[i]!) / (2 * h);
      }
    }
    return A;
  };

  const evalProcessNoiseTerm = (t: number, x: number[]): number[][] | null => {
    if (!problem.processNoiseQ) return null;
    const Q = typeof problem.processNoiseQ === "function" ? problem.processNoiseQ(t) : problem.processNoiseQ;
    if (!problem.noiseMatrixG) return Q;
    const G = typeof problem.noiseMatrixG === "function" ? problem.noiseMatrixG(t, x) : problem.noiseMatrixG;
    const GQ = matMul(G, Q);
    return matMulTransposeRight(GQ, G);
  };

  const evalCovDeriv = (t: number, x: number[], P: number[][]): number[][] => {
    const A = evalJacobian(t, x);
    const AP = matMul(A, P);
    const GQG = evalProcessNoiseTerm(t, x);
    const dP: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        // (A P + P A^T)_ij = (A P)_ij + (A P)_ji since P is symmetric
        dP[i]![j] = AP[i]![j]! + AP[j]![i]! + (GQG ? (GQG[i]?.[j] ?? 0) : 0);
      }
    }
    return dP;
  };

  const addVec = (a: number[], b: number[], scale: number): number[] => a.map((v, i) => v + scale * b[i]!);

  const addMat = (A: number[][], B: number[][], scale: number): number[][] =>
    A.map((row, i) => row.map((v, j) => v + scale * B[i]![j]!));

  const tArr: number[] = new Array(numSteps + 1);
  const meanArr: number[][] = new Array(numSteps + 1);
  const covArr: number[][][] = new Array(numSteps + 1);
  const stdArr: number[][] = new Array(numSteps + 1);

  let t = t0;
  let mu = problem.initialMean.slice();
  let P = symmetrizeMatrix(problem.initialCovariance);

  tArr[0] = t;
  meanArr[0] = mu.slice();
  covArr[0] = P.map((r) => r.slice());
  stdArr[0] = P.map((r, i) => Math.sqrt(Math.max(0, r[i]!)));

  for (let step = 0; step < numSteps; step++) {
    // Stage 1
    const k1x = problem.drift(t, mu);
    const k1P = evalCovDeriv(t, mu, P);

    // Stage 2
    const t2 = t + 0.5 * dt;
    const x2 = addVec(mu, k1x, 0.5 * dt);
    const P2 = addMat(P, k1P, 0.5 * dt);
    const k2x = problem.drift(t2, x2);
    const k2P = evalCovDeriv(t2, x2, P2);

    // Stage 3
    const x3 = addVec(mu, k2x, 0.5 * dt);
    const P3 = addMat(P, k2P, 0.5 * dt);
    const k3x = problem.drift(t2, x3);
    const k3P = evalCovDeriv(t2, x3, P3);

    // Stage 4
    const t4 = t + dt;
    const x4 = addVec(mu, k3x, dt);
    const P4 = addMat(P, k3P, dt);
    const k4x = problem.drift(t4, x4);
    const k4P = evalCovDeriv(t4, x4, P4);

    // Combine
    for (let i = 0; i < n; i++) {
      mu[i]! += (dt / 6) * (k1x[i]! + 2 * k2x[i]! + 2 * k3x[i]! + k4x[i]!);
    }
    const nextP: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        nextP[i]![j] = P[i]![j]! + (dt / 6) * (k1P[i]![j]! + 2 * k2P[i]![j]! + 2 * k3P[i]![j]! + k4P[i]![j]!);
      }
    }
    P = symmetrizeMatrix(nextP);
    t = t0 + (step + 1) * dt;

    tArr[step + 1] = t;
    meanArr[step + 1] = mu.slice();
    covArr[step + 1] = P.map((r) => r.slice());
    stdArr[step + 1] = P.map((r, i) => Math.sqrt(Math.max(0, r[i]!)));
  }

  return {
    t: tArr,
    mean: meanArr,
    covariance: covArr,
    stddev: stdArr,
    rigor: "approximate",
  };
}
