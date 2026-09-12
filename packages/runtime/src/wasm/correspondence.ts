/* eslint-disable */
// @ts-nocheck
/**
 * @fileoverview WASM Triple Graph Grammar (TGG) Correspondence Index
 *
 * Implements the correspondence graph ($C$) in linear WASM memory.
 * Maintains bidirectional alignment links between source AST nodes and target AST nodes
 * with O(1) hash map lookups and Salsa-compatible revision tracking for incremental updates.
 */

import { ChunkedUint32Array, createChunkedUint32Array } from "./array";
import { UnmanagedMap64, createMap64 } from "./hashmap";
import { atomicChunkAlloc } from "./arena";

export const CORR_FLAG_SYNCED: u16 = 0x0001;
export const CORR_FLAG_STALE: u16 = 0x0002;
export const CORR_FLAG_USER_OVERRIDE: u16 = 0x0004;
export const CORR_FLAG_CONFLICT: u16 = 0x0008;
export const CORR_FLAG_REMOVED: u16 = 0x0010;

export const CORR_STRIDE = 6;
export const CORR_SOURCE = 0;
export const CORR_TARGET = 1;
export const CORR_META = 2; // packed (u16 ruleId << 16) | (u16 flags)
export const CORR_REVISION = 3;
export const CORR_COMPLEMENT_PTR = 4;
export const CORR_THREAD_ID = 5;

/**
 * Struct-of-Arrays (SoA) Correspondence Index for zero-GC polyglot model transformation.
 */
@unmanaged
export class CorrespondenceIndex {
  data: ChunkedUint32Array;
  count: u32;
  sourceToSlot: UnmanagedMap64;
  targetToSlot: UnmanagedMap64;

  init(initialCapacity: u32 = 1024): void {
    this.data = createChunkedUint32Array(initialCapacity * CORR_STRIDE);
    this.count = 0;
    this.sourceToSlot = changetype<UnmanagedMap64>(createMap64());
    this.targetToSlot = changetype<UnmanagedMap64>(createMap64());
  }

  /**
   * Registers or updates a correspondence link between a source node and target node.
   */
  @inline
  addLink(sourceNodeId: u32, targetNodeId: u32, ruleId: u16, flags: u16 = CORR_FLAG_SYNCED, revision: u32 = 0): u32 {
    let key: u64 = sourceNodeId as u64;
    let existingSlotPlusOne = this.sourceToSlot.get(key);

    let slot: u32;
    if (existingSlotPlusOne != 0) {
      slot = existingSlotPlusOne - 1;
      let offsetOld = slot * CORR_STRIDE;
      let oldTarget = this.data.get(offsetOld + CORR_TARGET);
      if (oldTarget != targetNodeId) {
        if (oldTarget != 0) this.targetToSlot.set(oldTarget as u64, 0);
        this.targetToSlot.set(targetNodeId as u64, slot + 1);
      }
    } else {
      slot = this.count++;
      this.sourceToSlot.set(key, slot + 1);
      this.targetToSlot.set(targetNodeId as u64, slot + 1);
    }

    let offset = slot * CORR_STRIDE;
    let meta: u32 = ((ruleId as u32) << 16) | (flags as u32);

    this.data.set(offset + CORR_SOURCE, sourceNodeId);
    this.data.set(offset + CORR_TARGET, targetNodeId);
    this.data.set(offset + CORR_META, meta);
    this.data.set(offset + CORR_REVISION, revision);
    this.data.set(offset + CORR_COMPLEMENT_PTR, 0);
    this.data.set(offset + CORR_THREAD_ID, 0);

    return slot;
  }

  /**
   * O(1) lookup of target node ID given a source node ID.
   * Returns 0 if no correspondence link exists or if marked removed.
   */
  @inline
  findBySource(sourceNodeId: u32): u32 {
    let slotPlusOne = this.sourceToSlot.get(sourceNodeId as u64);
    if (slotPlusOne == 0) return 0;
    let slot = slotPlusOne - 1;
    if (this.isRemoved(slot)) return 0;
    let offset = slot * CORR_STRIDE;
    return this.data.get(offset + CORR_TARGET);
  }

  /**
   * O(1) reverse lookup of source node ID given a target node ID.
   * Returns 0 if no correspondence link exists or if marked removed.
   */
  @inline
  findByTarget(targetNodeId: u32): u32 {
    let slotPlusOne = this.targetToSlot.get(targetNodeId as u64);
    if (slotPlusOne == 0) return 0;
    let slot = slotPlusOne - 1;
    if (this.isRemoved(slot)) return 0;
    let offset = slot * CORR_STRIDE;
    return this.data.get(offset + CORR_SOURCE);
  }

