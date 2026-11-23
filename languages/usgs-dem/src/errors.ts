// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/usgs-dem` (`DEM1001`–`DEM5006`).
 */

export interface UsgsDemErrorSpec {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: (...args: never[]) => string;
}

export const UsgsDemErrorCode = {
  SYNTAX_ERROR: {
    code: "DEM1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `USGS DEM syntax error: ${detail}.`,
  },
  INVALID_GROUND_REF_SYSTEM: {
    code: "DEM2001",
    rule: "invalid-ground-ref-system",
    severity: "error" as const,
    message: (code: number) =>
      `Invalid ground planimetric reference system code '${code}' (expected 0=Geographic, 1=UTM, 2=State Plane, or 3=Albers).`,
  },
  INVALID_PLANIMETRIC_UNIT: {
    code: "DEM2002",
    rule: "invalid-planimetric-unit",
    severity: "error" as const,
    message: (code: number) =>
      `Invalid planimetric unit code '${code}' (expected 0=radians, 1=feet, 2=meters, or 3=arc-seconds).`,
  },
  INVALID_ELEVATION_UNIT: {
    code: "DEM2003",
    rule: "invalid-elevation-unit",
    severity: "error" as const,
    message: (code: number) => `Invalid elevation unit code '${code}' (expected 1=feet or 2=meters).`,
  },
  NON_POSITIVE_RESOLUTION: {
    code: "DEM3001",
    rule: "non-positive-resolution",
    severity: "error" as const,
    message: (axis: string, value: number) =>
      `Non-positive spatial resolution '${axis}' = ${value}; DEM grid spacing must be strictly positive.`,
  },
  MISSING_TYPE_B_PROFILES: {
    code: "DEM4001",
    rule: "missing-type-b-profiles",
    severity: "error" as const,
    message: () => `USGS DEM contains no Type B elevation profiles.`,
  },
  PROFILE_COUNT_MISMATCH: {
    code: "DEM4002",
    rule: "profile-count-mismatch",
    severity: "error" as const,
    message: (actual: number, expected: number) =>
      `Type B profile count '${actual}' does not match Type A NCOLS '${expected}'.`,
  },
  ELEVATION_OUT_OF_BOUNDS: {
    code: "DEM5001",
    rule: "elevation-out-of-bounds",
    severity: "warning" as const,
    message: (colIndex: number, value: number, minZ: number, maxZ: number) =>
      `Elevation '${value}' in profile '${colIndex}' lies outside Type A bounds [${minZ}, ${maxZ}].`,
  },
  PROFILE_SAMPLE_COUNT_MISMATCH: {
    code: "DEM5002",
    rule: "profile-sample-count-mismatch",
    severity: "error" as const,
    message: (colIndex: number, actual: number, expected: number) =>
      `Profile '${colIndex}' contains '${actual}' elevation samples, expected '${expected}'.`,
  },
  INVALID_ELEVATION_RANGE: {
    code: "DEM5003",
    rule: "invalid-elevation-range",
    severity: "error" as const,
    message: (minZ: number, maxZ: number) => `Type A minimum elevation '${minZ}' exceeds maximum elevation '${maxZ}'.`,
  },
  INVALID_UTM_ZONE: {
    code: "DEM5004",
    rule: "invalid-utm-zone",
    severity: "warning" as const,
    message: (zone: number) => `Invalid UTM zone '${zone}' for ground reference system 1 (expected 1..60 or -60..-1).`,
  },
  NEGATIVE_TYPE_C_RMSE: {
    code: "DEM5005",
    rule: "negative-type-c-rmse",
    severity: "error" as const,
    message: (axis: string, value: number) => `Type C RMSE statistic '${axis}' = ${value} cannot be negative.`,
  },
  INVALID_DEM_LEVEL: {
    code: "DEM5006",
    rule: "invalid-dem-level",
    severity: "warning" as const,
    message: (level: number) => `Unrecognized USGS DEM level code '${level}' (expected 1, 2, or 3).`,
  },
} as const satisfies Record<string, UsgsDemErrorSpec>;
