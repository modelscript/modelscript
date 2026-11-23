// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — Binary NASA CDF v2/v3 Record Encoder & Decoder.
 *
 * Implements the NASA CDF Internal Format record layout (big-endian network byte order):
 * - Magic header:
 *   - CDF v3: `0xCDF30001` + `0x0000FFFF` (uncompressed)
 *   - CDF v2: `0xCDF26002` + `0x0000FFFF` (uncompressed)
 * - Records (CDF v3 uses 8-byte record size + 4-byte record type; v2 uses 4-byte size + 4-byte type):
 *   - `CDR` (type 1): CDF Descriptor Record (GDR offset, version, release, encoding, flags, copyright)
 *   - `GDR` (type 2): Global Descriptor Record (zVDR head, ADR head, numVars, numAttrs, numRDims)
 *   - `ADR` (type 4): Attribute Descriptor Record (scope, name, head AgrEDR/AzEDR)
 *   - `AgrEDR` (type 5): Attribute g/r-Entry Descriptor Record (entryNum, dataType, numElems, payload)
 *   - `VXR` (type 6): Variable Index Record (firstRec, lastRec, VVR offset)
 *   - `VVR` (type 7): Variable Values Record (raw packed IEEE-754 / integer / UTF-8 record payload)
 *   - `zVDR` (type 8): zVariable Descriptor Record (name, dataType, numElems, maxRec, dims, VXR head)
 *   - `AzEDR` (type 9): Attribute z-Entry Descriptor Record (varNum, dataType, numElems, payload)
 */

import { NasaCdfErrorCode } from "../errors.js";
import { isoToCdfEpoch } from "../solver/epoch.js";
import {
  CDF_CODE_TO_TYPE,
  CDF_TYPE_CODES,
  cdfDataTypeByteSize,
  isValidCdfDataType,
  type CdfDataType,
  type CdfDocument,
  type CdfFormatVersion,
  type CdfGlobalAttribute,
  type CdfRecordValue,
  type CdfScalarValue,
  type CdfVariable,
  type CdfVariance,
} from "../types.js";

export const CDF_MAGIC_V3 = 0xcdf30001;
export const CDF_MAGIC_V2 = 0xcdf26002;
export const CDF_MAGIC_UNCOMPRESSED = 0x0000ffff;

export const CdfRecordType = {
  CDR: 1,
  GDR: 2,
  rVDR: 3,
  ADR: 4,
  AgrEDR: 5,
  VXR: 6,
  VVR: 7,
  zVDR: 8,
  AzEDR: 9,
} as const;

const CDR_FLAG_ROW_MAJOR = 0x01;
const CDR_FLAG_SINGLE_FILE = 0x02;
const VDR_FLAG_REC_VARIANCE = 0x01;
const ADR_SCOPE_GLOBAL = 1;
const ADR_SCOPE_VARIABLE = 2;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");

export interface BinaryEncodeOptions {
  /** CDF binary format version (`"v3"` default, or `"v2"`). */
  version?: CdfFormatVersion | undefined;
}

/**
 * Checks whether a byte buffer begins with a valid NASA CDF v2 or v3 magic header.
 */
export function isCdfBinaryBuffer(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic1 = view.getUint32(0, false);
  return magic1 === CDF_MAGIC_V3 || magic1 === CDF_MAGIC_V2;
}

function writeFixedString(buf: Uint8Array, offset: number, str: string, maxBytes: number): void {
  const encoded = textEncoder.encode(str);
  const len = Math.min(encoded.length, maxBytes);
  buf.set(encoded.subarray(0, len), offset);
}

function readFixedString(bytes: Uint8Array, offset: number, maxBytes: number): string {
  const slice = bytes.subarray(offset, offset + maxBytes);
  let end = slice.length;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === 0) {
      end = i;
      break;
    }
  }
  return textDecoder.decode(slice.subarray(0, end)).trim();
}

