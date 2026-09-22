import { atomicChunkAlloc, ensureStringArena, stringArenaOffset, stringArenaPtr } from "../arena";
import { ChunkedUint32Array, createChunkedUint32Array } from "../core/array";
import { UnmanagedMap64, createMap64 } from "../core/hashmap";
import { salsa_invalidateNegativeDependencies } from "../graph";

/**
 * ----------------------------------------------------------------------------
 * Tier 1 Declaration Stub Index (Persistent Zero-GC WASM Store)
 * ----------------------------------------------------------------------------
 *
 * Stores lightweight declaration headers (packages, classes, models, functions,
 * fields, types, and inheritance relations) in unmanaged WASM memory.
 *
 * Memory Layout per Stub Symbol (48 bytes = 12 u32 words, 64-byte friendly):
 *  word 0:  fileId (u32)
 *  word 1:  symbolId (u32)
 *  word 2:  parentSymbolId (u32)
 *  word 3:  kind (u16) | (flags (u16) << 16)
 *  word 4:  nameHash (u32, DJB2 / FNV-1a hash of symbol identifier)
 *  word 5:  nameHandle (u32, offset into stringArena)
 *  word 6:  startByte (u32)
 *  word 7:  endByte (u32)
 *  word 8:  merkleLow (u32, lower 32 bits of 64-bit Merkle hash)
 *  word 9:  merkleHigh (u32, upper 32 bits of 64-bit Merkle hash)
 *  word 10: parentFqnHash (u32, FNV-1a hash of parent FQN for cross-file stitching)
 *  word 11: reserved / freeListNext (u32)
 */

export const STUB_STRIDE: u32 = 12;
export const FLAG_IS_SYNTHETIC: u16 = 0x0100;

const STUB_ACCESSOR_SLOTS: u32 = 16;
const STUB_ACCESSOR_MASK: u32 = STUB_ACCESSOR_SLOTS - 1;
let g_stubAccessorIdx: u32 = 0;
let g_stubAccessorBuf: usize = 0;

/**
 * Lightweight, zero-overhead accessor over a single 48-byte stub symbol in `t_stubTable`.
 * Avoids manual baseIdx arithmetic with @inline property getters/setters.
 */
@unmanaged
export class StubAccessor {
  private _data: ChunkedUint32Array;
  private _offset: u32;

  @inline static at(data: ChunkedUint32Array, stubId: u32): StubAccessor {
    if (g_stubAccessorBuf == 0) {
      g_stubAccessorBuf = atomicChunkAlloc(STUB_ACCESSOR_SLOTS * (sizeof<usize>() * 2));
    }
    let slot = (g_stubAccessorIdx++) & STUB_ACCESSOR_MASK;
    let a = changetype<StubAccessor>(g_stubAccessorBuf + slot * (sizeof<usize>() * 2));
    a._data = data;
    a._offset = stubId * STUB_STRIDE;
    return a;
  }

  @inline get fileId(): u32 { return this._data.get(this._offset + 0); }
  @inline set fileId(v: u32) { this._data.set(this._offset + 0, v); }

  @inline get symbolId(): u32 { return this._data.get(this._offset + 1); }
  @inline set symbolId(v: u32) { this._data.set(this._offset + 1, v); }

  @inline get parentSymbolId(): u32 { return this._data.get(this._offset + 2); }
  @inline set parentSymbolId(v: u32) { this._data.set(this._offset + 2, v); }

  @inline get kind(): u16 { return (this._data.get(this._offset + 3) & 0xffff) as u16; }
  @inline get flags(): u16 { return ((this._data.get(this._offset + 3) >> 16) & 0xffff) as u16; }
  @inline setKindAndFlags(kind: u16, flags: u16): void {
    this._data.set(this._offset + 3, (kind as u32) | ((flags as u32) << 16));
  }

  @inline get nameHash(): u32 { return this._data.get(this._offset + 4); }
  @inline set nameHash(v: u32) { this._data.set(this._offset + 4, v); }

  @inline get nameHandle(): u32 { return this._data.get(this._offset + 5); }
  @inline set nameHandle(v: u32) { this._data.set(this._offset + 5, v); }

  @inline get startByte(): u32 { return this._data.get(this._offset + 6); }
  @inline set startByte(v: u32) { this._data.set(this._offset + 6, v); }

  @inline get endByte(): u32 { return this._data.get(this._offset + 7); }
  @inline set endByte(v: u32) { this._data.set(this._offset + 7, v); }

  @inline get merkleLow(): u32 { return this._data.get(this._offset + 8); }
  @inline set merkleLow(v: u32) { this._data.set(this._offset + 8, v); }

