// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  decodeDescriptor16,
  encodeDescriptor16,
  lookupTableB,
  lookupTableD,
  parseBufrDescriptor,
} from "../catalog/wmo-tables.js";
import type {
  BufrDescriptor,
  BufrMessage,
  BufrObservationValue,
  BufrSubset,
  BufrTableBEntry,
  BufrTableDEntry,
} from "../types.js";

/**
 * Big-endian bit-stream writer for WMO BUFR Section 4 bit-packed payloads.
 */
export class BitWriter {
  private bytes: number[] = [];
  private currentByte = 0;
  private bitPos = 0; // 0..7 bits filled in currentByte

  public writeBits(value: number, bitWidth: number): void {
    if (bitWidth <= 0) return;
    // Handle bit widths up to 53 bits safely using BigInt
    const bigVal = BigInt(Math.trunc(value));
    for (let i = bitWidth - 1; i >= 0; i--) {
      const bit = Number((bigVal >> BigInt(i)) & 1n);
      this.currentByte = (this.currentByte << 1) | bit;
      this.bitPos++;
      if (this.bitPos === 8) {
        this.bytes.push(this.currentByte);
        this.currentByte = 0;
        this.bitPos = 0;
      }
    }
  }

  public writeAllOnes(bitWidth: number): void {
    for (let i = 0; i < bitWidth; i++) {
      this.currentByte = (this.currentByte << 1) | 1;
      this.bitPos++;
      if (this.bitPos === 8) {
        this.bytes.push(this.currentByte);
        this.currentByte = 0;
        this.bitPos = 0;
      }
    }
  }

  public writeString(text: string, bitWidth: number): void {
    const byteLen = Math.floor(bitWidth / 8);
    for (let i = 0; i < byteLen; i++) {
      const ch = i < text.length ? text.charCodeAt(i) & 0x7f : 0x20; // space-padded CCITT IA5
      this.writeBits(ch, 8);
    }
  }

  public finish(): Uint8Array {
    if (this.bitPos > 0) {
      this.bytes.push(this.currentByte << (8 - this.bitPos));
      this.currentByte = 0;
      this.bitPos = 0;
    }
    return Uint8Array.from(this.bytes);
  }
}

/**
 * Big-endian bit-stream reader for WMO BUFR Section 4 bit-packed payloads.
 */
export class BitReader {
  private readonly data: Uint8Array;
  private bitOffset = 0;

  constructor(data: Uint8Array, byteOffset = 0) {
    this.data = data;
    this.bitOffset = byteOffset * 8;
  }

  public get remainingBits(): number {
    return this.data.length * 8 - this.bitOffset;
  }

  public readBits(bitWidth: number): { value: number; isMissing: boolean } {
    if (bitWidth <= 0) return { value: 0, isMissing: false };
    let acc = 0n;
    let allOnes = true;
    for (let i = 0; i < bitWidth; i++) {
      const byteIdx = this.bitOffset >> 3;
      const bitIdx = 7 - (this.bitOffset & 7);
      const bit = byteIdx < this.data.length ? (this.data[byteIdx]! >> bitIdx) & 1 : 0;
      if (bit === 0) allOnes = false;
      acc = (acc << 1n) | BigInt(bit);
      this.bitOffset++;
    }
    return {
      value: Number(acc),
      isMissing: bitWidth > 1 && allOnes,
    };
  }

  public readString(bitWidth: number): string | null {
    const byteLen = Math.floor(bitWidth / 8);
    let out = "";
    let allFF = byteLen > 0;
    for (let i = 0; i < byteLen; i++) {
      const { value } = this.readBits(8);
      if (value !== 0xff) allFF = false;
      out += String.fromCharCode(value & 0x7f);
    }
    return allFF ? null : out.trimEnd();
  }
}

function writeUInt24BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 16) & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = value & 0xff;
}

function readUInt24BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset]! << 16) | (buf[offset + 1]! << 8) | buf[offset + 2]!) >>> 0;
}

function writeUInt16BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 8) & 0xff;
  buf[offset + 1] = value & 0xff;
}

