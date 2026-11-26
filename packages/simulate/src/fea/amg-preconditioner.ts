// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Smoothed-Aggregation Algebraic Multigrid (SA-AMG) Preconditioner
 * and Preconditioned Conjugate Gradient (PCG) Solvers for Large-Scale FEA.
 *
 * Implements:
 *   1. Sparse CSR matrix representation (`CsrMatrix`) and sparse linear algebra kernels
 *   2. Strength-of-connection graph: |A_ij| >= theta * sqrt(|A_ii * A_jj|)
 *   3. Greedy root/pairwise aggregation building tentative prolongator P_0
 *   4. Damped-Jacobi prolongator smoothing: P = (I - omega_P * D^{-1} * A) * P_0
 *   5. Recursive Galerkin coarse operator: A_c = P^T * A * P down to n_c <= 64
 *   6. Direct Cholesky / Gaussian elimination coarse-grid solver
 *   7. Symmetric V-cycle (`applyVcycle`) with GPU-parallelizable damped-Jacobi / Chebyshev smoothers
 *   8. `solvePcgAmg` and `solvePcgJacobi` solvers
 */

export interface CsrMatrix {
  readonly n: number;
  readonly rowOffsets: Int32Array;
  readonly colIndices: Int32Array;
  readonly values: Float64Array;
}

/** Rectangular CSR matrix (rows x cols), used internally for P, R, and sparse products. */
interface RectCsrMatrix {
  readonly rows: number;
  readonly cols: number;
  readonly rowOffsets: Int32Array;
  readonly colIndices: Int32Array;
  readonly values: Float64Array;
}

export interface AmgOptions {
  /** Strength-of-connection threshold theta (default: 0.25). */
  strengthThreshold?: number;
  /** Damping factor for damped-Jacobi smoother (default: auto from spectral radius). */
  omega?: number;
  /** Maximum coarse grid size solved directly (default: 64). */
  maxCoarseSize?: number;
  /** Maximum number of multigrid levels (default: 12). */
  maxLevels?: number;
  /** Number of pre- and post-smoothing sweeps per V-cycle level (default: 2). */
  smootherSweeps?: number;
  /** GPU-parallelizable smoother type (default: "chebyshev"). */
  smoother?: "jacobi" | "chebyshev";
}

export interface PcgOptions {
  /** Relative residual convergence tolerance ||b - A x||_2 / ||b||_2 (default: 1e-8). */
  tolerance?: number;
  /** Maximum PCG iterations (default: 1000). */
  maxIterations?: number;
  /** Optional initial guess (length n). */
  x0?: Float64Array;
}

export interface PcgAmgOptions extends PcgOptions {
  amg?: AmgOptions;
}

export interface PcgSolveResult {
  x: Float64Array;
  iterations: number;
  residualNorm: number;
  converged: boolean;
}

interface AmgLevel {
  A: CsrMatrix;
  invDiag: Float64Array;
  rhoEst: number;
  omegaSmooth: number;
  P?: RectCsrMatrix;
  R?: RectCsrMatrix;
  /** Preallocated workspace vectors for zero-allocation V-cycle execution. */
  res: Float64Array;
  tmp: Float64Array;
  tmp2: Float64Array;
  coarseRhs?: Float64Array;
  coarseSol?: Float64Array;
  /** Coarse direct solver factorization (populated only on the coarsest level). */
  coarseCholeskyL?: Float64Array;
  coarseDenseLU?: { lu: Float64Array; piv: Int32Array };
}

