// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-performance N-Ary Digital Thread Alignment Hypergraph for @modelscript/runtime.
 *
 * Federates multi-way alignments across N >= 2 domain projections (SysML v2, Modelica,
 * CAD, Requirements, FEA, CFD, BOM, FMU, GD&T, Telemetry, Safety, Surrogate,
 * Manufacturing, Cost/Carbon, Verification, Software) without O(N^2) pairwise synchronizer explosion.
 * Operates in linear memory compatible Struct-of-Arrays (SoA) layout.
 */

import type { ConflictClause, SharedEquality } from "../formal/theory_coordinator.js";

export enum ThreadDomain {
  SysML2 = 0,
  Modelica = 1,
  CAD = 2,
  Requirements = 3,
  FEA = 4,
  CFD = 5,
  BOM = 6,
  FMU = 7,
  GDT = 8, // STEP AP242 Semantic GD&T
  Telemetry = 9, // ASAM MDF4 / MCAP / Parquet
  Safety = 10, // Safety Goals, ASIL, Hazards & Fault Trees
  Surrogate = 11, // POD-Galerkin / Neural ROMs
  Manufacturing = 12, // Tooling, G-code, CMM scans
  CostCarbon = 13, // Cost & Embodied Carbon LCA
  Verification = 14, // Test verification matrices & compliance
  Software = 15, // Firmware / sBOM
}

export enum ThreadRelation {
  Aligned = 0, // Default multi-way alignment
  Satisfies = 1, // Component/model satisfies requirement
  DerivesFrom = 2, // Design derives from parent architecture
  Verifies = 3, // Simulation or test verifies requirement
  Calibrates = 4, // Telemetry calibrates simulation parameter
  Manufactures = 5, // Tooling / G-code manufactures CAD geometry
  Measures = 6, // Virtual/physical sensor measures variable
  AllocatesTo = 7, // Function allocates to hardware/software
}

export const MAX_THREAD_DOMAINS = 16;
export const THREAD_HEADER_WORDS = 6;
export const THREAD_STRIDE = THREAD_HEADER_WORDS + MAX_THREAD_DOMAINS; // 22 words

export const THREAD_FIELD_ID = 0;
export const THREAD_FIELD_MASK = 1; // Bitmask of active domains (uint32, 16 bits used)
export const THREAD_FIELD_STATUS = 2; // Status flags (SYNCED, STALE, CONFLICT, REMOVED)
export const THREAD_FIELD_REVISION = 3; // Revision number
export const THREAD_FIELD_RELATION = 4; // ThreadRelation (uint32)
export const THREAD_FIELD_BRANCH = 5; // Branch / variant ID (uint32, 0 = main)

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
  relation: ThreadRelation;
  branchId: number;
  domainNodes: Record<number, number>;
  isSynced: boolean;
  isStale: boolean;
  isConflicted: boolean;
  isRemoved: boolean;
}

export interface BlastRadiusNode {
  domain: ThreadDomain;
  nodeId: number;
  threadId: number;
  slot: number;
  distance: number;
  status: "synced" | "stale" | "conflict" | "removed";
  relation: ThreadRelation;
  branchId: number;
}

export interface BlastRadiusResult {
  root: { domain: ThreadDomain; nodeId: number };
  impactedNodes: BlastRadiusNode[];
  impactedThreads: number[];
  staleCount: number;
  conflictCount: number;
}

export class DigitalThreadHypergraph {
  private data: Uint32Array;
  private count: number = 0;
  private capacity: number;
  private threadIdToSlot: Map<number, number> = new Map();
  // Map composite key `(domainIdx << 32) | nodeId` to array of slots
  private nodeToThreadSlots: Map<bigint, number[]> = new Map();
  private slotConflicts: Map<number, ConflictClause> = new Map();
  private slotEqualities: Map<number, SharedEquality[]> = new Map();

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

