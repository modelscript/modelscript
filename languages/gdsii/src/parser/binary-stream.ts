// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Calma GDSII Binary Stream Format (v6.0) Codec.
 *
 * Implements big-endian record framing, 2-byte/4-byte signed integers,
 * ASCII string padding, and IBM System/360 8-byte floating-point (`Real64`)
 * encoding and decoding.
 */

import type {
  GdsiiBoundaryElement,
  GdsiiElement,
  GdsiiLibrary,
  GdsiiParseError,
  GdsiiPathElement,
  GdsiiPoint,
  GdsiiStrans,
  GdsiiStructure,
  GdsiiTextElement,
  GdsiiTimestamp,
} from "../types.js";

/** Standard GDSII binary record type + data type 16-bit headers. */
export const GdsiiRecordType = {
  HEADER: 0x0002,
  BGNLIB: 0x0102,
  LIBNAME: 0x0206,
  UNITS: 0x0305,
  ENDLIB: 0x0400,
  BGNSTR: 0x0502,
  STRNAME: 0x0606,
  ENDSTR: 0x0700,
  BOUNDARY: 0x0800,
  PATH: 0x0900,
  SREF: 0x0a00,
  AREF: 0x0b00,
  TEXT: 0x0c00,
  LAYER: 0x0d02,
  DATATYPE: 0x0e02,
  WIDTH: 0x0f03,
  XY: 0x1003,
  ENDEL: 0x1100,
  SNAME: 0x1206,
  COLROW: 0x1302,
  TEXTTYPE: 0x1602,
  PRESENTATION: 0x1701,
  STRING: 0x1906,
  STRANS: 0x1a01,
  MAG: 0x1b05,
  ANGLE: 0x1c05,
  PATHTYPE: 0x2102,
  PROPATTR: 0x2b02,
  PROPVALUE: 0x2c06,
  BGNEXTN: 0x3003,
  ENDEXTN: 0x3103,
} as const;

export interface RawGdsiiRecord {
  recordType: number;
  payload: Uint8Array;
  byteOffset: number;
}

/**
 * Encodes an IEEE-754 double into the 8-byte IBM System/360 excess-64 base-16
 * floating-point representation used by GDSII (`Real64`).
 */
export function encodeIbmReal64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  if (!Number.isFinite(value) || value === 0) {
    return out;
  }

  const sign = value < 0 ? 0x80 : 0x00;
  let absVal = Math.abs(value);

  // Normalize absVal into [1/16, 1) using base-16 exponent
  let exp16 = 0;
  while (absVal >= 1.0) {
    absVal /= 16.0;
    exp16 += 1;
  }
  while (absVal < 1.0 / 16.0) {
    absVal *= 16.0;
    exp16 -= 1;
  }

  const biasedExp = exp16 + 64;
  if (biasedExp < 0) {
    return out; // underflow to 0
  }
  if (biasedExp > 127) {
    out[0] = sign | 0x7f;
    out.fill(0xff, 1);
    return out;
  }

  out[0] = sign | (biasedExp & 0x7f);

  // Extract 7 mantissa bytes (56 bits)
  let frac = absVal;
  for (let i = 1; i < 8; i++) {
    frac *= 256.0;
    const byte = Math.floor(frac);
    out[i] = byte & 0xff;
    frac -= byte;
  }

  return out;
}

/**
 * Decodes an 8-byte IBM System/360 floating-point (`Real64`) value into IEEE-754 double.
 */
export function decodeIbmReal64(bytes: Uint8Array, offset = 0): number {
  if (offset + 8 > bytes.length) {
    throw new RangeError(`Truncated IBM Real64 at offset ${offset}`);
  }
  const b0 = bytes[offset]!;
  let mantissa = 0;
  let factor = 1 / 256;
  for (let i = 1; i < 8; i++) {
    mantissa += bytes[offset + i]! * factor;
    factor /= 256;
  }
  if (mantissa === 0) {
    return 0;
  }
  const sign = (b0 & 0x80) !== 0 ? -1 : 1;
  const exp16 = (b0 & 0x7f) - 64;
  return sign * mantissa * Math.pow(16, exp16);
}

