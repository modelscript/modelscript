// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Core AST, Instantiation, Solver, and Diagnostic Types.
 */

export interface SourceSpan {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type GamsVarKind = "free" | "positive" | "negative" | "binary" | "integer";

export type GamsEqRelation = "=e=" | "=l=" | "=g=" | "=n=";

export type GamsSolverType = "lp" | "mip" | "nlp" | "rmip" | "qcp" | "miqcp" | "minlp" | "cns" | "mcp";

export type GamsOptSense = "minimizing" | "maximizing";

export type GamsExpr =
  | { kind: "number"; value: number; span?: SourceSpan | undefined }
  | { kind: "string"; value: string; span?: SourceSpan | undefined }
  | {
      kind: "ref";
      name: string;
      indices: GamsExpr[];
      suffix?: string | undefined;
      span?: SourceSpan | undefined;
    }
  | {
      kind: "unary";
      op: "+" | "-" | "not";
      operand: GamsExpr;
      span?: SourceSpan | undefined;
    }
  | {
      kind: "binary";
      op:
        | "+"
        | "-"
        | "*"
        | "/"
        | "**"
        | "^"
        | "<"
        | "<="
        | ">"
        | ">="
        | "="
        | "=="
        | "<>"
        | "!="
        | "and"
        | "or"
        | "xor"
        | "lt"
        | "le"
        | "gt"
        | "ge"
        | "eq"
        | "ne";
      left: GamsExpr;
      right: GamsExpr;
      span?: SourceSpan | undefined;
    }
  | {
      kind: "dollar";
      expr: GamsExpr;
      condition: GamsExpr;
      span?: SourceSpan | undefined;
    }
  | {
      kind: "indexedOp";
      op: "sum" | "prod" | "smin" | "smax";
      domains: GamsDomainBinding[];
      condition?: GamsExpr | undefined;
      body: GamsExpr;
      span?: SourceSpan | undefined;
    }
  | {
      kind: "call";
      name: string;
      args: GamsExpr[];
      span?: SourceSpan | undefined;
    };

export interface GamsDomainBinding {
  index: string;
  setName?: string | undefined;
  condition?: GamsExpr | undefined;
}

export interface GamsSetDecl {
  name: string;
  domain: string[];
  description?: string | undefined;
  elements: string[];
  span?: SourceSpan | undefined;
}

export interface GamsAliasDecl {
  names: string[];
  span?: SourceSpan | undefined;
}

export interface GamsParamDecl {
  name: string;
  domain: string[];
  description?: string | undefined;
  /** Map from tuple key (e.g. "seattle.new-york" or "" for scalar) to numeric value */
  values: Record<string, number>;
  kind: "parameter" | "scalar" | "table";
  span?: SourceSpan | undefined;
}

export interface GamsVarDecl {
  name: string;
  domain: string[];
  varKind: GamsVarKind;
  description?: string | undefined;
  span?: SourceSpan | undefined;
}

export interface GamsEqDecl {
  name: string;
  domain: string[];
  description?: string | undefined;
  span?: SourceSpan | undefined;
}

export interface GamsEqDef {
  name: string;
  domain: string[];
  condition?: GamsExpr | undefined;
  lhs: GamsExpr;
  relation: GamsEqRelation;
  rhs: GamsExpr;
  span?: SourceSpan | undefined;
}

export interface GamsAssignmentStmt {
  target: string;
  indices: GamsExpr[];
  suffix?: string | undefined;
  condition?: GamsExpr | undefined;
  value: GamsExpr;
  span?: SourceSpan | undefined;
}

export interface GamsModelDecl {
  name: string;
  description?: string | undefined;
  allEquations: boolean;
  equations: string[];
  span?: SourceSpan | undefined;
}

export interface GamsSolveStmt {
  modelName: string;
  solverType: string;
  sense: GamsOptSense;
  objectiveVar: string;
  span?: SourceSpan | undefined;
}

export interface GamsDisplayStmt {
  items: Array<{ name: string; suffix?: string | undefined }>;
  span?: SourceSpan | undefined;
}

export interface GamsSyntaxError {
  message: string;
  line: number;
  column: number;
  offset: number;
}

export interface GamsModel {
  title?: string | undefined;
  sets: GamsSetDecl[];
  aliases: GamsAliasDecl[];
  parameters: GamsParamDecl[];
  variables: GamsVarDecl[];
  equationDecls: GamsEqDecl[];
  equationDefs: GamsEqDef[];
  assignments: GamsAssignmentStmt[];
  models: GamsModelDecl[];
  solves: GamsSolveStmt[];
  displays: GamsDisplayStmt[];
  syntaxErrors: GamsSyntaxError[];
}

// ============================================================================
// Instantiated Problem Types (Flat LP / MILP / NLP representation)
// ============================================================================

export interface InstantiatedGamsVar {
  id: number;
  name: string;
  baseName: string;
  indices: string[];
  varKind: GamsVarKind;
  lb: number;
  ub: number;
  initVal: number;
}

export interface LinearTerm {
  varId: number;
  coeff: number;
}

export interface FlatAffineExpr {
  constant: number;
  terms: LinearTerm[];
  isNonlinear: boolean;
  nonlinearExpr?: GamsExpr | undefined;
}

export type FlatConstraintSense = "<=" | ">=" | "=";

export interface InstantiatedGamsConstraint {
  id: number;
  name: string;
  baseName: string;
  indices: string[];
  /** Standard form: lhsExpr (sense) rhs */
  terms: LinearTerm[];
  sense: FlatConstraintSense;
  rhs: number;
  isNonlinear: boolean;
}

export interface InstantiatedGamsProblem {
  name: string;
  sense: GamsOptSense;
  solverType: GamsSolverType;
  objectiveVarName: string;
  objectiveVarId: number;
  variables: InstantiatedGamsVar[];
  constraints: InstantiatedGamsConstraint[];
  /** Objective linear terms if directly extracted, else equals +1 * objectiveVarId */
  objectiveConstant: number;
  objectiveTerms: LinearTerm[];
  evaluatedSets: Record<string, string[]>;
  evaluatedParams: Record<string, Record<string, number>>;
}

// ============================================================================
// Solver Result Types
// ============================================================================

export type GamsSolveStatus = "optimal" | "infeasible" | "unbounded" | "iteration_limit" | "error";

export interface GamsSolveResult {
  status: GamsSolveStatus;
  objectiveValue: number;
  sense: GamsOptSense;
  solverType: GamsSolverType;
  iterations: number;
  nodesExplored?: number | undefined;
  /** Variable values keyed by flat instantiated name, e.g. "x('seattle','new-york')" or "z" */
  variableValues: Record<string, number>;
  /** Indexed variable values keyed by base name -> tuple key -> value */
  indexedValues: Record<string, Record<string, number>>;
  /** Dual / shadow prices keyed by flat constraint name */
  duals: Record<string, number>;
  message?: string | undefined;
}
