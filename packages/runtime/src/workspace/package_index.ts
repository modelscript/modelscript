// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Relocatable Segmented Columnar Binary Package Index (.msidx v1).
 *
 * Replaces fragile SQLite/JSON Salsa dumps with a zero-dependency, ABI-versioned,
 * columnar binary format that supports:
 *  - Zero-collision mounting via contiguous baseSequence rebasing (preserving LanguageDomainId bits)
 *  - Package-relative resourceId normalization
 *  - O(log N) exact/prefix name lookup, O(log N) FQN hash lookup, O(1) CSR childrenOf
 *  - Lazy byte-range loading of per-subpackage semantic summary chunks (disk fs.read or HTTP Range)
 */

import {
  getLanguageDomainId,
  getLocalSymbolSeq,
  getSymbolDomain,
  makePolyglotSymbolId,
  type SymbolEntry,
  type SymbolId,
  type SymbolIndex,
} from "../runtime.js";

// ---------------------------------------------------------------------------
// Constants & Error Types
// ---------------------------------------------------------------------------

/** ASCII "MSIX" in little-endian u32. */
export const MSIDX_MAGIC = 0x5849534d;
export const MSIDX_FORMAT_VERSION = 1;
export const MSIDX_COMPILER_ABI_VERSION = 1;
export const MSIDX_HEADER_SIZE = 64;

export const MSIDX_FLAG_HAS_SUMMARIES = 1 << 1;
export const MSIDX_FLAG_HAS_MERKLE = 1 << 2;

export type PackageIndexErrorCode =
  "INVALID_MAGIC" | "UNSUPPORTED_FORMAT_VERSION" | "ABI_MISMATCH" | "TRUNCATED" | "CORRUPT";

export class PackageIndexError extends Error {
  public readonly code: PackageIndexErrorCode;

  constructor(code: PackageIndexErrorCode, message: string) {
    super(message);
    this.name = "PackageIndexError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

export interface PackageIndexHeader {
  magic: number;
  formatVersion: number;
  compilerAbiVersion: number;
  flags: number;
  symbolCount: number;
  contentHashHex: string;
  stringPoolOffset: number;
  stringPoolLength: number;
  symbolTableOffset: number;
  symbolTableLength: number;
  lookupIndexOffset: number;
  lookupIndexLength: number;
  summaryTocOffset: number;
  summaryTocLength: number;
}

export interface PackageSemanticSummary {
  /** Local symbol ID (0..N-1) within the package index, or -1 if FQN-only. */
  localId: number;
  /** Fully-qualified symbol name (e.g., "Modelica.Electrical.Analog.Basic.Resistor"). */
  fqn: string;
  classKind?: string | undefined;
  isConnector?: boolean | undefined;
  isPartial?: boolean | undefined;
  isEncapsulated?: boolean | undefined;
  isFunction?: boolean | undefined;
  extendsFqns?: string[] | undefined;
  docSummary?: string | undefined;
  extra?: Record<string, unknown> | undefined;
}

export interface PackageSummaryTocEntry {
  prefix: string;
  byteOffset: number;
  byteLength: number;
  symbolCount: number;
}

export interface PackageIndexEncodeOptions {
  /** Root directory of the package on disk (used to strip absolute path prefixes & exclude external deps). */
  libraryPath?: string | undefined;
  /** Optional pure-data semantic summaries, grouped automatically into lazy chunks by prefix. */
  summaries?: PackageSemanticSummary[] | undefined;
  /** Include 64-bit Merkle hash columns if present on symbols (default: true). */
  includeMerkle?: boolean | undefined;
}

export interface PackageIndexMountOptions {
  /** Maps a package-relative POSIX path (e.g. "Blocks/Continuous.mo") to a workspace/VFS resourceId. */
  resolveResourceUri?: ((relPath: string) => string) | undefined;
  /** Existing SymbolIndex to merge into. If omitted, a fresh SymbolIndex is created. */
  targetIndex?: SymbolIndex | undefined;
  /** Explicit starting local sequence number for rebasing. Auto-computed from targetIndex if omitted. */
  baseSequence?: number | undefined;
  /** When true, recomputes the 64-bit contentHash and throws PackageIndexError("CORRUPT") on mismatch. */
  verifyHash?: boolean | undefined;
}

export interface PackageIndexInspection {
  header: PackageIndexHeader;
  byteLength: number;
  stringCount: number;
  domainCounts: Record<number, number>;
  summaryChunks: PackageSummaryTocEntry[];
}

export interface MountedPackageIndex {
  index: SymbolIndex;
  symbolCount: number;
  baseSequence: number;
  header: PackageIndexHeader;
  /** Maps localId (0..N-1) -> rebased global SymbolId. */
  localToGlobalId: Uint32Array;
}

export interface ByteRangeSource {
  readRange(offset: number, length: number): Promise<Uint8Array>;
}

/** In-memory ByteRangeSource backed by a Uint8Array / ArrayBuffer. */
export class BufferByteRangeSource implements ByteRangeSource {
  private readonly bytes: Uint8Array;

  constructor(data: Uint8Array | ArrayBuffer) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  }

  async readRange(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || length < 0 || offset + length > this.bytes.byteLength) {
      throw new PackageIndexError(
        "TRUNCATED",
        `Out-of-bounds range read: offset=${offset}, length=${length}, size=${this.bytes.byteLength}`,
      );
    }
    return this.bytes.subarray(offset, offset + length);
  }
}

/** Browser/Node fetch ByteRangeSource using HTTP Range requests with automatic full-body fallback. */
export class HttpByteRangeSource implements ByteRangeSource {
  private fullBuffer: Uint8Array | null = null;
  private readonly url: string;
  private readonly headers: Record<string, string>;

  constructor(url: string, headers?: Record<string, string>) {
    this.url = url;
    this.headers = headers ? { ...headers } : {};
  }

