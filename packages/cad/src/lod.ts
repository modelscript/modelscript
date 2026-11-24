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
  fullThresholdPx?: number | undefined;
  /** Minimum screen diameter in pixels for Decimated tier (default: 16px) */
  decimatedThresholdPx?: number | undefined;
  /** Minimum screen diameter in pixels below which geometry is culled (default: 2px) */
  cullThresholdPx?: number | undefined;
}

export interface CameraViewportConfig {
  /** Distance from camera to object center */
  distance: number;
  /** Vertical field of view in degrees (default: 50) */
  fovDegrees?: number | undefined;
  /** Viewport height in pixels (default: 1080) */
  viewportHeightPx?: number | undefined;
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

export interface DecimatedMeshResult {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly normals: Float32Array;
  readonly originalTriangleCount: number;
  readonly decimatedTriangleCount: number;
}

/**
 * Deterministic spatial vertex-clustering mesh decimator for `LoDTier.Decimated`.
 * Quantizes vertices into a uniform 3D grid calibrated to `targetRatio`, merges
 * clustered vertices by centroid average, discards degenerate triangles, and
 * recomputes smooth vertex normals.
 */
export function decimateMeshForLoD(
  vertices: Float32Array | readonly number[],
  indices: Uint16Array | Uint32Array | readonly number[],
  targetRatio = 0.25,
): DecimatedMeshResult {
  const vertCount = Math.floor(vertices.length / 3);
  const origTriCount = Math.floor(indices.length / 3);
  if (vertCount === 0 || origTriCount === 0) {
    return {
      vertices: new Float32Array(0),
      indices: new Uint32Array(0),
      normals: new Float32Array(0),
      originalTriangleCount: origTriCount,
      decimatedTriangleCount: 0,
    };
  }

  const ratio = Math.max(0.05, Math.min(1.0, targetRatio));
  if (ratio >= 0.99 || origTriCount <= 12) {
    const outV = new Float32Array(vertices);
    const outI = new Uint32Array(indices);
    return {
      vertices: outV,
      indices: outI,
      normals: computeSmoothVertexNormals(outV, outI),
      originalTriangleCount: origTriCount,
      decimatedTriangleCount: origTriCount,
    };
  }

  // Compute mesh bounds
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < vertCount; i++) {
    const x = vertices[i * 3]!;
    const y = vertices[i * 3 + 1]!;
    const z = vertices[i * 3 + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const spanZ = Math.max(1e-6, maxZ - minZ);
  const maxSpan = Math.max(spanX, spanY, spanZ);

  // Choose grid resolution proportional to sqrt(targetVertexCount) for surface meshes
  const targetVerts = Math.max(8, Math.round(vertCount * ratio));
  const gridCells = Math.max(3, Math.min(128, Math.round(Math.sqrt(targetVerts * 1.4))));
  const invCell = gridCells / maxSpan;

  const cellToCluster = new Map<string, number>();
  const vertToCluster = new Int32Array(vertCount);
  const sumX: number[] = [];
  const sumY: number[] = [];
  const sumZ: number[] = [];
  const counts: number[] = [];

  for (let i = 0; i < vertCount; i++) {
    const x = vertices[i * 3]!;
    const y = vertices[i * 3 + 1]!;
    const z = vertices[i * 3 + 2]!;
    const gx = Math.floor((x - minX) * invCell);
    const gy = Math.floor((y - minY) * invCell);
    const gz = Math.floor((z - minZ) * invCell);
    const key = `${gx},${gy},${gz}`;
    let clusterIdx = cellToCluster.get(key);
    if (clusterIdx === undefined) {
      clusterIdx = sumX.length;
      cellToCluster.set(key, clusterIdx);
      sumX.push(0);
      sumY.push(0);
      sumZ.push(0);
      counts.push(0);
    }
    sumX[clusterIdx] = sumX[clusterIdx]! + x;
    sumY[clusterIdx] = sumY[clusterIdx]! + y;
    sumZ[clusterIdx] = sumZ[clusterIdx]! + z;
    counts[clusterIdx] = counts[clusterIdx]! + 1;
    vertToCluster[i] = clusterIdx;
  }

  const clusterCount = sumX.length;
  const outVerts = new Float32Array(clusterCount * 3);
  for (let c = 0; c < clusterCount; c++) {
    const inv = 1 / counts[c]!;
    outVerts[c * 3] = sumX[c]! * inv;
    outVerts[c * 3 + 1] = sumY[c]! * inv;
    outVerts[c * 3 + 2] = sumZ[c]! * inv;
  }

  const keptIndices: number[] = [];
  const seenTriangles = new Set<string>();
  for (let t = 0; t < origTriCount; t++) {
    const a = vertToCluster[indices[t * 3]!]!;
    const b = vertToCluster[indices[t * 3 + 1]!]!;
    const c = vertToCluster[indices[t * 3 + 2]!]!;
    if (a === b || b === c || a === c) continue;
    const minI = Math.min(a, b, c);
    const maxI = Math.max(a, b, c);
    const midI = a + b + c - minI - maxI;
    const triKey = `${minI}:${midI}:${maxI}`;
    if (seenTriangles.has(triKey)) continue;
    seenTriangles.add(triKey);
    keptIndices.push(a, b, c);
  }

  const outIndices = new Uint32Array(keptIndices);
  const normals = computeSmoothVertexNormals(outVerts, outIndices);

  return {
    vertices: outVerts,
    indices: outIndices,
    normals,
    originalTriangleCount: origTriCount,
    decimatedTriangleCount: Math.floor(outIndices.length / 3),
  };
}

function computeSmoothVertexNormals(vertices: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(vertices.length);
  const triCount = Math.floor(indices.length / 3);
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3]! * 3;
    const i1 = indices[t * 3 + 1]! * 3;
    const i2 = indices[t * 3 + 2]! * 3;
    const ax = vertices[i1]! - vertices[i0]!;
    const ay = vertices[i1 + 1]! - vertices[i0 + 1]!;
    const az = vertices[i1 + 2]! - vertices[i0 + 2]!;
    const bx = vertices[i2]! - vertices[i0]!;
    const by = vertices[i2 + 1]! - vertices[i0 + 1]!;
    const bz = vertices[i2 + 2]! - vertices[i0 + 2]!;
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    normals[i0] = normals[i0]! + nx;
    normals[i0 + 1] = normals[i0 + 1]! + ny;
    normals[i0 + 2] = normals[i0 + 2]! + nz;
    normals[i1] = normals[i1]! + nx;
    normals[i1 + 1] = normals[i1 + 1]! + ny;
    normals[i1 + 2] = normals[i1 + 2]! + nz;
    normals[i2] = normals[i2]! + nx;
    normals[i2 + 1] = normals[i2 + 1]! + ny;
    normals[i2 + 2] = normals[i2 + 2]! + nz;
  }

  const vCount = Math.floor(vertices.length / 3);
  for (let v = 0; v < vCount; v++) {
    const off = v * 3;
    const len = Math.hypot(normals[off]!, normals[off + 1]!, normals[off + 2]!);
    if (len > 1e-9) {
      normals[off] = normals[off]! / len;
      normals[off + 1] = normals[off + 1]! / len;
      normals[off + 2] = normals[off + 2]! / len;
    } else {
      normals[off + 1] = 1;
    }
  }
  return normals;
}
