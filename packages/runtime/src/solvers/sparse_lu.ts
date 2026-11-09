// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Gilbert-Peierls Left-Looking Sparse LU Factorization.
 *
 * Implements high-performance sparse LU decomposition with partial pivoting
 * for Compressed Column Storage (CCS) matrices in WebAssembly linear memory and typed arrays,
 * with automatic fallback to SIMD dense LU.
 *
 * Academic Citations:
 *   - Gilbert, J. R., & Peierls, T. (1988). "Sparse partial pivoting in time proportional
 *     to arithmetic operations." SIAM Journal on Scientific and Statistical Computing, 9(5),
 *     pp. 862–874. DOI: 10.1137/0909058.
 *   - Davis, T. A. (2006). Direct Methods for Sparse Linear Systems. SIAM.
 *     ISBN: 978-0-898716-13-9. (CSparse / KLU Sparse Factorization Algorithms)
 */

import { luFactor, luSolve } from "./wasm_gaussian.js";

/**
 * Numerical Compressed Column Storage (CCS) sparse matrix with 64-bit float values.
 */
export interface SparseCCSMatrix {
  nRows: number;
  nCols: number;
  colPtr: Int32Array;
  rowIndices: Int32Array;
  values: Float64Array;
  nnz: number;
}

/** Backwards-compatible alias for numerical CCS matrices. */
export type CCSNumericMatrix = SparseCCSMatrix;

/**
 * Precomputed Gilbert-Peierls Sparse LU factorized structure (P * A * Q = L * U).
 */
export interface SparseLU {
  n: number;
  lColPtr: Int32Array;
  lRowIndices: Int32Array;
  lValues: Float64Array;
  uColPtr: Int32Array;
  uRowIndices: Int32Array;
  uValues: Float64Array;
  uDiagInv: Float64Array;
  perm: Int32Array;
  permInv: Int32Array;
  colPerm?: Int32Array | undefined;
  scratchY: Float64Array;
}

export interface SparseLuOptions {
  /** Whether to perturb near-zero pivots (< 1e-14) to 1e-6 instead of returning null. */
  allowPerturbation?: boolean | undefined;
  /** Whether to apply Approximate Minimum Degree (AMD / Tinney-2) column pre-ordering. Default: true for n >= 48. */
  useAmdOrdering?: boolean | undefined;
  /** Optional precomputed column permutation Q of length n. */
  colPerm?: Int32Array | undefined;
  /** Threshold partial pivoting tolerance in (0, 1]. Default: 0.1 when AMD ordering is active, 1.0 otherwise. */
  pivotThreshold?: number | undefined;
}

export interface FactorizedLinearSolver {
  isSparse: boolean;
  solve(rhs: Float64Array): void;
}

/**
 * Zero-GC Triplet (COO) sparse matrix accumulator that converts directly to Compressed Column Storage (CCS)
 * in O(n + nnz) time without allocating an N x N dense buffer. Duplicate (row, col) entries are summed.
 */
export class SparseTripletBuilder {
  public readonly nRows: number;
  public readonly nCols: number;
  private rows: Int32Array;
  private cols: Int32Array;
  private vals: Float64Array;
  private count = 0;

  constructor(nRows: number, nCols: number, initialCapacity = Math.max(64, 6 * Math.max(nRows, nCols))) {
    this.nRows = nRows;
    this.nCols = nCols;
    const cap = Math.max(16, initialCapacity);
    this.rows = new Int32Array(cap);
    this.cols = new Int32Array(cap);
    this.vals = new Float64Array(cap);
  }

  public clear(): void {
    this.count = 0;
  }

  public get length(): number {
    return this.count;
  }

