// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Diagnostic Error Code Catalog (GAMS1001–GAMS5006).
 */

import type { SourceSpan } from "./types.js";

export type GamsDiagnosticSeverity = "error" | "warning" | "info";

export interface GamsDiagnostic {
  id: string;
  code: number;
  rule: string;
  severity: GamsDiagnosticSeverity;
  message: string;
  line: number;
  column: number;
  endLine?: number | undefined;
  endColumn?: number | undefined;
  symbol?: string | undefined;
  span?: SourceSpan | undefined;
}

export const GamsErrorCode = {
  SYNTAX_ERROR: {
    id: "GAMS1001",
    code: 1001,
    rule: "syntax-error",
    severity: "error" as GamsDiagnosticSeverity,
    message: (detail: string) => `Syntax error in GAMS source: ${detail}.`,
  },
  DUPLICATE_SYMBOL: {
    id: "GAMS2001",
    code: 2001,
    rule: "duplicate-symbol",
    severity: "error" as GamsDiagnosticSeverity,
    message: (kind: string, name: string) => `Duplicate declaration of ${kind} '${name}'.`,
  },
  UNDEFINED_SET: {
    id: "GAMS2002",
    code: 2002,
    rule: "undefined-set",
    severity: "error" as GamsDiagnosticSeverity,
    message: (setName: string) => `Reference to undefined set '${setName}'.`,
  },
  UNDEFINED_PARAMETER: {
    id: "GAMS2003",
    code: 2003,
    rule: "undefined-parameter",
    severity: "error" as GamsDiagnosticSeverity,
    message: (paramName: string) => `Reference to undefined parameter '${paramName}'.`,
  },
  UNDEFINED_VARIABLE: {
    id: "GAMS2004",
    code: 2004,
    rule: "undefined-variable",
    severity: "error" as GamsDiagnosticSeverity,
    message: (varName: string) => `Reference to undefined variable '${varName}'.`,
  },
  DOMAIN_INDEX_MISMATCH: {
    id: "GAMS3001",
    code: 3001,
    rule: "domain-index-mismatch",
    severity: "error" as GamsDiagnosticSeverity,
    message: (name: string, expected: number, actual: number) =>
      `Domain index mismatch for '${name}': expected ${expected} index(es), but found ${actual}.`,
  },
  UNDECLARED_EQUATION_IN_MODEL: {
    id: "GAMS4001",
    code: 4001,
    rule: "undeclared-equation-in-model",
    severity: "error" as GamsDiagnosticSeverity,
    message: (eqName: string, modelName: string) =>
      `Undeclared equation '${eqName}' referenced in Model '${modelName}'.`,
  },
  MISSING_OBJECTIVE_VARIABLE: {
    id: "GAMS4002",
    code: 4002,
    rule: "missing-objective-variable",
    severity: "error" as GamsDiagnosticSeverity,
    message: (varName: string, modelName: string) =>
      `Objective variable '${varName}' in Solve statement for model '${modelName}' is missing or undeclared.`,
  },
  INVALID_SOLVER_TYPE: {
    id: "GAMS4003",
    code: 4003,
    rule: "invalid-solver-type",
    severity: "error" as GamsDiagnosticSeverity,
    message: (solverType: string) =>
      `Invalid GAMS solver type '${solverType}'. Expected one of: lp, mip, nlp, rmip, qcp, miqcp, minlp, cns, mcp.`,
  },
  CONFLICTING_BOUNDS: {
    id: "GAMS5001",
    code: 5001,
    rule: "conflicting-bounds",
    severity: "error" as GamsDiagnosticSeverity,
    message: (varName: string, lb: number, ub: number) =>
      `Variable '${varName}' has conflicting bounds: lower bound (${lb}) exceeds upper bound (${ub}).`,
  },
  EMPTY_SET: {
    id: "GAMS5002",
    code: 5002,
    rule: "empty-set",
    severity: "warning" as GamsDiagnosticSeverity,
    message: (setName: string) => `Set '${setName}' has no elements.`,
  },
  EQUATION_NOT_DEFINED: {
    id: "GAMS5003",
    code: 5003,
    rule: "equation-not-defined",
    severity: "warning" as GamsDiagnosticSeverity,
    message: (eqName: string) => `Equation '${eqName}' is declared but has no '..' definition.`,
  },
  OBJECTIVE_VAR_NON_FREE: {
    id: "GAMS5004",
    code: 5004,
    rule: "objective-var-non-free",
    severity: "warning" as GamsDiagnosticSeverity,
    message: (varName: string, varKind: string) =>
      `Objective variable '${varName}' is declared as '${varKind}'; GAMS requires a free scalar variable for the objective.`,
  },
  NONLINEAR_IN_LINEAR_SOLVE: {
    id: "GAMS5005",
    code: 5005,
    rule: "nonlinear-in-linear-solve",
    severity: "warning" as GamsDiagnosticSeverity,
    message: (eqName: string, solverType: string) =>
      `Equation '${eqName}' appears nonlinear for '${solverType.toUpperCase()}' solve.`,
  },
  UNDECLARED_MODEL_IN_SOLVE: {
    id: "GAMS5006",
    code: 5006,
    rule: "undeclared-model-in-solve",
    severity: "error" as GamsDiagnosticSeverity,
    message: (modelName: string) => `Solve statement references undeclared model '${modelName}'.`,
  },
} as const;

export const VALID_GAMS_SOLVER_TYPES = new Set(["lp", "mip", "nlp", "rmip", "qcp", "miqcp", "minlp", "cns", "mcp"]);
