// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/grib — Diagnostic Error Codes (`GRIB1001`–`GRIB5006`).
 */

export const GribErrorCode = {
  INVALID_MAGIC: {
    code: "GRIB1001",
    rule: "invalid-magic",
    severity: "error" as const,
    message: (detail: string) => `Invalid or missing GRIB indicator magic header: ${detail}.`,
  },
  MISSING_TRAILER: {
    code: "GRIB1002",
    rule: "missing-trailer",
    severity: "error" as const,
    message: (msgIdx: number) => `GRIB message #${msgIdx} is missing the mandatory '7777' End Section trailer.`,
  },
  UNSUPPORTED_EDITION: {
    code: "GRIB1003",
    rule: "unsupported-edition",
    severity: "error" as const,
    message: (edition: number) => `Unsupported GRIB edition '${edition}'; '@modelscript/grib' requires GRIB Edition 1.`,
  },
  INVALID_PDS_DATE: {
    code: "GRIB2001",
    rule: "invalid-pds-date",
    severity: "error" as const,
    message: (detail: string) => `Invalid PDS reference date/time: ${detail}.`,
  },
  INVALID_PARAMETER_CODE: {
    code: "GRIB2002",
    rule: "invalid-parameter-code",
    severity: "error" as const,
    message: (paramCode: number) =>
      `Invalid WMO Table 2 parameter indicator '${paramCode}'; expected integer in [1, 254].`,
  },
  INVALID_LEVEL_TYPE: {
    code: "GRIB2003",
    rule: "invalid-level-type",
    severity: "warning" as const,
    message: (levelType: number) => `Unrecognized WMO Table 3 level/layer type indicator '${levelType}'.`,
  },
  GDS_BDS_DIMENSION_MISMATCH: {
    code: "GRIB3001",
    rule: "gds-bds-dimension-mismatch",
    severity: "error" as const,
    message: (expected: number, actual: number) =>
      `GDS/BMS grid point count (${expected}) does not match BDS value count (${actual}).`,
  },
  INVALID_LAT_LON_BOUNDS: {
    code: "GRIB3002",
    rule: "invalid-lat-lon-bounds",
    severity: "error" as const,
    message: (detail: string) => `Invalid GDS geographic coordinate bounds: ${detail}.`,
  },
  BMS_LENGTH_MISMATCH: {
    code: "GRIB3003",
    rule: "bms-length-mismatch",
    severity: "error" as const,
    message: (expected: number, actual: number) =>
      `BMS bitmap length (${actual}) does not match GDS grid point count (${expected}).`,
  },
  INVALID_BIT_WIDTH: {
    code: "GRIB4001",
    rule: "invalid-bit-width",
    severity: "error" as const,
    message: (bits: number) => `Invalid BDS bit-width '${bits}'; GRIB Edition 1 requires bitsPerValue in [0, 32].`,
  },
  INVALID_SCALE_FACTOR: {
    code: "GRIB4002",
    rule: "invalid-scale-factor",
    severity: "warning" as const,
    message: (kind: string, value: number) =>
      `Extreme GRIB1 ${kind} scale factor '${value}' may cause numerical overflow or underflow.`,
  },
  MISSING_PDS: {
    code: "GRIB5001",
    rule: "missing-pds",
    severity: "error" as const,
    message: (msgIdx: number) => `GRIB message #${msgIdx} is missing the mandatory Product Definition Section (PDS).`,
  },
  MISSING_BDS: {
    code: "GRIB5002",
    rule: "missing-bds",
    severity: "error" as const,
    message: (msgIdx: number) => `GRIB message #${msgIdx} is missing the mandatory Binary Data Section (BDS).`,
  },
  NON_FINITE_DATA: {
    code: "GRIB5003",
    rule: "non-finite-data",
    severity: "error" as const,
    message: (count: number) => `BDS data section contains ${count} non-finite (NaN or Infinity) grid value(s).`,
  },
  TRUNCATED_BINARY_MESSAGE: {
    code: "GRIB5004",
    rule: "truncated-binary-message",
    severity: "error" as const,
    message: (declared: number, available: number) =>
      `Binary GRIB1 message truncated: declared total length is ${declared} bytes, but only ${available} bytes are available.`,
  },
  INVALID_GRID_INCREMENT: {
    code: "GRIB5005",
    rule: "invalid-grid-increment",
    severity: "warning" as const,
    message: (di: number, dj: number) =>
      `Non-positive GDS grid increment detected (di=${di}, dj=${dj}) on a regular Lat/Lon grid.`,
  },
  PHYSICAL_RANGE_WARNING: {
    code: "GRIB5006",
    rule: "physical-range-warning",
    severity: "warning" as const,
    message: (param: string, value: number, min: number, max: number) =>
      `Parameter '${param}' value ${value} is outside plausible meteorological range [${min}, ${max}].`,
  },
} as const;

export type GribErrorKey = keyof typeof GribErrorCode;
