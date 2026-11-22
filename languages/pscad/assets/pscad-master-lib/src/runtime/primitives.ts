// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript Physics, Control, Signal-Processing, and Power-System Kernels.
 *
 * All kernels operate exclusively on the multi-instance linear-memory state arena (`abi.ts`)
 * so arbitrary numbers of concurrent component instances execute without state collisions.
 */

import {
  activeIntBase,
  activeRealBase,
  ctxDt,
  ctxFirstStep,
  ctxTime,
  ctxTimeZero,
  emtdc_add_ccin,
  emtdc_add_ggin,
  emtdc_get_cbr,
  emtdc_get_vdc,
  emtdc_host_io,
  emtdc_host_plot,
  emtdc_next_component_id,
  emtdc_set_status,
  getArg,
  getStorf,
  getStori,
  setArg,
  setStorf,
  setStori,
} from "./abi";

const TWO_PI: f64 = 6.283185307179586;
const SQRT_2_3: f64 = 0.816496580927726; // sqrt(2/3)
const SQRT_1_3: f64 = 0.5773502691896257; // 1/sqrt(3)
const TWO_PI_3: f64 = 2.0943951023931953; // 2*pi/3

@inline
function clamp(v: f64, lo: f64, hi: f64): f64 {
  return v < lo ? lo : v > hi ? hi : v;
}

// ============================================================================
// 1. CORE SYSTEM / UTILITY / BRANCH CONFIGURATION KERNELS
// ============================================================================

export function kernelComponentId(argsPtr: usize, argCount: i32): f64 {
  const id = <f64>emtdc_next_component_id();
  if (argCount > 0) setArg(argsPtr, 0, argCount, id);
  return id;
}

export function kernelCheckInequality(argsPtr: usize, argCount: i32): f64 {
  const lhs = getArg(argsPtr, 0, argCount, 0.0);
  const rhs = getArg(argsPtr, 1, argCount, 0.0);
  const ok: f64 = lhs <= rhs ? 1.0 : 0.0;
  if (ok == 0.0) emtdc_set_status(1);
  return ok;
}

export function kernelBranchCfg(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(6);
  const r = getArg(argsPtr, 0, argCount, 1.0);
  const l = getArg(argsPtr, 1, argCount, 0.0);
  const c = getArg(argsPtr, 2, argCount, 0.0);
  const nodeA = <i32>getArg(argsPtr, 3, argCount, 0.0);
  const nodeB = <i32>getArg(argsPtr, 4, argCount, 0.0);
  setStorf(base + 0, r);
  setStorf(base + 1, l);
  setStorf(base + 2, c);
  setStorf(base + 3, <f64>nodeA);
  setStorf(base + 4, <f64>nodeB);
  const dt = ctxDt();
  const zEq = Math.max(1e-6, r + (2.0 * l) / dt + (c > 1e-12 ? dt / (2.0 * c) : 0.0));
  const gEq = 1.0 / zEq;
  setStorf(base + 5, gEq);
  if (nodeA > 0) emtdc_add_ggin(nodeA, gEq);
  if (nodeB > 0) emtdc_add_ggin(nodeB, gEq);
  return gEq;
}

export function kernelNoopStatus(argsPtr: usize, argCount: i32, statusCode: i32): f64 {
  emtdc_set_status(statusCode);
  return getArg(argsPtr, 0, argCount, 0.0);
}

// ============================================================================
// 2. CONTINUOUS CSMF CONTROL KERNELS (TRAPEZOIDAL INTEGRATION)
// ============================================================================

/** First-order real pole: H(s) = K / (1 + sT) with optional reset & limits. */
export function kernelRealPole(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(2);
  const dt = ctxDt();
  // Support both 4-arg (K, T, u, out) and PSCAD 9-arg (reset, mode, limFlag, K, T, u, y0, min, max)
  let K: f64 = 1.0;
  let T: f64 = 0.01;
  let u: f64 = 0.0;
  let reset: bool = false;
  let y0: f64 = 0.0;
  let minLim: f64 = -1e20;
  let maxLim: f64 = 1e20;
  let outIdx: i32 = -1;

  if (argCount >= 6) {
    reset = getArg(argsPtr, 0, argCount, 0.0) != 0.0;
    const limFlag = getArg(argsPtr, 2, argCount, 0.0) != 0.0;
    K = getArg(argsPtr, 3, argCount, 1.0);
    T = Math.max(1e-9, getArg(argsPtr, 4, argCount, 0.01));
    u = getArg(argsPtr, 5, argCount, 0.0);
    y0 = getArg(argsPtr, 6, argCount, K * u);
    if (limFlag && argCount >= 9) {
      minLim = getArg(argsPtr, 7, argCount, -1e20);
      maxLim = getArg(argsPtr, 8, argCount, 1e20);
    }
  } else {
    K = getArg(argsPtr, 0, argCount, 1.0);
    T = Math.max(1e-9, getArg(argsPtr, 1, argCount, 0.01));
    u = getArg(argsPtr, 2, argCount, 0.0);
    y0 = K * u;
    if (argCount >= 4) outIdx = 3;
  }

  let y: f64;
  if (ctxFirstStep() || ctxTimeZero() || reset) {
    y = clamp(y0, minLim, maxLim);
  } else {
    const yPrev = getStorf(base + 0);
    const uPrev = getStorf(base + 1);
    const D = 2.0 * T + dt;
    const a = (2.0 * T - dt) / D;
    const b = (K * dt) / D;
    y = clamp(a * yPrev + b * (u + uPrev), minLim, maxLim);
  }
  setStorf(base + 0, y);
  setStorf(base + 1, u);
  if (outIdx >= 0) setArg(argsPtr, outIdx, argCount, y);
  return y;
}

/** Lead-lag transfer function: H(s) = K * (1 + s*T1) / (1 + s*T2). */
export function kernelLeadLag(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(2);
  const dt = ctxDt();
  const K = getArg(argsPtr, 0, argCount, 1.0);
  const T1 = getArg(argsPtr, 1, argCount, 0.01);
  const T2 = Math.max(1e-9, getArg(argsPtr, 2, argCount, 0.02));
  const u = getArg(argsPtr, 3, argCount, 0.0);
  let y: f64;
  if (ctxFirstStep() || ctxTimeZero()) {
    y = K * u;
  } else {
    const yPrev = getStorf(base + 0);
    const uPrev = getStorf(base + 1);
    const D = 2.0 * T2 + dt;
    y = ((2.0 * T2 - dt) * yPrev + K * ((2.0 * T1 + dt) * u - (2.0 * T1 - dt) * uPrev)) / D;
  }
  setStorf(base + 0, y);
  setStorf(base + 1, u);
  if (argCount >= 5) setArg(argsPtr, 4, argCount, y);
  return y;
}

