// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Linear-Memory Kernels for 3-Stage Order-5 Radau IIA Stiff DAE Solver.
 *
 * Implements Hairer & Wanner's decoupled spectral decomposition (1 real n×n LU + 1 complex n×n LU),
 * 3-stage residual evaluation, Newton stage transform / solve / update, and stiff-filtered
 * embedded error estimation directly in WebAssembly linear memory with zero heap allocations.
 */

import { luFactor, luSolve } from "./matrix";

// Inverse of 3-stage Order-5 Radau IIA Butcher matrix (W = A^-1)
const W00: f64 = 3.224744871391589;
const W01: f64 = 1.1678400846904056;
const W02: f64 = -0.25319726142948834;
const W10: f64 = -3.5678400846904057;
const W11: f64 = 0.775255128608411;
const W12: f64 = 1.0531972614294884;
const W20: f64 = 5.531972614294884;
const W21: f64 = -7.531972614294884;
const W22: f64 = 5.0;

// Spectral decomposition eigenvalues of W_ORDER5
const RADAU5_GAMMA: f64 = 3.63783426820258482;
const RADAU5_ALPHA: f64 = 2.68108286589870737;
const RADAU5_BETA: f64 = 3.05043018748446215;

// Spectral transformation matrices T and T^-1
const T00: f64 = 9.12323943571072965e-2;
const T01: f64 = 1.28458063056954647e-1;
const T02: f64 = -2.73086537351891964e-2;
const T10: f64 = 2.41717931090874e-1;
const T11: f64 = -1.8563595249580056e-1;
const T12: f64 = 3.48248905105458417e-1;
const T20: f64 = 9.66048183068016875e-1;
const T21: f64 = -9.09403516982782212e-1;
const T22: f64 = 0.0;

const TI00: f64 = 4.32557988671561411;
const TI01: f64 = 3.3919923824152215e-1;
const TI02: f64 = 5.41770546262493102e-1;
const TI10: f64 = 4.59501036914979633;
const TI11: f64 = 3.60327183348117475e-1;
const TI12: f64 = -5.24105679428965243e-1;
const TI20: f64 = -5.52969705164406689e-1;
const TI21: f64 = 2.82814713084988334;
const TI22: f64 = -6.55417746420991043e-1;

// Hairer & Wanner (IV.8, Eq. 8.19) embedded error estimator weights
const SQRT6: f64 = 2.449489742783178;
const E1: f64 = (-13.0 - 7.0 * SQRT6) / 3.0;
const E2: f64 = (-13.0 + 7.0 * SQRT6) / 3.0;
const E3: f64 = -1.0 / 3.0;

/**
 * Complex dense LU factorization with partial pivoting for an n×n matrix (Ar + i * Ai).
 * Overwrites `arPtr` and `aiPtr` in place and writes row permutation to `pivPtr` (n × i32).
 * Returns 1 on success, 0 if singular.
 */
