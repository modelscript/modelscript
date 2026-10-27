// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GPUArenaBuffers } from "./gpu-buffers.js";

const DB_NAME = "modelscript-wgsl-cache";
const STORE_NAME = "shaders";

/**
 * Computes a structural hash of the arena buffers.
 * This represents the exact mathematical topology of the simulation.
 */
async function computeHash(buffers: GPUArenaBuffers): Promise<string> {
  const totalLength = buffers.varBuffer.byteLength + buffers.eqBuffer.byteLength + buffers.exprBuffer.byteLength;
  const combined = new Uint8Array(totalLength);

  let offset = 0;
  combined.set(
    new Uint8Array(buffers.varBuffer.buffer, buffers.varBuffer.byteOffset, buffers.varBuffer.byteLength),
    offset,
  );
  offset += buffers.varBuffer.byteLength;

  combined.set(
    new Uint8Array(buffers.eqBuffer.buffer, buffers.eqBuffer.byteOffset, buffers.eqBuffer.byteLength),
    offset,
  );
  offset += buffers.eqBuffer.byteLength;

  combined.set(
    new Uint8Array(buffers.exprBuffer.buffer, buffers.exprBuffer.byteOffset, buffers.exprBuffer.byteLength),
    offset,
  );

  const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface BrowserCacheGlobal {
  crypto?: Crypto | undefined;
  indexedDB?: IDBFactory | undefined;
}

/**
 * Attempt to retrieve a cached WGSL shader string for this model topology.
 */
export async function getCachedWGSL(buffers: GPUArenaBuffers): Promise<string | null> {
  const glob = typeof globalThis !== "undefined" ? (globalThis as BrowserCacheGlobal) : undefined;
  if (!glob || !glob.crypto || !glob.crypto.subtle || !glob.indexedDB) {
    return null;
  }

  try {
    const hash = await computeHash(buffers);
    const idb = glob.indexedDB;

    return new Promise((resolve) => {
      const req = idb.open(DB_NAME, 1);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          resolve(null);
          return;
        }
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get(hash);

        getReq.onsuccess = () => resolve((getReq.result as string) || null);
        getReq.onerror = () => resolve(null);
      };

      req.onerror = () => resolve(null);
    });
  } catch {
    return null; // Fallback to generation if hashing fails
  }
}

/**
 * Persist the generated WGSL string to IndexedDB.
 */
export async function setCachedWGSL(buffers: GPUArenaBuffers, wgsl: string): Promise<void> {
  const glob = typeof globalThis !== "undefined" ? (globalThis as BrowserCacheGlobal) : undefined;
  if (!glob || !glob.crypto || !glob.crypto.subtle || !glob.indexedDB) {
    return;
  }

  try {
    const hash = await computeHash(buffers);
    const idb = glob.indexedDB;

    return new Promise((resolve) => {
      const req = idb.open(DB_NAME, 1);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          resolve();
          return;
        }
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const putReq = store.put(wgsl, hash);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => resolve();
      };
      req.onerror = () => resolve();
    });
  } catch {
    // Ignore cache failure
  }
}
