// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — WebAssembly Linear-Memory Continuous Zonotope Kernel.
 *
 * Implements zero-allocation, cache-optimized reachability operations over zonotopes:
 *   Z = { c + \sum_{i=1}^p \alpha_i g_i | \alpha_i \in [-1, 1] }
 *
 * Academic Citations:
 *   - Girard, A. (2005). "Reachability of uncertain linear systems using zonotopes."
 *     Hybrid Systems: Computation and Control (HSCC), LNCS 3414, pp. 291–305.
 *   - Althoff, M., Stursberg, O., & Buss, M. (2008). "Reachability analysis of nonlinear
 *     systems with uncertain parameters using conservative linearization."
 *     IEEE CDC 2008, pp. 4042–4048.
 */

/**
 * Computes tight axis-aligned bounding box intervals [lo_i, hi_i] of a zonotope in linear memory.
 *   radius_i = \sum_{j=0}^{p-1} |G_{i, j}|
 *   lo_i = c_i - radius_i
 *   hi_i = c_i + radius_i
 *
 * @param dim State dimension n.
 * @param numGens Number of generators p.
 * @param centerPtr Pointer to center vector (n * f64).
 * @param gensPtr Pointer to generator matrix (n * p * f64, row-major: gens[i * p + j]).
 * @param outLoPtr Pointer to output lower bounds (n * f64).
 * @param outHiPtr Pointer to output upper bounds (n * f64).
 */
export function zonotope_bounds(
  dim: i32,
  numGens: i32,
  centerPtr: usize,
  gensPtr: usize,
  outLoPtr: usize,
  outHiPtr: usize,
): void {
  for (let i: i32 = 0; i < dim; i++) {
    let c = load<f64>(centerPtr + (<usize>i << 3));
    let rowOffset = gensPtr + (<usize>(i * numGens) << 3);
    let rad: f64 = 0.0;

    let j: i32 = 0;
    let j4 = numGens - 3;
    while (j < j4) {
      let g0 = load<f64>(rowOffset + (<usize>j << 3));
      let g1 = load<f64>(rowOffset + (<usize>(j + 1) << 3));
      let g2 = load<f64>(rowOffset + (<usize>(j + 2) << 3));
      let g3 = load<f64>(rowOffset + (<usize>(j + 3) << 3));
      rad += Math.abs(g0) + Math.abs(g1) + Math.abs(g2) + Math.abs(g3);
      j += 4;
    }
    while (j < numGens) {
      rad += Math.abs(load<f64>(rowOffset + (<usize>j << 3)));
      j++;
    }

    store<f64>(outLoPtr + (<usize>i << 3), c - rad);
    store<f64>(outHiPtr + (<usize>i << 3), c + rad);
  }
}

/**
 * Applies a linear transformation A to a zonotope Z = <c, G>:
 *   c' = A * c
 *   G' = A * G
 *
 * @param dim State dimension n (square matrix n x n).
 * @param numGens Number of generators p.
 * @param matPtr Pointer to matrix A (n * n * f64, row-major).
 * @param centerPtr Pointer to center c (n * f64).
 * @param gensPtr Pointer to generator matrix G (n * p * f64, row-major).
 * @param outCenterPtr Pointer to transformed center c' (n * f64).
 * @param outGensPtr Pointer to transformed generator matrix G' (n * p * f64, row-major).
 */
export function zonotope_linear_transform(
  dim: i32,
  numGens: i32,
  matPtr: usize,
  centerPtr: usize,
  gensPtr: usize,
  outCenterPtr: usize,
  outGensPtr: usize,
): void {
  // 1. Transform center: c' = A * c
  for (let i: i32 = 0; i < dim; i++) {
    let sum: f64 = 0.0;
    let rowA = matPtr + (<usize>(i * dim) << 3);
    for (let k: i32 = 0; k < dim; k++) {
      let a_ik = load<f64>(rowA + (<usize>k << 3));
      let c_k = load<f64>(centerPtr + (<usize>k << 3));
      sum += a_ik * c_k;
    }
    store<f64>(outCenterPtr + (<usize>i << 3), sum);
  }

  // 2. Transform generators: G' = A * G
  // G is n x p row-major. For each generator column j in [0, p-1]:
  for (let i: i32 = 0; i < dim; i++) {
    let rowA = matPtr + (<usize>(i * dim) << 3);
    let rowOutG = outGensPtr + (<usize>(i * numGens) << 3);

    for (let j: i32 = 0; j < numGens; j++) {
      let sum: f64 = 0.0;
      for (let k: i32 = 0; k < dim; k++) {
        let a_ik = load<f64>(rowA + (<usize>k << 3));
        let g_kj = load<f64>(gensPtr + (<usize>(k * numGens + j) << 3));
        sum += a_ik * g_kj;
      }
      store<f64>(rowOutG + (<usize>j << 3), sum);
    }
  }
}