  createThread(
    threadId: number,
    revision: number = 0,
    relation: ThreadRelation = ThreadRelation.Aligned,
    branchId: number = 0,
  ): number {
    const existing = this.threadIdToSlot.get(threadId);
    if (existing !== undefined) return existing;

    this.ensureCapacity(this.count + 1);
    const slot = this.count++;
    const offset = slot * THREAD_STRIDE;

    this.data[offset + THREAD_FIELD_ID] = threadId;
    this.data[offset + THREAD_FIELD_MASK] = 0;
    this.data[offset + THREAD_FIELD_STATUS] = THREAD_STATUS_SYNCED;
    this.data[offset + THREAD_FIELD_REVISION] = revision;
    this.data[offset + THREAD_FIELD_RELATION] = relation;
    this.data[offset + THREAD_FIELD_BRANCH] = branchId;

    for (let d = 0; d < MAX_THREAD_DOMAINS; d++) {
      this.data[offset + THREAD_HEADER_WORDS + d] = 0;
    }

    this.threadIdToSlot.set(threadId, slot);
    return slot;
  }

  findSlotByThreadId(threadId: number): number | undefined {
    return this.threadIdToSlot.get(threadId);
  }

  setRelation(slot: number, relation: ThreadRelation): void {
    if (slot >= this.count) return;
    this.data[slot * THREAD_STRIDE + THREAD_FIELD_RELATION] = relation;
  }

  getRelation(slot: number): ThreadRelation {
    if (slot >= this.count) return ThreadRelation.Aligned;
    return this.data[slot * THREAD_STRIDE + THREAD_FIELD_RELATION] as ThreadRelation;
  }

  setBranch(slot: number, branchId: number): void {
    if (slot >= this.count) return;
    this.data[slot * THREAD_STRIDE + THREAD_FIELD_BRANCH] = branchId;
  }

  getBranch(slot: number): number {
    if (slot >= this.count) return 0;
    return this.data[slot * THREAD_STRIDE + THREAD_FIELD_BRANCH];
  }

  bindDomainNode(slot: number, domainIdx: ThreadDomain | number, nodeId: number): void {
    if (slot >= this.count || domainIdx >= MAX_THREAD_DOMAINS) return;
    const offset = slot * THREAD_STRIDE;

    let mask = this.data[offset + THREAD_FIELD_MASK];
    mask |= 1 << domainIdx;
    this.data[offset + THREAD_FIELD_MASK] = mask;
    this.data[offset + THREAD_HEADER_WORDS + domainIdx] = nodeId;

    const key = (BigInt(domainIdx) << 32n) | BigInt(nodeId >>> 0);
    const slots = this.nodeToThreadSlots.get(key) || [];
    if (!slots.includes(slot)) {
      slots.push(slot);
      this.nodeToThreadSlots.set(key, slots);
    }
  }

  getDomainNode(slot: number, domainIdx: ThreadDomain | number): number {
    if (slot >= this.count || domainIdx >= MAX_THREAD_DOMAINS) return 0;
    return this.data[slot * THREAD_STRIDE + THREAD_HEADER_WORDS + domainIdx];
  }

  findSlotsByDomainNode(domainIdx: ThreadDomain | number, nodeId: number, branchId?: number): number[] {
    const key = (BigInt(domainIdx) << 32n) | BigInt(nodeId >>> 0);
    const slots = this.nodeToThreadSlots.get(key) || [];
    return slots.filter((s) => {
      if (this.isRemoved(s)) return false;
      if (branchId !== undefined && this.getBranch(s) !== branchId) return false;
      return true;
    });
  }

  findSlotByDomainNode(domainIdx: ThreadDomain | number, nodeId: number, branchId?: number): number | undefined {
    const active = this.findSlotsByDomainNode(domainIdx, nodeId, branchId);
    return active.length > 0 ? active[0] : undefined;
  }

