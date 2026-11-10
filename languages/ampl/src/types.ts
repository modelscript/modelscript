// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Type definitions for AMPL (A Mathematical Programming Language).
 */

export type SourceLocation = {
  line: number;
  column: number;
  offset: number;
};

export type SourceRange = {
  start: SourceLocation;
  end: SourceLocation;
};

// ── Expression AST ──

export type AmplUnaryOp = "+" | "-" | "not" | "!";
export type AmplBinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "^"
  | "**"
  | "mod"
  | "div"
  | "=="
  | "="
  | "!="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">="
  | "and"
  | "or"
  | "==>"
  | "<==>"
  | "union"
  | "inter"
  | "diff"
  | "symdiff"
  | "cross";

export type AmplReductionKind =
  | "sum"
  | "prod"
  | "min"
  | "max"
  | "forall"
  | "exists"
  | "count"
  | "numberof";

export interface AmplIterator {
  variables: string[];
  setExpr: AmplExpr;
  condition?: AmplExpr | undefined;
}

export type AmplExpr =
  | { kind: "number"; value: number; range?: SourceRange | undefined }
  | { kind: "string"; value: string; range?: SourceRange | undefined }
  | { kind: "identifier"; name: string; range?: SourceRange | undefined }
  | { kind: "wildcard"; range?: SourceRange | undefined }
  | { kind: "subscript"; name: string; indices: AmplExpr[]; range?: SourceRange | undefined }
  | { kind: "suffix"; target: AmplExpr; suffix: string; range?: SourceRange | undefined }
  | { kind: "unary"; op: AmplUnaryOp; expr: AmplExpr; range?: SourceRange | undefined }
  | { kind: "binary"; op: AmplBinaryOp; left: AmplExpr; right: AmplExpr; range?: SourceRange | undefined }
  | { kind: "call"; fn: string; args: AmplExpr[]; range?: SourceRange | undefined }
  | { kind: "reduction"; reduction: AmplReductionKind; iterators: AmplIterator[]; expr: AmplExpr; range?: SourceRange | undefined }
  | { kind: "if_then_else"; condition: AmplExpr; thenExpr: AmplExpr; elseExpr: AmplExpr; range?: SourceRange | undefined }
  | { kind: "piecewise"; breakpoints: AmplExpr[]; slopes: AmplExpr[]; argument: AmplExpr; zeroPoint?: AmplExpr | undefined; range?: SourceRange | undefined }
  | { kind: "set_literal"; elements: AmplExpr[]; range?: SourceRange | undefined }
  | { kind: "range"; start: AmplExpr; end: AmplExpr; step?: AmplExpr | undefined; range?: SourceRange | undefined }
  | { kind: "set_op"; op: "union" | "inter" | "diff" | "symdiff" | "cross"; left: AmplExpr; right: AmplExpr; range?: SourceRange | undefined };

// ── Declarations AST ──

export interface AmplIndexing {
  iterators: AmplIterator[];
}

export interface AmplSetDecl {
  name: string;
  dimen: number;
  ordered?: boolean | undefined;
  circular?: boolean | undefined;
  indexing?: AmplIndexing | undefined;
  within?: AmplExpr | undefined;
  default?: AmplExpr | undefined;
  assignExpr?: AmplExpr | undefined;
  range?: SourceRange | undefined;
}

export type AmplParamType = "real" | "integer" | "binary" | "symbolic";

export interface AmplParamDecl {
  name: string;
  type: AmplParamType;
  indexing?: AmplIndexing | undefined;
  lowerBound?: AmplExpr | undefined;
  upperBound?: AmplExpr | undefined;
  default?: AmplExpr | undefined;
  assignExpr?: AmplExpr | undefined;
  range?: SourceRange | undefined;
}

export type AmplVarType = "continuous" | "integer" | "binary" | "semicont" | "semiint";

export interface AmplVarCoeffClause {
  indexing?: AmplIndexing | undefined;
  targetConstraint: string;
  constraintIndices?: AmplExpr[] | undefined;
  coeffExpr: AmplExpr;
}

export interface AmplVarColumnSpec {
  objClauses: { objName: string; coeffExpr: AmplExpr }[];
  coeffClauses: AmplVarCoeffClause[];
}

