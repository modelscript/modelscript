// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Motorola S-Record (SREC) firmware integrity linter (`SREC1001`–`SREC5006`).
 */

import { SrecErrorCode } from "../errors.js";
import { parseSrec } from "../parser/index.js";
import type { SrecDataRecordType, SrecDiagnostic, SrecFile, SrecTermRecordType } from "../types.js";

export { SrecErrorCode };

function toHexByte(v: number): string {
  return (v & 0xff).toString(16).toUpperCase().padStart(2, "0");
}

function expectedTermForData(dataType: SrecDataRecordType): SrecTermRecordType {
  if (dataType === "S1") return "S9";
  if (dataType === "S2") return "S8";
  return "S7";
}

/**
 * Runs all Motorola S-Record integrity checks (`SREC1001`–`SREC5006`) on a parsed `SrecFile` or raw SREC text.
 */
export function lintSrec(input: SrecFile | string): SrecDiagnostic[] {
  const file = typeof input === "string" ? parseSrec(input) : input;
  const diagnostics: SrecDiagnostic[] = [];

  // 1. SREC1001 — Syntax errors
  for (const err of file.parseErrors) {
    diagnostics.push({
      code: SrecErrorCode.SYNTAX_ERROR.code,
      rule: SrecErrorCode.SYNTAX_ERROR.rule,
      severity: SrecErrorCode.SYNTAX_ERROR.severity,
      message: SrecErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
      endColumn: err.column + err.raw.length,
    });
  }

  let hasHeader = false;
  let hasTermination = false;
  let primaryDataType: SrecDataRecordType | undefined;
  const writtenAddresses = new Set<number>();

  for (const rec of file.records) {
    // SREC3001 — Reserved S4 record type
    if (rec.type === "S4") {
      diagnostics.push({
        code: SrecErrorCode.RESERVED_RECORD_TYPE.code,
        rule: SrecErrorCode.RESERVED_RECORD_TYPE.rule,
        severity: SrecErrorCode.RESERVED_RECORD_TYPE.severity,
        message: SrecErrorCode.RESERVED_RECORD_TYPE.message(rec.type),
        line: rec.line,
        column: 1,
        endColumn: 3,
      });
    }

    // SREC2002 — Byte count mismatch
    if (!rec.byteCountValid) {
      const actualCount = rec.addressBytes + rec.data.length + 1;
      diagnostics.push({
        code: SrecErrorCode.BYTE_COUNT_MISMATCH.code,
        rule: SrecErrorCode.BYTE_COUNT_MISMATCH.rule,
        severity: SrecErrorCode.BYTE_COUNT_MISMATCH.severity,
        message: SrecErrorCode.BYTE_COUNT_MISMATCH.message(rec.type, rec.byteCount, actualCount),
        line: rec.line,
        column: 3,
        endColumn: 5,
      });
    }

    // SREC2001 — 1's-complement checksum mismatch
    if (!rec.checksumValid) {
      diagnostics.push({
        code: SrecErrorCode.CHECKSUM_MISMATCH.code,
        rule: SrecErrorCode.CHECKSUM_MISMATCH.rule,
        severity: SrecErrorCode.CHECKSUM_MISMATCH.severity,
        message: SrecErrorCode.CHECKSUM_MISMATCH.message(
          rec.type,
          toHexByte(rec.checksum),
          toHexByte(rec.computedChecksum),
        ),
        line: rec.line,
        column: Math.max(1, rec.raw.length - 1),
        endColumn: rec.raw.length + 1,
      });
    }

    if (rec.type === "S0") {
      hasHeader = true;
    } else if (rec.type === "S1" || rec.type === "S2" || rec.type === "S3") {
      if (primaryDataType === undefined) {
        primaryDataType = rec.type;
      }
      // SREC5001 — Overlapping address bytes
      let overlapCount = 0;
      let firstOverlapAddr = -1;
      for (let i = 0; i < rec.data.length; i++) {
        const addr = ((rec.address >>> 0) + i) >>> 0;
        if (writtenAddresses.has(addr)) {
          overlapCount++;
          if (firstOverlapAddr === -1) firstOverlapAddr = addr;
        } else {
          writtenAddresses.add(addr);
        }
      }
      if (overlapCount > 0) {
        const addrHex = (firstOverlapAddr >>> 0)
          .toString(16)
          .toUpperCase()
          .padStart(rec.addressBytes * 2, "0");
        diagnostics.push({
          code: SrecErrorCode.OVERLAPPING_ADDRESS.code,
          rule: SrecErrorCode.OVERLAPPING_ADDRESS.rule,
          severity: SrecErrorCode.OVERLAPPING_ADDRESS.severity,
          message: SrecErrorCode.OVERLAPPING_ADDRESS.message(addrHex, overlapCount),
          line: rec.line,
          column: 5,
          endColumn: 5 + rec.addressBytes * 2,
        });
      }
    } else if (rec.type === "S5" || rec.type === "S6") {
      // SREC3002 — Data record count mismatch
      if (rec.address !== file.dataRecordCount) {
        diagnostics.push({
          code: SrecErrorCode.RECORD_COUNT_MISMATCH.code,
          rule: SrecErrorCode.RECORD_COUNT_MISMATCH.rule,
          severity: SrecErrorCode.RECORD_COUNT_MISMATCH.severity,
          message: SrecErrorCode.RECORD_COUNT_MISMATCH.message(rec.type, rec.address, file.dataRecordCount),
          line: rec.line,
          column: 5,
          endColumn: 5 + rec.addressBytes * 2,
        });
      }
    } else if (rec.type === "S7" || rec.type === "S8" || rec.type === "S9") {
      hasTermination = true;
      // SREC4002 — Address width mismatch between data records and terminator
      if (primaryDataType !== undefined) {
        const expectedTerm = expectedTermForData(primaryDataType);
        if (rec.type !== expectedTerm) {
          diagnostics.push({
            code: SrecErrorCode.ADDRESS_WIDTH_MISMATCH.code,
            rule: SrecErrorCode.ADDRESS_WIDTH_MISMATCH.rule,
            severity: SrecErrorCode.ADDRESS_WIDTH_MISMATCH.severity,
            message: SrecErrorCode.ADDRESS_WIDTH_MISMATCH.message(primaryDataType, rec.type, expectedTerm),
            line: rec.line,
            column: 1,
            endColumn: 3,
          });
        }
      }
    }
  }

  // SREC4001 — Missing termination record
  if (file.records.length > 0 && !hasTermination) {
    const lastLine = file.records[file.records.length - 1]!.line;
    diagnostics.push({
      code: SrecErrorCode.MISSING_TERMINATION.code,
      rule: SrecErrorCode.MISSING_TERMINATION.rule,
      severity: SrecErrorCode.MISSING_TERMINATION.severity,
      message: SrecErrorCode.MISSING_TERMINATION.message(),
      line: lastLine,
      column: 1,
    });
  }

  // SREC5006 — Missing S0 header warning
  if (file.records.length > 0 && !hasHeader) {
    diagnostics.push({
      code: SrecErrorCode.MISSING_HEADER.code,
      rule: SrecErrorCode.MISSING_HEADER.rule,
      severity: SrecErrorCode.MISSING_HEADER.severity,
      message: SrecErrorCode.MISSING_HEADER.message(),
      line: 1,
      column: 1,
    });
  }

  return diagnostics;
}
