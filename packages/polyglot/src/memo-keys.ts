// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * Packed Memo Keys — Eliminates string allocation for Salsa memo lookups.
 *
 * The current query engine uses string keys like `"queryName:symbolId"` for
 * its memo Map. For a 10k-equation model, this creates ~100k string keys,
 * each requiring a V8 string object (~40+ bytes overhead).
 *
 * This module provides a numeric packing scheme:
 * - Query names are mapped to small integers (0–255) via a registry.
 * - SymbolIds are already integers.
 * - The packed key is a single `number` (safe for Map keys in V8).
 *
 * ## Packing Scheme
 *
 * For queries WITHOUT argsHash (the common case, ~99% of lookups):
 *   Packed key = queryIndex * 2^24 + (symbolId & 0x00FF_FFFF)
 *   This supports up to 256 query names and ~16M symbol IDs.
 *
 * For queries WITH argsHash (specialization, <1% of lookups):
 *   Falls back to string key: `"queryIndex:symbolId:argsHash"`
 *
 * ## Performance Impact
 *
 * - Eliminates ~100k string allocations per compilation
 * - Numeric Map keys are stored inline in V8's internal hash table
 * - No GC pressure from key strings
 */

import type { SymbolId } from "./runtime.js";

/** Maximum number of distinct query names (8 bits → 256). */
const MAX_QUERY_INDEX = 256;

/** Maximum symbol ID that can be packed (24 bits → 16,777,215). */
const MAX_PACKABLE_SYMBOL_ID = 0x00ff_ffff;

/**
 * Registry that maps query names to compact integer indices.
 *
 * Query names are registered lazily on first use. The registry is
 * shared across the lifetime of a QueryEngine.
 */
export class QueryNameRegistry {
  private nameToIndex = new Map<string, number>();
  private indexToName: string[] = [];

  /**
   * Get or assign an integer index for a query name.
   * Indices are assigned sequentially starting from 0.
   */
  register(queryName: string): number {
    let idx = this.nameToIndex.get(queryName);
    if (idx !== undefined) return idx;

    idx = this.indexToName.length;
    if (idx >= MAX_QUERY_INDEX) {
      throw new Error(
        `QueryNameRegistry: exceeded maximum of ${MAX_QUERY_INDEX} query names. ` +
          `This is a compile-time constant; increase MAX_QUERY_INDEX if needed.`,
      );
    }

    this.nameToIndex.set(queryName, idx);
    this.indexToName.push(queryName);
    return idx;
  }

  /** Resolve an index back to a query name. */
  resolve(index: number): string {
    return this.indexToName[index]!;
  }

  /** Check if a query name has been registered. */
  has(queryName: string): boolean {
    return this.nameToIndex.has(queryName);
  }

  /** Number of registered query names. */
  get size(): number {
    return this.indexToName.length;
  }
}

/**
 * Pack a query index + symbol ID into a single numeric memo key.
 *
 * @param queryIndex - The query name index (0–255).
 * @param symbolId - The symbol ID (must be non-negative and ≤ MAX_PACKABLE_SYMBOL_ID for packing).
 * @returns A packed numeric key, or `null` if the symbol ID is too large or negative (virtual IDs).
 */
export function packMemoKey(queryIndex: number, symbolId: SymbolId): number | null {
  // Virtual IDs (negative) and large IDs can't be packed
  if (symbolId < 0 || symbolId > MAX_PACKABLE_SYMBOL_ID) {
    return null;
  }
  // Pack: queryIndex in high byte, symbolId in low 24 bits
  return (queryIndex << 24) | symbolId;
}

/**
 * Unpack a numeric memo key into query index and symbol ID.
 *
 * @param key - The packed numeric key.
 * @returns [queryIndex, symbolId]
 */
export function unpackMemoKey(key: number): [queryIndex: number, symbolId: SymbolId] {
  const queryIndex = (key >>> 24) & 0xff;
  const symbolId = key & MAX_PACKABLE_SYMBOL_ID;
  return [queryIndex, symbolId];
}

/**
 * A hybrid memo key store that uses packed numeric keys when possible
 * and falls back to string keys for unpacked cases (virtual IDs, argsHash).
 *
 * This replaces `Map<string, Memo>` in the QueryEngine with a two-tier
 * structure:
 * - `packedMemos: Map<number, T>` for the common case (~99%)
 * - `stringMemos: Map<string, T>` for the fallback case (~1%)
 */
export class MemoKeyStore<T> {
  /** Fast path: packed numeric keys for regular queries. */
  private packedMemos = new Map<number, T>();
  /** Slow path: string keys for virtual IDs and queries with argsHash. */
  private stringMemos = new Map<string, T>();

  private registry: QueryNameRegistry;

  constructor(registry: QueryNameRegistry) {
    this.registry = registry;
  }

