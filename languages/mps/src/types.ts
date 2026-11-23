// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mps — Core Types for IBM MPS (Mathematical Programming System) Format.
 */

export type MpsObjectiveSense = "MIN" | "MAX";

export type MpsRowType = "N" | "L" | "G" | "E";

export type MpsBoundType = "LO" | "UP" | "FX" | "FR" | "MI" | "PL" | "BV" | "LI" | "UI";

export type MpsVarType = "continuous" | "integer" | "binary";

export type MpsProblemClass = "LP" | "MILP" | "QP" | "MIQP";

export type MpsFormatMode = "auto" | "fixed" | "free";

export interface MpsSourceSpan {
  /** 1-indexed line number. */
  line: number;
  /** 1-indexed start column. */
  column: number;
  /** 0-indexed byte/char start offset in source. */
  startOffset: number;
  /** 0-indexed byte/char end offset in source. */
  endOffset: number;
}

export interface MpsRow {
  name: string;
  type: MpsRowType;
  rhs: number;
  range?: number | undefined;
  span?: MpsSourceSpan | undefined;
}

export interface MpsMatrixEntry {
  rowName: string;
  coeff: number;
  span?: MpsSourceSpan | undefined;
}

export interface MpsColumn {
  name: string;
  varType: MpsVarType;
  lb: number;
  ub: number;
  entries: MpsMatrixEntry[];
  span?: MpsSourceSpan | undefined;
}

export interface MpsBoundDirective {
  boundType: string;
  boundSetName: string;
  columnName: string;
  value?: number | undefined;
  span?: MpsSourceSpan | undefined;
}

export interface MpsQuadTerm {
  col1: string;
  col2: string;
  /** Symmetric Hessian coefficient Q_{ij} in (1/2) x^T Q x. */
  coeff: number;
  span?: MpsSourceSpan | undefined;
}

export interface MpsParseIssue {
  kind:
    | "syntax-error"
    | "duplicate-row"
    | "invalid-row-type"
    | "undefined-row-columns"
    | "undefined-row-rhs"
    | "undefined-row-ranges"
    | "undefined-col-bounds"
    | "undefined-col-quadobj"
    | "invalid-bound-type"
    | "duplicate-column-entry"
    | "range-on-objective";
  message: string;
  symbol?: string | undefined;
  span?: MpsSourceSpan | undefined;
}

export interface MpsModel {
  name: string;
  sense: MpsObjectiveSense;
  objectiveRow?: string | undefined;
  /** Detected or requested format of the parsed source. */
  format: "fixed" | "free";
  problemClass: MpsProblemClass;
  /** Ordered map of row name -> MpsRow. */
  rows: Map<string, MpsRow>;
  /** Ordered map of column name -> MpsColumn. */
  columns: Map<string, MpsColumn>;
  /** Raw bound directives preserved for auditing & linting. */
  bounds: MpsBoundDirective[];
  /** Quadratic objective terms from QUADOBJ or QMATRIX sections. */
  quadObj: MpsQuadTerm[];
  /** Structural header presence flags for linting. */
  hasNameCard: boolean;
  hasRowsSection: boolean;
  hasEndataCard: boolean;
  unclosedIntorgLine?: number | undefined;
  /** Active RHS vector name (first encountered). */
  rhsName?: string | undefined;
  /** Active RANGES vector name (first encountered). */
  rangesName?: string | undefined;
  /** Active BOUNDS vector name (first encountered). */
  boundsName?: string | undefined;
  /** Parse-time structural issues forwarded to linter. */
  parseIssues: MpsParseIssue[];
}

export interface MpsParseOptions {
  /** Override problem name when NAME card is omitted. */
  defaultName?: string | undefined;
  /** Format parsing mode: "auto" (default), "fixed" (80-column IBM cards), or "free". */
  format?: MpsFormatMode | undefined;
  /** Objective sense override if OBJSENSE card is not present. Default: "MIN". */
  defaultSense?: MpsObjectiveSense | undefined;
}

export interface MpsWriteOptions {
  /** Emit strict 80-column fixed IBM MPS format when true, or aligned free format when false (default). */
  fixedFormat?: boolean | undefined;
  /** Include OBJSENSE card (default: true). */
  includeObjSense?: boolean | undefined;
  /** Override problem name. */
  name?: string | undefined;
}

export type MpsSolveStatus = "optimal" | "infeasible" | "unbounded" | "iteration_limit" | "node_limit";

export interface MpsSolveResult {
  status: MpsSolveStatus;
  objectiveValue: number;
  /** Primal variable values keyed by column name. */
  primal: Record<string, number>;
  /** Dual / shadow prices keyed by constraint row name (LP only). */
  dual: Record<string, number>;
  /** Reduced costs keyed by column name (LP only). */
  reducedCosts: Record<string, number>;
  iterations: number;
  /** Branch-and-bound nodes explored (MIP only). */
  nodesExplored?: number | undefined;
  /** Relative optimality gap (MIP only). */
  mipGap?: number | undefined;
  /** Presolve summary if presolve was applied. */
  presolve?: MpsPresolveStats | undefined;
}

export interface MpsPresolveStats {
  fixedVarsEliminated: number;
  emptyRowsEliminated: number;
  emptyColsEliminated: number;
  singletonRowsEliminated: number;
  objectiveOffset: number;
}