/** Washout / differential pole: H(s) = K * s * T / (1 + s * T). */
export function kernelDiffPole(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(2);
  const dt = ctxDt();
  const K = getArg(argsPtr, 0, argCount, 1.0);
  const T = Math.max(1e-9, getArg(argsPtr, 1, argCount, 0.01));
  const u = getArg(argsPtr, 2, argCount, 0.0);
  let y: f64;
  if (ctxFirstStep() || ctxTimeZero()) {
    y = 0.0;
  } else {
    const yPrev = getStorf(base + 0);
    const uPrev = getStorf(base + 1);
    const D = 2.0 * T + dt;
    y = ((2.0 * T - dt) * yPrev + 2.0 * K * T * (u - uPrev)) / D;
  }
  setStorf(base + 0, y);
  setStorf(base + 1, u);
  if (argCount >= 4) setArg(argsPtr, 3, argCount, y);
  return y;
}

/** Trapezoidal integrator: H(s) = K / s with optional limits. */
export function kernelIntegrator(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(2);
  const dt = ctxDt();
  const K = getArg(argsPtr, 0, argCount, 1.0);
  const u = getArg(argsPtr, 1, argCount, 0.0);
  const y0 = getArg(argsPtr, 2, argCount, 0.0);
  const lo = argCount >= 5 ? getArg(argsPtr, 3, argCount, -1e20) : -1e20;
  const hi = argCount >= 5 ? getArg(argsPtr, 4, argCount, 1e20) : 1e20;
  let y: f64;
  if (ctxFirstStep() || ctxTimeZero()) {
    y = clamp(y0, lo, hi);
  } else {
    const yPrev = getStorf(base + 0);
    const uPrev = getStorf(base + 1);
    y = clamp(yPrev + 0.5 * K * dt * (u + uPrev), lo, hi);
  }
  setStorf(base + 0, y);
  setStorf(base + 1, u);
  return y;
}

/** PI controller with anti-windup: y = Kp*u + Ki*integral(u). */
export function kernelPI(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(2);
  const dt = ctxDt();
  const Kp = getArg(argsPtr, 0, argCount, 1.0);
  const Ti = Math.max(1e-9, getArg(argsPtr, 1, argCount, 0.1));
  const u = getArg(argsPtr, 2, argCount, 0.0);
  const lo = argCount >= 5 ? getArg(argsPtr, 3, argCount, -1e20) : -1e20;
  const hi = argCount >= 5 ? getArg(argsPtr, 4, argCount, 1e20) : 1e20;
  let integ: f64;
  if (ctxFirstStep() || ctxTimeZero()) {
    integ = 0.0;
  } else {
    const prevInteg = getStorf(base + 0);
    const prevU = getStorf(base + 1);
    integ = clamp(prevInteg + (0.5 * dt * (u + prevU)) / Ti, lo, hi);
  }
  const y = clamp(Kp * u + integ, lo, hi);
  setStorf(base + 0, integ);
  setStorf(base + 1, u);
  return y;
}

/** Second-order complex pole: H(s) = K * wn^2 / (s^2 + 2*zeta*wn*s + wn^2). */
export function kernelSecondOrder(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(2);
  const dt = ctxDt();
  const K = getArg(argsPtr, 0, argCount, 1.0);
  const wn = Math.max(1e-3, getArg(argsPtr, 1, argCount, TWO_PI * 10.0));
  const zeta = Math.max(0.01, getArg(argsPtr, 2, argCount, 0.707));
  const u = getArg(argsPtr, 3, argCount, 0.0);
  let y = getStorf(base + 0);
  let dy = getStorf(base + 1);
  if (ctxFirstStep() || ctxTimeZero()) {
    y = K * u;
    dy = 0.0;
  } else {
    const ddy = wn * wn * (K * u - y) - 2.0 * zeta * wn * dy;
    dy += ddy * dt;
    y += dy * dt;
  }
  setStorf(base + 0, y);
  setStorf(base + 1, dy);
  return y;
}

/** Ring-buffer transport delay (up to 64 steps per instance). */
export function kernelTransportDelay(argsPtr: usize, argCount: i32): f64 {
  const BUF_LEN: i32 = 64;
  const base = activeRealBase(BUF_LEN);
  const iBase = activeIntBase(1);
  const u = getArg(argsPtr, 0, argCount, 0.0);
  const tDelay = Math.max(0.0, getArg(argsPtr, 1, argCount, ctxDt()));
  const dt = ctxDt();
  let steps = <i32>Math.round(tDelay / dt);
  if (steps < 1) steps = 1;
  if (steps >= BUF_LEN) steps = BUF_LEN - 1;

  if (ctxFirstStep() || ctxTimeZero()) {
    for (let i = 0; i < BUF_LEN; i++) setStorf(base + i, u);
    setStori(iBase, 0);
    return u;
  }
  const head = getStori(iBase);
  const readIdx = (head + BUF_LEN - steps) % BUF_LEN;
  const out = getStorf(base + readIdx);
  setStorf(base + head, u);
  setStori(iBase, (head + 1) % BUF_LEN);
  return out;
}

export function kernelHardLimit(argsPtr: usize, argCount: i32): f64 {
  const lo = getArg(argsPtr, 0, argCount, -1.0);
  const hi = getArg(argsPtr, 1, argCount, 1.0);
  const u = getArg(argsPtr, 2, argCount, 0.0);
  return clamp(u, lo, hi);
}

export function kernelRateLimit(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(1);
  const u = getArg(argsPtr, 0, argCount, 0.0);
  const upRate = Math.max(1e-9, getArg(argsPtr, 1, argCount, 1e6));
  const dnRate = Math.max(1e-9, getArg(argsPtr, 2, argCount, upRate));
  const dt = ctxDt();
  let y: f64;
  if (ctxFirstStep() || ctxTimeZero()) {
    y = u;
  } else {
    const prev = getStorf(base);
    y = clamp(u, prev - dnRate * dt, prev + upRate * dt);
  }
  setStorf(base, y);
  return y;
}

export function kernelRamp(argsPtr: usize, argCount: i32): f64 {
  const t = ctxTime();
  const tStart = getArg(argsPtr, 0, argCount, 0.0);
  const tDur = Math.max(1e-9, getArg(argsPtr, 1, argCount, 0.1));
  const yStart = getArg(argsPtr, 2, argCount, 0.0);
  const yEnd = getArg(argsPtr, 3, argCount, 1.0);
  if (t <= tStart) return yStart;
  if (t >= tStart + tDur) return yEnd;
  return yStart + ((yEnd - yStart) * (t - tStart)) / tDur;
}

export function kernelTable1D(argsPtr: usize, argCount: i32): f64 {
  const x = getArg(argsPtr, 0, argCount, 0.0);
  const x0 = getArg(argsPtr, 1, argCount, 0.0);
  const y0 = getArg(argsPtr, 2, argCount, 0.0);
  const x1 = getArg(argsPtr, 3, argCount, 1.0);
  const y1 = getArg(argsPtr, 4, argCount, 1.0);
  const denom = Math.abs(x1 - x0) > 1e-12 ? x1 - x0 : 1.0;
  const frac = clamp((x - x0) / denom, 0.0, 1.0);
  return y0 + frac * (y1 - y0);
}

// ============================================================================
// 3. Z-DOMAIN & DIGITAL LOGIC KERNELS
// ============================================================================

export function kernelZDelay(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(1);
  const u = getArg(argsPtr, 0, argCount, 0.0);
  const prev = ctxFirstStep() || ctxTimeZero() ? u : getStorf(base);
  setStorf(base, u);
  return prev;
}