  public add(row: number, col: number, value: number): void {
    if (Math.abs(value) <= 1e-16) return;
    if (row < 0 || row >= this.nRows || col < 0 || col >= this.nCols) return;
    const idx = this.count;
    if (idx >= this.rows.length) {
      const nextCap = this.rows.length * 2;
      const nextRows = new Int32Array(nextCap);
      const nextCols = new Int32Array(nextCap);
      const nextVals = new Float64Array(nextCap);
      nextRows.set(this.rows);
      nextCols.set(this.cols);
      nextVals.set(this.vals);
      this.rows = nextRows;
      this.cols = nextCols;
      this.vals = nextVals;
    }
    this.rows[idx] = row;
    this.cols[idx] = col;
    this.vals[idx] = value;
    this.count = idx + 1;
  }

  /**
   * Compresses accumulated triplets into a deduplicated, row-sorted CCS matrix in O(nCols + nRows + nnz) time.
   */
  public toCCS(tol = 1e-15): SparseCCSMatrix {
    const nRows = this.nRows;
    const nCols = this.nCols;
    const m = this.count;

    // 1. Bucket triplets by column using counting sort
    const colCounts = new Int32Array(nCols + 1);
    for (let k = 0; k < m; k++) {
      colCounts[this.cols[k]! + 1]!++;
    }
    for (let c = 0; c < nCols; c++) {
      colCounts[c + 1] = colCounts[c + 1]! + colCounts[c]!;
    }

    const sortedRows = new Int32Array(m);
    const sortedVals = new Float64Array(m);
    const cursor = new Int32Array(colCounts);
    for (let k = 0; k < m; k++) {
      const c = this.cols[k]!;
      const dest = cursor[c]!;
      cursor[c] = dest + 1;
      sortedRows[dest] = this.rows[k]!;
      sortedVals[dest] = this.vals[k]!;
    }

    // 2. Deduplicate and sum entries within each column, sorting row indices
    const colPtr = new Int32Array(nCols + 1);
    const rowWorkspace = new Float64Array(nRows);
    const rowMarker = new Int32Array(nRows).fill(-1);
    const activeRows = new Int32Array(nRows);

    const outRows: number[] = [];
    const outVals: number[] = [];

    for (let c = 0; c < nCols; c++) {
      colPtr[c] = outVals.length;
      const start = colCounts[c]!;
      const end = colCounts[c + 1]!;
      let nActive = 0;

      for (let p = start; p < end; p++) {
        const r = sortedRows[p]!;
        const v = sortedVals[p]!;
        if (rowMarker[r] !== c) {
          rowMarker[r] = c;
          rowWorkspace[r] = v;
          activeRows[nActive++] = r;
        } else {
          rowWorkspace[r] = rowWorkspace[r]! + v;
        }
      }

      // Sort active rows in ascending order for canonical CCS layout
      const sub = activeRows.subarray(0, nActive);
      sub.sort();

      for (let k = 0; k < nActive; k++) {
        const r = sub[k]!;
        const v = rowWorkspace[r]!;
        if (Math.abs(v) > tol) {
          outRows.push(r);
          outVals.push(v);
        }
      }
    }
    colPtr[nCols] = outVals.length;

    return {
      nRows,
      nCols,
      colPtr,
      rowIndices: new Int32Array(outRows),
      values: new Float64Array(outVals),
      nnz: outVals.length,
    };
  }
}

/**
 * Computes a Tinney Scheme-2 / Approximate Minimum Degree (AMD) column ordering permutation `colPerm`
 * on the symmetrized sparsity pattern |A| + |A|^T to minimize LU fill-in on power grid and circuit matrices.
 */
