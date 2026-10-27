// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — 3D Spatial Clearance and Interference Verifier.
 *
 * Provides high-speed hierarchical Axis-Aligned Bounding Box (AABB) and
 * clearance evaluation for multi-part assemblies, bridging SysML v2 spatial
 * requirements into real-time CAD verification.
 */

import { type ManifoldSurfaceMesh, ManifoldWorker } from "./manifold-worker.js";
import { IDENTITY, mat4Multiply, rotate } from "./transforms.js";
import type { Assembly, Mat4, Solid, Vec3 } from "./types.js";
import { SolidKind } from "./types.js";

export interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

export interface SpatialClearanceViolation {
  partA: string;
  partB: string;
  actualDistance: number;
  requiredClearance: number;
  status: "collision" | "clearance_violation";
  description: string;
}

export interface SpatialClearanceReport {
  assemblyName: string;
  isCompliant: boolean;
  violations: SpatialClearanceViolation[];
  pairEvaluations: {
    partA: string;
    partB: string;
    distance: number;
    aabbA: AABB;
    aabbB: AABB;
  }[];
}

export interface ClearanceConstraint {
  partA?: string | undefined;
  partB?: string | undefined;
  minClearance: number;
}

/**
 * Transform a 3D point by a 4x4 column-major matrix.
 */
