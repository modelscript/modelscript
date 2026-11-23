// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — Diagnostic Error Codes (`NCDF1001`–`NCDF5006`).
 *
 * Numbering scheme:
 * - `NCDF1xxx`: Syntax, magic number & binary record framing
 * - `NCDF2xxx`: Mandatory skeleton sections (`#header`, `#end`) & duplicates
 * - `NCDF3xxx`: CDF data types & array dimension consistency
 * - `NCDF4xxx`: ISTP/SPDF metadata compliance (`DEPEND_0`, `UNITS`, `VALIDMIN`/`VALIDMAX`)
 * - `NCDF5xxx`: Physical bounds, epoch monotonicity, fill values & record integrity
 */

export interface NasaCdfErrorDefinition {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: (...args: string[]) => string;
}

export const NasaCdfErrorCode = {
  // 1xxx — Syntax, magic number & binary record framing
  SYNTAX_ERROR: {
    code: "NCDF1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `NASA CDF skeleton syntax error: ${detail}.`,
  },
  INVALID_MAGIC_NUMBER: {
    code: "NCDF1002",
    rule: "invalid-magic-number",
    severity: "error" as const,
    message: (actualHex: string) =>
      `Invalid binary CDF magic header '0x${actualHex}'; expected CDF v3 (0xCDF30001) or CDF v2 (0xCDF26002).`,
  },
  CORRUPT_RECORD_STRUCTURE: {
    code: "NCDF1003",
    rule: "corrupt-record-structure",
    severity: "error" as const,
    message: (recordKind: string, detail: string) => `Corrupt binary CDF '${recordKind}' record structure: ${detail}.`,
  },

  // 2xxx — Mandatory skeleton sections & duplicates
  MISSING_HEADER_SECTION: {
    code: "NCDF2001",
    rule: "missing-header-section",
    severity: "error" as const,
    message: () => "NASA CDF skeleton table is missing the mandatory '#header' section.",
  },
  MISSING_END_SECTION: {
    code: "NCDF2002",
    rule: "missing-end-section",
    severity: "error" as const,
    message: () => "NASA CDF skeleton table is missing the mandatory '#end' terminator.",
  },
  DUPLICATE_VARIABLE: {
    code: "NCDF2003",
    rule: "duplicate-variable",
    severity: "error" as const,
    message: (varName: string) => `Duplicate CDF variable '${varName}' declared in '#variables'.`,
  },
  DUPLICATE_ATTRIBUTE: {
    code: "NCDF2004",
    rule: "duplicate-attribute",
    severity: "error" as const,
    message: (scope: string, attrName: string) => `Duplicate ${scope} attribute '${attrName}' declared.`,
  },

  // 3xxx — CDF data types & dimensions
  INVALID_CDF_DATA_TYPE: {
    code: "NCDF3001",
    rule: "invalid-cdf-data-type",
    severity: "error" as const,
    message: (typeName: string, owner: string) => `Invalid CDF data type '${typeName}' on '${owner}'.`,
  },
  DIMENSION_MISMATCH: {
    code: "NCDF3002",
    rule: "dimension-mismatch",
    severity: "error" as const,
    message: (varName: string, detail: string) =>
      `Dimension specification mismatch on variable '${varName}': ${detail}.`,
  },

  // 4xxx — ISTP/SPDF metadata compliance
  ISTP_MISSING_DEPEND_0: {
    code: "NCDF4001",
    rule: "istp-missing-depend-0",
    severity: "warning" as const,
    message: (varName: string) =>
      `ISTP data variable '${varName}' is missing the required 'DEPEND_0' attribute referencing a time variable.`,
  },
  ISTP_MISSING_UNITS: {
    code: "NCDF4002",
    rule: "istp-missing-units",
    severity: "warning" as const,
    message: (varName: string) => `ISTP data variable '${varName}' is missing the required 'UNITS' attribute.`,
  },
  ISTP_MISSING_VALID_BOUNDS: {
    code: "NCDF4003",
    rule: "istp-missing-valid-bounds",
    severity: "warning" as const,
    message: (varName: string, missingAttr: string) =>
      `ISTP data variable '${varName}' is missing the '${missingAttr}' attribute.`,
  },
  ISTP_INVALID_DEPEND_0_TARGET: {
    code: "NCDF4004",
    rule: "istp-invalid-depend-0-target",
    severity: "error" as const,
    message: (varName: string, target: string, reason: string) =>
      `Variable '${varName}' has invalid 'DEPEND_0' target '${target}': ${reason}.`,
  },

  // 5xxx — Physical bounds, epoch monotonicity & records
  INVALID_VALID_BOUNDS: {
    code: "NCDF5001",
    rule: "invalid-valid-bounds",
    severity: "error" as const,
    message: (varName: string, minVal: string, maxVal: string) =>
      `Variable '${varName}' has invalid range bounds: VALIDMIN (${minVal}) > VALIDMAX (${maxVal}).`,
  },
  VALUE_OUT_OF_VALID_RANGE: {
    code: "NCDF5002",
    rule: "value-out-of-valid-range",
    severity: "warning" as const,
    message: (varName: string, recordIdx: string, value: string, minVal: string, maxVal: string) =>
      `Variable '${varName}' sample at record ${recordIdx} (${value}) is outside [VALIDMIN=${minVal}, VALIDMAX=${maxVal}].`,
  },
  NON_MONOTONIC_EPOCH: {
    code: "NCDF5003",
    rule: "non-monotonic-epoch",
    severity: "error" as const,
    message: (varName: string, recordIdx: string, prevVal: string, currVal: string) =>
      `Time variable '${varName}' is not monotonically increasing at record ${recordIdx} (${currVal} <= ${prevVal}).`,
  },
  MISSING_ISTP_GLOBAL_ATTRIBUTES: {
    code: "NCDF5004",
    rule: "missing-istp-global-attributes",
    severity: "info" as const,
    message: (missingList: string) => `Recommended ISTP/SPDF global attributes are missing: ${missingList}.`,
  },
  FILLVAL_IN_VALID_RANGE: {
    code: "NCDF5005",
    rule: "fillval-in-valid-range",
    severity: "warning" as const,
    message: (varName: string, fillVal: string, minVal: string, maxVal: string) =>
      `Variable '${varName}' declares FILLVAL (${fillVal}) inside valid range [${minVal}, ${maxVal}].`,
  },
  EMPTY_DATA_RECORDS: {
    code: "NCDF5006",
    rule: "empty-data-records",
    severity: "info" as const,
    message: (varName: string) => `Record-varying variable '${varName}' defines no data records.`,
  },
} as const satisfies Record<string, NasaCdfErrorDefinition>;

export type NasaCdfErrorCodeKey = keyof typeof NasaCdfErrorCode;
