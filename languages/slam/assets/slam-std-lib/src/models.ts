// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime for `@modelscript/slam-std-lib`.
 *
 * Implements zero-GC 256-byte aligned slot evaluation for SLAM II network
 * and continuous/threshold blocks (Pritsker & Pegden 1979):
 *   - `0x00..0x3F`: `CON[8]`    (`f64`) — block parameters
 *   - `0x40..0x7F`: `STATE[8]`  (`f64`) — internal state (level, count, busy, mean)
 *   - `0x80..0xBF`: `DSTATE[8]` (`f64`) — state derivatives
 *   - `0xC0..0xFF`: `IO[8]`     (`f64`) — block I/O bus:
 *       IO[0] = input signal / rate / arrival
 *       IO[1] = output signal / level / departure
 *       IO[2] = threshold / capacity
 *       IO[3] = crossing flag (1.0 when triggered, 0.0 otherwise)
 */

const OFF_CON: usize = 0x00;
const OFF_STATE: usize = 0x40;
const OFF_DSTATE: usize = 0x80;
const OFF_IO: usize = 0xc0;

const ARCH_CREATE: i32 = 1;
const ARCH_QUEUE: i32 = 2;
const ARCH_ACTIVITY: i32 = 3;
const ARCH_AWAIT: i32 = 5;
const ARCH_FREE: i32 = 6;
const ARCH_RESOURCE: i32 = 7;
const ARCH_COLCT: i32 = 11;
const ARCH_DETECT: i32 = 12;
const ARCH_CONTINUOUS: i32 = 14;

@inline
function getCon(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
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

export function slamBlockInit(archetypeId: i32, slotPtr: usize): void {
  for (let i = 0; i < 8; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }
  if (archetypeId == ARCH_RESOURCE) {
    const cap = getCon(slotPtr, 0);
    setState(slotPtr, 0, 0.0); // busy
    setIo(slotPtr, 1, cap > 0.0 ? cap : 1.0); // available
  } else if (archetypeId == ARCH_QUEUE) {
    const iq = getCon(slotPtr, 1);
    setState(slotPtr, 0, iq > 0.0 ? iq : 0.0);
  }
}

export function slamBlockStep(archetypeId: i32, dt: f64, slotPtr: usize): f64 {
  if (archetypeId == ARCH_CONTINUOUS) {
    const rate = getIo(slotPtr, 0);
    const y0 = getState(slotPtr, 0);
    const y1 = y0 + rate * dt;
    setDState(slotPtr, 0, rate);
    setState(slotPtr, 0, y1);
    setIo(slotPtr, 1, y1);
    return y1;
  }

  if (archetypeId == ARCH_DETECT) {
    const prevVal = getState(slotPtr, 0);
    const currVal = getIo(slotPtr, 0);
    const threshold = getCon(slotPtr, 0);
    const dir = getCon(slotPtr, 2); // 1=XP, -1=XN, 0=X
    const g0 = prevVal - threshold;
    const g1 = currVal - threshold;
    let triggered: f64 = 0.0;
    if (dir > 0.0) {
      if (g0 < 0.0 && g1 >= 0.0) triggered = 1.0;
    } else if (dir < 0.0) {
      if (g0 > 0.0 && g1 <= 0.0) triggered = 1.0;
    } else {
      if ((g0 < 0.0 && g1 >= 0.0) || (g0 > 0.0 && g1 <= 0.0)) triggered = 1.0;
    }
    setState(slotPtr, 0, currVal);
    setIo(slotPtr, 3, triggered);
    return triggered;
  }

  if (archetypeId == ARCH_QUEUE) {
    const arrivals = getIo(slotPtr, 0);
    const departures = getIo(slotPtr, 1);
    const q0 = getState(slotPtr, 0);
    let q1 = q0 + arrivals - departures;
    if (q1 < 0.0) q1 = 0.0;
    setState(slotPtr, 0, q1);
    return q1;
  }

  if (archetypeId == ARCH_RESOURCE || archetypeId == ARCH_AWAIT || archetypeId == ARCH_FREE) {
    const cap = getCon(slotPtr, 0) > 0.0 ? getCon(slotPtr, 0) : 1.0;
    const delta = getIo(slotPtr, 0);
    let busy = getState(slotPtr, 0) + delta;
    if (busy < 0.0) busy = 0.0;
    if (busy > cap) busy = cap;
    setState(slotPtr, 0, busy);
    setIo(slotPtr, 1, cap - busy);
    return busy / cap;
  }

  if (archetypeId == ARCH_COLCT) {
    const obs = getIo(slotPtr, 0);
    const n = getState(slotPtr, 0) + 1.0;
    const mean0 = getState(slotPtr, 1);
    const mean1 = mean0 + (obs - mean0) / n;
    setState(slotPtr, 0, n);
    setState(slotPtr, 1, mean1);
    setIo(slotPtr, 1, mean1);
    return mean1;
  }

  if (archetypeId == ARCH_CREATE || archetypeId == ARCH_ACTIVITY) {
    const elapsed = getState(slotPtr, 0) + dt;
    setState(slotPtr, 0, elapsed);
    setIo(slotPtr, 1, elapsed);
    return elapsed;
  }

  return 0.0;
}
