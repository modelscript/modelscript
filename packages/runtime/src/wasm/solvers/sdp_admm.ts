// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly Primal-Dual Interior-Point Semidefinite Programming (SDP) Solver Kernel.
 *
 * Solves standard-form SDP in flat linear memory with zero GC allocations inside the
 * outer iteration loop:
 *   min  <C, X>
 *   s.t. <A_i, X> = b_i,  i = 0 ... m - 1
 *        X >= 0 (symmetric positive semidefinite)
 *
 * Calls `sdp_cholesky` directly in-WASM (zero JS round-trips) for dual slack factorization,
 * primal/dual positive-definite step-length backtracking, and final PSD certification.
 */

import { sdp_cholesky } from "./wasm_advanced_solvers";

@inline
function innerProduct(len: i32, aPtr: usize, bPtr: usize): f64 {
  let sum: f64 = 0.0;
  for (let i: i32 = 0; i < len; i++) {
    const off = (<usize>i) << 3;
    sum += load<f64>(aPtr + off) * load<f64>(bPtr + off);
  }
  return sum;
}

@inline
function symmetrizeCopy(n: i32, srcPtr: usize, dstPtr: usize): void {
  for (let i: i32 = 0; i < n; i++) {
    const rowI = i * n;
    for (let j: i32 = i; j < n; j++) {
      const offIJ = (<usize>(rowI + j)) << 3;
      const offJI = (<usize>(j * n + i)) << 3;
      const avg = 0.5 * (load<f64>(srcPtr + offIJ) + load<f64>(srcPtr + offJI));
      store<f64>(dstPtr + offIJ, avg);
      if (i != j) {
        store<f64>(dstPtr + offJI, avg);
      }
    }
  }
}

@inline
function symmetrizeInPlace(n: i32, ptr: usize): void {
  for (let i: i32 = 0; i < n; i++) {
    const rowI = i * n;
    for (let j: i32 = i + 1; j < n; j++) {
      const offIJ = (<usize>(rowI + j)) << 3;
      const offJI = (<usize>(j * n + i)) << 3;
      const avg = 0.5 * (load<f64>(ptr + offIJ) + load<f64>(ptr + offJI));
      store<f64>(ptr + offIJ, avg);
      store<f64>(ptr + offJI, avg);
    }
  }
}

function matMul(n: i32, aPtr: usize, bPtr: usize, outPtr: usize): void {
  const nn = n * n;
  memory.fill(outPtr, 0, (<usize>nn) << 3);
  for (let i: i32 = 0; i < n; i++) {
    const rowI = i * n;
    for (let k: i32 = 0; k < n; k++) {
      const aik = load<f64>(aPtr + ((<usize>(rowI + k)) << 3));
      if (aik == 0.0) continue;
      const rowK = k * n;
      for (let j: i32 = 0; j < n; j++) {
        const outOff = (<usize>(rowI + j)) << 3;
        const bkj = load<f64>(bPtr + ((<usize>(rowK + j)) << 3));
        store<f64>(outPtr + outOff, load<f64>(outPtr + outOff) + aik * bkj);
      }
    }
  }
}

