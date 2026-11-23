// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core types for @modelscript/gcode (RS-274 / ISO 6983 CNC Numerical Control).
 */

export type PlaneMode = "G17" | "G18" | "G19";
export type DistanceMode = "G90" | "G91";
export type UnitMode = "G20" | "G21";
export type FeedMode = "G94" | "G95";
export type SpindleState = "M03" | "M04" | "M05";
export type CoolantState = "M08" | "M09";
export type CutterCompMode = "G40" | "G41" | "G42";
export type RetractMode = "G98" | "G99";
export type WorkOffsetCode = "G54" | "G55" | "G56" | "G57" | "G58" | "G59";

export type MotionMode =
  "G00" | "G01" | "G02" | "G03" | "G80" | "G81" | "G82" | "G83" | "G84" | "G85" | "G86" | "G87" | "G88" | "G89";

export interface GCodeWord {
  /** Uppercase address letter (e.g., G, M, X, Y, Z, F, S, T, I, J, K, R, P, Q, L, N, O). */
  letter: string;
  /** Evaluated numeric value (or NaN if expression failed to evaluate). */
  value: number;
  /** Canonical normalized code for G/M words (e.g., "G00", "G01", "M03", "G54"). */
  canonicalCode?: string | undefined;
  /** Raw source text of the word. */
  raw: string;
  /** Optional expression string if value came from `[...]` or `#n`. */
  expression?: string | undefined;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface GCodeComment {
  kind: "paren" | "semicolon";
  text: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface GCodeParamAssignment {
  paramNumber: number;
  expression: string;
  value: number;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface GCodeParseError {
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface GCodeBlock {
  blockIndex: number;
  line: number;
  lineNumber?: number | undefined;
  programNumber?: number | undefined;
  blockDelete: boolean;
  isTapeMarker: boolean;
  words: GCodeWord[];
  gCodes: string[];
  mCodes: string[];
  paramAssignments: GCodeParamAssignment[];
  comments: GCodeComment[];
  rawText: string;
  startOffset: number;
  endOffset: number;
}

export interface GCodeSubprogram {
  programNumber: number;
  name: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  blocks: GCodeBlock[];
}

export interface GCodeProgram {
  name: string;
  programNumber?: number | undefined;
  blocks: GCodeBlock[];
  subprograms: Map<number, GCodeSubprogram>;
  parameters: Map<number, number>;
  comments: GCodeComment[];
  parseErrors: GCodeParseError[];
  rawText: string;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface BoundingBox3D {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export type ToolpathSegmentKind =
  "rapid" | "linear" | "arc_cw" | "arc_ccw" | "dwell" | "drill_plunge" | "drill_retract";

export interface ToolpathSegment {
  kind: ToolpathSegmentKind;
  start: Point3D;
  end: Point3D;
  center?: Point3D | undefined;
  radiusMm?: number | undefined;
  sweepAngleRad?: number | undefined;
  plane?: PlaneMode | undefined;
  feedrateMmPerMin: number;
  spindleRpm: number;
  lengthMm: number;
  durationSec: number;
  blockLine: number;
  gCode: string;
  toolNumber: number;
}

export interface ToolpathOptions {
  /** Rapid traverse rate in mm/min (default: 10000). */
  rapidRateMmPerMin?: number | undefined;
  /** Default unit mode if program does not specify G20/G21 (default: "G21" mm). */
  defaultUnits?: UnitMode | undefined;
  /** Work coordinate offsets in mm. */
  workOffsets?: Partial<Record<WorkOffsetCode, Point3D>> | undefined;
  /** Retract clearance in mm for G83 peck drilling (default: 0.5). */
  peckClearanceMm?: number | undefined;
  /** Maximum subprogram call depth (default: 16). */
  maxSubprogramDepth?: number | undefined;
}

export interface ToolpathSummary {
  programName: string;
  segments: ToolpathSegment[];
  boundingBox: BoundingBox3D;
  rapidLengthMm: number;
  cuttingLengthMm: number;
  totalLengthMm: number;
  rapidTimeSec: number;
  cuttingTimeSec: number;
  dwellTimeSec: number;
  totalCycleTimeSec: number;
  unitMode: UnitMode;
  finalPosition: Point3D;
  toolChanges: number[];
  spindleRpmMax: number;
  feedrateMaxMmPerMin: number;
  holeCount: number;
}
