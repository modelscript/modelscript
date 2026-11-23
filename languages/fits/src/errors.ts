// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fits — Diagnostic Error Codes (`FITS1001`–`FITS5006`).
 *
 * Numbering scheme:
 * - `FITS1xxx`: Header syntax, card length & ASCII encoding
 * - `FITS2xxx`: Mandatory header keywords (`SIMPLE`, `END`, duplicates)
 * - `FITS3xxx`: Data array dimensions & `BITPIX` typing
 * - `FITS4xxx`: 2880-byte binary block framing & HDU extension rules
 * - `FITS5xxx`: WCS astrometry, scaling, table structure & payload consistency
 */

export interface FitsErrorDefinition {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: (...args: string[]) => string;
}

export const FitsErrorCode = {
  // 1xxx — Syntax, card length & character encoding
  CARD_LENGTH_ERROR: {
    code: "FITS1001",
    rule: "card-length-error",
    severity: "error" as const,
    message: (line: string, length: string) =>
      `FITS header card at line ${line} has length ${length}, exceeding the 80-character FITS 4.0 card limit.`,
  },
  NON_ASCII_CHARACTER: {
    code: "FITS1002",
    rule: "non-ascii-character",
    severity: "error" as const,
    message: (line: string, charCode: string) =>
      `Non-ASCII or non-printable character (0x${charCode}) in FITS header card at line ${line}; FITS 4.0 restricts headers to printable ASCII 0x20-0x7E.`,
  },
  MALFORMED_CARD_SYNTAX: {
    code: "FITS1003",
    rule: "malformed-card-syntax",
    severity: "error" as const,
    message: (keyword: string, reason: string) => `Malformed FITS header card for keyword '${keyword}': ${reason}.`,
  },

  // 2xxx — Mandatory keywords
  MISSING_SIMPLE_CARD: {
    code: "FITS2001",
    rule: "missing-simple-card",
    severity: "error" as const,
    message: (detail: string) => `Primary HDU must begin with mandatory keyword 'SIMPLE = T' (${detail}).`,
  },
  MISSING_END_CARD: {
    code: "FITS2002",
    rule: "missing-end-card",
    severity: "error" as const,
    message: (hduIndex: string) => `HDU #${hduIndex} header is missing the mandatory 'END' card.`,
  },
  DUPLICATE_MANDATORY_KEYWORD: {
    code: "FITS2003",
    rule: "duplicate-mandatory-keyword",
    severity: "error" as const,
    message: (keyword: string, hduIndex: string) => `Duplicate mandatory keyword '${keyword}' in HDU #${hduIndex}.`,
  },

  // 3xxx — BITPIX & NAXIS
  INVALID_BITPIX: {
    code: "FITS3001",
    rule: "invalid-bitpix",
    severity: "error" as const,
    message: (value: string, hduIndex: string) =>
      `Invalid 'BITPIX' value '${value}' in HDU #${hduIndex}; must be one of {8, 16, 32, 64, -32, -64}.`,
  },
  NAXIS_MISMATCH: {
    code: "FITS3002",
    rule: "naxis-mismatch",
    severity: "error" as const,
    message: (detail: string, hduIndex: string) => `NAXIS dimension mismatch in HDU #${hduIndex}: ${detail}.`,
  },

  // 4xxx — Binary 2880-byte framing & extensions
  NON_2880_BLOCK_ALIGNMENT: {
    code: "FITS4001",
    rule: "non-2880-block-alignment",
    severity: "error" as const,
    message: (byteLength: string) =>
      `Binary FITS stream length (${byteLength} bytes) is not a multiple of the mandatory 2880-byte FITS block size.`,
  },
  XTENSION_WITHOUT_EXTEND: {
    code: "FITS4002",
    rule: "xtension-without-extend",
    severity: "error" as const,
    message: (hduIndex: string, xtension: string) =>
      `Extension HDU #${hduIndex} ('${xtension}') is present, but Primary HDU does not declare 'EXTEND = T'.`,
  },

  // 5xxx — WCS, Scaling, Tables & Payload consistency
  INCOMPLETE_WCS_KEYWORDS: {
    code: "FITS5001",
    rule: "incomplete-wcs-keywords",
    severity: "warning" as const,
    message: (missing: string, hduIndex: string) =>
      `Incomplete WCS astrometry keywords in HDU #${hduIndex}: missing ${missing}.`,
  },
  UNSUPPORTED_WCS_PROJECTION: {
    code: "FITS5002",
    rule: "unsupported-wcs-projection",
    severity: "warning" as const,
    message: (ctype: string, hduIndex: string) =>
      `Unrecognized or mismatched WCS projection '${ctype}' in HDU #${hduIndex}.`,
  },
  SINGULAR_BSCALE: {
    code: "FITS5003",
    rule: "singular-bscale",
    severity: "error" as const,
    message: (hduIndex: string) =>
      `Invalid 'BSCALE = 0' in HDU #${hduIndex}; physical scaling factor must be non-zero.`,
  },
  INVALID_TABLE_SCHEMA: {
    code: "FITS5004",
    rule: "invalid-table-schema",
    severity: "error" as const,
    message: (detail: string, hduIndex: string) =>
      `Invalid FITS table extension schema in HDU #${hduIndex}: ${detail}.`,
  },
  INVALID_PCOUNT_GCOUNT: {
    code: "FITS5005",
    rule: "invalid-pcount-gcount",
    severity: "warning" as const,
    message: (detail: string, hduIndex: string) =>
      `Invalid 'PCOUNT'/'GCOUNT' specification in HDU #${hduIndex}: ${detail}.`,
  },
  DATA_PAYLOAD_SIZE_MISMATCH: {
    code: "FITS5006",
    rule: "data-payload-size-mismatch",
    severity: "error" as const,
    message: (expected: string, actual: string, hduIndex: string) =>
      `HDU #${hduIndex} data payload size mismatch: header specifies ${expected} bytes, but ${actual} bytes were decoded.`,
  },
} as const;

export type FitsErrorKey = keyof typeof FitsErrorCode;
