// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for IBM CSMP/360 & SCi CSSL-67 continuous simulation models.
 */

export type CsmpSectionKind = "INITIAL" | "DYNAMIC" | "TERMINAL";

export type CsmpSortMode = "SORT" | "NOSORT";

export type CsmpMethodName =
  "RKS" | "RKSFX" | "RK4" | "ADAMS" | "MILNE" | "SIMP" | "TRAPZ" | "RECT" | "STIFF" | "CENTRL";

export interface CsmpSpan {
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export type CsmpExpr =
  | { kind: "number"; value: number; span?: CsmpSpan }
  | { kind: "ident"; name: string; span?: CsmpSpan }
  | { kind: "unary"; op: "+" | "-"; operand: CsmpExpr; span?: CsmpSpan }
  | { kind: "binary"; op: "+" | "-" | "*" | "/" | "**"; left: CsmpExpr; right: CsmpExpr; span?: CsmpSpan }
  | { kind: "call"; callee: string; args: CsmpExpr[]; span?: CsmpSpan };

export interface CsmpAssignment {
  target: string;
  expr: CsmpExpr;
  rawExpr: string;
  section: CsmpSectionKind;
  sortMode: CsmpSortMode;
  span: CsmpSpan;
}

export interface CsmpDataDecl {
  kind: "PARAM" | "CONST" | "INCON";
  name: string;
  value: number;
  values?: number[] | undefined;
  span: CsmpSpan;
}

export interface CsmpFunctionTable {
  name: string;
  points: Array<{ x: number; y: number }>;
  rawValues: number[];
  span: CsmpSpan;
}

export interface CsmpMacroDef {
  name: string;
  outputs: string[];
  inputs: string[];
  body: CsmpAssignment[];
  closed: boolean;
  span: CsmpSpan;
}

export interface CsmpProcedureDef {
  outputs: string[];
  inputs: string[];
  body: CsmpAssignment[];
  closed: boolean;
  section: CsmpSectionKind;
  span: CsmpSpan;
}

export interface CsmpTimerConfig {
  fintim?: number | undefined;
  delt?: number | undefined;
  prdel?: number | undefined;
  outdel?: number | undefined;
  delmin?: number | undefined;
  delmax?: number | undefined;
  raw: Record<string, number>;
  span?: CsmpSpan | undefined;
}

export interface CsmpParseError {
  code: string;
  message: string;
  span: CsmpSpan;
}

export interface CsmpProgram {
  title: string;
  parameters: Map<string, CsmpDataDecl>;
  constants: Map<string, CsmpDataDecl>;
  incons: Map<string, CsmpDataDecl>;
  allDataDecls: CsmpDataDecl[];
  fixedVars: Set<string>;
  functionTables: Map<string, CsmpFunctionTable>;
  macros: Map<string, CsmpMacroDef>;
  procedures: CsmpProcedureDef[];
  initialStatements: CsmpAssignment[];
  dynamicStatements: CsmpAssignment[];
  terminalStatements: CsmpAssignment[];
  timer: CsmpTimerConfig;
  method?: string | undefined;
  methodSpan?: CsmpSpan | undefined;
  printVars: string[];
  prtpltVars: string[];
  hasEnd: boolean;
  hasStop: boolean;
  errors: CsmpParseError[];
}
