// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Declarative Bidirectional Binary Codec & Linear-Memory SoA Layout DSL.
 *
 * A single codec definition compiles to:
 *  1. Deterministic AssemblyScript/WASM linear-memory `decode` / `encode` kernels
 *  2. Zero-copy TypeScript typed-array SoA views (`Int32Array`, `Float64Array`, etc.)
 *  3. Resumable chunked streaming decoders/encoders (`ReadableStream` / `fs.createReadStream`)
 *  4. O(1) fixed-stride byte-offset seeking (`fs.read` / `Blob.slice`) for large files
 */

export type Endianness = "le" | "be";

export type BinaryScalarKind = "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "u64" | "i64" | "f32" | "f64";

export interface BinaryScalarCodec {
  readonly kind: "scalar";
  readonly scalar: BinaryScalarKind;
  readonly endian?: Endianness | undefined;
}

export interface BinaryFixedStrCodec {
  readonly kind: "fixedStr";
  readonly byteLength: number;
  readonly padChar: string;
  readonly trim: boolean;
}

export interface BinaryLenPrefixedStrCodec {
  readonly kind: "lenPrefixedStr";
  readonly lengthCodec: BinaryScalarKind;
  readonly endian?: Endianness | undefined;
}

export type BinaryExprOp = "+" | "-" | "*" | "/" | "%" | "&" | "|" | "<<" | ">>";

export interface BinaryExprBinOp {
  readonly kind: "expr";
  readonly op: BinaryExprOp;
  readonly left: BinaryExpr;
  readonly right: BinaryExpr;
}

/**
 * Dynamic integer expression for lengths, counts, and predicates.
 * Supports numeric literals, flat or dotted field paths (e.g. `"header.nChannels"`),
 * and arithmetic/bitwise trees (`codec.expr.sub("len", 4)`).
 */
export type BinaryExpr = number | string | BinaryExprBinOp;

export interface BinaryBytesCodec {
  readonly kind: "bytes";
  readonly length: BinaryExpr;
}

export interface BinaryMagicCodec {
  readonly kind: "magic";
  readonly expected: Uint8Array;
  readonly ascii?: string | undefined;
}

export interface BinaryAlignCodec {
  readonly kind: "align";
  readonly alignment: number;
}

export interface BinaryEndianCodec {
  readonly kind: "endian";
  readonly endian: Endianness;
  readonly inner: BinaryCodecNode;
}

export interface BinaryFortranRecordCodec {
  readonly kind: "fortranRecord";
  readonly markerBytes: 4 | 8;
  readonly inner: BinaryCodecNode;
}

export interface BinaryBitfieldDef {
  readonly name: string;
  readonly bits: number;
}

export interface BinaryBitfieldCodec {
  readonly kind: "bitfield";
  readonly fields: readonly BinaryBitfieldDef[];
  readonly totalBytes: number;
  readonly endian?: Endianness | undefined;
}

export type BinaryTextEncoding = "utf-8" | "ascii" | "latin1";

export interface BinaryCStrCodec {
  readonly kind: "cstr";
  readonly encoding: BinaryTextEncoding;
}

export type BinaryVarintKind = "uleb128" | "sleb128" | "zigzag";

export interface BinaryVarintCodec {
  readonly kind: "varint";
  readonly encoding: BinaryVarintKind;
}

export interface BinarySizedCodec {
  readonly kind: "sized";
  readonly length: BinaryExpr;
  readonly inner: BinaryCodecNode;
}

export interface BinaryTlvCodec {
  readonly kind: "tlv";
  readonly tagCodec: BinaryScalarKind | BinaryFixedStrCodec;
  readonly lengthCodec: BinaryScalarKind;
  readonly cases: Readonly<Record<string, BinaryCodecNode>>;
  readonly defaultCase?: BinaryCodecNode | undefined;
  readonly endian?: Endianness | undefined;
}

export interface BinaryFieldDef {
  readonly name: string;
  readonly codec: BinaryCodecNode;
}

export interface BinaryStructCodec {
  readonly kind: "struct";
  readonly name?: string | undefined;
  readonly fields: readonly BinaryFieldDef[];
}

