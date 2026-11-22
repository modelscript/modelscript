// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Linear Algebra Kernels for ROM / Surrogate Training & SINDy:
 * - One-sided Jacobi SVD for tall-skinny POD/DMD matrices
 * - RBF / Kriging Gram matrix assembly (6 kernel families)
 * - Cholesky LL^T factorization & solve
 * - Sequential Thresholded Least Squares (STLSQ) for SINDy sparse discovery
 */

/**
 * One-sided Jacobi SVD: A (m x n, row-major, m >= n) = U (m x n) * diag(S) * V^T (n x n).
 * Returns number of Jacobi sweeps performed.
 */
export function rom_jacobiSvd(
  aPtr: usize,
  m: i32,
  n: i32,
  uPtr: usize,
  sPtr: usize,
  vtPtr: usize,
  maxSweeps: i32,
): i32 {
  if (m <= 0 || n <= 0) return 0;

  // Copy A into U (m x n, row-major)
  memory.copy(uPtr, aPtr, <usize>(m * n) << 3);

  // Initialize V (n x n, stored in vtPtr temporarily as V, transposed at end) to identity
  const nn = n * n;
  memory.fill(vtPtr, 0, <usize>nn << 3);
  for (let i: i32 = 0; i < n; i++) {
    store<f64>(vtPtr + (<usize>(i * n + i) << 3), 1.0);
  }

  let sweep: i32 = 0;
  for (; sweep < maxSweeps; sweep++) {
    let converged = true;
    for (let p: i32 = 0; p < n - 1; p++) {
      for (let q: i32 = p + 1; q < n; q++) {
        let app: f64 = 0.0;
        let aqq: f64 = 0.0;
        let apq: f64 = 0.0;
        for (let r: i32 = 0; r < m; r++) {
          const rowOff = uPtr + (<usize>(r * n) << 3);
          const up = load<f64>(rowOff + (<usize>p << 3));
          const uq = load<f64>(rowOff + (<usize>q << 3));
          app += up * up;
          aqq += uq * uq;
          apq += up * uq;
        }
        const denom = Math.sqrt(app * aqq);
        if (denom < 1e-30 || Math.abs(apq) <= 1e-13 * denom) continue;
        converged = false;

        const tau = (aqq - app) / (2.0 * apq);
        const t = tau >= 0.0 ? 1.0 / (tau + Math.sqrt(1.0 + tau * tau)) : -1.0 / (-tau + Math.sqrt(1.0 + tau * tau));
        const c = 1.0 / Math.sqrt(1.0 + t * t);
        const s = t * c;

        for (let r: i32 = 0; r < m; r++) {
          const rowOff = uPtr + (<usize>(r * n) << 3);
          const up = load<f64>(rowOff + (<usize>p << 3));
          const uq = load<f64>(rowOff + (<usize>q << 3));
          store<f64>(rowOff + (<usize>p << 3), c * up - s * uq);
          store<f64>(rowOff + (<usize>q << 3), s * up + c * uq);
        }
        for (let r: i32 = 0; r < n; r++) {
          const rowOff = vtPtr + (<usize>(r * n) << 3);
          const vp = load<f64>(rowOff + (<usize>p << 3));
          const vq = load<f64>(rowOff + (<usize>q << 3));
          store<f64>(rowOff + (<usize>p << 3), c * vp - s * vq);
          store<f64>(rowOff + (<usize>q << 3), s * vp + c * vq);
        }
      }
    }
    if (converged) break;
  }

  // Extract singular values (column norms of U) and normalize U columns
  for (let j: i32 = 0; j < n; j++) {
    let norm2: f64 = 0.0;
    for (let r: i32 = 0; r < m; r++) {
      const val = load<f64>(uPtr + (<usize>(r * n + j) << 3));
      norm2 += val * val;
    }
    const sigma = Math.sqrt(norm2);
    store<f64>(sPtr + (<usize>j << 3), sigma);
    if (sigma > 1e-15) {
      const invS = 1.0 / sigma;
      for (let r: i32 = 0; r < m; r++) {
        const off = uPtr + (<usize>(r * n + j) << 3);
        store<f64>(off, load<f64>(off) * invS);
      }
    }
  }

  // Sort singular values descending (selection sort on n columns)
  for (let i: i32 = 0; i < n - 1; i++) {
    let maxIdx = i;
    let maxVal = load<f64>(sPtr + (<usize>i << 3));
    for (let j: i32 = i + 1; j < n; j++) {
      const vj = load<f64>(sPtr + (<usize>j << 3));
      if (vj > maxVal) {
        maxVal = vj;
        maxIdx = j;
      }
    }
    if (maxIdx != i) {
      store<f64>(sPtr + (<usize>maxIdx << 3), load<f64>(sPtr + (<usize>i << 3)));
      store<f64>(sPtr + (<usize>i << 3), maxVal);
      for (let r: i32 = 0; r < m; r++) {
        const o1 = uPtr + (<usize>(r * n + i) << 3);
        const o2 = uPtr + (<usize>(r * n + maxIdx) << 3);
        const tmp = load<f64>(o1);
        store<f64>(o1, load<f64>(o2));
        store<f64>(o2, tmp);
      }
      for (let r: i32 = 0; r < n; r++) {
        const o1 = vtPtr + (<usize>(r * n + i) << 3);
        const o2 = vtPtr + (<usize>(r * n + maxIdx) << 3);
        const tmp = load<f64>(o1);
        store<f64>(o1, load<f64>(o2));
        store<f64>(o2, tmp);
      }
    }
  }

  // Transpose V in-place to produce V^T
  for (let i: i32 = 0; i < n; i++) {
    for (let j: i32 = i + 1; j < n; j++) {
      const o1 = vtPtr + (<usize>(i * n + j) << 3);
      const o2 = vtPtr + (<usize>(j * n + i) << 3);
      const tmp = load<f64>(o1);
      store<f64>(o1, load<f64>(o2));
      store<f64>(o2, tmp);
    }
  }

  return sweep;
}

