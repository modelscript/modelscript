// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Linear-Memory Kernels for Frequency-Dependent Transmission Line (FDPM / J. Marti).
 *
 * Implements zero-GC, flat linear-memory kernels for:
 * - Instantaneous companion conductance computation (`fd_line_compute_gc`)
 * - Recursive pole-residue convolution (`fd_line_pole_conv`)
 * - Circular-buffer fractional delay interpolation (`fd_line_delay_interp`)
 * - Fused single-phase FD line time step & Norton history current update (`fd_line_step`)
 * - Power-invariant Clarke modal forward & inverse transforms (`fd_line_clarke_fwd`, `fd_line_clarke_inv`)
 * - Single-phase & 3-phase transposed Deri-Semlyen overhead line constants
 *   (`fd_line_overhead_constants`, `fd_line_modal_overhead_constants`)
 * - Logarithmic real-pole synthesis (`fd_line_synthesize_poles`)
 * - Real-pole rational Vector Fitting least-squares solver (`fd_line_vector_fit_ls`)
 */

const FD_MU0: f64 = 4.0 * Math.PI * 1e-7; // H/m
const FD_EPS0: f64 = 8.854187817e-12; // F/m
const FD_TWO_PI: f64 = 2.0 * Math.PI;
const FD_HALF_PI: f64 = 0.5 * Math.PI;
const FD_INV_SQRT3: f64 = 0.5773502691896258; // 1 / sqrt(3)
const FD_SQRT2_OVER_3: f64 = 0.816496580927726; // sqrt(2 / 3)
const FD_INV_SQRT2: f64 = Math.SQRT1_2; // 1 / sqrt(2)

/**
 * Computes the instantaneous companion conductance `G_c` for a frequency-dependent line:
 * `G_c = Y_0 + sum_{m=0}^{nY-1} |beta_0_m|` where `beta_0_m = (c_m / a_m) * (exp(a_m * dt) - 1)`
 * (falling back to `0.5 * c_m * dt` when `|a_m| <= 1e-12`).
 *
 * Input layout:
 * - `yPolesPtr`: `f64[nY]` — real poles `a_m`
 * - `yResPtr`: `f64[nY]` — residues `c_m`
 */
export function fd_line_compute_gc(
  y0: f64,
  yPolesPtr: usize,
  yResPtr: usize,
  nY: i32,
  dt: f64,
): f64 {
  let gc: f64 = y0;
  for (let m: i32 = 0; m < nY; m++) {
    const off = (<usize>m) << 3;
    const pole = load<f64>(yPolesPtr + off);
    const res = load<f64>(yResPtr + off);
    if (Math.abs(pole) > 1e-12) {
      const alpha = Math.exp(pole * dt);
      const beta0 = (res / pole) * (alpha - 1.0);
      gc += Math.abs(beta0);
    } else {
      gc += res * dt * 0.5;
    }
  }
  return gc;
}

/**
 * Evaluates one time step of recursive pole-residue convolution in-place for both
 * sending (`From`) and receiving (`To`) terminals:
 *   `x_m(t) = alpha_m * x_m(t - dt) + beta_m * u(t)`
 *   `alpha_m = exp(p_m * dt)`, `beta_m = (c_m / p_m) * (alpha_m - 1)` (or `c_m * dt` if `|p_m| <= 1e-12`).
 *
 * Output layout:
 * - `statesFromPtr`, `statesToPtr`: updated in-place (`f64[nPoles]`)
 * - `outSumsPtr`: `f64[2]` -> `[sumFrom, sumTo]`
 */
export function fd_line_pole_conv(
  polesPtr: usize,
  resPtr: usize,
  statesFromPtr: usize,
  statesToPtr: usize,
  nPoles: i32,
  inFrom: f64,
  inTo: f64,
  dt: f64,
  outSumsPtr: usize,
): void {
  let sumFrom: f64 = 0.0;
  let sumTo: f64 = 0.0;
  for (let m: i32 = 0; m < nPoles; m++) {
    const off = (<usize>m) << 3;
    const pole = load<f64>(polesPtr + off);
    const res = load<f64>(resPtr + off);
    const alpha = Math.exp(pole * dt);
    const beta = Math.abs(pole) > 1e-12 ? (res / pole) * (alpha - 1.0) : res * dt;

    const sFrom = alpha * load<f64>(statesFromPtr + off) + beta * inFrom;
    const sTo = alpha * load<f64>(statesToPtr + off) + beta * inTo;
    store<f64>(statesFromPtr + off, sFrom);
    store<f64>(statesToPtr + off, sTo);

    sumFrom += sFrom;
    sumTo += sTo;
  }
  store<f64>(outSumsPtr, sumFrom);
  store<f64>(outSumsPtr + 8, sumTo);
}

