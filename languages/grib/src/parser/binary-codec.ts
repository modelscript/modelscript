// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/grib — WMO GRIB Edition 1 Binary Stream Codec.
 *
 * Implements complete binary encoding and decoding per WMO FM 92-VIII Ext. GRIB (1985):
 * - Section 0: Indicator Section (IS) — `"GRIB"` + 3-byte total length + 1-byte edition (1)
 * - Section 1: Product Definition Section (PDS) — 28+ bytes
 * - Section 2: Grid Definition Section (GDS) — 32 bytes (Lat/Lon equidistant cylindrical)
 * - Section 3: Bit-Map Section (BMS) — optional MSB-first presence mask
 * - Section 4: Binary Data Section (BDS) — IBM System/360 32-bit float R + binary scale E + arbitrary bit-width packing
 * - Section 5: End Section — `"7777"`
 */

import { lookupWmoLevelType, lookupWmoParameterByCode } from "../catalog/grib-std-schemas.js";
import { packGrib1Values, unpackGrib1Values } from "../solver/packing.js";
import type {
  GribBinaryDataSection,
  GribBitmapSection,
  GribDocument,
  GribGridDefinitionSection,
  GribMessage,
  GribProductDefinitionSection,
} from "../types.js";

/**
 * Decodes an IBM System/360 32-bit base-16 floating-point word into an IEEE 754 JS number.
 *   value = (-1)^s * 16^(A - 64) * (B / 2^24)
 */
export function decodeIbmFloat32(word: number): number {
  const u = word >>> 0;
  if (u === 0) return 0;
  const sign = (u >>> 31) & 1;
  const exponent = (u >>> 24) & 0x7f;
  const mantissa = u & 0x00ffffff;
  if (mantissa === 0) return 0;
  const mag = (mantissa / 0x1000000) * Math.pow(16, exponent - 64);
  return sign ? -mag : mag;
}

/**
 * Encodes an IEEE 754 JS number into an IBM System/360 32-bit base-16 floating-point word.
 */
export function encodeIbmFloat32(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  const sign = value < 0 ? 1 : 0;
  const absVal = Math.abs(value);

  // Determine base-16 exponent such that 1/16 <= absVal / 16^exp16 < 1
  let exp16 = Math.floor(Math.log(absVal) / Math.LN2 / 4) + 1;
  let frac = absVal / Math.pow(16, exp16);
  while (frac >= 1) {
    exp16 += 1;
    frac /= 16;
  }
  while (frac < 1 / 16 && exp16 > -64) {
    exp16 -= 1;
    frac *= 16;
  }

  let mantissa = Math.round(frac * 0x1000000);
  if (mantissa >= 0x1000000) {
    exp16 += 1;
    mantissa = Math.round(mantissa / 16);
  }

  let biasedExp = exp16 + 64;
  if (biasedExp < 0) {
    return 0;
  }
  if (biasedExp > 127) {
    biasedExp = 127;
    mantissa = 0x00ffffff;
  }

  return ((sign << 31) | ((biasedExp & 0x7f) << 24) | (mantissa & 0x00ffffff)) >>> 0;
}

/** Reads a 24-bit unsigned big-endian integer from `buf` at `offset`. */
function readUInt24BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset]! << 16) | (buf[offset + 1]! << 8) | buf[offset + 2]!) >>> 0;
}

/** Writes a 24-bit unsigned big-endian integer into `buf` at `offset`. */
function writeUInt24BE(buf: Uint8Array, offset: number, value: number): void {
  const v = Math.max(0, Math.min(0xffffff, Math.trunc(value)));
  buf[offset] = (v >>> 16) & 0xff;
  buf[offset + 1] = (v >>> 8) & 0xff;
  buf[offset + 2] = v & 0xff;
}

/** Reads a 16-bit unsigned big-endian integer from `buf` at `offset`. */
function readUInt16BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset]! << 8) | buf[offset + 1]!) >>> 0;
}

/** Writes a 16-bit unsigned big-endian integer into `buf` at `offset`. */
function writeUInt16BE(buf: Uint8Array, offset: number, value: number): void {
  const v = Math.max(0, Math.min(0xffff, Math.trunc(value)));
  buf[offset] = (v >>> 8) & 0xff;
  buf[offset + 1] = v & 0xff;
}