/**
 * RBF / Kriging Gram Matrix assembly:
 * kernelKind:
 *   0 = gaussian: exp(-(eps*r)^2)
 *   1 = multiquadric: sqrt(1 + (eps*r)^2)
 *   2 = inverse_multiquadric: 1 / sqrt(1 + (eps*r)^2)
 *   3 = thin_plate_spline: r^2 * ln(r)
 *   4 = matern32: (1 + sqrt(3)*r/l) * exp(-sqrt(3)*r/l)   (l = 1/eps)
 *   5 = matern52: (1 + sqrt(5)*r/l + 5*r^2/(3*l^2)) * exp(-sqrt(5)*r/l)
 */
export function rom_rbfGramMatrix(
  xPtr: usize,
  nSamples: i32,
  dim: i32,
  kernelKind: i32,
  eps: f64,
  nugget: f64,
  outKPtr: usize,
): void {
  const eps2 = eps * eps;
  const sqrt3 = 1.7320508075688772;
  const sqrt5 = 2.23606797749979;

  for (let i: i32 = 0; i < nSamples; i++) {
    const xiOff = xPtr + (<usize>(i * dim) << 3);
    for (let j: i32 = i; j < nSamples; j++) {
      const xjOff = xPtr + (<usize>(j * dim) << 3);
      let r2: f64 = 0.0;
      for (let d: i32 = 0; d < dim; d++) {
        const diff = load<f64>(xiOff + (<usize>d << 3)) - load<f64>(xjOff + (<usize>d << 3));
        r2 += diff * diff;
      }

      let kval: f64 = 0.0;
      if (kernelKind == 0) {
        kval = Math.exp(-eps2 * r2);
      } else if (kernelKind == 1) {
        kval = Math.sqrt(1.0 + eps2 * r2);
      } else if (kernelKind == 2) {
        kval = 1.0 / Math.sqrt(1.0 + eps2 * r2);
      } else if (kernelKind == 3) {
        kval = r2 > 1e-30 ? 0.5 * r2 * Math.log(r2) : 0.0;
      } else if (kernelKind == 4) {
        const z = sqrt3 * Math.sqrt(r2) * eps;
        kval = (1.0 + z) * Math.exp(-z);
      } else {
        const z = sqrt5 * Math.sqrt(r2) * eps;
        kval = (1.0 + z + (z * z) / 3.0) * Math.exp(-z);
      }

      if (i == j) kval += nugget;
      store<f64>(outKPtr + (<usize>(i * nSamples + j) << 3), kval);
      if (i != j) {
        store<f64>(outKPtr + (<usize>(j * nSamples + i) << 3), kval);
      }
    }
  }
}

/**
 * Dense Cholesky solve A * x = b for symmetric positive definite A (n x n).
 * Returns 1 on success, 0 if not positive definite.
 */
