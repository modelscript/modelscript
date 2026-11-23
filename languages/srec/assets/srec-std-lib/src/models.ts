// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime for `@modelscript/srec-std-lib`.
 *
 * Provides zero-GC Motorola S-Record 1's-complement checksum calculation,
 * address-width metadata lookup, and firmware footprint metrics.
 */

const OFF_CON: usize = 0x080;
const OFF_IO: usize = 0x780;

/**
 * Computes the Motorola S-Record 1's-complement checksum over a byte buffer in linear memory.
 */
export function srecChecksumBytes(ptr: usize, length: i32): i32 {
  let sum: i32 = 0;
  for (let i = 0; i < length; i++) {
    sum += <i32>load<u8>(ptr + <usize>i);
  }
  return (~sum) & 0xff;
}

/**
 * Returns address field width in bytes for an S-Record archetype ID (1..10).
 */
export function srecAddressBytesForArchetype(archetypeId: i32): i32 {
  // S2 (3), S6 (7), S8 (9) => 3 bytes
  if (archetypeId == 3 || archetypeId == 7 || archetypeId == 9) return 3;
  // S3 (4), S7 (8) => 4 bytes
  if (archetypeId == 4 || archetypeId == 8) return 4;
  // S0 (1), S1 (2), S4 (5), S5 (6), S9 (10) => 2 bytes
  return 2;
}

/**
 * Evaluates a cleanroom SREC record or Motorola memory-map preset slot.
 * Writes addressBits to IO[0], addressBytes to IO[1], and maxPayloadBytes/baseAddr to IO[2].
 */
export function srecModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): f64 {
  const addrBits = conCount > 0 ? load<f64>(slotPtr + OFF_CON) : <f64>(srecAddressBytesForArchetype(archetypeId) * 8);
  const addrBytes = addrBits / 8.0;
  const thirdParam = conCount > 2 ? load<f64>(slotPtr + OFF_CON + 16) : 250.0;

  store<f64>(slotPtr + OFF_IO, addrBits);
  store<f64>(slotPtr + OFF_IO + 8, addrBytes);
  store<f64>(slotPtr + OFF_IO + 16, thirdParam);
  return addrBits;
}
