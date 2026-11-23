// SPDX-License-Identifier: AGPL-3.0-or-later

import { DxfErrorCode, type DxfDiagnostic } from "../errors.js";
import { parseDxf } from "../parser/dxf-parser.js";
import type { DxfDocument, DxfEntity, DxfPoint3D } from "../types.js";

function dist3D(a: DxfPoint3D, b: DxfPoint3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function triangleArea3D(a: DxfPoint3D, b: DxfPoint3D, c: DxfPoint3D): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

function lintEntity(ent: DxfEntity, doc: DxfDocument, hasLayerTable: boolean, diags: DxfDiagnostic[]): void {
  // DXF2001: Entity references undefined layer (layer "0" is always implicitly defined in DXF)
  if (hasLayerTable && ent.layer && ent.layer !== "0" && !doc.layers.has(ent.layer)) {
    const spec = DxfErrorCode.UNDEFINED_LAYER;
    diags.push({
      id: spec.id,
      code: spec.code,
      rule: spec.rule,
      severity: spec.severity,
      message: spec.message(ent.type, ent.layer),
      line: ent.line,
      entityType: ent.type,
      symbolName: ent.layer,
    });
  }

  switch (ent.type) {
    case "CIRCLE":
      if (!(ent.radius > 0)) {
        const spec = DxfErrorCode.ZERO_RADIUS_CIRCLE;
        diags.push({
          id: spec.id,
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(ent.radius),
          line: ent.line,
          entityType: ent.type,
        });
      }
      break;

    case "ARC":
      if (!(ent.radius > 0)) {
        const spec = DxfErrorCode.ZERO_RADIUS_ARC;
        diags.push({
          id: spec.id,
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(ent.radius),
          line: ent.line,
          entityType: ent.type,
        });
      }
      break;

    case "LWPOLYLINE":
      if (ent.vertices.length < 2) {
        const spec = DxfErrorCode.DEGENERATE_LWPOLYLINE;
        diags.push({
          id: spec.id,
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(ent.vertices.length),
          line: ent.line,
          entityType: ent.type,
        });
      }
      break;

    case "POLYLINE":
      if (!ent.hasSeqEnd) {
        const spec = DxfErrorCode.UNCLOSED_POLYLINE;
        diags.push({
          id: spec.id,
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(),
          line: ent.line,
          entityType: ent.type,
        });
      }
      break;

    case "3DFACE": {
      const [v0, v1, v2, v3] = ent.vertices;
      const area = triangleArea3D(v0, v1, v2) + triangleArea3D(v0, v2, v3);
      if (area <= 1e-12) {
        const spec = DxfErrorCode.DEGENERATE_3DFACE;
        diags.push({
          id: spec.id,
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(),
          line: ent.line,
          entityType: ent.type,
        });
      }
      break;
    }

    case "ELLIPSE": {
      const majorLen = Math.hypot(ent.majorAxisEndpoint.x, ent.majorAxisEndpoint.y, ent.majorAxisEndpoint.z);
      if (majorLen <= 1e-12 || !(ent.ratio > 0)) {
        const spec = DxfErrorCode.DEGENERATE_ELLIPSE;
        const detail =
          majorLen <= 1e-12
            ? "major axis vector has zero length"
            : `minor-to-major ratio '${ent.ratio}' must be positive`;
        diags.push({
          id: spec.id,
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(detail),
          line: ent.line,
          entityType: ent.type,
        });
      }
      break;
    }

    case "LINE": {
      if (dist3D(ent.start, ent.end) <= 1e-12) {
        const spec = DxfErrorCode.ZERO_LENGTH_LINE;
        diags.push({
          id: spec.id,
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(),
          line: ent.line,
          entityType: ent.type,
        });
      }
      break;
    }

    case "SPLINE": {
      const minCtrl = Math.max(2, ent.degree + 1);
      if (ent.degree < 1 || (ent.controlPoints.length < minCtrl && ent.fitPoints.length < 2)) {
        const spec = DxfErrorCode.INVALID_SPLINE_DEGREE;
        diags.push({
          id: spec.id,
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(ent.degree, ent.controlPoints.length),
          line: ent.line,
          entityType: ent.type,
        });
      }
      break;
    }

    case "INSERT": {
      if (!ent.blockName || !doc.blocks.has(ent.blockName)) {
        const spec = DxfErrorCode.UNDEFINED_BLOCK;
        diags.push({
          id: spec.id,
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(ent.blockName || "<empty>"),
          line: ent.line,
          entityType: ent.type,
          symbolName: ent.blockName,
        });
      }
      if (Math.abs(ent.scaleX) <= 1e-12 || Math.abs(ent.scaleY) <= 1e-12 || Math.abs(ent.scaleZ) <= 1e-12) {
        const spec = DxfErrorCode.ZERO_SCALE_INSERT;
        diags.push({
          id: spec.id,
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(ent.blockName),
          line: ent.line,
          entityType: ent.type,
          symbolName: ent.blockName,
        });
      }
      break;
    }

    default:
      break;
  }
}

/**
 * Runs all static DXF lint rules (`DXF1001`–`DXF5006`) on a parsed {@link DxfDocument} or raw DXF source.
 */
export function lintDxf(docOrSource: DxfDocument | string): DxfDiagnostic[] {
  const doc = typeof docOrSource === "string" ? parseDxf(docOrSource) : docOrSource;
  const diags: DxfDiagnostic[] = [];

  // 1. Parse / Syntax errors (DXF1001, DXF1004)
  for (const err of doc.parseErrors) {
    const isUnexpectedEndsec = err.code === DxfErrorCode.UNEXPECTED_ENDSEC.id;
    const spec = isUnexpectedEndsec ? DxfErrorCode.UNEXPECTED_ENDSEC : DxfErrorCode.SYNTAX_ERROR;
    diags.push({
      id: spec.id,
      code: spec.code,
      rule: spec.rule,
      severity: spec.severity,
      message: err.message,
      line: err.line,
    });
  }

  // 2. Unclosed SECTION (DXF1002)
  for (const sec of doc.sections) {
    if (!sec.closed) {
      const spec = DxfErrorCode.UNCLOSED_SECTION;
      diags.push({
        id: spec.id,
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(sec.name),
        line: sec.startLine,
        symbolName: sec.name,
      });
    }
  }

  // 3. Missing EOF (DXF1003)
  if (!doc.hasEof) {
    const spec = DxfErrorCode.MISSING_EOF;
    const lastLine = doc.groupPairs.length > 0 ? doc.groupPairs[doc.groupPairs.length - 1]!.line : 1;
    diags.push({
      id: spec.id,
      code: spec.code,
      rule: spec.rule,
      severity: spec.severity,
      message: spec.message(),
      line: lastLine,
    });
  }

  // 4. Invalid $INSUNITS (DXF4001) — valid AutoCAD codes are integers 0..20
  const insUnitsEntries = doc.header.variables["$INSUNITS"];
  if (insUnitsEntries && insUnitsEntries.length > 0) {
    const entry = insUnitsEntries.find((e) => e.code === 70) ?? insUnitsEntries[0]!;
    const rawVal = entry.value.trim();
    const parsed = Number(rawVal);
    if (!/^-?\d+$/.test(rawVal) || !Number.isInteger(parsed) || parsed < 0 || parsed > 20) {
      const spec = DxfErrorCode.INVALID_INSUNITS;
      diags.push({
        id: spec.id,
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(rawVal),
        line: entry.line,
        symbolName: "$INSUNITS",
      });
    }
  }

  // 5. Duplicate layers (DXF5005) and duplicate blocks (DXF5006)
  for (const dup of doc.duplicateLayers) {
    const spec = DxfErrorCode.DUPLICATE_LAYER;
    diags.push({
      id: spec.id,
      code: spec.code,
      rule: spec.rule,
      severity: spec.severity,
      message: spec.message(dup.name),
      line: dup.line,
      symbolName: dup.name,
    });
  }
  for (const dup of doc.duplicateBlocks) {
    const spec = DxfErrorCode.DUPLICATE_BLOCK;
    diags.push({
      id: spec.id,
      code: spec.code,
      rule: spec.rule,
      severity: spec.severity,
      message: spec.message(dup.name),
      line: dup.line,
      symbolName: dup.name,
    });
  }

  // 6. Unclosed BLOCK (DXF4002) and cyclic INSERT block references (DXF2003)
  for (const blk of doc.blocks.values()) {
    if (!blk.closed) {
      const spec = DxfErrorCode.UNCLOSED_BLOCK;
      diags.push({
        id: spec.id,
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(blk.name),
        line: blk.line,
        symbolName: blk.name,
      });
    }
  }

  // DFS cycle detection on BLOCK -> INSERT -> BLOCK graph
  const reportedCycles = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfsBlock(blockName: string, stack: string[]): void {
    if (visited.has(blockName)) return;
    visiting.add(blockName);
    stack.push(blockName);

    const blk = doc.blocks.get(blockName);
    if (blk) {
      for (const ent of blk.entities) {
        if (ent.type !== "INSERT") continue;
        const target = ent.blockName;
        if (!target || !doc.blocks.has(target)) continue;
        if (visiting.has(target)) {
          const cycleStart = stack.indexOf(target);
          const cycle = [...stack.slice(cycleStart), target];
          const key = [...cycle].sort().join("->");
          if (!reportedCycles.has(key)) {
            reportedCycles.add(key);
            const spec = DxfErrorCode.CYCLIC_BLOCK_REFERENCE;
            diags.push({
              id: spec.id,
              code: spec.code,
              rule: spec.rule,
              severity: spec.severity,
              message: spec.message(cycle.join(" -> ")),
              line: ent.line,
              entityType: "INSERT",
              symbolName: target,
            });
          }
        } else if (!visited.has(target)) {
          dfsBlock(target, stack);
        }
      }
    }

    stack.pop();
    visiting.delete(blockName);
    visited.add(blockName);
  }

  for (const blockName of doc.blocks.keys()) {
    if (!visited.has(blockName)) {
      dfsBlock(blockName, []);
    }
  }

  // 7. Entity-level lints (modelspace + inside blocks)
  const hasLayerTable = doc.layers.size > 0;
  for (const ent of doc.entities) {
    lintEntity(ent, doc, hasLayerTable, diags);
  }
  for (const blk of doc.blocks.values()) {
    for (const ent of blk.entities) {
      lintEntity(ent, doc, hasLayerTable, diags);
    }
  }

  return diags;
}

export { DxfErrorCode, type DxfDiagnostic } from "../errors.js";
