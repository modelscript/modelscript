// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fits — Binary 2880-Byte FITS HDU Codec.
 *
 * Implements big-endian binary FITS 4.0 HDU encoding & decoding for:
 * - Primary HDUs and `IMAGE` extensions (`BITPIX` = 8, 16, 32, 64, -32, -64)
 * - Physical value linear scaling (`physical = BZERO + BSCALE * raw`)
 * - ASCII `TABLE` extensions
 * - Binary `BINTABLE` extensions
 * - Exact 2880-byte FITS block framing and padding
 */

import type {
  FitsBitpix,
  FitsCard,
  FitsDocument,
  FitsHdu,
  FitsHeader,
  FitsImageData,
  FitsTableColumn,
  FitsTableData,
} from "../types.js";
import {
  buildFitsHeader,
  classifyHduKind,
  FITS_BLOCK_BYTES,
  FITS_CARD_LENGTH,
  FITS_CARDS_PER_BLOCK,
  formatFitsCard,
  parseFitsCard,
  serializeFitsHeaderBlocks,
} from "./header-parser.js";

export const VALID_BITPIX_VALUES = new Set<number>([8, 16, 32, 64, -32, -64]);

export interface FitsHeaderCardInput {
  keyword: string;
  value?: boolean | number | string | null | undefined;
  comment?: string | undefined;
}

export interface FitsImageHduSpec {
  kind: "PRIMARY" | "IMAGE";
  name?: string | undefined;
  bitpix: FitsBitpix;
  axes: number[];
  /** Physical pixel values (row-major). */
  data: Float64Array | number[];
  bscale?: number | undefined;
  bzero?: number | undefined;
  extend?: boolean | undefined;
  extraCards?: FitsHeaderCardInput[] | undefined;
}

export interface FitsTableHduSpec {
  kind: "TABLE" | "BINTABLE";
  name?: string | undefined;
  columns: Array<{
    name: string;
    tform: string;
    unit?: string | undefined;
  }>;
  rows: Array<Record<string, unknown>>;
  extraCards?: FitsHeaderCardInput[] | undefined;
}

export type FitsHduEncodeSpec = FitsImageHduSpec | FitsTableHduSpec;

/** Returns byte size per element for a valid FITS `BITPIX`. */
export function bitpixByteSize(bitpix: number): number {
  return Math.abs(bitpix) / 8;
}

/** Rounds a byte length up to the next multiple of 2880 bytes. */
export function padToFitsBlock(byteLength: number): number {
  if (byteLength <= 0) return 0;
  return Math.ceil(byteLength / FITS_BLOCK_BYTES) * FITS_BLOCK_BYTES;
}

function getIntKeyword(header: FitsHeader, key: string, fallback = 0): number {
  const card = header.keywords[key];
  if (!card || typeof card.value !== "number") return fallback;
  return Math.trunc(card.value);
}

function getNumKeyword(header: FitsHeader, key: string, fallback: number): number {
  const card = header.keywords[key];
  if (!card || typeof card.value !== "number") return fallback;
  return card.value;
}

function getStrKeyword(header: FitsHeader, key: string): string | undefined {
  const card = header.keywords[key];
  if (!card || typeof card.value !== "string") return undefined;
  return card.value.trim();
}

/**
 * Parses a FITS `BINTABLE` or ASCII `TABLE` `TFORMn` specification.
 */