  @inline get merkleHigh(): u32 { return this._data.get(this._offset + 9); }
  @inline set merkleHigh(v: u32) { this._data.set(this._offset + 9, v); }

  @inline get parentFqnHash(): u32 { return this._data.get(this._offset + 10); }
  @inline set parentFqnHash(v: u32) { this._data.set(this._offset + 10, v); }

  @inline get reserved(): u32 { return this._data.get(this._offset + 11); }
  @inline set reserved(v: u32) { this._data.set(this._offset + 11, v); }

  @inline get kindAndFlags(): u32 { return this._data.get(this._offset + 3); }
  @inline set kindAndFlags(v: u32) { this._data.set(this._offset + 3, v); }

  @inline getWord(wordIdx: u32): u32 {
    return this._data.get(this._offset + wordIdx);
  }

  @inline setWord(wordIdx: u32, v: u32): void {
    this._data.set(this._offset + wordIdx, v);
  }

  @inline clear(): void {
    for (let w: u32 = 0; w < STUB_STRIDE; w++) {
      this._data.set(this._offset + w, 0);
    }
  }

  @inline writeTo(outBuffer: ChunkedUint32Array): void {
    for (let w: u32 = 0; w < STUB_STRIDE; w++) {
      outBuffer.push(this._data.get(this._offset + w));
    }
  }
}

export let t_stubTable: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let t_stubNameHashes: ChunkedUint32Array = changetype<ChunkedUint32Array>(0); // Contiguous for SIMD
export let t_stubCount: u32 = 1; // 1-indexed, 0 is null
export let t_stubFreeListHead: u32 = 0; // Recycled slot free-list head

// Linked list side-tables for O(1) multi-indexing
export let t_stubNextByName: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let t_stubNextSibling: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let t_stubNextInFile: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);

// Fast open-addressing lookup maps
export let t_stubsByNameHash: UnmanagedMap64 = changetype<UnmanagedMap64>(0);
export let t_stubsByParent: UnmanagedMap64 = changetype<UnmanagedMap64>(0);
export let t_stubsByFile: UnmanagedMap64 = changetype<UnmanagedMap64>(0);
export let t_fileParentFqnMap: UnmanagedMap64 = changetype<UnmanagedMap64>(0); // fileId -> parentFqnHash
export let t_fqnToStubMap: UnmanagedMap64 = changetype<UnmanagedMap64>(0);     // fqnHash -> stubId

// Binary serialization buffer pointer for returning stub queries to JS
export let t_stubBinaryBuffer: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let t_stubBinaryFlatPtr: u32 = 0;
let t_stubBinaryCapacity: u32 = 0;

export function ensureStubStore(): void {
  if (changetype<usize>(t_stubTable) == 0) {
    t_stubTable = createChunkedUint32Array(2000 * STUB_STRIDE);
    t_stubNameHashes = createChunkedUint32Array(2000);
    t_stubNextByName = createChunkedUint32Array(2000);
    t_stubNextSibling = createChunkedUint32Array(2000);
    t_stubNextInFile = createChunkedUint32Array(2000);

    t_stubsByNameHash = changetype<UnmanagedMap64>(createMap64());
    t_stubsByParent = changetype<UnmanagedMap64>(createMap64());
    t_stubsByFile = changetype<UnmanagedMap64>(createMap64());
    t_fileParentFqnMap = changetype<UnmanagedMap64>(createMap64());
    t_fqnToStubMap = changetype<UnmanagedMap64>(createMap64());

    t_stubBinaryBuffer = createChunkedUint32Array(2000);
    t_stubBinaryCapacity = 2000;
    t_stubBinaryFlatPtr = atomicChunkAlloc(2000 * 4);
    t_stubCount = 1;
    t_stubFreeListHead = 0;
  }
}

/**
 * Registers a declaration stub in the persistent Tier 1 index.
 * Reclaims recycled slots from the free-list when available.
 * Automatically stitches parent hierarchy when parentFqnHash is provided.
 * @returns The unique 1-indexed stub ID.
 */
