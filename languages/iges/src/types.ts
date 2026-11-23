// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iges — Core IGES 5.3 (Initial Graphics Exchange Specification) data types.
 */

export type IgesSectionCode = "S" | "G" | "D" | "P" | "T";

/**
 * IGES 5.3 Global Section Unit Flags (Parameter 14).
 */
export const IgesUnitFlag = {
  INCH: 1,
  MILLIMETER: 2,
  SPECIAL: 3,
  FOOT: 4,
  MILE: 5,
  METER: 6,
  KILOMETER: 7,
  MIL: 8,
  MICRON: 9,
  CENTIMETER: 10,
  MICROINCH: 11,
} as const;

export type IgesUnitFlag = (typeof IgesUnitFlag)[keyof typeof IgesUnitFlag];

/**
 * Unit conversion factor from IGES model units to SI meters.
 */
export const IGES_UNIT_TO_METERS: Readonly<Record<number, number>> = {
  1: 0.0254, // inch
  2: 0.001, // millimeter
  3: 1.0, // special / user-defined
  4: 0.3048, // foot
  5: 1609.344, // mile
  6: 1.0, // meter
  7: 1000.0, // kilometer
  8: 0.0000254, // mil (0.001 inch)
  9: 1e-6, // micron
  10: 0.01, // centimeter
  11: 2.54e-8, // microinch
};

export const IGES_UNIT_NAMES: Readonly<Record<number, string>> = {
  1: "IN",
  2: "MM",
  3: "SPECIAL",
  4: "FT",
  5: "MI",
  6: "M",
  7: "KM",
  8: "MIL",
  9: "UM",
  10: "CM",
  11: "UIN",
};

/**
 * Standard IGES 5.3 Entity Type numbers.
 */
export const IgesEntityType = {
  CIRCULAR_ARC: 100,
  COMPOSITE_CURVE: 102,
  CONIC_ARC: 104,
  COPIOUS_DATA: 106,
  PLANE: 108,
  LINE: 110,
  POINT: 116,
  SURFACE_OF_REVOLUTION: 120,
  TABULATED_CYLINDER: 122,
  TRANSFORMATION_MATRIX: 124,
  RATIONAL_BSPLINE_CURVE: 126,
  RATIONAL_BSPLINE_SURFACE: 128,
  CURVE_ON_PARAMETRIC_SURFACE: 142,
  TRIMMED_PARAMETRIC_SURFACE: 144,
  MANIFOLD_SOLID_BREP: 186,
  VERTEX_LIST: 502,
  EDGE_LIST: 504,
  LOOP: 508,
  FACE: 510,
  SHELL: 514,
} as const;

export type IgesEntityType = (typeof IgesEntityType)[keyof typeof IgesEntityType];

export const IGES_ENTITY_TYPE_NAMES: Readonly<Record<number, string>> = {
  100: "Circular Arc",
  102: "Composite Curve",
  104: "Conic Arc",
  106: "Copious Data",
  108: "Plane",
  110: "Line",
  116: "Point",
  120: "Surface of Revolution",
  122: "Tabulated Cylinder",
  124: "Transformation Matrix",
  126: "Rational B-Spline Curve (NURBS)",
  128: "Rational B-Spline Surface (NURBS)",
  142: "Curve on Parametric Surface",
  144: "Trimmed Parametric Surface",
  186: "Manifold Solid B-Rep Object",
  502: "Vertex List",
  504: "Edge List",
  508: "Loop",
  510: "Face",
  514: "Shell",
};

export type Point3D = [number, number, number];

export interface IgesRawLine {
  lineNumber: number; // 1-based
  raw: string;
  length: number;
  sectionCode: IgesSectionCode | null;
  sequenceNumber: number | null;
  startOffset: number;
  endOffset: number;
}

export interface IgesParseIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column?: number;
  deNumber?: number;
}

export interface IgesGlobalParams {
  parameterDelimiter: string;
  recordDelimiter: string;
  productIdSender: string;
  fileName: string;
  nativeSystemId: string;
  preprocessorVersion: string;
  integerBits: number;
  singlePrecisionMag: number;
  singlePrecisionSig: number;
  doublePrecisionMag: number;
  doublePrecisionSig: number;
  productIdReceiver: string;
  modelSpaceScale: number;
  unitFlag: number;
  unitName: string;
  maxLineWeightGradations: number;
  maxLineWeight: number;
  creationDate: string;
  minResolution: number;
  maxCoordinate: number;
  authorName: string;
  authorOrganization: string;
  versionFlag: number;
  draftingStandardFlag: number;
  modifiedDate: string;
  rawFields: string[];
  startLine: number;
  endLine: number;
}

export interface IgesDirectoryEntry {
  /** 1-based odd sequence number in D section (1, 3, 5, ...) */
  deNumber: number;
  entityType: number;
  entityTypeLine2: number;
  parameterDataPointer: number;
  structure: number;
  lineFontPattern: number;
  level: number;
  view: number;
  transformMatrixPointer: number;
  labelDisplayAssoc: number;
  statusNumber: string;
  lineWeightNumber: number;
  colorNumber: number;
  parameterLineCount: number;
  formNumber: number;
  entityLabel: string;
  entitySubscript: number;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  incomplete: boolean;
}

export interface IgesParameterRecord {
  dePointer: number;
  entityType: number;
  rawText: string;
  fields: string[];
  startLine: number;
  endLine: number;
}