function encodeScalarPayload(values: CdfScalarValue[], dataType: CdfDataType): Uint8Array {
  if (dataType === "CDF_CHAR" || dataType === "CDF_UCHAR") {
    const joined = values.map(String).join("\0");
    return textEncoder.encode(joined);
  }
  const elemSize = cdfDataTypeByteSize(dataType);
  const buf = new Uint8Array(values.length * elemSize);
  const view = new DataView(buf.buffer);

  for (let i = 0; i < values.length; i++) {
    const raw = values[i]!;
    const off = i * elemSize;
    let numVal: number;
    if (typeof raw === "number") {
      numVal = raw;
    } else if (dataType === "CDF_EPOCH") {
      numVal = isoToCdfEpoch(raw);
    } else {
      numVal = Number(raw);
    }

    switch (dataType) {
      case "CDF_INT1":
      case "CDF_BYTE":
        view.setInt8(off, Math.trunc(numVal));
        break;
      case "CDF_UINT1":
        view.setUint8(off, Math.trunc(numVal));
        break;
      case "CDF_INT2":
        view.setInt16(off, Math.trunc(numVal), false);
        break;
      case "CDF_UINT2":
        view.setUint16(off, Math.trunc(numVal), false);
        break;
      case "CDF_INT4":
        view.setInt32(off, Math.trunc(numVal), false);
        break;
      case "CDF_UINT4":
        view.setUint32(off, Math.trunc(numVal), false);
        break;
      case "CDF_INT8":
      case "CDF_TIME_TT2000":
        view.setBigInt64(off, BigInt(Math.round(numVal)), false);
        break;
      case "CDF_REAL4":
      case "CDF_FLOAT":
        view.setFloat32(off, numVal, false);
        break;
      case "CDF_REAL8":
      case "CDF_DOUBLE":
      case "CDF_EPOCH":
        view.setFloat64(off, numVal, false);
        break;
      case "CDF_EPOCH16":
        view.setFloat64(off, numVal, false);
        view.setFloat64(off + 8, 0.0, false);
        break;
    }
  }
  return buf;
}

function decodeScalarPayload(
  bytes: Uint8Array,
  offset: number,
  byteLength: number,
  dataType: CdfDataType,
  numValues: number,
): CdfScalarValue[] {
  if (dataType === "CDF_CHAR" || dataType === "CDF_UCHAR") {
    const text = textDecoder.decode(bytes.subarray(offset, offset + byteLength));
    return text.length > 0 ? text.split("\0") : [""];
  }
  const elemSize = cdfDataTypeByteSize(dataType);
  const count = Math.min(numValues, Math.floor(byteLength / elemSize));
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, byteLength);
  const out: CdfScalarValue[] = [];

  for (let i = 0; i < count; i++) {
    const off = i * elemSize;
    switch (dataType) {
      case "CDF_INT1":
      case "CDF_BYTE":
        out.push(view.getInt8(off));
        break;
      case "CDF_UINT1":
        out.push(view.getUint8(off));
        break;
      case "CDF_INT2":
        out.push(view.getInt16(off, false));
        break;
      case "CDF_UINT2":
        out.push(view.getUint16(off, false));
        break;
      case "CDF_INT4":
        out.push(view.getInt32(off, false));
        break;
      case "CDF_UINT4":
        out.push(view.getUint32(off, false));
        break;
      case "CDF_INT8":
      case "CDF_TIME_TT2000":
        out.push(Number(view.getBigInt64(off, false)));
        break;
      case "CDF_REAL4":
      case "CDF_FLOAT":
        out.push(view.getFloat32(off, false));
        break;
      case "CDF_REAL8":
      case "CDF_DOUBLE":
      case "CDF_EPOCH":
        out.push(view.getFloat64(off, false));
        break;
      case "CDF_EPOCH16":
        out.push(view.getFloat64(off, false));
        break;
    }
  }
  return out;
}

function writeOffset(view: DataView, pos: number, value: number, isV3: boolean): void {
  if (isV3) {
    view.setBigInt64(pos, BigInt(value), false);
  } else {
    view.setInt32(pos, value, false);
  }
}

function readOffset(view: DataView, pos: number, isV3: boolean): number {
  if (isV3) {
    return Number(view.getBigInt64(pos, false));
  }
  return view.getInt32(pos, false);
}