export interface BinarySoaTableCodec {
  readonly kind: "soaTable";
  readonly name: string;
  readonly countField?: BinaryExpr | undefined;
  readonly fields: readonly BinaryFieldDef[];
  /** True if rows can be streamed incrementally without knowing total count upfront. */
  readonly streamable?: boolean | undefined;
}

export interface BinaryRepeatCodec {
  readonly kind: "repeat";
  readonly count: BinaryExpr;
  readonly item: BinaryCodecNode;
}

export interface BinaryRepeatUntilEofCodec {
  readonly kind: "repeatUntilEof";
  readonly item: BinaryCodecNode;
}

export type BinaryPredicateOp = "==" | "!=" | "<" | "<=" | ">" | ">=";

export interface BinaryPredicate {
  /** Field path (flat or dotted) or arithmetic/bitwise `BinaryExpr`. */
  readonly field: BinaryExpr;
  readonly op: BinaryPredicateOp;
  readonly value: number | string;
}

export interface BinaryWhenCodec {
  readonly kind: "when";
  readonly predicate: BinaryPredicate;
  readonly inner: BinaryCodecNode;
}

export interface BinarySwitchCodec {
  readonly kind: "switchOn";
  readonly field: string;
  readonly cases: Readonly<Record<string, BinaryCodecNode>>;
  readonly defaultCase?: BinaryCodecNode | undefined;
}

export type BinaryCodecNode =
  | BinaryScalarCodec
  | BinaryFixedStrCodec
  | BinaryLenPrefixedStrCodec
  | BinaryBytesCodec
  | BinaryMagicCodec
  | BinaryAlignCodec
  | BinaryEndianCodec
  | BinaryFortranRecordCodec
  | BinaryBitfieldCodec
  | BinaryCStrCodec
  | BinaryVarintCodec
  | BinarySizedCodec
  | BinaryTlvCodec
  | BinaryStructCodec
  | BinarySoaTableCodec
  | BinaryRepeatCodec
  | BinaryRepeatUntilEofCodec
  | BinaryWhenCodec
  | BinarySwitchCodec;

export interface BinaryCodecDefinition {
  readonly name: string;
  readonly endian: Endianness;
  readonly versions?: readonly (number | string)[] | undefined;
  readonly root: BinaryStructCodec;
}

/**
 * Multi-format / dialect entry registered on `LanguageOptions.formats`.
 */
export interface FormatDefinition<RuleName extends string = string> {
  readonly kind: "text" | "binary";
  readonly fileExtensions: readonly string[];
  readonly description?: string | undefined;
  /** Entry grammar rule for `kind: "text"` GLR formats. */
  readonly startRule?: RuleName | undefined;
  /** Declarative binary-to-SoA codec for `kind: "binary"` formats. */
  readonly codec?: BinaryCodecDefinition | undefined;
  /** Supported format revisions/dialects (e.g. `[26, 29, 30, 31, 32, 33, 34, 35, 36]`). */
  readonly versions?: readonly (number | string)[] | undefined;
}

// ---------------------------------------------------------------------------
// Combinator Constructors
// ---------------------------------------------------------------------------

