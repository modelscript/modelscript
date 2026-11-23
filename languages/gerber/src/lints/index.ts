// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis & IPC-2221 DFM Linter for Gerber RS-274-D & RS-274X (`GRB1001`–`GRB5006`).
 */

import { resolveGerberArc, unitToMm } from "../cad/geometry.js";
import { GerberErrorCode, type GerberDiagnostic } from "../errors.js";
import type { GerberDocument, GerberPoint } from "../types.js";

export interface GerberLintOptions {
  /** Minimum allowable trace width in mm (default: 0.127 mm = 5 mil, IPC-2221 Class 2). */
  minTraceWidthMm?: number | undefined;
  /** Minimum allowable annular ring in mm (default: 0.127 mm = 5 mil, IPC-2221 Class 2). */
  minAnnularRingMm?: number | undefined;
  /** Arc radius mismatch tolerance in mm (default: 0.01 mm). */
  arcRadiusToleranceMm?: number | undefined;
}

/**
 * Runs all syntax, semantic, and IPC-2221 DFM diagnostic checks (`GRB1001`–`GRB5006`)
 * against a parsed `GerberDocument`.
 */
export function lintGerber(doc: GerberDocument, options: GerberLintOptions = {}): GerberDiagnostic[] {
  const minTraceWidthMm = options.minTraceWidthMm ?? 0.127;
  const minAnnularRingMm = options.minAnnularRingMm ?? 0.127;
  const arcRadiusToleranceMm = options.arcRadiusToleranceMm ?? 0.01;
  const diagnostics: GerberDiagnostic[] = [];

  // GRB1001: Syntax / parser errors
  for (const err of doc.parseErrors) {
    diagnostics.push({
      code: GerberErrorCode.SYNTAX_ERROR.code,
      id: GerberErrorCode.SYNTAX_ERROR.id,
      rule: GerberErrorCode.SYNTAX_ERROR.rule,
      severity: GerberErrorCode.SYNTAX_ERROR.severity,
      message: GerberErrorCode.SYNTAX_ERROR.message(err.message),
      startOffset: err.startOffset,
      endOffset: err.endOffset,
      line: err.line,
      column: err.column,
    });
  }

  // GRB2001: Missing %FS format specification
  if (!doc.formatSpec) {
    diagnostics.push({
      code: GerberErrorCode.MISSING_FORMAT_SPEC.code,
      id: GerberErrorCode.MISSING_FORMAT_SPEC.id,
      rule: GerberErrorCode.MISSING_FORMAT_SPEC.rule,
      severity: GerberErrorCode.MISSING_FORMAT_SPEC.severity,
      message: GerberErrorCode.MISSING_FORMAT_SPEC.message(),
      line: 1,
      column: 1,
    });
  }

  // GRB2002: Missing %MO (or legacy G70/G71) unit specification
  if (!doc.hasExplicitUnit || !doc.unit) {
    diagnostics.push({
      code: GerberErrorCode.MISSING_UNIT_SPEC.code,
      id: GerberErrorCode.MISSING_UNIT_SPEC.id,
      rule: GerberErrorCode.MISSING_UNIT_SPEC.rule,
      severity: GerberErrorCode.MISSING_UNIT_SPEC.severity,
      message: GerberErrorCode.MISSING_UNIT_SPEC.message(),
      line: 1,
      column: 1,
    });
  }

  // GRB5005: Legacy RS-274-D features
  if (doc.hasLegacyUnitCommand) {
    diagnostics.push({
      code: GerberErrorCode.DFM_LEGACY_RS274D_MODE.code,
      id: GerberErrorCode.DFM_LEGACY_RS274D_MODE.id,
      rule: GerberErrorCode.DFM_LEGACY_RS274D_MODE.rule,
      severity: GerberErrorCode.DFM_LEGACY_RS274D_MODE.severity,
      message: GerberErrorCode.DFM_LEGACY_RS274D_MODE.message("G70/G71"),
      line: 1,
      column: 1,
    });
  }
  if (doc.hasIncrementalMode) {
    diagnostics.push({
      code: GerberErrorCode.DFM_LEGACY_RS274D_MODE.code,
      id: GerberErrorCode.DFM_LEGACY_RS274D_MODE.id,
      rule: GerberErrorCode.DFM_LEGACY_RS274D_MODE.rule,
      severity: GerberErrorCode.DFM_LEGACY_RS274D_MODE.severity,
      message: GerberErrorCode.DFM_LEGACY_RS274D_MODE.message("G91/Incremental"),
      line: 1,
      column: 1,
    });
  }

  const effectiveUnit = doc.unit ?? "MM";

  // Aperture definition DFM checks (GRB5003, GRB5004, GRB5002)
  for (const [dCode, ap] of doc.apertures) {
    const widthMm = unitToMm(ap.width, effectiveUnit);
    const heightMm = unitToMm(ap.height, effectiveUnit);
    const holeMm = unitToMm(ap.holeDiameter ?? 0, effectiveUnit);

    if (ap.shape !== "MACRO" && (widthMm <= 0 || heightMm <= 0)) {
      diagnostics.push({
        code: GerberErrorCode.DFM_ZERO_SIZE_APERTURE.code,
        id: GerberErrorCode.DFM_ZERO_SIZE_APERTURE.id,
        rule: GerberErrorCode.DFM_ZERO_SIZE_APERTURE.rule,
        severity: GerberErrorCode.DFM_ZERO_SIZE_APERTURE.severity,
        message: GerberErrorCode.DFM_ZERO_SIZE_APERTURE.message(dCode),
        startOffset: ap.startOffset,
        endOffset: ap.endOffset,
        line: ap.line,
        column: ap.column,
        dCode,
      });
      continue;
    }

    if (holeMm > 0) {
      const outerMinMm = Math.min(widthMm, heightMm);
      if (holeMm >= outerMinMm) {
        diagnostics.push({
          code: GerberErrorCode.DFM_HOLE_EXCEEDS_PAD.code,
          id: GerberErrorCode.DFM_HOLE_EXCEEDS_PAD.id,
          rule: GerberErrorCode.DFM_HOLE_EXCEEDS_PAD.rule,
          severity: GerberErrorCode.DFM_HOLE_EXCEEDS_PAD.severity,
          message: GerberErrorCode.DFM_HOLE_EXCEEDS_PAD.message(dCode, holeMm, outerMinMm),
          startOffset: ap.startOffset,
          endOffset: ap.endOffset,
          line: ap.line,
          column: ap.column,
          dCode,
        });
      } else {
        const ringMm = 0.5 * (outerMinMm - holeMm);
        if (ringMm + 1e-9 < minAnnularRingMm) {
          diagnostics.push({
            code: GerberErrorCode.DFM_MIN_ANNULAR_RING.code,
            id: GerberErrorCode.DFM_MIN_ANNULAR_RING.id,
            rule: GerberErrorCode.DFM_MIN_ANNULAR_RING.rule,
            severity: GerberErrorCode.DFM_MIN_ANNULAR_RING.severity,
            message: GerberErrorCode.DFM_MIN_ANNULAR_RING.message(dCode, ringMm, minAnnularRingMm),
            startOffset: ap.startOffset,
            endOffset: ap.endOffset,
            line: ap.line,
            column: ap.column,
            dCode,
          });
        }
      }
    }
  }

  // Command stream semantic & DFM checks
  let inRegion = false;
  let regionStartSpan: { startOffset: number; endOffset: number; line: number; column: number } | null = null;
  let currentPoint: GerberPoint = { x: 0, y: 0 };
  const reportedThinApertures = new Set<number>();

  for (const cmd of doc.commands) {
    if (cmd.kind === "SELECT_APERTURE") {
      if (!doc.apertures.has(cmd.dCode)) {
        diagnostics.push({
          code: GerberErrorCode.UNDEFINED_APERTURE.code,
          id: GerberErrorCode.UNDEFINED_APERTURE.id,
          rule: GerberErrorCode.UNDEFINED_APERTURE.rule,
          severity: GerberErrorCode.UNDEFINED_APERTURE.severity,
          message: GerberErrorCode.UNDEFINED_APERTURE.message(cmd.dCode),
          startOffset: cmd.startOffset,
          endOffset: cmd.endOffset,
          line: cmd.line,
          column: cmd.column,
          dCode: cmd.dCode,
        });
      }
      continue;
    }

    if (cmd.kind === "REGION_START") {
      inRegion = true;
      regionStartSpan = cmd;
      continue;
    }

    if (cmd.kind === "REGION_END") {
      if (!inRegion) {
        diagnostics.push({
          code: GerberErrorCode.UNMATCHED_REGION_END.code,
          id: GerberErrorCode.UNMATCHED_REGION_END.id,
          rule: GerberErrorCode.UNMATCHED_REGION_END.rule,
          severity: GerberErrorCode.UNMATCHED_REGION_END.severity,
          message: GerberErrorCode.UNMATCHED_REGION_END.message(),
          startOffset: cmd.startOffset,
          endOffset: cmd.endOffset,
          line: cmd.line,
          column: cmd.column,
        });
      }
      inRegion = false;
      regionStartSpan = null;
      continue;
    }

    if (cmd.kind === "OPERATION") {
      const nextPoint: GerberPoint = {
        x: unitToMm(cmd.x ?? 0, cmd.unit),
        y: unitToMm(cmd.y ?? 0, cmd.unit),
      };

      // GRB3001: Draw or flash before aperture selection (outside region)
      if ((cmd.op === "DRAW" || cmd.op === "FLASH") && !cmd.inRegion && cmd.apertureCode === null) {
        diagnostics.push({
          code: GerberErrorCode.DRAW_BEFORE_APERTURE.code,
          id: GerberErrorCode.DRAW_BEFORE_APERTURE.id,
          rule: GerberErrorCode.DRAW_BEFORE_APERTURE.rule,
          severity: GerberErrorCode.DRAW_BEFORE_APERTURE.severity,
          message: GerberErrorCode.DRAW_BEFORE_APERTURE.message(cmd.op === "DRAW" ? "D01" : "D03"),
          startOffset: cmd.startOffset,
          endOffset: cmd.endOffset,
          line: cmd.line,
          column: cmd.column,
        });
      }

      // GRB5001: Minimum trace width DFM check on draw operations outside region
      if (cmd.op === "DRAW" && !cmd.inRegion && cmd.apertureCode !== null) {
        const ap = doc.apertures.get(cmd.apertureCode);
        if (ap && ap.shape !== "MACRO" && !reportedThinApertures.has(ap.dCode)) {
          const widthMm = unitToMm(ap.width, cmd.unit);
          if (widthMm > 0 && widthMm + 1e-9 < minTraceWidthMm) {
            reportedThinApertures.add(ap.dCode);
            diagnostics.push({
              code: GerberErrorCode.DFM_MIN_TRACE_WIDTH.code,
              id: GerberErrorCode.DFM_MIN_TRACE_WIDTH.id,
              rule: GerberErrorCode.DFM_MIN_TRACE_WIDTH.rule,
              severity: GerberErrorCode.DFM_MIN_TRACE_WIDTH.severity,
              message: GerberErrorCode.DFM_MIN_TRACE_WIDTH.message(ap.dCode, widthMm, minTraceWidthMm),
              startOffset: cmd.startOffset,
              endOffset: cmd.endOffset,
              line: cmd.line,
              column: cmd.column,
              dCode: ap.dCode,
            });
          }
        }
      }

      // GRB5006: Arc radius consistency check
      if (cmd.op === "DRAW" && (cmd.interpolation === "CW_ARC" || cmd.interpolation === "CCW_ARC")) {
        const iMm = unitToMm(cmd.i ?? 0, cmd.unit);
        const jMm = unitToMm(cmd.j ?? 0, cmd.unit);
        const arc = resolveGerberArc(
          currentPoint,
          nextPoint,
          iMm,
          jMm,
          cmd.interpolation === "CW_ARC",
          cmd.quadrantMode,
        );
        if (Math.abs(arc.rStart - arc.rEnd) > arcRadiusToleranceMm) {
          diagnostics.push({
            code: GerberErrorCode.DFM_ARC_RADIUS_MISMATCH.code,
            id: GerberErrorCode.DFM_ARC_RADIUS_MISMATCH.id,
            rule: GerberErrorCode.DFM_ARC_RADIUS_MISMATCH.rule,
            severity: GerberErrorCode.DFM_ARC_RADIUS_MISMATCH.severity,
            message: GerberErrorCode.DFM_ARC_RADIUS_MISMATCH.message(arc.rStart, arc.rEnd),
            startOffset: cmd.startOffset,
            endOffset: cmd.endOffset,
            line: cmd.line,
            column: cmd.column,
          });
        }
      }

      currentPoint = nextPoint;
    }
  }

  // GRB3002: Unclosed G36 region
  if (inRegion) {
    diagnostics.push({
      code: GerberErrorCode.UNCLOSED_REGION.code,
      id: GerberErrorCode.UNCLOSED_REGION.id,
      rule: GerberErrorCode.UNCLOSED_REGION.rule,
      severity: GerberErrorCode.UNCLOSED_REGION.severity,
      message: GerberErrorCode.UNCLOSED_REGION.message(),
      startOffset: regionStartSpan?.startOffset,
      endOffset: regionStartSpan?.endOffset,
      line: regionStartSpan?.line,
      column: regionStartSpan?.column,
    });
  }

  // GRB4001: Missing M02* EOF
  if (!doc.hasEof) {
    diagnostics.push({
      code: GerberErrorCode.MISSING_EOF.code,
      id: GerberErrorCode.MISSING_EOF.id,
      rule: GerberErrorCode.MISSING_EOF.rule,
      severity: GerberErrorCode.MISSING_EOF.severity,
      message: GerberErrorCode.MISSING_EOF.message(),
    });
  }

  return diagnostics;
}

export { GerberErrorCode, type GerberDiagnostic };
