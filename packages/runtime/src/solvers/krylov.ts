// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Preconditioned Iterative Krylov Subspace Solvers & Matrix-Free JFNK Engine.
 *
 * Implements Restarted Generalized Minimal Residual (`GMRES(m)`), Biconjugate Gradient
 * Stabilized (`BiCGStab`), Zero-Fill Incomplete LU (`ILU(0)`), Jacobi preconditioning,
 * and Matrix-Free Jacobian-Free Newton-Krylov (`JFNK`) nonlinear solvers.
 *
 * Academic Citations:
 * - Saad, Y., & Schultz, M. H. (1986). "GMRES: A generalized minimal residual algorithm for
 *   solving nonsymmetric linear systems." SIAM Journal on Scientific and Statistical Computing,
 *   7(3), 856-869. https://doi.org/10.1137/0907058
 * - van der Vorst, H. A. (1992). "Bi-CGSTAB: A fast and smoothly converging variant of Bi-CG
 *   for the solution of nonsymmetric linear systems." SIAM Journal on Scientific and Statistical
 *   Computing, 13(2), 631-644. https://doi.org/10.1137/0913035
 * - Saad, Y. (2003). Iterative Methods for Sparse Linear Systems (2nd ed.). SIAM.
 *   https://doi.org/10.1137/1.9780898718003
 * - Knoll, D. A., & Keyes, D. E. (2004). "Jacobian-free Newton-Krylov methods: a survey of
 *   approaches and applications." Journal of Computational Physics, 193(2), 357-397.
 *   https://doi.org/10.1016/j.jcp.2003.08.010
 */

import type { SparseCCSMatrix } from "./sparse_lu.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public Interfaces
// ─────────────────────────────────────────────────────────────────────────────

/** Abstract matrix-vector product operator: computes `out = A * v`. */
export type MatVecOperator = (v: Float64Array, out: Float64Array) => void;

/** Abstract preconditioner operator: computes `out = M^{-1} * r`. */
export type Preconditioner = (r: Float64Array, out: Float64Array) => void;

export interface KrylovOptions {
  /** Relative or absolute residual convergence tolerance (default: 1e-10). */
  tol?: number | undefined;
  /** Maximum total Krylov iterations (default: 200). */
  maxIter?: number | undefined;
  /** Restart dimension `m` for GMRES(m) (default: 30). */
  restart?: number | undefined;
  /** Optional right preconditioner `M^{-1}`. */
  preconditioner?: Preconditioner | undefined;
}

export interface KrylovResult {
  /** Solution vector `x`. */
  x: Float64Array;
  /** True if residual norm reached tolerance within `maxIter`. */
  converged: boolean;
  /** Total matrix-vector product iterations executed. */
  iterations: number;
  /** Final Euclidean residual norm `||b - A x||_2`. */
  residualNorm: number;
}

export interface ILU0Factorization {
  /** Matrix dimension `n`. */
  n: number;
  /** Compressed Sparse Row (CSR) row pointer array of length `n + 1`. */
  rowPtr: Int32Array;
  /** CSR column indices array of length `nnz`. */
  colIndices: Int32Array;
  /** Combined L (strictly lower, unit diagonal implied) and U (diagonal + strictly upper) values. */
  luValues: Float64Array;
  /** Index into `colIndices` / `luValues` of the diagonal entry `(i, i)` for each row `i`. */
  diagPtr: Int32Array;
  /** Scratch vector for forward substitution. */
  scratchY: Float64Array;
}

export interface JFNKOptions {
  /** Nonlinear residual convergence tolerance `||F(x)||_2` (default: 1e-9). */
  tol?: number | undefined;
  /** Maximum outer Newton iterations (default: 25). */
  maxNewtonIter?: number | undefined;
  /** Inexact Newton relative forcing tolerance for inner GMRES (default: 1e-4). */
  krylovTol?: number | undefined;
  /** Maximum inner GMRES iterations per Newton step (default: 60). */
  maxKrylovIter?: number | undefined;
  /** GMRES restart dimension `m` (default: 25). */
  restart?: number | undefined;
  /** Optional right preconditioner `M^{-1}` for the Jacobian-vector operator. */
  preconditioner?: Preconditioner | undefined;
  /** Enable Armijo backtracking line search (default: true). */
  lineSearch?: boolean | undefined;
}

