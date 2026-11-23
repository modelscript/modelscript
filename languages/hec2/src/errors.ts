// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/hec2` (`HEC21001`–`HEC25006`).
 */
export const Hec2ErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    codeId: "HEC21001",
    rule: "hec2-syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Syntax error in HEC-2 card deck: ${detail}.`,
  },
  MISSING_JOB_CARD: {
    code: 2001,
    codeId: "HEC22001",
    rule: "hec2-missing-job-card",
    severity: "error" as const,
    message: () => `Missing required 'J1' job control card in HEC-2 deck.`,
  },
  MISSING_END_CARD: {
    code: 2002,
    codeId: "HEC22002",
    rule: "hec2-missing-end-card",
    severity: "warning" as const,
    message: () => `Missing 'EJ' (end of job) or 'ER' (end of run) termination card in HEC-2 deck.`,
  },
  NON_POSITIVE_MANNING: {
    code: 3001,
    codeId: "HEC23001",
    rule: "hec2-non-positive-manning",
    severity: "error" as const,
    message: (card: string, field: string, value: number) =>
      `Non-positive Manning's n value '${value}' on '${card}' card field '${field}'; Manning's n must be strictly greater than zero.`,
  },
  MANNING_OUT_OF_BOUNDS: {
    code: 3002,
    codeId: "HEC23002",
    rule: "hec2-manning-out-of-bounds",
    severity: "warning" as const,
    message: (card: string, field: string, value: number) =>
      `Manning's n value '${value}' on '${card}' card field '${field}' is outside typical open-channel bounds (0.008 - 0.25).`,
  },
  GR_COUNT_MISMATCH: {
    code: 4001,
    codeId: "HEC24001",
    rule: "hec2-gr-count-mismatch",
    severity: "error" as const,
    message: (secno: number, expected: number, actual: number) =>
      `Cross-section '${secno}' declared NUMST=${expected} on 'X1' card, but '${actual}' elevation-station pairs were provided on 'GR' cards.`,
  },
  NON_MONOTONIC_STATION: {
    code: 4002,
    codeId: "HEC24002",
    rule: "hec2-non-monotonic-station",
    severity: "error" as const,
    message: (secno: number, prevSta: number, currSta: number) =>
      `Cross-section '${secno}' has non-monotonic 'GR' station coordinates: '${currSta}' follows '${prevSta}'. Stations must be non-decreasing.`,
  },
  BANK_STATION_OUT_OF_BOUNDS: {
    code: 4003,
    codeId: "HEC24003",
    rule: "hec2-bank-station-out-of-bounds",
    severity: "error" as const,
    message: (secno: number, bankField: string, bankVal: number, minSta: number, maxSta: number) =>
      `Bank station '${bankField}' (${bankVal}) at cross-section '${secno}' is outside 'GR' station range [${minSta}, ${maxSta}].`,
  },
  BANK_STATION_INVERTED: {
    code: 4004,
    codeId: "HEC24004",
    rule: "hec2-bank-station-inverted",
    severity: "error" as const,
    message: (secno: number, stchl: number, stchr: number) =>
      `Left bank station 'STCHL' (${stchl}) exceeds right bank station 'STCHR' (${stchr}) at cross-section '${secno}'.`,
  },
  NEGATIVE_REACH_LENGTH: {
    code: 5001,
    codeId: "HEC25001",
    rule: "hec2-negative-reach-length",
    severity: "error" as const,
    message: (secno: number, field: string, value: number) =>
      `Negative reach length '${value}' in '${field}' at cross-section '${secno}'; reach lengths must be non-negative.`,
  },
  NON_POSITIVE_DISCHARGE: {
    code: 5002,
    codeId: "HEC25002",
    rule: "hec2-non-positive-discharge",
    severity: "error" as const,
    message: (source: string, value: number) =>
      `Non-positive discharge Q='${value}' specified on '${source}' card; discharge must be strictly positive.`,
  },
  INSUFFICIENT_CROSS_SECTIONS: {
    code: 5006,
    codeId: "HEC25006",
    rule: "hec2-insufficient-cross-sections",
    severity: "warning" as const,
    message: (count: number) =>
      `HEC-2 deck contains only '${count}' cross-section(s); at least 2 cross-sections are required for a gradually-varied flow profile.`,
  },
} as const;