function writeRecord(chunks: Uint8Array[], recordType: number, payload?: Uint8Array): void {
  const payloadLen = payload ? payload.length : 0;
  const totalLen = 4 + payloadLen;
  const rec = new Uint8Array(totalLen);
  const view = new DataView(rec.buffer);
  view.setUint16(0, totalLen, false);
  view.setUint16(2, recordType, false);
  if (payload && payloadLen > 0) {
    rec.set(payload, 4);
  }
  chunks.push(rec);
}

function encodeInt16Array(values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 2);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < values.length; i++) {
    view.setInt16(i * 2, values[i]!, false);
  }
  return buf;
}

function encodeUint16Array(values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 2);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < values.length; i++) {
    view.setUint16(i * 2, values[i]!, false);
  }
  return buf;
}

function encodeInt32Array(values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 4);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < values.length; i++) {
    view.setInt32(i * 4, Math.round(values[i]!), false);
  }
  return buf;
}

function encodeAsciiString(text: string): Uint8Array {
  const rawLen = text.length;
  const paddedLen = rawLen % 2 === 1 ? rawLen + 1 : rawLen;
  const buf = new Uint8Array(paddedLen);
  for (let i = 0; i < rawLen; i++) {
    buf[i] = text.charCodeAt(i) & 0x7f;
  }
  return buf;
}

function decodeAsciiString(payload: Uint8Array): string {
  let end = payload.length;
  while (end > 0 && payload[end - 1] === 0) {
    end -= 1;
  }
  let out = "";
  for (let i = 0; i < end; i++) {
    out += String.fromCharCode(payload[i]!);
  }
  return out;
}

