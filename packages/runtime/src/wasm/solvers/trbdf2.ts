// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Linear-Memory Kernels for TR-BDF2 Composite Stiff ODE/DAE Solver.
 *
 * Implements zero-GC dense iteration matrix assembly `(M - d*h*J)` / `(I - d*h*J)` + LU
 * factorization, Trapezoidal (Stage 1) and BDF-2 (Stage 2) Newton residual/solve/update
 * steps with weighted convergence norm, and Hosea-Shampine / Bank et al. embedded error
 * estimation directly in WebAssembly linear memory.
 */

import { luFactor, luSolve } from "./matrix";

/**
 * Assembles the TR-BDF2 iteration matrix `W = M - dh * J` (when `hasMass != 0`) or
 * `W = I - dh * J` (when `hasMass == 0`), where `dh = d * h = (gamma / 2) * h`, and
 * computes its row-equilibrated dense LU factorization in place via `luFactor`.
 *
 * Returns 1 on success, 0 if the matrix is singular.
 */
export function trbdf2_assemble_and_factor(
  n: i32,
  dh: f64,
  hasMass: i32,
  mPtr: usize,
  jPtr: usize,
  wPtr: usize,
  pivPtr: usize,
  scalePtr: usize,
): i32 {
  if (n <= 0) return 1;

  if (hasMass != 0) {
    const nn = n * n;
    for (let k: i32 = 0; k < nn; k++) {
      const off = (k as usize) << 3;
      store<f64>(wPtr + off, load<f64>(mPtr + off) - dh * load<f64>(jPtr + off));
    }
  } else {
    for (let i: i32 = 0; i < n; i++) {
      const rowBase = i * n;
      for (let j: i32 = 0; j < n; j++) {
        const off = ((rowBase + j) as usize) << 3;
        const diag: f64 = i == j ? 1.0 : 0.0;
        store<f64>(wPtr + off, diag - dh * load<f64>(jPtr + off));
      }
    }
  }

  return luFactor(<u32>wPtr, <u32>pivPtr, <u32>scalePtr, <u32>n) ? 1 : 0;
}

/**
 * Executes one Stage 1 (Trapezoidal rule) Newton iteration in linear memory:
 *   1. Forms negative residual `delta = -(M * (yGamma - y0) - dh * (f0 + fGamma))`
 *      (using `M = I` when `hasMass == 0`).
 *   2. Solves `W * delta = -R1` in place using the precomputed LU factors.
 *   3. Updates `yGamma += delta` and returns the weighted infinity convergence norm
 *      `max_i |delta[i]| / (atol + rtol * |yGamma[i]|)`.
 */
export function trbdf2_tr_stage_step(
  n: i32,
  dh: f64,
  hasMass: i32,
  mPtr: usize,
  wPtr: usize,
  pivPtr: usize,
  scalePtr: usize,
  y0Ptr: usize,
  f0Ptr: usize,
  yGammaPtr: usize,
  fGammaPtr: usize,
  deltaPtr: usize,
  luScratchPtr: usize,
  atol: f64,
  rtol: f64,
): f64 {
  if (n <= 0) return 0.0;

  if (hasMass != 0) {
    // Reuse luScratchPtr to store diff[j] = yGamma[j] - y0[j] before luSolve overwrites it
    for (let j: i32 = 0; j < n; j++) {
      const off = (j as usize) << 3;
      store<f64>(luScratchPtr + off, load<f64>(yGammaPtr + off) - load<f64>(y0Ptr + off));
    }
    for (let i: i32 = 0; i < n; i++) {
      const mRowPtr = mPtr + (((i * n) as usize) << 3);
      let my: f64 = 0.0;
      for (let j: i32 = 0; j < n; j++) {
        const jOff = (j as usize) << 3;
        my += load<f64>(mRowPtr + jOff) * load<f64>(luScratchPtr + jOff);
      }
      const iOff = (i as usize) << 3;
      const rhs = -(my - dh * (load<f64>(f0Ptr + iOff) + load<f64>(fGammaPtr + iOff)));
      store<f64>(deltaPtr + iOff, rhs);
    }
  } else {
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      const my = load<f64>(yGammaPtr + off) - load<f64>(y0Ptr + off);
      const rhs = -(my - dh * (load<f64>(f0Ptr + off) + load<f64>(fGammaPtr + off)));
      store<f64>(deltaPtr + off, rhs);
    }
  }

  luSolve(<u32>wPtr, <u32>pivPtr, <u32>scalePtr, <u32>deltaPtr, <u32>luScratchPtr, <u32>n);

  let maxDelta: f64 = 0.0;
  for (let i: i32 = 0; i < n; i++) {
    const off = (i as usize) << 3;
    const di = load<f64>(deltaPtr + off);
    const updated = load<f64>(yGammaPtr + off) + di;
    store<f64>(yGammaPtr + off, updated);
    const tol = atol + rtol * Math.abs(updated);
    const ratio = Math.abs(di) / tol;
    if (!isFinite(ratio)) {
      return Infinity;
    }
    if (ratio > maxDelta) {
      maxDelta = ratio;
    }
  }

  return maxDelta;
}

