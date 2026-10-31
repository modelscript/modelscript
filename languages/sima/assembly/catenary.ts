// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sima — AssemblyScript WebAssembly Kernel for Marine Catenary Solvers.
 *
 * Implements analytical and shooting catenary calculations directly in WebAssembly
 * linear memory: fairlead/anchor tensions, suspended/grounded lengths, TDP, angles,
 * and high-resolution 2D profile coordinates with zero GC allocation.
 */

const BUFFER_BASE: usize = 1024;

const OFF_H: usize = BUFFER_BASE + 0 * 8; // f64: horizontalTension
const OFF_VF: usize = BUFFER_BASE + 1 * 8; // f64: fairleadVerticalTension
const OFF_TF: usize = BUFFER_BASE + 2 * 8; // f64: fairleadTotalTension
const OFF_VA: usize = BUFFER_BASE + 3 * 8; // f64: anchorVerticalTension
const OFF_TA: usize = BUFFER_BASE + 4 * 8; // f64: anchorTotalTension
const OFF_SUSP_L: usize = BUFFER_BASE + 5 * 8; // f64: suspendedLength
const OFF_GROUND_L: usize = BUFFER_BASE + 6 * 8; // f64: groundedLength
const OFF_TDP: usize = BUFFER_BASE + 7 * 8; // f64: touchdownDistance
const OFF_FAIRLEAD_ANG: usize = BUFFER_BASE + 8 * 8; // f64: fairleadAngleDeg
const OFF_ANCHOR_ANG: usize = BUFFER_BASE + 9 * 8; // f64: anchorAngleDeg
const OFF_LIFTED_OFF: usize = BUFFER_BASE + 10 * 8; // f64: 1.0 or 0.0
const OFF_PROFILE_COUNT: usize = BUFFER_BASE + 11 * 8; // f64: number of (x, z) points
const OFF_PROFILE_PTS: usize = BUFFER_BASE + 12 * 8; // pairs of f64 (x, z)

export function catenary_get_buffer_base(): usize {
  return BUFFER_BASE;
}

@inline
function asinh(x: f64): f64 {
  return Math.log(x + Math.sqrt(x * x + 1.0));
}

@inline
function sinh(x: f64): f64 {
  const ex = Math.exp(x);
  return (ex - 1.0 / ex) * 0.5;
}

@inline
function cosh(x: f64): f64 {
  const ex = Math.exp(x);
  return (ex + 1.0 / ex) * 0.5;
}

@inline
function tanh(x: f64): f64 {
  const ex = Math.exp(2.0 * x);
  return (ex - 1.0) / (ex + 1.0);
}

@inline
function computeSpanError(s: f64, h: f64, X: f64, L: f64, w: f64, ea: f64): f64 {
  if (s <= h) return -1e9;
  const H = (w * (s * s - h * h)) / (2.0 * h);
  if (H <= 0.0) return -1e9;
  const xSusp = (H / w) * asinh((w * s) / H) + (H * s) / ea;
  const xGrounded = L - s;
  return xSusp + xGrounded - X;
}

function solveLiftedOffCatenary(h: f64, X: f64, L: f64, w: f64, ea: f64): i32 {
  let hLow = 1e3;
  let hHigh = 1e8;
  let bestH = hLow;

  for (let i = 0; i < 40; i++) {
    const H = 0.5 * (hLow + hHigh);
    const a = H / w;
    const rhs = 2.0 * a * sinh(X / (2.0 * a));
    const stretchedL = L + (H * L) / ea;
    const target = Math.sqrt(Math.max(0.0, stretchedL * stretchedL - h * h));
    if (rhs < target) {
      hHigh = H;
    } else {
      hLow = H;
    }
    bestH = H;
  }

  const a = bestH / w;
  const u = X / (2.0 * a);
  const va = (w * (h / tanh(u) - L)) * 0.5;
  const vf = va + w * L;
  const tf = Math.sqrt(bestH * bestH + vf * vf);
  const posVa = Math.max(0.0, va);
  const ta = Math.sqrt(bestH * bestH + posVa * posVa);
  const angleF = (Math.atan2(vf, bestH) * 180.0) / Math.PI;
  const angleA = (Math.atan2(posVa, bestH) * 180.0) / Math.PI;

  store<f64>(OFF_H, bestH);
  store<f64>(OFF_VF, vf);
  store<f64>(OFF_TF, tf);
  store<f64>(OFF_VA, posVa);
  store<f64>(OFF_TA, ta);
  store<f64>(OFF_SUSP_L, L);
  store<f64>(OFF_GROUND_L, 0.0);
  store<f64>(OFF_TDP, 0.0);
  store<f64>(OFF_FAIRLEAD_ANG, angleF);
  store<f64>(OFF_ANCHOR_ANG, angleA);
  store<f64>(OFF_LIFTED_OFF, 1.0);

  const numPts = 40;
  const sinhU = sinh(u);
  const x0 = sinhU != 0.0 ? X * 0.5 - a * asinh(h / (2.0 * a * sinhU)) : X * 0.5;
  const coshX0 = cosh(x0 / a);

  for (let i = 0; i <= numPts; i++) {
    const xLocal = ((<f64>i) / (<f64>numPts)) * X;
    const zLocal = a * (cosh((xLocal - x0) / a) - coshX0);
    store<f64>(OFF_PROFILE_PTS + (i * 2 + 0) * 8, xLocal);
    store<f64>(OFF_PROFILE_PTS + (i * 2 + 1) * 8, zLocal);
  }
  store<f64>(OFF_PROFILE_COUNT, <f64>(numPts + 1));
  return 0;
}

