// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CameraController, ViewportSize } from "../core/camera.js";
import type { TileLodTier, WorldBounds, WorldPoint } from "../schema/canvas-document.js";

/**
 * Shared Scissor-Rendered 3D Portal Manager (Layer 1).
 *
 * Eliminates the browser's 8-16 WebGL context crash limit AND context-pool
 * eviction flicker by scheduling unlimited embedded live 3D CAD / STEP / FEA /
 * CFD / VTK / USD / URDF viewports onto ONE single shared WebGL2/WebGPU canvas
 * using `renderer.setScissor(x, y, w, h)` + `renderer.setViewport(x, y, w, h)`.
 *
 * Idle or zoomed-out portals automatically freeze to cached `ImageBitmap` / dataURL
 * snapshots painted on Layer 0 (0 GPU cost) and wake seamlessly on hover, focus,
 * or live simulation playback.
 */

export type Embedded3DKind = "cad" | "fea" | "cfd" | "step" | "usd" | "urdf" | "vtk";

export interface Embedded3DPortalSpec {
  id: string;
  kind: Embedded3DKind;
  artifactUri: string;
  bounds: WorldBounds;
  /** Optional 3D camera matrices (4x4 column-major viewProjection) for pinning 3D CADPorts to 2D wires. */
  viewProjectionMatrix?: readonly number[] | undefined;
  /** Optional 3D CADPort / B-Rep feature locations in model space. */
  featurePins?: Record<string, [number, number, number]> | undefined;
  /** Whether a live co-simulation / animation is currently driving this 3D viewport. */
  isAnimating?: boolean | undefined;
  /** Cached offscreen snapshot used when frozen at low zoom / idle. */
  snapshotDataUrl?: string | undefined;
}

export interface ScissorViewportRect {
  portalId: string;
  kind: Embedded3DKind;
  artifactUri: string;
  /** Screen-space CSS pixels (origin top-left). */
  cssX: number;
  cssY: number;
  cssWidth: number;
  cssHeight: number;
  /** WebGL framebuffer pixels (origin bottom-left, scaled by DPR) for renderer.setScissor/setViewport. */
  glX: number;
  glY: number;
  glWidth: number;
  glHeight: number;
  /** True when the 3D scene should actively render this frame; false means stamp frozen snapshot on Layer 0. */
  renderLive: boolean;
  lod: TileLodTier;
  snapshotDataUrl?: string | undefined;
}

export interface ScissorSchedulerOptions {
  /** Minimum screen-space pixel width required to wake a live 3D scissor pass. */
  liveMinPixelWidth?: number | undefined;
  /** Device pixel ratio for WebGL framebuffer scissor coordinates. */
  devicePixelRatio?: number | undefined;
}

export class Scissor3DPortalManager {
  private portals = new Map<string, Embedded3DPortalSpec>();
  private hoveredPortalId: string | null = null;
  private focusedPortalId: string | null = null;
  private readonly liveMinPixelWidth: number;
  private dpr: number;

  /** Always exactly 1 shared WebGL context regardless of how many 3D portals exist! */
  public readonly sharedWebGlContextCount = 1;

  constructor(options: ScissorSchedulerOptions = {}) {
    this.liveMinPixelWidth = options.liveMinPixelWidth ?? 160;
    this.dpr = Math.max(1, options.devicePixelRatio ?? 1);
  }

  public setDevicePixelRatio(dpr: number): void {
    this.dpr = Math.max(1, dpr);
  }

  public registerPortal(spec: Embedded3DPortalSpec): void {
    this.portals.set(spec.id, { ...spec });
  }

  public unregisterPortal(id: string): void {
    this.portals.delete(id);
    if (this.hoveredPortalId === id) this.hoveredPortalId = null;
    if (this.focusedPortalId === id) this.focusedPortalId = null;
  }

  public updatePortalBounds(id: string, bounds: WorldBounds): void {
    const p = this.portals.get(id);
    if (p) p.bounds = { ...bounds };
  }

  public setPortalSnapshot(id: string, snapshotDataUrl: string): void {
    const p = this.portals.get(id);
    if (p) p.snapshotDataUrl = snapshotDataUrl;
  }

  public setPortalAnimating(id: string, animating: boolean): void {
    const p = this.portals.get(id);
    if (p) p.isAnimating = animating;
  }

  public setHoveredPortal(id: string | null): void {
    this.hoveredPortalId = id;
  }

