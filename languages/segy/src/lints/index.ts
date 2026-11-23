// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/segy — Static Analysis & Linter Engine (SEGY1001–SEGY5006).
 */

import { SegyErrorCode } from "../errors.js";
import { parseSegyTextualHeader } from "../parser/textual-header.js";
import { SegyMeasurementSystem, VALID_SEGY_SAMPLE_FORMATS, type SegyFile, type SegyTextualHeader } from "../types.js";

export interface SegyDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number | undefined;
  column?: number | undefined;
  byteOffset?: number | undefined;
  traceIndex?: number | undefined;
}

/**
 * Validates a SEG-Y textual reel header string or parsed `SegyTextualHeader`.
 */
export function lintSegyTextualHeader(input: string | SegyTextualHeader): SegyDiagnostic[] {
  const header = typeof input === "string" ? parseSegyTextualHeader(input) : input;
  const diags: SegyDiagnostic[] = [];

  if (header.cards.length === 0) {
    diags.push({
      code: SegyErrorCode.SYNTAX_STREAM_ERROR.code,
      rule: SegyErrorCode.SYNTAX_STREAM_ERROR.rule,
      severity: SegyErrorCode.SYNTAX_STREAM_ERROR.severity,
      message: SegyErrorCode.SYNTAX_STREAM_ERROR.message("Empty textual reel header"),
      line: 1,
      column: 1,
    });
    return diags;
  }

  for (const card of header.cards) {
    const trimmed = card.raw.trim();
    if (trimmed.length > 0 && !/^C\s*\d{1,2}\b/i.test(trimmed)) {
      diags.push({
        code: SegyErrorCode.SYNTAX_STREAM_ERROR.code,
        rule: SegyErrorCode.SYNTAX_STREAM_ERROR.rule,
        severity: SegyErrorCode.SYNTAX_STREAM_ERROR.severity,
        message: SegyErrorCode.SYNTAX_STREAM_ERROR.message(
          `Card on line ${card.line} does not begin with a valid C 1..C40 card prefix`,
        ),
        line: card.line,
        column: 1,
      });
    }
  }

  if (header.sampleIntervalUs !== undefined && header.sampleIntervalUs <= 0) {
    diags.push({
      code: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.code,
      rule: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.rule,
      severity: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.severity,
      message: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.message(header.sampleIntervalUs, "textual reel header"),
      line: header.cards.find((c) => c.key === "SAMPLE INTERVAL")?.line ?? 1,
    });
  }

  if (header.revision && header.revision.startsWith("1") && !header.hasEndTextualHeader) {
    diags.push({
      code: SegyErrorCode.MISSING_END_TEXTUAL_HEADER.code,
      rule: SegyErrorCode.MISSING_END_TEXTUAL_HEADER.rule,
      severity: SegyErrorCode.MISSING_END_TEXTUAL_HEADER.severity,
      message: SegyErrorCode.MISSING_END_TEXTUAL_HEADER.message(),
      line: header.cards.length,
    });
  }

  return diags;
}

/**
 * Validates a decoded `SegyFile` against SEG-Y Rev 0 / Rev 1 structural and numerical rules.
 */
