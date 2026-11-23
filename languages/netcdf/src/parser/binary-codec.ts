// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unidata NetCDF Classic v1 (`CDF\x01`) & v2 64-bit Offset (`CDF\x02`)
 * Big-Endian Binary Encoder & Decoder.
 *
 * Implements the official NetCDF Classic binary file format specification:
 * - Magic bytes: `0x43 0x44 0x46 0x01` (CDF1, 32-bit offsets) or `0x43 0x44 0x46 0x02` (CDF2, 64-bit offsets)
 * - Big-endian IEEE-754 floats/doubles and two's-complement signed integers
 * - 4-byte XDR padding for strings, attribute payloads, and variable slabs
 * - Fixed (non-record) and interleaved UNLIMITED record variable slabs
 */

import {
  NC_CODE_TO_TYPE,
  NC_DEFAULT_FILL,
  NC_TYPE_BYTE_SIZE,
  NC_TYPE_CODE,
  type NetcdfAttribute,
  type NetcdfAttributeValue,
  type NetcdfDataset,
  type NetcdfDataType,
  type NetcdfDimension,
  type NetcdfFormatVersion,
  type NetcdfVariable,
} from "../types.js";

const TAG_ABSENT = 0;
const TAG_DIMENSION = 0x0000000a;
const TAG_VARIABLE = 0x0000000b;
const TAG_ATTRIBUTE = 0x0000000c;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");

function pad4(n: number): number {
  const rem = n & 3;
  return rem === 0 ? n : n + (4 - rem);
}

/**
 * Checks whether a byte buffer begins with the NetCDF Classic magic header (`CDF\x01` or `CDF\x02`).
 */
export function isNetcdfBinary(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x43 && // 'C'
    bytes[1] === 0x44 && // 'D'
    bytes[2] === 0x46 && // 'F'
    (bytes[3] === 0x01 || bytes[3] === 0x02)
  );
}

class BigEndianWriter {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;

  constructor(initialCapacity = 4096) {
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }

  get offset(): number {
    return this.pos;
  }

  private ensure(extra: number): void {
    const needed = this.pos + extra;
    if (needed <= this.buf.length) return;
    let nextCap = this.buf.length * 2;
    while (nextCap < needed) nextCap *= 2;
    const nextBuf = new Uint8Array(nextCap);
    nextBuf.set(this.buf.subarray(0, this.pos));
    this.buf = nextBuf;
    this.view = new DataView(this.buf.buffer);
  }

