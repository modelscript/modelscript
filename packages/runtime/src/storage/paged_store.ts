// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import { hashIri64 } from "../ontology/wasm_ontology.js";

export interface PagedWasmExports {
  paged_init?(bufferPoolFrames?: number): void;
  paged_insertTriple?(s: number, p: number, o: number, axiomType: number, flags: number): number;
  paged_deleteTriple?(s: number, p: number, o: number): number;
  paged_findTriples?(s: number, p: number, o: number): number;
  paged_findTriplesCommitted?(s: number, p: number, o: number): number;
  paged_leapfrogJoinTriangle?(p1: number, p2: number, p3: number): number;
  paged_getPrefixCompressedSize?(): number;
  paged_compressPageToExchange?(pageId: number): number;
  paged_decompressExchangeToPage?(pageId: number): number;
  paged_beginTx?(): number;
  paged_commitTx?(): number;
  paged_abortTx?(): number;
  paged_getTxId?(): number;
  paged_getCommittedTxId?(): number;
  paged_getCowClonesCount?(): number;
  paged_getFreePageCount?(): number;
  paged_getFreePageAt?(index: number): number;
  paged_pushFreePage?(pageId: number): void;
  paged_getSpoRoot?(): number;
  paged_getPosRoot?(): number;
  paged_getOspRoot?(): number;
  paged_restoreSuperblock?(
    txId: number,
    spoRoot: number,
    posRoot: number,
    ospRoot: number,
    totalTriples: number,
    nextAllocPageId: number,
  ): void;
  paged_getQueryBufferPtr?(): number;
  paged_getExchangeBufferPtr?(): number;
  paged_readPageToExchange?(pageId: number): number;
  paged_writeExchangeToPage?(pageId: number): number;
  paged_getPageLsn?(pageId: number): number;
  paged_flush?(): number;
  paged_getPageCount?(): number;
  paged_getTotalTriples?(): number;
  paged_getCommittedTotalTriples?(): number;
  paged_getBufferPoolHitRate?(): number;
  ontology_getOrCreateEntity?(lo: number, hi: number): number;
  memory?: WebAssembly.Memory | undefined;
}

export interface PagedTriple {
  subjectId: number;
  predicateId: number;
  objectId: number;
  axiomType: number;
  flags: number;
}

export interface StorageMetrics {
  pageCount: number;
  totalTriples: number;
  bufferPoolHitRate: number;
  allocatedMemoryBytes: number;
  prefixCompressedBytes: number;
  txId: number;
  committedTxId: number;
  cowClonesCount: number;
  freePageCount: number;
  spoRoot: number;
  posRoot: number;
  ospRoot: number;
}

export interface SuperblockMetadata {
  slot: 0 | 1;
  txId: number;
  spoRoot: number;
  posRoot: number;
  ospRoot: number;
  totalTriples: number;
  nextAllocPageId: number;
  dictOffset: number;
  dictByteLength: number;
  freePages: number[];
  checksum: number;
}

// Inline NodeId Tag Constants (Top 2 bits of 32-bit unsigned NodeId)
//   00 (0x00000001..0x3FFFFFFF): Interned IRI or String in Node Table
//   01 (0x40000000..0x7FFFFFFF): Inline 30-bit Signed Integer (-536,870,912 .. +536,870,911)
//   10 (0x80000000..0xBFFFFFFF): Inline Boolean (0x80000000 = false, 0x80000001 = true)
//   11 (0xC0000000..0xFFFFFFFE): Inline Fixed-Point 1e-3 Decimal (0xFFFFFFFF reserved for wildcard)
const TAG_MASK = 0xc0000000;
const TAG_INLINE_INT = 0x40000000;
const TAG_INLINE_BOOL = 0x80000000;
const TAG_INLINE_DEC = 0xc0000000;
const PAYLOAD_MASK_30 = 0x3fffffff;

const SUPERBLOCK_MAGIC_0 = 0x4d535444; // "MSTD"
const SUPERBLOCK_MAGIC_1 = 0x42320001; // "B2\x00\x01"
const PAGE_SIZE = 4096;
const SUPERBLOCK_SLOTS_BYTES = PAGE_SIZE * 2; // 8192 bytes (Slot 0 at 0..4095, Slot 1 at 4096..8191)

