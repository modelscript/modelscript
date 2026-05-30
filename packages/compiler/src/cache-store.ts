import type { Memo, QueryCacheStore } from "./runtime.js";

/**
 * An in-memory implementation of the QueryCacheStore.
 * Primarily used as a fallback or for testing when no persistent
 * storage (IndexedDB / SQLite) is provided.
 */
export class MemoryQueryCacheStore implements QueryCacheStore {
  private store = new Map<number, Memo>();

  async getMemo(key: number): Promise<Memo | undefined> {
    return this.store.get(key);
  }

  async getMemos(keys: number[]): Promise<Map<number, Memo>> {
    const result = new Map<number, Memo>();
    for (const key of keys) {
      const memo = this.store.get(key);
      if (memo !== undefined) {
        result.set(key, memo);
      }
    }
    return result;
  }

  async setMemo(key: number, memo: Memo): Promise<void> {
    this.store.set(key, memo);
  }

  async setMemos(memos: Map<number, Memo>): Promise<void> {
    for (const [key, memo] of memos) {
      this.store.set(key, memo);
    }
  }

  async deleteMemo(key: number): Promise<void> {
    this.store.delete(key);
  }

  async clearMemos(): Promise<void> {
    this.store.clear();
  }
}
