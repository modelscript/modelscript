// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Mat3, StlBoundingBox, StlMassProperties, StlMeshDocument, StlTopologySummary, Vec3 } from "../types.js";

export interface StlMassPropertyOptions {
  /** Material density (default: 1.0). */
  density?: number | undefined;
}

export interface StlTopologyOptions {
  /** Spatial quantization epsilon for vertex welding (default: 1e-6). */
  weldEpsilon?: number | undefined;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/**
 * Computes exact signed tetrahedral volume, surface area, centroid, 3x3 inertia tensor
 * (both origin and centroidal frames via Tonon / Blow-Binstock tetrahedral integration),
 * and axis-aligned bounding box for an STL mesh.
 */
export function computeStlMassProperties(
  doc: StlMeshDocument,
  options?: StlMassPropertyOptions | number,
): StlMassProperties {
  const density = typeof options === "number" ? options : (options?.density ?? 1.0);
  const facets = doc.facets;

  let signedVolume = 0;
  let surfaceArea = 0;
  let cxAcc = 0;
  let cyAcc = 0;
  let czAcc = 0;

  // Symmetric covariance matrix C = integral(x * x^T dV) about origin
  let cxx = 0;
  let cyy = 0;
  let czz = 0;
  let cxy = 0;
  let cxz = 0;
  let cyz = 0;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const f of facets) {
    const [v0, v1, v2] = f.vertices;
    if (!isFiniteVec3(v0) || !isFiniteVec3(v1) || !isFiniteVec3(v2)) {
      continue;
    }

    for (const v of f.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] > maxZ) maxZ = v[2];
    }

    // Surface area: 0.5 * ||(v1 - v0) x (v2 - v0)||
    const e1 = sub(v1, v0);
    const e2 = sub(v2, v0);
    const cr = cross(e1, e2);
    surfaceArea += 0.5 * Math.hypot(cr[0], cr[1], cr[2]);

    // Signed tetrahedral volume: V_i = (1/6) * v0 . (v1 x v2)
    const v1xv2 = cross(v1, v2);
    const vi = dot(v0, v1xv2) / 6.0;
    signedVolume += vi;

    // Tetrahedron centroid: (v0 + v1 + v2) / 4
    cxAcc += vi * (v0[0] + v1[0] + v2[0]) * 0.25;
    cyAcc += vi * (v0[1] + v1[1] + v2[1]) * 0.25;
    czAcc += vi * (v0[2] + v1[2] + v2[2]) * 0.25;

    // Exact tetrahedral second-moment covariance contribution:
    // C_ab = (V_i / 20) * (2*(v0a*v0b + v1a*v1b + v2a*v2b)
    //                      + v0a*v1b + v1a*v0b + v0a*v2b + v2a*v0b + v1a*v2b + v2a*v1b)
    const k = vi / 20.0;
    const x0 = v0[0];
    const y0 = v0[1];
    const z0 = v0[2];
    const x1 = v1[0];
    const y1 = v1[1];
    const z1 = v1[2];
    const x2 = v2[0];
    const y2 = v2[1];
    const z2 = v2[2];

    cxx += k * (2 * (x0 * x0 + x1 * x1 + x2 * x2) + 2 * (x0 * x1 + x0 * x2 + x1 * x2));
    cyy += k * (2 * (y0 * y0 + y1 * y1 + y2 * y2) + 2 * (y0 * y1 + y0 * y2 + y1 * y2));
    czz += k * (2 * (z0 * z0 + z1 * z1 + z2 * z2) + 2 * (z0 * z1 + z0 * z2 + z1 * z2));

    cxy += k * (2 * (x0 * y0 + x1 * y1 + x2 * y2) + x0 * y1 + x1 * y0 + x0 * y2 + x2 * y0 + x1 * y2 + x2 * y1);
    cxz += k * (2 * (x0 * z0 + x1 * z1 + x2 * z2) + x0 * z1 + x1 * z0 + x0 * z2 + x2 * z0 + x1 * z2 + x2 * z1);
    cyz += k * (2 * (y0 * z0 + y1 * z1 + y2 * z2) + y0 * z1 + y1 * z0 + y0 * z2 + y2 * z0 + y1 * z2 + y2 * z1);
  }

  const volume = Math.abs(signedVolume);
  const sign = signedVolume < 0 ? -1 : 1;
  const mass = density * volume;

  const centroid: Vec3 =
    volume > 1e-18 ? [cxAcc / signedVolume, cyAcc / signedVolume, czAcc / signedVolume] : [0, 0, 0];

  // Positive-orientation covariance scaled by density
  const sCxx = sign * density * cxx;
  const sCyy = sign * density * cyy;
  const sCzz = sign * density * czz;
  const sCxy = sign * density * cxy;
  const sCxz = sign * density * cxz;
  const sCyz = sign * density * cyz;

  const ixx0 = sCyy + sCzz;
  const iyy0 = sCxx + sCzz;
  const izz0 = sCxx + sCyy;
  const ixy0 = -sCxy;
  const ixz0 = -sCxz;
  const iyz0 = -sCyz;

  const inertiaTensorOrigin: Mat3 = [
    [ixx0, ixy0, ixz0],
    [ixy0, iyy0, iyz0],
    [ixz0, iyz0, izz0],
  ];

  // Parallel axis theorem shift to centroid
  const [cx, cy, cz] = centroid;
  const ixx = ixx0 - mass * (cy * cy + cz * cz);
  const iyy = iyy0 - mass * (cx * cx + cz * cz);
  const izz = izz0 - mass * (cx * cx + cy * cy);
  const ixy = ixy0 + mass * cx * cy;
  const ixz = ixz0 + mass * cx * cz;
  const iyz = iyz0 + mass * cy * cz;

  const inertiaTensor: Mat3 = [
    [ixx, ixy, ixz],
    [ixy, iyy, iyz],
    [ixz, iyz, izz],
  ];

  const hasBounds = Number.isFinite(minX);
  const boundingBox: StlBoundingBox = hasBounds
    ? {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        extents: [maxX - minX, maxY - minY, maxZ - minZ],
      }
    : {
        min: [0, 0, 0],
        max: [0, 0, 0],
        extents: [0, 0, 0],
      };

  return {
    signedVolume,
    volume,
    surfaceArea,
    density,
    mass,
    centroid,
    inertiaTensor,
    inertiaTensorOrigin,
    boundingBox,
    facetCount: facets.length,
  };
}