function encodeTimestampPair(creation?: GdsiiTimestamp, modification?: GdsiiTimestamp): Uint8Array {
  const c = creation ?? { year: 2026, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  const m = modification ?? c;
  return encodeInt16Array([
    m.year,
    m.month,
    m.day,
    m.hour,
    m.minute,
    m.second,
    c.year,
    c.month,
    c.day,
    c.hour,
    c.minute,
    c.second,
  ]);
}

function decodeTimestampPair(payload: Uint8Array): {
  modificationTime?: GdsiiTimestamp;
  creationTime?: GdsiiTimestamp;
} {
  if (payload.length < 24) return {};
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const modificationTime: GdsiiTimestamp = {
    year: view.getInt16(0, false),
    month: view.getInt16(2, false),
    day: view.getInt16(4, false),
    hour: view.getInt16(6, false),
    minute: view.getInt16(8, false),
    second: view.getInt16(10, false),
  };
  const creationTime: GdsiiTimestamp = {
    year: view.getInt16(12, false),
    month: view.getInt16(14, false),
    day: view.getInt16(16, false),
    hour: view.getInt16(18, false),
    minute: view.getInt16(20, false),
    second: view.getInt16(22, false),
  };
  return { modificationTime, creationTime };
}

function encodeStrans(strans: GdsiiStrans): number {
  if (strans.raw !== undefined) return strans.raw & 0xffff;
  let mask = 0;
  if (strans.reflectX) mask |= 0x8000;
  if (strans.absoluteMag) mask |= 0x0004;
  if (strans.absoluteAngle) mask |= 0x0002;
  return mask;
}

function decodeStrans(mask: number): GdsiiStrans {
  return {
    reflectX: (mask & 0x8000) !== 0,
    absoluteMag: (mask & 0x0004) !== 0,
    absoluteAngle: (mask & 0x0002) !== 0,
    raw: mask,
  };
}

/**
 * Encodes a `GdsiiLibrary` into standard binary GDSII stream bytes.
 */
export function encodeGdsiiBinary(library: GdsiiLibrary): Uint8Array {
  const chunks: Uint8Array[] = [];

  writeRecord(chunks, GdsiiRecordType.HEADER, encodeInt16Array([library.version || 600]));
  writeRecord(chunks, GdsiiRecordType.BGNLIB, encodeTimestampPair(library.creationTime, library.modificationTime));
  writeRecord(chunks, GdsiiRecordType.LIBNAME, encodeAsciiString(library.name || "LIB"));

  const unitsBuf = new Uint8Array(16);
  unitsBuf.set(encodeIbmReal64(library.units.dbUnitInUserUnits), 0);
  unitsBuf.set(encodeIbmReal64(library.units.dbUnitInMeters), 8);
  writeRecord(chunks, GdsiiRecordType.UNITS, unitsBuf);

  for (const struct of library.structures) {
    writeRecord(chunks, GdsiiRecordType.BGNSTR, encodeTimestampPair(struct.creationTime, struct.modificationTime));
    writeRecord(chunks, GdsiiRecordType.STRNAME, encodeAsciiString(struct.name));

    for (const el of struct.elements) {
      if (el.kind === "boundary") {
        writeRecord(chunks, GdsiiRecordType.BOUNDARY);
        writeRecord(chunks, GdsiiRecordType.LAYER, encodeInt16Array([el.layer]));
        writeRecord(chunks, GdsiiRecordType.DATATYPE, encodeInt16Array([el.datatype]));
        const coords: number[] = [];
        for (const p of el.xy) {
          coords.push(p.x, p.y);
        }
        writeRecord(chunks, GdsiiRecordType.XY, encodeInt32Array(coords));
      } else if (el.kind === "path") {
        writeRecord(chunks, GdsiiRecordType.PATH);
        writeRecord(chunks, GdsiiRecordType.LAYER, encodeInt16Array([el.layer]));
        writeRecord(chunks, GdsiiRecordType.DATATYPE, encodeInt16Array([el.datatype]));
        if (el.pathtype !== undefined) {
          writeRecord(chunks, GdsiiRecordType.PATHTYPE, encodeInt16Array([el.pathtype]));
        }
        if (el.width !== undefined) {
          writeRecord(chunks, GdsiiRecordType.WIDTH, encodeInt32Array([el.width]));
        }
        if (el.bgnextn !== undefined) {
          writeRecord(chunks, GdsiiRecordType.BGNEXTN, encodeInt32Array([el.bgnextn]));
        }
        if (el.endextn !== undefined) {
          writeRecord(chunks, GdsiiRecordType.ENDEXTN, encodeInt32Array([el.endextn]));
        }
        const coords: number[] = [];
        for (const p of el.xy) {
          coords.push(p.x, p.y);
        }
        writeRecord(chunks, GdsiiRecordType.XY, encodeInt32Array(coords));
      } else if (el.kind === "sref") {
        writeRecord(chunks, GdsiiRecordType.SREF);
        writeRecord(chunks, GdsiiRecordType.SNAME, encodeAsciiString(el.sname));
        if (el.strans) {
          writeRecord(chunks, GdsiiRecordType.STRANS, encodeUint16Array([encodeStrans(el.strans)]));
        }
        if (el.mag !== undefined) {
          writeRecord(chunks, GdsiiRecordType.MAG, encodeIbmReal64(el.mag));
        }
        if (el.angle !== undefined) {
          writeRecord(chunks, GdsiiRecordType.ANGLE, encodeIbmReal64(el.angle));
        }
        writeRecord(chunks, GdsiiRecordType.XY, encodeInt32Array([el.xy.x, el.xy.y]));
      } else if (el.kind === "aref") {
        writeRecord(chunks, GdsiiRecordType.AREF);
        writeRecord(chunks, GdsiiRecordType.SNAME, encodeAsciiString(el.sname));
        if (el.strans) {
          writeRecord(chunks, GdsiiRecordType.STRANS, encodeUint16Array([encodeStrans(el.strans)]));
        }
        if (el.mag !== undefined) {
          writeRecord(chunks, GdsiiRecordType.MAG, encodeIbmReal64(el.mag));
        }
        if (el.angle !== undefined) {
          writeRecord(chunks, GdsiiRecordType.ANGLE, encodeIbmReal64(el.angle));
        }
        writeRecord(chunks, GdsiiRecordType.COLROW, encodeInt16Array([el.columns, el.rows]));
        writeRecord(
          chunks,
          GdsiiRecordType.XY,
          encodeInt32Array([el.xy[0].x, el.xy[0].y, el.xy[1].x, el.xy[1].y, el.xy[2].x, el.xy[2].y]),
        );
      } else if (el.kind === "text") {
        writeRecord(chunks, GdsiiRecordType.TEXT);
        writeRecord(chunks, GdsiiRecordType.LAYER, encodeInt16Array([el.layer]));
        writeRecord(chunks, GdsiiRecordType.TEXTTYPE, encodeInt16Array([el.texttype]));
        if (el.presentation !== undefined) {
          writeRecord(chunks, GdsiiRecordType.PRESENTATION, encodeUint16Array([el.presentation]));
        }
        if (el.strans) {
          writeRecord(chunks, GdsiiRecordType.STRANS, encodeUint16Array([encodeStrans(el.strans)]));
        }
        if (el.mag !== undefined) {
          writeRecord(chunks, GdsiiRecordType.MAG, encodeIbmReal64(el.mag));
        }
        if (el.angle !== undefined) {
          writeRecord(chunks, GdsiiRecordType.ANGLE, encodeIbmReal64(el.angle));
        }
        writeRecord(chunks, GdsiiRecordType.XY, encodeInt32Array([el.xy.x, el.xy.y]));
        writeRecord(chunks, GdsiiRecordType.STRING, encodeAsciiString(el.string));
      }

      if (el.properties) {
        for (const prop of el.properties) {
          writeRecord(chunks, GdsiiRecordType.PROPATTR, encodeInt16Array([prop.attr]));
          writeRecord(chunks, GdsiiRecordType.PROPVALUE, encodeAsciiString(prop.value));
        }
      }
      writeRecord(chunks, GdsiiRecordType.ENDEL);
    }

    writeRecord(chunks, GdsiiRecordType.ENDSTR);
  }

  writeRecord(chunks, GdsiiRecordType.ENDLIB);

  let totalBytes = 0;
  for (const c of chunks) totalBytes += c.length;
  const result = new Uint8Array(totalBytes);
  let pos = 0;
  for (const c of chunks) {
    result.set(c, pos);
    pos += c.length;
  }
  return result;
}

/**
 * Splits a binary GDSII buffer into raw records.
 */
export function readGdsiiRecords(bytes: Uint8Array): { records: RawGdsiiRecord[]; errors: GdsiiParseError[] } {
  const records: RawGdsiiRecord[] = [];
  const errors: GdsiiParseError[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) {
      errors.push({
        message: `Truncated GDSII record header at byte offset ${offset}`,
        line: 1,
        column: 1,
        offset,
      });
      break;
    }
    const recordLength = view.getUint16(offset, false);
    const recordType = view.getUint16(offset + 2, false);
    if (recordLength < 4) {
      errors.push({
        message: `Invalid GDSII record length ${recordLength} at byte offset ${offset}`,
        line: 1,
        column: 1,
        offset,
      });
      break;
    }
    if (offset + recordLength > bytes.length) {
      errors.push({
        message: `Truncated GDSII record payload (expected ${recordLength} bytes) at byte offset ${offset}`,
        line: 1,
        column: 1,
        offset,
      });
      break;
    }
    const payload = bytes.subarray(offset + 4, offset + recordLength);
    records.push({ recordType, payload, byteOffset: offset });
    offset += recordLength;
    if (recordType === GdsiiRecordType.ENDLIB) {
      break;
    }
  }

  return { records, errors };
}

