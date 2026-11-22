// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Non-Intrusive Generalized Polynomial Chaos Expansion (gPCE).
 *
 * Expands a stochastic model response in a multivariate orthonormal polynomial basis
 * matched to the input distributions (Hermite for Gaussian/LogNormal, Legendre via
 * isoprobabilistic CDF mapping for Uniform/Beta/Triangular/Empirical).
 *
 * Supports:
 *   - Regression fitting (OLS / Ridge on Sobol' quasi-random samples)
 *   - Tensor-product Gauss–Hermite / Gauss–Legendre quadrature projection
 *   - Analytical mean, variance, and Sudret (2008) first-order & total-order Sobol' indices
 *   - Leave-one-out cross-validation Q^2_LOO via hat-matrix leverage
 *   - Fast surrogate prediction at arbitrary parameter points
 */

import { DAEBuilder } from "@modelscript/runtime";
import { simulateArena, type ArenaSimulateOptions } from "../core/simulate-arena.js";
import { interpolateTrajectoryAt, type AnalyticalUqRigor } from "./fosm.js";
import { SobolSequence, inverseCDF, normalQuantile, type Distribution, type RandomVariable } from "./monte-carlo.js";

// ─────────────────────────────────────────────────────────────────────
// Univariate Orthonormal Polynomial Families
// ─────────────────────────────────────────────────────────────────────

export type BasisFamily = "hermite" | "legendre";

function basisFamilyForDistribution(dist: Distribution): BasisFamily {
  if (dist.type === "gaussian" || dist.type === "lognormal") {
    return "hermite";
  }
  return "legendre";
}

/** Map standard germ variable xi to physical parameter value x. */
function germToPhysical(dist: Distribution, xi: number): number {
  switch (dist.type) {
    case "gaussian":
      return dist.mean + dist.stddev * xi;
    case "lognormal":
      return Math.exp(dist.mu + dist.sigma * xi);
    case "uniform":
      return 0.5 * (dist.lo + dist.hi) + 0.5 * (dist.hi - dist.lo) * xi;
    default: {
      // Legendre germ xi in [-1, 1] -> u = (xi + 1) / 2 in (0, 1) -> inverseCDF
      const u = Math.min(1 - 1e-12, Math.max(1e-12, 0.5 * (xi + 1)));
      return inverseCDF(dist, u);
    }
  }
}

/** Map physical parameter value x back to standard germ variable xi. */
function physicalToGerm(dist: Distribution, x: number): number {
  switch (dist.type) {
    case "gaussian":
      return dist.stddev > 0 ? (x - dist.mean) / dist.stddev : 0;
    case "lognormal":
      return dist.sigma > 0 ? (Math.log(Math.max(1e-300, x)) - dist.mu) / dist.sigma : 0;
    case "uniform": {
      const span = dist.hi - dist.lo;
      return span > 0 ? (2 * (x - dist.lo)) / span - 1 : 0;
    }
    case "triangular": {
      const { lo, mode, hi } = dist;
      let u: number;
      if (x <= lo) u = 0;
      else if (x >= hi) u = 1;
      else if (x <= mode) u = ((x - lo) * (x - lo)) / ((hi - lo) * (mode - lo));
      else u = 1 - ((hi - x) * (hi - x)) / ((hi - lo) * (hi - mode));
      return 2 * u - 1;
    }
    default: {
      // Binary search on inverseCDF for beta/empirical
      let lo = 1e-9;
      let hi = 1 - 1e-9;
      for (let iter = 0; iter < 40; iter++) {
        const mid = 0.5 * (lo + hi);
        if (inverseCDF(dist, mid) < x) lo = mid;
        else hi = mid;
      }
      return 2 * (0.5 * (lo + hi)) - 1;
    }
  }
}

/**
 * Evaluate normalized univariate orthonormal polynomials psi_0(xi)..psi_p(xi):
 * - Hermite (probabilists'): He_{k+1} = xi*He_k - k*He_{k-1}, normalized by 1/sqrt(k!)
 * - Legendre (on U(-1,1)): (k+1)*P_{k+1} = (2k+1)*xi*P_k - k*P_{k-1}, normalized by sqrt(2k+1)
 */
export function evalOrthonormalPoly1D(family: BasisFamily, maxDegree: number, xi: number): number[] {
  const out = new Array<number>(maxDegree + 1);
  out[0] = 1.0;
  if (maxDegree === 0) return out;

  if (family === "hermite") {
    // Recurrence directly in normalized form:
    //   psi_0 = 1
    //   psi_1 = xi
    //   psi_{k+1} = (xi * psi_k - sqrt(k) * psi_{k-1}) / sqrt(k + 1)
    out[1] = xi;
    for (let k = 1; k < maxDegree; k++) {
      out[k + 1] = (xi * out[k]! - Math.sqrt(k) * out[k - 1]!) / Math.sqrt(k + 1);
    }
  } else {
    // Legendre raw P_k, then multiply by sqrt(2k + 1)
    const raw = new Array<number>(maxDegree + 1);
    raw[0] = 1.0;
    raw[1] = xi;
    for (let k = 1; k < maxDegree; k++) {
      raw[k + 1] = ((2 * k + 1) * xi * raw[k]! - k * raw[k - 1]!) / (k + 1);
    }
    for (let k = 0; k <= maxDegree; k++) {
      out[k] = raw[k]! * Math.sqrt(2 * k + 1);
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────
// 1D Gauss Quadrature Rules (Golub–Welsch via Symmetric Jacobi Matrix)
// ─────────────────────────────────────────────────────────────────────

/** Symmetric Jacobi eigensolver for small n x n matrices (returns eigenvalues & eigenvectors). */
export function jacobiEigenSymmetric(A: number[][], maxSweeps = 100): { values: number[]; vectors: number[][] } {
  const n = A.length;
  const M = A.map((r) => r.slice());
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let maxOff = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const val = Math.abs(M[p]![q]!);
        if (val > maxOff) maxOff = val;
      }
    }
    if (maxOff < 1e-14) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = M[p]![q]!;
        if (Math.abs(apq) < 1e-15) continue;
        const app = M[p]![p]!;
        const aqq = M[q]![q]!;
        const tau = (aqq - app) / (2 * apq);
        const t = tau >= 0 ? 1 / (tau + Math.sqrt(1 + tau * tau)) : -1 / (-tau + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;

        M[p]![p] = app - t * apq;
        M[q]![q] = aqq + t * apq;
        M[p]![q] = 0;
        M[q]![p] = 0;

        for (let r = 0; r < n; r++) {
          if (r !== p && r !== q) {
            const arp = M[r]![p]!;
            const arq = M[r]![q]!;
            M[r]![p] = c * arp - s * arq;
            M[p]![r] = M[r]![p]!;
            M[r]![q] = s * arp + c * arq;
            M[q]![r] = M[r]![q]!;
          }
          const vrp = V[r]![p]!;
          const vrq = V[r]![q]!;
          V[r]![p] = c * vrp - s * vrq;
          V[r]![q] = s * vrp + c * vrq;
        }
      }
    }
  }

  const values = Array.from({ length: n }, (_, i) => M[i]![i]!);
  return { values, vectors: V };
}