function readUInt16BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset]! << 8) | buf[offset + 1]!) >>> 0;
}

interface BinaryCodecContext {
  customTableB?: ReadonlyMap<string, BufrTableBEntry>;
  customTableD?: ReadonlyMap<string, BufrTableDEntry>;
}

/**
 * Encodes a `BufrMessage` into a standards-compliant WMO BUFR Edition 3 or Edition 4 binary `Uint8Array`.
 */
export function encodeBufrBinary(message: BufrMessage): Uint8Array {
  const edition = message.section0.edition === 3 ? 3 : 4;
  const s1 = message.section1;
  const s3 = message.section3;

  // Section 1: 18 bytes (Ed. 3) or 22 bytes (Ed. 4)
  const sec1Len = edition === 3 ? 18 : 22;
  const sec1 = new Uint8Array(sec1Len);
  writeUInt24BE(sec1, 0, sec1Len);
  sec1[3] = s1.masterTable & 0xff;
  if (edition === 3) {
    sec1[4] = s1.originatingSubCentre & 0xff;
    sec1[5] = s1.originatingCentre & 0xff;
    sec1[6] = s1.updateSequence & 0xff;
    sec1[7] = s1.optionalSection ? 0x80 : 0x00;
    sec1[8] = s1.dataCategory & 0xff;
    sec1[9] = s1.localSubCategory & 0xff;
    sec1[10] = s1.masterTableVersion & 0xff;
    sec1[11] = s1.localTableVersion & 0xff;
    sec1[12] = (s1.year % 100) & 0xff;
    sec1[13] = s1.month & 0xff;
    sec1[14] = s1.day & 0xff;
    sec1[15] = s1.hour & 0xff;
    sec1[16] = s1.minute & 0xff;
    sec1[17] = 0;
  } else {
    writeUInt16BE(sec1, 4, s1.originatingCentre);
    writeUInt16BE(sec1, 6, s1.originatingSubCentre);
    sec1[8] = s1.updateSequence & 0xff;
    sec1[9] = s1.optionalSection ? 0x80 : 0x00;
    sec1[10] = s1.dataCategory & 0xff;
    sec1[11] = s1.internationalSubCategory & 0xff;
    sec1[12] = s1.localSubCategory & 0xff;
    sec1[13] = s1.masterTableVersion & 0xff;
    sec1[14] = s1.localTableVersion & 0xff;
    writeUInt16BE(sec1, 15, s1.year);
    sec1[17] = s1.month & 0xff;
    sec1[18] = s1.day & 0xff;
    sec1[19] = s1.hour & 0xff;
    sec1[20] = s1.minute & 0xff;
    sec1[21] = s1.second & 0xff;
  }

  // Section 3: 7 bytes header + 2 * N descriptors (+1 pad byte for Ed. 3 even-octet alignment)
  const rawSec3Len = 7 + s3.descriptors.length * 2;
  const sec3Len = edition === 3 && rawSec3Len % 2 === 1 ? rawSec3Len + 1 : rawSec3Len;
  const sec3 = new Uint8Array(sec3Len);
  writeUInt24BE(sec3, 0, sec3Len);
  sec3[3] = 0; // reserved
  const subsetCount = message.subsets.length;
  writeUInt16BE(sec3, 4, subsetCount);
  sec3[6] = (s3.isObserved ? 0x80 : 0x00) | (s3.isCompressed ? 0x40 : 0x00);
  for (let i = 0; i < s3.descriptors.length; i++) {
    const d = s3.descriptors[i]!;
    writeUInt16BE(sec3, 7 + i * 2, encodeDescriptor16(d.f, d.x, d.y));
  }

  // Section 4: bit-packed subset values
  const writer = new BitWriter();
  for (const subset of message.subsets) {
    let valCursor = 0;
    let addWidth = 0;
    let addScale = 0;

    const encodeList = (list: readonly BufrDescriptor[]): void => {
      let i = 0;
      while (i < list.length) {
        const d = list[i]!;
        i++;
        if (d.f === 0) {
          const entry = lookupTableB(d.code, message.customTableB);
          const obs = subset.values[valCursor];
          valCursor++;
          const isDelay = d.x === 31 && (d.y === 1 || d.y === 2);
          const bitWidth = entry
            ? entry.isString || isDelay
              ? entry.bitWidth
              : Math.max(1, entry.bitWidth + addWidth)
            : 16;
          const scale = entry ? (entry.isString || isDelay ? entry.scale : entry.scale + addScale) : 0;
          const refVal = entry ? entry.referenceValue : 0;

          if (!obs || obs.value === null || obs.value === undefined) {
            writer.writeAllOnes(bitWidth);
          } else if (entry?.isString || typeof obs.value === "string") {
            writer.writeString(String(obs.value), bitWidth);
          } else {
            const factor = Math.pow(10, scale);
            const packed = Math.round(obs.value * factor) - refVal;
            const maxAllowed = Math.pow(2, bitWidth) - 2;
            const clamped = Math.max(0, Math.min(maxAllowed, packed));
            writer.writeBits(clamped, bitWidth);
          }
        } else if (d.f === 1) {
          const numDesc = d.x;
          let reps = d.y;
          if (reps === 0) {
            const factorDesc = list[i];
            i++;
            const factorEntry = factorDesc ? lookupTableB(factorDesc.code, message.customTableB) : undefined;
            const factorWidth = factorEntry?.bitWidth ?? 8;
            const obs = subset.values[valCursor];
            valCursor++;
            reps = typeof obs?.value === "number" ? Math.max(0, Math.round(obs.value)) : 0;
            writer.writeBits(reps, factorWidth);
          }
          const slice = list.slice(i, i + numDesc);
          i += numDesc;
          for (let r = 0; r < reps; r++) {
            encodeList(slice);
          }
        } else if (d.f === 2) {
          if (d.x === 1) addWidth = d.y === 0 ? 0 : d.y - 128;
          else if (d.x === 2) addScale = d.y === 0 ? 0 : d.y - 128;
          else if (d.x === 5) {
            const obs = subset.values[valCursor];
            valCursor++;
            writer.writeString(obs?.value ? String(obs.value) : "", d.y * 8);
          }
        } else if (d.f === 3) {
          const seqEntry = lookupTableD(d.code, message.customTableD);
          if (seqEntry) {
            const children = seqEntry.descriptors
              .map((c) => parseBufrDescriptor(c))
              .filter((x): x is BufrDescriptor => x !== null);
            encodeList(children);
          }
        }
      }
    };

    encodeList(s3.descriptors);
  }

  const payload = writer.finish();
  const rawSec4Len = 4 + payload.length;
  const sec4Len = edition === 3 && rawSec4Len % 2 === 1 ? rawSec4Len + 1 : rawSec4Len;
  const sec4 = new Uint8Array(sec4Len);
  writeUInt24BE(sec4, 0, sec4Len);
  sec4[3] = 0;
  sec4.set(payload, 4);

  // Section 0 (8 bytes) & Section 5 (4 bytes "7777")
  const totalLength = 8 + sec1Len + sec3Len + sec4Len + 4;
  const out = new Uint8Array(totalLength);

  // Section 0: "BUFR" + 24-bit totalLength + edition
  out[0] = 0x42; // B
  out[1] = 0x55; // U
  out[2] = 0x46; // F
  out[3] = 0x52; // R
  writeUInt24BE(out, 4, totalLength);
  out[7] = edition;

  let pos = 8;
  out.set(sec1, pos);
  pos += sec1Len;
  out.set(sec3, pos);
  pos += sec3Len;
  out.set(sec4, pos);
  pos += sec4Len;

  // Section 5: "7777"
  out[pos] = 0x37;
  out[pos + 1] = 0x37;
  out[pos + 2] = 0x37;
  out[pos + 3] = 0x37;

  return out;
}

