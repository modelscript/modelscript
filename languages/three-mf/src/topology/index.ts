// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/three-mf — 2-Manifold Mesh Topology Verification Engine & DAE Lowering.
 *
 * Computes:
 * - Euler-Poincare characteristic: chi = V - E + F and topological genus g = 1 - chi / 2
 * - Divergence-theorem exact signed volume: V = (1/6) sum (p1 . (p2 x p3))
 * - Surface area, Axis-Aligned Bounding Box (AABB), and 2-manifold / boundary edge counts
 * - Linear-memory DAEBuilder lowering for surgical guides and 3D-printed implants
 */

import { Causality, DAEBuilder, EqKind, ExprKind, StringInterner, Variability, VarType } from "@modelscript/runtime";
import type { ThreeMfDocument, ThreeMfMesh, ThreeMfObject } from "../types.js";

export interface BoundingBox3D {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

export interface MeshTopologyReport {
  objectId: string;
  objectName?: string | undefined;
  vertexCount: number;
  edgeCount: number;
  faceCount: number;
  eulerCharacteristic: number;
  genus: number;
  signedVolume: number;
  signedVolumeMm3: number;
  surfaceArea: number;
  surfaceAreaMm2: number;
  boundingBox: BoundingBox3D;
  isManifold: boolean;
  isWatertightManifold: boolean;
  openBoundaryEdgeCount: number;
  nonManifoldEdgeCount: number;
  degenerateTriangleCount: number;
  outOfBoundsTriangleCount: number;
  degenerateTriangleIndices: number[];
  outOfBoundsTriangleIndices: number[];
}

export interface ThreeMfTopologySummary extends MeshTopologyReport {
  objectReports: MeshTopologyReport[];
}

function analyzeSingleMesh(mesh: ThreeMfMesh, objectId = "1", objectName?: string): MeshTopologyReport {
  const V = mesh.vertices.length;
  const F = mesh.triangles.length;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const v of mesh.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }

  if (V === 0) {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 0;
  }

  const undirectedEdgeCounts = new Map<string, number>();
  const directedHalfEdgeCounts = new Map<string, number>();
  const degenerateTriangleIndices: number[] = [];
  const outOfBoundsTriangleIndices: number[] = [];

  let signedVolume = 0;
  let surfaceArea = 0;

  for (let tIdx = 0; tIdx < F; tIdx++) {
    const tri = mesh.triangles[tIdx]!;
    const { v1, v2, v3 } = tri;

    if (
      v1 < 0 ||
      v2 < 0 ||
      v3 < 0 ||
      v1 >= V ||
      v2 >= V ||
      v3 >= V ||
      !Number.isInteger(v1) ||
      !Number.isInteger(v2) ||
      !Number.isInteger(v3)
    ) {
      outOfBoundsTriangleIndices.push(tIdx);
      continue;
    }

    if (v1 === v2 || v2 === v3 || v1 === v3) {
      degenerateTriangleIndices.push(tIdx);
    }

    const pairs: Array<[number, number]> = [
      [v1, v2],
      [v2, v3],
      [v3, v1],
    ];
    for (const [a, b] of pairs) {
      if (a === b) continue;
      const uKey = a < b ? `${a}_${b}` : `${b}_${a}`;
      undirectedEdgeCounts.set(uKey, (undirectedEdgeCounts.get(uKey) ?? 0) + 1);
      const dKey = `${a}->${b}`;
      directedHalfEdgeCounts.set(dKey, (directedHalfEdgeCounts.get(dKey) ?? 0) + 1);
    }

    const p1 = mesh.vertices[v1]!;
    const p2 = mesh.vertices[v2]!;
    const p3 = mesh.vertices[v3]!;

    // Edge vectors e1 = p2 - p1, e2 = p3 - p1
    const e1x = p2.x - p1.x;
    const e1y = p2.y - p1.y;
    const e1z = p2.z - p1.z;
    const e2x = p3.x - p1.x;
    const e2y = p3.y - p1.y;
    const e2z = p3.z - p1.z;

    // Cross product e1 x e2
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const crossNorm = Math.sqrt(cx * cx + cy * cy + cz * cz);
    const triArea = 0.5 * crossNorm;
    surfaceArea += triArea;

    if (v1 !== v2 && v2 !== v3 && v1 !== v3 && triArea <= 1e-12) {
      degenerateTriangleIndices.push(tIdx);
    }

    // Signed tetrahedron volume (1/6) * p1 . (p2 x p3)
    const p2xp3_x = p2.y * p3.z - p2.z * p3.y;
    const p2xp3_y = p2.z * p3.x - p2.x * p3.z;
    const p2xp3_z = p2.x * p3.y - p2.y * p3.x;
    signedVolume += (p1.x * p2xp3_x + p1.y * p2xp3_y + p1.z * p2xp3_z) / 6.0;
  }

  const E = undirectedEdgeCounts.size;
  const eulerCharacteristic = V - E + F;
  const genus = 1 - eulerCharacteristic / 2;

