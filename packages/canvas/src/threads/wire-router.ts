// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasDocument, CanvasWire, TileAnchorSpec, WorldPoint } from "../schema/canvas-document.js";
import type { ResolvedAnchorPoint } from "./anchor-projector.js";

export interface RoutedWireGeometry {
  wireId: string;
  svgPath: string;
  labelPoint: WorldPoint;
  start: WorldPoint;
  end: WorldPoint;
}

export interface FmiWireValidationResult {
  valid: boolean;
  status: "synced" | "unit-mismatch" | "conflict";
  errors: string[];
  warnings: string[];
  suggestedTransformExpr?: string | undefined;
}

const KNOWN_UNIT_CONVERSIONS: Record<string, string> = {
  "deg->rad": "x * 0.017453292519943295",
  "rad->deg": "x * 57.29577951308232",
  "mm->m": "x * 0.001",
  "m->mm": "x * 1000",
  "g->kg": "x * 0.001",
  "kg->g": "x * 1000",
  "C->K": "x + 273.15",
  "K->C": "x - 273.15",
  "rpm->rad/s": "x * 0.10471975511965977",
  "rad/s->rpm": "x * 9.549296585513721",
};

/**
 * Validates causality, data type, and physical unit compatibility when wiring
 * an FMI/SSP co-simulation signal between two polyglot tiles.
 */
export function validateFmiWire(source: TileAnchorSpec, target: TileAnchorSpec): FmiWireValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let suggestedTransformExpr: string | undefined;

  if (source.kind === "fmi-input") {
    errors.push(`Source anchor '${source.path}' is an input; FMI signals must originate from an output or parameter.`);
  }
  if (target.kind === "fmi-output") {
    errors.push(`Target anchor '${target.path}' is an output; FMI signals must terminate at an input or parameter.`);
  }

  if (source.dataType && target.dataType && source.dataType !== target.dataType) {
    const numericCompatible =
      (source.dataType === "Integer" && target.dataType === "Real") ||
      (source.dataType === "Real" && target.dataType === "Integer");
    if (numericCompatible) {
      warnings.push(`Implicit numeric coercion between ${source.dataType} and ${target.dataType}.`);
    } else {
      errors.push(`Incompatible FMI signal types: '${source.dataType}' cannot connect to '${target.dataType}'.`);
    }
  }

  if (source.unit && target.unit && source.unit !== target.unit) {
    const convKey = `${source.unit}->${target.unit}`;
    const expr = KNOWN_UNIT_CONVERSIONS[convKey];
    if (expr) {
      suggestedTransformExpr = expr;
      warnings.push(`Unit conversion required (${source.unit} -> ${target.unit}); suggested adapter: ${expr}.`);
    } else {
      warnings.push(`Unit mismatch between '${source.unit}' and '${target.unit}'.`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, status: "conflict", errors, warnings };
  }
  if (source.unit && target.unit && source.unit !== target.unit) {
    return { valid: true, status: "unit-mismatch", errors, warnings, suggestedTransformExpr };
  }
  return { valid: true, status: "synced", errors, warnings };
}

/**
 * Routes a wire between two resolved anchor points:
 * - `fmi-signal` uses crisp orthogonal elbow pipes
 * - `shared-parameter`, `requirement-trace`, and `annotation-link` use smooth cubic bezier ribbons
 */
export function routeCanvasWire(
  wire: CanvasWire,
  source: ResolvedAnchorPoint,
  target: ResolvedAnchorPoint,
): RoutedWireGeometry {
  const s = source.world;
  const t = target.world;

  if (wire.kind === "fmi-signal") {
    const stub = 28;
    const p1 = { x: s.x + source.normal.x * stub, y: s.y + source.normal.y * stub };
    const p4 = { x: t.x + target.normal.x * stub, y: t.y + target.normal.y * stub };
    const midX = (p1.x + p4.x) / 2;
    const midY = (p1.y + p4.y) / 2;

    const horizontalDominant = Math.abs(source.normal.x) >= Math.abs(source.normal.y);
    const pts: WorldPoint[] = horizontalDominant
      ? [s, p1, { x: midX, y: p1.y }, { x: midX, y: p4.y }, p4, t]
      : [s, p1, { x: p1.x, y: midY }, { x: p4.x, y: midY }, p4, t];

    const svgPath = pts.map((pt, idx) => `${idx === 0 ? "M" : "L"} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(" ");

    return {
      wireId: wire.id,
      svgPath,
      labelPoint: { x: midX, y: midY },
      start: s,
      end: t,
    };
  }

  // Smooth cubic bezier ribbon for Digital Thread & Requirement Trace links
  const dist = Math.hypot(t.x - s.x, t.y - s.y);
  const handle = Math.min(220, Math.max(48, dist * 0.35));
  const c1 = { x: s.x + source.normal.x * handle, y: s.y + source.normal.y * handle };
  const c2 = { x: t.x + target.normal.x * handle, y: t.y + target.normal.y * handle };

  // Evaluate midpoint of cubic bezier at t = 0.5
  const labelPoint = {
    x: 0.125 * s.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * t.x,
    y: 0.125 * s.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * t.y,
  };

  const svgPath = `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${t.x.toFixed(1)} ${t.y.toFixed(1)}`;
  return { wireId: wire.id, svgPath, labelPoint, start: s, end: t };
}

export interface CanvasBlastRadius {
  rootTileId: string;
  rootAnchorPath?: string | undefined;
  /** Map of impacted tileId -> minimum hop distance from root (0 for root). */
  tileDistances: Record<string, number>;
  /** Set of wire IDs along causal paths from the root. */
  impactedWireIds: string[];
}

/**
 * Computes the causal blast radius across the spatial canvas starting from a tile
 * (or specific anchor), illuminating all downstream & linked artifacts for the
 * Blast-Radius Spotlight lens.
 */
export function computeCanvasBlastRadius(
  doc: CanvasDocument,
  rootTileId: string,
  rootAnchorPath?: string,
): CanvasBlastRadius {
  const tileDistances: Record<string, number> = {};
  const impactedWireSet = new Set<string>();

  if (!doc.tiles[rootTileId]) {
    return { rootTileId, rootAnchorPath, tileDistances, impactedWireIds: [] };
  }

  tileDistances[rootTileId] = 0;
  const queue: { tileId: string; anchorPath?: string | undefined; dist: number }[] = [
    { tileId: rootTileId, anchorPath: rootAnchorPath, dist: 0 },
  ];

  const wires = Object.values(doc.wires);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const wire of wires) {
      let nextTileId: string | undefined;
      if (wire.source.tileId === current.tileId) {
        // At hop 0 with a specific anchor, follow only wires attached to that anchor
        if (current.dist === 0 && current.anchorPath && wire.source.anchorPath !== current.anchorPath) {
          continue;
        }
        nextTileId = wire.target.tileId;
      } else if (wire.kind === "shared-parameter" && wire.target.tileId === current.tileId) {
        // Shared parameter threads are bidirectional
        if (current.dist === 0 && current.anchorPath && wire.target.anchorPath !== current.anchorPath) {
          continue;
        }
        nextTileId = wire.source.tileId;
      }

      if (!nextTileId) continue;
      impactedWireSet.add(wire.id);

      const nextDist = current.dist + 1;
      const prevDist = tileDistances[nextTileId];
      if (prevDist === undefined || nextDist < prevDist) {
        tileDistances[nextTileId] = nextDist;
        queue.push({ tileId: nextTileId, dist: nextDist });
      }
    }
  }

  return {
    rootTileId,
    rootAnchorPath,
    tileDistances,
    impactedWireIds: [...impactedWireSet].sort(),
  };
}
