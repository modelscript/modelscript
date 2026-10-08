// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Zero-GC Linear Algebra & Matrix Solvers for WASM linear memory.
 * Provides row-equilibrated LU factorization with partial pivoting and
 * dense linear system solvers (Ax = b).
 */

import { UnmanagedInt32Array, UnmanagedFloat64Array, DenseMatrixView } from "../core/array";

/**
 * Factors an n x n dense matrix (flat row-major f64 array at matrixPtr) into PA = LU
 * with row equilibration for numerical stability.
 *
 * @param matrixPtr Pointer to n*n f64 values (overwritten with LU decomposition).
 * @param pivPtr Pointer to n i32 values for pivot permutations.
 * @param scalePtr Pointer to n f64 values for row equilibration scales.
 * @param n Matrix dimension.
 * @returns true if factorization succeeded, false if singular.
 */
export function luFactor(matrixPtr: u32, pivPtr: u32, scalePtr: u32, n: u32): bool {
  let mat = DenseMatrixView.at(matrixPtr as usize, n, n);
  let piv = changetype<UnmanagedInt32Array>(pivPtr as usize);
  let scale = changetype<UnmanagedFloat64Array>(scalePtr as usize);

  // Initialize pivot vector
  for (let i: u32 = 0; i < n; i++) {
    piv[i] = i as i32;
  }

  // Row equilibration: scale each row by 1 / max|entry|
  for (let i: u32 = 0; i < n; i++) {
    let maxVal: f64 = 0.0;
    for (let j: u32 = 0; j < n; j++) {
      let val = Math.abs(mat.get(i, j));
      if (val > maxVal) maxVal = val;
    }

    let s: f64 = maxVal > 1e-30 ? 1.0 / maxVal : 1.0;
    scale[i] = s;

    for (let j: u32 = 0; j < n; j++) {
      mat.set(i, j, mat.get(i, j) * s);
    }
  }

  // Gaussian elimination with partial pivoting
  for (let k: u32 = 0; k < n; k++) {
    // Find pivot in column k
    let maxVal: f64 = Math.abs(mat.get(k, k));
    let maxIdx: u32 = k;

    for (let i: u32 = k + 1; i < n; i++) {
      let val = Math.abs(mat.get(i, k));
      if (val > maxVal) {
        maxVal = val;
        maxIdx = i;
      }
    }

    // Swap pivot rows if needed
    if (maxIdx != k) {
      mat.swapRows(k, maxIdx);

      let tmpPiv = piv[k];
      piv[k] = piv[maxIdx];
      piv[maxIdx] = tmpPiv;

      let tmpScale = scale[k];
      scale[k] = scale[maxIdx];
      scale[maxIdx] = tmpScale;
    }

    let diagVal = mat.get(k, k);
    if (Math.abs(diagVal) < 1e-30) {
      return false; // Matrix is singular or near-singular
    }

    // Eliminate entries below pivot with SIMD f64x2
    for (let i: u32 = k + 1; i < n; i++) {
      let factor = mat.get(i, k) / diagVal;
      mat.set(i, k, factor); // Store L multiplier

      let vFactor = f64x2.splat(factor);
      let j: u32 = k + 1;
      let len: u32 = n - j;
      let simdCount: u32 = len & ~1;
      let endSimd: u32 = j + simdCount;

      for (; j < endSimd; j += 2) {
        let pI = mat.getEntryPtr(i, j);
        let pK = mat.getEntryPtr(k, j);
        let vI = v128.load(pI);
        let vK = v128.load(pK);
        let vRes = f64x2.sub(vI, f64x2.mul(vFactor, vK));
        v128.store(pI, vRes);
      }
      for (; j < n; j++) {
        mat.set(i, j, mat.get(i, j) - factor * mat.get(k, j));
      }
    }
  }

  return true;
}

/**
 * Solves LU * x = b in-place (overwriting bPtr with solution x).
 * Accounts for row equilibration and pivoting applied during luFactor.
 *
 * @param luPtr Pointer to factored n*n matrix.
 * @param pivPtr Pointer to n i32 pivot permutations.
 * @param scalePtr Pointer to n f64 row equilibration scales.
 * @param bPtr Pointer to RHS vector of n f64 values (overwritten with solution).
 * @param scratchPtr Pointer to scratch buffer of at least n f64 values.
 * @param n Matrix dimension.
 */