/**
 * 1D Gauss quadrature nodes and probability-normalized weights (sum to 1)
 * for Hermite (N(0,1)) or Legendre (U(-1,1)) using Golub–Welsch.
 */
export function gaussQuadrature1D(family: BasisFamily, numPoints: number): { nodes: number[]; weights: number[] } {
  const n = Math.max(1, numPoints);
  if (n === 1) return { nodes: [0], weights: [1] };

  const J: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n - 1; i++) {
    const beta = family === "hermite" ? Math.sqrt(i + 1) : (i + 1) / Math.sqrt((2 * (i + 1) - 1) * (2 * (i + 1) + 1));
    J[i]![i + 1] = beta;
    J[i + 1]![i] = beta;
  }

  const { values, vectors } = jacobiEigenSymmetric(J);
  const pairs = values.map((node, i) => ({
    node,
    weight: vectors[0]![i]! * vectors[0]![i]!,
  }));
  pairs.sort((a, b) => a.node - b.node);

  return {
    nodes: pairs.map((p) => p.node),
    weights: pairs.map((p) => p.weight),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Multivariate Basis & Linear Solver
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate multivariate multi-indices alpha in N^d with q-norm ||alpha||_q <= maxDegree.
 * qNorm = 1.0 gives the standard total-degree basis; qNorm in (0, 1) (e.g. 0.7) gives
 * Blatman & Sudret (2011) hyperbolic truncation that prunes high-order interactions.
 */
export function generateTotalDegreeMultiIndices(dim: number, maxDegree: number, qNorm = 1.0): number[][] {
  const result: number[][] = [];
  const current = new Array<number>(dim).fill(0);
  const q = Math.max(0.1, Math.min(1.0, qNorm));
  const limitQ = Math.pow(maxDegree, q) + 1e-12;

  const recurse = (axis: number, sumQ: number, totalDeg: number): void => {
    if (axis === dim) {
      result.push(current.slice());
      return;
    }
    for (let deg = 0; deg <= maxDegree - totalDeg; deg++) {
      const nextSumQ = deg === 0 ? sumQ : sumQ + Math.pow(deg, q);
      if (nextSumQ > limitQ) break;
      current[axis] = deg;
      recurse(axis + 1, nextSumQ, totalDeg + deg);
    }
  };

  if (dim === 0) {
    result.push([]);
  } else {
    recurse(0, 0, 0);
    // Sort by increasing total degree so index 0 is always [0, ..., 0]
    result.sort((a, b) => {
      const sa = a.reduce((acc, v) => acc + v, 0);
      const sb = b.reduce((acc, v) => acc + v, 0);
      return sa - sb;
    });
  }

  return result;
}

/** Solve symmetric positive-definite linear system A x = b via Cholesky factorization. */
function solveSPD(A: number[][], b: number[]): number[] {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i]![k]! * L[j]![k]!;
      if (i === j) {
        const diag = A[i]![i]! - sum;
        L[i]![j] = Math.sqrt(Math.max(diag, 1e-15));
      } else {
        L[i]![j] = (A[i]![j]! - sum) / L[j]![j]!;
      }
    }
  }

  // Forward substitution: L y = b
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    for (let k = 0; k < i; k++) sum -= L[i]![k]! * y[k]!;
    y[i] = sum / L[i]![i]!;
  }

  // Backward substitution: L^T x = y
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]!;
    for (let k = i + 1; k < n; k++) sum -= L[k]![i]! * x[k]!;
    x[i] = sum / L[i]![i]!;
  }

  return x;
}