/**
 * Executes one Stage 2 (BDF-2 completion) Newton iteration in linear memory:
 *   1. Forms negative residual `delta = -(M * (yNew - cGamma * yGamma + c0 * y0) - dh * fNew)`
 *      (using `M = I` when `hasMass == 0`).
 *   2. Solves `W * delta = -R2` in place using the precomputed LU factors.
 *   3. Updates `yNew += delta` and returns the weighted infinity convergence norm
 *      `max_i |delta[i]| / (atol + rtol * |yNew[i]|)`.
 */
export function trbdf2_bdf2_stage_step(
  n: i32,
  dh: f64,
  cGamma: f64,
  c0: f64,
  hasMass: i32,
  mPtr: usize,
  wPtr: usize,
  pivPtr: usize,
  scalePtr: usize,
  y0Ptr: usize,
  yGammaPtr: usize,
  yNewPtr: usize,
  fNewPtr: usize,
  deltaPtr: usize,
  luScratchPtr: usize,
  atol: f64,
  rtol: f64,
): f64 {
  if (n <= 0) return 0.0;

  if (hasMass != 0) {
    // Reuse luScratchPtr to store comb[j] = yNew[j] - cGamma * yGamma[j] + c0 * y0[j]
    for (let j: i32 = 0; j < n; j++) {
      const off = (j as usize) << 3;
      const comb =
        load<f64>(yNewPtr + off) -
        cGamma * load<f64>(yGammaPtr + off) +
        c0 * load<f64>(y0Ptr + off);
      store<f64>(luScratchPtr + off, comb);
    }
    for (let i: i32 = 0; i < n; i++) {
      const mRowPtr = mPtr + (((i * n) as usize) << 3);
      let my: f64 = 0.0;
      for (let j: i32 = 0; j < n; j++) {
        const jOff = (j as usize) << 3;
        my += load<f64>(mRowPtr + jOff) * load<f64>(luScratchPtr + jOff);
      }
      const iOff = (i as usize) << 3;
      const rhs = -(my - dh * load<f64>(fNewPtr + iOff));
      store<f64>(deltaPtr + iOff, rhs);
    }
  } else {
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      const my =
        load<f64>(yNewPtr + off) -
        cGamma * load<f64>(yGammaPtr + off) +
        c0 * load<f64>(y0Ptr + off);
      const rhs = -(my - dh * load<f64>(fNewPtr + off));
      store<f64>(deltaPtr + off, rhs);
    }
  }

  luSolve(<u32>wPtr, <u32>pivPtr, <u32>scalePtr, <u32>deltaPtr, <u32>luScratchPtr, <u32>n);

  let maxDelta: f64 = 0.0;
  for (let i: i32 = 0; i < n; i++) {
    const off = (i as usize) << 3;
    const di = load<f64>(deltaPtr + off);
    const updated = load<f64>(yNewPtr + off) + di;
    store<f64>(yNewPtr + off, updated);
    const tol = atol + rtol * Math.abs(updated);
    const ratio = Math.abs(di) / tol;
    if (!isFinite(ratio)) {
      return Infinity;
    }
    if (ratio > maxDelta) {
      maxDelta = ratio;
    }
  }

  return maxDelta;
}

/**
 * Computes the Hosea-Shampine (1996) / Bank et al. (1985) divided-difference local error
 * ratio for TR-BDF2:
 *   err_i = kErrScale * |(1 - gamma) * f0[i] - fGamma[i] + gamma * fNew[i]|
 *   maxErrorRatio = max_i err_i / (atol + rtol * max(|y0[i]|, |yNew[i]|))
 *
 * Returns `Infinity` if any component produces a non-finite error ratio.
 */
export function trbdf2_error_estimate(
  n: i32,
  kErrScale: f64,
  gamma: f64,
  y0Ptr: usize,
  yNewPtr: usize,
  f0Ptr: usize,
  fGammaPtr: usize,
  fNewPtr: usize,
  atol: f64,
  rtol: f64,
): f64 {
  if (n <= 0) return 0.0;

  const oneMinusGamma: f64 = 1.0 - gamma;
  let maxErrorRatio: f64 = 0.0;

  for (let i: i32 = 0; i < n; i++) {
    const off = (i as usize) << 3;
    const f0i = load<f64>(f0Ptr + off);
    const fGi = load<f64>(fGammaPtr + off);
    const fNi = load<f64>(fNewPtr + off);
    const errI = kErrScale * Math.abs(oneMinusGamma * f0i - fGi + gamma * fNi);
    const y0Abs = Math.abs(load<f64>(y0Ptr + off));
    const yNAbs = Math.abs(load<f64>(yNewPtr + off));
    const maxY = y0Abs > yNAbs ? y0Abs : yNAbs;
    const tol = atol + rtol * maxY;
    const ratio = errI / tol;
    if (!isFinite(ratio)) {
      return Infinity;
    }
    if (ratio > maxErrorRatio) {
      maxErrorRatio = ratio;
    }
  }

  return maxErrorRatio;
}