  /**
   * Marks the correspondence link for a given source node as STALE.
   */
  @inline
  markStale(sourceNodeId: u32): void {
    let slotPlusOne = this.sourceToSlot.get(sourceNodeId as u64);
    if (slotPlusOne == 0) return;
    let slot = slotPlusOne - 1;
    let offset = slot * CORR_STRIDE + CORR_META;
    let meta = this.data.get(offset);
    let ruleId = (meta >>> 16) as u16;
    let flags = ((meta & 0xffff) as u16) | CORR_FLAG_STALE;
    this.data.set(offset, ((ruleId as u32) << 16) | (flags as u32));
  }

  @inline
  isStale(slot: u32): boolean {
    if (slot >= this.count) return false;
    let offset = slot * CORR_STRIDE + CORR_META;
    return (this.data.get(offset) & CORR_FLAG_STALE) != 0;
  }

  @inline
  getSource(slot: u32): u32 {
    if (slot >= this.count) return 0;
    return this.data.get(slot * CORR_STRIDE + CORR_SOURCE);
  }

  @inline
  getTarget(slot: u32): u32 {
    if (slot >= this.count) return 0;
    return this.data.get(slot * CORR_STRIDE + CORR_TARGET);
  }

  @inline
  getRule(slot: u32): u16 {
    if (slot >= this.count) return 0;
    return (this.data.get(slot * CORR_STRIDE + CORR_META) >>> 16) as u16;
  }

  @inline
  getFlags(slot: u32): u16 {
    if (slot >= this.count) return 0;
    return (this.data.get(slot * CORR_STRIDE + CORR_META) & 0xffff) as u16;
  }

  @inline
  isConflicted(slot: u32): boolean {
    if (slot >= this.count) return false;
    let offset = slot * CORR_STRIDE + CORR_META;
    return (this.data.get(offset) & CORR_FLAG_CONFLICT) != 0;
  }

  @inline
  markConflict(slot: u32): void {
    if (slot >= this.count) return;
    let offset = slot * CORR_STRIDE + CORR_META;
    let meta = this.data.get(offset);
    let ruleId = (meta >>> 16) as u16;
    let flags = ((meta & 0xffff) as u16) | CORR_FLAG_CONFLICT;
    this.data.set(offset, ((ruleId as u32) << 16) | (flags as u32));
  }

  @inline
  clearConflict(slot: u32): void {
    if (slot >= this.count) return;
    let offset = slot * CORR_STRIDE + CORR_META;
    let meta = this.data.get(offset);
    let ruleId = (meta >>> 16) as u16;
    let flags = ((meta & 0xffff) as u16) & ~CORR_FLAG_CONFLICT;
    this.data.set(offset, ((ruleId as u32) << 16) | (flags as u32));
  }

  @inline
  isRemoved(slot: u32): boolean {
    if (slot >= this.count) return false;
    let offset = slot * CORR_STRIDE + CORR_META;
    return (this.data.get(offset) & CORR_FLAG_REMOVED) != 0;
  }

  @inline
  markRemoved(slot: u32): void {
    if (slot >= this.count) return;
    let offset = slot * CORR_STRIDE + CORR_META;
    let meta = this.data.get(offset);
    let ruleId = (meta >>> 16) as u16;
    let flags = ((meta & 0xffff) as u16) | CORR_FLAG_REMOVED;
    this.data.set(offset, ((ruleId as u32) << 16) | (flags as u32));
  }

  @inline
  retractBySource(sourceNodeId: u32): u32 {
    let slotPlusOne = this.sourceToSlot.get(sourceNodeId as u64);
    if (slotPlusOne == 0) return 0;
    let slot = slotPlusOne - 1;
    if (this.isRemoved(slot)) return 0;
    this.markRemoved(slot);
    let offset = slot * CORR_STRIDE;
    return this.data.get(offset + CORR_TARGET);
  }

  @inline
  retractByTarget(targetNodeId: u32): u32 {
    let slotPlusOne = this.targetToSlot.get(targetNodeId as u64);
    if (slotPlusOne == 0) return 0;
    let slot = slotPlusOne - 1;
    if (this.isRemoved(slot)) return 0;
    this.markRemoved(slot);
    let offset = slot * CORR_STRIDE;
    return this.data.get(offset + CORR_SOURCE);
  }

