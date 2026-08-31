// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Salsa Query Memo Cache Stores & Federated Endpoints.
 *
 * Provides:
 *  - MemoryQueryCacheStore: in-memory query cache store
 *  - IndexedDBQueryCacheStore: browser-native IndexedDB query cache store
 *  - FederatedQueryCacheStore: multi-endpoint remote query cache store
 */

import type { Memo, QueryCacheStore } from "../compiler/runtime.js";

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

/**
 * IndexedDB-backed implementation of QueryCacheStore for browser environments.
 */
export class IndexedDBQueryCacheStore implements QueryCacheStore {
  private dbName: string;
  private storeName = "memos";
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dbName = "modelscript-cache") {
    this.dbName = dbName;
  }

  private async getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        return reject(new Error("IndexedDB is not available in this environment."));
      }

      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };

      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });

    return this.dbPromise;
  }

  async getMemo(key: number): Promise<Memo | undefined> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readonly");
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result as Memo | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  async getMemos(keys: number[]): Promise<Map<number, Memo>> {
    const db = await this.getDB();
    const result = new Map<number, Memo>();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readonly");
      const store = transaction.objectStore(this.storeName);
      let completed = 0;

      if (keys.length === 0) {
        resolve(result);
        return;
      }

      for (const key of keys) {
        const request = store.get(key);
        request.onsuccess = () => {
          if (request.result !== undefined) {
            result.set(key, request.result);
          }
          completed++;
          if (completed === keys.length) resolve(result);
        };
        request.onerror = () => {
          reject(request.error);
        };
      }
    });
  }

  async setMemo(key: number, memo: Memo): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      const store = transaction.objectStore(this.storeName);
      const request = store.put(memo, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async setMemos(memos: Map<number, Memo>): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      const store = transaction.objectStore(this.storeName);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const [key, memo] of memos.entries()) {
        store.put(memo, key);
      }
    });
  }

  async deleteMemo(key: number): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clearMemos(): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

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
    await this.localStore.setMemo(key, memo);
  }

  async setMemos(memos: Map<number, Memo>): Promise<void> {
    await this.localStore.setMemos(memos);
  }

  async deleteMemo(key: number): Promise<void> {
    await this.localStore.deleteMemo(key);
  }

  async clearMemos(): Promise<void> {
    await this.localStore.clearMemos();
  }

  private async fetchFromFederated(keys: number[]): Promise<Map<number, Memo>> {
    const result = new Map<number, Memo>();
    const endpoints = this.endpointProvider.getEndpoints();

    if (endpoints.length === 0 || keys.length === 0) return result;

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
        console.warn(`[FederatedCache] Failed to fetch from ${endpoint}`, err);
      }
    }

    return result;
  }
}
