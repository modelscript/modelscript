// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorldBounds, WorldPoint } from "../schema/canvas-document.js";

export interface CameraState {
  /** World-space translation X (screenX = worldX * zoom + tx). */
  tx: number;
  /** World-space translation Y (screenY = worldY * zoom + ty). */
  ty: number;
  /** Uniform zoom scale factor in [minZoom, maxZoom]. */
  zoom: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface CameraControllerOptions {
  minZoom?: number | undefined;
  maxZoom?: number | undefined;
  initial?: Partial<CameraState> | undefined;
}

/**
 * Double-precision infinite spatial camera controller supporting cursor-centered
 * exponential zoom, inertia panning, fit-to-bounds, and GPU transform generation.
 */
export class CameraController {
  public readonly minZoom: number;
  public readonly maxZoom: number;
  private state: CameraState;
  private listeners = new Set<(state: CameraState) => void>();

  constructor(options: CameraControllerOptions = {}) {
    this.minZoom = options.minZoom ?? 0.02;
    this.maxZoom = options.maxZoom ?? 10.0;
    this.state = {
      tx: options.initial?.tx ?? 0,
      ty: options.initial?.ty ?? 0,
      zoom: this.clampZoom(options.initial?.zoom ?? 1),
    };
  }

  public getState(): CameraState {
    return { ...this.state };
  }

  public subscribe(listener: (state: CameraState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setState(next: Partial<CameraState>): CameraState {
    this.state = {
      tx: next.tx ?? this.state.tx,
      ty: next.ty ?? this.state.ty,
      zoom: next.zoom !== undefined ? this.clampZoom(next.zoom) : this.state.zoom,
    };
    this.emit();
    return this.getState();
  }

  public clampZoom(zoom: number): number {
    if (!Number.isFinite(zoom)) return 1;
    return Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
  }

  /** Converts a world-space point into viewport screen pixels. */
  public worldToScreen(pt: WorldPoint): WorldPoint {
    return {
      x: pt.x * this.state.zoom + this.state.tx,
      y: pt.y * this.state.zoom + this.state.ty,
    };
  }

  /** Converts a viewport screen pixel into world-space coordinates. */
  public screenToWorld(pt: WorldPoint): WorldPoint {
    return {
      x: (pt.x - this.state.tx) / this.state.zoom,
      y: (pt.y - this.state.ty) / this.state.zoom,
    };
  }

  /** Pans the camera by screen-space deltas (dx, dy). */
  public panByScreenDelta(dx: number, dy: number): CameraState {
    this.state = {
      ...this.state,
      tx: this.state.tx + dx,
      ty: this.state.ty + dy,
    };
    this.emit();
    return this.getState();
  }

  /**
   * Zooms smoothly around a fixed screen-space focal point (e.g. mouse cursor),
   * preserving the exact world point underneath the cursor.
   */
  public zoomAtScreenPoint(targetZoom: number, focalScreen: WorldPoint): CameraState {
    const clamped = this.clampZoom(targetZoom);
    const worldBefore = this.screenToWorld(focalScreen);
    this.state = {
      zoom: clamped,
      tx: focalScreen.x - worldBefore.x * clamped,
      ty: focalScreen.y - worldBefore.y * clamped,
    };
    this.emit();
    return this.getState();
  }

  /** Applies an exponential wheel zoom step around the cursor. */
  public zoomByWheelDelta(deltaY: number, focalScreen: WorldPoint, sensitivity = 0.0015): CameraState {
    const factor = Math.exp(-deltaY * sensitivity);
    return this.zoomAtScreenPoint(this.state.zoom * factor, focalScreen);
  }

  /** Computes the visible world-space bounding box for a viewport, with optional margin in screen px. */
  public getVisibleWorldBounds(viewport: ViewportSize, marginPx = 0): WorldBounds {
    const topLeft = this.screenToWorld({ x: -marginPx, y: -marginPx });
    const bottomRight = this.screenToWorld({
      x: viewport.width + marginPx,
      y: viewport.height + marginPx,
    });
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: Math.max(0, bottomRight.x - topLeft.x),
      height: Math.max(0, bottomRight.y - topLeft.y),
    };
  }

  /** Fits a world-space bounding box into the viewport with padding. */
  public fitBounds(bounds: WorldBounds, viewport: ViewportSize, paddingPx = 48): CameraState {
    const availW = Math.max(1, viewport.width - paddingPx * 2);
    const availH = Math.max(1, viewport.height - paddingPx * 2);
    const contentW = Math.max(1, bounds.width);
    const contentH = Math.max(1, bounds.height);
    const zoom = this.clampZoom(Math.min(availW / contentW, availH / contentH));
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    this.state = {
      zoom,
      tx: viewport.width / 2 - centerX * zoom,
      ty: viewport.height / 2 - centerY * zoom,
    };
    this.emit();
    return this.getState();
  }

  /** Returns a GPU-accelerated CSS transform string for the world tile plane. */
  public toCssTransform(): string {
    return `translate3d(${this.state.tx}px, ${this.state.ty}px, 0) scale(${this.state.zoom})`;
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