export interface IgesEntityBase {
  deNumber: number;
  entityType: number;
  formNumber: number;
  transformMatrixPointer: number;
  label: string;
  colorNumber: number;
  level: number;
  startLine: number;
  endLine: number;
}

export interface IgesCircularArcEntity extends IgesEntityBase {
  entityType: 100;
  zt: number;
  center: [number, number];
  start: [number, number];
  end: [number, number];
}

export interface IgesCompositeCurveEntity extends IgesEntityBase {
  entityType: 102;
  constituentPointers: number[];
}

export interface IgesConicArcEntity extends IgesEntityBase {
  entityType: 104;
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  zt: number;
  start: [number, number];
  end: [number, number];
}

export interface IgesCopiousDataEntity extends IgesEntityBase {
  entityType: 106;
  interpretationFlag: number;
  points: Point3D[];
}

export interface IgesPlaneEntity extends IgesEntityBase {
  entityType: 108;
  a: number;
  b: number;
  c: number;
  d: number;
  boundingCurvePointer: number;
  displaySymbolLocation: Point3D;
  displaySymbolSize: number;
}

export interface IgesLineEntity extends IgesEntityBase {
  entityType: 110;
  start: Point3D;
  end: Point3D;
}

export interface IgesPointEntity extends IgesEntityBase {
  entityType: 116;
  point: Point3D;
  displaySymbolPointer: number;
}

export interface IgesSurfaceOfRevolutionEntity extends IgesEntityBase {
  entityType: 120;
  axisPointer: number;
  generatrixPointer: number;
  startAngle: number;
  endAngle: number;
}

export interface IgesTabulatedCylinderEntity extends IgesEntityBase {
  entityType: 122;
  directrixPointer: number;
  directionEnd: Point3D;
}

export interface IgesTransformMatrixEntity extends IgesEntityBase {
  entityType: 124;
  /** Row-major 3x3 rotation matrix [[r11,r12,r13],[r21,r22,r23],[r31,r32,r33]] */
  rotation: [[number, number, number], [number, number, number], [number, number, number]];
  translation: Point3D;
}

export interface IgesNurbsCurveEntity extends IgesEntityBase {
  entityType: 126;
  /** Upper index of sum (K); number of control points = K + 1 */
  k: number;
  /** Degree of basis functions (M) */
  m: number;
  planar: boolean;
  closed: boolean;
  polynomial: boolean;
  periodic: boolean;
  knots: number[];
  weights: number[];
  controlPoints: Point3D[];
  v0: number;
  v1: number;
  normal: Point3D;
}

export interface IgesNurbsSurfaceEntity extends IgesEntityBase {
  entityType: 128;
  k1: number;
  k2: number;
  m1: number;
  m2: number;
  closedU: boolean;
  closedV: boolean;
  polynomial: boolean;
  periodicU: boolean;
  periodicV: boolean;
  knotsU: number[];
  knotsV: number[];
  /** Weights in IGES order: index = j*(k1+1) + i (i in 0..k1, j in 0..k2) */
  weights: number[];
  /** Control points in IGES order: index = j*(k1+1) + i */
  controlPoints: Point3D[];
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export interface IgesCurveOnSurfaceEntity extends IgesEntityBase {
  entityType: 142;
  creationWay: number;
  surfacePointer: number;
  paramCurvePointer: number;
  modelCurvePointer: number;
  preference: number;
}

export interface IgesTrimmedSurfaceEntity extends IgesEntityBase {
  entityType: 144;
  surfacePointer: number;
  outerBoundaryType: number;
  outerBoundaryPointer: number;
  innerBoundaryPointers: number[];
}

export interface IgesManifoldSolidBRepEntity extends IgesEntityBase {
  entityType: 186;
  outerShellPointer: number;
  outerShellOrientation: boolean;
  voidShellPointers: number[];
  voidShellOrientations: boolean[];
}

export interface IgesGenericEntity extends IgesEntityBase {
  rawParams: string[];
}

export type IgesEntity =
  | IgesCircularArcEntity
  | IgesCompositeCurveEntity
  | IgesConicArcEntity
  | IgesCopiousDataEntity
  | IgesPlaneEntity
  | IgesLineEntity
  | IgesPointEntity
  | IgesSurfaceOfRevolutionEntity
  | IgesTabulatedCylinderEntity
  | IgesTransformMatrixEntity
  | IgesNurbsCurveEntity
  | IgesNurbsSurfaceEntity
  | IgesCurveOnSurfaceEntity
  | IgesTrimmedSurfaceEntity
  | IgesManifoldSolidBRepEntity
  | IgesGenericEntity;

export interface IgesTerminateSection {
  startCount: number;
  globalCount: number;
  directoryCount: number;
  parameterCount: number;
  lineNumber: number;
}

export interface IgesSectionCounts {
  S: number;
  G: number;
  D: number;
  P: number;
  T: number;
}

export interface IgesDocument {
  startLines: string[];
  global: IgesGlobalParams | null;
  directoryEntries: Map<number, IgesDirectoryEntry>;
  parameterRecords: Map<number, IgesParameterRecord>;
  entities: IgesEntity[];
  entitiesByDe: Map<number, IgesEntity>;
  terminate: IgesTerminateSection | null;
  sectionCounts: IgesSectionCounts;
  rawLines: IgesRawLine[];
  parseIssues: IgesParseIssue[];
}
