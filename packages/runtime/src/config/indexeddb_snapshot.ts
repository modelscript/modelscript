// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Client-Side Binary Snapshot Store for WASM Indices and Knowledge Stores.
 * Persists compiled stub tables, Merkle hashes, and version vectors to IndexedDB (browser)
 * or local storage for sub-millisecond cold starts (Blueprint 5).
 */

export interface CachedIndexSnapshot {
  version: number;
  timestamp: number;
  data: Uint8Array;
  workspaceFqnMap?: Record<string, number> | undefined;
}

interface MinimalIDBRequest<T> {
  result: T;
  error: unknown;
  onsuccess: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}

interface MinimalIDBOpenDBRequest extends MinimalIDBRequest<MinimalIDBDatabase> {
  onupgradeneeded: ((ev?: unknown) => void) | null;
}

interface MinimalIDBObjectStore {
  put(value: unknown, key?: string): unknown;
  get(key: string): MinimalIDBRequest<CachedIndexSnapshot | undefined>;
  delete(key: string): unknown;
}

interface MinimalIDBTransaction {
  objectStore(name: string): MinimalIDBObjectStore;
}

interface MinimalIDBDatabase {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string): unknown;
  transaction(storeName: string, mode: "readonly" | "readwrite"): MinimalIDBTransaction;
}

interface MinimalIDBFactory {
  open(name: string, version?: number): MinimalIDBOpenDBRequest;
}

function getIndexedDB(): MinimalIDBFactory | undefined {
  return (globalThis as { indexedDB?: MinimalIDBFactory }).indexedDB;
}

export class IndexedDbSnapshotStore {
  private dbName: string;
  private storeName: string;
  private memoryCache: Map<string, CachedIndexSnapshot>;

  constructor(dbName: string = "modelscript_cache", storeName: string = "wasm_snapshots") {
    this.dbName = dbName;
    this.storeName = storeName;
    this.memoryCache = new Map();
  }

  /**
   * Saves a binary snapshot to storage.
   */
  async saveSnapshot(key: string, data: Uint8Array, extra: Partial<CachedIndexSnapshot> = {}): Promise<void> {
    const record: CachedIndexSnapshot = {
      version: 2,
      timestamp: Date.now(),
      data: new Uint8Array(data),
      ...extra,
    };

    this.memoryCache.set(key, record);

    const idb = getIndexedDB();
    if (typeof idb !== "undefined") {
      try {
        const db = await this.openDB(idb);
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);
        store.put(record, key);
      } catch (err) {
        console.warn("Failed to persist snapshot to IndexedDB:", err);
      }
    }
  }

  /**
   * Loads a binary snapshot from storage.
   */
  async loadSnapshot(key: string): Promise<CachedIndexSnapshot | null> {
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key)!;
    }

    const idb = getIndexedDB();
    if (typeof idb !== "undefined") {
      try {
        const db = await this.openDB(idb);
        return new Promise((resolve) => {
          const tx = db.transaction(this.storeName, "readonly");
          const store = tx.objectStore(this.storeName);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });
      } catch (err) {
        console.warn("Failed to read snapshot from IndexedDB:", err);
        return null;
      }
    }

    return null;
  }

  /**
   * Deletes a snapshot from storage.
   */
  async deleteSnapshot(key: string): Promise<void> {
    this.memoryCache.delete(key);
    const idb = getIndexedDB();
    if (typeof idb !== "undefined") {
      try {
        const db = await this.openDB(idb);
        const tx = db.transaction(this.storeName, "readwrite");
        tx.objectStore(this.storeName).delete(key);
      } catch (err) {
        console.warn("Failed to delete snapshot from IndexedDB:", err);
      }
    }
  }

  private openDB(idb: MinimalIDBFactory): Promise<MinimalIDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = idb.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
}
