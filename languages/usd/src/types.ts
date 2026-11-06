// SPDX-License-Identifier: AGPL-3.0-or-later

export interface SourcePosition {
  line: number;
  column: number;
  offset: number;
}

export interface SourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export type UsdSpecifier = "def" | "over" | "class";

export interface UsdAttribute {
  name: string;
  type: string;
  value: any;
  timeSamples?: Map<number, any> | undefined;
  metadata?: Record<string, any> | undefined;
  range?: SourceRange | undefined;
}

export interface UsdRelationship {
  name: string;
  targets: string[];
  range?: SourceRange | undefined;
}

export interface UsdPrim {
  specifier: UsdSpecifier;
  typeName: string;
  name: string;
  path: string;
  apiSchemas: string[];
  kind?: string | undefined;
  attributes: Map<string, UsdAttribute>;
  relationships: Map<string, UsdRelationship>;
  children: Map<string, UsdPrim>;
  parentPath: string | null;
  range?: SourceRange | undefined;
}

export interface UsdStageMetadata {
  defaultPrim?: string | undefined;
  metersPerUnit?: number | undefined;
  upAxis?: "Y" | "Z" | undefined;
  timeCodesPerSecond?: number | undefined;
  startTimeCode?: number | undefined;
  endTimeCode?: number | undefined;
  subLayers?: string[] | undefined;
  customLayerData?: Record<string, any> | undefined;
}

export interface UsdStage {
  metadata: UsdStageMetadata;
  prims: Map<string, UsdPrim>;
  rootPrims: UsdPrim[];
}

export interface UsdDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  range: SourceRange;
}

// ── Physics Domain Models ───────────────────────────────────────────────────

export interface UsdPhysicsRigidBody {
  primPath: string;
  name: string;
  rigidBodyEnabled: boolean;
  mass: number;
  centerOfMass: [number, number, number];
  diagonalInertia: [number, number, number];
}

export interface UsdPhysicsJointData {
  primPath: string;
  name: string;
  type: "revolute" | "prismatic" | "fixed" | "generic";
  body0Path: string;
  body1Path: string;
  axis: "X" | "Y" | "Z";
  localPos0: [number, number, number];
  localRot0: [number, number, number, number]; // [w, x, y, z]
  localPos1: [number, number, number];
  localRot1: [number, number, number, number];
  lowerLimit?: number | undefined;
  upperLimit?: number | undefined;
}