/** Invert symmetric positive-definite matrix via Cholesky (used for LOO hat matrix). */
function invertSPD(A: number[][]): number[][] {
  const n = A.length;
  const inv: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let col = 0; col < n; col++) {
    const e = new Array<number>(n).fill(0);
    e[col] = 1;
    const sol = solveSPD(A, e);
    for (let row = 0; row < n; row++) inv[row]![col] = sol[row]!;
  }
  return inv;
}

// ─────────────────────────────────────────────────────────────────────
// PCE Public Interfaces & Fitting
// ─────────────────────────────────────────────────────────────────────

export type PCEFitMethod = "regression" | "quadrature";

export interface PCEOptions {
  /** Maximum total polynomial degree p (default: 3). */
  degree?: number | undefined;
  /** Hyperbolic truncation norm q in (0, 1] (default: 1.0 = full total-degree; e.g. 0.7 for sparse high-D). */
  qNorm?: number | undefined;
  /** Enable Orthogonal Matching Pursuit (OMP) sparse regression for high-dimensional problems (default: false). */
  sparse?: boolean | undefined;
  /** Maximum active basis terms when `sparse: true` (default: min(numBasis, floor(N / 2))). */
  maxActiveTerms?: number | undefined;
  /** Fitting method: "regression" (Sobol OLS/Ridge) or "quadrature" (Gauss tensor product). Default: "regression". */
  method?: PCEFitMethod | undefined;
  /** Number of Sobol samples for regression (default: max(2 * numBasis, numBasis + 16)). */
  numSamples?: number | undefined;
  /** Number of 1D quadrature points per dimension for quadrature mode (default: degree + 1). */
  quadraturePoints?: number | undefined;
  /** Ridge regularization parameter lambda for regression stability (default: 1e-12). */
  ridgeLambda?: number | undefined;
  /** Initial Sobol sequence burn-in skip (default: 32). */
  sobolSkip?: number | undefined;
}

