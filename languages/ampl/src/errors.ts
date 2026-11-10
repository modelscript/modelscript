// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Pre-flight Diagnostic Error Definitions.
 *
 * Diagnostic codes M9501 - M9510 for AMPL models and datasets.
 */

import type { SourceRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: SourceRange | undefined;
}

export const AmplErrorCode = {
  SYNTAX_ERROR: {
    code: 9501,
    rule: "syntax-error",
    severity: "error" as DiagnosticSeverity,
    message: (detail: string) => `Syntax error in AMPL source: ${detail}.`,
  },
  UNDECLARED_SET: {
    code: 9502,
    rule: "undeclared-set",
    severity: "error" as DiagnosticSeverity,
    message: (setName: string) => `Reference to undeclared set '${setName}'.`,
  },
  UNDECLARED_PARAM: {
    code: 9503,
    rule: "undeclared-param",
    severity: "error" as DiagnosticSeverity,
    message: (paramName: string) => `Reference to undeclared parameter '${paramName}'.`,
  },
  UNDECLARED_VAR: {
    code: 9504,
    rule: "undeclared-var",
    severity: "error" as DiagnosticSeverity,
    message: (varName: string) => `Reference to undeclared variable '${varName}'.`,
  },
  DIMENSION_MISMATCH: {
    code: 9505,
    rule: "dimension-mismatch",
    severity: "error" as DiagnosticSeverity,
    message: (name: string, expected: number, actual: number) =>
      `Dimension mismatch for '${name}': expected ${expected} indices, but found ${actual}.`,
  },
  BOUNDS_CONFLICT: {
    code: 9506,
    rule: "bounds-conflict",
    severity: "error" as DiagnosticSeverity,
    message: (name: string, lb: number, ub: number) =>
      `Variable or constraint '${name}' specifies conflicting bounds: lower bound (${lb}) exceeds upper bound (${ub}).`,
  },
  DIVISION_BY_ZERO: {
    code: 9507,
    rule: "division-by-zero",
    severity: "error" as DiagnosticSeverity,
    message: (context: string) => `Division by zero detected in expression '${context}'.`,
  },
  NONLINEAR_INTEGER_CONSTRAINT: {
    code: 9508,
    rule: "nonlinear-integer-constraint",
    severity: "warning" as DiagnosticSeverity,
    message: (conName: string, varName: string) =>
      `Constraint '${conName}' contains nonlinear terms with integer/binary variable '${varName}'. Global solver (Couenne/Bonmin) required.`,
  },
  EMPTY_INDEX_SET: {
    code: 9509,
    rule: "empty-index-set",
    severity: "warning" as DiagnosticSeverity,
    message: (setName: string, context: string) =>
      `Index set '${setName}' is empty during instantiation of '${context}'.`,
  },
  DUPLICATE_DECLARATION: {
    code: 9510,
    rule: "duplicate-declaration",
    severity: "error" as DiagnosticSeverity,
    message: (kind: string, name: string) =>
      `Duplicate declaration of ${kind} '${name}'.`,
  },
  SET_ARITY_MISMATCH: {
    code: 9511,
    rule: "set-arity-mismatch",
    severity: "error" as DiagnosticSeverity,
    message: (setName: string, expected: number, actual: number) =>
      `Set '${setName}' declared with dimen ${expected} contains member tuple with arity ${actual}.`,
  },
  SUBSET_RELATION_VIOLATION: {
    code: 9512,
    rule: "subset-relation-violation",
    severity: "error" as DiagnosticSeverity,
    message: (setName: string, parentSet: string, member: string) =>
      `Set '${setName}' member '${member}' is not in parent set '${parentSet}' required by 'within' clause.`,
  },
};
