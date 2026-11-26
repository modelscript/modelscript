// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Mixed-Precision (f32 Inner Preconditioner + f64 Outer Residual)
 * Smoothed-Aggregation AMG (SA-AMG) & Iterative Refinement Solvers for Large-Scale FEA.
 *
 * Implements:
 *   1. Single-precision CSR matrix (`CsrMatrixF32`) and rectangular CSR matrix kernels
 *   2. `MixedPrecisionAmgPreconditioner` — builds the SA-AMG hierarchy via
 *      `SmoothedAggregationAmg` and quantizes all level operators (`A`, `P`, `R`,
 *      `diagInv`, coarse factor) and V-cycle workspaces into `Float32Array` (`f32`),
 *      cutting preconditioner memory bandwidth by ~40-50%.
 *   3. Dynamic-range-preserving `applyVcycleF32(r64, z64)` — normalizes the `f64`
 *      residual to avoid `f32` underflow/overflow, executes the symmetric `f32` V-cycle
 *      (damped-Jacobi / Chebyshev smoother + direct coarse solve), and promotes back to `f64`.
 *   4. `solvePcgMixedPrecisionAmg` — Flexible PCG (FPCG / Polak-Ribière) in `f64`
 *      around the `f32` AMG V-cycle preconditioner, converging to full `f64` accuracy (< 1e-10).
 *   5. `solveMixedPrecisionIterativeRefinement` — `f64` defect correction around `f32`
 *      inner AMG-PCG solves.
 */

import {
  type AmgOptions,
  type CsrMatrix,
  type PcgAmgOptions,
  type PcgSolveResult,
  SmoothedAggregationAmg,
  spmvCsr,
} from "./amg-preconditioner.js";

/** Single-precision (f32) square sparse matrix in CSR format. */
export interface CsrMatrixF32 {
  readonly n: number;
  readonly rowOffsets: Int32Array;
  readonly colIndices: Int32Array;
  readonly values: Float32Array;
}

/** Single-precision (f32) rectangular sparse matrix in CSR format (rows x cols). */
interface RectCsrMatrixF32 {
  readonly rows: number;
  readonly cols: number;
  readonly rowOffsets: Int32Array;
  readonly colIndices: Int32Array;
  readonly values: Float32Array;
}

interface AmgLevelF32 {
  A: CsrMatrixF32;
  diagInv: Float32Array;
  rhoEst: number;
  omegaSmooth: number;
  P?: RectCsrMatrixF32;
  R?: RectCsrMatrixF32;
  /** Preallocated f32 workspace vectors for zero-allocation V-cycle execution. */
  res: Float32Array;
  tmp: Float32Array;
  coarseRhs?: Float32Array;
  coarseSol?: Float32Array;
  /** Quantized f32 coarse direct solver factorization (coarsest level only). */
  coarseCholeskyL?: Float32Array;
  coarseDenseLU?: { lu: Float32Array; piv: Int32Array };
}

export interface MixedPrecisionPcgResult extends PcgSolveResult {
  /** Total memory footprint (bytes) of the f32 preconditioner operators & workspaces. */
  preconditionerBytesF32: number;
  /** Equivalent memory footprint (bytes) if the same preconditioner were stored in f64. */
  equivalentBytesF64: number;
  /** Percentage memory bandwidth / footprint reduction: (1 - f32/f64) * 100. */
  bandwidthReductionPct: number;
}

export interface IterativeRefinementOptions extends PcgAmgOptions {
  /** Maximum outer f64 defect-correction iterations (default: 10). */
  maxOuterIterations?: number;
  /** Inner f32 PCG relative residual tolerance per defect step (default: 1e-5). */
  innerTolerance?: number;
  /** Maximum inner f32 PCG iterations per outer step (default: 25). */
  innerMaxIterations?: number;
}

export interface IterativeRefinementResult extends MixedPrecisionPcgResult {
  /** Number of outer f64 defect-correction steps performed. */
  outerIterations: number;
  /** Total inner f32 PCG iterations across all outer steps. */
  innerIterations: number;
}

/** Quantize a Float64 CSR matrix to Float32 CSR (shares immutable index arrays). */
export function quantizeCsrToF32(A: CsrMatrix): CsrMatrixF32 {
  const values = new Float32Array(A.values.length);
  for (let i = 0; i < A.values.length; i++) {
    values[i] = A.values[i]!;
  }
  return {
    n: A.n,
    rowOffsets: A.rowOffsets,
    colIndices: A.colIndices,
    values,
  };
}