export function computeAmdOrdering(A: SparseCCSMatrix): Int32Array {
  const n = A.nCols;
  const colPerm = new Int32Array(n);
  if (n <= 4) {
    for (let i = 0; i < n; i++) colPerm[i] = i;
    return colPerm;
  }

  // Build symmetrized adjacency sets for A + A^T (excluding self-loops)
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let c = 0; c < n; c++) {
    const start = A.colPtr[c] ?? 0;
    const end = A.colPtr[c + 1] ?? 0;
    for (let p = start; p < end; p++) {
      const r = A.rowIndices[p]!;
      if (r !== c && r >= 0 && r < n) {
        adj[c]!.add(r);
        adj[r]!.add(c);
      }
    }
  }

  // Degree bucket double-linked structure for O(1) minimum-degree selection
  const degree = new Int32Array(n);
  const head = new Int32Array(n + 1).fill(-1);
  const next = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const eliminated = new Uint8Array(n);

  const insertBucket = (node: number, deg: number): void => {
    const d = Math.max(0, Math.min(n, deg));
    degree[node] = d;
    const h = head[d]!;
    next[node] = h;
    prev[node] = -1;
    if (h >= 0) prev[h] = node;
    head[d] = node;
  };

  const removeBucket = (node: number): void => {
    const d = degree[node]!;
    const p = prev[node]!;
    const nx = next[node]!;
    if (p >= 0) {
      next[p] = nx;
    } else {
      head[d] = nx;
    }
    if (nx >= 0) {
      prev[nx] = p;
    }
    prev[node] = -1;
    next[node] = -1;
  };

  let minDeg = n;
  for (let i = 0; i < n; i++) {
    const d = adj[i]!.size;
    insertBucket(i, d);
    if (d < minDeg) minDeg = d;
  }

  const neighbors: number[] = [];
  for (let step = 0; step < n; step++) {
    while (minDeg <= n && head[minDeg] === -1) {
      minDeg++;
    }
    const piv = head[minDeg]!;
    removeBucket(piv);
    eliminated[piv] = 1;
    colPerm[step] = piv;

    const pivSet = adj[piv]!;
    neighbors.length = 0;
    for (const nb of pivSet) {
      if (!eliminated[nb]) {
        neighbors.push(nb);
      }
    }
    pivSet.clear();

    // Form clique among uneliminated neighbors (bounded degree update to keep ordering O(nnz))
    const kLen = neighbors.length;
    for (let a = 0; a < kLen; a++) {
      const u = neighbors[a]!;
      const uSet = adj[u]!;
      uSet.delete(piv);
      if (kLen <= 32) {
        for (let b = a + 1; b < kLen; b++) {
          const v = neighbors[b]!;
          uSet.add(v);
          adj[v]!.add(u);
        }
      }
    }

    for (let a = 0; a < kLen; a++) {
      const u = neighbors[a]!;
      removeBucket(u);
      const newDeg = adj[u]!.size;
      insertBucket(u, newDeg);
      if (newDeg < minDeg) minDeg = newDeg;
    }
  }

  return colPerm;
}

/**
 * Converts a dense square matrix Float64Array[] to a Compressed Column Storage (CCS) matrix.
 */
export function denseToCCS(dense: Float64Array[], n: number, tol = 1e-15): SparseCCSMatrix {
  let nnz = 0;
  for (let r = 0; r < n; r++) {
    const row = dense[r];
    if (!row) continue;
    for (let c = 0; c < n; c++) {
      if (Math.abs(row[c] ?? 0) > tol) nnz++;
    }
  }

  const colPtr = new Int32Array(n + 1);
  const rowIndices = new Int32Array(nnz);
  const values = new Float64Array(nnz);
  let pos = 0;

  for (let col = 0; col < n; col++) {
    colPtr[col] = pos;
    for (let row = 0; row < n; row++) {
      const val = dense[row]?.[col] ?? 0;
      if (Math.abs(val) > tol) {
        rowIndices[pos] = row;
        values[pos] = val;
        pos++;
      }
    }
  }
  colPtr[n] = pos;

  return {
    nRows: n,
    nCols: n,
    colPtr,
    rowIndices,
    values,
    nnz,
  };
}

/**
 * Converts a contiguous row-major flat 1D Float64Array (n x n) to a Compressed Column Storage (CCS) matrix.
 */
