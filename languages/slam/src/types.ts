// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data model and intermediate representation types for SLAM II
 * (Simulation Language for Alternative Modeling, Pritsker & Pegden 1979).
 */

export interface SourceSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface SlamGenStatement {
  analyst: string;
  project: string;
  date?: string | undefined;
  runs: number;
  span: SourceSpan;
}

export interface SlamLimitsStatement {
  mfil: number;
  matr: number;
  mnentries: number;
  span: SourceSpan;
}

export interface SlamContinuousStatement {
  nnequations: number; // NNEQD: number of differential equations
  nnstates: number; // NNEQS: number of state (algebraic) equations
  dtmin: number;
  dtmax: number;
  dtsav: number;
  warningFlag?: string | undefined;
  aaerr?: number | undefined;
  rrerr?: number | undefined;
  span: SourceSpan;
}

export interface SlamInitializeStatement {
  ttbeg: number;
  ttfin: number;
  span: SourceSpan;
}

export interface SlamIntlcAssignment {
  target: string; // e.g., "SS(1)", "XX(1)", "DD(1)"
  kind: "SS" | "DD" | "XX" | "ATRIB" | "VAR";
  index?: number | undefined;
  valueExpr: string;
  numericValue?: number | undefined;
  span: SourceSpan;
}

export type SlamExprNode =
  | { kind: "number"; value: number }
  | { kind: "state"; array: "SS" | "DD" | "XX" | "ATRIB"; index: number }
  | { kind: "ident"; name: string }
  | { kind: "unary"; op: "-" | "+"; operand: SlamExprNode }
  | { kind: "binary"; op: "+" | "-" | "*" | "/" | "^"; left: SlamExprNode; right: SlamExprNode }
  | { kind: "call"; callee: string; args: SlamExprNode[] };

export interface SlamStateEquation {
  lhsKind: "DD" | "SS";
  index: number;
  rhsText: string;
  rhsExpr: SlamExprNode;
  span: SourceSpan;
}

export type SlamNodeType =
  | "CREATE"
  | "QUEUE"
  | "ACTIVITY"
  | "ASSIGN"
  | "AWAIT"
  | "FREE"
  | "RESOURCE"
  | "GATE"
  | "OPEN"
  | "CLOSE"
  | "COLCT"
  | "DETECT"
  | "TERMINATE";

export type SlamCrossingDirection = "XP" | "XN" | "X" | "P" | "N" | "POSITIVE" | "NEGATIVE" | "EITHER";

export interface SlamAssignmentPair {
  lhs: string;
  rhsText: string;
  rhsExpr: SlamExprNode;
}

export interface SlamNetworkNode {
  id: string;
  label?: string | undefined;
  type: SlamNodeType;
  args: string[];
  /** Explicit target node label (e.g. from ACTIVITY/branch routing) */
  targetLabel?: string | undefined;
  /** Resource name for RESOURCE / AWAIT / FREE */
  resourceName?: string | undefined;
  /** Resource capacity (RESOURCE) or units requested/freed (AWAIT/FREE) */
  resourceUnits?: number | undefined;
  /** Gate name for GATE / OPEN / CLOSE */
  gateName?: string | undefined;
  /** Initial gate status for GATE */
  gateInitialOpen?: boolean | undefined;
  /** Queue file number for QUEUE / AWAIT / RESOURCE / GATE */
  fileNumber?: number | undefined;
  /** Queue initial count and capacity */
  initialCount?: number | undefined;
  capacity?: number | undefined;
  /** CREATE parameters */
  interarrivalExpr?: string | undefined;
  firstCreation?: number | undefined;
  markAttribute?: number | undefined;
  maxCreations?: number | undefined;
  /** ACTIVITY parameters */
  activityIndex?: number | undefined;
  durationExpr?: string | undefined;
  conditionOrProb?: string | undefined;
  probability?: number | undefined;
  /** ASSIGN pairs */
  assignments?: SlamAssignmentPair[] | undefined;
  /** COLCT parameters */
  collectVar?: string | undefined;
  collectId?: string | undefined;
  /** DETECT parameters */
  detectVar?: string | undefined;
  detectDirection?: string | undefined;
  detectThreshold?: number | undefined;
  detectTolerance?: number | undefined;
  /** TERMINATE count */
  terminateCount?: number | undefined;
  /** Branch limit M */
  maxBranches?: number | undefined;
  span: SourceSpan;
}

export interface SlamSyntaxError {
  message: string;
  span: SourceSpan;
}

export interface SlamModel {
  name: string;
  gen?: SlamGenStatement | undefined;
  limits?: SlamLimitsStatement | undefined;
  continuous?: SlamContinuousStatement | undefined;
  initialize?: SlamInitializeStatement | undefined;
  intlc: SlamIntlcAssignment[];
  stateEquations: SlamStateEquation[];
  hasNetwork: boolean;
  hasEndNetwork: boolean;
  hasFin: boolean;
  networkSpan?: SourceSpan | undefined;
  endNetworkSpan?: SourceSpan | undefined;
  nodes: SlamNetworkNode[];
  resources: Map<string, SlamNetworkNode>;
  gates: Map<string, SlamNetworkNode>;
  labels: Map<string, SlamNetworkNode>;
  syntaxErrors: SlamSyntaxError[];
}