export interface PCESobolEntry {
  name: string;
  firstOrder: number;
  totalOrder: number;
  interaction: number;
}

export interface PCEOutputExpansion {
  outputName: string;
  /** Orthonormal PCE coefficients c_alpha aligned with multiIndices. */
  coefficients: number[];
  /** Analytical PCE mean: c_0. */
  mean: number;
  /** Analytical PCE variance: sum_{alpha != 0} c_alpha^2. */
  variance: number;
  /** Analytical PCE standard deviation. */
  stddev: number;
  /** Exact Sudret (2008) analytical Sobol' sensitivity indices from PCE coefficients. */
  sobolIndices: PCESobolEntry[];
  /** Parameter names ranked descending by totalOrder index. */
  rankedByTotalOrder: string[];
  /** Leave-one-out cross-validation score Q^2_LOO (available in regression mode). */
  q2Loo?: number | undefined;
  /** Evaluate the PCE surrogate at a physical parameter map. */
  predict: (sample: Map<string, number>) => number;
}

export interface PCEResult {
  outputs: Map<string, PCEOutputExpansion>;
  degree: number;
  method: PCEFitMethod;
  multiIndices: number[][];
  basisFamilies: BasisFamily[];
  numBasis: number;
  numEvaluations: number;
  rigor: AnalyticalUqRigor;
}

export interface ArenaPCEOptions extends PCEOptions {
  /** Base simulation options forwarded to simulateArena(). */
  simulateOptions?: ArenaSimulateOptions | undefined;
  /** Target time for scalar output extraction (default: final simulation time). */
  snapshotTime?: number | undefined;
  /** Restrict fitting to a subset of state names (default: all states). */
  outputStates?: string[] | undefined;
}

function evalBasisRow(xi: number[], families: BasisFamily[], maxDegree: number, multiIndices: number[][]): number[] {
  const d = xi.length;
  const poly1D: number[][] = new Array(d);
  for (let j = 0; j < d; j++) {
    poly1D[j] = evalOrthonormalPoly1D(families[j]!, maxDegree, xi[j]!);
  }
  const m = multiIndices.length;
  const row = new Array<number>(m);
  for (let k = 0; k < m; k++) {
    const alpha = multiIndices[k]!;
    let prod = 1.0;
    for (let j = 0; j < d; j++) {
      prod *= poly1D[j]![alpha[j]!]!;
    }
    row[k] = prod;
  }
  return row;
}

