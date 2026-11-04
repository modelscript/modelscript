// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/febio — Domain types for FEBio 3.x/4.x (.feb) and SOFA Framework (.scn).
 *
 * Covers finite element meshes (tet4, hex8, tri3, quad4), hyperelastic and biphasic
 * soft-tissue materials (neo-Hookean, Mooney-Rivlin, Ogden, Holmes-Mow, biphasic),
 * boundary conditions, surface/nodal loads, contact interfaces, time-stepper controls,
 * and SOFA surgical scene graph nodes.
 */

export interface FebioSourceRange {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type FebioDiagnosticSeverity = "error" | "warning" | "info";

export interface FebioDiagnostic {
  code: string;
  rule: string;
  severity: FebioDiagnosticSeverity;
  message: string;
  range: FebioSourceRange;
}

export type FebioFormat = "feb" | "scn" | "dsl";

export type FebioMaterialType =
  | "neo-Hookean"
  | "Mooney-Rivlin"
  | "isotropic elastic"
  | "Ogden"
  | "Holmes-Mow"
  | "biphasic"
  | "poroelastic"
  | "veronda-westmann"
  | (string & {});

export interface FebioMaterial {
  id: string;
  name: string;
  type: FebioMaterialType;
  E?: number | undefined;
  v?: number | undefined;
  density?: number | undefined;
  c1?: number | undefined;
  c2?: number | undefined;
  k?: number | undefined;
  perm?: number | undefined;
  phi0?: number | undefined;
  range: FebioSourceRange;
}

export interface FebioNode {
  id: string;
  x: number;
  y: number;
  z: number;
  range: FebioSourceRange;
}

export type FebioElementType = "tet4" | "hex8" | "tri3" | "quad4";

export interface FebioElement {
  id: string;
  type: FebioElementType;
  domainName?: string | undefined;
  materialId?: string | undefined;
  nodeIds: string[];
  range: FebioSourceRange;
}

export interface FebioNodeSet {
  name: string;
  nodeIds: string[];
  range: FebioSourceRange;
}

export interface FebioSurfaceFacet {
  id: string;
  type: "tri3" | "quad4";
  nodeIds: string[];
  range: FebioSourceRange;
}

export interface FebioSurface {
  name: string;
  facets: FebioSurfaceFacet[];
  range: FebioSourceRange;
}

export interface FebioSolidDomain {
  name: string;
  materialId: string;
  range: FebioSourceRange;
}

export interface FebioBoundaryCondition {
  id: string;
  name: string;
  type: "fix" | "zero displacement" | "prescribed displacement" | "rigid";
  nodeSet: string;
  dofs: string[];
  value?: number | undefined;
  scale?: number | undefined;
  range: FebioSourceRange;
}

export interface FebioLoad {
  id: string;
  name: string;
  type: "pressure" | "traction" | "nodal_load" | "body_force";
  surface?: string | undefined;
  nodeSet?: string | undefined;
  dof?: string | undefined;
  value: number;
  range: FebioSourceRange;
}

export interface FebioContact {
  id: string;
  name: string;
  type: string;
  primarySurface: string;
  secondarySurface: string;
  penalty: number;
  range: FebioSourceRange;
}

export interface FebioControl {
  analysis: "STATIC" | "DYNAMIC" | "BIPHASIC" | "STEADY-STATE";
  timeSteps: number;
  stepSize: number;
  maxRefs?: number | undefined;
  dtol?: number | undefined;
  range: FebioSourceRange;
}

export interface SofaForceField {
  type: string;
  name: string;
  youngModulus?: number | undefined;
  poissonRatio?: number | undefined;
  stiffness?: number | undefined;
  range: FebioSourceRange;
}

export interface SofaSceneNode {
  name: string;
  hasMechanicalObject: boolean;
  mechanicalObjectName?: string | undefined;
  forceFields: SofaForceField[];
  hasFixedConstraint: boolean;
  fixedIndices: number[];
  range: FebioSourceRange;
}

export interface FebioDocument {
  format: FebioFormat;
  version: string;
  moduleType: string;
  title: string;
  control?: FebioControl | undefined;
  materials: FebioMaterial[];
  nodes: FebioNode[];
  elements: FebioElement[];
  nodeSets: FebioNodeSet[];
  surfaces: FebioSurface[];
  solidDomains: FebioSolidDomain[];
  boundaryConditions: FebioBoundaryCondition[];
  loads: FebioLoad[];
  contacts: FebioContact[];
  sofaNodes: SofaSceneNode[];
  sourceUri?: string | undefined;
  range: FebioSourceRange;
}
