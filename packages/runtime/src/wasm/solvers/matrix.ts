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

    // Eliminate entries below pivot
    for (let i: u32 = k + 1; i < n; i++) {
      let factor = mat.get(i, k) / diagVal;
      mat.set(i, k, factor); // Store L multiplier

      for (let j: u32 = k + 1; j < n; j++) {
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
 * Computes Euclidean norm ||v||_2 of an n-element vector.
 */
export function vectorNorm2(vPtr: u32, n: u32): f64 {
  let v = changetype<UnmanagedFloat64Array>(vPtr as usize);
  let sum: f64 = 0.0;
  for (let i: u32 = 0; i < n; i++) {
    let val = v[i];
    sum += val * val;
  }
  return Math.sqrt(sum);
}

/**
 * Computes Infinity norm ||v||_inf of an n-element vector.
 */
export function vectorNormInf(vPtr: u32, n: u32): f64 {
  let v = changetype<UnmanagedFloat64Array>(vPtr as usize);
  let maxVal: f64 = 0.0;
  for (let i: u32 = 0; i < n; i++) {
    let val = Math.abs(v[i]);
    if (val > maxVal) maxVal = val;
  }
  return maxVal;
}

/**
 * Computes dot product a^T * b of two n-element vectors.
 */
export function vectorDot(aPtr: u32, bPtr: u32, n: u32): f64 {
  let a = changetype<UnmanagedFloat64Array>(aPtr as usize);
  let b = changetype<UnmanagedFloat64Array>(bPtr as usize);
  let sum: f64 = 0.0;
  for (let i: u32 = 0; i < n; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * In-place row-equilibrated LU factorization matching `luFactorFlat` semantics
 * (continues past near-zero pivots rather than aborting).
 */
export function luFactorFlatInPlace(matrixPtr: u32, pivPtr: u32, scalePtr: u32, n: u32): void {
  let mat = DenseMatrixView.at(matrixPtr as usize, n, n);
  let piv = changetype<UnmanagedInt32Array>(pivPtr as usize);
  let scale = changetype<UnmanagedFloat64Array>(scalePtr as usize);

  for (let i: u32 = 0; i < n; i++) {
    piv[i] = i as i32;
  }

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

  for (let k: u32 = 0; k < n; k++) {
    let maxVal: f64 = Math.abs(mat.get(k, k));
    let maxIdx: u32 = k;
    for (let i: u32 = k + 1; i < n; i++) {
      let val = Math.abs(mat.get(i, k));
      if (val > maxVal) {
        maxVal = val;
        maxIdx = i;
      }
    }

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
    if (Math.abs(diagVal) < 1e-30) continue;

    for (let i: u32 = k + 1; i < n; i++) {
      let factor = mat.get(i, k) / diagVal;
      mat.set(i, k, factor);
      for (let j: u32 = k + 1; j < n; j++) {
        mat.set(i, j, mat.get(i, j) - factor * mat.get(k, j));
      }
    }
  }
}

/**
 * In-place LU solve matching `luSolveFlat` semantics (guards near-zero diagonal).
 */
export function luSolveFlatInPlace(
  luPtr: u32,
  pivPtr: u32,
  scalePtr: u32,
  bPtr: u32,
  scratchPtr: u32,
  n: u32,
): void {
  let lu = DenseMatrixView.at(luPtr as usize, n, n);
  let piv = changetype<UnmanagedInt32Array>(pivPtr as usize);
  let scale = changetype<UnmanagedFloat64Array>(scalePtr as usize);
  let b = changetype<UnmanagedFloat64Array>(bPtr as usize);
  let scratch = changetype<UnmanagedFloat64Array>(scratchPtr as usize);

  for (let i: u32 = 0; i < n; i++) {
    let pi = piv[i] as u32;
    scratch[i] = b[pi] * scale[i];
  }

  for (let i: u32 = 1; i < n; i++) {
    let sum: f64 = scratch[i];
    for (let j: u32 = 0; j < i; j++) {
      sum -= lu.get(i, j) * scratch[j];
    }
    scratch[i] = sum;
  }

  for (let i: i32 = (n as i32) - 1; i >= 0; i--) {
    let uI = i as u32;
    let sum: f64 = scratch[uI];
    for (let j: u32 = uI + 1; j < n; j++) {
      sum -= lu.get(uI, j) * scratch[j];
    }
    let diag = lu.get(uI, uI);
    scratch[uI] = Math.abs(diag) > 1e-30 ? sum / diag : 0.0;
  }

  for (let i: u32 = 0; i < n; i++) {
    b[i] = scratch[i];
  }
}

/**
 * Solves dense A * X = B in-place (overwriting `rhsPtr` with X) using partial-pivoted LU
 * with Tikhonov regularization for near-singular pivots.
 * Returns 1 if regularized, 0 otherwise, and writes `minPivotRatio` to `outMinPivotRatioPtr`.
 */
export function solveDenseMultiRhs(
  luPtr: u32,
  rhsPtr: u32,
  n: u32,
  m: u32,
  regularization: f64,
  outMinPivotRatioPtr: u32,
): i32 {
  let lu = changetype<UnmanagedFloat64Array>(luPtr as usize);
  let rhs = changetype<UnmanagedFloat64Array>(rhsPtr as usize);
  let maxPivot: f64 = 0.0;
  let minPivot: f64 = Infinity;
  let regularized: i32 = 0;

  for (let k: u32 = 0; k < n; k++) {
    let maxRow: u32 = k;
    let maxVal: f64 = Math.abs(lu[k * n + k]);
    for (let i: u32 = k + 1; i < n; i++) {
      let v = Math.abs(lu[i * n + k]);
      if (v > maxVal) {
        maxVal = v;
        maxRow = i;
      }
    }

    if (maxRow != k) {
      let rowK = k * n;
      let rowM = maxRow * n;
      for (let j: u32 = 0; j < n; j++) {
        let tmp = lu[rowK + j];
        lu[rowK + j] = lu[rowM + j];
        lu[rowM + j] = tmp;
      }
      let rhsK = k * m;
      let rhsM = maxRow * m;
      for (let j: u32 = 0; j < m; j++) {
        let tmp = rhs[rhsK + j];
        rhs[rhsK + j] = rhs[rhsM + j];
        rhs[rhsM + j] = tmp;
      }
    }

    let rawPivot = Math.abs(lu[k * n + k]);
    if (rawPivot < minPivot) minPivot = rawPivot;

    let pivot = lu[k * n + k];
    if (Math.abs(pivot) < regularization) {
      pivot = pivot >= 0.0 ? regularization : -regularization;
      lu[k * n + k] = pivot;
      regularized = 1;
    }

    let absPiv = Math.abs(pivot);
    if (absPiv > maxPivot) maxPivot = absPiv;

    let rowK = k * n;
    for (let i: u32 = k + 1; i < n; i++) {
      let rowI = i * n;
      let factor = lu[rowI + k] / pivot;
      lu[rowI + k] = factor;
      for (let j: u32 = k + 1; j < n; j++) {
        lu[rowI + j] = lu[rowI + j] - factor * lu[rowK + j];
      }
    }
  }

  // Forward substitution: L * Y = P * B
  for (let i: u32 = 1; i < n; i++) {
    let rowI = i * n;
    let rhsI = i * m;
    for (let k: u32 = 0; k < i; k++) {
      let lVal = lu[rowI + k];
      let rhsK = k * m;
      for (let j: u32 = 0; j < m; j++) {
        rhs[rhsI + j] = rhs[rhsI + j] - lVal * rhs[rhsK + j];
      }
    }
  }

  // Back substitution: U * X = Y
  for (let i: i32 = (n as i32) - 1; i >= 0; i--) {
    let uI = i as u32;
    let rowI = uI * n;
    let rhsI = uI * m;
    let diag = lu[rowI + uI];
    for (let k: u32 = uI + 1; k < n; k++) {
      let uVal = lu[rowI + k];
      let rhsK = k * m;
      for (let j: u32 = 0; j < m; j++) {
        rhs[rhsI + j] = rhs[rhsI + j] - uVal * rhs[rhsK + j];
      }
    }
    for (let j: u32 = 0; j < m; j++) {
      rhs[rhsI + j] = rhs[rhsI + j] / diag;
    }
  }

  if (outMinPivotRatioPtr != 0) {
    let ratio: f64 = maxPivot > 0.0 ? minPivot / maxPivot : 0.0;
    store<f64>(outMinPivotRatioPtr as usize, ratio);
  }
  return regularized;
}

/**
 * Dense row-major matrix multiplication: C = A * B where A is (m x k), B is (k x n), C is (m x n).
 */
export function denseMatMulWasm(
  aPtr: u32,
  bPtr: u32,
  cPtr: u32,
  m: u32,
  k: u32,
  n: u32,
): void {
  let A = changetype<UnmanagedFloat64Array>(aPtr as usize);
  let B = changetype<UnmanagedFloat64Array>(bPtr as usize);
  let C = changetype<UnmanagedFloat64Array>(cPtr as usize);
  memory.fill(cPtr as usize, 0, ((m as usize) * (n as usize)) << 3);

  for (let i: u32 = 0; i < m; i++) {
    let aRow = i * k;
    let cRow = i * n;
    for (let p: u32 = 0; p < k; p++) {
      let aip = A[aRow + p];
      if (aip == 0.0) continue;
      let bRow = p * n;
      for (let j: u32 = 0; j < n; j++) {
        C[cRow + j] = C[cRow + j] + aip * B[bRow + j];
      }
    }
  }
}

/**
 * Computes the normalized ridge regression Gram matrix G = Theta_norm^T Theta_norm + lambda I
 * and RHS vector rhs = Theta_norm^T y for SINDy STLSQ active-support regression.
 */
export function stlsqGramWasm(
  thetaPtr: u32,
  colNormsPtr: u32,
  yPtr: u32,
  activeIdxPtr: u32,
  nSamples: u32,
  nTerms: u32,
  nActive: u32,
  ridgeLambda: f64,
  gOutPtr: u32,
  rhsOutPtr: u32,
): void {
  let Theta = changetype<UnmanagedFloat64Array>(thetaPtr as usize);
  let colNorms = changetype<UnmanagedFloat64Array>(colNormsPtr as usize);
  let y = changetype<UnmanagedFloat64Array>(yPtr as usize);
  let G = changetype<UnmanagedFloat64Array>(gOutPtr as usize);
  let rhs = changetype<UnmanagedFloat64Array>(rhsOutPtr as usize);

  for (let a: u32 = 0; a < nActive; a++) {
    let colA = load<i32>((activeIdxPtr as usize) + ((a as usize) << 2)) as u32;
    let normA = colNorms[colA];
    let invNormA = normA != 0.0 ? 1.0 / normA : 1.0;

    let sumY: f64 = 0.0;
    for (let s: u32 = 0; s < nSamples; s++) {
      sumY += Theta[s * nTerms + colA] * invNormA * y[s];
    }
    rhs[a] = sumY;

    for (let b: u32 = a; b < nActive; b++) {
      let colB = load<i32>((activeIdxPtr as usize) + ((b as usize) << 2)) as u32;
      let normB = colNorms[colB];
      let invNormAB = invNormA * (normB != 0.0 ? 1.0 / normB : 1.0);

      let sumG: f64 = 0.0;
      for (let s: u32 = 0; s < nSamples; s++) {
        let rowOff = s * nTerms;
        sumG += Theta[rowOff + colA] * Theta[rowOff + colB];
      }
      let val = sumG * invNormAB;
      if (a == b) val += ridgeLambda;
      G[a * nActive + b] = val;
      G[b * nActive + a] = val;
    }
  }
}

/**
 * Computes all real and complex eigenvalues of a general n x n row-major matrix
 * via Householder reduction to Upper Hessenberg form + shifted QR iteration.
 * Writes real and imaginary parts into `reOutPtr` and `imOutPtr` and returns the
 * number of eigenvalues written.
 */
export function hessenbergQrEigenvaluesWasm(
  aInPtr: u32,
  n: u32,
  reOutPtr: u32,
  imOutPtr: u32,
): u32 {
  if (n == 0) return 0;
  let reOut = changetype<UnmanagedFloat64Array>(reOutPtr as usize);
  let imOut = changetype<UnmanagedFloat64Array>(imOutPtr as usize);
  if (n == 1) {
    reOut[0] = load<f64>(aInPtr as usize);
    imOut[0] = 0.0;
    return 1;
  }

  let nnBytes = ((n as usize) * (n as usize)) << 3;
  let nBytes = (n as usize) << 3;
  let hPtr = heap.alloc(nnBytes);
  let vPtr = heap.alloc(nBytes);
  let csPtr = heap.alloc(nBytes);
  let snPtr = heap.alloc(nBytes);
  memory.copy(hPtr, aInPtr as usize, nnBytes);

  let H = changetype<UnmanagedFloat64Array>(hPtr);
  let v = changetype<UnmanagedFloat64Array>(vPtr);
  let cs = changetype<UnmanagedFloat64Array>(csPtr);
  let sn = changetype<UnmanagedFloat64Array>(snPtr);

  // 1. Householder reduction to Upper Hessenberg form
  if (n > 2) {
    for (let k: u32 = 0; k < n - 2; k++) {
      let scale: f64 = 0.0;
      for (let i: u32 = k + 1; i < n; i++) {
        scale += Math.abs(H[i * n + k]);
      }
      if (scale == 0.0) continue;

      let normSq: f64 = 0.0;
      for (let i: u32 = k + 1; i < n; i++) {
        let vi = H[i * n + k] / scale;
        v[i] = vi;
        normSq += vi * vi;
      }
      let g = Math.sqrt(normSq);
      if (v[k + 1] >= 0.0) g = -g;
      let beta = normSq - v[k + 1] * g;
      if (beta <= 0.0) continue;
      v[k + 1] = v[k + 1] - g;

      for (let j: u32 = k; j < n; j++) {
        let dot: f64 = 0.0;
        for (let i: u32 = k + 1; i < n; i++) dot += v[i] * H[i * n + j];
        dot /= beta;
        for (let i: u32 = k + 1; i < n; i++) H[i * n + j] = H[i * n + j] - dot * v[i];
      }

      for (let i: u32 = 0; i < n; i++) {
        let dot: f64 = 0.0;
        for (let j: u32 = k + 1; j < n; j++) dot += H[i * n + j] * v[j];
        dot /= beta;
        for (let j: u32 = k + 1; j < n; j++) H[i * n + j] = H[i * n + j] - dot * v[j];
      }
    }
  }

  // 2. Shifted QR iteration with Wilkinson shift
  let eps: f64 = 2.220446049250313e-16;
  let outCount: u32 = 0;
  let m: i32 = (n as i32) - 1;
  let iter: u32 = 0;
  let maxTotalIter: u32 = 60 * n;

  while (m >= 0 && iter < maxTotalIter) {
    let mu = m as u32;
    let l: i32 = m;
    while (l > 0) {
      let lu = l as u32;
      let s = Math.abs(H[(lu - 1) * n + (lu - 1)]) + Math.abs(H[lu * n + lu]);
      if (s == 0.0) s = 1.0;
      if (Math.abs(H[lu * n + (lu - 1)]) <= eps * s) {
        H[lu * n + (lu - 1)] = 0.0;
        break;
      }
      l--;
    }

    if (l == m) {
      reOut[outCount] = H[mu * n + mu];
      imOut[outCount] = 0.0;
      outCount++;
      m--;
      continue;
    }

    if (l == m - 1) {
      let a = H[(mu - 1) * n + (mu - 1)];
      let b = H[(mu - 1) * n + mu];
      let c = H[mu * n + (mu - 1)];
      let d = H[mu * n + mu];
      let tr = a + d;
      let det = a * d - b * c;
      let disc = tr * tr - 4.0 * det;
      if (disc < 0.0) {
        let re = 0.5 * tr;
        let im = 0.5 * Math.sqrt(-disc);
        reOut[outCount] = re;
        imOut[outCount] = im;
        outCount++;
        reOut[outCount] = re;
        imOut[outCount] = -im;
        outCount++;
      } else {
        let sqrtDisc = Math.sqrt(disc);
        reOut[outCount] = 0.5 * (tr + sqrtDisc);
        imOut[outCount] = 0.0;
        outCount++;
        reOut[outCount] = 0.5 * (tr - sqrtDisc);
        imOut[outCount] = 0.0;
        outCount++;
      }
      m -= 2;
      continue;
    }

    iter++;
    let lu = l as u32;
    let a = H[(mu - 1) * n + (mu - 1)];
    let b = H[(mu - 1) * n + mu];
    let c = H[mu * n + (mu - 1)];
    let d = H[mu * n + mu];
    let tr = a + d;
    let det = a * d - b * c;
    let disc = tr * tr - 4.0 * det;
    let shift = d;
    if (disc >= 0.0) {
      let sq = Math.sqrt(disc);
      let r1 = 0.5 * (tr + sq);
      let r2 = 0.5 * (tr - sq);
      shift = Math.abs(r1 - d) < Math.abs(r2 - d) ? r1 : r2;
    }

    for (let i: u32 = lu; i <= mu; i++) {
      H[i * n + i] = H[i * n + i] - shift;
    }

    for (let i: u32 = lu; i < mu; i++) {
      let x = H[i * n + i];
      let y = H[(i + 1) * n + i];
      let r = Math.hypot(x, y);
      let cos = r > 0.0 ? x / r : 1.0;
      let sin = r > 0.0 ? -y / r : 0.0;
      cs[i - lu] = cos;
      sn[i - lu] = sin;

      for (let j: u32 = i; j < n; j++) {
        let t1 = H[i * n + j];
        let t2 = H[(i + 1) * n + j];
        H[i * n + j] = cos * t1 - sin * t2;
        H[(i + 1) * n + j] = sin * t1 + cos * t2;
      }
    }

    for (let i: u32 = lu; i < mu; i++) {
      let cos = cs[i - lu];
      let sin = sn[i - lu];
      let rMax = mu < i + 2 ? mu : i + 2;
      for (let r: u32 = 0; r <= rMax; r++) {
        let t1 = H[r * n + i];
        let t2 = H[r * n + (i + 1)];
        H[r * n + i] = cos * t1 - sin * t2;
        H[r * n + (i + 1)] = sin * t1 + cos * t2;
      }
    }

    for (let i: u32 = lu; i <= mu; i++) {
      H[i * n + i] = H[i * n + i] + shift;
    }
  }

  heap.free(snPtr);
  heap.free(csPtr);
  heap.free(vPtr);
  heap.free(hPtr);
  return outCount;
}

/**
 * Two-Phase Simplex LP solver operating on a flat row-major (numRows + 2) x totalCols tableau.
 * Returns iteration count (>= 0) on completion, or -(iterations + 1) if Phase 1 fails / infeasible.
 */
export function simplexTwoPhaseTableauWasm(
  tabPtr: u32,
  basicVarsPtr: u32,
  isArtificialPtr: u32,
  numRows: u32,
  totalCols: u32,
  p2ColLimit: u32,
  numArtificials: u32,
  maxIters: i32,
): i32 {
  const phase1Row = numRows;
  const phase2Row = numRows + 1;
  const totalRows = numRows + 2;
  const rhsCol = totalCols - 1;
  let iterations: i32 = 0;

  if (numArtificials > 0) {
    while (iterations < maxIters) {
      iterations++;
      let enterCol: i32 = -1;
      let minVal: f64 = -1e-8;
      const p1Off = phase1Row * totalCols;
      for (let j: u32 = 0; j < rhsCol; j++) {
        if (load<u8>(isArtificialPtr + j) != 0) continue;
        const v = load<f64>(tabPtr + ((p1Off + j) << 3));
        if (v < minVal) {
          minVal = v;
          enterCol = j as i32;
        }
      }
      if (enterCol == -1) break;

      const eCol = enterCol as u32;
      let leaveRow: i32 = -1;
      let minRatio: f64 = 1e20;
      for (let i: u32 = 0; i < numRows; i++) {
        const rOff = i * totalCols;
        const coef = load<f64>(tabPtr + ((rOff + eCol) << 3));
        if (coef > 1e-9) {
          const rhs = load<f64>(tabPtr + ((rOff + rhsCol) << 3));
          const ratio = rhs / coef;
          if (ratio < minRatio) {
            minRatio = ratio;
            leaveRow = i as i32;
          }
        }
      }
      if (leaveRow == -1) return -(iterations + 1);

      const pRow = leaveRow as u32;
      const pOff = pRow * totalCols;
      const invPivot = 1.0 / load<f64>(tabPtr + ((pOff + eCol) << 3));
      for (let j: u32 = 0; j < totalCols; j++) {
        const idx = pOff + j;
        store<f64>(tabPtr + (idx << 3), load<f64>(tabPtr + (idx << 3)) * invPivot);
      }
      for (let i: u32 = 0; i < totalRows; i++) {
        if (i == pRow) continue;
        const rOff = i * totalCols;
        const factor = load<f64>(tabPtr + ((rOff + eCol) << 3));
        if (Math.abs(factor) > 1e-15) {
          for (let j: u32 = 0; j < totalCols; j++) {
            const dstIdx = rOff + j;
            const srcIdx = pOff + j;
            store<f64>(
              tabPtr + (dstIdx << 3),
              load<f64>(tabPtr + (dstIdx << 3)) - factor * load<f64>(tabPtr + (srcIdx << 3)),
            );
          }
        }
      }
      store<i32>(basicVarsPtr + (pRow << 2), enterCol);
    }

    const phase1Obj = -load<f64>(tabPtr + ((phase1Row * totalCols + rhsCol) << 3));
    if (phase1Obj > 1e-4) return -(iterations + 1);
  }

  while (iterations < maxIters) {
    iterations++;
    let enterCol: i32 = -1;
    let minVal: f64 = -1e-9;
    const p2Off = phase2Row * totalCols;
    for (let j: u32 = 0; j < p2ColLimit; j++) {
      const v = load<f64>(tabPtr + ((p2Off + j) << 3));
      if (v < minVal) {
        minVal = v;
        enterCol = j as i32;
      }
    }
    if (enterCol == -1) break;

    const eCol = enterCol as u32;
    let leaveRow: i32 = -1;
    let minRatio: f64 = 1e20;
    for (let i: u32 = 0; i < numRows; i++) {
      const rOff = i * totalCols;
      const coef = load<f64>(tabPtr + ((rOff + eCol) << 3));
      if (coef > 1e-9) {
        const rhs = load<f64>(tabPtr + ((rOff + rhsCol) << 3));
        const ratio = rhs / coef;
        if (ratio < minRatio) {
          minRatio = ratio;
          leaveRow = i as i32;
        }
      }
    }
    if (leaveRow == -1) break;

    const pRow = leaveRow as u32;
    const pOff = pRow * totalCols;
    const invPivot = 1.0 / load<f64>(tabPtr + ((pOff + eCol) << 3));
    for (let j: u32 = 0; j < totalCols; j++) {
      const idx = pOff + j;
      store<f64>(tabPtr + (idx << 3), load<f64>(tabPtr + (idx << 3)) * invPivot);
    }
    for (let i: u32 = 0; i < totalRows; i++) {
      if (i == pRow) continue;
      const rOff = i * totalCols;
      const factor = load<f64>(tabPtr + ((rOff + eCol) << 3));
      if (Math.abs(factor) > 1e-15) {
        for (let j: u32 = 0; j < totalCols; j++) {
          const dstIdx = rOff + j;
          const srcIdx = pOff + j;
          store<f64>(
            tabPtr + (dstIdx << 3),
            load<f64>(tabPtr + (dstIdx << 3)) - factor * load<f64>(tabPtr + (srcIdx << 3)),
          );
        }
      }
    }
    store<i32>(basicVarsPtr + (pRow << 2), enterCol);
  }

  return iterations;
}

/**
 * Computes Levenberg-Marquardt normal equations:
 *   JtJ = J^T * J + lambda * I  (nParams x nParams)
 *   negJtr = -J^T * r            (nParams)
 * where J is row-major (nResiduals x nParams).
 */
export function lmNormalEquationsWasm(
  jPtr: u32,
  rPtr: u32,
  nResiduals: u32,
  nParams: u32,
  lambda: f64,
  jtjPtr: u32,
  negJtrPtr: u32,
): void {
  for (let i: u32 = 0; i < nParams; i++) {
    for (let j: u32 = 0; j <= i; j++) {
      let sum: f64 = 0.0;
      for (let k: u32 = 0; k < nResiduals; k++) {
        const rowOff = k * nParams;
        sum += load<f64>(jPtr + ((rowOff + i) << 3)) * load<f64>(jPtr + ((rowOff + j) << 3));
      }
      store<f64>(jtjPtr + ((i * nParams + j) << 3), sum);
      if (i != j) {
        store<f64>(jtjPtr + ((j * nParams + i) << 3), sum);
      } else {
        store<f64>(jtjPtr + ((i * nParams + i) << 3), sum + lambda);
      }
    }

    let jtr: f64 = 0.0;
    for (let k: u32 = 0; k < nResiduals; k++) {
      jtr += load<f64>(jPtr + ((k * nParams + i) << 3)) * load<f64>(rPtr + (k << 3));
    }
    store<f64>(negJtrPtr + (i << 3), -jtr);
  }
}

/**
 * L-BFGS-B two-loop recursion for active-set projected search direction d = -H_k * g.
 * scratchPtr must have at least (2 * n + k) * 8 bytes.
 */
export function lbfgsTwoLoopWasm(
  n: u32,
  k: u32,
  gradPtr: u32,
  activePtr: u32,
  sFlatPtr: u32,
  yFlatPtr: u32,
  rhoPtr: u32,
  dOutPtr: u32,
  scratchPtr: u32,
): void {
  const qPtr = scratchPtr;
  const rPtr = qPtr + (n << 3);
  const alphasPtr = rPtr + (n << 3);

  for (let j: u32 = 0; j < n; j++) {
    if (load<u8>(activePtr + j) != 0) {
      store<f64>(qPtr + (j << 3), 0.0);
    } else {
      store<f64>(qPtr + (j << 3), load<f64>(gradPtr + (j << 3)));
    }
  }

  // Loop 1 (backward)
  for (let idx: i32 = (k as i32) - 1; idx >= 0; idx--) {
    const i = idx as u32;
    const rowOff = i * n;
    const rho = load<f64>(rhoPtr + (i << 3));
    let dotSq: f64 = 0.0;
    for (let j: u32 = 0; j < n; j++) {
      if (load<u8>(activePtr + j) == 0) {
        dotSq += load<f64>(sFlatPtr + ((rowOff + j) << 3)) * load<f64>(qPtr + (j << 3));
      }
    }
    const alpha = rho * dotSq;
    store<f64>(alphasPtr + (i << 3), alpha);
    for (let j: u32 = 0; j < n; j++) {
      if (load<u8>(activePtr + j) == 0) {
        const qAddr = qPtr + (j << 3);
        store<f64>(qAddr, load<f64>(qAddr) - alpha * load<f64>(yFlatPtr + ((rowOff + j) << 3)));
      }
    }
  }

  // Initial Hessian scaling gamma
  let gamma: f64 = 1.0;
  if (k > 0) {
    const lastOff = (k - 1) * n;
    let sy: f64 = 0.0;
    let yy: f64 = 0.0;
    for (let j: u32 = 0; j < n; j++) {
      const sv = load<f64>(sFlatPtr + ((lastOff + j) << 3));
      const yv = load<f64>(yFlatPtr + ((lastOff + j) << 3));
      sy += sv * yv;
      yy += yv * yv;
    }
    if (yy > 1e-14) {
      gamma = Math.max(1e-8, Math.min(1e8, sy / yy));
    }
  }

  for (let j: u32 = 0; j < n; j++) {
    if (load<u8>(activePtr + j) == 0) {
      store<f64>(rPtr + (j << 3), gamma * load<f64>(qPtr + (j << 3)));
    } else {
      store<f64>(rPtr + (j << 3), 0.0);
    }
  }

  // Loop 2 (forward)
  for (let i: u32 = 0; i < k; i++) {
    const rowOff = i * n;
    const rho = load<f64>(rhoPtr + (i << 3));
    let dotYr: f64 = 0.0;
    for (let j: u32 = 0; j < n; j++) {
      if (load<u8>(activePtr + j) == 0) {
        dotYr += load<f64>(yFlatPtr + ((rowOff + j) << 3)) * load<f64>(rPtr + (j << 3));
      }
    }
    const beta = rho * dotYr;
    const diff = load<f64>(alphasPtr + (i << 3)) - beta;
    for (let j: u32 = 0; j < n; j++) {
      if (load<u8>(activePtr + j) == 0) {
        const rAddr = rPtr + (j << 3);
        store<f64>(rAddr, load<f64>(rAddr) + load<f64>(sFlatPtr + ((rowOff + j) << 3)) * diff);
      }
    }
  }

  for (let j: u32 = 0; j < n; j++) {
    if (load<u8>(activePtr + j) == 0) {
      store<f64>(dOutPtr + (j << 3), -load<f64>(rPtr + (j << 3)));
    } else {
      store<f64>(dOutPtr + (j << 3), 0.0);
    }
  }
}



