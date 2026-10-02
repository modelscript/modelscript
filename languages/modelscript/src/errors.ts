// SPDX-License-Identifier: AGPL-3.0-or-later

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface ModelScriptDiagnostic {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

export interface ErrorCodeDef {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: (...args: string[]) => string;
}

/**
 * Central registry of all ModelScript diagnostic error codes.
 *
 * Numbering Scheme:
 *   1xxx: Syntax & Parsing
 *   2xxx: Scope & Name Resolution
 *   3xxx: Type System & Assignments
 *   4xxx: FLWOR & Queries
 *   5xxx: Functions & Struct Contracts
 */
export const ModelScriptErrorCode = {
  // ── 1xxx: Syntax & Parse ───────────────────────────────────────────────────
  PARSE_ERROR: {
    code: 1001,
    rule: "parse-error",
    severity: "error",
    message: () => "Parse error.",
  },

  // ── 2xxx: Scope & Name Resolution ──────────────────────────────────────────
  UNDEFINED_VARIABLE: {
    code: 2001,
    rule: "undefined-variable",
    severity: "error",
    message: (name: string) => `Variable '${name}' is not declared in current scope.`,
  },
  DUPLICATE_DECLARATION: {
    code: 2002,
    rule: "duplicate-declaration",
    severity: "error",
    message: (name: string) => `Identifier '${name}' is already declared in this scope.`,
  },
  UNKNOWN_TYPE: {
    code: 2003,
    rule: "unknown-type",
    severity: "error",
    message: (typeName: string) => `Type '${typeName}' is not recognized.`,
  },

  // ── 3xxx: Type System & Assignments ────────────────────────────────────────
  TYPE_MISMATCH: {
    code: 3001,
    rule: "type-mismatch",
    severity: "error",
    message: (targetType: string, sourceType: string) =>
      `Type mismatch: cannot assign '${sourceType}' to '${targetType}'.`,
  },
  INVALID_BINARY_OPERAND: {
    code: 3002,
    rule: "invalid-binary-operand",
    severity: "error",
    message: (op: string, type: string) => `Operator '${op}' cannot be applied to operands of type '${type}'.`,
  },

  // ── 4xxx: FLWOR & Queries ──────────────────────────────────────────────────
  NON_ITERABLE_COLLECTION: {
    code: 4001,
    rule: "non-iterable-collection",
    severity: "error",
    message: (expr: string) => `Expression '${expr}' in 'for' clause is not iterable.`,
  },
  FLWOR_UNBOUND_VARIABLE: {
    code: 4002,
    rule: "flwor-unbound-variable",
    severity: "error",
    message: (varName: string) =>
      `Variable '${varName}' in FLWOR clause is not bound in preceding 'for' or 'let' clauses.`,
  },

  // ── 5xxx: Functions & Structs ──────────────────────────────────────────────
  ARGUMENT_COUNT_MISMATCH: {
    code: 5001,
    rule: "argument-count-mismatch",
    severity: "error",
    message: (fnName: string, expected: string, actual: string) =>
      `Function '${fnName}' expects ${expected} arguments, but got ${actual}.`,
  },
  UNKNOWN_STRUCT_FIELD: {
    code: 5002,
    rule: "unknown-struct-field",
    severity: "error",
    message: (structName: string, fieldName: string) => `Struct '${structName}' has no field named '${fieldName}'.`,
  },
} as const satisfies Record<string, ErrorCodeDef>;
