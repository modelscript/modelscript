// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Canonical ISO/ITU-T X.690 BER & DER Tag-Length-Value (TLV) binary codec.
 *
 * Implements:
 * - Definite short & minimal long length encoding (`encodeLength`)
 * - Minimal big-endian two's-complement INTEGER encoding/decoding (`encodeDerInteger`, `decodeDerInteger`)
 * - Base-128 VLQ OBJECT IDENTIFIER encoding/decoding (`encodeOid`, `decodeOid`)
 * - Canonical DER encoding (`encodeDer`) with lexicographic SET sorting
 * - Permissive BER decoding (`decodeBer`) with strict X.690 DER canonicality diagnostics
 */

import { Asn1ErrorCode } from "../errors.js";
import {
  UNIVERSAL_TAGS,
  type Asn1TagClass,
  type BerDecodeResult,
  type BerLengthForm,
  type BerTlvNode,
  type DerCanonicalIssue,
  type DerValue,
} from "../types.js";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });

export function bytesToHex(bytes: Uint8Array, separator = " "): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    parts.push((bytes[i] ?? 0).toString(16).padStart(2, "0").toUpperCase());
  }
  return parts.join(separator);
}

export function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.replace(/[^0-9a-fA-F]/g, "");
  if (cleaned.length % 2 !== 0) {
    throw new Error("Hex string must contain an even number of hexadecimal digits.");
  }
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function tagClassBits(tagClass: Asn1TagClass): number {
  switch (tagClass) {
    case "UNIVERSAL":
      return 0x00;
    case "APPLICATION":
      return 0x40;
    case "CONTEXT":
      return 0x80;
    case "PRIVATE":
      return 0xc0;
  }
}

function bitsToTagClass(bits: number): Asn1TagClass {
  switch (bits & 0xc0) {
    case 0x00:
      return "UNIVERSAL";
    case 0x40:
      return "APPLICATION";
    case 0x80:
      return "CONTEXT";
    default:
      return "PRIVATE";
  }
}

/**
 * Encodes an unsigned non-negative integer using X.690 base-128 VLQ (most-significant 7-bit groups first).
 */
export function encodeBase128(value: number | bigint): Uint8Array {
  let v = typeof value === "bigint" ? value : BigInt(value);
  if (v < 0n) {
    throw new Error(`Base-128 VLQ value must be non-negative, got ${v.toString()}`);
  }
  if (v === 0n) {
    return new Uint8Array([0x00]);
  }
  const bytes: number[] = [];
  bytes.push(Number(v & 0x7fn));
  v >>= 7n;
  while (v > 0n) {
    bytes.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  bytes.reverse();
  return new Uint8Array(bytes);
}

/**
 * Encodes an ASN.1 tag (short form for tag < 31, high-tag-number base-128 form for tag >= 31).
 */
export function encodeTag(tagClass: Asn1TagClass, constructed: boolean, tagNumber: number): Uint8Array {
  if (!Number.isInteger(tagNumber) || tagNumber < 0) {
    throw new Error(`Invalid ASN.1 tag number: ${tagNumber}`);
  }
  const prefix = tagClassBits(tagClass) | (constructed ? 0x20 : 0x00);
  if (tagNumber < 31) {
    return new Uint8Array([prefix | tagNumber]);
  }
  const vlq = encodeBase128(tagNumber);
  const out = new Uint8Array(1 + vlq.length);
  out[0] = prefix | 0x1f;
  out.set(vlq, 1);
  return out;
}

/**
 * Encodes a DER definite length:
 * - Short form (`0x00..0x7F`) for lengths < 128
 * - Minimal long form (`0x80 | N`, followed by N big-endian bytes) for lengths >= 128
 */
export function encodeLength(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new Error(`Invalid DER length: ${length}`);
  }
  if (length < 128) {
    return new Uint8Array([length]);
  }
  const octets: number[] = [];
  let rem = length;
  while (rem > 0) {
    octets.push(rem & 0xff);
    rem = Math.floor(rem / 256);
  }
  octets.reverse();
  return new Uint8Array([0x80 | octets.length, ...octets]);
}