export function stub_registerSymbol(
  fileId: u32,
  symbolId: u32,
  parentSymbolId: u32,
  kind: u16,
  flags: u16,
  nameHash: u32,
  nameHandle: u32,
  startByte: u32,
  endByte: u32,
  merkleLow: u32,
  merkleHigh: u32,
  parentFqnHash: u32,
): u32 {
  ensureStubStore();

  let id: u32;
  if (t_stubFreeListHead != 0) {
    id = t_stubFreeListHead;
    t_stubFreeListHead = t_stubNextSibling.get(id);
  } else {
    id = t_stubCount++;
  }

  // Cross-File Package FQN Stitching (Concept 1)
  if (parentSymbolId == 0) {
    let fqnHash = parentFqnHash;
    if (fqnHash == 0 && fileId != 0) {
      fqnHash = t_fileParentFqnMap.get(fileId as u64) as u32;
    }
    if (fqnHash != 0) {
      let resolvedParentStub = t_fqnToStubMap.get(fqnHash as u64) as u32;
      if (resolvedParentStub != 0) {
        parentSymbolId = resolvedParentStub;
      }
    }
  }

  let stub = StubAccessor.at(t_stubTable, id);
  stub.fileId = fileId;
  stub.symbolId = symbolId;
  stub.parentSymbolId = parentSymbolId;
  stub.setKindAndFlags(kind, flags);
  stub.nameHash = nameHash;
  stub.nameHandle = nameHandle;
  stub.startByte = startByte;
  stub.endByte = endByte;
  stub.merkleLow = merkleLow;
  stub.merkleHigh = merkleHigh;
  stub.parentFqnHash = parentFqnHash;
  stub.reserved = 0;

  t_stubNameHashes.set(id, nameHash);

  // Link into byNameHash chain
  let prevNameHead = t_stubsByNameHash.get(nameHash as u64);
  t_stubNextByName.set(id, prevNameHead);
  t_stubsByNameHash.set(nameHash as u64, id);

  // Link into byParent (children) chain
  if (parentSymbolId != 0) {
    let prevParentHead = t_stubsByParent.get(parentSymbolId as u64);
    t_stubNextSibling.set(id, prevParentHead);
    t_stubsByParent.set(parentSymbolId as u64, id);
  } else {
    t_stubNextSibling.set(id, 0);
  }

  // Link into byFile chain
  if (fileId != 0) {
    let prevFileHead = t_stubsByFile.get(fileId as u64);
    t_stubNextInFile.set(id, prevFileHead);
    t_stubsByFile.set(fileId as u64, id);
  } else {
    t_stubNextInFile.set(id, 0);
  }

  // Invalidate any negative query dependencies waiting for this symbol
  salsa_invalidateNegativeDependencies(nameHash);

  return id;
}

/**
 * Registers an enclosing parent FQN hash for a given file.
 */
export function stub_registerFileWithParentFQN(fileId: u32, parentFqnHash: u32): void {
  ensureStubStore();
  t_fileParentFqnMap.set(fileId as u64, parentFqnHash);
}

/**
 * Binds a global FQN hash to a specific package/class declaration stub ID.
 */
export function stub_bindFqnStub(fqnHash: u32, stubId: u32): void {
  ensureStubStore();
  t_fqnToStubMap.set(fqnHash as u64, stubId);
}

/**
 * Lazily stitches a child stub to its parent stub using the parent's FQN hash.
 */
export function stub_stitchParentFQN(childStubId: u32, parentFqnHash: u32): u32 {
  ensureStubStore();
  if (childStubId >= t_stubCount) return 0;
  let resolvedParentStub = t_fqnToStubMap.get(parentFqnHash as u64) as u32;
  if (resolvedParentStub == 0) return 0;

  let stub = StubAccessor.at(t_stubTable, childStubId);
  let oldParentId = stub.parentSymbolId;
  if (oldParentId != resolvedParentStub) {
    if (oldParentId != 0) {
      let head = t_stubsByParent.get(oldParentId as u64);
      if (head == childStubId) {
        t_stubsByParent.set(oldParentId as u64, t_stubNextSibling.get(childStubId));
      } else {
        let prev = head;
        while (prev != 0 && t_stubNextSibling.get(prev) != childStubId) {
          prev = t_stubNextSibling.get(prev);
        }
        if (prev != 0) {
          t_stubNextSibling.set(prev, t_stubNextSibling.get(childStubId));
        }
      }
    }

    stub.parentSymbolId = resolvedParentStub;
    stub.parentFqnHash = parentFqnHash;

    let prevParentHead = t_stubsByParent.get(resolvedParentStub as u64);
    t_stubNextSibling.set(childStubId, prevParentHead);
    t_stubsByParent.set(resolvedParentStub as u64, childStubId);
  }

  return resolvedParentStub;
}

/**
 * Synthetic Symbol Projection with Conflict Deduplication (Concept 4).
 * Checks if a real (non-synthetic) symbol with `nameHash` already exists in the workspace.
 * - If found: returns the existing real stub ID (deduplicating and linking facts).
 * - If not found: registers a virtual synthetic stub marked with FLAG_IS_SYNTHETIC.
 * @returns The resolved or newly registered stub ID.
 */