export function radau5_complex_lu_factor(
  n: i32,
  arPtr: usize,
  aiPtr: usize,
  pivPtr: usize,
): i32 {
  if (n <= 0) return 1;

  for (let i: i32 = 0; i < n; i++) {
    store<i32>(pivPtr + ((i as usize) << 2), i);
  }

  for (let k: i32 = 0; k < n; k++) {
    let maxVal: f64 = 0.0;
    let maxIdx: i32 = k;
    for (let i: i32 = k; i < n; i++) {
      const idx = ((i * n + k) as usize) << 3;
      const re = load<f64>(arPtr + idx);
      const im = load<f64>(aiPtr + idx);
      const mag = Math.abs(re) + Math.abs(im);
      if (mag > maxVal) {
        maxVal = mag;
        maxIdx = i;
      }
    }

    if (maxVal < 1e-30) return 0;

    if (maxIdx != k) {
      const kRowOff = (k * n) as usize;
      const mRowOff = (maxIdx * n) as usize;
      for (let j: i32 = 0; j < n; j++) {
        const kjOff = (kRowOff + (j as usize)) << 3;
        const mjOff = (mRowOff + (j as usize)) << 3;

        const tr = load<f64>(arPtr + kjOff);
        store<f64>(arPtr + kjOff, load<f64>(arPtr + mjOff));
        store<f64>(arPtr + mjOff, tr);

        const ti = load<f64>(aiPtr + kjOff);
        store<f64>(aiPtr + kjOff, load<f64>(aiPtr + mjOff));
        store<f64>(aiPtr + mjOff, ti);
      }
      const pkOff = (k as usize) << 2;
      const pmOff = (maxIdx as usize) << 2;
      const tp = load<i32>(pivPtr + pkOff);
      store<i32>(pivPtr + pkOff, load<i32>(pivPtr + pmOff));
      store<i32>(pivPtr + pmOff, tp);
    }

    const kkOff = ((k * n + k) as usize) << 3;
    const dRe = load<f64>(arPtr + kkOff);
    const dIm = load<f64>(aiPtr + kkOff);
    const dNorm = dRe * dRe + dIm * dIm;
    if (dNorm < 1e-60) return 0;

    const invDNorm = 1.0 / dNorm;
    const kRowBase = k * n;

    for (let i: i32 = k + 1; i < n; i++) {
      const iRowBase = i * n;
      const ikOff = ((iRowBase + k) as usize) << 3;
      const nRe = load<f64>(arPtr + ikOff);
      const nIm = load<f64>(aiPtr + ikOff);
      const mRe = (nRe * dRe + nIm * dIm) * invDNorm;
      const mIm = (nIm * dRe - nRe * dIm) * invDNorm;
      store<f64>(arPtr + ikOff, mRe);
      store<f64>(aiPtr + ikOff, mIm);

      for (let j: i32 = k + 1; j < n; j++) {
        const kjOff = ((kRowBase + j) as usize) << 3;
        const ijOff = ((iRowBase + j) as usize) << 3;
        const kjRe = load<f64>(arPtr + kjOff);
        const kjIm = load<f64>(aiPtr + kjOff);
        store<f64>(arPtr + ijOff, load<f64>(arPtr + ijOff) - (mRe * kjRe - mIm * kjIm));
        store<f64>(aiPtr + ijOff, load<f64>(aiPtr + ijOff) - (mRe * kjIm + mIm * kjRe));
      }
    }
  }
  return 1;
}

/**
 * Solves (Ar + i * Ai) x = (br + i * bi) in place using precomputed complex LU factors.
 * `tmpRPtr` and `tmpIPtr` are scratch buffers of n × f64 each.
 */
export function radau5_complex_lu_solve(
  n: i32,
  arPtr: usize,
  aiPtr: usize,
  pivPtr: usize,
  brPtr: usize,
  biPtr: usize,
  tmpRPtr: usize,
  tmpIPtr: usize,
): void {
  if (n <= 0) return;

  // Apply row permutation: tmp[k] = b[piv[k]]
  for (let k: i32 = 0; k < n; k++) {
    const p = load<i32>(pivPtr + ((k as usize) << 2));
    const kOff = (k as usize) << 3;
    const pOff = (p as usize) << 3;
    store<f64>(tmpRPtr + kOff, load<f64>(brPtr + pOff));
    store<f64>(tmpIPtr + kOff, load<f64>(biPtr + pOff));
  }
  for (let k: i32 = 0; k < n; k++) {
    const kOff = (k as usize) << 3;
    store<f64>(brPtr + kOff, load<f64>(tmpRPtr + kOff));
    store<f64>(biPtr + kOff, load<f64>(tmpIPtr + kOff));
  }

  // Forward substitution: L * y = b
  for (let i: i32 = 0; i < n; i++) {
    const iOff = (i as usize) << 3;
    const iRowBase = i * n;
    let sumR = load<f64>(brPtr + iOff);
    let sumI = load<f64>(biPtr + iOff);
    for (let j: i32 = 0; j < i; j++) {
      const ijOff = ((iRowBase + j) as usize) << 3;
      const jOff = (j as usize) << 3;
      const mRe = load<f64>(arPtr + ijOff);
      const mIm = load<f64>(aiPtr + ijOff);
      const bjR = load<f64>(brPtr + jOff);
      const bjI = load<f64>(biPtr + jOff);
      sumR -= mRe * bjR - mIm * bjI;
      sumI -= mRe * bjI + mIm * bjR;
    }
    store<f64>(brPtr + iOff, sumR);
    store<f64>(biPtr + iOff, sumI);
  }

  // Back substitution: U * x = y
  for (let i: i32 = n - 1; i >= 0; i--) {
    const iOff = (i as usize) << 3;
    const iRowBase = i * n;
    let sumR = load<f64>(brPtr + iOff);
    let sumI = load<f64>(biPtr + iOff);
    for (let j: i32 = i + 1; j < n; j++) {
      const ijOff = ((iRowBase + j) as usize) << 3;
      const jOff = (j as usize) << 3;
      const uRe = load<f64>(arPtr + ijOff);
      const uIm = load<f64>(aiPtr + ijOff);
      const bjR = load<f64>(brPtr + jOff);
      const bjI = load<f64>(biPtr + jOff);
      sumR -= uRe * bjR - uIm * bjI;
      sumI -= uRe * bjI + uIm * bjR;
    }
    const iiOff = ((iRowBase + i) as usize) << 3;
    const dRe = load<f64>(arPtr + iiOff);
    const dIm = load<f64>(aiPtr + iiOff);
    const invDNorm = 1.0 / (dRe * dRe + dIm * dIm);
    store<f64>(brPtr + iOff, (sumR * dRe + sumI * dIm) * invDNorm);
    store<f64>(biPtr + iOff, (sumI * dRe - sumR * dIm) * invDNorm);
  }
}

