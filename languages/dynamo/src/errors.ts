// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for @modelscript/dynamo (DYN1001–DYN5006).
 *
 * Numbering scheme:
 * - DYN1xxx: Syntax & Parsing
 * - DYN2xxx: Symbol Resolution & Declarations
 * - DYN3xxx: Time Subscript & Type Checking
 * - DYN4xxx: Structural & Simulation Specification
 * - DYN5xxx: Equation Graph & Causality
 */

export const DynamoErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "DYN1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `DYNAMO syntax error: ${detail}.`,
  },
  UNDEFINED_SYMBOL: {
    code: 2001,
    id: "DYN2001",
    rule: "undefined-symbol",
    severity: "error" as const,
    message: (name: string) => `Undefined DYNAMO symbol '${name}'.`,
  },
  DUPLICATE_EQUATION: {
    code: 2002,
    id: "DYN2002",
    rule: "duplicate-equation",
    severity: "error" as const,
    message: (name: string, kind: string) => `Duplicate equation definition for '${name}' (kind '${kind}').`,
  },
  INVALID_TIME_SUBSCRIPT: {
    code: 3001,
    id: "DYN3001",
    rule: "invalid-time-subscript",
    severity: "error" as const,
    message: (name: string, kind: string, subscript: string, expected: string) =>
      `Invalid time subscript '.${subscript}' on '${name}' in '${kind}' equation (expected ${expected}).`,
  },
  MISSING_LEVEL_INITIAL: {
    code: 4001,
    id: "DYN4001",
    rule: "missing-level-initial",
    severity: "error" as const,
    message: (name: string) => `Level variable '${name}' is missing a corresponding initial value ('N') equation.`,
  },
  NON_POSITIVE_SPEC: {
    code: 4002,
    id: "DYN4002",
    rule: "non-positive-spec",
    severity: "error" as const,
    message: (param: string, value: number) => `Simulation SPEC parameter '${param}' must be positive (got ${value}).`,
  },
  SIMULTANEOUS_AUXILIARY_CYCLE: {
    code: 5006,
    id: "DYN5006",
    rule: "simultaneous-auxiliary-cycle",
    severity: "error" as const,
    message: (cycle: string) => `Simultaneous algebraic cycle detected among auxiliary equations: ${cycle}.`,
  },
} as const;

export type DynamoErrorCodeKey = keyof typeof DynamoErrorCode;
