import type { Memo, QueryCacheStore } from "./runtime.js";

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
      // Compatibility check
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
