// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CanvasPointerFSM,
  projectRayToPlane,
  type PlanePointerEvent,
  type RayPlaneHit,
  type SpatialPlane3D,
} from "../engine/pointer-fsm.js";
import type { WorldBounds } from "../schema/canvas-document.js";

/**
 * Unified 2D / 3D Spatial / WebXR VR Surface Bridge.
 *
 * Bridges Three.js / `@react-three/xr` (from `packages/ide/src/webview/cad-viewer/vr-mode.tsx`)
 * to the 100% DOM-free `CanvasPointerFSM` and `SoaSceneGraph`:
 *  1. Supports multiple 3D-oriented schematic / SCADA / `.mscanvas` planes in world space.
 *  2. Casts desktop 3D mouse rays or VR controller laser rays onto the nearest plane
 *     and dispatches exact `(planeId, u, v)` events into `CanvasPointerFSM`.
 *  3. Computes volumetric 3D pop-out transforms for nested `cad3d` portal nodes so CAD,
 *     FEA, and CFD assemblies float in true 3D right above their schematic blocks.
 *  4. Supports cross-domain 3D-to-2D wiring (e.g., from a 3D `CADPort` to a 2D Modelica port).
 *  5. Tracks dirty rects for 90 Hz `THREE.CanvasTexture` updates with zero HTML DOM in VR.
 */

export type SurfacePresentationMode = "desktop-2d" | "spatial-3d" | "webxr-vr";

export interface VolumetricPopoutTransform {
  portalId: string;
  planeId: string;
  /** 3D center position floating along the plane normal. */
  position: [number, number, number];
  /** Physical size in meters (width, height, extrusionDepth). */
  sizeMeters: [number, number, number];
  /** Plane axes for orienting the Three.js group. */
  right: [number, number, number];
  down: [number, number, number];
  normal: [number, number, number];
}

export interface Spatial3DWire {
  id: string;
  from3D: [number, number, number];
  toPlaneId: string;
  toPlaneUV: { u: number; v: number };
  to3D: [number, number, number];
  controlPoint3D: [number, number, number];
}

export class SpatialSurfaceBridge {
  public mode: SurfacePresentationMode = "desktop-2d";
  private planes = new Map<string, SpatialPlane3D>();
  private planeFsms = new Map<string, CanvasPointerFSM>();
  private dirtyRects = new Map<string, WorldBounds[]>();
  private crossDomainWires = new Map<string, Spatial3DWire>();

  constructor(defaultPlane?: SpatialPlane3D) {
    const primary: SpatialPlane3D = defaultPlane ?? {
      id: "primary",
      origin: [-1.2, 1.8, -1.6],
      right: [1, 0, 0],
      down: [0, -1, 0],
      normal: [0, 0, 1],
      unitsPerMeter: 500,
    };
    this.registerPlane(primary);
  }

  public setMode(mode: SurfacePresentationMode): void {
    this.mode = mode;
  }

  public registerPlane(plane: SpatialPlane3D, fsm?: CanvasPointerFSM): void {
    this.planes.set(plane.id, plane);
    if (fsm) this.planeFsms.set(plane.id, fsm);
  }

  public bindFsm(planeId: string, fsm: CanvasPointerFSM): void {
    this.planeFsms.set(planeId, fsm);
  }

  public getPlane(planeId: string): SpatialPlane3D | undefined {
    return this.planes.get(planeId);
  }

  public getAllPlanes(): SpatialPlane3D[] {
    return Array.from(this.planes.values());
  }

  /** Converts a 2D diagram coordinate `(u, v)` on `planeId` into 3D world meters (with optional normal lift). */
  public planeUVToWorld3D(planeId: string, u: number, v: number, liftMeters = 0): [number, number, number] | null {
    const plane = this.planes.get(planeId);
    if (!plane || plane.unitsPerMeter <= 0) return null;
    const um = u / plane.unitsPerMeter;
    const vm = v / plane.unitsPerMeter;
    return [
      plane.origin[0] + plane.right[0] * um + plane.down[0] * vm + plane.normal[0] * liftMeters,
      plane.origin[1] + plane.right[1] * um + plane.down[1] * vm + plane.normal[1] * liftMeters,
      plane.origin[2] + plane.right[2] * um + plane.down[2] * vm + plane.normal[2] * liftMeters,
    ];
  }

  /**
   * Casts a 3D ray (desktop 3D camera ray or WebXR VR controller laser) against all
   * registered planes and returns the closest hit.
   */
  public castRay(rayOrigin: [number, number, number], rayDir: [number, number, number]): RayPlaneHit | null {
    let best: RayPlaneHit | null = null;
    for (const plane of this.planes.values()) {
      const hit = projectRayToPlane(rayOrigin, rayDir, plane);
      if (hit.hit && (!best || hit.distance < best.distance)) {
        best = hit;
      }
    }
    return best;
  }

