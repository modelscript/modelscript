// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ECAD Canvas — Design Rule Check (DRC) Engine.
 *
 * Runs continuous design rule checks against a PCB layout:
 *   - Copper clearance violations (trace-to-trace, trace-to-pad, pad-to-pad)
 *   - Minimum trace width violations
 *   - Unconnected ratsnest detection
 *   - Via annular ring minimum
 *   - Board edge clearance
 *
 * Designed to run in a WebWorker for non-blocking UI.
 */

import type { Point2D, RenderPad, RenderTrace, RenderVia } from "./renderer.js";

// ── Types ──

/** DRC violation severity. */
export type DRCSeverity = "error" | "warning" | "info";

/** A single DRC violation. */
export interface DRCViolation {
  /** Unique violation ID. */
  id: string;
  /** Human-readable rule name. */
  rule: string;
  /** Violation severity. */
  severity: DRCSeverity;
  /** Descriptive message. */
  message: string;
  /** Position on the board where the violation occurs. */
  position: Point2D;
  /** Affected objects (component names, net IDs, etc.). */
  affectedObjects: string[];
}

/** Design rules to check against. */
export interface DesignRules {
  /** Minimum copper-to-copper clearance (mm). */
  minClearance: number;
  /** Minimum trace width (mm). */
  minTraceWidth: number;
  /** Minimum via drill diameter (mm). */
  minViaDrill: number;
  /** Minimum via annular ring (mm). */
  minAnnularRing: number;
  /** Minimum clearance to board edge (mm). */
  boardEdgeClearance: number;
}

/** Input data for DRC checks. */
export interface DRCInput {
  traces: RenderTrace[];
  pads: RenderPad[];
  vias: RenderVia[];
  boardOutline: Point2D[];
  rules: DesignRules;
  /** Expected connections (net ID → pin names). */
  expectedNets: Map<string, string[]>;
}

/** Result of a DRC run. */
export interface DRCResult {
  violations: DRCViolation[];
  totalChecks: number;
  passRate: number;
  timestamp: number;
}

// ── Default rules ──

export const DEFAULT_DESIGN_RULES: DesignRules = {
  minClearance: 0.127, // 5mil
  minTraceWidth: 0.127,
  minViaDrill: 0.2,
  minAnnularRing: 0.1,
  boardEdgeClearance: 0.25,
};

// ── DRC Engine ──

/**
 * Run all design rule checks on the given PCB data.
 */