/** Sparse matrix-vector product y = A * x for square CSR matrix A. */
export function spmvCsr(A: CsrMatrix, x: Float64Array, y: Float64Array): void {
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

/** Rectangular sparse matrix-vector product y = M * x. */
function spmvRect(M: RectCsrMatrix, x: Float64Array, y: Float64Array): void {
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

/** Rectangular sparse matrix-vector accumulate y += M * x. */
function spmvRectAdd(M: RectCsrMatrix, x: Float64Array, y: Float64Array): void {
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

/** Extract diagonal entries of CSR matrix A. */
export function extractDiagonal(A: CsrMatrix): Float64Array {
  const { n, rowOffsets, colIndices, values } = A;
  const diag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const start = rowOffsets[i]!;
    const end = rowOffsets[i + 1]!;
    for (let k = start; k < end; k++) {
      if (colIndices[k] === i) {
        diag[i] = values[k]!;
        break;
      }
    }
  }
  return diag;
}

/** Estimate spectral radius rho(D^{-1} A) via power iteration (deterministic seed). */
function estimateSpectralRadius(A: CsrMatrix, invDiag: Float64Array, iters = 15): number {
  const n = A.n;
  if (n === 0) return 1.0;
  const v = new Float64Array(n);
  const w = new Float64Array(n);
  // Deterministic non-uniform initial vector to avoid symmetries with constant/alternating modes
  let normSq = 0.0;
  for (let i = 0; i < n; i++) {
    const val = Math.sin(1.7 * (i + 1)) + 0.5 * Math.cos(3.1 * (i + 1));
    v[i] = val;
    normSq += val * val;
  }
  const invNorm0 = normSq > 0 ? 1.0 / Math.sqrt(normSq) : 1.0;
  for (let i = 0; i < n; i++) v[i] = v[i]! * invNorm0;

  let lambda = 1.0;
  for (let it = 0; it < iters; it++) {
    spmvCsr(A, v, w);
    let rayleigh = 0.0;
    let wNormSq = 0.0;
    for (let i = 0; i < n; i++) {
      const wi = w[i]! * invDiag[i]!;
      w[i] = wi;
      rayleigh += v[i]! * wi;
      wNormSq += wi * wi;
    }
    if (wNormSq <= 1e-30) break;
    const invW = 1.0 / Math.sqrt(wNormSq);
    for (let i = 0; i < n; i++) v[i] = w[i]! * invW;
    lambda = Math.abs(rayleigh);
  }
  return lambda > 1e-12 ? lambda : 1.0;
}

/** Transpose a rectangular CSR matrix M (rows x cols) -> M^T (cols x rows). */
function transposeRectCsr(M: RectCsrMatrix): RectCsrMatrix {
  const { rows, cols, rowOffsets, colIndices, values } = M;
  const nnz = rowOffsets[rows]!;
  const counts = new Int32Array(cols);
  for (let k = 0; k < nnz; k++) {
    const c = colIndices[k]!;
    counts[c] = counts[c]! + 1;
  }
  const tOffsets = new Int32Array(cols + 1);
  for (let j = 0; j < cols; j++) {
    tOffsets[j + 1] = tOffsets[j]! + counts[j]!;
  }
  const tCols = new Int32Array(nnz);
  const tVals = new Float64Array(nnz);
  const cursor = tOffsets.slice(0, cols);
  for (let i = 0; i < rows; i++) {
    const start = rowOffsets[i]!;
    const end = rowOffsets[i + 1]!;
    for (let k = start; k < end; k++) {
      const col = colIndices[k]!;
      const pos = cursor[col]!;
      cursor[col] = pos + 1;
      tCols[pos] = i;
      tVals[pos] = values[k]!;
    }
  }
  return { rows: cols, cols: rows, rowOffsets: tOffsets, colIndices: tCols, values: tVals };
}

/**
 * Sparse-sparse matrix multiplication C = A * B in CSR format using Gustavson's algorithm.
 * Drops entries smaller than dropTol.
 */
function spgemmRectCsr(A: RectCsrMatrix, B: RectCsrMatrix, dropTol = 1e-15): RectCsrMatrix {
  const m = A.rows;
  const n = B.cols;
  const marker = new Int32Array(n).fill(-1);
  const accum = new Float64Array(n);
  const rowCols: number[] = [];

  const outOffsets = new Int32Array(m + 1);
  const outColsList: number[] = [];
  const outValsList: number[] = [];

  for (let i = 0; i < m; i++) {
    rowCols.length = 0;
    const aStart = A.rowOffsets[i]!;
    const aEnd = A.rowOffsets[i + 1]!;
    for (let ka = aStart; ka < aEnd; ka++) {
      const k = A.colIndices[ka]!;
      const aik = A.values[ka]!;
      if (aik === 0.0) continue;
      const bStart = B.rowOffsets[k]!;
      const bEnd = B.rowOffsets[k + 1]!;
      for (let kb = bStart; kb < bEnd; kb++) {
        const j = B.colIndices[kb]!;
        const prod = aik * B.values[kb]!;
        if (marker[j]! !== i) {
          marker[j] = i;
          accum[j] = prod;
          rowCols.push(j);
        } else {
          accum[j] = accum[j]! + prod;
        }
      }
    }
    rowCols.sort((a, b) => a - b);
    for (let idx = 0; idx < rowCols.length; idx++) {
      const j = rowCols[idx]!;
      const val = accum[j]!;
      if (Math.abs(val) > dropTol) {
        outColsList.push(j);
        outValsList.push(val);
      }
    }
    outOffsets[i + 1] = outColsList.length;
  }

  return {
    rows: m,
    cols: n,
    rowOffsets: outOffsets,
    colIndices: Int32Array.from(outColsList),
    values: Float64Array.from(outValsList),
  };
}

/**
 * Build strength-of-connection graph and perform greedy root/pairwise aggregation.
 * Returns aggregate ID per fine DOF (0 .. numAggregates - 1) and numAggregates.
 */
function aggregateGraph(A: CsrMatrix, diag: Float64Array, theta: number): { aggId: Int32Array; numAggs: number } {
  const { n, rowOffsets, colIndices, values } = A;
  const absDiag = new Float64Array(n);
  for (let i = 0; i < n; i++) absDiag[i] = Math.abs(diag[i]!);

  // Build strength-of-connection adjacency lists: |A_ij| >= theta * sqrt(|A_ii * A_jj|)
  const strongNeighbors: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const list: number[] = [];
    const start = rowOffsets[i]!;
    const end = rowOffsets[i + 1]!;
    const di = absDiag[i]!;
    for (let k = start; k < end; k++) {
      const j = colIndices[k]!;
      if (j === i) continue;
      const thresh = theta * Math.sqrt(di * absDiag[j]!);
      if (Math.abs(values[k]!) >= thresh) {
        list.push(j);
      }
    }
    strongNeighbors[i] = list;
  }

  const aggId = new Int32Array(n).fill(-1);
  let numAggs = 0;

  // Phase 1: Greedy root aggregation (Vanek-Mandel-Brezina)
  // Pick unaggregated node i whose strong neighbors are all unaggregated -> form aggregate
  for (let i = 0; i < n; i++) {
    if (aggId[i]! !== -1) continue;
    const nbrs = strongNeighbors[i]!;
    let allFree = true;
    for (let k = 0; k < nbrs.length; k++) {
      if (aggId[nbrs[k]!]! !== -1) {
        allFree = false;
        break;
      }
    }
    if (allFree && nbrs.length > 0) {
      const id = numAggs++;
      aggId[i] = id;
      for (let k = 0; k < nbrs.length; k++) {
        aggId[nbrs[k]!] = id;
      }
    }
  }

  // Phase 2: Attach remaining unaggregated nodes to strongest-coupled existing aggregate
  // (using a snapshot so aggregates don't chain arbitrarily in a single pass)
  const phase1Agg = aggId.slice();
  for (let i = 0; i < n; i++) {
    if (aggId[i]! !== -1) continue;
    let bestAgg = -1;
    let bestWeight = -1.0;
    const start = rowOffsets[i]!;
    const end = rowOffsets[i + 1]!;
    const di = absDiag[i]!;
    for (let k = start; k < end; k++) {
      const j = colIndices[k]!;
      if (j === i) continue;
      const a = phase1Agg[j]!;
      if (a === -1) continue;
      const thresh = theta * Math.sqrt(di * absDiag[j]!);
      const w = Math.abs(values[k]!);
      if (w >= thresh && w > bestWeight) {
        bestWeight = w;
        bestAgg = a;
      }
    }
    if (bestAgg !== -1) {
      aggId[i] = bestAgg;
    }
  }

  // Phase 3: Group any still-unaggregated nodes pairwise with unaggregated strong neighbors,
  // or form singleton aggregates for isolated DOFs
  for (let i = 0; i < n; i++) {
    if (aggId[i]! !== -1) continue;
    const id = numAggs++;
    aggId[i] = id;
    const nbrs = strongNeighbors[i]!;
    for (let k = 0; k < nbrs.length; k++) {
      const j = nbrs[k]!;
      if (aggId[j] === -1) {
        aggId[j] = id;
      }
    }
  }

  return { aggId, numAggs };
}

/** Build tentative prolongator P_0 (n x numAggs) with unit-normalized piecewise-constant columns. */
function buildTentativeProlongator(aggId: Int32Array, numAggs: number): RectCsrMatrix {
  const n = aggId.length;
  const aggSize = new Int32Array(numAggs);
  for (let i = 0; i < n; i++) {
    const a = aggId[i]!;
    aggSize[a] = aggSize[a]! + 1;
  }

  const invSqrtSize = new Float64Array(numAggs);
  for (let a = 0; a < numAggs; a++) {
    const sz = aggSize[a]!;
    invSqrtSize[a] = sz > 0 ? 1.0 / Math.sqrt(sz) : 1.0;
  }

  const rowOffsets = new Int32Array(n + 1);
  const colIndices = new Int32Array(n);
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = aggId[i]!;
    rowOffsets[i] = i;
    colIndices[i] = a;
    values[i] = invSqrtSize[a]!;
  }
  rowOffsets[n] = n;
  return { rows: n, cols: numAggs, rowOffsets, colIndices, values };
}