export function kernelZRealPole(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(1);
  const K = getArg(argsPtr, 0, argCount, 1.0);
  const T = Math.max(1e-9, getArg(argsPtr, 1, argCount, 0.01));
  const u = getArg(argsPtr, 2, argCount, 0.0);
  const alpha = Math.exp(-ctxDt() / T);
  const y = ctxFirstStep() || ctxTimeZero() ? K * u : alpha * getStorf(base) + (1.0 - alpha) * K * u;
  setStorf(base, y);
  return y;
}

export function kernelLogicGate(argsPtr: usize, argCount: i32): f64 {
  const mode = <i32>getArg(argsPtr, 0, argCount, 0.0);
  const a = getArg(argsPtr, 1, argCount, 0.0) > 0.5;
  const b = getArg(argsPtr, 2, argCount, 0.0) > 0.5;
  if (mode == 0) return a && b ? 1.0 : 0.0; // AND
  if (mode == 1) return a || b ? 1.0 : 0.0; // OR
  if (mode == 2) return a != b ? 1.0 : 0.0; // XOR
  if (mode == 3) return !a ? 1.0 : 0.0; // NOT
  return !(a && b) ? 1.0 : 0.0; // NAND
}

export function kernelFlipFlop(argsPtr: usize, argCount: i32): f64 {
  const iBase = activeIntBase(2);
  const setIn = getArg(argsPtr, 0, argCount, 0.0) > 0.5;
  const resetIn = getArg(argsPtr, 1, argCount, 0.0) > 0.5;
  let q = getStori(iBase);
  if (resetIn) q = 0;
  else if (setIn) q = 1;
  setStori(iBase, q);
  return <f64>q;
}

export function kernelComparator(argsPtr: usize, argCount: i32): f64 {
  const a = getArg(argsPtr, 0, argCount, 0.0);
  const b = getArg(argsPtr, 1, argCount, 0.0);
  return a >= b ? 1.0 : 0.0;
}

export function kernelSampleHold(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(1);
  const u = getArg(argsPtr, 0, argCount, 0.0);
  const trig = getArg(argsPtr, 1, argCount, 1.0) > 0.5;
  let held = getStorf(base);
  if (ctxFirstStep() || ctxTimeZero() || trig) {
    held = u;
    setStorf(base, held);
  }
  return held;
}

// ============================================================================
// 4. SIGNAL PROCESSING, METERING & PARK DQ0 KERNELS
// ============================================================================

export function kernelSlidingRms(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(2);
  const u = getArg(argsPtr, 0, argCount, 0.0);
  const freq = Math.max(1.0, getArg(argsPtr, 1, argCount, 60.0));
  const tau = 1.0 / freq;
  const alpha = Math.exp(-ctxDt() / tau);
  let meanSq = getStorf(base);
  if (ctxFirstStep() || ctxTimeZero()) {
    meanSq = u * u;
  } else {
    meanSq = alpha * meanSq + (1.0 - alpha) * u * u;
  }
  setStorf(base, meanSq);
  const rms = Math.sqrt(Math.max(0.0, meanSq));
  if (argCount >= 3) setArg(argsPtr, 2, argCount, rms);
  return rms;
}

/** Park abc <-> dq0 transform (direction 0: abc->dq0, 1: dq0->abc). */
export function kernelParkDq0(argsPtr: usize, argCount: i32): f64 {
  const dir = <i32>getArg(argsPtr, 0, argCount, 0.0);
  const x0 = getArg(argsPtr, 1, argCount, 0.0);
  const x1 = getArg(argsPtr, 2, argCount, 0.0);
  const x2 = getArg(argsPtr, 3, argCount, 0.0);
  const theta = getArg(argsPtr, 4, argCount, 0.0);
  const c0 = Math.cos(theta);
  const s0 = Math.sin(theta);
  const c1 = Math.cos(theta - TWO_PI_3);
  const s1 = Math.sin(theta - TWO_PI_3);
  const c2 = Math.cos(theta + TWO_PI_3);
  const s2 = Math.sin(theta + TWO_PI_3);

  let y0: f64;
  let y1: f64;
  let y2: f64;
  if (dir == 0) {
    y0 = SQRT_2_3 * (x0 * c0 + x1 * c1 + x2 * c2);
    y1 = -SQRT_2_3 * (x0 * s0 + x1 * s1 + x2 * s2);
    y2 = SQRT_1_3 * (x0 + x1 + x2);
  } else {
    y0 = SQRT_2_3 * (x0 * c0 - x1 * s0) + SQRT_1_3 * x2;
    y1 = SQRT_2_3 * (x0 * c1 - x1 * s1) + SQRT_1_3 * x2;
    y2 = SQRT_2_3 * (x0 * c2 - x1 * s2) + SQRT_1_3 * x2;
  }
  if (argCount >= 8) {
    setArg(argsPtr, 5, argCount, y0);
    setArg(argsPtr, 6, argCount, y1);
    setArg(argsPtr, 7, argCount, y2);
  }
  return y0;
}

export function kernelThreePhasePower(argsPtr: usize, argCount: i32, reactive: bool): f64 {
  const va = getArg(argsPtr, 0, argCount, 0.0);
  const vb = getArg(argsPtr, 1, argCount, 0.0);
  const vc = getArg(argsPtr, 2, argCount, 0.0);
  const ia = getArg(argsPtr, 3, argCount, 0.0);
  const ib = getArg(argsPtr, 4, argCount, 0.0);
  const ic = getArg(argsPtr, 5, argCount, 0.0);
  if (!reactive) {
    return va * ia + vb * ib + vc * ic;
  }
  return SQRT_1_3 * ((vb - vc) * ia + (vc - va) * ib + (va - vb) * ic);
}

export function kernelPll(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(2);
  const va = getArg(argsPtr, 0, argCount, 0.0);
  const f0 = Math.max(1.0, getArg(argsPtr, 1, argCount, 60.0));
  const kp = getArg(argsPtr, 2, argCount, 120.0);
  const ki = getArg(argsPtr, 3, argCount, 1800.0);
  const dt = ctxDt();
  let theta = getStorf(base + 0);
  let omegaInt = getStorf(base + 1);
  if (ctxFirstStep() || ctxTimeZero()) {
    theta = 0.0;
    omegaInt = TWO_PI * f0;
  } else {
    const err = va * Math.cos(theta);
    omegaInt = clamp(omegaInt + ki * err * dt, TWO_PI * f0 * 0.5, TWO_PI * f0 * 1.5);
    const omega = omegaInt + kp * err;
    theta = (theta + omega * dt) % TWO_PI;
    if (theta < 0.0) theta += TWO_PI;
  }
  setStorf(base + 0, theta);
  setStorf(base + 1, omegaInt);
  return theta;
}

// ============================================================================
// 5. NETWORK, MNA, SOURCES, TRANSFORMERS & SATURATION KERNELS
// ============================================================================

