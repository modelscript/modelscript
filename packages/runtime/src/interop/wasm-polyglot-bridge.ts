// SPDX-License-Identifier: AGPL-3.0-or-later

import { getDefaultWasmExports } from "../dae/wasm_dae.js";
import type { PolyglotNode, PolyglotTransformer } from "./polyglot-transformer.js";

export interface WasmPolyglotExports {
  createZSet?: (initialCapacity?: number) => number;
  zset_destroy?: (ptr: number) => void;
  zset_add?: (ptr: number, elementId: number, weight: number, timestamp: number) => void;
  zset_consolidate?: (ptr: number) => number;
  zset_count?: (ptr: number) => number;
  zset_getElement?: (ptr: number, index: number) => number;
  zset_getWeight?: (ptr: number, index: number) => number;
  dbsp_fixed_point_differentiate?: (inputZSetPtr: number, prevStateZSetPtr: number, outDeltaPtr: number) => number;
  tgg_forward_dispatch?: (
    sourceNodeTypeHash: number,
    sourceNodeId: number,
    corr: number,
    arena: number,
    targetLangId?: number,
    parentSlot?: number,
  ) => number;
  tgg_retract_dispatch?: (sourceNodeTypeHash: number, sourceNodeId: number, corr: number, arena: number) => number;
  tgg_propagate_all_stale?: (corr: number, stringPoolPtr?: number, direction?: number) => number;
  __setArgumentsLength?: (n: number) => void;
  // WASM CorrespondenceIndex exports
  createCorrespondenceIndex?: (initialCapacity: number) => number;
  corr_addLink?: (
    ptr: number,
    sourceNodeId: number,
    targetNodeId: number,
    ruleId: number,
    flags: number,
    revision: number,
  ) => number;
  corr_addLinkWithParent?: (
    ptr: number,
    sourceNodeId: number,
    targetNodeId: number,
    ruleId: number,
    flags: number,
    revision: number,
    parentSlot: number,
  ) => number;
  corr_findBySource?: (ptr: number, sourceNodeId: number) => number;
  corr_findByTarget?: (ptr: number, targetNodeId: number) => number;
  corr_markStale?: (ptr: number, sourceNodeId: number) => void;
  corr_markStaleCascading?: (ptr: number, parentSlot: number) => number;
  corr_retractBySource?: (ptr: number, sourceNodeId: number) => number;
  corr_retractByTarget?: (ptr: number, targetNodeId: number) => number;
  corr_allocComplement?: (ptr: number, byteSize: number) => number;
  corr_freeComplement?: (ptr: number, compPtr: number) => void;
  corr_getStaleQueueCount?: (ptr: number) => number;
  corr_getStaleQueueSlot?: (ptr: number, index: number) => number;
  corr_clearStaleQueue?: (ptr: number) => void;
  corr_reset?: (ptr: number) => void;
}

export interface ConsolidatedSymbolDeltas {
  added: PolyglotNode[];
  updated: PolyglotNode[];
  removed: string[];
  usedWasmZSet: boolean;
  cancelledCount: number;
}

/**
 * Runtime FFI bridge connecting TypeScript `PolyglotTransformer` Z-Set delta sync
 * to compiled AssemblyScript DBSP & TGG WASM exports (`createZSet`, `zset_add`,
 * `zset_consolidate`, `tgg_forward_dispatch`) when hydrated, with exact TS parity fallback.
 */
export class WasmPolyglotKernelBridge {
  private epoch = 1;

  constructor(private readonly exportsOverride?: WasmPolyglotExports | null) {}

  private resolveExports(): WasmPolyglotExports | null {
    if (this.exportsOverride !== undefined) return this.exportsOverride;
    if (typeof globalThis !== "undefined") {
      const globalExp = (globalThis as { __modelscript_wasm_exports__?: WasmPolyglotExports })
        .__modelscript_wasm_exports__;
      if (globalExp) return globalExp;
    }
    return (getDefaultWasmExports() as WasmPolyglotExports | null) ?? null;
  }

  public isWasmZSetAvailable(): boolean {
    const exp = this.resolveExports();
    return Boolean(
      exp &&
      typeof exp.createZSet === "function" &&
      typeof exp.zset_add === "function" &&
      typeof exp.zset_consolidate === "function" &&
      typeof exp.zset_count === "function" &&
      typeof exp.zset_getElement === "function" &&
      typeof exp.zset_getWeight === "function",
    );
  }

