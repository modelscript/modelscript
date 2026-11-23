// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/irig106` (IRIG 106 Chapter 9 TMATS).
 *
 * Numbering:
 * - IRIG1xxx: Syntax / Terminator errors
 * - IRIG2xxx: Duplicate / Structural attribute declarations
 * - IRIG3xxx: PCM Minor/Major Frame slot allocation & bounds
 * - IRIG4xxx: Cross-group references (D-x -> C-x)
 * - IRIG5xxx: PCM Format timing, sync pattern, word length & calibration integrity
 */

export type Irig106Severity = "error" | "warning" | "info";

export interface Irig106ErrorSpec<Args extends unknown[] = string[]> {
  code: string;
  rule: string;
  severity: Irig106Severity;
  message: (...args: Args) => string;
}

export const Irig106ErrorCode = {
  SYNTAX_ERROR: {
    code: "IRIG1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `TMATS syntax error: ${detail}.`,
  },
  DUPLICATE_ATTRIBUTE_CODE: {
    code: "IRIG2001",
    rule: "duplicate-attribute-code",
    severity: "error" as const,
    message: (attrCode: string, firstLine: number) =>
      `Duplicate TMATS attribute code '${attrCode}' (first declared at line ${firstLine}).`,
  },
  WORD_POSITION_OUT_OF_BOUNDS: {
    code: "IRIG3001",
    rule: "word-position-out-of-bounds",
    severity: "error" as const,
    message: (measurement: string, wordPos: number, maxWords: number) =>
      `PCM measurement '${measurement}' word position ${wordPos} is out of minor frame bounds [1, ${maxWords}].`,
  },
  OVERLAPPING_PCM_ALLOCATION: {
    code: "IRIG3002",
    rule: "overlapping-pcm-allocation",
    severity: "error" as const,
    message: (measA: string, measB: string, frameIdx: number, wordPos: number) =>
      `Overlapping PCM word/bit allocation between '${measA}' and '${measB}' at minor frame ${frameIdx}, word ${wordPos}.`,
  },
  UNDEFINED_CONVERSION_REF: {
    code: "IRIG4001",
    rule: "undefined-conversion-ref",
    severity: "error" as const,
    message: (measurement: string) =>
      `PCM measurement '${measurement}' references undefined C-x data conversion '${measurement}'.`,
  },
  BIT_RATE_FRAME_MISMATCH: {
    code: "IRIG5001",
    rule: "bit-rate-frame-mismatch",
    severity: "error" as const,
    message: (pcmId: string, detail: string) =>
      `PCM format '${pcmId}' bit-rate / minor-frame-rate mismatch: ${detail}.`,
  },
  MISSING_SYNC_PATTERN: {
    code: "IRIG5002",
    rule: "missing-sync-pattern",
    severity: "error" as const,
    message: (pcmId: string) =>
      `PCM format '${pcmId}' is missing required minor frame synchronization pattern (P-x\\MF4).`,
  },
  INVALID_WORD_LENGTH: {
    code: "IRIG5003",
    rule: "invalid-word-length",
    severity: "error" as const,
    message: (pcmId: string, wordLen: number) =>
      `PCM format '${pcmId}' has invalid common word length P-x\\F1=${wordLen} (must be an integer in [4, 64] bits).`,
  },
  INVALID_FRAME_POSITION: {
    code: "IRIG5004",
    rule: "invalid-frame-position",
    severity: "error" as const,
    message: (measurement: string, framePos: number, maxFrames: number) =>
      `PCM measurement '${measurement}' subcommutation frame position ${framePos} exceeds major frame depth ${maxFrames}.`,
  },
  MISSING_POLYNOMIAL_COEFFICIENTS: {
    code: "IRIG5005",
    rule: "missing-polynomial-coefficients",
    severity: "warning" as const,
    message: (convName: string) =>
      `Data conversion '${convName}' has type 'COE' but defines no polynomial coefficients (CO-n).`,
  },
  SYNC_PATTERN_LENGTH_MISMATCH: {
    code: "IRIG5006",
    rule: "sync-pattern-length-mismatch",
    severity: "warning" as const,
    message: (pcmId: string, syncBits: number, expectedBits: number) =>
      `PCM format '${pcmId}' sync pattern length (${syncBits} bits) does not match minor frame sync budget (${expectedBits} bits).`,
  },
} as const;

export type Irig106ErrorKey = keyof typeof Irig106ErrorCode;
