// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core domain types for GDSII (Calma Graphic Design System II, 1978) IC Layout Stream Format.
 */

export interface GdsiiPoint {
  x: number;
  y: number;
}

export interface GdsiiTimestamp {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface GdsiiStrans {
  /** Bit 15 (0x8000): Reflection across the X-axis before rotation. */
  reflectX: boolean;
  /** Bit 2 (0x0004): Absolute magnification flag. */
  absoluteMag?: boolean | undefined;
  /** Bit 1 (0x0002): Absolute angle flag. */
  absoluteAngle?: boolean | undefined;
  /** Raw 16-bit STRANS bitmask. */
  raw?: number | undefined;
}

export interface GdsiiProperty {
  attr: number;
  value: string;
}

export interface GdsiiElementBase {
  kind: "boundary" | "path" | "sref" | "aref" | "text" | "node" | "box";
  properties?: GdsiiProperty[] | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  line?: number | undefined;
  column?: number | undefined;
}

export interface GdsiiBoundaryElement extends GdsiiElementBase {
  kind: "boundary";
  layer: number;
  datatype: number;
  xy: GdsiiPoint[];
}

export interface GdsiiPathElement extends GdsiiElementBase {
  kind: "path";
  layer: number;
  datatype: number;
  pathtype?: number | undefined; // 0 = flush, 1 = round, 2 = half-width extended, 4 = custom
  width?: number | undefined;
  bgnextn?: number | undefined;
  endextn?: number | undefined;
  xy: GdsiiPoint[];
}

export interface GdsiiSrefElement extends GdsiiElementBase {
  kind: "sref";
  sname: string;
  strans?: GdsiiStrans | undefined;
  mag?: number | undefined;
  angle?: number | undefined;
  xy: GdsiiPoint;
}

export interface GdsiiArefElement extends GdsiiElementBase {
  kind: "aref";
  sname: string;
  strans?: GdsiiStrans | undefined;
  mag?: number | undefined;
  angle?: number | undefined;
  columns: number;
  rows: number;
  /** 3 reference points: [origin, columnEnd, rowEnd]. */
  xy: [GdsiiPoint, GdsiiPoint, GdsiiPoint];
}

export interface GdsiiTextElement extends GdsiiElementBase {
  kind: "text";
  layer: number;
  texttype: number;
  presentation?: number | undefined;
  pathtype?: number | undefined;
  width?: number | undefined;
  strans?: GdsiiStrans | undefined;
  mag?: number | undefined;
  angle?: number | undefined;
  xy: GdsiiPoint;
  string: string;
}

export type GdsiiElement =
  GdsiiBoundaryElement | GdsiiPathElement | GdsiiSrefElement | GdsiiArefElement | GdsiiTextElement;

export interface GdsiiStructure {
  name: string;
  creationTime?: GdsiiTimestamp | undefined;
  modificationTime?: GdsiiTimestamp | undefined;
  elements: GdsiiElement[];
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  line?: number | undefined;
}

export interface GdsiiUnits {
  /** Size of a database unit in user units (e.g., 1e-3 for 1 nm when user unit = 1 um). */
  dbUnitInUserUnits: number;
  /** Size of a database unit in meters (e.g., 1e-9 for 1 nm). */
  dbUnitInMeters: number;
}

export interface GdsiiParseError {
  message: string;
  line: number;
  column: number;
  offset?: number | undefined;
}

export interface GdsiiLibrary {
  /** GDSII stream version (typically 600 for v6.0, 5 for v5, 3 for v3). */
  version: number;
  name: string;
  creationTime?: GdsiiTimestamp | undefined;
  modificationTime?: GdsiiTimestamp | undefined;
  units: GdsiiUnits;
  structures: GdsiiStructure[];
  parseErrors?: GdsiiParseError[] | undefined;
}

/**
 * DRC design rule specification for a single GDSII layer.
 */
export interface GdsiiLayerDrcRule {
  layer: number;
  name?: string | undefined;
  /** Minimum feature width in database units (or user units if specified in options). */
  minWidth: number;
  /** Minimum spacing between distinct features on the same layer. */
  minSpacing: number;
  /** Optional minimum area. */
  minArea?: number | undefined;
}

/**
 * 3D process layer stack entry for CAD extrusion & parasitic RC extraction.
 */
export interface GdsiiLayerStackEntry {
  layer: number;
  datatype?: number | undefined;
  name: string;
  /** Bottom Z elevation in micrometers. */
  zMinUm: number;
  /** Layer thickness in micrometers. */
  thicknessUm: number;
  /** Sheet resistance in Ohms/square (for parasitic RC extraction). */
  sheetResistanceOhmSq: number;
  /** Area capacitance to substrate in fF/um^2. */
  areaCapFfPerUm2: number;
  /** Fringe (perimeter) capacitance in fF/um. */
  fringeCapFfPerUm: number;
  /** Display color for SVG projection. */
  color: string;
}
