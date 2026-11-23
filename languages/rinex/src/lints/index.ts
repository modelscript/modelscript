// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Semantic and physical-bounds linter for RINEX v2 OBS & NAV documents.
 *
 * Implements diagnostic codes `RNX1001`–`RNX5006`:
 * - RNX1001: Syntax / malformed record
 * - RNX2001: Missing RINEX VERSION / TYPE header
 * - RNX2002: Missing END OF HEADER delimiter
 * - RNX2003: Unsupported RINEX version (not 2.x)
 * - RNX3001: Fewer than 4 satellites for 3D fix (warning)
 * - RNX3002: Invalid satellite PRN
 * - RNX4001: Non-monotonic epoch timestamps
 * - RNX5001: Out-of-range pseudorange (< 15,000 km or > 35,000 km)
 * - RNX5002: Invalid orbital eccentricity (e < 0 or e >= 1) in NAV ephemeris
 * - RNX5003: Invalid semi-major axis in NAV ephemeris
 * - RNX5004: Unhealthy satellite flag in NAV ephemeris (warning)
 * - RNX5005: Missing '# / TYPES OF OBSERV' header in OBS file
 * - RNX5006: Missing 'APPROX POSITION XYZ' header in OBS file (warning)
 */

import { RinexErrorCode, type RinexDiagnostic } from "../errors.js";
import { formatRinexTimestamp } from "../parser/index.js";
import type { RinexDocument, RinexSatelliteSystem } from "../types.js";

export { RinexErrorCode, type RinexDiagnostic };

const MIN_PSEUDORANGE_M = 15_000_000; // 15,000 km
const MAX_PSEUDORANGE_M = 35_000_000; // 35,000 km
const PSEUDORANGE_OBS_TYPES = new Set(["C1", "P1", "P2", "C2", "C5"]);
const WGS84_EARTH_RADIUS_M = 6_378_137;

function isValidPrn(system: RinexSatelliteSystem, prnNumber: number): boolean {
  if (!Number.isInteger(prnNumber) || prnNumber <= 0) return false;
  switch (system) {
    case "G":
      return prnNumber >= 1 && prnNumber <= 32;
    case "R":
      return prnNumber >= 1 && prnNumber <= 24;
    case "E":
      return prnNumber >= 1 && prnNumber <= 36;
    case "C":
      return prnNumber >= 1 && prnNumber <= 63;
    case "S":
      return prnNumber >= 1 && prnNumber <= 58;
    case "J":
      return prnNumber >= 1 && prnNumber <= 10;
    default:
      return prnNumber >= 1 && prnNumber <= 99;
  }
}

/**
 * Runs all RINEX v2 semantic, structural, and physical-bounds lint rules.
 */