export const codec = {
  u8: (): BinaryScalarCodec => ({ kind: "scalar", scalar: "u8" }),
  i8: (): BinaryScalarCodec => ({ kind: "scalar", scalar: "i8" }),
  u16: (e?: Endianness): BinaryScalarCodec => ({ kind: "scalar", scalar: "u16", endian: e }),
  i16: (e?: Endianness): BinaryScalarCodec => ({ kind: "scalar", scalar: "i16", endian: e }),
  u32: (e?: Endianness): BinaryScalarCodec => ({ kind: "scalar", scalar: "u32", endian: e }),
  i32: (e?: Endianness): BinaryScalarCodec => ({ kind: "scalar", scalar: "i32", endian: e }),
  u64: (e?: Endianness): BinaryScalarCodec => ({ kind: "scalar", scalar: "u64", endian: e }),
  i64: (e?: Endianness): BinaryScalarCodec => ({ kind: "scalar", scalar: "i64", endian: e }),
  f32: (e?: Endianness): BinaryScalarCodec => ({ kind: "scalar", scalar: "f32", endian: e }),
  f64: (e?: Endianness): BinaryScalarCodec => ({ kind: "scalar", scalar: "f64", endian: e }),

  fixedStr: (byteLength: number, padChar = " ", trim = true): BinaryFixedStrCodec => ({
    kind: "fixedStr",
    byteLength,
    padChar,
    trim,
  }),

  lenPrefixedStr: (lengthCodec: BinaryScalarKind = "u32", e?: Endianness): BinaryLenPrefixedStrCodec => ({
    kind: "lenPrefixedStr",
    lengthCodec,
    endian: e,
  }),

  bytes: (length: BinaryExpr): BinaryBytesCodec => ({ kind: "bytes", length }),

  magic: (expected: string | Uint8Array): BinaryMagicCodec => {
    if (typeof expected === "string") {
      const arr = new Uint8Array(expected.length);
      for (let i = 0; i < expected.length; i++) arr[i] = expected.charCodeAt(i) & 0xff;
      return { kind: "magic", expected: arr, ascii: expected };
    }
    return { kind: "magic", expected };
  },

  align: (alignment: number): BinaryAlignCodec => ({ kind: "align", alignment }),

  endian: (e: Endianness, inner: BinaryCodecNode): BinaryEndianCodec => ({
    kind: "endian",
    endian: e,
    inner,
  }),

  fortranRecord: (inner: BinaryCodecNode, markerBytes: 4 | 8 = 4): BinaryFortranRecordCodec => ({
    kind: "fortranRecord",
    markerBytes,
    inner,
  }),

  bitfield: (fields: Record<string, number>, endian?: Endianness): BinaryBitfieldCodec => {
    const entries = Object.entries(fields).map(([name, bits]) => {
      if (!Number.isInteger(bits) || bits <= 0 || bits > 32) {
        throw new RangeError(`Bitfield '${name}' width must be an integer in 1..32, got ${bits}`);
      }
      return { name, bits };
    });
    const totalBits = entries.reduce((sum, f) => sum + f.bits, 0);
    if (totalBits === 0 || totalBits % 8 !== 0) {
      throw new RangeError(`Bitfield total width must be a positive multiple of 8 bits, got ${totalBits}`);
    }
    return { kind: "bitfield", fields: entries, totalBytes: totalBits / 8, endian };
  },

  cstr: (encoding: BinaryTextEncoding = "utf-8"): BinaryCStrCodec => ({
    kind: "cstr",
    encoding,
  }),

  varint: (encoding: BinaryVarintKind = "uleb128"): BinaryVarintCodec => ({
    kind: "varint",
    encoding,
  }),

  sized: (length: BinaryExpr, inner: BinaryCodecNode): BinarySizedCodec => ({
    kind: "sized",
    length,
    inner,
  }),

  tlv: (
    tagCodec: BinaryScalarKind | BinaryFixedStrCodec,
    lengthCodec: BinaryScalarKind,
    cases: Record<string, BinaryCodecNode>,
    opts?: { defaultCase?: BinaryCodecNode | undefined; endian?: Endianness | undefined },
  ): BinaryTlvCodec => ({
    kind: "tlv",
    tagCodec,
    lengthCodec,
    cases,
    defaultCase: opts?.defaultCase,
    endian: opts?.endian,
  }),

  expr: {
    add: (left: BinaryExpr, right: BinaryExpr): BinaryExprBinOp => ({ kind: "expr", op: "+", left, right }),
    sub: (left: BinaryExpr, right: BinaryExpr): BinaryExprBinOp => ({ kind: "expr", op: "-", left, right }),
    mul: (left: BinaryExpr, right: BinaryExpr): BinaryExprBinOp => ({ kind: "expr", op: "*", left, right }),
    div: (left: BinaryExpr, right: BinaryExpr): BinaryExprBinOp => ({ kind: "expr", op: "/", left, right }),
    mod: (left: BinaryExpr, right: BinaryExpr): BinaryExprBinOp => ({ kind: "expr", op: "%", left, right }),
    bitAnd: (left: BinaryExpr, right: BinaryExpr): BinaryExprBinOp => ({ kind: "expr", op: "&", left, right }),
    bitOr: (left: BinaryExpr, right: BinaryExpr): BinaryExprBinOp => ({ kind: "expr", op: "|", left, right }),
    shl: (left: BinaryExpr, right: BinaryExpr): BinaryExprBinOp => ({ kind: "expr", op: "<<", left, right }),
    shr: (left: BinaryExpr, right: BinaryExpr): BinaryExprBinOp => ({ kind: "expr", op: ">>", left, right }),
  },

  struct: (fields: Record<string, BinaryCodecNode>, name?: string): BinaryStructCodec => ({
    kind: "struct",
    name,
    fields: Object.entries(fields).map(([fieldName, fieldCodec]) => ({ name: fieldName, codec: fieldCodec })),
  }),

  soaTable: (
    name: string,
    fields: Record<string, BinaryCodecNode>,
    opts?: { countField?: BinaryExpr | undefined; streamable?: boolean | undefined },
  ): BinarySoaTableCodec => ({
    kind: "soaTable",
    name,
    countField: opts?.countField,
    streamable: opts?.streamable,
    fields: Object.entries(fields).map(([fieldName, fieldCodec]) => ({ name: fieldName, codec: fieldCodec })),
  }),

  repeat: (count: BinaryExpr, item: BinaryCodecNode): BinaryRepeatCodec => ({
    kind: "repeat",
    count,
    item,
  }),

  repeatUntilEof: (item: BinaryCodecNode): BinaryRepeatUntilEofCodec => ({
    kind: "repeatUntilEof",
    item,
  }),

  when: (
    field: BinaryExpr,
    op: BinaryPredicateOp,
    value: number | string,
    inner: BinaryCodecNode,
  ): BinaryWhenCodec => ({
    kind: "when",
    predicate: { field, op, value },
    inner,
  }),

  switchOn: (
    field: string,
    cases: Record<string, BinaryCodecNode>,
    defaultCase?: BinaryCodecNode,
  ): BinarySwitchCodec => ({
    kind: "switchOn",
    field,
    cases,
    defaultCase,
  }),
};

