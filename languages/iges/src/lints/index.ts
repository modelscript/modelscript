// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iges — IGES 5.3 Semantic & Structural Linter (IGES1001–IGES5006).
 */

import { IgesErrorCode } from "../errors.js";
import { parseIges } from "../parser/iges-parser.js";
import type { IgesDocument, IgesEntity } from "../types.js";

export interface IgesDiagnostic {
  id: string;
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column?: number | undefined;
  deNumber?: number | undefined;
}

const EPS = 1e-12;

function isValidDePointer(doc: IgesDocument, ptr: number): boolean {
  if (ptr <= 0 || ptr % 2 === 0) return false;
  return doc.directoryEntries.has(ptr);
}

function checkPointer(
  doc: IgesDocument,
  ptr: number,
  context: string,
  line: number,
  deNumber: number,
  out: IgesDiagnostic[],
  allowZero = true,
): void {
  if (allowZero && ptr === 0) return;
  if (!isValidDePointer(doc, ptr)) {
    out.push({
      id: IgesErrorCode.INVALID_DE_POINTER.id,
      code: IgesErrorCode.INVALID_DE_POINTER.code,
      rule: IgesErrorCode.INVALID_DE_POINTER.rule,
      severity: IgesErrorCode.INVALID_DE_POINTER.severity,
      message: IgesErrorCode.INVALID_DE_POINTER.message(ptr, context),
      line,
      deNumber,
    });
  }
}

