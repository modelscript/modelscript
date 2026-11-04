// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/three-mf — Domain types for ISO/ASTM 52915 3MF Core Specification
 * and 3MF Medical/Healthcare Extension (.3mf) for patient-specific 3D surgical guides and implants.
 */

export interface ThreeMfSourceRange {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type ThreeMfDiagnosticSeverity = "error" | "warning" | "info";

export interface ThreeMfDiagnostic {
  code: string;
  rule?: string | undefined;
  severity: ThreeMfDiagnosticSeverity;
  message: string;
  range: ThreeMfSourceRange;
}

export type ThreeMfUnit = "micron" | "millimeter" | "centimeter" | "inch" | "foot" | "meter";

export interface ThreeMfBaseMaterial {
  index: number;
  name: string;
  displayColor?: string | undefined;
  range: ThreeMfSourceRange;
}

export interface ThreeMfBaseMaterialsGroup {
  id: string;
  materials: ThreeMfBaseMaterial[];
  range: ThreeMfSourceRange;
}

export interface ThreeMfVertex {
  x: number;
  y: number;
  z: number;
}

export interface ThreeMfTriangle {
  v1: number;
  v2: number;
  v3: number;
  p1?: number | undefined;
  pid?: string | undefined;
  range: ThreeMfSourceRange;
}

export interface ThreeMfOsteotomyPlane {
  id: string;
  origin: [number, number, number];
  normal: [number, number, number];
  slotWidthMm?: number | undefined;
  range: ThreeMfSourceRange;
}

export interface ThreeMfDrillSleeve {
  id: string;
  entryPoint: [number, number, number];
  axis: [number, number, number];
  innerDiameterMm: number;
  outerDiameterMm: number;
  wallThicknessMm: number;
  lengthMm?: number | undefined;
  range: ThreeMfSourceRange;
}

export interface ThreeMfSurgicalGuideSpec {
  patientId?: string | undefined;
  anatomicalSite?: string | undefined;
  wallThicknessMm?: number | undefined;
  biocompatibleMaterial?: string | undefined;
  sterilizationMethod?: string | undefined;
  osteotomyPlanes: ThreeMfOsteotomyPlane[];
  drillSleeves: ThreeMfDrillSleeve[];
  range: ThreeMfSourceRange;
}

export interface ThreeMfMesh {
  vertices: ThreeMfVertex[];
  triangles: ThreeMfTriangle[];
}

export interface ThreeMfObject {
  id: string;
  name?: string | undefined;
  type: "model" | "solidsupport" | "support" | "surface" | "other";
  pid?: string | undefined;
  pindex?: number | undefined;
  materialName?: string | undefined;
  wallThicknessMm?: number | undefined;
  isMedicalDevice?: boolean | undefined;
  mesh?: ThreeMfMesh | undefined;
  surgicalGuide?: ThreeMfSurgicalGuideSpec | undefined;
  range: ThreeMfSourceRange;
}

export interface ThreeMfBuildItem {
  objectId: string;
  /**
   * 3MF 4x3 affine matrix: [m00, m01, m02, m10, m11, m12, m20, m21, m22, m30, m31, m32]
   */
  transform?:
    | [number, number, number, number, number, number, number, number, number, number, number, number]
    | undefined;
  rawTransform?: string | undefined;
  partNumber?: string | undefined;
  range: ThreeMfSourceRange;
}

export interface ThreeMfDocument {
  unit: ThreeMfUnit;
  metadata: Record<string, string>;
  baseMaterialGroups: ThreeMfBaseMaterialsGroup[];
  objects: ThreeMfObject[];
  buildItems: ThreeMfBuildItem[];
  sourceUri?: string | undefined;
  range: ThreeMfSourceRange;
}