/**
 * Encodes a signed integer into minimal big-endian two's-complement DER content octets (X.690 §8.3).
 */
export function encodeDerIntegerContent(value: number | bigint): Uint8Array {
  let v = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  if (v === 0n) {
    return new Uint8Array([0x00]);
  }
  const bytes: number[] = [];
  if (v > 0n) {
    while (v > 0n) {
      bytes.push(Number(v & 0xffn));
      v >>= 8n;
    }
    bytes.reverse();
    if ((bytes[0] ?? 0) & 0x80) {
      bytes.unshift(0x00);
    }
    return new Uint8Array(bytes);
  }
  // Negative two's-complement
  // Compute minimal byte count k such that -(2^(8k-1)) <= v
  let byteLen = 1;
  while (v < -(1n << BigInt(byteLen * 8 - 1))) {
    byteLen++;
  }
  const mod = 1n << BigInt(byteLen * 8);
  let twos = mod + v;
  for (let i = 0; i < byteLen; i++) {
    bytes.push(Number(twos & 0xffn));
    twos >>= 8n;
  }
  bytes.reverse();
  return new Uint8Array(bytes);
}

/**
 * Decodes big-endian two's-complement BER/DER INTEGER content octets into a `bigint`.
 */
export function decodeDerIntegerContent(bytes: Uint8Array): bigint {
  if (bytes.length === 0) return 0n;
  const isNegative = ((bytes[0] ?? 0) & 0x80) !== 0;
  let value = 0n;
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8n) | BigInt(bytes[i] ?? 0);
  }
  if (isNegative) {
    value -= 1n << BigInt(bytes.length * 8);
  }
  return value;
}

/**
 * Validates and parses an OID string (`"1.2.840.113549.1.1.1"`) or numeric arc array.
 */
export function parseOidArcs(oid: number[] | string): number[] {
  const arcs =
    typeof oid === "string"
      ? oid
          .trim()
          .split(".")
          .filter((s) => s.length > 0)
          .map((s) => Number(s))
      : [...oid];

  if (arcs.length < 2) {
    throw new Error("OBJECT IDENTIFIER requires at least 2 arcs.");
  }
  for (const arc of arcs) {
    if (!Number.isInteger(arc) || arc < 0) {
      throw new Error(`Invalid OID arc '${arc}': must be a non-negative integer.`);
    }
  }
  const arc0 = arcs[0]!;
  const arc1 = arcs[1]!;
  if (arc0 > 2) {
    throw new Error(`Invalid OID root arc '${arc0}': must be 0 (itu-t), 1 (iso), or 2 (joint-iso-itu-t).`);
  }
  if (arc0 < 2 && arc1 > 39) {
    throw new Error(`Invalid OID second arc '${arc1}' for root arc ${arc0}: must be <= 39.`);
  }
  return arcs;
}

/**
 * Encodes an OBJECT IDENTIFIER into X.690 content octets (without tag/length).
 */
export function encodeOidContent(oid: number[] | string): Uint8Array {
  const arcs = parseOidArcs(oid);
  const chunks: Uint8Array[] = [];
  const firstSubId = BigInt(arcs[0]!) * 40n + BigInt(arcs[1]!);
  chunks.push(encodeBase128(firstSubId));
  for (let i = 2; i < arcs.length; i++) {
    chunks.push(encodeBase128(arcs[i]!));
  }
  return concatBytes(chunks);
}

/**
 * Decodes X.690 OBJECT IDENTIFIER content octets into numeric arcs.
 */
