// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Firmware Image Integrity Linter for `@modelscript/ihex` (`IHEX1001`–`IHEX5006`).
 */

import { IhexErrorCode } from "../errors.js";
import { hexByte, hexDword, hexWord } from "../parser/index.js";
import { coalesceIhexMemoryMap } from "../solver/index.js";
import { IhexRecordType, type IhexLintDiagnostic, type IhexModel } from "../types.js";

export { IhexErrorCode };

export interface IhexLintOptions {
  /** Threshold in bytes above which an uninitialized gap triggers IHEX5002 (default 65536 = 64 KiB) */
  largeGapThresholdBytes?: number | undefined;
}

const EXPECTED_CONTROL_LENGTH: Record<number, number> = {
  [IhexRecordType.Eof]: 0,
  [IhexRecordType.ExtendedSegmentAddress]: 2,
  [IhexRecordType.StartSegmentAddress]: 4,
  [IhexRecordType.ExtendedLinearAddress]: 2,
  [IhexRecordType.StartLinearAddress]: 4,
};

/**
 * Runs all Intel HEX integrity checks (`IHEX1001`–`IHEX5006`) on a parsed `IhexModel`.
 */
export function lintIhex(model: IhexModel, options: IhexLintOptions = {}): IhexLintDiagnostic[] {
  const diags: IhexLintDiagnostic[] = [];
  const gapThreshold = options.largeGapThresholdBytes ?? 65536;

  // 1. Surface parser-level syntax errors (IHEX1001–IHEX1003)
  for (const err of model.parseErrors) {
    const rule =
      err.code === "IHEX1001"
        ? IhexErrorCode.MISSING_START_CODE.rule
        : err.code === "IHEX1003"
          ? IhexErrorCode.TRUNCATED_RECORD.rule
          : IhexErrorCode.INVALID_HEX_SYNTAX.rule;
    diags.push({
      code: err.code,
      rule,
      severity: "error",
      message: err.message,
      line: err.lineNumber,
      column: err.column,
      endColumn: err.column + Math.max(1, err.raw.length),
    });
  }

  let firstEofLine: number | undefined;
  let seenSegMode = false;
  let seenLinMode = false;
  let dataRecordCount = 0;

  for (const rec of model.records) {
    const lineStr = String(rec.lineNumber);

    // IHEX2002: Byte count mismatch
    if (!rec.byteCountValid) {
      diags.push({
        code: IhexErrorCode.BYTE_COUNT_MISMATCH.code,
        rule: IhexErrorCode.BYTE_COUNT_MISMATCH.rule,
        severity: IhexErrorCode.BYTE_COUNT_MISMATCH.severity,
        message: IhexErrorCode.BYTE_COUNT_MISMATCH.message(lineStr, String(rec.byteCount), String(rec.data.length)),
        line: rec.lineNumber,
        column: 2,
        endColumn: 4,
      });
    }

    // IHEX2001: 2's-complement checksum mismatch
    if (!rec.checksumValid) {
      diags.push({
        code: IhexErrorCode.CHECKSUM_MISMATCH.code,
        rule: IhexErrorCode.CHECKSUM_MISMATCH.rule,
        severity: IhexErrorCode.CHECKSUM_MISMATCH.severity,
        message: IhexErrorCode.CHECKSUM_MISMATCH.message(lineStr, hexByte(rec.checksum), hexByte(rec.expectedChecksum)),
        line: rec.lineNumber,
        column: Math.max(1, rec.raw.length - 1),
        endColumn: rec.raw.length + 1,
      });
    }

    // IHEX3001: Unsupported record type (> 0x05)
    if (rec.recordType > IhexRecordType.StartLinearAddress) {
      diags.push({
        code: IhexErrorCode.UNSUPPORTED_RECORD_TYPE.code,
        rule: IhexErrorCode.UNSUPPORTED_RECORD_TYPE.rule,
        severity: IhexErrorCode.UNSUPPORTED_RECORD_TYPE.severity,
        message: IhexErrorCode.UNSUPPORTED_RECORD_TYPE.message(lineStr, hexByte(rec.recordType)),
        line: rec.lineNumber,
        column: 8,
        endColumn: 10,
      });
    } else if (rec.recordType !== IhexRecordType.Data) {
      // Control record checks (types 01–05)
      const expectedLen = EXPECTED_CONTROL_LENGTH[rec.recordType];
      if (expectedLen !== undefined && rec.data.length !== expectedLen) {
        diags.push({
          code: IhexErrorCode.INVALID_PAYLOAD_LENGTH.code,
          rule: IhexErrorCode.INVALID_PAYLOAD_LENGTH.rule,
          severity: IhexErrorCode.INVALID_PAYLOAD_LENGTH.severity,
          message: IhexErrorCode.INVALID_PAYLOAD_LENGTH.message(
            lineStr,
            hexByte(rec.recordType),
            String(rec.data.length),
            String(expectedLen),
          ),
          line: rec.lineNumber,
          column: 2,
          endColumn: 10,
        });
      }

      // IHEX3003: Non-zero address field in control record
      if (rec.address !== 0) {
        diags.push({
          code: IhexErrorCode.NONZERO_CONTROL_ADDRESS.code,
          rule: IhexErrorCode.NONZERO_CONTROL_ADDRESS.rule,
          severity: IhexErrorCode.NONZERO_CONTROL_ADDRESS.severity,
          message: IhexErrorCode.NONZERO_CONTROL_ADDRESS.message(
            lineStr,
            hexByte(rec.recordType),
            hexWord(rec.address),
          ),
          line: rec.lineNumber,
          column: 4,
          endColumn: 8,
        });
      }
    } else {
      dataRecordCount += 1;
      // IHEX5004: 16-bit address wraparound within a single data record
      if (rec.address + rec.data.length > 0x10000) {
        diags.push({
          code: IhexErrorCode.ADDRESS_WRAPAROUND.code,
          rule: IhexErrorCode.ADDRESS_WRAPAROUND.rule,
          severity: IhexErrorCode.ADDRESS_WRAPAROUND.severity,
          message: IhexErrorCode.ADDRESS_WRAPAROUND.message(lineStr, hexWord(rec.address), String(rec.data.length)),
          line: rec.lineNumber,
          column: 4,
          endColumn: 8,
        });
      }
    }

    // IHEX4002 / IHEX4003: Records after EOF & duplicate EOF
    if (firstEofLine !== undefined) {
      if (rec.recordType === IhexRecordType.Eof) {
        diags.push({
          code: IhexErrorCode.DUPLICATE_EOF_RECORD.code,
          rule: IhexErrorCode.DUPLICATE_EOF_RECORD.rule,
          severity: IhexErrorCode.DUPLICATE_EOF_RECORD.severity,
          message: IhexErrorCode.DUPLICATE_EOF_RECORD.message(lineStr, String(firstEofLine)),
          line: rec.lineNumber,
          column: 1,
          endColumn: rec.raw.length + 1,
        });
      } else {
        diags.push({
          code: IhexErrorCode.RECORDS_AFTER_EOF.code,
          rule: IhexErrorCode.RECORDS_AFTER_EOF.rule,
          severity: IhexErrorCode.RECORDS_AFTER_EOF.severity,
          message: IhexErrorCode.RECORDS_AFTER_EOF.message(lineStr, String(firstEofLine)),
          line: rec.lineNumber,
          column: 1,
          endColumn: rec.raw.length + 1,
        });
      }
    } else if (rec.recordType === IhexRecordType.Eof) {
      firstEofLine = rec.lineNumber;
    }

    // IHEX5005: Mixed I16HEX and I32HEX addressing modes
    if (
      rec.recordType === IhexRecordType.ExtendedSegmentAddress ||
      rec.recordType === IhexRecordType.StartSegmentAddress
    ) {
      seenSegMode = true;
      if (seenLinMode) {
        diags.push({
          code: IhexErrorCode.MIXED_ADDRESSING_MODES.code,
          rule: IhexErrorCode.MIXED_ADDRESSING_MODES.rule,
          severity: IhexErrorCode.MIXED_ADDRESSING_MODES.severity,
          message: IhexErrorCode.MIXED_ADDRESSING_MODES.message(lineStr),
          line: rec.lineNumber,
          column: 8,
          endColumn: 10,
        });
      }
    } else if (
      rec.recordType === IhexRecordType.ExtendedLinearAddress ||
      rec.recordType === IhexRecordType.StartLinearAddress
    ) {
      seenLinMode = true;
      if (seenSegMode) {
        diags.push({
          code: IhexErrorCode.MIXED_ADDRESSING_MODES.code,
          rule: IhexErrorCode.MIXED_ADDRESSING_MODES.rule,
          severity: IhexErrorCode.MIXED_ADDRESSING_MODES.severity,
          message: IhexErrorCode.MIXED_ADDRESSING_MODES.message(lineStr),
          line: rec.lineNumber,
          column: 8,
          endColumn: 10,
        });
      }
    }
  }

  // IHEX4001: Missing EOF record
  if (!model.hasEof && model.records.length > 0) {
    const lastLine = model.records[model.records.length - 1]!.lineNumber;
    diags.push({
      code: IhexErrorCode.MISSING_EOF_RECORD.code,
      rule: IhexErrorCode.MISSING_EOF_RECORD.rule,
      severity: IhexErrorCode.MISSING_EOF_RECORD.severity,
      message: IhexErrorCode.MISSING_EOF_RECORD.message(),
      line: lastLine,
      column: 1,
      endColumn: 12,
    });
  }

  // IHEX5003: Empty image (no data records)
  if (dataRecordCount === 0 && model.records.length > 0) {
    diags.push({
      code: IhexErrorCode.EMPTY_IMAGE.code,
      rule: IhexErrorCode.EMPTY_IMAGE.rule,
      severity: IhexErrorCode.EMPTY_IMAGE.severity,
      message: IhexErrorCode.EMPTY_IMAGE.message(),
      line: 1,
      column: 1,
      endColumn: 12,
    });
  }

  // Memory-map structural checks (IHEX5001, IHEX5002, IHEX5006)
  const memMap = coalesceIhexMemoryMap(model);

  // IHEX5001: Overlapping addresses
  for (const ov of memMap.overlaps) {
    diags.push({
      code: IhexErrorCode.OVERLAPPING_ADDRESS.code,
      rule: IhexErrorCode.OVERLAPPING_ADDRESS.rule,
      severity: IhexErrorCode.OVERLAPPING_ADDRESS.severity,
      message: IhexErrorCode.OVERLAPPING_ADDRESS.message(
        hexDword(ov.address),
        String(ov.secondLine),
        String(ov.firstLine),
      ),
      line: ov.secondLine,
      column: 1,
      endColumn: 12,
    });
  }

  // IHEX5002: Large uninitialized gap between consecutive segments
  for (let i = 1; i < memMap.segments.length; i++) {
    const prev = memMap.segments[i - 1]!;
    const curr = memMap.segments[i]!;
    const gap = curr.startAddress - prev.endAddress;
    if (gap > gapThreshold) {
      diags.push({
        code: IhexErrorCode.LARGE_UNINITIALIZED_GAP.code,
        rule: IhexErrorCode.LARGE_UNINITIALIZED_GAP.rule,
        severity: IhexErrorCode.LARGE_UNINITIALIZED_GAP.severity,
        message: IhexErrorCode.LARGE_UNINITIALIZED_GAP.message(
          String(gap),
          hexDword(prev.endAddress),
          hexDword(curr.startAddress),
        ),
        line: curr.startLine,
        column: 1,
        endColumn: 12,
      });
    }
  }

  // IHEX5006: Start entry point outside defined ROM segments
  if (memMap.segments.length > 0) {
    const entryAddr =
      model.startLinearAddress !== undefined
        ? model.startLinearAddress >>> 0
        : model.startSegmentAddress !== undefined
          ? ((model.startSegmentAddress.cs << 4) + model.startSegmentAddress.ip) >>> 0
          : undefined;

    if (entryAddr !== undefined) {
      const inside = memMap.segments.some((s) => entryAddr >= s.startAddress && entryAddr < s.endAddress);
      if (!inside) {
        diags.push({
          code: IhexErrorCode.UNALIGNED_ENTRY_POINT.code,
          rule: IhexErrorCode.UNALIGNED_ENTRY_POINT.rule,
          severity: IhexErrorCode.UNALIGNED_ENTRY_POINT.severity,
          message: IhexErrorCode.UNALIGNED_ENTRY_POINT.message(hexDword(entryAddr)),
          line:
            model.records.find(
              (r) =>
                r.recordType === IhexRecordType.StartLinearAddress ||
                r.recordType === IhexRecordType.StartSegmentAddress,
            )?.lineNumber ?? 1,
          column: 1,
          endColumn: 12,
        });
      }
    }
  }

  return diags;
}
