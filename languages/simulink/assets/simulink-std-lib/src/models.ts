// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript block runtime for `@modelscript/simulink-std-lib`.
 *
 * Uses a zero-GC 2048-byte aligned slot ABI (plus optional 64 KiB ring buffer at `0x800`
 * for `TransportDelay`):
 *   - `0x080..0x57F` (1280 B): `PARAM[160]` (`f64`)
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`)
 *   - `0x780..0x7BF` (64 B):   `IN[8]`      (`f64`)
 *   - `0x7C0..0x7FF` (64 B):   `OUT[8]`     (`f64`)
 *   - `0x800..0x107FF` (64 KB): `RING[4096]` (`(t: f64, u: f64)` pairs for TransportDelay)
 */

const OFF_PARAM: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_IN: usize = 0x780;
const OFF_OUT: usize = 0x7c0;
const OFF_RING: usize = 0x800;
const RING_CAP: i32 = 4096;
const RING_MASK: i32 = 4095;

const ARCH_INTEGRATOR: i32 = 1;
const ARCH_DERIVATIVE: i32 = 2;
const ARCH_TRANSFER_FCN: i32 = 3;
const ARCH_STATE_SPACE: i32 = 4;
const ARCH_PID: i32 = 5;
const ARCH_SECOND_ORDER_INTEGRATOR: i32 = 6;
const ARCH_UNIT_DELAY: i32 = 10;
const ARCH_DISCRETE_INTEGRATOR: i32 = 11;
const ARCH_DISCRETE_FILTER: i32 = 12;
const ARCH_TRANSPORT_DELAY: i32 = 13;
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
const ARCH_BACKLASH: i32 = 35;
const ARCH_COULOMB_FRICTION: i32 = 36;
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
const ARCH_STATEFLOW_CHART: i32 = 80;

@inline
function clamp(x: f64, lo: f64, hi: f64): f64 {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

@inline
function getP(slotPtr: usize, count: i32, idx: i32, fallback: f64): f64 {
  if (idx >= count || idx < 0) return fallback;
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

@inline
function getRingT(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_RING + (<usize>idx << 4));
}

@inline
function getRingU(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_RING + (<usize>idx << 4) + 8);
}

@inline
function setRing(slotPtr: usize, idx: i32, t: f64, u: f64): void {
  const ptr = slotPtr + OFF_RING + (<usize>idx << 4);
  store<f64>(ptr, t);
  store<f64>(ptr + 8, u);
}

@inline
function evalRelOp(op: i32, a: f64, b: f64): bool {
  if (op == 0) return a == b;
  if (op == 1) return a != b;
  if (op == 2) return a < b;
  if (op == 3) return a <= b;
  if (op == 4) return a >= b;
  return a > b;
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
  if (archetypeId == ARCH_SECOND_ORDER_INTEGRATOR) {
    const x0 = getP(slotPtr, paramCount, 0, 0.0);
    const v0 = getP(slotPtr, paramCount, 3, 0.0);
    setS(slotPtr, 0, x0);
    setS(slotPtr, 1, v0);
    setOut(slotPtr, 0, x0);
    setOut(slotPtr, 1, v0);
    return 2;
  }
  if (archetypeId == ARCH_DISCRETE_INTEGRATOR) {
    const x0 = getP(slotPtr, paramCount, 1, 0.0);
    setS(slotPtr, 0, x0);
    setOut(slotPtr, 0, x0);
    return 1;
  }
  if (archetypeId == ARCH_TRANSPORT_DELAY) {
    const y0 = getP(slotPtr, paramCount, 0, 0.0);
    setS(slotPtr, 0, 0.0); // head
    setS(slotPtr, 1, 0.0); // count
    setS(slotPtr, 2, y0);
    setOut(slotPtr, 0, y0);
    return 3;
  }
  if (archetypeId == ARCH_STATE_SPACE) {
    if (paramCount <= 5) {
      const x0 = getP(slotPtr, paramCount, 4, 0.0);
      setS(slotPtr, 0, x0);
      setOut(slotPtr, 0, getP(slotPtr, paramCount, 2, 1.0) * x0);
      return 1;
    }
    const n = <i32>clamp(Math.round(getP(slotPtr, paramCount, 0, 1.0)), 1.0, 6.0);
    const m = <i32>clamp(Math.round(getP(slotPtr, paramCount, 1, 1.0)), 1.0, 6.0);
    const p = <i32>clamp(Math.round(getP(slotPtr, paramCount, 2, 1.0)), 1.0, 6.0);
    const offA = 3;
    const offB = offA + n * n;
    const offC = offB + n * m;
    const offD = offC + p * n;
    const offX0 = offD + p * m;
    for (let i: i32 = 0; i < n; i++) {
      setS(slotPtr, i, getP(slotPtr, paramCount, offX0 + i, 0.0));
    }
    for (let i: i32 = 0; i < p; i++) {
      let y: f64 = 0.0;
      for (let j: i32 = 0; j < n; j++) {
        y += getP(slotPtr, paramCount, offC + i * n + j, 0.0) * getS(slotPtr, j);
      }
      setOut(slotPtr, i, y);
    }
    return n;
  }
  if (archetypeId == ARCH_TRANSFER_FCN) {
    const order =
      paramCount <= 4
        ? 1
        : <i32>clamp(Math.round(getP(slotPtr, paramCount, 0, 1.0)), 1.0, 8.0);
    for (let i: i32 = 0; i < order; i++) {
      setS(slotPtr, i, 0.0);
    }
    setOut(slotPtr, 0, 0.0);
    return order;
  }
  if (archetypeId == ARCH_PID || archetypeId == ARCH_DISCRETE_FILTER) {
    setS(slotPtr, 0, 0.0);
    setS(slotPtr, 1, 0.0);
    setOut(slotPtr, 0, 0.0);
    return 2;
  }
  if (archetypeId == ARCH_BACKLASH) {
    const y0 = getP(slotPtr, paramCount, 2, 0.0);
    setS(slotPtr, 0, y0);
    setOut(slotPtr, 0, y0);
    return 1;
  }
  if (archetypeId == ARCH_STATEFLOW_CHART) {
    const initState = Math.round(getP(slotPtr, paramCount, 0, 0.0));
    setS(slotPtr, 0, initState); // active state ID
    setS(slotPtr, 1, 0.0); // elapsed time in state
    setS(slotPtr, 2, initState); // active output value
    setOut(slotPtr, 0, initState);
    setOut(slotPtr, 1, initState);
    return 3;
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

  if (archetypeId == ARCH_SECOND_ORDER_INTEGRATOR) {
    const xHi = getP(slotPtr, paramCount, 1, 1e30);
    const xLo = getP(slotPtr, paramCount, 2, -1e30);
    const vHi = getP(slotPtr, paramCount, 4, 1e30);
    const vLo = getP(slotPtr, paramCount, 5, -1e30);
    const x = getS(slotPtr, 0);
    const v = getS(slotPtr, 1);
    let vNext = clamp(v + dt * u0, vLo, vHi);
    let xNext = x + 0.5 * dt * (v + vNext);
    if (xNext >= xHi) {
      xNext = xHi;
      if (vNext > 0.0) vNext = 0.0;
    } else if (xNext <= xLo) {
      xNext = xLo;
      if (vNext < 0.0) vNext = 0.0;
    }
    setS(slotPtr, 0, xNext);
    setS(slotPtr, 1, vNext);
    setOut(slotPtr, 0, xNext);
    setOut(slotPtr, 1, vNext);
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
    if (paramCount <= 4) {
      // Legacy 1st-order H(s) = (b0*s + b1) / (a0*s + a1)
      const b0 = getP(slotPtr, paramCount, 0, 0.0);
      const b1 = getP(slotPtr, paramCount, 1, 1.0);
      const a0 = Math.max(1e-9, getP(slotPtr, paramCount, 2, 1.0));
      const a1 = getP(slotPtr, paramCount, 3, 1.0);
      const d = b0 / a0;
      const c = (b1 - a1 * d) / a0;
      const a = -a1 / a0;
      const x = getS(slotPtr, 0);
      const k1 = a * x + u0;
      const xp = x + dt * k1;
      const k2 = a * xp + u0;
      const xNext = x + 0.5 * dt * (k1 + k2);
      setS(slotPtr, 0, xNext);
      setOut(slotPtr, 0, c * xNext + d * u0);
      return;
    }

    // General N-th order (1 <= n <= 8) controllable canonical form integrated with Heun RK2:
    // PARAM[0] = n, PARAM[1..1+n] = b[0..n], PARAM[2+n..2+2n] = a[0..n]
    const n = <i32>clamp(Math.round(getP(slotPtr, paramCount, 0, 1.0)), 1.0, 8.0);
    const offB = 1;
    const offA = 2 + n;
    const a0Raw = getP(slotPtr, paramCount, offA, 1.0);
    const a0 = Math.abs(a0Raw) > 1e-12 ? a0Raw : 1.0;
    const d = getP(slotPtr, paramCount, offB, 0.0) / a0;

    // k1 = f(x, u0) stored in STATE[8..15], xp = x + dt*k1 stored in STATE[16..23]
    let k1Last: f64 = u0;
    for (let i: i32 = 0; i < n; i++) {
      const aNorm = getP(slotPtr, paramCount, offA + (n - i), 0.0) / a0;
      k1Last -= aNorm * getS(slotPtr, i);
    }
    for (let i: i32 = 0; i < n - 1; i++) {
      const k1i = getS(slotPtr, i + 1);
      setS(slotPtr, 8 + i, k1i);
      setS(slotPtr, 16 + i, getS(slotPtr, i) + dt * k1i);
    }
    setS(slotPtr, 8 + (n - 1), k1Last);
    setS(slotPtr, 16 + (n - 1), getS(slotPtr, n - 1) + dt * k1Last);

    // k2 = f(xp, u0)
    let k2Last: f64 = u0;
    for (let i: i32 = 0; i < n; i++) {
      const aNorm = getP(slotPtr, paramCount, offA + (n - i), 0.0) / a0;
      k2Last -= aNorm * getS(slotPtr, 16 + i);
    }

    // Heun update & output y = d*u0 + sum_i (b_{n-i}/a0 - d*a_{n-i}/a0) * x_i
    let y: f64 = d * u0;
    for (let i: i32 = 0; i < n; i++) {
      const k1i = getS(slotPtr, 8 + i);
      const k2i = i < n - 1 ? getS(slotPtr, 16 + i + 1) : k2Last;
      const xNext = getS(slotPtr, i) + 0.5 * dt * (k1i + k2i);
      setS(slotPtr, i, xNext);
      const bNorm = getP(slotPtr, paramCount, offB + (n - i), 0.0) / a0;
      const aNorm = getP(slotPtr, paramCount, offA + (n - i), 0.0) / a0;
      y += (bNorm - d * aNorm) * xNext;
    }
    setOut(slotPtr, 0, y);
    return;
  }

  if (archetypeId == ARCH_STATE_SPACE) {
    if (paramCount <= 5) {
      // Legacy scalar 1x1 StateSpace [A, B, C, D, X0]
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

    // General n x n StateSpace (1 <= n <= 6, 1 <= m <= 6, 1 <= p <= 6) with Heun RK2
    const n = <i32>clamp(Math.round(getP(slotPtr, paramCount, 0, 1.0)), 1.0, 6.0);
    const m = <i32>clamp(Math.round(getP(slotPtr, paramCount, 1, 1.0)), 1.0, 6.0);
    const p = <i32>clamp(Math.round(getP(slotPtr, paramCount, 2, 1.0)), 1.0, 6.0);
    const offA = 3;
    const offB = offA + n * n;
    const offC = offB + n * m;
    const offD = offC + p * n;

    // k1 = A*x + B*u -> STATE[8..13], xp = x + dt*k1 -> STATE[16..21]
    for (let i: i32 = 0; i < n; i++) {
      let acc: f64 = 0.0;
      for (let j: i32 = 0; j < n; j++) {
        acc += getP(slotPtr, paramCount, offA + i * n + j, 0.0) * getS(slotPtr, j);
      }
      for (let k: i32 = 0; k < m; k++) {
        acc += getP(slotPtr, paramCount, offB + i * m + k, 0.0) * getIn(slotPtr, k);
      }
      setS(slotPtr, 8 + i, acc);
      setS(slotPtr, 16 + i, getS(slotPtr, i) + dt * acc);
    }

    // k2 = A*xp + B*u, update x = x + 0.5*dt*(k1 + k2)
    for (let i: i32 = 0; i < n; i++) {
      let k2i: f64 = 0.0;
      for (let j: i32 = 0; j < n; j++) {
        k2i += getP(slotPtr, paramCount, offA + i * n + j, 0.0) * getS(slotPtr, 16 + j);
      }
      for (let k: i32 = 0; k < m; k++) {
        k2i += getP(slotPtr, paramCount, offB + i * m + k, 0.0) * getIn(slotPtr, k);
      }
      const xNext = getS(slotPtr, i) + 0.5 * dt * (getS(slotPtr, 8 + i) + k2i);
      setS(slotPtr, i, xNext);
    }

    // y = C*x + D*u
    for (let i: i32 = 0; i < p; i++) {
      let yi: f64 = 0.0;
      for (let j: i32 = 0; j < n; j++) {
        yi += getP(slotPtr, paramCount, offC + i * n + j, 0.0) * getS(slotPtr, j);
      }
      for (let k: i32 = 0; k < m; k++) {
        yi += getP(slotPtr, paramCount, offD + i * m + k, 0.0) * getIn(slotPtr, k);
      }
      setOut(slotPtr, i, yi);
    }
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

  if (archetypeId == ARCH_TRANSPORT_DELAY) {
    const y0 = getP(slotPtr, paramCount, 0, 0.0);
    const isVariable = getP(slotPtr, paramCount, 2, 0.0) > 0.5;
    const maxOrFixedTau = Math.max(0.0, getP(slotPtr, paramCount, 1, 1.0));
    const tau = isVariable ? clamp(u1, 0.0, maxOrFixedTau) : maxOrFixedTau;

    let head = <i32>getS(slotPtr, 0);
    let count = <i32>getS(slotPtr, 1);

    setRing(slotPtr, head, t, u0);
    head = (head + 1) & RING_MASK;
    if (count < RING_CAP) count += 1;
    setS(slotPtr, 0, <f64>head);
    setS(slotPtr, 1, <f64>count);

    if (tau <= 1e-12) {
      setOut(slotPtr, 0, u0);
      return;
    }

    const tQuery = t - tau;
    const oldest = (head - count + RING_CAP) & RING_MASK;
    const tOldest = getRingT(slotPtr, oldest);
    if (count <= 0 || tQuery < tOldest - 1e-12) {
      setOut(slotPtr, 0, y0);
      return;
    }
    if (count == 1 || tQuery <= tOldest) {
      setOut(slotPtr, 0, getRingU(slotPtr, oldest));
      return;
    }

    const newest = (head - 1 + RING_CAP) & RING_MASK;
    if (tQuery >= getRingT(slotPtr, newest)) {
      setOut(slotPtr, 0, getRingU(slotPtr, newest));
      return;
    }

    // Binary search over logical indices [0, count - 1]
    let lo: i32 = 0;
    let hi: i32 = count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      const physMid = (oldest + mid) & RING_MASK;
      if (getRingT(slotPtr, physMid) <= tQuery) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const physLo = (oldest + lo) & RING_MASK;
    const physHi = (oldest + hi) & RING_MASK;
    const tLo = getRingT(slotPtr, physLo);
    const tHi = getRingT(slotPtr, physHi);
    const uLo = getRingU(slotPtr, physLo);
    const uHi = getRingU(slotPtr, physHi);
    const span = tHi - tLo;
    const alpha = span > 1e-15 ? clamp((tQuery - tLo) / span, 0.0, 1.0) : 0.0;
    setOut(slotPtr, 0, uLo + alpha * (uHi - uLo));
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

  if (archetypeId == ARCH_BACKLASH) {
    // True deadband play hysteresis: deadband around yPrev is [yPrev + lo, yPrev + hi]
    const lo = getP(slotPtr, paramCount, 0, -0.5);
    const hi = getP(slotPtr, paramCount, 1, 0.5);
    const yPrev = getS(slotPtr, 0);
    let y = yPrev;
    if (u0 > yPrev + hi) {
      y = u0 - hi;
    } else if (u0 < yPrev + lo) {
      y = u0 - lo;
    }
    setS(slotPtr, 0, y);
    setOut(slotPtr, 0, y);
    return;
  }

  if (archetypeId == ARCH_COULOMB_FRICTION) {
    // Coulomb offset + viscous slope: y = gain*u + sign(u)*offset (0 at u == 0)
    const offsetNeg = Math.abs(getP(slotPtr, paramCount, 0, -0.1));
    const offsetPos = Math.abs(getP(slotPtr, paramCount, 1, 0.1));
    const gain = getP(slotPtr, paramCount, 2, 1.0);
    let y: f64 = 0.0;
    if (u0 > 0.0) {
      y = gain * u0 + offsetPos;
    } else if (u0 < 0.0) {
      y = gain * u0 - offsetNeg;
    }
    setOut(slotPtr, 0, y);
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
    setOut(slotPtr, 0, evalRelOp(op, u0, u1) ? 1.0 : 0.0);
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
    if (paramCount <= 6) {
      // Legacy 3-point piecewise linear lookup (x0,x1,x2) -> (y0,y1,y2)
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

    const mode = <i32>Math.round(getP(slotPtr, paramCount, 0, 1.0));
    const nx = <i32>clamp(Math.round(getP(slotPtr, paramCount, 1, 2.0)), 2.0, 32.0);
    const offX = 3;

    if (mode == 1) {
      // General N-point 1D binary-search piecewise linear lookup (up to 32 breakpoints)
      const offY = offX + nx;
      const xFirst = getP(slotPtr, paramCount, offX, 0.0);
      const xLast = getP(slotPtr, paramCount, offX + nx - 1, 1.0);
      if (u0 <= xFirst) {
        setOut(slotPtr, 0, getP(slotPtr, paramCount, offY, 0.0));
        return;
      }
      if (u0 >= xLast) {
        setOut(slotPtr, 0, getP(slotPtr, paramCount, offY + nx - 1, 0.0));
        return;
      }
      let lo: i32 = 0;
      let hi: i32 = nx - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (getP(slotPtr, paramCount, offX + mid, 0.0) <= u0) lo = mid;
        else hi = mid;
      }
      const xLo = getP(slotPtr, paramCount, offX + lo, 0.0);
      const xHi = getP(slotPtr, paramCount, offX + lo + 1, 0.0);
      const yLo = getP(slotPtr, paramCount, offY + lo, 0.0);
      const yHi = getP(slotPtr, paramCount, offY + lo + 1, 0.0);
      const frac = (u0 - xLo) / Math.max(1e-12, xHi - xLo);
      setOut(slotPtr, 0, yLo + frac * (yHi - yLo));
      return;
    }

    // 2D bilinear grid lookup: mode == 2, nx breakpoints along u0, ny along u1
    const ny = <i32>clamp(Math.round(getP(slotPtr, paramCount, 2, 2.0)), 2.0, 32.0);
    const offY = offX + nx;
    const offZ = offY + ny;

    // Locate ix, tx for u0
    let ix: i32 = 0;
    let tx: f64 = 0.0;
    const xFirst = getP(slotPtr, paramCount, offX, 0.0);
    const xLast = getP(slotPtr, paramCount, offX + nx - 1, 1.0);
    if (u0 <= xFirst) {
      ix = 0;
      tx = 0.0;
    } else if (u0 >= xLast) {
      ix = nx - 2;
      tx = 1.0;
    } else {
      let lo: i32 = 0;
      let hi: i32 = nx - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (getP(slotPtr, paramCount, offX + mid, 0.0) <= u0) lo = mid;
        else hi = mid;
      }
      ix = lo;
      const xLo = getP(slotPtr, paramCount, offX + ix, 0.0);
      const xHi = getP(slotPtr, paramCount, offX + ix + 1, 0.0);
      tx = clamp((u0 - xLo) / Math.max(1e-12, xHi - xLo), 0.0, 1.0);
    }

    // Locate iy, ty for u1
    let iy: i32 = 0;
    let ty: f64 = 0.0;
    const yFirst = getP(slotPtr, paramCount, offY, 0.0);
    const yLast = getP(slotPtr, paramCount, offY + ny - 1, 1.0);
    if (u1 <= yFirst) {
      iy = 0;
      ty = 0.0;
    } else if (u1 >= yLast) {
      iy = ny - 2;
      ty = 1.0;
    } else {
      let lo: i32 = 0;
      let hi: i32 = ny - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (getP(slotPtr, paramCount, offY + mid, 0.0) <= u1) lo = mid;
        else hi = mid;
      }
      iy = lo;
      const yLo = getP(slotPtr, paramCount, offY + iy, 0.0);
      const yHi = getP(slotPtr, paramCount, offY + iy + 1, 0.0);
      ty = clamp((u1 - yLo) / Math.max(1e-12, yHi - yLo), 0.0, 1.0);
    }

    const z00 = getP(slotPtr, paramCount, offZ + ix * ny + iy, 0.0);
    const z01 = getP(slotPtr, paramCount, offZ + ix * ny + (iy + 1), 0.0);
    const z10 = getP(slotPtr, paramCount, offZ + (ix + 1) * ny + iy, 0.0);
    const z11 = getP(slotPtr, paramCount, offZ + (ix + 1) * ny + (iy + 1), 0.0);
    const z0 = z00 + ty * (z01 - z00);
    const z1 = z10 + ty * (z11 - z10);
    setOut(slotPtr, 0, z0 + tx * (z1 - z0));
    return;
  }

  if (archetypeId == ARCH_STATEFLOW_CHART) {
    // Cleanroom Stateflow FSM transition evaluator:
    // PARAM[0] = initialState, PARAM[1] = numTransitions
    // Each transition k (6 params at 2 + k*6):
    //   [fromState (-1=any), toState, guardInputIdx (-1=always, -2=after(thr,s), 0..7=u[idx]), guardOp, guardThr, actionOut]
    let curState = <i32>Math.round(getS(slotPtr, 0));
    let timeInState = getS(slotPtr, 1) + dt;
    let curOut = getS(slotPtr, 2);
    const numTrans = <i32>clamp(Math.round(getP(slotPtr, paramCount, 1, 0.0)), 0.0, 24.0);

    for (let k: i32 = 0; k < numTrans; k++) {
      const base = 2 + k * 6;
      const fromState = <i32>Math.round(getP(slotPtr, paramCount, base, -1.0));
      if (fromState != -1 && fromState != curState) continue;
      const toState = <i32>Math.round(getP(slotPtr, paramCount, base + 1, <f64>curState));
      const guardIdx = <i32>Math.round(getP(slotPtr, paramCount, base + 2, -1.0));
      const guardOp = <i32>Math.round(getP(slotPtr, paramCount, base + 3, 4.0));
      const guardThr = getP(slotPtr, paramCount, base + 4, 0.0);
      const actionOut = getP(slotPtr, paramCount, base + 5, <f64>toState);

      let fired = false;
      if (guardIdx == -1) {
        fired = true;
      } else if (guardIdx == -2) {
        fired = evalRelOp(guardOp, timeInState, guardThr);
      } else if (guardIdx >= 0 && guardIdx < 8) {
        fired = evalRelOp(guardOp, getIn(slotPtr, guardIdx), guardThr);
      }

      if (fired) {
        curState = toState;
        timeInState = 0.0;
        curOut = actionOut;
        break;
      }
    }

    setS(slotPtr, 0, <f64>curState);
    setS(slotPtr, 1, timeInState);
    setS(slotPtr, 2, curOut);
    setOut(slotPtr, 0, curOut);
    setOut(slotPtr, 1, <f64>curState);
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
