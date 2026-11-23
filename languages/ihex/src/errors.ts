// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Error and warning codes for `@modelscript/ihex` (`IHEX1001`–`IHEX5006`).
 */

export interface IhexErrorDescriptor {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: (...args: string[]) => string;
}

export const IhexErrorCode = {
  MISSING_START_CODE: {
    code: "IHEX1001",
    rule: "missing-start-code",
    severity: "error" as const,
    message: (line: string) => `Intel HEX record on line ${line} does not start with ':' start code.`,
  },
  INVALID_HEX_SYNTAX: {
    code: "IHEX1002",
    rule: "invalid-hex-syntax",
    severity: "error" as const,
    message: (line: string, detail: string) => `Invalid hexadecimal syntax on line ${line}: ${detail}.`,
  },
  TRUNCATED_RECORD: {
    code: "IHEX1003",
    rule: "truncated-record",
    severity: "error" as const,
    message: (line: string, len: string) =>
      `Truncated Intel HEX record on line ${line} (${len} characters; minimum is 11 for ':LLAAAATTCC').`,
  },
  CHECKSUM_MISMATCH: {
    code: "IHEX2001",
    rule: "checksum-mismatch",
    severity: "error" as const,
    message: (line: string, got: string, expected: string) =>
      `2's-complement checksum mismatch on line ${line}: got 0x${got}, expected 0x${expected}.`,
  },
  BYTE_COUNT_MISMATCH: {
    code: "IHEX2002",
    rule: "byte-count-mismatch",
    severity: "error" as const,
    message: (line: string, declared: string, actual: string) =>
      `Declared byte count (${declared}) does not match actual payload length (${actual}) on line ${line}.`,
  },
  UNSUPPORTED_RECORD_TYPE: {
    code: "IHEX3001",
    rule: "unsupported-record-type",
    severity: "error" as const,
    message: (line: string, recType: string) =>
      `Unsupported Intel HEX record type 0x${recType} on line ${line} (standard types are 0x00–0x05).`,
  },
  INVALID_PAYLOAD_LENGTH: {
    code: "IHEX3002",
    rule: "invalid-payload-length",
    severity: "error" as const,
    message: (line: string, recType: string, actual: string, expected: string) =>
      `Record type 0x${recType} on line ${line} has payload length ${actual}, expected ${expected}.`,
  },
  NONZERO_CONTROL_ADDRESS: {
    code: "IHEX3003",
    rule: "nonzero-control-address",
    severity: "warning" as const,
    message: (line: string, recType: string, address: string) =>
      `Control record type 0x${recType} on line ${line} has non-zero address field 0x${address} (expected 0x0000).`,
  },
  MISSING_EOF_RECORD: {
    code: "IHEX4001",
    rule: "missing-eof-record",
    severity: "error" as const,
    message: () => "Intel HEX image is missing a terminating End-Of-File (0x01) record ':00000001FF'.",
  },
  RECORDS_AFTER_EOF: {
    code: "IHEX4002",
    rule: "records-after-eof",
    severity: "warning" as const,
    message: (line: string, eofLine: string) =>
      `Record on line ${line} appears after End-Of-File (0x01) record on line ${eofLine}.`,
  },
  DUPLICATE_EOF_RECORD: {
    code: "IHEX4003",
    rule: "duplicate-eof-record",
    severity: "warning" as const,
    message: (line: string, firstEofLine: string) =>
      `Duplicate End-Of-File (0x01) record on line ${line} (first EOF was on line ${firstEofLine}).`,
  },
  OVERLAPPING_ADDRESS: {
    code: "IHEX5001",
    rule: "overlapping-address",
    severity: "error" as const,
    message: (address: string, line: string, prevLine: string) =>
      `Overlapping memory address 0x${address} on line ${line} (previously written on line ${prevLine}).`,
  },
  LARGE_UNINITIALIZED_GAP: {
    code: "IHEX5002",
    rule: "large-uninitialized-gap",
    severity: "warning" as const,
    message: (gapBytes: string, prevEnd: string, nextStart: string) =>
      `Large uninitialized memory gap of ${gapBytes} bytes between 0x${prevEnd} and 0x${nextStart}.`,
  },
  EMPTY_IMAGE: {
    code: "IHEX5003",
    rule: "empty-image",
    severity: "warning" as const,
    message: () => "Intel HEX image contains no data (0x00) records.",
  },
  ADDRESS_WRAPAROUND: {
    code: "IHEX5004",
    rule: "address-wraparound",
    severity: "warning" as const,
    message: (line: string, address: string, len: string) =>
      `Data record on line ${line} at 0x${address} with ${len} bytes wraps past 16-bit 0xFFFF boundary.`,
  },
  MIXED_ADDRESSING_MODES: {
    code: "IHEX5005",
    rule: "mixed-addressing-modes",
    severity: "warning" as const,
    message: (line: string) =>
      `Record on line ${line} mixes I16HEX extended segment (0x02/0x03) and I32HEX extended linear (0x04/0x05) addressing.`,
  },
  UNALIGNED_ENTRY_POINT: {
    code: "IHEX5006",
    rule: "unaligned-entry-point",
    severity: "info" as const,
    message: (entryAddress: string) =>
      `Start entry address 0x${entryAddress} does not fall within any defined data segment.`,
  },
} as const;

export type IhexErrorCodeKey = keyof typeof IhexErrorCode;