/** Piecewise/smooth transformer & reactor core saturation current injection (TSAT / UMECSAT). */
export function kernelCoreSaturation(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(3);
  const vWinding = getArg(argsPtr, 0, argCount, 0.0);
  const kneeFlux = Math.max(1e-4, getArg(argsPtr, 1, argCount, 1.15));
  const lSat = Math.max(1e-6, getArg(argsPtr, 2, argCount, 0.2));
  const lUnsat = Math.max(lSat * 2.0, getArg(argsPtr, 3, argCount, 50.0));
  const dt = ctxDt();

  let flux = getStorf(base + 0);
  const vPrev = getStorf(base + 1);
  if (ctxFirstStep() || ctxTimeZero()) {
    flux = 0.0;
  } else {
    flux += 0.5 * dt * (vWinding + vPrev);
  }
  const absFlux = Math.abs(flux);
  let iMag: f64;
  if (absFlux <= kneeFlux) {
    iMag = flux / lUnsat;
  } else {
    const excess = absFlux - kneeFlux;
    const sign: f64 = flux >= 0.0 ? 1.0 : -1.0;
    iMag = sign * (kneeFlux / lUnsat + excess / lSat);
  }
  setStorf(base + 0, flux);
  setStorf(base + 1, vWinding);
  setStorf(base + 2, iMag);
  if (argCount >= 7) {
    setArg(argsPtr, argCount - 2, argCount, flux);
    setArg(argsPtr, argCount - 1, argCount, iMag);
  } else if (argCount >= 5) {
    setArg(argsPtr, 4, argCount, iMag);
  }
  return iMag;
}

/** ZnO Surge Arrester nonlinear V-I model: I = Iref * (|V|/Vref)^alpha. */
export function kernelZnOArrester(argsPtr: usize, argCount: i32): f64 {
  const v = getArg(argsPtr, 0, argCount, 0.0);
  const vRef = Math.max(1.0, getArg(argsPtr, 1, argCount, 200e3));
  const alpha = clamp(getArg(argsPtr, 2, argCount, 26.0), 2.0, 50.0);
  const ratio = Math.abs(v) / vRef;
  if (ratio < 0.5) return v * 1e-9;
  const iMag = Math.pow(Math.min(ratio, 2.5), alpha);
  return v >= 0.0 ? iMag : -iMag;
}

export function kernelVoltageSource(argsPtr: usize, argCount: i32): f64 {
  const vPeak = getArg(argsPtr, 0, argCount, 1.0);
  const freq = getArg(argsPtr, 1, argCount, 60.0);
  const phase = getArg(argsPtr, 2, argCount, 0.0);
  return vPeak * Math.sin(TWO_PI * freq * ctxTime() + phase);
}

export function kernelSurgeWaveform(argsPtr: usize, argCount: i32): f64 {
  const t = ctxTime();
  const vPeak = getArg(argsPtr, 0, argCount, 1000.0);
  const tFront = Math.max(1e-7, getArg(argsPtr, 1, argCount, 1.2e-6));
  const tTail = Math.max(tFront * 2.0, getArg(argsPtr, 2, argCount, 50e-6));
  return vPeak * (Math.exp(-t / tTail) - Math.exp(-t / tFront));
}

export function kernelBatteryModel(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(2);
  const iLoad = getArg(argsPtr, 0, argCount, 0.0);
  const vNom = Math.max(1.0, getArg(argsPtr, 1, argCount, 400.0));
  const capAs = Math.max(1.0, getArg(argsPtr, 2, argCount, 360000.0));
  const rInt = Math.max(1e-5, getArg(argsPtr, 3, argCount, 0.02));
  let soc = getStorf(base);
  if (ctxFirstStep() || ctxTimeZero()) {
    soc = clamp(getArg(argsPtr, 4, argCount, 0.85), 0.0, 1.0);
  } else {
    soc = clamp(soc - (iLoad * ctxDt()) / capAs, 0.0, 1.0);
  }
  setStorf(base, soc);
  const vOc = vNom * (0.9 + 0.15 * soc);
  const vTerm = vOc - iLoad * rInt;
  setStorf(base + 1, vTerm);
  return vTerm;
}

// ============================================================================
// 6. SWITCHGEAR, PROTECTION & POWER ELECTRONICS KERNELS
// ============================================================================

export function kernelBreaker(argsPtr: usize, argCount: i32): f64 {
  const iBase = activeIntBase(1);
  const cmdClosed = getArg(argsPtr, 0, argCount, 1.0) > 0.5;
  const iBranch = getArg(argsPtr, 1, argCount, 0.0);
  const rOn = Math.max(1e-6, getArg(argsPtr, 2, argCount, 0.005));
  const rOff = Math.max(1e3, getArg(argsPtr, 3, argCount, 1e6));
  let closed = getStori(iBase);
  if (ctxFirstStep() || ctxTimeZero()) {
    closed = cmdClosed ? 1 : 0;
  } else if (cmdClosed) {
    closed = 1;
  } else if (Math.abs(iBranch) < 1e-2) {
    closed = 0; // current-zero interruption
  }
  setStori(iBase, closed);
  return closed != 0 ? 1.0 / rOn : 1.0 / rOff;
}

export function kernelPeSwitch(argsPtr: usize, argCount: i32): f64 {
  const vAnodeCathode = getArg(argsPtr, 0, argCount, 0.0);
  const gate = getArg(argsPtr, 1, argCount, 1.0) > 0.5;
  const rOn = Math.max(1e-5, getArg(argsPtr, 2, argCount, 0.01));
  const rOff = Math.max(1e3, getArg(argsPtr, 3, argCount, 1e6));
  const conducting = gate && vAnodeCathode >= 0.0;
  return conducting ? 1.0 / rOn : 1.0 / rOff;
}

export function kernelPolygonRelay(argsPtr: usize, argCount: i32): f64 {
  const rMeas = getArg(argsPtr, 0, argCount, 0.0);
  const xMeas = getArg(argsPtr, 1, argCount, 0.0);
  const rReach = Math.max(1e-4, getArg(argsPtr, 2, argCount, 10.0));
  const xReach = Math.max(1e-4, getArg(argsPtr, 3, argCount, 20.0));
  const inside = rMeas >= -0.2 * rReach && rMeas <= rReach && xMeas >= -0.1 * xReach && xMeas <= xReach;
  return inside ? 1.0 : 0.0;
}

export function kernelTrvEnvelope(argsPtr: usize, argCount: i32): f64 {
  const vTrv = Math.abs(getArg(argsPtr, 0, argCount, 0.0));
  const uc = Math.max(1.0, getArg(argsPtr, 1, argCount, 300e3));
  return vTrv > uc ? 1.0 : 0.0;
}

// ============================================================================
// 7. ROTATING MACHINES & IEEE CONTROLS KERNELS
// ============================================================================

