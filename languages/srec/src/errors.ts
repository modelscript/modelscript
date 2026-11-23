// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Motorola S-Record (SREC) diagnostic error codes (`SREC1001`–`SREC5006`).
 */
export const SrecErrorCode = {
  SYNTAX_ERROR: {
    code: "SREC1001",
    rule: "srec-syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Malformed Motorola S-Record syntax: ${detail}.`,
  },
  CHECKSUM_MISMATCH: {
    code: "SREC2001",
    rule: "srec-checksum-mismatch",
    severity: "error" as const,
    message: (recordType: string, actual: string, expected: string) =>
      `1's-complement checksum mismatch in '${recordType}' record: found 0x${actual}, expected 0x${expected}.`,
  },
  BYTE_COUNT_MISMATCH: {
    code: "SREC2002",
    rule: "srec-byte-count-mismatch",
    severity: "error" as const,
    message: (recordType: string, declared: number, actual: number) =>
      `Byte count mismatch in '${recordType}' record: declared ${declared} bytes, but record contains ${actual} bytes.`,
  },
  RESERVED_RECORD_TYPE: {
    code: "SREC3001",
    rule: "srec-reserved-record-type",
    severity: "error" as const,
    message: (recordType: string) => `Invalid or reserved Motorola S-Record type '${recordType}' encountered.`,
  },
  RECORD_COUNT_MISMATCH: {
    code: "SREC3002",
    rule: "srec-record-count-mismatch",
    severity: "error" as const,
    message: (recordType: string, declared: number, actual: number) =>
      `Data record count mismatch in '${recordType}': declared ${declared}, but image contains ${actual} data records.`,
  },
  MISSING_TERMINATION: {
    code: "SREC4001",
    rule: "srec-missing-termination",
    severity: "error" as const,
    message: () => `Missing Motorola S-Record termination record ('S7', 'S8', or 'S9').`,
  },
  ADDRESS_WIDTH_MISMATCH: {
    code: "SREC4002",
    rule: "srec-address-width-mismatch",
    severity: "error" as const,
    message: (dataType: string, termType: string, expectedTerm: string) =>
      `Mismatched address width between data record '${dataType}' and termination record '${termType}' (expected '${expectedTerm}').`,
  },
  OVERLAPPING_ADDRESS: {
    code: "SREC5001",
    rule: "srec-overlapping-address",
    severity: "error" as const,
    message: (addrHex: string, count: number) =>
      `Overlapping memory write detected at address 0x${addrHex} (${count} overlapping byte(s) in record).`,
  },
  MISSING_HEADER: {
    code: "SREC5006",
    rule: "srec-missing-header",
    severity: "warning" as const,
    message: () => `Missing 'S0' header record at start of Motorola S-Record image.`,
  },
} as const;

export type SrecErrorCodeKey = keyof typeof SrecErrorCode;