  findThreadByDomainNode(domainIdx: ThreadDomain | number, nodeId: number, branchId?: number): number | undefined {
    const slot = this.findSlotByDomainNode(domainIdx, nodeId, branchId);
    if (slot === undefined) return undefined;
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

  recordTheorySat(slot: number, equalities?: SharedEquality[]): void {
    if (slot >= this.count) return;
    this.clearConflict(slot);
    this.clearStale(slot);
    const offset = slot * THREAD_STRIDE + THREAD_FIELD_STATUS;
    this.data[offset] |= THREAD_STATUS_SYNCED;
    this.slotConflicts.delete(slot);
    if (equalities && equalities.length > 0) {
      this.slotEqualities.set(slot, equalities);
    }
  }

  recordTheoryConflict(slot: number, conflict: ConflictClause): void {
    if (slot >= this.count) return;
    const offset = slot * THREAD_STRIDE + THREAD_FIELD_STATUS;
    this.data[offset] &= ~THREAD_STATUS_SYNCED;
    this.data[offset] |= THREAD_STATUS_CONFLICT;
    this.slotConflicts.set(slot, conflict);
  }

  clearTheoryConflict(slot: number): void {
    if (slot >= this.count) return;
    this.clearConflict(slot);
    this.slotConflicts.delete(slot);
  }

  getConflict(slot: number): ConflictClause | undefined {
    return this.slotConflicts.get(slot);
  }

  getEqualities(slot: number): SharedEquality[] | undefined {
    return this.slotEqualities.get(slot);
  }

  getAllConflicts(): Map<number, ConflictClause> {
    return new Map(this.slotConflicts);
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
    const relation = this.data[offset + THREAD_FIELD_RELATION] as ThreadRelation;
    const branchId = this.data[offset + THREAD_FIELD_BRANCH];

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
      relation,
      branchId,
      domainNodes,
      isSynced: (status & THREAD_STATUS_SYNCED) !== 0 && (status & THREAD_STATUS_STALE) === 0,
      isStale: (status & THREAD_STATUS_STALE) !== 0,
      isConflicted: (status & THREAD_STATUS_CONFLICT) !== 0,
      isRemoved: (status & THREAD_STATUS_REMOVED) !== 0,
    };
  }

  getAllRecords(branchId?: number): ThreadRecord[] {
    const list: ThreadRecord[] = [];
    for (let i = 0; i < this.count; i++) {
      const rec = this.getRecord(i);
      if (rec && !rec.isRemoved) {
        if (branchId !== undefined && rec.branchId !== branchId) continue;
        list.push(rec);
      }
    }
    return list;
  }

  forkBranch(parentBranchId: number, newBranchId: number, idOffset = 1_000_000): number {
    let cloned = 0;
    const currentCount = this.count;
    for (let slot = 0; slot < currentCount; slot++) {
      const rec = this.getRecord(slot);
      if (!rec || rec.isRemoved || rec.branchId !== parentBranchId) continue;

      const newThreadId = rec.threadId + idOffset * newBranchId;
      const newSlot = this.createThread(newThreadId, rec.revision, rec.relation, newBranchId);
      for (const [domStr, nId] of Object.entries(rec.domainNodes)) {
        this.bindDomainNode(newSlot, Number(domStr), nId);
      }
      cloned++;
    }
    return cloned;
  }

  mergeBranch(
    sourceBranchId: number,
    targetBranchId: number,
    idOffset = 1_000_000,
  ): { mergedCount: number; conflictCount: number } {
    let mergedCount = 0;
    let conflictCount = 0;

    for (let slot = 0; slot < this.count; slot++) {
      const rec = this.getRecord(slot);
      if (!rec || rec.isRemoved || rec.branchId !== sourceBranchId) continue;

      const originalThreadId = rec.threadId - idOffset * sourceBranchId;
      const targetSlot = this.findSlotByThreadId(originalThreadId);

      if (targetSlot !== undefined) {
        if (this.isConflicted(slot)) {
          this.markConflict(targetSlot);
          conflictCount++;
        } else {
          for (const [domStr, nId] of Object.entries(rec.domainNodes)) {
            this.bindDomainNode(targetSlot, Number(domStr), nId);
          }
          this.setRelation(targetSlot, rec.relation);
          this.data[targetSlot * THREAD_STRIDE + THREAD_FIELD_REVISION] = rec.revision;
          mergedCount++;
        }
      }
    }
    return { mergedCount, conflictCount };
  }