  /**
   * Get a memo by query name and symbol ID.
   */
  get(queryName: string, symbolId: SymbolId, argsHash?: string): T | undefined {
    if (argsHash) {
      return this.stringMemos.get(this.stringKey(queryName, symbolId, argsHash));
    }
    const queryIndex = this.registry.register(queryName);
    const packed = packMemoKey(queryIndex, symbolId);
    if (packed !== null) {
      return this.packedMemos.get(packed);
    }
    return this.stringMemos.get(this.stringKey(queryName, symbolId));
  }

  /**
   * Set a memo by query name and symbol ID.
   */
  set(queryName: string, symbolId: SymbolId, value: T, argsHash?: string): void {
    if (argsHash) {
      this.stringMemos.set(this.stringKey(queryName, symbolId, argsHash), value);
      return;
    }
    const queryIndex = this.registry.register(queryName);
    const packed = packMemoKey(queryIndex, symbolId);
    if (packed !== null) {
      this.packedMemos.set(packed, value);
    } else {
      this.stringMemos.set(this.stringKey(queryName, symbolId), value);
    }
  }

  /**
   * Check if a memo exists.
   */
  has(queryName: string, symbolId: SymbolId, argsHash?: string): boolean {
    if (argsHash) {
      return this.stringMemos.has(this.stringKey(queryName, symbolId, argsHash));
    }
    const queryIndex = this.registry.register(queryName);
    const packed = packMemoKey(queryIndex, symbolId);
    if (packed !== null) {
      return this.packedMemos.has(packed);
    }
    return this.stringMemos.has(this.stringKey(queryName, symbolId));
  }

  /**
   * Delete a memo.
   */
  delete(queryName: string, symbolId: SymbolId, argsHash?: string): boolean {
    if (argsHash) {
      return this.stringMemos.delete(this.stringKey(queryName, symbolId, argsHash));
    }
    const queryIndex = this.registry.register(queryName);
    const packed = packMemoKey(queryIndex, symbolId);
    if (packed !== null) {
      return this.packedMemos.delete(packed);
    }
    return this.stringMemos.delete(this.stringKey(queryName, symbolId));
  }

  /** Total number of memos across both tiers. */
  get size(): number {
    return this.packedMemos.size + this.stringMemos.size;
  }

  /** Clear all memos. */
  clear(): void {
    this.packedMemos.clear();
    this.stringMemos.clear();
  }

  /**
   * Iterate over all entries (both tiers).
   * Yields [queryName, symbolId, value, argsHash?].
   */
  *entries(): IterableIterator<[queryName: string, symbolId: SymbolId, value: T, argsHash?: string]> {
    for (const [packed, value] of this.packedMemos) {
      const [queryIndex, symbolId] = unpackMemoKey(packed);
      yield [this.registry.resolve(queryIndex), symbolId, value, undefined];
    }
    for (const [key, value] of this.stringMemos) {
      const parts = key.split(":");
      const queryName = parts[0]!;
      const symbolId = Number(parts[1]);
      const argsHash = parts.length > 2 ? parts.slice(2).join(":") : undefined;
      yield [queryName, symbolId, value, argsHash];
    }
  }

  /**
   * Evict the oldest N entries from the packed tier.
   * Returns the evicted entries for potential cache-store persistence.
   */
  evictOldest(count: number): T[] {
    const evicted: T[] = [];
    let n = 0;
    for (const [key, value] of this.packedMemos) {
      if (n >= count) break;
      evicted.push(value);
      this.packedMemos.delete(key);
      n++;
    }
    // If we still need more, evict from string tier
    if (n < count) {
      for (const [key, value] of this.stringMemos) {
        if (n >= count) break;
        evicted.push(value);
        this.stringMemos.delete(key);
        n++;
      }
    }
    return evicted;
  }

  /**
   * Delete all memos for a specific symbol ID (across all query names).
   * Used during invalidation when a symbol is deleted.
   */
  deleteAllForSymbol(symbolId: SymbolId): void {
    // For packed memos: scan all possible query indices
    if (symbolId >= 0 && symbolId <= MAX_PACKABLE_SYMBOL_ID) {
      for (let qi = 0; qi < this.registry.size; qi++) {
        const packed = packMemoKey(qi, symbolId);
        if (packed !== null) {
          this.packedMemos.delete(packed);
        }
      }
    }

    // For string memos: scan keys containing this symbol ID
    const suffix = `:${symbolId}`;
    const suffixColon = `:${symbolId}:`;
    for (const key of this.stringMemos.keys()) {
      if (key.endsWith(suffix) || key.includes(suffixColon)) {
        this.stringMemos.delete(key);
      }
    }
  }

  private stringKey(queryName: string, symbolId: SymbolId, argsHash?: string): string {
    return argsHash ? `${queryName}:${symbolId}:${argsHash}` : `${queryName}:${symbolId}`;
  }
}
