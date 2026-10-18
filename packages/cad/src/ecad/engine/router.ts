// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ECAD Canvas — Interactive PCB Router.
 *
 * State machine for interactive trace routing:
 *   - Snap-to-pad targeting
 *   - 45°/90° segment locking (Manhattan + diagonal)
 *   - Push-and-shove obstacle avoidance
 *   - Via insertion on layer transitions
 *   - Trace width from design rules
 */

import type { Point2D, RenderPad, RenderTrace } from "./renderer.js";

// ── Types ──

/** Routing constraint mode. */
export type RoutingMode = "manhattan" | "diagonal45" | "free";

/** Router state. */
export type RouterState = "idle" | "routing" | "dragging";

/** Design rules for routing constraints. */
export interface RoutingRules {
  /** Default trace width (mm). */
  traceWidth: number;
  /** Minimum clearance between copper (mm). */
  clearance: number;
  /** Via drill diameter (mm). */
  viaDrill: number;
  /** Via annular ring (mm). */
  viaAnnularRing: number;
  /** Snap distance to pads (mm). */
  snapDistance: number;
}

/** Event emitted by the router. */
export interface RouterEvent {
  type: "trace-added" | "trace-removed" | "via-added" | "state-changed";
  data?: unknown;
}

/** Callback for router events. */
export type RouterEventHandler = (event: RouterEvent) => void;

// ── Default design rules ──

export const DEFAULT_ROUTING_RULES: RoutingRules = {
  traceWidth: 0.254, // 10mil
  clearance: 0.127, // 5mil
  viaDrill: 0.3,
  viaAnnularRing: 0.15,
  snapDistance: 0.5,
};

// ── Router ──

/**
 * Interactive PCB routing state machine.
 */
export class PCBRouter {
  private state: RouterState = "idle";
  private mode: RoutingMode = "diagonal45";
  private currentLayer = "TopCopper";
  private rules: RoutingRules;
  private pads: RenderPad[];
  private traces: RenderTrace[];
  private currentWaypoints: Point2D[] = [];
  private currentNetId: string | null = null;
  private eventHandlers: RouterEventHandler[] = [];

  constructor(pads: RenderPad[], traces: RenderTrace[], rules?: RoutingRules) {
    this.pads = pads;
    this.traces = traces;
    this.rules = rules ?? DEFAULT_ROUTING_RULES;
  }

