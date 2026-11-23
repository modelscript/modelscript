// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — Structural, Binary & ISTP/SPDF Linter (`NCDF1001`–`NCDF5006`).
 */

import { NasaCdfErrorCode } from "../errors.js";
import { parseTimeValueToCdfEpoch } from "../solver/epoch.js";
import { isValidCdfDataType, type CdfDocument, type CdfVariable } from "../types.js";

export interface NasaCdfDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
}

const RECOMMENDED_ISTP_GLOBALS = ["Project", "Source_name", "Discipline", "Data_type", "Descriptor"] as const;

function isTimeType(dataType: string): boolean {
  return dataType === "CDF_EPOCH" || dataType === "CDF_EPOCH16" || dataType === "CDF_TIME_TT2000";
}

function getVarAttrString(v: CdfVariable, key: string): string | undefined {
  const entry = v.attributes[key] ?? v.attributes[key.toUpperCase()];
  if (!entry || entry.values.length === 0) return undefined;
  return String(entry.values[0]);
}

function getVarAttrNumbers(v: CdfVariable, key: string): number[] | undefined {
  const entry = v.attributes[key] ?? v.attributes[key.toUpperCase()];
  if (!entry || entry.values.length === 0) return undefined;
  const nums = entry.values.map(Number).filter(Number.isFinite);
  return nums.length > 0 ? nums : undefined;
}

function isIstpDataVariable(v: CdfVariable): boolean {
  if (isTimeType(v.dataType)) return false;
  const varType = getVarAttrString(v, "VAR_TYPE")?.toLowerCase();
  if (varType === "support_data" || varType === "metadata" || varType === "ignore_data") {
    return false;
  }
  if (v.dataType === "CDF_CHAR" || v.dataType === "CDF_UCHAR") {
    return varType === "data";
  }
  return v.recVariance === "T";
}

/**
 * Runs all structural, data-type, ISTP/SPDF metadata, range-bound, and epoch-monotonicity lints
 * (`NCDF1001`–`NCDF5006`) on a parsed `CdfDocument`.
 */
