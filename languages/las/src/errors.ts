// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/las — Well-Log ASCII Standard (LAS 1.2 / 2.0 / 3.0) Diagnostic Error Codes (LAS1001–LAS1007).
 */

export const LasErrorCode = {
  LAS_MISSING_VERSION: {
    code: "LAS1001",
    rule: "las-missing-version",
    severity: "error" as const,
    message: () => "Missing ~V (Version Information) section or VERS entry in LAS file.",
  },
  LAS_MISSING_CURVES: {
    code: "LAS1002",
    rule: "las-missing-curves",
    severity: "error" as const,
    message: () => "Missing or empty ~C (Curve Information) section in LAS file.",
  },
  LAS_MISSING_ASCII_DATA: {
    code: "LAS1003",
    rule: "las-missing-ascii-data",
    severity: "error" as const,
    message: () => "Missing ~A (ASCII Log Data) section in LAS file.",
  },
  LAS_COLUMN_COUNT_MISMATCH: {
    code: "LAS1004",
    rule: "las-column-count-mismatch",
    severity: "error" as const,
    message: (row: number, actual: number, expected: number) =>
      `Data record ${row} has ${actual} values, expected ${expected} to match ~C curve definitions.`,
  },
  LAS_INVALID_NUMERIC_VALUE: {
    code: "LAS1005",
    rule: "las-invalid-numeric-value",
    severity: "error" as const,
    message: (val: string, curve: string, row: number) =>
      `Invalid numeric value '${val}' for curve '${curve}' at data record ${row}.`,
  },
  LAS_DUPLICATE_CURVE: {
    code: "LAS1006",
    rule: "las-duplicate-curve",
    severity: "error" as const,
    message: (mnemonic: string, prevLine: number) =>
      `Duplicate curve mnemonic '${mnemonic}' in ~C section (already defined on line ${prevLine}).`,
  },
  LAS_NON_MONOTONIC_INDEX: {
    code: "LAS1007",
    rule: "las-non-monotonic-index",
    severity: "warning" as const,
    message: (val: number, row: number, prevVal: number) =>
      `Non-monotonic index value ${val} at record ${row} (previous value was ${prevVal}).`,
  },
} as const;

export type LasErrorCodeKey = keyof typeof LasErrorCode;
