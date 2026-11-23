// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/acsl` (ACSL1001–ACSL5006).
 */

export interface AcslDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  line?: number | undefined;
  column?: number | undefined;
  symbol?: string | undefined;
}

export const AcslErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "ACSL1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `ACSL syntax error: ${detail}.`,
  },
  MISMATCHED_END: {
    code: 1002,
    id: "ACSL1002",
    rule: "mismatched-end",
    severity: "error" as const,
    message: (section: string) => `Mismatched or missing END terminator for '${section}' section.`,
  },
  DUPLICATE_SYMBOL: {
    code: 2001,
    id: "ACSL2001",
    rule: "duplicate-symbol",
    severity: "error" as const,
    message: (name: string) => `Symbol '${name}' is already declared in this ACSL program.`,
  },
  UNDEFINED_VARIABLE: {
    code: 2002,
    id: "ACSL2002",
    rule: "undefined-variable",
    severity: "error" as const,
    message: (name: string) => `Undefined variable or parameter '${name}'.`,
  },
  INVALID_SECTION_PLACEMENT: {
    code: 3001,
    id: "ACSL3001",
    rule: "invalid-section-placement",
    severity: "error" as const,
    message: (section: string, parent: string) =>
      `Invalid section placement: '${section}' cannot appear inside '${parent}'.`,
  },
  UNINITIALIZED_INTEGRATOR: {
    code: 4001,
    id: "ACSL4001",
    rule: "uninitialized-integrator",
    severity: "error" as const,
    message: (stateVar: string) =>
      `Integrator for state '${stateVar}' is missing an initial condition argument in INTEG(...).`,
  },
  NON_POSITIVE_CINTERVAL: {
    code: 4002,
    id: "ACSL4002",
    rule: "non-positive-cinterval",
    severity: "error" as const,
    message: (val: number) => `CINTERVAL must be strictly positive, got ${val}.`,
  },
  NON_POSITIVE_MAXTERVAL: {
    code: 4003,
    id: "ACSL4003",
    rule: "non-positive-maxterval",
    severity: "error" as const,
    message: (val: number) => `MAXTERVAL must be strictly positive, got ${val}.`,
  },
  CYCLIC_ALGEBRAIC_LOOP: {
    code: 5001,
    id: "ACSL5001",
    rule: "cyclic-algebraic-loop",
    severity: "error" as const,
    message: (cycle: string) => `Cyclic algebraic loop detected in DERIVATIVE section: ${cycle}.`,
  },
  UNKNOWN_ALGORITHM: {
    code: 5002,
    id: "ACSL5002",
    rule: "unknown-algorithm",
    severity: "warning" as const,
    message: (ialg: number) => `Unsupported ACSL integration ALGORITHM code ${ialg} (expected 1..9).`,
  },
  INVALID_TERMT_CONDITION: {
    code: 5003,
    id: "ACSL5003",
    rule: "invalid-termt-condition",
    severity: "warning" as const,
    message: (reason: string) => `Invalid TERMT termination condition: ${reason}.`,
  },
  DUPLICATE_STATE_ASSIGNMENT: {
    code: 5004,
    id: "ACSL5004",
    rule: "duplicate-state-assignment",
    severity: "error" as const,
    message: (stateVar: string) => `State variable '${stateVar}' is assigned multiple times in DERIVATIVE.`,
  },
  TABLE_DIMENSION_MISMATCH: {
    code: 5005,
    id: "ACSL5005",
    rule: "table-dimension-mismatch",
    severity: "error" as const,
    message: (name: string, bpLen: number, valLen: number) =>
      `TABLE '${name}' has ${bpLen} breakpoints but ${valLen} values.`,
  },
  SCHEDULE_MISSING_TARGET: {
    code: 5006,
    id: "ACSL5006",
    rule: "schedule-missing-target",
    severity: "error" as const,
    message: (target: string) => `SCHEDULE references undefined DISCRETE block '${target}'.`,
  },
} as const;