function computeSuperblockChecksum(u32View: Uint32Array): number {
  // FNV-1a 32-bit checksum over header words [0..11] and freePage entries
  let hash = 0x811c9dc5;
  const freeCount = Math.min(u32View[11]!, 1010);
  const wordLimit = 13 + freeCount;
  for (let i = 0; i < wordLimit; i++) {
    if (i === 12) continue; // Word 12 is the stored checksum itself
    let w = u32View[i]!;
    for (let b = 0; b < 4; b++) {
      hash ^= w & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
      w >>>= 8;
    }
  }
  return hash >>> 0;
}

/**
 * Paged Virtual Storage Engine for WebAssembly Triple Stores (Apache Jena TDB2 Parity).
 *
 * Capabilities:
 *   1. Three covering B+Tree index permutations (SPO, POS, OSP) for O(log N + K) range queries on any bound pattern.
 *   2. Generation-Tagged Copy-on-Write (CoW) MVCC transactions (`beginTransaction`, `commit`, `abort`, `findTriplesCommitted`).
 *   3. Crash-safe Dual-Slot Ping-Pong Superblock (`Slot 0` / `Slot 1`) with checksum verification & automatic recovery.
 *   4. Persistent bidirectional Node Table (`IRI <-> NodeId`) + 32-bit Inline Value Encoding (integers, booleans, decimals).
 *   5. Two-way disk paging (`pread`/`pwrite`) and B+Tree deletion (`deleteTriple`) with Epoch Freelist reclamation.
 */
export class PagedStorageEngine {
  private _wasm: PagedWasmExports;
  private _backingFd: number | null = null;
  public _backingFilePath: string | null = null;
  private _iriMap = new Map<string, number>();
  private _idToIri = new Map<number, string>();
  private _nextSequentialId = 1;
  private _lastSyncedTxId = 0;
  private _lastRecoveredSuperblock: SuperblockMetadata | null = null;

  constructor(wasmExports: PagedWasmExports, bufferPoolFrames: number = 512) {
    this._wasm = wasmExports;
    this._wasm.paged_init?.(bufferPoolFrames);
  }

  /**
   * Attaches a persistent backing `.db` file.
   * If the file already exists and contains a valid Dual-Slot Superblock, automatically
   * recovers the latest committed B+Tree roots, pages, freelist, and Node Dictionary.
   */
  public attachFile(filePath: string): void {
    this._backingFilePath = filePath;
    const exists = fs.existsSync(filePath);
    const size = exists ? fs.statSync(filePath).size : 0;

    if (exists && size >= SUPERBLOCK_SLOTS_BYTES) {
      this._backingFd = fs.openSync(filePath, "r+");
      this._recoverFromDisk(size);
    } else {
      this._backingFd = fs.openSync(filePath, "w+");
      this._lastSyncedTxId = 0;
    }
  }

  /**
   * Returns metadata about the superblock slot recovered on last file open (if any).
   */
  public getRecoveredSuperblock(): SuperblockMetadata | null {
    return this._lastRecoveredSuperblock;
  }

  // ---------------------------------------------------------------------------
  // Node Table (IRI Interning) & Inline Literal Encoding
  // ---------------------------------------------------------------------------

  /**
   * Interns an IRI or string literal to a 32-bit dense Entity ID (< 0x40000000).
   */
  public intern(iri: string): number {
    if (!iri) return 0;
    const existing = this._iriMap.get(iri);
    if (existing !== undefined) return existing;

    const { lo, hi } = hashIri64(iri);
    let id: number;
    if (this._wasm.ontology_getOrCreateEntity) {
      id = this._wasm.ontology_getOrCreateEntity(lo, hi) >>> 0;
      if (id >= this._nextSequentialId) {
        this._nextSequentialId = id + 1;
      }
      // Guard against collision if reopening a persisted dictionary before WASM ontology table is populated
      while (this._idToIri.has(id) && this._idToIri.get(id) !== iri) {
        id = this._nextSequentialId++;
      }
    } else {
      id = this._nextSequentialId++;
    }

    this._iriMap.set(iri, id);
    this._idToIri.set(id, iri);
    return id;
  }

