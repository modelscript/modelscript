// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes (LP1001–LP5006) for @modelscript/cplex-lp.
 */

import type { SourceLocation } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface CplexLpDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  location?: SourceLocation | undefined;
  symbol?: string | undefined;
}

export const CplexLpErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "LP1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Syntax error in CPLEX LP / LINDO model: ${detail}.`,
  },
  MISSING_OBJECTIVE: {
    code: 2001,
    id: "LP2001",
    rule: "missing-objective",
    severity: "error" as const,
    message: () => "Missing objective section ('Minimize' or 'Maximize').",
  },
  MISSING_END: {
    code: 2002,
    id: "LP2002",
    rule: "missing-end",
    severity: "warning" as const,
    message: () => "Missing 'End' section terminator at the end of the LP file.",
  },
  DUPLICATE_CONSTRAINT_NAME: {
    code: 3001,
    id: "LP3001",
    rule: "duplicate-constraint-name",
    severity: "error" as const,
    message: (name: string) => `Duplicate constraint name '${name}'.`,
  },
  CONTRADICTORY_BOUNDS: {
    code: 4001,
    id: "LP4001",
    rule: "contradictory-bounds",
    severity: "error" as const,
    message: (variable: string, lower: number, upper: number) =>
      `Contradictory bounds for variable '${variable}': lower bound (${lower}) exceeds upper bound (${upper}).`,
  },
  BINARY_AND_FREE_CONFLICT: {
    code: 4002,
    id: "LP4002",
    rule: "binary-and-free-conflict",
    severity: "error" as const,
    message: (variable: string) => `Variable '${variable}' is declared both binary and free, which is contradictory.`,
  },
  EMPTY_CONSTRAINT: {
    code: 5001,
    id: "LP5001",
    rule: "empty-constraint",
    severity: "warning" as const,
    message: (name: string) => `Constraint '${name}' contains no variable terms (empty or unbounded constraint).`,
  },
  INVALID_SOS_WEIGHTS: {
    code: 5002,
    id: "LP5002",
    rule: "invalid-sos-weights",
    severity: "error" as const,
    message: (sosName: string, reason: string) => `Invalid SOS weights in '${sosName}': ${reason}.`,
  },
  INVALID_SOS_TYPE: {
    code: 5003,
    id: "LP5003",
    rule: "invalid-sos-type",
    severity: "error" as const,
    message: (sosName: string, type: string) => `Invalid SOS type '${type}' in '${sosName}' (expected 'S1' or 'S2').`,
  },
  BINARY_BOUND_CONFLICT: {
    code: 5004,
    id: "LP5004",
    rule: "binary-bound-conflict",
    severity: "warning" as const,
    message: (variable: string, lower: number, upper: number) =>
      `Binary variable '${variable}' has explicit bounds [${lower}, ${upper}] outside [0, 1].`,
  },
  SEMI_CONTINUOUS_BOUND_CONFLICT: {
    code: 5005,
    id: "LP5005",
    rule: "semi-continuous-bound-conflict",
    severity: "error" as const,
    message: (variable: string, lower: number) =>
      `Semi-continuous variable '${variable}' has negative lower bound (${lower}); lower bound must be >= 0.`,
  },
  UNREFERENCED_VARIABLE_DECLARATION: {
    code: 5006,
    id: "LP5006",
    rule: "unreferenced-variable-declaration",
    severity: "info" as const,
    message: (variable: string, section: string) =>
      `Variable '${variable}' declared in '${section}' is not referenced in the objective or constraints.`,
  },
} as const;