  /**
   * Dispatches a 3D / WebXR controller ray gesture directly into the bound `CanvasPointerFSM`.
   * Returns the plane hit (for rendering the 3D VR laser reticle) or null if the ray missed.
   */
  public dispatchRayPointer(
    rayOrigin: [number, number, number],
    rayDir: [number, number, number],
    phase: PlanePointerEvent["phase"],
    modifiers: {
      button?: number | undefined;
      shiftKey?: boolean | undefined;
      ctrlKey?: boolean | undefined;
      altKey?: boolean | undefined;
    } = {},
  ): RayPlaneHit | null {
    const hit = this.castRay(rayOrigin, rayDir);
    if (!hit) return null;
    const fsm = this.planeFsms.get(hit.planeId);
    if (fsm) {
      fsm.handleEvent({
        planeId: hit.planeId,
        u: hit.u,
        v: hit.v,
        button: modifiers.button ?? 0,
        buttons: phase === "up" ? 0 : 1,
        shiftKey: modifiers.shiftKey ?? false,
        ctrlKey: modifiers.ctrlKey ?? false,
        metaKey: false,
        altKey: modifiers.altKey ?? false,
        phase,
      });
      this.markDirty(hit.planeId, { x: hit.u - 64, y: hit.v - 64, width: 128, height: 128 });
    }
    return hit;
  }

  /**
   * Computes a volumetric 3D pop-out transform for an embedded `cad3d` portal node so its
   * CAD / FEA / CFD mesh extrudes cleanly in front of its schematic block in 3D/VR mode.
   */
  public computeVolumetricPopout(
    planeId: string,
    portalId: string,
    bounds: WorldBounds,
    extrusionDepthMeters = 0.25,
  ): VolumetricPopoutTransform | null {
    const plane = this.planes.get(planeId);
    if (!plane || plane.unitsPerMeter <= 0) return null;
    const centerU = bounds.x + bounds.width / 2;
    const centerV = bounds.y + bounds.height / 2;
    const lift = extrusionDepthMeters * 0.55;
    const pos = this.planeUVToWorld3D(planeId, centerU, centerV, lift);
    if (!pos) return null;

    return {
      portalId,
      planeId,
      position: pos,
      sizeMeters: [bounds.width / plane.unitsPerMeter, bounds.height / plane.unitsPerMeter, extrusionDepthMeters],
      right: [...plane.right],
      down: [...plane.down],
      normal: [...plane.normal],
    };
  }

  /**
   * Registers a live 3D-to-2D wire connecting a physical 3D `CADPort` point in world meters
   * to a 2D schematic connector port `(u, v)` on a floating diagram plane.
   */
  public upsert3DTo2DWire(
    id: string,
    from3D: [number, number, number],
    toPlaneId: string,
    toPlaneUV: { u: number; v: number },
  ): Spatial3DWire | null {
    const to3D = this.planeUVToWorld3D(toPlaneId, toPlaneUV.u, toPlaneUV.v, 0.005);
    const plane = this.planes.get(toPlaneId);
    if (!to3D || !plane) return null;

    const mid: [number, number, number] = [
      (from3D[0] + to3D[0]) * 0.5 + plane.normal[0] * 0.12,
      (from3D[1] + to3D[1]) * 0.5 + plane.normal[1] * 0.12,
      (from3D[2] + to3D[2]) * 0.5 + plane.normal[2] * 0.12,
    ];
    const wire: Spatial3DWire = {
      id,
      from3D,
      toPlaneId,
      toPlaneUV,
      to3D,
      controlPoint3D: mid,
    };
    this.crossDomainWires.set(id, wire);
    return wire;
  }

  public get3DTo2DWires(): Spatial3DWire[] {
    return Array.from(this.crossDomainWires.values());
  }

  /** Marks a region of a plane's `CanvasTexture` dirty for incremental 90 Hz VR upload. */
  public markDirty(planeId: string, rect: WorldBounds): void {
    const MAX_DIRTY_RECTS_PER_PLANE = 64;
    let list = this.dirtyRects.get(planeId);
    if (!list) {
      list = [];
      this.dirtyRects.set(planeId, list);
    }
    if (list.length >= MAX_DIRTY_RECTS_PER_PLANE) {
      let minX = rect.x;
      let minY = rect.y;
      let maxX = rect.x + rect.width;
      let maxY = rect.y + rect.height;
      for (const existing of list) {
        if (existing.x < minX) minX = existing.x;
        if (existing.y < minY) minY = existing.y;
        const exMaxX = existing.x + existing.width;
        const exMaxY = existing.y + existing.height;
        if (exMaxX > maxX) maxX = exMaxX;
        if (exMaxY > maxY) maxY = exMaxY;
      }
      list.length = 0;
      list.push({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
      return;
    }
    list.push(rect);
  }

  public consumeDirtyRects(planeId: string): WorldBounds[] {
    const list = this.dirtyRects.get(planeId) ?? [];
    this.dirtyRects.delete(planeId);
    return list;
  }
}