/**
 * Decodes a binary WMO BUFR Edition 3 or Edition 4 `Uint8Array` into a `BufrMessage`.
 */
export function decodeBufrBinary(bytes: Uint8Array, ctx: BinaryCodecContext = {}): BufrMessage {
  const customTableB = new Map(ctx.customTableB ?? []);
  const customTableD = new Map(ctx.customTableD ?? []);
  const syntaxErrors: Array<{ message: string; line: number; column: number }> = [];

  if (bytes.length < 12) {
    throw new Error(`BUFR binary buffer too short (${bytes.length} bytes)`);
  }

  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== "BUFR") {
    throw new Error(`Invalid BUFR magic header '${magic}' (expected 'BUFR')`);
  }

  const totalLength = readUInt24BE(bytes, 4);
  const editionRaw = bytes[7]!;
  if (editionRaw !== 3 && editionRaw !== 4) {
    throw new Error(`Unsupported BUFR binary edition '${editionRaw}' (expected 3 or 4)`);
  }
  const edition: 3 | 4 = editionRaw;

  // Section 1
  let pos = 8;
  const sec1Len = readUInt24BE(bytes, pos);
  const masterTable = bytes[pos + 3]!;
  let originatingCentre: number;
  let originatingSubCentre: number;
  let updateSequence: number;
  let optionalSection: boolean;
  let dataCategory: number;
  let internationalSubCategory = 0;
  let localSubCategory: number;
  let masterTableVersion: number;
  let localTableVersion: number;
  let year: number;
  let month: number;
  let day: number;
  let hour: number;
  let minute: number;
  let second = 0;

  if (edition === 3) {
    originatingSubCentre = bytes[pos + 4]!;
    originatingCentre = bytes[pos + 5]!;
    updateSequence = bytes[pos + 6]!;
    optionalSection = (bytes[pos + 7]! & 0x80) !== 0;
    dataCategory = bytes[pos + 8]!;
    localSubCategory = bytes[pos + 9]!;
    masterTableVersion = bytes[pos + 10]!;
    localTableVersion = bytes[pos + 11]!;
    const yr2 = bytes[pos + 12]!;
    year = yr2 >= 80 ? 1900 + yr2 : 2000 + yr2;
    month = bytes[pos + 13]!;
    day = bytes[pos + 14]!;
    hour = bytes[pos + 15]!;
    minute = bytes[pos + 16]!;
  } else {
    originatingCentre = readUInt16BE(bytes, pos + 4);
    originatingSubCentre = readUInt16BE(bytes, pos + 6);
    updateSequence = bytes[pos + 8]!;
    optionalSection = (bytes[pos + 9]! & 0x80) !== 0;
    dataCategory = bytes[pos + 10]!;
    internationalSubCategory = bytes[pos + 11]!;
    localSubCategory = bytes[pos + 12]!;
    masterTableVersion = bytes[pos + 13]!;
    localTableVersion = bytes[pos + 14]!;
    year = readUInt16BE(bytes, pos + 15);
    month = bytes[pos + 17]!;
    day = bytes[pos + 18]!;
    hour = bytes[pos + 19]!;
    minute = bytes[pos + 20]!;
    second = bytes[pos + 21]!;
  }
  pos += sec1Len;

  // Optional Section 2
  if (optionalSection && pos + 3 <= bytes.length) {
    const sec2Len = readUInt24BE(bytes, pos);
    pos += sec2Len;
  }

  // Section 3
  const sec3Len = readUInt24BE(bytes, pos);
  const subsetCount = readUInt16BE(bytes, pos + 4);
  const flags = bytes[pos + 6]!;
  const isObserved = (flags & 0x80) !== 0;
  const isCompressed = (flags & 0x40) !== 0;
  const descriptors: BufrDescriptor[] = [];
  const descCount = Math.floor((sec3Len - 7) / 2);
  for (let i = 0; i < descCount; i++) {
    const word = readUInt16BE(bytes, pos + 7 + i * 2);
    // Skip trailing 0x0000 padding in Edition 3 if at last word and sec3Len was padded
    if (word === 0 && edition === 3 && i === descCount - 1) continue;
    descriptors.push(decodeDescriptor16(word));
  }
  pos += sec3Len;

  // Section 4
  const sec4Len = readUInt24BE(bytes, pos);
  const sec4Data = bytes.subarray(pos + 4, pos + sec4Len);
  pos += sec4Len;

  // Section 5
  const endMarker =
    pos + 4 <= bytes.length ? String.fromCharCode(bytes[pos]!, bytes[pos + 1]!, bytes[pos + 2]!, bytes[pos + 3]!) : "";
  const hasEndMarker = endMarker === "7777";

  // Unpack subsets from Section 4 bit stream
  const reader = new BitReader(sec4Data, 0);
  const subsets: BufrSubset[] = [];

  for (let s = 0; s < subsetCount; s++) {
    const values: BufrObservationValue[] = [];
    let addWidth = 0;
    let addScale = 0;

    const decodeList = (list: readonly BufrDescriptor[]): void => {
      let i = 0;
      while (i < list.length) {
        const d = list[i]!;
        i++;
        if (d.f === 0) {
          const entry = lookupTableB(d.code, customTableB);
          const isDelay = d.x === 31 && (d.y === 1 || d.y === 2);
          const bitWidth = entry
            ? entry.isString || isDelay
              ? entry.bitWidth
              : Math.max(1, entry.bitWidth + addWidth)
            : 16;
          const scale = entry ? (entry.isString || isDelay ? entry.scale : entry.scale + addScale) : 0;
          const refVal = entry ? entry.referenceValue : 0;

          if (entry?.isString) {
            const strVal = reader.readString(bitWidth);
            values.push({ descriptor: d.code, name: entry.name, value: strVal, unit: entry.unit });
          } else {
            const { value: rawBits, isMissing } = reader.readBits(bitWidth);
            if (isMissing) {
              values.push({ descriptor: d.code, name: entry?.name, value: null, unit: entry?.unit });
            } else {
              const phys = (rawBits + refVal) / Math.pow(10, scale);
              values.push({ descriptor: d.code, name: entry?.name, value: phys, unit: entry?.unit });
            }
          }
        } else if (d.f === 1) {
          const numDesc = d.x;
          let reps = d.y;
          if (reps === 0) {
            const factorDesc = list[i];
            i++;
            const factorEntry = factorDesc ? lookupTableB(factorDesc.code, customTableB) : undefined;
            const factorWidth = factorEntry?.bitWidth ?? 8;
            const { value: countVal, isMissing } = reader.readBits(factorWidth);
            reps = isMissing ? 0 : countVal;
            if (factorDesc) {
              values.push({
                descriptor: factorDesc.code,
                name: factorEntry?.name,
                value: reps,
                unit: factorEntry?.unit,
              });
            }
          }
          const slice = list.slice(i, i + numDesc);
          i += numDesc;
          for (let r = 0; r < reps; r++) {
            decodeList(slice);
          }
        } else if (d.f === 2) {
          if (d.x === 1) addWidth = d.y === 0 ? 0 : d.y - 128;
          else if (d.x === 2) addScale = d.y === 0 ? 0 : d.y - 128;
          else if (d.x === 5) {
            const strVal = reader.readString(d.y * 8);
            values.push({ descriptor: d.code, name: "Signify character", value: strVal, unit: "CCITT IA5" });
          }
        } else if (d.f === 3) {
          const seqEntry = lookupTableD(d.code, customTableD);
          if (seqEntry) {
            const children = seqEntry.descriptors
              .map((c) => parseBufrDescriptor(c))
              .filter((x): x is BufrDescriptor => x !== null);
            decodeList(children);
          }
        }
      }
    };

    decodeList(descriptors);
    subsets.push({ index: s + 1, label: `SUBSET_${s + 1}`, values });
  }

  return {
    name: `BUFR_ED${edition}_C${originatingCentre}`,
    section0: { magic, totalLength, edition },
    section1: {
      masterTable,
      originatingCentre,
      originatingSubCentre,
      updateSequence,
      optionalSection,
      dataCategory,
      internationalSubCategory,
      localSubCategory,
      masterTableVersion,
      localTableVersion,
      year,
      month,
      day,
      hour,
      minute,
      second,
    },
    section3: { subsetCount, isObserved, isCompressed, descriptors },
    subsets,
    customTableB,
    customTableD,
    hasEndMarker,
    hasMagicHeader: true,
    syntaxErrors,
  };
}