export interface WeldedMeshData {
  points: Vec3[];
  faces: [number, number, number][];
  edgeIncidentCounts: Map<string, number>;
}

/**
 * Welds duplicate STL vertices within `weldEpsilon` and builds indexed triangle faces
 * plus undirected edge incidence counts.
 */
export function weldStlMesh(doc: StlMeshDocument, weldEpsilon = 1e-6): WeldedMeshData {
  const invEps = weldEpsilon > 0 ? 1.0 / weldEpsilon : 1e6;
  const vertexMap = new Map<string, number>();
  const points: Vec3[] = [];
  const faces: [number, number, number][] = [];
  const edgeIncidentCounts = new Map<string, number>();

  function getOrAddVertex(v: Vec3): number {
    const qx = Math.round(v[0] * invEps);
    const qy = Math.round(v[1] * invEps);
    const qz = Math.round(v[2] * invEps);
    const key = `${qx},${qy},${qz}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const idx = points.length;
    points.push([v[0], v[1], v[2]]);
    vertexMap.set(key, idx);
    return idx;
  }

  function addEdge(a: number, b: number): void {
    if (a === b) return;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = `${lo}:${hi}`;
    edgeIncidentCounts.set(key, (edgeIncidentCounts.get(key) ?? 0) + 1);
  }

  for (const f of doc.facets) {
    const [v0, v1, v2] = f.vertices;
    if (!isFiniteVec3(v0) || !isFiniteVec3(v1) || !isFiniteVec3(v2)) {
      continue;
    }
    const i0 = getOrAddVertex(v0);
    const i1 = getOrAddVertex(v1);
    const i2 = getOrAddVertex(v2);
    faces.push([i0, i1, i2]);
    addEdge(i0, i1);
    addEdge(i1, i2);
    addEdge(i2, i0);
  }

  return { points, faces, edgeIncidentCounts };
}

/**
 * Analyzes topological manifoldness, watertightness, and Euler characteristic (chi = V - E + F).
 */
export function analyzeStlTopology(doc: StlMeshDocument, options?: StlTopologyOptions | number): StlTopologySummary {
  const weldEpsilon = typeof options === "number" ? options : (options?.weldEpsilon ?? 1e-6);
  const { points, faces, edgeIncidentCounts } = weldStlMesh(doc, weldEpsilon);

  let openBoundaryEdges = 0;
  let nonManifoldEdges = 0;

  for (const count of edgeIncidentCounts.values()) {
    if (count === 1) openBoundaryEdges++;
    else if (count > 2) nonManifoldEdges++;
  }

  const V = points.length;
  const E = edgeIncidentCounts.size;
  const F = faces.length;
  const eulerCharacteristic = V - E + F;
  const isManifold = F > 0 && nonManifoldEdges === 0;
  const isWatertight = F > 0 && openBoundaryEdges === 0 && nonManifoldEdges === 0;
  const estimatedGenus = isWatertight && (2 - eulerCharacteristic) % 2 === 0 ? (2 - eulerCharacteristic) / 2 : null;

  return {
    vertexCount: V,
    edgeCount: E,
    faceCount: F,
    eulerCharacteristic,
    openBoundaryEdges,
    nonManifoldEdges,
    isManifold,
    isWatertight,
    estimatedGenus,
  };
}
