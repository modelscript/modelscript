/* eslint-disable */
// @ts-nocheck
/**
 * Zero-GC Linear Algebra & Matrix Solvers for WASM linear memory.
 * Provides row-equilibrated LU factorization with partial pivoting and
 * dense linear system solvers (Ax = b).
 */

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
@inline
export function luFactor(matrixPtr: u32, pivPtr: u32, scalePtr: u32, n: u32): bool {
  // Initialize pivot vector
  for (let i: u32 = 0; i < n; i++) {
    store<i32>(pivPtr + i * 4, i as i32);
  }

  // Row equilibration: scale each row by 1 / max|entry|
  for (let i: u32 = 0; i < n; i++) {
    let maxVal: f64 = 0.0;
    let rowOffset = i * n * 8;
    for (let j: u32 = 0; j < n; j++) {
      let val = Math.abs(load<f64>(matrixPtr + rowOffset + j * 8));
      if (val > maxVal) maxVal = val;
    }

    let s: f64 = maxVal > 1e-30 ? 1.0 / maxVal : 1.0;
    store<f64>(scalePtr + i * 8, s);

    for (let j: u32 = 0; j < n; j++) {
      let curr = load<f64>(matrixPtr + rowOffset + j * 8);
      store<f64>(matrixPtr + rowOffset + j * 8, curr * s);
    }
  }

  // Gaussian elimination with partial pivoting
  for (let k: u32 = 0; k < n; k++) {
    // Find pivot in column k
    let maxVal: f64 = Math.abs(load<f64>(matrixPtr + (k * n + k) * 8));
    let maxIdx: u32 = k;

    for (let i: u32 = k + 1; i < n; i++) {
      let val = Math.abs(load<f64>(matrixPtr + (i * n + k) * 8));
      if (val > maxVal) {
        maxVal = val;
        maxIdx = i;
      }
    }

    // Swap pivot rows if needed
    if (maxIdx != k) {
      for (let j: u32 = 0; j < n; j++) {
        let tmpK = load<f64>(matrixPtr + (k * n + j) * 8);
        let tmpMax = load<f64>(matrixPtr + (maxIdx * n + j) * 8);
        store<f64>(matrixPtr + (k * n + j) * 8, tmpMax);
        store<f64>(matrixPtr + (maxIdx * n + j) * 8, tmpK);
      }

      let tmpPiv = load<i32>(pivPtr + k * 4);
      store<i32>(pivPtr + k * 4, load<i32>(pivPtr + maxIdx * 4));
      store<i32>(pivPtr + maxIdx * 4, tmpPiv);

      let tmpScale = load<f64>(scalePtr + k * 8);
      store<f64>(scalePtr + k * 8, load<f64>(scalePtr + maxIdx * 8));
      store<f64>(scalePtr + maxIdx * 8, tmpScale);
    }

    let diagVal = load<f64>(matrixPtr + (k * n + k) * 8);
    if (Math.abs(diagVal) < 1e-30) {
      return false; // Matrix is singular or near-singular
    }

    // Eliminate entries below pivot
    for (let i: u32 = k + 1; i < n; i++) {
      let factor = load<f64>(matrixPtr + (i * n + k) * 8) / diagVal;
      store<f64>(matrixPtr + (i * n + k) * 8, factor); // Store L multiplier

      for (let j: u32 = k + 1; j < n; j++) {
        let valI = load<f64>(matrixPtr + (i * n + j) * 8);
        let valK = load<f64>(matrixPtr + (k * n + j) * 8);
        store<f64>(matrixPtr + (i * n + j) * 8, valI - factor * valK);
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
@inline
export function luSolve(
  luPtr: u32,
  pivPtr: u32,
  scalePtr: u32,
  bPtr: u32,
  scratchPtr: u32,
  n: u32
): void {
  // Apply permutation and row scaling to RHS: pb[i] = b[piv[i]] * scale[i]
  for (let i: u32 = 0; i < n; i++) {
    let pi = load<i32>(pivPtr + i * 4) as u32;
    let bVal = load<f64>(bPtr + pi * 8);
    let scaleVal = load<f64>(scalePtr + i * 8);
    store<f64>(scratchPtr + i * 8, bVal * scaleVal);
  }

  // Forward substitution: L * z = pb
  for (let i: u32 = 1; i < n; i++) {
    for (let j: u32 = 0; j < i; j++) {
      let L_ij = load<f64>(luPtr + (i * n + j) * 8);
      let z_j = load<f64>(scratchPtr + j * 8);
      let z_i = load<f64>(scratchPtr + i * 8);
      store<f64>(scratchPtr + i * 8, z_i - L_ij * z_j);
    }
  }

  // Back substitution: U * x = z
  for (let i: i32 = (n - 1) as i32; i >= 0; i--) {
    let uI = i as u32;
    for (let j: u32 = uI + 1; j < n; j++) {
      let U_ij = load<f64>(luPtr + (uI * n + j) * 8);
      let x_j = load<f64>(scratchPtr + j * 8);
      let z_i = load<f64>(scratchPtr + uI * 8);
      store<f64>(scratchPtr + uI * 8, z_i - U_ij * x_j);
    }
    let diag = load<f64>(luPtr + (uI * n + uI) * 8);
    let z_i = load<f64>(scratchPtr + uI * 8);
    store<f64>(scratchPtr + uI * 8, Math.abs(diag) > 1e-30 ? z_i / diag : 0.0);
  }

  // Copy solution back to bPtr
  for (let i: u32 = 0; i < n; i++) {
    store<f64>(bPtr + i * 8, load<f64>(scratchPtr + i * 8));
  }
}

/**
 * Computes Euclidean norm ||v||_2 of an n-element vector.
 */
@inline
export function vectorNorm2(vPtr: u32, n: u32): f64 {
  let sum: f64 = 0.0;
  for (let i: u32 = 0; i < n; i++) {
    let val = load<f64>(vPtr + i * 8);
    sum += val * val;
  }
  return Math.sqrt(sum);
}

/**
 * Computes Infinity norm ||v||_inf of an n-element vector.
 */
@inline
export function vectorNormInf(vPtr: u32, n: u32): f64 {
  let maxVal: f64 = 0.0;
  for (let i: u32 = 0; i < n; i++) {
    let val = Math.abs(load<f64>(vPtr + i * 8));
    if (val > maxVal) maxVal = val;
  }
  return maxVal;
}