function invertFromCholesky(n: i32, lPtr: usize, invLPtr: usize, invSPtr: usize): void {
  const nn = n * n;
  memory.fill(invLPtr, 0, (<usize>nn) << 3);

  for (let i: i32 = 0; i < n; i++) {
    const rowI = i * n;
    const lii = load<f64>(lPtr + ((<usize>(rowI + i)) << 3));
    store<f64>(invLPtr + ((<usize>(rowI + i)) << 3), 1.0 / lii);
    for (let j: i32 = 0; j < i; j++) {
      let sum: f64 = 0.0;
      for (let k: i32 = j; k < i; k++) {
        sum +=
          load<f64>(lPtr + ((<usize>(rowI + k)) << 3)) *
          load<f64>(invLPtr + ((<usize>(k * n + j)) << 3));
      }
      store<f64>(invLPtr + ((<usize>(rowI + j)) << 3), -sum / lii);
    }
  }

  for (let i: i32 = 0; i < n; i++) {
    const rowI = i * n;
    for (let j: i32 = i; j < n; j++) {
      let sum: f64 = 0.0;
      for (let k: i32 = j; k < n; k++) {
        const rowK = k * n;
        sum +=
          load<f64>(invLPtr + ((<usize>(rowK + i)) << 3)) *
          load<f64>(invLPtr + ((<usize>(rowK + j)) << 3));
      }
      store<f64>(invSPtr + ((<usize>(rowI + j)) << 3), sum);
      if (i != j) {
        store<f64>(invSPtr + ((<usize>(j * n + i)) << 3), sum);
      }
    }
  }
}

/**
 * Dense Gaussian elimination with partial pivoting solving `A * x = b` in-place.
 * Mutates `aPtr` (`m x m`) and `bPtr` (`m`), writing the solution to `xOutPtr` (`m`).
 * Returns 1 on success, 0 if singular.
 */
function solveLinearSystemInPlace(m: i32, aPtr: usize, bPtr: usize, xOutPtr: usize): i32 {
  if (m <= 0) return 1;

  for (let k: i32 = 0; k < m; k++) {
    let maxVal = Math.abs(load<f64>(aPtr + ((<usize>(k * m + k)) << 3)));
    let piv = k;
    for (let i: i32 = k + 1; i < m; i++) {
      const v = Math.abs(load<f64>(aPtr + ((<usize>(i * m + k)) << 3)));
      if (v > maxVal) {
        maxVal = v;
        piv = i;
      }
    }
    if (maxVal < 1e-14) return 0;

    if (piv != k) {
      const rowK = k * m;
      const rowP = piv * m;
      for (let j: i32 = k; j < m; j++) {
        const offK = (<usize>(rowK + j)) << 3;
        const offP = (<usize>(rowP + j)) << 3;
        const tmp = load<f64>(aPtr + offK);
        store<f64>(aPtr + offK, load<f64>(aPtr + offP));
        store<f64>(aPtr + offP, tmp);
      }
      const bOffK = (<usize>k) << 3;
      const bOffP = (<usize>piv) << 3;
      const tmpB = load<f64>(bPtr + bOffK);
      store<f64>(bPtr + bOffK, load<f64>(bPtr + bOffP));
      store<f64>(bPtr + bOffP, tmpB);
    }

    const rowK = k * m;
    const diag = load<f64>(aPtr + ((<usize>(rowK + k)) << 3));
    const bk = load<f64>(bPtr + ((<usize>k) << 3));
    for (let i: i32 = k + 1; i < m; i++) {
      const rowI = i * m;
      const f = load<f64>(aPtr + ((<usize>(rowI + k)) << 3)) / diag;
      if (f == 0.0) continue;
      for (let j: i32 = k + 1; j < m; j++) {
        const offIJ = (<usize>(rowI + j)) << 3;
        const akj = load<f64>(aPtr + ((<usize>(rowK + j)) << 3));
        store<f64>(aPtr + offIJ, load<f64>(aPtr + offIJ) - f * akj);
      }
      const bOffI = (<usize>i) << 3;
      store<f64>(bPtr + bOffI, load<f64>(bPtr + bOffI) - f * bk);
    }
  }

  for (let i: i32 = m - 1; i >= 0; i--) {
    const rowI = i * m;
    let sum = load<f64>(bPtr + ((<usize>i) << 3));
    for (let j: i32 = i + 1; j < m; j++) {
      sum -=
        load<f64>(aPtr + ((<usize>(rowI + j)) << 3)) *
        load<f64>(xOutPtr + ((<usize>j) << 3));
    }
    store<f64>(xOutPtr + ((<usize>i) << 3), sum / load<f64>(aPtr + ((<usize>(rowI + i)) << 3)));
  }

  return 1;
}

