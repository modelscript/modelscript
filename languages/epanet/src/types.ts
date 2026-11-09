// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Domain Types for US EPA EPANET Water Distribution Networks.
 *
 * Implements the schema for EPANET 2.x (.inp) network decks, including
 * hydraulic nodes (junctions, reservoirs, tanks), links (pipes, pumps, valves),
 * operational curves, patterns, and global hydraulic solver options.
 */

export interface EpanetRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type EpanetDiagnosticSeverity = "error" | "warning" | "info";

export interface EpanetDiagnostic {
  code: string;
  severity: EpanetDiagnosticSeverity;
  message: string;
  range: EpanetRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hydraulic Nodes
// ─────────────────────────────────────────────────────────────────────────────

export interface EpanetJunction {
  id: string;
  elevation: number; // m or ft
  demand: number; // Base demand flow rate
  patternId?: string | undefined;
  range: EpanetRange;
}

export interface EpanetReservoir {
  id: string;
  totalHead: number; // Hydraulic head (elevation + pressure head)
  patternId?: string | undefined;
  range: EpanetRange;
}

export interface EpanetTank {
  id: string;
  elevation: number;
  initLevel: number;
  minLevel: number;
  maxLevel: number;
  diameter: number;
  minVol: number;
  volCurveId?: string | undefined;
  range: EpanetRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hydraulic Links
// ─────────────────────────────────────────────────────────────────────────────

export interface EpanetPipe {
  id: string;
  node1: string;
  node2: string;
  length: number; // m or ft
  diameter: number; // mm or inches
  roughness: number; // Hazen-Williams C or Darcy-Weisbach roughness
  minorLoss: number;
  status: "OPEN" | "CLOSED" | "CV";
  range: EpanetRange;
}

export interface EpanetPump {
  id: string;
  node1: string;
  node2: string;
  headCurveId?: string | undefined;
  power?: number | undefined; // kW or hp
  speed?: number | undefined;
  status: "OPEN" | "CLOSED";
  range: EpanetRange;
}

export type EpanetValveType = "PRV" | "PSV" | "PBV" | "FCV" | "TCV" | "GPV";

export interface EpanetValve {
  id: string;
  node1: string;
  node2: string;
  diameter: number;
  type: EpanetValveType;
  setting: number;
  minorLoss: number;
  range: EpanetRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Operational Curves & Demand Patterns
// ─────────────────────────────────────────────────────────────────────────────

export interface EpanetCurvePoint {
  x: number; // Flow rate Q
  y: number; // Head H, Efficiency, Volume, etc.
}

export interface EpanetCurve {
  id: string;
  type?: string | undefined; // "PUMP", "EFFICIENCY", "VOLUME", "HEADLOSS"
  points: EpanetCurvePoint[];
  range: EpanetRange;
}

export interface EpanetPattern {
  id: string;
  multipliers: number[];
  range: EpanetRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Operational Controls & Logical Rules
// ─────────────────────────────────────────────────────────────────────────────

export interface EpanetControl {
  linkId: string;
  status: "OPEN" | "CLOSED";
  setting?: number | undefined;
  conditionType: "NODE_HEAD" | "NODE_PRESSURE" | "TANK_LEVEL" | "TIME" | "CLOCKTIME";
  nodeId?: string | undefined;
  operator?: "ABOVE" | "BELOW" | undefined;
  value: number; // Head (m), pressure (m), level (m), or time (hours)
  range?: EpanetRange | undefined;
}

export interface EpanetRule {
  id: string;
  condition: string;
  action: string;
  range?: EpanetRange | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Network Options & Root Document
// ─────────────────────────────────────────────────────────────────────────────

export type EpanetFlowUnits = "LPS" | "LPM" | "MLD" | "CMH" | "CMD" | "CFS" | "GPM" | "MGD" | "IMGD" | "AFD";

export type EpanetHeadLossModel = "H-W" | "D-W" | "C-M";

export interface EpanetOptions {
  units: EpanetFlowUnits;
  headloss: EpanetHeadLossModel;
  specificGravity: number;
  viscosity: number;
  trials: number;
  accuracy: number;
  flowChange: number;
  durationHours?: number | undefined; // EPS total duration, default 24h
  hydraulicStepHours?: number | undefined; // EPS time step, default 1h
  patternStepHours?: number | undefined; // Demand pattern interval, default 1h
  demandModel?: "DDA" | "PDD" | undefined; // Demand-Driven vs Pressure-Dependent
  pddMinPressure?: number | undefined; // Minimum pressure for zero flow, default 0 m
  pddReqPressure?: number | undefined; // Required service pressure, default 20 m
  pddPressureExponent?: number | undefined; // Pressure exponent alpha, default 0.5
}

export interface EpanetNetwork {
  title?: string | undefined;
  junctions: EpanetJunction[];
  reservoirs: EpanetReservoir[];
  tanks: EpanetTank[];
  pipes: EpanetPipe[];
  pumps: EpanetPump[];
  valves: EpanetValve[];
  curves: EpanetCurve[];
  patterns: EpanetPattern[];
  controls?: EpanetControl[] | undefined;
  rules?: EpanetRule[] | undefined;
  options: EpanetOptions;
  filename?: string | undefined;
}