  @inline
  getComplement(slot: u32): u32 {
    if (slot >= this.count) return 0;
    return this.data.get(slot * CORR_STRIDE + CORR_COMPLEMENT_PTR);
  }

  @inline
  setComplement(slot: u32, ptr: u32): void {
    if (slot >= this.count) return;
    this.data.set(slot * CORR_STRIDE + CORR_COMPLEMENT_PTR, ptr);
  }

  @inline
  getThreadId(slot: u32): u32 {
    if (slot >= this.count) return 0;
    return this.data.get(slot * CORR_STRIDE + CORR_THREAD_ID);
  }

  @inline
  setThreadId(slot: u32, threadId: u32): void {
    if (slot >= this.count) return;
    this.data.set(slot * CORR_STRIDE + CORR_THREAD_ID, threadId);
  }

  @inline
  getRevision(slot: u32): u32 {
    if (slot >= this.count) return 0;
    return this.data.get(slot * CORR_STRIDE + CORR_REVISION);
  }

  @inline
  setRevision(slot: u32, revision: u32): void {
    if (slot >= this.count) return;
    this.data.set(slot * CORR_STRIDE + CORR_REVISION, revision);
  }

  @inline
  reset(): void {
    this.count = 0;
    if (this.sourceToSlot != null) this.sourceToSlot.init();
    if (this.targetToSlot != null) this.targetToSlot.init();
  }
}

/**
 * Creates and initializes a new CorrespondenceIndex in WASM linear memory.
 */
export function createCorrespondenceIndex(initialCapacity: u32 = 1024): usize {
  let ptr = atomicChunkAlloc(sizeof<CorrespondenceIndex>());
  let idx = changetype<CorrespondenceIndex>(ptr);
  idx.init(initialCapacity);
  return ptr;
}

export function corr_addLink(ptr: usize, sourceNodeId: u32, targetNodeId: u32, ruleId: u16, flags: u16, revision: u32): u32 {
  return changetype<CorrespondenceIndex>(ptr).addLink(sourceNodeId, targetNodeId, ruleId, flags, revision);
}

export function corr_findBySource(ptr: usize, sourceNodeId: u32): u32 {
  return changetype<CorrespondenceIndex>(ptr).findBySource(sourceNodeId);
}

export function corr_findByTarget(ptr: usize, targetNodeId: u32): u32 {
  return changetype<CorrespondenceIndex>(ptr).findByTarget(targetNodeId);
}

export function corr_markStale(ptr: usize, sourceNodeId: u32): void {
  changetype<CorrespondenceIndex>(ptr).markStale(sourceNodeId);
}

export function corr_isConflicted(ptr: usize, slot: u32): u32 {
  return changetype<CorrespondenceIndex>(ptr).isConflicted(slot) ? 1 : 0;
}

export function corr_markConflict(ptr: usize, slot: u32): void {
  changetype<CorrespondenceIndex>(ptr).markConflict(slot);
}

export function corr_clearConflict(ptr: usize, slot: u32): void {
  changetype<CorrespondenceIndex>(ptr).clearConflict(slot);
}

export function corr_isRemoved(ptr: usize, slot: u32): u32 {
  return changetype<CorrespondenceIndex>(ptr).isRemoved(slot) ? 1 : 0;
}

export function corr_markRemoved(ptr: usize, slot: u32): void {
  changetype<CorrespondenceIndex>(ptr).markRemoved(slot);
}

export function corr_retractBySource(ptr: usize, sourceNodeId: u32): u32 {
  return changetype<CorrespondenceIndex>(ptr).retractBySource(sourceNodeId);
}

export function corr_retractByTarget(ptr: usize, targetNodeId: u32): u32 {
  return changetype<CorrespondenceIndex>(ptr).retractByTarget(targetNodeId);
}

export function corr_getComplement(ptr: usize, slot: u32): u32 {
  return changetype<CorrespondenceIndex>(ptr).getComplement(slot);
}

export function corr_setComplement(ptr: usize, slot: u32, compPtr: u32): void {
  changetype<CorrespondenceIndex>(ptr).setComplement(slot, compPtr);
}

export function corr_getThreadId(ptr: usize, slot: u32): u32 {
  return changetype<CorrespondenceIndex>(ptr).getThreadId(slot);
}

export function corr_setThreadId(ptr: usize, slot: u32, threadId: u32): void {
  changetype<CorrespondenceIndex>(ptr).setThreadId(slot, threadId);
}

export function corr_reset(ptr: usize): void {
  changetype<CorrespondenceIndex>(ptr).reset();
}