export interface JFNKResult {
  /** Converged state vector `x`. */
  x: Float64Array;
  /** True if nonlinear residual norm fell below `tol`. */
  converged: boolean;
  /** Outer Newton steps performed. */
  newtonIterations: number;
  /** Total inner Krylov matrix-vector products performed. */
  krylovIterations: number;
  /** Total nonlinear residual evaluations `F(x)` performed. */
  fEvals: number;
  /** Final nonlinear residual Euclidean norm `||F(x)||_2`. */
  residualNorm: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vector & Matrix-Vector Helpers
// ─────────────────────────────────────────────────────────────────────────────

function vecDot(a: Float64Array, b: Float64Array): number {
  let sum = 0.0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

function vecNorm2(a: Float64Array): number {
  return Math.sqrt(vecDot(a, a));
}

/**
 * Computes sparse matrix-vector product `out = A * v` for a Compressed Column Storage (CCS) matrix.
 */
export function ccsMatVec(A: SparseCCSMatrix, v: Float64Array, out: Float64Array): void {
  out.fill(0.0);
  const { nCols, colPtr, rowIndices, values } = A;
  for (let col = 0; col < nCols; col++) {
    const vj = v[col]!;
    if (vj === 0.0) continue;
    const start = colPtr[col]!;
    const end = colPtr[col + 1]!;
    for (let p = start; p < end; p++) {
      const row = rowIndices[p]!;
      out[row] = out[row]! + values[p]! * vj;
    }
  }
}

/**
 * Computes dense row-major matrix-vector product `out = A * v`.
 */
export function denseMatVec(A: Float64Array, n: number, v: Float64Array, out: Float64Array): void {
  for (let i = 0; i < n; i++) {
    let sum = 0.0;
    const rowOff = i * n;
    for (let j = 0; j < n; j++) {
      sum += A[rowOff + j]! * v[j]!;
    }
    out[i] = sum;
  }
}

function normalizeOperator(op: MatVecOperator | SparseCCSMatrix): MatVecOperator {
  if (typeof op === "function") return op;
  return (v, out) => ccsMatVec(op, v, out);
}

// ─────────────────────────────────────────────────────────────────────────────
// Preconditioners: Jacobi & Incomplete LU with Zero Fill-In (ILU(0))
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a diagonal (Jacobi) preconditioner `M^{-1} = diag(A)^{-1}` from a sparse CCS or dense matrix.
 */
export function jacobiPreconditioner(A: SparseCCSMatrix | Float64Array, nOverride?: number): Preconditioner {
  if (A instanceof Float64Array) {
    const n = nOverride ?? Math.round(Math.sqrt(A.length));
    const invDiag = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const d = A[i * n + i]!;
      invDiag[i] = Math.abs(d) > 1e-15 ? 1.0 / d : 1.0;
    }
    return (r, out) => {
      for (let i = 0; i < n; i++) out[i] = r[i]! * invDiag[i]!;
    };
  }

  const n = A.nRows;
  const invDiag = new Float64Array(n);
  invDiag.fill(1.0);
  for (let col = 0; col < A.nCols; col++) {
    const start = A.colPtr[col]!;
    const end = A.colPtr[col + 1]!;
    for (let p = start; p < end; p++) {
      if (A.rowIndices[p] === col) {
        const d = A.values[p]!;
        invDiag[col] = Math.abs(d) > 1e-15 ? 1.0 / d : 1.0;
        break;
      }
    }
  }
  return (r, out) => {
    for (let i = 0; i < n; i++) out[i] = r[i]! * invDiag[i]!;
  };
}

/**
 * Computes the Zero-Fill Incomplete LU (`ILU(0)`) factorization of a sparse CCS matrix `A`.
 *
 * Converts `A` into a sorted Compressed Sparse Row (CSR) structure (guaranteeing a diagonal
 * slot for every row) and executes Saad's IKJ in-place elimination over the sparsity pattern.
 */
export function ilu0Factor(A: SparseCCSMatrix): ILU0Factorization {
  const n = A.nRows;

  // Step 1: Collect entries per row from CCS, ensuring diagonal entry (i, i) exists
  const rowCounts = new Int32Array(n);
  const hasDiag = new Uint8Array(n);

  for (let col = 0; col < A.nCols; col++) {
    const start = A.colPtr[col]!;
    const end = A.colPtr[col + 1]!;
    for (let p = start; p < end; p++) {
      const row = A.rowIndices[p]!;
      rowCounts[row] = rowCounts[row]! + 1;
      if (row === col) hasDiag[row] = 1;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!hasDiag[i]) rowCounts[i] = rowCounts[i]! + 1;
  }

  const rowPtr = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    rowPtr[i + 1] = rowPtr[i]! + rowCounts[i]!;
  }