export function decodeOidContent(bytes: Uint8Array): number[] {
  if (bytes.length === 0) return [];
  const subIds: number[] = [];
  let acc = 0;
  let inProgress = false;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    acc = acc * 128 + (b & 0x7f);
    inProgress = (b & 0x80) !== 0;
    if (!inProgress) {
      subIds.push(acc);
      acc = 0;
    }
  }
  if (subIds.length === 0) return [];
  const first = subIds[0]!;
  let arc0: number;
  let arc1: number;
  if (first < 40) {
    arc0 = 0;
    arc1 = first;
  } else if (first < 80) {
    arc0 = 1;
    arc1 = first - 40;
  } else {
    arc0 = 2;
    arc1 = first - 80;
  }
  return [arc0, arc1, ...subIds.slice(1)];
}

function wrapTlv(tagClass: Asn1TagClass, constructed: boolean, tagNumber: number, content: Uint8Array): Uint8Array {
  const tag = encodeTag(tagClass, constructed, tagNumber);
  const len = encodeLength(content.length);
  return concatBytes([tag, len, content]);
}

function compareBytesLex(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

/**
 * Encodes a structured `DerValue` into canonical ISO/ITU-T X.690 DER bytes.
 */
export function encodeDer(value: DerValue): Uint8Array {
  switch (value.kind) {
    case "boolean":
      return wrapTlv("UNIVERSAL", false, UNIVERSAL_TAGS.BOOLEAN, new Uint8Array([value.value ? 0xff : 0x00]));
    case "integer":
      return wrapTlv("UNIVERSAL", false, UNIVERSAL_TAGS.INTEGER, encodeDerIntegerContent(value.value));
    case "enumerated":
      return wrapTlv("UNIVERSAL", false, UNIVERSAL_TAGS.ENUMERATED, encodeDerIntegerContent(value.value));
    case "null":
      return wrapTlv("UNIVERSAL", false, UNIVERSAL_TAGS.NULL, new Uint8Array(0));
    case "octetString":
      return wrapTlv("UNIVERSAL", false, UNIVERSAL_TAGS.OCTET_STRING, value.value);
    case "bitString": {
      const unused = value.unusedBits ?? 0;
      if (!Number.isInteger(unused) || unused < 0 || unused > 7) {
        throw new Error(`BIT STRING unusedBits must be 0..7, got ${unused}`);
      }
      const content = new Uint8Array(1 + value.value.length);
      content[0] = unused;
      content.set(value.value, 1);
      return wrapTlv("UNIVERSAL", false, UNIVERSAL_TAGS.BIT_STRING, content);
    }
    case "oid":
      return wrapTlv("UNIVERSAL", false, UNIVERSAL_TAGS.OBJECT_IDENTIFIER, encodeOidContent(value.value));
    case "utf8String":
      return wrapTlv("UNIVERSAL", false, UNIVERSAL_TAGS.UTF8_STRING, TEXT_ENCODER.encode(value.value));
    case "ia5String":
      return wrapTlv("UNIVERSAL", false, UNIVERSAL_TAGS.IA5_STRING, TEXT_ENCODER.encode(value.value));
    case "printableString":
      return wrapTlv("UNIVERSAL", false, UNIVERSAL_TAGS.PRINTABLE_STRING, TEXT_ENCODER.encode(value.value));
    case "real": {
      // X.690 §8.5 minimal REAL encoding: 0.0 is empty content; finite non-zero uses IEEE 754 binary base-2
      if (value.value === 0 && !Object.is(value.value, -0)) {
        return wrapTlv("UNIVERSAL", false, UNIVERSAL_TAGS.REAL, new Uint8Array(0));
      }
      if (value.value === Number.POSITIVE_INFINITY) {
        return wrapTlv("UNIVERSAL", false, UNIVERSAL_TAGS.REAL, new Uint8Array([0x40]));
      }
      if (value.value === Number.NEGATIVE_INFINITY) {
        return wrapTlv("UNIVERSAL", false, UNIVERSAL_TAGS.REAL, new Uint8Array([0x41]));
      }
      if (Number.isNaN(value.value)) {
        return wrapTlv("UNIVERSAL", false, UNIVERSAL_TAGS.REAL, new Uint8Array([0x42]));
      }
      const buf = new ArrayBuffer(8);
      const view = new DataView(buf);
      view.setFloat64(0, value.value, false);
      const hi = view.getUint32(0, false);
      const lo = view.getUint32(4, false);
      const sign = (hi >>> 31) & 1;
      const rawExp = (hi >>> 20) & 0x7ff;
      let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
      let exp = rawExp - 1023 - 52;
      if (rawExp !== 0) {
        mantissa |= 1n << 52n;
      } else {
        exp = -1022 - 52;
      }
      // Normalize mantissa so it is odd (DER requirement)
      while (mantissa > 0n && (mantissa & 1n) === 0n) {
        mantissa >>= 1n;
        exp++;
      }
      const expBytes = encodeDerIntegerContent(exp);
      const mantBytes: number[] = [];
      let m = mantissa;
      while (m > 0n) {
        mantBytes.push(Number(m & 0xffn));
        m >>= 8n;
      }
      mantBytes.reverse();
      const firstOctet =
        0x80 | (sign ? 0x40 : 0x00) | (expBytes.length === 1 ? 0x00 : expBytes.length === 2 ? 0x01 : 0x02);
      const content = concatBytes([new Uint8Array([firstOctet]), expBytes, new Uint8Array(mantBytes)]);
      return wrapTlv("UNIVERSAL", false, UNIVERSAL_TAGS.REAL, content);
    }
    case "sequence": {
      const encodedItems = value.items.map((item) => encodeDer(item));
      return wrapTlv("UNIVERSAL", true, UNIVERSAL_TAGS.SEQUENCE, concatBytes(encodedItems));
    }
    case "set": {
      const encodedItems = value.items.map((item) => encodeDer(item));
      encodedItems.sort(compareBytesLex);
      return wrapTlv("UNIVERSAL", true, UNIVERSAL_TAGS.SET, concatBytes(encodedItems));
    }
    case "tagged": {
      const innerBytes = value.inner instanceof Uint8Array ? value.inner : encodeDer(value.inner);
      return wrapTlv(value.tagClass, value.constructed, value.tagNumber, innerBytes);
    }
  }
}

function decodeTlvAt(
  bytes: Uint8Array,
  offset: number,
  allIssues: DerCanonicalIssue[],
): { node: BerTlvNode; nextOffset: number } {
  if (offset >= bytes.length) {
    const issue: DerCanonicalIssue = {
      code: "ASN15005",
      offset,
      message: Asn1ErrorCode.TRUNCATED_TLV.message(`unexpected end of buffer at offset ${offset}`),
    };
    allIssues.push(issue);
    throw new Error(issue.message);
  }

  const nodeIssues: DerCanonicalIssue[] = [];
  const startOffset = offset;
  const firstTag = bytes[offset++]!;
  const tagClass = bitsToTagClass(firstTag);
  const constructed = (firstTag & 0x20) !== 0;
  let tagNumber = firstTag & 0x1f;

  if (tagNumber === 0x1f) {
    tagNumber = 0;
    let b = 0;
    let count = 0;
    do {
      if (offset >= bytes.length) {
        const issue: DerCanonicalIssue = {
          code: "ASN15005",
          offset,
          message: Asn1ErrorCode.TRUNCATED_TLV.message(`truncated high-tag-number at offset ${startOffset}`),
        };
        allIssues.push(issue);
        throw new Error(issue.message);
      }
      b = bytes[offset++]!;
      tagNumber = tagNumber * 128 + (b & 0x7f);
      count++;
      if (count > 5) {
        throw new Error(`Tag number exceeds 32-bit range at offset ${startOffset}`);
      }
    } while ((b & 0x80) !== 0);
  }
  const rawTagBytes = bytes.slice(startOffset, offset);

  if (offset >= bytes.length) {
    const issue: DerCanonicalIssue = {
      code: "ASN15005",
      offset,
      message: Asn1ErrorCode.TRUNCATED_TLV.message(`missing length octet at offset ${offset}`),
    };
    allIssues.push(issue);
    throw new Error(issue.message);
  }

  const lenStart = offset;
  const firstLen = bytes[offset++]!;
  let length = 0;
  let lengthForm: BerLengthForm = "short";
  let indefiniteEnd = -1;

  if (firstLen < 0x80) {
    length = firstLen;
    lengthForm = "short";
  } else if (firstLen === 0x80) {
    lengthForm = "indefinite";
    const issue: DerCanonicalIssue = {
      code: "ASN15001",
      offset: lenStart,
      message: Asn1ErrorCode.NON_CANONICAL_DER_LENGTH.message(
        `indefinite length (0x80) at offset ${lenStart} is forbidden in DER`,
      ),
    };
    nodeIssues.push(issue);
    allIssues.push(issue);
  } else {
    lengthForm = "long";
    const numOctets = firstLen & 0x7f;
    if (offset + numOctets > bytes.length) {
      const issue: DerCanonicalIssue = {
        code: "ASN15005",
        offset: lenStart,
        message: Asn1ErrorCode.TRUNCATED_TLV.message(
          `length field declares ${numOctets} octet(s) at offset ${lenStart}, exceeding buffer`,
        ),
      };
      allIssues.push(issue);
      throw new Error(issue.message);
    }
    const firstLenValueByte = bytes[offset]!;
    for (let i = 0; i < numOctets; i++) {
      length = length * 256 + bytes[offset++]!;
    }
    if (length < 128 || firstLenValueByte === 0x00) {
      const issue: DerCanonicalIssue = {
        code: "ASN15001",
        offset: lenStart,
        message: Asn1ErrorCode.NON_CANONICAL_DER_LENGTH.message(
          `non-minimal long-form length (${numOctets} octets for length ${length}) at offset ${lenStart}`,
        ),
      };
      nodeIssues.push(issue);
      allIssues.push(issue);
    }
  }

  const rawLengthBytes = bytes.slice(lenStart, offset);
  const valueOffset = offset;

  let children: BerTlvNode[] | undefined;
  let nextOffset: number;
  let valueBytes: Uint8Array;

  if (lengthForm === "indefinite") {
    children = [];
    let cursor = valueOffset;
    while (cursor + 1 < bytes.length && !(bytes[cursor] === 0x00 && bytes[cursor + 1] === 0x00)) {
      const childRes = decodeTlvAt(bytes, cursor, allIssues);
      children.push(childRes.node);
      cursor = childRes.nextOffset;
    }
    if (cursor + 1 >= bytes.length) {
      const issue: DerCanonicalIssue = {
        code: "ASN15005",
        offset: cursor,
        message: Asn1ErrorCode.TRUNCATED_TLV.message(
          `missing EOC (00 00) for indefinite-length TLV at offset ${startOffset}`,
        ),
      };
      allIssues.push(issue);
      throw new Error(issue.message);
    }
    indefiniteEnd = cursor;
    length = indefiniteEnd - valueOffset;
    valueBytes = bytes.slice(valueOffset, indefiniteEnd);
    nextOffset = indefiniteEnd + 2;
  } else {
    if (valueOffset + length > bytes.length) {
      const issue: DerCanonicalIssue = {
        code: "ASN15005",
        offset: valueOffset,
        message: Asn1ErrorCode.TRUNCATED_TLV.message(
          `declared content length ${length} at offset ${valueOffset} exceeds remaining ${bytes.length - valueOffset} byte(s)`,
        ),
      };
      allIssues.push(issue);
      throw new Error(issue.message);
    }
    valueBytes = bytes.slice(valueOffset, valueOffset + length);
    nextOffset = valueOffset + length;
    if (constructed) {
      children = [];
      let cursor = valueOffset;
      while (cursor < nextOffset) {
        const childRes = decodeTlvAt(bytes, cursor, allIssues);
        children.push(childRes.node);
        cursor = childRes.nextOffset;
      }
    }
  }

  // Decode primitive universal values & verify DER canonicality
  let decodedValue: unknown;
  if (tagClass === "UNIVERSAL" && !constructed) {
    switch (tagNumber) {
      case UNIVERSAL_TAGS.BOOLEAN: {
        if (valueBytes.length !== 1) {
          const issue: DerCanonicalIssue = {
            code: "ASN15002",
            offset: valueOffset,
            message: Asn1ErrorCode.NON_CANONICAL_DER_BOOLEAN.message(bytesToHex(valueBytes, "")),
          };
          nodeIssues.push(issue);
          allIssues.push(issue);
          decodedValue = valueBytes.some((b) => b !== 0);
        } else {
          const b = valueBytes[0]!;
          decodedValue = b !== 0;
          if (b !== 0x00 && b !== 0xff) {
            const issue: DerCanonicalIssue = {
              code: "ASN15002",
              offset: valueOffset,
              message: Asn1ErrorCode.NON_CANONICAL_DER_BOOLEAN.message(b.toString(16).padStart(2, "0").toUpperCase()),
            };
            nodeIssues.push(issue);
            allIssues.push(issue);
          }
        }
        break;
      }
      case UNIVERSAL_TAGS.INTEGER:
      case UNIVERSAL_TAGS.ENUMERATED: {
        if (valueBytes.length === 0) {
          const issue: DerCanonicalIssue = {
            code: "ASN15003",
            offset: valueOffset,
            message: Asn1ErrorCode.NON_CANONICAL_DER_INTEGER.message("empty INTEGER content"),
          };
          nodeIssues.push(issue);
          allIssues.push(issue);
          decodedValue = 0n;
        } else {
          if (valueBytes.length > 1) {
            const b0 = valueBytes[0]!;
            const b1 = valueBytes[1]!;
            if ((b0 === 0x00 && (b1 & 0x80) === 0) || (b0 === 0xff && (b1 & 0x80) !== 0)) {
              const issue: DerCanonicalIssue = {
                code: "ASN15003",
                offset: valueOffset,
                message: Asn1ErrorCode.NON_CANONICAL_DER_INTEGER.message(
                  `redundant leading sign octet 0x${b0.toString(16).padStart(2, "0").toUpperCase()} at offset ${valueOffset}`,
                ),
              };
              nodeIssues.push(issue);
              allIssues.push(issue);
            }
          }
          decodedValue = decodeDerIntegerContent(valueBytes);
        }
        break;
      }
      case UNIVERSAL_TAGS.NULL:
        decodedValue = null;
        break;
      case UNIVERSAL_TAGS.OBJECT_IDENTIFIER: {
        const arcs = decodeOidContent(valueBytes);
        decodedValue = arcs.join(".");
        if (arcs.length < 2 || arcs[0]! > 2 || (arcs[0]! < 2 && arcs[1]! > 39)) {
          const issue: DerCanonicalIssue = {
            code: "ASN15004",
            offset: valueOffset,
            message: Asn1ErrorCode.INVALID_OID_ARCS.message(`decoded arcs '${decodedValue}' violate X.690 §8.19`),
          };
          nodeIssues.push(issue);
          allIssues.push(issue);
        }
        break;
      }
      case UNIVERSAL_TAGS.UTF8_STRING:
      case UNIVERSAL_TAGS.IA5_STRING:
      case UNIVERSAL_TAGS.PRINTABLE_STRING:
      case UNIVERSAL_TAGS.VISIBLE_STRING:
      case UNIVERSAL_TAGS.NUMERIC_STRING:
      case UNIVERSAL_TAGS.UTC_TIME:
      case UNIVERSAL_TAGS.GENERALIZED_TIME:
        decodedValue = TEXT_DECODER.decode(valueBytes);
        break;
      case UNIVERSAL_TAGS.OCTET_STRING:
        decodedValue = bytesToHex(valueBytes);
        break;
      case UNIVERSAL_TAGS.BIT_STRING:
        decodedValue = {
          unusedBits: valueBytes.length > 0 ? valueBytes[0]! : 0,
          hex: bytesToHex(valueBytes.slice(1)),
        };
        break;
      default:
        decodedValue = bytesToHex(valueBytes);
        break;
    }
  }

  const node: BerTlvNode = {
    tagClass,
    constructed,
    tagNumber,
    tagByte: firstTag,
    rawTagBytes,
    length,
    lengthForm,
    rawLengthBytes,
    offset: startOffset,
    valueOffset,
    valueBytes,
    totalLength: nextOffset - startOffset,
    children,
    decodedValue,
    derIssues: nodeIssues,
  };

  return { node, nextOffset };
}

/**
 * Decodes a BER/DER byte buffer into a structured TLV tree with DER canonicality diagnostics.
 */
export function decodeBer(bytes: Uint8Array, offset = 0): BerDecodeResult {
  const derIssues: DerCanonicalIssue[] = [];
  if (bytes.length === 0 || offset >= bytes.length) {
    const issue: DerCanonicalIssue = {
      code: "ASN15005",
      offset,
      message: Asn1ErrorCode.TRUNCATED_TLV.message("empty BER/DER input buffer"),
    };
    return { root: null, derIssues: [issue], trailingBytes: 0, error: issue.message };
  }
  try {
    const { node, nextOffset } = decodeTlvAt(bytes, offset, derIssues);
    const trailingBytes = Math.max(0, bytes.length - nextOffset);
    if (trailingBytes > 0) {
      derIssues.push({
        code: "ASN15006",
        offset: nextOffset,
        message: Asn1ErrorCode.TRAILING_TLV_BYTES.message(String(trailingBytes)),
      });
    }
    return { root: node, derIssues, trailingBytes };
  } catch (err) {
    return {
      root: null,
      derIssues,
      trailingBytes: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Inspects a BER/DER buffer and returns all X.690 DER canonicality issues.
 */
export function inspectDerCanonical(bytes: Uint8Array): DerCanonicalIssue[] {
  return decodeBer(bytes).derIssues;
}

/**
 * Human-readable label for a BER/DER TLV tag (e.g., `UNIVERSAL SEQUENCE`, `[0] CONTEXT`).
 */
export function formatBerTagName(node: BerTlvNode): string {
  if (node.tagClass === "UNIVERSAL") {
    switch (node.tagNumber) {
      case UNIVERSAL_TAGS.BOOLEAN:
        return "BOOLEAN";
      case UNIVERSAL_TAGS.INTEGER:
        return "INTEGER";
      case UNIVERSAL_TAGS.BIT_STRING:
        return "BIT STRING";
      case UNIVERSAL_TAGS.OCTET_STRING:
        return "OCTET STRING";
      case UNIVERSAL_TAGS.NULL:
        return "NULL";
      case UNIVERSAL_TAGS.OBJECT_IDENTIFIER:
        return "OBJECT IDENTIFIER";
      case UNIVERSAL_TAGS.REAL:
        return "REAL";
      case UNIVERSAL_TAGS.ENUMERATED:
        return "ENUMERATED";
      case UNIVERSAL_TAGS.UTF8_STRING:
        return "UTF8String";
      case UNIVERSAL_TAGS.SEQUENCE:
        return "SEQUENCE";
      case UNIVERSAL_TAGS.SET:
        return "SET";
      case UNIVERSAL_TAGS.PRINTABLE_STRING:
        return "PrintableString";
      case UNIVERSAL_TAGS.IA5_STRING:
        return "IA5String";
      case UNIVERSAL_TAGS.UTC_TIME:
        return "UTCTime";
      case UNIVERSAL_TAGS.GENERALIZED_TIME:
        return "GeneralizedTime";
      default:
        return `UNIVERSAL ${node.tagNumber}`;
    }
  }
  return `[${node.tagClass === "CONTEXT" ? "" : `${node.tagClass} `}${node.tagNumber}]`;
}