export function lintSegy(file: SegyFile): SegyDiagnostic[] {
  const diags: SegyDiagnostic[] = [];

  // 1. Stream-level framing issues (truncated reel/trace headers, format errors during decode)
  const reportedUnsupportedFormat = new Set<number>();
  for (const issue of file.streamIssues) {
    if (issue.code === SegyErrorCode.TRUNCATED_REEL_HEADER.code) {
      diags.push({
        code: SegyErrorCode.TRUNCATED_REEL_HEADER.code,
        rule: SegyErrorCode.TRUNCATED_REEL_HEADER.rule,
        severity: SegyErrorCode.TRUNCATED_REEL_HEADER.severity,
        message: issue.message,
        byteOffset: issue.byteOffset,
      });
    } else if (issue.code === SegyErrorCode.TRUNCATED_TRACE.code) {
      diags.push({
        code: SegyErrorCode.TRUNCATED_TRACE.code,
        rule: SegyErrorCode.TRUNCATED_TRACE.rule,
        severity: SegyErrorCode.TRUNCATED_TRACE.severity,
        message: issue.message,
        byteOffset: issue.byteOffset,
        traceIndex: issue.traceIndex,
      });
    } else if (issue.code === SegyErrorCode.UNSUPPORTED_SAMPLE_FORMAT.code) {
      reportedUnsupportedFormat.add(file.binaryHeader.sampleFormatCode);
      diags.push({
        code: SegyErrorCode.UNSUPPORTED_SAMPLE_FORMAT.code,
        rule: SegyErrorCode.UNSUPPORTED_SAMPLE_FORMAT.rule,
        severity: SegyErrorCode.UNSUPPORTED_SAMPLE_FORMAT.severity,
        message: issue.message,
        byteOffset: issue.byteOffset,
      });
    } else {
      diags.push({
        code: SegyErrorCode.SYNTAX_STREAM_ERROR.code,
        rule: SegyErrorCode.SYNTAX_STREAM_ERROR.rule,
        severity: SegyErrorCode.SYNTAX_STREAM_ERROR.severity,
        message: issue.message,
        byteOffset: issue.byteOffset,
      });
    }
  }

  const hasTruncatedReel = file.streamIssues.some((i) => i.code === SegyErrorCode.TRUNCATED_REEL_HEADER.code);
  if (hasTruncatedReel) {
    return diags;
  }

  // 2. Binary reel header checks
  const bh = file.binaryHeader;
  if (!VALID_SEGY_SAMPLE_FORMATS.has(bh.sampleFormatCode) && !reportedUnsupportedFormat.has(bh.sampleFormatCode)) {
    diags.push({
      code: SegyErrorCode.UNSUPPORTED_SAMPLE_FORMAT.code,
      rule: SegyErrorCode.UNSUPPORTED_SAMPLE_FORMAT.rule,
      severity: SegyErrorCode.UNSUPPORTED_SAMPLE_FORMAT.severity,
      message: SegyErrorCode.UNSUPPORTED_SAMPLE_FORMAT.message(bh.sampleFormatCode),
      byteOffset: 3224,
    });
  }

  if (bh.sampleIntervalUs <= 0) {
    diags.push({
      code: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.code,
      rule: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.rule,
      severity: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.severity,
      message: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.message(bh.sampleIntervalUs, "binary reel header"),
      byteOffset: 3216,
    });
  }

  if (bh.samplesPerTrace <= 0) {
    diags.push({
      code: SegyErrorCode.NON_POSITIVE_SAMPLE_COUNT.code,
      rule: SegyErrorCode.NON_POSITIVE_SAMPLE_COUNT.rule,
      severity: SegyErrorCode.NON_POSITIVE_SAMPLE_COUNT.severity,
      message: SegyErrorCode.NON_POSITIVE_SAMPLE_COUNT.message(bh.samplesPerTrace, "binary reel header"),
      byteOffset: 3220,
    });
  }

  if (bh.measurementSystem !== SegyMeasurementSystem.METERS && bh.measurementSystem !== SegyMeasurementSystem.FEET) {
    diags.push({
      code: SegyErrorCode.INVALID_MEASUREMENT_SYSTEM.code,
      rule: SegyErrorCode.INVALID_MEASUREMENT_SYSTEM.rule,
      severity: SegyErrorCode.INVALID_MEASUREMENT_SYSTEM.severity,
      message: SegyErrorCode.INVALID_MEASUREMENT_SYSTEM.message(bh.measurementSystem),
      byteOffset: 3254,
    });
  }

  // Rev 1 textual header END TEXTUAL HEADER check
  if (bh.segyRevision >= 0x0100 && !file.textualHeader.hasEndTextualHeader) {
    diags.push({
      code: SegyErrorCode.MISSING_END_TEXTUAL_HEADER.code,
      rule: SegyErrorCode.MISSING_END_TEXTUAL_HEADER.rule,
      severity: SegyErrorCode.MISSING_END_TEXTUAL_HEADER.severity,
      message: SegyErrorCode.MISSING_END_TEXTUAL_HEADER.message(),
      line: 40,
    });
  }

  // 3. Per-trace checks
  const seenSeq = new Set<number>();
  let prevSeq: number | undefined;

  for (let i = 0; i < file.traces.length; i++) {
    const trace = file.traces[i]!;
    const th = trace.header;

    if (th.sampleIntervalUs <= 0 && bh.sampleIntervalUs > 0) {
      // Allow 0 in trace header when inheriting binary header, only flag negative
      if (th.sampleIntervalUs < 0) {
        diags.push({
          code: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.code,
          rule: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.rule,
          severity: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.severity,
          message: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.message(th.sampleIntervalUs, `trace #${i}`),
          traceIndex: i,
          byteOffset: trace.byteOffset,
        });
      }
    } else if (th.sampleIntervalUs < 0) {
      diags.push({
        code: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.code,
        rule: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.rule,
        severity: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.severity,
        message: SegyErrorCode.NON_POSITIVE_SAMPLE_INTERVAL.message(th.sampleIntervalUs, `trace #${i}`),
        traceIndex: i,
        byteOffset: trace.byteOffset,
      });
    }

    const effectiveSamples = th.sampleCount > 0 ? th.sampleCount : trace.samples.length;
    if (effectiveSamples <= 0) {
      diags.push({
        code: SegyErrorCode.NON_POSITIVE_SAMPLE_COUNT.code,
        rule: SegyErrorCode.NON_POSITIVE_SAMPLE_COUNT.rule,
        severity: SegyErrorCode.NON_POSITIVE_SAMPLE_COUNT.severity,
        message: SegyErrorCode.NON_POSITIVE_SAMPLE_COUNT.message(effectiveSamples, `trace #${i}`),
        traceIndex: i,
        byteOffset: trace.byteOffset,
      });
    } else if (bh.samplesPerTrace > 0 && effectiveSamples !== bh.samplesPerTrace) {
      diags.push({
        code: SegyErrorCode.TRACE_SAMPLE_COUNT_MISMATCH.code,
        rule: SegyErrorCode.TRACE_SAMPLE_COUNT_MISMATCH.rule,
        severity: SegyErrorCode.TRACE_SAMPLE_COUNT_MISMATCH.severity,
        message: SegyErrorCode.TRACE_SAMPLE_COUNT_MISMATCH.message(i, effectiveSamples, bh.samplesPerTrace),
        traceIndex: i,
        byteOffset: trace.byteOffset,
      });
    }

    const seqNum = th.traceSeqLine;
    if (seenSeq.has(seqNum)) {
      diags.push({
        code: SegyErrorCode.DUPLICATE_TRACE_SEQUENCE.code,
        rule: SegyErrorCode.DUPLICATE_TRACE_SEQUENCE.rule,
        severity: SegyErrorCode.DUPLICATE_TRACE_SEQUENCE.severity,
        message: SegyErrorCode.DUPLICATE_TRACE_SEQUENCE.message(seqNum, i),
        traceIndex: i,
        byteOffset: trace.byteOffset,
      });
    } else if (prevSeq !== undefined && seqNum < prevSeq) {
      diags.push({
        code: SegyErrorCode.NON_MONOTONIC_TRACE_SEQUENCE.code,
        rule: SegyErrorCode.NON_MONOTONIC_TRACE_SEQUENCE.rule,
        severity: SegyErrorCode.NON_MONOTONIC_TRACE_SEQUENCE.severity,
        message: SegyErrorCode.NON_MONOTONIC_TRACE_SEQUENCE.message(seqNum, prevSeq, i),
        traceIndex: i,
        byteOffset: trace.byteOffset,
      });
    }
    seenSeq.add(seqNum);
    prevSeq = seqNum;

    // Check for NaN / Infinity in trace samples (report first occurrence per trace)
    for (let s = 0; s < trace.samples.length; s++) {
      const v = trace.samples[s]!;
      if (!Number.isFinite(v)) {
        diags.push({
          code: SegyErrorCode.NAN_INF_TRACE_AMPLITUDE.code,
          rule: SegyErrorCode.NAN_INF_TRACE_AMPLITUDE.rule,
          severity: SegyErrorCode.NAN_INF_TRACE_AMPLITUDE.severity,
          message: SegyErrorCode.NAN_INF_TRACE_AMPLITUDE.message(i, s, v),
          traceIndex: i,
          byteOffset: trace.byteOffset,
        });
        break;
      }
    }
  }

  return diags;
}