/**
 * Builds and LU-factors both decoupled Radau5 Jacobian blocks in linear memory:
 *   - Real block:    MatReal = gamma * M - h * J
 *   - Complex block: Ar + i * Ai = (alpha * M - h * J) - i * (beta * M)
 * Returns 1 if both factorizations succeed, 0 if either is singular.
 */
export function radau5_factor_decoupled(
  n: i32,
  h: f64,
  mPtr: usize,
  jPtr: usize,
  matRealPtr: usize,
  pivRealPtr: usize,
  scaleRealPtr: usize,
  arPtr: usize,
  aiPtr: usize,
  pivComplexPtr: usize,
): i32 {
  if (n <= 0) return 1;
  const nn = n * n;
  for (let k: i32 = 0; k < nn; k++) {
    const off = (k as usize) << 3;
    const mVal = load<f64>(mPtr + off);
    const hJ = h * load<f64>(jPtr + off);
    store<f64>(matRealPtr + off, RADAU5_GAMMA * mVal - hJ);
    store<f64>(arPtr + off, RADAU5_ALPHA * mVal - hJ);
    store<f64>(aiPtr + off, -RADAU5_BETA * mVal);
  }

  if (!luFactor(<u32>matRealPtr, <u32>pivRealPtr, <u32>scaleRealPtr, <u32>n)) {
    return 0;
  }
  return radau5_complex_lu_factor(n, arPtr, aiPtr, pivComplexPtr);
}

/**
 * Evaluates the 3-stage Radau IIA nonlinear residual vector:
 *   R_i = sum_{j=0}^{2} W_{ij} * M * Z_j - h * f_i   (i = 0, 1, 2)
 * Writes 3*n f64 values into `rOutPtr` and returns max_k |R_k|.
 */
export function radau5_stage_residual(
  n: i32,
  h: f64,
  mPtr: usize,
  zPtr: usize,
  fAllPtr: usize,
  rOutPtr: usize,
): f64 {
  if (n <= 0) return 0.0;
  const nBytes = (n as usize) << 3;
  const z0Ptr = zPtr;
  const z1Ptr = zPtr + nBytes;
  const z2Ptr = z1Ptr + nBytes;

  const f0Ptr = fAllPtr;
  const f1Ptr = fAllPtr + nBytes;
  const f2Ptr = f1Ptr + nBytes;

  const r0Ptr = rOutPtr;
  const r1Ptr = rOutPtr + nBytes;
  const r2Ptr = r1Ptr + nBytes;

  let maxR: f64 = 0.0;

  for (let r: i32 = 0; r < n; r++) {
    const mRowPtr = mPtr + (((r * n) as usize) << 3);
    let mZ0: f64 = 0.0;
    let mZ1: f64 = 0.0;
    let mZ2: f64 = 0.0;
    for (let c: i32 = 0; c < n; c++) {
      const cOff = (c as usize) << 3;
      const mrc = load<f64>(mRowPtr + cOff);
      mZ0 += mrc * load<f64>(z0Ptr + cOff);
      mZ1 += mrc * load<f64>(z1Ptr + cOff);
      mZ2 += mrc * load<f64>(z2Ptr + cOff);
    }

    const rOff = (r as usize) << 3;
    const res0 = W00 * mZ0 + W01 * mZ1 + W02 * mZ2 - h * load<f64>(f0Ptr + rOff);
    const res1 = W10 * mZ0 + W11 * mZ1 + W12 * mZ2 - h * load<f64>(f1Ptr + rOff);
    const res2 = W20 * mZ0 + W21 * mZ1 + W22 * mZ2 - h * load<f64>(f2Ptr + rOff);

    store<f64>(r0Ptr + rOff, res0);
    store<f64>(r1Ptr + rOff, res1);
    store<f64>(r2Ptr + rOff, res2);

    const a0 = Math.abs(res0);
    const a1 = Math.abs(res1);
    const a2 = Math.abs(res2);
    if (a0 > maxR) maxR = a0;
    if (a1 > maxR) maxR = a1;
    if (a2 > maxR) maxR = a2;
  }

  return maxR;
}