/** Reads a GRIB1 16-bit sign-magnitude integer (bit 15 = sign, bits 14..0 = magnitude). */
export function readSignMag16(buf: Uint8Array, offset: number): number {
  const raw = readUInt16BE(buf, offset);
  const mag = raw & 0x7fff;
  return (raw & 0x8000) !== 0 ? -mag : mag;
}

/** Writes a GRIB1 16-bit sign-magnitude integer. */
export function writeSignMag16(buf: Uint8Array, offset: number, value: number): void {
  const neg = value < 0;
  const mag = Math.min(0x7fff, Math.abs(Math.trunc(value)));
  const raw = neg ? 0x8000 | mag : mag;
  writeUInt16BE(buf, offset, raw);
}

/** Reads a GRIB1 24-bit sign-magnitude integer (bit 23 = sign, bits 22..0 = magnitude). */
export function readSignMag24(buf: Uint8Array, offset: number): number {
  const raw = readUInt24BE(buf, offset);
  const mag = raw & 0x7fffff;
  return (raw & 0x800000) !== 0 ? -mag : mag;
}

/** Writes a GRIB1 24-bit sign-magnitude integer. */
export function writeSignMag24(buf: Uint8Array, offset: number, value: number): void {
  const neg = value < 0;
  const mag = Math.min(0x7fffff, Math.abs(Math.trunc(value)));
  const raw = neg ? 0x800000 | mag : mag;
  writeUInt24BE(buf, offset, raw);
}

/** Reads a 32-bit unsigned big-endian integer. */
function readUInt32BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset]! << 24) | (buf[offset + 1]! << 16) | (buf[offset + 2]! << 8) | buf[offset + 3]!) >>> 0;
}

/** Writes a 32-bit unsigned big-endian integer. */
function writeUInt32BE(buf: Uint8Array, offset: number, value: number): void {
  const v = value >>> 0;
  buf[offset] = (v >>> 24) & 0xff;
  buf[offset + 1] = (v >>> 16) & 0xff;
  buf[offset + 2] = (v >>> 8) & 0xff;
  buf[offset + 3] = v & 0xff;
}

/**
 * Unpacks `count` MSB-first unsigned integers of width `bitsPerValue` (0..32) from `bytes`.
 */
export function unpackBitsMSB(bytes: Uint8Array, bitsPerValue: number, count: number): number[] {
  const out = new Array<number>(count);
  if (bitsPerValue === 0) {
    out.fill(0);
    return out;
  }
  let bitPos = 0;
  for (let i = 0; i < count; i++) {
    let val = 0;
    for (let b = 0; b < bitsPerValue; b++) {
      const byteIdx = bitPos >>> 3;
      const bitIdx = 7 - (bitPos & 7);
      const bit = byteIdx < bytes.length ? (bytes[byteIdx]! >>> bitIdx) & 1 : 0;
      val = val * 2 + bit;
      bitPos++;
    }
    out[i] = val;
  }
  return out;
}

/**
 * Packs unsigned integers `values` of width `bitsPerValue` (0..32) MSB-first into a byte array.
 */
export function packBitsMSB(
  values: readonly number[],
  bitsPerValue: number,
): { bytes: Uint8Array; unusedBits: number } {
  if (bitsPerValue === 0 || values.length === 0) {
    return { bytes: new Uint8Array(0), unusedBits: 0 };
  }
  const totalBits = values.length * bitsPerValue;
  const totalBytes = Math.ceil(totalBits / 8);
  const unusedBits = totalBytes * 8 - totalBits;
  const bytes = new Uint8Array(totalBytes);

  let bitPos = 0;
  for (let i = 0; i < values.length; i++) {
    const v = Math.max(0, Math.trunc(values[i]!));
    for (let b = bitsPerValue - 1; b >= 0; b--) {
      const bit = Math.floor(v / Math.pow(2, b)) % 2;
      if (bit !== 0) {
        const byteIdx = bitPos >>> 3;
        const bitIdx = 7 - (bitPos & 7);
        bytes[byteIdx] = bytes[byteIdx]! | (1 << bitIdx);
      }
      bitPos++;
    }
  }
  return { bytes, unusedBits };
}

