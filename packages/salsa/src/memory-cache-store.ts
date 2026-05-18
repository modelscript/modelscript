import type { Memo, QueryCacheStore } from "./types.js";

/**
 * An in-memory implementation of the QueryCacheStore.
 * Primarily used as a fallback or for testing when no persistent
 * storage (IndexedDB / SQLite) is provided.
 */
export class MemoryQueryCacheStore implements QueryCacheStore {
  private store = new Map<string, Memo>();

  async getMemo(key: string): Promise<Memo | undefined> {
    return this.store.get(key);
  }

  async getMemos(keys: string[]): Promise<Map<string, Memo>> {
    const result = new Map<string, Memo>();
    for (const key of keys) {
      const memo = this.store.get(key);
      if (memo !== undefined) {
        result.set(key, memo);
      }
    }
    return result;
  }

  async setMemo(key: string, memo: Memo): Promise<void> {
    this.store.set(key, memo);
  }

  async setMemos(memos: Map<string, Memo>): Promise<void> {
    for (const [key, memo] of memos) {
      this.store.set(key, memo);
    }
  }

  async deleteMemo(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clearMemos(): Promise<void> {
    this.store.clear();
  }
}
