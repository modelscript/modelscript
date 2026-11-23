// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ARINC 429 diagnostic error codes (`A4291001`–`A4295006`).
 */

export interface Arinc429ErrorDef {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: (...args: string[]) => string;
}

export const Arinc429ErrorCode = {
  SYNTAX_ERROR: {
    code: "A4291001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `ARINC 429 syntax error: ${detail}.`,
  },
  INVALID_OCTAL_LABEL: {
    code: "A4292001",
    rule: "invalid-octal-label",
    severity: "error" as const,
    message: (label: string) =>
      `Invalid octal ARINC 429 label '${label}'; label must be a valid octal value in range '001'..'377'.`,
  },
  DUPLICATE_LABEL: {
    code: "A4292002",
    rule: "duplicate-label",
    severity: "error" as const,
    message: (label: string, sdi: string) =>
      `Duplicate ARINC 429 label definition for label '${label}' (SDI '${sdi}') on the same bus.`,
  },
  PARITY_ERROR: {
    code: "A4293001",
    rule: "parity-error",
    severity: "error" as const,
    message: (hexWord: string, label: string) =>
      `Odd-parity error on 32-bit ARINC 429 word '${hexWord}' (label '${label}'); total 1-bits must be odd.`,
  },
  INVALID_BCD_NIBBLE: {
    code: "A4293002",
    rule: "invalid-bcd-nibble",
    severity: "error" as const,
    message: (hexWord: string, digits: string) =>
      `Invalid BCD nibble (> 9) in 32-bit ARINC 429 word '${hexWord}' at digit position(s) '${digits}'.`,
  },
  SSM_FAILURE_WARNING: {
    code: "A4294001",
    rule: "ssm-failure-warning",
    severity: "warning" as const,
    message: (hexWord: string, label: string) =>
      `ARINC 429 word '${hexWord}' (label '${label}') reports SSM Failure Warning (FW).`,
  },
  SSM_NO_COMPUTED_DATA: {
    code: "A4294002",
    rule: "ssm-no-computed-data",
    severity: "warning" as const,
    message: (hexWord: string, label: string) =>
      `ARINC 429 word '${hexWord}' (label '${label}') reports SSM No Computed Data (NCD).`,
  },
  BUS_BANDWIDTH_EXCEEDED: {
    code: "A4295001",
    rule: "bus-bandwidth-exceeded",
    severity: "error" as const,
    message: (utilPct: string, rate: string, bitRate: string) =>
      `ARINC 429 bus bandwidth utilization '${utilPct}%' exceeds 100% capacity at '${rate}' speed (${bitRate} bps).`,
  },
  BUS_BANDWIDTH_HIGH: {
    code: "A4295002",
    rule: "bus-bandwidth-high",
    severity: "warning" as const,
    message: (utilPct: string, rate: string) =>
      `ARINC 429 bus bandwidth utilization '${utilPct}%' exceeds 80% safety margin at '${rate}' speed.`,
  },
  UNKNOWN_WORD_LABEL: {
    code: "A4295003",
    rule: "unknown-word-label",
    severity: "warning" as const,
    message: (label: string, hexWord: string) =>
      `Trace word '${hexWord}' uses octal label '${label}' which is not declared in the bus schema.`,
  },
  RANGE_EXCEEDED: {
    code: "A4295004",
    rule: "range-exceeded",
    severity: "warning" as const,
    message: (label: string, value: string, range: string) =>
      `Decoded value '${value}' for label '${label}' exceeds declared range '±${range}'.`,
  },
  INVALID_SDI: {
    code: "A4295005",
    rule: "invalid-sdi",
    severity: "error" as const,
    message: (sdi: string, label: string) => `Invalid SDI '${sdi}' on label '${label}'; SDI must be in range 0..3.`,
  },
  MISSING_BUS_RATE: {
    code: "A4295006",
    rule: "missing-bus-rate",
    severity: "warning" as const,
    message: (busName: string) =>
      `Bus '${busName}' does not declare an explicit RATE ('HIGH' or 'LOW'); defaulting to 'LOW' (12.5 kbps).`,
  },
} as const;

export type Arinc429ErrorKey = keyof typeof Arinc429ErrorCode;
