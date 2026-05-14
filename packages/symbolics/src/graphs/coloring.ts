// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Distance-2 graph coloring for sparse Jacobian compression.
 *
 * Given the structural sparsity pattern of a Jacobian matrix (in CCS format),
 * assigns colors to columns such that no two columns sharing a non-zero in the
 * same row receive the same color. This enables compressed forward-mode AD:
 * instead of n individual directional derivative evaluations, only `numColors`
 * compressed evaluations are needed.
 *
 * Algorithm: Greedy coloring with largest-first ordering on the column
 * intersection graph (Curtis-Powell-Reid, 1974).
 *
 * Reference:
 *   Curtis, A.R., Powell, M.J.D., & Reid, J.K. (1974),
 *   "On the estimation of sparse Jacobian matrices",
 *   IMA Journal of Applied Mathematics, 13(1), 117-119.
 */

import type { CCSMatrix } from "./sparse.js";

/** Result of column coloring. */
export interface ColoringResult {
  /** Color assigned to each column (0-indexed). Length = nCols. */
  colors: number[];
  /** Total number of distinct colors used. */
  numColors: number;
  /** Columns grouped by color: colorGroups[c] = [col indices with color c]. */
  colorGroups: number[][];
}

/**
 * Compute a distance-2 column coloring of a Jacobian sparsity pattern.
 *
 * Two columns conflict (must have different colors) if they both have a
 * non-zero entry in the same row. This is equivalent to coloring the
 * column intersection graph G_col where:
 *   - Vertices = columns
 *   - Edge (i, j) exists if columns i and j share at least one common row
 *
 * @param ccs    Sparsity pattern in Compressed Column Storage
 * @param nCols  Number of columns (= number of state variables)
 * @returns      Coloring assignment and grouped columns
 */
export function colorJacobianColumns(ccs: CCSMatrix, nCols: number): ColoringResult {
  if (nCols === 0) {
    return { colors: [], numColors: 0, colorGroups: [] };
  }

  // ── Step 1: Build row-to-columns adjacency ──
  // For each row, collect which columns have a non-zero in that row.
  const rowToCols = new Map<number, number[]>();
  for (let col = 0; col < nCols; col++) {
    const start = ccs.col_ptr[col] ?? 0;
    const end = ccs.col_ptr[col + 1] ?? 0;
    for (let p = start; p < end; p++) {
      const row = ccs.row_indices[p] ?? 0;
      let cols = rowToCols.get(row);
      if (!cols) {
        cols = [];
        rowToCols.set(row, cols);
      }
      cols.push(col);
    }
  }

  // ── Step 2: Build column intersection graph (adjacency list) ──
  const neighbors: Set<number>[] = [];
  for (let i = 0; i < nCols; i++) {
    neighbors.push(new Set<number>());
  }

  for (const cols of rowToCols.values()) {
    // All columns sharing this row are mutually conflicting
    for (let i = 0; i < cols.length; i++) {
      for (let j = i + 1; j < cols.length; j++) {
        const ci = cols[i] ?? 0;
        const cj = cols[j] ?? 0;
        const nbCi = neighbors[ci];
        const nbCj = neighbors[cj];
        if (nbCi) nbCi.add(cj);
        if (nbCj) nbCj.add(ci);
      }
    }
  }

  // ── Step 3: Largest-first ordering ──
  // Sort columns by decreasing degree for better greedy coloring quality.
  const order = Array.from({ length: nCols }, (_, i) => i);
  order.sort((a, b) => (neighbors[b]?.size ?? 0) - (neighbors[a]?.size ?? 0));

  // ── Step 4: Greedy coloring ──
  const colors = new Array<number>(nCols).fill(-1);
  let numColors = 0;

  for (const col of order) {
    // Collect colors used by neighbors
    const usedColors = new Set<number>();
    const nbrs = neighbors[col];
    if (nbrs) {
      for (const nbr of nbrs) {
        const c = colors[nbr] ?? -1;
        if (c >= 0) usedColors.add(c);
      }
    }

    // Find smallest available color
    let color = 0;
    while (usedColors.has(color)) color++;
    colors[col] = color;
    if (color >= numColors) numColors = color + 1;
  }

  // ── Step 5: Build color groups ──
  const colorGroups: number[][] = [];
  for (let c = 0; c < numColors; c++) {
    colorGroups.push([]);
  }
  for (let col = 0; col < nCols; col++) {
    const c = colors[col] ?? 0;
    const group = colorGroups[c];
    if (group) group.push(col);
  }

  return { colors, numColors, colorGroups };
}