  const totalNnz = rowPtr[n]!;
  const colIndices = new Int32Array(totalNnz);
  const luValues = new Float64Array(totalNnz);
  const writePos = new Int32Array(rowPtr.subarray(0, n));

  // Since we iterate columns col = 0..n-1 in increasing order, entries appended to each row
  // are naturally sorted by column index if we insert missing diagonals at the right spot.
  for (let col = 0; col < A.nCols; col++) {
    if (!hasDiag[col]) {
      const pos = writePos[col]!;
      colIndices[pos] = col;
      luValues[pos] = 1e-12; // Small non-zero structural diagonal fallback
      writePos[col] = pos + 1;
      hasDiag[col] = 1;
    }
    const start = A.colPtr[col]!;
    const end = A.colPtr[col + 1]!;
    for (let p = start; p < end; p++) {
      const row = A.rowIndices[p]!;
      const pos = writePos[row]!;
      colIndices[pos] = col;
      luValues[pos] = A.values[p]!;
      writePos[row] = pos + 1;
    }
  }

  // Sort each row by column index (in case missing diagonal was inserted out of order) and record diagPtr
  const diagPtr = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const start = rowPtr[i]!;
    const end = rowPtr[i + 1]!;
    // Insertion sort on row i (rows are typically short in sparse matrices)
    for (let p = start + 1; p < end; p++) {
      const cVal = colIndices[p]!;
      const vVal = luValues[p]!;
      let q = p - 1;
      while (q >= start && colIndices[q]! > cVal) {
        colIndices[q + 1] = colIndices[q]!;
        luValues[q + 1] = luValues[q]!;
        q--;
      }
      colIndices[q + 1] = cVal;
      luValues[q + 1] = vVal;
    }
    for (let p = start; p < end; p++) {
      if (colIndices[p] === i) {
        diagPtr[i] = p;
        break;
      }
    }
  }

  // Step 2: Saad Algorithm 10.4 — General Static Pattern ILU(0)
  // Work array mapping column index j -> position in current row i (or -1 if not present)
  const iw = new Int32Array(n);
  iw.fill(-1);

  for (let i = 0; i < n; i++) {
    const rowStart = rowPtr[i]!;
    const rowEnd = rowPtr[i + 1]!;
    const diagIdx = diagPtr[i]!;

    // Populate column lookup table for row i
    for (let p = rowStart; p < rowEnd; p++) {
      iw[colIndices[p]!] = p;
    }

    // Eliminate lower triangular entries k < i
    for (let p = rowStart; p < diagIdx; p++) {
      const k = colIndices[p]!;
      const ukk = luValues[diagPtr[k]!]!;
      const pivot = Math.abs(ukk) > 1e-15 ? ukk : ukk >= 0 ? 1e-15 : -1e-15;
      const lik = luValues[p]! / pivot;
      luValues[p] = lik;

      // Update row i entries for columns j > k in row k
      const kDiag = diagPtr[k]!;
      const kEnd = rowPtr[k + 1]!;
      for (let kp = kDiag + 1; kp < kEnd; kp++) {
        const j = colIndices[kp]!;
        const ijPos = iw[j]!;
        if (ijPos !== -1) {
          luValues[ijPos] = luValues[ijPos]! - lik * luValues[kp]!;
        }
      }
    }

    // Guard zero diagonal pivot in U_{ii}
    if (Math.abs(luValues[diagIdx]!) < 1e-15) {
      luValues[diagIdx] = luValues[diagIdx]! >= 0 ? 1e-12 : -1e-12;
    }

    // Reset column lookup table
    for (let p = rowStart; p < rowEnd; p++) {
      iw[colIndices[p]!] = -1;
    }
  }

  return {
    n,
    rowPtr,
    colIndices,
    luValues,
    diagPtr,
    scratchY: new Float64Array(n),
  };
}