function maxPdStep(n: i32, mPtr: usize, dMPtr: usize, trialPtr: usize, lPtr: usize): f64 {
  let alpha: f64 = 1.0;
  const nn = n * n;
  for (let back: i32 = 0; back < 40; back++) {
    for (let idx: i32 = 0; idx < nn; idx++) {
      const off = (<usize>idx) << 3;
      store<f64>(trialPtr + off, load<f64>(mPtr + off) + alpha * load<f64>(dMPtr + off));
    }
    if (sdp_cholesky(n, trialPtr, lPtr) == 1) return alpha;
    alpha *= 0.5;
  }
  return 0.0;
}

function isSymmetricPsd(n: i32, xPtr: usize, lPtr: usize): bool {
  for (let i: i32 = 0; i < n; i++) {
    const rowI = i * n;
    for (let j: i32 = i + 1; j < n; j++) {
      const a = load<f64>(xPtr + ((<usize>(rowI + j)) << 3));
      const b = load<f64>(xPtr + ((<usize>(j * n + i)) << 3));
      if (Math.abs(a - b) > 1e-8) return false;
    }
  }
  return sdp_cholesky(n, xPtr, lPtr) == 1;
}

/**
 * Solves standard-form SDP in flat WASM linear memory:
 *   min <C, X>  s.t.  <A_i, X> = b_i (i = 0..m-1),  X >= 0.
 *
 * Parameters:
 *   - `n`: matrix dimension (`n x n`)
 *   - `m`: number of linear constraints
 *   - `cPtr`: `f64[n * n]` objective matrix `C` (row-major)
 *   - `aPtr`: `f64[m * n * n]` constraint matrices `A_0 .. A_{m-1}` (row-major per matrix)
 *   - `bPtr`: `f64[m]` right-hand side vector `b`
 *   - `maxIter`: maximum outer iterations
 *   - `tol`: primal/dual/complementarity convergence tolerance
 *   - `xOutPtr`: `f64[n * n]` output primal matrix `X`
 *   - `yOutPtr`: `f64[m]` output dual multiplier vector `y`
 *   - `sOutPtr`: `f64[n * n]` output dual slack matrix `S`
 *   - `statsOutPtr`: `f64[4]` output `[primalObj, iterations, residual, dualityGap]`
 *
 * Returns status code: `2 = OPTIMAL`, `1 = FEASIBLE`, `0 = INFEASIBLE`.
 */
