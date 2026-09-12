// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-performance N-Ary Digital Thread Alignment Hypergraph for @modelscript/runtime.
 *
 * Federates multi-way alignments across N >= 2 domain projections (SysML v2, Modelica,
 * CAD, Requirements, FEA, CFD, BOM, FMU) without O(N^2) pairwise synchronizer explosion.
 * Operates in linear memory compatible Struct-of-Arrays (SoA) layout.
 */

export enum ThreadDomain {
  SysML2 = 0,
  Modelica = 1,
  CAD = 2,
  Requirements = 3,
  FEA = 4,
  CFD = 5,
  BOM = 6,
  FMU = 7,
}

export const MAX_THREAD_DOMAINS = 8;
export const THREAD_HEADER_WORDS = 4;
export const THREAD_STRIDE = THREAD_HEADER_WORDS + MAX_THREAD_DOMAINS;

export const THREAD_FIELD_ID = 0;
export const THREAD_FIELD_MASK = 1;
export const THREAD_FIELD_STATUS = 2;
export const THREAD_FIELD_REVISION = 3;

export const THREAD_STATUS_SYNCED = 0x0001;
export const THREAD_STATUS_STALE = 0x0002;
export const THREAD_STATUS_CONFLICT = 0x0004;
export const THREAD_STATUS_REMOVED = 0x0008;

export interface ThreadRecord {
  slot: number;
  threadId: number;
  domainMask: number;
  status: number;
  revision: number;
  domainNodes: Record<number, number>;
  isSynced: boolean;
  isStale: boolean;
  isConflicted: boolean;
  isRemoved: boolean;
}

export class DigitalThreadHypergraph {
  private data: Uint32Array;
  private count: number = 0;
  private capacity: number;
  private threadIdToSlot: Map<number, number> = new Map();
  // Map composite key `(domainIdx << 32) | nodeId` to slot
  private nodeToThreadSlot: Map<bigint, number> = new Map();

  constructor(initialCapacity: number = 512) {
    this.capacity = initialCapacity;
    this.data = new Uint32Array(this.capacity * THREAD_STRIDE);
  }

  private ensureCapacity(neededCount: number): void {
    if (neededCount <= this.capacity) return;
    let newCap = Math.max(this.capacity * 2, neededCount);
    const next = new Uint32Array(newCap * THREAD_STRIDE);
    next.set(this.data);
    this.data = next;
    this.capacity = newCap;
  }

  createThread(threadId: number, revision: number = 0): number {
    const existing = this.threadIdToSlot.get(threadId);
    if (existing !== undefined) return existing;

    this.ensureCapacity(this.count + 1);
    const slot = this.count++;
    const offset = slot * THREAD_STRIDE;

    this.data[offset + THREAD_FIELD_ID] = threadId;
    this.data[offset + THREAD_FIELD_MASK] = 0;
    this.data[offset + THREAD_FIELD_STATUS] = THREAD_STATUS_SYNCED;
    this.data[offset + THREAD_FIELD_REVISION] = revision;

    for (let d = 0; d < MAX_THREAD_DOMAINS; d++) {
      this.data[offset + THREAD_HEADER_WORDS + d] = 0;
    }

    this.threadIdToSlot.set(threadId, slot);
    return slot;
  }

  findSlotByThreadId(threadId: number): number | undefined {
    return this.threadIdToSlot.get(threadId);
  }

  bindDomainNode(slot: number, domainIdx: ThreadDomain | number, nodeId: number): void {
    if (slot >= this.count || domainIdx >= MAX_THREAD_DOMAINS) return;
    const offset = slot * THREAD_STRIDE;

    let mask = this.data[offset + THREAD_FIELD_MASK];
    mask |= 1 << domainIdx;
    this.data[offset + THREAD_FIELD_MASK] = mask;
    this.data[offset + THREAD_HEADER_WORDS + domainIdx] = nodeId;

    const key = (BigInt(domainIdx) << 32n) | BigInt(nodeId >>> 0);
    this.nodeToThreadSlot.set(key, slot);
  }