  /**
   * Resolves a 32-bit interned Entity ID back to its IRI string.
   */
  public resolveIri(id: number): string | undefined {
    return this._idToIri.get(id >>> 0);
  }

  /**
   * Encodes a literal value (30-bit signed integer, boolean, fixed-point float, or string)
   * into a 32-bit tagged NodeId. Inline integers, booleans, and fixed-point decimals
   * require zero dictionary storage or string table lookup.
   */
  public encodeLiteral(value: number | boolean | string): number {
    if (typeof value === "boolean") {
      return (TAG_INLINE_BOOL | (value ? 1 : 0)) >>> 0;
    }
    if (typeof value === "number") {
      if (Number.isInteger(value) && value >= -536870912 && value <= 536870911) {
        return (TAG_INLINE_INT | (value & PAYLOAD_MASK_30)) >>> 0;
      }
      const scaled = Math.round(value * 1000);
      if (
        Number.isFinite(value) &&
        Math.abs(scaled / 1000 - value) < 1e-6 &&
        scaled >= -536870912 &&
        scaled <= 536870910
      ) {
        return (TAG_INLINE_DEC | (scaled & PAYLOAD_MASK_30)) >>> 0;
      }
      return this.intern(`"${value}"^^http://www.w3.org/2001/XMLSchema#double`);
    }
    return this.intern(value);
  }

  /**
   * Decodes any 32-bit NodeId (either an inline tagged value or an interned IRI/string).
   */
  public decodeTerm(nodeId: number): string | number | boolean | undefined {
    const u = nodeId >>> 0;
    if (u === 0 || u === 0xffffffff) return undefined;
    const tag = (u & TAG_MASK) >>> 0;
    if (tag === TAG_INLINE_INT) {
      // Sign-extend 30-bit two's complement integer to 32-bit signed number
      return ((u & PAYLOAD_MASK_30) << 2) >> 2;
    }
    if (tag === TAG_INLINE_BOOL) {
      return (u & 1) === 1;
    }
    if (tag === TAG_INLINE_DEC) {
      const scaled = ((u & PAYLOAD_MASK_30) << 2) >> 2;
      return scaled / 1000;
    }
    return this._idToIri.get(u);
  }

  /**
   * Returns true if the given 32-bit NodeId is an inlined value rather than a dictionary reference.
   */
  public isInlineValue(nodeId: number): boolean {
    const u = nodeId >>> 0;
    if (u === 0 || u === 0xffffffff) return false;
    return (u & TAG_MASK) !== 0;
  }

  // ---------------------------------------------------------------------------
  // MVCC Transactions (Begin / Commit / Abort / Snapshot Reader)
  // ---------------------------------------------------------------------------

  /**
   * Begins a Generation-Tagged Copy-on-Write (CoW) write transaction.
   * Returns the new transaction generation ID (`txId`).
   */
  public beginTransaction(): number {
    return this._wasm.paged_beginTx?.() ?? 1;
  }

  /**
   * Commits the active CoW write transaction, recycles shadowed pages into the
   * Epoch Freelist, and atomically persists dirty pages + Dual-Slot Superblock to disk.
   */
  public commit(): boolean {
    const ok = (this._wasm.paged_commitTx?.() ?? 0) > 0;
    if (this._backingFd !== null) {
      this.flush();
    }
    return ok;
  }

  /**
   * Aborts the active CoW write transaction and rolls back all B+Tree roots
   * and dirtied pages to the pre-transaction committed snapshot in O(1) per dirtied page.
   */
  public abort(): boolean {
    return (this._wasm.paged_abortTx?.() ?? 0) > 0;
  }

  // ---------------------------------------------------------------------------
  // Triple Store CRUD & Multi-Index Range Queries (SPO, POS, OSP)
  // ---------------------------------------------------------------------------

