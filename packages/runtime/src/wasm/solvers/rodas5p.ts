// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Linear-Memory Kernels for RODAS5P: 5th-Order L-Stable Stiffly Accurate
 * Rosenbrock-W DAE Solver (6-stage Steinebach base kernel + Richardson extrapolation).
 *
 * Implements zero-GC dense iteration matrix assembly `W = (1/(gamma*h))*M - J` /
 * `(1/(gamma*h))*I - J` + LU factorization via `luFactor`/`luSolve`, stage RHS assembly +
 * solve + mass-matrix product + next-stage state update, and 5th-order Richardson step
 * update with embedded 4th/5th-order weighted RMS error norm directly in WebAssembly
 * linear memory.
 */

import { luFactor, luSolve } from "./matrix";

// Verified Steinebach RODAS4P base coefficients (L-stable, stiffly accurate, gamma = 0.25)
const A21: f64 = 3.0;
const A31: f64 = 1.831036793486759;
const A32: f64 = 0.4955183967433795;
const A41: f64 = 2.304376582692669;
const A42: f64 = -0.05249275245743001;
const A43: f64 = -1.176798761832782;
const A51: f64 = -7.170454962423024;
const A52: f64 = -4.741636671481785;
const A53: f64 = -16.31002631330971;
const A54: f64 = -1.062004044111401;

const C21: f64 = -12.0;
const C31: f64 = -8.791795173947035;
const C32: f64 = -2.207865586973518;
const C41: f64 = 10.81793056857153;
const C42: f64 = 6.780270611428266;
const C43: f64 = 19.5348594464241;
const C51: f64 = 34.19095006749676;
const C52: f64 = 15.49671153725963;
const C53: f64 = 54.7476087596413;
const C54: f64 = 14.16005392148534;
const C61: f64 = 34.62605830930532;
const C62: f64 = 15.30084976114473;
const C63: f64 = 56.99955578662667;
const C64: f64 = 18.40807009793095;
const C65: f64 = -5.714285714285717;

const D1: f64 = 0.25;
const D2: f64 = -0.5;
const D3: f64 = -0.023504;
const D4: f64 = -0.0362;

@inline
function applyMassMatVec(outPtr: usize, vPtr: usize, mPtr: usize, n: i32): void {
  for (let i: i32 = 0; i < n; i++) {
    const mRowPtr = mPtr + (((i * n) as usize) << 3);
    let sum: f64 = 0.0;
    for (let j: i32 = 0; j < n; j++) {
      const jOff = (j as usize) << 3;
      sum += load<f64>(mRowPtr + jOff) * load<f64>(vPtr + jOff);
    }
    store<f64>(outPtr + ((i as usize) << 3), sum);
  }
}

/**
 * Assembles the Rosenbrock iteration matrix `W = invGammaH * M - J` (when `hasMass != 0`)
 * or `W = invGammaH * I - J` (when `hasMass == 0`), where `invGammaH = 1 / (gamma * h)`,
 * and computes its row-equilibrated dense LU factorization in place via `luFactor`.
 *
 * Returns 1 on success, 0 if the matrix is singular.
 */
export function rodas5p_assemble_and_factor(
  n: i32,
  invGammaH: f64,
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
      store<f64>(wPtr + off, invGammaH * load<f64>(mPtr + off) - load<f64>(jPtr + off));
    }
  } else {
    for (let i: i32 = 0; i < n; i++) {
      const rowBase = i * n;
      for (let j: i32 = 0; j < n; j++) {
        const off = ((rowBase + j) as usize) << 3;
        const diag: f64 = i == j ? invGammaH : 0.0;
        store<f64>(wPtr + off, diag - load<f64>(jPtr + off));
      }
    }
  }

  return luFactor(<u32>wPtr, <u32>pivPtr, <u32>scalePtr, <u32>n) ? 1 : 0;
}

