// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis & Geometric DRC Linter for `@modelscript/gdsii`.
 *
 * Implements `GDS1001`–`GDS5006`:
 * - `GDS1001`: Stream syntax / binary framing errors
 * - `GDS2001`: Unclosed `BOUNDARY` polygon
 * - `GDS2002`: Unresolved `SREF` / `AREF` structure reference
 * - `GDS2003`: Cyclic structure hierarchy
 * - `GDS3001`: Invalid layer or datatype (< 0 or > 65535)
 * - `GDS3002`: Zero-area degenerate polygon
 * - `GDS5001`: DRC minimum feature width violation
 * - `GDS5002`: DRC minimum feature spacing violation
 * - `GDS5003`: Invalid `AREF` COLROW
 * - `GDS5004`: Invalid `PATH` geometry
 * - `GDS5005`: Invalid `UNITS`
 * - `GDS5006`: Duplicate structure name
 */

import { computeBBox, expandPathToPolygon, polygonArea, type GdsiiBBox } from "../cad/index.js";
import { GdsiiErrorCode, type GdsiiDiagnostic } from "../errors.js";
import type { GdsiiLayerDrcRule, GdsiiLibrary, GdsiiPoint } from "../types.js";

export { GdsiiErrorCode, type GdsiiDiagnostic };

export interface GdsiiLintOptions {
  /** Optional per-layer DRC rules (minWidth, minSpacing in DB units). */
  drcRules?: GdsiiLayerDrcRule[] | undefined;
}

/**
 * Computes minimum Euclidean separation between two axis-aligned bounding boxes.
 * Returns 0 if boxes overlap or touch.
 */
function bboxDistance(a: GdsiiBBox, b: GdsiiBBox): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.hypot(dx, dy);
}

/**
 * Checks whether a polygon ring is properly closed (first == last, >= 4 vertices).
 */
export function isPolygonClosed(xy: readonly GdsiiPoint[]): boolean {
  if (xy.length < 4) return false;
  const first = xy[0]!;
  const last = xy[xy.length - 1]!;
  return first.x === last.x && first.y === last.y;
}

/**
 * Runs all structural, semantic, and geometric DRC lint checks on a `GdsiiLibrary`.
 */