/** Sparse matrix-vector product y = A * x in f32 for square CSR matrix A. */
export function spmvCsrF32(A: CsrMatrixF32, x: Float32Array, y: Float32Array): void {
  const { n, rowOffsets, colIndices, values } = A;
  for (let i = 0; i < n; i++) {
    let sum = 0.0;
    const start = rowOffsets[i]!;
    const end = rowOffsets[i + 1]!;
    for (let k = start; k < end; k++) {
      sum += values[k]! * x[colIndices[k]!]!;
    }
    y[i] = sum;
  }
}

/** Rectangular sparse matrix-vector product y = M * x in f32. */
function spmvRectF32(M: RectCsrMatrixF32, x: Float32Array, y: Float32Array): void {
  const { rows, rowOffsets, colIndices, values } = M;
  for (let i = 0; i < rows; i++) {
    let sum = 0.0;
    const start = rowOffsets[i]!;
    const end = rowOffsets[i + 1]!;
    for (let k = start; k < end; k++) {
      sum += values[k]! * x[colIndices[k]!]!;
    }
    y[i] = sum;
  }
}

/** Rectangular sparse matrix-vector accumulate y += M * x in f32. */
function spmvRectAddF32(M: RectCsrMatrixF32, x: Float32Array, y: Float32Array): void {
  const { rows, rowOffsets, colIndices, values } = M;
  for (let i = 0; i < rows; i++) {
    let sum = 0.0;
    const start = rowOffsets[i]!;
    const end = rowOffsets[i + 1]!;
    for (let k = start; k < end; k++) {
      sum += values[k]! * x[colIndices[k]!]!;
    }
    y[i] = y[i]! + sum;
  }
}

function solveDenseCholeskyF32(L: Float32Array, n: number, b: Float32Array, x: Float32Array): void {
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    const row = i * n;
    for (let j = 0; j < i; j++) sum -= L[row + j]! * x[j]!;
    x[i] = sum / L[row + i]!;
  }
  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i]!;
    for (let j = i + 1; j < n; j++) sum -= L[j * n + i]! * x[j]!;
    x[i] = sum / L[i * n + i]!;
  }
}

function solveDenseLUF32(lu: Float32Array, piv: Int32Array, n: number, b: Float32Array, x: Float32Array): void {
  for (let i = 0; i < n; i++) x[i] = b[piv[i]!]!;
  for (let i = 0; i < n; i++) {
    let sum = x[i]!;
    const row = i * n;
    for (let j = 0; j < i; j++) sum -= lu[row + j]! * x[j]!;
    x[i] = sum;
  }
  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i]!;
    const row = i * n;
    for (let j = i + 1; j < n; j++) sum -= lu[row + j]! * x[j]!;
    const d = lu[row + i]!;
    x[i] = Math.abs(d) > 1e-12 ? sum / d : 0.0;
  }
}

/**
 * Mixed-Precision Smoothed-Aggregation AMG Preconditioner.
 *
 * Constructs the SA-AMG hierarchy in `f64` via `SmoothedAggregationAmg` to preserve
 * exact Galerkin coarsening and strength-of-connection decisions, then quantizes all
 * level operators (`A`, `P`, `R`, `diagInv`, coarse Cholesky/LU factors) and V-cycle
 * workspaces into `Float32Array` (`f32`) for reduced memory bandwidth.
 */
export class MixedPrecisionAmgPreconditioner {
  public readonly levels: AmgLevelF32[] = [];
  public readonly preconditionerBytesF32: number;
  public readonly equivalentBytesF64: number;
  public readonly bandwidthReductionPct: number;

  private readonly smootherSweeps: number;
  private readonly smootherType: "jacobi" | "chebyshev";
  private readonly rF32: Float32Array;
  private readonly zF32: Float32Array;

