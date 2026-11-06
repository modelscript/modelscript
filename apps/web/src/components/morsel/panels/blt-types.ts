// SPDX-License-Identifier: AGPL-3.0-or-later

export type DependencyKind = "matched" | "linear" | "nonlinear" | "derivative";

export interface BltEquation {
  id: number;
  text: string;
  lhs: string;
  rhs: string;
  line: number;
  kind: "ODE" | "Relation" | "connect" | "Simple";
  referencedVars: string[];
}

export interface BltVariable {
  id: number;
  name: string;
  variability: "parameter" | "constant" | "discrete" | "continuous" | "component" | "input" | "output";
  typeName: string;
  line: number;
  isDerivative?: boolean;
  baseStateName?: string;
}

export interface BltBlockTearing {
  tearingVars: string[];
  residualEqs: string[];
  causalChain: Array<{ eqText: string; solvedVar: string }>;
  reductionPercent: number;
}

export interface BltBlock {
  index: number;
  size: number;
  isLoop: boolean;
  blockType: "analytic" | "linear" | "nonlinear" | "ode";
  equations: BltEquation[];
  variables: BltVariable[];
  tearing?: BltBlockTearing | undefined;
}

export interface BltDiagnostics {
  equationCount: number;
  unknownCount: number;
  parameterCount: number;
  degreesOfFreedom: number;
  isBalanced: boolean;
  status: "balanced" | "under-determined" | "over-determined" | "singular";
  loopCount: number;
  maxLoopSize: number;
  odeCount: number;
  analyticCount: number;
  unmatchedEqs: number[];
  unmatchedVars: number[];
}

export interface BltDagEdge {
  fromBlock: number;
  toBlock: number;
  sharedVar: string;
}

export interface BltModelAnalysis {
  className: string;
  equations: BltEquation[];
  variables: BltVariable[];
  blocks: BltBlock[];
  incidence: Record<string, DependencyKind>; // `${eqId}:${varId}` -> kind
  matchedEqToVar: number[]; // eqId -> varId (-1 if unmatched)
  matchedVarToEq: number[]; // varId -> eqId (-1 if unmatched)
  permutedEqOrder: number[]; // eq indices ordered in BLT canonical sequence
  permutedVarOrder: number[]; // var indices ordered in BLT canonical sequence
  diagnostics: BltDiagnostics;
  dagEdges: BltDagEdge[];
}