  computeBlastRadius(
    startDomain: ThreadDomain | number,
    startNodeId: number,
    options?: { branchId?: number; filterRelation?: ThreadRelation },
  ): BlastRadiusResult {
    const root = { domain: startDomain as ThreadDomain, nodeId: startNodeId };
    const initialSlots = this.findSlotsByDomainNode(startDomain, startNodeId, options?.branchId);

    if (initialSlots.length === 0) {
      return {
        root,
        impactedNodes: [],
        impactedThreads: [],
        staleCount: 0,
        conflictCount: 0,
      };
    }

    const visitedSlots = new Set<number>();
    const visitedNodes = new Set<string>();
    const impactedNodes: BlastRadiusNode[] = [];
    const impactedThreads = new Set<number>();

    const queue: { slot: number; distance: number }[] = [];
    for (const s of initialSlots) {
      visitedSlots.add(s);
      queue.push({ slot: s, distance: 1 });
    }

    while (queue.length > 0) {
      const { slot, distance } = queue.shift()!;
      const rec = this.getRecord(slot);
      if (!rec || rec.isRemoved) continue;
      if (options?.branchId !== undefined && rec.branchId !== options.branchId) continue;
      const matchesFilter = options?.filterRelation === undefined || rec.relation === options.filterRelation;
      if (matchesFilter) {
        impactedThreads.add(rec.threadId);
      }

      let statusStr: "synced" | "stale" | "conflict" | "removed" = "synced";
      if (rec.isRemoved) statusStr = "removed";
      else if (rec.isConflicted) statusStr = "conflict";
      else if (rec.isStale) statusStr = "stale";

      for (const [domStr, nId] of Object.entries(rec.domainNodes)) {
        const dom = Number(domStr) as ThreadDomain;
        const nodeKey = `${dom}:${nId}`;

        if (!visitedNodes.has(nodeKey)) {
          visitedNodes.add(nodeKey);
          if (matchesFilter) {
            impactedNodes.push({
              domain: dom,
              nodeId: nId,
              threadId: rec.threadId,
              slot,
              distance,
              status: statusStr,
              relation: rec.relation,
              branchId: rec.branchId,
            });
          }

          const otherSlots = this.findSlotsByDomainNode(dom, nId, options?.branchId);
          for (const otherSlot of otherSlots) {
            if (!visitedSlots.has(otherSlot)) {
              visitedSlots.add(otherSlot);
              queue.push({ slot: otherSlot, distance: distance + 1 });
            }
          }
        }
      }
    }

    const staleCount = impactedNodes.filter((n) => n.status === "stale").length;
    const conflictCount = impactedNodes.filter((n) => n.status === "conflict").length;

    return {
      root,
      impactedNodes,
      impactedThreads: Array.from(impactedThreads),
      staleCount,
      conflictCount,
    };
  }

  markBlastRadiusStale(
    startDomain: ThreadDomain | number,
    startNodeId: number,
    options?: { branchId?: number },
  ): number {
    const radius = this.computeBlastRadius(startDomain, startNodeId, options);
    let marked = 0;
    for (const threadId of radius.impactedThreads) {
      const slot = this.findSlotByThreadId(threadId);
      if (slot !== undefined) {
        this.markStale(slot);
        marked++;
      }
    }
    return marked;
  }
}

/**
 * Helper to bind a 3D CFD boundary patch to a 1D Modelica fluid port across the digital thread.
 */
export function bindCfdToModelicaThread(
  hypergraph: DigitalThreadHypergraph,
  threadId: number,
  cfdPatchNodeId: number,
  modelicaPortNodeId: number,
  revision = 0,
  branchId = 0,
): number {
  const slot = hypergraph.createThread(threadId, revision, ThreadRelation.Aligned, branchId);
  hypergraph.bindDomainNode(slot, ThreadDomain.CFD, cfdPatchNodeId);
  hypergraph.bindDomainNode(slot, ThreadDomain.Modelica, modelicaPortNodeId);
  return slot;
}

