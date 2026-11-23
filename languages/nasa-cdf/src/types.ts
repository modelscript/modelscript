// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — Core TypeScript Data Model for NASA CDF v2/v3 & Skeleton Tables (.skt).
 */

export const CDF_DATA_TYPES = [
  "CDF_INT1",
  "CDF_INT2",
  "CDF_INT4",
  "CDF_INT8",
  "CDF_UINT1",
  "CDF_UINT2",
  "CDF_UINT4",
  "CDF_REAL4",
  "CDF_REAL8",
  "CDF_FLOAT",
  "CDF_DOUBLE",
  "CDF_BYTE",
  "CDF_CHAR",
  "CDF_UCHAR",
  "CDF_EPOCH",
  "CDF_EPOCH16",
  "CDF_TIME_TT2000",
] as const;

export type CdfDataType = (typeof CDF_DATA_TYPES)[number];

/**
 * Official NASA CDF numeric data type codes (CDF Internal Format Description §2.5).
 */
export const CDF_TYPE_CODES: Record<CdfDataType, number> = {
  CDF_INT1: 1,
  CDF_INT2: 2,
  CDF_INT4: 4,
  CDF_INT8: 8,
  CDF_UINT1: 11,
  CDF_UINT2: 12,
  CDF_UINT4: 14,
  CDF_REAL4: 21,
  CDF_REAL8: 22,
  CDF_EPOCH: 31,
  CDF_EPOCH16: 32,
  CDF_TIME_TT2000: 33,
  CDF_BYTE: 41,
  CDF_FLOAT: 44,
  CDF_DOUBLE: 45,
  CDF_CHAR: 51,
  CDF_UCHAR: 52,
};

export const CDF_CODE_TO_TYPE: Record<number, CdfDataType> = Object.fromEntries(
  Object.entries(CDF_TYPE_CODES).map(([k, v]) => [v, k as CdfDataType]),
) as Record<number, CdfDataType>;

export function isValidCdfDataType(value: string): value is CdfDataType {
  return Object.prototype.hasOwnProperty.call(CDF_TYPE_CODES, value);
}

export function cdfDataTypeByteSize(dataType: CdfDataType): number {
  switch (dataType) {
    case "CDF_INT1":
    case "CDF_UINT1":
    case "CDF_BYTE":
    case "CDF_CHAR":
    case "CDF_UCHAR":
      return 1;
    case "CDF_INT2":
    case "CDF_UINT2":
      return 2;
    case "CDF_INT4":
    case "CDF_UINT4":
    case "CDF_REAL4":
    case "CDF_FLOAT":
      return 4;
    case "CDF_INT8":
    case "CDF_REAL8":
    case "CDF_DOUBLE":
    case "CDF_EPOCH":
    case "CDF_TIME_TT2000":
      return 8;
    case "CDF_EPOCH16":
      return 16;
  }
}

export type CdfMajority = "ROW_MAJOR" | "COLUMN_MAJOR";
export type CdfFileFormat = "SINGLE" | "MULTI";
export type CdfVariance = "T" | "F";
export type CdfFormatVersion = "v2" | "v3";

export interface CdfHeader {
  fileName: string;
  format: CdfFileFormat;
  encoding: string;
  majority: CdfMajority;
  numDims: number;
  dimSizes: number[];
  version: number;
  release: number;
  increment: number;
  compression?: string | undefined;
  checksum?: string | undefined;
  line: number;
}

export type CdfScalarValue = number | string;

export interface CdfAttributeEntry {
  entryNumber: number;
  dataType: string;
  values: CdfScalarValue[];
  line: number;
}

export interface CdfGlobalAttribute {
  name: string;
  entries: CdfAttributeEntry[];
  line: number;
}

export interface CdfVariableAttributeEntry {
  attributeName: string;
  dataType: string;
  values: CdfScalarValue[];
  line: number;
}

export type CdfRecordValue = CdfScalarValue | CdfScalarValue[];

export interface CdfVariable {
  name: string;
  dataType: string;
  numElements: number;
  numDims: number;
  dimSizes: number[];
  recVariance: CdfVariance;
  dimVariances: CdfVariance[];
  padValue?: CdfScalarValue | undefined;
  isZVariable: boolean;
  attributes: Record<string, CdfVariableAttributeEntry>;
  values: CdfRecordValue[];
  line: number;
}

export interface CdfParseIssue {
  code: string;
  message: string;
  line: number;
  column: number;
}

export interface CdfDocument {
  uri?: string | undefined;
  isBinary: boolean;
  formatVersion: CdfFormatVersion;
  header: CdfHeader;
  hasHeaderSection: boolean;
  hasEndSection: boolean;
  globalAttributes: CdfGlobalAttribute[];
  variableAttributeNames: string[];
  variables: CdfVariable[];
  parseIssues: CdfParseIssue[];
  rawByteLength?: number | undefined;
}
