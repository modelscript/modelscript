// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for the MIT DYNAMO System Dynamics language.
 *
 * Represents Level (L), Rate (R), Auxiliary (A), Initial (N), Constant (C),
 * Table (T), Supplementary (S), and simulation control statements
 * (NOTE, SPEC, PRINT, PLOT, RUN).
 */

export type DynamoEquationKind = "L" | "R" | "A" | "N" | "C" | "T" | "S";

export type DynamoTimeSubscript = "K" | "J" | "JK" | "KL";

export type DynamoBinaryOp = "+" | "-" | "*" | "/" | "^";

export type DynamoExpr =
  | { kind: "number"; value: number }
  | { kind: "var"; name: string; subscript?: DynamoTimeSubscript | undefined }
  | { kind: "unary"; op: "+" | "-"; operand: DynamoExpr }
  | { kind: "binary"; op: DynamoBinaryOp; left: DynamoExpr; right: DynamoExpr }
  | { kind: "call"; name: string; args: DynamoExpr[] };

export interface DynamoSourceSpan {
  line: number; // 1-based line number
  column: number; // 1-based column number
  startOffset: number;
  endOffset: number;
}

export interface DynamoEquation {
  kind: DynamoEquationKind;
  name: string;
  subscript?: DynamoTimeSubscript | undefined;
  expr?: DynamoExpr | undefined;
  /** Numeric table values for 'T' (Table) equations, e.g. T TAB=0/0.5/1.0 */
  tableValues?: number[] | undefined;
  /** Raw right-hand side source text for diagnostics and hover */
  rawRhs: string;
  span: DynamoSourceSpan;
}

export interface DynamoNote {
  text: string;
  span: DynamoSourceSpan;
}

export interface DynamoSpec {
  dt?: number | undefined;
  length?: number | undefined;
  prtper?: number | undefined;
  pltper?: number | undefined;
  extra: Record<string, number>;
  span?: DynamoSourceSpan | undefined;
}

export interface DynamoPrintDirective {
  variables: string[];
  raw: string;
  span: DynamoSourceSpan;
}

export interface DynamoPlotEntry {
  variable: string;
  symbol?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
}

export interface DynamoPlotDirective {
  entries: DynamoPlotEntry[];
  raw: string;
  span: DynamoSourceSpan;
}

export interface DynamoRunDirective {
  name?: string | undefined;
  span: DynamoSourceSpan;
}

export interface DynamoParseError {
  message: string;
  span: DynamoSourceSpan;
}

export interface DynamoModel {
  name: string;
  equations: DynamoEquation[];
  notes: DynamoNote[];
  spec: DynamoSpec;
  prints: DynamoPrintDirective[];
  plots: DynamoPlotDirective[];
  runs: DynamoRunDirective[];
  errors: DynamoParseError[];
}
