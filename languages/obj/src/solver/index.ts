// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/obj — Geometry & Mesh Topology Solver.
 *
 * Implements:
 *   - Fan triangulation of n-gon faces (`triangulateObjMesh`)
 *   - Area-weighted smooth vertex normal computation (`computeSmoothVertexNormals`)
 *   - Axis-aligned 3D bounding box (`computeBoundingBox`)
 *   - Exact surface area, signed volume, centroid, rigid-body inertia tensor,
 *     watertightness, non-manifold edge count, and Euler characteristic χ = V - E + F (`computeMeshMetrics`)
 */

import type { ObjDocument, Vec3 } from "../types.js";

export interface TriangulatedFace {
  /** 0-based vertex indices into `ObjDocument.vertices`. */
  indices: readonly [number, number, number];
  /** Optional 0-based normal indices into `ObjDocument.normals`. */
  normalIndices?: readonly [number, number, number] | undefined;
  /** Unit geometric face normal computed from `(p1 - p0) x (p2 - p0)`. */
  faceNormal: Vec3;
  /** Triangle surface area. */
  area: number;
  /** Originating face index in `ObjDocument.faces`. */
  sourceFaceIndex: number;
  /** Object name owning this triangle. */
  objectName: string;
  /** Group names owning this triangle. */
  groupNames: string[];
  /** Material name assigned to this triangle. */
  materialName?: string | undefined;
  /** Smoothing group ID (or null if flat). */
  smoothingGroup: number | null;
}

export interface BoundingBox3D {
  min: Vec3;
  max: Vec3;
  size: Vec3;
  center: Vec3;
  diagonal: number;
}

export interface InertiaTensor3x3 {
  ixx: number;
  iyy: number;
  izz: number;
  ixy: number;
  ixz: number;
  iyz: number;
}

export interface ObjMeshMetrics {
  vertexCount: number;
  usedVertexCount: number;
  faceCount: number;
  triangleCount: number;
  edgeCount: number;
  boundaryEdgeCount: number;
  nonManifoldEdgeCount: number;
  isWatertight: boolean;
  /** Euler characteristic χ = V_used - E + F_tri. For a closed genus-0 sphere/cube, χ = 2. */
  eulerCharacteristic: number;
  surfaceArea: number;
  /** Signed volume via divergence theorem Σ (p0 · (p1 × p2)) / 6. Positive for CCW outward normals. */
  signedVolume: number;
  /** Absolute volume |signedVolume|. */
  volume: number;
  /** Volume-weighted centroid (or vertex average if volume ≈ 0). */
  centroid: Vec3;
  /** Rigid-body inertia tensor about the centroid at unit density (ρ = 1 kg/m³). */
  unitDensityInertia: InertiaTensor3x3;
  boundingBox: BoundingBox3D;
}

/**
 * Fan-triangulate all valid polygonal faces (`n >= 3`) in an `ObjDocument`.
 */
export function triangulateObjMesh(doc: ObjDocument): TriangulatedFace[] {
  const triangles: TriangulatedFace[] = [];
  const verts = doc.vertices;

  for (let fIdx = 0; fIdx < doc.faces.length; fIdx++) {
    const face = doc.faces[fIdx]!;
    if (face.vertices.length < 3) continue;

    const v0Ref = face.vertices[0]!;
    if (v0Ref.v < 0 || v0Ref.v >= verts.length) continue;
    const p0 = verts[v0Ref.v]!;

    for (let k = 1; k < face.vertices.length - 1; k++) {
      const v1Ref = face.vertices[k]!;
      const v2Ref = face.vertices[k + 1]!;
      if (v1Ref.v < 0 || v1Ref.v >= verts.length || v2Ref.v < 0 || v2Ref.v >= verts.length) {
        continue;
      }
      const p1 = verts[v1Ref.v]!;
      const p2 = verts[v2Ref.v]!;

      const ux = p1.x - p0.x;
      const uy = p1.y - p0.y;
      const uz = p1.z - p0.z;
      const vx = p2.x - p0.x;
      const vy = p2.y - p0.y;
      const vz = p2.z - p0.z;

      const cx = uy * vz - uz * vy;
      const cy = uz * vx - ux * vz;
      const cz = ux * vy - uy * vx;
      const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
      const area = 0.5 * len;
      const faceNormal: Vec3 = len > 1e-15 ? [cx / len, cy / len, cz / len] : [0, 0, 1];

      const hasNormals =
        v0Ref.vn !== undefined &&
        v0Ref.vn >= 0 &&
        v1Ref.vn !== undefined &&
        v1Ref.vn >= 0 &&
        v2Ref.vn !== undefined &&
        v2Ref.vn >= 0;

      triangles.push({
        indices: [v0Ref.v, v1Ref.v, v2Ref.v],
        normalIndices: hasNormals ? [v0Ref.vn!, v1Ref.vn!, v2Ref.vn!] : undefined,
        faceNormal,
        area,
        sourceFaceIndex: fIdx,
        objectName: face.objectName,
        groupNames: face.groupNames,
        materialName: face.materialName,
        smoothingGroup: face.smoothingGroup,
      });
    }
  }

  return triangles;
}