export function luSolve(
  luPtr: u32,
  pivPtr: u32,
  scalePtr: u32,
  bPtr: u32,
  scratchPtr: u32,
  n: u32
): void {
  let lu = DenseMatrixView.at(luPtr as usize, n, n);
  let piv = changetype<UnmanagedInt32Array>(pivPtr as usize);
  let scale = changetype<UnmanagedFloat64Array>(scalePtr as usize);
  let b = changetype<UnmanagedFloat64Array>(bPtr as usize);
  let scratch = changetype<UnmanagedFloat64Array>(scratchPtr as usize);

  // Apply permutation and row scaling to RHS: pb[i] = b[piv[i]] * scale[i]
  for (let i: u32 = 0; i < n; i++) {
    let pi = piv[i] as u32;
    scratch[i] = b[pi] * scale[i];
  }

  // Forward substitution: L * z = pb
  for (let i: u32 = 1; i < n; i++) {
    for (let j: u32 = 0; j < i; j++) {
      scratch[i] -= lu.get(i, j) * scratch[j];
    }
  }

  // Back substitution: U * x = z
  for (let i: i32 = (n - 1) as i32; i >= 0; i--) {
    let uI = i as u32;
    for (let j: u32 = uI + 1; j < n; j++) {
      scratch[uI] -= lu.get(uI, j) * scratch[j];
    }
    let diag = lu.get(uI, uI);
    scratch[uI] = scratch[uI] / diag;
  }

  // Copy solution back to bPtr
  for (let i: u32 = 0; i < n; i++) {
    b[i] = scratch[i];
  }
}

/**
 * Computes Euclidean norm ||v||_2 of an n-element vector using v128 SIMD.
 */
export function vectorNorm2(vPtr: u32, n: u32): f64 {
  let v = changetype<UnmanagedFloat64Array>(vPtr as usize);
  let vAddr = vPtr as usize;
  let sumV = f64x2.splat(0.0);
  let i: u32 = 0;
  let simdEnd: u32 = n & ~1;

  for (; i < simdEnd; i += 2) {
    let vec = v128.load(vAddr + (((i as usize)) << 3));
    sumV = f64x2.add(sumV, f64x2.mul(vec, vec));
  }

  let sum: f64 = f64x2.extract_lane(sumV, 0) + f64x2.extract_lane(sumV, 1);
  for (; i < n; i++) {
    let val = v[i];
    sum += val * val;
  }
  return Math.sqrt(sum);
}

/**
 * Computes Infinity norm ||v||_inf of an n-element vector using v128 SIMD.
 */
export function vectorNormInf(vPtr: u32, n: u32): f64 {
  let v = changetype<UnmanagedFloat64Array>(vPtr as usize);
  let vAddr = vPtr as usize;
  let maxV = f64x2.splat(0.0);
  let i: u32 = 0;
  let simdEnd: u32 = n & ~1;

  for (; i < simdEnd; i += 2) {
    let vec = v128.load(vAddr + (((i as usize)) << 3));
    let absVec = f64x2.abs(vec);
    maxV = f64x2.pmax(maxV, absVec);
  }

  let maxVal: f64 = Math.max(f64x2.extract_lane(maxV, 0), f64x2.extract_lane(maxV, 1));
  for (; i < n; i++) {
    let val = Math.abs(v[i]);
    if (val > maxVal) maxVal = val;
  }
  return maxVal;
}

/**
 * Computes dot product a^T * b of two n-element vectors using v128 SIMD.
 */
export function vectorDot(aPtr: u32, bPtr: u32, n: u32): f64 {
  let a = changetype<UnmanagedFloat64Array>(aPtr as usize);
  let b = changetype<UnmanagedFloat64Array>(bPtr as usize);
  let aAddr = aPtr as usize;
  let bAddr = bPtr as usize;
  let sumV = f64x2.splat(0.0);
  let i: u32 = 0;
  let simdEnd: u32 = n & ~1;

  for (; i < simdEnd; i += 2) {
    let vecA = v128.load(aAddr + (((i as usize)) << 3));
    let vecB = v128.load(bAddr + (((i as usize)) << 3));
    sumV = f64x2.add(sumV, f64x2.mul(vecA, vecB));
  }

  let sum: f64 = f64x2.extract_lane(sumV, 0) + f64x2.extract_lane(sumV, 1);
  for (; i < n; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

