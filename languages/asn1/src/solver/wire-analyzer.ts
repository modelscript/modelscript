// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ASN.1 Type Dependency Graph, BER/DER Wire-Size Bounds Calculator, and Canonical DER Round-Trip Verifier.
 */

import {
  bytesToHex,
  decodeBer,
  decodeDerIntegerContent,
  decodeOidContent,
  encodeDer,
  encodeLength,
  encodeTag,
} from "../parser/ber-der.js";
import {
  UNIVERSAL_TAGS,
  type Asn1Module,
  type Asn1TypeExpr,
  type BerTlvNode,
  type DerCanonicalIssue,
  type DerValue,
} from "../types.js";

export interface Asn1TypeGraphEdge {
  from: string;
  to: string;
  fieldName?: string | undefined;
  optional: boolean;
}

export interface Asn1TypeGraph {
  nodes: string[];
  edges: Asn1TypeGraphEdge[];
  nonOptionalCycles: string[][];
  topologicalOrder: string[];
}

export interface WireSizeBounds {
  typeName: string;
  minBytes: number;
  maxBytes: number;
  isUnbounded: boolean;
  minTlvOverhead: number;
  maxTlvOverhead: number;
}

export interface DerRoundTripResult {
  encoded: Uint8Array;
  hex: string;
  reencoded: Uint8Array;
  exactMatch: boolean;
  relErr: number;
  rmse: number;
  canonicalDer: boolean;
  derIssues: DerCanonicalIssue[];
  decodedRoot: BerTlvNode | null;
}

function collectTypeRefs(
  expr: Asn1TypeExpr,
  optional: boolean,
  fieldName: string | undefined,
  out: Asn1TypeGraphEdge[],
  from: string,
): void {
  switch (expr.kind) {
    case "reference":
      out.push({ from, to: expr.name, fieldName, optional });
      break;
    case "tagged":
      collectTypeRefs(expr.inner, optional, fieldName, out, from);
      break;
    case "sequence":
    case "set":
      for (const f of expr.fields) {
        collectTypeRefs(f.type, optional || f.optional, f.name, out, from);
      }
      break;
    case "choice":
      // In a CHOICE, any individual alternative is optional unless all alternatives cycle
      for (const alt of expr.alternatives) {
        collectTypeRefs(alt.type, true, alt.name, out, from);
      }
      break;
    case "sequenceOf":
    case "setOf": {
      const minCount = expr.constraint?.kind === "size" ? (expr.constraint.min ?? 0) : 0;
      collectTypeRefs(expr.elementType, optional || minCount === 0, fieldName, out, from);
      break;
    }
    case "primitive":
    case "enumerated":
      break;
  }
}

/**
 * Builds the directed type dependency graph for an ASN.1 module, detects non-optional cycles,
 * and computes a topological ordering of types.
 */
export function buildAsn1TypeGraph(module: Asn1Module): Asn1TypeGraph {
  const nodes: string[] = [];
  const nodeSet = new Set<string>();
  const edges: Asn1TypeGraphEdge[] = [];

  for (const t of module.types) {
    if (!nodeSet.has(t.name)) {
      nodeSet.add(t.name);
      nodes.push(t.name);
    }
    collectTypeRefs(t.type, false, undefined, edges, t.name);
  }

  // Detect cycles on non-optional edges using DFS
  const reqAdj = new Map<string, string[]>();
  for (const n of nodes) reqAdj.set(n, []);
  for (const e of edges) {
    if (!e.optional && nodeSet.has(e.to)) {
      reqAdj.get(e.from)?.push(e.to);
    }
  }

  const state = new Map<string, 0 | 1 | 2>(); // 0=unvisited, 1=visiting, 2=done
  const stack: string[] = [];
  const nonOptionalCycles: string[][] = [];
  const seenCycles = new Set<string>();

  function dfs(u: string): void {
    state.set(u, 1);
    stack.push(u);
    for (const v of reqAdj.get(u) ?? []) {
      const st = state.get(v) ?? 0;
      if (st === 1) {
        const idx = stack.indexOf(v);
        if (idx >= 0) {
          const cycle = [...stack.slice(idx), v];
          const key = cycle.join("->");
          if (!seenCycles.has(key)) {
            seenCycles.add(key);
            nonOptionalCycles.push(cycle);
          }
        }
      } else if (st === 0) {
        dfs(v);
      }
    }
    stack.pop();
    state.set(u, 2);
  }

  for (const n of nodes) {
    if ((state.get(n) ?? 0) === 0) {
      dfs(n);
    }
  }

  // Topological order (dependencies first) using Kahn's algorithm on all internal edges
  const inDegree = new Map<string, number>();
  const revAdj = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n, 0);
    revAdj.set(n, []);
  }
  const uniqueEdges = new Set<string>();
  for (const e of edges) {
    if (nodeSet.has(e.to) && e.from !== e.to) {
      const k = `${e.from}->${e.to}`;
      if (!uniqueEdges.has(k)) {
        uniqueEdges.add(k);
        inDegree.set(e.from, (inDegree.get(e.from) ?? 0) + 1);
        revAdj.get(e.to)?.push(e.from);
      }
    }
  }

  const queue: string[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n) ?? 0) === 0) queue.push(n);
  }
  const topologicalOrder: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    topologicalOrder.push(cur);
    for (const parent of revAdj.get(cur) ?? []) {
      const nextDeg = (inDegree.get(parent) ?? 1) - 1;
      inDegree.set(parent, nextDeg);
      if (nextDeg === 0) queue.push(parent);
    }
  }
  for (const n of nodes) {
    if (!topologicalOrder.includes(n)) topologicalOrder.push(n);
  }

  return { nodes, edges, nonOptionalCycles, topologicalOrder };
}

