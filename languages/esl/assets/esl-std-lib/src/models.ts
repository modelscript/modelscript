// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript aerospace & control runtime for `@modelscript/esl-std-lib`.
 *
 * Zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — block parameters
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic states
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — signal bus:
 *       IO[0] = u0 (primary input / rx / wx / x)
 *       IO[1] = u1 (secondary input / ry / wy / y)
 *       IO[2] = u2 (rz / wz)
 *       IO[3] = y0 (primary output / ax / q0)
 *       IO[4] = y1 (ay / q1)
 *       IO[5] = y2 (az / q2)
 *       IO[6] = y3 (q3)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

const ARCH_TRANSFER: i32 = 1;
const ARCH_DELAY: i32 = 2;
const ARCH_LIMIT: i32 = 3;
const ARCH_DEADZONE: i32 = 4;
const ARCH_QUATERNION: i32 = 10;
const ARCH_ORBIT_J2: i32 = 11;
const ARCH_TAB1: i32 = 20;
const ARCH_TAB2: i32 = 21;

@inline
function clamp(x: f64, lo: f64, hi: f64): f64 {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_STATE + (<usize>idx << 3));
}

@inline
function setState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), v);
}

@inline
function getDState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3));
}

@inline
function setDState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3), v);
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

function stateCountForArchetype(archetypeId: i32): i32 {
  if (archetypeId == ARCH_TRANSFER) return 2;
  if (archetypeId == ARCH_DELAY) return 1;
  if (archetypeId == ARCH_QUATERNION) return 4;
  return 0;
}

export function eslModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  for (let i = 0; i < 8; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }
  if (archetypeId == ARCH_QUATERNION) {
    const q0 = getCon(slotPtr, conCount, 0, 1.0);
    const q1 = getCon(slotPtr, conCount, 1, 0.0);
    const q2 = getCon(slotPtr, conCount, 2, 0.0);
    const q3 = getCon(slotPtr, conCount, 3, 0.0);
    const n = Math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
    const inv = n > 1e-12 ? 1.0 / n : 1.0;
    setState(slotPtr, 0, q0 * inv);
    setState(slotPtr, 1, q1 * inv);
    setState(slotPtr, 2, q2 * inv);
    setState(slotPtr, 3, q3 * inv);
    setIo(slotPtr, 3, q0 * inv);
    setIo(slotPtr, 4, q1 * inv);
    setIo(slotPtr, 5, q2 * inv);
    setIo(slotPtr, 6, q3 * inv);
  } else if (archetypeId == ARCH_DELAY) {
    const y0 = getCon(slotPtr, conCount, 1, 0.0);
    setState(slotPtr, 0, y0);
    setIo(slotPtr, 3, y0);
  }
}

