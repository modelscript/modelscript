// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for `@modelscript/twentysim` (20-sim `.emx`, `.emxz`, and SIDOPS `.sid`).
 */

export type TwentySimSourceKind = "emx" | "emxz" | "sidops";

export type TwentySimPortKind = "power" | "signal" | "unknown";
export type TwentySimPortDirection = "in" | "out" | "inout";
export type TwentySimDomain =
  "mechanical-translation" | "mechanical-rotation" | "electrical" | "hydraulic" | "thermal" | "magnetic" | "general";

export type BondGraphElementKind =
  "0" | "1" | "R" | "C" | "I" | "Se" | "Sf" | "MSe" | "MSf" | "TF" | "GY" | "MTF" | "MGY" | "Signal" | "Submodel";

/**
 * Causal stroke assignment on a power bond:
 * - `"effort-to-target"`: causal stroke is at the target end (source imposes effort, target imposes flow)
 * - `"effort-to-source"`: causal stroke is at the source end (target imposes effort, source imposes flow)
 * - `"unassigned"`: causality has not yet been assigned
 * - `"conflict"`: causality conflict detected by SCAP
 */
export type BondCausality = "effort-to-target" | "effort-to-source" | "unassigned" | "conflict";

export interface TwentySimPort {
  name: string;
  kind: TwentySimPortKind;
  direction: TwentySimPortDirection;
  effortVar?: string | undefined;
  flowVar?: string | undefined;
  domain?: TwentySimDomain | undefined;
  restriction?: "effort" | "flow" | "none" | undefined;
  dimension?: number | undefined;
  line?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface TwentySimParameter {
  name: string;
  type: "real" | "integer" | "boolean" | "string";
  value?: number | boolean | string | undefined;
  expr?: SidopsExpr | undefined;
  unit?: string | undefined;
  description?: string | undefined;
  isConstant?: boolean | undefined;
  line?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface TwentySimVariable {
  name: string;
  type: "real" | "integer" | "boolean" | "string";
  qualifier?: "global" | "hidden" | "interesting" | "local" | undefined;
  initialValue?: number | undefined;
  unit?: string | undefined;
  line?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export type SidopsExpr =
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "string"; value: string }
  | { kind: "ident"; name: string }
  | { kind: "member"; object: string; field: string }
  | { kind: "unary"; op: "+" | "-" | "not"; operand: SidopsExpr }
  | {
      kind: "binary";
      op: "+" | "-" | "*" | "/" | "^" | "==" | "<>" | "<" | "<=" | ">" | ">=" | "and" | "or";
      left: SidopsExpr;
      right: SidopsExpr;
    }
  | { kind: "call"; callee: string; args: SidopsExpr[] }
  | { kind: "if"; condition: SidopsExpr; thenExpr: SidopsExpr; elseExpr: SidopsExpr };

export interface SidopsEquation {
  lhs: SidopsExpr;
  rhs: SidopsExpr;
  isInitial?: boolean | undefined;
  rawText?: string | undefined;
  line?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface TwentySimPosition {
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
}

export interface TwentySimSubmodel {
  name: string;
  elementKind: BondGraphElementKind;
  typeName?: string | undefined;
  description?: string | undefined;
  ports: TwentySimPort[];
  parameters: TwentySimParameter[];
  variables: TwentySimVariable[];
  initialEquations: SidopsEquation[];
  equations: SidopsEquation[];
  submodels: TwentySimSubmodel[];
  connections: TwentySimConnection[];
  rawSidops?: string | undefined;
  position?: TwentySimPosition | undefined;
  initialValues?: Record<string, number> | undefined;
  line?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface TwentySimConnection {
  id: string;
  kind: "bond" | "signal";
  fromSubmodel: string;
  fromPort: string;
  toSubmodel: string;
  toPort: string;
  causality?: BondCausality | undefined;
  waypoints?: Array<{ x: number; y: number }> | undefined;
  line?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface TwentySimExperiment {
  startTime: number;
  finishTime: number;
  stepSize: number;
  method?: string | undefined;
}

export interface TwentySimParseIssue {
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface TwentySimModel {
  name: string;
  sourceKind: TwentySimSourceKind;
  version?: string | undefined;
  root: TwentySimSubmodel;
  experiment?: TwentySimExperiment | undefined;
  globalVariables?: string[] | undefined;
  parseIssues: TwentySimParseIssue[];
}
