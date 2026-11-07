// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/csv — Measurement & Telemetry CSV Diagnostic Error Codes (CSV1001–CSV1007).
 */

export const CsvErrorCode = {
  CSV_UNCLOSED_QUOTE: {
    code: "CSV1001",
    rule: "csv-unclosed-quote",
    severity: "error" as const,
    message: (location: string) => `Unclosed quoted string ${location}.`,
  },
  CSV_EMPTY_HEADER: {
    code: "CSV1002",
    rule: "csv-empty-header",
    severity: "error" as const,
    message: (colIdx: number) => `Header column ${colIdx} is empty.`,
  },
  CSV_DUPLICATE_HEADER: {
    code: "CSV1003",
    rule: "csv-duplicate-header",
    severity: "error" as const,
    message: (header: string, prevCol: number) =>
      `Duplicate header column '${header}' (already defined at column ${prevCol}).`,
  },
  CSV_MIXED_DELIMITER: {
    code: "CSV1004",
    rule: "csv-mixed-delimiter",
    severity: "error" as const,
    message: (alt: string, row: number, col: number, expected: string) =>
      `Mixed delimiter ${alt} found in row ${row}, column ${col}; expected primary delimiter ${expected}.`,
  },
  CSV_COLUMN_COUNT_MISMATCH: {
    code: "CSV1005",
    rule: "csv-column-count-mismatch",
    severity: "error" as const,
    message: (row: number, actual: number, expected: number) =>
      `Row ${row} has ${actual} columns, expected ${expected} to match header row.`,
  },
  CSV_INVALID_NUMERIC_CELL: {
    code: "CSV1006",
    rule: "csv-invalid-numeric-cell",
    severity: "error" as const,
    message: (val: string, colName: string, row: number) =>
      `Invalid numeric value '${val}' in column '${colName}' at row ${row}.`,
  },
  CSV_NON_MONOTONIC_TIME: {
    code: "CSV1007",
    rule: "csv-non-monotonic-time",
    severity: "warning" as const,
    message: (timeVal: number, row: number, prevVal: number) =>
      `Non-monotonic time value ${timeVal} at row ${row} (previous time was ${prevVal}).`,
  },
} as const;

export type CsvErrorCodeKey = keyof typeof CsvErrorCode;
