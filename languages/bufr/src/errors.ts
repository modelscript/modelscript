// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WMO BUFR Diagnostic Error Codes (BUFR1001–BUFR5006).
 */
export const BufrErrorCode = {
  SYNTAX_OR_MAGIC_ERROR: {
    code: "BUFR1001",
    rule: "syntax-or-magic-error",
    severity: "error" as const,
    message: (detail: string) => `BUFR syntax or indicator header error: ${detail}.`,
  },
  MISSING_END_SECTION: {
    code: "BUFR1002",
    rule: "missing-end-section",
    severity: "error" as const,
    message: () => "Missing BUFR Section 5 end-of-message marker '7777'.",
  },
  INVALID_DESCRIPTOR_F: {
    code: "BUFR2001",
    rule: "invalid-descriptor-f",
    severity: "error" as const,
    message: (code: string, f: number) => `Invalid BUFR descriptor '${code}': F class '${f}' must be in range 0..3.`,
  },
  INVALID_DESCRIPTOR_X: {
    code: "BUFR2002",
    rule: "invalid-descriptor-x",
    severity: "error" as const,
    message: (code: string, x: number) => `Invalid BUFR descriptor '${code}': X class '${x}' must be in range 0..63.`,
  },
  INVALID_DESCRIPTOR_Y: {
    code: "BUFR2003",
    rule: "invalid-descriptor-y",
    severity: "error" as const,
    message: (code: string, y: number) =>
      `Invalid BUFR descriptor '${code}': Y element '${y}' must be in range 0..255.`,
  },
  UNKNOWN_DESCRIPTOR: {
    code: "BUFR3001",
    rule: "unknown-descriptor",
    severity: "warning" as const,
    message: (code: string) => `Unknown WMO BUFR Table B/D descriptor '${code}' not found in master or local tables.`,
  },
  SUBSET_COUNT_MISMATCH: {
    code: "BUFR4001",
    rule: "subset-count-mismatch",
    severity: "error" as const,
    message: (declared: number, actual: number) =>
      `BUFR Section 3 declares '${declared}' subset(s), but Section 4 contains '${actual}' subset(s).`,
  },
  DELAYED_REPLICATION_ERROR: {
    code: "BUFR4002",
    rule: "delayed-replication-error",
    severity: "error" as const,
    message: (detail: string) => `BUFR delayed replication count error: ${detail}.`,
  },
  TEMPERATURE_OUT_OF_RANGE: {
    code: "BUFR5001",
    rule: "temperature-out-of-range",
    severity: "error" as const,
    message: (descriptor: string, value: number) =>
      `Meteorological temperature '${descriptor}' value '${value} K' is outside physical bounds [150, 360] K.`,
  },
  RELATIVE_HUMIDITY_OUT_OF_RANGE: {
    code: "BUFR5002",
    rule: "relative-humidity-out-of-range",
    severity: "error" as const,
    message: (descriptor: string, value: number) =>
      `Relative humidity '${descriptor}' value '${value}%' is outside physical bounds [0, 100]%.`,
  },
  DEWPOINT_EXCEEDS_TEMPERATURE: {
    code: "BUFR5003",
    rule: "dewpoint-exceeds-temperature",
    severity: "warning" as const,
    message: (td: number, t: number) =>
      `Dewpoint temperature '${td.toFixed(2)} K' exceeds dry-bulb temperature '${t.toFixed(2)} K' (supersaturation).`,
  },
  PRESSURE_OUT_OF_RANGE: {
    code: "BUFR5004",
    rule: "pressure-out-of-range",
    severity: "error" as const,
    message: (descriptor: string, value: number) =>
      `Atmospheric pressure '${descriptor}' value '${value} Pa' is outside physical bounds [0, 115000] Pa.`,
  },
  COORDINATE_OUT_OF_RANGE: {
    code: "BUFR5005",
    rule: "coordinate-out-of-range",
    severity: "error" as const,
    message: (descriptor: string, value: number, range: string) =>
      `Geographic coordinate '${descriptor}' value '${value}' is outside valid range ${range}.`,
  },
  WIND_OUT_OF_RANGE: {
    code: "BUFR5006",
    rule: "wind-out-of-range",
    severity: "error" as const,
    message: (descriptor: string, value: number, detail: string) =>
      `Wind observation '${descriptor}' value '${value}' is invalid: ${detail}.`,
  },
} as const;

export type BufrErrorCodeKey = keyof typeof BufrErrorCode;

export interface BufrDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}