  async readRange(offset: number, length: number): Promise<Uint8Array> {
    if (length === 0) return new Uint8Array(0);
    if (this.fullBuffer) {
      return this.fullBuffer.subarray(offset, offset + length);
    }
    const end = offset + length - 1;
    const resp = await fetch(this.url, {
      headers: {
        ...this.headers,
        Range: `bytes=${offset}-${end}`,
      },
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} fetching range ${offset}-${end} from ${this.url}`);
    }
    const data = new Uint8Array(await resp.arrayBuffer());
    if (resp.status === 206) {
      return data;
    }
    // Server ignored Range header and returned full file (200 OK) — cache it for subsequent reads
    this.fullBuffer = data;
    return this.fullBuffer.subarray(offset, offset + length);
  }
}

// ---------------------------------------------------------------------------
// Internal Helpers: Hashing, Alignment, UTF-8, Filtering
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function align4(n: number): number {
  return (n + 3) & ~3;
}

/** Deterministic 64-bit FNV-1a hash split into (lo32, hi32). */
function fnv1a64String(str: string): { lo: number; hi: number } {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= ch + (h1 >>> 16);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return { lo: h1 >>> 0, hi: h2 >>> 0 };
}

function fnv1a64Bytes(chunks: Uint8Array[], abiVersion: number): { lo: number; hi: number } {
  let h1 = (0x811c9dc5 ^ abiVersion) >>> 0;
  let h2 = 0x9e3779b9;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i]!;
      h1 ^= b;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= b + (h1 >>> 16);
      h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
    }
  }
  return { lo: h1 >>> 0, hi: h2 >>> 0 };
}

function compareU64(aHi: number, aLo: number, bHi: number, bLo: number): number {
  if (aHi !== bHi) return aHi < bHi ? -1 : 1;
  if (aLo !== bLo) return aLo < bLo ? -1 : 1;
  return 0;
}

function formatHex64(hi: number, lo: number): string {
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

function baseNamePosix(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/**
 * Filters out hydrated external dependency symbols and normalizes `resourceId`
 * to a package-relative POSIX path. Shared between `.msidx` and `lsp-bundle.zip`.
 */
export function filterAndNormalizePackageSymbols(
  index: SymbolIndex,
  libraryPath?: string,
): Array<{ id: SymbolId; entry: SymbolEntry; relPath: string | undefined }> {
  const normLibPath = libraryPath ? libraryPath.replace(/\\/g, "/").replace(/\/?$/, "/") : null;
  const result: Array<{ id: SymbolId; entry: SymbolEntry; relPath: string | undefined }> = [];

  for (const [id, entry] of index.symbols.entries()) {
    const rawRes = entry.resourceId || "";
    const posixRes = rawRes.replace(/\\/g, "/");
    const base = baseNamePosix(posixRes);

    if (posixRes.startsWith("dep-bundle:/") || (base.startsWith("modelscript-") && posixRes.endsWith(".mo"))) {
      continue;
    }

    let relPath: string | undefined = posixRes || undefined;
    if (normLibPath && posixRes) {
      const cleanPath = posixRes.replace(/^[a-z0-9+-]+:\/\//i, "");
      if (cleanPath.startsWith(normLibPath)) {
        relPath = cleanPath.substring(normLibPath.length);
      } else if (cleanPath.startsWith("/") || /^[a-zA-Z]:\//.test(cleanPath)) {
        // Absolute path belonging to an external hydrated dependency library
        continue;
      } else if (posixRes.startsWith("sources/")) {
        relPath = posixRes.substring("sources/".length);
      }
    } else if (posixRes.startsWith("sources/")) {
      relPath = posixRes.substring("sources/".length);
    }

    result.push({ id, entry, relPath });
  }

  return result;
}

class StringPoolBuilder {
  private readonly map = new Map<string, number>();
  private readonly strings: string[] = [];

  intern(s: string): number {
    let idx = this.map.get(s);
    if (idx === undefined) {
      idx = this.strings.length;
      this.map.set(s, idx);
      this.strings.push(s);
    }
    return idx;
  }

  getStrings(): string[] {
    return this.strings;
  }

  encode(): Uint8Array {
    const count = this.strings.length;
    const encodedParts: Uint8Array[] = new Array(count);
    let totalUtf8 = 0;
    for (let i = 0; i < count; i++) {
      const bytes = textEncoder.encode(this.strings[i]!);
      encodedParts[i] = bytes;
      totalUtf8 += bytes.byteLength;
    }

    const headerBytes = 4 + (count + 1) * 4;
    const totalBytes = align4(headerBytes + totalUtf8);
    const out = new Uint8Array(totalBytes);
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);

    dv.setUint32(0, count, true);
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      dv.setUint32(4 + i * 4, cursor, true);
      const part = encodedParts[i]!;
      out.set(part, headerBytes + cursor);
      cursor += part.byteLength;
    }
    dv.setUint32(4 + count * 4, cursor, true);
    return out;
  }
}

function decodeStringPool(section: Uint8Array): string[] {
  if (section.byteLength < 4) {
    throw new PackageIndexError("TRUNCATED", "String pool section is truncated.");
  }
  const dv = new DataView(section.buffer, section.byteOffset, section.byteLength);
  const count = dv.getUint32(0, true);
  const dataStart = 4 + (count + 1) * 4;
  if (section.byteLength < dataStart) {
    throw new PackageIndexError("TRUNCATED", "String pool offset table is truncated.");
  }
  const strings: string[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const start = dv.getUint32(4 + i * 4, true);
    const end = dv.getUint32(4 + (i + 1) * 4, true);
    strings[i] = textDecoder.decode(section.subarray(dataStart + start, dataStart + end));
  }
  return strings;
}

function computeSummaryPrefix(fqn: string): string {
  const parts = fqn.split(".");
  if (parts.length >= 2) return `${parts[0]}.${parts[1]}`;
  return parts[0] || "";
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

/**
 * Encodes a `SymbolIndex` (and optional pure-data semantic summaries) into a
 * self-contained, relocatable `.msidx` v1 binary buffer.
 */
export function encodePackageIndex(index: SymbolIndex, options?: PackageIndexEncodeOptions): Uint8Array {
  const filtered = filterAndNormalizePackageSymbols(index, options?.libraryPath);
  const includedSet = new Set<SymbolId>(filtered.map((f) => f.id));

  // Assign contiguous local IDs 0..N-1 in deterministic order (parents before children when possible)
  const childrenMap = new Map<
    SymbolId | null,
    Array<{ id: SymbolId; entry: SymbolEntry; relPath: string | undefined }>
  >();
  for (const item of filtered) {
    const rawParent = item.entry.parentId;
    const parentKey = rawParent !== null && rawParent !== undefined && includedSet.has(rawParent) ? rawParent : null;
    let list = childrenMap.get(parentKey);
    if (!list) {
      list = [];
      childrenMap.set(parentKey, list);
    }
    list.push(item);
  }
  for (const list of childrenMap.values()) {
    list.sort((a, b) => a.id - b.id);
  }

  const ordered: Array<{ id: SymbolId; entry: SymbolEntry; relPath: string | undefined }> = [];
  const visited = new Set<SymbolId>();
  const visit = (parentKey: SymbolId | null) => {
    const list = childrenMap.get(parentKey);
    if (!list) return;
    for (const item of list) {
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      ordered.push(item);
      visit(item.id);
    }
  };
  visit(null);
  // Fallback for any disconnected cycles
  for (const item of filtered) {
    if (!visited.has(item.id)) {
      visited.add(item.id);
      ordered.push(item);
    }
  }

  const N = ordered.length;
  const origToLocal = new Map<SymbolId, number>();
  for (let i = 0; i < N; i++) {
    origToLocal.set(ordered[i]!.id, i);
  }

  const pool = new StringPoolBuilder();
  const includeMerkle = options?.includeMerkle !== false;
  let hasAnyMerkle = false;
  if (includeMerkle) {
    for (let i = 0; i < N; i++) {
      const e = ordered[i]!.entry;
      if (e.merkleLow !== undefined || e.merkleHigh !== undefined) {
        hasAnyMerkle = true;
        break;
      }
    }
  }

  // Columnar arrays
  const parentLocalIds = new Int32Array(N);
  const domainIds = new Uint8Array(align4(N));
  const kindStrIdx = new Uint32Array(N);
  const nameStrIdx = new Uint32Array(N);
  const ruleNameStrIdx = new Uint32Array(N);
  const namePathStrIdx = new Uint32Array(N);
  const fieldNameStrIdx = new Int32Array(N);
  const languageStrIdx = new Int32Array(N);
  const relPathStrIdx = new Int32Array(N);
  const startOffsets = new Uint32Array(N);
  const endOffsets = new Uint32Array(N);
  const merkleLows = hasAnyMerkle ? new Uint32Array(N) : null;
  const merkleHighs = hasAnyMerkle ? new Uint32Array(N) : null;

  const exportsOffsets = new Uint32Array(N + 1);
  const exportsFlat: number[] = [];
  const inheritsOffsets = new Uint32Array(N + 1);
  const inheritsFlat: number[] = [];
  const fieldRangeOffsets = new Uint32Array(N + 1);
  const fieldRangeFlat: Array<{ fieldIdx: number; start: number; end: number }> = [];
  const sparseMeta: Array<{ localId: number; jsonIdx: number }> = [];

  // Compute FQNs for FQN hash table
  const fqns: string[] = new Array(N);

  for (let i = 0; i < N; i++) {
    const { id, entry, relPath } = ordered[i]!;
    const parentLocal =
      entry.parentId !== null && entry.parentId !== undefined ? (origToLocal.get(entry.parentId) ?? -1) : -1;
    parentLocalIds[i] = parentLocal;

    const domain = getSymbolDomain(id) || (entry.language ? getLanguageDomainId(entry.language) : 0);
    domainIds[i] = domain & 0xff;

    kindStrIdx[i] = pool.intern(entry.kind || "");
    nameStrIdx[i] = pool.intern(entry.name || "");
    ruleNameStrIdx[i] = pool.intern(entry.ruleName || "");
    namePathStrIdx[i] = pool.intern(entry.namePath || "");
    fieldNameStrIdx[i] = entry.fieldName !== null && entry.fieldName !== undefined ? pool.intern(entry.fieldName) : -1;
    languageStrIdx[i] = entry.language !== undefined ? pool.intern(entry.language) : -1;
    relPathStrIdx[i] = relPath !== undefined ? pool.intern(relPath) : -1;
    startOffsets[i] = entry.startOffset >>> 0;
    endOffsets[i] = entry.endOffset >>> 0;

    if (merkleLows && merkleHighs) {
      merkleLows[i] = (entry.merkleLow ?? 0) >>> 0;
      merkleHighs[i] = (entry.merkleHigh ?? 0) >>> 0;
    }

    exportsOffsets[i] = exportsFlat.length;
    if (entry.exports && entry.exports.length > 0) {
      for (const exp of entry.exports) exportsFlat.push(pool.intern(exp));
    }

    inheritsOffsets[i] = inheritsFlat.length;
    if (entry.inherits && entry.inherits.length > 0) {
      for (const inh of entry.inherits) inheritsFlat.push(pool.intern(inh));
    }

    fieldRangeOffsets[i] = fieldRangeFlat.length;
    if (entry.fieldRanges) {
      for (const [field, range] of Object.entries(entry.fieldRanges)) {
        fieldRangeFlat.push({
          fieldIdx: pool.intern(field),
          start: range.startOffset >>> 0,
          end: range.endOffset >>> 0,
        });
      }
    }

    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      try {
        const json = JSON.stringify(entry.metadata);
        if (json && json !== "{}") {
          sparseMeta.push({ localId: i, jsonIdx: pool.intern(json) });
        }
      } catch {
        // Ignore non-serializable metadata fields
      }
    }

    const parentFqn = parentLocal >= 0 && parentLocal < i ? fqns[parentLocal] : undefined;
    fqns[i] = parentFqn ? `${parentFqn}.${entry.name}` : entry.name || "";
  }
  exportsOffsets[N] = exportsFlat.length;
  inheritsOffsets[N] = inheritsFlat.length;
  fieldRangeOffsets[N] = fieldRangeFlat.length;

  // Build Section 2: Symbol Table
  const symTableByteLen =
    N * 4 + // parentLocalIds
    domainIds.byteLength + // domainIds (4-byte aligned)
    N * 4 * 9 + // kind, name, ruleName, namePath, fieldName, language, relPath, start, end
    (hasAnyMerkle ? N * 8 : 0) +
    (N + 1) * 4 +
    exportsFlat.length * 4 +
    (N + 1) * 4 +
    inheritsFlat.length * 4 +
    (N + 1) * 4 +
    fieldRangeFlat.length * 12 +
    4 + // sparseMeta count
    sparseMeta.length * 8;

  const section2 = new Uint8Array(align4(symTableByteLen));
  const dv2 = new DataView(section2.buffer, section2.byteOffset, section2.byteLength);
  let pos2 = 0;

  const writeTyped = (arr: ArrayBufferView) => {
    section2.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), pos2);
    pos2 += arr.byteLength;
  };

  writeTyped(parentLocalIds);
  writeTyped(domainIds);
  writeTyped(kindStrIdx);
  writeTyped(nameStrIdx);
  writeTyped(ruleNameStrIdx);
  writeTyped(namePathStrIdx);
  writeTyped(fieldNameStrIdx);
  writeTyped(languageStrIdx);
  writeTyped(relPathStrIdx);
  writeTyped(startOffsets);
  writeTyped(endOffsets);
  if (merkleLows && merkleHighs) {
    writeTyped(merkleLows);
    writeTyped(merkleHighs);
  }
  writeTyped(exportsOffsets);
  for (let i = 0; i < exportsFlat.length; i++) {
    dv2.setUint32(pos2, exportsFlat[i]!, true);
    pos2 += 4;
  }
  writeTyped(inheritsOffsets);
  for (let i = 0; i < inheritsFlat.length; i++) {
    dv2.setUint32(pos2, inheritsFlat[i]!, true);
    pos2 += 4;
  }
  writeTyped(fieldRangeOffsets);
  for (let i = 0; i < fieldRangeFlat.length; i++) {
    const fr = fieldRangeFlat[i]!;
    dv2.setUint32(pos2, fr.fieldIdx, true);
    dv2.setUint32(pos2 + 4, fr.start, true);
    dv2.setUint32(pos2 + 8, fr.end, true);
    pos2 += 12;
  }
  dv2.setUint32(pos2, sparseMeta.length, true);
  pos2 += 4;
  for (let i = 0; i < sparseMeta.length; i++) {
    const sm = sparseMeta[i]!;
    dv2.setUint32(pos2, sm.localId, true);
    dv2.setUint32(pos2 + 4, sm.jsonIdx, true);
    pos2 += 8;
  }

  // Build Section 3: Compact Lookup Tables (CSR childrenOf, sorted byName, sorted byFqnHash)
  // 3a. CSR childrenOf: slot 0 = root (parent == -1), slot (p + 1) = children of p
  const childCounts = new Uint32Array(N + 1);
  for (let i = 0; i < N; i++) {
    const slot = parentLocalIds[i]! + 1;
    childCounts[slot] = childCounts[slot]! + 1;
  }
  const childOffsets = new Uint32Array(N + 2);
  let childTotal = 0;
  for (let s = 0; s <= N; s++) {
    childOffsets[s] = childTotal;
    childTotal += childCounts[s]!;
  }
  childOffsets[N + 1] = childTotal;
  const childWriteCursor = new Uint32Array(childOffsets.subarray(0, N + 1));
  const childLocalIds = new Uint32Array(childTotal);
  for (let i = 0; i < N; i++) {
    const slot = parentLocalIds[i]! + 1;
    const dst = childWriteCursor[slot]!;
    childLocalIds[dst] = i;
    childWriteCursor[slot] = dst + 1;
  }

  // 3b. Sorted byName
  const byNameMap = new Map<string, number[]>();
  for (let i = 0; i < N; i++) {
    const nm = ordered[i]!.entry.name;
    if (!nm) continue;
    let list = byNameMap.get(nm);
    if (!list) {
      list = [];
      byNameMap.set(nm, list);
    }
    list.push(i);
  }
  const sortedNames = Array.from(byNameMap.keys()).sort();
  const uniqueNameCount = sortedNames.length;
  const sortedNameStrIdx = new Uint32Array(uniqueNameCount);
  const namePostingOffsets = new Uint32Array(uniqueNameCount + 1);
  const namePostingsFlat: number[] = [];
  for (let i = 0; i < uniqueNameCount; i++) {
    const nm = sortedNames[i]!;
    sortedNameStrIdx[i] = pool.intern(nm);
    namePostingOffsets[i] = namePostingsFlat.length;
    const ids = byNameMap.get(nm)!;
    for (const lid of ids) namePostingsFlat.push(lid);
  }
  namePostingOffsets[uniqueNameCount] = namePostingsFlat.length;

  // 3c. Sorted byFqnHash (64-bit FNV-1a)
  const fqnEntries: Array<{ hi: number; lo: number; localId: number }> = new Array(N);
  for (let i = 0; i < N; i++) {
    const h = fnv1a64String(fqns[i]!);
    fqnEntries[i] = { hi: h.hi, lo: h.lo, localId: i };
  }
  fqnEntries.sort((a, b) => compareU64(a.hi, a.lo, b.hi, b.lo) || a.localId - b.localId);

  const section3ByteLen =
    (N + 2) * 4 +
    childTotal * 4 +
    4 + // uniqueNameCount
    uniqueNameCount * 4 +
    (uniqueNameCount + 1) * 4 +
    namePostingsFlat.length * 4 +
    N * 12; // (hi, lo, localId) * N

  const section3 = new Uint8Array(align4(section3ByteLen));
  const dv3 = new DataView(section3.buffer, section3.byteOffset, section3.byteLength);
  let pos3 = 0;

  const writeTyped3 = (arr: ArrayBufferView) => {
    section3.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), pos3);
    pos3 += arr.byteLength;
  };
  writeTyped3(childOffsets);
  writeTyped3(childLocalIds);
  dv3.setUint32(pos3, uniqueNameCount, true);
  pos3 += 4;
  writeTyped3(sortedNameStrIdx);
  writeTyped3(namePostingOffsets);
  for (let i = 0; i < namePostingsFlat.length; i++) {
    dv3.setUint32(pos3, namePostingsFlat[i]!, true);
    pos3 += 4;
  }
  for (let i = 0; i < N; i++) {
    const fe = fqnEntries[i]!;
    dv3.setUint32(pos3, fe.hi, true);
    dv3.setUint32(pos3 + 4, fe.lo, true);
    dv3.setUint32(pos3 + 8, fe.localId, true);
    pos3 += 12;
  }

  // Build Section 4: Lazy Semantic Summary Chunks (optional)
  const summaries = options?.summaries ?? [];
  const hasSummaries = summaries.length > 0;
  let summaryChunkPayloads: Array<{ prefixStrIdx: number; payload: Uint8Array; symbolCount: number }> = [];
  if (hasSummaries) {
    const grouped = new Map<string, PackageSemanticSummary[]>();
    for (const s of summaries) {
      const prefix = computeSummaryPrefix(s.fqn);
      let list = grouped.get(prefix);
      if (!list) {
        list = [];
        grouped.set(prefix, list);
      }
      list.push(s);
    }
    const sortedPrefixes = Array.from(grouped.keys()).sort();
    summaryChunkPayloads = sortedPrefixes.map((prefix) => {
      const items = grouped.get(prefix)!;
      const payload = textEncoder.encode(JSON.stringify(items));
      return {
        prefixStrIdx: pool.intern(prefix),
        payload,
        symbolCount: items.length,
      };
    });
  }

  // Finalize String Pool (Section 1) now that all strings (including summary prefixes) are interned
  const section1 = pool.encode();

  // Compute exact section offsets
  const stringPoolOffset = MSIDX_HEADER_SIZE;
  const symbolTableOffset = stringPoolOffset + section1.byteLength;
  const lookupIndexOffset = symbolTableOffset + section2.byteLength;

  let summaryTocOffset = 0;
  let summaryTocLength = 0;
  let section4Toc = new Uint8Array(0);
  let totalPayloadBytes = 0;

  if (hasSummaries) {
    summaryTocOffset = lookupIndexOffset + section3.byteLength;
    const chunkCount = summaryChunkPayloads.length;
    summaryTocLength = 4 + chunkCount * 16;
    section4Toc = new Uint8Array(summaryTocLength);
    const dv4 = new DataView(section4Toc.buffer, section4Toc.byteOffset, section4Toc.byteLength);
    dv4.setUint32(0, chunkCount, true);

    let chunkCursor = summaryTocOffset + summaryTocLength;
    for (let i = 0; i < chunkCount; i++) {
      const c = summaryChunkPayloads[i]!;
      const off = 4 + i * 16;
      dv4.setUint32(off, c.prefixStrIdx, true);
      dv4.setUint32(off + 4, chunkCursor, true);
      dv4.setUint32(off + 8, c.payload.byteLength, true);
      dv4.setUint32(off + 12, c.symbolCount, true);
      chunkCursor += align4(c.payload.byteLength);
      totalPayloadBytes += align4(c.payload.byteLength);
    }
  }

  const totalSize = lookupIndexOffset + section3.byteLength + summaryTocLength + totalPayloadBytes;
  const out = new Uint8Array(totalSize);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);

  // Copy sections
  out.set(section1, stringPoolOffset);
  out.set(section2, symbolTableOffset);
  out.set(section3, lookupIndexOffset);
  if (hasSummaries) {
    out.set(section4Toc, summaryTocOffset);
    let chunkCursor = summaryTocOffset + summaryTocLength;
    for (const c of summaryChunkPayloads) {
      out.set(c.payload, chunkCursor);
      chunkCursor += align4(c.payload.byteLength);
    }
  }

  // Compute 64-bit content hash over all section bytes + ABI version
  const contentHash = fnv1a64Bytes([out.subarray(MSIDX_HEADER_SIZE)], MSIDX_COMPILER_ABI_VERSION);

  let flags = 0;
  if (hasSummaries) flags |= MSIDX_FLAG_HAS_SUMMARIES;
  if (hasAnyMerkle) flags |= MSIDX_FLAG_HAS_MERKLE;

  // Write 64-byte header
  dv.setUint32(0, MSIDX_MAGIC, true);
  dv.setUint16(4, MSIDX_FORMAT_VERSION, true);
  dv.setUint16(6, MSIDX_COMPILER_ABI_VERSION, true);
  dv.setUint32(8, flags, true);
  dv.setUint32(12, N, true);
  dv.setUint32(16, contentHash.lo, true);
  dv.setUint32(20, contentHash.hi, true);
  dv.setUint32(24, stringPoolOffset, true);
  dv.setUint32(28, section1.byteLength, true);
  dv.setUint32(32, symbolTableOffset, true);
  dv.setUint32(36, section2.byteLength, true);
  dv.setUint32(40, lookupIndexOffset, true);
  dv.setUint32(44, section3.byteLength, true);
  dv.setUint32(48, summaryTocOffset, true);
  dv.setUint32(52, summaryTocLength, true);
  dv.setUint32(56, 0, true);
  dv.setUint32(60, 0, true);

  return out;
}

// ---------------------------------------------------------------------------
// Header Parser & Full Mounter
// ---------------------------------------------------------------------------

/** Validates and parses the 64-byte `.msidx` header. */
export function parsePackageIndexHeader(bytes: Uint8Array): PackageIndexHeader {
  if (bytes.byteLength < MSIDX_HEADER_SIZE) {
    throw new PackageIndexError("TRUNCATED", `Buffer too small for .msidx header (${bytes.byteLength} bytes).`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = dv.getUint32(0, true);
  if (magic !== MSIDX_MAGIC) {
    throw new PackageIndexError("INVALID_MAGIC", `Invalid .msidx magic: 0x${magic.toString(16)}.`);
  }
  const formatVersion = dv.getUint16(4, true);
  if (formatVersion !== MSIDX_FORMAT_VERSION) {
    throw new PackageIndexError(
      "UNSUPPORTED_FORMAT_VERSION",
      `Unsupported .msidx format version ${formatVersion} (expected ${MSIDX_FORMAT_VERSION}).`,
    );
  }
  const compilerAbiVersion = dv.getUint16(6, true);
  if (compilerAbiVersion !== MSIDX_COMPILER_ABI_VERSION) {
    throw new PackageIndexError(
      "ABI_MISMATCH",
      `Incompatible .msidx compiler ABI version ${compilerAbiVersion} (expected ${MSIDX_COMPILER_ABI_VERSION}).`,
    );
  }

  const hashLo = dv.getUint32(16, true);
  const hashHi = dv.getUint32(20, true);

  return {
    magic,
    formatVersion,
    compilerAbiVersion,
    flags: dv.getUint32(8, true),
    symbolCount: dv.getUint32(12, true),
    contentHashHex: formatHex64(hashHi, hashLo),
    stringPoolOffset: dv.getUint32(24, true),
    stringPoolLength: dv.getUint32(28, true),
    symbolTableOffset: dv.getUint32(32, true),
    symbolTableLength: dv.getUint32(36, true),
    lookupIndexOffset: dv.getUint32(40, true),
    lookupIndexLength: dv.getUint32(44, true),
    summaryTocOffset: dv.getUint32(48, true),
    summaryTocLength: dv.getUint32(52, true),
  };
}

const IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * Decodes a `.msidx` buffer and mounts all symbols into a `SymbolIndex` with
 * collision-free `baseSequence` rebasing (preserving each symbol's `LanguageDomainId`).
 */
export function mountPackageIndex(bytes: Uint8Array, options?: PackageIndexMountOptions): MountedPackageIndex {
  const header = parsePackageIndexHeader(bytes);
  if (options?.verifyHash) {
    const computed = fnv1a64Bytes([bytes.subarray(MSIDX_HEADER_SIZE)], header.compilerAbiVersion);
    const computedHex = formatHex64(computed.hi, computed.lo);
    if (computedHex !== header.contentHashHex) {
      throw new PackageIndexError(
        "CORRUPT",
        `.msidx contentHash mismatch: header=${header.contentHashHex}, computed=${computedHex}.`,
      );
    }
  }
  const N = header.symbolCount;

  const index: SymbolIndex = options?.targetIndex ?? {
    symbols: new Map(),
    byName: new Map(),
    childrenOf: new Map(),
    symbolsByResource: new Map(),
  };
  if (!index.symbolsByResource) {
    index.symbolsByResource = new Map();
  }

  // Compute collision-free baseSequence
  let baseSequence = options?.baseSequence;
  if (baseSequence === undefined) {
    let maxSeq = 0;
    for (const existingId of index.symbols.keys()) {
      const seq = getLocalSymbolSeq(existingId);
      if (seq > maxSeq) maxSeq = seq;
    }
    baseSequence = maxSeq + 1;
  }

  if (N === 0) {
    return {
      index,
      symbolCount: 0,
      baseSequence,
      header,
      localToGlobalId: new Uint32Array(0),
    };
  }

  if (
    header.stringPoolOffset + header.stringPoolLength > bytes.byteLength ||
    header.symbolTableOffset + header.symbolTableLength > bytes.byteLength
  ) {
    throw new PackageIndexError("TRUNCATED", ".msidx sections exceed buffer length.");
  }

  const strings = decodeStringPool(
    bytes.subarray(header.stringPoolOffset, header.stringPoolOffset + header.stringPoolLength),
  );
  const sec2 = bytes.subarray(header.symbolTableOffset, header.symbolTableOffset + header.symbolTableLength);
  const dv2 = new DataView(sec2.buffer, sec2.byteOffset, sec2.byteLength);
  const hasMerkle = (header.flags & MSIDX_FLAG_HAS_MERKLE) !== 0;

  let pos = 0;
  const readI32 = (len: number): Int32Array => {
    const absOff = sec2.byteOffset + pos;
    pos += len * 4;
    if (IS_LITTLE_ENDIAN && (absOff & 3) === 0) {
      return new Int32Array(sec2.buffer, absOff, len);
    }
    const arr = new Int32Array(len);
    const base = pos - len * 4;
    for (let i = 0; i < len; i++) arr[i] = dv2.getInt32(base + i * 4, true);
    return arr;
  };
  const readU32 = (len: number): Uint32Array => {
    const absOff = sec2.byteOffset + pos;
    pos += len * 4;
    if (IS_LITTLE_ENDIAN && (absOff & 3) === 0) {
      return new Uint32Array(sec2.buffer, absOff, len);
    }
    const arr = new Uint32Array(len);
    const base = pos - len * 4;
    for (let i = 0; i < len; i++) arr[i] = dv2.getUint32(base + i * 4, true);
    return arr;
  };

  const parentLocalIds = readI32(N);
  const domainIds = sec2.subarray(pos, pos + align4(N));
  pos += align4(N);
  const kindStrIdx = readU32(N);
  const nameStrIdx = readU32(N);
  const ruleNameStrIdx = readU32(N);
  const namePathStrIdx = readU32(N);
  const fieldNameStrIdx = readI32(N);
  const languageStrIdx = readI32(N);
  const relPathStrIdx = readI32(N);
  const startOffsets = readU32(N);
  const endOffsets = readU32(N);
  const merkleLows = hasMerkle ? readU32(N) : null;
  const merkleHighs = hasMerkle ? readU32(N) : null;

  const exportsOffsets = readU32(N + 1);
  const exportsTotal = exportsOffsets[N]!;
  const exportsFlat = readU32(exportsTotal);

  const inheritsOffsets = readU32(N + 1);
  const inheritsTotal = inheritsOffsets[N]!;
  const inheritsFlat = readU32(inheritsTotal);

  const fieldRangeOffsets = readU32(N + 1);
  const fieldRangeTotal = fieldRangeOffsets[N]!;
  const fieldRangesBasePos = pos;
  pos += fieldRangeTotal * 12;

  const sparseMetaCount = dv2.getUint32(pos, true);
  pos += 4;
  const metaMap = new Map<number, Record<string, unknown>>();
  for (let i = 0; i < sparseMetaCount; i++) {
    const lid = dv2.getUint32(pos, true);
    const jsonIdx = dv2.getUint32(pos + 4, true);
    pos += 8;
    try {
      metaMap.set(lid, JSON.parse(strings[jsonIdx]!) as Record<string, unknown>);
    } catch {
      // Ignore malformed metadata
    }
  }

  // Pre-compute rebased global SymbolIds
  const localToGlobalId = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    const domain = domainIds[i]!;
    localToGlobalId[i] = makePolyglotSymbolId(domain, baseSequence + i);
  }

  const resolveUri = options?.resolveResourceUri;

  for (let i = 0; i < N; i++) {
    const globalId = localToGlobalId[i]!;
    const pLocal = parentLocalIds[i]!;
    const parentId: SymbolId | null = pLocal >= 0 ? localToGlobalId[pLocal]! : null;

    const expStart = exportsOffsets[i]!;
    const expEnd = exportsOffsets[i + 1]!;
    const exportsArr: string[] = [];
    for (let j = expStart; j < expEnd; j++) exportsArr.push(strings[exportsFlat[j]!]!);

    const inhStart = inheritsOffsets[i]!;
    const inhEnd = inheritsOffsets[i + 1]!;
    const inheritsArr: string[] = [];
    for (let j = inhStart; j < inhEnd; j++) inheritsArr.push(strings[inheritsFlat[j]!]!);

    const frStart = fieldRangeOffsets[i]!;
    const frEnd = fieldRangeOffsets[i + 1]!;
    let fieldRanges: Record<string, { startOffset: number; endOffset: number }> | undefined;
    if (frEnd > frStart) {
      fieldRanges = {};
      for (let j = frStart; j < frEnd; j++) {
        const off = fieldRangesBasePos + j * 12;
        const fieldName = strings[dv2.getUint32(off, true)]!;
        fieldRanges[fieldName] = {
          startOffset: dv2.getUint32(off + 4, true),
          endOffset: dv2.getUint32(off + 8, true),
        };
      }
    }

    const relIdx = relPathStrIdx[i]!;
    const rawRelPath = relIdx >= 0 ? strings[relIdx]! : undefined;
    const resourceId = rawRelPath !== undefined ? (resolveUri ? resolveUri(rawRelPath) : rawRelPath) : undefined;
    const langIdx = languageStrIdx[i]!;
    const fnIdx = fieldNameStrIdx[i]!;

    const entry: SymbolEntry = {
      id: globalId,
      kind: strings[kindStrIdx[i]!]!,
      name: strings[nameStrIdx[i]!]!,
      ruleName: strings[ruleNameStrIdx[i]!]!,
      namePath: strings[namePathStrIdx[i]!]!,
      startOffset: startOffsets[i]!,
      endOffset: endOffsets[i]!,
      parentId,
      exports: exportsArr,
      inherits: inheritsArr,
      metadata: metaMap.get(i) ?? {},
      fieldName: fnIdx >= 0 ? strings[fnIdx]! : null,
      ...(fieldRanges ? { fieldRanges } : {}),
      ...(resourceId !== undefined ? { resourceId } : {}),
      ...(langIdx >= 0 ? { language: strings[langIdx]! } : {}),
      ...(merkleLows && merkleHighs ? { merkleLow: merkleLows[i]!, merkleHigh: merkleHighs[i]! } : {}),
    };

    index.symbols.set(globalId, entry);

    if (entry.name) {
      let nameList = index.byName.get(entry.name);
      if (!nameList) {
        nameList = [];
        index.byName.set(entry.name, nameList);
      }
      nameList.push(globalId);
    }

    let childList = index.childrenOf.get(parentId);
    if (!childList) {
      childList = [];
      index.childrenOf.set(parentId, childList);
    }
    childList.push(globalId);

    if (resourceId !== undefined) {
      let resList = index.symbolsByResource.get(resourceId);
      if (!resList) {
        resList = [];
        index.symbolsByResource.set(resourceId, resList);
      }
      resList.push(globalId);
    }
  }

  return {
    index,
    symbolCount: N,
    baseSequence,
    header,
    localToGlobalId,
  };
}

// ---------------------------------------------------------------------------
// Lazy Byte-Range Reader (Section 1 + Section 3 + Section 4 TOC on open)
// ---------------------------------------------------------------------------

/**
 * Lazy byte-range reader for `.msidx` files.
 * Opens without reading the full symbol table or summary payloads;
 * fetches individual sub-package semantic summary chunks on demand via `ByteRangeSource`.
 */
export class PackageIndexReader {
  public readonly header: PackageIndexHeader;
  private readonly source: ByteRangeSource;
  private readonly strings: string[];
  private readonly childOffsets: Uint32Array;
  private readonly childLocalIds: Uint32Array;
  private readonly sortedNameStrIdx: Uint32Array;
  private readonly namePostingOffsets: Uint32Array;
  private readonly namePostings: Uint32Array;
  private readonly fqnHashView: DataView;
  private readonly fqnHashOffset: number;
  private readonly summaryToc: Map<string, PackageSummaryTocEntry>;
  private readonly loadedSummaries = new Map<string, PackageSemanticSummary[]>();

  private constructor(
    header: PackageIndexHeader,
    source: ByteRangeSource,
    strings: string[],
    sec3: Uint8Array,
    summaryToc: Map<string, PackageSummaryTocEntry>,
  ) {
    this.header = header;
    this.source = source;
    this.strings = strings;
    this.summaryToc = summaryToc;

    const N = header.symbolCount;
    const dv3 = new DataView(sec3.buffer, sec3.byteOffset, sec3.byteLength);
    let pos = 0;

    const readU32 = (len: number): Uint32Array => {
      const arr = new Uint32Array(len);
      for (let i = 0; i < len; i++) arr[i] = dv3.getUint32(pos + i * 4, true);
      pos += len * 4;
      return arr;
    };

    this.childOffsets = readU32(N + 2);
    const childTotal = this.childOffsets[N + 1]!;
    this.childLocalIds = readU32(childTotal);

    const uniqueNameCount = dv3.getUint32(pos, true);
    pos += 4;
    this.sortedNameStrIdx = readU32(uniqueNameCount);
    this.namePostingOffsets = readU32(uniqueNameCount + 1);
    const postingsTotal = this.namePostingOffsets[uniqueNameCount]!;
    this.namePostings = readU32(postingsTotal);

    this.fqnHashView = dv3;
    this.fqnHashOffset = pos;
  }

  /**
   * Opens a `.msidx` file lazily by reading only the header, string pool,
   * lookup index, and summary TOC (skipping Section 2 and Section 4 chunk bodies).
   */
  static async open(source: ByteRangeSource): Promise<PackageIndexReader> {
    const headerBytes = await source.readRange(0, MSIDX_HEADER_SIZE);
    const header = parsePackageIndexHeader(headerBytes);

    const [sec1, sec3, sec4Toc] = await Promise.all([
      source.readRange(header.stringPoolOffset, header.stringPoolLength),
      source.readRange(header.lookupIndexOffset, header.lookupIndexLength),
      header.summaryTocLength > 0
        ? source.readRange(header.summaryTocOffset, header.summaryTocLength)
        : Promise.resolve(new Uint8Array(0)),
    ]);

    const strings = decodeStringPool(sec1);
    const toc = new Map<string, PackageSummaryTocEntry>();
    if (sec4Toc.byteLength >= 4) {
      const dv4 = new DataView(sec4Toc.buffer, sec4Toc.byteOffset, sec4Toc.byteLength);
      const count = dv4.getUint32(0, true);
      for (let i = 0; i < count; i++) {
        const off = 4 + i * 16;
        const prefix = strings[dv4.getUint32(off, true)]!;
        toc.set(prefix, {
          prefix,
          byteOffset: dv4.getUint32(off + 4, true),
          byteLength: dv4.getUint32(off + 8, true),
          symbolCount: dv4.getUint32(off + 12, true),
        });
      }
    }

    return new PackageIndexReader(header, source, strings, sec3, toc);
  }

  /** O(1) lookup of direct child localIds for a parent localId (`null` for top-level symbols). */
  getChildren(parentLocalId: number | null): number[] {
    const slot = parentLocalId === null ? 0 : parentLocalId + 1;
    if (slot < 0 || slot + 1 >= this.childOffsets.length) return [];
    const start = this.childOffsets[slot]!;
    const end = this.childOffsets[slot + 1]!;
    const out: number[] = [];
    for (let i = start; i < end; i++) out.push(this.childLocalIds[i]!);
    return out;
  }

  /** O(log M) exact name lookup returning matching localIds. */
  lookupByName(name: string): number[] {
    let lo = 0;
    let hi = this.sortedNameStrIdx.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const midStr = this.strings[this.sortedNameStrIdx[mid]!]!;
      if (midStr === name) {
        const start = this.namePostingOffsets[mid]!;
        const end = this.namePostingOffsets[mid + 1]!;
        const out: number[] = [];
        for (let i = start; i < end; i++) out.push(this.namePostings[i]!);
        return out;
      }
      if (midStr < name) lo = mid + 1;
      else hi = mid - 1;
    }
    return [];
  }

  /** O(log M + K) prefix lookup for fast autocomplete. */
  lookupPrefix(prefix: string, limit = 50): Array<{ name: string; localIds: number[] }> {
    let lo = 0;
    let hi = this.sortedNameStrIdx.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const midStr = this.strings[this.sortedNameStrIdx[mid]!]!;
      if (midStr < prefix) lo = mid + 1;
      else hi = mid;
    }
    const results: Array<{ name: string; localIds: number[] }> = [];
    for (let i = lo; i < this.sortedNameStrIdx.length && results.length < limit; i++) {
      const nm = this.strings[this.sortedNameStrIdx[i]!]!;
      if (!nm.startsWith(prefix)) break;
      const start = this.namePostingOffsets[i]!;
      const end = this.namePostingOffsets[i + 1]!;
      const localIds: number[] = [];
      for (let j = start; j < end; j++) localIds.push(this.namePostings[j]!);
      results.push({ name: nm, localIds });
    }
    return results;
  }

  /** O(log N) lookup of localId by 64-bit FQN hash. */
  lookupByFqn(fqn: string): number | null {
    const target = fnv1a64String(fqn);
    let lo = 0;
    let hi = this.header.symbolCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const off = this.fqnHashOffset + mid * 12;
      const midHi = this.fqnHashView.getUint32(off, true);
      const midLo = this.fqnHashView.getUint32(off + 4, true);
      const cmp = compareU64(midHi, midLo, target.hi, target.lo);
      if (cmp === 0) {
        return this.fqnHashView.getUint32(off + 8, true);
      }
      if (cmp < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  /** Lists all available lazy semantic summary chunk prefixes. */
  getSummaryPrefixes(): string[] {
    return Array.from(this.summaryToc.keys());
  }

  /** Lazily fetches & caches a single sub-package semantic summary chunk via byte-range read. */
  async loadSummaryChunk(prefix: string): Promise<PackageSemanticSummary[]> {
    const cached = this.loadedSummaries.get(prefix);
    if (cached) return cached;
    const entry = this.summaryToc.get(prefix);
    if (!entry) return [];
    const bytes = await this.source.readRange(entry.byteOffset, entry.byteLength);
    const parsed = JSON.parse(textDecoder.decode(bytes)) as PackageSemanticSummary[];
    this.loadedSummaries.set(prefix, parsed);
    return parsed;
  }
}

// ---------------------------------------------------------------------------
// Semantic Summary Extractor & Binary Inspector
// ---------------------------------------------------------------------------

/**
 * Extracts pure-data `PackageSemanticSummary` records from a `SymbolIndex`
 * (suitable for Section 4 lazy summary chunks without serializing Salsa Memos).
 */
export function extractPackageSummaries(index: SymbolIndex, libraryPath?: string): PackageSemanticSummary[] {
  const filtered = filterAndNormalizePackageSymbols(index, libraryPath);
  const includedMap = new Map<SymbolId, SymbolEntry>();
  for (const { id, entry } of filtered) includedMap.set(id, entry);

  const computeFqn = (symId: SymbolId): string => {
    const parts: string[] = [];
    let cur: SymbolId | null | undefined = symId;
    const seen = new Set<SymbolId>();
    while (cur !== null && cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      const e: SymbolEntry | undefined = includedMap.get(cur) ?? index.symbols.get(cur);
      if (!e) break;
      if (e.name) parts.push(e.name);
      cur = e.parentId;
    }
    return parts.reverse().join(".");
  };

  const summaries: PackageSemanticSummary[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const { id, entry } = filtered[i]!;
    const meta = entry.metadata ?? {};
    const classKind =
      typeof meta["classKind"] === "string"
        ? meta["classKind"]
        : typeof meta["classPrefixes"] === "string"
          ? meta["classPrefixes"]
          : typeof meta["defKind"] === "string"
            ? meta["defKind"]
            : undefined;
    const docSummary =
      typeof meta["description"] === "string"
        ? meta["description"]
        : typeof meta["doc"] === "string"
          ? meta["doc"]
          : undefined;
    const isConnector = Boolean(meta["isConnector"] || (classKind && classKind.includes("connector")));
    const isPartial = Boolean(meta["isPartial"] || (classKind && classKind.includes("partial")));
    const isEncapsulated = Boolean(meta["isEncapsulated"]);
    const isFunction = Boolean(meta["isFunction"] || (classKind && classKind.includes("function")));

    if (!classKind && !docSummary && !isConnector && !isPartial && !isEncapsulated && !isFunction) {
      continue;
    }

    const fqn = computeFqn(id);
    if (!fqn) continue;

    summaries.push({
      localId: i,
      fqn,
      ...(classKind ? { classKind } : {}),
      ...(isConnector ? { isConnector } : {}),
      ...(isPartial ? { isPartial } : {}),
      ...(isEncapsulated ? { isEncapsulated } : {}),
      ...(isFunction ? { isFunction } : {}),
      ...(docSummary ? { docSummary } : {}),
    });
  }

  return summaries;
}

/**
 * Inspects a `.msidx` buffer and returns its header, string count, per-domain
 * symbol counts, and summary chunk TOC (used by `msx polyglot inspect`).
 */
export function inspectPackageIndex(bytes: Uint8Array): PackageIndexInspection {
  const header = parsePackageIndexHeader(bytes);
  const N = header.symbolCount;
  const strings = decodeStringPool(
    bytes.subarray(header.stringPoolOffset, header.stringPoolOffset + header.stringPoolLength),
  );

  const domainCounts: Record<number, number> = {};
  if (N > 0) {
    const domainOffset = header.symbolTableOffset + N * 4;
    for (let i = 0; i < N; i++) {
      const dom = bytes[domainOffset + i]!;
      domainCounts[dom] = (domainCounts[dom] ?? 0) + 1;
    }
  }

  const summaryChunks: PackageSummaryTocEntry[] = [];
  if (header.summaryTocLength >= 4) {
    const toc = bytes.subarray(header.summaryTocOffset, header.summaryTocOffset + header.summaryTocLength);
    const dv4 = new DataView(toc.buffer, toc.byteOffset, toc.byteLength);
    const count = dv4.getUint32(0, true);
    for (let i = 0; i < count; i++) {
      const off = 4 + i * 16;
      summaryChunks.push({
        prefix: strings[dv4.getUint32(off, true)]!,
        byteOffset: dv4.getUint32(off + 4, true),
        byteLength: dv4.getUint32(off + 8, true),
        symbolCount: dv4.getUint32(off + 12, true),
      });
    }
  }

  return {
    header,
    byteLength: bytes.byteLength,
    stringCount: strings.length,
    domainCounts,
    summaryChunks,
  };
}
