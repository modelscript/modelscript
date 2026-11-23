// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Telemetry integrity linter for @modelscript/nmea0183 (NMEA1001–NMEA5006).
 */

import { Nmea0183ErrorCode, type Nmea0183Diagnostic } from "../errors.js";
import { KNOWN_NMEA_FORMATTERS, KNOWN_NMEA_TALKERS, ddmmToDecimalDegrees, parseNmea0183 } from "../parser/index.js";
import type { Nmea0183Document } from "../types.js";

export { Nmea0183ErrorCode, type Nmea0183Diagnostic } from "../errors.js";

const EXPECTED_MIN_FIELDS: Readonly<Record<string, number>> = {
  GGA: 13,
  RMC: 11,
  GSA: 17,
  GSV: 3,
  VTG: 8,
  HDG: 5,
  DBT: 6,
  MWV: 5,
};

const MAX_NMEA_LINE_CHARS = 82;
const HIGH_HDOP_THRESHOLD = 5.0;
const MAX_REALISTIC_SPEED_KNOTS = 500.0;

/**
 * Runs all NMEA 0183 integrity diagnostics (`NMEA1001`–`NMEA5006`) on a parsed document or raw telemetry string.
 */
export function lintNmea0183(docOrSource: Nmea0183Document | string): Nmea0183Diagnostic[] {
  const doc = typeof docOrSource === "string" ? parseNmea0183(docOrSource) : docOrSource;
  const diagnostics: Nmea0183Diagnostic[] = [];

  // 1. NMEA1001: Syntax errors reported by parser
  for (const err of doc.parseErrors) {
    diagnostics.push({
      code: Nmea0183ErrorCode.SYNTAX_ERROR.code,
      rule: Nmea0183ErrorCode.SYNTAX_ERROR.rule,
      severity: Nmea0183ErrorCode.SYNTAX_ERROR.severity,
      message: err.message,
      line: err.line,
      column: 1,
      endColumn: Math.max(2, err.raw.length + 1),
    });
  }

  let prevUtcSec: number | undefined;
  let prevUtcLine: number | undefined;

  for (const s of doc.sentences) {
    const lineLen = s.raw.length;

    // 2. NMEA1002 / NMEA2001: Checksum presence and XOR parity
    if (s.checksumProvided === undefined) {
      diagnostics.push({
        code: Nmea0183ErrorCode.MISSING_CHECKSUM.code,
        rule: Nmea0183ErrorCode.MISSING_CHECKSUM.rule,
        severity: Nmea0183ErrorCode.MISSING_CHECKSUM.severity,
        message: `Sentence '${s.address}' is missing '*XX' XOR checksum (expected '*${s.checksumComputed}').`,
        line: s.line,
        column: Math.max(1, lineLen),
        endColumn: lineLen + 1,
        sentenceIndex: s.index,
        address: s.address,
      });
    } else if (!s.checksumValid) {
      const starCol = s.raw.indexOf("*") + 1;
      diagnostics.push({
        code: Nmea0183ErrorCode.CHECKSUM_MISMATCH.code,
        rule: Nmea0183ErrorCode.CHECKSUM_MISMATCH.rule,
        severity: Nmea0183ErrorCode.CHECKSUM_MISMATCH.severity,
        message: `Checksum mismatch for '${s.address}': got '*${s.checksumProvided}', expected '*${s.checksumComputed}'.`,
        line: s.line,
        column: starCol > 0 ? starCol : 1,
        endColumn: lineLen + 1,
        sentenceIndex: s.index,
        address: s.address,
      });
    }

    // 3. NMEA2002: Sentence length > 82 chars (NMEA 0183 spec max 82 including CR/LF, so > 82 raw is always violating)
    if (lineLen > MAX_NMEA_LINE_CHARS) {
      diagnostics.push({
        code: Nmea0183ErrorCode.SENTENCE_TOO_LONG.code,
        rule: Nmea0183ErrorCode.SENTENCE_TOO_LONG.rule,
        severity: Nmea0183ErrorCode.SENTENCE_TOO_LONG.severity,
        message: `Sentence '${s.address}' length (${lineLen} chars) exceeds NMEA 0183 82-character maximum.`,
        line: s.line,
        column: MAX_NMEA_LINE_CHARS + 1,
        endColumn: lineLen + 1,
        sentenceIndex: s.index,
        address: s.address,
      });
    }

    // 4. NMEA4001: Unknown talker ID
    if (!(s.talker in KNOWN_NMEA_TALKERS)) {
      diagnostics.push({
        code: Nmea0183ErrorCode.UNKNOWN_TALKER.code,
        rule: Nmea0183ErrorCode.UNKNOWN_TALKER.rule,
        severity: Nmea0183ErrorCode.UNKNOWN_TALKER.severity,
        message: `Unknown NMEA 0183 talker ID '${s.talker}' in '${s.address}'.`,
        line: s.line,
        column: 2,
        endColumn: 4,
        sentenceIndex: s.index,
        address: s.address,
      });
    }

    // 5. NMEA4002: Unknown formatter ID
    if (!(s.formatter in KNOWN_NMEA_FORMATTERS)) {
      diagnostics.push({
        code: Nmea0183ErrorCode.UNKNOWN_FORMATTER.code,
        rule: Nmea0183ErrorCode.UNKNOWN_FORMATTER.rule,
        severity: Nmea0183ErrorCode.UNKNOWN_FORMATTER.severity,
        message: `Unknown NMEA 0183 sentence formatter '${s.formatter}' in '${s.address}'.`,
        line: s.line,
        column: 4,
        endColumn: 7,
        sentenceIndex: s.index,
        address: s.address,
      });
    }

    // 6. NMEA5004: Minimum field count for known formatters
    const minFields = EXPECTED_MIN_FIELDS[s.formatter];
    if (minFields !== undefined && s.fields.length < minFields) {
      diagnostics.push({
        code: Nmea0183ErrorCode.INVALID_FIELD_COUNT.code,
        rule: Nmea0183ErrorCode.INVALID_FIELD_COUNT.rule,
        severity: Nmea0183ErrorCode.INVALID_FIELD_COUNT.severity,
        message: `Sentence '${s.address}' has ${s.fields.length} fields; expected at least ${minFields}.`,
        line: s.line,
        column: 1,
        endColumn: lineLen + 1,
        sentenceIndex: s.index,
        address: s.address,
      });
    }

    const p = s.payload;

    // 7. NMEA3001 / NMEA3002: Latitude & Longitude range checks
    if (p.kind === "GGA" || p.kind === "RMC") {
      if (p.latRaw.trim() !== "" && ddmmToDecimalDegrees(p.latRaw, p.latHemi, false) === undefined) {
        diagnostics.push({
          code: Nmea0183ErrorCode.INVALID_LATITUDE.code,
          rule: Nmea0183ErrorCode.INVALID_LATITUDE.rule,
          severity: Nmea0183ErrorCode.INVALID_LATITUDE.severity,
          message: `Invalid latitude '${p.latRaw},${p.latHemi}' in '${s.address}' (must be valid ddmm.mmmm within [-90, 90] and minutes < 60).`,
          line: s.line,
          column: 1,
          endColumn: lineLen + 1,
          sentenceIndex: s.index,
          address: s.address,
        });
      }
      if (p.lonRaw.trim() !== "" && ddmmToDecimalDegrees(p.lonRaw, p.lonHemi, true) === undefined) {
        diagnostics.push({
          code: Nmea0183ErrorCode.INVALID_LONGITUDE.code,
          rule: Nmea0183ErrorCode.INVALID_LONGITUDE.rule,
          severity: Nmea0183ErrorCode.INVALID_LONGITUDE.severity,
          message: `Invalid longitude '${p.lonRaw},${p.lonHemi}' in '${s.address}' (must be valid dddmm.mmmm within [-180, 180] and minutes < 60).`,
          line: s.line,
          column: 1,
          endColumn: lineLen + 1,
          sentenceIndex: s.index,
          address: s.address,
        });
      }
    }

    // 8. NMEA5001: Void / invalid GPS fix
    if (p.kind === "RMC" && p.status === "V") {
      diagnostics.push({
        code: Nmea0183ErrorCode.VOID_GPS_FIX.code,
        rule: Nmea0183ErrorCode.VOID_GPS_FIX.rule,
        severity: Nmea0183ErrorCode.VOID_GPS_FIX.severity,
        message: `Void GPS fix reported by '${s.address}' (status 'V').`,
        line: s.line,
        column: 1,
        endColumn: lineLen + 1,
        sentenceIndex: s.index,
        address: s.address,
      });
    } else if (p.kind === "GGA" && p.fixQuality === 0) {
      diagnostics.push({
        code: Nmea0183ErrorCode.VOID_GPS_FIX.code,
        rule: Nmea0183ErrorCode.VOID_GPS_FIX.rule,
        severity: Nmea0183ErrorCode.VOID_GPS_FIX.severity,
        message: `Invalid GPS fix reported by '${s.address}' (fix quality '0').`,
        line: s.line,
        column: 1,
        endColumn: lineLen + 1,
        sentenceIndex: s.index,
        address: s.address,
      });
    }

    // 9. NMEA5002: High HDOP (> 5.0)
    if ((p.kind === "GGA" || p.kind === "GSA") && p.hdop !== undefined && p.hdop > HIGH_HDOP_THRESHOLD) {
      diagnostics.push({
        code: Nmea0183ErrorCode.HIGH_HDOP.code,
        rule: Nmea0183ErrorCode.HIGH_HDOP.rule,
        severity: Nmea0183ErrorCode.HIGH_HDOP.severity,
        message: `High HDOP (${p.hdop.toFixed(2)} > ${HIGH_HDOP_THRESHOLD.toFixed(1)}) in '${s.address}' indicates degraded horizontal fix accuracy.`,
        line: s.line,
        column: 1,
        endColumn: lineLen + 1,
        sentenceIndex: s.index,
        address: s.address,
      });
    }

    // 10. NMEA5003: Non-monotonic UTC timestamps
    if ((p.kind === "GGA" || p.kind === "RMC") && p.utcSeconds !== undefined) {
      if (prevUtcSec !== undefined && p.utcSeconds < prevUtcSec) {
        // Allow midnight rollover (e.g., 23:59:59 -> 00:00:01) if jump > 43200s (12h)
        if (prevUtcSec - p.utcSeconds < 43200) {
          diagnostics.push({
            code: Nmea0183ErrorCode.NON_MONOTONIC_TIMESTAMP.code,
            rule: Nmea0183ErrorCode.NON_MONOTONIC_TIMESTAMP.rule,
            severity: Nmea0183ErrorCode.NON_MONOTONIC_TIMESTAMP.severity,
            message: `Non-monotonic UTC timestamp '${p.utcRaw}' (${p.utcSeconds.toFixed(1)}s) is earlier than previous epoch (${prevUtcSec.toFixed(1)}s at line ${prevUtcLine}).`,
            line: s.line,
            column: 1,
            endColumn: lineLen + 1,
            sentenceIndex: s.index,
            address: s.address,
          });
        }
      }
      prevUtcSec = p.utcSeconds;
      prevUtcLine = s.line;
    }

    // 11. NMEA5005: Satellite azimuth/elevation bounds in GSV
    if (p.kind === "GSV") {
      for (const sat of p.satellites) {
        const badEl = sat.elevationDeg !== undefined && (sat.elevationDeg < 0 || sat.elevationDeg > 90);
        const badAz = sat.azimuthDeg !== undefined && (sat.azimuthDeg < 0 || sat.azimuthDeg > 360);
        if (badEl || badAz) {
          diagnostics.push({
            code: Nmea0183ErrorCode.INVALID_SATELLITE_GEOMETRY.code,
            rule: Nmea0183ErrorCode.INVALID_SATELLITE_GEOMETRY.rule,
            severity: Nmea0183ErrorCode.INVALID_SATELLITE_GEOMETRY.severity,
            message: `Invalid satellite PRN ${sat.prn} geometry in '${s.address}' (el=${sat.elevationDeg ?? "?"}, az=${sat.azimuthDeg ?? "?"}).`,
            line: s.line,
            column: 1,
            endColumn: lineLen + 1,
            sentenceIndex: s.index,
            address: s.address,
          });
        }
      }
    }

    // 12. NMEA5006: Unrealistic speed over ground (> 500 knots)
    if (
      (p.kind === "RMC" || p.kind === "VTG") &&
      p.speedKnots !== undefined &&
      p.speedKnots > MAX_REALISTIC_SPEED_KNOTS
    ) {
      diagnostics.push({
        code: Nmea0183ErrorCode.UNREALISTIC_SPEED.code,
        rule: Nmea0183ErrorCode.UNREALISTIC_SPEED.rule,
        severity: Nmea0183ErrorCode.UNREALISTIC_SPEED.severity,
        message: `Unrealistic speed over ground (${p.speedKnots.toFixed(1)} knots > ${MAX_REALISTIC_SPEED_KNOTS} knots) in '${s.address}'.`,
        line: s.line,
        column: 1,
        endColumn: lineLen + 1,
        sentenceIndex: s.index,
        address: s.address,
      });
    }
  }

  return diagnostics;
}
