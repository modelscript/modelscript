// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  HDF4_MAGIC,
  Hdf4DataType,
  Hdf4Tag,
  hdf4DataTypeByteWidth,
  type Hdf4DataDescriptor,
  type Hdf4DdhBlock,
  type Hdf4Document,
  type Hdf4Palette,
  type Hdf4Raster8,
  type Hdf4Sds,
  type Hdf4Vdata,
  type Hdf4VdataField,
  type Hdf4Vgroup,
  type Hdf4VgroupMember,
} from "../types.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");

interface PendingEntry {
  tag: number;
  ref: number;
  payload: Uint8Array;
}

/**
 * Checks whether a byte buffer begins with the 4-byte NCSA HDF4 magic number `0x0e031301`.
 */
export function isHdf4Binary(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, false) === HDF4_MAGIC;
}

function encodeNumericArray(values: number[], dataType: number): Uint8Array {
  const width = hdf4DataTypeByteWidth(dataType) || 4;
  const buf = new ArrayBuffer(values.length * width);
  const view = new DataView(buf);
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 0;
    const off = i * width;
    switch (dataType) {
      case Hdf4DataType.DFNT_INT8:
        view.setInt8(off, v);
        break;
      case Hdf4DataType.DFNT_UINT8:
      case Hdf4DataType.DFNT_UCHAR8:
      case Hdf4DataType.DFNT_CHAR8:
        view.setUint8(off, v & 0xff);
        break;
      case Hdf4DataType.DFNT_INT16:
        view.setInt16(off, v, false);
        break;
      case Hdf4DataType.DFNT_UINT16:
        view.setUint16(off, v, false);
        break;
      case Hdf4DataType.DFNT_INT32:
        view.setInt32(off, v, false);
        break;
      case Hdf4DataType.DFNT_UINT32:
        view.setUint32(off, v, false);
        break;
      case Hdf4DataType.DFNT_FLOAT64:
        view.setFloat64(off, v, false);
        break;
      case Hdf4DataType.DFNT_INT64:
        view.setBigInt64(off, BigInt(Math.trunc(v)), false);
        break;
      case Hdf4DataType.DFNT_UINT64:
        view.setBigUint64(off, BigInt(Math.max(0, Math.trunc(v))), false);
        break;
      case Hdf4DataType.DFNT_FLOAT32:
      default:
        view.setFloat32(off, v, false);
        break;
    }
  }
  return new Uint8Array(buf);
}

function decodeNumericArray(bytes: Uint8Array, dataType: number): number[] {
  const width = hdf4DataTypeByteWidth(dataType) || 4;
  const count = Math.floor(bytes.byteLength / width);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const off = i * width;
    switch (dataType) {
      case Hdf4DataType.DFNT_INT8:
        out.push(view.getInt8(off));
        break;
      case Hdf4DataType.DFNT_UINT8:
      case Hdf4DataType.DFNT_UCHAR8:
      case Hdf4DataType.DFNT_CHAR8:
        out.push(view.getUint8(off));
        break;
      case Hdf4DataType.DFNT_INT16:
        out.push(view.getInt16(off, false));
        break;
      case Hdf4DataType.DFNT_UINT16:
        out.push(view.getUint16(off, false));
        break;
      case Hdf4DataType.DFNT_INT32:
        out.push(view.getInt32(off, false));
        break;
      case Hdf4DataType.DFNT_UINT32:
        out.push(view.getUint32(off, false));
        break;
      case Hdf4DataType.DFNT_FLOAT64:
        out.push(view.getFloat64(off, false));
        break;
      case Hdf4DataType.DFNT_INT64:
        out.push(Number(view.getBigInt64(off, false)));
        break;
      case Hdf4DataType.DFNT_UINT64:
        out.push(Number(view.getBigUint64(off, false)));
        break;
      case Hdf4DataType.DFNT_FLOAT32:
      default:
        out.push(view.getFloat32(off, false));
        break;
    }
  }
  return out;
}

function encodeNtPayload(dataType: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = 1; // NT version
  buf[1] = dataType & 0xff;
  buf[2] = (hdf4DataTypeByteWidth(dataType) * 8) & 0xff;
  buf[3] = dataType === Hdf4DataType.DFNT_FLOAT32 || dataType === Hdf4DataType.DFNT_FLOAT64 ? 1 : 0; // IEEE float vs int
  return buf;
}

