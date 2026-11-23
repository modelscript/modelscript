// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript firmware memory-map & checksum runtime for `@modelscript/ihex-std-lib`.
 *
 * Slot ABI (2048-byte aligned):
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — schema parameters (FLASH_BASE, FLASH_SIZE, PAGE_SIZE, etc.)
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — accumulated byte count / page count
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives (0 for static memory layout)
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — I/O bus:
 *       IO[0] = usedBytes      IO[1] = flashSizeBytes
 *       IO[2] = utilization    IO[3] = pagesUsed
 *       IO[4] = freeBytes      IO[5] = baseAddress
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

const ARCH_REC_00: i32 = 1;
const ARCH_REC_01: i32 = 2;
const ARCH_REC_02: i32 = 3;
const ARCH_REC_03: i32 = 4;
const ARCH_REC_04: i32 = 5;
const ARCH_REC_05: i32 = 6;

const ARCH_MCU_8051: i32 = 10;
const ARCH_MCU_AVR: i32 = 11;
const ARCH_MCU_M0: i32 = 12;
const ARCH_MCU_M4: i32 = 13;

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getIO(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIO(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), val);
}

@inline
function setState(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), val);
}

@inline
function setDState(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3), val);
}

/**
 * Computes Intel HEX 2's-complement checksum for a 4-byte record header `(ll, addrHi, addrLo, tt)`.
 */
export function ihexHeaderChecksum(ll: i32, addrHi: i32, addrLo: i32, tt: i32): i32 {
  const sum = (ll + addrHi + addrLo + tt) & 0xff;
  return (256 - sum) & 0xff;
}

/**
 * Evaluates a cleanroom Intel HEX record or MCU flash layout model slot.
 */
export function ihexModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  setDState(slotPtr, 0, 0.0);

  if (archetypeId >= ARCH_MCU_8051 && archetypeId <= ARCH_MCU_M4) {
    const flashBase = getCon(slotPtr, conCount, 0, 0.0);
    const flashSize = getCon(slotPtr, conCount, 1, 65536.0);
    const pageSize = getCon(slotPtr, conCount, 2, 256.0);
    const usedBytes = getIO(slotPtr, 0);

    const util = flashSize > 0.0 ? usedBytes / flashSize : 0.0;
    const pagesUsed = pageSize > 0.0 ? Math.ceil(usedBytes / pageSize) : 0.0;
    const freeBytes = flashSize > usedBytes ? flashSize - usedBytes : 0.0;

    setState(slotPtr, 0, usedBytes);
    setIO(slotPtr, 1, flashSize);
    setIO(slotPtr, 2, util);
    setIO(slotPtr, 3, pagesUsed);
    setIO(slotPtr, 4, freeBytes);
    setIO(slotPtr, 5, flashBase);
    return;
  }

  // Record type archetypes (00..05)
  if (archetypeId >= ARCH_REC_00 && archetypeId <= ARCH_REC_05) {
    const recType = getCon(slotPtr, conCount, 0, 0.0);
    const payloadLen = getCon(slotPtr, conCount, 1, 0.0);
    setState(slotPtr, 0, payloadLen);
    setIO(slotPtr, 0, payloadLen);
    setIO(slotPtr, 1, recType);
  }
}
