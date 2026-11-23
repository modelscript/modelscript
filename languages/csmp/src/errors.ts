// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/csmp` (CSMP1001–CSMP5006).
 */

export const CsmpErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "CSMP1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Syntax error in CSMP/CSSL deck: ${detail}.`,
  },
  MISMATCHED_MACRO: {
    code: 1002,
    id: "CSMP1002",
    rule: "mismatched-macro",
    severity: "error" as const,
    message: (detail: string) => `Mismatched MACRO/ENDMAC block: ${detail}.`,
  },
  MISMATCHED_PROCEDURE: {
    code: 1003,
    id: "CSMP1003",
    rule: "mismatched-procedure",
    severity: "error" as const,
    message: (detail: string) => `Mismatched PROCEDURE/ENDPRO block: ${detail}.`,
  },
  DUPLICATE_DECLARATION: {
    code: 2001,
    id: "CSMP2001",
    rule: "duplicate-declaration",
    severity: "error" as const,
    message: (name: string, kind: string) => `Duplicate ${kind} declaration for '${name}'.`,
  },
  UNDEFINED_VARIABLE: {
    code: 2002,
    id: "CSMP2002",
    rule: "undefined-variable",
    severity: "error" as const,
    message: (name: string) => `Variable '${name}' is referenced before being declared or assigned.`,
  },
  ALGEBRAIC_LOOP: {
    code: 3001,
    id: "CSMP3001",
    rule: "algebraic-loop",
    severity: "error" as const,
    message: (cycle: string) => `Algebraic loop detected in SORT section involving variables: ${cycle}.`,
  },
  DUPLICATE_SORT_ASSIGNMENT: {
    code: 3002,
    id: "CSMP3002",
    rule: "duplicate-sort-assignment",
    severity: "error" as const,
    message: (name: string) => `Variable '${name}' is assigned more than once inside a SORT section.`,
  },
  INVALID_TIMER: {
    code: 4001,
    id: "CSMP4001",
    rule: "invalid-timer",
    severity: "error" as const,
    message: (detail: string) => `Invalid TIMER specification: ${detail}.`,
  },
  INVALID_METHOD: {
    code: 4002,
    id: "CSMP4002",
    rule: "invalid-method",
    severity: "error" as const,
    message: (name: string) =>
      `Invalid integration METHOD '${name}'. Expected one of RKS, RKSFX, RK4, ADAMS, MILNE, SIMP, TRAPZ, RECT, STIFF, CENTRL.`,
  },
  INVALID_INTGRL_ARITY: {
    code: 5001,
    id: "CSMP5001",
    rule: "invalid-intgrl-arity",
    severity: "error" as const,
    message: (target: string, argCount: number) =>
      `INTGRL call for '${target}' expects 2 arguments (initial condition, derivative), received ${argCount}.`,
  },
  INVALID_FUNCTION_TABLE: {
    code: 5002,
    id: "CSMP5002",
    rule: "invalid-function-table",
    severity: "error" as const,
    message: (name: string, detail: string) => `Invalid FUNCTION table '${name}': ${detail}.`,
  },
  MISSING_END: {
    code: 5003,
    id: "CSMP5003",
    rule: "missing-end",
    severity: "warning" as const,
    message: () => "CSMP/CSSL deck is missing a terminating END statement.",
  },
  INTGRL_OUTSIDE_DYNAMIC: {
    code: 5004,
    id: "CSMP5004",
    rule: "intgrl-outside-dynamic",
    severity: "error" as const,
    message: (target: string, section: string) =>
      `INTGRL block for '${target}' is not permitted in the ${section} section; move it to DYNAMIC.`,
  },
  UNUSED_PARAMETER: {
    code: 5005,
    id: "CSMP5005",
    rule: "unused-parameter",
    severity: "info" as const,
    message: (name: string) => `Declared parameter or constant '${name}' is never referenced.`,
  },
  UNKNOWN_FUNCTION: {
    code: 5006,
    id: "CSMP5006",
    rule: "unknown-function",
    severity: "warning" as const,
    message: (name: string) => `Unknown CSMP block or function '${name}'.`,
  },
} as const;

export type CsmpErrorCodeKey = keyof typeof CsmpErrorCode;