function derLengthHeaderSize(contentBytes: number): number {
  if (!Number.isFinite(contentBytes)) return 5;
  return encodeLength(Math.max(0, Math.trunc(contentBytes))).length;
}

function signedIntByteWidth(val: number): number {
  const v = Math.trunc(val);
  if (v >= -128 && v <= 127) return 1;
  if (v >= -32768 && v <= 32767) return 2;
  if (v >= -8388608 && v <= 8388607) return 3;
  if (v >= -2147483648 && v <= 2147483647) return 4;
  return 8;
}

interface InternalBounds {
  minBytes: number;
  maxBytes: number;
  isUnbounded: boolean;
  minOverhead: number;
  maxOverhead: number;
}

function computeExprBounds(
  expr: Asn1TypeExpr,
  typeMap: Map<string, Asn1TypeExpr>,
  visiting: Set<string>,
  defaultUnboundedMax: number,
): InternalBounds {
  switch (expr.kind) {
    case "primitive": {
      switch (expr.primitive) {
        case "BOOLEAN":
          // Tag(1) + Len(1) + Val(1) = 3
          return { minBytes: 3, maxBytes: 3, isUnbounded: false, minOverhead: 2, maxOverhead: 2 };
        case "NULL":
          // Tag(1) + Len(1) = 2
          return { minBytes: 2, maxBytes: 2, isUnbounded: false, minOverhead: 2, maxOverhead: 2 };
        case "INTEGER": {
          if (expr.constraint && (expr.constraint.kind === "range" || expr.constraint.kind === "singleValue")) {
            const lo = expr.constraint.min;
            const hi = expr.constraint.max;
            if (lo !== undefined && hi !== undefined) {
              const wLo = signedIntByteWidth(lo);
              const wHi = signedIntByteWidth(hi);
              const minV = lo <= 0 && hi >= 0 ? 1 : Math.min(wLo, wHi);
              const maxV = Math.max(wLo, wHi);
              return { minBytes: 2 + minV, maxBytes: 2 + maxV, isUnbounded: false, minOverhead: 2, maxOverhead: 2 };
            }
          }
          // Default 64-bit integer ceiling if unconstrained
          return { minBytes: 3, maxBytes: 10, isUnbounded: true, minOverhead: 2, maxOverhead: 2 };
        }
        case "REAL":
          return { minBytes: 2, maxBytes: 12, isUnbounded: false, minOverhead: 2, maxOverhead: 2 };
        case "OBJECT IDENTIFIER":
          return { minBytes: 3, maxBytes: 64, isUnbounded: true, minOverhead: 2, maxOverhead: 2 };
        case "BIT STRING": {
          const minBits = expr.constraint?.kind === "size" ? Math.max(0, expr.constraint.min ?? 0) : 0;
          const maxBits =
            expr.constraint?.kind === "size" && expr.constraint.max !== undefined
              ? Math.max(0, expr.constraint.max)
              : undefined;
          const minV = 1 + Math.ceil(minBits / 8);
          const maxV = maxBits !== undefined ? 1 + Math.ceil(maxBits / 8) : 1 + defaultUnboundedMax;
          const minOv = 1 + derLengthHeaderSize(minV);
          const maxOv = 1 + derLengthHeaderSize(maxV);
          return {
            minBytes: minOv + minV,
            maxBytes: maxOv + maxV,
            isUnbounded: maxBits === undefined,
            minOverhead: minOv,
            maxOverhead: maxOv,
          };
        }
        case "UTCTime":
          return { minBytes: 13, maxBytes: 19, isUnbounded: false, minOverhead: 2, maxOverhead: 2 };
        case "GeneralizedTime":
          return { minBytes: 17, maxBytes: 25, isUnbounded: false, minOverhead: 2, maxOverhead: 2 };
        case "OCTET STRING":
        case "UTF8String":
        case "IA5String":
        case "PrintableString":
        case "VisibleString":
        case "NumericString": {
          const mult = expr.primitive === "UTF8String" ? 4 : 1;
          const minLen = expr.constraint?.kind === "size" ? Math.max(0, expr.constraint.min ?? 0) : 0;
          const maxLen =
            expr.constraint?.kind === "size" && expr.constraint.max !== undefined
              ? Math.max(0, expr.constraint.max) * mult
              : undefined;
          const resolvedMax = maxLen ?? defaultUnboundedMax;
          const minOv = 1 + derLengthHeaderSize(minLen);
          const maxOv = 1 + derLengthHeaderSize(resolvedMax);
          return {
            minBytes: minOv + minLen,
            maxBytes: maxOv + resolvedMax,
            isUnbounded: maxLen === undefined,
            minOverhead: minOv,
            maxOverhead: maxOv,
          };
        }
      }
      break;
    }
    case "enumerated": {
      let maxW = 1;
      for (const item of expr.items) {
        maxW = Math.max(maxW, signedIntByteWidth(item.value));
      }
      return { minBytes: 3, maxBytes: 2 + maxW, isUnbounded: false, minOverhead: 2, maxOverhead: 2 };
    }
    case "tagged": {
      const inner = computeExprBounds(expr.inner, typeMap, visiting, defaultUnboundedMax);
      const tagLen = encodeTag(expr.tag.tagClass, true, expr.tag.number).length;
      if (expr.tag.mode === "IMPLICIT") {
        // Replaces inner tag byte (assumed 1 byte universal) with explicit tag bytes
        const delta = Math.max(0, tagLen - 1);
        return {
          minBytes: inner.minBytes + delta,
          maxBytes: inner.maxBytes + delta,
          isUnbounded: inner.isUnbounded,
          minOverhead: inner.minOverhead + delta,
          maxOverhead: inner.maxOverhead + delta,
        };
      }
      // EXPLICIT wraps inner TLV in outer TLV
      const minOuterOv = tagLen + derLengthHeaderSize(inner.minBytes);
      const maxOuterOv = tagLen + derLengthHeaderSize(inner.maxBytes);
      return {
        minBytes: minOuterOv + inner.minBytes,
        maxBytes: maxOuterOv + inner.maxBytes,
        isUnbounded: inner.isUnbounded,
        minOverhead: inner.minOverhead + minOuterOv,
        maxOverhead: inner.maxOverhead + maxOuterOv,
      };
    }
    case "sequence":
    case "set": {
      let minContent = 0;
      let maxContent = 0;
      let minChildOv = 0;
      let maxChildOv = 0;
      let unbounded = false;
      for (const f of expr.fields) {
        let fb = computeExprBounds(f.type, typeMap, visiting, defaultUnboundedMax);
        if (f.tag) {
          const tagLen = encodeTag(f.tag.tagClass, true, f.tag.number).length;
          if (f.tag.mode !== "IMPLICIT") {
            const minO = tagLen + derLengthHeaderSize(fb.minBytes);
            const maxO = tagLen + derLengthHeaderSize(fb.maxBytes);
            fb = {
              minBytes: fb.minBytes + minO,
              maxBytes: fb.maxBytes + maxO,
              isUnbounded: fb.isUnbounded,
              minOverhead: fb.minOverhead + minO,
              maxOverhead: fb.maxOverhead + maxO,
            };
          }
        }
        if (!f.optional) {
          minContent += fb.minBytes;
          minChildOv += fb.minOverhead;
        }
        maxContent += fb.maxBytes;
        maxChildOv += fb.maxOverhead;
        if (fb.isUnbounded) unbounded = true;
      }
      const minOuter = 1 + derLengthHeaderSize(minContent);
      const maxOuter = 1 + derLengthHeaderSize(maxContent);
      return {
        minBytes: minOuter + minContent,
        maxBytes: maxOuter + maxContent,
        isUnbounded: unbounded,
        minOverhead: minOuter + minChildOv,
        maxOverhead: maxOuter + maxChildOv,
      };
    }
    case "choice": {
      if (expr.alternatives.length === 0) {
        return { minBytes: 0, maxBytes: 0, isUnbounded: false, minOverhead: 0, maxOverhead: 0 };
      }
      let minBytes = Number.POSITIVE_INFINITY;
      let maxBytes = 0;
      let minOverhead = Number.POSITIVE_INFINITY;
      let maxOverhead = 0;
      let unbounded = false;
      for (const alt of expr.alternatives) {
        const ab = computeExprBounds(alt.type, typeMap, visiting, defaultUnboundedMax);
        minBytes = Math.min(minBytes, ab.minBytes);
        maxBytes = Math.max(maxBytes, ab.maxBytes);
        minOverhead = Math.min(minOverhead, ab.minOverhead);
        maxOverhead = Math.max(maxOverhead, ab.maxOverhead);
        if (ab.isUnbounded) unbounded = true;
      }
      return {
        minBytes: Number.isFinite(minBytes) ? minBytes : 0,
        maxBytes,
        isUnbounded: unbounded,
        minOverhead: Number.isFinite(minOverhead) ? minOverhead : 0,
        maxOverhead,
      };
    }
    case "sequenceOf":
    case "setOf": {
      const elem = computeExprBounds(expr.elementType, typeMap, visiting, defaultUnboundedMax);
      const minCount = expr.constraint?.kind === "size" ? Math.max(0, expr.constraint.min ?? 0) : 0;
      const maxCount =
        expr.constraint?.kind === "size" && expr.constraint.max !== undefined
          ? Math.max(0, expr.constraint.max)
          : undefined;
      const resolvedMaxCount = maxCount ?? 8;
      const minContent = minCount * elem.minBytes;
      const maxContent = resolvedMaxCount * elem.maxBytes;
      const minOuter = 1 + derLengthHeaderSize(minContent);
      const maxOuter = 1 + derLengthHeaderSize(maxContent);
      return {
        minBytes: minOuter + minContent,
        maxBytes: maxOuter + maxContent,
        isUnbounded: maxCount === undefined || elem.isUnbounded,
        minOverhead: minOuter + minCount * elem.minOverhead,
        maxOverhead: maxOuter + resolvedMaxCount * elem.maxOverhead,
      };
    }
    case "reference": {
      if (visiting.has(expr.name)) {
        return { minBytes: 2, maxBytes: defaultUnboundedMax, isUnbounded: true, minOverhead: 2, maxOverhead: 2 };
      }
      const target = typeMap.get(expr.name);
      if (!target) {
        return { minBytes: 2, maxBytes: defaultUnboundedMax, isUnbounded: true, minOverhead: 2, maxOverhead: 2 };
      }
      visiting.add(expr.name);
      const res = computeExprBounds(target, typeMap, visiting, defaultUnboundedMax);
      visiting.delete(expr.name);
      return res;
    }
  }
}