export function flatToCCS(A: Float64Array, n: number, tol = 1e-15): SparseCCSMatrix {
  let nnz = 0;
  const total = n * n;
  for (let i = 0; i < total; i++) {
    if (Math.abs(A[i] ?? 0) > tol) nnz++;
  }

  const colPtr = new Int32Array(n + 1);
  const rowIndices = new Int32Array(nnz);
  const values = new Float64Array(nnz);
  let pos = 0;

  for (let col = 0; col < n; col++) {
    colPtr[col] = pos;
    for (let row = 0; row < n; row++) {
      const val = A[row * n + col] ?? 0;
      if (Math.abs(val) > tol) {
        rowIndices[pos] = row;
        values[pos] = val;
        pos++;
      }
    }
  }
  colPtr[n] = pos;

  return {
    nRows: n,
    nCols: n,
    colPtr,
    rowIndices,
    values,
    nnz,
  };
}

/**
 * Gilbert-Peierls left-looking Sparse LU Factorization with Reachability DFS (`cs_spsolve`),
 * Threshold Partial Pivoting, and optional Tinney-2 / AMD Column Ordering.
 * Computes P * A * Q = L * U in time proportional to arithmetic operations O(flops + nnz(L+U)).
 *
 * @param A Sparse CCS matrix
 * @param allowPerturbationOrOptions Boolean perturbation flag or SparseLuOptions object
 * @returns SparseLU factors or null if singular (when perturbation is disabled)
 */