function computeAnalyticalPCESobol(
  coefficients: number[],
  multiIndices: number[][],
  paramNames: string[],
): { mean: number; variance: number; sobolIndices: PCESobolEntry[]; rankedByTotalOrder: string[] } {
  const mean = coefficients[0] ?? 0;
  let variance = 0;
  for (let k = 1; k < coefficients.length; k++) {
    const c = coefficients[k]!;
    variance += c * c;
  }

  const d = paramNames.length;
  const s1Num = new Array<number>(d).fill(0);
  const sTNum = new Array<number>(d).fill(0);

  for (let k = 1; k < coefficients.length; k++) {
    const c2 = coefficients[k]! * coefficients[k]!;
    const alpha = multiIndices[k]!;
    let activeCount = 0;
    let lastActive = -1;
    for (let j = 0; j < d; j++) {
      if (alpha[j]! > 0) {
        activeCount++;
        lastActive = j;
        sTNum[j]! += c2;
      }
    }
    if (activeCount === 1 && lastActive >= 0) {
      s1Num[lastActive]! += c2;
    }
  }

  const sobolIndices: PCESobolEntry[] = paramNames.map((name, j) => {
    const firstOrder = variance > 1e-30 ? s1Num[j]! / variance : 0;
    const totalOrder = variance > 1e-30 ? sTNum[j]! / variance : 0;
    return {
      name,
      firstOrder,
      totalOrder,
      interaction: Math.max(0, totalOrder - firstOrder),
    };
  });

  const rankedByTotalOrder = [...sobolIndices].sort((a, b) => b.totalOrder - a.totalOrder).map((e) => e.name);

  return { mean, variance, sobolIndices, rankedByTotalOrder };
}

/** Orthogonal Matching Pursuit (OMP) sparse PCE solver on design matrix Psi (N x M) and response y (N). */
function fitSparseOMP(
  Psi: number[][],
  y: number[],
  maxTerms: number,
  ridgeLambda: number,
): { coeffs: number[]; activeIndices: number[] } {
  const N = Psi.length;
  const M = Psi[0]?.length ?? 0;
  const active: number[] = [0]; // Always include constant term alpha = [0..0]
  const activeSet = new Set<number>([0]);

  // Precompute column norms
  const colNorms = new Array<number>(M).fill(0);
  for (let j = 0; j < M; j++) {
    let s = 0;
    for (let i = 0; i < N; i++) s += Psi[i]![j]! * Psi[i]![j]!;
    colNorms[j] = Math.sqrt(Math.max(s, 1e-30));
  }

  let yNormSq = 0;
  for (let i = 0; i < N; i++) yNormSq += y[i]! * y[i]!;
  const stopResSq = 1e-12 * Math.max(1, yNormSq);

  const solveActive = (): { subCoeffs: number[]; residual: number[]; resSq: number } => {
    const k = active.length;
    const G: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const rhs = new Array<number>(k).fill(0);
    for (let i = 0; i < N; i++) {
      const row = Psi[i]!;
      const yi = y[i]!;
      for (let a = 0; a < k; a++) {
        const va = row[active[a]!]!;
        rhs[a]! += va * yi;
        for (let b = a; b < k; b++) {
          G[a]![b]! += va * row[active[b]!]!;
        }
      }
    }
    for (let a = 0; a < k; a++) {
      G[a]![a]! += ridgeLambda;
      for (let b = a + 1; b < k; b++) G[b]![a] = G[a]![b]!;
    }
    const subCoeffs = solveSPD(G, rhs);
    const residual = new Array<number>(N);
    let resSq = 0;
    for (let i = 0; i < N; i++) {
      const row = Psi[i]!;
      let pred = 0;
      for (let a = 0; a < k; a++) pred += row[active[a]!]! * subCoeffs[a]!;
      const r = y[i]! - pred;
      residual[i] = r;
      resSq += r * r;
    }
    return { subCoeffs, residual, resSq };
  };

  let current = solveActive();
  const limit = Math.min(M, Math.max(1, maxTerms));

  while (active.length < limit && current.resSq > stopResSq) {
    let bestJ = -1;
    let bestCorr = -1;
    for (let j = 0; j < M; j++) {
      if (activeSet.has(j)) continue;
      let dot = 0;
      for (let i = 0; i < N; i++) dot += Psi[i]![j]! * current.residual[i]!;
      const score = Math.abs(dot) / colNorms[j]!;
      if (score > bestCorr) {
        bestCorr = score;
        bestJ = j;
      }
    }
    if (bestJ < 0 || bestCorr < 1e-12) break;
    active.push(bestJ);
    activeSet.add(bestJ);
    current = solveActive();
  }

  const coeffs = new Array<number>(M).fill(0);
  for (let a = 0; a < active.length; a++) {
    coeffs[active[a]!] = current.subCoeffs[a]!;
  }
  return { coeffs, activeIndices: active };
}

