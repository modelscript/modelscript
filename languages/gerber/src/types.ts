// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data model for Gerber RS-274-D & RS-274X PCB Photoplotter files.
 */

export type GerberUnit = "MM" | "IN";
export type GerberZeroOmission = "L" | "T";
export type GerberCoordNotation = "A" | "I";
export type GerberPolarity = "D" | "C";
export type GerberInterpolation = "LINEAR" | "CW_ARC" | "CCW_ARC";
export type GerberQuadrantMode = "SINGLE" | "MULTI";
export type GerberApertureShape = "C" | "R" | "O" | "P" | "MACRO";

export interface SourceSpan {
  startOffset: number;
  endOffset: number;
  line: number;
  column: number;
}

export interface GerberFormatSpec extends SourceSpan {
  zeroOmission: GerberZeroOmission;
  coordNotation: GerberCoordNotation;
  xInteger: number;
  xDecimal: number;
  yInteger: number;
  yDecimal: number;
}

export interface GerberApertureDef extends SourceSpan {
  dCode: number;
  shape: GerberApertureShape;
  macroName?: string | undefined;
  /** Dimensions in native file units (converted to mm during CAD lowering). */
  params: number[];
  /** Standard circle/polygon diameter or rectangle/obround X size. */
  width: number;
  /** Rectangle/obround Y size (equals width for circle/polygon). */
  height: number;
  /** Optional inner drill/hole diameter. */
  holeDiameter?: number | undefined;
  /** Number of vertices for regular polygon ('P'). */
  vertices?: number | undefined;
  /** Rotation angle in degrees for polygon ('P'). */
  rotationDeg?: number | undefined;
}

export interface GerberMacroPrimitive {
  code: number;
  modifiers: string[];
}

export interface GerberApertureMacro extends SourceSpan {
  name: string;
  body: string;
  primitives: GerberMacroPrimitive[];
}

export interface GerberStepRepeat extends SourceSpan {
  xRepeat: number;
  yRepeat: number;
  xStep: number;
  yStep: number;
}

export interface GerberAttribute extends SourceSpan {
  kind: "TF" | "TA" | "TD";
  name: string;
  values: string[];
}

export interface GerberComment extends SourceSpan {
  text: string;
}

export interface GerberParseError extends SourceSpan {
  message: string;
  raw: string;
}

export type GerberOperationKind = "DRAW" | "MOVE" | "FLASH";

export interface GerberDrawCommand extends SourceSpan {
  kind: "OPERATION";
  op: GerberOperationKind;
  x?: number | undefined;
  y?: number | undefined;
  i?: number | undefined;
  j?: number | undefined;
  /** Raw integer coordinate strings before scaling (for diagnostics/debugging). */
  rawX?: string | undefined;
  rawY?: string | undefined;
  rawI?: string | undefined;
  rawJ?: string | undefined;
  /** Active state snapshot at time of command */
  interpolation: GerberInterpolation;
  quadrantMode: GerberQuadrantMode;
  polarity: GerberPolarity;
  apertureCode: number | null;
  inRegion: boolean;
  unit: GerberUnit;
  stepRepeat: GerberStepRepeat;
}

export interface GerberSelectApertureCommand extends SourceSpan {
  kind: "SELECT_APERTURE";
  dCode: number;
}

export interface GerberRegionCommand extends SourceSpan {
  kind: "REGION_START" | "REGION_END";
}

export interface GerberModeCommand extends SourceSpan {
  kind: "INTERPOLATION" | "QUADRANT" | "UNIT_LEGACY" | "COORD_MODE" | "POLARITY" | "STEP_REPEAT" | "EOF";
  value: string;
}

export type GerberCommand = GerberDrawCommand | GerberSelectApertureCommand | GerberRegionCommand | GerberModeCommand;

export interface GerberDocument {
  name: string;
  formatSpec: GerberFormatSpec | null;
  unit: GerberUnit | null;
  hasExplicitUnit: boolean;
  hasLegacyUnitCommand: boolean;
  hasIncrementalMode: boolean;
  hasEof: boolean;
  apertures: Map<number, GerberApertureDef>;
  macros: Map<string, GerberApertureMacro>;
  attributes: GerberAttribute[];
  comments: GerberComment[];
  commands: GerberCommand[];
  parseErrors: GerberParseError[];
}

export interface GerberPoint {
  x: number;
  y: number;
}

export interface GerberBoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface GerberStrokeSegment {
  kind: "LINE" | "ARC";
  start: GerberPoint;
  end: GerberPoint;
  center?: GerberPoint | undefined;
  radius?: number | undefined;
  clockwise?: boolean | undefined;
  startAngleRad?: number | undefined;
  sweepAngleRad?: number | undefined;
  widthMm: number;
  lengthMm: number;
  areaMm2: number;
  polarity: GerberPolarity;
  apertureCode: number;
}

export interface GerberFlashPad {
  center: GerberPoint;
  apertureCode: number;
  shape: GerberApertureShape;
  widthMm: number;
  heightMm: number;
  holeDiameterMm: number;
  vertices?: number | undefined;
  rotationDeg?: number | undefined;
  areaMm2: number;
  polarity: GerberPolarity;
}

export interface GerberRegionSegment {
  kind: "LINE" | "ARC";
  start: GerberPoint;
  end: GerberPoint;
  center?: GerberPoint | undefined;
  radius?: number | undefined;
  clockwise?: boolean | undefined;
  sweepAngleRad?: number | undefined;
}

export interface GerberFilledRegion {
  contours: GerberRegionSegment[][];
  areaMm2: number;
  polarity: GerberPolarity;
  boundingBox: GerberBoundingBox;
}

export interface GerberGeometry {
  unit: "MM";
  strokes: GerberStrokeSegment[];
  flashes: GerberFlashPad[];
  regions: GerberFilledRegion[];
  boundingBox: GerberBoundingBox;
  copperAreaMm2: number;
  traceLengthMm: number;
  padCount: number;
  traceCount: number;
  arcCount: number;
  regionCount: number;
}