/**
 * Executes one stage (`stage` in 1..6) of the 6-stage Steinebach Rosenbrock-W base step
 * in linear memory:
 *   1. Assembles stage RHS into `kBufPtr + (stage - 1) * n * 8`.
 *   2. Solves `W * k_s = rhs_s` in place via `luSolve`.
 *   3. For stages 1..5, applies mass matrix `Mk_s = M * k_s` (when `hasMass != 0`) and
 *      writes the next stage's evaluation state into `yStagePtr` (or `yEmb` for stage 5).
 *   4. For stage 6, updates `yStagePtr` in place with `yOut = yEmb + k6` and checks
 *      finiteness of every component.
 *
 * `kBufPtr` holds 6 contiguous `n`-element f64 vectors (`k1..k6`).
 * `mkBufPtr` holds 5 contiguous `n`-element f64 vectors (`Mk1..Mk5`) when `hasMass != 0`
 * (ignored when `hasMass == 0`, where `kBufPtr` is read directly).
 *
 * Returns 1 on success, 0 if any output component is non-finite or `stage` is invalid.
 */
export function rodas5p_stage_step(
  stage: i32,
  n: i32,
  h: f64,
  hasMass: i32,
  mPtr: usize,
  wPtr: usize,
  pivPtr: usize,
  scalePtr: usize,
  yPtr: usize,
  fStagePtr: usize,
  dfdtPtr: usize,
  kBufPtr: usize,
  mkBufPtr: usize,
  yStagePtr: usize,
  luScratchPtr: usize,
): i32 {
  if (n <= 0) return 1;

  const stride: usize = (n as usize) << 3;
  const k1Ptr = kBufPtr;
  const k2Ptr = kBufPtr + stride;
  const k3Ptr = kBufPtr + stride * 2;
  const k4Ptr = kBufPtr + stride * 3;
  const k5Ptr = kBufPtr + stride * 4;
  const k6Ptr = kBufPtr + stride * 5;

  const mBase = hasMass != 0 ? mkBufPtr : kBufPtr;
  const mk1Ptr = mBase;
  const mk2Ptr = mBase + stride;
  const mk3Ptr = mBase + stride * 2;
  const mk4Ptr = mBase + stride * 3;
  const mk5Ptr = mBase + stride * 4;

  const invH: f64 = 1.0 / h;

  if (stage == 1) {
    const hD1 = h * D1;
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      store<f64>(k1Ptr + off, load<f64>(fStagePtr + off) + hD1 * load<f64>(dfdtPtr + off));
    }
    luSolve(<u32>wPtr, <u32>pivPtr, <u32>scalePtr, <u32>k1Ptr, <u32>luScratchPtr, <u32>n);
    if (hasMass != 0) applyMassMatVec(mk1Ptr, k1Ptr, mPtr, n);
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      store<f64>(yStagePtr + off, load<f64>(yPtr + off) + A21 * load<f64>(k1Ptr + off));
    }
    return 1;
  }

  if (stage == 2) {
    const hD2 = h * D2;
    const invHC21 = invH * C21;
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      store<f64>(
        k2Ptr + off,
        load<f64>(fStagePtr + off) + invHC21 * load<f64>(mk1Ptr + off) + hD2 * load<f64>(dfdtPtr + off),
      );
    }
    luSolve(<u32>wPtr, <u32>pivPtr, <u32>scalePtr, <u32>k2Ptr, <u32>luScratchPtr, <u32>n);
    if (hasMass != 0) applyMassMatVec(mk2Ptr, k2Ptr, mPtr, n);
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      store<f64>(
        yStagePtr + off,
        load<f64>(yPtr + off) + A31 * load<f64>(k1Ptr + off) + A32 * load<f64>(k2Ptr + off),
      );
    }
    return 1;
  }

  if (stage == 3) {
    const hD3 = h * D3;
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      store<f64>(
        k3Ptr + off,
        load<f64>(fStagePtr + off) +
          invH * (C31 * load<f64>(mk1Ptr + off) + C32 * load<f64>(mk2Ptr + off)) +
          hD3 * load<f64>(dfdtPtr + off),
      );
    }
    luSolve(<u32>wPtr, <u32>pivPtr, <u32>scalePtr, <u32>k3Ptr, <u32>luScratchPtr, <u32>n);
    if (hasMass != 0) applyMassMatVec(mk3Ptr, k3Ptr, mPtr, n);
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      store<f64>(
        yStagePtr + off,
        load<f64>(yPtr + off) +
          A41 * load<f64>(k1Ptr + off) +
          A42 * load<f64>(k2Ptr + off) +
          A43 * load<f64>(k3Ptr + off),
      );
    }
    return 1;
  }

  if (stage == 4) {
    const hD4 = h * D4;
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      store<f64>(
        k4Ptr + off,
        load<f64>(fStagePtr + off) +
          invH *
            (C41 * load<f64>(mk1Ptr + off) + C42 * load<f64>(mk2Ptr + off) + C43 * load<f64>(mk3Ptr + off)) +
          hD4 * load<f64>(dfdtPtr + off),
      );
    }
    luSolve(<u32>wPtr, <u32>pivPtr, <u32>scalePtr, <u32>k4Ptr, <u32>luScratchPtr, <u32>n);
    if (hasMass != 0) applyMassMatVec(mk4Ptr, k4Ptr, mPtr, n);
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      store<f64>(
        yStagePtr + off,
        load<f64>(yPtr + off) +
          A51 * load<f64>(k1Ptr + off) +
          A52 * load<f64>(k2Ptr + off) +
          A53 * load<f64>(k3Ptr + off) +
          A54 * load<f64>(k4Ptr + off),
      );
    }
    return 1;
  }

  if (stage == 5) {
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      store<f64>(
        k5Ptr + off,
        load<f64>(fStagePtr + off) +
          invH *
            (C51 * load<f64>(mk1Ptr + off) +
              C52 * load<f64>(mk2Ptr + off) +
              C53 * load<f64>(mk3Ptr + off) +
              C54 * load<f64>(mk4Ptr + off)),
      );
    }
    luSolve(<u32>wPtr, <u32>pivPtr, <u32>scalePtr, <u32>k5Ptr, <u32>luScratchPtr, <u32>n);
    if (hasMass != 0) applyMassMatVec(mk5Ptr, k5Ptr, mPtr, n);
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      store<f64>(yStagePtr + off, load<f64>(yStagePtr + off) + load<f64>(k5Ptr + off));
    }
    return 1;
  }

  if (stage == 6) {
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      store<f64>(
        k6Ptr + off,
        load<f64>(fStagePtr + off) +
          invH *
            (C61 * load<f64>(mk1Ptr + off) +
              C62 * load<f64>(mk2Ptr + off) +
              C63 * load<f64>(mk3Ptr + off) +
              C64 * load<f64>(mk4Ptr + off) +
              C65 * load<f64>(mk5Ptr + off)),
      );
    }
    luSolve(<u32>wPtr, <u32>pivPtr, <u32>scalePtr, <u32>k6Ptr, <u32>luScratchPtr, <u32>n);
    for (let i: i32 = 0; i < n; i++) {
      const off = (i as usize) << 3;
      const v = load<f64>(yStagePtr + off) + load<f64>(k6Ptr + off);
      if (!isFinite(v)) return 0;
      store<f64>(yStagePtr + off, v);
    }
    return 1;
  }

  return 0;
}

