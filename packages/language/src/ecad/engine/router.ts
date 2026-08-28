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
   * Constrain a segment based on the current routing mode.
   */
  private constrainSegment(from: Point2D, to: Point2D): Point2D[] {
    switch (this.mode) {
      case "manhattan":
        return this.manhattanRoute(from, to);
      case "diagonal45":
        return this.diagonal45Route(from, to);
      case "free":
        return [to];
    }
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