/**
 * Computes BER/DER encoded wire-size byte bounds (min, max, TLV overhead) for every type in an ASN.1 module.
 */
export function computeWireSizeBounds(module: Asn1Module, defaultUnboundedMax = 64): Map<string, WireSizeBounds> {
  const typeMap = new Map<string, Asn1TypeExpr>();
  for (const t of module.types) {
    typeMap.set(t.name, t.type);
  }
  const results = new Map<string, WireSizeBounds>();
  for (const t of module.types) {
    const visiting = new Set<string>([t.name]);
    const b = computeExprBounds(t.type, typeMap, visiting, defaultUnboundedMax);
    results.set(t.name, {
      typeName: t.name,
      minBytes: b.minBytes,
      maxBytes: b.maxBytes,
      isUnbounded: b.isUnbounded,
      minTlvOverhead: b.minOverhead,
      maxTlvOverhead: b.maxOverhead,
    });
  }
  return results;
}

function tlvNodeToDerValue(node: BerTlvNode): DerValue {
  if (node.tagClass === "UNIVERSAL") {
    if (node.constructed && node.tagNumber === UNIVERSAL_TAGS.SEQUENCE) {
      return { kind: "sequence", items: (node.children ?? []).map(tlvNodeToDerValue) };
    }
    if (node.constructed && node.tagNumber === UNIVERSAL_TAGS.SET) {
      return { kind: "set", items: (node.children ?? []).map(tlvNodeToDerValue) };
    }
    switch (node.tagNumber) {
      case UNIVERSAL_TAGS.BOOLEAN:
        return { kind: "boolean", value: Boolean(node.decodedValue) };
      case UNIVERSAL_TAGS.INTEGER:
        return { kind: "integer", value: decodeDerIntegerContent(node.valueBytes) };
      case UNIVERSAL_TAGS.ENUMERATED:
        return { kind: "enumerated", value: decodeDerIntegerContent(node.valueBytes) };
      case UNIVERSAL_TAGS.NULL:
        return { kind: "null" };
      case UNIVERSAL_TAGS.OCTET_STRING:
        return { kind: "octetString", value: node.valueBytes };
      case UNIVERSAL_TAGS.BIT_STRING:
        return {
          kind: "bitString",
          unusedBits: node.valueBytes[0] ?? 0,
          value: node.valueBytes.slice(1),
        };
      case UNIVERSAL_TAGS.OBJECT_IDENTIFIER:
        return { kind: "oid", value: decodeOidContent(node.valueBytes) };
      case UNIVERSAL_TAGS.UTF8_STRING:
        return { kind: "utf8String", value: String(node.decodedValue ?? "") };
      case UNIVERSAL_TAGS.IA5_STRING:
        return { kind: "ia5String", value: String(node.decodedValue ?? "") };
      case UNIVERSAL_TAGS.PRINTABLE_STRING:
        return { kind: "printableString", value: String(node.decodedValue ?? "") };
      default:
        return {
          kind: "tagged",
          tagClass: node.tagClass,
          tagNumber: node.tagNumber,
          constructed: node.constructed,
          inner: node.valueBytes,
        };
    }
  }
  if (node.constructed && node.children && node.children.length === 1) {
    return {
      kind: "tagged",
      tagClass: node.tagClass,
      tagNumber: node.tagNumber,
      constructed: true,
      inner: tlvNodeToDerValue(node.children[0]!),
    };
  }
  return {
    kind: "tagged",
    tagClass: node.tagClass,
    tagNumber: node.tagNumber,
    constructed: node.constructed,
    inner: node.valueBytes,
  };
}