/**
 * Executes one decoupled 3-stage Radau IIA Newton linear solve and stage update in linear memory:
 *   1. Forward transform & negate: [dw1, br, bi] = -(T_INV ⊗ I) * R
 *   2. Real block solve:    MatReal * dw1 = -R_tilde_1
 *   3. Complex block solve: (Ar + i*Ai) * (br + i*bi) = -(R_tilde_2 + i*R_tilde_3)
 *   4. Back-transform & update: Z += (T ⊗ I) * [dw1, br, bi]
 *   5. Writes [maxDelta, maxState] (2 × f64) to `outNormsPtr`.
 *
 * `scratchPtr` must provide at least `5 * n * 8` bytes (`dw1`, `br`, `bi`, `tmpR`/luScratch, `tmpI`).
 */
export function radau5_newton_solve_and_update(
  n: i32,
  matRealPtr: usize,
  pivRealPtr: usize,
  scaleRealPtr: usize,
  arPtr: usize,
  aiPtr: usize,
  pivComplexPtr: usize,
  rPtr: usize,
  yPtr: usize,
  zPtr: usize,
  scratchPtr: usize,
  outNormsPtr: usize,
): void {
  if (n <= 0) {
    store<f64>(outNormsPtr, 0.0);
    store<f64>(outNormsPtr + 8, 0.0);
    return;
  }

  const nBytes = (n as usize) << 3;
  const dw1Ptr = scratchPtr;
  const brPtr = dw1Ptr + nBytes;
  const biPtr = brPtr + nBytes;
  const tmpRPtr = biPtr + nBytes;
  const tmpIPtr = tmpRPtr + nBytes;

  const r0Ptr = rPtr;
  const r1Ptr = rPtr + nBytes;
  const r2Ptr = r1Ptr + nBytes;

  // 1. Forward spectral transform with negation
  for (let r: i32 = 0; r < n; r++) {
    const off = (r as usize) << 3;
    const r0 = load<f64>(r0Ptr + off);
    const r1 = load<f64>(r1Ptr + off);
    const r2 = load<f64>(r2Ptr + off);
    store<f64>(dw1Ptr + off, -(TI00 * r0 + TI01 * r1 + TI02 * r2));
    store<f64>(brPtr + off, -(TI10 * r0 + TI11 * r1 + TI12 * r2));
    store<f64>(biPtr + off, -(TI20 * r0 + TI21 * r1 + TI22 * r2));
  }

  // 2. Real block solve (reuses tmpRPtr as luSolve scratch)
  luSolve(<u32>matRealPtr, <u32>pivRealPtr, <u32>scaleRealPtr, <u32>dw1Ptr, <u32>tmpRPtr, <u32>n);

  // 3. Complex block solve
  radau5_complex_lu_solve(n, arPtr, aiPtr, pivComplexPtr, brPtr, biPtr, tmpRPtr, tmpIPtr);

  // 4. Back-transform to stage coordinates, update Z, and track convergence norms
  const z0Ptr = zPtr;
  const z1Ptr = zPtr + nBytes;
  const z2Ptr = z1Ptr + nBytes;

  let maxDelta: f64 = 0.0;
  let maxState: f64 = 0.0;

  for (let r: i32 = 0; r < n; r++) {
    const off = (r as usize) << 3;
    const w1 = load<f64>(dw1Ptr + off);
    const w2 = load<f64>(brPtr + off);
    const w3 = load<f64>(biPtr + off);
    const yr = load<f64>(yPtr + off);

    const d0 = T00 * w1 + T01 * w2 + T02 * w3;
    const d1 = T10 * w1 + T11 * w2 + T12 * w3;
    const d2 = T20 * w1 + T21 * w2 + T22 * w3;

    const z0 = load<f64>(z0Ptr + off) + d0;
    const z1 = load<f64>(z1Ptr + off) + d1;
    const z2 = load<f64>(z2Ptr + off) + d2;

    store<f64>(z0Ptr + off, z0);
    store<f64>(z1Ptr + off, z1);
    store<f64>(z2Ptr + off, z2);

    const ad0 = Math.abs(d0);
    const ad1 = Math.abs(d1);
    const ad2 = Math.abs(d2);
    if (ad0 > maxDelta) maxDelta = ad0;
    if (ad1 > maxDelta) maxDelta = ad1;
    if (ad2 > maxDelta) maxDelta = ad2;

    const s0 = Math.abs(yr + z0);
    const s1 = Math.abs(yr + z1);
    const s2 = Math.abs(yr + z2);
    if (s0 > maxState) maxState = s0;
    if (s1 > maxState) maxState = s1;
    if (s2 > maxState) maxState = s2;
  }

  store<f64>(outNormsPtr, maxDelta);
  store<f64>(outNormsPtr + 8, maxState);
}