export interface AmplVarDecl {
  name: string;
  type: AmplVarType;
  indexing?: AmplIndexing | undefined;
  lowerBound?: AmplExpr | undefined;
  upperBound?: AmplExpr | undefined;
  semiLowerBound?: AmplExpr | undefined;
  initial?: AmplExpr | undefined;
  definedExpr?: AmplExpr | undefined;
  sosno?: AmplExpr | undefined;
  ref?: AmplExpr | undefined;
  columnSpec?: AmplVarColumnSpec | undefined;
  range?: SourceRange | undefined;
}

export type AmplObjectiveDirection = "minimize" | "maximize";

export interface AmplObjectiveDecl {
  name: string;
  direction: AmplObjectiveDirection;
  indexing?: AmplIndexing | undefined;
  expr: AmplExpr;
  range?: SourceRange | undefined;
}

export type AmplConstraintRelOp = "<=" | ">=" | "=" | "==";

export interface AmplConstraintComplement {
  lhs: AmplExpr;
  operator: AmplConstraintRelOp;
  rhs: AmplExpr;
  rhsUpper?: AmplExpr | undefined;
}

export interface AmplConstraintDecl {
  name: string;
  indexing?: AmplIndexing | undefined;
  lhs: AmplExpr;
  operator: AmplConstraintRelOp;
  rhs: AmplExpr;
  rhsUpper?: AmplExpr | undefined; // For double-sided: lb <= expr <= ub
  complements?: AmplConstraintComplement | undefined; // For MPEC: c1 complements c2
  isLogical?: boolean | undefined; // For CP / logical constraints (==>, alldiff, etc.)
  range?: SourceRange | undefined;
}

export interface AmplNodeDecl {
  name: string;
  indexing?: AmplIndexing | undefined;
  operator?: AmplConstraintRelOp | undefined;
  rhs?: AmplExpr | undefined;
  netDirection?: "net_out" | "net_in" | undefined;
  range?: SourceRange | undefined;
}

export interface AmplArcEndpoint {
  nodeName: string;
  nodeIndices?: AmplExpr[] | undefined;
  gain?: AmplExpr | undefined;
}

export interface AmplArcDecl {
  name: string;
  indexing?: AmplIndexing | undefined;
  varType?: AmplVarType | undefined;
  lowerBound?: AmplExpr | undefined;
  upperBound?: AmplExpr | undefined;
  from?: AmplArcEndpoint | undefined;
  to?: AmplArcEndpoint | undefined;
  objClause?: { objName: string; cost: AmplExpr } | undefined;
  range?: SourceRange | undefined;
}

export interface AmplFunctionDecl {
  name: string;
  params: string[];
  body: AmplExpr;
  isExternal?: boolean | undefined;
  range?: SourceRange | undefined;
}

export interface AmplProblemDecl {
  name: string;
  indexing?: AmplIndexing | undefined;
  elements: string[];
  range?: SourceRange | undefined;
}

export interface AmplSuffixDecl {
  name: string;
  direction: "IN" | "OUT" | "INOUT";
  datatype: "real" | "integer" | "binary" | "symbolic";
  range?: SourceRange | undefined;
}

export interface AmplTableColumnSpec {
  name: string;
  alias?: string | undefined;
  expr?: AmplExpr | undefined;
}

export interface AmplTableDecl {
  name: string;
  indexing?: AmplIndexing | undefined;
  mode: "IN" | "OUT" | "INOUT";
  driver: string;
  filePath: string;
  setName?: string | undefined;
  keyColumns: string[];
  valueColumns: AmplTableColumnSpec[];
  range?: SourceRange | undefined;
}

export interface AmplCheckDecl {
  indexing?: AmplIndexing | undefined;
  condition: AmplExpr;
  range?: SourceRange | undefined;
}

// ── Imperative Scripting AST (.run) ──

