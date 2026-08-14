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
    t_stubTable = createChunkedUint32Array(500000 * STUB_STRIDE);
    t_stubNextByName = createChunkedUint32Array(500000);
    t_stubNextSibling = createChunkedUint32Array(500000);
    t_stubNextInFile = createChunkedUint32Array(500000);

    t_stubsByNameHash = changetype<UnmanagedMap64>(createMap64());
    t_stubsByParent = changetype<UnmanagedMap64>(createMap64());
    t_stubsByFile = changetype<UnmanagedMap64>(createMap64());

    t_stubBinaryBuffer = createChunkedUint32Array(20000);
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

function ensureStubBuffer(): void {
  if (changetype<usize>(t_stubBinaryBuffer) == 0) {
    t_stubBinaryBuffer = createChunkedUint32Array(20000);
  } else {
    t_stubBinaryBuffer.clear();
  }
}

function flushStubBuffer(): void {
  let len: u32 = t_stubBinaryBuffer.length as u32;
  if (len > t_stubBinaryCapacity) {
    let newCap: u32 = t_stubBinaryCapacity == 0 ? 20000 : t_stubBinaryCapacity * 2;
    while (newCap < len) newCap *= 2;
    let newPtr = atomicChunkAlloc(newCap * 4);
    t_stubBinaryFlatPtr = newPtr as u32;
    t_stubBinaryCapacity = newCap;
  }
  t_stubBinaryBuffer.copyToFlat(t_stubBinaryFlatPtr as usize);
}
