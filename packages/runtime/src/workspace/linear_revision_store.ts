// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Zero-GC Struct-of-Arrays (SoA) linear revision & durability store for Salsa.
 *
 * Uses dense contiguous `Uint32Array` (revisions) and `Uint8Array` (durability tiers) slabs
 * for local symbol IDs in `[0, DENSE_LIMIT)`, eliminating `Map.get()` hashing and boxing
 * during `deepVerify()`, `invalidate()`, and durability narrowing. Polyglot domain-prefixed
 * IDs (`>= DENSE_LIMIT`) and negative virtual IDs fall back seamlessly to sparse maps.
 */

import { Durability, type Revision, type SymbolId } from "../runtime.js";

/** Upper bound (exclusive) for direct O(1) dense typed-array indexing. */
const DENSE_LIMIT = 262_144;
/** Initial capacity of dense slabs (grows geometrically up to `DENSE_LIMIT`). */
const INITIAL_CAPACITY = 1024;
/** Sentinel byte in `denseDurabilities` meaning "no explicit durability override set". */
const DURABILITY_UNSET = 0xff;

export class LinearRevisionStore {
  private denseRevisions = new Uint32Array(INITIAL_CAPACITY);
  private densePresent = new Uint8Array(INITIAL_CAPACITY);
  private denseDurabilities = new Uint8Array(INITIAL_CAPACITY).fill(DURABILITY_UNSET);

  private sparseRevisions = new Map<SymbolId, Revision>();
  private sparseDurabilities = new Map<SymbolId, Durability>();

  private ensureCapacity(id: number): void {
    if (id < this.denseRevisions.length) return;
    let nextCap = this.denseRevisions.length * 2;
    while (nextCap <= id && nextCap < DENSE_LIMIT) {
      nextCap *= 2;
    }
    if (nextCap > DENSE_LIMIT) nextCap = DENSE_LIMIT;

    const nextRev = new Uint32Array(nextCap);
    nextRev.set(this.denseRevisions);
    this.denseRevisions = nextRev;

    const nextPresent = new Uint8Array(nextCap);
    nextPresent.set(this.densePresent);
    this.densePresent = nextPresent;

    const nextDur = new Uint8Array(nextCap);
    nextDur.fill(DURABILITY_UNSET);
    nextDur.set(this.denseDurabilities);
    this.denseDurabilities = nextDur;
  }

  /** Sets the last-modified revision for `symbolId`. */
  setRevision(symbolId: SymbolId, rev: Revision): void {
    if (symbolId >= 0 && symbolId < DENSE_LIMIT) {
      this.ensureCapacity(symbolId);
      this.denseRevisions[symbolId] = rev;
      this.densePresent[symbolId] = 1;
      return;
    }
    this.sparseRevisions.set(symbolId, rev);
  }

  /** Gets the last-modified revision for `symbolId` (`0` if never modified). */
  getRevision(symbolId: SymbolId): Revision {
    if (symbolId >= 0 && symbolId < this.denseRevisions.length) {
      return this.denseRevisions[symbolId]!;
    }
    return this.sparseRevisions.get(symbolId) ?? 0;
  }

  /** Returns true if `symbolId` has an explicit revision entry recorded. */
  hasRevision(symbolId: SymbolId): boolean {
    if (symbolId >= 0 && symbolId < this.densePresent.length) {
      return this.densePresent[symbolId] === 1;
    }
    return this.sparseRevisions.has(symbolId);
  }

  /** Sets an explicit durability override for `symbolId`. */
  setDurability(symbolId: SymbolId, durability: Durability): void {
    if (symbolId >= 0 && symbolId < DENSE_LIMIT) {
      this.ensureCapacity(symbolId);
      this.denseDurabilities[symbolId] = durability;
      return;
    }
    this.sparseDurabilities.set(symbolId, durability);
  }

  /** Returns the explicit durability override for `symbolId`, or `undefined` if unset. */
  getExplicitDurability(symbolId: SymbolId): Durability | undefined {
    if (symbolId >= 0 && symbolId < this.denseDurabilities.length) {
      const val = this.denseDurabilities[symbolId]!;
      return val === DURABILITY_UNSET ? undefined : (val as Durability);
    }
    return this.sparseDurabilities.get(symbolId);
  }

  /**
   * Tight monomorphic verification loop: returns `true` if ANY symbol ID in `inputs`
   * has a revision strictly greater than `verifiedAt`.
   */
  hasAnyInputChangedSince(inputs: Int32Array, verifiedAt: Revision): boolean {
    const dense = this.denseRevisions;
    const denseLen = dense.length;
    const sparse = this.sparseRevisions;
    const len = inputs.length;
    for (let i = 0; i < len; i++) {
      const symId = inputs[i]!;
      const rev = symId >= 0 && symId < denseLen ? dense[symId]! : (sparse.get(symId) ?? 0);
      if (rev > verifiedAt) return true;
    }
    return false;
  }
}