export type AmplStmt =
  | { kind: "model_cmd"; filePath: string; range?: SourceRange | undefined }
  | { kind: "data_cmd"; filePath: string; range?: SourceRange | undefined }
  | { kind: "include_cmd"; filePath: string; range?: SourceRange | undefined }
  | { kind: "option_cmd"; name: string; value: string | number; range?: SourceRange | undefined }
  | { kind: "solve_cmd"; range?: SourceRange | undefined }
  | { kind: "let_cmd"; indexing?: AmplIndexing | undefined; target: AmplExpr; value: AmplExpr; range?: SourceRange | undefined }
  | { kind: "fix_cmd"; indexing?: AmplIndexing | undefined; target: AmplExpr; value?: AmplExpr | undefined; range?: SourceRange | undefined }
  | { kind: "unfix_cmd"; indexing?: AmplIndexing | undefined; target: AmplExpr; range?: SourceRange | undefined }
  | { kind: "drop_cmd"; indexing?: AmplIndexing | undefined; target: AmplExpr; range?: SourceRange | undefined }
  | { kind: "restore_cmd"; indexing?: AmplIndexing | undefined; target: AmplExpr; range?: SourceRange | undefined }
  | { kind: "objective_cmd"; name: string; range?: SourceRange | undefined }
  | { kind: "problem_cmd"; name: string; range?: SourceRange | undefined }
  | { kind: "reset_cmd"; mode: "all" | "data"; targets?: string[] | undefined; range?: SourceRange | undefined }
  | { kind: "read_table_cmd"; name: string; range?: SourceRange | undefined }
  | { kind: "write_table_cmd"; name: string; range?: SourceRange | undefined }
  | { kind: "display_cmd"; indexing?: AmplIndexing | undefined; exprs: AmplExpr[]; range?: SourceRange | undefined }
  | { kind: "printf_cmd"; indexing?: AmplIndexing | undefined; format: string; args: AmplExpr[]; range?: SourceRange | undefined }
  | { kind: "for_cmd"; indexing: AmplIndexing; body: AmplStmt[]; range?: SourceRange | undefined }
  | { kind: "repeat_cmd"; condition?: AmplExpr | undefined; isUntil?: boolean | undefined; body: AmplStmt[]; range?: SourceRange | undefined }
  | { kind: "if_cmd"; condition: AmplExpr; thenBody: AmplStmt[]; elseBody?: AmplStmt[] | undefined; range?: SourceRange | undefined }
  | { kind: "break_cmd"; range?: SourceRange | undefined }
  | { kind: "continue_cmd"; range?: SourceRange | undefined };

export interface AmplModel {
  sets: Map<string, AmplSetDecl>;
  params: Map<string, AmplParamDecl>;
  vars: Map<string, AmplVarDecl>;
  objectives: Map<string, AmplObjectiveDecl>;
  constraints: Map<string, AmplConstraintDecl>;
  tables?: Map<string, AmplTableDecl> | undefined;
  checks?: AmplCheckDecl[] | undefined;
  statements?: AmplStmt[] | undefined;
  nodes?: Map<string, AmplNodeDecl> | undefined;
  arcs?: Map<string, AmplArcDecl> | undefined;
  functions?: Map<string, AmplFunctionDecl> | undefined;
  problems?: Map<string, AmplProblemDecl> | undefined;
  suffixes?: Map<string, AmplSuffixDecl> | undefined;
}

// ── Tabular Data AST (.dat) ──

export type SetElement = string | number | (string | number)[];

export interface AmplData {
  sets: Map<string, SetElement[]>;
  params: Map<string, Map<string, number | string>>; // key is serialized tuple e.g. "GARY,FRA"
}

// ── Flat Instantiated Optimization Problem ──

export type ProblemClass =
  | "LP"
  | "MILP"
  | "QP"
  | "MIQP"
  | "QCP"
  | "MIQCP"
  | "SOCP"
  | "MISOCP"
  | "NLP"
  | "MINLP";

export interface ConicConstraint {
  type: "SOC" | "RSOC"; // Standard second-order cone or Rotated second-order cone
  name: string;
  coneVarId: number; // t (for SOC) or u (for RSOC)
  rotVarId?: number | undefined; // v (for RSOC)
  coneMultiplier?: number | undefined; // multiplier for RSOC (e.g. 2 for 2*u*v)
  variables: { varId: number; coeff: number }[]; // x_i
  rhs?: number | undefined;
}

export interface FlatQuadraticTerm {
  var1Id: number;
  var2Id: number;
  coeff: number;
}