/**
 * Fit a non-intrusive Generalized Polynomial Chaos Expansion (gPCE) to a scalar
 * or multi-output model using either Sobol' regression (dense or sparse OMP)
 * or Gauss quadrature projection.
 */
export function fitPCE(
  fn: (sample: Map<string, number>) => number | Record<string, number>,
  randomVars: RandomVariable[],
  options?: PCEOptions,
): PCEResult {
  const d = randomVars.length;
  const degree = Math.max(1, options?.degree ?? 3);
  const qNorm = options?.qNorm ?? 1.0;
  const sparse = options?.sparse ?? false;
  const method: PCEFitMethod = options?.method ?? "regression";
  const ridgeLambda = options?.ridgeLambda ?? 1e-12;
  const families = randomVars.map((rv) => basisFamilyForDistribution(rv.distribution));
  const multiIndices = generateTotalDegreeMultiIndices(d, degree, qNorm);
  const numBasis = multiIndices.length;
  const paramNames = randomVars.map((rv) => rv.name);

  const normalizeOutput = (raw: number | Record<string, number>): Record<string, number> =>
    typeof raw === "number" ? { y: raw } : raw;

  // Build design points in germ space (xiPoints) and optional quadrature weights
  const xiPoints: number[][] = [];
  let quadWeights: number[] | null = null;

  if (method === "quadrature") {
    const qPts = Math.max(degree + 1, options?.quadraturePoints ?? degree + 1);
    const rules1D = families.map((fam) => gaussQuadrature1D(fam, qPts));
    quadWeights = [];

    const totalQuad = Math.pow(qPts, d);
    for (let idx = 0; idx < totalQuad; idx++) {
      let rem = idx;
      const pt = new Array<number>(d);
      let w = 1.0;
      for (let j = d - 1; j >= 0; j--) {
        const k = rem % qPts;
        rem = Math.floor(rem / qPts);
        pt[j] = rules1D[j]!.nodes[k]!;
        w *= rules1D[j]!.weights[k]!;
      }
      xiPoints.push(pt);
      quadWeights.push(w);
    }
  } else {
    const defaultN = sparse ? Math.max(24, Math.min(numBasis, 4 * d * degree)) : Math.max(2 * numBasis, numBasis + 16);
    const N = sparse
      ? Math.max(4, options?.numSamples ?? defaultN)
      : Math.max(numBasis + 1, options?.numSamples ?? defaultN);
    const sobol = new SobolSequence(d);
    sobol.skip(options?.sobolSkip ?? 32);
    for (let i = 0; i < N; i++) {
      const uPt = sobol.next();
      const xi = new Array<number>(d);
      for (let j = 0; j < d; j++) {
        const u = Math.min(1 - 1e-12, Math.max(1e-12, uPt[j] ?? 0.5));
        xi[j] = families[j] === "hermite" ? normalQuantile(u) : 2 * u - 1;
      }
      xiPoints.push(xi);
    }
  }

  const N = xiPoints.length;
  const designMatrix: number[][] = new Array(N);
  const rawOutputs: Record<string, number>[] = new Array(N);

  for (let i = 0; i < N; i++) {
    const xi = xiPoints[i]!;
    designMatrix[i] = evalBasisRow(xi, families, degree, multiIndices);
    const sample = new Map<string, number>();
    for (let j = 0; j < d; j++) {
      sample.set(paramNames[j]!, germToPhysical(randomVars[j]!.distribution, xi[j]!));
    }
    rawOutputs[i] = normalizeOutput(fn(sample));
  }

  const outputNames = Object.keys(rawOutputs[0] ?? {});
  const outputs = new Map<string, PCEOutputExpansion>();

  // Precompute normal equations matrix Psi^T Psi + lambda*I and inverse (for dense regression)
  let gramMatrix: number[][] | null = null;
  let gramInv: number[][] | null = null;
  let leverageH: number[] | null = null;

  if (method === "regression" && !sparse) {
    gramMatrix = Array.from({ length: numBasis }, () => new Array<number>(numBasis).fill(0));
    for (let i = 0; i < N; i++) {
      const row = designMatrix[i]!;
      for (let a = 0; a < numBasis; a++) {
        const ra = row[a]!;
        for (let b = a; b < numBasis; b++) {
          gramMatrix[a]![b]! += ra * row[b]!;
        }
      }
    }
    for (let a = 0; a < numBasis; a++) {
      gramMatrix[a]![a]! += ridgeLambda;
      for (let b = a + 1; b < numBasis; b++) {
        gramMatrix[b]![a] = gramMatrix[a]![b]!;
      }
    }

    gramInv = invertSPD(gramMatrix);
    leverageH = new Array<number>(N);
    for (let i = 0; i < N; i++) {
      const row = designMatrix[i]!;
      let h = 0;
      for (let a = 0; a < numBasis; a++) {
        let sum = 0;
        for (let b = 0; b < numBasis; b++) {
          sum += gramInv[a]![b]! * row[b]!;
        }
        h += row[a]! * sum;
      }
      leverageH[i] = h;
    }
  }

  for (const outName of outputNames) {
    const yVec = rawOutputs.map((r) => r[outName] ?? 0);
    let coeffs: number[];
    let q2Loo: number | undefined;

    if (method === "quadrature" && quadWeights) {
      coeffs = new Array<number>(numBasis).fill(0);
      for (let i = 0; i < N; i++) {
        const wy = quadWeights[i]! * yVec[i]!;
        const row = designMatrix[i]!;
        for (let k = 0; k < numBasis; k++) {
          coeffs[k]! += wy * row[k]!;
        }
      }
    } else if (sparse) {
      const maxActive = options?.maxActiveTerms ?? Math.min(numBasis, Math.max(2, Math.floor(N / 2)));
      const omp = fitSparseOMP(designMatrix, yVec, maxActive, ridgeLambda);
      coeffs = omp.coeffs;

      // Compute LOO on active support
      const active = omp.activeIndices;
      const kAct = active.length;
      const Gsub: number[][] = Array.from({ length: kAct }, () => new Array<number>(kAct).fill(0));
      for (let i = 0; i < N; i++) {
        const row = designMatrix[i]!;
        for (let a = 0; a < kAct; a++) {
          const va = row[active[a]!]!;
          for (let b = a; b < kAct; b++) Gsub[a]![b]! += va * row[active[b]!]!;
        }
      }
      for (let a = 0; a < kAct; a++) {
        Gsub[a]![a]! += ridgeLambda;
        for (let b = a + 1; b < kAct; b++) Gsub[b]![a] = Gsub[a]![b]!;
      }
      const GsubInv = invertSPD(Gsub);

      let yMean = 0;
      for (let i = 0; i < N; i++) yMean += yVec[i]!;
      yMean /= N;
      let yVar = 0;
      let looSum = 0;
      for (let i = 0; i < N; i++) {
        const dy = yVec[i]! - yMean;
        yVar += dy * dy;
        const row = designMatrix[i]!;
        let yHat = 0;
        let hi = 0;
        for (let a = 0; a < kAct; a++) {
          const va = row[active[a]!]!;
          yHat += va * coeffs[active[a]!]!;
          let s = 0;
          for (let b = 0; b < kAct; b++) s += GsubInv[a]![b]! * row[active[b]!]!;
          hi += va * s;
        }
        const eLoo = (yVec[i]! - yHat) / Math.max(1e-6, 1 - hi);
        looSum += eLoo * eLoo;
      }
      q2Loo = yVar > 1e-30 ? 1 - looSum / yVar : 1;
    } else {
      const rhs = new Array<number>(numBasis).fill(0);
      for (let i = 0; i < N; i++) {
        const yi = yVec[i]!;
        const row = designMatrix[i]!;
        for (let k = 0; k < numBasis; k++) {
          rhs[k]! += row[k]! * yi;
        }
      }
      coeffs = solveSPD(gramMatrix!, rhs);

      // Compute LOO cross-validation Q^2_LOO = 1 - (1/N) sum(((y_i - yHat_i)/(1 - h_i))^2) / Var(y)
      let yMean = 0;
      for (let i = 0; i < N; i++) yMean += yVec[i]!;
      yMean /= N;
      let yVar = 0;
      let looSum = 0;
      for (let i = 0; i < N; i++) {
        const dy = yVec[i]! - yMean;
        yVar += dy * dy;
        const row = designMatrix[i]!;
        let yHat = 0;
        for (let k = 0; k < numBasis; k++) yHat += row[k]! * coeffs[k]!;
        const denom = Math.max(1e-6, 1 - leverageH![i]!);
        const eLoo = (yVec[i]! - yHat) / denom;
        looSum += eLoo * eLoo;
      }
      q2Loo = yVar > 1e-30 ? 1 - looSum / yVar : 1;
    }

    const stats = computeAnalyticalPCESobol(coeffs, multiIndices, paramNames);
    const predict = (sample: Map<string, number>): number => {
      const xi = new Array<number>(d);
      for (let j = 0; j < d; j++) {
        const val = sample.get(paramNames[j]!) ?? 0;
        xi[j] = physicalToGerm(randomVars[j]!.distribution, val);
      }
      const row = evalBasisRow(xi, families, degree, multiIndices);
      let acc = 0;
      for (let k = 0; k < numBasis; k++) acc += row[k]! * coeffs[k]!;
      return acc;
    };

    outputs.set(outName, {
      outputName: outName,
      coefficients: coeffs,
      mean: stats.mean,
      variance: stats.variance,
      stddev: Math.sqrt(Math.max(0, stats.variance)),
      sobolIndices: stats.sobolIndices,
      rankedByTotalOrder: stats.rankedByTotalOrder,
      ...(q2Loo !== undefined ? { q2Loo } : {}),
      predict,
    });
  }

  return {
    outputs,
    degree,
    method,
    multiIndices,
    basisFamilies: families,
    numBasis,
    numEvaluations: N,
    rigor: "approximate",
  };
}