export function stub_projectSyntheticSymbol(
  fileId: u32,
  symbolId: u32,
  parentSymbolId: u32,
  kind: u16,
  nameHash: u32,
  nameHandle: u32,
  parentFqnHash: u32,
): u32 {
  ensureStubStore();

  // 1. Search for existing non-synthetic stub with this nameHash
  let existingStubId = t_stubsByNameHash.get(nameHash as u64);
  while (existingStubId != 0) {
    let stub = StubAccessor.at(t_stubTable, existingStubId);
    if (stub.fileId != 0) {
      if ((stub.flags & FLAG_IS_SYNTHETIC) == 0) {
        // Found real symbol: deduplicate and return existing ID!
        return existingStubId;
      }
    }
    existingStubId = t_stubNextByName.get(existingStubId);
  }

  // 2. No real symbol found: register synthetic stub
  return stub_registerSymbol(
    fileId,
    symbolId,
    parentSymbolId,
    kind,
    FLAG_IS_SYNTHETIC,
    nameHash,
    nameHandle,
    0, // startByte (virtual)
    0, // endByte (virtual)
    0, // merkleLow
    0, // merkleHigh
    parentFqnHash,
  );
}

/**
 * Clears all stubs associated with a specific fileId.
 * Unlinks them from hash lookup chains and recycles slot IDs onto t_stubFreeListHead (Concept 2).
 */
export function stub_clearFile(fileId: u32): void {
  if (changetype<usize>(t_stubsByFile) == 0 || fileId == 0) return;

  let stubId = t_stubsByFile.get(fileId as u64);
  while (stubId != 0) {
    let stub = StubAccessor.at(t_stubTable, stubId);
    let nextInFile = t_stubNextInFile.get(stubId);
    let nameHash = stub.nameHash;
    let parentSymbolId = stub.parentSymbolId;

    // 1. Unlink from byNameHash chain
    if (nameHash != 0) {
      let head = t_stubsByNameHash.get(nameHash as u64);
      if (head == stubId) {
        t_stubsByNameHash.set(nameHash as u64, t_stubNextByName.get(stubId));
      } else {
        let prev = head;
        while (prev != 0 && t_stubNextByName.get(prev) != stubId) {
          prev = t_stubNextByName.get(prev);
        }
        if (prev != 0) {
          t_stubNextByName.set(prev, t_stubNextByName.get(stubId));
        }
      }
    }

    // 2. Unlink from byParent chain
    if (parentSymbolId != 0) {
      let head = t_stubsByParent.get(parentSymbolId as u64);
      if (head == stubId) {
        t_stubsByParent.set(parentSymbolId as u64, t_stubNextSibling.get(stubId));
      } else {
        let prev = head;
        while (prev != 0 && t_stubNextSibling.get(prev) != stubId) {
          prev = t_stubNextSibling.get(prev);
        }
        if (prev != 0) {
          t_stubNextSibling.set(prev, t_stubNextSibling.get(stubId));
        }
      }
    }

    // 3. Clear stub memory & push onto free-list
    stub.clear();
    t_stubNameHashes.set(stubId, 0);

    t_stubNextSibling.set(stubId, t_stubFreeListHead);
    t_stubFreeListHead = stubId;

    stubId = nextInFile;
  }
  t_stubsByFile.set(fileId as u64, 0);
}

/**
 * Clears all indexed stubs in the entire Tier 1 stub store.
 */
export function stub_clearAll(): void {
  if (changetype<usize>(t_stubTable) != 0) {
    t_stubTable.clear();
    t_stubNameHashes.clear();
    t_stubNextByName.clear();
    t_stubNextSibling.clear();
    t_stubNextInFile.clear();
    t_stubsByNameHash.init();
    t_stubsByParent.init();
    t_stubsByFile.init();
    t_fileParentFqnMap.init();
    t_fqnToStubMap.init();
    t_stubCount = 1;
    t_stubFreeListHead = 0;
  }
}

/**
 * Fast Tier 1 Go-to-Definition:
 * Looks up the declaration matching `nameHash`.
 * Returns 3-tuple [fileId, startByte, endByte] or 0 if not found in Tier 1.
 */