/** Subtransient dq0 synchronous machine + swing equation (SYNCMC3P). */
export function kernelSyncMachineDq0(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(6);
  const pm = getArg(argsPtr, 0, argCount, 0.8);
  const ef = getArg(argsPtr, 1, argCount, 1.1);
  const vd = getArg(argsPtr, 2, argCount, 0.0);
  const vq = getArg(argsPtr, 3, argCount, 1.0);
  const H = Math.max(0.1, getArg(argsPtr, 4, argCount, 3.5));
  const D = Math.max(0.0, getArg(argsPtr, 5, argCount, 2.0));
  const xdPrime = Math.max(0.05, getArg(argsPtr, 6, argCount, 0.3));
  const tdoPrime = Math.max(0.05, getArg(argsPtr, 7, argCount, 5.0));
  const dt = ctxDt();
  const omegaBase = TWO_PI * 60.0;

  let delta = getStorf(base + 0);
  let omegaPu = getStorf(base + 1);
  let eqPrime = getStorf(base + 2);
  if (ctxFirstStep() || ctxTimeZero()) {
    delta = 0.25;
    omegaPu = 1.0;
    eqPrime = ef;
  } else {
    const id = (eqPrime - vq) / xdPrime;
    const iq = vd / xdPrime;
    const pe = vd * id + vq * iq;
    const dOmega = (pm - pe - D * (omegaPu - 1.0)) / (2.0 * H);
    omegaPu += dOmega * dt;
    delta += omegaBase * (omegaPu - 1.0) * dt;
    eqPrime += ((ef - eqPrime - (1.8 - xdPrime) * id) / tdoPrime) * dt;
  }
  setStorf(base + 0, delta);
  setStorf(base + 1, omegaPu);
  setStorf(base + 2, eqPrime);
  return omegaPu;
}

/** Induction machine slip & electromagnetic torque kernel (INDUCMC2 / SQCIM3P1 / SPIMW1). */
export function kernelInductionMachine(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(3);
  const vPu = getArg(argsPtr, 0, argCount, 1.0);
  const tMech = getArg(argsPtr, 1, argCount, 0.5);
  const r2 = Math.max(0.002, getArg(argsPtr, 2, argCount, 0.02));
  const xEq = Math.max(0.05, getArg(argsPtr, 3, argCount, 0.2));
  const H = Math.max(0.05, getArg(argsPtr, 4, argCount, 1.5));
  const dt = ctxDt();

  let slip = getStorf(base + 0);
  if (ctxFirstStep() || ctxTimeZero()) {
    slip = 0.02;
  } else {
    const sSafe = Math.abs(slip) < 1e-4 ? (slip >= 0.0 ? 1e-4 : -1e-4) : slip;
    const rOverS = r2 / sSafe;
    const tElec = (vPu * vPu * rOverS) / (rOverS * rOverS + xEq * xEq);
    const dSlip = -(tElec - tMech) / (2.0 * H);
    slip = clamp(slip + dSlip * dt, -0.5, 1.5);
    setStorf(base + 1, tElec);
  }
  setStorf(base + 0, slip);
  return 1.0 - slip;
}

/** IEEE Exciter / AVR kernel (EXCDC3A1 / EXCI35 / DEC* / AC/DC/ST exciters). */
export function kernelIeeeExciter(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(2);
  const vRef = getArg(argsPtr, 0, argCount, 1.0);
  const vTerm = getArg(argsPtr, 1, argCount, 1.0);
  const Ka = getArg(argsPtr, 2, argCount, 200.0);
  const Ta = Math.max(0.002, getArg(argsPtr, 3, argCount, 0.02));
  const vrMax = getArg(argsPtr, 4, argCount, 5.0);
  const vrMin = getArg(argsPtr, 5, argCount, -5.0);
  const dt = ctxDt();

  let efd = getStorf(base + 0);
  if (ctxFirstStep() || ctxTimeZero()) {
    efd = 1.0;
  } else {
    const err = vRef - vTerm;
    const vr = clamp(Ka * err, vrMin, vrMax);
    efd = clamp(efd + ((vr - efd) * dt) / Ta, vrMin, vrMax);
  }
  setStorf(base + 0, efd);
  return efd;
}

/** IEEE Governor / Turbine kernel (TGOV11..51 / TTUR11..21 / HGOV90 / WINDGOV1 / WINDTRB1). */
export function kernelIeeeGovernor(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(2);
  const pRef = getArg(argsPtr, 0, argCount, 0.8);
  const omegaPu = getArg(argsPtr, 1, argCount, 1.0);
  const droop = Math.max(0.01, getArg(argsPtr, 2, argCount, 0.05));
  const tGov = Math.max(0.01, getArg(argsPtr, 3, argCount, 0.2));
  const tTurb = Math.max(0.05, getArg(argsPtr, 4, argCount, 0.5));
  const dt = ctxDt();

  let valve = getStorf(base + 0);
  let pMech = getStorf(base + 1);
  if (ctxFirstStep() || ctxTimeZero()) {
    valve = pRef;
    pMech = pRef;
  } else {
    const target = clamp(pRef - (omegaPu - 1.0) / droop, 0.0, 1.2);
    valve += ((target - valve) * dt) / tGov;
    pMech += ((valve - pMech) * dt) / tTurb;
  }
  setStorf(base + 0, valve);
  setStorf(base + 1, pMech);
  return pMech;
}

/** Node voltage / branch current readout helpers. */
export function kernelNodeVoltage(argsPtr: usize, argCount: i32): f64 {
  const node = <i32>getArg(argsPtr, 0, argCount, 0.0);
  return emtdc_get_vdc(node);
}

export function kernelBranchCurrent(argsPtr: usize, argCount: i32): f64 {
  const br = <i32>getArg(argsPtr, 0, argCount, 0.0);
  return emtdc_get_cbr(br);
}

export function kernelInjectCurrent(argsPtr: usize, argCount: i32): f64 {
  const node = <i32>getArg(argsPtr, 0, argCount, 0.0);
  const current = getArg(argsPtr, 1, argCount, 0.0);
  emtdc_add_ccin(node, current);
  return current;
}

// ============================================================================
// 8. DEDICATED POWER ELECTRONICS, HVDC, MMC & FACTS KERNELS
// ============================================================================

/** 6-pulse/12-pulse LCC thyristor valve group: Vd = (3*sqrt(2)/pi)*Vll*cos(alpha) - (3/pi)*Xc*Id. */
export function kernelValveGroup6Pulse(argsPtr: usize, argCount: i32): f64 {
  const vLL = getArg(argsPtr, 0, argCount, 230.0);
  const alphaRad = clamp(getArg(argsPtr, 1, argCount, 0.26), 0.0, 2.8);
  const xc = Math.max(0.0, getArg(argsPtr, 2, argCount, 10.0));
  const iDc = Math.max(0.0, getArg(argsPtr, 3, argCount, 0.0));
  const vD0 = (3.0 * 1.4142135623730951 * vLL) / Math.PI;
  const vDc = vD0 * Math.cos(alphaRad) - (3.0 / Math.PI) * xc * iDc;
  if (argCount >= 5) setArg(argsPtr, 4, argCount, vDc);
  return vDc;
}

