// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Star-Set Reachability Kernels in WebAssembly linear memory:
 * - Exact affine map S' = M * S
 * - Halfspace intersection h^T (c + V alpha) <= gamma
 * - Tight coordinate interval hull extraction with isolated constraint tightening
 */

/**
 * Exact affine transformation: outCenter = M * center, outBasis[:, m] = M * basis[:, m].
 * - mPtr: row-major f64[outDim * inDim]
 * - centerPtr: f64[inDim]
 * - basisPtr: column-major f64[numBasis * inDim] (col j starts at j * inDim)
 * - outCenterPtr: f64[outDim]
 * - outBasisPtr: column-major f64[numBasis * outDim]
 */
export function star_linearMap(
  mPtr: usize,
  outDim: i32,
  inDim: i32,
  centerPtr: usize,
  basisPtr: usize,
  numBasis: i32,
  outCenterPtr: usize,
  outBasisPtr: usize,
): void {
  // outCenter = M * center
  for (let i: i32 = 0; i < outDim; i++) {
    const mRowOff = <usize>(i * inDim);
    let sum: f64 = 0.0;
    for (let j: i32 = 0; j < inDim; j++) {
      sum += load<f64>(mPtr + ((mRowOff + <usize>j) << 3)) * load<f64>(centerPtr + (<usize>j << 3));
    }
    store<f64>(outCenterPtr + (<usize>i << 3), sum);
  }

  // outBasis[:, col] = M * basis[:, col]
  for (let col: i32 = 0; col < numBasis; col++) {
    const inColOff = <usize>(col * inDim);
    const outColOff = <usize>(col * outDim);
    for (let i: i32 = 0; i < outDim; i++) {
      const mRowOff = <usize>(i * inDim);
      let sum: f64 = 0.0;
      for (let j: i32 = 0; j < inDim; j++) {
        sum +=
          load<f64>(mPtr + ((mRowOff + <usize>j) << 3)) *
          load<f64>(basisPtr + ((inColOff + <usize>j) << 3));
      }
      store<f64>(outBasisPtr + ((outColOff + <usize>i) << 3), sum);
    }
  }
}

/**
 * Halfspace intersection: writes row[j] = h^T * basis[:, j] into outRowPtr[numBasis],
 * and returns bound = gamma - h^T * center.
 */
export function star_intersectHalfspace(
  hPtr: usize,
  gamma: f64,
  dim: i32,
  centerPtr: usize,
  basisPtr: usize,
  numBasis: i32,
  outRowPtr: usize,
): f64 {
  let hDotC: f64 = 0.0;
  for (let i: i32 = 0; i < dim; i++) {
    hDotC += load<f64>(hPtr + (<usize>i << 3)) * load<f64>(centerPtr + (<usize>i << 3));
  }

  for (let j: i32 = 0; j < numBasis; j++) {
    const colOff = <usize>(j * dim);
    let sum: f64 = 0.0;
    for (let i: i32 = 0; i < dim; i++) {
      sum += load<f64>(hPtr + (<usize>i << 3)) * load<f64>(basisPtr + ((colOff + <usize>i) << 3));
    }
    store<f64>(outRowPtr + (<usize>j << 3), sum);
  }

  return gamma - hDotC;
}

/**
 * Computes tight coordinate interval hull [outLoPtr[i], outHiPtr[i]] for i in 0..dim-1,
 * tightening alphaLoPtr/alphaHiPtr in-place using isolated single-variable constraints of C*alpha <= d.
 * Returns 1 if feasible, 0 if empty/infeasible.
 */
export function star_toIntervals(
  dim: i32,
  numBasis: i32,
  numConstraints: i32,
  centerPtr: usize,
  basisPtr: usize,
  cPtr: usize,
  dPtr: usize,
  alphaLoPtr: usize,
  alphaHiPtr: usize,
  outLoPtr: usize,
  outHiPtr: usize,
): i32 {
  for (let k: i32 = 0; k < numConstraints; k++) {
    const rowOff = <usize>(k * numBasis);
    const bound = load<f64>(dPtr + (<usize>k << 3));

    let singleIdx: i32 = -1;
    let nonZeroCount: i32 = 0;
    for (let j: i32 = 0; j < numBasis; j++) {
      if (load<f64>(cPtr + ((rowOff + <usize>j) << 3)) != 0.0) {
        singleIdx = j;
        nonZeroCount++;
        if (nonZeroCount > 1) break;
      }
    }

    if (nonZeroCount == 1 && singleIdx >= 0) {
      const cVal = load<f64>(cPtr + ((rowOff + <usize>singleIdx) << 3));
      const limit = bound / cVal;
      const loAddr = alphaLoPtr + (<usize>singleIdx << 3);
      const hiAddr = alphaHiPtr + (<usize>singleIdx << 3);
      let lo = load<f64>(loAddr);
      let hi = load<f64>(hiAddr);
      if (cVal > 0.0) {
        if (limit < hi) {
          hi = limit;
          store<f64>(hiAddr, hi);
        }
      } else {
        if (limit > lo) {
          lo = limit;
          store<f64>(loAddr, lo);
        }
      }
      if (lo > hi) {
        for (let i: i32 = 0; i < dim; i++) {
          store<f64>(outLoPtr + (<usize>i << 3), Infinity);
          store<f64>(outHiPtr + (<usize>i << 3), -Infinity);
        }
        return 0;
      }
    }
  }

  for (let i: i32 = 0; i < dim; i++) {
    let minVal = load<f64>(centerPtr + (<usize>i << 3));
    let maxVal = minVal;
    for (let j: i32 = 0; j < numBasis; j++) {
      const coeff = load<f64>(basisPtr + ((<usize>(j * dim) + <usize>i) << 3));
      const bLo = load<f64>(alphaLoPtr + (<usize>j << 3));
      const bHi = load<f64>(alphaHiPtr + (<usize>j << 3));
      if (coeff >= 0.0) {
        minVal += coeff * bLo;
        maxVal += coeff * bHi;
      } else {
        minVal += coeff * bHi;
        maxVal += coeff * bLo;
      }
    }
    store<f64>(outLoPtr + (<usize>i << 3), minVal);
    store<f64>(outHiPtr + (<usize>i << 3), maxVal);
  }

  return 1;
}
