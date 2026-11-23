// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Domain Linter for `@modelscript/jcamp-dx` (`JDX1001`–`JDX5006`).
 */

import { JcampDxErrorCode } from "../errors.js";
import { parseJcampDx } from "../parser/jcamp-parser.js";
import type { JcampBlock, JcampDocument, JcampDxDiagnostic } from "../types.js";

function findLdrLine(block: JcampBlock, label: string): number {
  const found = block.ldrs.find((l) => l.label === label);
  return found ? found.line : block.startLine;
}

function isTransmittanceUnit(yUnits?: string): { isTrans: boolean; isPercent: boolean } {
  if (!yUnits) return { isTrans: false, isPercent: false };
  const u = yUnits.trim().toUpperCase();
  if (u.includes("%T") || u.includes("PERCENT") || u.includes("% TRANS")) {
    return { isTrans: true, isPercent: true };
  }
  if (u.includes("TRANSMITTANCE") || u === "T") {
    return { isTrans: true, isPercent: false };
  }
  return { isTrans: false, isPercent: false };
}

function lintBlock(block: JcampBlock, out: JcampDxDiagnostic[]): void {
  // JDX1001: Syntax / parse errors
  for (const err of block.parseErrors) {
    out.push({
      code: JcampDxErrorCode.SYNTAX_ERROR.code,
      rule: JcampDxErrorCode.SYNTAX_ERROR.rule,
      severity: JcampDxErrorCode.SYNTAX_ERROR.severity,
      message: JcampDxErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      ...(err.column !== undefined ? { column: err.column } : {}),
    });
  }

  // JDX2001–JDX2004: Mandatory LDRs
  const hasLabel = (name: string): boolean => block.ldrs.some((l) => l.label === name);

  if (!hasLabel("TITLE")) {
    out.push({
      code: JcampDxErrorCode.MISSING_TITLE.code,
      rule: JcampDxErrorCode.MISSING_TITLE.rule,
      severity: JcampDxErrorCode.MISSING_TITLE.severity,
      message: JcampDxErrorCode.MISSING_TITLE.message(),
      line: block.startLine,
      label: "TITLE",
    });
  }
  if (!hasLabel("JCAMP-DX") && !hasLabel("JCAMPDX")) {
    out.push({
      code: JcampDxErrorCode.MISSING_JCAMP_DX.code,
      rule: JcampDxErrorCode.MISSING_JCAMP_DX.rule,
      severity: JcampDxErrorCode.MISSING_JCAMP_DX.severity,
      message: JcampDxErrorCode.MISSING_JCAMP_DX.message(),
      line: block.startLine,
      label: "JCAMP-DX",
    });
  }
  if (!hasLabel("DATA TYPE") && !hasLabel("DATATYPE")) {
    out.push({
      code: JcampDxErrorCode.MISSING_DATA_TYPE.code,
      rule: JcampDxErrorCode.MISSING_DATA_TYPE.rule,
      severity: JcampDxErrorCode.MISSING_DATA_TYPE.severity,
      message: JcampDxErrorCode.MISSING_DATA_TYPE.message(),
      line: block.startLine,
      label: "DATA TYPE",
    });
  }
  if (!block.hasEnd) {
    out.push({
      code: JcampDxErrorCode.MISSING_END.code,
      rule: JcampDxErrorCode.MISSING_END.rule,
      severity: JcampDxErrorCode.MISSING_END.severity,
      message: JcampDxErrorCode.MISSING_END.message(),
      line: block.endLine,
      label: "END",
    });
  }

  // JDX5006: Version check
  if (block.jcampDxVersion) {
    const verMatch = block.jcampDxVersion.match(/(\d+(?:\.\d+)?)/);
    if (verMatch) {
      const ver = Number(verMatch[1]);
      if (Number.isFinite(ver) && (ver < 4.24 || ver > 6.0)) {
        out.push({
          code: JcampDxErrorCode.UNSUPPORTED_JCAMP_VERSION.code,
          rule: JcampDxErrorCode.UNSUPPORTED_JCAMP_VERSION.rule,
          severity: JcampDxErrorCode.UNSUPPORTED_JCAMP_VERSION.severity,
          message: JcampDxErrorCode.UNSUPPORTED_JCAMP_VERSION.message(block.jcampDxVersion),
          line: findLdrLine(block, "JCAMP-DX"),
          label: "JCAMP-DX",
        });
      }
    }
  }

  // JDX4001 / JDX4002: Non-positive XFACTOR / YFACTOR
  if (block.xFactor !== undefined && block.xFactor <= 0) {
    out.push({
      code: JcampDxErrorCode.NON_POSITIVE_XFACTOR.code,
      rule: JcampDxErrorCode.NON_POSITIVE_XFACTOR.rule,
      severity: JcampDxErrorCode.NON_POSITIVE_XFACTOR.severity,
      message: JcampDxErrorCode.NON_POSITIVE_XFACTOR.message(String(block.xFactor)),
      line: findLdrLine(block, "XFACTOR"),
      label: "XFACTOR",
    });
  }
  if (block.yFactor !== undefined && block.yFactor <= 0) {
    out.push({
      code: JcampDxErrorCode.NON_POSITIVE_YFACTOR.code,
      rule: JcampDxErrorCode.NON_POSITIVE_YFACTOR.rule,
      severity: JcampDxErrorCode.NON_POSITIVE_YFACTOR.severity,
      message: JcampDxErrorCode.NON_POSITIVE_YFACTOR.message(String(block.yFactor)),
      line: findLdrLine(block, "YFACTOR"),
      label: "YFACTOR",
    });
  }

  // JDX3002: DIFDUP checkpoint discontinuity errors
  for (const cp of block.checkpointErrors) {
    out.push({
      code: JcampDxErrorCode.DIFDUP_CHECKPOINT_ERROR.code,
      rule: JcampDxErrorCode.DIFDUP_CHECKPOINT_ERROR.rule,
      severity: JcampDxErrorCode.DIFDUP_CHECKPOINT_ERROR.severity,
      message: JcampDxErrorCode.DIFDUP_CHECKPOINT_ERROR.message(String(cp.expectedY), String(cp.actualY), String(cp.x)),
      line: cp.line,
      label: "XYDATA",
    });
  }

  const allPoints = block.points.length > 0 ? block.points : block.peakTable;

  // JDX5005: Empty spectrum data (skip for LINK wrapper blocks)
  if (block.dataType !== "LINK" && allPoints.length === 0) {
    out.push({
      code: JcampDxErrorCode.EMPTY_SPECTRUM_DATA.code,
      rule: JcampDxErrorCode.EMPTY_SPECTRUM_DATA.rule,
      severity: JcampDxErrorCode.EMPTY_SPECTRUM_DATA.severity,
      message: JcampDxErrorCode.EMPTY_SPECTRUM_DATA.message(block.title || "(untitled)"),
      line: block.startLine,
    });
  }

  // JDX3001: NPOINTS mismatch
  if (block.nPoints !== undefined && allPoints.length > 0 && block.nPoints !== allPoints.length) {
    out.push({
      code: JcampDxErrorCode.NPOINTS_MISMATCH.code,
      rule: JcampDxErrorCode.NPOINTS_MISMATCH.rule,
      severity: JcampDxErrorCode.NPOINTS_MISMATCH.severity,
      message: JcampDxErrorCode.NPOINTS_MISMATCH.message(String(block.nPoints), String(allPoints.length)),
      line: findLdrLine(block, "NPOINTS"),
      label: "NPOINTS",
    });
  }

  // JDX5001 / JDX5002: FIRSTX / LASTX mismatch against decoded X range
  if (allPoints.length > 0) {
    const actualFirstX = allPoints[0]!.x;
    const actualLastX = allPoints[allPoints.length - 1]!.x;
    const span = Math.max(1, Math.abs(actualLastX - actualFirstX));
    const xTol = Math.max(1e-3, span * 1e-3);

    if (block.firstX !== undefined && Math.abs(block.firstX - actualFirstX) > xTol) {
      out.push({
        code: JcampDxErrorCode.FIRSTX_MISMATCH.code,
        rule: JcampDxErrorCode.FIRSTX_MISMATCH.rule,
        severity: JcampDxErrorCode.FIRSTX_MISMATCH.severity,
        message: JcampDxErrorCode.FIRSTX_MISMATCH.message(String(block.firstX), String(actualFirstX)),
        line: findLdrLine(block, "FIRSTX"),
        label: "FIRSTX",
      });
    }
    if (block.lastX !== undefined && Math.abs(block.lastX - actualLastX) > xTol) {
      out.push({
        code: JcampDxErrorCode.LASTX_MISMATCH.code,
        rule: JcampDxErrorCode.LASTX_MISMATCH.rule,
        severity: JcampDxErrorCode.LASTX_MISMATCH.severity,
        message: JcampDxErrorCode.LASTX_MISMATCH.message(String(block.lastX), String(actualLastX)),
        line: findLdrLine(block, "LASTX"),
        label: "LASTX",
      });
    }
  }

  // JDX5003 / JDX5004: Physical transmittance bounds [0, 1.2] (or [0, 120] for %T)
  const { isTrans, isPercent } = isTransmittanceUnit(block.yUnits);
  if (isTrans && allPoints.length > 0) {
    const scale = isPercent ? 100 : 1;
    const xyLine = findLdrLine(block, "XYDATA");
    let reportedLow = false;
    let reportedHigh = false;
    for (const pt of allPoints) {
      const tNorm = pt.y / scale;
      if (!reportedLow && tNorm < 0) {
        out.push({
          code: JcampDxErrorCode.INVALID_TRANSMITTANCE_LOW.code,
          rule: JcampDxErrorCode.INVALID_TRANSMITTANCE_LOW.rule,
          severity: JcampDxErrorCode.INVALID_TRANSMITTANCE_LOW.severity,
          message: JcampDxErrorCode.INVALID_TRANSMITTANCE_LOW.message(String(tNorm), String(pt.x)),
          line: xyLine,
          label: "YUNITS",
        });
        reportedLow = true;
      }
      if (!reportedHigh && tNorm > 1.2) {
        out.push({
          code: JcampDxErrorCode.INVALID_TRANSMITTANCE_HIGH.code,
          rule: JcampDxErrorCode.INVALID_TRANSMITTANCE_HIGH.rule,
          severity: JcampDxErrorCode.INVALID_TRANSMITTANCE_HIGH.severity,
          message: JcampDxErrorCode.INVALID_TRANSMITTANCE_HIGH.message(String(tNorm), String(pt.x)),
          line: xyLine,
          label: "YUNITS",
        });
        reportedHigh = true;
      }
      if (reportedLow && reportedHigh) break;
    }
  }

  for (const child of block.children) {
    lintBlock(child, out);
  }
}

/**
 * Runs all JCAMP-DX semantic and structural lint rules (`JDX1001`–`JDX5006`).
 */
export function lintJcampDx(input: string | JcampDocument | JcampBlock): JcampDxDiagnostic[] {
  const diagnostics: JcampDxDiagnostic[] = [];
  if (typeof input === "string") {
    const doc = parseJcampDx(input);
    for (const block of doc.blocks) {
      lintBlock(block, diagnostics);
    }
  } else if ("blocks" in input) {
    for (const block of input.blocks) {
      lintBlock(block, diagnostics);
    }
  } else {
    lintBlock(input, diagnostics);
  }
  return diagnostics;
}

export { JcampDxErrorCode };