/** Build smoothed prolongator P = (I - omegaP * D^{-1} * A) * P_0. */
function smoothProlongator(A: CsrMatrix, invDiag: Float64Array, P0: RectCsrMatrix, omegaP: number): RectCsrMatrix {
  const { n, rowOffsets, colIndices, values } = A;
  const nnz = rowOffsets[n]!;
  // Construct smoother operator S = I - omegaP * D^{-1} * A in CSR
  const sValues = new Float64Array(nnz);
  for (let i = 0; i < n; i++) {
    const scale = -omegaP * invDiag[i]!;
    const start = rowOffsets[i]!;
    const end = rowOffsets[i + 1]!;
    for (let k = start; k < end; k++) {
      const j = colIndices[k]!;
      sValues[k] = (j === i ? 1.0 : 0.0) + scale * values[k]!;
    }
  }
  const S: RectCsrMatrix = { rows: n, cols: n, rowOffsets, colIndices, values: sValues };
  return spgemmRectCsr(S, P0);
}

/** Dense Cholesky factorization A = L * L^T (lower triangular stored row-major). Returns null if not SPD. */
function factorizeDenseCholesky(A: Float64Array, n: number): Float64Array | null {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * n + j]!;
      for (let k = 0; k < j; k++) {
        sum -= L[i * n + k]! * L[j * n + k]!;
      }
      if (i === j) {
        if (sum <= 1e-14) return null;
        L[i * n + j] = Math.sqrt(sum);
      } else {
        L[i * n + j] = sum / L[j * n + j]!;
      }
    }
  }
  return L;
}