export function lintRinex(doc: RinexDocument): RinexDiagnostic[] {
  const diags: RinexDiagnostic[] = [];

  // RNX1001: parser syntax issues
  for (const issue of doc.parseIssues) {
    diags.push({
      code: RinexErrorCode.SYNTAX_ERROR.code,
      rule: RinexErrorCode.SYNTAX_ERROR.rule,
      severity: RinexErrorCode.SYNTAX_ERROR.severity,
      message: RinexErrorCode.SYNTAX_ERROR.message(issue.message),
      line: issue.line,
      column: issue.column,
    });
  }

  // RNX2001: Missing RINEX VERSION / TYPE
  if (!doc.header.hasVersionHeader) {
    diags.push({
      code: RinexErrorCode.MISSING_VERSION_HEADER.code,
      rule: RinexErrorCode.MISSING_VERSION_HEADER.rule,
      severity: RinexErrorCode.MISSING_VERSION_HEADER.severity,
      message: RinexErrorCode.MISSING_VERSION_HEADER.message(),
      line: 1,
      column: 1,
    });
  } else if (!Number.isFinite(doc.header.version) || doc.header.version < 2.0 || doc.header.version >= 3.0) {
    // RNX2003: Unsupported RINEX version
    const verStr = Number.isFinite(doc.header.version) ? doc.header.version.toFixed(2) : "unknown";
    diags.push({
      code: RinexErrorCode.UNSUPPORTED_VERSION.code,
      rule: RinexErrorCode.UNSUPPORTED_VERSION.rule,
      severity: RinexErrorCode.UNSUPPORTED_VERSION.severity,
      message: RinexErrorCode.UNSUPPORTED_VERSION.message(verStr),
      line: 1,
      column: 1,
    });
  }

  // RNX2002: Missing END OF HEADER
  if (!doc.header.hasEndOfHeader) {
    diags.push({
      code: RinexErrorCode.MISSING_END_OF_HEADER.code,
      rule: RinexErrorCode.MISSING_END_OF_HEADER.rule,
      severity: RinexErrorCode.MISSING_END_OF_HEADER.severity,
      message: RinexErrorCode.MISSING_END_OF_HEADER.message(),
      line: Math.max(1, doc.header.rawLines.length),
      column: 1,
    });
  }

  // OBS-specific header checks
  if (doc.fileType === "O") {
    if (doc.header.observationTypes.length === 0) {
      diags.push({
        code: RinexErrorCode.MISSING_OBS_TYPES.code,
        rule: RinexErrorCode.MISSING_OBS_TYPES.rule,
        severity: RinexErrorCode.MISSING_OBS_TYPES.severity,
        message: RinexErrorCode.MISSING_OBS_TYPES.message(),
        line: 1,
        column: 1,
      });
    }
    if (!doc.header.approxPositionXyz) {
      diags.push({
        code: RinexErrorCode.MISSING_APPROX_POSITION.code,
        rule: RinexErrorCode.MISSING_APPROX_POSITION.rule,
        severity: RinexErrorCode.MISSING_APPROX_POSITION.severity,
        message: RinexErrorCode.MISSING_APPROX_POSITION.message(),
        line: 1,
        column: 1,
      });
    }
  }

  // Observation epoch checks
  let prevEpochSec: number | undefined;
  let prevEpochLabel = "";

  for (const epoch of doc.epochs) {
    const epochLabel = formatRinexTimestamp(epoch.timestamp);

    // RNX4001: Non-monotonic epoch timestamps
    if (prevEpochSec !== undefined && epoch.timestamp.epochSec <= prevEpochSec) {
      diags.push({
        code: RinexErrorCode.NON_MONOTONIC_EPOCH.code,
        rule: RinexErrorCode.NON_MONOTONIC_EPOCH.rule,
        severity: RinexErrorCode.NON_MONOTONIC_EPOCH.severity,
        message: RinexErrorCode.NON_MONOTONIC_EPOCH.message(epochLabel, prevEpochLabel),
        line: epoch.line,
        column: 1,
      });
    }
    prevEpochSec = epoch.timestamp.epochSec;
    prevEpochLabel = epochLabel;

    // RNX3001: Fewer than 4 satellites for 3D fix
    if (epoch.satellites.length < 4) {
      diags.push({
        code: RinexErrorCode.FEWER_THAN_FOUR_SATELLITES.code,
        rule: RinexErrorCode.FEWER_THAN_FOUR_SATELLITES.rule,
        severity: RinexErrorCode.FEWER_THAN_FOUR_SATELLITES.severity,
        message: RinexErrorCode.FEWER_THAN_FOUR_SATELLITES.message(String(epoch.satellites.length), epochLabel),
        line: epoch.line,
        column: 30,
      });
    }

    for (const sat of epoch.satellites) {
      // RNX3002: Invalid PRN
      if (!isValidPrn(sat.system, sat.prnNumber)) {
        diags.push({
          code: RinexErrorCode.INVALID_SATELLITE_PRN.code,
          rule: RinexErrorCode.INVALID_SATELLITE_PRN.rule,
          severity: RinexErrorCode.INVALID_SATELLITE_PRN.severity,
          message: RinexErrorCode.INVALID_SATELLITE_PRN.message(sat.prn),
          line: epoch.line,
          column: 33,
          prn: sat.prn,
        });
      }

      // RNX5001: Out-of-range pseudorange (< 15,000 km or > 35,000 km)
      for (const [obsType, obsVal] of Object.entries(sat.observations)) {
        if (PSEUDORANGE_OBS_TYPES.has(obsType)) {
          if (obsVal.value < MIN_PSEUDORANGE_M || obsVal.value > MAX_PSEUDORANGE_M) {
            const km = (obsVal.value / 1000).toFixed(2);
            diags.push({
              code: RinexErrorCode.OUT_OF_RANGE_PSEUDORANGE.code,
              rule: RinexErrorCode.OUT_OF_RANGE_PSEUDORANGE.rule,
              severity: RinexErrorCode.OUT_OF_RANGE_PSEUDORANGE.severity,
              message: RinexErrorCode.OUT_OF_RANGE_PSEUDORANGE.message(sat.prn, obsType, km),
              line: sat.line,
              column: 1,
              prn: sat.prn,
            });
          }
        }
      }
    }
  }

  // Navigation ephemeris checks
  for (const ephem of doc.ephemerides) {
    // RNX3002: Invalid GPS PRN
    if (!isValidPrn("G", ephem.prnNumber)) {
      diags.push({
        code: RinexErrorCode.INVALID_SATELLITE_PRN.code,
        rule: RinexErrorCode.INVALID_SATELLITE_PRN.rule,
        severity: RinexErrorCode.INVALID_SATELLITE_PRN.severity,
        message: RinexErrorCode.INVALID_SATELLITE_PRN.message(ephem.prn),
        line: ephem.line,
        column: 1,
        prn: ephem.prn,
      });
    }

    // RNX5002: Invalid eccentricity (e < 0 or e >= 1)
    if (!Number.isFinite(ephem.e) || ephem.e < 0 || ephem.e >= 1) {
      diags.push({
        code: RinexErrorCode.INVALID_ECCENTRICITY.code,
        rule: RinexErrorCode.INVALID_ECCENTRICITY.rule,
        severity: RinexErrorCode.INVALID_ECCENTRICITY.severity,
        message: RinexErrorCode.INVALID_ECCENTRICITY.message(ephem.prn, String(ephem.e)),
        line: ephem.line + 2,
        column: 23,
        prn: ephem.prn,
      });
    }

    // RNX5003: Invalid semi-major axis
    const semiMajorAxis = ephem.sqrtA * ephem.sqrtA;
    if (!Number.isFinite(ephem.sqrtA) || ephem.sqrtA <= 0 || semiMajorAxis < WGS84_EARTH_RADIUS_M) {
      diags.push({
        code: RinexErrorCode.INVALID_SEMI_MAJOR_AXIS.code,
        rule: RinexErrorCode.INVALID_SEMI_MAJOR_AXIS.rule,
        severity: RinexErrorCode.INVALID_SEMI_MAJOR_AXIS.severity,
        message: RinexErrorCode.INVALID_SEMI_MAJOR_AXIS.message(ephem.prn, String(ephem.sqrtA)),
        line: ephem.line + 2,
        column: 61,
        prn: ephem.prn,
      });
    }

    // RNX5004: Unhealthy satellite
    if (ephem.svHealth !== 0) {
      diags.push({
        code: RinexErrorCode.UNHEALTHY_SATELLITE.code,
        rule: RinexErrorCode.UNHEALTHY_SATELLITE.rule,
        severity: RinexErrorCode.UNHEALTHY_SATELLITE.severity,
        message: RinexErrorCode.UNHEALTHY_SATELLITE.message(ephem.prn, String(ephem.svHealth)),
        line: ephem.line + 6,
        column: 23,
        prn: ephem.prn,
      });
    }
  }

  return diags;
}