  /**
   * Inserts an asserted or inferred triple into the SPO, POS, and OSP B+Trees.
   */
  public insertTriple(
    subject: string | number,
    predicate: string | number,
    object: string | number | boolean,
    axiomType: number = 0,
    flags: number = 0,
  ): boolean {
    if (!this._wasm.paged_insertTriple) return false;

    const sId = typeof subject === "string" ? this.intern(subject) : subject >>> 0;
    const pId = typeof predicate === "string" ? this.intern(predicate) : predicate >>> 0;
    const oId =
      typeof object === "string"
        ? this.intern(object)
        : typeof object === "boolean"
          ? this.encodeLiteral(object)
          : object >>> 0;

    const res = this._wasm.paged_insertTriple(sId, pId, oId, axiomType, flags);
    return res > 0;
  }

  /**
   * Deletes a triple from the SPO, POS, and OSP B+Trees.
   * Returns true if the triple existed and was deleted.
   */
  public deleteTriple(
    subject: string | number,
    predicate: string | number,
    object: string | number | boolean,
  ): boolean {
    if (!this._wasm.paged_deleteTriple) return false;

    const sId = typeof subject === "string" ? this.intern(subject) : subject >>> 0;
    const pId = typeof predicate === "string" ? this.intern(predicate) : predicate >>> 0;
    const oId =
      typeof object === "string"
        ? this.intern(object)
        : typeof object === "boolean"
          ? this.encodeLiteral(object)
          : object >>> 0;

    const res = this._wasm.paged_deleteTriple(sId, pId, oId);
    return res > 0;
  }

  /**
   * Executes an O(log N + K) range scan query using the optimal covering index (SPO, POS, or OSP).
   * Wildcards are represented by 0 or undefined.
   */
  public findTriples(pattern: {
    subject?: string | number | undefined;
    predicate?: string | number | undefined;
    object?: string | number | boolean | undefined;
  }): PagedTriple[] {
    return this._executeFind(pattern, false);
  }

  /**
   * Executes an O(log N + K) range scan query against the last committed MVCC snapshot,
   * completely isolated from any ongoing uncommitted write transaction.
   */
  public findTriplesCommitted(pattern: {
    subject?: string | number | undefined;
    predicate?: string | number | undefined;
    object?: string | number | boolean | undefined;
  }): PagedTriple[] {
    return this._executeFind(pattern, true);
  }

  private _executeFind(
    pattern: {
      subject?: string | number | undefined;
      predicate?: string | number | undefined;
      object?: string | number | boolean | undefined;
    },
    committedOnly: boolean,
  ): PagedTriple[] {
    const findFn = committedOnly ? this._wasm.paged_findTriplesCommitted : this._wasm.paged_findTriples;
    if (!findFn || !this._wasm.memory || !this._wasm.paged_getQueryBufferPtr) {
      return [];
    }

    const sId =
      pattern.subject !== undefined
        ? typeof pattern.subject === "string"
          ? (this._iriMap.get(pattern.subject) ?? 0xfffffffe)
          : pattern.subject >>> 0
        : 0;
    const pId =
      pattern.predicate !== undefined
        ? typeof pattern.predicate === "string"
          ? (this._iriMap.get(pattern.predicate) ?? 0xfffffffe)
          : pattern.predicate >>> 0
        : 0;
    const oId =
      pattern.object !== undefined
        ? typeof pattern.object === "string"
          ? (this._iriMap.get(pattern.object) ?? 0xfffffffe)
          : typeof pattern.object === "boolean"
            ? this.encodeLiteral(pattern.object)
            : pattern.object >>> 0
        : 0;

    const count = findFn(sId, pId, oId);
    if (count === 0) return [];

    const bufPtr = this._wasm.paged_getQueryBufferPtr();
    const u32 = new Uint32Array(this._wasm.memory.buffer, bufPtr, count * 5);
    const results: PagedTriple[] = [];

    for (let i = 0; i < count; i++) {
      const offset = i * 5;
      results.push({
        subjectId: u32[offset]!,
        predicateId: u32[offset + 1]!,
        objectId: u32[offset + 2]!,
        axiomType: u32[offset + 3]!,
        flags: u32[offset + 4]!,
      });
    }

    return results;
  }