/**
 * Computes the Minkowski sum of two zonotopes:
 *   <c1, G1> \oplus <c2, G2> = <c1 + c2, [G1, G2]>
 *
 * @param dim State dimension n.
 * @param p1 Generator count of Z1.
 * @param p2 Generator count of Z2.
 * @param c1Ptr Pointer to c1.
 * @param g1Ptr Pointer to G1 (n x p1).
 * @param c2Ptr Pointer to c2.
 * @param g2Ptr Pointer to G2 (n x p2).
 * @param outCPtr Pointer to out center c1 + c2 (n * f64).
 * @param outGPtr Pointer to out generators [G1, G2] (n x (p1 + p2)).
 */
export function zonotope_minkowski_sum(
  dim: i32,
  p1: i32,
  p2: i32,
  c1Ptr: usize,
  g1Ptr: usize,
  c2Ptr: usize,
  g2Ptr: usize,
  outCPtr: usize,
  outGPtr: usize,
): void {
  let totalGens = p1 + p2;

  // Center sum
  for (let i: i32 = 0; i < dim; i++) {
    let c1 = load<f64>(c1Ptr + (<usize>i << 3));
    let c2 = load<f64>(c2Ptr + (<usize>i << 3));
    store<f64>(outCPtr + (<usize>i << 3), c1 + c2);
  }

  // Concatenate generator matrices row-by-row
  for (let i: i32 = 0; i < dim; i++) {
    let rowOut = outGPtr + (<usize>(i * totalGens) << 3);
    let rowG1 = g1Ptr + (<usize>(i * p1) << 3);
    let rowG2 = g2Ptr + (<usize>(i * p2) << 3);

    // Copy G1
    memory.copy(rowOut, rowG1, (<usize>p1) << 3);
    // Copy G2
    memory.copy(rowOut + ((<usize>p1) << 3), rowG2, (<usize>p2) << 3);
  }
}

/**
 * Computes the extreme support vector in a given normal direction d:
 *   x^*(d) = c + \sum_{j=0}^{p-1} sign(g_j^T d) * g_j
 *
 * Used for counterexample falsification witness search and support function evaluation.
 *
 * @param dim State dimension n.
 * @param numGens Number of generators p.
 * @param centerPtr Pointer to center (n * f64).
 * @param gensPtr Pointer to generator matrix G (n x p, row-major).
 * @param dirPtr Pointer to direction vector d (n * f64).
 * @param outPointPtr Pointer to extreme support point x* (n * f64).
 */
export function zonotope_extreme_point(
  dim: i32,
  numGens: i32,
  centerPtr: usize,
  gensPtr: usize,
  dirPtr: usize,
  outPointPtr: usize,
): void {
  // Initialize outPoint with center c
  memory.copy(outPointPtr, centerPtr, (<usize>dim) << 3);

  // For each generator j in [0, p-1]:
  for (let j: i32 = 0; j < numGens; j++) {
    // Compute dot product g_j^T * d
    let dot: f64 = 0.0;
    for (let i: i32 = 0; i < dim; i++) {
      let g_ij = load<f64>(gensPtr + (<usize>(i * numGens + j) << 3));
      let d_i = load<f64>(dirPtr + (<usize>i << 3));
      dot += g_ij * d_i;
    }

    let sign: f64 = dot >= 0.0 ? 1.0 : -1.0;

    // Add sign * g_j to outPoint
    for (let i: i32 = 0; i < dim; i++) {
      let g_ij = load<f64>(gensPtr + (<usize>(i * numGens + j) << 3));
      let cur = load<f64>(outPointPtr + (<usize>i << 3));
      store<f64>(outPointPtr + (<usize>i << 3), cur + sign * g_ij);
    }
  }
}

