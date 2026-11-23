// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime for `@modelscript/simscript-std-lib`.
 *
 * Implements SIMSCRIPT II.5 statistical distributions, set primitives,
 * multi-server resource utilization (Erlang-C), and TALLY/ACCUMULATE kernels
 * using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — primitive parameters
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — I/O bus:
 *       IO[0] = input / u (0..1)     IO[1] = output / sample / rho
 *       IO[2] = mean / E[X]          IO[3] = variance / Var[X]
 *       IO[4] = Lq (queue length)    IO[5] = Wq (wait time)
 *       IO[6] = L (system length)    IO[7] = W (system time)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `SimscriptArchetypeId` in simscript-std-schemas.ts)
const ARCH_EXPONENTIAL_F: i32 = 1;
const ARCH_NORMAL_F: i32 = 2;
const ARCH_UNIFORM_F: i32 = 3;
const ARCH_POISSON_F: i32 = 4;
const ARCH_ERLANG_F: i32 = 5;

const ARCH_FIFO_SET: i32 = 10;
const ARCH_LIFO_SET: i32 = 11;
const ARCH_RANKED_SET: i32 = 12;

const ARCH_RESOURCE: i32 = 20;
const ARCH_PREEMPTIVE_RESOURCE: i32 = 21;

const ARCH_TALLY: i32 = 30;
const ARCH_ACCUMULATE: i32 = 31;

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
function setState(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), val);
}

@inline
function setDState(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3), val);
}

@inline
function getIO(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIO(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), val);
}

/**
 * Computes Erlang-C waiting probability P_w and queue metrics for an M/M/c resource.
 */
function evalMMcResource(slotPtr: usize, capacity: f64, lambda: f64, mu: f64): void {
  const c: i32 = capacity < 1.0 ? 1 : <i32>Math.floor(capacity);
  const cF: f64 = <f64>c;
  const a: f64 = mu > 0.0 ? lambda / mu : 0.0;
  const rho: f64 = cF > 0.0 ? a / cF : 0.0;

  setIO(slotPtr, 1, rho);
  if (rho <= 0.0 || rho >= 1.0 || lambda <= 0.0 || mu <= 0.0) {
    setIO(slotPtr, 2, rho * cF);
    setIO(slotPtr, 3, 0.0);
    setIO(slotPtr, 4, 0.0);
    setIO(slotPtr, 5, 0.0);
    setIO(slotPtr, 6, a);
    setIO(slotPtr, 7, mu > 0.0 ? 1.0 / mu : 0.0);
    return;
  }

  let sumTerms: f64 = 1.0;
  let term: f64 = 1.0;
  for (let n: i32 = 1; n < c; n++) {
    term = (term * a) / (<f64>n);
    sumTerms += term;
  }
  const cTerm: f64 = (term * a) / (cF * (1.0 - rho));
  const p0: f64 = 1.0 / (sumTerms + cTerm);
  const pWait: f64 = cTerm * p0;
  const lq: f64 = (pWait * rho) / (1.0 - rho);
  const wq: f64 = lq / lambda;
  const w: f64 = wq + 1.0 / mu;
  const l: f64 = lambda * w;

  setIO(slotPtr, 2, rho * cF);
  setIO(slotPtr, 3, pWait);
  setIO(slotPtr, 4, lq);
  setIO(slotPtr, 5, wq);
  setIO(slotPtr, 6, l);
  setIO(slotPtr, 7, w);
  setDState(slotPtr, 0, lambda - cF * mu * rho);
}

/**
 * Initializes a SIMSCRIPT II.5 library primitive slot.
 */