  /**
   * Executes a Worst-Case Optimal Join (Leapfrog Triejoin) for a cyclic 3-pattern triangle query:
   *   (?x, p1, ?y) /\ (?y, p2, ?z) /\ (?z, p3, ?x)
   * directly over sorted SPO + POS B+Tree leaf iterators in WebAssembly linear memory.
   */
  public leapfrogTriangleJoin(
    p1: string | number,
    p2: string | number,
    p3: string | number,
  ): { x: number; y: number; z: number }[] {
    if (!this._wasm.paged_leapfrogJoinTriangle || !this._wasm.memory || !this._wasm.paged_getQueryBufferPtr) {
      return [];
    }

    const p1Id = typeof p1 === "string" ? (this._iriMap.get(p1) ?? 0xfffffffe) : p1 >>> 0;
    const p2Id = typeof p2 === "string" ? (this._iriMap.get(p2) ?? 0xfffffffe) : p2 >>> 0;
    const p3Id = typeof p3 === "string" ? (this._iriMap.get(p3) ?? 0xfffffffe) : p3 >>> 0;

    const count = this._wasm.paged_leapfrogJoinTriangle(p1Id, p2Id, p3Id);
    if (count === 0) return [];

    const bufPtr = this._wasm.paged_getQueryBufferPtr();
    const u32 = new Uint32Array(this._wasm.memory.buffer, bufPtr, count * 3);
    const results: { x: number; y: number; z: number }[] = [];

    for (let i = 0; i < count; i++) {
      const offset = i * 3;
      results.push({
        x: u32[offset]!,
        y: u32[offset + 1]!,
        z: u32[offset + 2]!,
      });
    }
    return results;
  }

  /**
   * Compresses a 4KB slotted leaf page using shared (k1, k2) Prefix Run-Length Encoding
   * and returns the compact binary payload.
   */
  public compressPage(pageId: number): Uint8Array {
    if (!this._wasm.paged_compressPageToExchange || !this._wasm.paged_getExchangeBufferPtr || !this._wasm.memory) {
      return new Uint8Array(0);
    }
    const byteLen = this._wasm.paged_compressPageToExchange(pageId >>> 0);
    if (byteLen === 0) return new Uint8Array(0);
    const exPtr = this._wasm.paged_getExchangeBufferPtr();
    return new Uint8Array(this._wasm.memory.buffer.slice(exPtr, exPtr + byteLen));
  }

  /**
   * Decompresses a prefix-compressed leaf payload into the specified page slot
   * and returns the restored itemCount.
   */
  public decompressPage(pageId: number, compressedPayload: Uint8Array): number {
    if (!this._wasm.paged_decompressExchangeToPage || !this._wasm.paged_getExchangeBufferPtr || !this._wasm.memory) {
      return 0;
    }
    const exPtr = this._wasm.paged_getExchangeBufferPtr();
    const target = new Uint8Array(this._wasm.memory.buffer, exPtr, PAGE_SIZE);
    target.fill(0);
    target.set(compressedPayload.subarray(0, PAGE_SIZE));
    return this._wasm.paged_decompressExchangeToPage(pageId >>> 0);
  }

  /**
   * Computes prefix-compression statistics across all active SPO/POS/OSP B+Tree pages.
   */
  public getPrefixCompressionStats(): {
    rawAllocatedBytes: number;
    uncompressedLogicalBytes: number;
    prefixCompressedBytes: number;
    compressionRatioVsLogical: number;
    compressionRatioVsAllocated: number;
  } {
    const pageCount = this._wasm.paged_getPageCount?.() ?? 0;
    const totalTriples = this._wasm.paged_getTotalTriples?.() ?? 0;
    const rawAllocatedBytes = pageCount * PAGE_SIZE;
    // 3 indexes * 16 bytes per entry + 32-byte header per page
    const uncompressedLogicalBytes = pageCount * 32 + totalTriples * 3 * 16;
    const prefixCompressedBytes = this._wasm.paged_getPrefixCompressedSize?.() ?? uncompressedLogicalBytes;

    return {
      rawAllocatedBytes,
      uncompressedLogicalBytes,
      prefixCompressedBytes,
      compressionRatioVsLogical: prefixCompressedBytes > 0 ? uncompressedLogicalBytes / prefixCompressedBytes : 1.0,
      compressionRatioVsAllocated: prefixCompressedBytes > 0 ? rawAllocatedBytes / prefixCompressedBytes : 1.0,
    };
  }