  /**
   * Consolidates raw delta additions, updates, and retractions in an algebraic Z-Set
   * (either in WASM linear memory via `zset_add` + `zset_consolidate` when hydrated,
   * or in exact TS map arithmetic), canceling opposing pairs within the same batch.
   */
  public consolidateDeltas(deltas: {
    added?: PolyglotNode[] | undefined;
    updated?: PolyglotNode[] | undefined;
    removed?: string[] | undefined;
  }): ConsolidatedSymbolDeltas {
    const addedIn = deltas.added ?? [];
    const updatedIn = deltas.updated ?? [];
    const removedIn = deltas.removed ?? [];

    const idToNumeric = new Map<string, number>();
    const numericToKey = new Map<number, string>();
    const latestNodeByKey = new Map<string, PolyglotNode>();
    const isUpdateByKey = new Set<string>();
    const addedKeys = new Set<string>();
    const dedupedUpdatedKeys = new Set<string>();
    let nextId = 1;

    const internKey = (key: string): number => {
      const existing = idToNumeric.get(key);
      if (existing !== undefined) return existing;
      const allocated = nextId++;
      idToNumeric.set(key, allocated);
      numericToKey.set(allocated, key);
      return allocated;
    };

    for (const node of addedIn) {
      const k = String(node.id ?? node.name);
      internKey(k);
      latestNodeByKey.set(k, node);
      addedKeys.add(k);
    }
    for (const node of updatedIn) {
      const k = String(node.id ?? node.name);
      internKey(k);
      latestNodeByKey.set(k, node);
      isUpdateByKey.add(k);
      if (!addedKeys.has(k)) {
        dedupedUpdatedKeys.add(k);
      }
    }
    for (const rem of removedIn) {
      internKey(rem);
    }

    const exp = this.resolveExports();
    const epochNow = this.epoch++;

    if (this.isWasmZSetAvailable() && exp) {
      const ptr = exp.createZSet!(Math.max(16, idToNumeric.size * 2));
      if (ptr !== 0) {
        try {
          let rawEntries = 0;
          for (const node of addedIn) {
            const k = String(node.id ?? node.name);
            exp.zset_add!(ptr, idToNumeric.get(k)!, 1, epochNow);
            rawEntries++;
          }
          for (const k of dedupedUpdatedKeys) {
            exp.zset_add!(ptr, idToNumeric.get(k)!, 1, epochNow);
            rawEntries++;
          }
          for (const rem of removedIn) {
            exp.zset_add!(ptr, idToNumeric.get(rem)!, -1, epochNow);
            rawEntries++;
          }

          exp.zset_consolidate!(ptr);
          const surviving = exp.zset_count!(ptr);

          const added: PolyglotNode[] = [];
          const updated: PolyglotNode[] = [];
          const removed: string[] = [];
          for (let i = 0; i < surviving; i++) {
            const elId = exp.zset_getElement!(ptr, i);
            const weight = exp.zset_getWeight!(ptr, i);
            const key = numericToKey.get(elId);
            if (!key || weight === 0) continue;
            if (weight > 0) {
              const node = latestNodeByKey.get(key);
              if (node) {
                if (isUpdateByKey.has(key)) updated.push(node);
                else added.push(node);
              }
            } else {
              removed.push(key);
            }
          }

          const activeTotal = added.length + updated.length + removed.length;
          return {
            added,
            updated,
            removed,
            usedWasmZSet: true,
            cancelledCount: Math.max(0, rawEntries - activeTotal),
          };
        } finally {
          exp.zset_destroy?.(ptr);
        }
      }
    }

    // Exact TS algebraic Z-set consolidation parity path
    const weights = new Map<string, number>();
    let rawEntries = 0;
    for (const node of addedIn) {
      const k = String(node.id ?? node.name);
      weights.set(k, (weights.get(k) ?? 0) + 1);
      rawEntries++;
    }
    for (const k of dedupedUpdatedKeys) {
      weights.set(k, (weights.get(k) ?? 0) + 1);
      rawEntries++;
    }
    for (const rem of removedIn) {
      weights.set(rem, (weights.get(rem) ?? 0) - 1);
      rawEntries++;
    }

    const added: PolyglotNode[] = [];
    const updated: PolyglotNode[] = [];
    const removed: string[] = [];
    for (const [key, w] of weights.entries()) {
      if (w > 0) {
        const node = latestNodeByKey.get(key);
        if (node) {
          if (isUpdateByKey.has(key)) updated.push(node);
          else added.push(node);
        }
      } else if (w < 0) {
        removed.push(key);
      }
    }

    const activeTotal = added.length + updated.length + removed.length;
    return {
      added,
      updated,
      removed,
      usedWasmZSet: false,
      cancelledCount: Math.max(0, rawEntries - activeTotal),
    };
  }