/**
 * Circular-buffer fractional delay interpolation.
 *
 * Retrieves the delayed wave at `writeIdx - (delaySteps + frac)` modulo `bufLen`.
 * When `frac <= 0.0`, returns the exact integer-delay sample `buf[(writeIdx - delaySteps) mod bufLen]`.
 * When `frac > 0.0`, linearly interpolates between `delaySteps` and `delaySteps + 1`.
 */
export function fd_line_delay_interp(
  bufPtr: usize,
  bufLen: i32,
  writeIdx: i32,
  delaySteps: i32,
  frac: f64,
): f64 {
  if (bufLen <= 0) return 0.0;
  let idx0 = (writeIdx - delaySteps) % bufLen;
  if (idx0 < 0) idx0 += bufLen;
  const v0 = load<f64>(bufPtr + ((<usize>idx0) << 3));
  if (frac <= 0.0) {
    return v0;
  }
  const f = frac > 1.0 ? 1.0 : frac;
  const idx1 = idx0 > 0 ? idx0 - 1 : bufLen - 1;
  const v1 = load<f64>(bufPtr + ((<usize>idx1) << 3));
  return v0 + f * (v1 - v0);
}

/**
 * Fused single-phase Frequency-Dependent Line time step:
 * 1. Recursive pole-residue convolution for characteristic admittance `Y_c(s)`
 * 2. Incident forward wave launch `a_k(t) = 2 * v_k(t) * G_c - i_{Y,k}(t)` into circular delay buffers
 * 3. Integer or fractional delay interpolation from opposite-end circular buffer
 * 4. Recursive pole-residue convolution for propagation function `H(s)`
 * 5. Norton history current update `I_{hist,k} = -(i_{Y,k} + b_k)` written to `outIHistPtr` (`f64[2]`)
 *
 * Returns the next circular buffer index `(bufferIdx + 1) % bufLen`.
 */
