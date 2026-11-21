// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bidirectional Binary-to-SoA Codec Emitter & Runtime Engine.
 *
 * Compiles a declarative `BinaryCodecDefinition` into:
 *  1. `emitAssemblyScriptCodec`: Deterministic linear-memory AssemblyScript/WASM codec
 *     with tightly packed SoA column buffers, `decode`, `encode`, resumable streaming
 *     (`streamInit` / `streamFeed` / `streamFlush`), and O(1) stride/offset exports.
 *  2. `emitTypeScriptCodecBindings`: Strongly typed zero-copy `TypedArray` SoA views
 *     over `wasmMemory.buffer` + streaming & random-access slice helpers.
 *  3. `createRuntimeBinaryCodec`: Direct JS/TS runtime codec supporting `decode`, `encode`,
 *     chunked `decodeStream`, and O(1) `readSlice` seeking.
 */

import {
  staticByteSize,
  type BinaryCodecDefinition,
  type BinaryCodecNode,
  type BinaryExpr,
  type BinaryFieldDef,
  type BinaryPredicate,
  type BinaryScalarKind,
  type BinarySoaTableCodec,
  type Endianness,
} from "../../dsl/codec-types.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");

export interface RandomAccessReader {
  readonly byteLength: number;
  read(offset: number, length: number): Uint8Array | Promise<Uint8Array>;
}

export interface StreamDecodeResult<THeader = Record<string, unknown>> {
  header: THeader;
  framesEmitted: number;
}

export interface RuntimeBinaryCodec<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly definition: BinaryCodecDefinition;
  decode(bytes: Uint8Array): T;
  encode(value: T): Uint8Array;
  decodeStream<TFrame = Record<string, unknown>>(
    chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
    onFrame: (frame: TFrame, index: number) => void | Promise<void>,
  ): Promise<StreamDecodeResult>;
  readSlice<TFrame = Record<string, unknown>>(
    reader: RandomAccessReader,
    startIndex: number,
    count: number,
  ): Promise<{ header: Record<string, unknown>; frames: TFrame[] }>;
}

// ---------------------------------------------------------------------------
// Scalar helpers
// ---------------------------------------------------------------------------

function scalarByteSize(kind: BinaryScalarKind): number {
  switch (kind) {
    case "u8":
    case "i8":
      return 1;
    case "u16":
    case "i16":
      return 2;
    case "u32":
    case "i32":
    case "f32":
      return 4;
    case "u64":
    case "i64":
    case "f64":
      return 8;
  }
}

function asTypeForScalar(kind: BinaryScalarKind): string {
  return kind;
}

function typedArrayCtorForScalar(kind: BinaryScalarKind): string {
  switch (kind) {
    case "u8":
      return "Uint8Array";
    case "i8":
      return "Int8Array";
    case "u16":
      return "Uint16Array";
    case "i16":
      return "Int16Array";
    case "u32":
      return "Uint32Array";
    case "i32":
      return "Int32Array";
    case "u64":
      return "BigUint64Array";
    case "i64":
      return "BigInt64Array";
    case "f32":
      return "Float32Array";
    case "f64":
      return "Float64Array";
  }
}

function createTypedArrayForScalar(
  kind: BinaryScalarKind,
  length: number,
): ArrayLike<number | bigint> & Record<number, number | bigint> {
  switch (kind) {
    case "u8":
      return new Uint8Array(length);
    case "i8":
      return new Int8Array(length);
    case "u16":
      return new Uint16Array(length);
    case "i16":
      return new Int16Array(length);
    case "u32":
      return new Uint32Array(length);
    case "i32":
      return new Int32Array(length);
    case "u64":
      return new BigUint64Array(length) as unknown as ArrayLike<number | bigint> & Record<number, number | bigint>;
    case "i64":
      return new BigInt64Array(length) as unknown as ArrayLike<number | bigint> & Record<number, number | bigint>;
    case "f32":
      return new Float32Array(length);
    case "f64":
      return new Float64Array(length);
  }
}