  constructor(A: CsrMatrix, options: AmgOptions = {}) {
    const amg64 = new SmoothedAggregationAmg(A, options);
    this.smootherSweeps = options.smootherSweeps ?? 2;
    this.smootherType = options.smoother ?? "chebyshev";
    this.rF32 = new Float32Array(A.n);
    this.zF32 = new Float32Array(A.n);

    let floatElements = 2 * A.n; // rF32 + zF32
    let indexBytes = 0;

    for (let lvlIdx = 0; lvlIdx < amg64.levels.length; lvlIdx++) {
      const lvl64 = amg64.levels[lvlIdx]!;
      const n = lvl64.A.n;
      const AF32 = quantizeCsrToF32(lvl64.A);
      const diagInv = Float32Array.from(lvl64.invDiag);

      // Level-0 A.rowOffsets/A.colIndices are shared by reference with the caller's matrix;
      // coarse Galerkin operators (lvlIdx > 0) own their CSR index arrays.
      if (lvlIdx > 0) {
        indexBytes += AF32.rowOffsets.byteLength + AF32.colIndices.byteLength;
      }
      floatElements += AF32.values.length + diagInv.length + 2 * n; // values + diagInv + res + tmp

      const levelF32: AmgLevelF32 = {
        A: AF32,
        diagInv,
        rhoEst: lvl64.rhoEst,
        omegaSmooth: lvl64.omegaSmooth,
        res: new Float32Array(n),
        tmp: new Float32Array(n),
      };

      if (lvl64.P && lvl64.R) {
        const PF32: RectCsrMatrixF32 = {
          rows: lvl64.P.rows,
          cols: lvl64.P.cols,
          rowOffsets: lvl64.P.rowOffsets,
          colIndices: lvl64.P.colIndices,
          values: Float32Array.from(lvl64.P.values),
        };
        const RF32: RectCsrMatrixF32 = {
          rows: lvl64.R.rows,
          cols: lvl64.R.cols,
          rowOffsets: lvl64.R.rowOffsets,
          colIndices: lvl64.R.colIndices,
          values: Float32Array.from(lvl64.R.values),
        };
        levelF32.P = PF32;
        levelF32.R = RF32;
        levelF32.coarseRhs = new Float32Array(PF32.cols);
        levelF32.coarseSol = new Float32Array(PF32.cols);

        indexBytes +=
          PF32.rowOffsets.byteLength +
          PF32.colIndices.byteLength +
          RF32.rowOffsets.byteLength +
          RF32.colIndices.byteLength;
        floatElements += PF32.values.length + RF32.values.length + 2 * PF32.cols;
      }

      if (lvl64.coarseCholeskyL) {
        levelF32.coarseCholeskyL = Float32Array.from(lvl64.coarseCholeskyL);
        floatElements += levelF32.coarseCholeskyL.length;
      } else if (lvl64.coarseDenseLU) {
        levelF32.coarseDenseLU = {
          lu: Float32Array.from(lvl64.coarseDenseLU.lu),
          piv: lvl64.coarseDenseLU.piv,
        };
        indexBytes += levelF32.coarseDenseLU.piv.byteLength;
        floatElements += levelF32.coarseDenseLU.lu.length;
      }

      this.levels.push(levelF32);
    }

    this.preconditionerBytesF32 = indexBytes + floatElements * Float32Array.BYTES_PER_ELEMENT;
    this.equivalentBytesF64 = indexBytes + floatElements * Float64Array.BYTES_PER_ELEMENT;
    this.bandwidthReductionPct =
      this.equivalentBytesF64 > 0
        ? ((this.equivalentBytesF64 - this.preconditionerBytesF32) / this.equivalentBytesF64) * 100.0
        : 0.0;
  }

  /** Number of multigrid levels in the f32 hierarchy. */
  public get numLevels(): number {
    return this.levels.length;
  }

  /** Number of DOFs at the coarsest level. */
  public get coarseSize(): number {
    return this.levels[this.levels.length - 1]!.A.n;
  }

  /** Fine-grid operator in f32 CSR format. */
  public get fineMatrixF32(): CsrMatrixF32 {
    return this.levels[0]!.A;
  }

  /**
   * Apply one f32 symmetric V-cycle directly on f32 vectors: computes z32 = M_f32^{-1} * r32.
   */
  public applyVcycleRawF32(r32: Float32Array, z32: Float32Array): void {
    z32.fill(0.0);
    this.vcycleRecursiveF32(0, r32, z32);
  }

  /**
   * Apply one f32 V-cycle to an f64 residual vector `r64`, writing the promoted
   * `f64` preconditioned vector into `z64`.
   *
   * Uses infinity-norm scaling prior to f32 quantization to preserve full f64
   * dynamic range (preventing f32 underflow at residuals << 1e-38 or overflow).
   */
  public applyVcycleF32(r64: Float64Array, z64: Float64Array): void {
    const n = r64.length;
    let maxAbs = 0.0;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(r64[i]!);
      if (a > maxAbs) maxAbs = a;
    }
    if (maxAbs === 0.0) {
      z64.fill(0.0);
      return;
    }

