// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes (`RNX1001`–`RNX5006`) for `@modelscript/rinex`.
 */

export type RinexDiagnosticSeverity = "error" | "warning" | "info";

export interface RinexErrorSpec {
  code: string;
  rule: string;
  severity: RinexDiagnosticSeverity;
  message: (...args: string[]) => string;
}

export const RinexErrorCode = {
  SYNTAX_ERROR: {
    code: "RNX1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `RINEX syntax error: ${detail}.`,
  },
  MISSING_VERSION_HEADER: {
    code: "RNX2001",
    rule: "missing-version-header",
    severity: "error" as const,
    message: () => "Missing required 'RINEX VERSION / TYPE' header record.",
  },
  MISSING_END_OF_HEADER: {
    code: "RNX2002",
    rule: "missing-end-of-header",
    severity: "error" as const,
    message: () => "Missing required 'END OF HEADER' delimiter.",
  },
  UNSUPPORTED_VERSION: {
    code: "RNX2003",
    rule: "unsupported-rinex-version",
    severity: "error" as const,
    message: (version: string) => `Unsupported RINEX version '${version}'; expected RINEX v2.x (2.00–2.99).`,
  },
  FEWER_THAN_FOUR_SATELLITES: {
    code: "RNX3001",
    rule: "fewer-than-four-satellites",
    severity: "warning" as const,
    message: (count: string, epoch: string) =>
      `Epoch '${epoch}' observes only ${count} satellite(s); at least 4 satellites are required for a 3D position fix.`,
  },
  INVALID_SATELLITE_PRN: {
    code: "RNX3002",
    rule: "invalid-satellite-prn",
    severity: "error" as const,
    message: (prn: string) => `Invalid GNSS satellite PRN '${prn}'.`,
  },
  NON_MONOTONIC_EPOCH: {
    code: "RNX4001",
    rule: "non-monotonic-epoch",
    severity: "error" as const,
    message: (current: string, previous: string) =>
      `Non-monotonic observation epoch timestamp '${current}' is not strictly after previous epoch '${previous}'.`,
  },
  OUT_OF_RANGE_PSEUDORANGE: {
    code: "RNX5001",
    rule: "out-of-range-pseudorange",
    severity: "error" as const,
    message: (prn: string, obsType: string, valueKm: string) =>
      `Out-of-range pseudorange '${obsType}' for satellite '${prn}' (${valueKm} km); expected 15,000 km to 35,000 km.`,
  },
  INVALID_ECCENTRICITY: {
    code: "RNX5002",
    rule: "invalid-eccentricity",
    severity: "error" as const,
    message: (prn: string, ecc: string) =>
      `Invalid orbital eccentricity e = '${ecc}' for satellite '${prn}'; bound GNSS orbit requires 0 <= e < 1.`,
  },
  INVALID_SEMI_MAJOR_AXIS: {
    code: "RNX5003",
    rule: "invalid-semi-major-axis",
    severity: "error" as const,
    message: (prn: string, sqrtA: string) =>
      `Invalid orbital semi-major axis parameter sqrt(A) = '${sqrtA}' for satellite '${prn}'.`,
  },
  UNHEALTHY_SATELLITE: {
    code: "RNX5004",
    rule: "unhealthy-satellite",
    severity: "warning" as const,
    message: (prn: string, health: string) =>
      `Satellite '${prn}' reports non-zero SV health flag '${health}' in broadcast ephemeris.`,
  },
  MISSING_OBS_TYPES: {
    code: "RNX5005",
    rule: "missing-obs-types",
    severity: "error" as const,
    message: () => "Observation file is missing '# / TYPES OF OBSERV' header record.",
  },
  MISSING_APPROX_POSITION: {
    code: "RNX5006",
    rule: "missing-approx-position",
    severity: "warning" as const,
    message: () => "Observation file is missing 'APPROX POSITION XYZ' header record.",
  },
} as const;

export type RinexErrorCodeKey = keyof typeof RinexErrorCode;

export interface RinexDiagnostic {
  code: string;
  rule: string;
  severity: RinexDiagnosticSeverity;
  message: string;
  line: number;
  column: number;
  prn?: string | undefined;
}