/** 3-phase Space Vector Modulation (SVM): computes duty cycles [da, db, dc] from (vAlpha, vBeta, vDc). */
export function kernelSvmModulator(argsPtr: usize, argCount: i32): f64 {
  const vAlpha = getArg(argsPtr, 0, argCount, 0.0);
  const vBeta = getArg(argsPtr, 1, argCount, 0.0);
  const vDc = Math.max(1e-3, getArg(argsPtr, 2, argCount, 1.0));
  const va = vAlpha;
  const vb = -0.5 * vAlpha + 0.8660254037844386 * vBeta;
  const vc = -0.5 * vAlpha - 0.8660254037844386 * vBeta;
  const vMax = Math.max(va, Math.max(vb, vc));
  const vMin = Math.min(va, Math.min(vb, vc));
  const vZero = -0.5 * (vMax + vMin);
  const da = clamp(0.5 + (va + vZero) / vDc, 0.0, 1.0);
  const db = clamp(0.5 + (vb + vZero) / vDc, 0.0, 1.0);
  const dc = clamp(0.5 + (vc + vZero) / vDc, 0.0, 1.0);
  if (argCount >= 6) {
    setArg(argsPtr, 3, argCount, da);
    setArg(argsPtr, 4, argCount, db);
    setArg(argsPtr, 5, argCount, dc);
  }
  return da;
}

/** Static VAR Compensator (TCR/TSC): B_svc(alpha) = Bc - Bl*(2*pi - 2*alpha + sin(2*alpha))/pi. */
export function kernelSvcController(argsPtr: usize, argCount: i32): f64 {
  const alphaRad = clamp(getArg(argsPtr, 0, argCount, 2.0), Math.PI * 0.5, Math.PI);
  const bMaxL = Math.max(0.0, getArg(argsPtr, 1, argCount, 1.0));
  const bCap = Math.max(0.0, getArg(argsPtr, 2, argCount, 0.5));
  const bTcr = bMaxL * ((TWO_PI - 2.0 * alphaRad + Math.sin(2.0 * alphaRad)) / Math.PI);
  const bNet = bCap - bTcr;
  if (argCount >= 4) setArg(argsPtr, 3, argCount, bNet);
  return bNet;
}

/** MMC submodule capacitor-voltage balancing & insertion index selection. */
export function kernelMmcSubmoduleSort(argsPtr: usize, argCount: i32): f64 {
  const vRef = getArg(argsPtr, 0, argCount, 0.0);
  const vCapAvg = Math.max(1e-3, getArg(argsPtr, 1, argCount, 1.0));
  const nTotal = Math.max(1.0, getArg(argsPtr, 2, argCount, 20.0));
  const nInsert = clamp(Math.round(vRef / vCapAvg), 0.0, nTotal);
  if (argCount >= 4) setArg(argsPtr, 3, argCount, nInsert);
  return nInsert;
}

// ============================================================================
// 9. DEDICATED PROTECTION RELAYS & INSTRUMENT TRANSFORMER KERNELS
// ============================================================================

/** Self-polarized Mho distance relay: trips when |Z - Zr/2| <= |Zr|/2. */
export function kernelMhoRelay(argsPtr: usize, argCount: i32): f64 {
  const rMeas = getArg(argsPtr, 0, argCount, 0.0);
  const xMeas = getArg(argsPtr, 1, argCount, 0.0);
  const zReach = Math.max(1e-4, getArg(argsPtr, 2, argCount, 20.0));
  const phiRad = getArg(argsPtr, 3, argCount, 1.309); // ~75 deg MTA
  const rCenter = 0.5 * zReach * Math.cos(phiRad);
  const xCenter = 0.5 * zReach * Math.sin(phiRad);
  const dr = rMeas - rCenter;
  const dx = xMeas - xCenter;
  const distSq = dr * dr + dx * dx;
  const radSq = 0.25 * zReach * zReach;
  return distSq <= radSq ? 1.0 : 0.0;
}

/** IEEE C37.112 Inverse-Time Overcurrent Relay with state accumulation. */
export function kernelOvercurrentRelay(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(1);
  const iMag = Math.abs(getArg(argsPtr, 0, argCount, 0.0));
  const iPickup = Math.max(1e-4, getArg(argsPtr, 1, argCount, 1.0));
  const td = Math.max(0.05, getArg(argsPtr, 2, argCount, 1.0));
  const dt = ctxDt();
  let accum = getStorf(base);
  if (ctxFirstStep() || ctxTimeZero()) {
    accum = 0.0;
  } else {
    const M = iMag / iPickup;
    if (M > 1.0) {
      // IEEE Moderately Inverse: A=0.0515, B=0.114, p=0.02
      const tTrip = td * (0.0515 / (Math.pow(M, 0.02) - 1.0) + 0.114);
      accum = Math.min(1.0, accum + dt / Math.max(1e-4, tTrip));
    } else {
      accum = Math.max(0.0, accum - dt / Math.max(0.1, td));
    }
  }
  setStorf(base, accum);
  return accum >= 1.0 ? 1.0 : 0.0;
}

/** Symmetrical component sequence filter (Fortescue positive/negative/zero magnitudes). */
export function kernelSeqFilter(argsPtr: usize, argCount: i32): f64 {
  const va = getArg(argsPtr, 0, argCount, 0.0);
  const vb = getArg(argsPtr, 1, argCount, 0.0);
  const vc = getArg(argsPtr, 2, argCount, 0.0);
  const v0 = (va + vb + vc) / 3.0;
  const vAlpha = (2.0 * va - vb - vc) / 3.0;
  const vBeta = (vb - vc) * SQRT_1_3;
  const vPos = Math.sqrt(vAlpha * vAlpha + vBeta * vBeta);
  if (argCount >= 5) {
    setArg(argsPtr, 3, argCount, vPos);
    setArg(argsPtr, 4, argCount, v0);
  }
  return vPos;
}

// ============================================================================
// 10. DEDICATED IEEE PSS, DC/AC EXCITERS & WIND AERODYNAMICS KERNELS
// ============================================================================

/** IEEE PSS1A/PSS2B Power System Stabilizer (washout + dual lead-lag + limits). */
export function kernelIeeePss(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(4);
  const u = getArg(argsPtr, 0, argCount, 0.0);
  const Ks = getArg(argsPtr, 1, argCount, 10.0);
  const Tw = Math.max(0.05, getArg(argsPtr, 2, argCount, 5.0));
  const T1 = Math.max(0.005, getArg(argsPtr, 3, argCount, 0.15));
  const T2 = Math.max(0.005, getArg(argsPtr, 4, argCount, 0.03));
  const vLim = Math.max(0.01, getArg(argsPtr, 5, argCount, 0.1));
  const dt = ctxDt();

  let wPrev = getStorf(base + 0);
  let uPrev = getStorf(base + 1);
  let yPrev = getStorf(base + 2);
  let wOut: f64;
  let yOut: f64;
  if (ctxFirstStep() || ctxTimeZero()) {
    wOut = 0.0;
    yOut = 0.0;
  } else {
    const Dw = 2.0 * Tw + dt;
    wOut = ((2.0 * Tw - dt) * wPrev + 2.0 * Ks * Tw * (u - uPrev)) / Dw;
    const Dl = 2.0 * T2 + dt;
    yOut = ((2.0 * T2 - dt) * yPrev + (2.0 * T1 + dt) * wOut - (2.0 * T1 - dt) * wPrev) / Dl;
  }
  setStorf(base + 0, wOut);
  setStorf(base + 1, u);
  setStorf(base + 2, yOut);
  return clamp(yOut, -vLim, vLim);
}