/**
 * Decodes binary GDSII stream bytes into a structured `GdsiiLibrary`.
 */
export function decodeGdsiiBinary(bytes: Uint8Array): GdsiiLibrary {
  const { records, errors } = readGdsiiRecords(bytes);
  const library: GdsiiLibrary = {
    version: 600,
    name: "UNNAMED",
    units: { dbUnitInUserUnits: 1e-3, dbUnitInMeters: 1e-9 },
    structures: [],
  };

  let currentStruct: GdsiiStructure | null = null;
  let currentEl: (Partial<GdsiiElement> & { kind?: GdsiiElement["kind"] }) | null = null;
  let pendingPropAttr: number | undefined;

  const readI16 = (p: Uint8Array, idx = 0): number =>
    new DataView(p.buffer, p.byteOffset, p.byteLength).getInt16(idx * 2, false);
  const readU16 = (p: Uint8Array, idx = 0): number =>
    new DataView(p.buffer, p.byteOffset, p.byteLength).getUint16(idx * 2, false);
  const readI32 = (p: Uint8Array, idx = 0): number =>
    new DataView(p.buffer, p.byteOffset, p.byteLength).getInt32(idx * 4, false);

  for (const rec of records) {
    const { recordType, payload, byteOffset } = rec;
    switch (recordType) {
      case GdsiiRecordType.HEADER:
        if (payload.length >= 2) library.version = readI16(payload, 0);
        break;
      case GdsiiRecordType.BGNLIB: {
        const ts = decodeTimestampPair(payload);
        library.creationTime = ts.creationTime;
        library.modificationTime = ts.modificationTime;
        break;
      }
      case GdsiiRecordType.LIBNAME:
        library.name = decodeAsciiString(payload);
        break;
      case GdsiiRecordType.UNITS:
        if (payload.length >= 16) {
          library.units = {
            dbUnitInUserUnits: decodeIbmReal64(payload, 0),
            dbUnitInMeters: decodeIbmReal64(payload, 8),
          };
        }
        break;
      case GdsiiRecordType.BGNSTR: {
        const ts = decodeTimestampPair(payload);
        currentStruct = {
          name: "UNNAMED_STR",
          creationTime: ts.creationTime,
          modificationTime: ts.modificationTime,
          elements: [],
          startOffset: byteOffset,
        };
        break;
      }
      case GdsiiRecordType.STRNAME:
        if (currentStruct) currentStruct.name = decodeAsciiString(payload);
        break;
      case GdsiiRecordType.ENDSTR:
        if (currentStruct) {
          currentStruct.endOffset = byteOffset + 4;
          library.structures.push(currentStruct);
          currentStruct = null;
        }
        break;
      case GdsiiRecordType.BOUNDARY:
        currentEl = { kind: "boundary", layer: 0, datatype: 0, xy: [], startOffset: byteOffset };
        break;
      case GdsiiRecordType.PATH:
        currentEl = { kind: "path", layer: 0, datatype: 0, xy: [], startOffset: byteOffset };
        break;
      case GdsiiRecordType.SREF:
        currentEl = { kind: "sref", sname: "", xy: { x: 0, y: 0 }, startOffset: byteOffset };
        break;
      case GdsiiRecordType.AREF:
        currentEl = {
          kind: "aref",
          sname: "",
          columns: 1,
          rows: 1,
          xy: [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            { x: 0, y: 0 },
          ],
          startOffset: byteOffset,
        };
        break;
      case GdsiiRecordType.TEXT:
        currentEl = { kind: "text", layer: 0, texttype: 0, xy: { x: 0, y: 0 }, string: "", startOffset: byteOffset };
        break;
      case GdsiiRecordType.LAYER:
        if (currentEl && payload.length >= 2 && "layer" in currentEl) {
          (currentEl as GdsiiBoundaryElement | GdsiiPathElement | GdsiiTextElement).layer = readI16(payload, 0);
        }
        break;
      case GdsiiRecordType.DATATYPE:
        if (currentEl && payload.length >= 2 && (currentEl.kind === "boundary" || currentEl.kind === "path")) {
          currentEl.datatype = readI16(payload, 0);
        }
        break;
      case GdsiiRecordType.TEXTTYPE:
        if (currentEl && payload.length >= 2 && currentEl.kind === "text") {
          currentEl.texttype = readI16(payload, 0);
        }
        break;
      case GdsiiRecordType.PATHTYPE:
        if (currentEl && payload.length >= 2 && (currentEl.kind === "path" || currentEl.kind === "text")) {
          currentEl.pathtype = readI16(payload, 0);
        }
        break;
      case GdsiiRecordType.WIDTH:
        if (currentEl && payload.length >= 4 && (currentEl.kind === "path" || currentEl.kind === "text")) {
          currentEl.width = readI32(payload, 0);
        }
        break;
      case GdsiiRecordType.BGNEXTN:
        if (currentEl && payload.length >= 4 && currentEl.kind === "path") {
          currentEl.bgnextn = readI32(payload, 0);
        }
        break;
      case GdsiiRecordType.ENDEXTN:
        if (currentEl && payload.length >= 4 && currentEl.kind === "path") {
          currentEl.endextn = readI32(payload, 0);
        }
        break;
      case GdsiiRecordType.PRESENTATION:
        if (currentEl && payload.length >= 2 && currentEl.kind === "text") {
          currentEl.presentation = readU16(payload, 0);
        }
        break;
      case GdsiiRecordType.SNAME:
        if (currentEl && (currentEl.kind === "sref" || currentEl.kind === "aref")) {
          currentEl.sname = decodeAsciiString(payload);
        }
        break;
      case GdsiiRecordType.STRANS:
        if (
          currentEl &&
          payload.length >= 2 &&
          (currentEl.kind === "sref" || currentEl.kind === "aref" || currentEl.kind === "text")
        ) {
          currentEl.strans = decodeStrans(readU16(payload, 0));
        }
        break;
      case GdsiiRecordType.MAG:
        if (
          currentEl &&
          payload.length >= 8 &&
          (currentEl.kind === "sref" || currentEl.kind === "aref" || currentEl.kind === "text")
        ) {
          currentEl.mag = decodeIbmReal64(payload, 0);
        }
        break;
      case GdsiiRecordType.ANGLE:
        if (
          currentEl &&
          payload.length >= 8 &&
          (currentEl.kind === "sref" || currentEl.kind === "aref" || currentEl.kind === "text")
        ) {
          currentEl.angle = decodeIbmReal64(payload, 0);
        }
        break;
      case GdsiiRecordType.COLROW:
        if (currentEl && payload.length >= 4 && currentEl.kind === "aref") {
          currentEl.columns = readI16(payload, 0);
          currentEl.rows = readI16(payload, 1);
        }
        break;
      case GdsiiRecordType.STRING:
        if (currentEl && currentEl.kind === "text") {
          currentEl.string = decodeAsciiString(payload);
        }
        break;
      case GdsiiRecordType.XY:
        if (currentEl) {
          const pts: GdsiiPoint[] = [];
          const count = Math.floor(payload.length / 8);
          for (let i = 0; i < count; i++) {
            pts.push({ x: readI32(payload, i * 2), y: readI32(payload, i * 2 + 1) });
          }
          if (currentEl.kind === "boundary" || currentEl.kind === "path") {
            currentEl.xy = pts;
          } else if (currentEl.kind === "sref" || currentEl.kind === "text") {
            currentEl.xy = pts[0] ?? { x: 0, y: 0 };
          } else if (currentEl.kind === "aref") {
            currentEl.xy = [pts[0] ?? { x: 0, y: 0 }, pts[1] ?? { x: 0, y: 0 }, pts[2] ?? { x: 0, y: 0 }];
          }
        }
        break;
      case GdsiiRecordType.PROPATTR:
        if (payload.length >= 2) pendingPropAttr = readI16(payload, 0);
        break;
      case GdsiiRecordType.PROPVALUE:
        if (currentEl && pendingPropAttr !== undefined) {
          if (!currentEl.properties) currentEl.properties = [];
          currentEl.properties.push({ attr: pendingPropAttr, value: decodeAsciiString(payload) });
          pendingPropAttr = undefined;
        }
        break;
      case GdsiiRecordType.ENDEL:
        if (currentStruct && currentEl) {
          currentEl.endOffset = byteOffset + 4;
          currentStruct.elements.push(currentEl as GdsiiElement);
        }
        currentEl = null;
        pendingPropAttr = undefined;
        break;
      case GdsiiRecordType.ENDLIB:
        break;
      default:
        break;
    }
  }

  if (errors.length > 0) {
    library.parseErrors = errors;
  }
  return library;
}
