// SPDX-License-Identifier: AGPL-3.0-or-later

const DB_NAME = "modelscript_offline_v1";
const DB_VERSION = 1;

export interface CachedArtifact {
  id: string | number;
  data: any;
  timestamp: number;
}

export interface CachedPost {
  id: string | number;
  data: any;
  timestamp: number;
}

export interface PlaygroundDraft {
  id: string;
  code: string;
  title: string;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      dbPromise = null;
      reject(new Error("IndexedDB not supported in current environment."));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("artifacts")) {
        db.createObjectStore("artifacts", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("timeline")) {
        db.createObjectStore("timeline", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("playground_drafts")) {
        db.createObjectStore("playground_drafts", { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function awaitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Cache an engineering artifact view in IndexedDB for offline inspection.
 */
export async function cacheArtifact(artifact: any): Promise<void> {
  if (!artifact?.id) return;
  try {
    const db = await openDatabase();
    const tx = db.transaction("artifacts", "readwrite");
    const store = tx.objectStore("artifacts");
    store.put({
      id: String(artifact.id),
      data: artifact,
      timestamp: Date.now(),
    });
    await awaitTx(tx);
  } catch (err) {
    console.warn("[offline-storage] Failed to cache artifact:", err);
  }
}

/**
 * Retrieve a cached artifact from IndexedDB if offline.
 */
export async function getCachedArtifact(id: string | number): Promise<any | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction("artifacts", "readonly");
      const store = tx.objectStore("artifacts");
      const req = store.get(String(id));
      req.onsuccess = () => resolve(req.result?.data ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Cache a batch of timeline posts for offline feed rendering.
 */
export async function cacheTimelinePosts(posts: any[]): Promise<void> {
  if (!Array.isArray(posts) || posts.length === 0) return;
  try {
    const db = await openDatabase();
    const tx = db.transaction("timeline", "readwrite");
    const store = tx.objectStore("timeline");
    const now = Date.now();
    for (const post of posts) {
      if (post?.id) {
        store.put({
          id: String(post.id),
          data: post,
          timestamp: now,
        });
      }
    }
    await awaitTx(tx);
  } catch (err) {
    console.warn("[offline-storage] Failed to cache timeline posts:", err);
  }
}

/**
 * Retrieve cached timeline posts sorted by timestamp.
 */
export async function getCachedTimelinePosts(): Promise<any[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction("timeline", "readonly");
      const store = tx.objectStore("timeline");
      const req = store.getAll();
      req.onsuccess = () => {
        const results = req.result || [];
        results.sort((a, b) => b.timestamp - a.timestamp);
        resolve(results.map((r) => r.data));
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/**
 * Save an active model draft from the Playground to persistent IndexedDB.
 */
export async function savePlaygroundDraft(id: string, code: string, title: string): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction("playground_drafts", "readwrite");
    const store = tx.objectStore("playground_drafts");
    store.put({
      id,
      code,
      title,
      updatedAt: Date.now(),
    });
    await awaitTx(tx);
  } catch (err) {
    console.warn("[offline-storage] Failed to save playground draft:", err);
  }
}

/**
 * Retrieve a saved model draft from IndexedDB.
 */
export async function getPlaygroundDraft(id: string): Promise<PlaygroundDraft | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction("playground_drafts", "readonly");
      const store = tx.objectStore("playground_drafts");
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Clear all cached offline data from IndexedDB.
 */
export async function clearOfflineCache(): Promise<void> {
  try {
    const db = await openDatabase();
    const storeNames = ["artifacts", "timeline", "playground_drafts"].filter((name) =>
      db.objectStoreNames.contains(name),
    );
    if (storeNames.length === 0) return;
    const tx = db.transaction(storeNames, "readwrite");
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    await awaitTx(tx);
  } catch (err) {
    console.warn("[offline-storage] Failed to clear offline cache:", err);
  }
}