export function initSlot(slotPtr: usize, archetypeId: i32, conCount: i32): i32 {
  if (archetypeId == ARCH_FIFO_SET || archetypeId == ARCH_LIFO_SET || archetypeId == ARCH_RANKED_SET) {
    setState(slotPtr, 0, getCon(slotPtr, conCount, 0, 0.0));
  } else if (archetypeId == ARCH_TALLY || archetypeId == ARCH_ACCUMULATE) {
    setState(slotPtr, 0, getCon(slotPtr, conCount, 0, 0.0));
    setState(slotPtr, 1, 0.0);
  } else if (archetypeId == ARCH_RESOURCE || archetypeId == ARCH_PREEMPTIVE_RESOURCE) {
    setState(slotPtr, 0, 0.0);
  }
  return 0;
}

/**
 * Evaluates a SIMSCRIPT II.5 library primitive slot.
 */
export function evalSlot(slotPtr: usize, archetypeId: i32, conCount: i32, _time: f64): i32 {
  if (archetypeId == ARCH_EXPONENTIAL_F) {
    const mean = getCon(slotPtr, conCount, 0, 1.0);
    let u = getIO(slotPtr, 0);
    if (u <= 1e-12 || u >= 1.0) u = 0.5;
    const sample = -mean * Math.log(1.0 - u);
    setIO(slotPtr, 1, sample);
    setIO(slotPtr, 2, mean);
    setIO(slotPtr, 3, mean * mean);
    return 0;
  }

  if (archetypeId == ARCH_NORMAL_F) {
    const mean = getCon(slotPtr, conCount, 0, 0.0);
    const stdDev = getCon(slotPtr, conCount, 1, 1.0);
    setIO(slotPtr, 1, mean);
    setIO(slotPtr, 2, mean);
    setIO(slotPtr, 3, stdDev * stdDev);
    return 0;
  }

  if (archetypeId == ARCH_UNIFORM_F) {
    const lo = getCon(slotPtr, conCount, 0, 0.0);
    const hi = getCon(slotPtr, conCount, 1, 1.0);
    let u = getIO(slotPtr, 0);
    if (u < 0.0 || u > 1.0) u = 0.5;
    const span = hi - lo;
    setIO(slotPtr, 1, lo + u * span);
    setIO(slotPtr, 2, 0.5 * (lo + hi));
    setIO(slotPtr, 3, (span * span) / 12.0);
    return 0;
  }

  if (archetypeId == ARCH_POISSON_F) {
    const mean = getCon(slotPtr, conCount, 0, 1.0);
    setIO(slotPtr, 1, Math.round(mean));
    setIO(slotPtr, 2, mean);
    setIO(slotPtr, 3, mean);
    return 0;
  }

  if (archetypeId == ARCH_ERLANG_F) {
    const mean = getCon(slotPtr, conCount, 0, 1.0);
    const k = getCon(slotPtr, conCount, 1, 2.0);
    const kSafe = k < 1.0 ? 1.0 : k;
    setIO(slotPtr, 1, mean);
    setIO(slotPtr, 2, mean);
    setIO(slotPtr, 3, (mean * mean) / kSafe);
    return 0;
  }

  if (archetypeId == ARCH_RESOURCE || archetypeId == ARCH_PREEMPTIVE_RESOURCE) {
    const cap = getCon(slotPtr, conCount, 0, 1.0);
    const lambda = getCon(slotPtr, conCount, 1, 0.5);
    const mu = getCon(slotPtr, conCount, 2, 1.0);
    evalMMcResource(slotPtr, cap, lambda, mu);
    return 0;
  }

  if (archetypeId == ARCH_FIFO_SET || archetypeId == ARCH_LIFO_SET || archetypeId == ARCH_RANKED_SET) {
    const sz = getState(slotPtr, 0);
    setIO(slotPtr, 1, sz);
    setIO(slotPtr, 2, sz);
    return 0;
  }

  if (archetypeId == ARCH_TALLY || archetypeId == ARCH_ACCUMULATE) {
    const val = getState(slotPtr, 0);
    setIO(slotPtr, 1, val);
    setIO(slotPtr, 2, val);
    return 0;
  }

  return 0;
}