export function sparseLuFactor(
  A: SparseCCSMatrix,
  allowPerturbationOrOptions: boolean | SparseLuOptions = true,
): SparseLU | null {
  const n = A.nCols;
  const opts: SparseLuOptions =
    typeof allowPerturbationOrOptions === "boolean"
      ? { allowPerturbation: allowPerturbationOrOptions }
      : allowPerturbationOrOptions;

  const allowPerturbation = opts.allowPerturbation ?? true;
  const useAmd = opts.useAmdOrdering ?? n >= 48;
  const colPerm = opts.colPerm ?? (useAmd ? computeAmdOrdering(A) : undefined);
  const pivotThreshold = opts.pivotThreshold ?? (colPerm ? 0.1 : 1.0);

  const perm = new Int32Array(n);
  // pinv[origRow] = pivot step k (0..n-1), or -1 if origRow has not been pivoted yet
  const pinv = new Int32Array(n).fill(-1);

  const lColPtrList: number[] = [0];
  const lRowIndicesList: number[] = [];
  const lValuesList: number[] = [];

  const uColPtrList: number[] = [0];
  const uRowIndicesList: number[] = [];
  const uValuesList: number[] = [];
  const uDiagInv = new Float64Array(n);

  const denseX = new Float64Array(n);
  // Topological reach list in xi[top..n-1]
  const xi = new Int32Array(n);
  // Stamp array marked with current column step `k` so we never do an O(n) fill between columns
  const visited = new Int32Array(n).fill(-1);
  const dfsStackRow = new Int32Array(n);
  const dfsStackPtr = new Int32Array(n);
  let fallbackUnpivotedCursor = 0;

  for (let k = 0; k < n; k++) {
    const col = colPerm ? colPerm[k]! : k;
    const aStart = A.colPtr[col] ?? 0;
    const aEnd = A.colPtr[col + 1] ?? 0;

    // 1. Gilbert-Peierls Reachability DFS (`cs_reach`) over columns 0..k-1 of L
    let top = n;
    for (let p = aStart; p < aEnd; p++) {
      const startRow = A.rowIndices[p]!;
      if (visited[startRow] === k) continue;

      let stackTop = 0;
      dfsStackRow[0] = startRow;
      const j0 = pinv[startRow]!;
      dfsStackPtr[0] = j0 >= 0 ? lColPtrList[j0]! + 1 : 0;
      visited[startRow] = k;

      while (stackTop >= 0) {
        const currRow = dfsStackRow[stackTop]!;
        const j = pinv[currRow]!;
        if (j >= 0) {
          const lEnd = lColPtrList[j + 1]!;
          let lp = dfsStackPtr[stackTop]!;
          while (lp < lEnd && visited[lRowIndicesList[lp]!] === k) {
            lp++;
          }
          dfsStackPtr[stackTop] = lp + 1;
          if (lp < lEnd) {
            const childRow = lRowIndicesList[lp]!;
            visited[childRow] = k;
            stackTop++;
            dfsStackRow[stackTop] = childRow;
            const cj = pinv[childRow]!;
            dfsStackPtr[stackTop] = cj >= 0 ? lColPtrList[cj]! + 1 : 0;
            continue;
          }
        }
        xi[--top] = currRow;
        stackTop--;
      }
    }

    // 2. Scatter non-zeros of A(:, col) into denseX
    for (let p = aStart; p < aEnd; p++) {
      const r = A.rowIndices[p]!;
      denseX[r] = A.values[p]!;
    }

    // 3. Sparse triangular solve L(0..k-1) * u = A(:, col) along topological order xi[top..n-1]
    for (let px = top; px < n; px++) {
      const r = xi[px]!;
      const j = pinv[r]!;
      if (j < 0) continue;
      const xj = denseX[r]!;
      if (Math.abs(xj) <= 1e-16) continue;

      const lStart = lColPtrList[j]! + 1;
      const lEnd = lColPtrList[j + 1]!;
      for (let lp = lStart; lp < lEnd; lp++) {
        const lr = lRowIndicesList[lp]!;
        denseX[lr] = denseX[lr]! - xj * lValuesList[lp]!;
      }
    }

    // 4. Threshold Partial Pivoting among unpivoted rows in xi[top..n-1]
    let maxVal = -1.0;
    let pivotRow = -1;
    for (let px = top; px < n; px++) {
      const r = xi[px]!;
      if (pinv[r]! < 0) {
        const absVal = Math.abs(denseX[r]!);
        if (absVal > maxVal) {
          maxVal = absVal;
          pivotRow = r;
        }
      }
    }

    // Prefer structural diagonal entry `r === col` if it satisfies threshold stability |x[col]| >= alpha * maxVal
    if (
      pivotThreshold < 1.0 &&
      pinv[col]! < 0 &&
      maxVal > 0 &&
      Math.abs(denseX[col]!) >= pivotThreshold * maxVal &&
      Math.abs(denseX[col]!) >= 1e-12
    ) {
      pivotRow = col;
      maxVal = Math.abs(denseX[col]!);
    }

    if (pivotRow < 0 || maxVal < 1e-14) {
      if (!allowPerturbation) {
        for (let px = top; px < n; px++) {
          denseX[xi[px]!] = 0;
        }
        return null;
      }
      if (pivotRow < 0) {
        if (pinv[col]! < 0) {
          pivotRow = col;
        } else {
          while (fallbackUnpivotedCursor < n && pinv[fallbackUnpivotedCursor]! >= 0) {
            fallbackUnpivotedCursor++;
          }
          pivotRow = fallbackUnpivotedCursor < n ? fallbackUnpivotedCursor : 0;
        }
      }
      denseX[pivotRow] = 1e-6;
      maxVal = 1e-6;
    }

    pinv[pivotRow] = k;
    perm[k] = pivotRow;

    const pivotVal = denseX[pivotRow]!;
    const invPivot = 1.0 / pivotVal;
    uDiagInv[k] = invPivot;

    // 5. Append U(:, k) entries (rows j = pinv[r] < k) and diagonal k
    for (let px = top; px < n; px++) {
      const r = xi[px]!;
      const j = pinv[r]!;
      if (j >= 0 && j < k) {
        const val = denseX[r]!;
        if (Math.abs(val) > 1e-15) {
          uRowIndicesList.push(j);
          uValuesList.push(val);
        }
      }
    }
    uRowIndicesList.push(k);
    uValuesList.push(pivotVal);
    uColPtrList.push(uValuesList.length);

    // 6. Append L(:, k) unit diagonal (original row pivotRow) and unpivoted off-diagonals
    lRowIndicesList.push(pivotRow);
    lValuesList.push(1.0);
    for (let px = top; px < n; px++) {
      const r = xi[px]!;
      if (pinv[r]! < 0) {
        const val = denseX[r]! * invPivot;
        if (Math.abs(val) > 1e-15) {
          lRowIndicesList.push(r);
          lValuesList.push(val);
        }
      }
    }
    lColPtrList.push(lValuesList.length);

    // 7. Zero out only touched entries in denseX
    denseX[pivotRow] = 0;
    for (let px = top; px < n; px++) {
      denseX[xi[px]!] = 0;
    }
  }

  // Map L row indices from original row space to permuted pivot index pinv[r] in 0..n-1
  const lLen = lRowIndicesList.length;
  const lRowIndices = new Int32Array(lLen);
  for (let p = 0; p < lLen; p++) {
    lRowIndices[p] = pinv[lRowIndicesList[p]!]!;
  }

  return {
    n,
    lColPtr: new Int32Array(lColPtrList),
    lRowIndices,
    lValues: new Float64Array(lValuesList),
    uColPtr: new Int32Array(uColPtrList),
    uRowIndices: new Int32Array(uRowIndicesList),
    uValues: new Float64Array(uValuesList),
    uDiagInv,
    perm,
    permInv: pinv,
    colPerm,
    scratchY: new Float64Array(n),
  };
}