export function fd_line_step(
  yPolesPtr: usize,
  yResPtr: usize,
  nY: i32,
  hPolesPtr: usize,
  hResPtr: usize,
  nH: i32,
  statesYFromPtr: usize,
  statesYToPtr: usize,
  statesHFromPtr: usize,
  statesHToPtr: usize,
  bufferFromPtr: usize,
  bufferToPtr: usize,
  bufLen: i32,
  bufferIdx: i32,
  delaySteps: i32,
  delayFrac: f64,
  gc: f64,
  vFrom: f64,
  vTo: f64,
  dt: f64,
  outIHistPtr: usize,
): i32 {
  // 1. Characteristic admittance Y_c recursive convolution
  let iYFrom: f64 = 0.0;
  let iYTo: f64 = 0.0;
  for (let m: i32 = 0; m < nY; m++) {
    const off = (<usize>m) << 3;
    const pole = load<f64>(yPolesPtr + off);
    const res = load<f64>(yResPtr + off);
    const alpha = Math.exp(pole * dt);
    const beta = Math.abs(pole) > 1e-12 ? (res / pole) * (alpha - 1.0) : res * dt;

    const sFrom = alpha * load<f64>(statesYFromPtr + off) + beta * vFrom;
    const sTo = alpha * load<f64>(statesYToPtr + off) + beta * vTo;
    store<f64>(statesYFromPtr + off, sFrom);
    store<f64>(statesYToPtr + off, sTo);

    iYFrom += sFrom;
    iYTo += sTo;
  }

  // 2. Incident forward waves launched into the line at sending & receiving terminals
  const aFrom = 2.0 * vFrom * gc - iYFrom;
  const aTo = 2.0 * vTo * gc - iYTo;

  let delayedWaveAtFrom: f64 = 0.0;
  let delayedWaveAtTo: f64 = 0.0;
  let nextIdx: i32 = 0;
  if (bufLen > 0) {
    const writeOff = (<usize>bufferIdx) << 3;
    store<f64>(bufferFromPtr + writeOff, aFrom);
    store<f64>(bufferToPtr + writeOff, aTo);

    delayedWaveAtFrom = fd_line_delay_interp(bufferToPtr, bufLen, bufferIdx, delaySteps, delayFrac);
    delayedWaveAtTo = fd_line_delay_interp(bufferFromPtr, bufLen, bufferIdx, delaySteps, delayFrac);

    nextIdx = bufferIdx + 1;
    if (nextIdx >= bufLen) nextIdx = 0;
  }

  // 3. Propagation function H(s) recursive convolution (attenuation & dispersion)
  let bFrom: f64 = 0.0;
  let bTo: f64 = 0.0;
  for (let k: i32 = 0; k < nH; k++) {
    const off = (<usize>k) << 3;
    const pole = load<f64>(hPolesPtr + off);
    const res = load<f64>(hResPtr + off);
    const alpha = Math.exp(pole * dt);
    const beta = Math.abs(pole) > 1e-12 ? (res / pole) * (alpha - 1.0) : res * dt;

    const sFrom = alpha * load<f64>(statesHFromPtr + off) + beta * delayedWaveAtFrom;
    const sTo = alpha * load<f64>(statesHToPtr + off) + beta * delayedWaveAtTo;
    store<f64>(statesHFromPtr + off, sFrom);
    store<f64>(statesHToPtr + off, sTo);

    bFrom += sFrom;
    bTo += sTo;
  }

  // 4. Norton history currents for next time step
  store<f64>(outIHistPtr, -(iYFrom + bFrom));
  store<f64>(outIHistPtr + 8, -(iYTo + bTo));

  return nextIdx;
}

/**
 * Forward power-invariant Clarke transform from 3-phase terminal voltages
 * `(vfa, vfb, vfc, vta, vtb, vtc)` to modal voltages `[vf0, vfAlpha, vfBeta, vt0, vtAlpha, vtBeta]`.
 *
 * Output layout:
 * - `outModalVPtr`: `f64[6]`
 */
export function fd_line_clarke_fwd(
  vfa: f64,
  vfb: f64,
  vfc: f64,
  vta: f64,
  vtb: f64,
  vtc: f64,
  outModalVPtr: usize,
): void {
  store<f64>(outModalVPtr, FD_INV_SQRT3 * (vfa + vfb + vfc));
  store<f64>(outModalVPtr + 8, FD_SQRT2_OVER_3 * (vfa - 0.5 * vfb - 0.5 * vfc));
  store<f64>(outModalVPtr + 16, FD_INV_SQRT2 * (vfb - vfc));

  store<f64>(outModalVPtr + 24, FD_INV_SQRT3 * (vta + vtb + vtc));
  store<f64>(outModalVPtr + 32, FD_SQRT2_OVER_3 * (vta - 0.5 * vtb - 0.5 * vtc));
  store<f64>(outModalVPtr + 40, FD_INV_SQRT2 * (vtb - vtc));
}

/**
 * Inverse power-invariant Clarke transform from modal history currents
 * `(if0, ifAlpha, ifBeta, it0, itAlpha, itBeta)` to 3-phase currents `[ia, ib, ic]` at both ends.
 *
 * Output layout:
 * - `outFromPhasePtr`: `f64[3]`
 * - `outToPhasePtr`: `f64[3]`
 */
