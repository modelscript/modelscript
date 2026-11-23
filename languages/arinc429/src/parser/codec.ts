// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Exact 32-bit ARINC 429 (Mark 33 DITS) binary word encoder and decoder.
 *
 * 1-indexed bit layout per ARINC Specification 429:
 *  - Bits 1..8   (idx 0..7):   8-bit bit-reversed octal label (transmitted MSB-first)
 *  - Bits 9..10  (idx 8..9):   2-bit Source/Destination Identifier (SDI)
 *  - Bits 11..29 (idx 10..28): 19-bit Data Payload (BNR two's-complement, 5-digit BCD, or DISCRETE)
 *  - Bits 30..31 (idx 29..30): 2-bit Sign/Status Matrix (SSM)
 *  - Bit 32      (idx 31):     Odd Parity bit (total 1-bits across all 32 bits must be odd)
 */

import { lookupStandardArinc429Label } from "../catalog/arinc429-std-schemas.js";
import type {
  Arinc429Encoding,
  Arinc429LabelDef,
  Arinc429SsmCode,
  Arinc429SsmMeaning,
  DecodedArinc429Word,
  EncodeArinc429WordInput,
} from "../types.js";

/**
 * Reverses the 8 bits of a byte (used for ARINC 429 wire-order label encoding).
 */
export function reverseBits8(byte: number): number {
  let x = byte & 0xff;
  x = ((x & 0xf0) >>> 4) | ((x & 0x0f) << 4);
  x = ((x & 0xcc) >>> 2) | ((x & 0x33) << 2);
  x = ((x & 0xaa) >>> 1) | ((x & 0x55) << 1);
  return x & 0xff;
}

/**
 * Counts the number of set (1) bits in a 32-bit unsigned integer.
 */
export function popcount32(value: number): number {
  let x = value >>> 0;
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Returns true iff the 32-bit ARINC 429 word has valid odd parity.
 */
export function hasValidOddParity(word: number): boolean {
  return (popcount32(word >>> 0) & 1) === 1;
}

/**
 * Formats an unsigned 32-bit word as `0xXXXXXXXX`.
 */
export function formatArinc429Hex(word: number): string {
  return `0x${(word >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

/**
 * Parses an octal label string (e.g. `"203"`) into its numeric value (`0o203 = 131`),
 * returning `NaN` if invalid or outside `001..377`.
 */
export function parseOctalLabel(label: string): number {
  const trimmed = label.trim();
  if (!/^[0-7]{1,3}$/.test(trimmed)) return Number.NaN;
  const val = Number.parseInt(trimmed, 8);
  if (val < 1 || val > 0o377) return Number.NaN;
  return val;
}

/**
 * Formats a numeric label `0..255` as a 3-digit zero-padded octal string (e.g. `131` -> `"203"`).
 */
export function formatOctalLabel(labelValue: number): string {
  return (labelValue & 0xff).toString(8).padStart(3, "0");
}

/**
 * Interprets the 2-bit SSM code according to ARINC 429 encoding type.
 */
export function interpretSsm(ssm: Arinc429SsmCode, encoding: Arinc429Encoding): Arinc429SsmMeaning {
  if (encoding === "BCD") {
    switch (ssm) {
      case 0:
        return "PLUS";
      case 1:
        return "NO_COMPUTED_DATA";
      case 2:
        return "FUNCTIONAL_TEST";
      case 3:
        return "MINUS";
    }
  }
  if (encoding === "DISCRETE") {
    switch (ssm) {
      case 0:
        return "NORMAL_OPERATION";
      case 1:
        return "NO_COMPUTED_DATA";
      case 2:
        return "FUNCTIONAL_TEST";
      case 3:
        return "FAILURE_WARNING";
    }
  }
  // BNR
  switch (ssm) {
    case 0:
      return "FAILURE_WARNING";
    case 1:
      return "NO_COMPUTED_DATA";
    case 2:
      return "FUNCTIONAL_TEST";
    case 3:
      return "NORMAL_OPERATION";
  }
}

/**
 * Encodes a 32-bit ARINC 429 word with bit-reversed 8-bit octal label, 2-bit SDI,
 * 19-bit BNR/BCD/DISCRETE payload, 2-bit SSM, and odd parity on bit 32.
 */
export function encodeArinc429Word(input: EncodeArinc429WordInput): number {
  const labelValue = typeof input.label === "string" ? parseOctalLabel(input.label) : input.label & 0xff;
  if (!Number.isFinite(labelValue) || labelValue < 0 || labelValue > 0xff) {
    throw new RangeError(`Invalid ARINC 429 octal label: ${String(input.label)}`);
  }

  const labelOctal = formatOctalLabel(labelValue);
  const std = lookupStandardArinc429Label(labelOctal);
  const encoding: Arinc429Encoding = input.encoding ?? std?.encoding ?? "BNR";
  const sdi = (input.sdi ?? 0) & 0x3;

  let data19 = 0;
  let ssm: Arinc429SsmCode;

  if (encoding === "BNR") {
    const res = input.resolution ?? (input.range !== undefined ? input.range / 262144 : (std?.resolution ?? 1));
    const scaled = Math.round(input.value / res);
    const clamped = Math.max(-262144, Math.min(262143, scaled));
    data19 = clamped & 0x7ffff;
    ssm = input.ssm ?? 3;
  } else if (encoding === "BCD") {
    const res = input.resolution ?? 1;
    const isNegative = input.value < 0;
    const mag = Math.min(79999, Math.round(Math.abs(input.value) / res));
    const d1 = mag % 10;
    const d2 = Math.floor(mag / 10) % 10;
    const d3 = Math.floor(mag / 100) % 10;
    const d4 = Math.floor(mag / 1000) % 10;
    const d5 = Math.floor(mag / 10000) % 8;
    data19 = (d1 & 0xf) | ((d2 & 0xf) << 4) | ((d3 & 0xf) << 8) | ((d4 & 0xf) << 12) | ((d5 & 0x7) << 16);
    ssm = input.ssm ?? (isNegative ? 3 : 0);
  } else {
    data19 = Math.trunc(input.value) & 0x7ffff;
    ssm = input.ssm ?? 0;
  }

  const wireLabel = reverseBits8(labelValue);
  let word = ((wireLabel & 0xff) | (sdi << 8) | (data19 << 10) | ((ssm & 0x3) << 29)) >>> 0;

  const needParityOne = (popcount32(word & 0x7fffffff) & 1) === 0;
  const setParityOne = input.injectParityError ? !needParityOne : needParityOne;
  if (setParityOne) {
    word = (word | 0x80000000) >>> 0;
  }

  return word >>> 0;
}

/**
 * Decodes a 32-bit ARINC 429 word into all bit fields and engineering units.
 */
export function decodeArinc429Word(rawWord: number, labelDef?: Partial<Arinc429LabelDef>): DecodedArinc429Word {
  const word = rawWord >>> 0;
  const wireLabelByte = word & 0xff;
  const labelValue = reverseBits8(wireLabelByte);
  const labelOctal = formatOctalLabel(labelValue);
  const std = lookupStandardArinc429Label(labelOctal);

  const sdi = (word >>> 8) & 0x3;
  const rawData19 = (word >>> 10) & 0x7ffff;
  const signedData19 = (rawData19 & 0x40000) !== 0 ? rawData19 - 0x80000 : rawData19;
  const ssm = ((word >>> 29) & 0x3) as Arinc429SsmCode;
  const parityBit = ((word >>> 31) & 0x1) as 0 | 1;
  const parityValid = hasValidOddParity(word);

  const encoding: Arinc429Encoding = labelDef?.encoding ?? std?.encoding ?? "BNR";
  const ssmMeaning = interpretSsm(ssm, encoding);

  const d1 = rawData19 & 0xf;
  const d2 = (rawData19 >>> 4) & 0xf;
  const d3 = (rawData19 >>> 8) & 0xf;
  const d4 = (rawData19 >>> 12) & 0xf;
  const d5 = (rawData19 >>> 16) & 0x7;
  const bcdDigits: [number, number, number, number, number] = [d5, d4, d3, d2, d1];

  const invalidBcdDigits: number[] = [];
  if (d1 > 9) invalidBcdDigits.push(1);
  if (d2 > 9) invalidBcdDigits.push(2);
  if (d3 > 9) invalidBcdDigits.push(3);
  if (d4 > 9) invalidBcdDigits.push(4);
  const bcdValid = invalidBcdDigits.length === 0;

  let engineeringValue: number;
  if (encoding === "BNR") {
    const res =
      labelDef?.resolution ?? (labelDef?.range !== undefined ? labelDef.range / 262144 : (std?.resolution ?? 1));
    engineeringValue = signedData19 * res;
  } else if (encoding === "BCD") {
    const res = labelDef?.resolution ?? 1;
    const magnitude = d5 * 10000 + d4 * 1000 + d3 * 100 + d2 * 10 + d1;
    const sign = ssm === 3 ? -1 : 1;
    engineeringValue = sign * magnitude * res;
  } else {
    engineeringValue = rawData19;
  }

  return {
    rawWord: word,
    rawHex: formatArinc429Hex(word),
    wireLabelByte,
    labelValue,
    labelOctal,
    sdi,
    rawData19,
    signedData19,
    bcdDigits,
    bcdValid,
    invalidBcdDigits,
    ssm,
    ssmMeaning,
    parityBit,
    parityValid,
    encoding,
    engineeringValue,
    units: labelDef?.units ?? std?.units ?? "",
    labelName: labelDef?.name ?? std?.name ?? `LABEL_${labelOctal}`,
  };
}
