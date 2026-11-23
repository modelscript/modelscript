// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ARINC 429 avionics bus schema and 32-bit word linter (`A4291001`–`A4295006`).
 */

import { Arinc429ErrorCode } from "../errors.js";
import { decodeArinc429Word } from "../parser/codec.js";
import { analyzeBusUtilization, findLabelDef } from "../solver/index.js";
import type { Arinc429Diagnostic, Arinc429Document } from "../types.js";

export { Arinc429ErrorCode };

/**
 * Runs all ARINC 429 lint rules (`A4291001`–`A4295006`) on a parsed document.
 */
export function lintArinc429(doc: Arinc429Document): Arinc429Diagnostic[] {
  const diagnostics: Arinc429Diagnostic[] = [];

  // 1. Syntax errors (A4291001)
  for (const err of doc.parseErrors) {
    diagnostics.push({
      code: Arinc429ErrorCode.SYNTAX_ERROR.code,
      rule: Arinc429ErrorCode.SYNTAX_ERROR.rule,
      severity: Arinc429ErrorCode.SYNTAX_ERROR.severity,
      message: Arinc429ErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
    });
  }

  // 2. Missing explicit bus rate (A4295006)
  if (!doc.rateExplicit && (doc.labels.length > 0 || doc.frames.length > 0)) {
    diagnostics.push({
      code: Arinc429ErrorCode.MISSING_BUS_RATE.code,
      rule: Arinc429ErrorCode.MISSING_BUS_RATE.rule,
      severity: Arinc429ErrorCode.MISSING_BUS_RATE.severity,
      message: Arinc429ErrorCode.MISSING_BUS_RATE.message(doc.busName),
      line: 1,
      column: 1,
    });
  }

  // 3. Label schema checks: octal validity (A4292001), SDI bounds (A4295005), duplicates (A4292002)
  const seenLabels = new Set<string>();
  for (const label of doc.labels) {
    const line = label.line ?? 1;

    if (Number.isNaN(label.labelValue) || label.labelValue < 1 || label.labelValue > 0o377) {
      diagnostics.push({
        code: Arinc429ErrorCode.INVALID_OCTAL_LABEL.code,
        rule: Arinc429ErrorCode.INVALID_OCTAL_LABEL.rule,
        severity: Arinc429ErrorCode.INVALID_OCTAL_LABEL.severity,
        message: Arinc429ErrorCode.INVALID_OCTAL_LABEL.message(label.labelOctal),
        line,
        column: 1,
        labelOctal: label.labelOctal,
      });
    } else {
      const sdiKey = label.sdi !== undefined ? String(label.sdi) : "*";
      const dupKey = `${label.labelOctal}:${sdiKey}`;
      if (seenLabels.has(dupKey)) {
        diagnostics.push({
          code: Arinc429ErrorCode.DUPLICATE_LABEL.code,
          rule: Arinc429ErrorCode.DUPLICATE_LABEL.rule,
          severity: Arinc429ErrorCode.DUPLICATE_LABEL.severity,
          message: Arinc429ErrorCode.DUPLICATE_LABEL.message(label.labelOctal, sdiKey),
          line,
          column: 1,
          labelOctal: label.labelOctal,
        });
      } else {
        seenLabels.add(dupKey);
      }
    }

    if (label.sdi !== undefined && (label.sdi < 0 || label.sdi > 3)) {
      diagnostics.push({
        code: Arinc429ErrorCode.INVALID_SDI.code,
        rule: Arinc429ErrorCode.INVALID_SDI.rule,
        severity: Arinc429ErrorCode.INVALID_SDI.severity,
        message: Arinc429ErrorCode.INVALID_SDI.message(String(label.sdi), label.labelOctal),
        line,
        column: 1,
        labelOctal: label.labelOctal,
      });
    }
  }

  // 4. Bus bandwidth utilization checks (A4295001 > 100%, A4295002 > 80%)
  const util = analyzeBusUtilization(doc);
  if (util.utilizationPct > 100) {
    diagnostics.push({
      code: Arinc429ErrorCode.BUS_BANDWIDTH_EXCEEDED.code,
      rule: Arinc429ErrorCode.BUS_BANDWIDTH_EXCEEDED.rule,
      severity: Arinc429ErrorCode.BUS_BANDWIDTH_EXCEEDED.severity,
      message: Arinc429ErrorCode.BUS_BANDWIDTH_EXCEEDED.message(
        util.utilizationPct.toFixed(1),
        util.rate,
        String(util.bitRateBps),
      ),
      line: 1,
      column: 1,
    });
  } else if (util.utilizationPct > 80) {
    diagnostics.push({
      code: Arinc429ErrorCode.BUS_BANDWIDTH_HIGH.code,
      rule: Arinc429ErrorCode.BUS_BANDWIDTH_HIGH.rule,
      severity: Arinc429ErrorCode.BUS_BANDWIDTH_HIGH.severity,
      message: Arinc429ErrorCode.BUS_BANDWIDTH_HIGH.message(util.utilizationPct.toFixed(1), util.rate),
      line: 1,
      column: 1,
    });
  }

  // 5. Trace word checks: parity (A4293001), BCD nibbles (A4293002), SSM FW/NCD (A4294001/A4294002),
  //    unknown label (A4295003), range exceeded (A4295004)
  for (const frame of doc.frames) {
    const line = frame.line ?? 1;
    const prelim = decodeArinc429Word(frame.rawWord);
    const labelDef = findLabelDef(doc, prelim.labelOctal, prelim.sdi);
    const decoded = labelDef ? decodeArinc429Word(frame.rawWord, labelDef) : prelim;

    // Odd parity check
    if (!decoded.parityValid) {
      diagnostics.push({
        code: Arinc429ErrorCode.PARITY_ERROR.code,
        rule: Arinc429ErrorCode.PARITY_ERROR.rule,
        severity: Arinc429ErrorCode.PARITY_ERROR.severity,
        message: Arinc429ErrorCode.PARITY_ERROR.message(decoded.rawHex, decoded.labelOctal),
        line,
        column: 1,
        labelOctal: decoded.labelOctal,
      });
    }

    // Undeclared label when bus schema defines labels
    if (doc.labels.length > 0 && !labelDef) {
      diagnostics.push({
        code: Arinc429ErrorCode.UNKNOWN_WORD_LABEL.code,
        rule: Arinc429ErrorCode.UNKNOWN_WORD_LABEL.rule,
        severity: Arinc429ErrorCode.UNKNOWN_WORD_LABEL.severity,
        message: Arinc429ErrorCode.UNKNOWN_WORD_LABEL.message(decoded.labelOctal, decoded.rawHex),
        line,
        column: 1,
        labelOctal: decoded.labelOctal,
      });
    }

    // BCD nibble validity check
    if (decoded.encoding === "BCD" && !decoded.bcdValid) {
      diagnostics.push({
        code: Arinc429ErrorCode.INVALID_BCD_NIBBLE.code,
        rule: Arinc429ErrorCode.INVALID_BCD_NIBBLE.rule,
        severity: Arinc429ErrorCode.INVALID_BCD_NIBBLE.severity,
        message: Arinc429ErrorCode.INVALID_BCD_NIBBLE.message(decoded.rawHex, decoded.invalidBcdDigits.join(", ")),
        line,
        column: 1,
        labelOctal: decoded.labelOctal,
      });
    }

    // SSM Failure Warning / No Computed Data
    if (decoded.ssmMeaning === "FAILURE_WARNING") {
      diagnostics.push({
        code: Arinc429ErrorCode.SSM_FAILURE_WARNING.code,
        rule: Arinc429ErrorCode.SSM_FAILURE_WARNING.rule,
        severity: Arinc429ErrorCode.SSM_FAILURE_WARNING.severity,
        message: Arinc429ErrorCode.SSM_FAILURE_WARNING.message(decoded.rawHex, decoded.labelOctal),
        line,
        column: 1,
        labelOctal: decoded.labelOctal,
      });
    } else if (decoded.ssmMeaning === "NO_COMPUTED_DATA") {
      diagnostics.push({
        code: Arinc429ErrorCode.SSM_NO_COMPUTED_DATA.code,
        rule: Arinc429ErrorCode.SSM_NO_COMPUTED_DATA.rule,
        severity: Arinc429ErrorCode.SSM_NO_COMPUTED_DATA.severity,
        message: Arinc429ErrorCode.SSM_NO_COMPUTED_DATA.message(decoded.rawHex, decoded.labelOctal),
        line,
        column: 1,
        labelOctal: decoded.labelOctal,
      });
    }

    // Engineering range check
    if (
      labelDef?.range !== undefined &&
      decoded.encoding !== "DISCRETE" &&
      Math.abs(decoded.engineeringValue) > labelDef.range * 1.0001
    ) {
      diagnostics.push({
        code: Arinc429ErrorCode.RANGE_EXCEEDED.code,
        rule: Arinc429ErrorCode.RANGE_EXCEEDED.rule,
        severity: Arinc429ErrorCode.RANGE_EXCEEDED.severity,
        message: Arinc429ErrorCode.RANGE_EXCEEDED.message(
          decoded.labelOctal,
          decoded.engineeringValue.toFixed(3),
          String(labelDef.range),
        ),
        line,
        column: 1,
        labelOctal: decoded.labelOctal,
      });
    }
  }

  return diagnostics;
}
