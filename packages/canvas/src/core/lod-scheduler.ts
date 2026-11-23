// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasTile, TileLodTier } from "../schema/canvas-document.js";

export interface LodThresholds {
  /** Zoom below which tiles collapse to macro cards. */
  macroMaxZoom: number;
  /** Zoom below which tiles render cached thumbnails. */
  thumbnailMaxZoom: number;
  /** Minimum screen width (px) to render above macro tier. */
  macroMinScreenWidthPx: number;
  /** Hysteresis deadband to avoid flickering when zooming right at a threshold. */
  hysteresis: number;
}

export const DEFAULT_LOD_THRESHOLDS: LodThresholds = {
  macroMaxZoom: 0.15,
  thumbnailMaxZoom: 0.45,
  macroMinScreenWidthPx: 90,
  hysteresis: 0.03,
};

/**
 * Resolves the 4-tier semantic LOD for a tile with hysteresis to prevent
 * rapid mount/unmount thrashing at zoom boundaries.
 */
export function resolveTileLodTier(
  tile: Pick<CanvasTile, "id" | "bounds">,
  zoom: number,
  options: {
    focusedTileId?: string | null | undefined;
    previousTier?: TileLodTier | undefined;
    thresholds?: Partial<LodThresholds> | undefined;
  } = {},
): TileLodTier {
  if (options.focusedTileId && options.focusedTileId === tile.id) {
    return "focus";
  }

  const t: LodThresholds = { ...DEFAULT_LOD_THRESHOLDS, ...options.thresholds };
  const screenW = tile.bounds.width * zoom;
  const prev = options.previousTier;

  // Apply hysteresis deadband when transitioning out of a tier
  const macroCutoff = prev === "macro" ? t.macroMaxZoom + t.hysteresis : t.macroMaxZoom - t.hysteresis;
  const thumbCutoff = prev === "thumbnail" ? t.thumbnailMaxZoom + t.hysteresis : t.thumbnailMaxZoom - t.hysteresis;

  if (zoom < macroCutoff || screenW < t.macroMinScreenWidthPx) {
    return "macro";
  }
  if (zoom < thumbCutoff) {
    return "thumbnail";
  }
  return "interactive";
}

export interface WebGlSlotAllocation {
  activeTileIds: string[];
  evictedTileIds: string[];
}

/**
 * LRU budget manager capping simultaneous live WebGL contexts across 3D CAD tiles
 * (`cad3d`) so browsers never hit the hardware WebGL context limit (typically 8-16).
 * Evicted 3D tiles freeze to a high-DPI PNG snapshot until re-focused or hovered.
 */
export class WebGlContextBudget {
  public readonly maxLiveContexts: number;
  private readonly lruOrder: string[] = [];

  constructor(maxLiveContexts = 4) {
    this.maxLiveContexts = Math.max(1, maxLiveContexts);
  }

  /** Requests a live WebGL slot for a 3D tile, returning any evicted tile IDs to snapshot-freeze. */
  public acquire(tileId: string): WebGlSlotAllocation {
    const existingIdx = this.lruOrder.indexOf(tileId);
    if (existingIdx !== -1) {
      this.lruOrder.splice(existingIdx, 1);
      this.lruOrder.push(tileId);
      return { activeTileIds: [...this.lruOrder], evictedTileIds: [] };
    }

    this.lruOrder.push(tileId);
    const evictedTileIds: string[] = [];
    while (this.lruOrder.length > this.maxLiveContexts) {
      const evicted = this.lruOrder.shift();
      if (evicted !== undefined) {
        evictedTileIds.push(evicted);
      }
    }
    return { activeTileIds: [...this.lruOrder], evictedTileIds };
  }

  public release(tileId: string): void {
    const idx = this.lruOrder.indexOf(tileId);
    if (idx !== -1) {
      this.lruOrder.splice(idx, 1);
    }
  }

  public isLive(tileId: string): boolean {
    return this.lruOrder.includes(tileId);
  }

  public getActiveTileIds(): string[] {
    return [...this.lruOrder];
  }
}