/** IEEE DC1A/DC3A Exciter with exponential saturation Se(Efd) = Aex*exp(Bex*Efd) & rate feedback. */
export function kernelIeeeExciterDc(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(3);
  const vRef = getArg(argsPtr, 0, argCount, 1.0);
  const vTerm = getArg(argsPtr, 1, argCount, 1.0);
  const Ka = getArg(argsPtr, 2, argCount, 100.0);
  const Ta = Math.max(0.005, getArg(argsPtr, 3, argCount, 0.02));
  const Te = Math.max(0.05, getArg(argsPtr, 4, argCount, 0.8));
  const Ke = getArg(argsPtr, 5, argCount, 1.0);
  const Kf = getArg(argsPtr, 6, argCount, 0.03);
  const Tf = Math.max(0.05, getArg(argsPtr, 7, argCount, 1.0));
  const dt = ctxDt();

  let vr = getStorf(base + 0);
  let efd = getStorf(base + 1);
  let vf = getStorf(base + 2);
  if (ctxFirstStep() || ctxTimeZero()) {
    efd = 1.0;
    vr = Ke * efd;
    vf = 0.0;
  } else {
    const err = vRef - vTerm - vf;
    vr = clamp(vr + ((Ka * err - vr) * dt) / Ta, -5.0, 5.0);
    const se = 0.05 * Math.exp(0.3 * Math.abs(efd));
    const dEfd = (vr - (Ke + se) * efd) / Te;
    efd = clamp(efd + dEfd * dt, 0.0, 6.0);
    vf += ((Kf * dEfd - vf) * dt) / Tf;
  }
  setStorf(base + 0, vr);
  setStorf(base + 1, efd);
  setStorf(base + 2, vf);
  return efd;
}

/** Wind turbine aerodynamic Cp(lambda, beta) power & pitch-angle controller. */
export function kernelWindTurbine(argsPtr: usize, argCount: i32): f64 {
  const vWind = Math.max(0.1, getArg(argsPtr, 0, argCount, 10.0));
  const omegaR = Math.max(0.05, getArg(argsPtr, 1, argCount, 1.5));
  const betaDeg = clamp(getArg(argsPtr, 2, argCount, 0.0), 0.0, 45.0);
  const radius = Math.max(1.0, getArg(argsPtr, 3, argCount, 40.0));
  const rho = 1.225;
  const lambda = clamp((omegaR * radius) / vWind, 0.5, 20.0);
  const invLamI = 1.0 / (lambda + 0.08 * betaDeg) - 0.035 / (betaDeg * betaDeg * betaDeg + 1.0);
  const cp = clamp(0.5176 * (116.0 * invLamI - 0.4 * betaDeg - 5.0) * Math.exp(-21.0 * invLamI) + 0.0068 * lambda, 0.0, 0.593);
  const area = Math.PI * radius * radius;
  const pMechW = 0.5 * rho * area * cp * vWind * vWind * vWind;
  if (argCount >= 5) setArg(argsPtr, 4, argCount, cp);
  return pMechW;
}

// ============================================================================
// 11. OPTIMIZER, PRNG & MULTI-RUN STATISTICS KERNELS
// ============================================================================

/** Deterministic cleanroom LCG + Box-Muller PRNG (RAN1 / GASDEV). */
export function kernelRandomGauss(argsPtr: usize, argCount: i32, gaussian: bool): f64 {
  const iBase = activeIntBase(1);
  let seed = getStori(iBase);
  if (seed == 0) {
    seed = <i32>getArg(argsPtr, 0, argCount, 1234567.0);
    if (seed == 0) seed = 1234567;
  }
  seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
  const u1 = Math.max(1e-9, <f64>seed / 2147483648.0);
  if (!gaussian) {
    setStori(iBase, seed);
    return u1;
  }
  seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
  const u2 = <f64>seed / 2147483648.0;
  setStori(iBase, seed);
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(TWO_PI * u2);
}

/** Online multi-run statistics & objective optimizer tracker (OPT_* / MRUN*). */
export function kernelMultiRunStats(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(4);
  const sample = getArg(argsPtr, 0, argCount, 0.0);
  let count = getStorf(base + 0);
  let mean = getStorf(base + 1);
  let minVal = getStorf(base + 2);
  let maxVal = getStorf(base + 3);
  if (ctxFirstStep() || ctxTimeZero() || count <= 0.0) {
    count = 1.0;
    mean = sample;
    minVal = sample;
    maxVal = sample;
  } else {
    count += 1.0;
    mean += (sample - mean) / count;
    if (sample < minVal) minVal = sample;
    if (sample > maxVal) maxVal = sample;
  }
  setStorf(base + 0, count);
  setStorf(base + 1, mean);
  setStorf(base + 2, minVal);
  setStorf(base + 3, maxVal);
  return mean;
}

// ============================================================================
// 12. PER-STANDARD IEEE AC/ST EXCITERS & HYDRO/GAS TURBINE-GOVERNOR KERNELS
// ============================================================================

/** IEEE Std 421.5 AC1A/AC8B Brushless AC Exciter with rectifier regulation Fex(In) & demagnetizing Kd*Ifd. */
export function kernelIeeeExciterAc(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(3);
  const vRef = getArg(argsPtr, 0, argCount, 1.0);
  const vTerm = getArg(argsPtr, 1, argCount, 1.0);
  const iFd = Math.max(0.0, getArg(argsPtr, 2, argCount, 1.0));
  const Ka = getArg(argsPtr, 3, argCount, 400.0);
  const Ta = Math.max(0.005, getArg(argsPtr, 4, argCount, 0.02));
  const Te = Math.max(0.05, getArg(argsPtr, 5, argCount, 0.8));
  const Kd = Math.max(0.0, getArg(argsPtr, 6, argCount, 0.38));
  const Kc = Math.max(0.0, getArg(argsPtr, 7, argCount, 0.2));
  const dt = ctxDt();

  let vr = getStorf(base + 0);
  let ve = getStorf(base + 1);
  if (ctxFirstStep() || ctxTimeZero()) {
    ve = 1.2;
    vr = ve;
  } else {
    const err = vRef - vTerm;
    vr = clamp(vr + ((Ka * err - vr) * dt) / Ta, -6.0, 6.0);
    const se = 0.03 * Math.exp(0.25 * Math.abs(ve));
    const dVe = (vr - (1.0 + se) * ve - Kd * iFd) / Te;
    ve = Math.max(0.0, ve + dVe * dt);
  }
  // Rectifier loading factor Fex(In)
  const iNorm = ve > 1e-4 ? (Kc * iFd) / ve : 1.0;
  let fEx: f64;
  if (iNorm <= 0.433) fEx = 1.0 - 0.577 * iNorm;
  else if (iNorm < 0.75) fEx = Math.sqrt(Math.max(0.0, 0.75 - iNorm * iNorm));
  else fEx = Math.max(0.0, 1.732 * (1.0 - iNorm));
  const efd = ve * fEx;
  setStorf(base + 0, vr);
  setStorf(base + 1, ve);
  setStorf(base + 2, efd);
  if (argCount >= 9) setArg(argsPtr, 8, argCount, efd);
  return efd;
}