/**
 * Defines a declarative bidirectional binary-to-SoA codec.
 */
export function defineBinaryCodec(def: BinaryCodecDefinition): BinaryCodecDefinition {
  return def;
}

/**
 * Computes the fixed byte size of a codec node if statically known, or `null` if variable-length.
 */
export function staticByteSize(node: BinaryCodecNode): number | null {
  switch (node.kind) {
    case "scalar":
      switch (node.scalar) {
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
      return null;
    case "fixedStr":
      return node.byteLength;
    case "bytes":
      return typeof node.length === "number" ? node.length : null;
    case "magic":
      return node.expected.byteLength;
    case "bitfield":
      return node.totalBytes;
    case "sized":
      return typeof node.length === "number" ? node.length : null;
    case "endian":
      return staticByteSize(node.inner);
    case "fortranRecord": {
      const inner = staticByteSize(node.inner);
      return inner !== null ? inner + node.markerBytes * 2 : null;
    }
    case "struct": {
      let total = 0;
      for (const f of node.fields) {
        const s = staticByteSize(f.codec);
        if (s === null) return null;
        total += s;
      }
      return total;
    }
    case "repeat": {
      if (typeof node.count !== "number") return null;
      const itemSize = staticByteSize(node.item);
      return itemSize !== null ? node.count * itemSize : null;
    }
    default:
      return null;
  }
}

/** Private-Use-Area sentinels for zero-conflict multi-entry-point GLR format dispatch. */
export const FORMAT_SENTINEL_START = "\uE000";
export const FORMAT_SENTINEL_END = "\uE001";

/**
 * Prepends the GLR multi-entry-point format sentinel (`\uE000<format>\uE001`) to `source`.
 */
export function encodeFormatSource(source: string, format: string): string {
  return `${FORMAT_SENTINEL_START}${format}${FORMAT_SENTINEL_END}${source}`;
}

/**
 * Resolves the registered format key for a file path / URI from a `formats` map.
 */
export function resolveFormatForUri<R extends string>(
  formats: Readonly<Record<string, FormatDefinition<R>>> | undefined,
  uri: string | undefined,
): string | undefined {
  if (!formats || !uri) return undefined;
  const lower = uri.toLowerCase();
  for (const [key, def] of Object.entries(formats)) {
    for (const ext of def.fileExtensions) {
      if (lower.endsWith(ext.toLowerCase())) return key;
    }
  }
  return undefined;
}