export function lintGdsii(library: GdsiiLibrary, options?: GdsiiLintOptions): GdsiiDiagnostic[] {
  const diagnostics: GdsiiDiagnostic[] = [];

  // GDS1001: Propagate parser/stream errors
  if (library.parseErrors) {
    for (const err of library.parseErrors) {
      diagnostics.push({
        code: GdsiiErrorCode.SYNTAX_STREAM_ERROR.code,
        id: GdsiiErrorCode.SYNTAX_STREAM_ERROR.id,
        rule: GdsiiErrorCode.SYNTAX_STREAM_ERROR.rule,
        severity: GdsiiErrorCode.SYNTAX_STREAM_ERROR.severity,
        message: GdsiiErrorCode.SYNTAX_STREAM_ERROR.message(err.message),
        line: err.line,
        column: err.column,
        startOffset: err.offset,
      });
    }
  }

  // GDS5005: Validate UNITS
  const { dbUnitInUserUnits, dbUnitInMeters } = library.units;
  if (
    !Number.isFinite(dbUnitInUserUnits) ||
    dbUnitInUserUnits <= 0 ||
    !Number.isFinite(dbUnitInMeters) ||
    dbUnitInMeters <= 0
  ) {
    diagnostics.push({
      code: GdsiiErrorCode.INVALID_UNITS.code,
      id: GdsiiErrorCode.INVALID_UNITS.id,
      rule: GdsiiErrorCode.INVALID_UNITS.rule,
      severity: GdsiiErrorCode.INVALID_UNITS.severity,
      message: GdsiiErrorCode.INVALID_UNITS.message(dbUnitInUserUnits, dbUnitInMeters),
      line: 1,
    });
  }

  // Build structure index and check GDS5006 duplicate structure names
  const structNames = new Set<string>();
  const refGraph = new Map<string, Set<string>>();

  for (const struct of library.structures) {
    if (structNames.has(struct.name)) {
      diagnostics.push({
        code: GdsiiErrorCode.DUPLICATE_STRUCTURE_NAME.code,
        id: GdsiiErrorCode.DUPLICATE_STRUCTURE_NAME.id,
        rule: GdsiiErrorCode.DUPLICATE_STRUCTURE_NAME.rule,
        severity: GdsiiErrorCode.DUPLICATE_STRUCTURE_NAME.severity,
        message: GdsiiErrorCode.DUPLICATE_STRUCTURE_NAME.message(struct.name),
        structureName: struct.name,
        line: struct.line,
        startOffset: struct.startOffset,
        endOffset: struct.endOffset,
      });
    }
    structNames.add(struct.name);
    if (!refGraph.has(struct.name)) {
      refGraph.set(struct.name, new Set());
    }
  }

  // Index DRC rules by layer
  const drcByLayer = new Map<number, GdsiiLayerDrcRule>();
  if (options?.drcRules) {
    for (const r of options.drcRules) {
      drcByLayer.set(r.layer, r);
    }
  }

  // Per-structure element checks
  for (const struct of library.structures) {
    const layerShapes = new Map<number, Array<{ bbox: GdsiiBBox; width: number; line?: number | undefined }>>();

    for (const el of struct.elements) {
      if (el.kind === "boundary") {
        // GDS3001: layer/datatype bounds
        if (el.layer < 0 || el.layer > 65535 || !Number.isInteger(el.layer)) {
          diagnostics.push({
            code: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.code,
            id: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.id,
            rule: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.rule,
            severity: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.severity,
            message: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.message("LAYER", el.layer, struct.name),
            structureName: struct.name,
            layer: el.layer,
            line: el.line,
          });
        }
        if (el.datatype < 0 || el.datatype > 65535 || !Number.isInteger(el.datatype)) {
          diagnostics.push({
            code: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.code,
            id: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.id,
            rule: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.rule,
            severity: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.severity,
            message: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.message("DATATYPE", el.datatype, struct.name),
            structureName: struct.name,
            layer: el.layer,
            line: el.line,
          });
        }

        // GDS2001: unclosed polygon
        if (!isPolygonClosed(el.xy)) {
          diagnostics.push({
            code: GdsiiErrorCode.UNCLOSED_BOUNDARY.code,
            id: GdsiiErrorCode.UNCLOSED_BOUNDARY.id,
            rule: GdsiiErrorCode.UNCLOSED_BOUNDARY.rule,
            severity: GdsiiErrorCode.UNCLOSED_BOUNDARY.severity,
            message: GdsiiErrorCode.UNCLOSED_BOUNDARY.message(struct.name, el.layer),
            structureName: struct.name,
            layer: el.layer,
            line: el.line,
            startOffset: el.startOffset,
            endOffset: el.endOffset,
          });
        }

        // GDS3002: zero-area degenerate polygon
        const area = polygonArea(el.xy);
        if (area <= 1e-12) {
          diagnostics.push({
            code: GdsiiErrorCode.ZERO_AREA_POLYGON.code,
            id: GdsiiErrorCode.ZERO_AREA_POLYGON.id,
            rule: GdsiiErrorCode.ZERO_AREA_POLYGON.rule,
            severity: GdsiiErrorCode.ZERO_AREA_POLYGON.severity,
            message: GdsiiErrorCode.ZERO_AREA_POLYGON.message(struct.name, el.layer),
            structureName: struct.name,
            layer: el.layer,
            line: el.line,
          });
        }

        const bbox = computeBBox(el.xy);
        if (bbox && area > 1e-12) {
          const minDim = Math.min(bbox.width, bbox.height);
          const list = layerShapes.get(el.layer) ?? [];
          list.push({ bbox, width: minDim, line: el.line });
          layerShapes.set(el.layer, list);
        }
      } else if (el.kind === "path") {
        if (el.layer < 0 || el.layer > 65535 || !Number.isInteger(el.layer)) {
          diagnostics.push({
            code: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.code,
            id: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.id,
            rule: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.rule,
            severity: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.severity,
            message: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.message("LAYER", el.layer, struct.name),
            structureName: struct.name,
            layer: el.layer,
            line: el.line,
          });
        }
        if (el.datatype < 0 || el.datatype > 65535 || !Number.isInteger(el.datatype)) {
          diagnostics.push({
            code: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.code,
            id: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.id,
            rule: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.rule,
            severity: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.severity,
            message: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.message("DATATYPE", el.datatype, struct.name),
            structureName: struct.name,
            layer: el.layer,
            line: el.line,
          });
        }
        if (el.xy.length < 2) {
          diagnostics.push({
            code: GdsiiErrorCode.INVALID_PATH_GEOMETRY.code,
            id: GdsiiErrorCode.INVALID_PATH_GEOMETRY.id,
            rule: GdsiiErrorCode.INVALID_PATH_GEOMETRY.rule,
            severity: GdsiiErrorCode.INVALID_PATH_GEOMETRY.severity,
            message: GdsiiErrorCode.INVALID_PATH_GEOMETRY.message(
              struct.name,
              el.layer,
              "PATH requires at least 2 XY vertices",
            ),
            structureName: struct.name,
            layer: el.layer,
            line: el.line,
          });
        }
        const pathW = el.width ?? 0;
        if (pathW > 0 && el.xy.length >= 2) {
          const ribbon = expandPathToPolygon(el.xy, pathW, el.pathtype ?? 0);
          const bbox = computeBBox(ribbon);
          if (bbox) {
            const list = layerShapes.get(el.layer) ?? [];
            list.push({ bbox, width: pathW, line: el.line });
            layerShapes.set(el.layer, list);
          }
        }
      } else if (el.kind === "text") {
        if (el.layer < 0 || el.layer > 65535 || !Number.isInteger(el.layer)) {
          diagnostics.push({
            code: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.code,
            id: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.id,
            rule: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.rule,
            severity: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.severity,
            message: GdsiiErrorCode.INVALID_LAYER_OR_DATATYPE.message("LAYER", el.layer, struct.name),
            structureName: struct.name,
            layer: el.layer,
            line: el.line,
          });
        }
      } else if (el.kind === "sref" || el.kind === "aref") {
        // GDS2002: unresolved reference
        if (!structNames.has(el.sname)) {
          diagnostics.push({
            code: GdsiiErrorCode.UNRESOLVED_STRUCTURE_REF.code,
            id: GdsiiErrorCode.UNRESOLVED_STRUCTURE_REF.id,
            rule: GdsiiErrorCode.UNRESOLVED_STRUCTURE_REF.rule,
            severity: GdsiiErrorCode.UNRESOLVED_STRUCTURE_REF.severity,
            message: GdsiiErrorCode.UNRESOLVED_STRUCTURE_REF.message(el.kind.toUpperCase(), el.sname, struct.name),
            structureName: struct.name,
            line: el.line,
          });
        } else {
          refGraph.get(struct.name)?.add(el.sname);
        }

        // GDS5003: AREF COLROW check
        if (
          el.kind === "aref" &&
          (!Number.isInteger(el.columns) ||
            !Number.isInteger(el.rows) ||
            el.columns < 1 ||
            el.rows < 1 ||
            el.columns > 32767 ||
            el.rows > 32767)
        ) {
          diagnostics.push({
            code: GdsiiErrorCode.INVALID_AREF_COLROW.code,
            id: GdsiiErrorCode.INVALID_AREF_COLROW.id,
            rule: GdsiiErrorCode.INVALID_AREF_COLROW.rule,
            severity: GdsiiErrorCode.INVALID_AREF_COLROW.severity,
            message: GdsiiErrorCode.INVALID_AREF_COLROW.message(struct.name, el.columns, el.rows),
            structureName: struct.name,
            line: el.line,
          });
        }
      }
    }

    // GDS5001 & GDS5002: Geometric DRC min-width & min-spacing per layer
    for (const [layer, shapes] of layerShapes) {
      const rule = drcByLayer.get(layer);
      if (!rule) continue;

      for (const shape of shapes) {
        if (shape.width + 1e-9 < rule.minWidth) {
          diagnostics.push({
            code: GdsiiErrorCode.DRC_MIN_WIDTH.code,
            id: GdsiiErrorCode.DRC_MIN_WIDTH.id,
            rule: GdsiiErrorCode.DRC_MIN_WIDTH.rule,
            severity: GdsiiErrorCode.DRC_MIN_WIDTH.severity,
            message: GdsiiErrorCode.DRC_MIN_WIDTH.message(struct.name, layer, shape.width, rule.minWidth),
            structureName: struct.name,
            layer,
            line: shape.line,
          });
        }
      }

      for (let i = 0; i < shapes.length; i++) {
        for (let j = i + 1; j < shapes.length; j++) {
          const dist = bboxDistance(shapes[i]!.bbox, shapes[j]!.bbox);
          // Only flag strictly disjoint shapes whose separation violates minSpacing
          if (dist > 1e-9 && dist + 1e-9 < rule.minSpacing) {
            diagnostics.push({
              code: GdsiiErrorCode.DRC_MIN_SPACING.code,
              id: GdsiiErrorCode.DRC_MIN_SPACING.id,
              rule: GdsiiErrorCode.DRC_MIN_SPACING.rule,
              severity: GdsiiErrorCode.DRC_MIN_SPACING.severity,
              message: GdsiiErrorCode.DRC_MIN_SPACING.message(struct.name, layer, dist, rule.minSpacing),
              structureName: struct.name,
              layer,
              line: shapes[i]!.line ?? shapes[j]!.line,
            });
          }
        }
      }
    }
  }

  // GDS2003: Cycle detection in structure reference graph (DFS 3-color)
  const color = new Map<string, number>(); // 0=unvisited, 1=visiting, 2=visited
  const pathStack: string[] = [];
  const reportedCycles = new Set<string>();

  function dfs(node: string): void {
    color.set(node, 1);
    pathStack.push(node);
    for (const neighbor of refGraph.get(node) ?? []) {
      const c = color.get(neighbor) ?? 0;
      if (c === 1) {
        const idx = pathStack.indexOf(neighbor);
        const cycle = [...pathStack.slice(idx), neighbor].join(" -> ");
        if (!reportedCycles.has(cycle)) {
          reportedCycles.add(cycle);
          diagnostics.push({
            code: GdsiiErrorCode.CYCLIC_HIERARCHY.code,
            id: GdsiiErrorCode.CYCLIC_HIERARCHY.id,
            rule: GdsiiErrorCode.CYCLIC_HIERARCHY.rule,
            severity: GdsiiErrorCode.CYCLIC_HIERARCHY.severity,
            message: GdsiiErrorCode.CYCLIC_HIERARCHY.message(cycle),
            structureName: node,
          });
        }
      } else if (c === 0) {
        dfs(neighbor);
      }
    }
    pathStack.pop();
    color.set(node, 2);
  }

  for (const name of structNames) {
    if ((color.get(name) ?? 0) === 0) {
      dfs(name);
    }
  }

  return diagnostics;
}