/**
 * Applies an `ILU(0)` factorization to solve `(L * U) out = r` via forward and backward substitution.
 */
export function ilu0Solve(ilu: ILU0Factorization, r: Float64Array, out: Float64Array): void {
  const { n, rowPtr, colIndices, luValues, diagPtr, scratchY } = ilu;

  // Forward substitution: L * y = r (L has unit diagonal)
  for (let i = 0; i < n; i++) {
    let sum = r[i]!;
    const start = rowPtr[i]!;
    const diag = diagPtr[i]!;
    for (let p = start; p < diag; p++) {
      sum -= luValues[p]! * scratchY[colIndices[p]!]!;
    }
    scratchY[i] = sum;
  }

  // Backward substitution: U * out = y
  for (let i = n - 1; i >= 0; i--) {
    let sum = scratchY[i]!;
    const diag = diagPtr[i]!;
    const end = rowPtr[i + 1]!;
    for (let p = diag + 1; p < end; p++) {
      sum -= luValues[p]! * out[colIndices[p]!]!;
    }
    out[i] = sum / luValues[diag]!;
  }
}

/**
 * Builds a right/left preconditioner closure from an `ILU(0)` factorization of `A`.
 */
export function ilu0Preconditioner(A: SparseCCSMatrix): Preconditioner {
  const ilu = ilu0Factor(A);
  return (r, out) => ilu0Solve(ilu, r, out);
}

// ─────────────────────────────────────────────────────────────────────────────
// Restarted GMRES(m) Solver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Solves the linear system `A x = b` using Restarted Right-Preconditioned GMRES(m).
 *
 * Uses Modified Gram-Schmidt Arnoldi orthogonalization and progressive Givens rotations.
 */