/**
 * Girard (2005) zonotope generator reduction.
 * If numGens <= maxGens, simply copies gens to outGens.
 * Otherwise, partitions generators into:
 *   - The top (maxGens - dim) largest generators by L1-norm (preserved exactly).
 *   - The remaining smallest generators, which are condensed into an axis-aligned bounding box
 *     forming dim diagonal generators.
 *
 * @param dim State dimension n.
 * @param numGens Number of input generators p.
 * @param maxGens Maximum target generators allowed.
 * @param gensPtr Pointer to input generator matrix (n x p, row-major).
 * @param outGensPtr Pointer to reduced generator matrix (n x targetCount, row-major).
 * @param scratchPtr Scratch buffer of size at least (p * 16) bytes for sorting keys [norm: f64, idx: i64].
 * @return The final number of generators in the reduced zonotope.
 */
export function zonotope_reduce_girard(
  dim: i32,
  numGens: i32,
  maxGens: i32,
  gensPtr: usize,
  outGensPtr: usize,
  scratchPtr: usize,
): i32 {
  if (numGens <= maxGens) {
    memory.copy(outGensPtr, gensPtr, (<usize>(dim * numGens)) << 3);
    return numGens;
  }

  let preservedCount = maxGens > dim ? maxGens - dim : 0;
  let finalGensCount = preservedCount + dim;

  // 1. Compute L1 norms for each generator j: scratch[j] = [norm: f64, idx: i32]
  for (let j: i32 = 0; j < numGens; j++) {
    let norm: f64 = 0.0;
    for (let i: i32 = 0; i < dim; i++) {
      let g_ij = load<f64>(gensPtr + (<usize>(i * numGens + j) << 3));
      norm += Math.abs(g_ij);
    }
    // Store in scratch: 16 bytes per entry: [norm: f64 (offset 0), idx: i32 (offset 8)]
    let entryPtr = scratchPtr + (<usize>j << 4);
    store<f64>(entryPtr, norm);
    store<i32>(entryPtr + 8, j);
  }

  // 2. Sort scratch entries by norm descending using insertion sort
  for (let i: i32 = 1; i < numGens; i++) {
    let keyPtr = scratchPtr + (<usize>i << 4);
    let keyNorm = load<f64>(keyPtr);
    let keyIdx = load<i32>(keyPtr + 8);

    let k = i - 1;
    while (k >= 0) {
      let prevPtr = scratchPtr + (<usize>k << 4);
      let prevNorm = load<f64>(prevPtr);
      if (prevNorm < keyNorm) {
        let nextPtr = scratchPtr + (<usize>(k + 1) << 4);
        store<f64>(nextPtr, prevNorm);
        store<i32>(nextPtr + 8, load<i32>(prevPtr + 8));
        k--;
      } else {
        break;
      }
    }
    let targetPtr = scratchPtr + (<usize>(k + 1) << 4);
    store<f64>(targetPtr, keyNorm);
    store<i32>(targetPtr + 8, keyIdx);
  }

  // 3. Copy preserved generators to outGens (first preservedCount columns)
  for (let col: i32 = 0; col < preservedCount; col++) {
    let origJ = load<i32>(scratchPtr + (<usize>col << 4) + 8);
    for (let i: i32 = 0; i < dim; i++) {
      let val = load<f64>(gensPtr + (<usize>(i * numGens + origJ) << 3));
      store<f64>(outGensPtr + (<usize>(i * finalGensCount + col) << 3), val);
    }
  }

  // 4. Condense remaining generators into diagonal box generators (last dim columns)
  // For each dimension i, boxRad_i = \sum_{col=preservedCount}^{numGens-1} |g_{i, origJ}|
  for (let i: i32 = 0; i < dim; i++) {
    let boxRad: f64 = 0.0;
    for (let col = preservedCount; col < numGens; col++) {
      let origJ = load<i32>(scratchPtr + (<usize>col << 4) + 8);
      let val = load<f64>(gensPtr + (<usize>(i * numGens + origJ) << 3));
      boxRad += Math.abs(val);
    }

    // Set the dim box generator columns: column (preservedCount + d) has entry only at row d
    for (let d: i32 = 0; d < dim; d++) {
      let colIdx = preservedCount + d;
      let diagVal: f64 = (i === d) ? boxRad : 0.0;
      store<f64>(outGensPtr + (<usize>(i * finalGensCount + colIdx) << 3), diagVal);
    }
  }

  return finalGensCount;
}