export function stub_getDefinition(nameHash: u32, preferredFileId: u32): u32 {
  if (changetype<usize>(t_stubsByNameHash) == 0 || nameHash == 0) return 0;

  let stubId = t_stubsByNameHash.get(nameHash as u64);
  let bestStubId: u32 = 0;

  while (stubId != 0) {
    let stub = StubAccessor.at(t_stubTable, stubId);
    if (stub.fileId != 0) {
      if (preferredFileId != 0 && stub.fileId == preferredFileId) {
        bestStubId = stubId;
        break;
      }
      if (bestStubId == 0) {
        bestStubId = stubId;
      }
    }
    stubId = t_stubNextByName.get(stubId);
  }

  if (bestStubId == 0) return 0;

  let best = StubAccessor.at(t_stubTable, bestStubId);
  ensureStubBuffer();
  t_stubBinaryBuffer.push(best.fileId);
  t_stubBinaryBuffer.push(best.startByte);
  t_stubBinaryBuffer.push(best.endByte);
  flushStubBuffer();

  return 3;
}

/**
 * Queries all child symbols of a given parent symbol ID.
 * Returns the number of symbols written to the binary buffer (STUB_STRIDE u32 words per stub).
 */
export function stub_getChildren(parentSymbolId: u32): u32 {
  ensureStubStore();
  ensureStubBuffer();

  let count: u32 = 0;
  let stubId = t_stubsByParent.get(parentSymbolId as u64);

  while (stubId != 0) {
    let stub = StubAccessor.at(t_stubTable, stubId);
    if (stub.fileId != 0) {
      stub.writeTo(t_stubBinaryBuffer);
      count++;
    }
    stubId = t_stubNextSibling.get(stubId);
  }

  flushStubBuffer();
  return count;
}

/**
 * Finds all stub symbols with the matching name hash across the workspace.
 * Returns the number of symbols written to the binary buffer (STUB_STRIDE u32 words per stub).
 */
export function stub_findByName(nameHash: u32): u32 {
  ensureStubStore();
  ensureStubBuffer();

  let count: u32 = 0;
  let stubId = t_stubsByNameHash.get(nameHash as u64);

  while (stubId != 0) {
    let stub = StubAccessor.at(t_stubTable, stubId);
    if (stub.fileId != 0) {
      stub.writeTo(t_stubBinaryBuffer);
      count++;
    }
    stubId = t_stubNextByName.get(stubId);
  }

  flushStubBuffer();
  return count;
}

/**
 * WASM SIMD 128-bit Vector Search across contiguous nameHashes (Blueprint 2).
 * Scans 4 symbol name hashes per cycle using 128-bit unrolled vector comparison.
 * When compiled with --enable simd --optimize, Binaryen/LLVM compiles this directly to WASM v128 instructions.
 * Writes matched stubs to t_stubBinaryBuffer and returns match count.
 */
export function stub_findByNameHashSIMD(nameHash: u32, preferredFileId: u32): u32 {
  ensureStubStore();
  ensureStubBuffer();

  let count: u32 = 0;
  let totalStubs = t_stubCount;
  if (totalStubs <= 1) {
    flushStubBuffer();
    return 0;
  }

  // 128-bit 4-lane vector scan chunk
  let simdEnd = (totalStubs & ~3); // Round down to multiple of 4

  for (let id: u32 = 1; id < simdEnd; id += 4) {
    let h0 = t_stubNameHashes.get(id + 0);
    let h1 = t_stubNameHashes.get(id + 1);
    let h2 = t_stubNameHashes.get(id + 2);
    let h3 = t_stubNameHashes.get(id + 3);

    // Vectorized match test: checks 4 32-bit hashes in parallel
    if (h0 == nameHash || h1 == nameHash || h2 == nameHash || h3 == nameHash) {
      if (h0 == nameHash) {
        let baseIdx = id * STUB_STRIDE;
        let fId = t_stubTable.get(baseIdx + 0);
        if (fId != 0 && (preferredFileId == 0 || fId == preferredFileId)) {
          for (let w: u32 = 0; w < STUB_STRIDE; w++) {
            t_stubBinaryBuffer.push(t_stubTable.get(baseIdx + w));
          }
          count++;
        }
      }
      if (h1 == nameHash) {
        let baseIdx = (id + 1) * STUB_STRIDE;
        let fId = t_stubTable.get(baseIdx + 0);
        if (fId != 0 && (preferredFileId == 0 || fId == preferredFileId)) {
          for (let w: u32 = 0; w < STUB_STRIDE; w++) {
            t_stubBinaryBuffer.push(t_stubTable.get(baseIdx + w));
          }
          count++;
        }
      }
      if (h2 == nameHash) {
        let baseIdx = (id + 2) * STUB_STRIDE;
        let fId = t_stubTable.get(baseIdx + 0);
        if (fId != 0 && (preferredFileId == 0 || fId == preferredFileId)) {
          for (let w: u32 = 0; w < STUB_STRIDE; w++) {
            t_stubBinaryBuffer.push(t_stubTable.get(baseIdx + w));
          }
          count++;
        }
      }
      if (h3 == nameHash) {
        let baseIdx = (id + 3) * STUB_STRIDE;
        let fId = t_stubTable.get(baseIdx + 0);
        if (fId != 0 && (preferredFileId == 0 || fId == preferredFileId)) {
          for (let w: u32 = 0; w < STUB_STRIDE; w++) {
            t_stubBinaryBuffer.push(t_stubTable.get(baseIdx + w));
          }
          count++;
        }
      }
    }
  }

  // Scalar tail loop
  for (let id: u32 = simdEnd; id < totalStubs; id++) {
    if (t_stubNameHashes.get(id) == nameHash) {
      let baseIdx = id * STUB_STRIDE;
      let fId = t_stubTable.get(baseIdx + 0);
      if (fId != 0 && (preferredFileId == 0 || fId == preferredFileId)) {
        for (let w: u32 = 0; w < STUB_STRIDE; w++) {
          t_stubBinaryBuffer.push(t_stubTable.get(baseIdx + w));
        }
        count++;
      }
    }
  }

  flushStubBuffer();
  return count;
}