/**
 * Fit a non-intrusive gPCE expansion directly to a DAE arena model via `simulateArena`.
 */
export function fitPCEArena(arena: DAEBuilder, randomVars: RandomVariable[], options?: ArenaPCEOptions): PCEResult {
  const baseOverrides = options?.simulateOptions?.parameterOverrides;
  const outputFilter = options?.outputStates ? new Set(options.outputStates) : null;

  const evalArena = (sample: Map<string, number>): Record<string, number> => {
    const merged = new Map<string, number>();
    if (baseOverrides) {
      for (const [k, v] of baseOverrides) merged.set(k, v);
    }
    for (const [k, v] of sample) merged.set(k, v);

    const sim = simulateArena(arena, {
      ...options?.simulateOptions,
      parameterOverrides: merged,
    });

    const nS = sim.states.length;
    const values =
      options?.snapshotTime !== undefined
        ? interpolateTrajectoryAt(sim, options.snapshotTime, nS)
        : (sim.y[sim.y.length - 1] ?? new Array<number>(nS).fill(0));

    const record: Record<string, number> = {};
    for (let si = 0; si < nS; si++) {
      const name = sim.states[si] ?? `x${si}`;
      if (!outputFilter || outputFilter.has(name)) {
        record[name] = values[si] ?? 0;
      }
    }
    return record;
  };

  return fitPCE(evalArena, randomVars, options);
}