export function lintNasaCdf(doc: CdfDocument): NasaCdfDiagnostic[] {
  const diagnostics: NasaCdfDiagnostic[] = [];

  // 1. Parser issues (NCDF1001–NCDF1003)
  for (const issue of doc.parseIssues) {
    diagnostics.push({
      code: issue.code,
      rule: NasaCdfErrorCode.SYNTAX_ERROR.rule,
      severity: "error",
      message: issue.message,
      line: issue.line,
      column: issue.column,
    });
  }

  // 2. Mandatory skeleton sections (NCDF2001, NCDF2002)
  if (!doc.isBinary && !doc.hasHeaderSection) {
    diagnostics.push({
      code: NasaCdfErrorCode.MISSING_HEADER_SECTION.code,
      rule: NasaCdfErrorCode.MISSING_HEADER_SECTION.rule,
      severity: NasaCdfErrorCode.MISSING_HEADER_SECTION.severity,
      message: NasaCdfErrorCode.MISSING_HEADER_SECTION.message(),
      line: 1,
      column: 1,
    });
  }
  if (!doc.isBinary && !doc.hasEndSection) {
    diagnostics.push({
      code: NasaCdfErrorCode.MISSING_END_SECTION.code,
      rule: NasaCdfErrorCode.MISSING_END_SECTION.rule,
      severity: NasaCdfErrorCode.MISSING_END_SECTION.severity,
      message: NasaCdfErrorCode.MISSING_END_SECTION.message(),
      line: Math.max(1, doc.header.line),
      column: 1,
    });
  }

  // 3. Global attributes: duplicates (NCDF2004), entry types (NCDF3001), ISTP globals (NCDF5004)
  const seenGlobalAttrs = new Set<string>();
  const globalNamesLower = new Set<string>();
  for (const attr of doc.globalAttributes) {
    const key = attr.name.toLowerCase();
    if (seenGlobalAttrs.has(key)) {
      diagnostics.push({
        code: NasaCdfErrorCode.DUPLICATE_ATTRIBUTE.code,
        rule: NasaCdfErrorCode.DUPLICATE_ATTRIBUTE.rule,
        severity: NasaCdfErrorCode.DUPLICATE_ATTRIBUTE.severity,
        message: NasaCdfErrorCode.DUPLICATE_ATTRIBUTE.message("global", attr.name),
        line: attr.line,
        column: 1,
      });
    } else {
      seenGlobalAttrs.add(key);
      globalNamesLower.add(key);
    }

    for (const entry of attr.entries) {
      if (!isValidCdfDataType(entry.dataType)) {
        diagnostics.push({
          code: NasaCdfErrorCode.INVALID_CDF_DATA_TYPE.code,
          rule: NasaCdfErrorCode.INVALID_CDF_DATA_TYPE.rule,
          severity: NasaCdfErrorCode.INVALID_CDF_DATA_TYPE.severity,
          message: NasaCdfErrorCode.INVALID_CDF_DATA_TYPE.message(entry.dataType, `global attribute '${attr.name}'`),
          line: entry.line,
          column: 1,
        });
      }
    }
  }

  const missingGlobals = RECOMMENDED_ISTP_GLOBALS.filter((g) => !globalNamesLower.has(g.toLowerCase()));
  if (missingGlobals.length > 0 && doc.variables.length > 0) {
    diagnostics.push({
      code: NasaCdfErrorCode.MISSING_ISTP_GLOBAL_ATTRIBUTES.code,
      rule: NasaCdfErrorCode.MISSING_ISTP_GLOBAL_ATTRIBUTES.rule,
      severity: NasaCdfErrorCode.MISSING_ISTP_GLOBAL_ATTRIBUTES.severity,
      message: NasaCdfErrorCode.MISSING_ISTP_GLOBAL_ATTRIBUTES.message(missingGlobals.join(", ")),
      line: doc.header.line,
      column: 1,
    });
  }

  // Duplicate declared variable attribute names (NCDF2004)
  const seenVarAttrDecl = new Set<string>();
  for (const attrName of doc.variableAttributeNames) {
    const key = attrName.toLowerCase();
    if (seenVarAttrDecl.has(key)) {
      diagnostics.push({
        code: NasaCdfErrorCode.DUPLICATE_ATTRIBUTE.code,
        rule: NasaCdfErrorCode.DUPLICATE_ATTRIBUTE.rule,
        severity: NasaCdfErrorCode.DUPLICATE_ATTRIBUTE.severity,
        message: NasaCdfErrorCode.DUPLICATE_ATTRIBUTE.message("variable", attrName),
        line: doc.header.line,
        column: 1,
      });
    } else {
      seenVarAttrDecl.add(key);
    }
  }

  // Index variables for DEPEND_0 lookup & duplicate detection
  const varByName = new Map<string, CdfVariable>();
  const seenVars = new Set<string>();
  for (const v of doc.variables) {
    const key = v.name.toLowerCase();
    if (seenVars.has(key)) {
      diagnostics.push({
        code: NasaCdfErrorCode.DUPLICATE_VARIABLE.code,
        rule: NasaCdfErrorCode.DUPLICATE_VARIABLE.rule,
        severity: NasaCdfErrorCode.DUPLICATE_VARIABLE.severity,
        message: NasaCdfErrorCode.DUPLICATE_VARIABLE.message(v.name),
        line: v.line,
        column: 1,
      });
    } else {
      seenVars.add(key);
      varByName.set(key, v);
    }
  }

  // 4. Per-variable checks
  for (const v of doc.variables) {
    // NCDF3001: Invalid CDF data type
    if (!isValidCdfDataType(v.dataType)) {
      diagnostics.push({
        code: NasaCdfErrorCode.INVALID_CDF_DATA_TYPE.code,
        rule: NasaCdfErrorCode.INVALID_CDF_DATA_TYPE.rule,
        severity: NasaCdfErrorCode.INVALID_CDF_DATA_TYPE.severity,
        message: NasaCdfErrorCode.INVALID_CDF_DATA_TYPE.message(v.dataType, `variable '${v.name}'`),
        line: v.line,
        column: 1,
      });
    }

    // Check variable attribute entry types
    for (const attr of Object.values(v.attributes)) {
      if (!isValidCdfDataType(attr.dataType)) {
        diagnostics.push({
          code: NasaCdfErrorCode.INVALID_CDF_DATA_TYPE.code,
          rule: NasaCdfErrorCode.INVALID_CDF_DATA_TYPE.rule,
          severity: NasaCdfErrorCode.INVALID_CDF_DATA_TYPE.severity,
          message: NasaCdfErrorCode.INVALID_CDF_DATA_TYPE.message(
            attr.dataType,
            `attribute '${attr.attributeName}' on '${v.name}'`,
          ),
          line: attr.line,
          column: 1,
        });
      }
    }

    // NCDF3002: Dimension mismatch
    if (v.numDims !== v.dimSizes.length) {
      diagnostics.push({
        code: NasaCdfErrorCode.DIMENSION_MISMATCH.code,
        rule: NasaCdfErrorCode.DIMENSION_MISMATCH.rule,
        severity: NasaCdfErrorCode.DIMENSION_MISMATCH.severity,
        message: NasaCdfErrorCode.DIMENSION_MISMATCH.message(
          v.name,
          `declared numDims=${v.numDims} but dimSizes has ${v.dimSizes.length} entries`,
        ),
        line: v.line,
        column: 1,
      });
    } else if (v.dimVariances.length > 0 && v.dimVariances.length !== v.numDims) {
      diagnostics.push({
        code: NasaCdfErrorCode.DIMENSION_MISMATCH.code,
        rule: NasaCdfErrorCode.DIMENSION_MISMATCH.rule,
        severity: NasaCdfErrorCode.DIMENSION_MISMATCH.severity,
        message: NasaCdfErrorCode.DIMENSION_MISMATCH.message(
          v.name,
          `declared numDims=${v.numDims} but dimVariances has ${v.dimVariances.length} entries`,
        ),
        line: v.line,
        column: 1,
      });
    }

    // ISTP metadata checks for data variables (NCDF4001–NCDF4004)
    if (isIstpDataVariable(v)) {
      const depend0 = getVarAttrString(v, "DEPEND_0");
      if (!depend0) {
        diagnostics.push({
          code: NasaCdfErrorCode.ISTP_MISSING_DEPEND_0.code,
          rule: NasaCdfErrorCode.ISTP_MISSING_DEPEND_0.rule,
          severity: NasaCdfErrorCode.ISTP_MISSING_DEPEND_0.severity,
          message: NasaCdfErrorCode.ISTP_MISSING_DEPEND_0.message(v.name),
          line: v.line,
          column: 1,
        });
      } else {
        const target = varByName.get(depend0.toLowerCase());
        if (!target) {
          diagnostics.push({
            code: NasaCdfErrorCode.ISTP_INVALID_DEPEND_0_TARGET.code,
            rule: NasaCdfErrorCode.ISTP_INVALID_DEPEND_0_TARGET.rule,
            severity: NasaCdfErrorCode.ISTP_INVALID_DEPEND_0_TARGET.severity,
            message: NasaCdfErrorCode.ISTP_INVALID_DEPEND_0_TARGET.message(v.name, depend0, "variable not declared"),
            line: v.attributes["DEPEND_0"]?.line ?? v.line,
            column: 1,
          });
        } else if (!isTimeType(target.dataType)) {
          diagnostics.push({
            code: NasaCdfErrorCode.ISTP_INVALID_DEPEND_0_TARGET.code,
            rule: NasaCdfErrorCode.ISTP_INVALID_DEPEND_0_TARGET.rule,
            severity: NasaCdfErrorCode.ISTP_INVALID_DEPEND_0_TARGET.severity,
            message: NasaCdfErrorCode.ISTP_INVALID_DEPEND_0_TARGET.message(
              v.name,
              depend0,
              `target has non-time type '${target.dataType}'`,
            ),
            line: v.attributes["DEPEND_0"]?.line ?? v.line,
            column: 1,
          });
        }
      }

      const units = getVarAttrString(v, "UNITS");
      if (units === undefined) {
        diagnostics.push({
          code: NasaCdfErrorCode.ISTP_MISSING_UNITS.code,
          rule: NasaCdfErrorCode.ISTP_MISSING_UNITS.rule,
          severity: NasaCdfErrorCode.ISTP_MISSING_UNITS.severity,
          message: NasaCdfErrorCode.ISTP_MISSING_UNITS.message(v.name),
          line: v.line,
          column: 1,
        });
      }

      const validMin = getVarAttrNumbers(v, "VALIDMIN");
      const validMax = getVarAttrNumbers(v, "VALIDMAX");
      if (!validMin) {
        diagnostics.push({
          code: NasaCdfErrorCode.ISTP_MISSING_VALID_BOUNDS.code,
          rule: NasaCdfErrorCode.ISTP_MISSING_VALID_BOUNDS.rule,
          severity: NasaCdfErrorCode.ISTP_MISSING_VALID_BOUNDS.severity,
          message: NasaCdfErrorCode.ISTP_MISSING_VALID_BOUNDS.message(v.name, "VALIDMIN"),
          line: v.line,
          column: 1,
        });
      }
      if (!validMax) {
        diagnostics.push({
          code: NasaCdfErrorCode.ISTP_MISSING_VALID_BOUNDS.code,
          rule: NasaCdfErrorCode.ISTP_MISSING_VALID_BOUNDS.rule,
          severity: NasaCdfErrorCode.ISTP_MISSING_VALID_BOUNDS.severity,
          message: NasaCdfErrorCode.ISTP_MISSING_VALID_BOUNDS.message(v.name, "VALIDMAX"),
          line: v.line,
          column: 1,
        });
      }
    }

    // NCDF5001, NCDF5002, NCDF5005: Valid bounds & FILLVAL checks
    const validMinArr = getVarAttrNumbers(v, "VALIDMIN");
    const validMaxArr = getVarAttrNumbers(v, "VALIDMAX");
    const fillValArr = getVarAttrNumbers(v, "FILLVAL");

    if (validMinArr && validMaxArr) {
      const minBound = validMinArr[0]!;
      const maxBound = validMaxArr[0]!;
      if (minBound > maxBound) {
        diagnostics.push({
          code: NasaCdfErrorCode.INVALID_VALID_BOUNDS.code,
          rule: NasaCdfErrorCode.INVALID_VALID_BOUNDS.rule,
          severity: NasaCdfErrorCode.INVALID_VALID_BOUNDS.severity,
          message: NasaCdfErrorCode.INVALID_VALID_BOUNDS.message(v.name, String(minBound), String(maxBound)),
          line: v.attributes["VALIDMIN"]?.line ?? v.line,
          column: 1,
        });
      } else {
        // Check FILLVAL collision
        if (fillValArr) {
          const fv = fillValArr[0]!;
          if (fv >= minBound && fv <= maxBound) {
            diagnostics.push({
              code: NasaCdfErrorCode.FILLVAL_IN_VALID_RANGE.code,
              rule: NasaCdfErrorCode.FILLVAL_IN_VALID_RANGE.rule,
              severity: NasaCdfErrorCode.FILLVAL_IN_VALID_RANGE.severity,
              message: NasaCdfErrorCode.FILLVAL_IN_VALID_RANGE.message(
                v.name,
                String(fv),
                String(minBound),
                String(maxBound),
              ),
              line: v.attributes["FILLVAL"]?.line ?? v.line,
              column: 1,
            });
          }
        }

        // Check sample values against [VALIDMIN, VALIDMAX]
        const fillVal = fillValArr?.[0];
        for (let rIdx = 0; rIdx < v.values.length; rIdx++) {
          const rec = v.values[rIdx]!;
          const nums = Array.isArray(rec) ? rec.map(Number) : [Number(rec)];
          for (let c = 0; c < nums.length; c++) {
            const val = nums[c]!;
            if (!Number.isFinite(val)) continue;
            if (fillVal !== undefined && Math.abs(val - fillVal) <= Math.max(1e-6 * Math.abs(fillVal), 1e-12)) {
              continue;
            }
            const cMin = validMinArr[c] ?? minBound;
            const cMax = validMaxArr[c] ?? maxBound;
            if (val < cMin || val > cMax) {
              diagnostics.push({
                code: NasaCdfErrorCode.VALUE_OUT_OF_VALID_RANGE.code,
                rule: NasaCdfErrorCode.VALUE_OUT_OF_VALID_RANGE.rule,
                severity: NasaCdfErrorCode.VALUE_OUT_OF_VALID_RANGE.severity,
                message: NasaCdfErrorCode.VALUE_OUT_OF_VALID_RANGE.message(
                  v.name,
                  String(rIdx),
                  String(val),
                  String(cMin),
                  String(cMax),
                ),
                line: v.line,
                column: 1,
              });
            }
          }
        }
      }
    }

    // NCDF5003: Non-monotonic EPOCH / TT2000 timestamps
    if (isTimeType(v.dataType) && v.values.length > 1) {
      let prevMs: number | undefined;
      for (let rIdx = 0; rIdx < v.values.length; rIdx++) {
        const rec = v.values[rIdx]!;
        if (typeof rec !== "number" && typeof rec !== "string") continue;
        const currMs = parseTimeValueToCdfEpoch(rec, v.dataType);
        if (currMs === undefined) continue;
        if (prevMs !== undefined && currMs <= prevMs) {
          diagnostics.push({
            code: NasaCdfErrorCode.NON_MONOTONIC_EPOCH.code,
            rule: NasaCdfErrorCode.NON_MONOTONIC_EPOCH.rule,
            severity: NasaCdfErrorCode.NON_MONOTONIC_EPOCH.severity,
            message: NasaCdfErrorCode.NON_MONOTONIC_EPOCH.message(v.name, String(rIdx), String(prevMs), String(currMs)),
            line: v.line,
            column: 1,
          });
        }
        prevMs = currMs;
      }
    }

    // NCDF5006: Empty data records for record-varying variable
    if (v.recVariance === "T" && v.values.length === 0) {
      diagnostics.push({
        code: NasaCdfErrorCode.EMPTY_DATA_RECORDS.code,
        rule: NasaCdfErrorCode.EMPTY_DATA_RECORDS.rule,
        severity: NasaCdfErrorCode.EMPTY_DATA_RECORDS.severity,
        message: NasaCdfErrorCode.EMPTY_DATA_RECORDS.message(v.name),
        line: v.line,
        column: 1,
      });
    }
  }

  return diagnostics;
}
