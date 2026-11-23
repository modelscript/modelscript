// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/netcdf — Diagnostic Error Codes (`NC1001`–`NC5006`).
 *
 * Numbering scheme:
 * - `NC1xxx`: CDL syntax, binary magic header & framing
 * - `NC2xxx`: Symbol resolution & duplicate declarations
 * - `NC3xxx`: Dimension sizing & NetCDF Classic UNLIMITED rules
 * - `NC4xxx`: Data section shape & assignment consistency
 * - `NC5xxx`: CF-1.x metadata conventions & fill-value / scaling integrity
 */

export interface NetcdfErrorDefinition {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: (...args: string[]) => string;
}

export const NetcdfErrorCode = {
  // 1xxx — Syntax & Binary Magic
  SYNTAX_ERROR: {
    code: "NC1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `CDL syntax error: ${detail}.`,
  },
  INVALID_MAGIC_HEADER: {
    code: "NC1002",
    rule: "invalid-magic-header",
    severity: "error" as const,
    message: (found: string) =>
      `Invalid NetCDF binary magic header '${found}'; expected 'CDF\\x01' (Classic) or 'CDF\\x02' (64-bit offset).`,
  },
  TRUNCATED_BINARY_STREAM: {
    code: "NC1003",
    rule: "truncated-binary-stream",
    severity: "error" as const,
    message: (detail: string) => `Truncated or corrupted NetCDF Classic binary stream: ${detail}.`,
  },

  // 2xxx — Duplicates & Undefined Symbols
  DUPLICATE_DIMENSION: {
    code: "NC2001",
    rule: "duplicate-dimension",
    severity: "error" as const,
    message: (dimName: string) => `Duplicate dimension declaration '${dimName}'.`,
  },
  DUPLICATE_VARIABLE: {
    code: "NC2002",
    rule: "duplicate-variable",
    severity: "error" as const,
    message: (varName: string) => `Duplicate variable declaration '${varName}'.`,
  },
  DUPLICATE_ATTRIBUTE: {
    code: "NC2003",
    rule: "duplicate-attribute",
    severity: "error" as const,
    message: (target: string, attrName: string) => `Duplicate attribute '${attrName}' on '${target}'.`,
  },
  UNDEFINED_DIMENSION: {
    code: "NC2004",
    rule: "undefined-dimension",
    severity: "error" as const,
    message: (varName: string, dimName: string) => `Variable '${varName}' references undefined dimension '${dimName}'.`,
  },

  // 3xxx — Dimension Sizing & Classic UNLIMITED Rules
  NON_POSITIVE_DIMENSION: {
    code: "NC3001",
    rule: "non-positive-dimension",
    severity: "error" as const,
    message: (dimName: string, size: string) =>
      `Fixed dimension '${dimName}' must have a positive integer size (got '${size}').`,
  },
  MULTIPLE_UNLIMITED_DIMENSIONS: {
    code: "NC3002",
    rule: "multiple-unlimited-dimensions",
    severity: "error" as const,
    message: (dimName: string) =>
      `NetCDF Classic format allows at most one UNLIMITED dimension; extra UNLIMITED dimension '${dimName}' declared.`,
  },
  UNLIMITED_NOT_LEADING: {
    code: "NC3003",
    rule: "unlimited-not-leading",
    severity: "error" as const,
    message: (varName: string, dimName: string) =>
      `UNLIMITED dimension '${dimName}' must be the first (outermost) dimension of variable '${varName}' in NetCDF Classic format.`,
  },

  // 4xxx — Data Section Consistency
  DATA_COUNT_MISMATCH: {
    code: "NC4001",
    rule: "data-count-mismatch",
    severity: "error" as const,
    message: (varName: string, actual: string, expected: string) =>
      `Data value count mismatch for variable '${varName}': found ${actual} values, expected ${expected} based on declared shape.`,
  },
  UNDEFINED_DATA_VARIABLE: {
    code: "NC4002",
    rule: "undefined-data-variable",
    severity: "error" as const,
    message: (varName: string) => `Data section assigns values to undeclared variable '${varName}'.`,
  },

  // 5xxx — CF-1.x Conventions & Fill Value / Scaling Integrity
  MISSING_UNITS_ATTRIBUTE: {
    code: "NC5001",
    rule: "missing-units-attribute",
    severity: "warning" as const,
    message: (varName: string) =>
      `CF-1.x convention warning: numeric variable '${varName}' is missing a 'units' attribute.`,
  },
  MISSING_LONG_NAME: {
    code: "NC5002",
    rule: "missing-long-name",
    severity: "warning" as const,
    message: (varName: string) =>
      `CF-1.x convention warning: variable '${varName}' is missing both 'long_name' and 'standard_name' attributes.`,
  },
  MISSING_CONVENTIONS_ATTR: {
    code: "NC5003",
    rule: "missing-conventions-attr",
    severity: "info" as const,
    message: (datasetName: string) =>
      `Dataset '${datasetName}' does not declare a global ':Conventions' attribute (e.g., "CF-1.8").`,
  },
  NAN_INF_FILL_VALUE_MISMATCH: {
    code: "NC5004",
    rule: "nan-inf-fill-value-mismatch",
    severity: "warning" as const,
    message: (varName: string, count: string) =>
      `Variable '${varName}' contains ${count} non-finite (NaN/Inf) value(s) without a matching non-finite '_FillValue' attribute.`,
  },
  FILL_VALUE_TYPE_MISMATCH: {
    code: "NC5005",
    rule: "fill-value-type-mismatch",
    severity: "error" as const,
    message: (varName: string, fillType: string, varType: string) =>
      `Attribute '_FillValue' on variable '${varName}' has type '${fillType}', which does not match variable type '${varType}'.`,
  },
  SCALE_OFFSET_INVALID: {
    code: "NC5006",
    rule: "scale-offset-invalid",
    severity: "error" as const,
    message: (varName: string, attrName: string, val: string) =>
      `Invalid '${attrName}' value '${val}' on variable '${varName}'; must be a finite non-zero number.`,
  },
} as const satisfies Record<string, NetcdfErrorDefinition>;

export type NetcdfErrorKey = keyof typeof NetcdfErrorCode;