export function fd_line_clarke_inv(
  if0: f64,
  ifAlpha: f64,
  ifBeta: f64,
  it0: f64,
  itAlpha: f64,
  itBeta: f64,
  outFromPhasePtr: usize,
  outToPhasePtr: usize,
): void {
  const f0Term = FD_INV_SQRT3 * if0;
  const fAlphaHalf = 0.5 * FD_SQRT2_OVER_3 * ifAlpha;
  const fBetaTerm = FD_INV_SQRT2 * ifBeta;
  store<f64>(outFromPhasePtr, f0Term + FD_SQRT2_OVER_3 * ifAlpha);
  store<f64>(outFromPhasePtr + 8, f0Term - fAlphaHalf + fBetaTerm);
  store<f64>(outFromPhasePtr + 16, f0Term - fAlphaHalf - fBetaTerm);

  const t0Term = FD_INV_SQRT3 * it0;
  const tAlphaHalf = 0.5 * FD_SQRT2_OVER_3 * itAlpha;
  const tBetaTerm = FD_INV_SQRT2 * itBeta;
  store<f64>(outToPhasePtr, t0Term + FD_SQRT2_OVER_3 * itAlpha);
  store<f64>(outToPhasePtr + 8, t0Term - tAlphaHalf + tBetaTerm);
  store<f64>(outToPhasePtr + 16, t0Term - tAlphaHalf - tBetaTerm);
}

/**
 * Computes single-phase overhead transmission line constants at `freqHz` using
 * Deri-Semlyen's complex ground return plane and tubular skin-effect correction.
 *
 * Output layout (`outPtr`: `f64[6]`):
 * `[rOhmPerKm, lHPerKm, cFPerKm, zcMagOhm, phaseVelocityKmPerSec, attenuationNeperPerKm]`
 */
export function fd_line_overhead_constants(
  freqHz: f64,
  conductorHeightM: f64,
  conductorRadiusM: f64,
  gmrM: f64,
  rDcOhmPerKm: f64,
  soilResistivityOhmM: f64,
  outPtr: usize,
): void {
  const omega = FD_TWO_PI * Math.max(1e-3, freqHz);
  const h = Math.max(1.0, conductorHeightM);
  const r = Math.max(1e-4, conductorRadiusM);
  const gmr = gmrM > 0.0 ? gmrM : 0.7788 * r;

  const skinRatio = Math.sqrt(1.0 + freqHz / 120.0);
  const rCondPerKm = rDcOhmPerKm * skinRatio;

  const deltaE = Math.sqrt((2.0 * soilResistivityOhmM) / (omega * FD_MU0));
  const pRe = 0.5 * deltaE;
  const pIm = -0.5 * deltaE;

  const numRe = (2.0 * (h + pRe)) / gmr;
  const numIm = (2.0 * pIm) / gmr;
  const logMag = Math.log(Math.hypot(numRe, numIm));
  const logAng = Math.atan2(numIm, numRe);

  const kFactor = (omega * FD_MU0 * 1000.0) / FD_TWO_PI;
  const rEarthPerKm = kFactor * Math.max(0.0, -logAng);
  const xPerKm = kFactor * logMag;

  const rOhmPerKm = rCondPerKm + rEarthPerKm;
  const lHPerKm = xPerKm / omega;
  const cFPerKm = ((FD_TWO_PI * FD_EPS0) / Math.log((2.0 * h) / r)) * 1000.0;

  const zMag = Math.hypot(rOhmPerKm, xPerKm);
  const zAng = Math.atan2(xPerKm, rOhmPerKm);
  const yMag = omega * cFPerKm;

  const gammaMag = Math.sqrt(zMag * yMag);
  const gammaAng = 0.5 * (zAng + FD_HALF_PI);
  const alpha = gammaMag * Math.cos(gammaAng);
  const beta = gammaMag * Math.sin(gammaAng);

  const zcMagOhm = Math.sqrt(zMag / Math.max(1e-18, yMag));
  const phaseVelocityKmPerSec = beta > 1e-12 ? omega / beta : 299792.0;

  store<f64>(outPtr, rOhmPerKm);
  store<f64>(outPtr + 8, lHPerKm);
  store<f64>(outPtr + 16, cFPerKm);
  store<f64>(outPtr + 24, zcMagOhm);
  store<f64>(outPtr + 32, phaseVelocityKmPerSec);
  store<f64>(outPtr + 40, alpha);
}