  // ---------------------------------------------------------------------------
  // Persistence: Two-Way Disk Paging & Dual-Slot Ping-Pong Superblock
  // ---------------------------------------------------------------------------

  /**
   * Flushes all dirty buffer pool frames, persists the Node Table, and atomically
   * commits the Dual-Slot Ping-Pong Superblock (`Slot 0` / `Slot 1`) to disk.
   */
  public flush(): number {
    const flushed = this._wasm.paged_flush?.() ?? 0;
    if (
      this._backingFd !== null &&
      this._wasm.paged_getExchangeBufferPtr &&
      this._wasm.paged_readPageToExchange &&
      this._wasm.memory
    ) {
      const pageCount = this._wasm.paged_getPageCount?.() ?? 0;
      const exBufPtr = this._wasm.paged_getExchangeBufferPtr();
      const nodeBuf = Buffer.from(this._wasm.memory.buffer, exBufPtr, PAGE_SIZE);

      // 1. Write dirty 4KB B+Tree pages (p = 1..pageCount) at offset (p + 1) * 4096
      for (let p = 1; p <= pageCount; p++) {
        const pageLsn = this._wasm.paged_getPageLsn?.(p) ?? 1;
        if (this._lastSyncedTxId === 0 || pageLsn >= this._lastSyncedTxId) {
          if (this._wasm.paged_readPageToExchange(p)) {
            fs.writeSync(this._backingFd, nodeBuf, 0, PAGE_SIZE, (p + 1) * PAGE_SIZE);
          }
        }
      }

      // 2. Serialize and write the persistent Node Table (IRI <-> NodeId) after B+Tree pages
      const dictOffset = (pageCount + 2) * PAGE_SIZE;
      const dictPayload = this._serializeNodeTable();
      if (dictPayload.byteLength > 0) {
        fs.writeSync(this._backingFd, dictPayload, 0, dictPayload.byteLength, dictOffset);
      }

      try {
        fs.fdatasyncSync(this._backingFd);
      } catch {}

      // 3. Write Dual-Slot Ping-Pong Superblock to slot (txId % 2)
      const txId = this._wasm.paged_getTxId?.() ?? 1;
      const spoRoot = this._wasm.paged_getSpoRoot?.() ?? 1;
      const posRoot = this._wasm.paged_getPosRoot?.() ?? 2;
      const ospRoot = this._wasm.paged_getOspRoot?.() ?? 3;
      const totalTriples = this._wasm.paged_getTotalTriples?.() ?? 0;
      const nextAllocPageId = pageCount + 1;

      const superblockBuf = this._buildSuperblockBuffer(
        txId,
        spoRoot,
        posRoot,
        ospRoot,
        totalTriples,
        nextAllocPageId,
        dictOffset,
        dictPayload.byteLength,
      );

      if (this._lastSyncedTxId === 0) {
        // First flush on a brand-new database file: initialize both Slot 0 and Slot 1
        fs.writeSync(this._backingFd, superblockBuf, 0, PAGE_SIZE, 0);
        fs.writeSync(this._backingFd, superblockBuf, 0, PAGE_SIZE, PAGE_SIZE);
      } else {
        const targetSlotOffset = (txId % 2) * PAGE_SIZE;
        fs.writeSync(this._backingFd, superblockBuf, 0, PAGE_SIZE, targetSlotOffset);
      }

      try {
        fs.fdatasyncSync(this._backingFd);
      } catch {}

      this._lastSyncedTxId = txId;
    }
    return flushed;
  }