function solveDenseCholesky(L: Float64Array, n: number, b: Float64Array, x: Float64Array): void {
  // Forward substitution L * y = b
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    const row = i * n;
    for (let j = 0; j < i; j++) sum -= L[row + j]! * x[j]!;
    x[i] = sum / L[row + i]!;
  }
  // Backward substitution L^T * x = y
  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i]!;
    for (let j = i + 1; j < n; j++) sum -= L[j * n + i]! * x[j]!;
    x[i] = sum / L[i * n + i]!;
  }
}

/** Dense LU factorization with partial pivoting (fallback if coarse matrix is near-singular). */
function factorizeDenseLU(A: Float64Array, n: number): { lu: Float64Array; piv: Int32Array } {
  const lu = new Float64Array(A);
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;

  for (let k = 0; k < n; k++) {
    let maxRow = k;
    let maxVal = Math.abs(lu[k * n + k]!);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(lu[i * n + k]!);
      if (v > maxVal) {
        maxVal = v;
        maxRow = i;
      }
    }
    if (maxRow !== k) {
      const tmpP = piv[k]!;
      piv[k] = piv[maxRow]!;
      piv[maxRow] = tmpP;
      for (let j = 0; j < n; j++) {
        const tmp = lu[k * n + j]!;
        lu[k * n + j] = lu[maxRow * n + j]!;
        lu[maxRow * n + j] = tmp;
      }
    }
    const diag = lu[k * n + k]!;
    if (Math.abs(diag) < 1e-15) continue;
    for (let i = k + 1; i < n; i++) {
      const factor = lu[i * n + k]! / diag;
      lu[i * n + k] = factor;
      for (let j = k + 1; j < n; j++) {
        lu[i * n + j] = lu[i * n + j]! - factor * lu[k * n + j]!;
      }
    }
  }
  return { lu, piv };
}