function lintEntity(doc: IgesDocument, entity: IgesEntity, out: IgesDiagnostic[]): void {
  const line = entity.startLine;
  const deNum = entity.deNumber;

  // Check transformation matrix pointer if non-zero
  if (entity.transformMatrixPointer !== 0) {
    checkPointer(doc, entity.transformMatrixPointer, `D${deNum} transform matrix`, line, deNum, out, false);
  }

  if ("rawParams" in entity) return;

  switch (entity.entityType) {
    case 100: {
      const [cx, cy] = entity.center;
      const [sx, sy] = entity.start;
      const [ex, ey] = entity.end;
      const r1 = Math.hypot(sx - cx, sy - cy);
      const r2 = Math.hypot(ex - cx, ey - cy);
      if (r1 <= EPS || r2 <= EPS) {
        out.push({
          id: IgesErrorCode.DEGENERATE_ZERO_RADIUS_ARC.id,
          code: IgesErrorCode.DEGENERATE_ZERO_RADIUS_ARC.code,
          rule: IgesErrorCode.DEGENERATE_ZERO_RADIUS_ARC.rule,
          severity: IgesErrorCode.DEGENERATE_ZERO_RADIUS_ARC.severity,
          message: IgesErrorCode.DEGENERATE_ZERO_RADIUS_ARC.message(deNum, "zero radius"),
          line,
          deNumber: deNum,
        });
      } else if (Math.abs(r1 - r2) > Math.max(1e-3, 1e-2 * Math.max(r1, r2))) {
        out.push({
          id: IgesErrorCode.DEGENERATE_ZERO_RADIUS_ARC.id,
          code: IgesErrorCode.DEGENERATE_ZERO_RADIUS_ARC.code,
          rule: IgesErrorCode.DEGENERATE_ZERO_RADIUS_ARC.rule,
          severity: IgesErrorCode.DEGENERATE_ZERO_RADIUS_ARC.severity,
          message: IgesErrorCode.DEGENERATE_ZERO_RADIUS_ARC.message(
            deNum,
            `start radius (${r1.toFixed(6)}) differs from end radius (${r2.toFixed(6)})`,
          ),
          line,
          deNumber: deNum,
        });
      }
      break;
    }

    case 102: {
      for (const ptr of entity.constituentPointers) {
        checkPointer(doc, ptr, `Composite Curve D${deNum}`, line, deNum, out, false);
      }
      break;
    }

    case 108: {
      if (entity.boundingCurvePointer !== 0) {
        checkPointer(doc, Math.abs(entity.boundingCurvePointer), `Plane D${deNum} bounding curve`, line, deNum, out);
      }
      break;
    }

    case 110: {
      const dx = entity.end[0] - entity.start[0];
      const dy = entity.end[1] - entity.start[1];
      const dz = entity.end[2] - entity.start[2];
      if (Math.hypot(dx, dy, dz) <= EPS) {
        out.push({
          id: IgesErrorCode.DEGENERATE_ZERO_LENGTH_LINE.id,
          code: IgesErrorCode.DEGENERATE_ZERO_LENGTH_LINE.code,
          rule: IgesErrorCode.DEGENERATE_ZERO_LENGTH_LINE.rule,
          severity: IgesErrorCode.DEGENERATE_ZERO_LENGTH_LINE.severity,
          message: IgesErrorCode.DEGENERATE_ZERO_LENGTH_LINE.message(deNum),
          line,
          deNumber: deNum,
        });
      }
      break;
    }

    case 120: {
      checkPointer(doc, entity.axisPointer, `Surface of Revolution D${deNum} axis`, line, deNum, out, false);
      checkPointer(
        doc,
        entity.generatrixPointer,
        `Surface of Revolution D${deNum} generatrix`,
        line,
        deNum,
        out,
        false,
      );
      break;
    }

    case 122: {
      checkPointer(doc, entity.directrixPointer, `Tabulated Cylinder D${deNum} directrix`, line, deNum, out, false);
      break;
    }

    case 124: {
      const [[r00, r01, r02], [r10, r11, r12], [r20, r21, r22]] = entity.rotation;
      const det = r00 * (r11 * r22 - r12 * r21) - r01 * (r10 * r22 - r12 * r20) + r02 * (r10 * r21 - r11 * r20);
      if (Math.abs(det) < 1e-9) {
        out.push({
          id: IgesErrorCode.SINGULAR_TRANSFORM_MATRIX.id,
          code: IgesErrorCode.SINGULAR_TRANSFORM_MATRIX.code,
          rule: IgesErrorCode.SINGULAR_TRANSFORM_MATRIX.rule,
          severity: IgesErrorCode.SINGULAR_TRANSFORM_MATRIX.severity,
          message: IgesErrorCode.SINGULAR_TRANSFORM_MATRIX.message(deNum, det),
          line,
          deNumber: deNum,
        });
      }
      break;
    }

    case 126: {
      const expectedKnots = entity.k + entity.m + 2;
      const expectedCtrl = entity.k + 1;
      if (entity.m < 1 || entity.k < entity.m) {
        out.push({
          id: IgesErrorCode.INVALID_NURBS_WEIGHTS.id,
          code: IgesErrorCode.INVALID_NURBS_WEIGHTS.code,
          rule: IgesErrorCode.INVALID_NURBS_WEIGHTS.rule,
          severity: IgesErrorCode.INVALID_NURBS_WEIGHTS.severity,
          message: IgesErrorCode.INVALID_NURBS_WEIGHTS.message(deNum, `invalid degree M=${entity.m} for K=${entity.k}`),
          line,
          deNumber: deNum,
        });
      }
      if (entity.knots.length !== expectedKnots || entity.controlPoints.length !== expectedCtrl) {
        out.push({
          id: IgesErrorCode.INVALID_NURBS_WEIGHTS.id,
          code: IgesErrorCode.INVALID_NURBS_WEIGHTS.code,
          rule: IgesErrorCode.INVALID_NURBS_WEIGHTS.rule,
          severity: IgesErrorCode.INVALID_NURBS_WEIGHTS.severity,
          message: IgesErrorCode.INVALID_NURBS_WEIGHTS.message(
            deNum,
            `expected ${expectedKnots} knots and ${expectedCtrl} control points, got ${entity.knots.length} and ${entity.controlPoints.length}`,
          ),
          line,
          deNumber: deNum,
        });
      }
      for (let i = 1; i < entity.knots.length; i++) {
        if (entity.knots[i]! < entity.knots[i - 1]! - EPS) {
          out.push({
            id: IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.id,
            code: IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.code,
            rule: IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.rule,
            severity: IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.severity,
            message: IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.message(deNum, "U", i),
            line,
            deNumber: deNum,
          });
          break;
        }
      }
      if (entity.weights.some((w) => w <= 0)) {
        out.push({
          id: IgesErrorCode.INVALID_NURBS_WEIGHTS.id,
          code: IgesErrorCode.INVALID_NURBS_WEIGHTS.code,
          rule: IgesErrorCode.INVALID_NURBS_WEIGHTS.rule,
          severity: IgesErrorCode.INVALID_NURBS_WEIGHTS.severity,
          message: IgesErrorCode.INVALID_NURBS_WEIGHTS.message(deNum, "weights must be strictly positive"),
          line,
          deNumber: deNum,
        });
      }
      break;
    }

    case 128: {
      for (let i = 1; i < entity.knotsU.length; i++) {
        if (entity.knotsU[i]! < entity.knotsU[i - 1]! - EPS) {
          out.push({
            id: IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.id,
            code: IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.code,
            rule: IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.rule,
            severity: IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.severity,
            message: IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.message(deNum, "U", i),
            line,
            deNumber: deNum,
          });
          break;
        }
      }
      for (let i = 1; i < entity.knotsV.length; i++) {
        if (entity.knotsV[i]! < entity.knotsV[i - 1]! - EPS) {
          out.push({
            id: IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.id,
            code: IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.code,
            rule: IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.rule,
            severity: IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.severity,
            message: IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.message(deNum, "V", i),
            line,
            deNumber: deNum,
          });
          break;
        }
      }
      const expectedCtrl = (entity.k1 + 1) * (entity.k2 + 1);
      if (entity.controlPoints.length !== expectedCtrl || entity.weights.some((w) => w <= 0)) {
        out.push({
          id: IgesErrorCode.INVALID_NURBS_WEIGHTS.id,
          code: IgesErrorCode.INVALID_NURBS_WEIGHTS.code,
          rule: IgesErrorCode.INVALID_NURBS_WEIGHTS.rule,
          severity: IgesErrorCode.INVALID_NURBS_WEIGHTS.severity,
          message: IgesErrorCode.INVALID_NURBS_WEIGHTS.message(
            deNum,
            `expected ${expectedCtrl} positive weights/control points`,
          ),
          line,
          deNumber: deNum,
        });
      }
      break;
    }

    case 142: {
      checkPointer(doc, entity.surfacePointer, `Curve on Surface D${deNum} surface`, line, deNum, out, false);
      if (entity.paramCurvePointer !== 0) {
        checkPointer(doc, entity.paramCurvePointer, `Curve on Surface D${deNum} param curve`, line, deNum, out, false);
      }
      if (entity.modelCurvePointer !== 0) {
        checkPointer(doc, entity.modelCurvePointer, `Curve on Surface D${deNum} model curve`, line, deNum, out, false);
      }
      break;
    }

    case 144: {
      checkPointer(doc, entity.surfacePointer, `Trimmed Surface D${deNum} surface`, line, deNum, out, false);
      if (entity.outerBoundaryPointer !== 0) {
        checkPointer(
          doc,
          entity.outerBoundaryPointer,
          `Trimmed Surface D${deNum} outer boundary`,
          line,
          deNum,
          out,
          false,
        );
      }
      for (const ptr of entity.innerBoundaryPointers) {
        checkPointer(doc, ptr, `Trimmed Surface D${deNum} inner boundary`, line, deNum, out, false);
      }
      break;
    }

    case 186: {
      if (!isValidDePointer(doc, entity.outerShellPointer)) {
        out.push({
          id: IgesErrorCode.INVALID_BREP_REFERENCE.id,
          code: IgesErrorCode.INVALID_BREP_REFERENCE.code,
          rule: IgesErrorCode.INVALID_BREP_REFERENCE.rule,
          severity: IgesErrorCode.INVALID_BREP_REFERENCE.severity,
          message: IgesErrorCode.INVALID_BREP_REFERENCE.message(deNum, entity.outerShellPointer),
          line,
          deNumber: deNum,
        });
      }
      for (const vp of entity.voidShellPointers) {
        if (!isValidDePointer(doc, vp)) {
          out.push({
            id: IgesErrorCode.INVALID_BREP_REFERENCE.id,
            code: IgesErrorCode.INVALID_BREP_REFERENCE.code,
            rule: IgesErrorCode.INVALID_BREP_REFERENCE.rule,
            severity: IgesErrorCode.INVALID_BREP_REFERENCE.severity,
            message: IgesErrorCode.INVALID_BREP_REFERENCE.message(deNum, vp),
            line,
            deNumber: deNum,
          });
        }
      }
      break;
    }
  }
}

