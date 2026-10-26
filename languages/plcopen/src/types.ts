// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plcopen — Domain types for IEC 61131-3 PLCopen XML and Structured Text (ST).
 *
 * Implements the data model defined by PLCopen TC6 XML v2.01/v2.02 and IEC 61131-3 3rd Edition.
 */

export interface PlcRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type PlcDiagnosticSeverity = "error" | "warning" | "info";

export interface PlcDiagnostic {
  code: string;
  severity: PlcDiagnosticSeverity;
  message: string;
  range: PlcRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Project & Header Structures
// ─────────────────────────────────────────────────────────────────────────────

export interface PlcFileHeader {
  companyName?: string | undefined;
  productName?: string | undefined;
  productVersion?: string | undefined;
  creationDateTime?: string | undefined;
}

export interface PlcContentHeader {
  name: string;
  version?: string | undefined;
  modificationDateTime?: string | undefined;
  organization?: string | undefined;
  author?: string | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Types
// ─────────────────────────────────────────────────────────────────────────────

export type PlcDataTypeKind = "simple" | "enum" | "struct" | "array" | "subrange";

export interface PlcStructMember {
  name: string;
  dataType: string;
  initialValue?: string | number | boolean | undefined;
}

export interface PlcDataType {
  name: string;
  kind: PlcDataTypeKind;
  baseType?: string | undefined;
  enumValues?: string[] | undefined;
  structMembers?: PlcStructMember[] | undefined;
  arrayDimension?: string | undefined;
  initialValue?: string | number | boolean | undefined;
  range?: PlcRange | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Variables & Declarations
// ─────────────────────────────────────────────────────────────────────────────

export type PlcVariableScope = "input" | "output" | "inOut" | "local" | "temp" | "global" | "external";

export interface PlcVariable {
  name: string;
  scope: PlcVariableScope;
  dataType: string;
  initialValue?: string | number | boolean | undefined;
  address?: string | undefined; // e.g. "%IX0.0", "%QX0.0", "%MW100"
  isConstant?: boolean | undefined;
  isRetain?: boolean | undefined;
  range: PlcRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured Text (ST) Expressions
// ─────────────────────────────────────────────────────────────────────────────

export type PlcBinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "MOD"
  | "**"
  | "="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">="
  | "AND"
  | "OR"
  | "XOR";

export type PlcUnaryOp = "-" | "+" | "NOT";

export type PlcLiteralType = "bool" | "number" | "string" | "time";

export interface PlcLiteralExpr {
  kind: "literal";
  literalType: PlcLiteralType;
  value: number | boolean | string;
  raw: string;
  range: PlcRange;
}

export interface PlcIdentifierExpr {
  kind: "identifier";
  name: string;
  range: PlcRange;
}

export interface PlcBinaryExpr {
  kind: "binary";
  op: PlcBinaryOp;
  left: PlcExpr;
  right: PlcExpr;
  range: PlcRange;
}

export interface PlcUnaryExpr {
  kind: "unary";
  op: PlcUnaryOp;
  argument: PlcExpr;
  range: PlcRange;
}

export interface PlcMemberExpr {
  kind: "member";
  object: PlcExpr;
  property: string;
  range: PlcRange;
}

export interface PlcIndexExpr {
  kind: "index";
  array: PlcExpr;
  indices: PlcExpr[];
  range: PlcRange;
}

export interface PlcCallArg {
  name?: string | undefined;
  direction: "in" | "out"; // in: ":=", out: "=>"
  expr: PlcExpr;
}

export interface PlcCallExpr {
  kind: "call";
  callee: string;
  args: PlcCallArg[];
  range: PlcRange;
}

export type PlcExpr =
  | PlcLiteralExpr
  | PlcIdentifierExpr
  | PlcBinaryExpr
  | PlcUnaryExpr
  | PlcMemberExpr
  | PlcIndexExpr
  | PlcCallExpr;

// ─────────────────────────────────────────────────────────────────────────────
// Structured Text (ST) Statements
// ─────────────────────────────────────────────────────────────────────────────

export interface PlcAssignmentStmt {
  kind: "assignment";
  target: PlcExpr;
  value: PlcExpr;
  range: PlcRange;
}

export interface PlcIfBranch {
  condition: PlcExpr;
  statements: PlcStatement[];
}

export interface PlcIfStmt {
  kind: "if";
  condition: PlcExpr;
  thenStatements: PlcStatement[];
  elsifs: PlcIfBranch[];
  elseStatements: PlcStatement[];
  range: PlcRange;
}

export interface PlcCaseBranch {
  values: (number | string)[];
  statements: PlcStatement[];
}

export interface PlcCaseStmt {
  kind: "case";
  selector: PlcExpr;
  cases: PlcCaseBranch[];
  elseStatements: PlcStatement[];
  range: PlcRange;
}

export interface PlcForStmt {
  kind: "for";
  variable: string;
  start: PlcExpr;
  end: PlcExpr;
  step?: PlcExpr | undefined;
  statements: PlcStatement[];
  range: PlcRange;
}

export interface PlcWhileStmt {
  kind: "while";
  condition: PlcExpr;
  statements: PlcStatement[];
  range: PlcRange;
}

export interface PlcRepeatStmt {
  kind: "repeat";
  condition: PlcExpr;
  statements: PlcStatement[];
  range: PlcRange;
}

export interface PlcCallStmt {
  kind: "call";
  callee: string;
  args: PlcCallArg[];
  range: PlcRange;
}

export interface PlcReturnStmt {
  kind: "return";
  range: PlcRange;
}

export interface PlcExitStmt {
  kind: "exit";
  range: PlcRange;
}

export interface PlcEmptyStmt {
  kind: "empty";
  range: PlcRange;
}

export type PlcStatement =
  | PlcAssignmentStmt
  | PlcIfStmt
  | PlcCaseStmt
  | PlcForStmt
  | PlcWhileStmt
  | PlcRepeatStmt
  | PlcCallStmt
  | PlcReturnStmt
  | PlcExitStmt
  | PlcEmptyStmt;

export interface StBody {
  statements: PlcStatement[];
  rawSource?: string | undefined;
}

export interface PlcBody {
  kind: "ST" | "FBD" | "SFC" | "LD" | "IL";
  st?: StBody | undefined;
  raw?: string | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Program Organization Units (POUs)
// ─────────────────────────────────────────────────────────────────────────────

export type PlcPouType = "program" | "functionBlock" | "function";

export interface PlcPou {
  name: string;
  pouType: PlcPouType;
  returnType?: string | undefined; // For functions
  variables: PlcVariable[];
  body: PlcBody;
  range: PlcRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configurations, Resources & Tasks
// ─────────────────────────────────────────────────────────────────────────────

export interface PlcTask {
  name: string;
  priority: number;
  interval?: string | undefined; // e.g. "T#20ms", "t#10ms"
  intervalMs?: number | undefined;
  single?: string | undefined;
  range?: PlcRange | undefined;
}

export interface PlcPouInstance {
  name: string;
  typeName: string;
  taskName?: string | undefined;
  range?: PlcRange | undefined;
}

export interface PlcResource {
  name: string;
  tasks: PlcTask[];
  globalVars: PlcVariable[];
  instances: PlcPouInstance[];
  range?: PlcRange | undefined;
}

export interface PlcConfiguration {
  name: string;
  resources: PlcResource[];
  globalVars: PlcVariable[];
  range?: PlcRange | undefined;
}

export interface PlcProject {
  fileHeader?: PlcFileHeader | undefined;
  contentHeader?: PlcContentHeader | undefined;
  dataTypes: PlcDataType[];
  pous: PlcPou[];
  configurations: PlcConfiguration[];
  sourceFile?: string | undefined;
}
