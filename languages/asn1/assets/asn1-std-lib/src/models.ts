// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime for `@modelscript/asn1-std-lib`.
 *
 * Implements zero-GC 2048-byte aligned slot ABI for X.680 universal tags and
 * classic 1980s ASN.1 BER/DER protocol PDUs (SNMPv1, X.509, IEC 61850 GOOSE):
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — [minBytes, maxBytes, rateHz]
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — [txBytesTotal, txFramesTotal]
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — [dTxBytes_dt, dTxFrames_dt]
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — [avgBytes, peakBandwidthBps, overheadRatio]
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

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
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

export function asn1ModelInit(_archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const minB = getCon(slotPtr, conCount, 0, 2.0);
  const maxB = getCon(slotPtr, conCount, 1, 64.0);
  const rateHz = getCon(slotPtr, conCount, 2, 1.0);
  const avgB = 0.5 * (minB + maxB);

  setState(slotPtr, 0, 0.0);
  setState(slotPtr, 1, 0.0);
  setDState(slotPtr, 0, rateHz * avgB);
  setDState(slotPtr, 1, rateHz);
  setIo(slotPtr, 0, avgB);
  setIo(slotPtr, 1, rateHz * maxB * 8.0);
  setIo(slotPtr, 2, avgB > 0.0 ? 2.0 / avgB : 0.0);
}

export function asn1ModelStep(
  _archetypeId: i32,
  _t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const minB = getCon(slotPtr, conCount, 0, 2.0);
  const maxB = getCon(slotPtr, conCount, 1, 64.0);
  const rateHz = getCon(slotPtr, conCount, 2, 1.0);
  const avgB = 0.5 * (minB + maxB);

  const dBytes = rateHz * avgB;
  const txBytes = getState(slotPtr, 0) + dBytes * dt;
  const txFrames = getState(slotPtr, 1) + rateHz * dt;

  setState(slotPtr, 0, txBytes);
  setState(slotPtr, 1, txFrames);
  setDState(slotPtr, 0, dBytes);
  setDState(slotPtr, 1, rateHz);
  setIo(slotPtr, 0, avgB);
  setIo(slotPtr, 1, rateHz * maxB * 8.0);
  setIo(slotPtr, 2, avgB > 0.0 ? 2.0 / avgB : 0.0);
}

export function asn1BatchInit(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    asn1ModelInit(archetypeId, slotPtr, conCount);
  }
}

export function asn1BatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    asn1ModelStep(archetypeId, t, dt, slotPtr, conCount);
  }
}