@inline
function writeModeConstants(
  rMode: f64,
  xMode: f64,
  lMode: f64,
  cMode: f64,
  omega: f64,
  outPtr: usize,
): void {
  const zMag = Math.hypot(rMode, xMode);
  const zAng = Math.atan2(xMode, rMode);
  const yMag = omega * cMode;
  const gammaMag = Math.sqrt(zMag * yMag);
  const gammaAng = 0.5 * (zAng + FD_HALF_PI);
  const alpha = gammaMag * Math.cos(gammaAng);
  const beta = gammaMag * Math.sin(gammaAng);
  store<f64>(outPtr, rMode);
  store<f64>(outPtr + 8, lMode);
  store<f64>(outPtr + 16, cMode);
  store<f64>(outPtr + 24, Math.sqrt(zMag / Math.max(1e-18, yMag)));
  store<f64>(outPtr + 32, beta > 1e-12 ? omega / beta : 299792.0);
  store<f64>(outPtr + 40, alpha);
}

/**
 * Computes 3-phase transposed Clarke/Karrenbauer modal overhead line constants at `freqHz`.
 *
 * Output layout (`outPtr`: `f64[16]`):
 * - `[0..5]`: positiveMode `[rOhmPerKm, lHPerKm, cFPerKm, zcMagOhm, phaseVelocityKmPerSec, attenuationNeperPerKm]`
 * - `[6..11]`: zeroMode `[rOhmPerKm, lHPerKm, cFPerKm, zcMagOhm, phaseVelocityKmPerSec, attenuationNeperPerKm]`
 * - `[12..13]`: zSelfOhmPerKm `[re, im]`
 * - `[14..15]`: zMutualOhmPerKm `[re, im]`
 */
export function fd_line_modal_overhead_constants(
  freqHz: f64,
  conductorHeightM: f64,
  conductorRadiusM: f64,
  gmrM: f64,
  phaseSpacingM: f64,
  rDcOhmPerKm: f64,
  soilResistivityOhmM: f64,
  outPtr: usize,
): void {
  const omega = FD_TWO_PI * Math.max(1e-3, freqHz);
  const h = Math.max(1.0, conductorHeightM);
  const r = Math.max(1e-4, conductorRadiusM);
  const gmr = gmrM > 0.0 ? gmrM : 0.7788 * r;
  const dEq = Math.max(2.5 * r, phaseSpacingM);

  const skinRatio = Math.sqrt(1.0 + freqHz / 120.0);
  const rCondPerKm = rDcOhmPerKm * skinRatio;

  const deltaE = Math.sqrt((2.0 * soilResistivityOhmM) / (omega * FD_MU0));
  const pRe = 0.5 * deltaE;
  const pIm = -0.5 * deltaE;
  const kFactor = (omega * FD_MU0 * 1000.0) / FD_TWO_PI;

  const selfNumRe = (2.0 * (h + pRe)) / gmr;
  const selfNumIm = (2.0 * pIm) / gmr;
  const selfLogMag = Math.log(Math.hypot(selfNumRe, selfNumIm));
  const selfLogAng = Math.atan2(selfNumIm, selfNumRe);
  const rSelf = rCondPerKm + kFactor * Math.max(0.0, -selfLogAng);
  const xSelf = kFactor * selfLogMag;

  const hpRe = h + pRe;
  const hpIm = pIm;
  const wRe = 4.0 * (hpRe * hpRe - hpIm * hpIm) + dEq * dEq;
  const wIm = 8.0 * hpRe * hpIm;
  const wMag = Math.hypot(wRe, wIm);
  const wAng = Math.atan2(wIm, wRe);
  const dImgMag = Math.sqrt(wMag);
  const dImgAng = 0.5 * wAng;

  const mutLogMag = Math.log(dImgMag / dEq);
  const mutLogAng = dImgAng;
  const rMut = kFactor * Math.max(0.0, -mutLogAng);
  const xMut = kFactor * mutLogAng > -1e9 ? kFactor * mutLogMag : 0.0;

  const r1 = Math.max(rCondPerKm * 0.95, rSelf - rMut);
  const x1 = Math.max(1e-6, xSelf - xMut);
  const l1 = x1 / omega;

  const r0 = rSelf + 2.0 * rMut;
  const x0 = xSelf + 2.0 * xMut;
  const l0 = x0 / omega;

  const pSS = Math.log((2.0 * h) / r) / (FD_TWO_PI * FD_EPS0);
  const pSM = Math.log(Math.hypot(2.0 * h, dEq) / dEq) / (FD_TWO_PI * FD_EPS0);
  const c1 = (1.0 / Math.max(1e3, pSS - pSM)) * 1000.0;
  const c0 = (1.0 / Math.max(1e3, pSS + 2.0 * pSM)) * 1000.0;

  writeModeConstants(r1, x1, l1, c1, omega, outPtr);
  writeModeConstants(r0, x0, l0, c0, omega, outPtr + 48);
  store<f64>(outPtr + 96, rSelf);
  store<f64>(outPtr + 104, xSelf);
  store<f64>(outPtr + 112, rMut);
  store<f64>(outPtr + 120, xMut);
}

