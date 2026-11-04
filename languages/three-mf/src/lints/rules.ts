// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/three-mf — ISO/ASTM 52915 3MF Medical/Healthcare Semantic Linter.
 *
 * Implements diagnostic rules M9701–M9710:
 * - M9701 (three-mf-non-manifold-edge): Triangle mesh contains open boundary edges or non-manifold edges shared by != 2 triangles.
 * - M9702 (three-mf-degenerate-triangle): Triangle has collinear/duplicate vertex indices or zero area.
 * - M9703 (three-mf-negative-mesh-volume): Mesh has inverted outward normals resulting in negative signed volume (V <= 0).
 * - M9704 (three-mf-unresolved-build-object): <build><item objectid="..."/> references an undefined <object> ID.
 * - M9705 (three-mf-wall-thickness-violation): Surgical guide or implant wall/cannula thickness is below threshold (< 0.8 mm).
 * - M9706 (three-mf-invalid-osteotomy-guide-axis): Surgical cutting plane normal or drill guide axis vector has zero length.
 * - M9707 (three-mf-missing-biocompatible-material): Medical implant/surgical guide object lacks a declared biocompatible material.
 * - M9708 (three-mf-singular-item-transform): <item transform="..."/> 4x3 affine matrix has zero or negative determinant (det(M) <= 0).
 * - M9709 (three-mf-out-of-bounds-vertex-index): Triangle index v_i is < 0 or >= vertex count.
 * - M9710 (three-mf-duplicate-object-id): Duplicate <object id="..."/> in <resources>.
 */

import { verifyMeshTopology } from "../topology/index.js";
import type { ThreeMfDiagnostic, ThreeMfDocument } from "../types.js";

export const MIN_SURGICAL_WALL_THICKNESS_MM = 0.8;

export const APPROVED_BIOCOMPATIBLE_MATERIALS = new Set<string>([
  "Ti-6Al-4V",
  "Ti6Al4V",
  "Ti-6Al-4V ELI",
  "PEEK",
  "PEKK",
  "BioMed Amber",
  "BioMed Clear",
  "BioMed White",
  "BioMed Black",
  "Surgical Guide Resin",
  "Dental SG",
  "Dental LT Clear",
  "CoCr",
  "CoCrMo",
  "316L",
  "316L Stainless Steel",
  "Zirconia",
  "Alumina",
  "PCL",
  "PLGA",
  "UHMWPE",
]);

