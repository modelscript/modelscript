// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript continuous/hybrid operator runtime for `@modelscript/acsl-std-lib`.
 *
 * Implements the 14 standard ACSL (1975) operators using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — operator parameters
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — signal I/O bus:
 *       IO[0] = u0 (primary input)
 *       IO[1] = u1 (secondary input / clk / cond)
 *       IO[2] = u2 (tertiary input / b branch)
 *       IO[3] = y  (primary output)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

const ARCH_INTEG: i32 = 1;
const ARCH_REALPL: i32 = 2;
const ARCH_CMPXPL: i32 = 3;
const ARCH_LEDLAG: i32 = 4;
const ARCH_DELAY: i32 = 5;
const ARCH_PULSE: i32 = 6;
const ARCH_RAMP: i32 = 7;
const ARCH_STEP: i32 = 8;
const ARCH_BOUND: i32 = 9;
const ARCH_DEAD: i32 = 10;
const ARCH_QUANT: i32 = 11;
const ARCH_SW: i32 = 12;
const ARCH_ZHOLD: i32 = 13;
const ARCH_LIMINT: i32 = 14;

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

export function stateCountForArchetype(archetypeId: i32): i32 {
  if (archetypeId == ARCH_CMPXPL) return 2;
  if (
    archetypeId == ARCH_INTEG ||
    archetypeId == ARCH_REALPL ||
    archetypeId == ARCH_LEDLAG ||
    archetypeId == ARCH_LIMINT ||
    archetypeId == ARCH_DELAY ||
    archetypeId == ARCH_ZHOLD
  ) {
    return 1;
  }
  return 0;
}

export function acslModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  if (archetypeId == ARCH_INTEG) {
    const ic = getCon(slotPtr, conCount, 0, 0.0);
    setState(slotPtr, 0, ic);
    setIo(slotPtr, 3, ic);
    return;
  }
  if (archetypeId == ARCH_LIMINT) {
    const ic = getCon(slotPtr, conCount, 0, 0.0);
    const lo = getCon(slotPtr, conCount, 1, -1.0);
    const hi = getCon(slotPtr, conCount, 2, 1.0);
    const clamped = clamp(ic, lo, hi);
    setState(slotPtr, 0, clamped);
    setIo(slotPtr, 3, clamped);
    return;
  }
  if (archetypeId == ARCH_REALPL) {
    const ic = getCon(slotPtr, conCount, 1, 0.0);
    setState(slotPtr, 0, ic);
    setIo(slotPtr, 3, ic);
    return;
  }
  if (archetypeId == ARCH_CMPXPL) {
    const ic1 = getCon(slotPtr, conCount, 2, 0.0);
    const ic2 = getCon(slotPtr, conCount, 3, 0.0);
    setState(slotPtr, 0, ic1);
    setState(slotPtr, 1, ic2);
    setIo(slotPtr, 3, ic1);
    return;
  }
  if (archetypeId == ARCH_LEDLAG) {
    const ic = getCon(slotPtr, conCount, 2, 0.0);
    setState(slotPtr, 0, ic);
    setIo(slotPtr, 3, ic);
    return;
  }
  if (archetypeId == ARCH_DELAY) {
    const ic = getCon(slotPtr, conCount, 1, 0.0);
    setState(slotPtr, 0, ic);
    setIo(slotPtr, 3, ic);
    return;
  }
  if (archetypeId == ARCH_ZHOLD) {
    const ic = getCon(slotPtr, conCount, 0, 0.0);
    setState(slotPtr, 0, ic);
    setIo(slotPtr, 3, ic);
    return;
  }
}