  /**
   * Consolidates deltas in algebraic Z-Set form and executes `PolyglotTransformer.syncSymbolDeltas`.
   */
  public syncDeltas(
    transformer: PolyglotTransformer,
    deltas: {
      added?: PolyglotNode[] | undefined;
      updated?: PolyglotNode[] | undefined;
      removed?: string[] | undefined;
    },
    targetLang: string,
  ): {
    consolidated: ConsolidatedSymbolDeltas;
    syncResult: { applied: number; retracted: number; targets: PolyglotNode[] };
  } {
    const consolidated = this.consolidateDeltas(deltas);
    const syncResult = transformer.syncSymbolDeltas(
      {
        added: consolidated.added,
        updated: consolidated.updated,
        removed: consolidated.removed,
      },
      targetLang,
    );
    return { consolidated, syncResult };
  }

  /**
   * Returns true if the hydrated WASM runtime exposes linear-memory CorrespondenceIndex exports.
   */
  public isWasmCorrespondenceAvailable(): boolean {
    const exp = this.resolveExports();
    return Boolean(
      exp &&
      typeof exp.createCorrespondenceIndex === "function" &&
      typeof exp.corr_addLink === "function" &&
      typeof exp.corr_findBySource === "function" &&
      typeof exp.corr_findByTarget === "function" &&
      typeof exp.corr_markStale === "function" &&
      typeof exp.corr_markStaleCascading === "function" &&
      typeof exp.corr_retractBySource === "function",
    );
  }

  /**
   * Instantiates a linear-memory `WasmCorrespondenceBridge` backed by the hydrated runtime WASM exports.
   * Returns `null` if WASM correspondence exports are unavailable or allocation fails.
   */
  public createCorrespondenceBridge(initialCapacity = 1024): WasmCorrespondenceBridge | null {
    const exp = this.resolveExports();
    if (!this.isWasmCorrespondenceAvailable() || !exp) return null;
    const ptr = exp.createCorrespondenceIndex!(initialCapacity);
    if (!ptr) return null;
    return new WasmCorrespondenceBridge(exp, ptr);
  }
}

/**
 * Direct JS ↔ WASM adapter over the linear-memory `CorrespondenceIndex` struct.
 * Implements `markStale(sourceNodeId)` and `markStaleCascading(parentSlot)` so it can
 * be attached directly to `WasmQueryEngine.setCorrespondenceIndex()` or used by TGG runners.
 */
export class WasmCorrespondenceBridge {
  constructor(
    private readonly exp: WasmPolyglotExports,
    public readonly ptr: number,
  ) {}

  addLink(sourceNodeId: number, targetNodeId: number, ruleId = 0, flags = 1, revision = 0): number {
    return this.exp.corr_addLink!(this.ptr, sourceNodeId, targetNodeId, ruleId, flags, revision);
  }

  addLinkWithParent(
    sourceNodeId: number,
    targetNodeId: number,
    parentSlot: number,
    ruleId = 0,
    flags = 1,
    revision = 0,
  ): number {
    if (typeof this.exp.corr_addLinkWithParent === "function") {
      return this.exp.corr_addLinkWithParent(this.ptr, sourceNodeId, targetNodeId, ruleId, flags, revision, parentSlot);
    }
    return this.addLink(sourceNodeId, targetNodeId, ruleId, flags, revision);
  }

  findBySource(sourceNodeId: number): number {
    return this.exp.corr_findBySource!(this.ptr, sourceNodeId);
  }

  findByTarget(targetNodeId: number): number {
    return this.exp.corr_findByTarget!(this.ptr, targetNodeId);
  }

  markStale(sourceNodeId: number): void {
    this.exp.corr_markStale!(this.ptr, sourceNodeId);
  }

  markStaleCascading(parentSlot: number): number {
    return this.exp.corr_markStaleCascading!(this.ptr, parentSlot);
  }

  retractBySource(sourceNodeId: number): number {
    return this.exp.corr_retractBySource!(this.ptr, sourceNodeId);
  }

  retractByTarget(targetNodeId: number): number {
    return this.exp.corr_retractByTarget!(this.ptr, targetNodeId);
  }

  allocComplement(byteSize: number): number {
    return this.exp.corr_allocComplement?.(this.ptr, byteSize) ?? 0;
  }

  freeComplement(compPtr: number): void {
    this.exp.corr_freeComplement?.(this.ptr, compPtr);
  }

  drainStaleSlots(): number[] {
    if (
      typeof this.exp.corr_getStaleQueueCount !== "function" ||
      typeof this.exp.corr_getStaleQueueSlot !== "function"
    ) {
      return [];
    }
    const count = this.exp.corr_getStaleQueueCount(this.ptr);
    const slots: number[] = [];
    for (let i = 0; i < count; i++) {
      slots.push(this.exp.corr_getStaleQueueSlot(this.ptr, i));
    }
    this.exp.corr_clearStaleQueue?.(this.ptr);
    return slots;
  }

  reset(): void {
    this.exp.corr_reset?.(this.ptr);
  }
}
