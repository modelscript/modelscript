// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Semantic and structural linter for USGS Digital Elevation Model (DEM) files (`DEM1001`–`DEM5006`).
 */

import { UsgsDemErrorCode } from "../errors.js";
import type { UsgsDemDiagnostic, UsgsDemModel } from "../types.js";

export { UsgsDemErrorCode };

const VALID_GROUND_REF_SYSTEMS = new Set([0, 1, 2, 3]);
const VALID_PLANIMETRIC_UNITS = new Set([0, 1, 2, 3]);
const VALID_ELEVATION_UNITS = new Set([1, 2]);
const VALID_DEM_LEVELS = new Set([1, 2, 3]);

/**
 * Run all USGS DEM validation rules on a parsed `UsgsDemModel`.
 */
export function lintUsgsDem(model: UsgsDemModel): UsgsDemDiagnostic[] {
  const diags: UsgsDemDiagnostic[] = [];
  const h = model.header;

  // DEM1001 — Syntax errors recorded during parsing
  for (const err of model.syntaxErrors) {
    diags.push({
      code: UsgsDemErrorCode.SYNTAX_ERROR.code,
      rule: UsgsDemErrorCode.SYNTAX_ERROR.rule,
      severity: UsgsDemErrorCode.SYNTAX_ERROR.severity,
      message: UsgsDemErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
    });
  }

  // DEM2001 — Invalid ground planimetric reference system code
  if (!VALID_GROUND_REF_SYSTEMS.has(h.groundRefSystem)) {
    diags.push({
      code: UsgsDemErrorCode.INVALID_GROUND_REF_SYSTEM.code,
      rule: UsgsDemErrorCode.INVALID_GROUND_REF_SYSTEM.rule,
      severity: UsgsDemErrorCode.INVALID_GROUND_REF_SYSTEM.severity,
      message: UsgsDemErrorCode.INVALID_GROUND_REF_SYSTEM.message(h.groundRefSystem),
      line: h.line,
      column: 1,
    });
  }

  // DEM2002 — Invalid planimetric unit code
  if (!VALID_PLANIMETRIC_UNITS.has(h.planimetricUnits)) {
    diags.push({
      code: UsgsDemErrorCode.INVALID_PLANIMETRIC_UNIT.code,
      rule: UsgsDemErrorCode.INVALID_PLANIMETRIC_UNIT.rule,
      severity: UsgsDemErrorCode.INVALID_PLANIMETRIC_UNIT.severity,
      message: UsgsDemErrorCode.INVALID_PLANIMETRIC_UNIT.message(h.planimetricUnits),
      line: h.line,
      column: 1,
    });
  }

  // DEM2003 — Invalid elevation unit code
  if (!VALID_ELEVATION_UNITS.has(h.elevationUnits)) {
    diags.push({
      code: UsgsDemErrorCode.INVALID_ELEVATION_UNIT.code,
      rule: UsgsDemErrorCode.INVALID_ELEVATION_UNIT.rule,
      severity: UsgsDemErrorCode.INVALID_ELEVATION_UNIT.severity,
      message: UsgsDemErrorCode.INVALID_ELEVATION_UNIT.message(h.elevationUnits),
      line: h.line,
      column: 1,
    });
  }

  // DEM3001 — Non-positive spatial resolution dx/dy/dz
  const resAxes: Array<["dx" | "dy" | "dz", number]> = [
    ["dx", h.spatialResolution.dx],
    ["dy", h.spatialResolution.dy],
    ["dz", h.spatialResolution.dz],
  ];
  for (const [axis, val] of resAxes) {
    if (!Number.isFinite(val) || val <= 0) {
      diags.push({
        code: UsgsDemErrorCode.NON_POSITIVE_RESOLUTION.code,
        rule: UsgsDemErrorCode.NON_POSITIVE_RESOLUTION.rule,
        severity: UsgsDemErrorCode.NON_POSITIVE_RESOLUTION.severity,
        message: UsgsDemErrorCode.NON_POSITIVE_RESOLUTION.message(axis, val),
        line: h.line,
        column: 1,
      });
    }
  }

  // DEM5003 — Type A minElevation > maxElevation
  if (h.minElevation > h.maxElevation) {
    diags.push({
      code: UsgsDemErrorCode.INVALID_ELEVATION_RANGE.code,
      rule: UsgsDemErrorCode.INVALID_ELEVATION_RANGE.rule,
      severity: UsgsDemErrorCode.INVALID_ELEVATION_RANGE.severity,
      message: UsgsDemErrorCode.INVALID_ELEVATION_RANGE.message(h.minElevation, h.maxElevation),
      line: h.line,
      column: 1,
    });
  }

  // DEM5004 — Invalid UTM zone when groundRefSystem === 1
  if (h.groundRefSystem === 1) {
    const absZone = Math.abs(h.groundRefZone);
    if (h.groundRefZone === 0 || absZone < 1 || absZone > 60) {
      diags.push({
        code: UsgsDemErrorCode.INVALID_UTM_ZONE.code,
        rule: UsgsDemErrorCode.INVALID_UTM_ZONE.rule,
        severity: UsgsDemErrorCode.INVALID_UTM_ZONE.severity,
        message: UsgsDemErrorCode.INVALID_UTM_ZONE.message(h.groundRefZone),
        line: h.line,
        column: 1,
      });
    }
  }

  // DEM5006 — Unrecognized DEM level code
  if (!VALID_DEM_LEVELS.has(h.demLevelCode)) {
    diags.push({
      code: UsgsDemErrorCode.INVALID_DEM_LEVEL.code,
      rule: UsgsDemErrorCode.INVALID_DEM_LEVEL.rule,
      severity: UsgsDemErrorCode.INVALID_DEM_LEVEL.severity,
      message: UsgsDemErrorCode.INVALID_DEM_LEVEL.message(h.demLevelCode),
      line: h.line,
      column: 1,
    });
  }

  // DEM4001 — Missing Type B profiles
  if (model.profiles.length === 0) {
    diags.push({
      code: UsgsDemErrorCode.MISSING_TYPE_B_PROFILES.code,
      rule: UsgsDemErrorCode.MISSING_TYPE_B_PROFILES.rule,
      severity: UsgsDemErrorCode.MISSING_TYPE_B_PROFILES.severity,
      message: UsgsDemErrorCode.MISSING_TYPE_B_PROFILES.message(),
      line: h.line,
      column: 1,
    });
  } else if (h.cols > 0 && model.profiles.length !== h.cols) {
    // DEM4002 — Profile count mismatch with Type A NCOLS
    diags.push({
      code: UsgsDemErrorCode.PROFILE_COUNT_MISMATCH.code,
      rule: UsgsDemErrorCode.PROFILE_COUNT_MISMATCH.rule,
      severity: UsgsDemErrorCode.PROFILE_COUNT_MISMATCH.severity,
      message: UsgsDemErrorCode.PROFILE_COUNT_MISMATCH.message(model.profiles.length, h.cols),
      line: h.line,
      column: 1,
    });
  }

  // Per-profile checks (DEM5001, DEM5002)
  const eps = 1e-6;
  const voidVal = model.grid.voidValue;
  for (const prof of model.profiles) {
    if (prof.numRows > 0 && prof.elevations.length !== prof.numRows) {
      diags.push({
        code: UsgsDemErrorCode.PROFILE_SAMPLE_COUNT_MISMATCH.code,
        rule: UsgsDemErrorCode.PROFILE_SAMPLE_COUNT_MISMATCH.rule,
        severity: UsgsDemErrorCode.PROFILE_SAMPLE_COUNT_MISMATCH.severity,
        message: UsgsDemErrorCode.PROFILE_SAMPLE_COUNT_MISMATCH.message(
          prof.colIndex,
          prof.elevations.length,
          prof.numRows,
        ),
        line: prof.line,
        column: 1,
      });
    }

    if (h.minElevation <= h.maxElevation) {
      for (const zVal of prof.elevations) {
        if (zVal === voidVal) continue;
        if (zVal < h.minElevation - eps || zVal > h.maxElevation + eps) {
          diags.push({
            code: UsgsDemErrorCode.ELEVATION_OUT_OF_BOUNDS.code,
            rule: UsgsDemErrorCode.ELEVATION_OUT_OF_BOUNDS.rule,
            severity: UsgsDemErrorCode.ELEVATION_OUT_OF_BOUNDS.severity,
            message: UsgsDemErrorCode.ELEVATION_OUT_OF_BOUNDS.message(
              prof.colIndex,
              zVal,
              h.minElevation,
              h.maxElevation,
            ),
            line: prof.line,
            column: 1,
          });
          break; // Report once per out-of-bounds profile to avoid flooding
        }
      }
    }
  }

  // DEM5005 — Negative Type C RMSE statistics
  if (model.accuracy) {
    const a = model.accuracy;
    const rmseChecks: Array<[string, number]> = [
      ["datum.x", a.rmseDatum[0]],
      ["datum.y", a.rmseDatum[1]],
      ["datum.z", a.rmseDatum[2]],
      ["dem.x", a.rmseDem[0]],
      ["dem.y", a.rmseDem[1]],
      ["dem.z", a.rmseDem[2]],
    ];
    for (const [axis, val] of rmseChecks) {
      if (val < 0) {
        diags.push({
          code: UsgsDemErrorCode.NEGATIVE_TYPE_C_RMSE.code,
          rule: UsgsDemErrorCode.NEGATIVE_TYPE_C_RMSE.rule,
          severity: UsgsDemErrorCode.NEGATIVE_TYPE_C_RMSE.severity,
          message: UsgsDemErrorCode.NEGATIVE_TYPE_C_RMSE.message(axis, val),
          line: a.line,
          column: 1,
        });
      }
    }
  }

  return diags;
}