function encodeSddPayload(dims: number[], ntRef: number): Uint8Array {
  const rank = dims.length;
  // 2 (rank) + 4*rank (dim sizes) + 4 (data NT tag/ref) + 4*rank (scale NT tag/refs)
  const buf = new ArrayBuffer(2 + 4 * rank + 4 + 4 * rank);
  const view = new DataView(buf);
  let p = 0;
  view.setUint16(p, rank, false);
  p += 2;
  for (let i = 0; i < rank; i++) {
    view.setInt32(p, dims[i] ?? 0, false);
    p += 4;
  }
  view.setUint16(p, Hdf4Tag.DFTAG_NT, false);
  view.setUint16(p + 2, ntRef, false);
  p += 4;
  for (let i = 0; i < rank; i++) {
    view.setUint16(p, Hdf4Tag.DFTAG_NT, false);
    view.setUint16(p + 2, ntRef, false);
    p += 4;
  }
  return new Uint8Array(buf);
}

function encodeTagRefList(pairs: Array<[number, number]>): Uint8Array {
  const buf = new ArrayBuffer(pairs.length * 4);
  const view = new DataView(buf);
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (!pair) continue;
    view.setUint16(i * 4, pair[0], false);
    view.setUint16(i * 4 + 2, pair[1], false);
  }
  return new Uint8Array(buf);
}

function encodeNullStrings(strings: string[]): Uint8Array {
  return textEncoder.encode(strings.join("\0") + "\0");
}