/**
 * Encodes a `CdfDocument` into a binary NASA CDF v3 (default) or v2 byte stream
 * with magic bytes, CDR, GDR, ADR, AgrEDR, zVDR, AzEDR, VXR, and VVR records.
 */
export function encodeCdfBinary(doc: CdfDocument, options: BinaryEncodeOptions = {}): Uint8Array {
  const version: CdfFormatVersion = options.version ?? doc.formatVersion ?? "v3";
  const isV3 = version === "v3";
  const offSize = isV3 ? 8 : 4;
  const hdrSize = offSize + 4; // RecordSize + RecordType

  // Build individual record byte blocks sequentially, tracking file offsets
  const chunks: Uint8Array[] = [];
  let cursor = 0;

  const pushChunk = (buf: Uint8Array): number => {
    const start = cursor;
    chunks.push(buf);
    cursor += buf.byteLength;
    return start;
  };

  // 1. 8-byte Magic Header
  const magicBuf = new Uint8Array(8);
  const magicView = new DataView(magicBuf.buffer);
  magicView.setUint32(0, isV3 ? CDF_MAGIC_V3 : CDF_MAGIC_V2, false);
  magicView.setUint32(4, CDF_MAGIC_UNCOMPRESSED, false);
  pushChunk(magicBuf);

  // 2. CDR (type 1): hdr + gdrOffset + version(4) + release(4) + encoding(4) + flags(4) + increment(4) + name(64)
  const cdrSize = hdrSize + offSize + 20 + 64;
  const cdrBuf = new Uint8Array(cdrSize);
  const cdrView = new DataView(cdrBuf.buffer);
  writeOffset(cdrView, 0, cdrSize, isV3);
  cdrView.setInt32(offSize, CdfRecordType.CDR, false);
  const cdrGdrOffPos = hdrSize;
  const cdrFixedPos = hdrSize + offSize;
  cdrView.setInt32(cdrFixedPos, isV3 ? 3 : 2, false);
  cdrView.setInt32(cdrFixedPos + 4, doc.header.release ?? 8, false);
  cdrView.setInt32(cdrFixedPos + 8, 1, false); // NETWORK encoding
  const flags =
    (doc.header.majority === "ROW_MAJOR" ? CDR_FLAG_ROW_MAJOR : 0) |
    (doc.header.format === "SINGLE" ? CDR_FLAG_SINGLE_FILE : 0);
  cdrView.setInt32(cdrFixedPos + 12, flags, false);
  cdrView.setInt32(cdrFixedPos + 16, doc.header.increment ?? 0, false);
  writeFixedString(cdrBuf, cdrFixedPos + 20, doc.header.fileName || "untitled.cdf", 64);
  pushChunk(cdrBuf);

  // 3. GDR (type 2): hdr + zVDRhead + ADRhead + numZVars(4) + numAttrs(4)
  const gdrSize = hdrSize + offSize * 2 + 8;
  const gdrBuf = new Uint8Array(gdrSize);
  const gdrView = new DataView(gdrBuf.buffer);
  writeOffset(gdrView, 0, gdrSize, isV3);
  gdrView.setInt32(offSize, CdfRecordType.GDR, false);
  const gdrOffset = pushChunk(gdrBuf);
  writeOffset(cdrView, cdrGdrOffPos, gdrOffset, isV3);

  // 4. Emit zVDR + VXR + VVR for each variable
  let firstZvdrOffset = 0;
  let prevZvdrView: DataView | null = null;

  for (let vIdx = 0; vIdx < doc.variables.length; vIdx++) {
    const v = doc.variables[vIdx]!;
    const dt: CdfDataType = isValidCdfDataType(v.dataType) ? v.dataType : "CDF_REAL8";
    const dtCode = CDF_TYPE_CODES[dt];
    const dimsCount = v.dimSizes.length;
    const elemsPerRec = v.dimSizes.reduce((a, b) => a * Math.max(1, b), 1);

    // Build VVR payload
    const flatScalars: CdfScalarValue[] = [];
    for (const rec of v.values) {
      if (Array.isArray(rec)) {
        for (const el of rec) flatScalars.push(el);
      } else {
        flatScalars.push(rec);
      }
    }
    const payload = encodeScalarPayload(flatScalars, dt);

    // VVR record: hdr + payload
    const vvrSize = hdrSize + payload.byteLength;
    const vvrBuf = new Uint8Array(vvrSize);
    const vvrView = new DataView(vvrBuf.buffer);
    writeOffset(vvrView, 0, vvrSize, isV3);
    vvrView.setInt32(offSize, CdfRecordType.VVR, false);
    vvrBuf.set(payload, hdrSize);
    const vvrOffset = pushChunk(vvrBuf);

    // VXR record: hdr + vxrNext + nEntries(4) + nUsedEntries(4) + firstRec(4) + lastRec(4) + vvrOffset
    const vxrSize = hdrSize + offSize + 16 + offSize;
    const vxrBuf = new Uint8Array(vxrSize);
    const vxrView = new DataView(vxrBuf.buffer);
    writeOffset(vxrView, 0, vxrSize, isV3);
    vxrView.setInt32(offSize, CdfRecordType.VXR, false);
    writeOffset(vxrView, hdrSize, 0, isV3); // vxrNext = 0
    vxrView.setInt32(hdrSize + offSize, 1, false);
    vxrView.setInt32(hdrSize + offSize + 4, v.values.length > 0 ? 1 : 0, false);
    vxrView.setInt32(hdrSize + offSize + 8, 0, false);
    vxrView.setInt32(hdrSize + offSize + 12, Math.max(0, v.values.length - 1), false);
    writeOffset(vxrView, hdrSize + offSize + 16, vvrOffset, isV3);
    const vxrOffset = pushChunk(vxrBuf);

    // zVDR record:
    // hdr + vdrNext + dataType(4) + maxRec(4) + vxrHead + numElems(4) + num(4) + flags(4) + numDims(4) + name(64) + dimSizes(4*d) + dimVars(4*d)
    const zvdrSize = hdrSize + offSize + 8 + offSize + 16 + 64 + dimsCount * 8;
    const zvdrBuf = new Uint8Array(zvdrSize);
    const zvdrView = new DataView(zvdrBuf.buffer);
    writeOffset(zvdrView, 0, zvdrSize, isV3);
    zvdrView.setInt32(offSize, CdfRecordType.zVDR, false);
    writeOffset(zvdrView, hdrSize, 0, isV3); // vdrNext patched later
    let p = hdrSize + offSize;
    zvdrView.setInt32(p, dtCode, false);
    p += 4;
    zvdrView.setInt32(p, v.values.length - 1, false); // maxRec (-1 if empty)
    p += 4;
    writeOffset(zvdrView, p, vxrOffset, isV3);
    p += offSize;
    zvdrView.setInt32(p, Math.max(1, v.numElements || elemsPerRec), false);
    p += 4;
    zvdrView.setInt32(p, vIdx, false);
    p += 4;
    zvdrView.setInt32(p, v.recVariance === "T" ? VDR_FLAG_REC_VARIANCE : 0, false);
    p += 4;
    zvdrView.setInt32(p, dimsCount, false);
    p += 4;
    writeFixedString(zvdrBuf, p, v.name, 64);
    p += 64;
    for (let d = 0; d < dimsCount; d++) {
      zvdrView.setInt32(p, v.dimSizes[d]!, false);
      p += 4;
    }
    for (let d = 0; d < dimsCount; d++) {
      zvdrView.setInt32(p, v.dimVariances[d] === "F" ? 0 : -1, false);
      p += 4;
    }

    const zvdrOffset = pushChunk(zvdrBuf);
    if (firstZvdrOffset === 0) firstZvdrOffset = zvdrOffset;
    if (prevZvdrView) {
      writeOffset(prevZvdrView, hdrSize, zvdrOffset, isV3);
    }
    prevZvdrView = zvdrView;
  }

  // 5. Emit ADR + AgrEDR (global) and ADR + AzEDR (variable attributes)
  let firstAdrOffset = 0;
  let prevAdrView: DataView | null = null;
  let totalAttrCount = 0;

  // Global attributes
  for (const gAttr of doc.globalAttributes) {
    let firstEdrOffset = 0;
    let prevEdrView: DataView | null = null;

    for (const entry of gAttr.entries) {
      const dt: CdfDataType = isValidCdfDataType(entry.dataType) ? entry.dataType : "CDF_CHAR";
      const payload = encodeScalarPayload(entry.values, dt);
      const edrSize = hdrSize + offSize + 12 + payload.byteLength;
      const edrBuf = new Uint8Array(edrSize);
      const edrView = new DataView(edrBuf.buffer);
      writeOffset(edrView, 0, edrSize, isV3);
      edrView.setInt32(offSize, CdfRecordType.AgrEDR, false);
      writeOffset(edrView, hdrSize, 0, isV3);
      const p = hdrSize + offSize;
      edrView.setInt32(p, CDF_TYPE_CODES[dt], false);
      edrView.setInt32(p + 4, entry.entryNumber, false);
      edrView.setInt32(
        p + 8,
        dt === "CDF_CHAR" || dt === "CDF_UCHAR" ? payload.byteLength : entry.values.length,
        false,
      );
      edrBuf.set(payload, p + 12);

      const edrOffset = pushChunk(edrBuf);
      if (firstEdrOffset === 0) firstEdrOffset = edrOffset;
      if (prevEdrView) writeOffset(prevEdrView, hdrSize, edrOffset, isV3);
      prevEdrView = edrView;
    }

    // ADR: hdr + adrNext + agrEdrHead + azEdrHead + scope(4) + num(4) + name(64)
    const adrSize = hdrSize + offSize * 3 + 8 + 64;
    const adrBuf = new Uint8Array(adrSize);
    const adrView = new DataView(adrBuf.buffer);
    writeOffset(adrView, 0, adrSize, isV3);
    adrView.setInt32(offSize, CdfRecordType.ADR, false);
    writeOffset(adrView, hdrSize, 0, isV3);
    writeOffset(adrView, hdrSize + offSize, firstEdrOffset, isV3);
    writeOffset(adrView, hdrSize + offSize * 2, 0, isV3);
    adrView.setInt32(hdrSize + offSize * 3, ADR_SCOPE_GLOBAL, false);
    adrView.setInt32(hdrSize + offSize * 3 + 4, totalAttrCount, false);
    writeFixedString(adrBuf, hdrSize + offSize * 3 + 8, gAttr.name, 64);

    const adrOffset = pushChunk(adrBuf);
    if (firstAdrOffset === 0) firstAdrOffset = adrOffset;
    if (prevAdrView) writeOffset(prevAdrView, hdrSize, adrOffset, isV3);
    prevAdrView = adrView;
    totalAttrCount++;
  }

  // Variable attributes grouped by attribute name
  const varAttrNames = new Set(doc.variableAttributeNames);
  for (const v of doc.variables) {
    for (const k of Object.keys(v.attributes)) varAttrNames.add(k);
  }

  for (const attrName of varAttrNames) {
    let firstAzEdrOffset = 0;
    let prevAzEdrView: DataView | null = null;

    for (let vIdx = 0; vIdx < doc.variables.length; vIdx++) {
      const entry = doc.variables[vIdx]!.attributes[attrName];
      if (!entry) continue;
      const dt: CdfDataType = isValidCdfDataType(entry.dataType) ? entry.dataType : "CDF_CHAR";
      const payload = encodeScalarPayload(entry.values, dt);
      const edrSize = hdrSize + offSize + 12 + payload.byteLength;
      const edrBuf = new Uint8Array(edrSize);
      const edrView = new DataView(edrBuf.buffer);
      writeOffset(edrView, 0, edrSize, isV3);
      edrView.setInt32(offSize, CdfRecordType.AzEDR, false);
      writeOffset(edrView, hdrSize, 0, isV3);
      const p = hdrSize + offSize;
      edrView.setInt32(p, CDF_TYPE_CODES[dt], false);
      edrView.setInt32(p + 4, vIdx, false);
      edrView.setInt32(
        p + 8,
        dt === "CDF_CHAR" || dt === "CDF_UCHAR" ? payload.byteLength : entry.values.length,
        false,
      );
      edrBuf.set(payload, p + 12);

      const edrOffset = pushChunk(edrBuf);
      if (firstAzEdrOffset === 0) firstAzEdrOffset = edrOffset;
      if (prevAzEdrView) writeOffset(prevAzEdrView, hdrSize, edrOffset, isV3);
      prevAzEdrView = edrView;
    }

    const adrSize = hdrSize + offSize * 3 + 8 + 64;
    const adrBuf = new Uint8Array(adrSize);
    const adrView = new DataView(adrBuf.buffer);
    writeOffset(adrView, 0, adrSize, isV3);
    adrView.setInt32(offSize, CdfRecordType.ADR, false);
    writeOffset(adrView, hdrSize, 0, isV3);
    writeOffset(adrView, hdrSize + offSize, 0, isV3);
    writeOffset(adrView, hdrSize + offSize * 2, firstAzEdrOffset, isV3);
    adrView.setInt32(hdrSize + offSize * 3, ADR_SCOPE_VARIABLE, false);
    adrView.setInt32(hdrSize + offSize * 3 + 4, totalAttrCount, false);
    writeFixedString(adrBuf, hdrSize + offSize * 3 + 8, attrName, 64);

    const adrOffset = pushChunk(adrBuf);
    if (firstAdrOffset === 0) firstAdrOffset = adrOffset;
    if (prevAdrView) writeOffset(prevAdrView, hdrSize, adrOffset, isV3);
    prevAdrView = adrView;
    totalAttrCount++;
  }

  // Patch GDR pointers & counts
  writeOffset(gdrView, hdrSize, firstZvdrOffset, isV3);
  writeOffset(gdrView, hdrSize + offSize, firstAdrOffset, isV3);
  gdrView.setInt32(hdrSize + offSize * 2, doc.variables.length, false);
  gdrView.setInt32(hdrSize + offSize * 2 + 4, totalAttrCount, false);

  // Concatenate chunks
  const out = new Uint8Array(cursor);
  let writePos = 0;
  for (const chunk of chunks) {
    out.set(chunk, writePos);
    writePos += chunk.byteLength;
  }
  return out;
}

