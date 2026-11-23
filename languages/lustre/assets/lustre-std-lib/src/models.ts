// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript synchronous operator runtime for `@modelscript/lustre-std-lib`.
 *
 * Implements standard Lustre/SCADE temporal operators using a zero-GC 512-byte aligned slot ABI:
 *   - `0x000..0x03F` (64 B):  `META[16]`  (`i32`) — META[0] = tickCount (0 before first tick)
 *   - `0x040..0x0BF` (128 B): `CON[16]`   (`f64`) — operator parameters
 *   - `0x0C0..0x13F` (128 B): `STATE[16]` (`f64`) — synchronous `pre(...)` state registers
 *   - `0x140..0x1BF` (128 B): `IN[16]`    (`f64`) — input stream values (bool encoded as 0.0 / 1.0)
 *   - `0x1C0..0x1FF` (64 B):  `OUT[8]`    (`f64`) — output stream values
 */

const OFF_META: usize = 0x000;
const OFF_CON: usize = 0x040;
const OFF_STATE: usize = 0x0c0;
const OFF_IN: usize = 0x140;
const OFF_OUT: usize = 0x1c0;

// Archetype IDs (must match `LustreArchetypeId` in lustre-std-schemas.ts)
const ARCH_EDGE: i32 = 1;
const ARCH_RISING_EDGE: i32 = 2;
const ARCH_FALLING_EDGE: i32 = 3;
const ARCH_COUNTER: i32 = 4;
const ARCH_TIMER: i32 = 5;
const ARCH_INTEGRATOR_EULER: i32 = 6;
const ARCH_PID_DISCRETE: i32 = 7;
const ARCH_LATCH: i32 = 8;
const ARCH_ONCE_SINCE: i32 = 9;

@inline
function getMeta(slotPtr: usize, idx: i32): i32 {
  return load<i32>(slotPtr + OFF_META + (<usize>idx << 2));
}

@inline
function setMeta(slotPtr: usize, idx: i32, v: i32): void {
  store<i32>(slotPtr + OFF_META + (<usize>idx << 2), v);
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
function getIn(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IN + (<usize>idx << 3));
}

@inline
function setOut(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_OUT + (<usize>idx << 3), v);
}

