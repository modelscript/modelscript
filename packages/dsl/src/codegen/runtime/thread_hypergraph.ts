/* eslint-disable */
// @ts-nocheck
/**
 * @fileoverview WASM N-Ary Digital Thread Alignment Hypergraph
 *
 * Implements an N-way hypergraph alignment index in linear memory, superseding pairwise
 * TGG triples with a central federated thread fabric linking SysML, Modelica, CAD,
 * Requirements, and BOM without O(N^2) synchronizer explosion.
 */

import { ChunkedUint32Array, createChunkedUint32Array } from "./array";
import { UnmanagedMap64, createMap64 } from "./hashmap";
import { atomicChunkAlloc } from "./arena";

export const MAX_THREAD_DOMAINS: u32 = 8;
// Thread Record Layout:
// [0]: threadId
// [1]: domainMask (bit i set if domain i is bound)
// [2]: status / flags (0x1 = SYNCED, 0x2 = STALE, 0x4 = CONFLICT, 0x8 = REMOVED)
// [3]: revision
// [4 .. 4 + MAX_THREAD_DOMAINS - 1]: domainNodeIds (0 to 7)
export const THREAD_HEADER_WORDS: u32 = 4;
export const THREAD_STRIDE: u32 = THREAD_HEADER_WORDS + MAX_THREAD_DOMAINS;

export const THREAD_FIELD_ID: u32 = 0;
export const THREAD_FIELD_MASK: u32 = 1;
export const THREAD_FIELD_STATUS: u32 = 2;
export const THREAD_FIELD_REVISION: u32 = 3;

export const THREAD_STATUS_SYNCED: u32 = 0x0001;
export const THREAD_STATUS_STALE: u32 = 0x0002;
export const THREAD_STATUS_CONFLICT: u32 = 0x0004;
export const THREAD_STATUS_REMOVED: u32 = 0x0008;

@unmanaged
export class ThreadHypergraph {
  data: ChunkedUint32Array;
  count: u32;
  // Map composite key ((domainIdx as u64) << 32) | (nodeId as u64) -> threadSlot + 1
  nodeToThreadSlot: UnmanagedMap64;
  threadIdToSlot: UnmanagedMap64;

  init(initialCapacity: u32 = 512): void {
    this.data = createChunkedUint32Array(initialCapacity * THREAD_STRIDE);
    this.count = 0;
    this.nodeToThreadSlot = changetype<UnmanagedMap64>(createMap64());
    this.threadIdToSlot = changetype<UnmanagedMap64>(createMap64());
  }

  @inline
  createThread(threadId: u32, revision: u32 = 0): u32 {
    let existingSlotPlusOne = this.threadIdToSlot.get(threadId as u64);
    if (existingSlotPlusOne != 0) return existingSlotPlusOne - 1;

    let slot = this.count++;
    let offset = slot * THREAD_STRIDE;
    this.data.set(offset + THREAD_FIELD_ID, threadId);
    this.data.set(offset + THREAD_FIELD_MASK, 0);
    this.data.set(offset + THREAD_FIELD_STATUS, THREAD_STATUS_SYNCED);
    this.data.set(offset + THREAD_FIELD_REVISION, revision);
    this.threadIdToSlot.set(threadId as u64, slot + 1);

    for (let d: u32 = 0; d < MAX_THREAD_DOMAINS; d++) {
      this.data.set(offset + THREAD_HEADER_WORDS + d, 0);
    }
    return slot;
  }

  @inline
  findSlotByThreadId(threadId: u32): u32 {
    let slotPlusOne = this.threadIdToSlot.get(threadId as u64);
    if (slotPlusOne == 0) return 0xffffffff;
    return slotPlusOne - 1;
  }

  @inline
  bindDomainNode(slot: u32, domainIdx: u32, nodeId: u32): void {
    if (slot >= this.count || domainIdx >= MAX_THREAD_DOMAINS) return;
    let offset = slot * THREAD_STRIDE;

    let mask = this.data.get(offset + THREAD_FIELD_MASK);
    mask |= (1 << domainIdx);
    this.data.set(offset + THREAD_FIELD_MASK, mask);
    this.data.set(offset + THREAD_HEADER_WORDS + domainIdx, nodeId);

    // Register reverse lookup key: domainIdx << 32 | nodeId
    let key: u64 = ((domainIdx as u64) << 32) | (nodeId as u64);
    this.nodeToThreadSlot.set(key, slot + 1);
  }