/**
 * Synthesizes logarithmically distributed stable real poles and passive residues
 * for `Y_c(s)` and `H(s)` matching DC admittance deviation `deltaY` and DC gain `dcGain`.
 *
 * Output layout:
 * - `outPolesPtr`: `f64[numPoles]`
 * - `outYResPtr`: `f64[numPoles]`
 * - `outHResPtr`: `f64[numPoles]`
 */
export function fd_line_synthesize_poles(
  numPoles: i32,
  deltaY: f64,
  dcGain: f64,
  pMin: f64,
  pMax: f64,
  outPolesPtr: usize,
  outYResPtr: usize,
  outHResPtr: usize,
): void {
  if (numPoles <= 0) return;

  const ratio = pMax / pMin;
  let weightSum: f64 = 0.0;
  for (let m: i32 = 0; m < numPoles; m++) {
    const frac: f64 = numPoles > 1 ? (<f64>m) / (<f64>(numPoles - 1)) : 0.5;
    const pole = -pMin * Math.pow(ratio, frac);
    store<f64>(outPolesPtr + ((<usize>m) << 3), pole);
    weightSum += 1.0 / (<f64>(m + 1));
  }

  for (let m: i32 = 0; m < numPoles; m++) {
    const off = (<usize>m) << 3;
    const pole = load<f64>(outPolesPtr + off);
    const w = 1.0 / (<f64>(m + 1)) / weightSum;
    store<f64>(outYResPtr + off, -deltaY * w * pole);
    store<f64>(outHResPtr + off, -dcGain * w * pole);
  }
}

/**
 * Real-pole rational Vector Fitting least-squares synthesis kernel.
 *
 * Solves for real residues `c[0..nPoles-1]` minimizing
 *   `sum_{k=0}^{nFreq-1} | d0 + sum_{m=0}^{nPoles-1} c_m / (j*omega_k - p_m) - (targetRe_k + j*targetIm_k) |^2`
 * via normal equations `A^T A c = A^T b` with Tikhonov regularization (`1e-18`) and
 * Gaussian elimination with partial pivoting.
 *
 * Input layout:
 * - `omegasPtr`, `targetRePtr`, `targetImPtr`: `f64[nFreq]`
 * - `polesPtr`: `f64[nPoles]`
 * - `scratchPtr`: `f64[nPoles * (nPoles + 1)]` (augmented normal matrix workspace)
 *
 * Output layout:
 * - `outResPtr`: `f64[nPoles]`
 *
 * Returns `1` on success, `0` if dimensions are invalid or the normal matrix is singular.
 */