  let openBoundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const [uKey, count] of undirectedEdgeCounts.entries()) {
    if (count === 1) {
      openBoundaryEdgeCount++;
    } else if (count > 2) {
      nonManifoldEdgeCount++;
    } else if (count === 2) {
      const [aStr, bStr] = uKey.split("_");
      const fwd = directedHalfEdgeCounts.get(`${aStr}->${bStr}`) ?? 0;
      const rev = directedHalfEdgeCounts.get(`${bStr}->${aStr}`) ?? 0;
      if (fwd !== 1 || rev !== 1) {
        nonManifoldEdgeCount++;
      }
    }
  }

  const isWatertightManifold =
    F >= 4 &&
    openBoundaryEdgeCount === 0 &&
    nonManifoldEdgeCount === 0 &&
    degenerateTriangleIndices.length === 0 &&
    outOfBoundsTriangleIndices.length === 0;

  const roundedVol = Math.round(signedVolume * 1e6) / 1e6;
  const roundedArea = Math.round(surfaceArea * 1e6) / 1e6;

  return {
    objectId,
    objectName,
    vertexCount: V,
    edgeCount: E,
    faceCount: F,
    eulerCharacteristic,
    genus,
    signedVolume: roundedVol,
    signedVolumeMm3: roundedVol,
    surfaceArea: roundedArea,
    surfaceAreaMm2: roundedArea,
    boundingBox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      size: [maxX - minX, maxY - minY, maxZ - minZ],
    },
    isManifold: isWatertightManifold,
    isWatertightManifold,
    openBoundaryEdgeCount,
    nonManifoldEdgeCount,
    degenerateTriangleCount: degenerateTriangleIndices.length,
    outOfBoundsTriangleCount: outOfBoundsTriangleIndices.length,
    degenerateTriangleIndices,
    outOfBoundsTriangleIndices,
  };
}

/**
 * Verifies 2-manifold topology, Euler characteristic ($\chi = V - E + F$), signed volume,
 * surface area, and bounding box for a 3MF document, object, or mesh.
 */
export function verifyMeshTopology(input: ThreeMfDocument | ThreeMfObject | ThreeMfMesh): ThreeMfTopologySummary {
  if ("objects" in input) {
    const objectReports: MeshTopologyReport[] = [];
    for (const obj of input.objects) {
      if (obj.mesh) {
        objectReports.push(analyzeSingleMesh(obj.mesh, obj.id, obj.name));
      }
    }
    const primary = objectReports[0] ?? analyzeSingleMesh({ vertices: [], triangles: [] }, "0", "Empty");
    return {
      ...primary,
      objectReports,
    };
  }

  if ("vertices" in input) {
    const rep = analyzeSingleMesh(input, "1");
    return {
      ...rep,
      objectReports: [rep],
    };
  }

  const rep = analyzeSingleMesh(input.mesh ?? { vertices: [], triangles: [] }, input.id, input.name);
  return {
    ...rep,
    objectReports: [rep],
  };
}

function sanitizeIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Lowers a 3MF document (mesh topology, signed volume, surface area, surgical guide wall thickness,
 * drill sleeves, and osteotomy planes) into ModelScript's linear-memory DAEBuilder arena.
 */
export function lowerThreeMfToDae(doc: ThreeMfDocument, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? doc.metadata["Title"] ?? "ThreeMF_SurgicalGuide";
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const topo = verifyMeshTopology(doc);

  for (let i = 0; i < doc.objects.length; i++) {
    const obj = doc.objects[i]!;
    const base = sanitizeIdentifier(obj.name ?? `Object_${obj.id}`);
    const rep = topo.objectReports.find((r) => r.objectId === obj.id);

    const volVar = `${base}_Volume_mm3`;
    const volId = interner.intern(volVar);
    arena.addVariable(volVar, VarType.Real, Variability.Continuous, Causality.Output);
    const volExpr = arena.addExpression(ExprKind.Name, volId);
    arena.addEquation(EqKind.Simple, volExpr, arena.addRealLiteral(rep?.signedVolumeMm3 ?? 0.0));

    const areaVar = `${base}_SurfaceArea_mm2`;
    const areaId = interner.intern(areaVar);
    arena.addVariable(areaVar, VarType.Real, Variability.Continuous, Causality.Output);
    const areaExpr = arena.addExpression(ExprKind.Name, areaId);
    arena.addEquation(EqKind.Simple, areaExpr, arena.addRealLiteral(rep?.surfaceAreaMm2 ?? 0.0));

    const chiVar = `${base}_EulerCharacteristic`;
    const chiId = interner.intern(chiVar);
    arena.addVariable(chiVar, VarType.Real, Variability.Parameter, Causality.Local);
    const chiExpr = arena.addExpression(ExprKind.Name, chiId);
    arena.addEquation(EqKind.InitialSimple, chiExpr, arena.addRealLiteral(rep?.eulerCharacteristic ?? 0));

    if (obj.wallThicknessMm !== undefined) {
      const wtVar = `${base}_WallThickness_mm`;
      const wtId = interner.intern(wtVar);
      arena.addVariable(wtVar, VarType.Real, Variability.Parameter, Causality.Local);
      const wtExpr = arena.addExpression(ExprKind.Name, wtId);
      arena.addEquation(EqKind.InitialSimple, wtExpr, arena.addRealLiteral(obj.wallThicknessMm));
    }

    if (obj.surgicalGuide) {
      for (const sleeve of obj.surgicalGuide.drillSleeves) {
        const sBase = `${base}_${sanitizeIdentifier(sleeve.id)}`;
        const idVar = `${sBase}_InnerDiameter_mm`;
        const idSym = interner.intern(idVar);
        arena.addVariable(idVar, VarType.Real, Variability.Parameter, Causality.Local);
        arena.addEquation(
          EqKind.InitialSimple,
          arena.addExpression(ExprKind.Name, idSym),
          arena.addRealLiteral(sleeve.innerDiameterMm),
        );
      }
    }
  }

  return arena;
}