/**
 * Computes the 5th-order Richardson-extrapolated state update
 *   `yNew[i] = yFine[i] + (yFine[i] - yCoarse[i]) / 15`
 * and returns the embedded 4th/5th-order weighted RMS error norm
 *   `sqrt((1 / max(1, n)) * sum_i (|yFine[i] - yCoarse[i]| / (15 * (atol + rtol * max(|y[i]|, |yNew[i]|))))^2)`.
 *
 * Returns `Infinity` if any component produces a non-finite value.
 */
export function rodas5p_richardson_update_and_error(
  n: i32,
  yPtr: usize,
  yCoarsePtr: usize,
  yFinePtr: usize,
  yNewPtr: usize,
  atol: f64,
  rtol: f64,
): f64 {
  if (n <= 0) return 0.0;

  let errSq: f64 = 0.0;
  for (let i: i32 = 0; i < n; i++) {
    const off = (i as usize) << 3;
    const yf = load<f64>(yFinePtr + off);
    const yc = load<f64>(yCoarsePtr + off);
    const diff = yf - yc;
    const yn = yf + diff / 15.0;
    if (!isFinite(yn)) return Infinity;
    store<f64>(yNewPtr + off, yn);

    const yAbs = Math.abs(load<f64>(yPtr + off));
    const ynAbs = Math.abs(yn);
    const maxY = yAbs > ynAbs ? yAbs : ynAbs;
    const sc = atol + rtol * maxY;
    const e = Math.abs(diff) / (15.0 * sc);
    if (!isFinite(e)) return Infinity;
    errSq += e * e;
  }

  return Math.sqrt(errSq / <f64>(n > 1 ? n : 1));
}
