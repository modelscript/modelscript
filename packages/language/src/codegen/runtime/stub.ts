/* eslint-disable */
// @ts-nocheck
import { atomicChunkAlloc, ensureStringArena, stringArenaOffset, stringArenaPtr } from "./arena";
import { ChunkedUint32Array, createChunkedUint32Array } from "./array";
import { UnmanagedMap64, createMap64 } from "./hashmap";

/**
 * ----------------------------------------------------------------------------
 * Tier 1 Declaration Stub Index (Persistent Zero-GC WASM Store)
 * ----------------------------------------------------------------------------
 *
 * Stores lightweight declaration headers (packages, classes, models, functions,
 * fields, types, and inheritance relations) in unmanaged WASM memory.
 *
 * Memory Layout per Stub Symbol (32 bytes = 8 u32 words):
 *  word 0: fileId (u32)
 *  word 1: symbolId (u32)
 *  word 2: parentSymbolId (u32)
 *  word 3: kind (u16) | (flags (u16) << 16)
 *  word 4: nameHash (u32, DJB2 / FNV-1a hash of symbol identifier)
 *  word 5: nameHandle (u32, offset into stringArena)
 *  word 6: startByte (u32)
 *  word 7: endByte (u32)
 */

export const STUB_STRIDE: u32 = 8;

export let t_stubTable: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let t_stubCount: u32 = 1; // 1-indexed, 0 is null

// Linked list side-tables for O(1) multi-indexing
export let t_stubNextByName: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let t_stubNextSibling: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let t_stubNextInFile: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);

// Fast open-addressing lookup maps
export let t_stubsByNameHash: UnmanagedMap64 = changetype<UnmanagedMap64>(0);
export let t_stubsByParent: UnmanagedMap64 = changetype<UnmanagedMap64>(0);
export let t_stubsByFile: UnmanagedMap64 = changetype<UnmanagedMap64>(0);

// Binary serialization buffer pointer for returning stub queries to JS
export let t_stubBinaryBuffer: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let t_stubBinaryFlatPtr: u32 = 0;
let t_stubBinaryCapacity: u32 = 0;

export function ensureStubStore(): void {
  if (changetype<usize>(t_stubTable) == 0) {
    t_stubTable = createChunkedUint32Array(2000 * STUB_STRIDE);
    t_stubNextByName = createChunkedUint32Array(2000);
    t_stubNextSibling = createChunkedUint32Array(2000);
    t_stubNextInFile = createChunkedUint32Array(2000);

    t_stubsByNameHash = changetype<UnmanagedMap64>(createMap64());
    t_stubsByParent = changetype<UnmanagedMap64>(createMap64());
    t_stubsByFile = changetype<UnmanagedMap64>(createMap64());

    t_stubBinaryBuffer = createChunkedUint32Array(2000);
    t_stubBinaryCapacity = 2000;
    t_stubBinaryFlatPtr = atomicChunkAlloc(2000 * 4);
    t_stubCount = 1;
  }
}

/**
 * Registers a declaration stub in the persistent Tier 1 index.
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
): u32 {
  ensureStubStore();

  let id = t_stubCount++;
  let baseIdx = id * STUB_STRIDE;

  t_stubTable.set(baseIdx + 0, fileId);
  t_stubTable.set(baseIdx + 1, symbolId);
  t_stubTable.set(baseIdx + 2, parentSymbolId);
  t_stubTable.set(baseIdx + 3, (kind as u32) | ((flags as u32) << 16));
  t_stubTable.set(baseIdx + 4, nameHash);
  t_stubTable.set(baseIdx + 5, nameHandle);
  t_stubTable.set(baseIdx + 6, startByte);
  t_stubTable.set(baseIdx + 7, endByte);

  // Link into byNameHash chain
  let prevNameHead = t_stubsByNameHash.get(nameHash as u64);
  t_stubNextByName.set(id, prevNameHead);
  t_stubsByNameHash.set(nameHash as u64, id);

  // Link into byParent (children) chain
  if (parentSymbolId != 0) {
    let prevParentHead = t_stubsByParent.get(parentSymbolId as u64);
    t_stubNextSibling.set(id, prevParentHead);
    t_stubsByParent.set(parentSymbolId as u64, id);
  }

  // Link into byFile chain
  if (fileId != 0) {
    let prevFileHead = t_stubsByFile.get(fileId as u64);
    t_stubNextInFile.set(id, prevFileHead);
    t_stubsByFile.set(fileId as u64, id);
  }

  return id;
}

/**
 * Clears all stubs associated with a specific fileId (e.g. before re-indexing on edit).
 */
