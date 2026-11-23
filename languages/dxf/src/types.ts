// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/dxf — Core AST, Geometry, and Document Data Types for AutoCAD DXF.
 */

export interface DxfPoint2D {
  x: number;
  y: number;
}

export interface DxfPoint3D {
  x: number;
  y: number;
  z: number;
}

export interface DxfBoundingBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface DxfGroupPair {
  code: number;
  value: string;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface DxfHeaderVariables {
  acadVer?: string | undefined;
  insUnits?: number | undefined;
  measurement?: number | undefined;
  clayer?: string | undefined;
  extMin?: DxfPoint3D | undefined;
  extMax?: DxfPoint3D | undefined;
  variables: Record<string, Array<{ code: number; value: string; line: number }>>;
}

export interface DxfLayerRecord {
  name: string;
  color: number;
  lineType: string;
  flags: number;
  frozen: boolean;
  off: boolean;
  locked: boolean;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface DxfTable {
  name: string;
  layers: DxfLayerRecord[];
  entryCount: number;
  line: number;
}

export interface DxfEntityBase {
  type: DxfEntityType;
  handle?: string | undefined;
  layer: string;
  color?: number | undefined;
  lineType?: string | undefined;
  extrusion?: DxfPoint3D | undefined;
  line: number;
  startOffset: number;
  endOffset: number;
}

export type DxfEntityType =
  | "LINE"
  | "ARC"
  | "CIRCLE"
  | "LWPOLYLINE"
  | "POLYLINE"
  | "SPLINE"
  | "ELLIPSE"
  | "3DFACE"
  | "POINT"
  | "TEXT"
  | "MTEXT"
  | "INSERT";

export interface DxfLineEntity extends DxfEntityBase {
  type: "LINE";
  start: DxfPoint3D;
  end: DxfPoint3D;
}

export interface DxfArcEntity extends DxfEntityBase {
  type: "ARC";
  center: DxfPoint3D;
  radius: number;
  startAngle: number; // degrees
  endAngle: number; // degrees
}

export interface DxfCircleEntity extends DxfEntityBase {
  type: "CIRCLE";
  center: DxfPoint3D;
  radius: number;
}

export interface DxfLwPolylineVertex {
  x: number;
  y: number;
  bulge: number;
  startWidth?: number | undefined;
  endWidth?: number | undefined;
}

export interface DxfLwPolylineEntity extends DxfEntityBase {
  type: "LWPOLYLINE";
  vertices: DxfLwPolylineVertex[];
  closed: boolean;
  elevation: number;
  constantWidth?: number | undefined;
}

export interface DxfPolylineEntity extends DxfEntityBase {
  type: "POLYLINE";
  vertices: DxfPoint3D[];
  bulges: number[];
  closed: boolean;
  is3D: boolean;
  hasSeqEnd: boolean;
}

export interface DxfSplineEntity extends DxfEntityBase {
  type: "SPLINE";
  degree: number;
  flags: number;
  closed: boolean;
  periodic: boolean;
  rational: boolean;
  knots: number[];
  controlPoints: DxfPoint3D[];
  fitPoints: DxfPoint3D[];
  weights: number[];
}

export interface DxfEllipseEntity extends DxfEntityBase {
  type: "ELLIPSE";
  center: DxfPoint3D;
  majorAxisEndpoint: DxfPoint3D; // relative to center
  ratio: number; // minor / major axis ratio
  startParam: number; // radians
  endParam: number; // radians
}

export interface Dxf3DFaceEntity extends DxfEntityBase {
  type: "3DFACE";
  vertices: [DxfPoint3D, DxfPoint3D, DxfPoint3D, DxfPoint3D];
  invisibleEdgeFlags: number;
}

export interface DxfPointEntity extends DxfEntityBase {
  type: "POINT";
  position: DxfPoint3D;
}

export interface DxfTextEntity extends DxfEntityBase {
  type: "TEXT" | "MTEXT";
  position: DxfPoint3D;
  height: number;
  rotation: number;
  text: string;
  style?: string | undefined;
}

export interface DxfInsertEntity extends DxfEntityBase {
  type: "INSERT";
  blockName: string;
  position: DxfPoint3D;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotation: number; // degrees CCW around Z
  rowCount: number;
  columnCount: number;
  rowSpacing: number;
  columnSpacing: number;
}

export type DxfEntity =
  | DxfLineEntity
  | DxfArcEntity
  | DxfCircleEntity
  | DxfLwPolylineEntity
  | DxfPolylineEntity
  | DxfSplineEntity
  | DxfEllipseEntity
  | Dxf3DFaceEntity
  | DxfPointEntity
  | DxfTextEntity
  | DxfInsertEntity;

export interface DxfBlock {
  name: string;
  layer: string;
  basePoint: DxfPoint3D;
  flags: number;
  entities: DxfEntity[];
  closed: boolean;
  line: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

export interface DxfSectionRecord {
  name: string;
  startLine: number;
  endLine: number;
  closed: boolean;
  pairCount: number;
}

export interface DxfParseError {
  code: string;
  message: string;
  line: number;
}

export interface DxfObjectRecord {
  type: string;
  handle?: string | undefined;
  line: number;
}

export interface DxfDocument {
  header: DxfHeaderVariables;
  tables: DxfTable[];
  layers: Map<string, DxfLayerRecord>;
  duplicateLayers: Array<{ name: string; line: number }>;
  blocks: Map<string, DxfBlock>;
  duplicateBlocks: Array<{ name: string; line: number }>;
  entities: DxfEntity[];
  objects: DxfObjectRecord[];
  sections: DxfSectionRecord[];
  hasEof: boolean;
  parseErrors: DxfParseError[];
  groupPairs: DxfGroupPair[];
  source: string;
}