export function acslModelEvalDerivatives(
  archetypeId: i32,
  t: f64,
  _dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const u = getIo(slotPtr, 0);

  if (archetypeId == ARCH_INTEG) {
    setDState(slotPtr, 0, u);
    setIo(slotPtr, 3, getState(slotPtr, 0));
    return;
  }

  if (archetypeId == ARCH_LIMINT) {
    const lo = getCon(slotPtr, conCount, 1, -1.0);
    const hi = getCon(slotPtr, conCount, 2, 1.0);
    const y = clamp(getState(slotPtr, 0), lo, hi);
    let dy = u;
    if ((y <= lo && u < 0.0) || (y >= hi && u > 0.0)) {
      dy = 0.0;
    }
    setDState(slotPtr, 0, dy);
    setIo(slotPtr, 3, y);
    return;
  }

  if (archetypeId == ARCH_REALPL) {
    const tau = Math.max(1e-9, getCon(slotPtr, conCount, 0, 1.0));
    const y = getState(slotPtr, 0);
    setDState(slotPtr, 0, (u - y) / tau);
    setIo(slotPtr, 3, y);
    return;
  }

  if (archetypeId == ARCH_CMPXPL) {
    const a = Math.max(1e-9, getCon(slotPtr, conCount, 0, 1.0));
    const b = getCon(slotPtr, conCount, 1, 1.414);
    const y = getState(slotPtr, 0);
    const v = getState(slotPtr, 1);
    setDState(slotPtr, 0, v);
    setDState(slotPtr, 1, (u - b * v - y) / a);
    setIo(slotPtr, 3, y);
    return;
  }

  if (archetypeId == ARCH_LEDLAG) {
    const t1 = getCon(slotPtr, conCount, 0, 0.5);
    const t2 = Math.max(1e-9, getCon(slotPtr, conCount, 1, 1.0));
    const x = getState(slotPtr, 0);
    setDState(slotPtr, 0, (u - x) / t2);
    const y = x + (t1 / t2) * (u - x);
    setIo(slotPtr, 3, y);
    return;
  }

  if (archetypeId == ARCH_DELAY) {
    // First-order Pade / lag approximation in single-slot WASM kernel
    const td = getCon(slotPtr, conCount, 0, 1.0);
    if (td <= 1e-9) {
      setDState(slotPtr, 0, 0.0);
      setIo(slotPtr, 3, u);
      return;
    }
    const x = getState(slotPtr, 0);
    setDState(slotPtr, 0, (2.0 / td) * (u - x));
    setIo(slotPtr, 3, 2.0 * x - u);
    return;
  }

  if (archetypeId == ARCH_PULSE) {
    const tz = getCon(slotPtr, conCount, 0, 0.0);
    const p = Math.max(1e-9, getCon(slotPtr, conCount, 1, 1.0));
    const w = getCon(slotPtr, conCount, 2, 0.5);
    if (t < tz) {
      setIo(slotPtr, 3, 0.0);
      return;
    }
    const phase = (t - tz) - Math.floor((t - tz) / p) * p;
    setIo(slotPtr, 3, phase < w ? 1.0 : 0.0);
    return;
  }

  if (archetypeId == ARCH_RAMP) {
    const t0 = getCon(slotPtr, conCount, 0, 0.0);
    setIo(slotPtr, 3, t > t0 ? t - t0 : 0.0);
    return;
  }

  if (archetypeId == ARCH_STEP) {
    const t0 = getCon(slotPtr, conCount, 0, 0.0);
    setIo(slotPtr, 3, t >= t0 ? 1.0 : 0.0);
    return;
  }

  if (archetypeId == ARCH_BOUND) {
    const lo = getCon(slotPtr, conCount, 0, -1.0);
    const hi = getCon(slotPtr, conCount, 1, 1.0);
    setIo(slotPtr, 3, clamp(u, lo, hi));
    return;
  }

  if (archetypeId == ARCH_DEAD) {
    const lo = getCon(slotPtr, conCount, 0, -0.1);
    const hi = getCon(slotPtr, conCount, 1, 0.1);
    if (u > hi) setIo(slotPtr, 3, u - hi);
    else if (u < lo) setIo(slotPtr, 3, u - lo);
    else setIo(slotPtr, 3, 0.0);
    return;
  }

  if (archetypeId == ARCH_QUANT) {
    const q = Math.max(1e-12, getCon(slotPtr, conCount, 0, 0.1));
    setIo(slotPtr, 3, Math.round(u / q) * q);
    return;
  }

  if (archetypeId == ARCH_SW) {
    const cond = getIo(slotPtr, 1);
    const b = getIo(slotPtr, 2);
    const thr = getCon(slotPtr, conCount, 0, 0.0);
    setIo(slotPtr, 3, cond > thr ? u : b);
    return;
  }

  if (archetypeId == ARCH_ZHOLD) {
    const clk = getIo(slotPtr, 1);
    if (clk > 0.0) {
      setState(slotPtr, 0, u);
    }
    setDState(slotPtr, 0, 0.0);
    setIo(slotPtr, 3, getState(slotPtr, 0));
    return;
  }
}

export function acslModelStep(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const nStates = stateCountForArchetype(archetypeId);
  if (nStates == 0 || dt <= 0.0 || archetypeId == ARCH_ZHOLD) {
    acslModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
    return;
  }

  const y0_0 = getState(slotPtr, 0);
  const y0_1 = getState(slotPtr, 1);

  acslModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
  const k1_0 = getDState(slotPtr, 0);
  const k1_1 = getDState(slotPtr, 1);

  setState(slotPtr, 0, y0_0 + dt * k1_0);
  if (nStates > 1) setState(slotPtr, 1, y0_1 + dt * k1_1);

  acslModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
  const k2_0 = getDState(slotPtr, 0);
  const k2_1 = getDState(slotPtr, 1);

  let next0 = y0_0 + 0.5 * dt * (k1_0 + k2_0);
  if (archetypeId == ARCH_LIMINT) {
    const lo = getCon(slotPtr, conCount, 1, -1.0);
    const hi = getCon(slotPtr, conCount, 2, 1.0);
    next0 = clamp(next0, lo, hi);
  }
  setState(slotPtr, 0, next0);
  if (nStates > 1) setState(slotPtr, 1, y0_1 + 0.5 * dt * (k1_1 + k2_1));

  acslModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
}

export function acslBatchInit(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    acslModelInit(archetypeId, slotPtr, conCount);
  }
}

export function acslBatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    acslModelStep(archetypeId, t, dt, slotPtr, conCount);
  }
}
