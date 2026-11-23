// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorldBounds, WorldPoint } from "../schema/canvas-document.js";

export interface IndexedSpatialItem {
  id: string;
  bounds: WorldBounds;
  zIndex: number;
}

export function boundsIntersect(a: WorldBounds, b: WorldBounds): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export function pointInBounds(pt: WorldPoint, bounds: WorldBounds): boolean {
  return pt.x >= bounds.x && pt.x <= bounds.x + bounds.width && pt.y >= bounds.y && pt.y <= bounds.y + bounds.height;
}

/**
 * Uniform-grid spatial hash index for O(K_visible) frustum culling,
 * marquee selection, and topmost point hit-testing on large polyglot boards.
 */
export class CanvasSpatialIndex<T extends IndexedSpatialItem = IndexedSpatialItem> {
  private readonly cellSize: number;
  private readonly buckets = new Map<string, Set<string>>();
  private readonly items = new Map<string, T>();
  private readonly itemCells = new Map<string, string[]>();

  constructor(cellSize = 512) {
    this.cellSize = Math.max(64, cellSize);
  }

  public get size(): number {
    return this.items.size;
  }

  public clear(): void {
    this.buckets.clear();
    this.items.clear();
    this.itemCells.clear();
  }

  public upsert(item: T): void {
    if (this.items.has(item.id)) {
      this.remove(item.id);
    }
    this.items.set(item.id, item);
    const keys = this.computeCellKeys(item.bounds);
    this.itemCells.set(item.id, keys);
    for (const key of keys) {
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = new Set<string>();
        this.buckets.set(key, bucket);
      }
      bucket.add(item.id);
    }
  }

  public remove(id: string): void {
    const keys = this.itemCells.get(id);
    if (keys) {
      for (const key of keys) {
        const bucket = this.buckets.get(key);
        if (bucket) {
          bucket.delete(id);
          if (bucket.size === 0) {
            this.buckets.delete(key);
          }
        }
      }
      this.itemCells.delete(id);
    }
    this.items.delete(id);
  }

  public rebuild(items: Iterable<T>): void {
    this.clear();
    for (const item of items) {
      this.upsert(item);
    }
  }

  /** Returns all items intersecting the given world-space frustum/marquee, sorted by zIndex ascending. */
  public queryRect(rect: WorldBounds): T[] {
    const seen = new Set<string>();
    const results: T[] = [];
    for (const key of this.computeCellKeys(rect)) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      for (const id of bucket) {
        if (seen.has(id)) continue;
        seen.add(id);
        const item = this.items.get(id);
        if (item && boundsIntersect(item.bounds, rect)) {
          results.push(item);
        }
      }
    }
    results.sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
    return results;
  }

  /** Returns all items containing a world-space point, sorted topmost (highest zIndex) first. */
  public hitTestPoint(pt: WorldPoint): T[] {
    const gx = Math.floor(pt.x / this.cellSize);
    const gy = Math.floor(pt.y / this.cellSize);
    const bucket = this.buckets.get(`${gx},${gy}`);
    if (!bucket) return [];
    const hits: T[] = [];
    for (const id of bucket) {
      const item = this.items.get(id);
      if (item && pointInBounds(pt, item.bounds)) {
        hits.push(item);
      }
    }
    hits.sort((a, b) => b.zIndex - a.zIndex || b.id.localeCompare(a.id));
    return hits;
  }

  /** Computes the union bounding box of all indexed items (useful for Zoom-to-Fit). */
  public getTotalBounds(): WorldBounds | null {
    if (this.items.size === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of this.items.values()) {
      minX = Math.min(minX, item.bounds.x);
      minY = Math.min(minY, item.bounds.y);
      maxX = Math.max(maxX, item.bounds.x + item.bounds.width);
      maxY = Math.max(maxY, item.bounds.y + item.bounds.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  private computeCellKeys(bounds: WorldBounds): string[] {
    const x0 = Math.floor(bounds.x / this.cellSize);
    const y0 = Math.floor(bounds.y / this.cellSize);
    const x1 = Math.floor((bounds.x + bounds.width) / this.cellSize);
    const y1 = Math.floor((bounds.y + bounds.height) / this.cellSize);
    const maxSpan = 64;
    const cx1 = Math.min(x1, x0 + maxSpan);
    const cy1 = Math.min(y1, y0 + maxSpan);
    const keys: string[] = [];
    for (let gx = x0; gx <= cx1; gx++) {
      for (let gy = y0; gy <= cy1; gy++) {
        keys.push(`${gx},${gy}`);
      }
    }
    return keys;
  }
}
