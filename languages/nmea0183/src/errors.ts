// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for @modelscript/nmea0183 (NMEA1001–NMEA5006).
 */

export type NmeaDiagnosticSeverity = "error" | "warning" | "info";

export interface NmeaErrorDefinition {
  readonly code: string;
  readonly rule: string;
  readonly severity: NmeaDiagnosticSeverity;
  readonly description: string;
}

export const Nmea0183ErrorCode = {
  SYNTAX_ERROR: {
    code: "NMEA1001",
    rule: "syntax-error",
    severity: "error" as const,
    description: "Malformed NMEA 0183 sentence syntax.",
  },
  MISSING_CHECKSUM: {
    code: "NMEA1002",
    rule: "missing-checksum",
    severity: "warning" as const,
    description: "NMEA 0183 sentence is missing an '*XX' hex XOR checksum.",
  },
  CHECKSUM_MISMATCH: {
    code: "NMEA2001",
    rule: "checksum-mismatch",
    severity: "error" as const,
    description: "NMEA 0183 XOR checksum does not match the '*XX' trailer.",
  },
  SENTENCE_TOO_LONG: {
    code: "NMEA2002",
    rule: "sentence-too-long",
    severity: "warning" as const,
    description: "NMEA 0183 sentence exceeds the 82-character maximum length.",
  },
  INVALID_LATITUDE: {
    code: "NMEA3001",
    rule: "invalid-latitude",
    severity: "error" as const,
    description: "Latitude 'ddmm.mmmm' is outside valid range [-90, 90] or has minutes >= 60.",
  },
  INVALID_LONGITUDE: {
    code: "NMEA3002",
    rule: "invalid-longitude",
    severity: "error" as const,
    description: "Longitude 'dddmm.mmmm' is outside valid range [-180, 180] or has minutes >= 60.",
  },
  UNKNOWN_TALKER: {
    code: "NMEA4001",
    rule: "unknown-talker",
    severity: "warning" as const,
    description: "Unrecognized 2-character NMEA 0183 talker ID.",
  },
  UNKNOWN_FORMATTER: {
    code: "NMEA4002",
    rule: "unknown-formatter",
    severity: "warning" as const,
    description: "Unrecognized 3-character NMEA 0183 sentence formatter.",
  },
  VOID_GPS_FIX: {
    code: "NMEA5001",
    rule: "void-gps-fix",
    severity: "warning" as const,
    description: "Void or invalid GPS fix ('RMC' status 'V' or 'GGA' fix quality '0').",
  },
  HIGH_HDOP: {
    code: "NMEA5002",
    rule: "high-hdop",
    severity: "warning" as const,
    description: "High HDOP (> 5.0) indicating degraded horizontal positioning accuracy.",
  },
  NON_MONOTONIC_TIMESTAMP: {
    code: "NMEA5003",
    rule: "non-monotonic-timestamp",
    severity: "warning" as const,
    description: "Non-monotonic UTC timestamp detected relative to the previous epoch.",
  },
  INVALID_FIELD_COUNT: {
    code: "NMEA5004",
    rule: "invalid-field-count",
    severity: "error" as const,
    description: "Unexpected field count for standard NMEA 0183 sentence formatter.",
  },
  INVALID_SATELLITE_GEOMETRY: {
    code: "NMEA5005",
    rule: "invalid-satellite-geometry",
    severity: "warning" as const,
    description: "GSV satellite azimuth/elevation is outside physical bounds.",
  },
  UNREALISTIC_SPEED: {
    code: "NMEA5006",
    rule: "unrealistic-speed",
    severity: "warning" as const,
    description: "Speed over ground exceeds realistic marine/surface vessel threshold (> 500 knots).",
  },
} as const;

export type Nmea0183ErrorKey = keyof typeof Nmea0183ErrorCode;

export interface Nmea0183Diagnostic {
  code: string;
  rule: string;
  severity: NmeaDiagnosticSeverity;
  message: string;
  line: number; // 1-based
  column: number; // 1-based
  endColumn?: number | undefined;
  sentenceIndex?: number | undefined;
  address?: string | undefined;
}