    const invScale = 1.0 / maxAbs;
    const rF32 = this.rF32;
    const zF32 = this.zF32;
    for (let i = 0; i < n; i++) {
      rF32[i] = r64[i]! * invScale;
    }

    zF32.fill(0.0);
    this.vcycleRecursiveF32(0, rF32, zF32);

    for (let i = 0; i < n; i++) {
      z64[i] = zF32[i]! * maxAbs;
    }
  }

  private vcycleRecursiveF32(lvlIdx: number, b: Float32Array, x: Float32Array): void {
    const level = this.levels[lvlIdx]!;
    const n = level.A.n;

    if (lvlIdx === this.levels.length - 1 || !level.P || !level.R) {
      if (level.coarseCholeskyL) {
        solveDenseCholeskyF32(level.coarseCholeskyL, n, b, x);
      } else if (level.coarseDenseLU) {
        solveDenseLUF32(level.coarseDenseLU.lu, level.coarseDenseLU.piv, n, b, x);
      }
      return;
    }

    // 1. Pre-smoothing in f32
    this.smoothF32(level, b, x);

    // 2. Residual res = b - A * x in f32
    spmvCsrF32(level.A, x, level.res);
    for (let i = 0; i < n; i++) {
      level.res[i] = b[i]! - level.res[i]!;
    }

    // 3. Restrict residual to coarse grid: r_c = R * res
    const coarseRhs = level.coarseRhs!;
    const coarseSol = level.coarseSol!;
    spmvRectF32(level.R, level.res, coarseRhs);
    coarseSol.fill(0.0);

    // 4. Coarse-grid correction
    this.vcycleRecursiveF32(lvlIdx + 1, coarseRhs, coarseSol);

    // 5. Prolongate and update: x += P * e_c
    spmvRectAddF32(level.P, coarseSol, x);

    // 6. Post-smoothing in f32
    this.smoothF32(level, b, x);
  }

  private smoothF32(level: AmgLevelF32, b: Float32Array, x: Float32Array): void {
    const { A, diagInv, res, tmp } = level;
    const n = A.n;

    if (this.smootherType === "jacobi") {
      const omega = level.omegaSmooth;
      for (let s = 0; s < this.smootherSweeps; s++) {
        spmvCsrF32(A, x, res);
        for (let i = 0; i < n; i++) {
          x[i] = x[i]! + omega * diagInv[i]! * (b[i]! - res[i]!);
        }
      }
      return;
    }

    // 1st-kind Chebyshev polynomial smoother on [0.2 * rho, 1.05 * rho] in f32
    const lambdaMax = 1.05 * level.rhoEst;
    const lambdaMin = 0.2 * level.rhoEst;
    const theta = 0.5 * (lambdaMax + lambdaMin);
    const delta = 0.5 * (lambdaMax - lambdaMin);
    const invTheta = 1.0 / theta;

    spmvCsrF32(A, x, res);
    for (let i = 0; i < n; i++) {
      const di = invTheta * diagInv[i]! * (b[i]! - res[i]!);
      tmp[i] = di;
      x[i] = x[i]! + di;
    }

    if (this.smootherSweeps <= 1) return;

    const sigma1 = theta / delta;
    let rhoPrev = 1.0 / sigma1;
    for (let k = 1; k < this.smootherSweeps; k++) {
      const rhoCurr = 1.0 / (2.0 * sigma1 - rhoPrev);
      const beta = rhoCurr * rhoPrev;
      const alpha = (2.0 * rhoCurr) / delta;
      spmvCsrF32(A, x, res);
      for (let i = 0; i < n; i++) {
        const di = beta * tmp[i]! + alpha * diagInv[i]! * (b[i]! - res[i]!);
        tmp[i] = di;
        x[i] = x[i]! + di;
      }
      rhoPrev = rhoCurr;
    }
  }
}