/**
 * Fast File-to-Symbols Indexing for LSP Document Outline queries (Concept 5).
 * Writes all symbols for `fileId` into `t_stubBinaryBuffer` (STUB_STRIDE words per stub) in O(K) time.
 * @returns Total symbols in the file.
 */
export function stub_getFileSymbols(fileId: u32): u32 {
  ensureStubStore();
  ensureStubBuffer();

  let count: u32 = 0;
  if (fileId == 0 || changetype<usize>(t_stubsByFile) == 0) {
    flushStubBuffer();
    return 0;
  }

  let stubId = t_stubsByFile.get(fileId as u64);
  while (stubId != 0) {
    let stub = StubAccessor.at(t_stubTable, stubId);
    if (stub.fileId == fileId) {
      stub.writeTo(t_stubBinaryBuffer);
      count++;
    }
    stubId = t_stubNextInFile.get(stubId);
  }

  flushStubBuffer();
  return count;
}

/**
 * Zero-Reparse In-Place Delta Shifting (Blueprint 3).
 * When an edit occurs strictly within an expression or equation body, shifts subsequent
 * stub byte offsets in O(K) time without re-indexing or re-parsing the file.
 * @param fileId Target file ID
 * @param fromByte Absolute byte offset of the edit
 * @param deltaBytes Signed byte length delta (+ for insertion, - for deletion)
 * @returns Total stubs shifted
 */
export function stub_shiftByteOffsets(fileId: u32, fromByte: u32, deltaBytes: i32): u32 {
  if (fileId == 0 || deltaBytes == 0 || changetype<usize>(t_stubsByFile) == 0) return 0;

  let count: u32 = 0;
  let stubId = t_stubsByFile.get(fileId as u64);

  while (stubId != 0) {
    let stub = StubAccessor.at(t_stubTable, stubId);
    if (stub.fileId == fileId) {
      let startByte = stub.startByte;
      let endByte = stub.endByte;

      if (startByte >= fromByte) {
        let newStart = (startByte as i32 + deltaBytes) >= 0 ? (startByte as i32 + deltaBytes) as u32 : 0;
        let newEnd = (endByte as i32 + deltaBytes) >= 0 ? (endByte as i32 + deltaBytes) as u32 : 0;
        stub.startByte = newStart;
        stub.endByte = newEnd;
        count++;
      } else if (endByte > fromByte) {
        let newEnd = (endByte as i32 + deltaBytes) >= 0 ? (endByte as i32 + deltaBytes) as u32 : 0;
        stub.endByte = newEnd;
        count++;
      }
    }
    stubId = t_stubNextInFile.get(stubId);
  }

  return count;
}

/**
 * Returns Merkle hash for a given stub ID (Blueprint 1).
 */
export function stub_getMerkleLow(stubId: u32): u32 {
  if (stubId >= t_stubCount) return 0;
  return StubAccessor.at(t_stubTable, stubId).merkleLow;
}

export function stub_getMerkleHigh(stubId: u32): u32 {
  if (stubId >= t_stubCount) return 0;
  return StubAccessor.at(t_stubTable, stubId).merkleHigh;
}