function ascii4(buf: Uint8Array, offset: number): string {
  if (offset + 4 > buf.length) return "";
  return String.fromCharCode(buf[offset]!, buf[offset + 1]!, buf[offset + 2]!, buf[offset + 3]!);
}

/**
 * Decodes a binary WMO GRIB Edition 1 byte stream (supporting concatenated multi-message files).
 */
export function decodeGrib1Binary(data: Uint8Array, uri?: string): GribDocument {
  const messages: GribMessage[] = [];
  const syntaxErrors: Array<{ message: string; line: number; column: number }> = [];
  let offset = 0;
  let msgIdx = 0;

  while (offset < data.length) {
    // Scan forward for "GRIB" magic header
    let found = -1;
    for (let p = offset; p + 4 <= data.length; p++) {
      if (data[p] === 0x47 && data[p + 1] === 0x52 && data[p + 2] === 0x49 && data[p + 3] === 0x42) {
        found = p;
        break;
      }
    }
    if (found < 0) {
      if (messages.length === 0) {
        syntaxErrors.push({ message: "No 'GRIB' magic header found in binary stream", line: 1, column: 1 });
      }
      break;
    }

    const msgStart = found;
    if (msgStart + 8 > data.length) {
      syntaxErrors.push({ message: "Truncated GRIB Indicator Section (< 8 bytes)", line: 1, column: 1 });
      break;
    }

    const magic = ascii4(data, msgStart);
    const totalLength = readUInt24BE(data, msgStart + 4);
    const edition = data[msgStart + 7]!;
    const msgEnd = Math.min(data.length, msgStart + totalLength);
    const truncated = msgStart + totalLength > data.length;

    const parseErrors: string[] = [];
    if (edition !== 1) {
      parseErrors.push(`Unsupported GRIB edition ${edition}`);
      messages.push({
        index: msgIdx++,
        indicator: { magic, totalLength, edition },
        end: { magic: "", present: false },
        parseErrors,
        truncated,
      });
      offset = Math.max(msgStart + 8, msgEnd);
      continue;
    }

    let pos = msgStart + 8;

    // Section 1: Product Definition Section (PDS)
    let pds: GribProductDefinitionSection | undefined;
    if (pos + 28 <= msgEnd) {
      const pdsLen = readUInt24BE(data, pos);
      const tableVersion = data[pos + 3]!;
      const centerId = data[pos + 4]!;
      const generatingProcessId = data[pos + 5]!;
      const gridId = data[pos + 6]!;
      const sectionFlags = data[pos + 7]!;
      const hasGds = (sectionFlags & 0x80) !== 0;
      const hasBms = (sectionFlags & 0x40) !== 0;
      const parameterCode = data[pos + 8]!;
      const levelType = data[pos + 9]!;
      const levelValue = readUInt16BE(data, pos + 10);
      const yearOfCentury = data[pos + 12]!;
      const month = data[pos + 13]!;
      const day = data[pos + 14]!;
      const hour = data[pos + 15]!;
      const minute = data[pos + 16]!;
      const timeUnit = data[pos + 17]!;
      const p1 = data[pos + 18]!;
      const p2 = data[pos + 19]!;
      const timeRangeIndicator = data[pos + 20]!;
      const century = data[pos + 24]!;
      const subCenterId = data[pos + 25]!;
      const decimalScaleFactor = readSignMag16(data, pos + 26);

      const fullYear = century > 0 ? (century - 1) * 100 + yearOfCentury : yearOfCentury;
      const paramMeta = lookupWmoParameterByCode(parameterCode);
      const levelMeta = lookupWmoLevelType(levelType);

      pds = {
        tableVersion,
        centerId,
        generatingProcessId,
        gridId,
        hasGds,
        hasBms,
        parameterCode,
        parameterName: paramMeta?.mnemonic,
        levelType,
        levelName: levelMeta?.mnemonic,
        levelValue,
        year: fullYear,
        month,
        day,
        hour,
        minute,
        timeUnit,
        p1,
        p2,
        timeRangeIndicator,
        century,
        subCenterId,
        decimalScaleFactor,
      };
      pos += Math.max(28, pdsLen);
    }

    // Section 2: Grid Definition Section (GDS)
    let gds: GribGridDefinitionSection | undefined;
    if (pds?.hasGds && pos + 32 <= msgEnd) {
      const gdsLen = readUInt24BE(data, pos);
      const dataRepresentationType = data[pos + 5]!;
      const ni = readUInt16BE(data, pos + 6);
      const nj = readUInt16BE(data, pos + 8);
      const la1 = readSignMag24(data, pos + 10) / 1000;
      const lo1 = readSignMag24(data, pos + 13) / 1000;
      const resolutionFlags = data[pos + 16]!;
      const la2 = readSignMag24(data, pos + 17) / 1000;
      const lo2 = readSignMag24(data, pos + 20) / 1000;
      const di = readUInt16BE(data, pos + 23) / 1000;
      const dj = readUInt16BE(data, pos + 25) / 1000;
      const scanningMode = data[pos + 27]!;

      gds = {
        dataRepresentationType,
        ni,
        nj,
        la1,
        lo1,
        resolutionFlags,
        la2,
        lo2,
        di,
        dj,
        scanningMode,
      };
      pos += Math.max(32, gdsLen);
    }

    // Section 3: Bit-Map Section (BMS)
    let bms: GribBitmapSection | undefined;
    if (pds?.hasBms && pos + 6 <= msgEnd) {
      const bmsLen = readUInt24BE(data, pos);
      const unusedBits = data[pos + 3]!;
      const tableReference = readUInt16BE(data, pos + 4);
      const bitmapBytes = data.subarray(pos + 6, Math.min(msgEnd, pos + bmsLen));
      const totalBits = Math.max(0, bitmapBytes.length * 8 - unusedBits);
      const bitmap = new Array<boolean>(totalBits);
      for (let k = 0; k < totalBits; k++) {
        const byteIdx = k >>> 3;
        const bitIdx = 7 - (k & 7);
        bitmap[k] = ((bitmapBytes[byteIdx]! >>> bitIdx) & 1) === 1;
      }
      bms = { unusedBits, tableReference, bitmap };
      pos += Math.max(6, bmsLen);
    }

    // Section 4: Binary Data Section (BDS)
    let bds: GribBinaryDataSection | undefined;
    if (pos + 11 <= msgEnd) {
      const bdsLen = readUInt24BE(data, pos);
      const flagByte = data[pos + 3]!;
      const flags = (flagByte >>> 4) & 0x0f;
      const unusedBits = flagByte & 0x0f;
      const binaryScaleFactor = readSignMag16(data, pos + 4);
      const refWord = readUInt32BE(data, pos + 6);
      const referenceValue = decodeIbmFloat32(refWord);
      const bitsPerValue = data[pos + 10]!;

      const payloadEnd = Math.min(msgEnd, pos + bdsLen);
      const payload = data.subarray(pos + 11, payloadEnd);

      let expectedCount: number;
      if (bms) {
        expectedCount = bms.bitmap.reduce((acc, present) => acc + (present ? 1 : 0), 0);
      } else if (gds) {
        expectedCount = gds.ni * gds.nj;
      } else if (bitsPerValue > 0) {
        expectedCount = Math.floor(Math.max(0, payload.length * 8 - unusedBits) / bitsPerValue);
      } else {
        expectedCount = 0;
      }

      const packedValues = unpackBitsMSB(payload, bitsPerValue, expectedCount);
      const decimalScaleFactor = pds?.decimalScaleFactor ?? 0;
      const unpackedActive = unpackGrib1Values(referenceValue, packedValues, binaryScaleFactor, decimalScaleFactor);

      let values = unpackedActive;
      if (bms && bms.bitmap.length > 0) {
        values = new Array<number>(bms.bitmap.length);
        let activeIdx = 0;
        for (let k = 0; k < bms.bitmap.length; k++) {
          values[k] = bms.bitmap[k] ? (unpackedActive[activeIdx++] ?? NaN) : NaN;
        }
      }

      bds = {
        flags,
        binaryScaleFactor,
        referenceValue,
        bitsPerValue,
        values,
        packedValues,
      };
      pos += Math.max(11, bdsLen);
    }

    // Section 5: End Section ("7777")
    const endMagic = pos + 4 <= msgEnd ? ascii4(data, pos) : "";
    const endPresent = endMagic === "7777";

    messages.push({
      index: msgIdx++,
      indicator: { magic, totalLength, edition },
      pds,
      gds,
      bms,
      bds,
      end: { magic: endPresent ? "7777" : endMagic, present: endPresent },
      parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
      truncated,
    });

    offset = Math.max(msgStart + 8, msgStart + totalLength);
  }

  return {
    uri,
    isBinary: true,
    messages,
    syntaxErrors,
  };
}