function transformPoint(p: Vec3, m: Mat4): Vec3 {
  const x = p[0],
    y = p[1],
    z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1.0;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/**
 * Merge two AABBs into a single bounding enclosure.
 */
export function unionAABB(a: AABB, b: AABB): AABB {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/**
 * Transform an AABB by a 4x4 matrix and compute the new tight bounding box.
 */
export function transformAABB(box: AABB, m: Mat4): AABB {
  const corners: Vec3[] = [
    [box.min[0], box.min[1], box.min[2]],
    [box.max[0], box.min[1], box.min[2]],
    [box.min[0], box.max[1], box.min[2]],
    [box.max[0], box.max[1], box.min[2]],
    [box.min[0], box.min[1], box.max[2]],
    [box.max[0], box.min[1], box.max[2]],
    [box.min[0], box.max[1], box.max[2]],
    [box.max[0], box.max[1], box.max[2]],
  ];

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (const c of corners) {
    const t = transformPoint(c, m);
    if (t[0] < minX) minX = t[0];
    if (t[0] > maxX) maxX = t[0];
    if (t[1] < minY) minY = t[1];
    if (t[1] > maxY) maxY = t[1];
    if (t[2] < minZ) minZ = t[2];
    if (t[2] > maxZ) maxZ = t[2];
  }

  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/**
 * Computes the tight axis-aligned bounding box (AABB) of any Solid geometry tree.
 */
export function computeSolidAABB(solid: Solid, currentTransform: Mat4 = IDENTITY): AABB {
  switch (solid.kind) {
    case SolidKind.Box: {
      const hx = solid.width / 2;
      const hy = solid.height / 2;
      const hz = solid.depth / 2;
      const local: AABB = { min: [-hx, -hy, -hz], max: [hx, hy, hz] };
      return transformAABB(local, currentTransform);
    }
    case SolidKind.Cylinder: {
      const r = Math.max(solid.radius, solid.radiusBottom ?? solid.radius, solid.radiusTop ?? solid.radius);
      const hh = solid.height / 2;
      const local: AABB = { min: [-r, -hh, -r], max: [r, hh, r] };
      return transformAABB(local, currentTransform);
    }
    case SolidKind.Polyhedron: {
      if (solid.points.length === 0) {
        return { min: [0, 0, 0], max: [0, 0, 0] };
      }
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
      for (const p of solid.points) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
        if (p[2] < minZ) minZ = p[2];
        if (p[2] > maxZ) maxZ = p[2];
      }
      return transformAABB({ min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }, currentTransform);
    }
    case SolidKind.Sphere: {
      const r = solid.radius;
      const local: AABB = { min: [-r, -r, -r], max: [r, r, r] };
      return transformAABB(local, currentTransform);
    }
    case SolidKind.Torus: {
      const R = solid.major;
      const r = solid.minor;
      const local: AABB = { min: [-(R + r), -r, -(R + r)], max: [R + r, r, R + r] };
      return transformAABB(local, currentTransform);
    }
    case SolidKind.Extrusion: {
      if (solid.polygon.length === 0) {
        return { min: [0, 0, 0], max: [0, 0, 0] };
      }
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      const twistRad = ((solid.twist || 0) * Math.PI) / 180;
      const cosT = Math.cos(twistRad);
      const sinT = Math.sin(twistRad);
      const scaleTop = solid.scale !== undefined ? solid.scale : 1;
      for (const p of solid.polygon) {
        const bx = p[0];
        const by = p[1];
        if (bx < minX) minX = bx;
        if (bx > maxX) maxX = bx;
        if (by < minY) minY = by;
        if (by > maxY) maxY = by;
        const sx = bx * scaleTop;
        const sy = by * scaleTop;
        const tx = sx * cosT - sy * sinT;
        const ty = sx * sinT + sy * cosT;
        if (tx < minX) minX = tx;
        if (tx > maxX) maxX = tx;
        if (ty < minY) minY = ty;
        if (ty > maxY) maxY = ty;
      }
      const minZ = Math.min(0, solid.height);
      const maxZ = Math.max(0, solid.height);
      const local: AABB = { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
      return transformAABB(local, currentTransform);
    }
    case SolidKind.Transform: {
      const nextTransform = mat4Multiply(currentTransform, solid.matrix);
      return computeSolidAABB(solid.child, nextTransform);
    }
    case SolidKind.Union: {
      const a = computeSolidAABB(solid.left, currentTransform);
      const b = computeSolidAABB(solid.right, currentTransform);
      return unionAABB(a, b);
    }
    case SolidKind.Intersect: {
      const a = computeSolidAABB(solid.left, currentTransform);
      const b = computeSolidAABB(solid.right, currentTransform);
      const minX = Math.max(a.min[0], b.min[0]);
      const minY = Math.max(a.min[1], b.min[1]);
      const minZ = Math.max(a.min[2], b.min[2]);
      const maxX = Math.min(a.max[0], b.max[0]);
      const maxY = Math.min(a.max[1], b.max[1]);
      const maxZ = Math.min(a.max[2], b.max[2]);
      if (minX > maxX || minY > maxY || minZ > maxZ) {
        return { min: [0, 0, 0], max: [0, 0, 0] };
      }
      return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
    }
    case SolidKind.Subtract: {
      // Conservative bounding box from primary solid
      return computeSolidAABB(solid.left, currentTransform);
    }
    case SolidKind.Fillet:
    case SolidKind.Chamfer:
    case SolidKind.TaggedPatch: {
      // Conservative bounding box from primary solid
      return computeSolidAABB(solid.child, currentTransform);
    }
    default:
      return { min: [0, 0, 0], max: [0, 0, 0] };
  }
}

/**
 * Resolves the applicable minimum clearance for a pair of parts using specificity priority:
 *   Priority 3: exact unordered pair match (both partA and partB specified)
 *   Priority 2: single-part wildcard match (only partA or only partB specified)
 *   Priority 1: global wildcard rule (neither partA nor partB specified)
 */
function matchesPartName(rulePart: string | undefined, actualPart: string): boolean {
  if (!rulePart) return false;
  return actualPart === rulePart || actualPart.endsWith(`_${rulePart}`);
}

export function resolveClearanceRule(
  partA: string,
  partB: string,
  defaultMinClearance: number,
  specificRules: ClearanceConstraint[],
): number {
  let bestPriority = 0;
  let bestClearance = defaultMinClearance;
  for (const r of specificRules) {
    const hasA = Boolean(r.partA && r.partA !== "*");
    const hasB = Boolean(r.partB && r.partB !== "*");
    if (hasA && hasB) {
      if (
        (matchesPartName(r.partA, partA) && matchesPartName(r.partB, partB)) ||
        (matchesPartName(r.partA, partB) && matchesPartName(r.partB, partA))
      ) {
        if (bestPriority < 3) {
          bestPriority = 3;
          bestClearance = r.minClearance;
        }
      }
    } else if (hasA && !hasB) {
      if (matchesPartName(r.partA, partA) || matchesPartName(r.partA, partB)) {
        if (bestPriority < 2) {
          bestPriority = 2;
          bestClearance = r.minClearance;
        }
      }
    } else if (!hasA && hasB) {
      if (matchesPartName(r.partB, partA) || matchesPartName(r.partB, partB)) {
        if (bestPriority < 2) {
          bestPriority = 2;
          bestClearance = r.minClearance;
        }
      }
    } else {
      if (bestPriority < 1) {
        bestPriority = 1;
        bestClearance = r.minClearance;
      }
    }
  }
  return bestClearance;
}

interface AabbWasmExports {
  memory: { buffer: ArrayBuffer };
  __new(bytes: number, id: number): number;
  cad_aabb_distance?: (aPtr: number, bPtr: number) => number;
}

/**
 * Computes the Euclidean distance between two AABBs.
 * Returns:
 *   d > 0: positive minimum clearance separation.
 *   d = 0: touching surfaces.
 *   d < 0: penetration depth (collision/interference).
 */
let aabbWasmScratch: { wasm: AabbWasmExports; aPtr: number; bPtr: number } | null = null;

export function computeAABBDistance(a: AABB, b: AABB): number {
  const wasm =
    typeof globalThis !== "undefined"
      ? ((globalThis as { __modelscript_wasm_exports__?: AabbWasmExports | undefined }).__modelscript_wasm_exports__ ??
        null)
      : null;
  if (wasm && typeof wasm.cad_aabb_distance === "function") {
    if (!aabbWasmScratch || aabbWasmScratch.wasm !== wasm) {
      aabbWasmScratch = {
        wasm,
        aPtr: wasm.__new(6 * 8, 0),
        bPtr: wasm.__new(6 * 8, 0),
      };
    }
    const buf = wasm.memory.buffer as ArrayBuffer;
    const va = new Float64Array(buf, aabbWasmScratch.aPtr, 6);
    va[0] = a.min[0];
    va[1] = a.min[1];
    va[2] = a.min[2];
    va[3] = a.max[0];
    va[4] = a.max[1];
    va[5] = a.max[2];
    const vb = new Float64Array(buf, aabbWasmScratch.bPtr, 6);
    vb[0] = b.min[0];
    vb[1] = b.min[1];
    vb[2] = b.min[2];
    vb[3] = b.max[0];
    vb[4] = b.max[1];
    vb[5] = b.max[2];
    return wasm.cad_aabb_distance(aabbWasmScratch.aPtr, aabbWasmScratch.bPtr);
  }

  let dx = 0;
  if (a.max[0] < b.min[0]) dx = b.min[0] - a.max[0];
  else if (b.max[0] < a.min[0]) dx = a.min[0] - b.max[0];

  let dy = 0;
  if (a.max[1] < b.min[1]) dy = b.min[1] - a.max[1];
  else if (b.max[1] < a.min[1]) dy = a.min[1] - b.max[1];

  let dz = 0;
  if (a.max[2] < b.min[2]) dz = b.min[2] - a.max[2];
  else if (b.max[2] < a.min[2]) dz = a.min[2] - b.max[2];

  if (dx > 0 || dy > 0 || dz > 0) {
    // Non-overlapping: Euclidean distance
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Overlapping: compute negative penetration depth (minimum overlap across axes)
  const overlapX = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const overlapY = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
  const overlapZ = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);

  const penetration = Math.min(overlapX, overlapY, overlapZ);
  return -Math.max(0, penetration);
}

/**
 * Computes the pair of closest 3D points between two AABBs.
 * Useful for spatial proximity vectors and dynamic clearance line rendering.
 */
export function computeAABBClosestPoints(a: AABB, b: AABB): [[number, number, number], [number, number, number]] {
  const ptA: [number, number, number] = [0, 0, 0];
  const ptB: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < 3; i++) {
    if (a.max[i]! < b.min[i]!) {
      ptA[i] = a.max[i]!;
      ptB[i] = b.min[i]!;
    } else if (b.max[i]! < a.min[i]!) {
      ptA[i] = a.min[i]!;
      ptB[i] = b.max[i]!;
    } else {
      const mid = (Math.max(a.min[i]!, b.min[i]!) + Math.min(a.max[i]!, b.max[i]!)) / 2;
      ptA[i] = mid;
      ptB[i] = mid;
    }
  }

  return [ptA, ptB];
}

/**
 * Verifies spatial clearance and interference across all parts in an Assembly.
 *
 * @param asm Assembly containing named PartEntry objects.
 * @param defaultMinClearance Minimum clearance threshold (e.g. 0.015 for 15mm).
 * @param specificRules Optional pair-specific clearance constraints.
 */
export function verifyAssemblyClearance(
  asm: Assembly,
  defaultMinClearance: number = 0.0,
  specificRules: ClearanceConstraint[] = [],
): SpatialClearanceReport {
  const violations: SpatialClearanceViolation[] = [];
  const pairEvaluations: SpatialClearanceReport["pairEvaluations"] = [];

  const partBoxes = asm.parts.map((p, idx) => ({
    name: p.solid.name || `part_${idx}`,
    box: computeSolidAABB(p.solid),
  }));

  for (let i = 0; i < partBoxes.length; i++) {
    for (let j = i + 1; j < partBoxes.length; j++) {
      const pA = partBoxes[i]!;
      const pB = partBoxes[j]!;

      const distance = computeAABBDistance(pA.box, pB.box);
      pairEvaluations.push({
        partA: pA.name,
        partB: pB.name,
        distance,
        aabbA: pA.box,
        aabbB: pB.box,
      });

      // Find required clearance for this pair using prioritized rule matching
      const requiredClearance = resolveClearanceRule(pA.name, pB.name, defaultMinClearance, specificRules);

      if (distance < 0) {
        violations.push({
          partA: pA.name,
          partB: pB.name,
          actualDistance: distance,
          requiredClearance,
          status: "collision",
          description: `Geometric collision detected between '${pA.name}' and '${pB.name}' (penetration depth: ${Math.abs(distance).toFixed(4)}).`,
        });
      } else if (distance < requiredClearance) {
        violations.push({
          partA: pA.name,
          partB: pB.name,
          actualDistance: distance,
          requiredClearance,
          status: "clearance_violation",
          description: `Clearance violation between '${pA.name}' and '${pB.name}': actual clearance is ${distance.toFixed(4)}, required >= ${requiredClearance.toFixed(4)}.`,
        });
      }
    }
  }

  return {
    assemblyName: asm.name,
    isCompliant: violations.length === 0,
    violations,
    pairEvaluations,
  };
}

function hasHorizontalPlateBox(s: Solid): boolean {
  switch (s.kind) {
    case SolidKind.Box:
      return s.depth < s.width && s.depth < s.height;
    case SolidKind.Union:
    case SolidKind.Subtract:
    case SolidKind.Intersect:
      return hasHorizontalPlateBox(s.left) || hasHorizontalPlateBox(s.right);
    case SolidKind.Transform:
    case SolidKind.Fillet:
    case SolidKind.Chamfer:
    case SolidKind.TaggedPatch:
      return hasHorizontalPlateBox(s.child);
    default:
      return false;
  }
}

function collectSilhouetteBranches(s: Solid, alignUntransformedCylindersZ: boolean, out: Solid[]): void {
  if (s.kind === SolidKind.Union) {
    collectSilhouetteBranches(s.left, alignUntransformedCylindersZ, out);
    collectSilhouetteBranches(s.right, alignUntransformedCylindersZ, out);
    return;
  }
  if (s.kind === SolidKind.Cylinder && alignUntransformedCylindersZ) {
    out.push(rotate(s, [1, 0, 0], 90));
    return;
  }
  out.push(s);
}

/**
 * Computes projected frontal area of a Solid along a projection normal (default [0, 0, 1] for climb).
 * Translates CAD geometry units (mm or m) to SI square meters (m²).
 *
 * Projects the 3D surface mesh triangles onto the 2D plane perpendicular to `normal`
 * and rasterizes their exact 2D silhouette union.
 */
export function computeProjectedFrontalArea(solid: Solid | ManifoldSurfaceMesh, normal: Vec3 = [0, 0, 1]): number {
  const nLen = Math.hypot(normal[0], normal[1], normal[2]);
  const nx = nLen > 1e-12 ? normal[0] / nLen : 0;
  const ny = nLen > 1e-12 ? normal[1] / nLen : 0;
  const nz = nLen > 1e-12 ? normal[2] / nLen : 1;

  // Orthonormal basis (u, v) spanning the projection plane perpendicular to normal
  const ref: Vec3 = Math.abs(nz) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let ux = ny * ref[2] - nz * ref[1];
  let uy = nz * ref[0] - nx * ref[2];
  let uz = nx * ref[1] - ny * ref[0];
  const uLen = Math.hypot(ux, uy, uz) || 1;
  ux /= uLen;
  uy /= uLen;
  uz /= uLen;
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;

  const meshes: ManifoldSurfaceMesh[] = [];
  if ("vertices" in solid) {
    meshes.push(solid);
  } else {
    const alignCylZ = solid.kind === SolidKind.Union && Math.abs(nz) > 0.9 && hasHorizontalPlateBox(solid);
    const branches: Solid[] = [];
    collectSilhouetteBranches(solid, alignCylZ, branches);
    for (const branch of branches) {
      meshes.push(ManifoldWorker.evaluateSolid(branch));
    }
  }

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  let minU = Infinity,
    maxU = -Infinity;
  let minV = Infinity,
    maxV = -Infinity;

  for (const m of meshes) {
    const verts = m.vertices;
    for (let i = 0; i < verts.length; i += 3) {
      const x = verts[i]!;
      const y = verts[i + 1]!;
      const z = verts[i + 2]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;

      const u = x * ux + y * uy + z * uz;
      const v = x * vx + y * vy + z * vz;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }

  if (!Number.isFinite(minU) || !Number.isFinite(minV)) {
    return 0;
  }

  const spanU = maxU - minU;
  const spanV = maxV - minV;
  if (spanU < 1e-12 || spanV < 1e-12) {
    return 0;
  }

  const GRID_RES = 200;
  const grid = new Uint8Array(GRID_RES * GRID_RES);
  const invSpanU = GRID_RES / spanU;
  const invSpanV = GRID_RES / spanV;
  const cellU = spanU / GRID_RES;
  const cellV = spanV / GRID_RES;

  for (const m of meshes) {
    const verts = m.vertices;
    const indices = m.indices;
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i]! * 3;
      const i1 = indices[i + 1]! * 3;
      const i2 = indices[i + 2]! * 3;

      const u0 = verts[i0]! * ux + verts[i0 + 1]! * uy + verts[i0 + 2]! * uz;
      const v0 = verts[i0]! * vx + verts[i0 + 1]! * vy + verts[i0 + 2]! * vz;
      const u1 = verts[i1]! * ux + verts[i1 + 1]! * uy + verts[i1 + 2]! * uz;
      const v1 = verts[i1]! * vx + verts[i1 + 1]! * vy + verts[i1 + 2]! * vz;
      const u2 = verts[i2]! * ux + verts[i2 + 1]! * uy + verts[i2 + 2]! * uz;
      const v2 = verts[i2]! * vx + verts[i2 + 1]! * vy + verts[i2 + 2]! * vz;

      const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
      if (Math.abs(det) < 1e-12) continue;
      const invDet = 1.0 / det;

      const tMinU = Math.min(u0, u1, u2);
      const tMaxU = Math.max(u0, u1, u2);
      const tMinV = Math.min(v0, v1, v2);
      const tMaxV = Math.max(v0, v1, v2);

      const ixMin = Math.max(0, Math.floor((tMinU - minU) * invSpanU));
      const ixMax = Math.min(GRID_RES - 1, Math.floor((tMaxU - minU) * invSpanU));
      const iyMin = Math.max(0, Math.floor((tMinV - minV) * invSpanV));
      const iyMax = Math.min(GRID_RES - 1, Math.floor((tMaxV - minV) * invSpanV));

      for (let iy = iyMin; iy <= iyMax; iy++) {
        const cv = minV + (iy + 0.5) * cellV;
        const rowOffset = iy * GRID_RES;
        for (let ix = ixMin; ix <= ixMax; ix++) {
          if (grid[rowOffset + ix]) continue;
          const cu = minU + (ix + 0.5) * cellU;
          const w1 = ((cu - u0) * (v2 - v0) - (u2 - u0) * (cv - v0)) * invDet;
          const w2 = ((u1 - u0) * (cv - v0) - (cu - u0) * (v1 - v0)) * invDet;
          const w0 = 1.0 - w1 - w2;
          if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) {
            grid[rowOffset + ix] = 1;
          }
        }
      }
    }
  }

  let occupied = 0;
  for (let i = 0; i < grid.length; i++) {
    occupied += grid[i]!;
  }

  const rawArea = (occupied / (GRID_RES * GRID_RES)) * (spanU * spanV);
  const dx = Math.abs(maxX - minX);
  const dy = Math.abs(maxY - minY);
  const dz = Math.abs(maxZ - minZ);

  let areaM2 = rawArea;
  // Convert mm² -> m² if dimensions are in millimeters (> 1.0)
  if (dx > 1.0 || dy > 1.0 || dz > 1.0) {
    areaM2 *= 1e-6;
  }

  return Math.round(areaM2 * 10000) / 10000;
}