export function catenary_solve(h: f64, X: f64, L: f64, w: f64, ea: f64): i32 {
  if (L <= h) {
    return -1; // Error: line length must exceed water depth
  }

  const diag = Math.sqrt(X * X + h * h);
  if (L < diag) {
    // Taut line with elastic stretch
    const stretch = (diag - L) / L;
    const tension = stretch * ea;
    const angleRad = Math.atan2(h, X);
    const H = tension * Math.cos(angleRad);
    const Vf = tension * Math.sin(angleRad);
    const deg = (angleRad * 180.0) / Math.PI;

    store<f64>(OFF_H, H);
    store<f64>(OFF_VF, Vf);
    store<f64>(OFF_TF, tension);
    store<f64>(OFF_VA, Vf);
    store<f64>(OFF_TA, tension);
    store<f64>(OFF_SUSP_L, L);
    store<f64>(OFF_GROUND_L, 0.0);
    store<f64>(OFF_TDP, 0.0);
    store<f64>(OFF_FAIRLEAD_ANG, deg);
    store<f64>(OFF_ANCHOR_ANG, deg);
    store<f64>(OFF_LIFTED_OFF, 1.0);
    store<f64>(OFF_PROFILE_COUNT, 2.0);
    store<f64>(OFF_PROFILE_PTS + 0 * 8, 0.0);
    store<f64>(OFF_PROFILE_PTS + 1 * 8, 0.0);
    store<f64>(OFF_PROFILE_PTS + 2 * 8, X);
    store<f64>(OFF_PROFILE_PTS + 3 * 8, h);
    return 0;
  }

  // Check if fully lifted off at s = L
  const atLErr = computeSpanError(L, h, X, L, w, ea);
  if (atLErr < 0.0) {
    return solveLiftedOffCatenary(h, X, L, w, ea);
  }

  // Bisection on s in (h, L]
  let sLow = h + 1e-4;
  let sHigh = L;
  let bestH: f64 = 1e5;
  let bestS: f64 = L;

  for (let iter = 0; iter < 40; iter++) {
    const sMid = 0.5 * (sLow + sHigh);
    const H = (w * (sMid * sMid - h * h)) / (2.0 * h);
    const err = computeSpanError(sMid, h, X, L, w, ea);
    bestH = H;
    bestS = sMid;

    if (Math.abs(err) < 1e-4) break;
    if (err > 0.0) {
      sHigh = sMid;
    } else {
      sLow = sMid;
    }
  }

  const Vf = w * bestS;
  const Tf = Math.sqrt(bestH * bestH + Vf * Vf);
  const groundedLen = Math.max(0.0, L - bestS);
  const fairleadAngleDeg = (Math.atan2(Vf, bestH) * 180.0) / Math.PI;

  store<f64>(OFF_H, bestH);
  store<f64>(OFF_VF, Vf);
  store<f64>(OFF_TF, Tf);
  store<f64>(OFF_VA, 0.0);
  store<f64>(OFF_TA, bestH);
  store<f64>(OFF_SUSP_L, bestS);
  store<f64>(OFF_GROUND_L, groundedLen);
  store<f64>(OFF_TDP, groundedLen);
  store<f64>(OFF_FAIRLEAD_ANG, fairleadAngleDeg);
  store<f64>(OFF_ANCHOR_ANG, 0.0);
  store<f64>(OFF_LIFTED_OFF, 0.0);

  let ptIdx: usize = 0;
  const numGroundedPts = 10;
  for (let i = 0; i <= numGroundedPts; i++) {
    const frac = (<f64>i) / (<f64>numGroundedPts);
    store<f64>(OFF_PROFILE_PTS + (ptIdx * 2 + 0) * 8, frac * groundedLen);
    store<f64>(OFF_PROFILE_PTS + (ptIdx * 2 + 1) * 8, 0.0);
    ptIdx++;
  }

  const numSuspPts = 30;
  for (let i = 1; i <= numSuspPts; i++) {
    const sLocal = ((<f64>i) / (<f64>numSuspPts)) * bestS;
    const ratio = (w * sLocal) / bestH;
    const zLocal = (bestH / w) * (Math.sqrt(1.0 + ratio * ratio) - 1.0);
    const xLocal = groundedLen + (bestH / w) * asinh(ratio) + (bestH * sLocal) / ea;
    store<f64>(OFF_PROFILE_PTS + (ptIdx * 2 + 0) * 8, xLocal);
    store<f64>(OFF_PROFILE_PTS + (ptIdx * 2 + 1) * 8, zLocal);
    ptIdx++;
  }

  store<f64>(OFF_PROFILE_COUNT, <f64>ptIdx);
  return 0;
}