function dot64(a: Float64Array, b: Float64Array): number {
  let s = 0.0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function norm2_64(a: Float64Array): number {
  return Math.sqrt(dot64(a, a));
}

function dot32(a: Float32Array, b: Float32Array): number {
  let s = 0.0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function norm2_32(a: Float32Array): number {
  return Math.sqrt(dot32(a, a));
}

/**
 * Solve SPD linear system A * x = b using Mixed-Precision Flexible PCG (FPCG)
 * with Polak-Ribière beta = z_{k+1}^T (r_{k+1} - r_k) / (z_k^T r_k) in `f64`
 * around an `f32` Smoothed-Aggregation AMG V-cycle preconditioner.
 *
 * The Polak-Ribière update restores A-conjugacy against `f32` preconditioning noise,
 * achieving full `f64` accuracy (< 1e-10) with ~50% lower preconditioner value bandwidth.
 */
export function solvePcgMixedPrecisionAmg(
  A: CsrMatrix,
  b: Float64Array,
  options: PcgAmgOptions = {},
): MixedPrecisionPcgResult {
  const n = A.n;
  const tol = options.tolerance ?? 1e-10;
  const maxIter = options.maxIterations ?? 1000;
  const x = options.x0 ? new Float64Array(options.x0) : new Float64Array(n);

  const precond = new MixedPrecisionAmgPreconditioner(A, options.amg);
  const memStats = {
    preconditionerBytesF32: precond.preconditionerBytesF32,
    equivalentBytesF64: precond.equivalentBytesF64,
    bandwidthReductionPct: precond.bandwidthReductionPct,
  };

  const bNorm = norm2_64(b);
  if (bNorm === 0.0) {
    return { x, iterations: 0, residualNorm: 0.0, converged: true, ...memStats };
  }

  const r = new Float64Array(n);
  const rPrev = new Float64Array(n);
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  const Ap = new Float64Array(n);

  // r = b - A * x in f64
  spmvCsr(A, x, Ap);
  for (let i = 0; i < n; i++) r[i] = b[i]! - Ap[i]!;

  let relRes = norm2_64(r) / bNorm;
  if (relRes <= tol) {
    return { x, iterations: 0, residualNorm: relRes, converged: true, ...memStats };
  }

  precond.applyVcycleF32(r, z);
  p.set(z);
  let rz = dot64(r, z);

  let iter = 0;
  for (iter = 1; iter <= maxIter; iter++) {
    spmvCsr(A, p, Ap);
    const pAp = dot64(p, Ap);
    if (pAp <= 1e-30) break;

    const alpha = rz / pAp;
    for (let i = 0; i < n; i++) {
      rPrev[i] = r[i]!;
      x[i] = x[i]! + alpha * p[i]!;
      r[i] = r[i]! - alpha * Ap[i]!;
    }

    relRes = norm2_64(r) / bNorm;
    if (relRes <= tol) {
      // Verify true f64 residual to guard against recursive residual drift
      spmvCsr(A, x, Ap);
      for (let i = 0; i < n; i++) r[i] = b[i]! - Ap[i]!;
      relRes = norm2_64(r) / bNorm;
      if (relRes <= tol) {
        return { x, iterations: iter, residualNorm: relRes, converged: true, ...memStats };
      }
    }

    precond.applyVcycleF32(r, z);
    const rzNew = dot64(r, z);
    if (Math.abs(rz) <= 1e-30) break;

    // Polak-Ribière Flexible PCG: beta = z_{k+1}^T (r_{k+1} - r_k) / (z_k^T r_k)
    let zDotDeltaR = 0.0;
    for (let i = 0; i < n; i++) {
      zDotDeltaR += z[i]! * (r[i]! - rPrev[i]!);
    }
    const beta = zDotDeltaR / rz;

    for (let i = 0; i < n; i++) {
      p[i] = z[i]! + beta * p[i]!;
    }
    rz = rzNew;
  }

  // Compute exact final f64 residual
  spmvCsr(A, x, Ap);
  for (let i = 0; i < n; i++) r[i] = b[i]! - Ap[i]!;
  relRes = norm2_64(r) / bNorm;

  return { x, iterations: iter, residualNorm: relRes, converged: relRes <= tol, ...memStats };
}

/**
 * Solve SPD linear system A * x = b using Mixed-Precision Iterative Refinement:
 *   - Outer loop computes exact `f64` defect r = b - A * x and updates x += delta in `f64`.
 *   - Inner loop solves A_f32 * delta_f32 ≈ r_f32 entirely in `f32` using AMG-PCG
 *     with `MixedPrecisionAmgPreconditioner`.
 */
export function solveMixedPrecisionIterativeRefinement(
  A: CsrMatrix,
  b: Float64Array,
  options: IterativeRefinementOptions = {},
): IterativeRefinementResult {
  const n = A.n;
  const tol = options.tolerance ?? 1e-10;
  const maxOuter = options.maxOuterIterations ?? 10;
  const innerTol = options.innerTolerance ?? 1e-5;
  const innerMaxIter = options.innerMaxIterations ?? 25;
  const x = options.x0 ? new Float64Array(options.x0) : new Float64Array(n);

  const precond = new MixedPrecisionAmgPreconditioner(A, options.amg);
  const AF32 = precond.fineMatrixF32;
  const memStats = {
    preconditionerBytesF32: precond.preconditionerBytesF32,
    equivalentBytesF64: precond.equivalentBytesF64,
    bandwidthReductionPct: precond.bandwidthReductionPct,
  };

  const bNorm = norm2_64(b);
  if (bNorm === 0.0) {
    return {
      x,
      iterations: 0,
      outerIterations: 0,
      innerIterations: 0,
      residualNorm: 0.0,
      converged: true,
      ...memStats,
    };
  }

  // Outer f64 vectors
  const r64 = new Float64Array(n);
  const Ax64 = new Float64Array(n);

  // Inner f32 PCG vectors (reused across all outer refinement steps)
  const delta32 = new Float32Array(n);
  const r32 = new Float32Array(n);
  const rPrev32 = new Float32Array(n);
  const z32 = new Float32Array(n);
  const p32 = new Float32Array(n);
  const Ap32 = new Float32Array(n);

  // Initial f64 defect
  spmvCsr(A, x, Ax64);
  for (let i = 0; i < n; i++) r64[i] = b[i]! - Ax64[i]!;
  let relRes = norm2_64(r64) / bNorm;
  if (relRes <= tol) {
    return {
      x,
      iterations: 0,
      outerIterations: 0,
      innerIterations: 0,
      residualNorm: relRes,
      converged: true,
      ...memStats,
    };
  }

  let outerIter = 0;
  let totalInnerIters = 0;

  for (outerIter = 1; outerIter <= maxOuter; outerIter++) {
    // Normalize f64 defect before casting to f32
    let maxAbs = 0.0;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(r64[i]!);
      if (a > maxAbs) maxAbs = a;
    }
    if (maxAbs === 0.0) break;

    const invScale = 1.0 / maxAbs;
    for (let i = 0; i < n; i++) {
      r32[i] = r64[i]! * invScale;
    }
    delta32.fill(0.0);

    const rhsNorm32 = norm2_32(r32);
    if (rhsNorm32 === 0.0) break;

    // Inner f32 Flexible PCG solve: A_f32 * delta32 = r32
    precond.applyVcycleRawF32(r32, z32);
    p32.set(z32);
    let rz = dot32(r32, z32);

    for (let k = 1; k <= innerMaxIter; k++) {
      totalInnerIters++;
      spmvCsrF32(AF32, p32, Ap32);
      const pAp = dot32(p32, Ap32);
      if (pAp <= 1e-30) break;

      const alpha = rz / pAp;
      for (let i = 0; i < n; i++) {
        rPrev32[i] = r32[i]!;
        delta32[i] = delta32[i]! + alpha * p32[i]!;
        r32[i] = r32[i]! - alpha * Ap32[i]!;
      }

      if (norm2_32(r32) / rhsNorm32 <= innerTol) break;

      precond.applyVcycleRawF32(r32, z32);
      const rzNew = dot32(r32, z32);
      if (Math.abs(rz) <= 1e-30) break;

      let zDotDeltaR = 0.0;
      for (let i = 0; i < n; i++) {
        zDotDeltaR += z32[i]! * (r32[i]! - rPrev32[i]!);
      }
      const beta = zDotDeltaR / rz;

      for (let i = 0; i < n; i++) {
        p32[i] = z32[i]! + beta * p32[i]!;
      }
      rz = rzNew;
    }

    // Promote f32 correction to f64 and accumulate into x
    for (let i = 0; i < n; i++) {
      x[i] = x[i]! + delta32[i]! * maxAbs;
    }

    // Recompute exact f64 defect r = b - A * x
    spmvCsr(A, x, Ax64);
    for (let i = 0; i < n; i++) r64[i] = b[i]! - Ax64[i]!;
    relRes = norm2_64(r64) / bNorm;
    if (relRes <= tol) {
      return {
        x,
        iterations: totalInnerIters,
        outerIterations: outerIter,
        innerIterations: totalInnerIters,
        residualNorm: relRes,
        converged: true,
        ...memStats,
      };
    }
  }

  return {
    x,
    iterations: totalInnerIters,
    outerIterations: outerIter,
    innerIterations: totalInnerIters,
    residualNorm: relRes,
    converged: relRes <= tol,
    ...memStats,
  };
}