/**
 * Lint a parsed `IgesDocument` or raw IGES 5.3 text string and return all diagnostics.
 */
export function lintIges(input: IgesDocument | string): IgesDiagnostic[] {
  const doc = typeof input === "string" ? parseIges(input) : input;
  const diagnostics: IgesDiagnostic[] = [];

  // 1. Surface parser issues (column width, Hollerith strings, section order)
  for (const issue of doc.parseIssues) {
    const codeNum = parseInt(issue.code.replace(/\D/g, ""), 10) || 1001;
    const rule =
      issue.code === IgesErrorCode.INVALID_HOLLERITH_STRING.id
        ? IgesErrorCode.INVALID_HOLLERITH_STRING.rule
        : issue.code === IgesErrorCode.INVALID_SECTION_ORDER.id
          ? IgesErrorCode.INVALID_SECTION_ORDER.rule
          : IgesErrorCode.SYNTAX_COLUMN_WIDTH.rule;
    diagnostics.push({
      id: issue.code,
      code: codeNum,
      rule,
      severity: issue.severity,
      message: issue.message,
      line: issue.line,
      column: issue.column,
      deNumber: issue.deNumber,
    });
  }

  // 2. Mandatory sections S, G, D, P, T
  if (doc.sectionCounts.S === 0) {
    diagnostics.push({
      id: IgesErrorCode.MISSING_START_SECTION.id,
      code: IgesErrorCode.MISSING_START_SECTION.code,
      rule: IgesErrorCode.MISSING_START_SECTION.rule,
      severity: IgesErrorCode.MISSING_START_SECTION.severity,
      message: IgesErrorCode.MISSING_START_SECTION.message(),
      line: 1,
    });
  }
  if (doc.sectionCounts.G === 0) {
    diagnostics.push({
      id: IgesErrorCode.MISSING_GLOBAL_SECTION.id,
      code: IgesErrorCode.MISSING_GLOBAL_SECTION.code,
      rule: IgesErrorCode.MISSING_GLOBAL_SECTION.rule,
      severity: IgesErrorCode.MISSING_GLOBAL_SECTION.severity,
      message: IgesErrorCode.MISSING_GLOBAL_SECTION.message(),
      line: 1,
    });
  }
  if (doc.sectionCounts.D === 0) {
    diagnostics.push({
      id: IgesErrorCode.MISSING_DIRECTORY_SECTION.id,
      code: IgesErrorCode.MISSING_DIRECTORY_SECTION.code,
      rule: IgesErrorCode.MISSING_DIRECTORY_SECTION.rule,
      severity: IgesErrorCode.MISSING_DIRECTORY_SECTION.severity,
      message: IgesErrorCode.MISSING_DIRECTORY_SECTION.message(),
      line: 1,
    });
  }
  if (doc.sectionCounts.P === 0) {
    diagnostics.push({
      id: IgesErrorCode.MISSING_PARAMETER_SECTION.id,
      code: IgesErrorCode.MISSING_PARAMETER_SECTION.code,
      rule: IgesErrorCode.MISSING_PARAMETER_SECTION.rule,
      severity: IgesErrorCode.MISSING_PARAMETER_SECTION.severity,
      message: IgesErrorCode.MISSING_PARAMETER_SECTION.message(),
      line: 1,
    });
  }
  if (doc.sectionCounts.T === 0 || !doc.terminate) {
    diagnostics.push({
      id: IgesErrorCode.MISSING_TERMINATE_SECTION.id,
      code: IgesErrorCode.MISSING_TERMINATE_SECTION.code,
      rule: IgesErrorCode.MISSING_TERMINATE_SECTION.rule,
      severity: IgesErrorCode.MISSING_TERMINATE_SECTION.severity,
      message: IgesErrorCode.MISSING_TERMINATE_SECTION.message(),
      line: Math.max(1, doc.rawLines.length),
    });
  }

  // 3. Terminate section counts parity
  if (doc.terminate) {
    const checks: Array<[string, number, number]> = [
      ["S", doc.terminate.startCount, doc.sectionCounts.S],
      ["G", doc.terminate.globalCount, doc.sectionCounts.G],
      ["D", doc.terminate.directoryCount, doc.sectionCounts.D],
      ["P", doc.terminate.parameterCount, doc.sectionCounts.P],
    ];
    for (const [sec, declared, actual] of checks) {
      if (declared !== actual) {
        diagnostics.push({
          id: IgesErrorCode.MISMATCHED_TERMINATE_COUNTS.id,
          code: IgesErrorCode.MISMATCHED_TERMINATE_COUNTS.code,
          rule: IgesErrorCode.MISMATCHED_TERMINATE_COUNTS.rule,
          severity: IgesErrorCode.MISMATCHED_TERMINATE_COUNTS.severity,
          message: IgesErrorCode.MISMATCHED_TERMINATE_COUNTS.message(sec, declared, actual),
          line: doc.terminate.lineNumber,
        });
      }
    }
  }

  // 4. Global unit flag range (1..11)
  if (doc.global && (doc.global.unitFlag < 1 || doc.global.unitFlag > 11)) {
    diagnostics.push({
      id: IgesErrorCode.INVALID_UNIT_FLAG.id,
      code: IgesErrorCode.INVALID_UNIT_FLAG.code,
      rule: IgesErrorCode.INVALID_UNIT_FLAG.rule,
      severity: IgesErrorCode.INVALID_UNIT_FLAG.severity,
      message: IgesErrorCode.INVALID_UNIT_FLAG.message(doc.global.unitFlag),
      line: doc.global.startLine,
    });
  }

  // 5. Directory Entry structural checks
  for (const [deNum, de] of doc.directoryEntries) {
    if (de.incomplete) {
      diagnostics.push({
        id: IgesErrorCode.INCOMPLETE_DE_RECORD.id,
        code: IgesErrorCode.INCOMPLETE_DE_RECORD.code,
        rule: IgesErrorCode.INCOMPLETE_DE_RECORD.rule,
        severity: IgesErrorCode.INCOMPLETE_DE_RECORD.severity,
        message: IgesErrorCode.INCOMPLETE_DE_RECORD.message(deNum),
        line: de.startLine,
        deNumber: deNum,
      });
    } else if (de.entityType !== de.entityTypeLine2) {
      diagnostics.push({
        id: IgesErrorCode.DE_ENTITY_TYPE_MISMATCH.id,
        code: IgesErrorCode.DE_ENTITY_TYPE_MISMATCH.code,
        rule: IgesErrorCode.DE_ENTITY_TYPE_MISMATCH.rule,
        severity: IgesErrorCode.DE_ENTITY_TYPE_MISMATCH.severity,
        message: IgesErrorCode.DE_ENTITY_TYPE_MISMATCH.message(deNum, de.entityType, de.entityTypeLine2),
        line: de.endLine,
        deNumber: deNum,
      });
    }

    const prec = doc.parameterRecords.get(deNum);
    if (!prec || prec.fields.length === 0) {
      diagnostics.push({
        id: IgesErrorCode.MISSING_PARAMETER_DATA.id,
        code: IgesErrorCode.MISSING_PARAMETER_DATA.code,
        rule: IgesErrorCode.MISSING_PARAMETER_DATA.rule,
        severity: IgesErrorCode.MISSING_PARAMETER_DATA.severity,
        message: IgesErrorCode.MISSING_PARAMETER_DATA.message(deNum),
        line: de.startLine,
        deNumber: deNum,
      });
    } else if (prec.entityType !== de.entityType) {
      diagnostics.push({
        id: IgesErrorCode.DE_ENTITY_TYPE_MISMATCH.id,
        code: IgesErrorCode.DE_ENTITY_TYPE_MISMATCH.code,
        rule: IgesErrorCode.DE_ENTITY_TYPE_MISMATCH.rule,
        severity: IgesErrorCode.DE_ENTITY_TYPE_MISMATCH.severity,
        message: IgesErrorCode.DE_ENTITY_TYPE_MISMATCH.message(deNum, de.entityType, prec.entityType),
        line: prec.startLine,
        deNumber: deNum,
      });
    }
  }

  // 6. Parameter Data orphan DE pointer check
  for (const [dePtr, prec] of doc.parameterRecords) {
    if (!isValidDePointer(doc, dePtr)) {
      diagnostics.push({
        id: IgesErrorCode.INVALID_DE_POINTER.id,
        code: IgesErrorCode.INVALID_DE_POINTER.code,
        rule: IgesErrorCode.INVALID_DE_POINTER.rule,
        severity: IgesErrorCode.INVALID_DE_POINTER.severity,
        message: IgesErrorCode.INVALID_DE_POINTER.message(dePtr, `Parameter Data line ${prec.startLine}`),
        line: prec.startLine,
      });
    }
  }

  // 7. Entity-level geometric & referential checks
  for (const entity of doc.entities) {
    lintEntity(doc, entity, diagnostics);
  }

  return diagnostics;
}
