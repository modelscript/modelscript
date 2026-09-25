export interface BoundaryActionPayload {
  kind: "fix" | "force" | "displacement" | "pressure" | "moment" | "inlet";
  targetId: number | string;
  dofs?: number[];
  magnitude?: number;
  vector?: [number, number, number];
}

export interface FeaNode {
  id: number;
  x: number;
  y: number;
  z: number;
}

export interface FeaElement {
  id: number;
  type: string; // e.g. "C3D4", "C3D10", "CTETRA", "CHEXA", "S3"
  nodes: number[];
  elset?: string;
}

export interface FeaMaterial {
  name: string;
  E?: number;
  nu?: number;
  rho?: number;
  yieldStrength?: number;
}

export interface FeaModelData {
  heading?: string;
  dialect: string;
  nodes: Map<number, FeaNode>;
  elements: Map<number, FeaElement>;
  nodeSets: Map<string, Set<number>>;
  elementSets: Map<string, Set<number>>;
  materials: Map<string, FeaMaterial>;
  fixedNodes: Set<number>;
  nodalLoads: Map<number, [number, number, number]>;
}

export type ParameterLookup = (name: string) => number | string | undefined;

export interface MaterializeOptions {
  evaluator?: ParameterLookup | Record<string, number | string>;
  formatNumber?: (val: number) => string;
}

export interface FeaDialect {
  readonly id: string;
  readonly name: string;
  readonly extensions: string[];
  parse(content: string): FeaModelData;
  materialize(templateText: string, options?: MaterializeOptions): string;
}
