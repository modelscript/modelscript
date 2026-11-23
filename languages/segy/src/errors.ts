// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/segy — SEG-Y Rev 0 / Rev 1 Diagnostic Error Codes (SEGY1001–SEGY5006).
 */

export const SegyErrorCode = {
  SYNTAX_STREAM_ERROR: {
    code: "SEGY1001",
    rule: "segy-syntax-stream-error",
    severity: "error" as const,
    message: (detail: string) => `SEG-Y syntax or stream error: ${detail}.`,
  },
  TRUNCATED_REEL_HEADER: {
    code: "SEGY1002",
    rule: "segy-truncated-reel-header",
    severity: "error" as const,
    message: (actualBytes: number, expectedBytes: number) =>
      `Truncated SEG-Y reel header: stream has ${actualBytes} bytes, expected at least ${expectedBytes} bytes.`,
  },
  TRUNCATED_TRACE: {
    code: "SEGY1003",
    rule: "segy-truncated-trace",
    severity: "error" as const,
    message: (traceIndex: number, actualBytes: number, expectedBytes: number) =>
      `Truncated SEG-Y trace #${traceIndex}: available ${actualBytes} bytes, expected ${expectedBytes} bytes.`,
  },
  UNSUPPORTED_SAMPLE_FORMAT: {
    code: "SEGY2001",
    rule: "segy-unsupported-sample-format",
    severity: "error" as const,
    message: (formatCode: number) =>
      `Unsupported SEG-Y sample format code '${formatCode}' (valid: 1=IBM float32, 2=int32, 3=int16, 5=IEEE float32, 8=int8).`,
  },
  INVALID_MEASUREMENT_SYSTEM: {
    code: "SEGY2002",
    rule: "segy-invalid-measurement-system",
    severity: "warning" as const,
    message: (code: number) => `Invalid SEG-Y measurement system code '${code}' (valid: 1=meters, 2=feet).`,
  },
  NON_POSITIVE_SAMPLE_INTERVAL: {
    code: "SEGY3001",
    rule: "segy-non-positive-sample-interval",
    severity: "error" as const,
    message: (dtUs: number, context: string) =>
      `Non-positive SEG-Y sample interval Δt = ${dtUs} µs in ${context} (must be > 0).`,
  },
  NON_POSITIVE_SAMPLE_COUNT: {
    code: "SEGY3002",
    rule: "segy-non-positive-sample-count",
    severity: "error" as const,
    message: (count: number, context: string) =>
      `Non-positive SEG-Y sample count '${count}' in ${context} (must be > 0).`,
  },
  TRACE_SAMPLE_COUNT_MISMATCH: {
    code: "SEGY3003",
    rule: "segy-trace-sample-count-mismatch",
    severity: "error" as const,
    message: (traceIndex: number, traceSamples: number, headerSamples: number) =>
      `Trace #${traceIndex} sample count (${traceSamples}) does not match binary reel header samplesPerTrace (${headerSamples}).`,
  },
  DUPLICATE_TRACE_SEQUENCE: {
    code: "SEGY4001",
    rule: "segy-duplicate-trace-sequence",
    severity: "error" as const,
    message: (seqNum: number, traceIndex: number) =>
      `Duplicate trace sequence number '${seqNum}' at trace #${traceIndex}.`,
  },
  NON_MONOTONIC_TRACE_SEQUENCE: {
    code: "SEGY4002",
    rule: "segy-non-monotonic-trace-sequence",
    severity: "warning" as const,
    message: (seqNum: number, prevSeqNum: number, traceIndex: number) =>
      `Non-monotonic trace sequence number '${seqNum}' at trace #${traceIndex} (previous was '${prevSeqNum}').`,
  },
  NAN_INF_TRACE_AMPLITUDE: {
    code: "SEGY5001",
    rule: "segy-nan-inf-amplitude",
    severity: "error" as const,
    message: (traceIndex: number, sampleIndex: number, value: number) =>
      `Non-finite trace amplitude '${String(value)}' at trace #${traceIndex}, sample #${sampleIndex}.`,
  },
  MISSING_END_TEXTUAL_HEADER: {
    code: "SEGY5006",
    rule: "segy-missing-end-textual-header",
    severity: "warning" as const,
    message: () => "SEG-Y Rev 1 textual reel header is missing the 'END TEXTUAL HEADER' sentinel card.",
  },
} as const;

export type SegyErrorCodeKey = keyof typeof SegyErrorCode;