  public setFocusedPortal(id: string | null): void {
    this.focusedPortalId = id;
  }

  public getPortal(id: string): Embedded3DPortalSpec | undefined {
    return this.portals.get(id);
  }

  public getAllPortals(): Embedded3DPortalSpec[] {
    return Array.from(this.portals.values());
  }

  /**
   * Computes clipped WebGL scissor rects for all visible 3D portals in a single pass.
   * Only portals inside the viewport frustum and above `liveMinPixelWidth` (or focused/animating)
   * schedule live GPU passes; all others use zero-GPU cached snapshots.
   */
  public computeFrameScissorRects(camera: CameraController, viewport: ViewportSize): ScissorViewportRect[] {
    const camState = camera.getState();
    const out: ScissorViewportRect[] = [];

    for (const portal of this.portals.values()) {
      const topLeft = camera.worldToScreen({ x: portal.bounds.x, y: portal.bounds.y });
      const cssW = portal.bounds.width * camState.zoom;
      const cssH = portal.bounds.height * camState.zoom;

      // Frustum cull against screen viewport
      if (topLeft.x + cssW < 0 || topLeft.y + cssH < 0 || topLeft.x > viewport.width || topLeft.y > viewport.height) {
        continue;
      }

      const isFocused = this.focusedPortalId === portal.id;
      const isHovered = this.hoveredPortalId === portal.id;
      const isAnimating = Boolean(portal.isAnimating);

      let lod: TileLodTier = "interactive";
      if (isFocused) lod = "focus";
      else if (cssW < 90) lod = "macro";
      else if (cssW < this.liveMinPixelWidth) lod = "thumbnail";

      // Wake live 3D rendering when focused, animating, hovered at working zoom, or no snapshot exists yet
      const renderLive =
        isFocused || isAnimating || (cssW >= this.liveMinPixelWidth && (isHovered || !portal.snapshotDataUrl));

      // Convert top-left CSS rect to WebGL bottom-left framebuffer pixel rect
      const glX = Math.round(topLeft.x * this.dpr);
      const glW = Math.max(1, Math.round(cssW * this.dpr));
      const glH = Math.max(1, Math.round(cssH * this.dpr));
      const glY = Math.round((viewport.height - (topLeft.y + cssH)) * this.dpr);

      out.push({
        portalId: portal.id,
        kind: portal.kind,
        artifactUri: portal.artifactUri,
        cssX: topLeft.x,
        cssY: topLeft.y,
        cssWidth: cssW,
        cssHeight: cssH,
        glX,
        glY,
        glWidth: glW,
        glHeight: glH,
        renderLive,
        lod,
        snapshotDataUrl: portal.snapshotDataUrl,
      });
    }

    return out;
  }

  /**
   * Projects a 3D CADPort / B-Rep feature coordinate `[mx, my, mz]` inside a portal
   * through its active 4x4 column-major view-projection matrix into 2D canvas world `(x, y)`
   * so Modelica wires & Digital Threads stay anchored to the exact 3D flange while orbiting!
   */
  public project3DFeatureToWorld(portalId: string, featureKey: string): WorldPoint | null {
    const portal = this.portals.get(portalId);
    if (!portal) return null;
    const pt = portal.featurePins?.[featureKey];
    if (!pt) return null;

    const m = portal.viewProjectionMatrix;
    if (m && m.length === 16) {
      const x = pt[0];
      const y = pt[1];
      const z = pt[2];
      const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
      const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
      if (Math.abs(cw) > 1e-6) {
        const ndcX = cx / cw;
        const ndcY = cy / cw;
        const u = Math.max(0.02, Math.min(0.98, (ndcX + 1) * 0.5));
        const v = Math.max(0.02, Math.min(0.98, (1 - ndcY) * 0.5));
        return {
          x: portal.bounds.x + u * portal.bounds.width,
          y: portal.bounds.y + v * portal.bounds.height,
        };
      }
    }

    // Isometric fallback when no live camera matrix has been uploaded yet
    const u = Math.max(0.08, Math.min(0.92, 0.5 + (pt[0] - pt[2]) * 0.18));
    const v = Math.max(0.08, Math.min(0.92, 0.5 - pt[1] * 0.22 + (pt[0] + pt[2]) * 0.08));
    return {
      x: portal.bounds.x + u * portal.bounds.width,
      y: portal.bounds.y + v * portal.bounds.height,
    };
  }
}
