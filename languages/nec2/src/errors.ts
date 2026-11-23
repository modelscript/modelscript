// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/nec2` (NEC1001–NEC5006).
 */

export const Nec2ErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "NEC1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `NEC-2 card syntax error: ${detail}.`,
  },
  MISSING_CE: {
    code: 1002,
    id: "NEC1002",
    rule: "missing-ce",
    severity: "warning" as const,
    message: () => "Missing 'CE' comment-end card after 'CM' comment cards.",
  },
  MISSING_GE: {
    code: 1003,
    id: "NEC1003",
    rule: "missing-ge",
    severity: "error" as const,
    message: () => "Missing 'GE' geometry-end card terminating the structure geometry section.",
  },
  MISSING_EN: {
    code: 1004,
    id: "NEC1004",
    rule: "missing-en",
    severity: "warning" as const,
    message: () => "Missing 'EN' end-of-run card at the end of the NEC-2 deck.",
  },
  ZERO_LENGTH_WIRE: {
    code: 2001,
    id: "NEC2001",
    rule: "zero-length-wire",
    severity: "error" as const,
    message: (tag: number, reason: string) => `Wire tag '${tag}' is invalid: ${reason}.`,
  },
  WIRE_RADIUS_EXCEEDS_SEGMENT: {
    code: 2002,
    id: "NEC2002",
    rule: "wire-radius-exceeds-segment",
    severity: "error" as const,
    message: (tag: number, radius: number, segLen: number) =>
      `Wire tag '${tag}' has radius ${radius.toExponential(3)} m >= segment length ${segLen.toExponential(3)} m (or non-positive radius).`,
  },
  THIN_WIRE_RATIO_VIOLATION: {
    code: 2003,
    id: "NEC2003",
    rule: "thin-wire-ratio-violation",
    severity: "warning" as const,
    message: (tag: number, ratio: number) =>
      `Wire tag '${tag}' violates NEC-2 thin-wire approximation: segment-length-to-radius ratio Δ/a = ${ratio.toFixed(2)} < 2.0.`,
  },
  UNDEFINED_WIRE_TAG: {
    code: 3001,
    id: "NEC3001",
    rule: "undefined-wire-tag",
    severity: "error" as const,
    message: (card: string, tag: number) => `Card '${card}' references undefined wire tag '${tag}'.`,
  },
  SEGMENT_OUT_OF_RANGE: {
    code: 3002,
    id: "NEC3002",
    rule: "segment-out-of-range",
    severity: "error" as const,
    message: (card: string, seg: number, tag: number, maxSeg: number) =>
      `Card '${card}' references segment '${seg}' on wire tag '${tag}', which is outside valid range 1..${maxSeg}.`,
  },
  UNDER_SEGMENTED_WIRE: {
    code: 4001,
    id: "NEC4001",
    rule: "under-segmented-wire",
    severity: "warning" as const,
    message: (tag: number, segLen: number, limit: number, freqMhz: number) =>
      `Wire tag '${tag}' is under-segmented at ${freqMhz.toFixed(2)} MHz: segment length ${segLen.toFixed(4)} m exceeds λ/10 (${limit.toFixed(4)} m).`,
  },
  INVALID_FREQUENCY: {
    code: 5001,
    id: "NEC5001",
    rule: "invalid-frequency",
    severity: "error" as const,
    message: (fmhz: number, nfrq: number) =>
      `Invalid 'FR' frequency specification: fmhz=${fmhz} MHz, nfrq=${nfrq} (frequency must be > 0 and nfrq >= 1).`,
  },
  MISSING_EXCITATION: {
    code: 5002,
    id: "NEC5002",
    rule: "missing-excitation",
    severity: "error" as const,
    message: (card: string) => `Card '${card}' invoked without a preceding 'EX' excitation card.`,
  },
  GROUND_GE_MISMATCH: {
    code: 5003,
    id: "NEC5003",
    rule: "ground-ge-mismatch",
    severity: "warning" as const,
    message: (gpflag: number, iperf: number) => `Ground plane mismatch between 'GE ${gpflag}' and 'GN ${iperf}'.`,
  },
  WIRE_BELOW_GROUND: {
    code: 5004,
    id: "NEC5004",
    rule: "wire-below-ground",
    severity: "error" as const,
    message: (tag: number, minZ: number) =>
      `Wire tag '${tag}' extends below ground plane (z = ${minZ.toFixed(4)} m < 0) while ground plane is active.`,
  },
  DUPLICATE_WIRE_TAG: {
    code: 5005,
    id: "NEC5005",
    rule: "duplicate-wire-tag",
    severity: "warning" as const,
    message: (tag: number) => `Duplicate wire tag '${tag}' declared; 'EX'/'LD' segment indexing may be ambiguous.`,
  },
  INVALID_LOAD_IMPEDANCE: {
    code: 5006,
    id: "NEC5006",
    rule: "invalid-load-impedance",
    severity: "error" as const,
    message: (tag: number, reason: string) => `Invalid 'LD' load on wire tag '${tag}': ${reason}.`,
  },
} as const;

export type Nec2ErrorKey = keyof typeof Nec2ErrorCode;