  getDomainNode(slot: number, domainIdx: ThreadDomain | number): number {
    if (slot >= this.count || domainIdx >= MAX_THREAD_DOMAINS) return 0;
    return this.data[slot * THREAD_STRIDE + THREAD_HEADER_WORDS + domainIdx];
  }

  findThreadByDomainNode(domainIdx: ThreadDomain | number, nodeId: number): number | undefined {
    const key = (BigInt(domainIdx) << 32n) | BigInt(nodeId >>> 0);
    const slot = this.nodeToThreadSlot.get(key);
    if (slot === undefined) return undefined;
    if (this.isRemoved(slot)) return undefined;
    return this.data[slot * THREAD_STRIDE + THREAD_FIELD_ID];
  }

  markStale(slot: number): void {
    if (slot >= this.count) return;
    const offset = slot * THREAD_STRIDE + THREAD_FIELD_STATUS;
    this.data[offset] |= THREAD_STATUS_STALE;
  }

  clearStale(slot: number): void {
    if (slot >= this.count) return;
    const offset = slot * THREAD_STRIDE + THREAD_FIELD_STATUS;
    this.data[offset] &= ~THREAD_STATUS_STALE;
  }

  isStale(slot: number): boolean {
    if (slot >= this.count) return false;
    return (this.data[slot * THREAD_STRIDE + THREAD_FIELD_STATUS] & THREAD_STATUS_STALE) !== 0;
  }

  markConflict(slot: number): void {
    if (slot >= this.count) return;
    const offset = slot * THREAD_STRIDE + THREAD_FIELD_STATUS;
    this.data[offset] |= THREAD_STATUS_CONFLICT;
  }

  clearConflict(slot: number): void {
    if (slot >= this.count) return;
    const offset = slot * THREAD_STRIDE + THREAD_FIELD_STATUS;
    this.data[offset] &= ~THREAD_STATUS_CONFLICT;
  }

  isConflicted(slot: number): boolean {
    if (slot >= this.count) return false;
    return (this.data[slot * THREAD_STRIDE + THREAD_FIELD_STATUS] & THREAD_STATUS_CONFLICT) !== 0;
  }

  markRemoved(slot: number): void {
    if (slot >= this.count) return;
    const offset = slot * THREAD_STRIDE + THREAD_FIELD_STATUS;
    this.data[offset] |= THREAD_STATUS_REMOVED;
  }

  isRemoved(slot: number): boolean {
    if (slot >= this.count) return false;
    return (this.data[slot * THREAD_STRIDE + THREAD_FIELD_STATUS] & THREAD_STATUS_REMOVED) !== 0;
  }

  getThreadCount(): number {
    return this.count;
  }

  getRecord(slot: number): ThreadRecord | undefined {
    if (slot >= this.count) return undefined;
    const offset = slot * THREAD_STRIDE;
    const threadId = this.data[offset + THREAD_FIELD_ID];
    const domainMask = this.data[offset + THREAD_FIELD_MASK];
    const status = this.data[offset + THREAD_FIELD_STATUS];
    const revision = this.data[offset + THREAD_FIELD_REVISION];

    const domainNodes: Record<number, number> = {};
    for (let d = 0; d < MAX_THREAD_DOMAINS; d++) {
      if ((domainMask & (1 << d)) !== 0) {
        domainNodes[d] = this.data[offset + THREAD_HEADER_WORDS + d];
      }
    }

    return {
      slot,
      threadId,
      domainMask,
      status,
      revision,
      domainNodes,
      isSynced: (status & THREAD_STATUS_SYNCED) !== 0 && (status & THREAD_STATUS_STALE) === 0,
      isStale: (status & THREAD_STATUS_STALE) !== 0,
      isConflicted: (status & THREAD_STATUS_CONFLICT) !== 0,
      isRemoved: (status & THREAD_STATUS_REMOVED) !== 0,
    };
  }

  getAllRecords(): ThreadRecord[] {
    const list: ThreadRecord[] = [];
    for (let i = 0; i < this.count; i++) {
      const rec = this.getRecord(i);
      if (rec && !rec.isRemoved) list.push(rec);
    }
    return list;
  }
}