export function sdp_solveAdmmWasm(
  n: i32,
  m: i32,
  cPtr: usize,
  aPtr: usize,
  bPtr: usize,
  maxIter: i32,
  tol: f64,
  xOutPtr: usize,
  yOutPtr: usize,
  sOutPtr: usize,
  statsOutPtr: usize
): i32 {
  if (n <= 0) {
    if (statsOutPtr != 0) {
      store<f64>(statsOutPtr + 0, 0.0);
      store<f64>(statsOutPtr + 8, 0.0);
      store<f64>(statsOutPtr + 16, 0.0);
      store<f64>(statsOutPtr + 24, 0.0);
    }
    return 2;
  }

  if (m < 0) m = 0;
  if (maxIter < 0) maxIter = 0;

  const nn = n * n;
  const mm = m * m;
  const nnBytes = (<usize>nn) << 3;
  const mBytes = (<usize>m) << 3;
  const mmBytes = (<usize>mm) << 3;
  const mNnBytes = (<usize>(m * nn)) << 3;

  // Single linear scratch allocation outside the iteration loop:
  //   cSym (nn) + aSym (m*nn) + rd (nn) + l (nn) + invL (nn) + sInv (nn)
  //   + dS (nn) + dX (nn) + tmp1 (nn) + tmp2 (nn) + mMat (mm) + rp (m) + rhs (m) + dy (m)
  const totalBytes: usize =
    nnBytes * 9 + mNnBytes + mmBytes + mBytes * 3;
  const workPtr: usize = heap.alloc(totalBytes);
  let cursor = workPtr;

  const cSymPtr = cursor;
  cursor += nnBytes;
  const aSymPtr = cursor;
  cursor += mNnBytes;
  const rdPtr = cursor;
  cursor += nnBytes;
  const lPtr = cursor;
  cursor += nnBytes;
  const invLPtr = cursor;
  cursor += nnBytes;
  const sInvPtr = cursor;
  cursor += nnBytes;
  const dSPtr = cursor;
  cursor += nnBytes;
  const dXPtr = cursor;
  cursor += nnBytes;
  const tmp1Ptr = cursor;
  cursor += nnBytes;
  const tmp2Ptr = cursor;
  cursor += nnBytes;
  const mPtr = cursor;
  cursor += mmBytes;
  const rpPtr = cursor;
  cursor += mBytes;
  const rhsPtr = cursor;
  cursor += mBytes;
  const dyPtr = cursor;

  // Symmetrize C and A_0..A_{m-1}
  symmetrizeCopy(n, cPtr, cSymPtr);
  for (let k: i32 = 0; k < m; k++) {
    const kOff = (<usize>(k * nn)) << 3;
    symmetrizeCopy(n, aPtr + kOff, aSymPtr + kOff);
  }

  // Initial scale & diagonal initialization
  let scale: f64 = 1.0;
  for (let i: i32 = 0; i < m; i++) {
    const v = Math.abs(load<f64>(bPtr + ((<usize>i) << 3)));
    if (v > scale) scale = v;
  }
  for (let idx: i32 = 0; idx < nn; idx++) {
    const v = Math.abs(load<f64>(cSymPtr + ((<usize>idx) << 3)));
    if (v > scale) scale = v;
  }
  const sqrtScale = Math.sqrt(scale);
  const initDiag: f64 = sqrtScale > 1.0 ? sqrtScale : 1.0;

  memory.fill(xOutPtr, 0, nnBytes);
  memory.fill(sOutPtr, 0, nnBytes);
  for (let i: i32 = 0; i < n; i++) {
    const diagOff = (<usize>(i * n + i)) << 3;
    store<f64>(xOutPtr + diagOff, initDiag);
    store<f64>(sOutPtr + diagOff, initDiag);
  }
  if (m > 0) {
    memory.fill(yOutPtr, 0, mBytes);
  }

  let iterations: i32 = 0;
  let primalRes: f64 = Infinity;
  let dualRes: f64 = Infinity;
  let gap: f64 = innerProduct(nn, xOutPtr, sOutPtr);
  const gapTol: f64 = tol * <f64>(n > 1 ? n : 1);

  for (let iter: i32 = 0; iter < maxIter; iter++) {
    iterations++;

    // Primal residual rp_i = b_i - <A_i, X>
    primalRes = 0.0;
    for (let i: i32 = 0; i < m; i++) {
      const aiPtr = aSymPtr + ((<usize>(i * nn)) << 3);
      const val = load<f64>(bPtr + ((<usize>i) << 3)) - innerProduct(nn, aiPtr, xOutPtr);
      store<f64>(rpPtr + ((<usize>i) << 3), val);
      const av = Math.abs(val);
      if (av > primalRes) primalRes = av;
    }

    // Dual residual Rd = C - S - sum_k y_k * A_k
    for (let idx: i32 = 0; idx < nn; idx++) {
      const off = (<usize>idx) << 3;
      store<f64>(rdPtr + off, load<f64>(cSymPtr + off) - load<f64>(sOutPtr + off));
    }
    for (let k: i32 = 0; k < m; k++) {
      const yk = load<f64>(yOutPtr + ((<usize>k) << 3));
      if (yk == 0.0) continue;
      const akPtr = aSymPtr + ((<usize>(k * nn)) << 3);
      for (let idx: i32 = 0; idx < nn; idx++) {
        const off = (<usize>idx) << 3;
        store<f64>(rdPtr + off, load<f64>(rdPtr + off) - yk * load<f64>(akPtr + off));
      }
    }
    const rdNormSq = innerProduct(nn, rdPtr, rdPtr);
    dualRes = Math.sqrt(rdNormSq > 0.0 ? rdNormSq : 0.0);

    const rawGap = innerProduct(nn, xOutPtr, sOutPtr);
    gap = rawGap > 0.0 ? rawGap : 0.0;
    const mu = gap / <f64>n;

    if (primalRes < tol && dualRes < tol && gap < gapTol) {
      if (statsOutPtr != 0) {
        store<f64>(statsOutPtr + 0, innerProduct(nn, cSymPtr, xOutPtr));
        store<f64>(statsOutPtr + 8, <f64>iterations);
        store<f64>(statsOutPtr + 16, primalRes);
        store<f64>(statsOutPtr + 24, gap);
      }
      heap.free(workPtr);
      return 2;
    }

    // Factor S = L * L^T and compute S^{-1}
    if (sdp_cholesky(n, sOutPtr, lPtr) != 1) break;
    invertFromCholesky(n, lPtr, invLPtr, sInvPtr);

    // Form Schur complement matrix M_{ij} = <A_i, X * A_j * S^{-1}> + 1e-10 * delta_{ij}
    if (m > 0) {
      memory.fill(mPtr, 0, mmBytes);
      for (let j: i32 = 0; j < m; j++) {
        const ajPtr = aSymPtr + ((<usize>(j * nn)) << 3);
        matMul(n, xOutPtr, ajPtr, tmp1Ptr);
        matMul(n, tmp1Ptr, sInvPtr, tmp2Ptr);
        for (let i: i32 = 0; i <= j; i++) {
          const aiPtr = aSymPtr + ((<usize>(i * nn)) << 3);
          const val = innerProduct(nn, aiPtr, tmp2Ptr);
          store<f64>(mPtr + ((<usize>(i * m + j)) << 3), val);
          if (i != j) {
            store<f64>(mPtr + ((<usize>(j * m + i)) << 3), val);
          }
        }
        const diagOff = (<usize>(j * m + j)) << 3;
        store<f64>(mPtr + diagOff, load<f64>(mPtr + diagOff) + 1e-10);
      }
    }

    // Form RHS: rhs_i = rp_i - <A_i, sigma * mu * S^{-1} - X + X * Rd * S^{-1}>
    const sigma: f64 = primalRes < tol * 10.0 && dualRes < tol * 10.0 ? 0.1 : 0.25;
    const sigmaMu = sigma * mu;
    matMul(n, xOutPtr, rdPtr, tmp1Ptr);
    matMul(n, tmp1Ptr, sInvPtr, tmp2Ptr);
    for (let idx: i32 = 0; idx < nn; idx++) {
      const off = (<usize>idx) << 3;
      const rVal =
        sigmaMu * load<f64>(sInvPtr + off) -
        load<f64>(xOutPtr + off) +
        load<f64>(tmp2Ptr + off);
      store<f64>(tmp2Ptr + off, rVal);
    }
    for (let i: i32 = 0; i < m; i++) {
      const aiPtr = aSymPtr + ((<usize>(i * nn)) << 3);
      const val = load<f64>(rpPtr + ((<usize>i) << 3)) - innerProduct(nn, aiPtr, tmp2Ptr);
      store<f64>(rhsPtr + ((<usize>i) << 3), val);
    }

    // Solve M * dy = rhs
    if (m > 0) {
      if (solveLinearSystemInPlace(m, mPtr, rhsPtr, dyPtr) == 0) break;
    }

    // Compute dS = sym(Rd - sum_k dy_k * A_k)
    memory.copy(dSPtr, rdPtr, nnBytes);
    for (let k: i32 = 0; k < m; k++) {
      const dyk = load<f64>(dyPtr + ((<usize>k) << 3));
      if (dyk == 0.0) continue;
      const akPtr = aSymPtr + ((<usize>(k * nn)) << 3);
      for (let idx: i32 = 0; idx < nn; idx++) {
        const off = (<usize>idx) << 3;
        store<f64>(dSPtr + off, load<f64>(dSPtr + off) - dyk * load<f64>(akPtr + off));
      }
    }
    symmetrizeInPlace(n, dSPtr);

    // Compute dX = sym(sigma * mu * S^{-1} - X - X * dS * S^{-1})
    matMul(n, xOutPtr, dSPtr, tmp1Ptr);
    matMul(n, tmp1Ptr, sInvPtr, tmp2Ptr);
    for (let idx: i32 = 0; idx < nn; idx++) {
      const off = (<usize>idx) << 3;
      const val =
        sigmaMu * load<f64>(sInvPtr + off) -
        load<f64>(xOutPtr + off) -
        load<f64>(tmp2Ptr + off);
      store<f64>(dXPtr + off, val);
    }
    symmetrizeInPlace(n, dXPtr);

    // Backtracking PD step lengths
    const rawAlphaP = 0.98 * maxPdStep(n, xOutPtr, dXPtr, tmp1Ptr, lPtr);
    const alphaP: f64 = rawAlphaP < 1.0 ? rawAlphaP : 1.0;
    const rawAlphaD = 0.98 * maxPdStep(n, sOutPtr, dSPtr, tmp1Ptr, lPtr);
    const alphaD: f64 = rawAlphaD < 1.0 ? rawAlphaD : 1.0;
    if (alphaP < 1e-12 && alphaD < 1e-12) break;

    for (let idx: i32 = 0; idx < nn; idx++) {
      const off = (<usize>idx) << 3;
      store<f64>(xOutPtr + off, load<f64>(xOutPtr + off) + alphaP * load<f64>(dXPtr + off));
      store<f64>(sOutPtr + off, load<f64>(sOutPtr + off) + alphaD * load<f64>(dSPtr + off));
    }
    for (let k: i32 = 0; k < m; k++) {
      const off = (<usize>k) << 3;
      store<f64>(yOutPtr + off, load<f64>(yOutPtr + off) + alphaD * load<f64>(dyPtr + off));
    }
  }

  let finalResidual: f64 = 0.0;
  for (let i: i32 = 0; i < m; i++) {
    const aiPtr = aSymPtr + ((<usize>(i * nn)) << 3);
    const val = Math.abs(
      load<f64>(bPtr + ((<usize>i) << 3)) - innerProduct(nn, aiPtr, xOutPtr)
    );
    if (val > finalResidual) finalResidual = val;
  }
  const finalRawGap = innerProduct(nn, xOutPtr, sOutPtr);
  gap = finalRawGap > 0.0 ? finalRawGap : 0.0;
  const primalObj = innerProduct(nn, cSymPtr, xOutPtr);
  const xIsPsd = isSymmetricPsd(n, xOutPtr, lPtr);
  const isOptimal = finalResidual < tol && dualRes < tol && gap < gapTol && xIsPsd;
  const feasTol: f64 = tol * 10.0 > 1e-4 ? tol * 10.0 : 1e-4;
  const isFeasible = xIsPsd && isFinite(finalResidual) && (m == 0 || finalResidual <= feasTol);

  if (statsOutPtr != 0) {
    store<f64>(statsOutPtr + 0, primalObj);
    store<f64>(statsOutPtr + 8, <f64>iterations);
    store<f64>(statsOutPtr + 16, finalResidual);
    store<f64>(statsOutPtr + 24, gap);
  }

  heap.free(workPtr);

  if (isOptimal) return 2;
  if (isFeasible) return 1;
  return 0;
}