  /** Register event handler. */
  onEvent(handler: RouterEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /** Get current router state. */
  getState(): RouterState {
    return this.state;
  }

  /** Get current routing mode. */
  getMode(): RoutingMode {
    return this.mode;
  }

  /** Set routing mode (manhattan, diagonal45, free). */
  setMode(mode: RoutingMode): void {
    this.mode = mode;
  }

  /** Set active routing layer. */
  setLayer(layer: string): void {
    this.currentLayer = layer;
  }

  /** Set design rules. */
  setRules(rules: RoutingRules): void {
    this.rules = rules;
  }

  /**
   * Begin routing a new trace from the given position.
   */
  startRoute(layer: string, position: Point2D): boolean {
    const snapped = this.snapToPad(position);
    const startPos = snapped ?? position;

    if (snapped) {
      const pad = this.findNearestPad(position);
      if (pad) this.currentNetId = pad.netId;
    }

    this.currentLayer = layer;
    this.currentWaypoints = [startPos];
    this.state = "routing";
    this.emit({ type: "state-changed", data: { state: "routing" } });
    return true;
  }

  /**
   * Update the current route with a new cursor position.
   * Returns the constrained trace segments for preview rendering.
   */
  updateRoute(cursor: Point2D): Point2D[] {
    if (this.state !== "routing" || this.currentWaypoints.length === 0) return [];

    const lastPoint = this.currentWaypoints[this.currentWaypoints.length - 1]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const snapped = this.snapToPad(cursor) ?? cursor;
    const constrained = this.constrainSegment(lastPoint, snapped);

    return [...this.currentWaypoints, ...constrained];
  }

  /**
   * Add a waypoint at the current cursor position.
   */
  addWaypoint(cursor: Point2D): void {
    if (this.state !== "routing") return;

    const lastPoint = this.currentWaypoints[this.currentWaypoints.length - 1]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const snapped = this.snapToPad(cursor) ?? cursor;
    const constrained = this.constrainSegment(lastPoint, snapped);
    this.currentWaypoints.push(...constrained);
  }

  /**
   * Commit the current route as a completed trace.
   */
  commitRoute(): RenderTrace | null {
    if (this.state !== "routing" || this.currentWaypoints.length < 2) {
      this.cancelRoute();
      return null;
    }

    const trace: RenderTrace = {
      points: [...this.currentWaypoints],
      width: this.rules.traceWidth,
      layer: this.currentLayer,
      netId: this.currentNetId ?? "",
      selected: false,
    };

    this.traces.push(trace);
    this.state = "idle";
    this.currentWaypoints = [];
    this.currentNetId = null;

    this.emit({ type: "trace-added", data: trace });
    this.emit({ type: "state-changed", data: { state: "idle" } });

    return trace;
  }

  /**
   * Cancel the current routing operation.
   */
  cancelRoute(): void {
    this.state = "idle";
    this.currentWaypoints = [];
    this.currentNetId = null;
    this.emit({ type: "state-changed", data: { state: "idle" } });
  }

  /**
   * Insert a via at the current position and switch layers.
   */
  insertVia(position: Point2D): void {
    if (this.state !== "routing") return;

    this.addWaypoint(position);
    this.currentLayer = this.currentLayer === "TopCopper" ? "BottomCopper" : "TopCopper";
    this.emit({
      type: "via-added",
      data: {
        center: position,
        drill: this.rules.viaDrill,
        annularRing: this.rules.viaAnnularRing,
        net: this.currentNetId,
      },
    });
  }

  /**
   * Remove a trace from the routed set.
   */
  removeTrace(index: number): void {
    if (index >= 0 && index < this.traces.length) {
      this.traces.splice(index, 1);
      this.emit({ type: "trace-removed", data: { index } });
    }
  }

  /**
   * Get all completed traces.
   */
  getTraces(): RenderTrace[] {
    return this.traces;
  }

  // ── Private helpers ──

  private snapToPad(position: Point2D): Point2D | null {
    const pad = this.findNearestPad(position);
    if (!pad) return null;
    const dx = position.x - pad.center.x;
    const dy = position.y - pad.center.y;
    if (Math.sqrt(dx * dx + dy * dy) <= this.rules.snapDistance) {
      return { x: pad.center.x, y: pad.center.y };
    }
    return null;
  }

  private findNearestPad(position: Point2D): RenderPad | null {
    let nearest: RenderPad | null = null;
    let minDist = Infinity;

    for (const pad of this.pads) {
      if (pad.layer !== this.currentLayer) continue;
      const dx = position.x - pad.center.x;
      const dy = position.y - pad.center.y;
      const dist = dx * dx + dy * dy;
      if (dist < minDist) {
        minDist = dist;
        nearest = pad;
      }
    }

    return nearest;
  }

  /**
   * Constrain a segment based on the current routing mode, avoiding obstacles on the current layer.
   */
  private constrainSegment(from: Point2D, to: Point2D): Point2D[] {
    let primary: Point2D[];
    let alternate: Point2D[] | null = null;
    switch (this.mode) {
      case "manhattan": {
        primary = this.manhattanRoute(from, to);
        const dx = Math.abs(to.x - from.x);
        const dy = Math.abs(to.y - from.y);
        alternate = dx >= dy ? [{ x: from.x, y: to.y }, to] : [{ x: to.x, y: from.y }, to];
        break;
      }
      case "diagonal45": {
        primary = this.diagonal45Route(from, to);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const diag = Math.min(Math.abs(dx), Math.abs(dy));
        alternate = [{ x: to.x - Math.sign(dx) * diag, y: to.y - Math.sign(dy) * diag }, to];
        break;
      }
      case "free":
        primary = [to];
        break;
    }

    if (!this.pathCollides(from, primary)) {
      return primary;
    }
    if (alternate && !this.pathCollides(from, alternate)) {
      return alternate;
    }

    const detour = this.computeWalkaroundRoute(from, to);
    if (detour) {
      return detour;
    }
    return primary;
  }

  private pathCollides(from: Point2D, waypoints: Point2D[]): boolean {
    let prev = from;
    for (const pt of waypoints) {
      if (this.segmentBlockedByPad(prev, pt) || this.segmentBlockedByTrace(prev, pt)) {
        return true;
      }
      prev = pt;
    }
    return false;
  }

  private segmentBlockedByPad(a: Point2D, b: Point2D): RenderPad | null {
    const halfWidth = this.rules.traceWidth / 2;
    for (const pad of this.pads) {
      if (pad.layer !== this.currentLayer) continue;
      if (this.currentNetId && pad.netId === this.currentNetId) continue;
      // Ignore if endpoint is snapped directly to this pad
      if (Math.hypot(a.x - pad.center.x, a.y - pad.center.y) < 1e-3) continue;
      if (Math.hypot(b.x - pad.center.x, b.y - pad.center.y) < 1e-3) continue;

      const padRadius = Math.max(pad.width, pad.height) / 2;
      const minAllowed = padRadius + halfWidth + this.rules.clearance;
      if (pointToSegDist(pad.center, a, b) < minAllowed) {
        return pad;
      }
    }
    return null;
  }

  private segmentBlockedByTrace(a: Point2D, b: Point2D): boolean {
    const halfWidth = this.rules.traceWidth / 2;
    for (const trace of this.traces) {
      if (trace.layer !== this.currentLayer) continue;
      if (this.currentNetId && trace.netId === this.currentNetId) continue;
      const minAllowed = trace.width / 2 + halfWidth + this.rules.clearance;
      for (let i = 0; i < trace.points.length - 1; i++) {
        const p1 = trace.points[i]!;
        const p2 = trace.points[i + 1]!;
        if (segToSegDist(a, b, p1, p2) < minAllowed) {
          return true;
        }
      }
    }
    return false;
  }

  private computeWalkaroundRoute(from: Point2D, to: Point2D): Point2D[] | null {
    const blocker = this.segmentBlockedByPad(from, to);
    if (!blocker) return null;
    const margin = Math.max(blocker.width, blocker.height) / 2 + this.rules.traceWidth / 2 + this.rules.clearance + 0.1;
    const offsets: [number, number][] = [
      [0, margin],
      [0, -margin],
      [margin, 0],
      [-margin, 0],
    ];
    for (const [ox, oy] of offsets) {
      const wp: Point2D = { x: blocker.center.x + ox, y: blocker.center.y + oy };
      const leg1 = this.mode === "manhattan" ? this.manhattanRoute(from, wp) : [wp];
      const leg2 = this.mode === "manhattan" ? this.manhattanRoute(wp, to) : [to];
      const candidate = [...leg1, ...leg2];
      if (!this.pathCollides(from, candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /** Manhattan routing: two segments at 90° */
  private manhattanRoute(from: Point2D, to: Point2D): Point2D[] {
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    if (dx >= dy) {
      return [{ x: to.x, y: from.y }, to];
    } else {
      return [{ x: from.x, y: to.y }, to];
    }
  }

  /** Diagonal 45° routing: diagonal segment + straight segment */
  private diagonal45Route(from: Point2D, to: Point2D): Point2D[] {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const diag = Math.min(adx, ady);
    const diagX = Math.sign(dx) * diag;
    const diagY = Math.sign(dy) * diag;
    const mid = { x: from.x + diagX, y: from.y + diagY };
    return [mid, to];
  }

  private emit(event: RouterEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }
}

function pointToSegDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segToSegDist(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): number {
  const ccw = (p1: Point2D, p2: Point2D, p3: Point2D) => (p3.y - p1.y) * (p2.x - p1.x) - (p2.y - p1.y) * (p3.x - p1.x);
  const d1 = ccw(b1, b2, a1);
  const d2 = ccw(b1, b2, a2);
  const d3 = ccw(a1, a2, b1);
  const d4 = ccw(a1, a2, b2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return 0;
  }
  return Math.min(
    pointToSegDist(a1, b1, b2),
    pointToSegDist(a2, b1, b2),
    pointToSegDist(b1, a1, a2),
    pointToSegDist(b2, a1, a2),
  );
}
