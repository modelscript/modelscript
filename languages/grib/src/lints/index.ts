// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/grib — Domain Linter (`GRIB1001`–`GRIB5006`).
 */

import { lookupWmoLevelType, lookupWmoParameterByCode } from "../catalog/grib-std-schemas.js";
import { GribErrorCode } from "../errors.js";
import type { GribDiagnostic, GribDocument, GribSpan } from "../types.js";

function spanOrDefault(span?: GribSpan): {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
} {
  if (!span) return { line: 1, column: 1, endLine: 1, endColumn: 1 };
  return {
    line: span.startLine,
    column: span.startColumn,
    endLine: span.endLine,
    endColumn: span.endColumn,
  };
}

/**
 * Validates a parsed `GribDocument` (from textual descriptor or binary GRIB1 stream)
 * and emits structured `GribDiagnostic[]` across `GRIB1001`–`GRIB5006`.
 */
export function lintGribDocument(doc: GribDocument): GribDiagnostic[] {
  const diags: GribDiagnostic[] = [];

  for (const err of doc.syntaxErrors) {
    diags.push({
      code: GribErrorCode.INVALID_MAGIC.code,
      rule: GribErrorCode.INVALID_MAGIC.rule,
      severity: GribErrorCode.INVALID_MAGIC.severity,
      message: GribErrorCode.INVALID_MAGIC.message(err.message),
      line: err.line,
      column: err.column,
      endLine: err.line,
      endColumn: err.column + 1,
    });
  }

  if (doc.messages.length === 0 && doc.syntaxErrors.length === 0) {
    diags.push({
      code: GribErrorCode.INVALID_MAGIC.code,
      rule: GribErrorCode.INVALID_MAGIC.rule,
      severity: GribErrorCode.INVALID_MAGIC.severity,
      message: GribErrorCode.INVALID_MAGIC.message("empty document with no GRIB messages"),
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 1,
    });
    return diags;
  }

  for (const msg of doc.messages) {
    const isLoc = spanOrDefault(msg.indicator.span ?? msg.span);

    // GRIB1001: Indicator magic header
    if (msg.indicator.magic !== "GRIB") {
      diags.push({
        code: GribErrorCode.INVALID_MAGIC.code,
        rule: GribErrorCode.INVALID_MAGIC.rule,
        severity: GribErrorCode.INVALID_MAGIC.severity,
        message: GribErrorCode.INVALID_MAGIC.message(`expected 'GRIB', got '${msg.indicator.magic}'`),
        messageIndex: msg.index,
        ...isLoc,
      });
    }

    // GRIB1003: Edition must be 1
    if (msg.indicator.edition !== 1) {
      diags.push({
        code: GribErrorCode.UNSUPPORTED_EDITION.code,
        rule: GribErrorCode.UNSUPPORTED_EDITION.rule,
        severity: GribErrorCode.UNSUPPORTED_EDITION.severity,
        message: GribErrorCode.UNSUPPORTED_EDITION.message(msg.indicator.edition),
        messageIndex: msg.index,
        ...isLoc,
      });
    }

    // GRIB5004: Truncated binary stream
    if (msg.truncated) {
      diags.push({
        code: GribErrorCode.TRUNCATED_BINARY_MESSAGE.code,
        rule: GribErrorCode.TRUNCATED_BINARY_MESSAGE.rule,
        severity: GribErrorCode.TRUNCATED_BINARY_MESSAGE.severity,
        message: GribErrorCode.TRUNCATED_BINARY_MESSAGE.message(msg.indicator.totalLength, 0),
        messageIndex: msg.index,
        ...isLoc,
      });
    }

    // GRIB1002: Missing 7777 trailer
    if (!msg.end.present || msg.end.magic !== "7777") {
      const endLoc = spanOrDefault(msg.end.span ?? msg.span);
      diags.push({
        code: GribErrorCode.MISSING_TRAILER.code,
        rule: GribErrorCode.MISSING_TRAILER.rule,
        severity: GribErrorCode.MISSING_TRAILER.severity,
        message: GribErrorCode.MISSING_TRAILER.message(msg.index),
        messageIndex: msg.index,
        ...endLoc,
      });
    }

    // GRIB5001: Missing PDS
    if (!msg.pds) {
      diags.push({
        code: GribErrorCode.MISSING_PDS.code,
        rule: GribErrorCode.MISSING_PDS.rule,
        severity: GribErrorCode.MISSING_PDS.severity,
        message: GribErrorCode.MISSING_PDS.message(msg.index),
        messageIndex: msg.index,
        ...isLoc,
      });
    } else {
      const pds = msg.pds;
      const pdsLoc = spanOrDefault(pds.span ?? msg.span);

      // GRIB2001: Invalid PDS date/time
      const maxDay =
        pds.month === 2
          ? pds.year % 4 === 0 && (pds.year % 100 !== 0 || pds.year % 400 === 0)
            ? 29
            : 28
          : [4, 6, 9, 11].includes(pds.month)
            ? 30
            : 31;
      if (
        !Number.isInteger(pds.month) ||
        pds.month < 1 ||
        pds.month > 12 ||
        !Number.isInteger(pds.day) ||
        pds.day < 1 ||
        pds.day > maxDay ||
        !Number.isInteger(pds.hour) ||
        pds.hour < 0 ||
        pds.hour > 23 ||
        !Number.isInteger(pds.minute) ||
        pds.minute < 0 ||
        pds.minute > 59
      ) {
        diags.push({
          code: GribErrorCode.INVALID_PDS_DATE.code,
          rule: GribErrorCode.INVALID_PDS_DATE.rule,
          severity: GribErrorCode.INVALID_PDS_DATE.severity,
          message: GribErrorCode.INVALID_PDS_DATE.message(
            `year=${pds.year}, month=${pds.month}, day=${pds.day}, hour=${pds.hour}, minute=${pds.minute}`,
          ),
          messageIndex: msg.index,
          ...pdsLoc,
        });
      }

      // GRIB2002: Parameter code
      if (!Number.isInteger(pds.parameterCode) || pds.parameterCode < 1 || pds.parameterCode > 254) {
        diags.push({
          code: GribErrorCode.INVALID_PARAMETER_CODE.code,
          rule: GribErrorCode.INVALID_PARAMETER_CODE.rule,
          severity: GribErrorCode.INVALID_PARAMETER_CODE.severity,
          message: GribErrorCode.INVALID_PARAMETER_CODE.message(pds.parameterCode),
          messageIndex: msg.index,
          ...pdsLoc,
        });
      }

      // GRIB2003: Level type
      if (!lookupWmoLevelType(pds.levelType) && (pds.levelType < 1 || pds.levelType > 254)) {
        diags.push({
          code: GribErrorCode.INVALID_LEVEL_TYPE.code,
          rule: GribErrorCode.INVALID_LEVEL_TYPE.rule,
          severity: GribErrorCode.INVALID_LEVEL_TYPE.severity,
          message: GribErrorCode.INVALID_LEVEL_TYPE.message(pds.levelType),
          messageIndex: msg.index,
          ...pdsLoc,
        });
      }

      // GRIB4002: Extreme decimal scale factor
      if (Math.abs(pds.decimalScaleFactor) > 16) {
        diags.push({
          code: GribErrorCode.INVALID_SCALE_FACTOR.code,
          rule: GribErrorCode.INVALID_SCALE_FACTOR.rule,
          severity: GribErrorCode.INVALID_SCALE_FACTOR.severity,
          message: GribErrorCode.INVALID_SCALE_FACTOR.message("decimal (D)", pds.decimalScaleFactor),
          messageIndex: msg.index,
          ...pdsLoc,
        });
      }
    }

    // GDS checks
    if (msg.gds) {
      const gds = msg.gds;
      const gdsLoc = spanOrDefault(gds.span ?? msg.span);

      // GRIB3002: Invalid lat/lon bounds or non-positive grid dims
      if (
        gds.ni <= 0 ||
        gds.nj <= 0 ||
        gds.la1 < -90 ||
        gds.la1 > 90 ||
        gds.la2 < -90 ||
        gds.la2 > 90 ||
        gds.lo1 < -180 ||
        gds.lo1 > 360 ||
        gds.lo2 < -180 ||
        gds.lo2 > 360
      ) {
        diags.push({
          code: GribErrorCode.INVALID_LAT_LON_BOUNDS.code,
          rule: GribErrorCode.INVALID_LAT_LON_BOUNDS.rule,
          severity: GribErrorCode.INVALID_LAT_LON_BOUNDS.severity,
          message: GribErrorCode.INVALID_LAT_LON_BOUNDS.message(
            `ni=${gds.ni}, nj=${gds.nj}, la1=${gds.la1}, lo1=${gds.lo1}, la2=${gds.la2}, lo2=${gds.lo2}`,
          ),
          messageIndex: msg.index,
          ...gdsLoc,
        });
      }

      // GRIB5005: Non-positive grid increment
      if (gds.dataRepresentationType === 0 && (gds.di <= 0 || gds.dj <= 0)) {
        diags.push({
          code: GribErrorCode.INVALID_GRID_INCREMENT.code,
          rule: GribErrorCode.INVALID_GRID_INCREMENT.rule,
          severity: GribErrorCode.INVALID_GRID_INCREMENT.severity,
          message: GribErrorCode.INVALID_GRID_INCREMENT.message(gds.di, gds.dj),
          messageIndex: msg.index,
          ...gdsLoc,
        });
      }

      // GRIB3003: BMS length vs GDS ni * nj
      if (msg.bms && msg.bms.bitmap.length > 0 && msg.bms.bitmap.length !== gds.ni * gds.nj) {
        const bmsLoc = spanOrDefault(msg.bms.span ?? gds.span ?? msg.span);
        diags.push({
          code: GribErrorCode.BMS_LENGTH_MISMATCH.code,
          rule: GribErrorCode.BMS_LENGTH_MISMATCH.rule,
          severity: GribErrorCode.BMS_LENGTH_MISMATCH.severity,
          message: GribErrorCode.BMS_LENGTH_MISMATCH.message(gds.ni * gds.nj, msg.bms.bitmap.length),
          messageIndex: msg.index,
          ...bmsLoc,
        });
      }
    }

    // GRIB5002: Missing BDS
    if (!msg.bds) {
      diags.push({
        code: GribErrorCode.MISSING_BDS.code,
        rule: GribErrorCode.MISSING_BDS.rule,
        severity: GribErrorCode.MISSING_BDS.severity,
        message: GribErrorCode.MISSING_BDS.message(msg.index),
        messageIndex: msg.index,
        ...isLoc,
      });
    } else {
      const bds = msg.bds;
      const bdsLoc = spanOrDefault(bds.span ?? msg.span);

      // GRIB4001: Invalid bit width
      if (!Number.isInteger(bds.bitsPerValue) || bds.bitsPerValue < 0 || bds.bitsPerValue > 32) {
        diags.push({
          code: GribErrorCode.INVALID_BIT_WIDTH.code,
          rule: GribErrorCode.INVALID_BIT_WIDTH.rule,
          severity: GribErrorCode.INVALID_BIT_WIDTH.severity,
          message: GribErrorCode.INVALID_BIT_WIDTH.message(bds.bitsPerValue),
          messageIndex: msg.index,
          ...bdsLoc,
        });
      }

      // GRIB4002: Extreme binary scale factor
      if (Math.abs(bds.binaryScaleFactor) > 64) {
        diags.push({
          code: GribErrorCode.INVALID_SCALE_FACTOR.code,
          rule: GribErrorCode.INVALID_SCALE_FACTOR.rule,
          severity: GribErrorCode.INVALID_SCALE_FACTOR.severity,
          message: GribErrorCode.INVALID_SCALE_FACTOR.message("binary (E)", bds.binaryScaleFactor),
          messageIndex: msg.index,
          ...bdsLoc,
        });
      }

      // GRIB3001: GDS grid dimension mismatch with BDS values
      if (msg.gds && msg.gds.ni > 0 && msg.gds.nj > 0) {
        const totalGridPts = msg.gds.ni * msg.gds.nj;
        const activePts = msg.bms ? msg.bms.bitmap.reduce((acc, p) => acc + (p ? 1 : 0), 0) : totalGridPts;
        if (bds.values.length !== totalGridPts && bds.values.length !== activePts) {
          diags.push({
            code: GribErrorCode.GDS_BDS_DIMENSION_MISMATCH.code,
            rule: GribErrorCode.GDS_BDS_DIMENSION_MISMATCH.rule,
            severity: GribErrorCode.GDS_BDS_DIMENSION_MISMATCH.severity,
            message: GribErrorCode.GDS_BDS_DIMENSION_MISMATCH.message(totalGridPts, bds.values.length),
            messageIndex: msg.index,
            ...bdsLoc,
          });
        }
      }

      // GRIB5003: Non-finite data (ignoring intentional BMS-masked NaNs)
      let nonFiniteCount = 0;
      for (let k = 0; k < bds.values.length; k++) {
        const isMasked = msg.bms && k < msg.bms.bitmap.length && !msg.bms.bitmap[k];
        if (!isMasked && !Number.isFinite(bds.values[k])) {
          nonFiniteCount++;
        }
      }
      if (nonFiniteCount > 0) {
        diags.push({
          code: GribErrorCode.NON_FINITE_DATA.code,
          rule: GribErrorCode.NON_FINITE_DATA.rule,
          severity: GribErrorCode.NON_FINITE_DATA.severity,
          message: GribErrorCode.NON_FINITE_DATA.message(nonFiniteCount),
          messageIndex: msg.index,
          ...bdsLoc,
        });
      }

      // GRIB5006: Physical range warning for known WMO Table 2 parameters
      const paramMeta = msg.pds ? lookupWmoParameterByCode(msg.pds.parameterCode) : undefined;
      if (paramMeta && paramMeta.minPlausible !== undefined && paramMeta.maxPlausible !== undefined) {
        for (let k = 0; k < bds.values.length; k++) {
          const v = bds.values[k]!;
          if (Number.isFinite(v) && (v < paramMeta.minPlausible || v > paramMeta.maxPlausible)) {
            diags.push({
              code: GribErrorCode.PHYSICAL_RANGE_WARNING.code,
              rule: GribErrorCode.PHYSICAL_RANGE_WARNING.rule,
              severity: GribErrorCode.PHYSICAL_RANGE_WARNING.severity,
              message: GribErrorCode.PHYSICAL_RANGE_WARNING.message(
                paramMeta.mnemonic,
                v,
                paramMeta.minPlausible,
                paramMeta.maxPlausible,
              ),
              messageIndex: msg.index,
              ...bdsLoc,
            });
            break;
          }
        }
      }
    }
  }

  return diags;
}

export { GribErrorCode };