function solveDenseLU(lu: Float64Array, piv: Int32Array, n: number, b: Float64Array, x: Float64Array): void {
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
    x[i] = Math.abs(d) > 1e-15 ? sum / d : 0.0;
  }
}

/**
 * Smoothed-Aggregation Algebraic Multigrid (SA-AMG) Preconditioner.
 *
 * Builds a multigrid hierarchy recursively and exposes a symmetric V-cycle
 * (`applyVcycle`) suitable as a preconditioner for Conjugate Gradient (PCG).
 */
export class SmoothedAggregationAmg {
  public readonly levels: AmgLevel[] = [];
  private readonly smootherSweeps: number;
  private readonly smootherType: "jacobi" | "chebyshev";

  constructor(A: CsrMatrix, options: AmgOptions = {}) {
    const theta = options.strengthThreshold ?? 0.25;
    const maxCoarseSize = options.maxCoarseSize ?? 64;
    const maxLevels = options.maxLevels ?? 12;
    this.smootherSweeps = options.smootherSweeps ?? 2;
    this.smootherType = options.smoother ?? "chebyshev";

    let currentA = A;
    for (let lvl = 0; lvl < maxLevels; lvl++) {
      const n = currentA.n;
      const diag = extractDiagonal(currentA);
      const invDiag = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const d = diag[i]!;
        invDiag[i] = Math.abs(d) > 1e-30 ? 1.0 / d : 1.0;
      }
      const rhoEst = estimateSpectralRadius(currentA, invDiag);
      // Optimal damped-Jacobi relaxation weight strictly < 2 / rho(D^{-1} A)
      const omegaSmooth = options.omega ?? Math.min(0.8, 4.0 / (3.0 * Math.max(rhoEst, 1.0)));

      const level: AmgLevel = {
        A: currentA,
        invDiag,
        rhoEst,
        omegaSmooth,
        res: new Float64Array(n),
        tmp: new Float64Array(n),
        tmp2: new Float64Array(n),
      };
      this.levels.push(level);

      if (n <= maxCoarseSize || lvl === maxLevels - 1) {
        this.factorizeCoarsest(level);
        break;
      }

      // 1. Strength-of-connection & greedy aggregation
      // On coarser levels, Galerkin Dirichlet boundary dominance can reduce off-diagonal/diagonal
      // ratios; if coarsening stalls, progressively relax theta so hierarchy reaches maxCoarseSize.
      let effectiveTheta = theta;
      let { aggId, numAggs } = aggregateGraph(currentA, diag, effectiveTheta);
      while (numAggs > Math.floor(0.85 * n) && effectiveTheta > 1e-6) {
        effectiveTheta *= 0.25;
        ({ aggId, numAggs } = aggregateGraph(currentA, diag, effectiveTheta));
      }
      if (numAggs > Math.floor(0.85 * n)) {
        ({ aggId, numAggs } = aggregateGraph(currentA, diag, 0.0));
      }
      if (numAggs >= n || numAggs === 0) {
        this.factorizeCoarsest(level);
        break;
      }

      // 2. Tentative prolongator P_0
      const P0 = buildTentativeProlongator(aggId, numAggs);

      // 3. Damped-Jacobi prolongator smoothing: P = (I - (4 / (3 * rho)) D^{-1} A) P_0
      const omegaP = 4.0 / (3.0 * Math.max(rhoEst, 1.0));
      const P = smoothProlongator(currentA, invDiag, P0, omegaP);
      const R = transposeRectCsr(P);

      // 4. Galerkin coarse operator: A_c = P^T * A * P
      const ARect: RectCsrMatrix = {
        rows: n,
        cols: n,
        rowOffsets: currentA.rowOffsets,
        colIndices: currentA.colIndices,
        values: currentA.values,
      };
      const AP = spgemmRectCsr(ARect, P);
      const AcRect = spgemmRectCsr(R, AP);
      const Ac: CsrMatrix = {
        n: numAggs,
        rowOffsets: AcRect.rowOffsets,
        colIndices: AcRect.colIndices,
        values: AcRect.values,
      };

      level.P = P;
      level.R = R;
      level.coarseRhs = new Float64Array(numAggs);
      level.coarseSol = new Float64Array(numAggs);
      currentA = Ac;
    }
  }

  /** Number of multigrid levels in the hierarchy. */
  public get numLevels(): number {
    return this.levels.length;
  }

  /** Number of DOFs at the coarsest level. */
  public get coarseSize(): number {
    return this.levels[this.levels.length - 1]!.A.n;
  }

  private factorizeCoarsest(level: AmgLevel): void {
    const { n, rowOffsets, colIndices, values } = level.A;
    const dense = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      const start = rowOffsets[i]!;
      const end = rowOffsets[i + 1]!;
      for (let k = start; k < end; k++) {
        dense[i * n + colIndices[k]!] = values[k]!;
      }
    }
    const L = factorizeDenseCholesky(dense, n);
    if (L) {
      level.coarseCholeskyL = L;
    } else {
      level.coarseDenseLU = factorizeDenseLU(dense, n);
    }
  }

  /**
   * Apply one symmetric V-cycle: computes z = M^{-1} * r.
   * Safe for use as an SPD preconditioner inside Conjugate Gradient (PCG).
   */
  public applyVcycle(r: Float64Array, z: Float64Array): void {
    z.fill(0.0);
    this.vcycleRecursive(0, r, z);
  }

  private vcycleRecursive(lvlIdx: number, b: Float64Array, x: Float64Array): void {
    const level = this.levels[lvlIdx]!;
    const n = level.A.n;

    // Coarsest level: exact direct solve
    if (lvlIdx === this.levels.length - 1 || !level.P || !level.R) {
      if (level.coarseCholeskyL) {
        solveDenseCholesky(level.coarseCholeskyL, n, b, x);
      } else if (level.coarseDenseLU) {
        solveDenseLU(level.coarseDenseLU.lu, level.coarseDenseLU.piv, n, b, x);
      }
      return;
    }

    // 1. Pre-smoothing
    this.smooth(level, b, x);

    // 2. Compute residual res = b - A * x
    spmvCsr(level.A, x, level.res);
    for (let i = 0; i < n; i++) {
      level.res[i] = b[i]! - level.res[i]!;
    }

    // 3. Restrict residual to coarse grid: r_c = R * res
    const coarseRhs = level.coarseRhs!;
    const coarseSol = level.coarseSol!;
    spmvRect(level.R, level.res, coarseRhs);
    coarseSol.fill(0.0);

    // 4. Coarse-grid correction
    this.vcycleRecursive(lvlIdx + 1, coarseRhs, coarseSol);

    // 5. Prolongate and update: x += P * e_c
    spmvRectAdd(level.P, coarseSol, x);

    // 6. Post-smoothing (symmetric to pre-smoothing)
    this.smooth(level, b, x);
  }

  /**
   * GPU-parallelizable symmetric smoother:
   *   - "jacobi": damped Jacobi sweeps x <- x + omega * D^{-1} * (b - A x)
   *   - "chebyshev": 1st-kind Chebyshev polynomial smoother on [0.2 * rho, 1.05 * rho]
   */
  private smooth(level: AmgLevel, b: Float64Array, x: Float64Array): void {
    const { A, invDiag, res, tmp } = level;
    const n = A.n;

    if (this.smootherType === "jacobi") {
      const omega = level.omegaSmooth;
      for (let s = 0; s < this.smootherSweeps; s++) {
        spmvCsr(A, x, res);
        for (let i = 0; i < n; i++) {
          x[i] = x[i]! + omega * invDiag[i]! * (b[i]! - res[i]!);
        }
      }
      return;
    }

    // Chebyshev polynomial smoother (degree = smootherSweeps)
    // Targets high-frequency spectrum [lambdaMin, lambdaMax] = [0.2 * rho, 1.05 * rho]
    const lambdaMax = 1.05 * level.rhoEst;
    const lambdaMin = 0.2 * level.rhoEst;
    const theta = 0.5 * (lambdaMax + lambdaMin);
    const delta = 0.5 * (lambdaMax - lambdaMin);
    const invTheta = 1.0 / theta;

    // Step 0: d_0 = (1 / theta) * D^{-1} * (b - A x), x += d_0
    spmvCsr(A, x, res);
    for (let i = 0; i < n; i++) {
      const di = invTheta * invDiag[i]! * (b[i]! - res[i]!);
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
      spmvCsr(A, x, res);
      for (let i = 0; i < n; i++) {
        const di = beta * tmp[i]! + alpha * invDiag[i]! * (b[i]! - res[i]!);
        tmp[i] = di;
        x[i] = x[i]! + di;
      }
      rhoPrev = rhoCurr;
    }
  }
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0.0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function norm2(a: Float64Array): number {
  return Math.sqrt(dot(a, a));
}