/**
 * Compute area-weighted smooth unit vertex normals for every vertex in `doc.vertices`.
 */
export function computeSmoothVertexNormals(doc: ObjDocument, triangles?: TriangulatedFace[]): Vec3[] {
  const tris = triangles ?? triangulateObjMesh(doc);
  const n = doc.vertices.length;
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  const az = new Float64Array(n);

  for (const tri of tris) {
    const [i0, i1, i2] = tri.indices;
    const wx = tri.faceNormal[0] * tri.area;
    const wy = tri.faceNormal[1] * tri.area;
    const wz = tri.faceNormal[2] * tri.area;

    ax[i0] = (ax[i0] ?? 0) + wx;
    ay[i0] = (ay[i0] ?? 0) + wy;
    az[i0] = (az[i0] ?? 0) + wz;

    ax[i1] = (ax[i1] ?? 0) + wx;
    ay[i1] = (ay[i1] ?? 0) + wy;
    az[i1] = (az[i1] ?? 0) + wz;

    ax[i2] = (ax[i2] ?? 0) + wx;
    ay[i2] = (ay[i2] ?? 0) + wy;
    az[i2] = (az[i2] ?? 0) + wz;
  }

  const out: Vec3[] = new Array<Vec3>(n);
  for (let i = 0; i < n; i++) {
    const nx = ax[i] ?? 0;
    const ny = ay[i] ?? 0;
    const nz = az[i] ?? 0;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    out[i] = len > 1e-15 ? [nx / len, ny / len, nz / len] : [0, 0, 1];
  }
  return out;
}

/**
 * Compute the axis-aligned 3D bounding box of all vertices in `doc`.
 */
export function computeBoundingBox(doc: ObjDocument): BoundingBox3D {
  if (doc.vertices.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      size: [0, 0, 0],
      center: [0, 0, 0],
      diagonal: 0,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const v of doc.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }

  const sx = maxX - minX;
  const sy = maxY - minY;
  const sz = maxZ - minZ;

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [sx, sy, sz],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    diagonal: Math.sqrt(sx * sx + sy * sy + sz * sz),
  };
}

/**
 * Compute comprehensive geometric, topological, and inertial metrics for an `ObjDocument`.
 */
