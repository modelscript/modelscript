// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * JESD3 16-bit Fuse Checksum (`C` field) and ETX Transmission Checksum utilities.
 *
 * Per JEDEC Standard 3 (JESD3 / JESD3-C):
 * - Fuse checksum (`C<hhhh>*`): fuses are grouped into 8-bit bytes starting at fuse 0,
 *   LSB-first (`byte |= bit << (i % 8)`). Unused bits in the final partial byte are 0.
 *   All bytes are summed modulo 0x10000 (16-bit unsigned).
 * - Transmission checksum (`\x03<hhhh>`): sum of all 7-bit/8-bit ASCII character codes
 *   from STX (`\x02`) through ETX (`\x03`) inclusive, modulo 0x10000.
 */

/**
 * Formats a 16-bit unsigned integer as 4 uppercase hexadecimal digits (e.g., `"1A3F"`).
 */
export function formatHex16(value: number): string {
  return (value & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Computes the JESD3 16-bit fuse checksum over a fuse array (`Uint8Array`, `number[]`, or binary string).
 */
export function computeJedecFuseChecksum(fuses: Uint8Array | readonly number[] | string): number {
  const len = fuses.length;
  let sum = 0;
  let byteVal = 0;
  for (let i = 0; i < len; i++) {
    const bitPos = i & 7;
    const bit = typeof fuses === "string" ? (fuses.charCodeAt(i) === 49 ? 1 : 0) : fuses[i] ? 1 : 0;
    if (bit) {
      byteVal |= 1 << bitPos;
    }
    if (bitPos === 7 || i === len - 1) {
      sum = (sum + byteVal) & 0xffff;
      byteVal = 0;
    }
  }
  return sum & 0xffff;
}

/**
 * Computes the JESD3 16-bit ETX transmission checksum over raw JESD3 text
 * (sum of ASCII codes from STX `\x02` through ETX `\x03` inclusive, mod 0x10000).
 */
export function computeJedecTransmissionChecksum(text: string): number {
  const stxIdx = text.indexOf("\x02");
  const etxIdx = text.indexOf("\x03");
  const start = stxIdx >= 0 ? stxIdx : 0;
  const end = etxIdx >= 0 ? etxIdx : text.length - 1;
  let sum = 0;
  for (let i = start; i <= end; i++) {
    sum = (sum + (text.charCodeAt(i) & 0xff)) & 0xffff;
  }
  return sum & 0xffff;
}