export function runDRC(input: DRCInput): DRCResult {
  const violations: DRCViolation[] = [];
  let totalChecks = 0;
  let violationCounter = 0;

  const nextId = (): string => `DRC-${violationCounter++}`;

  // 1. Minimum trace width check
  for (const trace of input.traces) {
    totalChecks++;
    if (trace.width < input.rules.minTraceWidth) {
      const mid = traceCenter(trace);
      violations.push({
        id: nextId(),
        rule: "min-trace-width",
        severity: "error",
        message: `Trace width ${trace.width.toFixed(3)}mm is below minimum ${input.rules.minTraceWidth.toFixed(3)}mm`,
        position: mid,
        affectedObjects: [trace.netId],
      });
    }
  }

  // 2. Copper clearance: trace-to-trace
  for (let i = 0; i < input.traces.length; i++) {
    for (let j = i + 1; j < input.traces.length; j++) {
      const t1 = input.traces[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const t2 = input.traces[j]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      if (t1.layer !== t2.layer) continue;
      if (t1.netId === t2.netId) continue;
      totalChecks++;

      const clearance = minTraceToTraceClearance(t1, t2);
      if (clearance < input.rules.minClearance) {
        violations.push({
          id: nextId(),
          rule: "copper-clearance",
          severity: "error",
          message: `Trace-to-trace clearance ${clearance.toFixed(3)}mm < ${input.rules.minClearance.toFixed(3)}mm`,
          position: traceCenter(t1),
          affectedObjects: [t1.netId, t2.netId],
        });
      }
    }
  }

  // 3. Copper clearance: trace-to-pad (different nets)
  for (const trace of input.traces) {
    for (const pad of input.pads) {
      if (trace.layer !== pad.layer) continue;
      if (trace.netId === pad.netId) continue;
      totalChecks++;

      const clearance = minTraceToPadClearance(trace, pad);
      if (clearance < input.rules.minClearance) {
        violations.push({
          id: nextId(),
          rule: "copper-clearance",
          severity: "error",
          message: `Trace-to-pad clearance ${clearance.toFixed(3)}mm < ${input.rules.minClearance.toFixed(3)}mm`,
          position: pad.center,
          affectedObjects: [trace.netId, pad.netId, pad.component],
        });
      }
    }
  }

  // 4. Pad-to-pad clearance (different nets, same layer)
  for (let i = 0; i < input.pads.length; i++) {
    for (let j = i + 1; j < input.pads.length; j++) {
      const p1 = input.pads[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const p2 = input.pads[j]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      if (p1.layer !== p2.layer) continue;
      if (p1.netId === p2.netId) continue;
      totalChecks++;

      const dist = distance(p1.center, p2.center);
      const clearance = dist - p1.width / 2 - p2.width / 2;
      if (clearance < input.rules.minClearance) {
        violations.push({
          id: nextId(),
          rule: "copper-clearance",
          severity: "error",
          message: `Pad-to-pad clearance ${clearance.toFixed(3)}mm < ${input.rules.minClearance.toFixed(3)}mm`,
          position: midpoint(p1.center, p2.center),
          affectedObjects: [p1.component, p2.component],
        });
      }
    }
  }

  // 5. Via constraints
  for (const via of input.vias) {
    totalChecks += 2;
    if (via.drillRadius * 2 < input.rules.minViaDrill) {
      violations.push({
        id: nextId(),
        rule: "min-via-drill",
        severity: "error",
        message: `Via drill ${(via.drillRadius * 2).toFixed(3)}mm < minimum ${input.rules.minViaDrill.toFixed(3)}mm`,
        position: via.center,
        affectedObjects: [via.netId],
      });
    }
    const annularRing = via.outerRadius - via.drillRadius;
    if (annularRing < input.rules.minAnnularRing) {
      violations.push({
        id: nextId(),
        rule: "min-annular-ring",
        severity: "error",
        message: `Via annular ring ${annularRing.toFixed(3)}mm < minimum ${input.rules.minAnnularRing.toFixed(3)}mm`,
        position: via.center,
        affectedObjects: [via.netId],
      });
    }
  }

  // 6. Board edge clearance
  if (input.boardOutline.length >= 3) {
    for (const pad of input.pads) {
      totalChecks++;
      const edgeDist = minDistToPolygon(pad.center, input.boardOutline);
      if (edgeDist < input.rules.boardEdgeClearance) {
        violations.push({
          id: nextId(),
          rule: "board-edge-clearance",
          severity: "warning",
          message: `Pad ${pad.component}.${pad.pinName} is ${edgeDist.toFixed(3)}mm from board edge (min: ${input.rules.boardEdgeClearance.toFixed(3)}mm)`,
          position: pad.center,
          affectedObjects: [pad.component],
        });
      }
    }

    for (const via of input.vias) {
      totalChecks++;
      const edgeDist = minDistToPolygon(via.center, input.boardOutline);
      if (edgeDist < input.rules.boardEdgeClearance) {
        violations.push({
          id: nextId(),
          rule: "board-edge-clearance",
          severity: "warning",
          message: `Via is ${edgeDist.toFixed(3)}mm from board edge`,
          position: via.center,
          affectedObjects: [via.netId],
        });
      }
    }
  }

  // 7. Unconnected nets (ratsnest check)
  for (const [netId, expectedPins] of input.expectedNets) {
    totalChecks++;
    const connectedPins = new Set<string>();

    for (const trace of input.traces) {
      if (trace.netId !== netId) continue;
      for (const pad of input.pads) {
        if (pad.netId !== netId) continue;
        for (const pt of trace.points) {
          if (distance(pt, pad.center) < pad.width / 2 + 0.01) {
            connectedPins.add(`${pad.component}.${pad.pinName}`);
          }
        }
      }
    }

    const unconnected = expectedPins.filter((p) => !connectedPins.has(p));
    if (unconnected.length > 0 && connectedPins.size > 0) {
      violations.push({
        id: nextId(),
        rule: "unconnected-net",
        severity: "warning",
        message: `Net ${netId} has ${unconnected.length} unconnected pin(s): ${unconnected.join(", ")}`,
        position: { x: 0, y: 0 },
        affectedObjects: unconnected,
      });
    }
  }

  const passedChecks = totalChecks - violations.length;

  return {
    violations,
    totalChecks,
    passRate: totalChecks > 0 ? passedChecks / totalChecks : 1.0,
    timestamp: Date.now(),
  };
}

// ── Geometry helpers ──

function distance(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function traceCenter(trace: RenderTrace): Point2D {
  if (trace.points.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of trace.points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / trace.points.length, y: sy / trace.points.length };
}

/** Minimum clearance between two traces (approximate). */
function minTraceToTraceClearance(t1: RenderTrace, t2: RenderTrace): number {
  let minDist = Infinity;

  for (const p1 of t1.points) {
    for (const p2 of t2.points) {
      const d = distance(p1, p2) - t1.width / 2 - t2.width / 2;
      if (d < minDist) minDist = d;
    }
  }

  return minDist;
}

/** Minimum clearance between a trace and a pad (approximate). */
function minTraceToPadClearance(trace: RenderTrace, pad: RenderPad): number {
  let minDist = Infinity;

  for (const pt of trace.points) {
    const d = distance(pt, pad.center) - trace.width / 2 - pad.width / 2;
    if (d < minDist) minDist = d;
  }

  return minDist;
}

/** Minimum distance from a point to a polygon edge. */
function minDistToPolygon(point: Point2D, polygon: Point2D[]): number {
  let minDist = Infinity;

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const b = polygon[(i + 1) % polygon.length]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const d = pointToSegmentDist(point, a, b);
    if (d < minDist) minDist = d;
  }

  return minDist;
}

/** Distance from a point to a line segment. */
function pointToSegmentDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return distance(p, a);

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return distance(p, proj);
}