/** Internal PCG driver shared by AMG-PCG and Jacobi-PCG. */
function runPcg(
  A: CsrMatrix,
  b: Float64Array,
  applyPreconditioner: (r: Float64Array, z: Float64Array) => void,
  options: PcgOptions = {},
): PcgSolveResult {
  const n = A.n;
  const tol = options.tolerance ?? 1e-8;
  const maxIter = options.maxIterations ?? 1000;
  const x = options.x0 ? new Float64Array(options.x0) : new Float64Array(n);

  const bNorm = norm2(b);
  if (bNorm === 0.0) {
    return { x, iterations: 0, residualNorm: 0.0, converged: true };
  }

  const r = new Float64Array(n);
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  const Ap = new Float64Array(n);

  // r = b - A * x
  spmvCsr(A, x, Ap);
  for (let i = 0; i < n; i++) r[i] = b[i]! - Ap[i]!;

  let relRes = norm2(r) / bNorm;
  if (relRes <= tol) {
    return { x, iterations: 0, residualNorm: relRes, converged: true };
  }

  applyPreconditioner(r, z);
  p.set(z);
  let rz = dot(r, z);

  let iter = 0;
  for (iter = 1; iter <= maxIter; iter++) {
    spmvCsr(A, p, Ap);
    const pAp = dot(p, Ap);
    if (pAp <= 1e-30) break;

    const alpha = rz / pAp;
    for (let i = 0; i < n; i++) {
      x[i] = x[i]! + alpha * p[i]!;
      r[i] = r[i]! - alpha * Ap[i]!;
    }

    relRes = norm2(r) / bNorm;
    if (relRes <= tol) {
      return { x, iterations: iter, residualNorm: relRes, converged: true };
    }

    applyPreconditioner(r, z);
    const rzNew = dot(r, z);
    if (Math.abs(rz) <= 1e-30) break;
    const beta = rzNew / rz;
    for (let i = 0; i < n; i++) {
      p[i] = z[i]! + beta * p[i]!;
    }
    rz = rzNew;
  }

  return { x, iterations: iter, residualNorm: relRes, converged: relRes <= tol };
}