  @inline
  getDomainNode(slot: u32, domainIdx: u32): u32 {
    if (slot >= this.count || domainIdx >= MAX_THREAD_DOMAINS) return 0;
    return this.data.get(slot * THREAD_STRIDE + THREAD_HEADER_WORDS + domainIdx);
  }

  @inline
  findThreadByDomainNode(domainIdx: u32, nodeId: u32): u32 {
    let key: u64 = ((domainIdx as u64) << 32) | (nodeId as u64);
    let slotPlusOne = this.nodeToThreadSlot.get(key);
    if (slotPlusOne == 0) return 0;
    let slot = slotPlusOne - 1;
    let offset = slot * THREAD_STRIDE;
    let status = this.data.get(offset + THREAD_FIELD_STATUS);
    if ((status & THREAD_STATUS_REMOVED) != 0) return 0;
    return this.data.get(offset + THREAD_FIELD_ID);
  }

  @inline
  markStale(slot: u32): void {
    if (slot >= this.count) return;
    let offset = slot * THREAD_STRIDE + THREAD_FIELD_STATUS;
    let status = this.data.get(offset) | THREAD_STATUS_STALE;
    this.data.set(offset, status);
  }

  @inline
  isStale(slot: u32): boolean {
    if (slot >= this.count) return false;
    let offset = slot * THREAD_STRIDE + THREAD_FIELD_STATUS;
    return (this.data.get(offset) & THREAD_STATUS_STALE) != 0;
  }

  @inline
  markConflict(slot: u32): void {
    if (slot >= this.count) return;
    let offset = slot * THREAD_STRIDE + THREAD_FIELD_STATUS;
    let status = this.data.get(offset) | THREAD_STATUS_CONFLICT;
    this.data.set(offset, status);
  }

  @inline
  clearConflict(slot: u32): void {
    if (slot >= this.count) return;
    let offset = slot * THREAD_STRIDE + THREAD_FIELD_STATUS;
    let status = this.data.get(offset) & ~THREAD_STATUS_CONFLICT;
    this.data.set(offset, status);
  }

  @inline
  markRemoved(slot: u32): void {
    if (slot >= this.count) return;
    let offset = slot * THREAD_STRIDE + THREAD_FIELD_STATUS;
    let status = this.data.get(offset) | THREAD_STATUS_REMOVED;
    this.data.set(offset, status);
  }

  @inline
  isRemoved(slot: u32): boolean {
    if (slot >= this.count) return false;
    let offset = slot * THREAD_STRIDE + THREAD_FIELD_STATUS;
    return (this.data.get(offset) & THREAD_STATUS_REMOVED) != 0;
  }
}

export function createThreadHypergraph(initialCapacity: u32 = 512): usize {
  let ptr = atomicChunkAlloc(sizeof<ThreadHypergraph>());
  let hg = changetype<ThreadHypergraph>(ptr);
  hg.init(initialCapacity);
  return ptr;
}

export function thread_create(ptr: usize, threadId: u32, revision: u32): u32 {
  return changetype<ThreadHypergraph>(ptr).createThread(threadId, revision);
}

export function thread_bind(ptr: usize, slot: u32, domainIdx: u32, nodeId: u32): void {
  changetype<ThreadHypergraph>(ptr).bindDomainNode(slot, domainIdx, nodeId);
}

export function thread_getNode(ptr: usize, slot: u32, domainIdx: u32): u32 {
  return changetype<ThreadHypergraph>(ptr).getDomainNode(slot, domainIdx);
}

export function thread_findByNode(ptr: usize, domainIdx: u32, nodeId: u32): u32 {
  return changetype<ThreadHypergraph>(ptr).findThreadByDomainNode(domainIdx, nodeId);
}

export function thread_markStale(ptr: usize, slot: u32): void {
  changetype<ThreadHypergraph>(ptr).markStale(slot);
}

export function thread_isStale(ptr: usize, slot: u32): u32 {
  return changetype<ThreadHypergraph>(ptr).isStale(slot) ? 1 : 0;
}

export function thread_markRemoved(ptr: usize, slot: u32): void {
  changetype<ThreadHypergraph>(ptr).markRemoved(slot);
}

export function thread_findByThreadId(ptr: usize, threadId: u32): u32 {
  return changetype<ThreadHypergraph>(ptr).findSlotByThreadId(threadId);
}