/**
 * Encodes a single `GribMessage` into a compliant WMO GRIB Edition 1 binary `Uint8Array`.
 */
export function encodeGrib1Message(msg: GribMessage): Uint8Array {
  const pds = msg.pds;
  if (!pds) {
    throw new Error("Cannot encode GRIB1 message without PDS.");
  }
  const bds = msg.bds;
  if (!bds) {
    throw new Error("Cannot encode GRIB1 message without BDS.");
  }

  const hasGds = Boolean(msg.gds);
  const hasBms = Boolean(msg.bms && msg.bms.bitmap.length > 0);

  // Section 1: PDS (28 bytes)
  const pdsBytes = new Uint8Array(28);
  writeUInt24BE(pdsBytes, 0, 28);
  pdsBytes[3] = pds.tableVersion & 0xff;
  pdsBytes[4] = pds.centerId & 0xff;
  pdsBytes[5] = pds.generatingProcessId & 0xff;
  pdsBytes[6] = pds.gridId & 0xff;
  pdsBytes[7] = (hasGds ? 0x80 : 0) | (hasBms ? 0x40 : 0);
  pdsBytes[8] = pds.parameterCode & 0xff;
  pdsBytes[9] = pds.levelType & 0xff;
  writeUInt16BE(pdsBytes, 10, pds.levelValue);

  const fullYear = pds.year >= 100 ? pds.year : pds.century > 0 ? (pds.century - 1) * 100 + pds.year : 2000 + pds.year;
  const century = Math.floor((fullYear - 1) / 100) + 1;
  const yearOfCentury = fullYear - (century - 1) * 100;

  pdsBytes[12] = yearOfCentury & 0xff;
  pdsBytes[13] = pds.month & 0xff;
  pdsBytes[14] = pds.day & 0xff;
  pdsBytes[15] = pds.hour & 0xff;
  pdsBytes[16] = pds.minute & 0xff;
  pdsBytes[17] = pds.timeUnit & 0xff;
  pdsBytes[18] = pds.p1 & 0xff;
  pdsBytes[19] = pds.p2 & 0xff;
  pdsBytes[20] = pds.timeRangeIndicator & 0xff;
  writeUInt16BE(pdsBytes, 21, 0);
  pdsBytes[23] = 0;
  pdsBytes[24] = century & 0xff;
  pdsBytes[25] = pds.subCenterId & 0xff;
  writeSignMag16(pdsBytes, 26, pds.decimalScaleFactor);

  // Section 2: GDS (32 bytes if present)
  let gdsBytes = new Uint8Array(0);
  if (msg.gds) {
    const g = msg.gds;
    gdsBytes = new Uint8Array(32);
    writeUInt24BE(gdsBytes, 0, 32);
    gdsBytes[3] = 0; // NV
    gdsBytes[4] = 255; // PV/PL
    gdsBytes[5] = g.dataRepresentationType & 0xff;
    writeUInt16BE(gdsBytes, 6, g.ni);
    writeUInt16BE(gdsBytes, 8, g.nj);
    writeSignMag24(gdsBytes, 10, Math.round(g.la1 * 1000));
    writeSignMag24(gdsBytes, 13, Math.round(g.lo1 * 1000));
    gdsBytes[16] = g.resolutionFlags & 0xff;
    writeSignMag24(gdsBytes, 17, Math.round(g.la2 * 1000));
    writeSignMag24(gdsBytes, 20, Math.round(g.lo2 * 1000));
    writeUInt16BE(gdsBytes, 23, Math.round(Math.abs(g.di) * 1000));
    writeUInt16BE(gdsBytes, 25, Math.round(Math.abs(g.dj) * 1000));
    gdsBytes[27] = g.scanningMode & 0xff;
  }

  // Section 3: BMS (if present)
  let bmsBytes = new Uint8Array(0);
  let activeValues = bds.values;
  if (hasBms && msg.bms) {
    const bm = msg.bms.bitmap;
    const bmByteLen = Math.ceil(bm.length / 8);
    const unusedBits = bmByteLen * 8 - bm.length;
    const bmsLen = 6 + bmByteLen;
    bmsBytes = new Uint8Array(bmsLen);
    writeUInt24BE(bmsBytes, 0, bmsLen);
    bmsBytes[3] = unusedBits & 0xff;
    writeUInt16BE(bmsBytes, 4, msg.bms.tableReference);
    activeValues = [];
    for (let k = 0; k < bm.length; k++) {
      if (bm[k]) {
        const byteIdx = 6 + (k >>> 3);
        const bitIdx = 7 - (k & 7);
        bmsBytes[byteIdx] = bmsBytes[byteIdx]! | (1 << bitIdx);
        activeValues.push(bds.values[k] ?? 0);
      }
    }
  }

  // Section 4: BDS
  const bpv = Math.max(0, Math.min(32, Math.trunc(bds.bitsPerValue || 16)));
  const packed = packGrib1Values(activeValues, bpv, pds.decimalScaleFactor);
  const ibmRefWord = encodeIbmFloat32(packed.referenceValue);
  const ibmRefDecoded = decodeIbmFloat32(ibmRefWord);

  // Re-quantize packed integers against the exact IBM-rounded reference value R to minimize round-trip error
  const tenPowD = Math.pow(10, pds.decimalScaleFactor);
  const invTwoPowE = Math.pow(2, -packed.binaryScaleFactor);
  const maxInt = packed.bitsPerValue === 32 ? 0xffffffff : Math.pow(2, packed.bitsPerValue) - 1;
  const refinedPacked = packed.packedValues.map((_, idx) => {
    if (packed.bitsPerValue === 0) return 0;
    const scaled = (activeValues[idx] ?? 0) * tenPowD;
    const q = Math.round((scaled - ibmRefDecoded) * invTwoPowE);
    return Math.max(0, Math.min(maxInt, q));
  });

  const { bytes: bitPayload, unusedBits } = packBitsMSB(refinedPacked, packed.bitsPerValue);
  const bdsLen = 11 + bitPayload.length;
  const bdsBytes = new Uint8Array(bdsLen);
  writeUInt24BE(bdsBytes, 0, bdsLen);
  bdsBytes[3] = ((bds.flags & 0x0f) << 4) | (unusedBits & 0x0f);
  writeSignMag16(bdsBytes, 4, packed.binaryScaleFactor);
  writeUInt32BE(bdsBytes, 6, ibmRefWord);
  bdsBytes[10] = packed.bitsPerValue & 0xff;
  bdsBytes.set(bitPayload, 11);

  // Section 0 (IS, 8 bytes) + Section 5 (End, 4 bytes)
  const totalLength = 8 + pdsBytes.length + gdsBytes.length + bmsBytes.length + bdsBytes.length + 4;
  const out = new Uint8Array(totalLength);

  // IS: "GRIB" + totalLength (3 bytes) + edition (1)
  out[0] = 0x47; // G
  out[1] = 0x52; // R
  out[2] = 0x49; // I
  out[3] = 0x42; // B
  writeUInt24BE(out, 4, totalLength);
  out[7] = msg.indicator.edition & 0xff;

  let cursor = 8;
  out.set(pdsBytes, cursor);
  cursor += pdsBytes.length;
  out.set(gdsBytes, cursor);
  cursor += gdsBytes.length;
  out.set(bmsBytes, cursor);
  cursor += bmsBytes.length;
  out.set(bdsBytes, cursor);
  cursor += bdsBytes.length;

  // End Section: "7777"
  out[cursor] = 0x37;
  out[cursor + 1] = 0x37;
  out[cursor + 2] = 0x37;
  out[cursor + 3] = 0x37;

  return out;
}

/**
 * Encodes an entire `GribDocument` (one or more messages) into a concatenated binary GRIB1 stream.
 */
export function encodeGrib1Binary(doc: GribDocument): Uint8Array {
  const chunks = doc.messages.map((m) => encodeGrib1Message(m));
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
