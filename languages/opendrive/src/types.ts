// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendrive — Domain Types for ASAM OpenDRIVE Roadway Digital Twins.
 *
 * Implements the core schema of ASAM OpenDRIVE v1.6 / v1.7.
 */

export interface OpenDriveRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type OpenDriveDiagnosticSeverity = "error" | "warning" | "info";

export interface OpenDriveDiagnostic {
  code: string;
  severity: OpenDriveDiagnosticSeverity;
  message: string;
  range: OpenDriveRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Header & Metadata
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenDriveHeader {
  revMajor: number;
  revMinor: number;
  name?: string | undefined;
  version?: string | undefined;
  date?: string | undefined;
  north?: number | undefined;
  south?: number | undefined;
  east?: number | undefined;
  west?: number | undefined;
  vendor?: string | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// PlanView Geometries
// ─────────────────────────────────────────────────────────────────────────────

export type OpenDriveGeometryType = "line" | "spiral" | "arc" | "poly3" | "paramPoly3";

export interface OpenDriveGeometryBase {
  s: number; // Start s-coordinate along road reference line (m)
  x: number; // Start Cartesian X coordinate (m)
  y: number; // Start Cartesian Y coordinate (m)
  hdg: number; // Start heading angle (rad)
  length: number; // Length of the geometry element (m)
  range: OpenDriveRange;
}

export interface OpenDriveLineGeometry extends OpenDriveGeometryBase {
  type: "line";
}

export interface OpenDriveSpiralGeometry extends OpenDriveGeometryBase {
  type: "spiral";
  curvStart: number; // Curvature at start (1/m)
  curvEnd: number; // Curvature at end (1/m)
}

export interface OpenDriveArcGeometry extends OpenDriveGeometryBase {
  type: "arc";
  curvature: number; // Constant curvature (1/m)
}

export interface OpenDrivePoly3Geometry extends OpenDriveGeometryBase {
  type: "poly3";
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface OpenDriveParamPoly3Geometry extends OpenDriveGeometryBase {
  type: "paramPoly3";
  aU: number;
  bU: number;
  cU: number;
  dU: number;
  aV: number;
  bV: number;
  cV: number;
  dV: number;
  pRange: "arcLength" | "normalized";
}

export type OpenDriveGeometry =
  | OpenDriveLineGeometry
  | OpenDriveSpiralGeometry
  | OpenDriveArcGeometry
  | OpenDrivePoly3Geometry
  | OpenDriveParamPoly3Geometry;

// ─────────────────────────────────────────────────────────────────────────────
// Elevation & Superelevation Profiles
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenDriveElevationRecord {
  s: number; // Start s-coordinate (m)
  a: number; // Elevation at s (m)
  b: number; // Slope dz/ds
  c: number; // Curvature d2z/ds2
  d: number; // Rate of change d3z/ds3
  range?: OpenDriveRange | undefined;
}

export interface OpenDriveSuperelevationRecord {
  s: number; // Start s-coordinate (m)
  a: number; // Cross-fall / roll angle at s (rad)
  b: number; // Rate of change (rad/m)
  c: number;
  d: number;
  range?: OpenDriveRange | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lanes & Lane Sections
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenDriveLaneWidth {
  sOffset: number; // Offset from lane section start (m)
  a: number; // Width at sOffset (m)
  b: number;
  c: number;
  d: number;
}

export interface OpenDriveLaneLink {
  predecessor?: number | undefined;
  successor?: number | undefined;
}

export interface OpenDriveLane {
  id: number; // Positive = left, 0 = center, Negative = right
  type: string; // "driving", "border", "shoulder", "sidewalk", etc.
  level?: boolean | undefined;
  link?: OpenDriveLaneLink | undefined;
  widthRecords: OpenDriveLaneWidth[];
  range: OpenDriveRange;
}

export interface OpenDriveLaneSection {
  s: number; // Start s-coordinate along road (m)
  leftLanes: OpenDriveLane[];
  centerLane: OpenDriveLane;
  rightLanes: OpenDriveLane[];
  range: OpenDriveRange;
}

export interface OpenDriveLanes {
  laneSections: OpenDriveLaneSection[];
  range?: OpenDriveRange | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Road Topology & Links
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenDriveRoadLinkItem {
  elementType: "road" | "junction";
  elementId: string;
  contactPoint?: "start" | "end" | undefined;
}

export interface OpenDriveRoadLink {
  predecessor?: OpenDriveRoadLinkItem | undefined;
  successor?: OpenDriveRoadLinkItem | undefined;
}

export interface OpenDriveSignal {
  id: string;
  s: number;
  t: number;
  name?: string | undefined;
  dynamic: boolean;
  orientation: "+" | "-" | "none";
  zOffset?: number | undefined;
  country?: string | undefined;
  type?: string | undefined;
  subtype?: string | undefined;
  value?: number | undefined;
  range: OpenDriveRange;
}

export interface OpenDriveRoad {
  id: string;
  name?: string | undefined;
  length: number;
  junction: string; // -1 for direct road, or junction ID
  link?: OpenDriveRoadLink | undefined;
  planView: OpenDriveGeometry[];
  elevationProfile: OpenDriveElevationRecord[];
  lateralProfile: OpenDriveSuperelevationRecord[];
  lanes: OpenDriveLanes;
  signals: OpenDriveSignal[];
  range: OpenDriveRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Junctions & Connections
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenDriveLaneLinkEntry {
  from: number;
  to: number;
}

export interface OpenDriveConnection {
  id: string;
  incomingRoad: string;
  connectingRoad: string;
  contactPoint: "start" | "end";
  laneLinks: OpenDriveLaneLinkEntry[];
}

export interface OpenDriveJunction {
  id: string;
  name?: string | undefined;
  type?: string | undefined;
  connections: OpenDriveConnection[];
  range: OpenDriveRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Root OpenDRIVE Document
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenDriveDocument {
  header: OpenDriveHeader;
  roads: OpenDriveRoad[];
  junctions: OpenDriveJunction[];
  sourceFile?: string | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluated Spatial Points (Trajectory & CAD)
// ─────────────────────────────────────────────────────────────────────────────

export interface TrackPoint3D {
  s: number;
  x: number;
  y: number;
  z: number;
  hdg: number;
  curvature: number;
  roll: number;
  pitch: number;
}