  private _buildSuperblockBuffer(
    txId: number,
    spoRoot: number,
    posRoot: number,
    ospRoot: number,
    totalTriples: number,
    nextAllocPageId: number,
    dictOffset: number,
    dictByteLength: number,
  ): Buffer {
    const buf = Buffer.alloc(PAGE_SIZE, 0);
    const u32 = new Uint32Array(buf.buffer, buf.byteOffset, PAGE_SIZE >> 2);

    const freeCount = Math.min(this._wasm.paged_getFreePageCount?.() ?? 0, 1010);

    u32[0] = SUPERBLOCK_MAGIC_0;
    u32[1] = SUPERBLOCK_MAGIC_1;
    u32[2] = txId >>> 0;
    u32[3] = 0; // txId high 32 bits
    u32[4] = spoRoot >>> 0;
    u32[5] = posRoot >>> 0;
    u32[6] = ospRoot >>> 0;
    u32[7] = totalTriples >>> 0;
    u32[8] = nextAllocPageId >>> 0;
    u32[9] = dictOffset >>> 0;
    u32[10] = dictByteLength >>> 0;
    u32[11] = freeCount >>> 0;

    for (let i = 0; i < freeCount; i++) {
      u32[13 + i] = (this._wasm.paged_getFreePageAt?.(i) ?? 0) >>> 0;
    }

    u32[12] = computeSuperblockChecksum(u32);
    return buf;
  }

  private _parseSuperblockSlot(buf: Buffer, slot: 0 | 1): SuperblockMetadata | null {
    if (buf.byteLength < PAGE_SIZE) return null;
    const u32 = new Uint32Array(buf.buffer, buf.byteOffset, PAGE_SIZE >> 2);
    if (u32[0] !== SUPERBLOCK_MAGIC_0 || u32[1] !== SUPERBLOCK_MAGIC_1) {
      return null;
    }
    const storedChecksum = u32[12]!;
    const expectedChecksum = computeSuperblockChecksum(u32);
    if (storedChecksum !== expectedChecksum) {
      return null;
    }

    const freeCount = Math.min(u32[11]!, 1010);
    const freePages: number[] = [];
    for (let i = 0; i < freeCount; i++) {
      freePages.push(u32[13 + i]!);
    }

    return {
      slot,
      txId: u32[2]!,
      spoRoot: u32[4]!,
      posRoot: u32[5]!,
      ospRoot: u32[6]!,
      totalTriples: u32[7]!,
      nextAllocPageId: u32[8]!,
      dictOffset: u32[9]!,
      dictByteLength: u32[10]!,
      freePages,
      checksum: storedChecksum,
    };
  }

  private _recoverFromDisk(fileSize: number): void {
    if (this._backingFd === null) return;

    const slot0Buf = Buffer.alloc(PAGE_SIZE);
    const slot1Buf = Buffer.alloc(PAGE_SIZE);
    fs.readSync(this._backingFd, slot0Buf, 0, PAGE_SIZE, 0);
    fs.readSync(this._backingFd, slot1Buf, 0, PAGE_SIZE, PAGE_SIZE);

    const sb0 = this._parseSuperblockSlot(slot0Buf, 0);
    const sb1 = this._parseSuperblockSlot(slot1Buf, 1);

    let chosen: SuperblockMetadata | null = null;
    if (sb0 && sb1) {
      chosen = sb1.txId >= sb0.txId ? sb1 : sb0;
    } else if (sb0) {
      chosen = sb0;
    } else if (sb1) {
      chosen = sb1;
    }

    if (!chosen) {
      this._lastRecoveredSuperblock = null;
      return;
    }

    this._lastRecoveredSuperblock = chosen;
    this._lastSyncedTxId = chosen.txId;

    // 1. Restore B+Tree pages from disk into WASM
    const pageCount = chosen.nextAllocPageId - 1;
    if (this._wasm.paged_getExchangeBufferPtr && this._wasm.paged_writeExchangeToPage && this._wasm.memory) {
      const exBufPtr = this._wasm.paged_getExchangeBufferPtr();
      const pageBuf = Buffer.from(this._wasm.memory.buffer, exBufPtr, PAGE_SIZE);
      for (let p = 1; p <= pageCount; p++) {
        const diskOffset = (p + 1) * PAGE_SIZE;
        if (diskOffset + PAGE_SIZE <= fileSize) {
          fs.readSync(this._backingFd, pageBuf, 0, PAGE_SIZE, diskOffset);
          this._wasm.paged_writeExchangeToPage(p);
        }
      }
    }

    // 2. Restore Superblock roots & Epoch Freelist in WASM
    this._wasm.paged_restoreSuperblock?.(
      chosen.txId,
      chosen.spoRoot,
      chosen.posRoot,
      chosen.ospRoot,
      chosen.totalTriples,
      chosen.nextAllocPageId,
    );
    for (const freeId of chosen.freePages) {
      this._wasm.paged_pushFreePage?.(freeId);
    }

    // 3. Restore Persistent Node Table (IRI <-> NodeId)
    if (chosen.dictByteLength > 0 && chosen.dictOffset + chosen.dictByteLength <= fileSize) {
      const dictBuf = Buffer.alloc(chosen.dictByteLength);
      fs.readSync(this._backingFd, dictBuf, 0, chosen.dictByteLength, chosen.dictOffset);
      this._deserializeNodeTable(dictBuf);
    }
  }