@inline
function clamp(x: f64, lo: f64, hi: f64): f64 {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/**
 * Initializes a synchronous operator slot before tick 0.
 */
export function lustreOpInit(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  setMeta(slotPtr, 0, 0); // tickCount = 0
  for (let i = 0; i < 8; i++) {
    setState(slotPtr, i, 0.0);
    setOut(slotPtr, i, 0.0);
  }
  if (archetypeId == ARCH_COUNTER) {
    setState(slotPtr, 0, getCon(slotPtr, conCount, 0, 0.0));
  } else if (archetypeId == ARCH_INTEGRATOR_EULER) {
    setState(slotPtr, 0, getCon(slotPtr, conCount, 1, 0.0));
  } else if (archetypeId == ARCH_LATCH) {
    setState(slotPtr, 0, getCon(slotPtr, conCount, 0, 0.0));
  }
}

/**
 * Executes a single synchronous tick for the given operator archetype.
 */
export function lustreOpStep(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const tick = getMeta(slotPtr, 0);
  const isFirst = tick == 0;

  if (archetypeId == ARCH_EDGE) {
    const x = getIn(slotPtr, 0) != 0.0 ? 1.0 : 0.0;
    const prevX = getState(slotPtr, 0);
    const y = isFirst ? 0.0 : x != prevX ? 1.0 : 0.0;
    setState(slotPtr, 0, x);
    setOut(slotPtr, 0, y);
  } else if (archetypeId == ARCH_RISING_EDGE) {
    const x = getIn(slotPtr, 0) != 0.0 ? 1.0 : 0.0;
    const prevX = getState(slotPtr, 0);
    const y = isFirst ? 0.0 : x != 0.0 && prevX == 0.0 ? 1.0 : 0.0;
    setState(slotPtr, 0, x);
    setOut(slotPtr, 0, y);
  } else if (archetypeId == ARCH_FALLING_EDGE) {
    const x = getIn(slotPtr, 0) != 0.0 ? 1.0 : 0.0;
    const prevX = getState(slotPtr, 0);
    const y = isFirst ? 0.0 : x == 0.0 && prevX != 0.0 ? 1.0 : 0.0;
    setState(slotPtr, 0, x);
    setOut(slotPtr, 0, y);
  } else if (archetypeId == ARCH_COUNTER) {
    const init = getIn(slotPtr, 0);
    const incr = getIn(slotPtr, 1);
    const reset = getIn(slotPtr, 2) != 0.0;
    const prevN = getState(slotPtr, 0);
    const n = reset || isFirst ? init : prevN + incr;
    setState(slotPtr, 0, n);
    setOut(slotPtr, 0, n);
  } else if (archetypeId == ARCH_TIMER) {
    const reset = getIn(slotPtr, 0) != 0.0;
    const limit = getIn(slotPtr, 1);
    const prevC = getState(slotPtr, 0);
    const c = reset || isFirst ? 0.0 : prevC + 1.0;
    setState(slotPtr, 0, c);
    setOut(slotPtr, 0, c >= limit ? 1.0 : 0.0);
    setOut(slotPtr, 1, c);
  } else if (archetypeId == ARCH_INTEGRATOR_EULER) {
    const u = getIn(slotPtr, 0);
    const dt = getIn(slotPtr, 1);
    const y0 = getIn(slotPtr, 2);
    const prevY = getState(slotPtr, 0);
    const y = isFirst ? y0 : prevY + dt * u;
    setState(slotPtr, 0, y);
    setOut(slotPtr, 0, y);
  } else if (archetypeId == ARCH_PID_DISCRETE) {
    const err = getIn(slotPtr, 0);
    const dt = getIn(slotPtr, 1) > 0.0 ? getIn(slotPtr, 1) : 0.01;
    const kp = getCon(slotPtr, conCount, 0, 1.0);
    const ki = getCon(slotPtr, conCount, 1, 0.1);
    const kd = getCon(slotPtr, conCount, 2, 0.01);
    const outMin = getCon(slotPtr, conCount, 3, -100.0);
    const outMax = getCon(slotPtr, conCount, 4, 100.0);

    const prevI = getState(slotPtr, 0);
    const prevErr = getState(slotPtr, 1);
    const nextI = isFirst ? 0.0 : prevI + err * dt;
    const dErr = isFirst ? 0.0 : (err - prevErr) / dt;
    const rawU = kp * err + ki * nextI + kd * dErr;
    const clampedU = clamp(rawU, outMin, outMax);

    // Anti-windup: freeze integrator when saturated in the same direction
    const finalI = rawU == clampedU ? nextI : prevI;
    setState(slotPtr, 0, finalI);
    setState(slotPtr, 1, err);
    setOut(slotPtr, 0, clampedU);
  } else if (archetypeId == ARCH_LATCH) {
    const setFlag = getIn(slotPtr, 0) != 0.0;
    const resetFlag = getIn(slotPtr, 1) != 0.0;
    const init = getIn(slotPtr, 2) != 0.0 ? 1.0 : 0.0;
    const prevQ = getState(slotPtr, 0);
    let q: f64;
    if (setFlag) {
      q = 1.0;
    } else if (resetFlag) {
      q = 0.0;
    } else {
      q = isFirst ? init : prevQ;
    }
    setState(slotPtr, 0, q);
    setOut(slotPtr, 0, q);
  } else if (archetypeId == ARCH_ONCE_SINCE) {
    const a = getIn(slotPtr, 0) != 0.0;
    const b = getIn(slotPtr, 1) != 0.0;
    const prevY = getState(slotPtr, 0) != 0.0;
    let y: f64;
    if (b) {
      y = a ? 1.0 : 0.0;
    } else if (isFirst) {
      y = a ? 1.0 : 0.0;
    } else {
      y = a || prevY ? 1.0 : 0.0;
    }
    setState(slotPtr, 0, y);
    setOut(slotPtr, 0, y);
  }

  setMeta(slotPtr, 0, tick + 1);
}

/**
 * Batched zero-copy initialization across `count` descriptors:
 * each descriptor is 16 bytes `{ archetypeId: i32, slotPtr: u32, reserved: i32, conCount: i32 }`.
 */
export function lustreBatchInit(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    lustreOpInit(archetypeId, slotPtr, conCount);
  }
}

/**
 * Batched zero-copy synchronous tick across `count` descriptors.
 */
export function lustreBatchStep(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    lustreOpStep(archetypeId, slotPtr, conCount);
  }
}