export function parseTform(
  tform: string,
  kind: "TABLE" | "BINTABLE",
): {
  repeat: number;
  typeCode: string;
  byteWidth: number;
} {
  const trimmed = tform.trim().toUpperCase();
  if (kind === "TABLE") {
    // ASCII table format: Aw, Iw, Fw.d, Ew.d, Dw.d
    const m = /^([AIFED])(\d+)(?:\.\d+)?$/.exec(trimmed);
    if (!m) {
      return { repeat: 1, typeCode: "A", byteWidth: 1 };
    }
    return {
      repeat: 1,
      typeCode: m[1]!,
      byteWidth: Number.parseInt(m[2]!, 10),
    };
  }

  // Binary table format: rT (e.g. "1E", "E", "16A", "1D", "1J", "1I", "1K", "1B", "1L")
  const m = /^(\d*)([LXBIJKAEDCM])/.exec(trimmed);
  if (!m) {
    return { repeat: 1, typeCode: "B", byteWidth: 1 };
  }
  const repeat = m[1] && m[1].length > 0 ? Number.parseInt(m[1], 10) : 1;
  const typeCode = m[2]!;
  let elemBytes = 1;
  switch (typeCode) {
    case "L":
    case "B":
    case "A":
      elemBytes = 1;
      break;
    case "X":
      return { repeat, typeCode, byteWidth: Math.ceil(repeat / 8) };
    case "I":
      elemBytes = 2;
      break;
    case "J":
    case "E":
      elemBytes = 4;
      break;
    case "K":
    case "D":
    case "C":
      elemBytes = 8;
      break;
    case "M":
      elemBytes = 16;
      break;
    default:
      elemBytes = 1;
  }
  return { repeat, typeCode, byteWidth: repeat * elemBytes };
}

/**
 * Decodes big-endian image pixels from `bytes` starting at `offset` and applies `BZERO + BSCALE * raw`.
 */