export function stub_clearFile(fileId: u32): void {
  if (changetype<usize>(t_stubsByFile) == 0 || fileId == 0) return;

  let stubId = t_stubsByFile.get(fileId as u64);
  while (stubId != 0) {
    let baseIdx = stubId * STUB_STRIDE;
    // Mark as inactive by zeroing fileId and symbolId
    t_stubTable.set(baseIdx + 0, 0);
    t_stubTable.set(baseIdx + 1, 0);

    stubId = t_stubNextInFile.get(stubId);
  }
  t_stubsByFile.set(fileId as u64, 0);
}

/**
 * Clears all indexed stubs in the entire Tier 1 stub store.
 */
export function stub_clearAll(): void {
  if (changetype<usize>(t_stubTable) != 0) {
    t_stubTable.clear();
    t_stubNextByName.clear();
    t_stubNextSibling.clear();
    t_stubNextInFile.clear();
    t_stubsByNameHash.init();
    t_stubsByParent.init();
    t_stubsByFile.init();
    t_stubCount = 1;
  }
}

/**
 * Fast Tier 1 Go-to-Definition:
 * Looks up the declaration matching `nameHash`.
 * Returns 3-tuple [fileId, startByte, endByte] or 0 if not found in Tier 1.
 */
export function stub_getDefinition(nameHash: u32, preferredFileId: u32 = 0): u32 {
  if (changetype<usize>(t_stubsByNameHash) == 0 || nameHash == 0) return 0;

  let stubId = t_stubsByNameHash.get(nameHash as u64);
  let bestStubId: u32 = 0;

  while (stubId != 0) {
    let baseIdx = stubId * STUB_STRIDE;
    let fId = t_stubTable.get(baseIdx + 0);

    if (fId != 0) {
      if (preferredFileId != 0 && fId == preferredFileId) {
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

  let baseIdx = bestStubId * STUB_STRIDE;
  let targetFileId = t_stubTable.get(baseIdx + 0);
  let startByte = t_stubTable.get(baseIdx + 6);
  let endByte = t_stubTable.get(baseIdx + 7);

  ensureStubBuffer();
  t_stubBinaryBuffer.push(targetFileId);
  t_stubBinaryBuffer.push(startByte);
  t_stubBinaryBuffer.push(endByte);
  flushStubBuffer();

  return 3;
}

/**
 * Queries all child symbols of a given parent symbol ID.
 * Returns the number of symbols written to the binary buffer (8 u32 words per stub).
 */
export function stub_getChildren(parentSymbolId: u32): u32 {
  ensureStubStore();
  ensureStubBuffer();

  let count: u32 = 0;
  let stubId = t_stubsByParent.get(parentSymbolId as u64);

  while (stubId != 0) {
    let baseIdx = stubId * STUB_STRIDE;
    let fId = t_stubTable.get(baseIdx + 0);

    if (fId != 0) {
      for (let w: u32 = 0; w < STUB_STRIDE; w++) {
        t_stubBinaryBuffer.push(t_stubTable.get(baseIdx + w));
      }
      count++;
    }
    stubId = t_stubNextSibling.get(stubId);
  }

  flushStubBuffer();
  return count;
}

/**
 * Finds all stub symbols with the matching name hash across the workspace.
 * Returns the number of symbols written to the binary buffer (8 u32 words per stub).
 */
export function stub_findByName(nameHash: u32): u32 {
  ensureStubStore();
  ensureStubBuffer();

  let count: u32 = 0;
  let stubId = t_stubsByNameHash.get(nameHash as u64);

  while (stubId != 0) {
    let baseIdx = stubId * STUB_STRIDE;
    let fId = t_stubTable.get(baseIdx + 0);

    if (fId != 0) {
      for (let w: u32 = 0; w < STUB_STRIDE; w++) {
        t_stubBinaryBuffer.push(t_stubTable.get(baseIdx + w));
      }
      count++;
    }
    stubId = t_stubNextByName.get(stubId);
  }

  flushStubBuffer();
  return count;
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
 * Payload layout per stub (8 u32 words): [fileId, symbolId, parentSymbolId, (kind | (flags << 16)), nameHash, nameHandle, startByte, endByte]
 * @param chunkPtr Flat memory address of u32 payload
 * @param wordCount Total u32 words in payload (must be multiple of 8)
 * @returns Total symbols registered in this call
 */
export function stub_bulkRegister(chunkPtr: u32, wordCount: u32): u32 {
  ensureStubStore();
  let numStubs = wordCount / STUB_STRIDE;
  for (let i: u32 = 0; i < numStubs; i++) {
    let offset = chunkPtr + (i * STUB_STRIDE * 4);
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

    stub_registerSymbol(fileId, symbolId, parentSymbolId, kind, flags, nameHash, nameHandle, startByte, endByte);
  }
  return numStubs;
}

/**
 * Serializes the entire Tier 1 stub store and string arena into a single flat binary buffer.
 * Header (32 bytes = 8 u32 words): [0x4D535442, version(1), stubCount, stringArenaOffset, STUB_STRIDE(8), 0, 0, 0]
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
  store<u32>(outPtr + 4, 1);          // Version 1
  store<u32>(outPtr + 8, t_stubCount);
  store<u32>(outPtr + 12, stringArenaOffset);
  store<u32>(outPtr + 16, STUB_STRIDE);
  store<u32>(outPtr + 20, 0);
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
 * Re-links all O(1) hash maps and side-tables.
 * Returns 1 on success, 0 on failure.
 */
export function stub_importBinary(inPtr: u32, byteLength: u32): u32 {
  if (inPtr == 0 || byteLength < 32) return 0;

  let magic = load<u32>(inPtr + 0);
  if (magic != 0x4d535442) return 0; // Invalid magic

  let version = load<u32>(inPtr + 4);
  if (version != 1) return 0; // Unsupported version

  let stubCount = load<u32>(inPtr + 8);
  let strArenaLen = load<u32>(inPtr + 12);
  let stride = load<u32>(inPtr + 16);

  let expectedSize: u32 = 32 + (stubCount * stride * 4) + strArenaLen;
  if (byteLength < expectedSize) return 0;

  ensureStubStore();

  // Clear current maps
  t_stubsByNameHash = changetype<UnmanagedMap64>(createMap64());
  t_stubsByParent = changetype<UnmanagedMap64>(createMap64());
  t_stubsByFile = changetype<UnmanagedMap64>(createMap64());

  t_stubCount = stubCount;
  let stubBytes = stubCount * stride * 4;

  // Copy stub table payload
  for (let i: u32 = 0; i < stubCount * stride; i++) {
    let val = load<u32>(inPtr + 32 + (i * 4));
    t_stubTable.set(i, val);
  }

  // Restore string arena
  if (strArenaLen > 0) {
    ensureStringArena(strArenaLen);
    memory.copy(stringArenaPtr, inPtr + 32 + stubBytes, strArenaLen);
    stringArenaOffset = strArenaLen;
  }

  // Re-link lookup chains
  for (let id: u32 = 1; id < stubCount; id++) {
    let baseIdx = id * STUB_STRIDE;
    let fId = t_stubTable.get(baseIdx + 0);
    let parentSymbolId = t_stubTable.get(baseIdx + 2);
    let nameHash = t_stubTable.get(baseIdx + 4);

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