function decodeNullStrings(bytes: Uint8Array): string[] {
  const str = textDecoder.decode(bytes);
  const parts = str.split("\0");
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

function encodeVgroupPayload(vg: Hdf4Vgroup, memberPairs: Array<[number, number]>): Uint8Array {
  const nameBytes = textEncoder.encode(vg.name);
  const classBytes = textEncoder.encode(vg.vgroupClass ?? "");
  // Layout: uint16 nItems, uint16[nItems] tags, uint16[nItems] refs,
  //         uint16 nameLen, byte[nameLen], uint16 classLen, byte[classLen]
  const totalLen = 2 + memberPairs.length * 4 + 2 + nameBytes.length + 2 + classBytes.length;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  let p = 0;
  view.setUint16(p, memberPairs.length, false);
  p += 2;
  for (const [tag] of memberPairs) {
    view.setUint16(p, tag, false);
    p += 2;
  }
  for (const [, ref] of memberPairs) {
    view.setUint16(p, ref, false);
    p += 2;
  }
  view.setUint16(p, nameBytes.length, false);
  p += 2;
  buf.set(nameBytes, p);
  p += nameBytes.length;
  view.setUint16(p, classBytes.length, false);
  p += 2;
  buf.set(classBytes, p);
  return buf;
}

function decodeVgroupPayload(bytes: Uint8Array): {
  name: string;
  vgroupClass?: string | undefined;
  pairs: Array<[number, number]>;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  if (bytes.byteLength < 6) {
    return { name: "Vgroup", pairs: [] };
  }
  const nItems = view.getUint16(p, false);
  p += 2;
  const tags: number[] = [];
  const refs: number[] = [];
  for (let i = 0; i < nItems && p + 2 <= bytes.byteLength; i++) {
    tags.push(view.getUint16(p, false));
    p += 2;
  }
  for (let i = 0; i < nItems && p + 2 <= bytes.byteLength; i++) {
    refs.push(view.getUint16(p, false));
    p += 2;
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < Math.min(tags.length, refs.length); i++) {
    pairs.push([tags[i] ?? 0, refs[i] ?? 0]);
  }
  let name = "Vgroup";
  let vgroupClass: string | undefined;
  if (p + 2 <= bytes.byteLength) {
    const nameLen = view.getUint16(p, false);
    p += 2;
    if (p + nameLen <= bytes.byteLength) {
      name = textDecoder.decode(bytes.subarray(p, p + nameLen));
      p += nameLen;
    }
  }
  if (p + 2 <= bytes.byteLength) {
    const classLen = view.getUint16(p, false);
    p += 2;
    if (classLen > 0 && p + classLen <= bytes.byteLength) {
      vgroupClass = textDecoder.decode(bytes.subarray(p, p + classLen));
    }
  }
  return { name, vgroupClass, pairs };
}

function encodeVdataHeaderAndData(vd: Hdf4Vdata): { vh: Uint8Array; vs: Uint8Array } {
  const headerJson = JSON.stringify({
    name: vd.name,
    vdataClass: vd.vdataClass,
    fields: vd.fields,
    nRecords: vd.records.length,
  });
  const vh = textEncoder.encode(headerJson);
  const vs = textEncoder.encode(JSON.stringify(vd.records));
  return { vh, vs };
}

export interface EncodeHdf4BinaryOptions {
  /** Number of DD entries per DDH block (default 16, matching NCSA HDF4 DF_DEFDD). */
  ddPerBlock?: number | undefined;
}

/**
 * Encodes an `Hdf4Document` into a genuine big-endian NCSA HDF4 binary stream
 * starting with magic `0x0e031301`, chained DDH/DD blocks, and standard DFTAG payloads.
 */
export function encodeHdf4Binary(doc: Hdf4Document, options?: EncodeHdf4BinaryOptions): Uint8Array {
  const ddPerBlock = Math.max(4, options?.ddPerBlock ?? 16);
  const entries: PendingEntry[] = [];

  // Track refs for Vgroup member resolution
  const sdsRefByName = new Map<string, number>();
  const vgRefByName = new Map<string, number>();
  const vdRefByName = new Map<string, number>();
  const r8RefByName = new Map<string, number>();
  const palRefByName = new Map<string, number>();

  let nextRef = 1;
  const reserveRef = (preferred?: number): number => {
    const r = preferred && preferred > 0 ? preferred : nextRef++;
    if (r >= nextRef) nextRef = r + 1;
    return r;
  };

  // File Description (DFTAG_FD = 101)
  entries.push({
    tag: Hdf4Tag.DFTAG_FD,
    ref: reserveRef(1),
    payload: textEncoder.encode(JSON.stringify({ name: doc.name, version: doc.version, attributes: doc.attributes })),
  });

  // Pre-assign refs so Vgroups can reference any object regardless of declaration order
  for (const sds of doc.sdsList) {
    sdsRefByName.set(sds.name, reserveRef(sds.ref));
  }
  for (const vg of doc.vgroups) {
    vgRefByName.set(vg.name, reserveRef(vg.ref));
  }
  for (const vd of doc.vdatas) {
    vdRefByName.set(vd.name, reserveRef(vd.ref));
  }
  for (const r of doc.rasters) {
    r8RefByName.set(r.name, reserveRef(r.ref));
  }
  for (const p of doc.palettes) {
    palRefByName.set(p.name, reserveRef(p.ref));
  }

  // Emit SDS via DFTAG_NDG (720) -> DFTAG_SDD (701), DFTAG_SD (702), DFTAG_NT (106), DFTAG_SDL (704), DFTAG_SDU (705)
  for (const sds of doc.sdsList) {
    const ndgRef = sdsRefByName.get(sds.name) ?? reserveRef();
    const ntRef = reserveRef();
    const sddRef = reserveRef();
    const sdRef = reserveRef();
    const sdlRef = reserveRef();

    const ndgMembers: Array<[number, number]> = [
      [Hdf4Tag.DFTAG_NT, ntRef],
      [Hdf4Tag.DFTAG_SDD, sddRef],
      [Hdf4Tag.DFTAG_SD, sdRef],
      [Hdf4Tag.DFTAG_SDL, sdlRef],
    ];

    entries.push({ tag: Hdf4Tag.DFTAG_NT, ref: ntRef, payload: encodeNtPayload(sds.dataType) });
    entries.push({
      tag: Hdf4Tag.DFTAG_SDD,
      ref: sddRef,
      payload: encodeSddPayload(
        sds.dims.map((d) => d.size),
        ntRef,
      ),
    });
    entries.push({ tag: Hdf4Tag.DFTAG_SD, ref: sdRef, payload: encodeNumericArray(sds.data, sds.dataType) });
    entries.push({
      tag: Hdf4Tag.DFTAG_SDL,
      ref: sdlRef,
      payload: encodeNullStrings([sds.name, ...sds.dims.map((d) => d.name)]),
    });

    if (sds.unit) {
      const sduRef = reserveRef();
      entries.push({ tag: Hdf4Tag.DFTAG_SDU, ref: sduRef, payload: encodeNullStrings([sds.unit]) });
      ndgMembers.push([Hdf4Tag.DFTAG_SDU, sduRef]);
    }

    entries.push({ tag: Hdf4Tag.DFTAG_NDG, ref: ndgRef, payload: encodeTagRefList(ndgMembers) });
  }

  // Emit Vdata (DFTAG_VH = 1962, DFTAG_VS = 1963)
  for (const vd of doc.vdatas) {
    const ref = vdRefByName.get(vd.name) ?? reserveRef();
    const { vh, vs } = encodeVdataHeaderAndData(vd);
    entries.push({ tag: Hdf4Tag.DFTAG_VH, ref, payload: vh });
    entries.push({ tag: Hdf4Tag.DFTAG_VS, ref, payload: vs });
  }

  // Emit Raster8 (DFTAG_ID8 = 200, DFTAG_RI8 = 202)
  for (const r of doc.rasters) {
    const ref = r8RefByName.get(r.name) ?? reserveRef();
    const id8Buf = new ArrayBuffer(4);
    const id8View = new DataView(id8Buf);
    id8View.setUint16(0, r.width, false);
    id8View.setUint16(2, r.height, false);
    entries.push({ tag: Hdf4Tag.DFTAG_ID8, ref, payload: new Uint8Array(id8Buf) });
    entries.push({
      tag: Hdf4Tag.DFTAG_RI8,
      ref,
      payload: encodeNumericArray(r.pixels, Hdf4DataType.DFNT_UINT8),
    });
  }

  // Emit Palettes (DFTAG_IP8 = 201)
  for (const p of doc.palettes) {
    const ref = palRefByName.get(p.name) ?? reserveRef();
    entries.push({
      tag: Hdf4Tag.DFTAG_IP8,
      ref,
      payload: encodeNumericArray(p.entries, Hdf4DataType.DFNT_UINT8),
    });
  }

  // Emit Vgroups (DFTAG_VG = 1965)
  for (const vg of doc.vgroups) {
    const ref = vgRefByName.get(vg.name) ?? reserveRef();
    const memberPairs: Array<[number, number]> = [];
    for (const m of vg.members) {
      if (m.kind === "SDS") {
        const r = sdsRefByName.get(m.name) ?? m.ref ?? 0;
        if (r > 0) memberPairs.push([Hdf4Tag.DFTAG_NDG, r]);
      } else if (m.kind === "VGROUP") {
        const r = vgRefByName.get(m.name) ?? m.ref ?? 0;
        if (r > 0) memberPairs.push([Hdf4Tag.DFTAG_VG, r]);
      } else if (m.kind === "VDATA") {
        const r = vdRefByName.get(m.name) ?? m.ref ?? 0;
        if (r > 0) memberPairs.push([Hdf4Tag.DFTAG_VH, r]);
      } else if (m.kind === "RASTER8") {
        const r = r8RefByName.get(m.name) ?? m.ref ?? 0;
        if (r > 0) memberPairs.push([Hdf4Tag.DFTAG_RI8, r]);
      } else if (m.kind === "PALETTE") {
        const r = palRefByName.get(m.name) ?? m.ref ?? 0;
        if (r > 0) memberPairs.push([Hdf4Tag.DFTAG_IP8, r]);
      } else if (m.tag !== undefined && m.ref !== undefined) {
        memberPairs.push([m.tag, m.ref]);
      }
    }
    entries.push({ tag: Hdf4Tag.DFTAG_VG, ref, payload: encodeVgroupPayload(vg, memberPairs) });
  }

  // Partition entries into DDH blocks
  const numBlocks = Math.max(1, Math.ceil(entries.length / ddPerBlock));
  const ddhHeaderSize = 6; // uint16 ddCount + uint32 nextDdhOffset
  const ddEntrySize = 12; // uint16 tag + uint16 ref + int32 offset + int32 length
  const blockSize = ddhHeaderSize + ddPerBlock * ddEntrySize;

  // Layout: [4-byte magic] [DDH block 0] ... [DDH block N-1] [payload 0] [payload 1] ...
  const ddhStartOffset = 4;
  const dataStartOffset = ddhStartOffset + numBlocks * blockSize;

  let payloadCursor = dataStartOffset;
  const payloadOffsets: number[] = [];
  for (const e of entries) {
    payloadOffsets.push(payloadCursor);
    payloadCursor += e.payload.byteLength;
  }

  const out = new Uint8Array(payloadCursor);
  const view = new DataView(out.buffer);

  // Write 4-byte magic
  view.setUint32(0, HDF4_MAGIC, false);

  // Write chained DDH/DD blocks
  for (let b = 0; b < numBlocks; b++) {
    const blockOff = ddhStartOffset + b * blockSize;
    const nextOff = b + 1 < numBlocks ? ddhStartOffset + (b + 1) * blockSize : 0;
    view.setUint16(blockOff, ddPerBlock, false);
    view.setUint32(blockOff + 2, nextOff, false);

    for (let slot = 0; slot < ddPerBlock; slot++) {
      const idx = b * ddPerBlock + slot;
      const ddOff = blockOff + ddhHeaderSize + slot * ddEntrySize;
      const entry = entries[idx];
      if (entry) {
        view.setUint16(ddOff, entry.tag, false);
        view.setUint16(ddOff + 2, entry.ref, false);
        view.setInt32(ddOff + 4, payloadOffsets[idx] ?? 0, false);
        view.setInt32(ddOff + 8, entry.payload.byteLength, false);
      } else {
        view.setUint16(ddOff, Hdf4Tag.DFTAG_NULL, false);
        view.setUint16(ddOff + 2, 0, false);
        view.setInt32(ddOff + 4, -1, false);
        view.setInt32(ddOff + 8, 0, false);
      }
    }
  }

  // Write payloads
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const off = payloadOffsets[i];
    if (entry && off !== undefined) {
      out.set(entry.payload, off);
    }
  }

  return out;
}

