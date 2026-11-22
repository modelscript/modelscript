// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Sparse Hessian-of-Lagrangian Star Coloring & Compressed AD Recovery.
 *
 * Implements Gebremedhin–Manne–Pothen (2005) Distance-2 / Star Coloring on symmetric Hessian
 * sparsity graphs (`SparseDiffTools.jl` / `JuMP` / `MadNLP` parity):
 *   - Computes a valid symmetric distance-2 coloring `colors[0..n-1]` using `numColors << n` colors.
 *   - Evaluates the full sparse Hessian `H(x)` in only `numColors` Hessian-vector products
 *     (instead of `O(n)`), directly recovering exact `H_{ij}` entries into a `SparseCCSMatrix`.
 */

import type { SparseCCSMatrix } from "../solvers/sparse_lu.js";

export interface SparseHessianColoringResult {
  /** Number of variables `n`. */
  n: number;
  /** Color assignment `colorOf[i] ∈ [0, numColors - 1]` for each variable `i`. */
  colorOf: Int32Array;
  /** Total number of colors `χ` (number of HVP sweeps required). */
  numColors: number;
  /** Symmetric adjacency list `neighbors[i]` (sorted unique column indices `j` where `H_{ij} != 0`). */
  neighbors: number[][];
}

/**
 * Greedy Distance-2 Coloring of a symmetric Hessian sparsity graph `G = (V, E)`.
 *
 * Guarantees that for every edge `(i, j)` in `E`, all neighbors of `i` have distinct colors
 * (sufficient for direct sparse Hessian recovery without substitution!).
 */
export function computeSymmetricHessianColoring(
  n: number,
  sparsityEdges: [number, number][],
): SparseHessianColoringResult {
  const adjSets: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let i = 0; i < n; i++) adjSets[i]!.add(i); // always include diagonal
  for (const [u, v] of sparsityEdges) {
    if (u >= 0 && u < n && v >= 0 && v < n) {
      adjSets[u]!.add(v);
      adjSets[v]!.add(u);
    }
  }
  const neighbors: number[][] = adjSets.map((s) => Array.from(s).sort((a, b) => a - b));

  // Order vertices by descending degree (Largest-First heuristic)
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => neighbors[b]!.length - neighbors[a]!.length);
  const colorOf = new Int32Array(n).fill(-1);
  const forbidden = new Int32Array(n).fill(-1);
  let numColors = 0;

  for (const v of order) {
    // Mark colors of distance-1 and distance-2 neighbors as forbidden
    for (const u of neighbors[v]!) {
      if (u !== v && colorOf[u]! >= 0) forbidden[colorOf[u]!] = v;
      for (const w of neighbors[u]!) {
        if (w !== v && colorOf[w]! >= 0) forbidden[colorOf[w]!] = v;
      }
    }
    let c = 0;
    while (c < n && forbidden[c] === v) c++;
    colorOf[v] = c;
    if (c + 1 > numColors) numColors = c + 1;
  }

  return { n, colorOf, numColors, neighbors };
}

/**
 * Evaluates a sparse symmetric Hessian `H(x)` in `coloring.numColors` gradient evaluations
 * using compressed directional Hessian-vector products `H(x) * d_c ≈ (∇f(x + ε d_c) - ∇f(x - ε d_c)) / (2ε)`.
 */
export function evaluateCompressedSparseHessian(
  gradFn: (x: Float64Array) => Float64Array,
  x: Float64Array,
  coloring: SparseHessianColoringResult,
  eps = 1e-6,
): { hessian: SparseCCSMatrix; gradEvals: number } {
  const { n, colorOf, numColors, neighbors } = coloring;

  // Seed vectors d_c: (d_c)_j = 1 iff colorOf[j] === c
  const compressedCols: Float64Array[] = new Array(numColors);
  const xPlus = new Float64Array(n);
  const xMinus = new Float64Array(n);
  let gradEvals = 0;

  for (let c = 0; c < numColors; c++) {
    xPlus.set(x);
    xMinus.set(x);
    for (let j = 0; j < n; j++) {
      if (colorOf[j] === c) {
        xPlus[j] = x[j]! + eps;
        xMinus[j] = x[j]! - eps;
      }
    }
    const gPlus = gradFn(xPlus);
    const gMinus = gradFn(xMinus);
    gradEvals += 2;
    const hvp = new Float64Array(n);
    const inv2Eps = 0.5 / eps;
    for (let i = 0; i < n; i++) {
      hvp[i] = (gPlus[i]! - gMinus[i]!) * inv2Eps;
    }
    compressedCols[c] = hvp;
  }

  // Decompress into SparseCCSMatrix: for each column j and row i ∈ neighbors[j],
  // H_{ij} = compressedCols[colorOf[j]][i] (symmetrized with compressedCols[colorOf[i]][j])
  const colPtr = new Int32Array(n + 1);
  let nnz = 0;
  for (let j = 0; j < n; j++) {
    colPtr[j] = nnz;
    nnz += neighbors[j]!.length;
  }
  colPtr[n] = nnz;

  const rowIndices = new Int32Array(nnz);
  const values = new Float64Array(nnz);
  let p = 0;
  for (let j = 0; j < n; j++) {
    const cj = colorOf[j]!;
    for (const i of neighbors[j]!) {
      const ci = colorOf[i]!;
      const hij = compressedCols[cj]![i]!;
      const hji = compressedCols[ci]![j]!;
      rowIndices[p] = i;
      values[p] = 0.5 * (hij + hji);
      p++;
    }
  }

  return {
    hessian: { nRows: n, nCols: n, nnz, colPtr, rowIndices, values },
    gradEvals,
  };
}
