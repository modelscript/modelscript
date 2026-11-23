// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript discrete-event queuing & SNA kernel for `@modelscript/gpss-std-lib`.
 *
 * Implements Erlang-C multi-server M/M/c queuing analytics, Little's Law invariants,
 * and GPSS Standard Numerical Attribute (`Q$`, `F$`, `S$`, `R$`, `FR$`, `SR$`) evaluators
 * using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — block / resource parameters
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state (queue length, busy servers)
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — fluid-approximation derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — DES metric bus:
 *       IO[0] = lambda (arrival rate)     IO[1] = mu (service rate)
 *       IO[2] = capacity c                IO[3] = rho (utilization 0..1)
 *       IO[4] = Lq (mean queue length)    IO[5] = Wq (mean wait time)
 *       IO[6] = L (mean in system)        IO[7] = W (mean system time)
 *       IO[8] = Q$ (current queue)        IO[9] = F$ / S$ (occupied servers)
 *       IO[10] = R$ (remaining capacity)  IO[11] = FR$ / SR$ (utilization permille 0..1000)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

const ARCH_GENERATE: i32 = 1;
const ARCH_SEIZE: i32 = 10;
const ARCH_ENTER: i32 = 12;
const ARCH_STORAGE: i32 = 14;
const ARCH_QUEUE: i32 = 21;
const ARCH_SNA_Q: i32 = 40;
const ARCH_SNA_F: i32 = 41;
const ARCH_SNA_S: i32 = 42;
const ARCH_SNA_R: i32 = 43;
const ARCH_SNA_FR: i32 = 44;
const ARCH_SNA_SR: i32 = 45;

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

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function gpssGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Computes Erlang-C waiting probability C(c, a) for an M/M/c queue with offered load a = lambda / mu.
 */
export function gpssErlangC(c: i32, offeredLoad: f64): f64 {
  if (c <= 0) return 1.0;
  const rho = offeredLoad / (<f64>c);
  if (rho >= 1.0) return 1.0;
  if (offeredLoad <= 0.0) return 0.0;

  let sum: f64 = 1.0;
  let term: f64 = 1.0;
  for (let n: i32 = 1; n < c; n++) {
    term *= offeredLoad / (<f64>n);
    sum += term;
  }
  const cTerm = (term * offeredLoad) / (<f64>c);
  const tail = cTerm / (1.0 - rho);
  return tail / (sum + tail);
}

/**
 * Evaluates steady-state M/M/c queuing metrics and GPSS Standard Numerical Attributes for a slot.
 */
export function gpssModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const lambda = Math.max(0.0, getIo(slotPtr, 0));
  const mu = Math.max(1e-9, getIo(slotPtr, 1));
  const cap = archetypeId == ARCH_SEIZE ? 1.0 : Math.max(1.0, getIo(slotPtr, 2) > 0.0 ? getIo(slotPtr, 2) : getCon(slotPtr, conCount, 0, 1.0));
  const c = <i32>Math.max(1.0, Math.round(cap));

  if (archetypeId == ARCH_GENERATE) {
    const mean = Math.max(1e-9, getCon(slotPtr, conCount, 0, 18.0));
    setIo(slotPtr, 0, 1.0 / mean);
    return;
  }

  if (archetypeId == ARCH_SEIZE || archetypeId == ARCH_ENTER || archetypeId == ARCH_STORAGE || archetypeId == ARCH_QUEUE) {
    const a = lambda / mu;
    const rho = Math.min(0.999999, a / cap);
    const ec = gpssErlangC(c, a);
    const lq = ec * (rho / Math.max(1e-9, 1.0 - rho));
    const wq = lambda > 1e-12 ? lq / lambda : 0.0;
    const w = wq + 1.0 / mu;
    const l = lambda * w;

    setIo(slotPtr, 2, cap);
    setIo(slotPtr, 3, rho);
    setIo(slotPtr, 4, lq);
    setIo(slotPtr, 5, wq);
    setIo(slotPtr, 6, l);
    setIo(slotPtr, 7, w);
    setIo(slotPtr, 8, lq);
    setIo(slotPtr, 9, a);
    setIo(slotPtr, 10, Math.max(0.0, cap - a));
    setIo(slotPtr, 11, rho * 1000.0);
    setState(slotPtr, 0, lq);
    setDState(slotPtr, 0, lambda - mu * Math.min(cap, getState(slotPtr, 0) + a));
    return;
  }

  if (archetypeId == ARCH_SNA_Q) {
    setIo(slotPtr, 8, Math.max(0.0, getState(slotPtr, 0)));
  } else if (archetypeId == ARCH_SNA_F) {
    setIo(slotPtr, 9, getState(slotPtr, 1) > 0.5 ? 1.0 : 0.0);
  } else if (archetypeId == ARCH_SNA_S) {
    setIo(slotPtr, 9, Math.max(0.0, getState(slotPtr, 1)));
  } else if (archetypeId == ARCH_SNA_R) {
    setIo(slotPtr, 10, Math.max(0.0, cap - getState(slotPtr, 1)));
  } else if (archetypeId == ARCH_SNA_FR || archetypeId == ARCH_SNA_SR) {
    setIo(slotPtr, 11, Math.min(1000.0, Math.max(0.0, getIo(slotPtr, 3) * 1000.0)));
  }
}