export function fd_line_vector_fit_ls(
  nFreq: i32,
  omegasPtr: usize,
  targetRePtr: usize,
  targetImPtr: usize,
  nPoles: i32,
  polesPtr: usize,
  d0: f64,
  outResPtr: usize,
  scratchPtr: usize,
): i32 {
  if (nFreq <= 0 || nPoles <= 0) return 0;

  const cols = nPoles + 1;
  const totalElems = nPoles * cols;
  for (let idx: i32 = 0; idx < totalElems; idx++) {
    store<f64>(scratchPtr + ((<usize>idx) << 3), 0.0);
  }

  // Accumulate normal equations: G = A^T A (symmetric), rhs = A^T b
  for (let k: i32 = 0; k < nFreq; k++) {
    const kOff = (<usize>k) << 3;
    const w = load<f64>(omegasPtr + kOff);
    const w2 = w * w;
    const bRe = load<f64>(targetRePtr + kOff) - d0;
    const bIm = load<f64>(targetImPtr + kOff);

    for (let i: i32 = 0; i < nPoles; i++) {
      const pi = load<f64>(polesPtr + ((<usize>i) << 3));
      const invDenI = 1.0 / Math.max(1e-30, pi * pi + w2);
      const phiIRe = -pi * invDenI;
      const phiIIm = -w * invDenI;

      const rowBase = i * cols;
      // RHS entry
      const rhsOff = (<usize>(rowBase + nPoles)) << 3;
      store<f64>(scratchPtr + rhsOff, load<f64>(scratchPtr + rhsOff) + phiIRe * bRe + phiIIm * bIm);

      // Upper triangle + diagonal of G
      for (let j: i32 = i; j < nPoles; j++) {
        const pj = load<f64>(polesPtr + ((<usize>j) << 3));
        const invDenJ = 1.0 / Math.max(1e-30, pj * pj + w2);
        const phiJRe = -pj * invDenJ;
        const phiJIm = -w * invDenJ;

        const ijOff = (<usize>(rowBase + j)) << 3;
        store<f64>(scratchPtr + ijOff, load<f64>(scratchPtr + ijOff) + phiIRe * phiJRe + phiIIm * phiJIm);
      }
    }
  }

  // Mirror upper triangle to lower triangle and add tiny diagonal regularization
  for (let i: i32 = 0; i < nPoles; i++) {
    const diagOff = (<usize>(i * cols + i)) << 3;
    store<f64>(scratchPtr + diagOff, load<f64>(scratchPtr + diagOff) + 1e-18);
    for (let j: i32 = i + 1; j < nPoles; j++) {
      const val = load<f64>(scratchPtr + ((<usize>(i * cols + j)) << 3));
      store<f64>(scratchPtr + ((<usize>(j * cols + i)) << 3), val);
    }
  }

  // Gaussian elimination with partial pivoting
  for (let i: i32 = 0; i < nPoles; i++) {
    let piv: i32 = i;
    let maxV: f64 = Math.abs(load<f64>(scratchPtr + ((<usize>(i * cols + i)) << 3)));
    for (let r: i32 = i + 1; r < nPoles; r++) {
      const v = Math.abs(load<f64>(scratchPtr + ((<usize>(r * cols + i)) << 3)));
      if (v > maxV) {
        maxV = v;
        piv = r;
      }
    }
    if (maxV < 1e-30) return 0;

    if (piv != i) {
      for (let c: i32 = i; c < cols; c++) {
        const o1 = (<usize>(i * cols + c)) << 3;
        const o2 = (<usize>(piv * cols + c)) << 3;
        const tmp = load<f64>(scratchPtr + o1);
        store<f64>(scratchPtr + o1, load<f64>(scratchPtr + o2));
        store<f64>(scratchPtr + o2, tmp);
      }
    }

    const diag = load<f64>(scratchPtr + ((<usize>(i * cols + i)) << 3));
    for (let r: i32 = i + 1; r < nPoles; r++) {
      const factor = load<f64>(scratchPtr + ((<usize>(r * cols + i)) << 3)) / diag;
      for (let c: i32 = i + 1; c < cols; c++) {
        const ro = (<usize>(r * cols + c)) << 3;
        const io = (<usize>(i * cols + c)) << 3;
        store<f64>(scratchPtr + ro, load<f64>(scratchPtr + ro) - factor * load<f64>(scratchPtr + io));
      }
    }
  }

  // Back-substitution
  for (let i: i32 = nPoles - 1; i >= 0; i--) {
    let sum = load<f64>(scratchPtr + ((<usize>(i * cols + nPoles)) << 3));
    for (let c: i32 = i + 1; c < nPoles; c++) {
      sum -= load<f64>(scratchPtr + ((<usize>(i * cols + c)) << 3)) * load<f64>(outResPtr + ((<usize>c) << 3));
    }
    const diag = load<f64>(scratchPtr + ((<usize>(i * cols + i)) << 3));
    store<f64>(outResPtr + ((<usize>i) << 3), sum / diag);
  }

  return 1;
}
