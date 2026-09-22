// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Sparse & Dense Linear Algebra Solver Bridge.
 *
 * Implements Gilbert-Peierls left-looking Sparse LU factorization with partial pivoting
 * for Compressed Column Storage (CCS) matrices, with automatic fallback to SIMD dense LU.
 */

import { luFactor, luSolve } from "@modelscript/runtime/wasm_gaussian.js";

export interface CCSMatrix {
  nRows: number;
  nCols: number;
  colPtr: Int32Array;
  rowIndices: Int32Array;
  values: Float64Array;
  nnz: number;
}

export interface SparseLU {
  n: number;
  lColPtr: Int32Array;
  lRowIndices: Int32Array;
  lValues: Float64Array;
  uColPtr: Int32Array;
  uRowIndices: Int32Array;
  uValues: Float64Array;
  perm: Int32Array;
  permInv: Int32Array;
}

export interface FactorizedLinearSolver {
  isSparse: boolean;
  solve(rhs: Float64Array): void;
}

/**
 * Converts a dense square matrix Float64Array[] to a Compressed Column Storage (CCS) matrix.
 */
export function denseToCCS(dense: Float64Array[], n: number, tol = 1e-15): CCSMatrix {
  const colPtr = new Int32Array(n + 1);
  const rowIndicesList: number[] = [];
  const valuesList: number[] = [];

  for (let col = 0; col < n; col++) {
    colPtr[col] = valuesList.length;
    for (let row = 0; row < n; row++) {
      const val = dense[row]?.[col] ?? 0;
      if (Math.abs(val) > tol) {
        rowIndicesList.push(row);
        valuesList.push(val);
      }
    }
  }
  colPtr[n] = valuesList.length;

  return {
    nRows: n,
    nCols: n,
    colPtr,
    rowIndices: new Int32Array(rowIndicesList),
    values: new Float64Array(valuesList),
    nnz: valuesList.length,
  };
}

/**
 * Gilbert-Peierls left-looking Sparse LU Factorization with Partial Pivoting.
 * Computes P * A = L * U.
 */
export function sparseLuFactor(A: CCSMatrix): SparseLU {
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
      const permR = perm[r] ?? r;
      denseX[permR] = val;
      touched[permR] = 1;
    }

    // 2. Triangular solve with previously computed L columns: L[0..k-1] * u = a_k
    for (let j = 0; j < k; j++) {
      const xj = denseX[j];
      if (Math.abs(xj) < 1e-15) continue;

      const lStart = lColPtrList[j] ?? 0;
      const lEnd = lColPtrList[j + 1] ?? 0;
      for (let p = lStart + 1; p < lEnd; p++) {
        const r = lRowIndicesList[p] ?? 0;
        const lVal = lValuesList[p] ?? 0;
        denseX[r] -= xj * lVal;
        touched[r] = 1;
      }
    }

    // 3. Partial Pivoting: Find maximum entry in denseX[k..n-1]
    let maxVal = Math.abs(denseX[k]);
    let pivotRow = k;

    for (let r = k + 1; r < n; r++) {
      const val = Math.abs(denseX[r]);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = r;
      }
    }

    if (maxVal < 1e-14) {
      denseX[k] = 1e-6; // Numerical perturbation for near-singular pivot
      maxVal = 1e-6;
    }

    // Swap pivot rows
    if (pivotRow !== k) {
      const tmp = denseX[k];
      denseX[k] = denseX[pivotRow];
      denseX[pivotRow] = tmp;

      const pK = perm[k];
      const pPiv = perm[pivotRow];
      perm[k] = pPiv;
      perm[pivotRow] = pK;
    }

    const pivotVal = denseX[k];

    // 4. Store U factor column k (rows 0..k)
    for (let r = 0; r <= k; r++) {
      const val = denseX[r];
      if (Math.abs(val) > 1e-15 || r === k) {
        uRowIndicesList.push(r);
        uValuesList.push(val);
      }
    }
    uColPtrList.push(uValuesList.length);

    // 5. Store L factor column k (rows k..n-1, unit diagonal)
    lRowIndicesList.push(k);
    lValuesList.push(1.0); // Unit diagonal

    const invPivot = 1.0 / pivotVal;
    for (let r = k + 1; r < n; r++) {
      const val = denseX[r];
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
    perm,
    permInv,
  };
}

/**
 * Solves (P * A) x = L * U * x = P * b using the precomputed Sparse LU factors.
 */
export function sparseLuSolve(lu: SparseLU, b: Float64Array, x: Float64Array): void {
  const n = lu.n;
  const y = new Float64Array(n);

  // 1. Permute RHS: y = P * b
  for (let i = 0; i < n; i++) {
    y[lu.perm[i]!] = b[i] ?? 0;
  }

  // 2. Forward substitution: L * z = y (Unit diagonal)
  for (let col = 0; col < n; col++) {
    const diagVal = y[col];
    if (Math.abs(diagVal) < 1e-15) continue;

    const start = lu.lColPtr[col] ?? 0;
    const end = lu.lColPtr[col + 1] ?? 0;
    for (let p = start + 1; p < end; p++) {
      const row = lu.lRowIndices[p] ?? 0;
      const lVal = lu.lValues[p] ?? 0;
      y[row] -= diagVal * lVal;
    }
  }

  // 3. Back substitution: U * x = z
  for (let col = n - 1; col >= 0; col--) {
    const start = lu.uColPtr[col] ?? 0;
    const end = lu.uColPtr[col + 1] ?? 0;

    let diagU = 1.0;
    for (let p = start; p < end; p++) {
      if (lu.uRowIndices[p] === col) {
        diagU = lu.uValues[p] ?? 1.0;
        break;
      }
    }

    const solCol = y[col] / diagU;
    x[col] = solCol;

    for (let p = start; p < end; p++) {
      const row = lu.uRowIndices[p] ?? 0;
      if (row < col) {
        const uVal = lu.uValues[p] ?? 0;
        y[row] -= solCol * uVal;
      }
    }
  }
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
    linearSolver?: "auto" | "dense" | "sparse";
    sparseThreshold?: number;
  } = {},
): FactorizedLinearSolver {
  const solverType = options.linearSolver ?? "auto";
  const sparseThreshold = options.sparseThreshold ?? 25;

  const useSparse = solverType === "sparse" || (solverType === "auto" && n >= sparseThreshold);

  if (useSparse) {
    const ccs = denseToCCS(W, n);
    const lu = sparseLuFactor(ccs);
    const scratchX = new Float64Array(n);

    return {
      isSparse: true,
      solve(rhs: Float64Array): void {
        sparseLuSolve(lu, rhs, scratchX);
        rhs.set(scratchX);
      },
    };
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