/**
 * Decodes a binary NASA CDF v2 or v3 byte stream back into a `CdfDocument`.
 */
export function decodeCdfBinary(bytes: Uint8Array, uri?: string): CdfDocument {
  if (bytes.byteLength < 8) {
    throw new Error(NasaCdfErrorCode.INVALID_MAGIC_NUMBER.message("00000000"));
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic1 = view.getUint32(0, false);

  if (magic1 !== CDF_MAGIC_V3 && magic1 !== CDF_MAGIC_V2) {
    throw new Error(NasaCdfErrorCode.INVALID_MAGIC_NUMBER.message(magic1.toString(16).toUpperCase().padStart(8, "0")));
  }

  const isV3 = magic1 === CDF_MAGIC_V3;
  const offSize = isV3 ? 8 : 4;
  const hdrSize = offSize + 4;

  // Read CDR at offset 8
  if (bytes.byteLength < 8 + hdrSize + offSize + 20) {
    throw new Error(NasaCdfErrorCode.CORRUPT_RECORD_STRUCTURE.message("CDR", "truncated CDR record"));
  }
  const cdrType = view.getInt32(8 + offSize, false);
  if (cdrType !== CdfRecordType.CDR) {
    throw new Error(NasaCdfErrorCode.CORRUPT_RECORD_STRUCTURE.message("CDR", `unexpected record type ${cdrType}`));
  }

  const gdrOffset = readOffset(view, 8 + hdrSize, isV3);
  const cdrFixedPos = 8 + hdrSize + offSize;
  const versionNum = view.getInt32(cdrFixedPos, false);
  const releaseNum = view.getInt32(cdrFixedPos + 4, false);
  const flags = view.getInt32(cdrFixedPos + 12, false);
  const incrementNum = view.getInt32(cdrFixedPos + 16, false);
  const fileName = readFixedString(bytes, cdrFixedPos + 20, 64) || "untitled.cdf";

  // Read GDR
  if (gdrOffset <= 0 || gdrOffset + hdrSize + offSize * 2 + 8 > bytes.byteLength) {
    throw new Error(NasaCdfErrorCode.CORRUPT_RECORD_STRUCTURE.message("GDR", `invalid GDR offset ${gdrOffset}`));
  }
  const gdrType = view.getInt32(gdrOffset + offSize, false);
  if (gdrType !== CdfRecordType.GDR) {
    throw new Error(NasaCdfErrorCode.CORRUPT_RECORD_STRUCTURE.message("GDR", `unexpected record type ${gdrType}`));
  }

  const firstZvdrOffset = readOffset(view, gdrOffset + hdrSize, isV3);
  const firstAdrOffset = readOffset(view, gdrOffset + hdrSize + offSize, isV3);

  // Traverse zVDR linked list
  const variables: CdfVariable[] = [];
  let vdrOff = firstZvdrOffset;
  let guard = 0;

  while (vdrOff > 0 && guard < 10_000) {
    guard++;
    if (vdrOff + hdrSize + offSize > bytes.byteLength) {
      throw new Error(NasaCdfErrorCode.CORRUPT_RECORD_STRUCTURE.message("zVDR", `offset ${vdrOff} out of bounds`));
    }
    const recType = view.getInt32(vdrOff + offSize, false);
    if (recType !== CdfRecordType.zVDR) {
      throw new Error(NasaCdfErrorCode.CORRUPT_RECORD_STRUCTURE.message("zVDR", `unexpected record type ${recType}`));
    }
    const vdrNext = readOffset(view, vdrOff + hdrSize, isV3);
    let p = vdrOff + hdrSize + offSize;
    const dtCode = view.getInt32(p, false);
    p += 4;
    const maxRec = view.getInt32(p, false);
    p += 4;
    const vxrHead = readOffset(view, p, isV3);
    p += offSize;
    const numElements = view.getInt32(p, false);
    p += 4;
    p += 4; // var num
    const vFlags = view.getInt32(p, false);
    p += 4;
    const numDims = view.getInt32(p, false);
    p += 4;
    const name = readFixedString(bytes, p, 64);
    p += 64;
    const dimSizes: number[] = [];
    for (let d = 0; d < numDims; d++) {
      dimSizes.push(view.getInt32(p, false));
      p += 4;
    }
    const dimVariances: CdfVariance[] = [];
    for (let d = 0; d < numDims; d++) {
      dimVariances.push(view.getInt32(p, false) === 0 ? "F" : "T");
      p += 4;
    }

    const dataType: CdfDataType = CDF_CODE_TO_TYPE[dtCode] ?? "CDF_REAL8";
    const numRecords = maxRec >= 0 ? maxRec + 1 : 0;
    const elemsPerRec = dimSizes.reduce((a, b) => a * Math.max(1, b), 1);

    const values: CdfRecordValue[] = [];
    if (vxrHead > 0 && numRecords > 0 && vxrHead + hdrSize + offSize + 16 + offSize <= bytes.byteLength) {
      const vvrOffset = readOffset(view, vxrHead + hdrSize + offSize + 16, isV3);
      if (vvrOffset > 0 && vvrOffset + hdrSize <= bytes.byteLength) {
        const vvrSize = readOffset(view, vvrOffset, isV3);
        const payloadBytes = Math.max(0, vvrSize - hdrSize);
        const flat = decodeScalarPayload(bytes, vvrOffset + hdrSize, payloadBytes, dataType, numRecords * elemsPerRec);
        if (elemsPerRec > 1) {
          for (let r = 0; r < numRecords; r++) {
            values.push(flat.slice(r * elemsPerRec, (r + 1) * elemsPerRec));
          }
        } else {
          for (const val of flat) values.push(val);
        }
      }
    }

    variables.push({
      name,
      dataType,
      numElements,
      numDims,
      dimSizes,
      recVariance: (vFlags & VDR_FLAG_REC_VARIANCE) !== 0 ? "T" : "F",
      dimVariances,
      isZVariable: true,
      attributes: {},
      values,
      line: 1,
    });

    vdrOff = vdrNext;
  }

  // Traverse ADR linked list
  const globalAttributes: CdfGlobalAttribute[] = [];
  const variableAttributeNames: string[] = [];
  let adrOff = firstAdrOffset;
  guard = 0;

  while (adrOff > 0 && guard < 10_000) {
    guard++;
    if (adrOff + hdrSize + offSize * 3 + 8 + 64 > bytes.byteLength) {
      throw new Error(NasaCdfErrorCode.CORRUPT_RECORD_STRUCTURE.message("ADR", `offset ${adrOff} out of bounds`));
    }
    const adrNext = readOffset(view, adrOff + hdrSize, isV3);
    const agrHead = readOffset(view, adrOff + hdrSize + offSize, isV3);
    const azHead = readOffset(view, adrOff + hdrSize + offSize * 2, isV3);
    const scope = view.getInt32(adrOff + hdrSize + offSize * 3, false);
    const attrName = readFixedString(bytes, adrOff + hdrSize + offSize * 3 + 8, 64);

    if (scope === ADR_SCOPE_GLOBAL) {
      const gAttr: CdfGlobalAttribute = { name: attrName, entries: [], line: 1 };
      let edrOff = agrHead;
      let edrGuard = 0;
      while (edrOff > 0 && edrGuard < 10_000) {
        edrGuard++;
        const edrSize = readOffset(view, edrOff, isV3);
        const edrNext = readOffset(view, edrOff + hdrSize, isV3);
        const p = edrOff + hdrSize + offSize;
        const dtCode = view.getInt32(p, false);
        const entryNumber = view.getInt32(p + 4, false);
        const numVals = view.getInt32(p + 8, false);
        const dataType: CdfDataType = CDF_CODE_TO_TYPE[dtCode] ?? "CDF_CHAR";
        const payloadLen = Math.max(0, edrSize - (hdrSize + offSize + 12));
        const values = decodeScalarPayload(bytes, p + 12, payloadLen, dataType, numVals);
        gAttr.entries.push({ entryNumber, dataType, values, line: 1 });
        edrOff = edrNext;
      }
      globalAttributes.push(gAttr);
    } else if (scope === ADR_SCOPE_VARIABLE) {
      variableAttributeNames.push(attrName);
      let edrOff = azHead;
      let edrGuard = 0;
      while (edrOff > 0 && edrGuard < 10_000) {
        edrGuard++;
        const edrSize = readOffset(view, edrOff, isV3);
        const edrNext = readOffset(view, edrOff + hdrSize, isV3);
        const p = edrOff + hdrSize + offSize;
        const dtCode = view.getInt32(p, false);
        const varIdx = view.getInt32(p + 4, false);
        const numVals = view.getInt32(p + 8, false);
        const dataType: CdfDataType = CDF_CODE_TO_TYPE[dtCode] ?? "CDF_CHAR";
        const payloadLen = Math.max(0, edrSize - (hdrSize + offSize + 12));
        const values = decodeScalarPayload(bytes, p + 12, payloadLen, dataType, numVals);
        const targetVar = variables[varIdx];
        if (targetVar) {
          targetVar.attributes[attrName] = {
            attributeName: attrName,
            dataType,
            values,
            line: 1,
          };
        }
        edrOff = edrNext;
      }
    }

    adrOff = adrNext;
  }

  return {
    uri,
    isBinary: true,
    formatVersion: isV3 ? "v3" : "v2",
    header: {
      fileName,
      format: (flags & CDR_FLAG_SINGLE_FILE) !== 0 ? "SINGLE" : "MULTI",
      encoding: "NETWORK",
      majority: (flags & CDR_FLAG_ROW_MAJOR) !== 0 ? "ROW_MAJOR" : "COLUMN_MAJOR",
      numDims: 0,
      dimSizes: [],
      version: versionNum,
      release: releaseNum,
      increment: incrementNum,
      line: 1,
    },
    hasHeaderSection: true,
    hasEndSection: true,
    globalAttributes,
    variableAttributeNames,
    variables,
    parseIssues: [],
    rawByteLength: bytes.byteLength,
  };
}