  writeUint32(val: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, val >>> 0, false);
    this.pos += 4;
  }

  writeUint32At(offset: number, val: number): void {
    this.view.setUint32(offset, val >>> 0, false);
  }

  writeUint64(val: number): void {
    this.ensure(8);
    this.view.setBigUint64(this.pos, BigInt(val), false);
    this.pos += 8;
  }

  writeUint64At(offset: number, val: number): void {
    this.view.setBigUint64(offset, BigInt(val), false);
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.pos);
    this.pos += bytes.length;
  }

  writeZeroPad(count: number): void {
    if (count <= 0) return;
    this.ensure(count);
    this.buf.fill(0, this.pos, this.pos + count);
    this.pos += count;
  }

  writeNcString(str: string): void {
    const encoded = textEncoder.encode(str);
    this.writeUint32(encoded.length);
    this.writeBytes(encoded);
    const pad = pad4(encoded.length) - encoded.length;
    this.writeZeroPad(pad);
  }

  writeTypedValues(type: NetcdfDataType, values: (number | string)[]): void {
    if (type === "char") {
      const joined =
        values.length === 1 && typeof values[0] === "string"
          ? values[0]
          : values.map((v) => (typeof v === "string" ? v : String.fromCharCode(Number(v)))).join("");
      const encoded = textEncoder.encode(joined);
      this.writeBytes(encoded);
      this.writeZeroPad(pad4(encoded.length) - encoded.length);
      return;
    }

    const elemSize = NC_TYPE_BYTE_SIZE[type];
    const rawBytes = values.length * elemSize;
    this.ensure(pad4(rawBytes));

    for (let i = 0; i < values.length; i++) {
      const rawVal = values[i];
      const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
      switch (type) {
        case "byte":
          this.view.setInt8(this.pos, num);
          this.pos += 1;
          break;
        case "short":
          this.view.setInt16(this.pos, num, false);
          this.pos += 2;
          break;
        case "int":
        case "long":
          this.view.setInt32(this.pos, num | 0, false);
          this.pos += 4;
          break;
        case "float":
          this.view.setFloat32(this.pos, num, false);
          this.pos += 4;
          break;
        case "double":
          this.view.setFloat64(this.pos, num, false);
          this.pos += 8;
          break;
      }
    }
    const pad = pad4(rawBytes) - rawBytes;
    this.writeZeroPad(pad);
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

class BigEndianReader {
  private readonly view: DataView;
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get offset(): number {
    return this.pos;
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.bytes.byteLength) {
      throw new Error(`Seek offset ${offset} out of bounds (length ${this.bytes.byteLength})`);
    }
    this.pos = offset;
  }

  private check(n: number): void {
    if (this.pos + n > this.bytes.byteLength) {
      throw new Error(`Unexpected EOF at offset ${this.pos} (needed ${n} bytes, length ${this.bytes.byteLength})`);
    }
  }

  readUint32(): number {
    this.check(4);
    const v = this.view.getUint32(this.pos, false);
    this.pos += 4;
    return v;
  }

  readUint64(): number {
    this.check(8);
    const v = this.view.getBigUint64(this.pos, false);
    this.pos += 8;
    return Number(v);
  }

  readNcString(): string {
    const len = this.readUint32();
    const padded = pad4(len);
    this.check(padded);
    const str = textDecoder.decode(this.bytes.subarray(this.pos, this.pos + len));
    this.pos += padded;
    return str;
  }

  readTypedValues(type: NetcdfDataType, count: number): (number | string)[] {
    if (type === "char") {
      const padded = pad4(count);
      this.check(padded);
      const raw = textDecoder.decode(this.bytes.subarray(this.pos, this.pos + count));
      this.pos += padded;
      return [raw.replace(/\0+$/, "")];
    }

    const elemSize = NC_TYPE_BYTE_SIZE[type];
    const rawBytes = count * elemSize;
    const padded = pad4(rawBytes);
    this.check(padded);

    const out: number[] = new Array(count);
    for (let i = 0; i < count; i++) {
      switch (type) {
        case "byte":
          out[i] = this.view.getInt8(this.pos);
          this.pos += 1;
          break;
        case "short":
          out[i] = this.view.getInt16(this.pos, false);
          this.pos += 2;
          break;
        case "int":
        case "long":
          out[i] = this.view.getInt32(this.pos, false);
          this.pos += 4;
          break;
        case "float":
          out[i] = this.view.getFloat32(this.pos, false);
          this.pos += 4;
          break;
        case "double":
          out[i] = this.view.getFloat64(this.pos, false);
          this.pos += 8;
          break;
      }
    }
    this.pos += padded - rawBytes;
    return out;
  }
}

function writeAttributeList(writer: BigEndianWriter, attrs: NetcdfAttribute[]): void {
  if (attrs.length === 0) {
    writer.writeUint32(TAG_ABSENT);
    writer.writeUint32(0);
    return;
  }
  writer.writeUint32(TAG_ATTRIBUTE);
  writer.writeUint32(attrs.length);
  for (const attr of attrs) {
    writer.writeNcString(attr.name);
    writer.writeUint32(NC_TYPE_CODE[attr.type]);
    if (attr.type === "char" || typeof attr.value === "string") {
      const str = typeof attr.value === "string" ? attr.value : String(attr.value);
      const encoded = textEncoder.encode(str);
      writer.writeUint32(encoded.length);
      writer.writeBytes(encoded);
      writer.writeZeroPad(pad4(encoded.length) - encoded.length);
    } else if (Array.isArray(attr.value)) {
      writer.writeUint32(attr.value.length);
      writer.writeTypedValues(attr.type, attr.value);
    } else {
      writer.writeUint32(1);
      writer.writeTypedValues(attr.type, [attr.value]);
    }
  }
}

