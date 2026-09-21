// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — 3D Spatial Clearance and Interference Verifier.
 *
 * Provides high-speed hierarchical Axis-Aligned Bounding Box (AABB) and
 * clearance evaluation for multi-part assemblies, bridging SysML v2 spatial
 * requirements into real-time CAD verification.
 */

import { IDENTITY, mat4Multiply } from "./transforms.js";
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
  partA?: string;
  partB?: string;
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
      const r = solid.radius;
      const hh = solid.height / 2;
      const local: AABB = { min: [-r, -hh, -r], max: [r, hh, r] };
      return transformAABB(local, currentTransform);
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
      let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
      for (const p of solid.polygon) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minZ) minZ = p[1];
        if (p[1] > maxZ) maxZ = p[1];
      }
      const hh = solid.height / 2;
      const local: AABB = { min: [minX, -hh, minZ], max: [maxX, hh, maxZ] };
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
    case SolidKind.Subtract:
    case SolidKind.Intersect:
    case SolidKind.Fillet:
    case SolidKind.Chamfer:
    case SolidKind.TaggedPatch: {
      // Conservative bounding box from primary solid
      const child = (solid as any).left || (solid as any).child;
      if (child) return computeSolidAABB(child, currentTransform);
      return { min: [0, 0, 0], max: [0, 0, 0] };
    }
    default:
      return { min: [0, 0, 0], max: [0, 0, 0] };
  }
}

/**
 * Computes the Euclidean distance between two AABBs.
 * Returns:
 *   d > 0: positive minimum clearance separation.
 *   d = 0: touching surfaces.
 *   d < 0: penetration depth (collision/interference).
 */
export function computeAABBDistance(a: AABB, b: AABB): number {
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
      const pA = partBoxes[i];
      const pB = partBoxes[j];

      const distance = computeAABBDistance(pA.box, pB.box);
      pairEvaluations.push({
        partA: pA.name,
        partB: pB.name,
        distance,
        aabbA: pA.box,
        aabbB: pB.box,
      });

      // Find required clearance for this pair
      let requiredClearance = defaultMinClearance;
      const rule = specificRules.find(
        (r) =>
          (!r.partA || r.partA === pA.name || r.partA === pB.name) &&
          (!r.partB || r.partB === pA.name || r.partB === pB.name),
      );
      if (rule) requiredClearance = rule.minClearance;

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
