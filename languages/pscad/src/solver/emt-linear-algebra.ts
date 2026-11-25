// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SparseLUFactors } from "@modelscript/runtime";

/**
 * In-place dense LU factorization with partial pivoting for an n x n matrix stored row-major.
 */
export function factorizeDenseLU(A: Float64Array, LU: Float64Array, piv: Int32Array, n: number): boolean {
  LU.set(A);
  for (let i = 0; i < n; i++) piv[i] = i;

  for (let p = 0; p < n; p++) {
    let maxVal = Math.abs(LU[p * n + p]!);
    let maxRow = p;
    for (let r = p + 1; r < n; r++) {
      const val = Math.abs(LU[r * n + p]!);
      if (val > maxVal) {
        maxVal = val;
        maxRow = r;
      }
    }
    if (maxVal < 1e-18) return false;

    if (maxRow !== p) {
      for (let c = 0; c < n; c++) {
        const tmp = LU[p * n + c]!;
        LU[p * n + c] = LU[maxRow * n + c]!;
        LU[maxRow * n + c] = tmp;
      }
      const tmpP = piv[p]!;
      piv[p] = piv[maxRow]!;
      piv[maxRow] = tmpP;
    }

    const pivot = LU[p * n + p]!;
    for (let r = p + 1; r < n; r++) {
      const factor = LU[r * n + p]! / pivot;
      LU[r * n + p] = factor;
      if (factor === 0) continue;
      for (let c = p + 1; c < n; c++) {
        LU[r * n + c] = LU[r * n + c]! - factor * LU[p * n + c]!;
      }
    }
  }
  return true;
}

/**
 * Forward and back substitution using precomputed dense LU factors and pivot permutation.
 */
export function solveDenseLU(LU: Float64Array, piv: Int32Array, b: Float64Array, x: Float64Array, n: number): void {
  for (let i = 0; i < n; i++) {
    x[i] = b[piv[i]!]!;
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      x[i] = x[i]! - LU[i * n + j]! * x[j]!;
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) {
      x[i] = x[i]! - LU[i * n + j]! * x[j]!;
    }
    const diag = LU[i * n + i]!;
    x[i] = Math.abs(diag) > 1e-18 ? x[i]! / diag : 0.0;
  }
}

/**
 * Deep-clones numeric factor arrays of a cached SparseLUFactors structure while sharing immutable symbolic indices.
 */
export function cloneSparseFactors(f: SparseLUFactors): SparseLUFactors {
  return {
    n: f.n,
    lColPtr: f.lColPtr,
    lRowIndices: f.lRowIndices,
    lValues: f.lValues.slice(),
    uColPtr: f.uColPtr,
    uRowIndices: f.uRowIndices,
    uValues: f.uValues.slice(),
    uDiagInv: f.uDiagInv.slice(),
    perm: f.perm.slice(),
    permInv: f.permInv.slice(),
    colPerm: f.colPerm,
    scratchY: new Float64Array(f.n),
    scratchX: f.scratchX ? new Float64Array(f.n) : undefined,
    hasSymbolicPattern: f.hasSymbolicPattern,
  };
}

/**
 * Solves a small dense linear system `A * x = b` in-place via Gaussian elimination with partial pivoting.
 */
export function solveSmallDenseSystem(A: Float64Array, b: Float64Array, x: Float64Array, dim: number): boolean {
  for (let p = 0; p < dim; p++) {
    let maxVal = Math.abs(A[p * dim + p]!);
    let maxRow = p;
    for (let r = p + 1; r < dim; r++) {
      const v = Math.abs(A[r * dim + p]!);
      if (v > maxVal) {
        maxVal = v;
        maxRow = r;
      }
    }
    if (maxVal < 1e-15) return false;
    if (maxRow !== p) {
      for (let c = p; c < dim; c++) {
        const tmp = A[p * dim + c]!;
        A[p * dim + c] = A[maxRow * dim + c]!;
        A[maxRow * dim + c] = tmp;
      }
      const tmpB = b[p]!;
      b[p] = b[maxRow]!;
      b[maxRow] = tmpB;
    }
    const piv = A[p * dim + p]!;
    for (let r = p + 1; r < dim; r++) {
      const fac = A[r * dim + p]! / piv;
      if (fac === 0) continue;
      for (let c = p + 1; c < dim; c++) {
        A[r * dim + c] = A[r * dim + c]! - fac * A[p * dim + c]!;
      }
      b[r] = b[r]! - fac * b[p]!;
    }
  }
  for (let i = dim - 1; i >= 0; i--) {
    let sum = b[i]!;
    for (let c = i + 1; c < dim; c++) {
      sum -= A[i * dim + c]! * x[c]!;
    }
    x[i] = sum / A[i * dim + i]!;
  }
  return true;
}