function readAttributeList(reader: BigEndianReader): NetcdfAttribute[] {
  const tag = reader.readUint32();
  const count = reader.readUint32();
  if (tag === TAG_ABSENT || count === 0) return [];
  if (tag !== TAG_ATTRIBUTE) {
    throw new Error(`Expected NC_ATTRIBUTE tag (0x0C), got 0x${tag.toString(16)}`);
  }
  const attrs: NetcdfAttribute[] = [];
  for (let i = 0; i < count; i++) {
    const name = reader.readNcString();
    const typeCode = reader.readUint32();
    const type = NC_CODE_TO_TYPE[typeCode];
    if (!type) {
      throw new Error(`Unknown NetCDF attribute type code ${typeCode} for '${name}'`);
    }
    const nelems = reader.readUint32();
    const vals = reader.readTypedValues(type, nelems);
    let value: NetcdfAttributeValue;
    if (type === "char") {
      value = String(vals[0] ?? "");
    } else if (vals.length === 1) {
      value = Number(vals[0]);
    } else {
      value = vals.map((v) => Number(v));
    }
    attrs.push({ name, type, value });
  }
  return attrs;
}

/**
 * Encodes a `NetcdfDataset` into Unidata NetCDF Classic v1 (`CDF\x01`) or v2 (`CDF\x02`) big-endian binary bytes.
 */
export function encodeNetcdfBinary(
  dataset: NetcdfDataset,
  format: NetcdfFormatVersion = dataset.format ?? "classic",
): Uint8Array {
  const writer = new BigEndianWriter();
  const isCdf2 = format === "64bit-offset";

  // 1. Magic header: "CDF\x01" or "CDF\x02"
  writer.writeBytes(new Uint8Array([0x43, 0x44, 0x46, isCdf2 ? 0x02 : 0x01]));

  // Determine numrecs from unlimited dimension
  const dimIndexByName = new Map<string, number>();
  let unlimitedDimIdx = -1;
  let numrecs = 0;
  dataset.dimensions.forEach((d, idx) => {
    dimIndexByName.set(d.name, idx);
    if (d.isUnlimited && unlimitedDimIdx === -1) {
      unlimitedDimIdx = idx;
      numrecs = Math.max(0, d.size);
    }
  });
  writer.writeUint32(numrecs);

  // 2. dim_list
  if (dataset.dimensions.length === 0) {
    writer.writeUint32(TAG_ABSENT);
    writer.writeUint32(0);
  } else {
    writer.writeUint32(TAG_DIMENSION);
    writer.writeUint32(dataset.dimensions.length);
    for (const d of dataset.dimensions) {
      writer.writeNcString(d.name);
      writer.writeUint32(d.isUnlimited ? 0 : d.size);
    }
  }

  // 3. gatt_list
  writeAttributeList(writer, dataset.globalAttributes);

  // 4. var_list (record placeholder positions for `begin` offsets)
  interface VarEncodePlan {
    variable: NetcdfVariable;
    isRecord: boolean;
    slabElements: number;
    vsize: number;
    beginFieldOffset: number;
  }
  const plans: VarEncodePlan[] = [];

  if (dataset.variables.length === 0) {
    writer.writeUint32(TAG_ABSENT);
    writer.writeUint32(0);
  } else {
    writer.writeUint32(TAG_VARIABLE);
    writer.writeUint32(dataset.variables.length);

    for (const v of dataset.variables) {
      writer.writeNcString(v.name);
      writer.writeUint32(v.dimensions.length);

      let isRecord = false;
      let slabElements = 1;
      for (let k = 0; k < v.dimensions.length; k++) {
        const dName = v.dimensions[k]!;
        const dIdx = dimIndexByName.get(dName);
        if (dIdx === undefined) {
          throw new Error(`Variable '${v.name}' references undefined dimension '${dName}'`);
        }
        writer.writeUint32(dIdx);
        const dim = dataset.dimensions[dIdx]!;
        if (k === 0 && dim.isUnlimited) {
          isRecord = true;
        } else {
          slabElements *= Math.max(1, dim.size);
        }
      }

      writeAttributeList(writer, v.attributes);
      writer.writeUint32(NC_TYPE_CODE[v.type]);

      const elemSize = NC_TYPE_BYTE_SIZE[v.type];
      const vsize = pad4(slabElements * elemSize);
      writer.writeUint32(vsize);

      const beginFieldOffset = writer.offset;
      if (isCdf2) {
        writer.writeUint64(0);
      } else {
        writer.writeUint32(0);
      }

      plans.push({ variable: v, isRecord, slabElements, vsize, beginFieldOffset });
    }
  }

  // 5. Write fixed (non-record) variable slabs
  const fixedPlans = plans.filter((p) => !p.isRecord);
  for (const plan of fixedPlans) {
    const startOffset = writer.offset;
    if (isCdf2) {
      writer.writeUint64At(plan.beginFieldOffset, startOffset);
    } else {
      writer.writeUint32At(plan.beginFieldOffset, startOffset);
    }

    const fillVal = NC_DEFAULT_FILL[plan.variable.type];
    const rawData = plan.variable.data ?? [];
    if (plan.variable.type === "char") {
      const str = typeof rawData[0] === "string" ? rawData[0] : rawData.map(String).join("");
      const encoded = textEncoder.encode(str);
      const slab = new Uint8Array(plan.vsize);
      slab.set(encoded.subarray(0, Math.min(encoded.length, plan.slabElements)));
      writer.writeBytes(slab);
    } else {
      const vals: number[] = new Array(plan.slabElements);
      for (let i = 0; i < plan.slabElements; i++) {
        const val = rawData[i];
        vals[i] = val !== undefined ? Number(val) : fillVal;
      }
      writer.writeTypedValues(plan.variable.type, vals);
    }
  }

  // 6. Write interleaved record variable slabs
  const recordPlans = plans.filter((p) => p.isRecord);
  if (recordPlans.length > 0) {
    // Record begin offsets point to record 0 slabs
    let runningOffset = writer.offset;
    for (const plan of recordPlans) {
      if (isCdf2) {
        writer.writeUint64At(plan.beginFieldOffset, runningOffset);
      } else {
        writer.writeUint32At(plan.beginFieldOffset, runningOffset);
      }
      runningOffset += plan.vsize;
    }

    for (let r = 0; r < numrecs; r++) {
      for (const plan of recordPlans) {
        const fillVal = NC_DEFAULT_FILL[plan.variable.type];
        const rawData = plan.variable.data ?? [];
        const base = r * plan.slabElements;
        if (plan.variable.type === "char") {
          const str = typeof rawData[r] === "string" ? String(rawData[r]) : "";
          const encoded = textEncoder.encode(str);
          const slab = new Uint8Array(plan.vsize);
          slab.set(encoded.subarray(0, Math.min(encoded.length, plan.slabElements)));
          writer.writeBytes(slab);
        } else {
          const vals: number[] = new Array(plan.slabElements);
          for (let i = 0; i < plan.slabElements; i++) {
            const val = rawData[base + i];
            vals[i] = val !== undefined ? Number(val) : fillVal;
          }
          writer.writeTypedValues(plan.variable.type, vals);
        }
      }
    }
  }

  return writer.toUint8Array();
}

