// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime for `@modelscript/edif-std-lib`.
 *
 * Implements the 12 standard EDIF 2.0.0 GENERIC cells (`RES`, `CAP`, `IND`, `GND`, `VCC`,
 * `AND2`, `OR2`, `NAND2`, `NOR2`, `INV`, `XOR2`, `DFF`) using a zero-GC 2048-byte slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — cell parameters
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state vector (Vc, Il, Q, prevClk)
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — pin voltages / logic inputs & outputs:
 *       IO[0] = vP / logic A / D
 *       IO[1] = vN / logic B / CLK
 *       IO[2] = iBranch / logic Y / Q
 *       IO[3] = vOut
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

const ARCH_RES: i32 = 1;
const ARCH_CAP: i32 = 2;
const ARCH_IND: i32 = 3;
const ARCH_GND: i32 = 4;
const ARCH_VCC: i32 = 5;

const ARCH_AND2: i32 = 10;
const ARCH_OR2: i32 = 11;
const ARCH_NAND2: i32 = 12;
const ARCH_NOR2: i32 = 13;
const ARCH_INV: i32 = 14;
const ARCH_XOR2: i32 = 15;
const ARCH_DFF: i32 = 16;

@inline
function getCon(slotPtr: usize, idx: i32, fallback: f64): f64 {
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

@inline
function toBit(v: f64, threshold: f64): i32 {
  return v >= threshold ? 1 : 0;
}

/**
 * Initialize a cell slot by archetype ID.
 */
export function init(archetypeId: i32, slotPtr: usize): i32 {
  if (archetypeId == ARCH_DFF) {
    const q0 = getCon(slotPtr, 1, 0.0);
    setState(slotPtr, 0, q0 >= 0.5 ? 1.0 : 0.0);
    setState(slotPtr, 1, 0.0);
    setIo(slotPtr, 2, getState(slotPtr, 0));
    return 0;
  }
  setState(slotPtr, 0, 0.0);
  setState(slotPtr, 1, 0.0);
  setDState(slotPtr, 0, 0.0);
  setDState(slotPtr, 1, 0.0);
  return 0;
}

/**
 * Evaluate cell constitutive law / logic transfer function for one step.
 */
export function edif_eval(archetypeId: i32, slotPtr: usize, dt: f64): i32 {
  const in0 = getIo(slotPtr, 0);
  const in1 = getIo(slotPtr, 1);

  if (archetypeId == ARCH_RES) {
    const r = getCon(slotPtr, 0, 1000.0);
    const safeR = r > 1e-12 ? r : 1e-12;
    const current = (in0 - in1) / safeR;
    setIo(slotPtr, 2, current);
    return 0;
  }

  if (archetypeId == ARCH_CAP) {
    const c = getCon(slotPtr, 0, 1e-6);
    const safeC = c > 1e-18 ? c : 1e-18;
    const vPrev = getState(slotPtr, 0);
    const vNow = in0 - in1;
    const dvdt = dt > 0.0 ? (vNow - vPrev) / dt : 0.0;
    setDState(slotPtr, 0, dvdt);
    setState(slotPtr, 0, vNow);
    setIo(slotPtr, 2, safeC * dvdt);
    return 0;
  }

  if (archetypeId == ARCH_IND) {
    const l = getCon(slotPtr, 0, 1e-3);
    const safeL = l > 1e-18 ? l : 1e-18;
    const iPrev = getState(slotPtr, 0);
    const didt = (in0 - in1) / safeL;
    const iNext = dt > 0.0 ? iPrev + didt * dt : iPrev;
    setDState(slotPtr, 0, didt);
    setState(slotPtr, 0, iNext);
    setIo(slotPtr, 2, iNext);
    return 0;
  }

  if (archetypeId == ARCH_GND) {
    setIo(slotPtr, 3, 0.0);
    return 0;
  }

  if (archetypeId == ARCH_VCC) {
    const vcc = getCon(slotPtr, 0, 5.0);
    setIo(slotPtr, 3, vcc);
    return 0;
  }

  const vdd = getCon(slotPtr, 0, 5.0);
  const thresh = 0.5 * vdd;
  const a = toBit(in0, thresh);
  const b = toBit(in1, thresh);

  if (archetypeId == ARCH_AND2) {
    setIo(slotPtr, 2, (a & b) != 0 ? vdd : 0.0);
    return 0;
  }
  if (archetypeId == ARCH_OR2) {
    setIo(slotPtr, 2, (a | b) != 0 ? vdd : 0.0);
    return 0;
  }
  if (archetypeId == ARCH_NAND2) {
    setIo(slotPtr, 2, (a & b) == 0 ? vdd : 0.0);
    return 0;
  }
  if (archetypeId == ARCH_NOR2) {
    setIo(slotPtr, 2, (a | b) == 0 ? vdd : 0.0);
    return 0;
  }
  if (archetypeId == ARCH_INV) {
    setIo(slotPtr, 2, a == 0 ? vdd : 0.0);
    return 0;
  }
  if (archetypeId == ARCH_XOR2) {
    setIo(slotPtr, 2, (a ^ b) != 0 ? vdd : 0.0);
    return 0;
  }
  if (archetypeId == ARCH_DFF) {
    const prevClk = getState(slotPtr, 1);
    const clkBit = b;
    let q = getState(slotPtr, 0);
    if (prevClk < 0.5 && clkBit == 1) {
      q = a != 0 ? 1.0 : 0.0;
      setState(slotPtr, 0, q);
    }
    setState(slotPtr, 1, clkBit != 0 ? 1.0 : 0.0);
    setIo(slotPtr, 2, q >= 0.5 ? vdd : 0.0);
    return 0;
  }

  return -1;
}