export interface InstantiatedVar {
  id: number;
  name: string; // e.g. "Trans[GARY,FRA]"
  baseName: string;
  indices: (string | number)[];
  type: AmplVarType;
  lb: number;
  ub: number;
  semiLb?: number | undefined;
  initVal: number;
  fixed?: boolean | undefined;
  sosno?: number | undefined; // > 0 => SOS1 group, < 0 => SOS2 group
  ref?: number | undefined;   // Reference weight in SOS group
  definedExpr?: FlatExpression | undefined;
  customSuffixes?: Map<string, number | string> | undefined;
}

export interface FlatAffineTerm {
  varId: number;
  coeff: number;
}

export interface FlatExpression {
  constant: number;
  linearTerms: FlatAffineTerm[];
  quadraticTerms?: FlatQuadraticTerm[] | undefined;
  nonlinearTree?: AmplExpr | undefined; // Non-affine components
}

export interface InstantiatedConstraint {
  id: number;
  name: string; // e.g. "Supply[GARY]"
  expr: FlatExpression;
  lb: number; // lower bound on expr
  ub: number; // upper bound on expr
  dropped?: boolean | undefined;
  complements?: {
    expr: FlatExpression;
    lb: number;
    ub: number;
  } | undefined;
  logicalExpr?: AmplExpr | undefined;
  customSuffixes?: Map<string, number | string> | undefined;
}

export interface InstantiatedObjective {
  name: string;
  direction: AmplObjectiveDirection;
  expr: FlatExpression;
}

export interface SosSet {
  id: number;
  type: 1 | 2; // 1 = SOS1, 2 = SOS2
  name: string;
  members: { varId: number; weight: number }[];
}

export interface InstantiatedProblem {
  name: string;
  problemClass: ProblemClass;
  variables: InstantiatedVar[];
  varNameMap: Map<string, number>;
  objective: InstantiatedObjective;
  objectives?: InstantiatedObjective[] | undefined;
  constraints: InstantiatedConstraint[];
  sosSets?: SosSet[] | undefined;
  cones?: ConicConstraint[] | undefined;
}

// ── Suffixes & Solver Result ──

export type BasisStatus = "basic" | "low" | "upp" | "super" | "fixed" | "none";

export interface VariableSuffixes {
  val: number;
  rc: number;       // Reduced cost: c_j - pi^T A_{*,j}
  lb: number;
  ub: number;
  init: number;
  relax: number;
  status: BasisStatus;
}

export interface ConstraintSuffixes {
  body: number;     // Evaluated constraint body
  dual: number;     // Shadow price / Lagrange multiplier
  slack: number;    // min(body - lb, ub - body)
  lb: number;
  ub: number;
  status: BasisStatus;
}

export interface PresolveStatistics {
  originalVars: number;
  originalConstraints: number;
  presolvedVars: number;
  presolvedConstraints: number;
  eliminatedVars: number;
  eliminatedConstraints: number;
}

export interface AmplSolverOptions {
  tolerance?: number | undefined;
  maxIterations?: number | undefined;
  printLevel?: number | undefined;
  presolve?: boolean | undefined;
  mpecMode?: "milp" | "nlp" | undefined;
  bigM?: number | undefined;
  solver?:
    | "auto"
    | "clp"
    | "cbc"
    | "ipopt"
    | "couenne"
    | "pure-js"
    | "cplex"
    | "highs"
    | "scip"
    | "gurobi"
    | "mosek"
    | undefined;
}

export interface AmplSolverResult {
  problemName: string;
  problemClass: ProblemClass;
  status: "OPTIMAL" | "INFEASIBLE" | "UNBOUNDED" | "ITERATION_LIMIT" | "ERROR";
  statusCode: number;
  message: string;
  objectiveValue: number;
  variables: Record<string, number>;
  duals?: Record<string, number> | undefined;
  slacks?: Record<string, number> | undefined;
  reducedCosts?: Record<string, number> | undefined;
  variableSuffixes?: Record<string, VariableSuffixes> | undefined;
  constraintSuffixes?: Record<string, ConstraintSuffixes> | undefined;
  presolveStats?: PresolveStatistics | undefined;
  iterations?: number | undefined;
  solveTimeMs?: number | undefined;
}