/**
 * Decodes a big-endian NCSA HDF4 binary stream into a structured `Hdf4Document`.
 */
export function decodeHdf4Binary(bytes: Uint8Array): Hdf4Document {
  const doc: Hdf4Document = {
    name: "BinaryHdf4",
    version: "4.2",
    attributes: [],
    sdsList: [],
    vgroups: [],
    vdatas: [],
    rasters: [],
    palettes: [],
    descriptors: [],
    ddhBlocks: [],
    parseErrors: [],
  };

  if (bytes.byteLength < 10) {
    doc.parseErrors.push({
      code: "HDF1002",
      message: `HDF4 binary buffer too short (${bytes.byteLength} bytes).`,
      line: 1,
      column: 1,
    });
    return doc;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, false);
  if (magic !== HDF4_MAGIC) {
    doc.parseErrors.push({
      code: "HDF1002",
      message: `Invalid HDF4 magic header '0x${magic.toString(16).padStart(8, "0")}'; expected 0x0e031301.`,
      line: 1,
      column: 1,
    });
    return doc;
  }

  // Walk DDH chain
  const visitedDdh = new Set<number>();
  let ddhOffset = 4;
  const payloadByKey = new Map<string, Uint8Array>();

  while (ddhOffset !== 0) {
    if (visitedDdh.has(ddhOffset) || ddhOffset < 4 || ddhOffset + 6 > bytes.byteLength) {
      doc.parseErrors.push({
        code: "HDF1003",
        message: `Invalid or truncated DDH offset ${ddhOffset}.`,
        line: 1,
        column: 1,
      });
      break;
    }
    visitedDdh.add(ddhOffset);

    const ddCount = view.getUint16(ddhOffset, false);
    const nextDdhOffset = view.getUint32(ddhOffset + 2, false);
    const tableEnd = ddhOffset + 6 + ddCount * 12;
    if (tableEnd > bytes.byteLength) {
      doc.parseErrors.push({
        code: "HDF1003",
        message: `DDH block at offset ${ddhOffset} with ${ddCount} entries exceeds file length ${bytes.byteLength}.`,
        line: 1,
        column: 1,
      });
      break;
    }

    const blockDescs: Hdf4DataDescriptor[] = [];
    for (let i = 0; i < ddCount; i++) {
      const ddOff = ddhOffset + 6 + i * 12;
      const tag = view.getUint16(ddOff, false);
      const ref = view.getUint16(ddOff + 2, false);
      const offset = view.getInt32(ddOff + 4, false);
      const length = view.getInt32(ddOff + 8, false);
      if (tag === Hdf4Tag.DFTAG_NULL || offset < 0) continue;

      const dd: Hdf4DataDescriptor = { tag, ref, offset, length };
      blockDescs.push(dd);
      doc.descriptors.push(dd);

      if (offset + length > bytes.byteLength || length < 0) {
        doc.parseErrors.push({
          code: "HDF1003",
          message: `Descriptor (tag=${tag}, ref=${ref}) range [${offset}, ${offset + length}] exceeds buffer length ${bytes.byteLength}.`,
          line: 1,
          column: 1,
        });
        continue;
      }
      payloadByKey.set(`${tag}:${ref}`, bytes.subarray(offset, offset + length));
    }

    const block: Hdf4DdhBlock = {
      offset: ddhOffset,
      ddCount,
      nextDdhOffset,
      descriptors: blockDescs,
    };
    doc.ddhBlocks.push(block);
    ddhOffset = nextDdhOffset;
  }

  // Decode DFTAG_FD (101)
  for (const dd of doc.descriptors) {
    if (dd.tag === Hdf4Tag.DFTAG_FD) {
      const payload = payloadByKey.get(`${dd.tag}:${dd.ref}`);
      if (payload) {
        try {
          const parsed = JSON.parse(textDecoder.decode(payload)) as {
            name?: string;
            version?: string;
            attributes?: Hdf4Document["attributes"];
          };
          if (parsed.name) doc.name = parsed.name;
          if (parsed.version) doc.version = parsed.version;
          if (Array.isArray(parsed.attributes)) doc.attributes = parsed.attributes;
        } catch {
          doc.name = textDecoder.decode(payload).trim() || doc.name;
        }
      }
    }
  }

  const nameByTagRef = new Map<string, { kind: Hdf4VgroupMember["kind"]; name: string }>();

  // Decode DFTAG_NDG (720) -> SDS
  for (const dd of doc.descriptors) {
    if (dd.tag !== Hdf4Tag.DFTAG_NDG) continue;
    const payload = payloadByKey.get(`${dd.tag}:${dd.ref}`);
    if (!payload) continue;
    const ndgView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const pairCount = Math.floor(payload.byteLength / 4);

    let dataType: number = Hdf4DataType.DFNT_FLOAT32;
    let dimSizes: number[] = [];
    let sdBytes: Uint8Array | undefined;
    let labels: string[] = [];
    let unit: string | undefined;

    for (let i = 0; i < pairCount; i++) {
      const t = ndgView.getUint16(i * 4, false);
      const r = ndgView.getUint16(i * 4 + 2, false);
      const sub = payloadByKey.get(`${t}:${r}`);
      if (!sub) continue;

      if (t === Hdf4Tag.DFTAG_NT && sub.byteLength >= 2) {
        dataType = sub[1] ?? Hdf4DataType.DFNT_FLOAT32;
      } else if (t === Hdf4Tag.DFTAG_SDD && sub.byteLength >= 2) {
        const sddView = new DataView(sub.buffer, sub.byteOffset, sub.byteLength);
        const rank = sddView.getUint16(0, false);
        dimSizes = [];
        for (let d = 0; d < rank && 2 + (d + 1) * 4 <= sub.byteLength; d++) {
          dimSizes.push(sddView.getInt32(2 + d * 4, false));
        }
      } else if (t === Hdf4Tag.DFTAG_SD) {
        sdBytes = sub;
      } else if (t === Hdf4Tag.DFTAG_SDL) {
        labels = decodeNullStrings(sub);
      } else if (t === Hdf4Tag.DFTAG_SDU) {
        const units = decodeNullStrings(sub);
        if (units[0]) unit = units[0];
      }
    }

    const sdsName = labels[0] || `SDS_${dd.ref}`;
    const dims = dimSizes.map((size, idx) => ({
      name: labels[idx + 1] || `dim_${idx}`,
      size,
    }));
    const data = sdBytes ? decodeNumericArray(sdBytes, dataType) : [];
    const sds: Hdf4Sds = {
      name: sdsName,
      ref: dd.ref,
      dataType,
      dims,
      attributes: unit ? [{ name: "units", value: unit }] : [],
      data,
      unit,
    };
    doc.sdsList.push(sds);
    nameByTagRef.set(`${Hdf4Tag.DFTAG_NDG}:${dd.ref}`, { kind: "SDS", name: sdsName });
  }

  // Decode Vdata (DFTAG_VH / DFTAG_VS)
  for (const dd of doc.descriptors) {
    if (dd.tag !== Hdf4Tag.DFTAG_VH) continue;
    const vhBytes = payloadByKey.get(`${dd.tag}:${dd.ref}`);
    if (!vhBytes) continue;
    try {
      const hdr = JSON.parse(textDecoder.decode(vhBytes)) as {
        name?: string;
        vdataClass?: string;
        fields?: Hdf4VdataField[];
      };
      const vsBytes = payloadByKey.get(`${Hdf4Tag.DFTAG_VS}:${dd.ref}`);
      const records = vsBytes ? (JSON.parse(textDecoder.decode(vsBytes)) as Array<Array<number | string>>) : [];
      const vd: Hdf4Vdata = {
        name: hdr.name || `Vdata_${dd.ref}`,
        vdataClass: hdr.vdataClass,
        ref: dd.ref,
        fields: Array.isArray(hdr.fields) ? hdr.fields : [],
        records: Array.isArray(records) ? records : [],
        attributes: [],
      };
      doc.vdatas.push(vd);
      nameByTagRef.set(`${Hdf4Tag.DFTAG_VH}:${dd.ref}`, { kind: "VDATA", name: vd.name });
    } catch {
      // Ignore malformed non-JSON Vdata header
    }
  }

  // Decode Raster8 (DFTAG_ID8 / DFTAG_RI8)
  for (const dd of doc.descriptors) {
    if (dd.tag !== Hdf4Tag.DFTAG_RI8) continue;
    const riBytes = payloadByKey.get(`${dd.tag}:${dd.ref}`);
    const idBytes = payloadByKey.get(`${Hdf4Tag.DFTAG_ID8}:${dd.ref}`);
    let width = 0;
    let height = 0;
    if (idBytes && idBytes.byteLength >= 4) {
      const idView = new DataView(idBytes.buffer, idBytes.byteOffset, idBytes.byteLength);
      width = idView.getUint16(0, false);
      height = idView.getUint16(2, false);
    }
    const raster: Hdf4Raster8 = {
      name: `Raster8_${dd.ref}`,
      ref: dd.ref,
      width,
      height,
      pixels: riBytes ? decodeNumericArray(riBytes, Hdf4DataType.DFNT_UINT8) : [],
      attributes: [],
    };
    doc.rasters.push(raster);
    nameByTagRef.set(`${Hdf4Tag.DFTAG_RI8}:${dd.ref}`, { kind: "RASTER8", name: raster.name });
  }

  // Decode Palette (DFTAG_IP8)
  for (const dd of doc.descriptors) {
    if (dd.tag !== Hdf4Tag.DFTAG_IP8) continue;
    const ipBytes = payloadByKey.get(`${dd.tag}:${dd.ref}`);
    const pal: Hdf4Palette = {
      name: `Palette_${dd.ref}`,
      ref: dd.ref,
      entries: ipBytes ? decodeNumericArray(ipBytes, Hdf4DataType.DFNT_UINT8) : [],
    };
    doc.palettes.push(pal);
    nameByTagRef.set(`${Hdf4Tag.DFTAG_IP8}:${dd.ref}`, { kind: "PALETTE", name: pal.name });
  }

  // Pre-decode Vgroup names first so nested Vgroups resolve cleanly
  const rawVgroups: Array<{ ref: number; decoded: ReturnType<typeof decodeVgroupPayload> }> = [];
  for (const dd of doc.descriptors) {
    if (dd.tag !== Hdf4Tag.DFTAG_VG) continue;
    const vgBytes = payloadByKey.get(`${dd.tag}:${dd.ref}`);
    if (!vgBytes) continue;
    const decoded = decodeVgroupPayload(vgBytes);
    rawVgroups.push({ ref: dd.ref, decoded });
    nameByTagRef.set(`${Hdf4Tag.DFTAG_VG}:${dd.ref}`, { kind: "VGROUP", name: decoded.name });
  }

  for (const { ref, decoded } of rawVgroups) {
    const members: Hdf4VgroupMember[] = decoded.pairs.map(([tag, memberRef]) => {
      const resolved = nameByTagRef.get(`${tag}:${memberRef}`);
      if (resolved) {
        return { kind: resolved.kind, name: resolved.name, tag, ref: memberRef };
      }
      return { kind: "TAGREF", name: `${tag}:${memberRef}`, tag, ref: memberRef };
    });
    const vg: Hdf4Vgroup = {
      name: decoded.name,
      vgroupClass: decoded.vgroupClass,
      ref,
      members,
      attributes: [],
    };
    doc.vgroups.push(vg);
  }

  return doc;
}