function resolveScopePath(scope: Record<string, unknown>, path: string): unknown {
  if (!path.includes(".")) return scope[path];
  let cur: unknown = scope;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function evalExpr(expr: BinaryExpr, scope: Record<string, unknown>): unknown {
  if (typeof expr === "number") return expr;
  if (typeof expr === "string") return resolveScopePath(scope, expr);
  const l = Number(evalExpr(expr.left, scope) ?? 0);
  const r = Number(evalExpr(expr.right, scope) ?? 0);
  switch (expr.op) {
    case "+":
      return l + r;
    case "-":
      return l - r;
    case "*":
      return l * r;
    case "/":
      return r === 0 ? 0 : Math.trunc(l / r);
    case "%":
      return r === 0 ? 0 : l % r;
    case "&":
      return (l | 0) & (r | 0);
    case "|":
      return l | 0 | (r | 0);
    case "<<":
      return (l | 0) << (r | 0);
    case ">>":
      return (l | 0) >> (r | 0);
  }
}

function evalIntExpr(expr: BinaryExpr, scope: Record<string, unknown>): number {
  return Number(evalExpr(expr, scope) ?? 0);
}

function evalPredicate(pred: BinaryPredicate, scope: Record<string, unknown>): boolean {
  const actual = evalExpr(pred.field, scope);
  const expected = pred.value;
  if (typeof actual === "bigint" && typeof expected === "number" && Number.isInteger(expected)) {
    const expBig = BigInt(expected);
    switch (pred.op) {
      case "==":
        return actual === expBig;
      case "!=":
        return actual !== expBig;
      case "<":
        return actual < expBig;
      case "<=":
        return actual <= expBig;
      case ">":
        return actual > expBig;
      case ">=":
        return actual >= expBig;
    }
  }
  switch (pred.op) {
    case "==":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case "<":
      return Number(actual) < Number(expected);
    case "<=":
      return Number(actual) <= Number(expected);
    case ">":
      return Number(actual) > Number(expected);
    case ">=":
      return Number(actual) >= Number(expected);
  }
}

// ---------------------------------------------------------------------------
// Runtime Reader / Writer
// ---------------------------------------------------------------------------

class ByteCursor {
  readonly view: DataView;
  offset = 0;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  readScalar(kind: BinaryScalarKind, endian: Endianness): number | bigint {
    const le = endian === "le";
    const o = this.offset;
    const size = scalarByteSize(kind);
    if (o + size > this.bytes.byteLength) {
      throw new RangeError(`Unexpected EOF reading ${kind} at offset ${o}`);
    }
    this.offset += size;
    switch (kind) {
      case "u8":
        return this.view.getUint8(o);
      case "i8":
        return this.view.getInt8(o);
      case "u16":
        return this.view.getUint16(o, le);
      case "i16":
        return this.view.getInt16(o, le);
      case "u32":
        return this.view.getUint32(o, le);
      case "i32":
        return this.view.getInt32(o, le);
      case "u64":
        return this.view.getBigUint64(o, le);
      case "i64":
        return this.view.getBigInt64(o, le);
      case "f32":
        return this.view.getFloat32(o, le);
      case "f64":
        return this.view.getFloat64(o, le);
    }
  }

  readBytes(len: number): Uint8Array {
    if (len < 0 || this.offset + len > this.bytes.byteLength) {
      throw new RangeError(`Unexpected EOF reading ${len} bytes at offset ${this.offset}`);
    }
    const slice = this.bytes.slice(this.offset, this.offset + len);
    this.offset += len;
    return slice;
  }

  skip(len: number): void {
    if (len < 0 || this.offset + len > this.bytes.byteLength) {
      throw new RangeError(`Unexpected EOF skipping ${len} bytes at offset ${this.offset}`);
    }
    this.offset += len;
  }
}

class ByteBuilder {
  private buf: Uint8Array;
  private view: DataView;
  length = 0;

  constructor(initialCapacity = 4096) {
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(extra: number): void {
    if (this.length + extra <= this.buf.byteLength) return;
    let nextCap = this.buf.byteLength * 2;
    while (nextCap < this.length + extra) nextCap *= 2;
    const next = new Uint8Array(nextCap);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  writeScalar(kind: BinaryScalarKind, val: number | bigint, endian: Endianness): void {
    const size = scalarByteSize(kind);
    this.ensure(size);
    const le = endian === "le";
    const o = this.length;
    switch (kind) {
      case "u8":
        this.view.setUint8(o, Number(val));
        break;
      case "i8":
        this.view.setInt8(o, Number(val));
        break;
      case "u16":
        this.view.setUint16(o, Number(val), le);
        break;
      case "i16":
        this.view.setInt16(o, Number(val), le);
        break;
      case "u32":
        this.view.setUint32(o, Number(val), le);
        break;
      case "i32":
        this.view.setInt32(o, Number(val), le);
        break;
      case "u64":
        this.view.setBigUint64(o, typeof val === "bigint" ? val : BigInt(Math.trunc(val)), le);
        break;
      case "i64":
        this.view.setBigInt64(o, typeof val === "bigint" ? val : BigInt(Math.trunc(val)), le);
        break;
      case "f32":
        this.view.setFloat32(o, Number(val), le);
        break;
      case "f64":
        this.view.setFloat64(o, Number(val), le);
        break;
    }
    this.length += size;
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensure(bytes.byteLength);
    this.buf.set(bytes, this.length);
    this.length += bytes.byteLength;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

function decodeNode(
  node: BinaryCodecNode,
  cur: ByteCursor,
  endian: Endianness,
  scope: Record<string, unknown>,
): unknown {
  switch (node.kind) {
    case "scalar":
      return cur.readScalar(node.scalar, node.endian ?? endian);

    case "fixedStr": {
      const raw = cur.readBytes(node.byteLength);
      const str = textDecoder.decode(raw);
      if (!node.trim) return str;
      let end = str.length;
      const pad = node.padChar;
      while (end > 0) {
        const ch = str[end - 1]!;
        if (ch === "\0" || ch === pad || (pad === " " && /\s/.test(ch))) {
          end--;
        } else {
          break;
        }
      }
      return str.slice(0, end);
    }

    case "lenPrefixedStr": {
      const len = Number(cur.readScalar(node.lengthCodec, node.endian ?? endian));
      const raw = cur.readBytes(len);
      return textDecoder.decode(raw);
    }

    case "bytes": {
      const len = evalIntExpr(node.length, scope);
      return cur.readBytes(len);
    }

    case "magic": {
      const raw = cur.readBytes(node.expected.byteLength);
      for (let i = 0; i < node.expected.byteLength; i++) {
        if (raw[i] !== node.expected[i]) {
          throw new Error(
            `Binary magic mismatch at offset ${cur.offset - node.expected.byteLength}: expected ${node.ascii ?? [...node.expected].join(",")}`,
          );
        }
      }
      return node.ascii ?? raw;
    }

    case "align": {
      if (!Number.isInteger(node.alignment) || node.alignment <= 0) {
        throw new RangeError(`Invalid binary alignment: ${node.alignment} (must be a positive integer)`);
      }
      const rem = cur.offset % node.alignment;
      if (rem !== 0) {
        cur.skip(node.alignment - rem);
      }
      return undefined;
    }

    case "endian":
      return decodeNode(node.inner, cur, node.endian, scope);

    case "fortranRecord": {
      const markerKind: BinaryScalarKind = node.markerBytes === 8 ? "u64" : "u32";
      const recLen = Number(cur.readScalar(markerKind, endian));
      const payloadBytes = cur.readBytes(recLen);
      const trailLen = Number(cur.readScalar(markerKind, endian));
      if (trailLen !== recLen) {
        throw new Error(`Fortran record length mismatch: leading=${recLen}, trailing=${trailLen}`);
      }
      const subCur = new ByteCursor(payloadBytes);
      return decodeNode(node.inner, subCur, endian, scope);
    }

    case "bitfield": {
      const raw = cur.readBytes(node.totalBytes);
      const bfEndian = node.endian ?? endian;
      const out: Record<string, number> = {};
      if (bfEndian === "be") {
        let bitPos = 0;
        for (const f of node.fields) {
          let val = 0;
          for (let i = 0; i < f.bits; i++) {
            const byteIdx = bitPos >>> 3;
            const bitIdx = 7 - (bitPos & 7);
            val = val * 2 + ((raw[byteIdx]! >>> bitIdx) & 1);
            bitPos++;
          }
          out[f.name] = val;
        }
      } else {
        let bitPos = 0;
        for (const f of node.fields) {
          let val = 0;
          for (let i = 0; i < f.bits; i++) {
            const byteIdx = bitPos >>> 3;
            const bitIdx = bitPos & 7;
            if ((raw[byteIdx]! >>> bitIdx) & 1) {
              val += 2 ** i;
            }
            bitPos++;
          }
          out[f.name] = val;
        }
      }
      return out;
    }

    case "cstr": {
      const start = cur.offset;
      let nul = start;
      while (nul < cur.bytes.byteLength && cur.bytes[nul] !== 0) nul++;
      if (nul >= cur.bytes.byteLength) {
        throw new RangeError(`Unexpected EOF scanning for NUL-terminated cstr at offset ${start}`);
      }
      const slice = cur.bytes.subarray(start, nul);
      cur.offset = nul + 1;
      if (node.encoding === "utf-8") return textDecoder.decode(slice);
      let s = "";
      for (let i = 0; i < slice.byteLength; i++) s += String.fromCharCode(slice[i]!);
      return s;
    }

    case "varint": {
      let result = 0;
      let shift = 0;
      let byte = 0;
      while (true) {
        if (cur.offset >= cur.bytes.byteLength) {
          throw new RangeError(`Unexpected EOF reading varint (${node.encoding}) at offset ${cur.offset}`);
        }
        byte = cur.bytes[cur.offset++]!;
        result |= (byte & 0x7f) << shift;
        shift += 7;
        if ((byte & 0x80) === 0) break;
        if (shift > 35) throw new RangeError(`Varint (${node.encoding}) exceeds 32-bit range`);
      }
      if (node.encoding === "uleb128") return result >>> 0;
      if (node.encoding === "sleb128") {
        if (shift < 32 && (byte & 0x40) !== 0) {
          result |= ~0 << shift;
        }
        return result | 0;
      }
      // zigzag
      const u = result >>> 0;
      return (u >>> 1) ^ -(u & 1);
    }

    case "sized": {
      const len = evalIntExpr(node.length, scope);
      const payload = cur.readBytes(len);
      const subCur = new ByteCursor(payload);
      return decodeNode(node.inner, subCur, endian, scope);
    }

    case "tlv": {
      const tlvEndian = node.endian ?? endian;
      const tag =
        typeof node.tagCodec === "string"
          ? cur.readScalar(node.tagCodec, tlvEndian)
          : decodeNode(node.tagCodec, cur, tlvEndian, scope);
      const len = Number(cur.readScalar(node.lengthCodec, tlvEndian));
      const payload = cur.readBytes(len);
      const key = String(tag);
      const branch = node.cases[key] ?? node.defaultCase;
      const value = branch ? decodeNode(branch, new ByteCursor(payload), tlvEndian, scope) : payload;
      return { tag, value };
    }

    case "struct": {
      const obj: Record<string, unknown> = {};
      const childScope: Record<string, unknown> = { ...scope };
      for (const f of node.fields) {
        const val = decodeNode(f.codec, cur, endian, childScope);
        obj[f.name] = val;
        childScope[f.name] = val;
      }
      return obj;
    }

    case "soaTable": {
      const count =
        node.countField !== undefined ? evalIntExpr(node.countField, scope) : Number(cur.readScalar("u32", endian));
      const cols: Record<string, unknown> = { count };
      for (const f of node.fields) {
        if (f.codec.kind === "scalar") {
          cols[f.name] = createTypedArrayForScalar(f.codec.scalar, count);
        } else {
          cols[f.name] = new Array(count);
        }
      }
      for (let row = 0; row < count; row++) {
        const rowScope: Record<string, unknown> = { ...scope };
        for (const f of node.fields) {
          const v = decodeNode(f.codec, cur, endian, rowScope);
          (cols[f.name] as Record<number, unknown>)[row] = v;
          rowScope[f.name] = v;
        }
      }
      return cols;
    }

    case "repeat": {
      const count = evalIntExpr(node.count, scope);
      const arr: unknown[] = new Array(count);
      for (let i = 0; i < count; i++) {
        arr[i] = decodeNode(node.item, cur, endian, scope);
      }
      return arr;
    }

    case "repeatUntilEof": {
      const arr: unknown[] = [];
      while (cur.remaining > 0) {
        arr.push(decodeNode(node.item, cur, endian, scope));
      }
      return arr;
    }

    case "when": {
      if (evalPredicate(node.predicate, scope)) {
        return decodeNode(node.inner, cur, endian, scope);
      }
      return undefined;
    }

    case "switchOn": {
      const key = String(resolveScopePath(scope, node.field) ?? "");
      const branch = node.cases[key] ?? node.defaultCase;
      return branch ? decodeNode(branch, cur, endian, scope) : undefined;
    }
  }
}

function encodeNode(
  node: BinaryCodecNode,
  val: unknown,
  out: ByteBuilder,
  endian: Endianness,
  scope: Record<string, unknown>,
): void {
  switch (node.kind) {
    case "scalar":
      out.writeScalar(node.scalar, (val as number | bigint) ?? 0, node.endian ?? endian);
      return;

    case "fixedStr": {
      const encoded = textEncoder.encode(String(val ?? ""));
      const padByte = node.padChar.charCodeAt(0) & 0xff;
      const fixed = new Uint8Array(node.byteLength);
      fixed.fill(padByte);
      fixed.set(encoded.subarray(0, Math.min(encoded.byteLength, node.byteLength)));
      out.writeBytes(fixed);
      return;
    }

    case "lenPrefixedStr": {
      const encoded = textEncoder.encode(String(val ?? ""));
      out.writeScalar(node.lengthCodec, encoded.byteLength, node.endian ?? endian);
      out.writeBytes(encoded);
      return;
    }

    case "bytes": {
      const b = val instanceof Uint8Array ? val : new Uint8Array(0);
      out.writeBytes(b);
      return;
    }

    case "magic":
      out.writeBytes(node.expected);
      return;

    case "align": {
      if (!Number.isInteger(node.alignment) || node.alignment <= 0) {
        throw new RangeError(`Invalid binary alignment: ${node.alignment} (must be a positive integer)`);
      }
      const rem = out.length % node.alignment;
      if (rem !== 0) {
        out.writeBytes(new Uint8Array(node.alignment - rem));
      }
      return;
    }

    case "endian":
      encodeNode(node.inner, val, out, node.endian, scope);
      return;

    case "fortranRecord": {
      const markerKind: BinaryScalarKind = node.markerBytes === 8 ? "u64" : "u32";
      const subOut = new ByteBuilder(256);
      encodeNode(node.inner, val, subOut, endian, scope);
      const payload = subOut.finish();
      out.writeScalar(markerKind, payload.byteLength, endian);
      out.writeBytes(payload);
      out.writeScalar(markerKind, payload.byteLength, endian);
      return;
    }

    case "bitfield": {
      const obj = (val ?? {}) as Record<string, number>;
      const raw = new Uint8Array(node.totalBytes);
      const bfEndian = node.endian ?? endian;
      if (bfEndian === "be") {
        let bitPos = 0;
        for (const f of node.fields) {
          const fv = Math.trunc(Number(obj[f.name] ?? 0));
          for (let i = f.bits - 1; i >= 0; i--) {
            const byteIdx = bitPos >>> 3;
            const bitIdx = 7 - (bitPos & 7);
            if ((fv >>> i) & 1) {
              raw[byteIdx] = raw[byteIdx]! | (1 << bitIdx);
            }
            bitPos++;
          }
        }
      } else {
        let bitPos = 0;
        for (const f of node.fields) {
          const fv = Math.trunc(Number(obj[f.name] ?? 0));
          for (let i = 0; i < f.bits; i++) {
            const byteIdx = bitPos >>> 3;
            const bitIdx = bitPos & 7;
            if ((fv >>> i) & 1) {
              raw[byteIdx] = raw[byteIdx]! | (1 << bitIdx);
            }
            bitPos++;
          }
        }
      }
      out.writeBytes(raw);
      return;
    }

    case "cstr": {
      const s = String(val ?? "");
      if (node.encoding === "utf-8") {
        out.writeBytes(textEncoder.encode(s));
      } else {
        const buf = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i) & 0xff;
        out.writeBytes(buf);
      }
      out.writeScalar("u8", 0, endian);
      return;
    }

    case "varint": {
      const n = Math.trunc(Number(val ?? 0));
      if (node.encoding === "uleb128") {
        let u = n >>> 0;
        do {
          let b = u & 0x7f;
          u >>>= 7;
          if (u !== 0) b |= 0x80;
          out.writeScalar("u8", b, endian);
        } while (u !== 0);
      } else if (node.encoding === "sleb128") {
        let v = n | 0;
        let more = true;
        while (more) {
          let b = v & 0x7f;
          v >>= 7;
          if ((v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0)) {
            more = false;
          } else {
            b |= 0x80;
          }
          out.writeScalar("u8", b, endian);
        }
      } else {
        // zigzag
        let u = ((n << 1) ^ (n >> 31)) >>> 0;
        do {
          let b = u & 0x7f;
          u >>>= 7;
          if (u !== 0) b |= 0x80;
          out.writeScalar("u8", b, endian);
        } while (u !== 0);
      }
      return;
    }

    case "sized": {
      const expectedLen = evalIntExpr(node.length, scope);
      const subOut = new ByteBuilder(Math.max(16, expectedLen));
      encodeNode(node.inner, val, subOut, endian, scope);
      const payload = subOut.finish();
      if (payload.byteLength > expectedLen) {
        throw new RangeError(
          `Sized codec payload (${payload.byteLength} bytes) exceeds declared length (${expectedLen} bytes).`,
        );
      }
      out.writeBytes(payload);
      if (payload.byteLength < expectedLen) {
        out.writeBytes(new Uint8Array(expectedLen - payload.byteLength));
      }
      return;
    }

    case "tlv": {
      const tlvEndian = node.endian ?? endian;
      const obj = (val ?? {}) as { tag?: unknown; value?: unknown };
      if (typeof node.tagCodec === "string") {
        out.writeScalar(node.tagCodec, (obj.tag as number | bigint) ?? 0, tlvEndian);
      } else {
        encodeNode(node.tagCodec, obj.tag, out, tlvEndian, scope);
      }
      const key = String(obj.tag ?? "");
      const branch = node.cases[key] ?? node.defaultCase;
      let payload: Uint8Array;
      if (branch) {
        const subOut = new ByteBuilder(64);
        encodeNode(branch, obj.value, subOut, tlvEndian, scope);
        payload = subOut.finish();
      } else {
        payload = obj.value instanceof Uint8Array ? obj.value : new Uint8Array(0);
      }
      out.writeScalar(node.lengthCodec, payload.byteLength, tlvEndian);
      out.writeBytes(payload);
      return;
    }

    case "struct": {
      const obj = (val ?? {}) as Record<string, unknown>;
      const childScope: Record<string, unknown> = { ...scope, ...obj };
      for (const f of node.fields) {
        encodeNode(f.codec, obj[f.name], out, endian, childScope);
      }
      return;
    }

    case "soaTable": {
      const cols = (val ?? {}) as Record<string, unknown>;
      const count =
        cols["count"] !== undefined
          ? Number(cols["count"])
          : node.countField !== undefined
            ? evalIntExpr(node.countField, scope)
            : 0;
      if (node.countField === undefined) {
        out.writeScalar("u32", count, endian);
      }
      for (let row = 0; row < count; row++) {
        const rowScope: Record<string, unknown> = { ...scope };
        for (const f of node.fields) {
          const col = cols[f.name] as Record<number, unknown> | undefined;
          const cell = col ? col[row] : undefined;
          rowScope[f.name] = cell;
          encodeNode(f.codec, cell, out, endian, rowScope);
        }
      }
      return;
    }

    case "repeat":
    case "repeatUntilEof": {
      const arr = Array.isArray(val) ? val : [];
      for (const item of arr) {
        encodeNode(node.item, item, out, endian, scope);
      }
      return;
    }

    case "when": {
      if (evalPredicate(node.predicate, scope)) {
        encodeNode(node.inner, val, out, endian, scope);
      }
      return;
    }

    case "switchOn": {
      const key = String(resolveScopePath(scope, node.field) ?? "");
      const branch = node.cases[key] ?? node.defaultCase;
      if (branch) encodeNode(branch, val, out, endian, scope);
      return;
    }
  }
}

/**
 * Finds the trailing streamable field (`repeatUntilEof` or `repeat`) in a root struct.
 */
function findStreamableSplit(def: BinaryCodecDefinition): {
  headerFields: BinaryFieldDef[];
  streamField: BinaryFieldDef;
  itemCodec: BinaryCodecNode;
} | null {
  const fields = def.root.fields;
  if (fields.length === 0) return null;
  const last = fields[fields.length - 1]!;
  if (last.codec.kind === "repeatUntilEof") {
    return { headerFields: fields.slice(0, -1), streamField: last, itemCodec: last.codec.item };
  }
  if (last.codec.kind === "repeat") {
    return { headerFields: fields.slice(0, -1), streamField: last, itemCodec: last.codec.item };
  }
  return null;
}

function resolveDynamicByteSize(node: BinaryCodecNode, scope: Record<string, unknown>): number | null {
  const s = staticByteSize(node);
  if (s !== null) return s;
  switch (node.kind) {
    case "bytes":
    case "sized": {
      const len = evalIntExpr(node.length, scope);
      return Number.isFinite(len) ? len : null;
    }
    case "endian":
      return resolveDynamicByteSize(node.inner, scope);
    case "fortranRecord": {
      const inner = resolveDynamicByteSize(node.inner, scope);
      return inner !== null ? inner + node.markerBytes * 2 : null;
    }
    case "struct": {
      let total = 0;
      for (const f of node.fields) {
        const fs = resolveDynamicByteSize(f.codec, scope);
        if (fs === null) return null;
        total += fs;
      }
      return total;
    }
    case "repeat": {
      const count = evalIntExpr(node.count, scope);
      if (!Number.isFinite(count)) return null;
      const itemSize = resolveDynamicByteSize(node.item, scope);
      return itemSize !== null ? count * itemSize : null;
    }
    default:
      return null;
  }
}

/**
 * Creates a bidirectional runtime binary codec supporting `decode`, `encode`,
 * resumable chunked `decodeStream`, and O(1) `readSlice` seeking.
 */
export function createRuntimeBinaryCodec<T extends Record<string, unknown> = Record<string, unknown>>(
  definition: BinaryCodecDefinition,
): RuntimeBinaryCodec<T> {
  return {
    definition,

    decode(bytes: Uint8Array): T {
      const cur = new ByteCursor(bytes);
      return decodeNode(definition.root, cur, definition.endian, {}) as T;
    },

    encode(value: T): Uint8Array {
      const out = new ByteBuilder();
      encodeNode(definition.root, value, out, definition.endian, value);
      return out.finish();
    },

    async decodeStream<TFrame = Record<string, unknown>>(
      chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
      onFrame: (frame: TFrame, index: number) => void | Promise<void>,
    ): Promise<StreamDecodeResult> {
      const split = findStreamableSplit(definition);
      if (!split) {
        throw new Error(`Codec '${definition.name}' does not end with a streamable repeat/repeatUntilEof field.`);
      }

      let carry: Uint8Array = new Uint8Array(0);
      let headerParsed = false;
      let header: Record<string, unknown> = {};
      let framesEmitted = 0;
      const headerStruct: BinaryCodecNode = { kind: "struct", fields: split.headerFields };

      const appendChunk = (chunk: Uint8Array) => {
        if (carry.byteLength === 0) {
          carry = chunk;
          return;
        }
        const next = new Uint8Array(carry.byteLength + chunk.byteLength);
        next.set(carry);
        next.set(chunk, carry.byteLength);
        carry = next;
      };

      const drain = async () => {
        if (carry.byteLength === 0) return;
        const cur = new ByteCursor(carry);

        if (!headerParsed) {
          const savedOffset = cur.offset;
          try {
            header = decodeNode(headerStruct, cur, definition.endian, {}) as Record<string, unknown>;
            headerParsed = true;
          } catch (err) {
            if (err instanceof RangeError) {
              cur.offset = savedOffset;
              return; // wait for more header bytes
            }
            throw err;
          }
        }

        const maxFrames =
          split.streamField.codec.kind === "repeat" ? evalIntExpr(split.streamField.codec.count, header) : Infinity;

        while (cur.remaining > 0 && framesEmitted < maxFrames) {
          const frameStart = cur.offset;
          let frame: TFrame;
          try {
            frame = decodeNode(split.itemCodec, cur, definition.endian, header) as TFrame;
          } catch (err) {
            if (err instanceof RangeError) {
              cur.offset = frameStart;
              break; // partial record across chunk boundary
            }
            throw err;
          }
          if (cur.offset === frameStart) {
            throw new Error(
              `Codec '${definition.name}' stream item consumed 0 bytes at frame ${framesEmitted}; aborting to prevent infinite loop.`,
            );
          }
          await onFrame(frame, framesEmitted++);
        }

        if (cur.offset > 0) {
          carry = cur.remaining > 0 ? carry.slice(cur.offset) : new Uint8Array(0);
        }
      };

      for await (const chunk of chunks as AsyncIterable<Uint8Array>) {
        if (chunk.byteLength === 0) continue;
        appendChunk(chunk);
        await drain();
      }
      await drain();

      if (!headerParsed && carry.byteLength > 0) {
        throw new RangeError(
          `Unexpected EOF in codec '${definition.name}': incomplete header (${carry.byteLength} trailing bytes).`,
        );
      }
      if (headerParsed && carry.byteLength > 0) {
        const maxFrames =
          split.streamField.codec.kind === "repeat" ? evalIntExpr(split.streamField.codec.count, header) : Infinity;
        if (framesEmitted < maxFrames) {
          throw new RangeError(
            `Unexpected EOF in codec '${definition.name}': truncated frame after ${framesEmitted} frames (${carry.byteLength} trailing bytes).`,
          );
        }
      }

      return { header, framesEmitted };
    },

    async readSlice<TFrame = Record<string, unknown>>(
      reader: RandomAccessReader,
      startIndex: number,
      count: number,
    ): Promise<{ header: Record<string, unknown>; frames: TFrame[] }> {
      if (!Number.isInteger(startIndex) || startIndex < 0) {
        throw new RangeError(`readSlice startIndex must be a non-negative integer, got ${startIndex}`);
      }
      const split = findStreamableSplit(definition);
      if (!split) {
        throw new Error(`Codec '${definition.name}' does not support fixed-stride slicing.`);
      }

      // Read initial probe to decode header (grow if variable-length header exceeds initial 4KB)
      let probeSize = Math.min(reader.byteLength, 4096);
      let header: Record<string, unknown> = {};
      let headerByteLen = 0;
      const headerStruct: BinaryCodecNode = { kind: "struct", fields: split.headerFields };

      while (true) {
        const probe = await reader.read(0, probeSize);
        const cur = new ByteCursor(probe);
        try {
          header = decodeNode(headerStruct, cur, definition.endian, {}) as Record<string, unknown>;
          headerByteLen = cur.offset;
          break;
        } catch (err) {
          if (err instanceof RangeError && probeSize < reader.byteLength) {
            probeSize = Math.min(reader.byteLength, probeSize * 2);
            continue;
          }
          throw err;
        }
      }

      const stride = resolveDynamicByteSize(split.itemCodec, header);
      if (stride === null || stride <= 0) {
        throw new Error(`Codec '${definition.name}' stream item does not have a determinable fixed stride.`);
      }

      const maxFrames =
        split.streamField.codec.kind === "repeat" ? evalIntExpr(split.streamField.codec.count, header) : Infinity;

      const startOffset = headerByteLen + startIndex * stride;
      if (startOffset >= reader.byteLength || count <= 0 || startIndex >= maxFrames) {
        return { header, frames: [] };
      }

      const fileRecords = Math.floor((reader.byteLength - startOffset) / stride);
      const declaredRemaining = Number.isFinite(maxFrames) ? Math.max(0, maxFrames - startIndex) : fileRecords;
      const availableRecords = Math.min(fileRecords, declaredRemaining);
      const toRead = Math.min(count, availableRecords);
      if (toRead <= 0) {
        return { header, frames: [] };
      }
      const sliceBytes = await reader.read(startOffset, toRead * stride);
      const cur = new ByteCursor(sliceBytes);
      const frames: TFrame[] = [];
      for (let i = 0; i < toRead; i++) {
        frames.push(decodeNode(split.itemCodec, cur, definition.endian, header) as TFrame);
      }
      return { header, frames };
    },
  };
}

// ---------------------------------------------------------------------------
// AssemblyScript WASM Codec Codegen
// ---------------------------------------------------------------------------

function collectSoaTables(node: BinaryCodecNode, acc: BinarySoaTableCodec[] = []): BinarySoaTableCodec[] {
  if (node.kind === "soaTable") {
    acc.push(node);
  } else if (node.kind === "struct") {
    for (const f of node.fields) collectSoaTables(f.codec, acc);
  } else if (node.kind === "endian" || node.kind === "fortranRecord" || node.kind === "when" || node.kind === "sized") {
    collectSoaTables(node.inner, acc);
  } else if (node.kind === "repeat" || node.kind === "repeatUntilEof") {
    collectSoaTables(node.item, acc);
  } else if (node.kind === "switchOn") {
    for (const c of Object.values(node.cases)) collectSoaTables(c, acc);
    if (node.defaultCase) collectSoaTables(node.defaultCase, acc);
  }
  return acc;
}

function collectHeaderScalars(
  fields: readonly BinaryFieldDef[],
  acc: Array<{ name: string; scalar: BinaryScalarKind }> = [],
  seen = new Set<string>(),
): Array<{ name: string; scalar: BinaryScalarKind }> {
  const visit = (name: string, node: BinaryCodecNode) => {
    if (node.kind === "scalar") {
      if (!seen.has(name)) {
        seen.add(name);
        acc.push({ name, scalar: node.scalar });
      }
    } else if (
      node.kind === "when" ||
      node.kind === "endian" ||
      node.kind === "fortranRecord" ||
      node.kind === "sized"
    ) {
      visit(name, node.inner);
    }
  };
  for (const f of fields) {
    visit(f.name, f.codec);
  }
  return acc;
}

function asExpr(expr: BinaryExpr): string {
  if (typeof expr === "number") return String(expr);
  if (typeof expr === "string") {
    if (expr.includes(".")) {
      throw new Error(
        `emitAssemblyScriptCodec: dotted field path '${expr}' is not supported in AssemblyScript codegen.`,
      );
    }
    return `hdr_${expr}`;
  }
  return `(${asExpr(expr.left)} ${expr.op} ${asExpr(expr.right)})`;
}

function asReadExpr(kind: BinaryScalarKind, endian: Endianness): string {
  const fn = kind.toUpperCase();
  return `read_${fn}_${endian.toUpperCase()}()`;
}

function asWriteStmt(kind: BinaryScalarKind, valExpr: string, endian: Endianness): string {
  const fn = kind.toUpperCase();
  return `write_${fn}_${endian.toUpperCase()}(${valExpr});`;
}

/**
 * Emits a self-contained AssemblyScript WASM codec module with linear-memory
 * SoA column tables, `decode`, `encode`, streaming `streamFeed`, and O(1) stride getters.
 */
export function emitAssemblyScriptCodec(def: BinaryCodecDefinition): string {
  const tables = collectSoaTables(def.root);
  const headerScalars = collectHeaderScalars(def.root.fields);
  const split = findStreamableSplit(def);
  const lines: string[] = [];

  lines.push(`// AUTO-GENERATED by @modelscript/dsl codec-emitter — DO NOT EDIT`);
  lines.push(`// Codec: ${def.name} (endian: ${def.endian})`);
  lines.push(``);
  lines.push(`let inBuf: Uint8Array = new Uint8Array(0);`);
  lines.push(`let inPos: i32 = 0;`);
  lines.push(`let inLen: i32 = 0;`);
  lines.push(`let inErr: i32 = 0;`);
  lines.push(`let outBuf: Uint8Array = new Uint8Array(4096);`);
  lines.push(`let outPos: i32 = 0;`);
  lines.push(``);
  lines.push(`export function codec_allocInput(byteLen: i32): usize {`);
  lines.push(`  if (byteLen < 0) return 0;`);
  lines.push(`  if (inBuf.length < byteLen) inBuf = new Uint8Array(byteLen);`);
  lines.push(`  inLen = byteLen;`);
  lines.push(`  inPos = 0;`);
  lines.push(`  inErr = 0;`);
  lines.push(`  return inBuf.dataStart;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export function codec_getOutputPtr(): usize { return outBuf.dataStart; }`);
  lines.push(`export function codec_getOutputLen(): i32 { return outPos; }`);
  lines.push(``);
  lines.push(`function ensureOut(extra: i32): void {`);
  lines.push(`  const needed: i32 = outPos + extra;`);
  lines.push(`  if (needed <= outBuf.length) return;`);
  lines.push(`  let cap: i32 = outBuf.length > 0 ? outBuf.length : 4096;`);
  lines.push(`  while (cap < needed && cap < 0x40000000) cap <<= 1;`);
  lines.push(`  if (cap < needed) cap = needed;`);
  lines.push(`  const next = new Uint8Array(cap);`);
  lines.push(`  memory.copy(next.dataStart, outBuf.dataStart, outPos);`);
  lines.push(`  outBuf = next;`);
  lines.push(`}`);
  lines.push(``);

  // Bounds-checked LE & BE scalar read/write helpers in linear memory
  lines.push(
    `@inline function read_U8_LE(): u8 { if (inPos + 1 > inLen) { inErr = -3; return 0; } const v = load<u8>(inBuf.dataStart + inPos); inPos += 1; return v; }`,
  );
  lines.push(
    `@inline function read_I8_LE(): i8 { if (inPos + 1 > inLen) { inErr = -3; return 0; } const v = load<i8>(inBuf.dataStart + inPos); inPos += 1; return v; }`,
  );
  lines.push(
    `@inline function read_U16_LE(): u16 { if (inPos + 2 > inLen) { inErr = -3; return 0; } const v = load<u16>(inBuf.dataStart + inPos); inPos += 2; return v; }`,
  );
  lines.push(
    `@inline function read_I16_LE(): i16 { if (inPos + 2 > inLen) { inErr = -3; return 0; } const v = load<i16>(inBuf.dataStart + inPos); inPos += 2; return v; }`,
  );
  lines.push(
    `@inline function read_U32_LE(): u32 { if (inPos + 4 > inLen) { inErr = -3; return 0; } const v = load<u32>(inBuf.dataStart + inPos); inPos += 4; return v; }`,
  );
  lines.push(
    `@inline function read_I32_LE(): i32 { if (inPos + 4 > inLen) { inErr = -3; return 0; } const v = load<i32>(inBuf.dataStart + inPos); inPos += 4; return v; }`,
  );
  lines.push(
    `@inline function read_U64_LE(): u64 { if (inPos + 8 > inLen) { inErr = -3; return 0; } const v = load<u64>(inBuf.dataStart + inPos); inPos += 8; return v; }`,
  );
  lines.push(
    `@inline function read_I64_LE(): i64 { if (inPos + 8 > inLen) { inErr = -3; return 0; } const v = load<i64>(inBuf.dataStart + inPos); inPos += 8; return v; }`,
  );
  lines.push(
    `@inline function read_F32_LE(): f32 { if (inPos + 4 > inLen) { inErr = -3; return 0.0; } const v = load<f32>(inBuf.dataStart + inPos); inPos += 4; return v; }`,
  );
  lines.push(
    `@inline function read_F64_LE(): f64 { if (inPos + 8 > inLen) { inErr = -3; return 0.0; } const v = load<f64>(inBuf.dataStart + inPos); inPos += 8; return v; }`,
  );
  lines.push(`@inline function read_U8_BE(): u8 { return read_U8_LE(); }`);
  lines.push(`@inline function read_I8_BE(): i8 { return read_I8_LE(); }`);
  lines.push(`@inline function read_U16_BE(): u16 { return bswap<u16>(read_U16_LE()); }`);
  lines.push(`@inline function read_I16_BE(): i16 { return bswap<i16>(read_I16_LE()); }`);
  lines.push(`@inline function read_U32_BE(): u32 { return bswap<u32>(read_U32_LE()); }`);
  lines.push(`@inline function read_I32_BE(): i32 { return bswap<i32>(read_I32_LE()); }`);
  lines.push(`@inline function read_U64_BE(): u64 { return bswap<u64>(read_U64_LE()); }`);
  lines.push(`@inline function read_I64_BE(): i64 { return bswap<i64>(read_I64_LE()); }`);
  lines.push(`@inline function read_F32_BE(): f32 { return reinterpret<f32>(bswap<u32>(read_U32_LE())); }`);
  lines.push(`@inline function read_F64_BE(): f64 { return reinterpret<f64>(bswap<u64>(read_U64_LE())); }`);
  lines.push(``);
  lines.push(
    `@inline function write_U8_LE(v: u8): void { ensureOut(1); store<u8>(outBuf.dataStart + outPos, v); outPos += 1; }`,
  );
  lines.push(
    `@inline function write_I8_LE(v: i8): void { ensureOut(1); store<i8>(outBuf.dataStart + outPos, v); outPos += 1; }`,
  );
  lines.push(
    `@inline function write_U16_LE(v: u16): void { ensureOut(2); store<u16>(outBuf.dataStart + outPos, v); outPos += 2; }`,
  );
  lines.push(
    `@inline function write_I16_LE(v: i16): void { ensureOut(2); store<i16>(outBuf.dataStart + outPos, v); outPos += 2; }`,
  );
  lines.push(
    `@inline function write_U32_LE(v: u32): void { ensureOut(4); store<u32>(outBuf.dataStart + outPos, v); outPos += 4; }`,
  );
  lines.push(
    `@inline function write_I32_LE(v: i32): void { ensureOut(4); store<i32>(outBuf.dataStart + outPos, v); outPos += 4; }`,
  );
  lines.push(
    `@inline function write_U64_LE(v: u64): void { ensureOut(8); store<u64>(outBuf.dataStart + outPos, v); outPos += 8; }`,
  );
  lines.push(
    `@inline function write_I64_LE(v: i64): void { ensureOut(8); store<i64>(outBuf.dataStart + outPos, v); outPos += 8; }`,
  );
  lines.push(
    `@inline function write_F32_LE(v: f32): void { ensureOut(4); store<f32>(outBuf.dataStart + outPos, v); outPos += 4; }`,
  );
  lines.push(
    `@inline function write_F64_LE(v: f64): void { ensureOut(8); store<f64>(outBuf.dataStart + outPos, v); outPos += 8; }`,
  );
  lines.push(`@inline function write_U8_BE(v: u8): void { write_U8_LE(v); }`);
  lines.push(`@inline function write_I8_BE(v: i8): void { write_I8_LE(v); }`);
  lines.push(`@inline function write_U16_BE(v: u16): void { write_U16_LE(bswap<u16>(v)); }`);
  lines.push(`@inline function write_I16_BE(v: i16): void { write_I16_LE(bswap<i16>(v)); }`);
  lines.push(`@inline function write_U32_BE(v: u32): void { write_U32_LE(bswap<u32>(v)); }`);
  lines.push(`@inline function write_I32_BE(v: i32): void { write_I32_LE(bswap<i32>(v)); }`);
  lines.push(`@inline function write_U64_BE(v: u64): void { write_U64_LE(bswap<u64>(v)); }`);
  lines.push(`@inline function write_I64_BE(v: i64): void { write_I64_LE(bswap<i64>(v)); }`);
  lines.push(`@inline function write_F32_BE(v: f32): void { write_U32_LE(bswap<u32>(reinterpret<u32>(v))); }`);
  lines.push(`@inline function write_F64_BE(v: f64): void { write_U64_LE(bswap<u64>(reinterpret<u64>(v))); }`);
  lines.push(``);

  // Header scalar globals (including scalars nested inside when/endian/fortranRecord)
  for (const hs of headerScalars) {
    const t = asTypeForScalar(hs.scalar);
    lines.push(`let hdr_${hs.name}: ${t} = 0;`);
    lines.push(`export function get_${hs.name}(): ${t} { return hdr_${hs.name}; }`);
    lines.push(`export function set_${hs.name}(v: ${t}): void { hdr_${hs.name} = v; }`);
  }
  lines.push(``);

  // SoA Table column storage & exports
  for (const tbl of tables) {
    lines.push(`let tbl_${tbl.name}_count: i32 = 0;`);
    lines.push(`export function get_${tbl.name}_count(): i32 { return tbl_${tbl.name}_count; }`);
    for (const f of tbl.fields) {
      if (f.codec.kind !== "scalar") {
        throw new Error(
          `emitAssemblyScriptCodec: unsupported non-scalar column '${f.name}' (kind '${f.codec.kind}') in soaTable '${tbl.name}'.`,
        );
      }
      const ta = typedArrayCtorForScalar(f.codec.scalar);
      lines.push(`let col_${tbl.name}_${f.name}: ${ta} = new ${ta}(0);`);
      lines.push(
        `export function get_${tbl.name}_${f.name}_ptr(): usize { return col_${tbl.name}_${f.name}.dataStart; }`,
      );
    }
    lines.push(`export function alloc_${tbl.name}(count: i32): void {`);
    lines.push(`  if (count < 0) return;`);
    lines.push(`  tbl_${tbl.name}_count = count;`);
    for (const f of tbl.fields) {
      if (f.codec.kind === "scalar") {
        const ta = typedArrayCtorForScalar(f.codec.scalar);
        lines.push(`  if (col_${tbl.name}_${f.name}.length < count) col_${tbl.name}_${f.name} = new ${ta}(count);`);
      }
    }
    lines.push(`}`);
    lines.push(``);
  }

  // Decode function (supports magic, scalar, align, endian, when, fortranRecord, soaTable)
  const emitDecodeField = (f: BinaryFieldDef, indent: string, endian: Endianness) => {
    const node = f.codec;
    if (node.kind === "magic") {
      for (let i = 0; i < node.expected.byteLength; i++) {
        lines.push(`${indent}if (read_U8_LE() != ${node.expected[i]} || inErr != 0) return inErr != 0 ? inErr : -1;`);
      }
    } else if (node.kind === "scalar") {
      lines.push(`${indent}hdr_${f.name} = ${asReadExpr(node.scalar, node.endian ?? endian)};`);
      lines.push(`${indent}if (inErr != 0) return inErr;`);
    } else if (node.kind === "align") {
      if (!Number.isInteger(node.alignment) || node.alignment <= 0) {
        throw new RangeError(`emitAssemblyScriptCodec: invalid alignment ${node.alignment} in field '${f.name}'.`);
      }
      lines.push(`${indent}{`);
      lines.push(`${indent}  const rem: i32 = inPos % ${node.alignment};`);
      lines.push(`${indent}  if (rem != 0) {`);
      lines.push(`${indent}    const pad: i32 = ${node.alignment} - rem;`);
      lines.push(`${indent}    if (inPos + pad > inLen) return -3;`);
      lines.push(`${indent}    inPos += pad;`);
      lines.push(`${indent}  }`);
      lines.push(`${indent}}`);
    } else if (node.kind === "endian") {
      emitDecodeField({ name: f.name, codec: node.inner }, indent, node.endian);
    } else if (node.kind === "when") {
      const p = node.predicate;
      const lhs = asExpr(p.field);
      const rhs = typeof p.value === "string" ? JSON.stringify(p.value) : String(p.value);
      lines.push(`${indent}if (${lhs} ${p.op} ${rhs}) {`);
      emitDecodeField({ name: f.name, codec: node.inner }, indent + "  ", endian);
      lines.push(`${indent}}`);
    } else if (node.kind === "sized") {
      lines.push(`${indent}{`);
      lines.push(`${indent}  const sLen: i32 = i32(${asExpr(node.length)});`);
      lines.push(`${indent}  if (sLen < 0 || inPos + sLen > inLen) return -3;`);
      lines.push(`${indent}  const sStart: i32 = inPos;`);
      lines.push(`${indent}  const prevInLen: i32 = inLen;`);
      lines.push(`${indent}  inLen = sStart + sLen;`);
      emitDecodeField({ name: f.name, codec: node.inner }, indent + "  ", endian);
      lines.push(`${indent}  inLen = prevInLen;`);
      lines.push(`${indent}  inPos = sStart + sLen;`);
      lines.push(`${indent}}`);
    } else if (node.kind === "fortranRecord") {
      const mk = node.markerBytes === 8 ? "U64" : "U32";
      lines.push(`${indent}{`);
      lines.push(`${indent}  const fLen = read_${mk}_${endian.toUpperCase()}();`);
      lines.push(`${indent}  if (inErr != 0) return inErr;`);
      lines.push(`${indent}  const recStart: i32 = inPos;`);
      emitDecodeField({ name: f.name, codec: node.inner }, indent + "  ", endian);
      lines.push(`${indent}  if (u64(inPos - recStart) != u64(fLen)) return -2;`);
      lines.push(`${indent}  const fTrail = read_${mk}_${endian.toUpperCase()}();`);
      lines.push(`${indent}  if (inErr != 0) return inErr;`);
      lines.push(`${indent}  if (fTrail != fLen) return -2;`);
      lines.push(`${indent}}`);
    } else if (node.kind === "soaTable") {
      const rowBytes = node.fields.reduce(
        (sum, cf) => sum + (cf.codec.kind === "scalar" ? scalarByteSize(cf.codec.scalar) : 0),
        0,
      );
      const countExpr =
        node.countField !== undefined ? `i32(${asExpr(node.countField)})` : `i32(${asReadExpr("u32", endian)})`;
      lines.push(`${indent}{`);
      lines.push(`${indent}  const n: i32 = ${countExpr};`);
      lines.push(`${indent}  if (inErr != 0) return inErr;`);
      lines.push(`${indent}  if (n < 0 || i64(n) * ${rowBytes} > i64(inLen - inPos)) return -3;`);
      lines.push(`${indent}  alloc_${node.name}(n);`);
      lines.push(`${indent}  for (let r: i32 = 0; r < n; r++) {`);
      for (const cf of node.fields) {
        if (cf.codec.kind === "scalar") {
          lines.push(
            `${indent}    unchecked(col_${node.name}_${cf.name}[r] = ${asReadExpr(cf.codec.scalar, cf.codec.endian ?? endian)});`,
          );
        }
      }
      lines.push(`${indent}  }`);
      lines.push(`${indent}  if (inErr != 0) return inErr;`);
      lines.push(`${indent}}`);
    } else {
      throw new Error(`emitAssemblyScriptCodec: unsupported codec node kind '${node.kind}' in field '${f.name}'.`);
    }
  };

  lines.push(`export function codec_decode(byteLen: i32): i32 {`);
  lines.push(`  if (byteLen < 0 || byteLen > inBuf.length) return -3;`);
  lines.push(`  inPos = 0;`);
  lines.push(`  inLen = byteLen;`);
  lines.push(`  inErr = 0;`);
  for (const f of def.root.fields) {
    emitDecodeField(f, "  ", def.endian);
  }
  lines.push(`  return inErr != 0 ? inErr : inPos;`);
  lines.push(`}`);
  lines.push(``);

  // Encode function (symmetric to decode)
  const emitEncodeField = (f: BinaryFieldDef, indent: string, endian: Endianness) => {
    const node = f.codec;
    if (node.kind === "magic") {
      for (let i = 0; i < node.expected.byteLength; i++) {
        lines.push(`${indent}write_U8_LE(${node.expected[i]});`);
      }
    } else if (node.kind === "scalar") {
      lines.push(`${indent}${asWriteStmt(node.scalar, `hdr_${f.name}`, node.endian ?? endian)}`);
    } else if (node.kind === "align") {
      lines.push(`${indent}{`);
      lines.push(`${indent}  const rem: i32 = outPos % ${node.alignment};`);
      lines.push(`${indent}  if (rem != 0) {`);
      lines.push(`${indent}    const pad: i32 = ${node.alignment} - rem;`);
      lines.push(`${indent}    ensureOut(pad);`);
      lines.push(`${indent}    memory.fill(outBuf.dataStart + outPos, 0, pad);`);
      lines.push(`${indent}    outPos += pad;`);
      lines.push(`${indent}  }`);
      lines.push(`${indent}}`);
    } else if (node.kind === "endian") {
      emitEncodeField({ name: f.name, codec: node.inner }, indent, node.endian);
    } else if (node.kind === "when") {
      const p = node.predicate;
      const lhs = asExpr(p.field);
      const rhs = typeof p.value === "string" ? JSON.stringify(p.value) : String(p.value);
      lines.push(`${indent}if (${lhs} ${p.op} ${rhs}) {`);
      emitEncodeField({ name: f.name, codec: node.inner }, indent + "  ", endian);
      lines.push(`${indent}}`);
    } else if (node.kind === "sized") {
      lines.push(`${indent}{`);
      lines.push(`${indent}  const sLen: i32 = i32(${asExpr(node.length)});`);
      lines.push(`${indent}  const sStart: i32 = outPos;`);
      emitEncodeField({ name: f.name, codec: node.inner }, indent + "  ", endian);
      lines.push(`${indent}  const written: i32 = outPos - sStart;`);
      lines.push(`${indent}  if (written < sLen) {`);
      lines.push(`${indent}    const pad: i32 = sLen - written;`);
      lines.push(`${indent}    ensureOut(pad);`);
      lines.push(`${indent}    memory.fill(outBuf.dataStart + outPos, 0, pad);`);
      lines.push(`${indent}    outPos += pad;`);
      lines.push(`${indent}  }`);
      lines.push(`${indent}}`);
    } else if (node.kind === "fortranRecord") {
      const mk = node.markerBytes === 8 ? "u64" : "u32";
      const patchedVal = endian === "be" ? `bswap<${mk}>(${mk}(payloadLen))` : `${mk}(payloadLen)`;
      lines.push(`${indent}{`);
      lines.push(`${indent}  const startPos: i32 = outPos;`);
      lines.push(`${indent}  ${asWriteStmt(mk, "0", endian)}`);
      lines.push(`${indent}  const payloadStart: i32 = outPos;`);
      emitEncodeField({ name: f.name, codec: node.inner }, indent + "  ", endian);
      lines.push(`${indent}  const payloadLen: i32 = outPos - payloadStart;`);
      lines.push(`${indent}  store<${mk}>(outBuf.dataStart + startPos, ${patchedVal});`);
      lines.push(`${indent}  ${asWriteStmt(mk, `${mk}(payloadLen)`, endian)}`);
      lines.push(`${indent}}`);
    } else if (node.kind === "soaTable") {
      const rowBytes = node.fields.reduce(
        (sum, cf) => sum + (cf.codec.kind === "scalar" ? scalarByteSize(cf.codec.scalar) : 0),
        0,
      );
      if (node.countField === undefined) {
        lines.push(`${indent}${asWriteStmt("u32", `u32(tbl_${node.name}_count)`, endian)}`);
      }
      lines.push(`${indent}if (tbl_${node.name}_count > 0) {`);
      lines.push(`${indent}  ensureOut(tbl_${node.name}_count * ${rowBytes});`);
      lines.push(`${indent}  let dst: usize = outBuf.dataStart + outPos;`);
      lines.push(`${indent}  for (let r: i32 = 0; r < tbl_${node.name}_count; r++) {`);
      let fieldOff = 0;
      for (const cf of node.fields) {
        if (cf.codec.kind === "scalar") {
          const sk = cf.codec.scalar;
          const sz = scalarByteSize(sk);
          const colEnd = cf.codec.endian ?? endian;
          const valExpr = `unchecked(col_${node.name}_${cf.name}[r])`;
          if (colEnd === "be" && sz > 1) {
            if (sk === "f32") {
              lines.push(`${indent}    store<u32>(dst + ${fieldOff}, bswap<u32>(reinterpret<u32>(${valExpr})));`);
            } else if (sk === "f64") {
              lines.push(`${indent}    store<u64>(dst + ${fieldOff}, bswap<u64>(reinterpret<u64>(${valExpr})));`);
            } else {
              lines.push(`${indent}    store<${sk}>(dst + ${fieldOff}, bswap<${sk}>(${valExpr}));`);
            }
          } else {
            lines.push(`${indent}    store<${sk}>(dst + ${fieldOff}, ${valExpr});`);
          }
          fieldOff += sz;
        }
      }
      lines.push(`${indent}    dst += ${rowBytes};`);
      lines.push(`${indent}  }`);
      lines.push(`${indent}  outPos += tbl_${node.name}_count * ${rowBytes};`);
      lines.push(`${indent}}`);
    } else {
      throw new Error(`emitAssemblyScriptCodec: unsupported codec node kind '${node.kind}' in field '${f.name}'.`);
    }
  };

  lines.push(`export function codec_encode(): i32 {`);
  lines.push(`  outPos = 0;`);
  // Auto-sync root scalar countField headers from allocated SoA table row counts
  const headerScalarMap = new Map(headerScalars.map((hs) => [hs.name, hs.scalar]));
  for (const tbl of tables) {
    if (typeof tbl.countField === "string" && headerScalarMap.has(tbl.countField)) {
      const t = asTypeForScalar(headerScalarMap.get(tbl.countField)!);
      lines.push(`  hdr_${tbl.countField} = ${t}(tbl_${tbl.name}_count);`);
    }
  }
  for (const f of def.root.fields) {
    emitEncodeField(f, "  ", def.endian);
  }
  lines.push(`  return outPos;`);
  lines.push(`}`);
  lines.push(``);

  // Resumable linear-memory streaming carryover buffer
  lines.push(`let streamBuf: Uint8Array = new Uint8Array(65536);`);
  lines.push(`let streamLen: i32 = 0;`);
  lines.push(`let streamChunkBuf: Uint8Array = new Uint8Array(0);`);
  lines.push(`let streamFramesEmitted: i32 = 0;`);
  lines.push(``);
  lines.push(`export function codec_streamInit(): void { streamLen = 0; streamFramesEmitted = 0; }`);
  lines.push(`export function codec_streamGetBufferedBytes(): i32 { return streamLen; }`);
  lines.push(`export function codec_streamGetFramesEmitted(): i32 { return streamFramesEmitted; }`);
  lines.push(`export function codec_streamAllocChunk(byteLen: i32): usize {`);
  lines.push(`  if (byteLen < 0) return 0;`);
  lines.push(`  if (streamChunkBuf.length < byteLen) streamChunkBuf = new Uint8Array(byteLen);`);
  lines.push(`  return streamChunkBuf.dataStart;`);
  lines.push(`}`);
  lines.push(`export function codec_streamFeed(chunkLen: i32): i32 {`);
  lines.push(`  if (chunkLen <= 0) return streamLen;`);
  lines.push(`  const needed: i32 = streamLen + chunkLen;`);
  lines.push(`  if (needed > streamBuf.length) {`);
  lines.push(`    let cap: i32 = streamBuf.length > 0 ? streamBuf.length : 65536;`);
  lines.push(`    while (cap < needed && cap < 0x40000000) cap <<= 1;`);
  lines.push(`    if (cap < needed) cap = needed;`);
  lines.push(`    const next = new Uint8Array(cap);`);
  lines.push(`    memory.copy(next.dataStart, streamBuf.dataStart, streamLen);`);
  lines.push(`    streamBuf = next;`);
  lines.push(`  }`);
  lines.push(`  memory.copy(streamBuf.dataStart + streamLen, streamChunkBuf.dataStart, chunkLen);`);
  lines.push(`  streamLen += chunkLen;`);
  lines.push(`  return streamLen;`);
  lines.push(`}`);
  lines.push(`export function codec_streamFlush(): i32 {`);
  lines.push(`  const ptr = codec_allocInput(streamLen);`);
  lines.push(`  memory.copy(ptr, streamBuf.dataStart, streamLen);`);
  lines.push(`  const res = codec_decode(streamLen);`);
  lines.push(`  streamLen = 0;`);
  lines.push(`  return res;`);
  lines.push(`}`);
  lines.push(``);

  // Static header & stride metadata for O(1) seeking
  const staticHeader = split ? staticByteSize({ kind: "struct", fields: split.headerFields }) : null;
  const staticStride = split ? staticByteSize(split.itemCodec) : null;
  lines.push(`export function codec_getStreamHeaderBytes(): i32 { return ${staticHeader ?? -1}; }`);
  lines.push(`export function codec_getStreamRecordStride(): i32 { return ${staticStride ?? -1}; }`);
  lines.push(``);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// TypeScript Zero-Copy SoA Bindings Codegen
// ---------------------------------------------------------------------------

function tsTypeForNode(node: BinaryCodecNode): string {
  switch (node.kind) {
    case "scalar":
      return node.scalar === "u64" || node.scalar === "i64" ? "bigint" : "number";
    case "varint":
      return "number";
    case "fixedStr":
    case "lenPrefixedStr":
    case "cstr":
    case "magic":
      return "string";
    case "bytes":
      return "Uint8Array";
    case "bitfield":
      return `{ ${node.fields.map((f) => `${f.name}: number`).join("; ")} }`;
    case "endian":
    case "fortranRecord":
    case "sized":
      return tsTypeForNode(node.inner);
    case "when":
      return `${tsTypeForNode(node.inner)} | undefined`;
    case "repeat":
    case "repeatUntilEof":
      return `Array<${tsTypeForNode(node.item)}>`;
    case "struct":
      return `{ ${node.fields.map((f) => `${f.name}: ${tsTypeForNode(f.codec)}`).join("; ")} }`;
    case "soaTable": {
      const cols = node.fields
        .map((f) =>
          f.codec.kind === "scalar"
            ? `${f.name}: ${typedArrayCtorForScalar(f.codec.scalar)}`
            : `${f.name}: Array<${tsTypeForNode(f.codec)}>`,
        )
        .join("; ");
      return `{ count: number; ${cols} }`;
    }
    case "switchOn": {
      const branches = Object.values(node.cases).map(tsTypeForNode);
      if (node.defaultCase) branches.push(tsTypeForNode(node.defaultCase));
      else branches.push("undefined");
      return Array.from(new Set(branches)).join(" | ");
    }
    case "tlv": {
      const tagT =
        typeof node.tagCodec === "string"
          ? node.tagCodec === "u64" || node.tagCodec === "i64"
            ? "bigint"
            : "number"
          : "string";
      const valBranches = Object.values(node.cases).map(tsTypeForNode);
      if (node.defaultCase) valBranches.push(tsTypeForNode(node.defaultCase));
      else valBranches.push("Uint8Array");
      return `{ tag: ${tagT}; value: ${Array.from(new Set(valBranches)).join(" | ")} }`;
    }
    case "align":
      return "void";
  }
}

/**
 * Emits strongly typed TypeScript interfaces and zero-copy WASM linear-memory
 * SoA view helpers for a `BinaryCodecDefinition`.
 */
export function emitTypeScriptCodecBindings(def: BinaryCodecDefinition): string {
  const pascal = def.name.replace(/(^|[_-])([a-z])/g, (_, __, c: string) => c.toUpperCase());
  const tables = collectSoaTables(def.root);
  const scalarHeaders = collectHeaderScalars(def.root.fields);
  const lines: string[] = [];

  lines.push(`// AUTO-GENERATED by @modelscript/dsl codec-emitter — DO NOT EDIT`);
  lines.push(`// Codec: ${def.name}`);
  lines.push(``);
  lines.push(`export interface ${pascal}Data {`);
  for (const f of def.root.fields) {
    if (f.codec.kind === "align") continue;
    lines.push(`  ${f.name}: ${tsTypeForNode(f.codec)};`);
  }
  lines.push(`}`);
  lines.push(``);

  for (const tbl of tables) {
    const tPascal = tbl.name.replace(/(^|[_-])([a-z])/g, (_, __, c: string) => c.toUpperCase());
    lines.push(`export interface ${pascal}${tPascal}SoaView {`);
    lines.push(`  readonly count: number;`);
    for (const f of tbl.fields) {
      if (f.codec.kind === "scalar") {
        lines.push(`  readonly ${f.name}: ${typedArrayCtorForScalar(f.codec.scalar)};`);
      }
    }
    lines.push(`}`);
    lines.push(``);
  }

  lines.push(`export interface ${pascal}WasmExports {`);
  lines.push(`  readonly memory: WebAssembly.Memory;`);
  lines.push(`  codec_allocInput(byteLen: number): number;`);
  lines.push(`  codec_decode(byteLen: number): number;`);
  lines.push(`  codec_encode(): number;`);
  lines.push(`  codec_getOutputPtr(): number;`);
  lines.push(`  codec_getOutputLen(): number;`);
  lines.push(`  codec_streamInit(): void;`);
  lines.push(`  codec_streamGetBufferedBytes(): number;`);
  lines.push(`  codec_streamGetFramesEmitted(): number;`);
  lines.push(`  codec_streamAllocChunk(byteLen: number): number;`);
  lines.push(`  codec_streamFeed(chunkLen: number): number;`);
  lines.push(`  codec_streamFlush(): number;`);
  lines.push(`  codec_getStreamHeaderBytes(): number;`);
  lines.push(`  codec_getStreamRecordStride(): number;`);
  for (const hs of scalarHeaders) {
    const tsT = hs.scalar === "u64" || hs.scalar === "i64" ? "bigint" : "number";
    lines.push(`  get_${hs.name}(): ${tsT};`);
    lines.push(`  set_${hs.name}(v: ${tsT}): void;`);
  }
  for (const tbl of tables) {
    lines.push(`  get_${tbl.name}_count(): number;`);
    lines.push(`  alloc_${tbl.name}(count: number): void;`);
    for (const f of tbl.fields) {
      if (f.codec.kind === "scalar") {
        lines.push(`  get_${tbl.name}_${f.name}_ptr(): number;`);
      }
    }
  }
  lines.push(`}`);
  lines.push(``);

  // Zero-copy view factory over wasmMemory.buffer
  lines.push(`export function create${pascal}WasmView(exports: ${pascal}WasmExports) {`);
  lines.push(`  return {`);
  lines.push(`    decode(bytes: Uint8Array): number {`);
  lines.push(`      const ptr = exports.codec_allocInput(bytes.byteLength);`);
  lines.push(`      new Uint8Array(exports.memory.buffer, ptr, bytes.byteLength).set(bytes);`);
  lines.push(`      return exports.codec_decode(bytes.byteLength);`);
  lines.push(`    },`);
  lines.push(`    encode(): Uint8Array {`);
  lines.push(`      const len = exports.codec_encode();`);
  lines.push(`      const ptr = exports.codec_getOutputPtr();`);
  lines.push(`      return new Uint8Array(exports.memory.buffer, ptr, len).slice();`);
  lines.push(`    },`);
  lines.push(`    async decodeStream(chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>): Promise<number> {`);
  lines.push(`      exports.codec_streamInit();`);
  lines.push(`      for await (const chunk of chunks as AsyncIterable<Uint8Array>) {`);
  lines.push(`        if (chunk.byteLength === 0) continue;`);
  lines.push(`        const ptr = exports.codec_streamAllocChunk(chunk.byteLength);`);
  lines.push(`        new Uint8Array(exports.memory.buffer, ptr, chunk.byteLength).set(chunk);`);
  lines.push(`        exports.codec_streamFeed(chunk.byteLength);`);
  lines.push(`      }`);
  lines.push(`      return exports.codec_streamFlush();`);
  lines.push(`    },`);
  for (const hs of scalarHeaders) {
    const tsT = hs.scalar === "u64" || hs.scalar === "i64" ? "bigint" : "number";
    lines.push(`    get ${hs.name}(): ${tsT} { return exports.get_${hs.name}(); },`);
    lines.push(`    set ${hs.name}(v: ${tsT}) { exports.set_${hs.name}(v); },`);
  }
  for (const tbl of tables) {
    const tPascal = tbl.name.replace(/(^|[_-])([a-z])/g, (_, __, c: string) => c.toUpperCase());
    lines.push(`    alloc_${tbl.name}(count: number): void { exports.alloc_${tbl.name}(count); },`);
    lines.push(`    get ${tbl.name}(): ${pascal}${tPascal}SoaView {`);
    lines.push(`      const count = exports.get_${tbl.name}_count();`);
    lines.push(`      const buf = exports.memory.buffer;`);
    lines.push(`      return {`);
    lines.push(`        count,`);
    for (const f of tbl.fields) {
      if (f.codec.kind === "scalar") {
        const ta = typedArrayCtorForScalar(f.codec.scalar);
        lines.push(`        ${f.name}: new ${ta}(buf, exports.get_${tbl.name}_${f.name}_ptr(), count),`);
      }
    }
    lines.push(`      };`);
    lines.push(`    },`);
  }
  lines.push(`  };`);
  lines.push(`}`);
  lines.push(``);

  return lines.join("\n");
}