export function rom_choleskySolve(aPtr: usize, bPtr: usize, n: i32, outXPtr: usize): i32 {
  if (n <= 0) return 0;
  const lPtr = heap.alloc(<usize>(n * n) << 3);
  memory.fill(lPtr, 0, <usize>(n * n) << 3);

  for (let i: i32 = 0; i < n; i++) {
    for (let j: i32 = 0; j <= i; j++) {
      let sum = load<f64>(aPtr + (<usize>(i * n + j) << 3));
      for (let k: i32 = 0; k < j; k++) {
        sum -= load<f64>(lPtr + (<usize>(i * n + k) << 3)) * load<f64>(lPtr + (<usize>(j * n + k) << 3));
      }
      if (i == j) {
        if (sum <= 1e-15) {
          heap.free(lPtr);
          return 0;
        }
        store<f64>(lPtr + (<usize>(i * n + j) << 3), Math.sqrt(sum));
      } else {
        const ljj = load<f64>(lPtr + (<usize>(j * n + j) << 3));
        store<f64>(lPtr + (<usize>(i * n + j) << 3), sum / ljj);
      }
    }
  }

  // Forward substitution L y = b
  for (let i: i32 = 0; i < n; i++) {
    let sum = load<f64>(bPtr + (<usize>i << 3));
    for (let k: i32 = 0; k < i; k++) {
      sum -= load<f64>(lPtr + (<usize>(i * n + k) << 3)) * load<f64>(outXPtr + (<usize>k << 3));
    }
    store<f64>(outXPtr + (<usize>i << 3), sum / load<f64>(lPtr + (<usize>(i * n + i) << 3)));
  }

  // Back substitution L^T x = y
  for (let i: i32 = n - 1; i >= 0; i--) {
    let sum = load<f64>(outXPtr + (<usize>i << 3));
    for (let k: i32 = i + 1; k < n; k++) {
      sum -= load<f64>(lPtr + (<usize>(k * n + i) << 3)) * load<f64>(outXPtr + (<usize>k << 3));
    }
    store<f64>(outXPtr + (<usize>i << 3), sum / load<f64>(lPtr + (<usize>(i * n + i) << 3)));
  }

  heap.free(lPtr);
  return 1;
}

/**
 * Dense partial-pivoting Gaussian elimination solving A * x = b (in-place on copies).
 */
function solveDenseLinear(aPtr: usize, bPtr: usize, n: i32, outXPtr: usize): bool {
  const mat = heap.alloc(<usize>(n * n) << 3);
  const rhs = heap.alloc(<usize>n << 3);
  memory.copy(mat, aPtr, <usize>(n * n) << 3);
  memory.copy(rhs, bPtr, <usize>n << 3);

  for (let k: i32 = 0; k < n; k++) {
    let pivotRow = k;
    let pivotVal = Math.abs(load<f64>(mat + (<usize>(k * n + k) << 3)));
    for (let i: i32 = k + 1; i < n; i++) {
      const v = Math.abs(load<f64>(mat + (<usize>(i * n + k) << 3)));
      if (v > pivotVal) {
        pivotVal = v;
        pivotRow = i;
      }
    }
    if (pivotVal < 1e-14) {
      heap.free(mat);
      heap.free(rhs);
      return false;
    }
    if (pivotRow != k) {
      for (let j: i32 = k; j < n; j++) {
        const o1 = mat + (<usize>(k * n + j) << 3);
        const o2 = mat + (<usize>(pivotRow * n + j) << 3);
        const tmp = load<f64>(o1);
        store<f64>(o1, load<f64>(o2));
        store<f64>(o2, tmp);
      }
      const r1 = rhs + (<usize>k << 3);
      const r2 = rhs + (<usize>pivotRow << 3);
      const tr = load<f64>(r1);
      store<f64>(r1, load<f64>(r2));
      store<f64>(r2, tr);
    }

    const diag = load<f64>(mat + (<usize>(k * n + k) << 3));
    for (let i: i32 = k + 1; i < n; i++) {
      const factor = load<f64>(mat + (<usize>(i * n + k) << 3)) / diag;
      store<f64>(mat + (<usize>(i * n + k) << 3), 0.0);
      for (let j: i32 = k + 1; j < n; j++) {
        const oij = mat + (<usize>(i * n + j) << 3);
        store<f64>(oij, load<f64>(oij) - factor * load<f64>(mat + (<usize>(k * n + j) << 3)));
      }
      const ri = rhs + (<usize>i << 3);
      store<f64>(ri, load<f64>(ri) - factor * load<f64>(rhs + (<usize>k << 3)));
    }
  }

  for (let i: i32 = n - 1; i >= 0; i--) {
    let sum = load<f64>(rhs + (<usize>i << 3));
    for (let j: i32 = i + 1; j < n; j++) {
      sum -= load<f64>(mat + (<usize>(i * n + j) << 3)) * load<f64>(outXPtr + (<usize>j << 3));
    }
    store<f64>(outXPtr + (<usize>i << 3), sum / load<f64>(mat + (<usize>(i * n + i) << 3)));
  }

  heap.free(mat);
  heap.free(rhs);
  return true;
}

