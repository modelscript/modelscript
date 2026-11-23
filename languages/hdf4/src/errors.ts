// SPDX-License-Identifier: AGPL-3.0-or-later

export type Hdf4DiagnosticSeverity = "error" | "warning" | "info";

export interface Hdf4ErrorDefinition {
  code: string;
  rule: string;
  severity: Hdf4DiagnosticSeverity;
  message: (...args: string[]) => string;
}

/**
 * NCSA HDF4 domain diagnostic catalog (`HDF1001`–`HDF5006`).
 */
export const Hdf4ErrorCode = {
  SYNTAX_ERROR: {
    code: "HDF1001",
    rule: "syntax-error",
    severity: "error" as Hdf4DiagnosticSeverity,
    message: (detail: string) => `HDF4 DDL syntax error: ${detail}.`,
  },
  INVALID_MAGIC: {
    code: "HDF1002",
    rule: "invalid-magic",
    severity: "error" as Hdf4DiagnosticSeverity,
    message: (actual: string) => `Invalid HDF4 magic header '${actual}'; expected 0x0e031301.`,
  },
  TRUNCATED_DDH: {
    code: "HDF1003",
    rule: "truncated-ddh",
    severity: "error" as Hdf4DiagnosticSeverity,
    message: (detail: string) => `Truncated HDF4 DDH/DD descriptor block: ${detail}.`,
  },
  DUPLICATE_TAG_REF: {
    code: "HDF2001",
    rule: "duplicate-tag-ref",
    severity: "error" as Hdf4DiagnosticSeverity,
    message: (tag: string, ref: string) => `Duplicate HDF4 descriptor pair (tag=${tag}, ref=${ref}).`,
  },
  DUPLICATE_SDS_NAME: {
    code: "HDF2002",
    rule: "duplicate-sds-name",
    severity: "error" as Hdf4DiagnosticSeverity,
    message: (name: string) => `Duplicate SDS dataset name '${name}'.`,
  },
  DUPLICATE_VGROUP_NAME: {
    code: "HDF2003",
    rule: "duplicate-vgroup-name",
    severity: "error" as Hdf4DiagnosticSeverity,
    message: (name: string) => `Duplicate Vgroup name '${name}'.`,
  },
  UNDEFINED_VGROUP_MEMBER: {
    code: "HDF2004",
    rule: "undefined-vgroup-member",
    severity: "error" as Hdf4DiagnosticSeverity,
    message: (vgroup: string, member: string) => `Vgroup '${vgroup}' references undefined member '${member}'.`,
  },
  INVALID_DATA_TYPE: {
    code: "HDF3001",
    rule: "invalid-data-type",
    severity: "error" as Hdf4DiagnosticSeverity,
    message: (target: string, code: string) => `Invalid HDF4 DFNT data type code '${code}' on '${target}'.`,
  },
  NON_POSITIVE_DIM: {
    code: "HDF3002",
    rule: "non-positive-dim",
    severity: "error" as Hdf4DiagnosticSeverity,
    message: (target: string, dimName: string, size: string) =>
      `Non-positive dimension size '${size}' for dimension '${dimName}' in '${target}'.`,
  },
  CYCLIC_VGROUP: {
    code: "HDF4001",
    rule: "cyclic-vgroup",
    severity: "error" as Hdf4DiagnosticSeverity,
    message: (cyclePath: string) => `Cyclic Vgroup hierarchy detected: ${cyclePath}.`,
  },
  EMPTY_VGROUP: {
    code: "HDF4002",
    rule: "empty-vgroup",
    severity: "warning" as Hdf4DiagnosticSeverity,
    message: (name: string) => `Vgroup '${name}' declares no members.`,
  },
  SDS_DATA_COUNT_MISMATCH: {
    code: "HDF5001",
    rule: "sds-data-count-mismatch",
    severity: "error" as Hdf4DiagnosticSeverity,
    message: (name: string, actual: string, expected: string) =>
      `SDS '${name}' data count (${actual}) does not match product of declared dimensions (${expected}).`,
  },
  PALETTE_SIZE_MISMATCH: {
    code: "HDF5002",
    rule: "palette-size-mismatch",
    severity: "error" as Hdf4DiagnosticSeverity,
    message: (name: string, actual: string) =>
      `Palette '${name}' has ${actual} RGB entries; HDF4 8-bit palette expects 768 (256 x 3).`,
  },
  RASTER8_DATA_MISMATCH: {
    code: "HDF5003",
    rule: "raster8-data-mismatch",
    severity: "error" as Hdf4DiagnosticSeverity,
    message: (name: string, actual: string, expected: string) =>
      `Raster8 '${name}' pixel count (${actual}) does not match width*height (${expected}).`,
  },
  VDATA_FIELD_MISMATCH: {
    code: "HDF5004",
    rule: "vdata-field-mismatch",
    severity: "error" as Hdf4DiagnosticSeverity,
    message: (name: string, row: string, actual: string, expected: string) =>
      `Vdata '${name}' record #${row} has ${actual} values; expected ${expected}.`,
  },
  NON_FINITE_DATA: {
    code: "HDF5005",
    rule: "non-finite-data",
    severity: "warning" as Hdf4DiagnosticSeverity,
    message: (name: string, count: string) => `SDS '${name}' contains ${count} non-finite (NaN/Infinity) value(s).`,
  },
  MISSING_UNITS_ATTR: {
    code: "HDF5006",
    rule: "missing-units-attr",
    severity: "info" as Hdf4DiagnosticSeverity,
    message: (name: string) => `SDS '${name}' does not specify a 'units' attribute or unit metadata.`,
  },
} as const;

export type Hdf4ErrorKey = keyof typeof Hdf4ErrorCode;
export type Hdf4ErrorCodeValue = (typeof Hdf4ErrorCode)[Hdf4ErrorKey]["code"];

export interface Hdf4Diagnostic {
  code: Hdf4ErrorCodeValue;
  rule: string;
  severity: Hdf4DiagnosticSeverity;
  message: string;
  objectName?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
}