/**
 * Hairer & Wanner (IV.8, Eq. 8.19) stiff-filtered embedded error estimator for 3-stage Radau IIA:
 *   (gamma * M - h * J) * err = h * f(t, y) + M * (e1 * Z1 + e2 * Z2 + e3 * Z3)
 *
 * Solves for `err` using the factored real block and returns the weighted RMS error norm
 * over differential rows (rows where ||M[r, :]||_1 > 0).
 *
 * `scratchPtr` must provide at least `3 * n * 8 + n` bytes (`eZ`, `errRhs`, `luScratch`, `isDiffRow`).
 */
export function radau5_error_estimate(
  n: i32,
  h: f64,
  mPtr: usize,
  zPtr: usize,
  f0Ptr: usize,
  yPtr: usize,
  matRealPtr: usize,
  pivRealPtr: usize,
  scaleRealPtr: usize,
  atol: f64,
  rtol: f64,
  scratchPtr: usize,
): f64 {
  if (n <= 0) return 0.0;
  const nBytes = (n as usize) << 3;
  const eZPtr = scratchPtr;
  const errRhsPtr = eZPtr + nBytes;
  const luScratchPtr = errRhsPtr + nBytes;
  const isDiffRowPtr = luScratchPtr + nBytes;

  const z0Ptr = zPtr;
  const z1Ptr = zPtr + nBytes;
  const z2Ptr = z1Ptr + nBytes;

  for (let r: i32 = 0; r < n; r++) {
    const off = (r as usize) << 3;
    const ez = E1 * load<f64>(z0Ptr + off) + E2 * load<f64>(z1Ptr + off) + E3 * load<f64>(z2Ptr + off);
    store<f64>(eZPtr + off, ez);
  }

  for (let r: i32 = 0; r < n; r++) {
    const mRowPtr = mPtr + (((r * n) as usize) << 3);
    let mEz: f64 = 0.0;
    let rowNormM: f64 = 0.0;
    for (let c: i32 = 0; c < n; c++) {
      const cOff = (c as usize) << 3;
      const mrc = load<f64>(mRowPtr + cOff);
      rowNormM += Math.abs(mrc);
      mEz += mrc * load<f64>(eZPtr + cOff);
    }
    const rOff = (r as usize) << 3;
    if (rowNormM > 0.0) {
      store<u8>(isDiffRowPtr + (r as usize), 1);
      store<f64>(errRhsPtr + rOff, h * load<f64>(f0Ptr + rOff) + mEz);
    } else {
      store<u8>(isDiffRowPtr + (r as usize), 0);
      store<f64>(errRhsPtr + rOff, 0.0);
    }
  }

  luSolve(<u32>matRealPtr, <u32>pivRealPtr, <u32>scaleRealPtr, <u32>errRhsPtr, <u32>luScratchPtr, <u32>n);

  let errSq: f64 = 0.0;
  let diffCount: i32 = 0;
  for (let r: i32 = 0; r < n; r++) {
    if (load<u8>(isDiffRowPtr + (r as usize)) == 0) continue;
    diffCount++;
    const off = (r as usize) << 3;
    const yr = load<f64>(yPtr + off);
    const yNewR = yr + load<f64>(z2Ptr + off);
    const sc = atol + rtol * Math.max(Math.abs(yr), Math.abs(yNewR));
    const ratio = load<f64>(errRhsPtr + off) / sc;
    errSq += ratio * ratio;
  }

  return diffCount > 0 ? Math.sqrt(errSq / <f64>diffCount) : 0.0;
}
