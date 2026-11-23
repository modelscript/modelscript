// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasCrdtDelta } from "./crdt-store.js";

export interface CanvasOfflineCache {
  load(boardId: string): Promise<CanvasCrdtDelta | null>;
  save(boardId: string, delta: CanvasCrdtDelta): Promise<void>;
  clear(boardId: string): Promise<void>;
}

const DB_NAME = "modelscript_spatial_canvas_v1";
const STORE_NAME = "boards";

/**
 * Offline-first IndexedDB persistence for `CanvasCrdtStore` deltas.
 * Automatically falls back to an in-memory map in non-browser/SSR/Node environments.
 */
export class CanvasIndexedDbCache implements CanvasOfflineCache {
  private readonly memoryFallback = new Map<string, CanvasCrdtDelta>();

  private hasIndexedDb(): boolean {
    return (
      typeof globalThis !== "undefined" && typeof (globalThis as { indexedDB?: unknown }).indexedDB !== "undefined"
    );
  }

  public async load(boardId: string): Promise<CanvasCrdtDelta | null> {
    if (!this.hasIndexedDb()) {
      return this.memoryFallback.get(boardId) ?? null;
    }
    try {
      const db = await this.openDb();
      return await new Promise<CanvasCrdtDelta | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(boardId);
        req.onsuccess = () => resolve((req.result as CanvasCrdtDelta | undefined) ?? null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.memoryFallback.get(boardId) ?? null;
    }
  }

  public async save(boardId: string, delta: CanvasCrdtDelta): Promise<void> {
    this.memoryFallback.set(boardId, structuredClone(delta));
    if (!this.hasIndexedDb()) return;
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(delta, boardId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Keep memory fallback on quota/private-mode errors
    }
  }

  public async clear(boardId: string): Promise<void> {
    this.memoryFallback.delete(boardId);
    if (!this.hasIndexedDb()) return;
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(boardId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Ignore cleanup errors
    }
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
}
