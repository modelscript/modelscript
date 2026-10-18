// SPDX-License-Identifier: AGPL-3.0-or-later

export interface BoundaryActionPayload {
  kind: "fix" | "force" | "displacement" | "pressure" | "moment" | "inlet";
  targetId: number | string;
  dofs?: number[] | undefined;
  magnitude?: number | undefined;
  vector?: [number, number, number] | undefined;
}

export interface FeaNode {
  id: number;
  x: number;
  y: number;
  z: number;
}

export interface FeaElement {
  id: number;
  type: string; // e.g. "C3D4", "C3D10", "CTETRA", "CHEXA", "S3", "S4", "CQUAD4", "CTRIA3"
  nodes: number[];
  elset?: string | undefined;
  family?: "solid" | "shell" | "beam" | "truss" | "other" | undefined;
}

export interface FeaMaterial {
  name: string;
  E?: number | undefined;
  nu?: number | undefined;
  rho?: number | undefined;
  yieldStrength?: number | undefined;
}

export interface CaeDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  line?: number | undefined;
  column?: number | undefined;
  expression?: string | undefined;
}

export interface FeaModelData {
  heading?: string | undefined;
  dialect: string;
  nodes: Map<number, FeaNode>;
  elements: Map<number, FeaElement>;
  nodeSets: Map<string, Set<number>>;
  elementSets: Map<string, Set<number>>;
  materials: Map<string, FeaMaterial>;
  fixedNodes: Set<number>;
  nodalLoads: Map<number, [number, number, number]>;
  displacements?: Map<number, [number, number, number]> | undefined;
}

export type ParameterLookup = (name: string) => number | string | undefined;

export interface MaterializeOptions {
  evaluator?: ParameterLookup | Record<string, number | string> | undefined;
  formatNumber?: ((val: number) => string) | undefined;
  diagnostics?: CaeDiagnostic[] | undefined;
}

export interface FeaDialect {
  readonly id: string;
  readonly name: string;
  readonly extensions: string[];
  parse(content: string): FeaModelData;
  materialize(templateText: string, options?: MaterializeOptions): string;
}
