// SPDX-License-Identifier: AGPL-3.0-or-later

export type ApdlProcessor = "BEGIN" | "PREP7" | "SOLU" | "POST1" | "POST26";

export type ApdlAnalysisType = "STATIC" | "BUCKLE" | "MODAL" | "HARMIC" | "TRANS" | "SUBSTR";

export interface ApdlSourceSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface ApdlSyntaxError extends ApdlSourceSpan {
  message: string;
}

export interface ApdlDiagnostic {
  code: string;
  numericCode: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  endLine?: number | undefined;
  endColumn?: number | undefined;
}

export type ApdlStatement =
  | {
      kind: "processor";
      processor: ApdlProcessor;
      command: string;
      args: string[];
      line: number;
      column: number;
      raw: string;
    }
  | {
      kind: "title";
      title: string;
      line: number;
      column: number;
      raw: string;
    }
  | {
      kind: "units";
      system: string;
      line: number;
      column: number;
      raw: string;
    }
  | {
      kind: "set";
      name: string;
      indexExpr?: string | undefined;
      expr: string;
      line: number;
      column: number;
      raw: string;
    }
  | {
      kind: "dim";
      name: string;
      arrayType: string;
      imax: string;
      jmax?: string | undefined;
      kmax?: string | undefined;
      line: number;
      column: number;
      raw: string;
    }
  | {
      kind: "do_start";
      variable: string;
      startExpr: string;
      endExpr: string;
      incExpr: string;
      line: number;
      column: number;
      raw: string;
    }
  | {
      kind: "enddo";
      line: number;
      column: number;
      raw: string;
    }
  | {
      kind: "if_start";
      lhsExpr: string;
      operator: string;
      rhsExpr: string;
      action: string;
      inlineCommand?: string | undefined;
      line: number;
      column: number;
      raw: string;
    }
  | {
      kind: "elseif";
      lhsExpr: string;
      operator: string;
      rhsExpr: string;
      line: number;
      column: number;
      raw: string;
    }
  | {
      kind: "else";
      line: number;
      column: number;
      raw: string;
    }
  | {
      kind: "endif";
      line: number;
      column: number;
      raw: string;
    }
  | {
      kind: "get";
      param: string;
      entity: string;
      entnum: string;
      item1: string;
      it1num: string;
      item2?: string | undefined;
      it2num?: string | undefined;
      line: number;
      column: number;
      raw: string;
    }
  | {
      kind: "command";
      command: string;
      args: string[];
      line: number;
      column: number;
      raw: string;
    };

export interface ApdlParsedDeck {
  title: string;
  units: string;
  statements: ApdlStatement[];
  syntaxErrors: ApdlSyntaxError[];
  rawText: string;
}

export interface ApdlElementType {
  id: number;
  name: string;
  keyopts: Record<number, number>;
  line: number;
}

export interface ApdlMaterial {
  id: number;
  EX?: number | undefined;
  PRXY?: number | undefined;
  DENS?: number | undefined;
  GXY?: number | undefined;
  ALPX?: number | undefined;
  properties: Record<string, number>;
  line: number;
}

export interface ApdlRealConstant {
  id: number;
  values: number[];
  line: number;
}

export interface ApdlSection {
  id: number;
  type: string;
  subtype: string;
  data: number[];
  area: number;
  Izz: number;
  Iyy: number;
  J: number;
  line: number;
}

export interface ApdlKeypoint {
  id: number;
  x: number;
  y: number;
  z: number;
  line: number;
}

export interface ApdlLine {
  id: number;
  k1: number;
  k2: number;
  ndiv?: number | undefined;
  line: number;
}

export interface ApdlArea {
  id: number;
  keypoints: number[];
  line: number;
}

export interface ApdlVolume {
  id: number;
  keypoints: number[];
  line: number;
}

export interface ApdlNode {
  id: number;
  x: number;
  y: number;
  z: number;
  line: number;
}

export interface ApdlElement {
  id: number;
  typeId: number;
  matId: number;
  realId: number;
  secId: number;
  nodes: number[];
  line: number;
}

export interface ApdlConstraint {
  node: number;
  dof: string;
  value: number;
  line: number;
}

export interface ApdlForce {
  node: number;
  dof: string;
  value: number;
  line: number;
}

export interface ApdlSurfaceLoad {
  entity: number;
  lab: string;
  value: number;
  line: number;
}

export interface ApdlModel {
  title: string;
  units: string;
  analysisType: ApdlAnalysisType;
  numModes: number;
  parameters: Map<string, number>;
  arrays: Map<string, number[]>;
  elementTypes: Map<number, ApdlElementType>;
  materials: Map<number, ApdlMaterial>;
  realConstants: Map<number, ApdlRealConstant>;
  sections: Map<number, ApdlSection>;
  keypoints: Map<number, ApdlKeypoint>;
  lines: Map<number, ApdlLine>;
  areas: Map<number, ApdlArea>;
  volumes: Map<number, ApdlVolume>;
  nodes: Map<number, ApdlNode>;
  elements: Map<number, ApdlElement>;
  constraints: ApdlConstraint[];
  forces: ApdlForce[];
  surfaceLoads: ApdlSurfaceLoad[];
  hasSolve: boolean;
  statements: ApdlStatement[];
}

export interface ApdlNodalDisplacement {
  nodeId: number;
  ux: number;
  uy: number;
  uz: number;
  rotx: number;
  roty: number;
  rotz: number;
  usum: number;
}

export interface ApdlNodalReaction {
  nodeId: number;
  fx: number;
  fy: number;
  fz: number;
  mx: number;
  my: number;
  mz: number;
}

export interface ApdlElementResult {
  elementId: number;
  elementType: string;
  length: number;
  axialForce: number;
  axialStress: number;
  maxShearY: number;
  maxMomentZ: number;
  maxBendingStress: number;
  strainEnergy: number;
}

export interface ApdlStaticSolution {
  analysisType: "STATIC";
  converged: boolean;
  dofCount: number;
  freeDofCount: number;
  displacements: Map<number, ApdlNodalDisplacement>;
  reactions: Map<number, ApdlNodalReaction>;
  elementResults: Map<number, ApdlElementResult>;
  maxDisplacement: number;
  totalStrainEnergy: number;
}

export interface ApdlModeResult {
  mode: number;
  omega: number; // rad/s
  frequencyHz: number; // Hz
  modeShape: Map<number, ApdlNodalDisplacement>;
}

export interface ApdlModalSolution {
  analysisType: "MODAL";
  converged: boolean;
  dofCount: number;
  freeDofCount: number;
  modes: ApdlModeResult[];
}