export function decodeImagePayload(
  bytes: Uint8Array,
  offset: number,
  bitpix: FitsBitpix,
  axes: number[],
  bscale = 1.0,
  bzero = 0.0,
): FitsImageData {
  const pixelCount = axes.length === 0 ? 0 : axes.reduce((acc, n) => acc * n, 1);
  const out = new Float64Array(pixelCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
  const elemBytes = bitpixByteSize(bitpix);
  const maxReadable = Math.min(pixelCount, Math.floor((bytes.byteLength - offset) / elemBytes));

  for (let i = 0; i < maxReadable; i++) {
    const pos = i * elemBytes;
    let raw: number;
    switch (bitpix) {
      case 8:
        raw = view.getUint8(pos);
        break;
      case 16:
        raw = view.getInt16(pos, false);
        break;
      case 32:
        raw = view.getInt32(pos, false);
        break;
      case 64:
        raw = Number(view.getBigInt64(pos, false));
        break;
      case -32:
        raw = view.getFloat32(pos, false);
        break;
      case -64:
        raw = view.getFloat64(pos, false);
        break;
    }
    out[i] = bzero + bscale * raw;
  }

  return {
    bitpix,
    naxis: axes.length,
    axes: [...axes],
    bscale,
    bzero,
    data: out,
  };
}

/**
 * Encodes physical pixel values into big-endian raw binary bytes padded to 2880-byte blocks.
 */
export function encodeImagePayload(
  data: Float64Array | number[],
  bitpix: FitsBitpix,
  bscale = 1.0,
  bzero = 0.0,
): Uint8Array {
  const elemBytes = bitpixByteSize(bitpix);
  const rawBytes = data.length * elemBytes;
  const paddedBytes = padToFitsBlock(rawBytes);
  const out = new Uint8Array(paddedBytes);
  if (rawBytes === 0) return out;

  const view = new DataView(out.buffer);
  const invScale = bscale !== 0 ? 1.0 / bscale : 1.0;

  for (let i = 0; i < data.length; i++) {
    const phys = data[i] ?? 0;
    const raw = (phys - bzero) * invScale;
    const pos = i * elemBytes;
    switch (bitpix) {
      case 8:
        view.setUint8(pos, Math.max(0, Math.min(255, Math.round(raw))));
        break;
      case 16:
        view.setInt16(pos, Math.max(-32768, Math.min(32767, Math.round(raw))), false);
        break;
      case 32:
        view.setInt32(pos, Math.max(-2147483648, Math.min(2147483647, Math.round(raw))), false);
        break;
      case 64:
        view.setBigInt64(pos, BigInt(Math.round(raw)), false);
        break;
      case -32:
        view.setFloat32(pos, raw, false);
        break;
      case -64:
        view.setFloat64(pos, raw, false);
        break;
    }
  }

  return out;
}

function decodeAsciiTablePayload(
  bytes: Uint8Array,
  offset: number,
  rowBytes: number,
  rowCount: number,
  columns: FitsTableColumn[],
): FitsTableData {
  const decoder = new TextDecoder("ascii");
  const rows: Array<Record<string, unknown>> = [];

  for (let r = 0; r < rowCount; r++) {
    const rowStart = offset + r * rowBytes;
    if (rowStart + rowBytes > bytes.byteLength) break;
    const rowStr = decoder.decode(bytes.subarray(rowStart, rowStart + rowBytes));
    const rowObj: Record<string, unknown> = {};
    for (const col of columns) {
      const start = Math.max(0, (col.tbcol ?? 1) - 1);
      const cell = rowStr.slice(start, start + col.byteWidth).trim();
      if (col.typeCode === "A") {
        rowObj[col.name] = cell;
      } else if (col.typeCode === "I") {
        rowObj[col.name] = cell.length > 0 ? Number.parseInt(cell, 10) : 0;
      } else {
        rowObj[col.name] = cell.length > 0 ? Number(cell.replace(/[dD]/, "e")) : 0;
      }
    }
    rows.push(rowObj);
  }

  return { kind: "TABLE", rowCount, rowBytes, columns, rows };
}

function decodeBinaryTablePayload(
  bytes: Uint8Array,
  offset: number,
  rowBytes: number,
  rowCount: number,
  columns: FitsTableColumn[],
): FitsTableData {
  const decoder = new TextDecoder("ascii");
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const rows: Array<Record<string, unknown>> = [];

  for (let r = 0; r < rowCount; r++) {
    let cursor = offset + r * rowBytes;
    if (cursor + rowBytes > bytes.byteLength) break;
    const rowObj: Record<string, unknown> = {};

    for (const col of columns) {
      const tscal = col.tscal ?? 1.0;
      const tzero = col.tzero ?? 0.0;
      if (col.typeCode === "A") {
        const str = decoder.decode(bytes.subarray(cursor, cursor + col.byteWidth)).replace(/[\0 ]+$/, "");
        rowObj[col.name] = str;
      } else if (col.typeCode === "L") {
        const vals: boolean[] = [];
        for (let k = 0; k < col.repeat; k++) {
          vals.push(bytes[cursor + k] === 0x54); // 'T'
        }
        rowObj[col.name] = col.repeat === 1 ? vals[0] : vals;
      } else {
        const vals: number[] = [];
        const step = col.repeat > 0 ? col.byteWidth / col.repeat : 1;
        for (let k = 0; k < col.repeat; k++) {
          const pos = cursor + k * step;
          let raw = 0;
          switch (col.typeCode) {
            case "B":
              raw = view.getUint8(pos);
              break;
            case "I":
              raw = view.getInt16(pos, false);
              break;
            case "J":
              raw = view.getInt32(pos, false);
              break;
            case "K":
              raw = Number(view.getBigInt64(pos, false));
              break;
            case "E":
              raw = view.getFloat32(pos, false);
              break;
            case "D":
              raw = view.getFloat64(pos, false);
              break;
            default:
              raw = view.getUint8(pos);
          }
          vals.push(tzero + tscal * raw);
        }
        rowObj[col.name] = col.repeat === 1 ? vals[0] : vals;
      }
      cursor += col.byteWidth;
    }
    rows.push(rowObj);
  }

  return { kind: "BINTABLE", rowCount, rowBytes, columns, rows };
}

function extractTableColumns(header: FitsHeader, kind: "TABLE" | "BINTABLE"): FitsTableColumn[] {
  const tfields = getIntKeyword(header, "TFIELDS", 0);
  const cols: FitsTableColumn[] = [];
  let runningTbcol = 1;

  for (let i = 1; i <= tfields; i++) {
    const name = getStrKeyword(header, `TTYPE${i}`) ?? `COL${i}`;
    const tform = getStrKeyword(header, `TFORM${i}`) ?? (kind === "TABLE" ? "A8" : "1E");
    const unit = getStrKeyword(header, `TUNIT${i}`);
    const parsed = parseTform(tform, kind);
    const tbcol = kind === "TABLE" ? getIntKeyword(header, `TBCOL${i}`, runningTbcol) : undefined;
    runningTbcol = (tbcol ?? runningTbcol) + parsed.byteWidth;

    const tscalCard = header.keywords[`TSCAL${i}`];
    const tzeroCard = header.keywords[`TZERO${i}`];
    const tscal = tscalCard && typeof tscalCard.value === "number" ? tscalCard.value : undefined;
    const tzero = tzeroCard && typeof tzeroCard.value === "number" ? tzeroCard.value : undefined;

    cols.push({
      index: i,
      name,
      tform,
      unit,
      tbcol,
      repeat: parsed.repeat,
      typeCode: parsed.typeCode,
      byteWidth: parsed.byteWidth,
      tscal,
      tzero,
    });
  }

  return cols;
}

/**
 * Decodes a binary FITS stream (2880-byte block-framed HDUs) into a `FitsDocument`.
 */
export function decodeFitsBinary(bytes: Uint8Array, uri?: string): FitsDocument {
  const decoder = new TextDecoder("latin1");
  const hdus: FitsHdu[] = [];
  let offset = 0;
  let globalLine = 1;

  while (offset + FITS_CARD_LENGTH <= bytes.byteLength) {
    const hduStartOffset = offset;
    const cards: FitsCard[] = [];
    let foundEnd = false;
    let cardIdx = 0;

    while (offset + FITS_CARD_LENGTH <= bytes.byteLength && !foundEnd) {
      // Read one 2880-byte header block (or remaining cards if truncated)
      const cardsInBlock = Math.min(FITS_CARDS_PER_BLOCK, Math.floor((bytes.byteLength - offset) / FITS_CARD_LENGTH));
      for (let c = 0; c < cardsInBlock; c++) {
        const cardBytes = bytes.subarray(offset + c * FITS_CARD_LENGTH, offset + (c + 1) * FITS_CARD_LENGTH);
        const raw = decoder.decode(cardBytes);
        if (!foundEnd) {
          const card = parseFitsCard(raw, globalLine++, cardIdx++);
          cards.push(card);
          if (card.keyword === "END") {
            foundEnd = true;
          }
        }
      }
      offset += cardsInBlock * FITS_CARD_LENGTH;
      if (cardsInBlock < FITS_CARDS_PER_BLOCK) {
        break;
      }
    }

    if (cards.length === 0) break;

    const header = buildFitsHeader(cards);
    const hduIndex = hdus.length;
    const kind = classifyHduKind(header, hduIndex);
    const name = getStrKeyword(header, "EXTNAME") ?? (hduIndex === 0 ? "PRIMARY" : `HDU_${hduIndex}`);

    const bitpix = getIntKeyword(header, "BITPIX", 8);
    const naxis = getIntKeyword(header, "NAXIS", 0);
    const pcount = getIntKeyword(header, "PCOUNT", 0);
    const gcount = getIntKeyword(header, "GCOUNT", 1);

    const axes: number[] = [];
    for (let a = 1; a <= naxis; a++) {
      axes.push(getIntKeyword(header, `NAXIS${a}`, 0));
    }

    const elemBytes = VALID_BITPIX_VALUES.has(bitpix) ? bitpixByteSize(bitpix) : 1;
    const axisProduct = naxis === 0 ? 0 : axes.reduce((acc, v) => acc * v, 1);
    const rawDataBytes = Math.max(0, elemBytes * gcount * (pcount + axisProduct));
    const paddedDataBytes = padToFitsBlock(rawDataBytes);

    let image: FitsImageData | undefined;
    let table: FitsTableData | undefined;

    if (rawDataBytes > 0 && offset < bytes.byteLength) {
      if ((kind === "PRIMARY" || kind === "IMAGE") && VALID_BITPIX_VALUES.has(bitpix)) {
        const bscale = getNumKeyword(header, "BSCALE", 1.0);
        const bzero = getNumKeyword(header, "BZERO", 0.0);
        image = decodeImagePayload(bytes, offset, bitpix as FitsBitpix, axes, bscale, bzero);
      } else if (kind === "TABLE" && axes.length >= 2) {
        const cols = extractTableColumns(header, "TABLE");
        table = decodeAsciiTablePayload(bytes, offset, axes[0]!, axes[1]!, cols);
      } else if (kind === "BINTABLE" && axes.length >= 2) {
        const cols = extractTableColumns(header, "BINTABLE");
        table = decodeBinaryTablePayload(bytes, offset, axes[0]!, axes[1]!, cols);
      }
    }

    const actualAvailable = Math.max(0, Math.min(rawDataBytes, bytes.byteLength - offset));

    hdus.push({
      index: hduIndex,
      kind,
      name,
      header,
      image,
      table,
      byteOffset: hduStartOffset,
      rawDataBytes: actualAvailable,
    });

    offset += paddedDataBytes;
    if (offset >= bytes.byteLength) break;
  }

  return {
    uri,
    hdus,
    binaryByteLength: bytes.byteLength,
    isBinary: true,
  };
}

function encodeAsciiTableHdu(spec: FitsTableHduSpec): Uint8Array {
  const columns: FitsTableColumn[] = [];
  let tbcol = 1;
  for (let i = 0; i < spec.columns.length; i++) {
    const c = spec.columns[i]!;
    const parsed = parseTform(c.tform, "TABLE");
    columns.push({
      index: i + 1,
      name: c.name,
      tform: c.tform,
      unit: c.unit,
      tbcol,
      repeat: parsed.repeat,
      typeCode: parsed.typeCode,
      byteWidth: parsed.byteWidth,
    });
    tbcol += parsed.byteWidth + 1; // 1-space separator
  }
  const rowBytes = Math.max(1, tbcol - 1);
  const rowCount = spec.rows.length;

  const cards: string[] = [
    formatFitsCard("XTENSION", "TABLE", "ASCII table extension"),
    formatFitsCard("BITPIX", 8, "8-bit ASCII characters"),
    formatFitsCard("NAXIS", 2, "2-dimensional ASCII table"),
    formatFitsCard("NAXIS1", rowBytes, "Width of table in characters"),
    formatFitsCard("NAXIS2", rowCount, "Number of rows in table"),
    formatFitsCard("PCOUNT", 0, "No special data parameters"),
    formatFitsCard("GCOUNT", 1, "One data group"),
    formatFitsCard("TFIELDS", columns.length, "Number of fields per row"),
  ];
  if (spec.name) {
    cards.push(formatFitsCard("EXTNAME", spec.name, "Extension name"));
  }
  for (const col of columns) {
    cards.push(formatFitsCard(`TBCOL${col.index}`, col.tbcol ?? 1, `Start column of field ${col.index}`));
    cards.push(formatFitsCard(`TFORM${col.index}`, col.tform, `Format of field ${col.index}`));
    cards.push(formatFitsCard(`TTYPE${col.index}`, col.name, `Label of field ${col.index}`));
    if (col.unit) {
      cards.push(formatFitsCard(`TUNIT${col.index}`, col.unit, `Physical unit of field ${col.index}`));
    }
  }
  if (spec.extraCards) {
    for (const extra of spec.extraCards) {
      cards.push(formatFitsCard(extra.keyword, extra.value, extra.comment));
    }
  }

  const headerBytes = serializeFitsHeaderBlocks(cards);
  const rawDataBytes = rowBytes * rowCount;
  const paddedDataBytes = padToFitsBlock(rawDataBytes);
  const dataBytes = new Uint8Array(paddedDataBytes);
  dataBytes.fill(0x20); // ASCII TABLE pads with spaces (FITS 4.0 §7.2.4)

  const encoder = new TextEncoder();
  for (let r = 0; r < rowCount; r++) {
    const row = spec.rows[r]!;
    const base = r * rowBytes;
    for (const col of columns) {
      const val = row[col.name];
      let text: string;
      if (col.typeCode === "A") {
        text = String(val ?? "")
          .slice(0, col.byteWidth)
          .padEnd(col.byteWidth, " ");
      } else if (col.typeCode === "I") {
        text = String(Math.trunc(Number(val ?? 0))).padStart(col.byteWidth, " ");
      } else {
        const num = Number(val ?? 0);
        text = num.toPrecision(Math.max(1, Math.min(8, col.byteWidth - 4))).padStart(col.byteWidth, " ");
      }
      const encoded = encoder.encode(text.slice(0, col.byteWidth));
      dataBytes.set(encoded, base + ((col.tbcol ?? 1) - 1));
    }
  }

  const combined = new Uint8Array(headerBytes.byteLength + dataBytes.byteLength);
  combined.set(headerBytes, 0);
  combined.set(dataBytes, headerBytes.byteLength);
  return combined;
}

function encodeBinaryTableHdu(spec: FitsTableHduSpec): Uint8Array {
  const columns: FitsTableColumn[] = spec.columns.map((c, idx) => {
    const parsed = parseTform(c.tform, "BINTABLE");
    return {
      index: idx + 1,
      name: c.name,
      tform: c.tform,
      unit: c.unit,
      repeat: parsed.repeat,
      typeCode: parsed.typeCode,
      byteWidth: parsed.byteWidth,
    };
  });

  const rowBytes = columns.reduce((acc, c) => acc + c.byteWidth, 0);
  const rowCount = spec.rows.length;

  const cards: string[] = [
    formatFitsCard("XTENSION", "BINTABLE", "Binary table extension"),
    formatFitsCard("BITPIX", 8, "8-bit bytes"),
    formatFitsCard("NAXIS", 2, "2-dimensional binary table"),
    formatFitsCard("NAXIS1", rowBytes, "Width of table in bytes"),
    formatFitsCard("NAXIS2", rowCount, "Number of rows in table"),
    formatFitsCard("PCOUNT", 0, "Size of special data area"),
    formatFitsCard("GCOUNT", 1, "One data group"),
    formatFitsCard("TFIELDS", columns.length, "Number of fields per row"),
  ];
  if (spec.name) {
    cards.push(formatFitsCard("EXTNAME", spec.name, "Extension name"));
  }
  for (const col of columns) {
    cards.push(formatFitsCard(`TTYPE${col.index}`, col.name, `Label of field ${col.index}`));
    cards.push(formatFitsCard(`TFORM${col.index}`, col.tform, `Format of field ${col.index}`));
    if (col.unit) {
      cards.push(formatFitsCard(`TUNIT${col.index}`, col.unit, `Physical unit of field ${col.index}`));
    }
  }
  if (spec.extraCards) {
    for (const extra of spec.extraCards) {
      cards.push(formatFitsCard(extra.keyword, extra.value, extra.comment));
    }
  }

  const headerBytes = serializeFitsHeaderBlocks(cards);
  const rawDataBytes = rowBytes * rowCount;
  const paddedDataBytes = padToFitsBlock(rawDataBytes);
  const dataBytes = new Uint8Array(paddedDataBytes);
  const view = new DataView(dataBytes.buffer);
  const encoder = new TextEncoder();

  for (let r = 0; r < rowCount; r++) {
    const row = spec.rows[r]!;
    let cursor = r * rowBytes;
    for (const col of columns) {
      const val = row[col.name];
      if (col.typeCode === "A") {
        const str = String(val ?? "")
          .slice(0, col.byteWidth)
          .padEnd(col.byteWidth, " ");
        dataBytes.set(encoder.encode(str), cursor);
      } else if (col.typeCode === "L") {
        const arr = Array.isArray(val) ? val : [Boolean(val)];
        for (let k = 0; k < col.repeat; k++) {
          dataBytes[cursor + k] = arr[k] ? 0x54 : 0x46; // 'T' or 'F'
        }
      } else {
        const arr = Array.isArray(val) ? val : [Number(val ?? 0)];
        const step = col.repeat > 0 ? col.byteWidth / col.repeat : 1;
        for (let k = 0; k < col.repeat; k++) {
          const num = Number(arr[k] ?? 0);
          const pos = cursor + k * step;
          switch (col.typeCode) {
            case "B":
              view.setUint8(pos, Math.max(0, Math.min(255, Math.round(num))));
              break;
            case "I":
              view.setInt16(pos, Math.round(num), false);
              break;
            case "J":
              view.setInt32(pos, Math.round(num), false);
              break;
            case "K":
              view.setBigInt64(pos, BigInt(Math.round(num)), false);
              break;
            case "E":
              view.setFloat32(pos, num, false);
              break;
            case "D":
              view.setFloat64(pos, num, false);
              break;
            default:
              view.setUint8(pos, Math.round(num) & 0xff);
          }
        }
      }
      cursor += col.byteWidth;
    }
  }

  const combined = new Uint8Array(headerBytes.byteLength + dataBytes.byteLength);
  combined.set(headerBytes, 0);
  combined.set(dataBytes, headerBytes.byteLength);
  return combined;
}

function encodeImageHdu(spec: FitsImageHduSpec, hasFollowingExtensions: boolean): Uint8Array {
  const bscale = spec.bscale ?? 1.0;
  const bzero = spec.bzero ?? 0.0;
  const cards: string[] = [];

  if (spec.kind === "PRIMARY") {
    cards.push(formatFitsCard("SIMPLE", true, "Conforms to FITS 4.0 standard"));
  } else {
    cards.push(formatFitsCard("XTENSION", "IMAGE", "Image extension"));
  }

  cards.push(formatFitsCard("BITPIX", spec.bitpix, "Bits per data value"));
  cards.push(formatFitsCard("NAXIS", spec.axes.length, "Number of data axes"));
  for (let i = 0; i < spec.axes.length; i++) {
    cards.push(formatFitsCard(`NAXIS${i + 1}`, spec.axes[i]!, `Length of data axis ${i + 1}`));
  }

  if (spec.kind === "PRIMARY") {
    if (spec.extend !== undefined ? spec.extend : hasFollowingExtensions) {
      cards.push(formatFitsCard("EXTEND", true, "File may contain FITS extensions"));
    }
  } else {
    cards.push(formatFitsCard("PCOUNT", 0, "Number of random group parameters"));
    cards.push(formatFitsCard("GCOUNT", 1, "Number of random groups"));
    if (spec.name) {
      cards.push(formatFitsCard("EXTNAME", spec.name, "Extension name"));
    }
  }

  if (bscale !== 1.0) {
    cards.push(formatFitsCard("BSCALE", bscale, "Physical scaling factor"));
  }
  if (bzero !== 0.0) {
    cards.push(formatFitsCard("BZERO", bzero, "Physical zero offset"));
  }

  if (spec.extraCards) {
    for (const extra of spec.extraCards) {
      cards.push(formatFitsCard(extra.keyword, extra.value, extra.comment));
    }
  }

  const headerBytes = serializeFitsHeaderBlocks(cards);
  const dataBytes = encodeImagePayload(spec.data, spec.bitpix, bscale, bzero);

  const combined = new Uint8Array(headerBytes.byteLength + dataBytes.byteLength);
  combined.set(headerBytes, 0);
  combined.set(dataBytes, headerBytes.byteLength);
  return combined;
}

/**
 * Encodes one or more HDU specifications into a compliant 2880-byte-aligned binary FITS file.
 */
export function encodeFitsBinary(hdus: FitsHduEncodeSpec[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const hasExtensions = hdus.length > 1;

  for (let i = 0; i < hdus.length; i++) {
    const spec = hdus[i]!;
    if (spec.kind === "PRIMARY" || spec.kind === "IMAGE") {
      chunks.push(encodeImageHdu(spec, i === 0 && hasExtensions));
    } else if (spec.kind === "TABLE") {
      chunks.push(encodeAsciiTableHdu(spec));
    } else if (spec.kind === "BINTABLE") {
      chunks.push(encodeBinaryTableHdu(spec));
    }
  }

  const totalBytes = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