/**
 * Helper to bind an interactive 3D CAD surface selection to a 3D CFD boundary patch
 * and optional 1D Modelica fluid port across the digital thread.
 */
export function bindCadCfdModelicaThread(
  hypergraph: DigitalThreadHypergraph,
  threadId: number,
  cadFaceNodeId: number,
  cfdPatchNodeId: number,
  modelicaPortNodeId?: number,
  revision = 0,
  branchId = 0,
): number {
  const slot = hypergraph.createThread(threadId, revision, ThreadRelation.Aligned, branchId);
  hypergraph.bindDomainNode(slot, ThreadDomain.CAD, cadFaceNodeId);
  hypergraph.bindDomainNode(slot, ThreadDomain.CFD, cfdPatchNodeId);
  if (modelicaPortNodeId !== undefined) {
    hypergraph.bindDomainNode(slot, ThreadDomain.Modelica, modelicaPortNodeId);
  }
  return slot;
}

/**
 * Helper to bind STEP AP242 Semantic GD&T tolerance zone to CAD B-Rep surface.
 */
export function bindGdtToCadThread(
  hypergraph: DigitalThreadHypergraph,
  threadId: number,
  gdtNodeId: number,
  cadFaceNodeId: number,
  revision = 0,
  branchId = 0,
): number {
  const slot = hypergraph.createThread(threadId, revision, ThreadRelation.Manufactures, branchId);
  hypergraph.bindDomainNode(slot, ThreadDomain.GDT, gdtNodeId);
  hypergraph.bindDomainNode(slot, ThreadDomain.CAD, cadFaceNodeId);
  return slot;
}

/**
 * Helper to bind real physical telemetry stream to a Modelica simulation port/variable.
 */
export function bindTelemetryToSimulationThread(
  hypergraph: DigitalThreadHypergraph,
  threadId: number,
  telemetryChannelId: number,
  modelicaPortId: number,
  revision = 0,
  branchId = 0,
): number {
  const slot = hypergraph.createThread(threadId, revision, ThreadRelation.Calibrates, branchId);
  hypergraph.bindDomainNode(slot, ThreadDomain.Telemetry, telemetryChannelId);
  hypergraph.bindDomainNode(slot, ThreadDomain.Modelica, modelicaPortId);
  return slot;
}

/**
 * Helper to bind an ISO 26262 ASIL safety goal / fault cut set to a SysML requirement.
 */
export function bindSafetyToRequirementThread(
  hypergraph: DigitalThreadHypergraph,
  threadId: number,
  safetyGoalNodeId: number,
  reqNodeId: number,
  revision = 0,
  branchId = 0,
): number {
  const slot = hypergraph.createThread(threadId, revision, ThreadRelation.Verifies, branchId);
  hypergraph.bindDomainNode(slot, ThreadDomain.Safety, safetyGoalNodeId);
  hypergraph.bindDomainNode(slot, ThreadDomain.Requirements, reqNodeId);
  return slot;
}

/**
 * Helper to bind a SysML part definition to an eBOM item and manufacturing process.
 */
export function bindBomToManufacturingThread(
  hypergraph: DigitalThreadHypergraph,
  threadId: number,
  sysmlPartNodeId: number,
  bomItemNodeId: number,
  mfgProcessNodeId?: number,
  revision = 0,
  branchId = 0,
): number {
  const slot = hypergraph.createThread(threadId, revision, ThreadRelation.AllocatesTo, branchId);
  hypergraph.bindDomainNode(slot, ThreadDomain.SysML2, sysmlPartNodeId);
  hypergraph.bindDomainNode(slot, ThreadDomain.BOM, bomItemNodeId);
  if (mfgProcessNodeId !== undefined) {
    hypergraph.bindDomainNode(slot, ThreadDomain.Manufacturing, mfgProcessNodeId);
  }
  return slot;
}