export const ThreeMfErrorCode = {
  NON_MANIFOLD_EDGE: {
    code: "M9701",
    rule: "three-mf-non-manifold-edge",
    severity: "error" as const,
    message: (objId: string, openEdges: number, nonManifoldEdges: number) =>
      `Mesh in object '${objId}' is not a closed 2-manifold ('${openEdges}' open boundary edges, '${nonManifoldEdges}' non-manifold edges).`,
  },
  DEGENERATE_TRIANGLE: {
    code: "M9702",
    rule: "three-mf-degenerate-triangle",
    severity: "error" as const,
    message: (objId: string, triIndex: number, v1: number, v2: number, v3: number) =>
      `Triangle #${triIndex} (${v1}, ${v2}, ${v3}) in object '${objId}' is degenerate (duplicate vertex indices or zero area).`,
  },
  NEGATIVE_MESH_VOLUME: {
    code: "M9703",
    rule: "three-mf-negative-mesh-volume",
    severity: "error" as const,
    message: (objId: string, signedVol: number) =>
      `Mesh in object '${objId}' has non-positive signed volume '${signedVol} mm^3' (inverted outward face normals).`,
  },
  UNRESOLVED_BUILD_OBJECT: {
    code: "M9704",
    rule: "three-mf-unresolved-build-object",
    severity: "error" as const,
    message: (objectId: string) => `Build '<item>' references undefined resource '<object id="${objectId}">'.`,
  },
  WALL_THICKNESS_VIOLATION: {
    code: "M9705",
    rule: "three-mf-wall-thickness-violation",
    severity: "error" as const,
    message: (targetName: string, actualMm: number, minMm: number) =>
      `Surgical guide or cannula '${targetName}' has wall thickness '${actualMm} mm' below minimum additive manufacturing threshold '${minMm} mm'.`,
  },
  INVALID_OSTEOTOMY_GUIDE_AXIS: {
    code: "M9706",
    rule: "three-mf-invalid-osteotomy-guide-axis",
    severity: "error" as const,
    message: (guideFeatureId: string, objId: string) =>
      `Osteotomy plane or drill sleeve '${guideFeatureId}' on object '${objId}' has a zero-length normal/axis vector.`,
  },
  MISSING_BIOCOMPATIBLE_MATERIAL: {
    code: "M9707",
    rule: "three-mf-missing-biocompatible-material",
    severity: "error" as const,
    message: (objId: string, matName: string) =>
      `Medical object '${objId}' lacks an approved ISO 10993 / USP Class VI biocompatible material (found '${matName || "none"}').`,
  },
  SINGULAR_ITEM_TRANSFORM: {
    code: "M9708",
    rule: "three-mf-singular-item-transform",
    severity: "error" as const,
    message: (objectId: string, det: number) =>
      `Build '<item objectid="${objectId}">' has singular or reflection 4x3 affine transform with determinant '${det}'.`,
  },
  OUT_OF_BOUNDS_VERTEX_INDEX: {
    code: "M9709",
    rule: "three-mf-out-of-bounds-vertex-index",
    severity: "error" as const,
    message: (objId: string, triIndex: number, v1: number, v2: number, v3: number, vertexCount: number) =>
      `Triangle #${triIndex} (${v1}, ${v2}, ${v3}) in object '${objId}' references vertex index outside [0, ${vertexCount - 1}].`,
  },
  DUPLICATE_OBJECT_ID: {
    code: "M9710",
    rule: "three-mf-duplicate-object-id",
    severity: "error" as const,
    message: (objId: string) => `Duplicate '<object id="${objId}">' declared in '<resources>'.`,
  },
};

function isBiocompatibleMaterial(name: string | undefined): boolean {
  if (!name) return false;
  if (APPROVED_BIOCOMPATIBLE_MATERIALS.has(name)) return true;
  const lower = name.toLowerCase();
  for (const approved of APPROVED_BIOCOMPATIBLE_MATERIALS) {
    if (approved.toLowerCase() === lower) return true;
  }
  return false;
}

function computeAffineDeterminant(
  m: [number, number, number, number, number, number, number, number, number, number, number, number],
): number {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  return m00 * (m11 * m22 - m12 * m21) - m01 * (m10 * m22 - m12 * m20) + m02 * (m10 * m21 - m11 * m20);
}

