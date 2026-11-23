// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript ARINC 429 avionics bus equipment runtime for `@modelscript/arinc429-std-lib`.
 *
 * Implements zero-GC 2048-byte aligned slot ABI for Air Data Computer (203/205/206/211),
 * Inertial Reference System (310/311/314/324/325), and Radio Altimeter (164) transmitters:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — [0]=labelValue, [1]=range, [2]=resolution, [3]=rateHz
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — [0]=filtered engineering value, [1]=last tx time
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — [0]=sensorIn, [1]=encodedWordU32, [2]=decodedEngVal, [3]=sdi, [4]=ssm
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
function setState(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), val);
}

@inline
function setDState(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3), val);
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), val);
}

@inline
function reverseBits8(b: u32): u32 {
  let x = b & 0xff;
  x = ((x & 0xf0) >> 4) | ((x & 0x0f) << 4);
  x = ((x & 0xcc) >> 2) | ((x & 0x33) << 2);
  x = ((x & 0xaa) >> 1) | ((x & 0x55) << 1);
  return x & 0xff;
}

/**
 * Encodes a 32-bit ARINC 429 BNR word with bit-reversed 8-bit label, 2-bit SDI,
 * 19-bit two's-complement data, 2-bit SSM, and odd parity on bit 32.
 */
export function encodeBnrWord32(labelVal: u32, sdi: u32, value: f64, resolution: f64, ssm: u32): u32 {
  const res = resolution > 0.0 ? resolution : 1.0;
  let scaled = <i32>Math.round(value / res);
  if (scaled > 262143) scaled = 262143;
  if (scaled < -262144) scaled = -262144;
  const data19: u32 = (<u32>scaled) & 0x7ffff;
  const wireLabel = reverseBits8(labelVal);
  let word: u32 = (wireLabel & 0xff) | ((sdi & 0x3) << 8) | (data19 << 10) | ((ssm & 0x3) << 29);
  const ones = popcnt<u32>(word & 0x7fffffff);
  if ((ones & 1) == 0) {
    word |= 0x80000000;
  }
  return word;
}

export function arinc429ModelInit(_archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const sensorIn = getIo(slotPtr, 0);
  setState(slotPtr, 0, isNaN(sensorIn) ? 0.0 : sensorIn);
  setState(slotPtr, 1, 0.0);
  const labelVal = <u32>Math.round(getCon(slotPtr, conCount, 0, 131.0));
  const res = getCon(slotPtr, conCount, 2, 0.5);
  const sdi = <u32>Math.round(getIo(slotPtr, 3)) & 0x3;
  const word = encodeBnrWord32(labelVal, sdi, getState(slotPtr, 0), res, 3);
  setIo(slotPtr, 1, <f64>word);
  setIo(slotPtr, 2, getState(slotPtr, 0));
}

export function arinc429ModelStep(_archetypeId: i32, t: f64, dt: f64, slotPtr: usize, conCount: i32): void {
  const sensorIn = getIo(slotPtr, 0);
  const target = isNaN(sensorIn) ? 0.0 : sensorIn;
  const prev = getState(slotPtr, 0);
  const tau: f64 = 0.05;
  const dVal = (target - prev) / tau;
  setDState(slotPtr, 0, dVal);
  const next = dt > 0.0 ? prev + dVal * (dt < tau ? dt : tau) : target;
  setState(slotPtr, 0, next);
  setState(slotPtr, 1, t);

  const labelVal = <u32>Math.round(getCon(slotPtr, conCount, 0, 131.0));
  const res = getCon(slotPtr, conCount, 2, 0.5);
  const sdi = <u32>Math.round(getIo(slotPtr, 3)) & 0x3;
  const ssmRaw = getIo(slotPtr, 4);
  const ssm: u32 = isNaN(ssmRaw) ? 3 : (<u32>Math.round(ssmRaw) & 0x3);
  const word = encodeBnrWord32(labelVal, sdi, next, res, ssm);
  setIo(slotPtr, 1, <f64>word);
  setIo(slotPtr, 2, next);
}