export function eslModelEvalDerivatives(
  archetypeId: i32,
  _t: f64,
  _dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  if (archetypeId == ARCH_TRANSFER) {
    const gain = getCon(slotPtr, conCount, 0, 1.0);
    const tau = Math.max(1e-6, getCon(slotPtr, conCount, 1, 0.5));
    const wn = Math.max(1e-6, getCon(slotPtr, conCount, 2, 1.0));
    const zeta = getCon(slotPtr, conCount, 3, 0.707);
    const order = getCon(slotPtr, conCount, 4, 1.0);
    const u = getIo(slotPtr, 0);
    const x0 = getState(slotPtr, 0);
    const x1 = getState(slotPtr, 1);

    if (order < 1.5) {
      // First-order lag: tau * dy/dt + y = gain * u
      setDState(slotPtr, 0, (gain * u - x0) / tau);
      setDState(slotPtr, 1, 0.0);
      setIo(slotPtr, 3, x0);
    } else {
      // Second-order: x0' = x1, x1' = wn^2*(gain*u - x0) - 2*zeta*wn*x1
      setDState(slotPtr, 0, x1);
      setDState(slotPtr, 1, wn * wn * (gain * u - x0) - 2.0 * zeta * wn * x1);
      setIo(slotPtr, 3, x0);
    }
    return;
  }

  if (archetypeId == ARCH_DELAY) {
    // First-order Pade delay: dx/dt = (2/T)*(u - x), y = 2*x - u
    const delayT = Math.max(1e-6, getCon(slotPtr, conCount, 0, 0.1));
    const u = getIo(slotPtr, 0);
    const x = getState(slotPtr, 0);
    setDState(slotPtr, 0, (2.0 / delayT) * (u - x));
    setIo(slotPtr, 3, 2.0 * x - u);
    return;
  }

  if (archetypeId == ARCH_LIMIT) {
    const lo = getCon(slotPtr, conCount, 0, -1.0);
    const hi = getCon(slotPtr, conCount, 1, 1.0);
    const u = getIo(slotPtr, 0);
    setIo(slotPtr, 3, clamp(u, lo, hi));
    return;
  }

  if (archetypeId == ARCH_DEADZONE) {
    const lo = getCon(slotPtr, conCount, 0, -0.05);
    const hi = getCon(slotPtr, conCount, 1, 0.05);
    const slope = getCon(slotPtr, conCount, 2, 1.0);
    const u = getIo(slotPtr, 0);
    let y: f64 = 0.0;
    if (u > hi) y = slope * (u - hi);
    else if (u < lo) y = slope * (u - lo);
    setIo(slotPtr, 3, y);
    return;
  }

  if (archetypeId == ARCH_QUATERNION) {
    const wx = getIo(slotPtr, 0);
    const wy = getIo(slotPtr, 1);
    const wz = getIo(slotPtr, 2);
    const kNorm = getCon(slotPtr, conCount, 4, 1.0);

    const q0 = getState(slotPtr, 0);
    const q1 = getState(slotPtr, 1);
    const q2 = getState(slotPtr, 2);
    const q3 = getState(slotPtr, 3);
    const err = 1.0 - (q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);

    setDState(slotPtr, 0, 0.5 * (-wx * q1 - wy * q2 - wz * q3) + kNorm * err * q0);
    setDState(slotPtr, 1, 0.5 * (wx * q0 + wz * q2 - wy * q3) + kNorm * err * q1);
    setDState(slotPtr, 2, 0.5 * (wy * q0 - wz * q1 + wx * q3) + kNorm * err * q2);
    setDState(slotPtr, 3, 0.5 * (wz * q0 + wy * q1 - wx * q2) + kNorm * err * q3);

    setIo(slotPtr, 3, q0);
    setIo(slotPtr, 4, q1);
    setIo(slotPtr, 5, q2);
    setIo(slotPtr, 6, q3);
    return;
  }

  if (archetypeId == ARCH_ORBIT_J2) {
    const mu = getCon(slotPtr, conCount, 0, 3.986004418e14);
    const re = getCon(slotPtr, conCount, 1, 6378137.0);
    const j2 = getCon(slotPtr, conCount, 2, 1.08262668e-3);

    const rx = getIo(slotPtr, 0);
    const ry = getIo(slotPtr, 1);
    const rz = getIo(slotPtr, 2);
    const r2 = rx * rx + ry * ry + rz * rz;
    const r = Math.sqrt(Math.max(1.0, r2));
    const r3 = r * r2;
    const r5 = r3 * r2;
    const z2OverR2 = (rz * rz) / Math.max(1.0, r2);
    const j2Factor = (1.5 * j2 * mu * re * re) / r5;

    const ax = (-mu * rx) / r3 - j2Factor * rx * (1.0 - 5.0 * z2OverR2);
    const ay = (-mu * ry) / r3 - j2Factor * ry * (1.0 - 5.0 * z2OverR2);
    const az = (-mu * rz) / r3 - j2Factor * rz * (3.0 - 5.0 * z2OverR2);
    setIo(slotPtr, 3, ax);
    setIo(slotPtr, 4, ay);
    setIo(slotPtr, 5, az);
    return;
  }

  if (archetypeId == ARCH_TAB1) {
    const x0 = getCon(slotPtr, conCount, 0, 0.0);
    const x1 = getCon(slotPtr, conCount, 1, 1.0);
    const x2 = getCon(slotPtr, conCount, 2, 2.0);
    const y0 = getCon(slotPtr, conCount, 3, 0.0);
    const y1 = getCon(slotPtr, conCount, 4, 1.0);
    const y2 = getCon(slotPtr, conCount, 5, 0.0);
    const x = getIo(slotPtr, 0);
    let y: f64;
    if (x <= x0) {
      y = y0;
    } else if (x <= x1) {
      const denom = x1 - x0;
      const frac = denom > 1e-12 ? (x - x0) / denom : 0.0;
      y = y0 + frac * (y1 - y0);
    } else if (x <= x2) {
      const denom = x2 - x1;
      const frac = denom > 1e-12 ? (x - x1) / denom : 0.0;
      y = y1 + frac * (y2 - y1);
    } else {
      y = y2;
    }
    setIo(slotPtr, 3, y);
    return;
  }

  if (archetypeId == ARCH_TAB2) {
    const x0 = getCon(slotPtr, conCount, 0, 0.0);
    const x1 = getCon(slotPtr, conCount, 1, 1.0);
    const y0 = getCon(slotPtr, conCount, 2, 0.0);
    const y1 = getCon(slotPtr, conCount, 3, 1.0);
    const z00 = getCon(slotPtr, conCount, 4, 0.0);
    const z10 = getCon(slotPtr, conCount, 5, 1.0);
    const z01 = getCon(slotPtr, conCount, 6, 2.0);
    const z11 = getCon(slotPtr, conCount, 7, 3.0);

    const x = getIo(slotPtr, 0);
    const y = getIo(slotPtr, 1);
    const tx = x1 > x0 ? clamp((x - x0) / (x1 - x0), 0.0, 1.0) : 0.0;
    const ty = y1 > y0 ? clamp((y - y0) / (y1 - y0), 0.0, 1.0) : 0.0;

    const z0 = z00 + tx * (z10 - z00);
    const z1 = z01 + tx * (z11 - z01);
    setIo(slotPtr, 3, z0 + ty * (z1 - z0));
    return;
  }
}