/**
 * Solves (P * A * Q) (Q^T * x) = L * U * (Q^T * x) = P * b using the precomputed Sparse LU factors
 * with zero per-step memory allocations.
 */
export function sparseLuSolve(lu: SparseLU, b: Float64Array, outX?: Float64Array): Float64Array {
  const n = lu.n;
  const y = lu.scratchY;
  const x = outX && outX.length >= n ? outX : new Float64Array(n);
  const colPerm = lu.colPerm;

  // 1. Permute RHS: y = P * b
  for (let i = 0; i < n; i++) {
    y[i] = b[lu.perm[i]!] ?? 0;
  }

  // 2. Forward substitution: L * z = y (Unit diagonal)
  for (let col = 0; col < n; col++) {
    const diagVal = y[col]!;
    if (Math.abs(diagVal) < 1e-15) continue;

    const start = lu.lColPtr[col] ?? 0;
    const end = lu.lColPtr[col + 1] ?? 0;
    for (let p = start + 1; p < end; p++) {
      const row = lu.lRowIndices[p] ?? 0;
      const lVal = lu.lValues[p] ?? 0;
      y[row] = y[row]! - diagVal * lVal;
    }
  }

  // 3. Back substitution: U * w = z and x = Q * w
  for (let col = n - 1; col >= 0; col--) {
    const start = lu.uColPtr[col] ?? 0;
    const end = lu.uColPtr[col + 1] ?? 0;

    const solCol = y[col]! * lu.uDiagInv[col]!;
    if (colPerm) {
      x[colPerm[col]!] = solCol;
    } else {
      x[col] = solCol;
    }

    for (let p = start; p < end; p++) {
      const row = lu.uRowIndices[p] ?? 0;
      if (row < col) {
        const uVal = lu.uValues[p] ?? 0;
        y[row] = y[row]! - solCol * uVal;
      }
    }
  }

  return x;
}

/**
 * Solves a sparse linear system A * x = b directly from a SparseCCSMatrix in-place (overwriting b with x)
 * without allocating any dense N x N matrix.
 */
export function solveSparseCCS(A: SparseCCSMatrix, b: Float64Array, options?: SparseLuOptions): boolean {
  const lu = sparseLuFactor(A, options ?? { allowPerturbation: false });
  if (!lu) return false;
  const scratchX = new Float64Array(A.nCols);
  sparseLuSolve(lu, b, scratchX);
  b.set(scratchX);
  return true;
}

/**
 * Universal linear matrix factorization factory.
 * Automatically chooses between dense SIMD LU and Gilbert-Peierls Sparse LU
 * based on matrix dimension and sparsity pattern.
 */
