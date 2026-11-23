// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic Error Codes for `@modelscript/apt` (`APT1001`–`APT5006`).
 */

export interface AptErrorSpec {
  readonly code: number;
  readonly id: string;
  readonly rule: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: (...args: never[]) => string;
}

export const AptErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "APT1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `APT syntax error: ${detail}.`,
  },
  DUPLICATE_GEOMETRY_LABEL: {
    code: 2001,
    id: "APT2001",
    rule: "duplicate-geometry-label",
    severity: "error" as const,
    message: (label: string) => `Duplicate geometry label '${label}' declared multiple times in the part program.`,
  },
  UNDEFINED_GEOMETRY_REF: {
    code: 2002,
    id: "APT2002",
    rule: "undefined-geometry-ref",
    severity: "error" as const,
    message: (ref: string, context: string) => `Undefined geometry reference '${ref}' in ${context}.`,
  },
  INVALID_CUTTER_DIAMETER: {
    code: 3001,
    id: "APT3001",
    rule: "invalid-cutter-diameter",
    severity: "error" as const,
    message: (diameter: number) => `CUTTER diameter must be positive, got ${diameter}.`,
  },
  INVALID_FEED_RATE: {
    code: 3002,
    id: "APT3002",
    rule: "invalid-feed-rate",
    severity: "error" as const,
    message: (feed: number) => `FEDRAT value must be positive, got ${feed}.`,
  },
  INVALID_SPINDLE_RPM: {
    code: 3003,
    id: "APT3003",
    rule: "invalid-spindle-rpm",
    severity: "error" as const,
    message: (rpm: number) => `Invalid SPINDL speed ${rpm} RPM (must be > 0 and <= 100000 RPM).`,
  },
  MOTION_BEFORE_FROM: {
    code: 4001,
    id: "APT4001",
    rule: "motion-before-from",
    severity: "error" as const,
    message: (keyword: string) => `Motion statement '${keyword}' appears before an initial FROM tool position.`,
  },
  MOTION_BEFORE_CUTTER: {
    code: 4002,
    id: "APT4002",
    rule: "motion-before-cutter",
    severity: "warning" as const,
    message: (keyword: string) => `Motion statement '${keyword}' appears before a CUTTER definition.`,
  },
  PARALLEL_NON_INTERSECTING_LINES: {
    code: 5001,
    id: "APT5001",
    rule: "parallel-non-intersecting-lines",
    severity: "error" as const,
    message: (lineA: string, lineB: string) =>
      `Drive line '${lineA}' and check line '${lineB}' are parallel and do not intersect.`,
  },
  MISSING_FINI: {
    code: 5002,
    id: "APT5002",
    rule: "missing-fini",
    severity: "warning" as const,
    message: () => "APT part program is missing a terminating FINI statement.",
  },
  NON_POSITIVE_TOLERANCE: {
    code: 5003,
    id: "APT5003",
    rule: "non-positive-tolerance",
    severity: "error" as const,
    message: (keyword: string, value: number) => `${keyword} tolerance must be positive, got ${value}.`,
  },
  DEGENERATE_GEOMETRY: {
    code: 5004,
    id: "APT5004",
    rule: "degenerate-geometry",
    severity: "error" as const,
    message: (label: string, reason: string) => `Degenerate geometry '${label}': ${reason}.`,
  },
  NO_CIRCLE_INTERSECTION: {
    code: 5005,
    id: "APT5005",
    rule: "no-circle-intersection",
    severity: "error" as const,
    message: (drive: string, check: string) =>
      `No valid intersection or tangency between drive surface '${drive}' and check surface '${check}'.`,
  },
  CUTTER_TOO_LARGE_FOR_FILLET: {
    code: 5006,
    id: "APT5006",
    rule: "cutter-too-large-for-fillet",
    severity: "error" as const,
    message: (cutterRadius: number, filletRadius: number, label: string) =>
      `Cutter radius (${cutterRadius}) exceeds concave fillet circle '${label}' radius (${filletRadius}).`,
  },
} as const;

export type AptErrorKey = keyof typeof AptErrorCode;

export interface AptDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  endLine?: number | undefined;
  endColumn?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  symbol?: string | undefined;
}