export function eslModelStep(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const nStates = stateCountForArchetype(archetypeId);
  if (nStates == 0 || dt <= 0.0) {
    eslModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
    return;
  }

  const y0_0 = getState(slotPtr, 0);
  const y0_1 = getState(slotPtr, 1);
  const y0_2 = getState(slotPtr, 2);
  const y0_3 = getState(slotPtr, 3);

  eslModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
  const k1_0 = getDState(slotPtr, 0);
  const k1_1 = getDState(slotPtr, 1);
  const k1_2 = getDState(slotPtr, 2);
  const k1_3 = getDState(slotPtr, 3);

  setState(slotPtr, 0, y0_0 + dt * k1_0);
  if (nStates > 1) setState(slotPtr, 1, y0_1 + dt * k1_1);
  if (nStates > 2) setState(slotPtr, 2, y0_2 + dt * k1_2);
  if (nStates > 3) setState(slotPtr, 3, y0_3 + dt * k1_3);

  eslModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
  const k2_0 = getDState(slotPtr, 0);
  const k2_1 = getDState(slotPtr, 1);
  const k2_2 = getDState(slotPtr, 2);
  const k2_3 = getDState(slotPtr, 3);

  setState(slotPtr, 0, y0_0 + 0.5 * dt * (k1_0 + k2_0));
  if (nStates > 1) setState(slotPtr, 1, y0_1 + 0.5 * dt * (k1_1 + k2_1));
  if (nStates > 2) setState(slotPtr, 2, y0_2 + 0.5 * dt * (k1_2 + k2_2));
  if (nStates > 3) setState(slotPtr, 3, y0_3 + 0.5 * dt * (k1_3 + k2_3));

  eslModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
}

export function eslBatchInit(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    eslModelInit(archetypeId, slotPtr, conCount);
  }
}

export function eslBatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    eslModelStep(archetypeId, t, dt, slotPtr, conCount);
  }
}
