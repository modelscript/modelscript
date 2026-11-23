// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core TypeScript types for `@modelscript/netcdf` (NetCDF Classic v1/v2 & CDL).
 */

export type NetcdfFormatVersion = "classic" | "64bit-offset";

export type NetcdfDataType = "byte" | "char" | "short" | "int" | "long" | "float" | "double";

/**
 * Standard Unidata NetCDF Classic binary type codes (CDF1 / CDF2).
 */
export const NC_TYPE_CODE: Record<NetcdfDataType, number> = {
  byte: 1,
  char: 2,
  short: 3,
  int: 4,
  long: 4, // Alias for 32-bit signed int in NetCDF Classic CDL
  float: 5,
  double: 6,
};

export const NC_CODE_TO_TYPE: Record<number, NetcdfDataType> = {
  1: "byte",
  2: "char",
  3: "short",
  4: "int",
  5: "float",
  6: "double",
};

export const NC_TYPE_BYTE_SIZE: Record<NetcdfDataType, number> = {
  byte: 1,
  char: 1,
  short: 2,
  int: 4,
  long: 4,
  float: 4,
  double: 8,
};

/**
 * Standard Unidata NetCDF Classic default fill values (`NC_FILL_*`).
 */
export const NC_DEFAULT_FILL: Record<NetcdfDataType, number> = {
  byte: -127,
  char: 0,
  short: -32767,
  int: -2147483647,
  long: -2147483647,
  float: 9.969209968386869e36,
  double: 9.969209968386869e36,
};

export interface NetcdfSourceSpan {
  line?: number | undefined;
  column?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface NetcdfDimension extends NetcdfSourceSpan {
  name: string;
  size: number;
  isUnlimited: boolean;
}

export type NetcdfAttributeValue = string | number | number[];

export interface NetcdfAttribute extends NetcdfSourceSpan {
  name: string;
  type: NetcdfDataType;
  value: NetcdfAttributeValue;
}

export interface NetcdfVariable extends NetcdfSourceSpan {
  name: string;
  type: NetcdfDataType;
  dimensions: string[];
  attributes: NetcdfAttribute[];
  data?: (number | string)[] | undefined;
  isRecord?: boolean | undefined;
  vsize?: number | undefined;
  offset?: number | undefined;
}

export interface NetcdfParseError {
  code: string;
  message: string;
  line: number;
  column: number;
}

export interface NetcdfDataset {
  name: string;
  format: NetcdfFormatVersion;
  sourceFormat: "cdl" | "binary";
  dimensions: NetcdfDimension[];
  variables: NetcdfVariable[];
  globalAttributes: NetcdfAttribute[];
  /** Data assignments referencing variables (retained for lint checks if undeclared). */
  undeclaredDataTargets?: Array<{ name: string; line: number; column: number }> | undefined;
  parseErrors: NetcdfParseError[];
}

export interface NetcdfDiagnostic {
  id: string;
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number | undefined;
  column?: number | undefined;
  symbolName?: string | undefined;
}