/**
 * Decodes a Unidata NetCDF Classic v1 (`CDF\x01`) or v2 (`CDF\x02`) binary stream into a `NetcdfDataset`.
 */
export function decodeNetcdfBinary(bytes: Uint8Array, datasetName = "binary_dataset"): NetcdfDataset {
  if (bytes.length < 4) {
    return {
      name: datasetName,
      format: "classic",
      sourceFormat: "binary",
      dimensions: [],
      variables: [],
      globalAttributes: [],
      parseErrors: [
        {
          code: "NC1003",
          message: `Binary NetCDF buffer too short (${bytes.length} bytes)`,
          line: 1,
          column: 1,
        },
      ],
    };
  }

  if (!isNetcdfBinary(bytes)) {
    const found = Array.from(bytes.subarray(0, 4))
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, "0")}`))
      .join("");
    return {
      name: datasetName,
      format: "classic",
      sourceFormat: "binary",
      dimensions: [],
      variables: [],
      globalAttributes: [],
      parseErrors: [
        {
          code: "NC1002",
          message: `Invalid NetCDF binary magic header '${found}'; expected 'CDF\\x01' or 'CDF\\x02'`,
          line: 1,
          column: 1,
        },
      ],
    };
  }

  const versionByte = bytes[3]!;
  const format: NetcdfFormatVersion = versionByte === 0x02 ? "64bit-offset" : "classic";
  const isCdf2 = format === "64bit-offset";
  const reader = new BigEndianReader(bytes);
  reader.seek(4);

  try {
    const numrecs = reader.readUint32();

    // 1. Dimensions
    const dimensions: NetcdfDimension[] = [];
    const dimTag = reader.readUint32();
    const dimCount = reader.readUint32();
    if (dimTag !== TAG_ABSENT && dimCount > 0) {
      if (dimTag !== TAG_DIMENSION) {
        throw new Error(`Expected NC_DIMENSION tag (0x0A), got 0x${dimTag.toString(16)}`);
      }
      for (let i = 0; i < dimCount; i++) {
        const name = reader.readNcString();
        const len = reader.readUint32();
        const isUnlimited = len === 0;
        dimensions.push({
          name,
          size: isUnlimited ? numrecs : len,
          isUnlimited,
        });
      }
    }

    // 2. Global attributes
    const globalAttributes = readAttributeList(reader);

    // 3. Variables
    const variables: NetcdfVariable[] = [];
    const varTag = reader.readUint32();
    const varCount = reader.readUint32();

    interface VarReadMeta {
      variable: NetcdfVariable;
      isRecord: boolean;
      slabElements: number;
      vsize: number;
      begin: number;
    }
    const varMetas: VarReadMeta[] = [];

    if (varTag !== TAG_ABSENT && varCount > 0) {
      if (varTag !== TAG_VARIABLE) {
        throw new Error(`Expected NC_VARIABLE tag (0x0B), got 0x${varTag.toString(16)}`);
      }
      for (let i = 0; i < varCount; i++) {
        const name = reader.readNcString();
        const ndims = reader.readUint32();
        const varDims: string[] = [];
        let isRecord = false;
        let slabElements = 1;
        for (let k = 0; k < ndims; k++) {
          const dimId = reader.readUint32();
          const dim = dimensions[dimId];
          if (!dim) {
            throw new Error(`Variable '${name}' references out-of-range dimid ${dimId}`);
          }
          varDims.push(dim.name);
          if (k === 0 && dim.isUnlimited) {
            isRecord = true;
          } else {
            slabElements *= Math.max(1, dim.size);
          }
        }
        const attributes = readAttributeList(reader);
        const typeCode = reader.readUint32();
        const type = NC_CODE_TO_TYPE[typeCode];
        if (!type) {
          throw new Error(`Unknown NetCDF variable type code ${typeCode} for '${name}'`);
        }
        const vsize = reader.readUint32();
        const begin = isCdf2 ? reader.readUint64() : reader.readUint32();

        const variable: NetcdfVariable = {
          name,
          type,
          dimensions: varDims,
          attributes,
          isRecord,
          vsize,
          offset: begin,
          data: [],
        };
        variables.push(variable);
        varMetas.push({ variable, isRecord, slabElements, vsize, begin });
      }
    }

    // 4. Read fixed variable data slabs
    for (const meta of varMetas) {
      if (meta.isRecord) continue;
      reader.seek(meta.begin);
      meta.variable.data = reader.readTypedValues(meta.variable.type, meta.slabElements);
    }

    // 5. Read interleaved record variable slabs
    const recordMetas = varMetas.filter((m) => m.isRecord);
    if (recordMetas.length > 0 && numrecs > 0) {
      const recStride = recordMetas.reduce((acc, m) => acc + m.vsize, 0);
      for (const meta of recordMetas) {
        const allValues: (number | string)[] = [];
        for (let r = 0; r < numrecs; r++) {
          reader.seek(meta.begin + r * recStride);
          const slabVals = reader.readTypedValues(meta.variable.type, meta.slabElements);
          for (const v of slabVals) {
            allValues.push(v);
          }
        }
        meta.variable.data = allValues;
      }
    }

    return {
      name: datasetName,
      format,
      sourceFormat: "binary",
      dimensions,
      variables,
      globalAttributes,
      parseErrors: [],
    };
  } catch (err) {
    return {
      name: datasetName,
      format,
      sourceFormat: "binary",
      dimensions: [],
      variables: [],
      globalAttributes: [],
      parseErrors: [
        {
          code: "NC1003",
          message: err instanceof Error ? err.message : String(err),
          line: 1,
          column: 1,
        },
      ],
    };
  }
}