/**
 * Verifies canonical X.690 DER round-trip fidelity: `encodeDer` -> `decodeBer` -> `encodeDer`.
 * Returns exact byte-wise `relErr` and `rmse` (both `0` on exact parity).
 */
export function verifyDerRoundTrip(value: DerValue): DerRoundTripResult {
  const encoded = encodeDer(value);
  const decoded = decodeBer(encoded);
  const reencoded = decoded.root ? encodeDer(tlvNodeToDerValue(decoded.root)) : new Uint8Array(0);

  const maxLen = Math.max(encoded.length, reencoded.length);
  let sumSq = 0;
  let sumRefSq = 0;
  let exactMatch = encoded.length === reencoded.length;
  for (let i = 0; i < maxLen; i++) {
    const a = encoded[i] ?? 0;
    const b = reencoded[i] ?? 0;
    if (a !== b) exactMatch = false;
    const diff = a - b;
    sumSq += diff * diff;
    sumRefSq += a * a;
  }
  const rmse = maxLen > 0 ? Math.sqrt(sumSq / maxLen) : 0;
  const relErr = sumRefSq > 0 ? Math.sqrt(sumSq / sumRefSq) : exactMatch ? 0 : 1;

  return {
    encoded,
    hex: bytesToHex(encoded),
    reencoded,
    exactMatch,
    relErr,
    rmse,
    canonicalDer: decoded.derIssues.length === 0 && decoded.error === undefined,
    derIssues: decoded.derIssues,
    decodedRoot: decoded.root,
  };
}