export function factorizeLinearMatrix(
  W: Float64Array[],
  n: number,
  options: {
    linearSolver?: "auto" | "dense" | "sparse" | undefined;
    sparseThreshold?: number | undefined;
  } = {},
): FactorizedLinearSolver {
  const solverType = options.linearSolver ?? "auto";
  const sparseThreshold = options.sparseThreshold ?? 25;

  const useSparse = solverType === "sparse" || (solverType === "auto" && n >= sparseThreshold);

  if (useSparse) {
    const ccs = denseToCCS(W, n);
    const lu = sparseLuFactor(ccs);
    if (lu) {
      const scratchX = new Float64Array(n);
      return {
        isSparse: true,
        solve(rhs: Float64Array): void {
          sparseLuSolve(lu, rhs, scratchX);
          rhs.set(scratchX);
        },
      };
    }
  }

  // Fallback to dense LU
  const denseLu = luFactor(W, n);
  return {
    isSparse: false,
    solve(rhs: Float64Array): void {
      luSolve(denseLu, rhs);
    },
  };
}

/**
 * Solves a linear system A * x = b in-place (overwriting b with x),
 * automatically selecting between dense Gaussian elimination and Gilbert-Peierls Sparse LU
 * based on the matrix dimension.
 *
 * @param A Row-major flat Float64Array (n x n)
 * @param b Float64Array RHS vector of length n (overwritten with solution)
 * @param n Dimension of square matrix
 * @param options Configuration options
 * @returns true if solved successfully, false if singular
 */
export function solveLinearSystemSparse(
  A: Float64Array,
  b: Float64Array,
  n: number,
  options: {
    sparseThreshold?: number | undefined;
    linearSolver?: "auto" | "dense" | "sparse" | undefined;
  } = {},
): boolean {
  const solver = options.linearSolver ?? "auto";
  const threshold = options.sparseThreshold ?? 30;
  const useSparse = solver === "sparse" || (solver === "auto" && n >= threshold);

  if (useSparse) {
    const ccs = flatToCCS(A, n);
    const lu = sparseLuFactor(ccs, false);
    if (lu) {
      const scratchX = new Float64Array(n);
      sparseLuSolve(lu, b, scratchX);
      b.set(scratchX);
      return true;
    }
    // If sparse factorization reports singularity, fall back to dense check
  }

  // Dense LU with partial pivoting
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    let maxVal = Math.abs(A[i * n + i] ?? 0);
    for (let k = i + 1; k < n; k++) {
      const val = Math.abs(A[k * n + i] ?? 0);
      if (val > maxVal) {
        maxVal = val;
        maxRow = k;
      }
    }

    if (maxVal < 1e-12) return false;

    if (maxRow !== i) {
      for (let c = i; c < n; c++) {
        const tmpA = A[i * n + c] ?? 0;
        A[i * n + c] = A[maxRow * n + c] ?? 0;
        A[maxRow * n + c] = tmpA;
      }
      const tmpB = b[i] ?? 0;
      b[i] = b[maxRow] ?? 0;
      b[maxRow] = tmpB;
    }

    const pivot = A[i * n + i]!;
    for (let k = i + 1; k < n; k++) {
      const factor = (A[k * n + i] ?? 0) / pivot;
      for (let c = i; c < n; c++) {
        const curA = A[k * n + c] ?? 0;
        const subA = A[i * n + c] ?? 0;
        A[k * n + c] = curA - factor * subA;
      }
      const curB = b[k] ?? 0;
      const subB = b[i] ?? 0;
      b[k] = curB - factor * subB;
    }
  }

  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i] ?? 0;
    for (let c = i + 1; c < n; c++) {
      sum -= (A[i * n + c] ?? 0) * (b[c] ?? 0);
    }
    const diag = A[i * n + i]!;
    b[i] = Math.abs(diag) > 1e-12 ? sum / diag : 0;
  }

  return true;
}
