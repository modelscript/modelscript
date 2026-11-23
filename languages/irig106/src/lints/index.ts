// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static semantic & frame-integrity linter for IRIG 106 Chapter 9 TMATS (`IRIG1001`–`IRIG5006`).
 */

import { Irig106ErrorCode, type Irig106Severity } from "../errors.js";
import { parseIrig106 } from "../parser/tmats-parser.js";
import { buildCommutatorGrid, expandFramePositions, expandWordPositions } from "../solver/commutator.js";
import type { TmatsModel } from "../types.js";

export interface Irig106Diagnostic {
  code: string;
  rule: string;
  severity: Irig106Severity;
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

const STANDARD_SYNC_BIT_WIDTHS = new Set([16, 24, 32]);

/**
 * Runs all IRIG 106 Chapter 9 TMATS diagnostics (`IRIG1001`–`IRIG5006`).
 */
export function lintIrig106(modelOrSource: TmatsModel | string): Irig106Diagnostic[] {
  const model = typeof modelOrSource === "string" ? parseIrig106(modelOrSource) : modelOrSource;
  const diagnostics: Irig106Diagnostic[] = [];

  // 1. IRIG1001: Syntax / Missing ';' terminator errors
  for (const err of model.parseErrors) {
    diagnostics.push({
      code: Irig106ErrorCode.SYNTAX_ERROR.code,
      rule: Irig106ErrorCode.SYNTAX_ERROR.rule,
      severity: Irig106ErrorCode.SYNTAX_ERROR.severity,
      message: Irig106ErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
      startOffset: err.startOffset,
      endOffset: err.endOffset,
    });
  }

  // 2. IRIG2001: Duplicate TMATS attribute codes (excluding COMMENT)
  const seenCodes = new Map<string, number>();
  for (const attr of model.attributes) {
    if (attr.group === "COMMENT") continue;
    const prevLine = seenCodes.get(attr.rawCode);
    if (prevLine !== undefined) {
      diagnostics.push({
        code: Irig106ErrorCode.DUPLICATE_ATTRIBUTE_CODE.code,
        rule: Irig106ErrorCode.DUPLICATE_ATTRIBUTE_CODE.rule,
        severity: Irig106ErrorCode.DUPLICATE_ATTRIBUTE_CODE.severity,
        message: Irig106ErrorCode.DUPLICATE_ATTRIBUTE_CODE.message(attr.rawCode, prevLine),
        line: attr.line,
        column: attr.column,
        startOffset: attr.startOffset,
        endOffset: attr.endOffset,
      });
    } else {
      seenCodes.set(attr.rawCode, attr.line);
    }
  }

  // 3. PCM Format checks (IRIG5001, IRIG5002, IRIG5003, IRIG5006)
  for (const pcm of model.pcmFormats.values()) {
    const pcmId = pcm.dataLinkName ?? `P-${pcm.index}`;
    const line = pcm.line ?? 1;
    const startOffset = pcm.startOffset ?? 0;
    const endOffset = pcm.endOffset ?? 0;

    // IRIG5002: Missing sync pattern MF4
    if (!pcm.syncPattern) {
      diagnostics.push({
        code: Irig106ErrorCode.MISSING_SYNC_PATTERN.code,
        rule: Irig106ErrorCode.MISSING_SYNC_PATTERN.rule,
        severity: Irig106ErrorCode.MISSING_SYNC_PATTERN.severity,
        message: Irig106ErrorCode.MISSING_SYNC_PATTERN.message(pcmId),
        line,
        column: 1,
        startOffset,
        endOffset,
      });
    }

    // IRIG5003: Invalid common word length F1
    if (pcm.commonWordLengthBits !== undefined) {
      const f1 = pcm.commonWordLengthBits;
      if (!Number.isInteger(f1) || f1 < 4 || f1 > 64) {
        diagnostics.push({
          code: Irig106ErrorCode.INVALID_WORD_LENGTH.code,
          rule: Irig106ErrorCode.INVALID_WORD_LENGTH.rule,
          severity: Irig106ErrorCode.INVALID_WORD_LENGTH.severity,
          message: Irig106ErrorCode.INVALID_WORD_LENGTH.message(pcmId, f1),
          line,
          column: 1,
          startOffset,
          endOffset,
        });
      }
    }

    // IRIG5001: Bit-rate / minor-frame-rate / bit-budget mismatch
    if (
      pcm.wordsPerMinorFrame !== undefined &&
      pcm.commonWordLengthBits !== undefined &&
      pcm.bitsPerMinorFrame !== undefined
    ) {
      const dataBits = pcm.wordsPerMinorFrame * pcm.commonWordLengthBits;
      const syncBits = pcm.syncPatternBits ?? 0;
      if (pcm.bitsPerMinorFrame < dataBits) {
        diagnostics.push({
          code: Irig106ErrorCode.BIT_RATE_FRAME_MISMATCH.code,
          rule: Irig106ErrorCode.BIT_RATE_FRAME_MISMATCH.rule,
          severity: Irig106ErrorCode.BIT_RATE_FRAME_MISMATCH.severity,
          message: Irig106ErrorCode.BIT_RATE_FRAME_MISMATCH.message(
            pcmId,
            `MF2 (${pcm.bitsPerMinorFrame} bits) is smaller than MF1*F1 (${dataBits} bits)`,
          ),
          line,
          column: 1,
          startOffset,
          endOffset,
        });
      } else if (syncBits > 0 && dataBits + syncBits !== pcm.bitsPerMinorFrame) {
        const expectedSyncBudget = pcm.bitsPerMinorFrame - dataBits;
        diagnostics.push({
          code: Irig106ErrorCode.SYNC_PATTERN_LENGTH_MISMATCH.code,
          rule: Irig106ErrorCode.SYNC_PATTERN_LENGTH_MISMATCH.rule,
          severity: Irig106ErrorCode.SYNC_PATTERN_LENGTH_MISMATCH.severity,
          message: Irig106ErrorCode.SYNC_PATTERN_LENGTH_MISMATCH.message(pcmId, syncBits, expectedSyncBudget),
          line,
          column: 1,
          startOffset,
          endOffset,
        });
      }
    }

    if (
      pcm.declaredMinorFrameRateHz !== undefined &&
      pcm.bitRateBps !== undefined &&
      pcm.bitsPerMinorFrame !== undefined &&
      pcm.bitsPerMinorFrame > 0
    ) {
      const computedRate = pcm.bitRateBps / pcm.bitsPerMinorFrame;
      const relDiff =
        Math.abs(computedRate - pcm.declaredMinorFrameRateHz) / Math.max(1e-9, pcm.declaredMinorFrameRateHz);
      if (relDiff > 1e-6) {
        diagnostics.push({
          code: Irig106ErrorCode.BIT_RATE_FRAME_MISMATCH.code,
          rule: Irig106ErrorCode.BIT_RATE_FRAME_MISMATCH.rule,
          severity: Irig106ErrorCode.BIT_RATE_FRAME_MISMATCH.severity,
          message: Irig106ErrorCode.BIT_RATE_FRAME_MISMATCH.message(
            pcmId,
            `D1/MF2 (${computedRate.toFixed(4)} Hz) != declared minor frame rate (${pcm.declaredMinorFrameRateHz} Hz)`,
          ),
          line,
          column: 1,
          startOffset,
          endOffset,
        });
      }
    }

    if (pcm.syncPattern && pcm.syncPatternBits !== undefined && pcm.syncPatternBits > 0) {
      if (!STANDARD_SYNC_BIT_WIDTHS.has(pcm.syncPatternBits) && pcm.bitsPerMinorFrame === undefined) {
        diagnostics.push({
          code: Irig106ErrorCode.SYNC_PATTERN_LENGTH_MISMATCH.code,
          rule: Irig106ErrorCode.SYNC_PATTERN_LENGTH_MISMATCH.rule,
          severity: Irig106ErrorCode.SYNC_PATTERN_LENGTH_MISMATCH.severity,
          message: Irig106ErrorCode.SYNC_PATTERN_LENGTH_MISMATCH.message(pcmId, pcm.syncPatternBits, 24),
          line,
          column: 1,
          startOffset,
          endOffset,
        });
      }
    }

    // Commutator overlap checks (IRIG3002)
    const gridResult = buildCommutatorGrid(model, pcm.index);
    for (const conflict of gridResult.conflicts) {
      diagnostics.push({
        code: Irig106ErrorCode.OVERLAPPING_PCM_ALLOCATION.code,
        rule: Irig106ErrorCode.OVERLAPPING_PCM_ALLOCATION.rule,
        severity: Irig106ErrorCode.OVERLAPPING_PCM_ALLOCATION.severity,
        message: Irig106ErrorCode.OVERLAPPING_PCM_ALLOCATION.message(
          conflict.measurementA,
          conflict.measurementB,
          conflict.frameIndex,
          conflict.wordPosition,
        ),
        line: conflict.line,
        column: 1,
        startOffset,
        endOffset,
      });
    }
  }

  // 4. Measurement checks (IRIG3001, IRIG4001, IRIG5004)
  for (const dg of model.measurementGroups.values()) {
    // Find associated PCM format
    let pcm = model.pcmFormats.get(dg.index);
    if (dg.dataLinkName) {
      for (const candidate of model.pcmFormats.values()) {
        if (candidate.dataLinkName === dg.dataLinkName) {
          pcm = candidate;
          break;
        }
      }
    }
    const maxWords = pcm?.wordsPerMinorFrame;
    const maxFrames = pcm?.minorFramesPerMajorFrame ?? 1;

    for (const meas of dg.measurements) {
      // IRIG3001: Word position out of bounds
      if (maxWords !== undefined && meas.wordPosition !== undefined) {
        const wps = expandWordPositions(meas, maxWords);
        for (const wp of wps) {
          if (wp < 1 || wp > maxWords) {
            diagnostics.push({
              code: Irig106ErrorCode.WORD_POSITION_OUT_OF_BOUNDS.code,
              rule: Irig106ErrorCode.WORD_POSITION_OUT_OF_BOUNDS.rule,
              severity: Irig106ErrorCode.WORD_POSITION_OUT_OF_BOUNDS.severity,
              message: Irig106ErrorCode.WORD_POSITION_OUT_OF_BOUNDS.message(meas.name, wp, maxWords),
              line: meas.line,
              column: 1,
              startOffset: meas.startOffset,
              endOffset: meas.endOffset,
            });
          }
        }
      }

      // IRIG5004: Frame position exceeds major frame depth
      if (pcm) {
        const fps = expandFramePositions(meas, maxFrames);
        for (const fp of fps) {
          if (fp < 1 || fp > maxFrames) {
            diagnostics.push({
              code: Irig106ErrorCode.INVALID_FRAME_POSITION.code,
              rule: Irig106ErrorCode.INVALID_FRAME_POSITION.rule,
              severity: Irig106ErrorCode.INVALID_FRAME_POSITION.severity,
              message: Irig106ErrorCode.INVALID_FRAME_POSITION.message(meas.name, fp, maxFrames),
              line: meas.line,
              column: 1,
              startOffset: meas.startOffset,
              endOffset: meas.endOffset,
            });
          }
        }
      }

      // IRIG4001: Undefined C-x conversion reference
      if (!model.conversionsByName.has(meas.name)) {
        diagnostics.push({
          code: Irig106ErrorCode.UNDEFINED_CONVERSION_REF.code,
          rule: Irig106ErrorCode.UNDEFINED_CONVERSION_REF.rule,
          severity: Irig106ErrorCode.UNDEFINED_CONVERSION_REF.severity,
          message: Irig106ErrorCode.UNDEFINED_CONVERSION_REF.message(meas.name),
          line: meas.line,
          column: 1,
          startOffset: meas.startOffset,
          endOffset: meas.endOffset,
        });
      }
    }
  }

  // 5. Conversion checks (IRIG5005)
  for (const conv of model.conversions.values()) {
    if (conv.conversionType === "COE" && conv.coefficients.length === 0) {
      diagnostics.push({
        code: Irig106ErrorCode.MISSING_POLYNOMIAL_COEFFICIENTS.code,
        rule: Irig106ErrorCode.MISSING_POLYNOMIAL_COEFFICIENTS.rule,
        severity: Irig106ErrorCode.MISSING_POLYNOMIAL_COEFFICIENTS.severity,
        message: Irig106ErrorCode.MISSING_POLYNOMIAL_COEFFICIENTS.message(conv.measurementName),
        line: conv.line,
        column: 1,
        startOffset: conv.startOffset,
        endOffset: conv.endOffset,
      });
    }
  }

  return diagnostics;
}

export { Irig106ErrorCode } from "../errors.js";