export function lintThreeMfDocument(doc: ThreeMfDocument): ThreeMfDiagnostic[] {
  const diagnostics: ThreeMfDiagnostic[] = [];

  // 1. M9710: Duplicate <object id="...">
  const seenObjectIds = new Set<string>();
  for (const obj of doc.objects) {
    if (seenObjectIds.has(obj.id)) {
      diagnostics.push({
        code: ThreeMfErrorCode.DUPLICATE_OBJECT_ID.code,
        rule: ThreeMfErrorCode.DUPLICATE_OBJECT_ID.rule,
        severity: ThreeMfErrorCode.DUPLICATE_OBJECT_ID.severity,
        message: ThreeMfErrorCode.DUPLICATE_OBJECT_ID.message(obj.id),
        range: obj.range,
      });
    } else {
      seenObjectIds.add(obj.id);
    }
  }

  // 2. Per-object mesh and medical checks: M9701, M9702, M9703, M9705, M9706, M9707, M9709
  for (const obj of doc.objects) {
    if (obj.mesh) {
      const rep = verifyMeshTopology(obj);
      const V = obj.mesh.vertices.length;

      // M9709: Out-of-bounds vertex index
      for (const tIdx of rep.outOfBoundsTriangleIndices) {
        const tri = obj.mesh.triangles[tIdx]!;
        diagnostics.push({
          code: ThreeMfErrorCode.OUT_OF_BOUNDS_VERTEX_INDEX.code,
          rule: ThreeMfErrorCode.OUT_OF_BOUNDS_VERTEX_INDEX.rule,
          severity: ThreeMfErrorCode.OUT_OF_BOUNDS_VERTEX_INDEX.severity,
          message: ThreeMfErrorCode.OUT_OF_BOUNDS_VERTEX_INDEX.message(obj.id, tIdx, tri.v1, tri.v2, tri.v3, V),
          range: tri.range,
        });
      }

      // M9702: Degenerate triangles
      for (const tIdx of rep.degenerateTriangleIndices) {
        const tri = obj.mesh.triangles[tIdx]!;
        diagnostics.push({
          code: ThreeMfErrorCode.DEGENERATE_TRIANGLE.code,
          rule: ThreeMfErrorCode.DEGENERATE_TRIANGLE.rule,
          severity: ThreeMfErrorCode.DEGENERATE_TRIANGLE.severity,
          message: ThreeMfErrorCode.DEGENERATE_TRIANGLE.message(obj.id, tIdx, tri.v1, tri.v2, tri.v3),
          range: tri.range,
        });
      }

      // M9701: Non-manifold or open boundary edges
      if (rep.openBoundaryEdgeCount > 0 || rep.nonManifoldEdgeCount > 0) {
        diagnostics.push({
          code: ThreeMfErrorCode.NON_MANIFOLD_EDGE.code,
          rule: ThreeMfErrorCode.NON_MANIFOLD_EDGE.rule,
          severity: ThreeMfErrorCode.NON_MANIFOLD_EDGE.severity,
          message: ThreeMfErrorCode.NON_MANIFOLD_EDGE.message(
            obj.id,
            rep.openBoundaryEdgeCount,
            rep.nonManifoldEdgeCount,
          ),
          range: obj.range,
        });
      }

      // M9703: Negative signed mesh volume (only check when mesh has triangles and no out-of-bounds indices)
      if (obj.mesh.triangles.length > 0 && rep.outOfBoundsTriangleCount === 0 && rep.signedVolumeMm3 <= 0) {
        diagnostics.push({
          code: ThreeMfErrorCode.NEGATIVE_MESH_VOLUME.code,
          rule: ThreeMfErrorCode.NEGATIVE_MESH_VOLUME.rule,
          severity: ThreeMfErrorCode.NEGATIVE_MESH_VOLUME.severity,
          message: ThreeMfErrorCode.NEGATIVE_MESH_VOLUME.message(obj.id, rep.signedVolumeMm3),
          range: obj.range,
        });
      }
    }

    // M9705: Wall thickness violation (< 0.8 mm)
    if (obj.wallThicknessMm !== undefined && obj.wallThicknessMm < MIN_SURGICAL_WALL_THICKNESS_MM) {
      diagnostics.push({
        code: ThreeMfErrorCode.WALL_THICKNESS_VIOLATION.code,
        rule: ThreeMfErrorCode.WALL_THICKNESS_VIOLATION.rule,
        severity: ThreeMfErrorCode.WALL_THICKNESS_VIOLATION.severity,
        message: ThreeMfErrorCode.WALL_THICKNESS_VIOLATION.message(
          obj.name ?? obj.id,
          obj.wallThicknessMm,
          MIN_SURGICAL_WALL_THICKNESS_MM,
        ),
        range: obj.surgicalGuide?.range ?? obj.range,
      });
    }

    if (obj.surgicalGuide) {
      // Check drill sleeve wall thickness and axis vectors
      for (const sleeve of obj.surgicalGuide.drillSleeves) {
        if (sleeve.wallThicknessMm < MIN_SURGICAL_WALL_THICKNESS_MM) {
          diagnostics.push({
            code: ThreeMfErrorCode.WALL_THICKNESS_VIOLATION.code,
            rule: ThreeMfErrorCode.WALL_THICKNESS_VIOLATION.rule,
            severity: ThreeMfErrorCode.WALL_THICKNESS_VIOLATION.severity,
            message: ThreeMfErrorCode.WALL_THICKNESS_VIOLATION.message(
              sleeve.id,
              sleeve.wallThicknessMm,
              MIN_SURGICAL_WALL_THICKNESS_MM,
            ),
            range: sleeve.range,
          });
        }
        const [ax, ay, az] = sleeve.axis;
        const axisNorm = Math.sqrt(ax * ax + ay * ay + az * az);
        if (axisNorm <= 1e-9) {
          diagnostics.push({
            code: ThreeMfErrorCode.INVALID_OSTEOTOMY_GUIDE_AXIS.code,
            rule: ThreeMfErrorCode.INVALID_OSTEOTOMY_GUIDE_AXIS.rule,
            severity: ThreeMfErrorCode.INVALID_OSTEOTOMY_GUIDE_AXIS.severity,
            message: ThreeMfErrorCode.INVALID_OSTEOTOMY_GUIDE_AXIS.message(sleeve.id, obj.id),
            range: sleeve.range,
          });
        }
      }

      // M9706: Check osteotomy cutting plane normal vectors
      for (const plane of obj.surgicalGuide.osteotomyPlanes) {
        const [nx, ny, nz] = plane.normal;
        const norm = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (norm <= 1e-9) {
          diagnostics.push({
            code: ThreeMfErrorCode.INVALID_OSTEOTOMY_GUIDE_AXIS.code,
            rule: ThreeMfErrorCode.INVALID_OSTEOTOMY_GUIDE_AXIS.rule,
            severity: ThreeMfErrorCode.INVALID_OSTEOTOMY_GUIDE_AXIS.severity,
            message: ThreeMfErrorCode.INVALID_OSTEOTOMY_GUIDE_AXIS.message(plane.id, obj.id),
            range: plane.range,
          });
        }
      }
    }

    // M9707: Missing biocompatible material on medical device / surgical guide / implant object
    if (obj.isMedicalDevice || obj.surgicalGuide !== undefined) {
      const mat = obj.surgicalGuide?.biocompatibleMaterial ?? obj.materialName;
      if (!isBiocompatibleMaterial(mat)) {
        diagnostics.push({
          code: ThreeMfErrorCode.MISSING_BIOCOMPATIBLE_MATERIAL.code,
          rule: ThreeMfErrorCode.MISSING_BIOCOMPATIBLE_MATERIAL.rule,
          severity: ThreeMfErrorCode.MISSING_BIOCOMPATIBLE_MATERIAL.severity,
          message: ThreeMfErrorCode.MISSING_BIOCOMPATIBLE_MATERIAL.message(obj.name ?? obj.id, mat ?? ""),
          range: obj.surgicalGuide?.range ?? obj.range,
        });
      }
    }
  }

  // 3. Build Item checks: M9704 (unresolved objectid) and M9708 (singular 4x3 affine transform)
  for (const item of doc.buildItems) {
    if (!seenObjectIds.has(item.objectId)) {
      diagnostics.push({
        code: ThreeMfErrorCode.UNRESOLVED_BUILD_OBJECT.code,
        rule: ThreeMfErrorCode.UNRESOLVED_BUILD_OBJECT.rule,
        severity: ThreeMfErrorCode.UNRESOLVED_BUILD_OBJECT.severity,
        message: ThreeMfErrorCode.UNRESOLVED_BUILD_OBJECT.message(item.objectId),
        range: item.range,
      });
    }

    if (item.transform) {
      const det = Math.round(computeAffineDeterminant(item.transform) * 1e6) / 1e6;
      if (det <= 1e-9) {
        diagnostics.push({
          code: ThreeMfErrorCode.SINGULAR_ITEM_TRANSFORM.code,
          rule: ThreeMfErrorCode.SINGULAR_ITEM_TRANSFORM.rule,
          severity: ThreeMfErrorCode.SINGULAR_ITEM_TRANSFORM.severity,
          message: ThreeMfErrorCode.SINGULAR_ITEM_TRANSFORM.message(item.objectId, det),
          range: item.range,
        });
      }
    } else if (item.rawTransform !== undefined) {
      diagnostics.push({
        code: ThreeMfErrorCode.SINGULAR_ITEM_TRANSFORM.code,
        rule: ThreeMfErrorCode.SINGULAR_ITEM_TRANSFORM.rule,
        severity: ThreeMfErrorCode.SINGULAR_ITEM_TRANSFORM.severity,
        message: ThreeMfErrorCode.SINGULAR_ITEM_TRANSFORM.message(item.objectId, 0),
        range: item.range,
      });
    }
  }

  return diagnostics;
}