export function gmres(
  matVecOrMatrix: MatVecOperator | SparseCCSMatrix,
  b: Float64Array,
  options: KrylovOptions = {},
  x0?: Float64Array,
): KrylovResult {
  const matVec = normalizeOperator(matVecOrMatrix);
  const n = b.length;
  const tol = options.tol ?? 1e-10;
  const maxIter = options.maxIter ?? Math.max(200, n * 2);
  const m = Math.min(options.restart ?? 30, n, maxIter);
  const precond = options.preconditioner;

  const x = x0 ? new Float64Array(x0) : new Float64Array(n);
  const r = new Float64Array(n);
  const Ax = new Float64Array(n);
  const z = new Float64Array(n);
  const w = new Float64Array(n);

  const bNorm = vecNorm2(b);
  if (bNorm === 0.0) {
    return { x, converged: true, iterations: 0, residualNorm: 0.0 };
  }
  const stopTol = tol * bNorm;

  // Krylov basis V[0..m] of length n each
  const V: Float64Array[] = Array.from({ length: m + 1 }, () => new Float64Array(n));
  // Upper Hessenberg matrix H of dimension (m + 1) x m (stored column-major or row-major)
  const H = new Float64Array((m + 1) * m);
  const cs = new Float64Array(m);
  const sn = new Float64Array(m);
  const g = new Float64Array(m + 1);
  const y = new Float64Array(m);

  let totalIter = 0;

  while (totalIter < maxIter) {
    // Compute initial residual r = b - A * x
    matVec(x, Ax);
    for (let i = 0; i < n; i++) r[i] = b[i]! - Ax[i]!;
    const beta = vecNorm2(r);

    if (beta <= stopTol) {
      return { x, converged: true, iterations: totalIter, residualNorm: beta };
    }

    // V[0] = r / beta
    const invBeta = 1.0 / beta;
    const v0 = V[0]!;
    for (let i = 0; i < n; i++) v0[i] = r[i]! * invBeta;

    g.fill(0.0);
    g[0] = beta;

    let kReached = 0;
    let resNorm = beta;

    for (let j = 0; j < m && totalIter < maxIter; j++) {
      totalIter++;
      kReached = j + 1;

      // Apply right preconditioner: z = M^{-1} V[j]
      if (precond) {
        precond(V[j]!, z);
      } else {
        z.set(V[j]!);
      }

      // w = A * z
      matVec(z, w);

      // Modified Gram-Schmidt orthogonalization against V[0..j]
      for (let i = 0; i <= j; i++) {
        const vi = V[i]!;
        const hij = vecDot(w, vi);
        H[i * m + j] = hij;
        for (let idx = 0; idx < n; idx++) {
          w[idx] = w[idx]! - hij * vi[idx]!;
        }
      }

      const hNext = vecNorm2(w);
      H[(j + 1) * m + j] = hNext;

      if (hNext > 1e-16) {
        const invH = 1.0 / hNext;
        const vNext = V[j + 1]!;
        for (let idx = 0; idx < n; idx++) vNext[idx] = w[idx]! * invH;
      }

      // Apply previous Givens rotations to column j of H
      for (let i = 0; i < j; i++) {
        const temp = cs[i]! * H[i * m + j]! + sn[i]! * H[(i + 1) * m + j]!;
        H[(i + 1) * m + j] = -sn[i]! * H[i * m + j]! + cs[i]! * H[(i + 1) * m + j]!;
        H[i * m + j] = temp;
      }

      // Compute new Givens rotation to eliminate H[j + 1, j]
      const hDiag = H[j * m + j]!;
      const hSub = H[(j + 1) * m + j]!;
      const denom = Math.hypot(hDiag, hSub);
      if (denom > 1e-16) {
        cs[j] = hDiag / denom;
        sn[j] = hSub / denom;
      } else {
        cs[j] = 1.0;
        sn[j] = 0.0;
      }

      H[j * m + j] = cs[j]! * hDiag + sn[j]! * hSub;
      H[(j + 1) * m + j] = 0.0;

      // Update RHS vector g of least-squares problem
      const gTemp = cs[j]! * g[j]! + sn[j]! * g[j + 1]!;
      g[j + 1] = -sn[j]! * g[j]! + cs[j]! * g[j + 1]!;
      g[j] = gTemp;

      resNorm = Math.abs(g[j + 1]!);
      if (resNorm <= stopTol) {
        break;
      }
    }

    // Solve upper triangular system H[0..kReached-1, 0..kReached-1] * y = g[0..kReached-1]
    for (let i = kReached - 1; i >= 0; i--) {
      let sum = g[i]!;
      for (let j = i + 1; j < kReached; j++) {
        sum -= H[i * m + j]! * y[j]!;
      }
      const diag = H[i * m + i]!;
      y[i] = Math.abs(diag) > 1e-16 ? sum / diag : 0.0;
    }

    // Reconstruct update: w = sum_{i=0}^{kReached-1} V[i] * y[i], then x += M^{-1} w
    w.fill(0.0);
    for (let i = 0; i < kReached; i++) {
      const yi = y[i]!;
      const vi = V[i]!;
      for (let idx = 0; idx < n; idx++) {
        w[idx] = w[idx]! + yi * vi[idx]!;
      }
    }
    if (precond) {
      precond(w, z);
    } else {
      z.set(w);
    }
    for (let idx = 0; idx < n; idx++) {
      x[idx] = x[idx]! + z[idx]!;
    }

    if (resNorm <= stopTol) {
      return { x, converged: true, iterations: totalIter, residualNorm: resNorm };
    }
  }

  // Final residual check
  matVec(x, Ax);
  for (let i = 0; i < n; i++) r[i] = b[i]! - Ax[i]!;
  const finalNorm = vecNorm2(r);
  return {
    x,
    converged: finalNorm <= stopTol,
    iterations: totalIter,
    residualNorm: finalNorm,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Preconditioned BiCGStab Solver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Solves the nonsymmetric linear system `A x = b` using Right-Preconditioned BiCGStab.
 */
export function bicgstab(
  matVecOrMatrix: MatVecOperator | SparseCCSMatrix,
  b: Float64Array,
  options: KrylovOptions = {},
  x0?: Float64Array,
): KrylovResult {
  const matVec = normalizeOperator(matVecOrMatrix);
  const n = b.length;
  const tol = options.tol ?? 1e-10;
  const maxIter = options.maxIter ?? Math.max(200, n * 2);
  const precond = options.preconditioner;

  const x = x0 ? new Float64Array(x0) : new Float64Array(n);
  const r = new Float64Array(n);
  const rHat = new Float64Array(n);
  const p = new Float64Array(n);
  const pHat = new Float64Array(n);
  const v = new Float64Array(n);
  const s = new Float64Array(n);
  const sHat = new Float64Array(n);
  const t = new Float64Array(n);

  const bNorm = vecNorm2(b);
  if (bNorm === 0.0) {
    return { x, converged: true, iterations: 0, residualNorm: 0.0 };
  }
  const stopTol = tol * bNorm;

  // Initial residual r = b - A * x
  matVec(x, v);
  for (let i = 0; i < n; i++) {
    r[i] = b[i]! - v[i]!;
    rHat[i] = r[i]!;
  }

  let resNorm = vecNorm2(r);
  if (resNorm <= stopTol) {
    return { x, converged: true, iterations: 0, residualNorm: resNorm };
  }

  let rhoPrev = 1.0;
  let alpha = 1.0;
  let omega = 1.0;
  v.fill(0.0);
  p.fill(0.0);

  let iter = 0;
  for (iter = 1; iter <= maxIter; iter++) {
    const rho = vecDot(rHat, r);
    if (Math.abs(rho) < 1e-30) {
      break;
    }

    if (iter === 1) {
      p.set(r);
    } else {
      const beta = (rho / rhoPrev) * (alpha / omega);
      for (let i = 0; i < n; i++) {
        p[i] = r[i]! + beta * (p[i]! - omega * v[i]!);
      }
    }

    // Apply right preconditioner: pHat = M^{-1} p
    if (precond) {
      precond(p, pHat);
    } else {
      pHat.set(p);
    }

    // v = A * pHat
    matVec(pHat, v);

    const rHatDotV = vecDot(rHat, v);
    alpha = Math.abs(rHatDotV) > 1e-30 ? rho / rHatDotV : 0.0;

    // s = r - alpha * v
    for (let i = 0; i < n; i++) {
      s[i] = r[i]! - alpha * v[i]!;
    }

    const sNorm = vecNorm2(s);
    if (sNorm <= stopTol) {
      for (let i = 0; i < n; i++) {
        x[i] = x[i]! + alpha * pHat[i]!;
      }
      return { x, converged: true, iterations: iter, residualNorm: sNorm };
    }

    // Apply right preconditioner: sHat = M^{-1} s
    if (precond) {
      precond(s, sHat);
    } else {
      sHat.set(s);
    }

    // t = A * sHat
    matVec(sHat, t);

    const tDotT = vecDot(t, t);
    omega = tDotT > 1e-30 ? vecDot(t, s) / tDotT : 0.0;

    // Update solution x and residual r
    for (let i = 0; i < n; i++) {
      x[i] = x[i]! + alpha * pHat[i]! + omega * sHat[i]!;
      r[i] = s[i]! - omega * t[i]!;
    }

    resNorm = vecNorm2(r);
    if (resNorm <= stopTol || Math.abs(omega) < 1e-30) {
      return {
        x,
        converged: resNorm <= stopTol,
        iterations: iter,
        residualNorm: resNorm,
      };
    }

    rhoPrev = rho;
  }

  return {
    x,
    converged: resNorm <= stopTol,
    iterations: iter,
    residualNorm: resNorm,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Matrix-Free Jacobian-Free Newton-Krylov (JFNK) Solver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Solves a nonlinear algebraic system `F(x) = 0` without forming or storing the Jacobian `J(x)`.
 *
 * Uses directional Gateaux finite-difference approximations inside `GMRES(m)`:
 *   `J(x) * v ≈ (F(x + eps * v) - F(x)) / eps`
 * coupled with an Armijo backtracking line search.
 */
export function jfnkSolve(
  residualFn: (x: Float64Array, outF: Float64Array) => void,
  x0: Float64Array,
  options: JFNKOptions = {},
): JFNKResult {
  const n = x0.length;
  const tol = options.tol ?? 1e-9;
  const maxNewtonIter = options.maxNewtonIter ?? 25;
  const krylovTol = options.krylovTol ?? 1e-4;
  const maxKrylovIter = options.maxKrylovIter ?? Math.min(80, Math.max(20, n));
  const restart = options.restart ?? Math.min(25, n);
  const useLineSearch = options.lineSearch ?? true;

  const x = new Float64Array(x0);
  const F0 = new Float64Array(n);
  const Fpert = new Float64Array(n);
  const xPert = new Float64Array(n);
  const rhs = new Float64Array(n);
  const xTrial = new Float64Array(n);

  let fEvals = 0;
  let totalKrylovIter = 0;

  const evalF = (state: Float64Array, out: Float64Array): void => {
    fEvals++;
    residualFn(state, out);
  };

  evalF(x, F0);
  let fNorm = vecNorm2(F0);

  if (fNorm <= tol) {
    return {
      x,
      converged: true,
      newtonIterations: 0,
      krylovIterations: 0,
      fEvals,
      residualNorm: fNorm,
    };
  }

  const sqrtMachEps = 1.4901161193847656e-8; // Math.sqrt(Number.EPSILON)

  // Matrix-free directional Jacobian-vector product J(x) * v
  const jvOperator: MatVecOperator = (v: Float64Array, outJv: Float64Array): void => {
    const vNorm = vecNorm2(v);
    if (vNorm < 1e-20) {
      outJv.fill(0.0);
      return;
    }
    const xNorm = vecNorm2(x);
    const eps = (sqrtMachEps * (1.0 + xNorm)) / vNorm;
    const invEps = 1.0 / eps;

    for (let i = 0; i < n; i++) {
      xPert[i] = x[i]! + eps * v[i]!;
    }
    evalF(xPert, Fpert);
    for (let i = 0; i < n; i++) {
      outJv[i] = (Fpert[i]! - F0[i]!) * invEps;
    }
  };

  let newtonIter = 0;
  for (newtonIter = 1; newtonIter <= maxNewtonIter; newtonIter++) {
    for (let i = 0; i < n; i++) rhs[i] = -F0[i]!;

    const gmresRes = gmres(jvOperator, rhs, {
      tol: krylovTol,
      maxIter: maxKrylovIter,
      restart,
      preconditioner: options.preconditioner,
    });
    totalKrylovIter += gmresRes.iterations;

    const dx = gmresRes.x;

    // Backtracking line search to ensure sufficient decrease in ||F(x)||_2
    let stepAccepted = false;
    let alpha = 1.0;

    if (useLineSearch) {
      for (let ls = 0; ls < 8; ls++) {
        for (let i = 0; i < n; i++) {
          xTrial[i] = x[i]! + alpha * dx[i]!;
        }
        evalF(xTrial, Fpert);
        const trialNorm = vecNorm2(Fpert);
        if (trialNorm < (1.0 - 1e-4 * alpha) * fNorm || trialNorm <= tol) {
          x.set(xTrial);
          F0.set(Fpert);
          fNorm = trialNorm;
          stepAccepted = true;
          break;
        }
        alpha *= 0.5;
      }
    }

    if (!stepAccepted) {
      for (let i = 0; i < n; i++) {
        x[i] = x[i]! + alpha * dx[i]!;
      }
      evalF(x, F0);
      fNorm = vecNorm2(F0);
    }

    if (fNorm <= tol) {
      return {
        x,
        converged: true,
        newtonIterations: newtonIter,
        krylovIterations: totalKrylovIter,
        fEvals,
        residualNorm: fNorm,
      };
    }
  }

  return {
    x,
    converged: fNorm <= tol,
    newtonIterations: newtonIter,
    krylovIterations: totalKrylovIter,
    fEvals,
    residualNorm: fNorm,
  };
}
