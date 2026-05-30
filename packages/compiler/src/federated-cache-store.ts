import type { Memo, QueryCacheStore } from "./runtime.js";

/**
 * Provides a dynamic list of federated endpoints to query.
 * This allows the cache store to adapt as remote libraries are added or removed from the context.
 */
export interface FederatedEndpointProvider {
  getEndpoints(): string[];
}

/**
 * A composite QueryCacheStore that first checks a local cache (e.g., IndexedDB),
 * and for any missing keys, queries a list of remote federated endpoints provided dynamically.
 * Newly fetched memos are saved to the local cache.
 */
export class FederatedQueryCacheStore implements QueryCacheStore {
  constructor(
    private localStore: QueryCacheStore,
    private endpointProvider: FederatedEndpointProvider,
  ) {}

  async getMemo(key: number): Promise<Memo | undefined> {
    const local = await this.localStore.getMemo(key);
    if (local) return local;

    const remoteMemos = await this.fetchFromFederated([key]);
    const remote = remoteMemos.get(key);
    if (remote) {
      await this.localStore.setMemo(key, remote);
      return remote;
    }

    return undefined;
  }

  async getMemos(keys: number[]): Promise<Map<number, Memo>> {
    const localMemos = await this.localStore.getMemos(keys);
    const missingKeys = keys.filter((key) => !localMemos.has(key));

    if (missingKeys.length === 0) {
      return localMemos;
    }

    const remoteMemos = await this.fetchFromFederated(missingKeys);

    // Save newly fetched memos to local cache
    if (remoteMemos.size > 0) {
      await this.localStore.setMemos(remoteMemos);
    }

    const result = new Map<number, Memo>(localMemos);
    for (const [key, memo] of remoteMemos) {
      result.set(key, memo);
    }

    return result;
  }

  async setMemo(key: number, memo: Memo): Promise<void> {
    // Only write to local store
    await this.localStore.setMemo(key, memo);
  }

  async setMemos(memos: Map<number, Memo>): Promise<void> {
    // Only write to local store
    await this.localStore.setMemos(memos);
  }

  async deleteMemo(key: number): Promise<void> {
    await this.localStore.deleteMemo(key);
  }

  async clearMemos(): Promise<void> {
    await this.localStore.clearMemos();
  }

  /**
   * Helper to fetch missing keys from federated endpoints.
   */
  private async fetchFromFederated(keys: number[]): Promise<Map<number, Memo>> {
    const result = new Map<number, Memo>();
    const endpoints = this.endpointProvider.getEndpoints();

    if (endpoints.length === 0 || keys.length === 0) return result;

    // Batched to avoid URI too long. For now, assume a reasonable size.
    const keysParam = keys.join(",");

    for (const endpoint of endpoints) {
      try {
        const url = new URL(endpoint);
        url.searchParams.set("keys", keysParam);

        const response = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
        });

        if (response.ok) {
          const data = (await response.json()) as { memos: Record<string, Memo> };
          if (data && data.memos) {
            for (const [k, v] of Object.entries(data.memos)) {
              result.set(Number(k), v);
            }
          }
        }
      } catch (err) {
        // Ignore network errors for a single federated endpoint, continue to next
        console.warn(`[FederatedCache] Failed to fetch from ${endpoint}`, err);
      }
    }

    return result;
  }
}
