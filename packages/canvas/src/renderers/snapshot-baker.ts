// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Canvas2DContextLike } from "../engine/glyph-compiler.js";

/**
 * 3D LOD Offscreen Snapshot Baker for Shared Scissor 3D Portals.
 *
 * Captures scissor crops from the shared Layer 1 WebGL/WebGPU canvas into an
 * LRU-bounded cache of `ImageBitmap` (or offscreen canvas / synthetic headless)
 * snapshots so idle or zoomed-out 3D CAD/FEA/CFD portals freeze at zero GPU
 * cost and paint crisply onto Layer 0 Canvas2D.
 */

export interface SnapshotCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapshotBitmapLike {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  close?(): void;
}

export interface SnapshotSourceCanvasLike {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface BakedPortalSnapshot {
  portalId: string;
  stampKey: string;
  width: number;
  height: number;
  capturedAtMs: number;
  /** Captured GPU/offscreen bitmap when available, or `null` for synthetic headless snapshots. */
  image: ImageBitmap | HTMLCanvasElement | SnapshotBitmapLike | null;
  /** True when captured as a metadata-only fallback without browser image capture APIs. */
  synthetic: boolean;
}

export interface FrozenPortalPaintTarget {
  portalId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  snapshotFrozen: boolean;
  label?: string | undefined;
}

export interface ScissorSnapshotBakerOptions {
  /** Maximum number of cached portal snapshots before LRU eviction (default 32). */
  maxSnapshots?: number | undefined;
  /** Optional custom `createImageBitmap` implementation for headless/unit testing. */
  createImageBitmapFn?:
    | ((
        source: HTMLCanvasElement | SnapshotSourceCanvasLike,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
      ) => Promise<SnapshotBitmapLike>)
    | undefined;
}

type Canvas2DWithDrawImage = Canvas2DContextLike & {
  drawImage?: (image: unknown, dx: number, dy: number, dWidth: number, dHeight: number) => void;
};

type OffscreenCopyContextLike = {
  drawImage?: (
    image: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => void;
};

function closeSnapshotImage(image: BakedPortalSnapshot["image"]): void {
  if (!image) return;
  const closable = image as SnapshotBitmapLike;
  if (typeof closable.close === "function") {
    try {
      closable.close();
    } catch {
      // Ignore already-closed ImageBitmap handles
    }
  }
}

export class ScissorSnapshotBaker {
  private readonly maxSnapshots: number;
  private readonly snapshots = new Map<string, BakedPortalSnapshot>();
  private readonly customCreateImageBitmap: ScissorSnapshotBakerOptions["createImageBitmapFn"] | undefined;

  constructor(options: ScissorSnapshotBakerOptions | number = {}) {
    if (typeof options === "number") {
      this.maxSnapshots = Math.max(1, Math.floor(options));
      this.customCreateImageBitmap = undefined;
    } else {
      this.maxSnapshots = Math.max(1, Math.floor(options.maxSnapshots ?? 32));
      this.customCreateImageBitmap = options.createImageBitmapFn;
    }
  }

  public get size(): number {
    return this.snapshots.size;
  }

  /**
   * Captures a scissor crop from `sourceCanvas` into the LRU snapshot cache.
   * Uses `createImageBitmap` when available, falling back to an offscreen 2D
   * canvas copy or a synthetic metadata snapshot in headless environments.
   */
  public async captureFromCanvas(
    portalId: string,
    sourceCanvas: HTMLCanvasElement | SnapshotSourceCanvasLike | null,
    rect: SnapshotCropRect,
    stampKey: string,
  ): Promise<boolean> {
    const rawW = Math.floor(rect.width);
    const rawH = Math.floor(rect.height);
    if (!portalId || !Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW <= 0 || rawH <= 0) {
      return false;
    }

    const existing = this.snapshots.get(portalId);
    if (existing && existing.stampKey === stampKey) {
      // Touch LRU order without redundant GPU readback
      this.snapshots.delete(portalId);
      this.snapshots.set(portalId, existing);
      return true;
    }

    let sx = Math.max(0, Math.floor(rect.x));
    let sy = Math.max(0, Math.floor(rect.y));
    let sw = rawW;
    let sh = rawH;

    if (sourceCanvas) {
      const canvasW = typeof sourceCanvas.width === "number" ? Math.floor(sourceCanvas.width) : 0;
      const canvasH = typeof sourceCanvas.height === "number" ? Math.floor(sourceCanvas.height) : 0;
      if (canvasW > 0 && canvasH > 0) {
        sx = Math.min(sx, Math.max(0, canvasW - 1));
        sy = Math.min(sy, Math.max(0, canvasH - 1));
        sw = Math.max(1, Math.min(sw, canvasW - sx));
        sh = Math.max(1, Math.min(sh, canvasH - sy));
      }
    }

    let image: BakedPortalSnapshot["image"] = null;
    let synthetic = true;

    if (sourceCanvas) {
      const bitmapFn =
        this.customCreateImageBitmap ??
        (typeof globalThis.createImageBitmap === "function"
          ? (src: HTMLCanvasElement | SnapshotSourceCanvasLike, cx: number, cy: number, cw: number, ch: number) =>
              globalThis.createImageBitmap(src as CanvasImageSource, cx, cy, cw, ch) as Promise<SnapshotBitmapLike>
          : undefined);

      if (bitmapFn) {
        try {
          image = await bitmapFn(sourceCanvas, sx, sy, sw, sh);
          synthetic = false;
        } catch {
          image = null;
          synthetic = true;
        }
      }

      if (!image) {
        const offscreenCopy = this.copyToOffscreenCanvas(sourceCanvas, sx, sy, sw, sh);
        if (offscreenCopy) {
          image = offscreenCopy;
          synthetic = false;
        }
      }
    }

    if (existing) {
      closeSnapshotImage(existing.image);
      this.snapshots.delete(portalId);
    }

    const baked: BakedPortalSnapshot = {
      portalId,
      stampKey,
      width: sw,
      height: sh,
      capturedAtMs: Date.now(),
      image,
      synthetic,
    };

    this.snapshots.set(portalId, baked);
    this.evictOverflow();
    return true;
  }

  public hasSnapshot(portalId: string, stampKey?: string): boolean {
    const snap = this.snapshots.get(portalId);
    if (!snap) return false;
    if (stampKey !== undefined && snap.stampKey !== stampKey) return false;
    return true;
  }

  public getSnapshot(portalId: string): BakedPortalSnapshot | undefined {
    const snap = this.snapshots.get(portalId);
    if (!snap) return undefined;
    // Refresh LRU recency
    this.snapshots.delete(portalId);
    this.snapshots.set(portalId, snap);
    return snap;
  }

  /**
   * Paints all frozen portals that have a baked snapshot onto Layer 0 Canvas2D,
   * using `ctx.drawImage` when an `ImageBitmap`/canvas is available or a crisp
   * frozen-frame card fallback in headless/synthetic mode.
   */
  public paintFrozenSnapshots(ctx: Canvas2DContextLike, portals: ReadonlyArray<FrozenPortalPaintTarget>): number {
    let painted = 0;
    const drawImage = (ctx as Canvas2DWithDrawImage).drawImage;

    for (const portal of portals) {
      if (!portal.snapshotFrozen || portal.width <= 0 || portal.height <= 0) {
        continue;
      }

      const snap = this.getSnapshot(portal.portalId);
      if (!snap) {
        continue;
      }

      ctx.save();
      if (snap.image && typeof drawImage === "function") {
        drawImage.call(ctx, snap.image, portal.x, portal.y, portal.width, portal.height);
        // Subtle frozen-frame border + badge
        ctx.strokeStyle = "rgba(56, 189, 248, 0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(portal.x, portal.y, portal.width, portal.height);
        ctx.stroke();

        if (portal.label && portal.width >= 72 && portal.height >= 36) {
          const badgeH = 16;
          ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
          ctx.beginPath();
          ctx.rect(portal.x + 4, portal.y + 4, Math.min(portal.width - 8, 124), badgeH);
          ctx.fill();
          ctx.font = "600 9px sans-serif";
          ctx.fillStyle = "#e2e8f0";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(portal.label, portal.x + 8, portal.y + 4 + badgeH / 2);
        }
      } else {
        this.paintFrozenCardFallback(ctx, portal, snap);
      }
      ctx.restore();
      painted++;
    }

    return painted;
  }

  public invalidate(portalId?: string): void {
    if (portalId === undefined) {
      for (const snap of this.snapshots.values()) {
        closeSnapshotImage(snap.image);
      }
      this.snapshots.clear();
      return;
    }

    const existing = this.snapshots.get(portalId);
    if (existing) {
      closeSnapshotImage(existing.image);
      this.snapshots.delete(portalId);
    }
  }

  public dispose(): void {
    this.invalidate();
  }

  private evictOverflow(): void {
    while (this.snapshots.size > this.maxSnapshots) {
      const oldestKey = this.snapshots.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.snapshots.get(oldestKey);
      if (oldest) {
        closeSnapshotImage(oldest.image);
      }
      this.snapshots.delete(oldestKey);
    }
  }

  private copyToOffscreenCanvas(
    sourceCanvas: HTMLCanvasElement | SnapshotSourceCanvasLike,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): HTMLCanvasElement | SnapshotBitmapLike | null {
    try {
      if (typeof OffscreenCanvas !== "undefined") {
        const offscreen = new OffscreenCanvas(sw, sh);
        const offCtx = offscreen.getContext("2d") as OffscreenCopyContextLike | null;
        if (offCtx && typeof offCtx.drawImage === "function") {
          offCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
          return offscreen as unknown as SnapshotBitmapLike;
        }
      }

      if (typeof document !== "undefined" && typeof document.createElement === "function") {
        const copyCanvas = document.createElement("canvas");
        copyCanvas.width = sw;
        copyCanvas.height = sh;
        const copyCtx = copyCanvas.getContext("2d") as OffscreenCopyContextLike | null;
        if (copyCtx && typeof copyCtx.drawImage === "function") {
          copyCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
          return copyCanvas;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private paintFrozenCardFallback(
    ctx: Canvas2DContextLike,
    portal: FrozenPortalPaintTarget,
    snap: BakedPortalSnapshot,
  ): void {
    const { x, y, width, height } = portal;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, width, height, 6);
    } else {
      ctx.rect(x, y, width, height);
    }
    ctx.fillStyle = "#0f172a";
    ctx.fill();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Subtle isometric cube wireframe indicator at card center
    const cx = x + width / 2;
    const cy = y + height / 2;
    const r = Math.max(8, Math.min(width, height) * 0.22);
    const dx = r * 0.866;
    const dy = r * 0.5;

    ctx.strokeStyle = "rgba(56, 189, 248, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + dx, cy - dy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - dx, cy + dy);
    ctx.lineTo(cx - dx, cy - dy);
    ctx.closePath();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + dx, cy - dy);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - dx, cy - dy);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();

    const title = portal.label ?? portal.portalId;
    if (width >= 56 && height >= 28) {
      ctx.font = "600 10px sans-serif";
      ctx.fillStyle = "#e2e8f0";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(title, x + 8, y + 12);

      if (height >= 48) {
        ctx.font = "9px monospace";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText(`3D LOD · ${snap.stampKey}`, x + 8, y + height - 10);
      }
    }
  }
}
