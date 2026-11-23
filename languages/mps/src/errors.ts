// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mps — Diagnostic Error Code Catalog (MPS1001–MPS5006).
 *
 * Numbering scheme:
 * - MPS1xxx: Parser / Structural card syntax
 * - MPS2xxx: Name resolution (rows & columns)
 * - MPS3xxx: Type & card code validation
 * - MPS4xxx: Bound & marker consistency
 * - MPS5xxx: Mathematical formulation & semantic checks
 */

export const MpsErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "MPS1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `MPS card syntax error: ${detail}.`,
  },
  MISSING_NAME: {
    code: 1002,
    id: "MPS1002",
    rule: "missing-name",
    severity: "error" as const,
    message: () => "Missing required 'NAME' header card at start of MPS deck.",
  },
  MISSING_ROWS: {
    code: 1003,
    id: "MPS1003",
    rule: "missing-rows",
    severity: "error" as const,
    message: () => "Missing required 'ROWS' section in MPS deck.",
  },
  MISSING_ENDATA: {
    code: 1004,
    id: "MPS1004",
    rule: "missing-endata",
    severity: "error" as const,
    message: () => "Missing required 'ENDATA' terminator card at end of MPS deck.",
  },
  DUPLICATE_ROW: {
    code: 2001,
    id: "MPS2001",
    rule: "duplicate-row",
    severity: "error" as const,
    message: (rowName: string) => `Duplicate row name '${rowName}' declared in ROWS section.`,
  },
  UNDEFINED_ROW_IN_COLUMNS: {
    code: 2002,
    id: "MPS2002",
    rule: "undefined-row-in-columns",
    severity: "error" as const,
    message: (rowName: string, colName: string) =>
      `Row '${rowName}' referenced in COLUMNS for variable '${colName}' is not declared in ROWS.`,
  },
  UNDEFINED_ROW_IN_RHS: {
    code: 2003,
    id: "MPS2003",
    rule: "undefined-row-in-rhs",
    severity: "error" as const,
    message: (rowName: string) => `Row '${rowName}' referenced in RHS section is not declared in ROWS.`,
  },
  UNDEFINED_ROW_IN_RANGES: {
    code: 2004,
    id: "MPS2004",
    rule: "undefined-row-in-ranges",
    severity: "error" as const,
    message: (rowName: string) => `Row '${rowName}' referenced in RANGES section is not declared in ROWS.`,
  },
  UNDEFINED_COLUMN_IN_BOUNDS: {
    code: 2005,
    id: "MPS2005",
    rule: "undefined-column-in-bounds",
    severity: "error" as const,
    message: (colName: string) => `Column '${colName}' referenced in BOUNDS section is not declared in COLUMNS.`,
  },
  UNDEFINED_COLUMN_IN_QUADOBJ: {
    code: 2006,
    id: "MPS2006",
    rule: "undefined-column-in-quadobj",
    severity: "error" as const,
    message: (colName: string) =>
      `Column '${colName}' referenced in QUADOBJ/QMATRIX section is not declared in COLUMNS.`,
  },
  INVALID_BOUND_TYPE: {
    code: 3001,
    id: "MPS3001",
    rule: "invalid-bound-type",
    severity: "error" as const,
    message: (boundType: string) =>
      `Invalid bound type '${boundType}' in BOUNDS section (expected LO, UP, FX, FR, MI, PL, BV, LI, or UI).`,
  },
  INVALID_ROW_TYPE: {
    code: 3002,
    id: "MPS3002",
    rule: "invalid-row-type",
    severity: "error" as const,
    message: (rowType: string) => `Invalid row type '${rowType}' in ROWS section (expected N, L, G, or E).`,
  },
  CONTRADICTORY_BOUNDS: {
    code: 4001,
    id: "MPS4001",
    rule: "contradictory-bounds",
    severity: "error" as const,
    message: (colName: string, lb: number, ub: number) =>
      `Contradictory bounds on column '${colName}': lower bound (${lb}) exceeds upper bound (${ub}).`,
  },
  UNMATCHED_INTEGER_MARKER: {
    code: 4002,
    id: "MPS4002",
    rule: "unmatched-integer-marker",
    severity: "warning" as const,
    message: () => "Unclosed 'INTORG' integer marker in COLUMNS section without a matching 'INTEND' marker.",
  },
  MISSING_OBJECTIVE_ROW: {
    code: 5001,
    id: "MPS5001",
    rule: "missing-objective-row",
    severity: "warning" as const,
    message: () => "No objective ('N') row declared in ROWS section.",
  },
  EMPTY_PROBLEM: {
    code: 5002,
    id: "MPS5002",
    rule: "empty-problem",
    severity: "warning" as const,
    message: () => "MPS problem contains no decision variables in COLUMNS section.",
  },
  EMPTY_CONSTRAINT_ROW: {
    code: 5003,
    id: "MPS5003",
    rule: "empty-constraint-row",
    severity: "info" as const,
    message: (rowName: string) => `Constraint row '${rowName}' has no non-zero coefficients in COLUMNS.`,
  },
  FREE_VARIABLE_IN_MIP: {
    code: 5004,
    id: "MPS5004",
    rule: "free-variable-in-mip",
    severity: "warning" as const,
    message: (colName: string) => `Integer variable '${colName}' has unbounded lower or upper limit.`,
  },
  DUPLICATE_COLUMN_ENTRY: {
    code: 5005,
    id: "MPS5005",
    rule: "duplicate-column-entry",
    severity: "warning" as const,
    message: (colName: string, rowName: string) =>
      `Duplicate matrix entry for column '${colName}' in row '${rowName}'; values are accumulated.`,
  },
  RANGE_ON_OBJECTIVE_ROW: {
    code: 5006,
    id: "MPS5006",
    rule: "range-on-objective-row",
    severity: "warning" as const,
    message: (rowName: string) => `RANGES entry applied to non-constraining ('N') row '${rowName}' has no effect.`,
  },
} as const;

export type MpsErrorKey = keyof typeof MpsErrorCode;
