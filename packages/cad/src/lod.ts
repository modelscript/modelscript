// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — Dynamic Level of Detail (LoD) Engine for Large Assemblies.
 *
 * Computes screen-space projected pixel coverage and manages multi-tier
 * geometric representations (Full B-Rep -> Decimated -> Bounding Proxy)
 * to maintain 60 FPS across massive industrial models.
 */

import type { AABB } from "./clearance.js";

export enum LoDTier {
  /** Full analytical B-Rep or high-resolution mesh */
  Full = 0,
  /** Decimated intermediate mesh (approx 25% triangle budget) */
  Decimated = 1,
  /** Bounding box or convex proxy (12 triangles) */
  Proxy = 2,
  /** Sub-pixel geometry culled from rendering */
  Culled = 3,
}

export interface LoDThresholds {
  /** Minimum screen diameter in pixels for Full fidelity (default: 80px) */
  fullThresholdPx?: number;
  /** Minimum screen diameter in pixels for Decimated tier (default: 16px) */
  decimatedThresholdPx?: number;
  /** Minimum screen diameter in pixels below which geometry is culled (default: 2px) */
  cullThresholdPx?: number;
}

export interface CameraViewportConfig {
  /** Distance from camera to object center */
  distance: number;
  /** Vertical field of view in degrees (default: 50) */
  fovDegrees?: number;
  /** Viewport height in pixels (default: 1080) */
  viewportHeightPx?: number;
}

/**
 * Estimates the projected screen-space diameter of an object in pixels.
 *
 * Formula:
 *   d_px = (2 * r_bound * h_viewport) / (2 * distance * tan(fov / 2))
 */
export function computeProjectedScreenDiameter(boundingRadius: number, config: CameraViewportConfig): number {
  const dist = Math.max(0.001, config.distance);
  const fovDeg = config.fovDegrees ?? 50;
  const viewportH = config.viewportHeightPx ?? 1080;

  const fovRad = (fovDeg * Math.PI) / 180;
  const tanHalfFov = Math.tan(fovRad * 0.5);

  const projectedDiameter = (boundingRadius * viewportH) / (dist * tanHalfFov);
  return Math.max(0, projectedDiameter);
}

/**
 * Determines the optimal LoD tier for an object given its bounding box and camera distance.
 */
export function selectLoDTier(aabb: AABB, config: CameraViewportConfig, thresholds: LoDThresholds = {}): LoDTier {
  const fullPx = thresholds.fullThresholdPx ?? 80;
  const decPx = thresholds.decimatedThresholdPx ?? 16;
  const cullPx = thresholds.cullThresholdPx ?? 2;

  // Approximate bounding radius from AABB half-diagonal
  const dx = aabb.max[0] - aabb.min[0];
  const dy = aabb.max[1] - aabb.min[1];
  const dz = aabb.max[2] - aabb.min[2];
  const radius = 0.5 * Math.hypot(dx, dy, dz);

  const screenDiameter = computeProjectedScreenDiameter(radius, config);

  if (screenDiameter < cullPx) {
    return LoDTier.Culled;
  }
  if (screenDiameter < decPx) {
    return LoDTier.Proxy;
  }
  if (screenDiameter < fullPx) {
    return LoDTier.Decimated;
  }
  return LoDTier.Full;
}

/**
 * Generates an analytical 12-triangle bounding box proxy mesh (vertices + indices)
 * for an AABB, used as a minimal LoD Tier 2 proxy.
 */
export function generateBoxProxyMesh(aabb: AABB): {
  vertices: Float32Array;
  indices: Uint16Array;
} {
  const min = aabb.min;
  const max = aabb.max;

  // 8 corners
  const v = new Float32Array([
    min[0],
    min[1],
    min[2], // 0
    max[0],
    min[1],
    min[2], // 1
    max[0],
    max[1],
    min[2], // 2
    min[0],
    max[1],
    min[2], // 3
    min[0],
    min[1],
    max[2], // 4
    max[0],
    min[1],
    max[2], // 5
    max[0],
    max[1],
    max[2], // 6
    min[0],
    max[1],
    max[2], // 7
  ]);

  // 12 triangles (36 indices)
  const idx = new Uint16Array([
    // Front (z = max)
    4, 5, 6, 4, 6, 7,
    // Back (z = min)
    1, 0, 3, 1, 3, 2,
    // Top (y = max)
    3, 7, 6, 3, 6, 2,
    // Bottom (y = min)
    0, 1, 5, 0, 5, 4,
    // Right (x = max)
    1, 2, 6, 1, 6, 5,
    // Left (x = min)
    0, 4, 7, 0, 7, 3,
  ]);

  return { vertices: v, indices: idx };
}