/**
 * Sequential Thresholded Least Squares (STLSQ) for SINDy sparse regression.
 * thetaPtr: [nSamples x nFeatures] row-major, targetPtr: [nSamples], outXiPtr: [nFeatures].
 * Returns number of active (non-zero) features.
 */
export function rom_stlsq(
  thetaPtr: usize,
  targetPtr: usize,
  nSamples: i32,
  nFeatures: i32,
  threshold: f64,
  ridgeAlpha: f64,
  maxIter: i32,
  outXiPtr: usize,
): i32 {
  if (nSamples <= 0 || nFeatures <= 0) return 0;

  // Precompute full normal equations G = Theta^T Theta + alpha*I and rhs = Theta^T y
  const gPtr = heap.alloc(<usize>(nFeatures * nFeatures) << 3);
  const rhsPtr = heap.alloc(<usize>nFeatures << 3);
  const activePtr = heap.alloc(<usize>nFeatures);
  const idxMapPtr = heap.alloc(<usize>nFeatures << 2);
  memory.fill(activePtr, 1, <usize>nFeatures);

  for (let i: i32 = 0; i < nFeatures; i++) {
    let ry: f64 = 0.0;
    for (let s: i32 = 0; s < nSamples; s++) {
      ry += load<f64>(thetaPtr + (<usize>(s * nFeatures + i) << 3)) * load<f64>(targetPtr + (<usize>s << 3));
    }
    store<f64>(rhsPtr + (<usize>i << 3), ry);

    for (let j: i32 = i; j < nFeatures; j++) {
      let dot: f64 = 0.0;
      for (let s: i32 = 0; s < nSamples; s++) {
        dot +=
          load<f64>(thetaPtr + (<usize>(s * nFeatures + i) << 3)) *
          load<f64>(thetaPtr + (<usize>(s * nFeatures + j) << 3));
      }
      if (i == j) dot += ridgeAlpha;
      store<f64>(gPtr + (<usize>(i * nFeatures + j) << 3), dot);
      if (i != j) store<f64>(gPtr + (<usize>(j * nFeatures + i) << 3), dot);
    }
  }

  const subG = heap.alloc(<usize>(nFeatures * nFeatures) << 3);
  const subRhs = heap.alloc(<usize>nFeatures << 3);
  const subSol = heap.alloc(<usize>nFeatures << 3);

  let activeCount = nFeatures;
  for (let iter: i32 = 0; iter < maxIter; iter++) {
    activeCount = 0;
    for (let i: i32 = 0; i < nFeatures; i++) {
      if (load<u8>(activePtr + <usize>i) != 0) {
        store<i32>(idxMapPtr + (<usize>activeCount << 2), i);
        activeCount++;
      }
    }
    memory.fill(outXiPtr, 0, <usize>nFeatures << 3);
    if (activeCount == 0) break;

    for (let a: i32 = 0; a < activeCount; a++) {
      const ia = load<i32>(idxMapPtr + (<usize>a << 2));
      store<f64>(subRhs + (<usize>a << 3), load<f64>(rhsPtr + (<usize>ia << 3)));
      for (let b: i32 = 0; b < activeCount; b++) {
        const ib = load<i32>(idxMapPtr + (<usize>b << 2));
        store<f64>(
          subG + (<usize>(a * activeCount + b) << 3),
          load<f64>(gPtr + (<usize>(ia * nFeatures + ib) << 3)),
        );
      }
    }

    if (!solveDenseLinear(subG, subRhs, activeCount, subSol)) break;

    let changed = false;
    for (let a: i32 = 0; a < activeCount; a++) {
      const ia = load<i32>(idxMapPtr + (<usize>a << 2));
      const val = load<f64>(subSol + (<usize>a << 3));
      if (Math.abs(val) < threshold) {
        store<u8>(activePtr + <usize>ia, 0);
        store<f64>(outXiPtr + (<usize>ia << 3), 0.0);
        changed = true;
      } else {
        store<f64>(outXiPtr + (<usize>ia << 3), val);
      }
    }
    if (!changed) break;
  }

  heap.free(subG);
  heap.free(subRhs);
  heap.free(subSol);
  heap.free(gPtr);
  heap.free(rhsPtr);
  heap.free(activePtr);
  heap.free(idxMapPtr);
  return activeCount;
}