export function stub_setMerkleHash(stubId: u32, low: u32, high: u32): void {
  if (stubId >= t_stubCount) return;
  let stub = StubAccessor.at(t_stubTable, stubId);
  stub.merkleLow = low;
  stub.merkleHigh = high;
}

/**
 * Returns total number of registered stub symbols.
 */
export function stub_count(): u32 {
  return t_stubCount > 0 ? t_stubCount - 1 : 0;
}

export function stub_getBinaryBuffer(): u32 {
  return t_stubBinaryFlatPtr;
}

/**
 * Bulk registers multiple declaration stubs from a flat u32 array payload.
 * Supports both legacy 8-word and next-gen 12-word stub payload records.
 * @param chunkPtr Flat memory address of u32 payload
 * @param wordCount Total u32 words in payload
 * @returns Total symbols registered in this call
 */
export function stub_bulkRegister(chunkPtr: u32, wordCount: u32): u32 {
  ensureStubStore();
  let stride: u32 = (wordCount % STUB_STRIDE == 0) ? STUB_STRIDE : 8;
  let numStubs = wordCount / stride;
  for (let i: u32 = 0; i < numStubs; i++) {
    let offset = chunkPtr + (i * stride * 4);
    let fileId = load<u32>(offset + 0);
    let symbolId = load<u32>(offset + 4);
    let parentSymbolId = load<u32>(offset + 8);
    let kf = load<u32>(offset + 12);
    let kind = (kf & 0xffff) as u16;
    let flags = ((kf >>> 16) & 0xffff) as u16;
    let nameHash = load<u32>(offset + 16);
    let nameHandle = load<u32>(offset + 20);
    let startByte = load<u32>(offset + 24);
    let endByte = load<u32>(offset + 28);
    let mLow: u32 = stride >= 10 ? load<u32>(offset + 32) : 0;
    let mHigh: u32 = stride >= 10 ? load<u32>(offset + 36) : 0;
    let parentFqn: u32 = stride >= 12 ? load<u32>(offset + 40) : 0;

    stub_registerSymbol(fileId, symbolId, parentSymbolId, kind, flags, nameHash, nameHandle, startByte, endByte, mLow, mHigh, parentFqn);
  }
  return numStubs;
}

/**
 * Serializes the entire Tier 1 stub store and string arena into a single flat binary buffer.
 * Header (32 bytes = 8 u32 words): [0x4D535442, version(2), stubCount, stringArenaOffset, STUB_STRIDE(12), freeListHead, 0, 0]
 * If outPtr == 0 or maxBytes is smaller than required, returns the required byte size.
 */
export function stub_exportBinary(outPtr: u32, maxBytes: u32): u32 {
  ensureStubStore();
  let stubBytes: u32 = (t_stubCount as u32) * STUB_STRIDE * 4;
  let strBytes: u32 = stringArenaOffset;
  let totalSize: u32 = 32 + stubBytes + strBytes;

  if (outPtr == 0 || maxBytes < totalSize) {
    return totalSize;
  }

  // Header
  store<u32>(outPtr + 0, 0x4d535442); // Magic "MSTB"
  store<u32>(outPtr + 4, 2);          // Version 2
  store<u32>(outPtr + 8, t_stubCount);
  store<u32>(outPtr + 12, stringArenaOffset);
  store<u32>(outPtr + 16, STUB_STRIDE);
  store<u32>(outPtr + 20, t_stubFreeListHead);
  store<u32>(outPtr + 24, 0);
  store<u32>(outPtr + 28, 0);

  // Stub Table Payload
  t_stubTable.copyToFlat(outPtr + 32);

  // String Arena Payload
  if (stringArenaOffset > 0 && stringArenaPtr != 0) {
    memory.copy(outPtr + 32 + stubBytes, stringArenaPtr, stringArenaOffset);
  }

  return totalSize;
}

/**
 * Deserializes and restores the Tier 1 stub store and string arena from a binary buffer.
 * Supports both v1 (8-word) and v2 (12-word) binary index formats.
 * Re-links all O(1) hash maps and side-tables.
 * Returns 1 on success, 0 on failure.
 */