export function computeMeshMetrics(doc: ObjDocument): ObjMeshMetrics {
  const triangles = triangulateObjMesh(doc);
  const boundingBox = computeBoundingBox(doc);

  const usedVertices = new Set<number>();
  const edgeCounts = new Map<string, number>();

  let surfaceArea = 0;
  let signedVolume = 0;
  let cxAcc = 0;
  let cyAcc = 0;
  let czAcc = 0;

  for (const tri of triangles) {
    const [i0, i1, i2] = tri.indices;
    usedVertices.add(i0);
    usedVertices.add(i1);
    usedVertices.add(i2);

    surfaceArea += tri.area;

    const p0 = doc.vertices[i0]!;
    const p1 = doc.vertices[i1]!;
    const p2 = doc.vertices[i2]!;

    // Signed tetrahedron volume (origin, p0, p1, p2)
    const crossX = p1.y * p2.z - p1.z * p2.y;
    const crossY = p1.z * p2.x - p1.x * p2.z;
    const crossZ = p1.x * p2.y - p1.y * p2.x;
    const tetVol = (p0.x * crossX + p0.y * crossY + p0.z * crossZ) / 6;
    signedVolume += tetVol;

    cxAcc += tetVol * (p0.x + p1.x + p2.x) * 0.25;
    cyAcc += tetVol * (p0.y + p1.y + p2.y) * 0.25;
    czAcc += tetVol * (p0.z + p1.z + p2.z) * 0.25;

    // Undirected triangle edges
    const pairs: Array<[number, number]> = [
      [i0, i1],
      [i1, i2],
      [i2, i0],
    ];
    for (const [a, b] of pairs) {
      if (a === b) continue;
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = `${lo}:${hi}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) boundaryEdgeCount++;
    else if (count > 2) nonManifoldEdgeCount++;
  }

  const volume = Math.abs(signedVolume);
  let centroid: Vec3;
  if (Math.abs(signedVolume) > 1e-12) {
    centroid = [cxAcc / signedVolume, cyAcc / signedVolume, czAcc / signedVolume];
  } else if (usedVertices.size > 0) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const idx of usedVertices) {
      const v = doc.vertices[idx]!;
      sx += v.x;
      sy += v.y;
      sz += v.z;
    }
    const inv = 1 / usedVertices.size;
    centroid = [sx * inv, sy * inv, sz * inv];
  } else {
    centroid = boundingBox.center;
  }

  // Exact tetrahedron-summed inertia tensor about the centroid (unit density ρ = 1)
  // Using Tonon (2005) / Blow & Binstock canonical tetrahedron covariance formula
  let cxx = 0;
  let cyy = 0;
  let czz = 0;
  let cxy = 0;
  let cxz = 0;
  let cyz = 0;
  const sign = signedVolume >= 0 ? 1 : -1;

  for (const tri of triangles) {
    const [i0, i1, i2] = tri.indices;
    const p0 = doc.vertices[i0]!;
    const p1 = doc.vertices[i1]!;
    const p2 = doc.vertices[i2]!;

    const x0 = p0.x - centroid[0];
    const y0 = p0.y - centroid[1];
    const z0 = p0.z - centroid[2];
    const x1 = p1.x - centroid[0];
    const y1 = p1.y - centroid[1];
    const z1 = p1.z - centroid[2];
    const x2 = p2.x - centroid[0];
    const y2 = p2.y - centroid[1];
    const z2 = p2.z - centroid[2];

    const detJ = sign * (x0 * (y1 * z2 - z1 * y2) - y0 * (x1 * z2 - z1 * x2) + z0 * (x1 * y2 - y1 * x2));
    const f = detJ / 60;

    cxx += f * (x0 * x0 + x1 * x1 + x2 * x2 + x0 * x1 + x1 * x2 + x2 * x0);
    cyy += f * (y0 * y0 + y1 * y1 + y2 * y2 + y0 * y1 + y1 * y2 + y2 * y0);
    czz += f * (z0 * z0 + z1 * z1 + z2 * z2 + z0 * z1 + z1 * z2 + z2 * z0);

    cxy +=
      (detJ / 120) *
      (2 * x0 * y0 + 2 * x1 * y1 + 2 * x2 * y2 + x0 * y1 + x1 * y0 + x1 * y2 + x2 * y1 + x2 * y0 + x0 * y2);
    cxz +=
      (detJ / 120) *
      (2 * x0 * z0 + 2 * x1 * z1 + 2 * x2 * z2 + x0 * z1 + x1 * z0 + x1 * z2 + x2 * z1 + x2 * z0 + x0 * z2);
    cyz +=
      (detJ / 120) *
      (2 * y0 * z0 + 2 * y1 * z1 + 2 * y2 * z2 + y0 * z1 + y1 * z0 + y1 * z2 + y2 * z1 + y2 * z0 + y0 * z2);
  }

  const unitDensityInertia: InertiaTensor3x3 = {
    ixx: Math.max(0, cyy + czz),
    iyy: Math.max(0, cxx + czz),
    izz: Math.max(0, cxx + cyy),
    ixy: -cxy,
    ixz: -cxz,
    iyz: -cyz,
  };

  const edgeCount = edgeCounts.size;
  const eulerCharacteristic = usedVertices.size - edgeCount + triangles.length;
  const isWatertight = triangles.length > 0 && boundaryEdgeCount === 0 && nonManifoldEdgeCount === 0;

  return {
    vertexCount: doc.vertices.length,
    usedVertexCount: usedVertices.size,
    faceCount: doc.faces.length,
    triangleCount: triangles.length,
    edgeCount,
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    isWatertight,
    eulerCharacteristic,
    surfaceArea,
    signedVolume,
    volume,
    centroid,
    unitDensityInertia,
    boundingBox,
  };
}
