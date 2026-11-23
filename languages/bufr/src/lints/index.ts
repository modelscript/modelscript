// SPDX-License-Identifier: AGPL-3.0-or-later

import { BufrErrorCode, type BufrDiagnostic } from "../errors.js";
import { parseBufrText } from "../parser/text-parser.js";
import { expandBufrDescriptors } from "../solver/descriptor-tree.js";
import type { BufrMessage } from "../types.js";

export { BufrErrorCode, type BufrDiagnostic } from "../errors.js";

/**
 * Validates a WMO BUFR message (textual source or parsed `BufrMessage`) against
 * structural, descriptor-table, replication, and physical meteorological lint rules (BUFR1001–BUFR5006).
 */
export function lintBufr(input: string | BufrMessage): BufrDiagnostic[] {
  const msg = typeof input === "string" ? parseBufrText(input) : input;
  const diagnostics: BufrDiagnostic[] = [];

  // BUFR1001: Syntax or magic header error
  if (!msg.hasMagicHeader) {
    diagnostics.push({
      code: BufrErrorCode.SYNTAX_OR_MAGIC_ERROR.code,
      rule: BufrErrorCode.SYNTAX_OR_MAGIC_ERROR.rule,
      severity: BufrErrorCode.SYNTAX_OR_MAGIC_ERROR.severity,
      message: BufrErrorCode.SYNTAX_OR_MAGIC_ERROR.message("missing 'BUFR' Section 0 magic header"),
      line: 1,
      column: 1,
    });
  }
  for (const err of msg.syntaxErrors) {
    diagnostics.push({
      code: BufrErrorCode.SYNTAX_OR_MAGIC_ERROR.code,
      rule: BufrErrorCode.SYNTAX_OR_MAGIC_ERROR.rule,
      severity: BufrErrorCode.SYNTAX_OR_MAGIC_ERROR.severity,
      message: BufrErrorCode.SYNTAX_OR_MAGIC_ERROR.message(err.message),
      line: err.line,
      column: err.column,
    });
  }

  // BUFR1002: Missing 7777 end-of-message sentinel
  if (!msg.hasEndMarker) {
    const lastLine = msg.rawText ? msg.rawText.split(/\r?\n/).length : 1;
    diagnostics.push({
      code: BufrErrorCode.MISSING_END_SECTION.code,
      rule: BufrErrorCode.MISSING_END_SECTION.rule,
      severity: BufrErrorCode.MISSING_END_SECTION.severity,
      message: BufrErrorCode.MISSING_END_SECTION.message(),
      line: lastLine,
      column: 1,
    });
  }

  // BUFR2001 / BUFR2002 / BUFR2003: F, X, Y descriptor range validation
  const validDescriptors = [];
  for (const d of msg.section3.descriptors) {
    let invalid = false;
    if (d.f < 0 || d.f > 3) {
      diagnostics.push({
        code: BufrErrorCode.INVALID_DESCRIPTOR_F.code,
        rule: BufrErrorCode.INVALID_DESCRIPTOR_F.rule,
        severity: BufrErrorCode.INVALID_DESCRIPTOR_F.severity,
        message: BufrErrorCode.INVALID_DESCRIPTOR_F.message(d.code, d.f),
        line: d.line ?? msg.section3.line ?? 1,
        column: 1,
      });
      invalid = true;
    }
    if (d.x < 0 || d.x > 63) {
      diagnostics.push({
        code: BufrErrorCode.INVALID_DESCRIPTOR_X.code,
        rule: BufrErrorCode.INVALID_DESCRIPTOR_X.rule,
        severity: BufrErrorCode.INVALID_DESCRIPTOR_X.severity,
        message: BufrErrorCode.INVALID_DESCRIPTOR_X.message(d.code, d.x),
        line: d.line ?? msg.section3.line ?? 1,
        column: 1,
      });
      invalid = true;
    }
    if (d.y < 0 || d.y > 255) {
      diagnostics.push({
        code: BufrErrorCode.INVALID_DESCRIPTOR_Y.code,
        rule: BufrErrorCode.INVALID_DESCRIPTOR_Y.rule,
        severity: BufrErrorCode.INVALID_DESCRIPTOR_Y.severity,
        message: BufrErrorCode.INVALID_DESCRIPTOR_Y.message(d.code, d.y),
        line: d.line ?? msg.section3.line ?? 1,
        column: 1,
      });
      invalid = true;
    }
    if (!invalid) {
      validDescriptors.push(d);
    }
  }

  // Extract delayed replication counts from first subset if present
  const delayedCounts: number[] = [];
  if (msg.subsets.length > 0) {
    for (const obs of msg.subsets[0]!.values) {
      if ((obs.descriptor === "0-31-001" || obs.descriptor === "0-31-002") && typeof obs.value === "number") {
        delayedCounts.push(obs.value);
      }
    }
  }

  // Expand descriptors to check BUFR3001 (unknown Table B/D) and BUFR4002 (delayed replication)
  const expanded = expandBufrDescriptors(validDescriptors, {
    customTableB: msg.customTableB,
    customTableD: msg.customTableD,
    delayedCounts,
  });

  const seenUnknown = new Set<string>();
  for (const unk of expanded.unknownDescriptors) {
    if (seenUnknown.has(unk.code)) continue;
    seenUnknown.add(unk.code);
    diagnostics.push({
      code: BufrErrorCode.UNKNOWN_DESCRIPTOR.code,
      rule: BufrErrorCode.UNKNOWN_DESCRIPTOR.rule,
      severity: BufrErrorCode.UNKNOWN_DESCRIPTOR.severity,
      message: BufrErrorCode.UNKNOWN_DESCRIPTOR.message(unk.code),
      line: unk.line ?? msg.section3.line ?? 1,
      column: 1,
    });
  }

  for (const repErr of expanded.replicationErrors) {
    diagnostics.push({
      code: BufrErrorCode.DELAYED_REPLICATION_ERROR.code,
      rule: BufrErrorCode.DELAYED_REPLICATION_ERROR.rule,
      severity: BufrErrorCode.DELAYED_REPLICATION_ERROR.severity,
      message: BufrErrorCode.DELAYED_REPLICATION_ERROR.message(repErr.message),
      line: repErr.descriptor.line ?? msg.section3.line ?? 1,
      column: 1,
    });
  }

  // BUFR4001: Subset count mismatch
  if (msg.section3.subsetCount !== msg.subsets.length) {
    diagnostics.push({
      code: BufrErrorCode.SUBSET_COUNT_MISMATCH.code,
      rule: BufrErrorCode.SUBSET_COUNT_MISMATCH.rule,
      severity: BufrErrorCode.SUBSET_COUNT_MISMATCH.severity,
      message: BufrErrorCode.SUBSET_COUNT_MISMATCH.message(msg.section3.subsetCount, msg.subsets.length),
      line: msg.section3.line ?? 1,
      column: 1,
    });
  }

  // BUFR5001–BUFR5006: Physical meteorological range & thermodynamic consistency checks
  for (const subset of msg.subsets) {
    let lastTempK: number | undefined;
    let lastTempLine = subset.line ?? 1;

    for (const obs of subset.values) {
      if (typeof obs.value !== "number") continue;
      const val = obs.value;
      const line = obs.line ?? subset.line ?? 1;
      const d = obs.descriptor;

      // Delayed replication count negative check in data values
      if (d === "0-31-001" || d === "0-31-002") {
        if (!Number.isInteger(val) || val < 0) {
          diagnostics.push({
            code: BufrErrorCode.DELAYED_REPLICATION_ERROR.code,
            rule: BufrErrorCode.DELAYED_REPLICATION_ERROR.rule,
            severity: BufrErrorCode.DELAYED_REPLICATION_ERROR.severity,
            message: BufrErrorCode.DELAYED_REPLICATION_ERROR.message(
              `delayed replication factor '${d}' has invalid count '${val}'`,
            ),
            line,
            column: 1,
          });
        }
      }

      // BUFR5001: Temperature range [150, 360] K
      if (d === "0-12-101" || d === "0-12-001") {
        lastTempK = val;
        lastTempLine = line;
        if (val < 150 || val > 360) {
          diagnostics.push({
            code: BufrErrorCode.TEMPERATURE_OUT_OF_RANGE.code,
            rule: BufrErrorCode.TEMPERATURE_OUT_OF_RANGE.rule,
            severity: BufrErrorCode.TEMPERATURE_OUT_OF_RANGE.severity,
            message: BufrErrorCode.TEMPERATURE_OUT_OF_RANGE.message(d, val),
            line,
            column: 1,
          });
        }
      }

      // BUFR5001 & BUFR5003: Dewpoint range and Td <= T check
      if (d === "0-12-103" || d === "0-12-003") {
        if (val < 150 || val > 360) {
          diagnostics.push({
            code: BufrErrorCode.TEMPERATURE_OUT_OF_RANGE.code,
            rule: BufrErrorCode.TEMPERATURE_OUT_OF_RANGE.rule,
            severity: BufrErrorCode.TEMPERATURE_OUT_OF_RANGE.severity,
            message: BufrErrorCode.TEMPERATURE_OUT_OF_RANGE.message(d, val),
            line,
            column: 1,
          });
        }
        if (lastTempK !== undefined && val > lastTempK + 0.05) {
          diagnostics.push({
            code: BufrErrorCode.DEWPOINT_EXCEEDS_TEMPERATURE.code,
            rule: BufrErrorCode.DEWPOINT_EXCEEDS_TEMPERATURE.rule,
            severity: BufrErrorCode.DEWPOINT_EXCEEDS_TEMPERATURE.severity,
            message: BufrErrorCode.DEWPOINT_EXCEEDS_TEMPERATURE.message(val, lastTempK),
            line: Math.max(line, lastTempLine),
            column: 1,
          });
        }
      }

      // BUFR5002: Relative humidity [0, 100] %
      if (d === "0-13-003") {
        if (val < 0 || val > 100) {
          diagnostics.push({
            code: BufrErrorCode.RELATIVE_HUMIDITY_OUT_OF_RANGE.code,
            rule: BufrErrorCode.RELATIVE_HUMIDITY_OUT_OF_RANGE.rule,
            severity: BufrErrorCode.RELATIVE_HUMIDITY_OUT_OF_RANGE.severity,
            message: BufrErrorCode.RELATIVE_HUMIDITY_OUT_OF_RANGE.message(d, val),
            line,
            column: 1,
          });
        }
      }

      // BUFR5004: Pressure [0, 115000] Pa
      if (d === "0-07-004" || d === "0-10-004" || d === "0-10-051") {
        if (val < 0 || val > 115000) {
          diagnostics.push({
            code: BufrErrorCode.PRESSURE_OUT_OF_RANGE.code,
            rule: BufrErrorCode.PRESSURE_OUT_OF_RANGE.rule,
            severity: BufrErrorCode.PRESSURE_OUT_OF_RANGE.severity,
            message: BufrErrorCode.PRESSURE_OUT_OF_RANGE.message(d, val),
            line,
            column: 1,
          });
        }
      }

      // BUFR5005: Latitude [-90, 90], Longitude [-180, 180]
      if (d === "0-05-001" || d === "0-05-002") {
        if (val < -90 || val > 90) {
          diagnostics.push({
            code: BufrErrorCode.COORDINATE_OUT_OF_RANGE.code,
            rule: BufrErrorCode.COORDINATE_OUT_OF_RANGE.rule,
            severity: BufrErrorCode.COORDINATE_OUT_OF_RANGE.severity,
            message: BufrErrorCode.COORDINATE_OUT_OF_RANGE.message(d, val, "[-90, 90] deg"),
            line,
            column: 1,
          });
        }
      }
      if (d === "0-06-001" || d === "0-06-002") {
        if (val < -180 || val > 180) {
          diagnostics.push({
            code: BufrErrorCode.COORDINATE_OUT_OF_RANGE.code,
            rule: BufrErrorCode.COORDINATE_OUT_OF_RANGE.rule,
            severity: BufrErrorCode.COORDINATE_OUT_OF_RANGE.severity,
            message: BufrErrorCode.COORDINATE_OUT_OF_RANGE.message(d, val, "[-180, 180] deg"),
            line,
            column: 1,
          });
        }
      }

      // BUFR5006: Wind direction [0, 360] deg, wind speed >= 0 m/s
      if (d === "0-11-001" && (val < 0 || val > 360)) {
        diagnostics.push({
          code: BufrErrorCode.WIND_OUT_OF_RANGE.code,
          rule: BufrErrorCode.WIND_OUT_OF_RANGE.rule,
          severity: BufrErrorCode.WIND_OUT_OF_RANGE.severity,
          message: BufrErrorCode.WIND_OUT_OF_RANGE.message(d, val, "wind direction must be in [0, 360] deg"),
          line,
          column: 1,
        });
      }
      if (d === "0-11-002" && (val < 0 || val > 200)) {
        diagnostics.push({
          code: BufrErrorCode.WIND_OUT_OF_RANGE.code,
          rule: BufrErrorCode.WIND_OUT_OF_RANGE.rule,
          severity: BufrErrorCode.WIND_OUT_OF_RANGE.severity,
          message: BufrErrorCode.WIND_OUT_OF_RANGE.message(d, val, "wind speed must be in [0, 200] m/s"),
          line,
          column: 1,
        });
      }
    }
  }

  return diagnostics;
}