/**
 * Solve SPD linear system A * x = b using Preconditioned Conjugate Gradient (PCG)
 * with Smoothed-Aggregation Algebraic Multigrid (SA-AMG) V-cycle preconditioning.
 */
export function solvePcgAmg(A: CsrMatrix, b: Float64Array, options: PcgAmgOptions = {}): PcgSolveResult {
  const amg = new SmoothedAggregationAmg(A, options.amg);
  return runPcg(A, b, (r, z) => amg.applyVcycle(r, z), options);
}

/**
 * Solve SPD linear system A * x = b using Preconditioned Conjugate Gradient (PCG)
 * with diagonal Jacobi preconditioning (baseline comparison).
 */
export function solvePcgJacobi(A: CsrMatrix, b: Float64Array, options: PcgOptions = {}): PcgSolveResult {
  const diag = extractDiagonal(A);
  const invDiag = new Float64Array(A.n);
  for (let i = 0; i < A.n; i++) {
    const d = diag[i]!;
    invDiag[i] = Math.abs(d) > 1e-30 ? 1.0 / d : 1.0;
  }
  return runPcg(
    A,
    b,
    (r, z) => {
      for (let i = 0; i < A.n; i++) z[i] = invDiag[i]! * r[i]!;
    },
    options,
  );
}
