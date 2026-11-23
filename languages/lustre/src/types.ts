// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core AST, clock calculus, and model types for `@modelscript/lustre`.
 */

export interface LustreSpan {
  startOffset: number;
  endOffset: number;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export type LustreBaseType = "bool" | "int" | "real";

export type LustreType =
  | { kind: "base"; name: LustreBaseType }
  | { kind: "named"; name: string }
  | { kind: "array"; element: LustreType; size: number };

export type LustreClock = { kind: "base" } | { kind: "on"; clockVar: string; negated: boolean; parent: LustreClock };

export type LustreUnaryOp = "not" | "-" | "pre" | "current";

export type LustreBinaryOp =
  | "->"
  | "when"
  | "+"
  | "-"
  | "*"
  | "/"
  | "div"
  | "mod"
  | "and"
  | "or"
  | "xor"
  | "=>"
  | "="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">=";

export type LustreExpr =
  | { kind: "bool"; value: boolean; span: LustreSpan }
  | { kind: "int"; value: number; span: LustreSpan }
  | { kind: "real"; value: number; span: LustreSpan }
  | { kind: "var"; name: string; span: LustreSpan }
  | { kind: "unary"; op: LustreUnaryOp; operand: LustreExpr; span: LustreSpan }
  | { kind: "binary"; op: LustreBinaryOp; left: LustreExpr; right: LustreExpr; span: LustreSpan }
  | { kind: "if"; cond: LustreExpr; thenExpr: LustreExpr; elseExpr: LustreExpr; span: LustreSpan }
  | { kind: "merge"; clockVar: string; trueExpr: LustreExpr; falseExpr: LustreExpr; span: LustreSpan }
  | { kind: "call"; callee: string; args: LustreExpr[]; span: LustreSpan }
  | { kind: "tuple"; elements: LustreExpr[]; span: LustreSpan }
  | { kind: "array"; elements: LustreExpr[]; span: LustreSpan }
  | { kind: "index"; array: LustreExpr; index: LustreExpr; span: LustreSpan };

export interface LustreConstDecl {
  name: string;
  type?: LustreType | undefined;
  value?: LustreExpr | undefined;
  span: LustreSpan;
}

export interface LustreTypeDecl {
  name: string;
  alias?: LustreType | undefined;
  span: LustreSpan;
}

export interface LustreVarDecl {
  name: string;
  type: LustreType;
  clock: LustreClock;
  role: "input" | "output" | "local";
  span: LustreSpan;
}

export interface LustreEquation {
  lhs: string[];
  rhs: LustreExpr;
  span: LustreSpan;
}

export interface LustreAssertion {
  expr: LustreExpr;
  span: LustreSpan;
}

export interface LustreNodeDecl {
  kind: "node" | "function";
  name: string;
  inputs: LustreVarDecl[];
  outputs: LustreVarDecl[];
  locals: LustreVarDecl[];
  equations: LustreEquation[];
  assertions: LustreAssertion[];
  span: LustreSpan;
}

export interface LustreSyntaxError {
  message: string;
  span: LustreSpan;
}

export interface LustreProgram {
  consts: LustreConstDecl[];
  types: LustreTypeDecl[];
  nodes: LustreNodeDecl[];
  syntaxErrors: LustreSyntaxError[];
  source: string;
}

export type LustreScalarValue = boolean | number;
export type LustreRuntimeValue = LustreScalarValue | undefined;