/** IEEE Std 421.5 ST1A/ST7B Static Potential-Source Exciter with terminal-voltage ceiling Vt*Vmax - Kc*Ifd. */
export function kernelIeeeExciterSt(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(2);
  const vRef = getArg(argsPtr, 0, argCount, 1.0);
  const vTerm = Math.max(0.05, getArg(argsPtr, 1, argCount, 1.0));
  const iFd = Math.max(0.0, getArg(argsPtr, 2, argCount, 1.0));
  const Ka = getArg(argsPtr, 3, argCount, 200.0);
  const Ta = Math.max(0.002, getArg(argsPtr, 4, argCount, 0.01));
  const vMax = getArg(argsPtr, 5, argCount, 5.0);
  const vMin = getArg(argsPtr, 6, argCount, -4.0);
  const Kc = Math.max(0.0, getArg(argsPtr, 7, argCount, 0.08));
  const dt = ctxDt();

  let efd = getStorf(base + 0);
  const ceilHi = vTerm * vMax - Kc * iFd;
  const ceilLo = vTerm * vMin;
  if (ctxFirstStep() || ctxTimeZero()) {
    efd = clamp(1.0, ceilLo, ceilHi);
  } else {
    const err = vRef - vTerm;
    const target = clamp(Ka * err, ceilLo, ceilHi);
    efd = clamp(efd + ((target - efd) * dt) / Ta, ceilLo, ceilHi);
  }
  setStorf(base + 0, efd);
  if (argCount >= 9) setArg(argsPtr, 8, argCount, efd);
  return efd;
}

/** IEEE HYGOV Nonlinear Hydro Turbine-Governor with water starting time Tw and temporary droop (Rt, Tr). */
export function kernelHydroGovernor(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(3);
  const pRef = getArg(argsPtr, 0, argCount, 0.8);
  const omegaPu = getArg(argsPtr, 1, argCount, 1.0);
  const rPerm = Math.max(0.01, getArg(argsPtr, 2, argCount, 0.04));
  const rTemp = Math.max(0.05, getArg(argsPtr, 3, argCount, 0.3));
  const tReset = Math.max(0.1, getArg(argsPtr, 4, argCount, 5.0));
  const tWater = Math.max(0.1, getArg(argsPtr, 5, argCount, 1.0));
  const dt = ctxDt();

  let gate = getStorf(base + 0);
  let qFlow = getStorf(base + 1);
  let wash = getStorf(base + 2);
  if (ctxFirstStep() || ctxTimeZero()) {
    gate = clamp(pRef, 0.05, 1.0);
    qFlow = gate;
    wash = 0.0;
  } else {
    const err = pRef - (omegaPu - 1.0) / rPerm - wash;
    const dGate = clamp((err - gate) / 0.2, -0.2, 0.2);
    gate = clamp(gate + dGate * dt, 0.02, 1.0);
    wash += ((rTemp * dGate - wash) * dt) / tReset;
    const hHead = (qFlow / Math.max(0.02, gate)) * (qFlow / Math.max(0.02, gate));
    qFlow = Math.max(0.0, qFlow + ((1.0 - hHead) * dt) / tWater);
  }
  const hHeadNow = (qFlow / Math.max(0.02, gate)) * (qFlow / Math.max(0.02, gate));
  const pMech = qFlow * hHeadNow;
  setStorf(base + 0, gate);
  setStorf(base + 1, qFlow);
  setStorf(base + 2, wash);
  if (argCount >= 7) setArg(argsPtr, 6, argCount, pMech);
  return pMech;
}

/** IEEE GGOV1 / GAST Gas-Turbine Governor with combustion/exhaust lag & temperature limit. */
export function kernelGasGovernor(argsPtr: usize, argCount: i32): f64 {
  const base = activeRealBase(2);
  const pRef = getArg(argsPtr, 0, argCount, 0.8);
  const omegaPu = getArg(argsPtr, 1, argCount, 1.0);
  const droop = Math.max(0.01, getArg(argsPtr, 2, argCount, 0.05));
  const tValve = Math.max(0.01, getArg(argsPtr, 3, argCount, 0.05));
  const tComb = Math.max(0.02, getArg(argsPtr, 4, argCount, 0.4));
  const tLimit = Math.max(0.5, getArg(argsPtr, 5, argCount, 1.05));
  const dt = ctxDt();

  let fuel = getStorf(base + 0);
  let pMech = getStorf(base + 1);
  if (ctxFirstStep() || ctxTimeZero()) {
    fuel = clamp(pRef, 0.0, tLimit);
    pMech = fuel;
  } else {
    const cmd = clamp(pRef - (omegaPu - 1.0) / droop, 0.0, tLimit);
    fuel += ((cmd - fuel) * dt) / tValve;
    pMech += ((fuel - pMech) * dt) / tComb;
  }
  setStorf(base + 0, fuel);
  setStorf(base + 1, pMech);
  if (argCount >= 7) setArg(argsPtr, 6, argCount, pMech);
  return pMech;
}

// ============================================================================
// 13. HOST-IMPORTED I/O, FILE PLAYBACK, PLOTTING & LIFECYCLE KERNELS
// ============================================================================

/** Host file-playback reader (FILEREAD2): opCode = 1. */
export function kernelHostFileRead(argsPtr: usize, argCount: i32): f64 {
  const fileId = getArg(argsPtr, 0, argCount, 0.0);
  const colIdx = getArg(argsPtr, 1, argCount, 0.0);
  const val = emtdc_host_io(1, fileId, colIdx, ctxTime());
  if (argCount >= 3) setArg(argsPtr, 2, argCount, val);
  return val;
}

/** Host plot/RTPS channel streamer (FPLOT19, RTPS_*, EXNEWCHCO, EXGETDCO): records live sample. */
export function kernelHostPlotChannel(argsPtr: usize, argCount: i32): f64 {
  const chId = <i32>getArg(argsPtr, 0, argCount, 0.0);
  const val = getArg(argsPtr, 1, argCount, 0.0);
  emtdc_host_plot(chId, val, ctxTime());
  return val;
}

/** Host parameter/state query (PSCAD_AGI2/AGR2, DOBLE_STATE): opCode = 2. */
export function kernelHostParamQuery(argsPtr: usize, argCount: i32): f64 {
  const keyId = getArg(argsPtr, 0, argCount, 0.0);
  const fallback = getArg(argsPtr, 1, argCount, 0.0);
  const val = emtdc_host_io(2, keyId, fallback, ctxTime());
  if (argCount >= 3) setArg(argsPtr, 2, argCount, val);
  return val;
}

/** Host lifecycle/message notification (EMTDC_MESSAGE/WARN/QUIT/PAUSE/STOPRUN): opCode = 3. */
export function kernelHostLifecycle(argsPtr: usize, argCount: i32, code: i32): f64 {
  emtdc_set_status(code);
  return emtdc_host_io(3, <f64>code, getArg(argsPtr, 0, argCount, 0.0), ctxTime());
}