  private _serializeNodeTable(): Buffer {
    const entries: [number, Buffer][] = [];
    let totalBytes = 4; // [0..3]: entryCount: u32
    for (const [iri, id] of this._iriMap.entries()) {
      const strBuf = Buffer.from(iri, "utf8");
      entries.push([id, strBuf]);
      totalBytes += 8 + strBuf.byteLength; // id (4B) + byteLen (4B) + utf8 bytes
    }

    const out = Buffer.alloc(totalBytes);
    out.writeUInt32LE(entries.length, 0);
    let offset = 4;
    for (const [id, strBuf] of entries) {
      out.writeUInt32LE(id >>> 0, offset);
      out.writeUInt32LE(strBuf.byteLength, offset + 4);
      strBuf.copy(out, offset + 8);
      offset += 8 + strBuf.byteLength;
    }
    return out;
  }

  private _deserializeNodeTable(buf: Buffer): void {
    this._iriMap.clear();
    this._idToIri.clear();
    if (buf.byteLength < 4) return;

    const count = buf.readUInt32LE(0);
    let offset = 4;
    let maxId = 0;

    for (let i = 0; i < count && offset + 8 <= buf.byteLength; i++) {
      const id = buf.readUInt32LE(offset);
      const len = buf.readUInt32LE(offset + 4);
      offset += 8;
      if (offset + len > buf.byteLength) break;
      const iri = buf.toString("utf8", offset, offset + len);
      offset += len;

      this._iriMap.set(iri, id);
      this._idToIri.set(id, iri);
      if (id > maxId) maxId = id;
    }

    this._nextSequentialId = maxId + 1;
  }

  /**
   * Returns runtime metrics on buffer pool hit rate, page allocation, CoW clones, and triples count.
   */
  public getMetrics(): StorageMetrics {
    const pageCount = this._wasm.paged_getPageCount?.() ?? 0;
    const totalTriples = this._wasm.paged_getTotalTriples?.() ?? 0;
    const bufferPoolHitRate = this._wasm.paged_getBufferPoolHitRate?.() ?? 1.0;

    return {
      pageCount,
      totalTriples,
      bufferPoolHitRate,
      allocatedMemoryBytes: pageCount * PAGE_SIZE,
      prefixCompressedBytes: this._wasm.paged_getPrefixCompressedSize?.() ?? pageCount * PAGE_SIZE,
      txId: this._wasm.paged_getTxId?.() ?? 1,
      committedTxId: this._wasm.paged_getCommittedTxId?.() ?? 1,
      cowClonesCount: this._wasm.paged_getCowClonesCount?.() ?? 0,
      freePageCount: this._wasm.paged_getFreePageCount?.() ?? 0,
      spoRoot: this._wasm.paged_getSpoRoot?.() ?? 1,
      posRoot: this._wasm.paged_getPosRoot?.() ?? 2,
      ospRoot: this._wasm.paged_getOspRoot?.() ?? 3,
    };
  }

  /**
   * Closes attached backing file descriptor.
   */
  public close(): void {
    this.flush();
    if (this._backingFd !== null) {
      try {
        fs.closeSync(this._backingFd);
      } catch {}
      this._backingFd = null;
    }
  }
}
