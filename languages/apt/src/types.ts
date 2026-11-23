// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core AST, Analytic Geometry, and CLDATA Types for `@modelscript/apt`
 * (APT — Automatically Programmed Tools CNC Part Programming Language, 1957–1960s / ISO 4342).
 */

export type AptUnits = "INCHES" | "MM";

export type AptSurfaceRelation = "TO" | "ON" | "PAST" | "TANTO";

export type AptMotionKeyword =
  "FROM" | "GOTO" | "GODLTA" | "GO" | "GOLFT" | "GORGT" | "GOFWD" | "GOBACK" | "GOUP" | "GODOWN";

export type AptGeometryKind = "POINT" | "LINE" | "CIRCLE" | "PLANE" | "PATERN";

export type AptPostProcessorKeyword =
  "PARTNO" | "MACHIN" | "UNITS" | "INTOL" | "OUTTOL" | "CUTTER" | "SPINDL" | "FEDRAT" | "COOLNT" | "RAPID" | "FINI";

export interface SourceSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface AptParseError extends SourceSpan {
  message: string;
  rawLine: string;
}

export interface AptGeometryDef extends SourceSpan {
  stmtKind: "geometry";
  label: string;
  geometryKind: AptGeometryKind;
  args: string[];
  raw: string;
}

export interface AptMotionStmt extends SourceSpan {
  stmtKind: "motion";
  keyword: AptMotionKeyword;
  args: string[];
  raw: string;
}

export interface AptPostProcessorStmt extends SourceSpan {
  stmtKind: "postprocessor";
  keyword: AptPostProcessorKeyword;
  args: string[];
  raw: string;
}

export type AptStatement = AptGeometryDef | AptMotionStmt | AptPostProcessorStmt;

export interface AptProgram {
  partno: string;
  machin?: string | undefined;
  units: AptUnits;
  intol: number;
  outtol: number;
  hasFini: boolean;
  geometries: Map<string, AptGeometryDef>;
  geometryList: AptGeometryDef[];
  statements: AptStatement[];
  parseErrors: AptParseError[];
}

// ---------------------------------------------------------------------------
// Resolved 2D/3D Analytic Geometry
// ---------------------------------------------------------------------------

export interface Point3D {
  kind: "POINT";
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface Line2D {
  kind: "LINE";
  label: string;
  /** Point on the line */
  x1: number;
  y1: number;
  /** Second point defining direction */
  x2: number;
  y2: number;
  /** Unit direction vector (ux, uy) from p1 toward p2 */
  ux: number;
  uy: number;
  /** Unit left normal (-uy, ux), satisfying a*x + b*y + c = 0 with a = -uy, b = ux */
  a: number;
  b: number;
  c: number;
}

export interface Circle2D {
  kind: "CIRCLE";
  label: string;
  cx: number;
  cy: number;
  cz: number;
  radius: number;
}

export interface Plane3D {
  kind: "PLANE";
  label: string;
  /** Normal vector (nx, ny, nz) normalized */
  nx: number;
  ny: number;
  nz: number;
  /** Plane equation nx*x + ny*y + nz*z = d */
  d: number;
}

export interface PaternResolved {
  kind: "PATERN";
  label: string;
  points: Array<{ x: number; y: number; z: number }>;
}

export type ResolvedGeometry = Point3D | Line2D | Circle2D | Plane3D | PaternResolved;

// ---------------------------------------------------------------------------
// CLDATA (Cutter Location Data) Toolpath Representation
// ---------------------------------------------------------------------------

export type ClDataRecordKind =
  "FROM" | "RAPID" | "LINEAR" | "ARC_CW" | "ARC_CCW" | "CUTTER" | "SPINDL" | "FEDRAT" | "COOLNT" | "FINI";

export interface ClDataRecord {
  kind: ClDataRecordKind;
  line: number;
  /** Tool center start position (for motion records) */
  x0?: number | undefined;
  y0?: number | undefined;
  z0?: number | undefined;
  /** Tool center end position (for FROM / motion records) */
  x?: number | undefined;
  y?: number | undefined;
  z?: number | undefined;
  /** Arc center and geometry (for ARC_CW / ARC_CCW) */
  cx?: number | undefined;
  cy?: number | undefined;
  radius?: number | undefined;
  startAngle?: number | undefined;
  endAngle?: number | undefined;
  sweepAngle?: number | undefined;
  /** Segment length in program units */
  length?: number | undefined;
  /** Active feed rate in units/min during this segment */
  feedRate?: number | undefined;
  /** Postprocessor numeric value (diameter, RPM, feed rate) */
  value?: number | undefined;
  /** Postprocessor mode (e.g. CLW, CCLW, ON, OFF, FLOOD, MIST) */
  mode?: string | undefined;
  /** Source APT statement summary */
  comment?: string | undefined;
}

export interface ClDataBoundingBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface ClDataSolverError {
  code: string;
  message: string;
  line: number;
}

export interface ClDataProgram {
  partno: string;
  units: AptUnits;
  cutterDiameter: number;
  cutterRadius: number;
  spindleRpm: number;
  spindleDirection: "CLW" | "CCLW" | "OFF";
  feedRate: number;
  rapidRate: number;
  geometries: Map<string, ResolvedGeometry>;
  records: ClDataRecord[];
  totalCuttingLength: number;
  totalRapidLength: number;
  totalPathLength: number;
  cuttingTimeMin: number;
  rapidTimeMin: number;
  totalCycleTimeMin: number;
  totalCycleTimeSec: number;
  boundingBox: ClDataBoundingBox;
  errors: ClDataSolverError[];
}