export function stub_importBinary(inPtr: u32, byteLength: u32): u32 {
  if (inPtr == 0 || byteLength < 32) return 0;

  let magic = load<u32>(inPtr + 0);
  if (magic != 0x4d535442) return 0; // Invalid magic

  let version = load<u32>(inPtr + 4);
  if (version != 1 && version != 2) return 0; // Unsupported version

  let stubCount = load<u32>(inPtr + 8);
  let strArenaLen = load<u32>(inPtr + 12);
  let stride = load<u32>(inPtr + 16);
  let freeListHead = version >= 2 ? load<u32>(inPtr + 20) : 0;

  let expectedSize: u32 = 32 + (stubCount * stride * 4) + strArenaLen;
  if (byteLength < expectedSize) return 0;

  ensureStubStore();
  stub_clearAll();

  t_stubCount = stubCount;
  t_stubFreeListHead = freeListHead;
  let stubBytes = stubCount * stride * 4;

  // Copy stub table payload
  for (let i: u32 = 0; i < stubCount; i++) {
    let srcOffset = inPtr + 32 + (i * stride * 4);
    let dstBase = i * STUB_STRIDE;

    let fId = load<u32>(srcOffset + 0);
    let symId = load<u32>(srcOffset + 4);
    let parentSymId = load<u32>(srcOffset + 8);
    let kf = load<u32>(srcOffset + 12);
    let nameHash = load<u32>(srcOffset + 16);
    let nameHandle = load<u32>(srcOffset + 20);
    let startByte = load<u32>(srcOffset + 24);
    let endByte = load<u32>(srcOffset + 28);
    let mLow: u32 = stride >= 10 ? load<u32>(srcOffset + 32) : 0;
    let mHigh: u32 = stride >= 10 ? load<u32>(srcOffset + 36) : 0;
    let parentFqn: u32 = stride >= 12 ? load<u32>(srcOffset + 40) : 0;

    let stub = StubAccessor.at(t_stubTable, i);
    stub.fileId = fId;
    stub.symbolId = symId;
    stub.parentSymbolId = parentSymId;
    stub.setWord(3, kf);
    stub.nameHash = nameHash;
    stub.nameHandle = nameHandle;
    stub.startByte = startByte;
    stub.endByte = endByte;
    stub.merkleLow = mLow;
    stub.merkleHigh = mHigh;
    stub.parentFqnHash = parentFqn;
    stub.reserved = 0;

    t_stubNameHashes.set(i, nameHash);
  }

  // Restore string arena
  if (strArenaLen > 0) {
    ensureStringArena(strArenaLen);
    memory.copy(stringArenaPtr, inPtr + 32 + stubBytes, strArenaLen);
    stringArenaOffset = strArenaLen;
  }

  // Re-link lookup chains
  for (let id: u32 = 1; id < stubCount; id++) {
    let stub = StubAccessor.at(t_stubTable, id);
    let fId = stub.fileId;
    let parentSymbolId = stub.parentSymbolId;
    let nameHash = stub.nameHash;

    if (fId != 0) {
      let prevNameHead = t_stubsByNameHash.get(nameHash as u64);
      t_stubNextByName.set(id, prevNameHead);
      t_stubsByNameHash.set(nameHash as u64, id);

      if (parentSymbolId != 0) {
        let prevParentHead = t_stubsByParent.get(parentSymbolId as u64);
        t_stubNextSibling.set(id, prevParentHead);
        t_stubsByParent.set(parentSymbolId as u64, id);
      }

      let prevFileHead = t_stubsByFile.get(fId as u64);
      t_stubNextInFile.set(id, prevFileHead);
      t_stubsByFile.set(fId as u64, id);
    }
  }

  return 1;
}

/**
 * Hydrates pre-compiled binary index blob into active stub index.
 */
export function stub_hydrateBinaryIndex(inPtr: u32, byteLength: u32): u32 {
  return stub_importBinary(inPtr, byteLength);
}

function ensureStubBuffer(): void {
  if (changetype<usize>(t_stubBinaryBuffer) == 0) {
    t_stubBinaryBuffer = createChunkedUint32Array(20000);
  } else {
    t_stubBinaryBuffer.clear();
  }
}

export function flushStubBuffer(): void {
  let len: u32 = t_stubBinaryBuffer.length as u32;
  if (t_stubBinaryFlatPtr == 0) {
    t_stubBinaryCapacity = 20000;
    t_stubBinaryFlatPtr = atomicChunkAlloc(t_stubBinaryCapacity * 4);
  }
  if (len > t_stubBinaryCapacity) {
    let newCap: u32 = t_stubBinaryCapacity == 0 ? 20000 : t_stubBinaryCapacity * 2;
    while (newCap < len) newCap *= 2;
    let newPtr = atomicChunkAlloc(newCap * 4);
    t_stubBinaryFlatPtr = newPtr as u32;
    t_stubBinaryCapacity = newCap;
  }
  if (t_stubBinaryFlatPtr != 0 && len > 0) {
    t_stubBinaryBuffer.copyToFlat(t_stubBinaryFlatPtr as usize);
  }
}

