// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript block runtime for `@modelscript/simulink-std-lib`.
 *
 * Uses a zero-GC 2048-byte aligned slot ABI:
 *   - `0x080..0x57F` (1280 B): `PARAM[160]` (`f64`)
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`)
 *   - `0x780..0x7BF` (64 B):   `IN[8]`      (`f64`)
 *   - `0x7C0..0x7FF` (64 B):   `OUT[8]`     (`f64`)
 */

const OFF_PARAM: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_IN: usize = 0x780;
const OFF_OUT: usize = 0x7c0;

const ARCH_INTEGRATOR: i32 = 1;
const ARCH_DERIVATIVE: i32 = 2;
const ARCH_TRANSFER_FCN: i32 = 3;
const ARCH_STATE_SPACE: i32 = 4;
const ARCH_PID: i32 = 5;
const ARCH_UNIT_DELAY: i32 = 10;
const ARCH_DISCRETE_INTEGRATOR: i32 = 11;
const ARCH_DISCRETE_FILTER: i32 = 12;
const ARCH_GAIN: i32 = 20;
const ARCH_SUM: i32 = 21;
const ARCH_PRODUCT: i32 = 22;
const ARCH_MATH_UNARY: i32 = 23;
const ARCH_MIN_MAX: i32 = 24;
const ARCH_SATURATE: i32 = 30;
const ARCH_DEAD_ZONE: i32 = 31;
const ARCH_RATE_LIMITER: i32 = 32;
const ARCH_RELAY: i32 = 33;
const ARCH_QUANTIZER: i32 = 34;
const ARCH_RELATIONAL_OP: i32 = 40;
const ARCH_LOGICAL_OP: i32 = 41;
const ARCH_SWITCH: i32 = 50;
const ARCH_PASSTHROUGH: i32 = 51;
const ARCH_LOOKUP_1D: i32 = 60;
const ARCH_SRC_CONSTANT: i32 = 70;
const ARCH_SRC_STEP: i32 = 71;
const ARCH_SRC_SINE: i32 = 72;
const ARCH_SRC_RAMP: i32 = 73;
const ARCH_SRC_CLOCK: i32 = 74;
const ARCH_SRC_PULSE: i32 = 75;

@inline
function clamp(x: f64, lo: f64, hi: f64): f64 {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

@inline
function getP(slotPtr: usize, count: i32, idx: i32, fallback: f64): f64 {
  if (idx >= count) return fallback;
  const v = load<f64>(slotPtr + OFF_PARAM + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getS(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_STATE + (<usize>idx << 3));
}

@inline
function setS(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), v);
}

@inline
function getIn(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IN + (<usize>idx << 3));
}

@inline
function setOut(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_OUT + (<usize>idx << 3), v);
}

export function simGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

export function simBlockInit(archetypeId: i32, slotPtr: usize, paramCount: i32): i32 {
  if (archetypeId == ARCH_INTEGRATOR || archetypeId == ARCH_UNIT_DELAY) {
    const x0 = getP(slotPtr, paramCount, 0, 0.0);
    setS(slotPtr, 0, x0);
    setOut(slotPtr, 0, x0);
    return 1;
  }
  if (archetypeId == ARCH_DISCRETE_INTEGRATOR) {
    const x0 = getP(slotPtr, paramCount, 1, 0.0);
    setS(slotPtr, 0, x0);
    setOut(slotPtr, 0, x0);
    return 1;
  }
  if (archetypeId == ARCH_STATE_SPACE) {
    const x0 = getP(slotPtr, paramCount, 4, 0.0);
    setS(slotPtr, 0, x0);
    setOut(slotPtr, 0, getP(slotPtr, paramCount, 2, 1.0) * x0);
    return 1;
  }
  if (archetypeId == ARCH_PID || archetypeId == ARCH_TRANSFER_FCN || archetypeId == ARCH_DISCRETE_FILTER) {
    setS(slotPtr, 0, 0.0);
    setS(slotPtr, 1, 0.0);
    setOut(slotPtr, 0, 0.0);
    return 2;
  }
  if (archetypeId == ARCH_DERIVATIVE || archetypeId == ARCH_RATE_LIMITER || archetypeId == ARCH_RELAY) {
    setS(slotPtr, 0, 0.0);
    setS(slotPtr, 1, 0.0);
    setOut(slotPtr, 0, 0.0);
    return 1;
  }
  return 0;
}

export function simBlockStep(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  paramCount: i32,
): void {
  const u0 = getIn(slotPtr, 0);
  const u1 = getIn(slotPtr, 1);
  const u2 = getIn(slotPtr, 2);

  if (archetypeId == ARCH_INTEGRATOR) {
    const hi = getP(slotPtr, paramCount, 1, 1e30);
    const lo = getP(slotPtr, paramCount, 2, -1e30);
    const xNext = clamp(getS(slotPtr, 0) + dt * u0, lo, hi);
    setS(slotPtr, 0, xNext);
    setOut(slotPtr, 0, xNext);
    return;
  }

  if (archetypeId == ARCH_DERIVATIVE) {
    const prev = getS(slotPtr, 0);
    const initialized = getS(slotPtr, 1);
    const y = initialized > 0.5 && dt > 1e-12 ? (u0 - prev) / dt : 0.0;
    setS(slotPtr, 0, u0);
    setS(slotPtr, 1, 1.0);
    setOut(slotPtr, 0, y);
    return;
  }

  if (archetypeId == ARCH_TRANSFER_FCN) {
    // H(s) = (b0*s + b1) / (a0*s + a1)
    const b0 = getP(slotPtr, paramCount, 0, 0.0);
    const b1 = getP(slotPtr, paramCount, 1, 1.0);
    const a0 = Math.max(1e-9, getP(slotPtr, paramCount, 2, 1.0));
    const a1 = getP(slotPtr, paramCount, 3, 1.0);
    const d = b0 / a0;
    const c = (b1 - a1 * d) / a0;
    const a = -a1 / a0;
    const x = getS(slotPtr, 0);
    // 2nd-order Heun integration
    const k1 = a * x + u0;
    const xp = x + dt * k1;
    const k2 = a * xp + u0;
    const xNext = x + 0.5 * dt * (k1 + k2);
    setS(slotPtr, 0, xNext);
    setOut(slotPtr, 0, c * xNext + d * u0);
    return;
  }

  if (archetypeId == ARCH_STATE_SPACE) {
    const a = getP(slotPtr, paramCount, 0, -1.0);
    const b = getP(slotPtr, paramCount, 1, 1.0);
    const c = getP(slotPtr, paramCount, 2, 1.0);
    const d = getP(slotPtr, paramCount, 3, 0.0);
    const x = getS(slotPtr, 0);
    const k1 = a * x + b * u0;
    const k2 = a * (x + dt * k1) + b * u0;
    const xNext = x + 0.5 * dt * (k1 + k2);
    setS(slotPtr, 0, xNext);
    setOut(slotPtr, 0, c * xNext + d * u0);
    return;
  }

  if (archetypeId == ARCH_PID) {
    const kp = getP(slotPtr, paramCount, 0, 1.0);
    const ki = getP(slotPtr, paramCount, 1, 1.0);
    const kd = getP(slotPtr, paramCount, 2, 0.0);
    const n = Math.max(1e-3, getP(slotPtr, paramCount, 3, 100.0));
    const hi = getP(slotPtr, paramCount, 4, 1e30);
    const lo = getP(slotPtr, paramCount, 5, -1e30);
    let xI = getS(slotPtr, 0);
    let xD = getS(slotPtr, 1);
    const dTerm = (kd * u0 - xD) * n;
    xD = xD + dt * dTerm;
    const unsat = kp * u0 + xI + dTerm;
    const sat = clamp(unsat, lo, hi);
    // Conditional integration anti-windup
    if (unsat == sat || (unsat > hi && u0 < 0.0) || (unsat < lo && u0 > 0.0)) {
      xI = xI + dt * ki * u0;
    }
    setS(slotPtr, 0, xI);
    setS(slotPtr, 1, xD);
    setOut(slotPtr, 0, clamp(kp * u0 + xI + dTerm, lo, hi));
    return;
  }

  if (archetypeId == ARCH_UNIT_DELAY) {
    const y = getS(slotPtr, 0);
    setS(slotPtr, 0, u0);
    setOut(slotPtr, 0, y);
    return;
  }

  if (archetypeId == ARCH_DISCRETE_INTEGRATOR) {
    const k = getP(slotPtr, paramCount, 0, 1.0);
    const hi = getP(slotPtr, paramCount, 2, 1e30);
    const lo = getP(slotPtr, paramCount, 3, -1e30);
    const y = getS(slotPtr, 0);
    setS(slotPtr, 0, clamp(y + k * dt * u0, lo, hi));
    setOut(slotPtr, 0, y);
    return;
  }

  if (archetypeId == ARCH_DISCRETE_FILTER) {
    const b0 = getP(slotPtr, paramCount, 0, 0.5);
    const b1 = getP(slotPtr, paramCount, 1, 0.0);
    const a1 = getP(slotPtr, paramCount, 2, -0.5);
    const xPrev = getS(slotPtr, 0);
    const yPrev = getS(slotPtr, 1);
    const y = b0 * u0 + b1 * xPrev - a1 * yPrev;
    setS(slotPtr, 0, u0);
    setS(slotPtr, 1, y);
    setOut(slotPtr, 0, y);
    return;
  }

  if (archetypeId == ARCH_GAIN) {
    setOut(slotPtr, 0, getP(slotPtr, paramCount, 0, 1.0) * u0 + getP(slotPtr, paramCount, 1, 0.0));
    return;
  }

  if (archetypeId == ARCH_SUM) {
    setOut(slotPtr, 0, getP(slotPtr, paramCount, 0, 1.0) * u0 + getP(slotPtr, paramCount, 1, 1.0) * u1);
    return;
  }

  if (archetypeId == ARCH_PRODUCT) {
    const mode = getP(slotPtr, paramCount, 0, 0.0);
    setOut(slotPtr, 0, mode > 0.5 ? (Math.abs(u1) > 1e-12 ? u0 / u1 : 0.0) : u0 * u1);
    return;
  }

  if (archetypeId == ARCH_MATH_UNARY) {
    const op = <i32>Math.round(getP(slotPtr, paramCount, 0, 0.0));
    let y: f64 = u0;
    if (op == 0) y = Math.abs(u0);
    else if (op == 1) y = Math.sqrt(Math.max(0.0, u0));
    else if (op == 2) y = u0 > 0.0 ? 1.0 : u0 < 0.0 ? -1.0 : 0.0;
    else if (op == 3) y = Math.sin(u0);
    else if (op == 4) y = Math.cos(u0);
    else if (op == 5) y = Math.exp(u0);
    else if (op == 6) y = Math.log(Math.max(1e-12, u0));
    else if (op == 7) y = u0 * u0;
    setOut(slotPtr, 0, y);
    return;
  }

  if (archetypeId == ARCH_MIN_MAX) {
    const mode = getP(slotPtr, paramCount, 0, 0.0);
    setOut(slotPtr, 0, mode > 0.5 ? Math.max(u0, u1) : Math.min(u0, u1));
    return;
  }

  if (archetypeId == ARCH_SATURATE) {
    setOut(slotPtr, 0, clamp(u0, getP(slotPtr, paramCount, 1, -0.5), getP(slotPtr, paramCount, 0, 0.5)));
    return;
  }

  if (archetypeId == ARCH_DEAD_ZONE) {
    const lo = getP(slotPtr, paramCount, 0, -0.5);
    const hi = getP(slotPtr, paramCount, 1, 0.5);
    setOut(slotPtr, 0, u0 > hi ? u0 - hi : u0 < lo ? u0 - lo : 0.0);
    return;
  }

  if (archetypeId == ARCH_RATE_LIMITER) {
    const rMax = getP(slotPtr, paramCount, 0, 1.0);
    const fMin = getP(slotPtr, paramCount, 1, -1.0);
    const yPrev = getS(slotPtr, 0);
    const y = clamp(u0, yPrev + fMin * dt, yPrev + rMax * dt);
    setS(slotPtr, 0, y);
    setOut(slotPtr, 0, y);
    return;
  }

  if (archetypeId == ARCH_RELAY) {
    const onSw = getP(slotPtr, paramCount, 0, 0.5);
    const offSw = getP(slotPtr, paramCount, 1, -0.5);
    const onOut = getP(slotPtr, paramCount, 2, 1.0);
    const offOut = getP(slotPtr, paramCount, 3, 0.0);
    let isOn = getS(slotPtr, 0) > 0.5;
    if (u0 >= onSw) isOn = true;
    else if (u0 <= offSw) isOn = false;
    setS(slotPtr, 0, isOn ? 1.0 : 0.0);
    setOut(slotPtr, 0, isOn ? onOut : offOut);
    return;
  }

  if (archetypeId == ARCH_QUANTIZER) {
    const q = Math.max(1e-12, getP(slotPtr, paramCount, 0, 0.5));
    setOut(slotPtr, 0, q * Math.round(u0 / q));
    return;
  }

  if (archetypeId == ARCH_RELATIONAL_OP) {
    const op = <i32>Math.round(getP(slotPtr, paramCount, 0, 4.0));
    let res = false;
    if (op == 0) res = u0 == u1;
    else if (op == 1) res = u0 != u1;
    else if (op == 2) res = u0 < u1;
    else if (op == 3) res = u0 <= u1;
    else if (op == 4) res = u0 >= u1;
    else res = u0 > u1;
    setOut(slotPtr, 0, res ? 1.0 : 0.0);
    return;
  }

  if (archetypeId == ARCH_LOGICAL_OP) {
    const op = <i32>Math.round(getP(slotPtr, paramCount, 0, 0.0));
    const a = u0 != 0.0;
    const b = u1 != 0.0;
    let res = false;
    if (op == 0) res = a && b;
    else if (op == 1) res = a || b;
    else if (op == 2) res = a != b;
    else res = !a;
    setOut(slotPtr, 0, res ? 1.0 : 0.0);
    return;
  }

  if (archetypeId == ARCH_SWITCH) {
    const thr = getP(slotPtr, paramCount, 0, 0.0);
    setOut(slotPtr, 0, u1 >= thr ? u0 : u2);
    return;
  }

  if (archetypeId == ARCH_LOOKUP_1D) {
    // 3-point piecewise linear lookup (x0,x1,x2) -> (y0,y1,y2)
    const x0 = getP(slotPtr, paramCount, 0, 0.0);
    const x1 = getP(slotPtr, paramCount, 1, 1.0);
    const x2 = getP(slotPtr, paramCount, 2, 2.0);
    const y0 = getP(slotPtr, paramCount, 3, 0.0);
    const y1 = getP(slotPtr, paramCount, 4, 1.0);
    const y2 = getP(slotPtr, paramCount, 5, 4.0);
    let y: f64;
    if (u0 <= x0) y = y0;
    else if (u0 >= x2) y = y2;
    else if (u0 <= x1) y = y0 + ((u0 - x0) / Math.max(1e-12, x1 - x0)) * (y1 - y0);
    else y = y1 + ((u0 - x1) / Math.max(1e-12, x2 - x1)) * (y2 - y1);
    setOut(slotPtr, 0, y);
    return;
  }

  if (archetypeId == ARCH_SRC_CONSTANT) {
    setOut(slotPtr, 0, getP(slotPtr, paramCount, 0, 1.0));
    return;
  }

  if (archetypeId == ARCH_SRC_STEP) {
    const tStep = getP(slotPtr, paramCount, 0, 1.0);
    setOut(slotPtr, 0, t >= tStep ? getP(slotPtr, paramCount, 2, 1.0) : getP(slotPtr, paramCount, 1, 0.0));
    return;
  }

  if (archetypeId == ARCH_SRC_SINE) {
    const amp = getP(slotPtr, paramCount, 0, 1.0);
    const bias = getP(slotPtr, paramCount, 1, 0.0);
    const freq = getP(slotPtr, paramCount, 2, 1.0);
    const phase = getP(slotPtr, paramCount, 3, 0.0);
    setOut(slotPtr, 0, amp * Math.sin(freq * t + phase) + bias);
    return;
  }

  if (archetypeId == ARCH_SRC_RAMP) {
    const slope = getP(slotPtr, paramCount, 0, 1.0);
    const t0 = getP(slotPtr, paramCount, 1, 0.0);
    const x0 = getP(slotPtr, paramCount, 2, 0.0);
    setOut(slotPtr, 0, t >= t0 ? x0 + slope * (t - t0) : x0);
    return;
  }

  if (archetypeId == ARCH_SRC_CLOCK) {
    setOut(slotPtr, 0, t);
    return;
  }

  if (archetypeId == ARCH_SRC_PULSE) {
    const amp = getP(slotPtr, paramCount, 0, 1.0);
    const period = Math.max(1e-9, getP(slotPtr, paramCount, 1, 1.0));
    const duty = clamp(getP(slotPtr, paramCount, 2, 50.0) / 100.0, 0.0, 1.0);
    const delay = getP(slotPtr, paramCount, 3, 0.0);
    if (t < delay) {
      setOut(slotPtr, 0, 0.0);
    } else {
      const rem = (t - delay) % period;
      setOut(slotPtr, 0, rem < duty * period ? amp : 0.0);
    }
    return;
  }

  // ARCH_PASSTHROUGH
  setOut(slotPtr, 0, u0);
}
