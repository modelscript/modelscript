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
 * Precomputed Gilbert-Peierls Sparse LU factorized structure (PA = LU).
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
  scratchY: Float64Array;
}

export interface FactorizedLinearSolver {
  isSparse: boolean;
  solve(rhs: Float64Array): void;
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
 * Gilbert-Peierls left-looking Sparse LU Factorization with Partial Pivoting.
 * Computes P * A = L * U.
 *
 * @param A Sparse CCS matrix
 * @param allowPerturbation If true, near-zero pivots are perturbed to 1e-6 to avoid singularity
 * @returns SparseLU factors or null if singular (when perturbation is disabled)
 */
export function sparseLuFactor(A: SparseCCSMatrix, allowPerturbation = true): SparseLU | null {
  const n = A.nCols;
  const perm = new Int32Array(n);
  const permInv = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    perm[i] = i;
    permInv[i] = i;
  }

  const lColPtrList: number[] = [0];
  const lRowIndicesList: number[] = [];
  const lValuesList: number[] = [];

  const uColPtrList: number[] = [0];
  const uRowIndicesList: number[] = [];
  const uValuesList: number[] = [];
  const uDiagInv = new Float64Array(n);

  const denseX = new Float64Array(n);
  const touched = new Uint8Array(n);

  for (let k = 0; k < n; k++) {
    // 1. Unpack column k of A into dense accumulator
    denseX.fill(0);
    touched.fill(0);

    const aStart = A.colPtr[k] ?? 0;
    const aEnd = A.colPtr[k + 1] ?? 0;
    for (let p = aStart; p < aEnd; p++) {
      const r = A.rowIndices[p] ?? 0;
      const val = A.values[p] ?? 0;
      const permR = permInv[r] ?? r;
      denseX[permR] = val;
      touched[permR] = 1;
    }

    // 2. Triangular solve with previously computed L columns: L[0..k-1] * u = a_k
    for (let j = 0; j < k; j++) {
      const xj = denseX[j]!;
      if (Math.abs(xj) < 1e-15) continue;

      const lStart = lColPtrList[j] ?? 0;
      const lEnd = lColPtrList[j + 1] ?? 0;
      for (let p = lStart + 1; p < lEnd; p++) {
        const r = lRowIndicesList[p] ?? 0;
        const lVal = lValuesList[p] ?? 0;
        denseX[r] = denseX[r]! - xj * lVal;
        touched[r] = 1;
      }
    }

    // 3. Partial Pivoting: Find maximum entry in denseX[k..n-1]
    let maxVal = Math.abs(denseX[k]!);
    let pivotRow = k;

    for (let r = k + 1; r < n; r++) {
      const val = Math.abs(denseX[r]!);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = r;
      }
    }

    if (maxVal < 1e-14) {
      if (!allowPerturbation) {
        return null;
      }
      denseX[k] = 1e-6; // Numerical perturbation for near-singular pivot
      maxVal = 1e-6;
    }

    // Swap pivot rows
    if (pivotRow !== k) {
      const tmp = denseX[k]!;
      denseX[k] = denseX[pivotRow]!;
      denseX[pivotRow] = tmp;

      const origK = perm[k]!;
      const origPiv = perm[pivotRow]!;
      perm[k] = origPiv;
      perm[pivotRow] = origK;
      permInv[origPiv] = k;
      permInv[origK] = pivotRow;

      // Permute row indices k <-> pivotRow in previously factored columns of L
      for (let p = 0; p < lRowIndicesList.length; p++) {
        const rIdx = lRowIndicesList[p];
        if (rIdx === k) {
          lRowIndicesList[p] = pivotRow;
        } else if (rIdx === pivotRow) {
          lRowIndicesList[p] = k;
        }
      }
    }

    const pivotVal = denseX[k]!;
    const invPivot = 1.0 / pivotVal;
    uDiagInv[k] = invPivot;

    // 4. Store U factor column k (rows 0..k)
    for (let r = 0; r <= k; r++) {
      const val = denseX[r]!;
      if (Math.abs(val) > 1e-15 || r === k) {
        uRowIndicesList.push(r);
        uValuesList.push(val);
      }
    }
    uColPtrList.push(uValuesList.length);

    // 5. Store L factor column k (rows k..n-1, unit diagonal)
    lRowIndicesList.push(k);
    lValuesList.push(1.0); // Unit diagonal

    for (let r = k + 1; r < n; r++) {
      const val = denseX[r]!;
      if (Math.abs(val) > 1e-15) {
        lRowIndicesList.push(r);
        lValuesList.push(val * invPivot);
      }
    }
    lColPtrList.push(lValuesList.length);
  }

  for (let i = 0; i < n; i++) {
    permInv[perm[i]!] = i;
  }

  return {
    n,
    lColPtr: new Int32Array(lColPtrList),
    lRowIndices: new Int32Array(lRowIndicesList),
    lValues: new Float64Array(lValuesList),
    uColPtr: new Int32Array(uColPtrList),
    uRowIndices: new Int32Array(uRowIndicesList),
    uValues: new Float64Array(uValuesList),
    uDiagInv,
    perm,
    permInv,
    scratchY: new Float64Array(n),
  };
}

/**
 * Solves (P * A) x = L * U * x = P * b using the precomputed Sparse LU factors
 * with zero per-step memory allocations.
 */
export function sparseLuSolve(lu: SparseLU, b: Float64Array, outX?: Float64Array): Float64Array {
  const n = lu.n;
  const y = lu.scratchY;
  const x = outX && outX.length >= n ? outX : new Float64Array(n);

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

  // 3. Back substitution: U * x = z
  for (let col = n - 1; col >= 0; col--) {
    const start = lu.uColPtr[col] ?? 0;
    const end = lu.uColPtr[col + 1] ?? 0;

    const solCol = y[col]! * lu.uDiagInv[col]!;
    x[col] = solCol;

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
