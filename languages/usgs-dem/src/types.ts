// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for USGS Digital Elevation Model (DEM) ASCII Terrain Format (1970s–1980s).
 *
 * Follows USGS National Mapping Program Data Users Guide 5 (Type A header, Type B elevation
 * profiles, Type C RMSE accuracy statistics) supporting both fixed 1024-byte records and
 * free-format ASCII DEM files.
 */

export type GroundRefSystemCode = 0 | 1 | 2 | 3 | number;
export type PlanimetricUnitCode = 0 | 1 | 2 | 3 | number;
export type ElevationUnitCode = 1 | 2 | number;
export type DemLevelCode = 1 | 2 | 3 | number;
export type DemFormatKind = "fixed-1024" | "free-format";

export interface DemCorner {
  x: number;
  y: number;
}

export interface DemSpatialResolution {
  dx: number;
  dy: number;
  dz: number;
}

/**
 * USGS DEM Type A logical record (file header).
 */
export interface UsgsDemHeader {
  quadrangleName: string;
  freeFormatText: string;
  processCode: string;
  sectionalIndicator: string;
  originCode: string;
  demLevelCode: DemLevelCode;
  elevationPattern: number;
  groundRefSystem: GroundRefSystemCode;
  groundRefZone: number;
  projectionParams: number[];
  planimetricUnits: PlanimetricUnitCode;
  elevationUnits: ElevationUnitCode;
  polygonSides: number;
  corners: [DemCorner, DemCorner, DemCorner, DemCorner];
  minElevation: number;
  maxElevation: number;
  angleRad: number;
  accuracyCode: number;
  spatialResolution: DemSpatialResolution;
  rows: number;
  cols: number;
  horizontalDatum?: number | undefined;
  verticalDatum?: number | undefined;
  line: number;
  startOffset: number;
  endOffset: number;
}

/**
 * USGS DEM Type B logical record (single elevation profile along a column).
 */
export interface UsgsDemProfile {
  rowIndex: number;
  colIndex: number;
  numRows: number;
  numCols: number;
  xOrigin: number;
  yOrigin: number;
  localDatumElevation: number;
  minElevation: number;
  maxElevation: number;
  rawElevations: number[];
  elevations: number[];
  line: number;
  startOffset: number;
  endOffset: number;
}

/**
 * USGS DEM Type C logical record (RMSE accuracy statistics).
 */
export interface UsgsDemAccuracy {
  availabilityDatum: number;
  rmseDatum: [number, number, number];
  sampleSizeDatum: number;
  availabilityDem: number;
  rmseDem: [number, number, number];
  sampleSizeDem: number;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface UsgsDemSyntaxError {
  message: string;
  line: number;
  column: number;
}

/**
 * Regularized 2D elevation grid extracted from Type B profiles.
 * Stored in row-major order: `z[row * numCols + col]`, where `row = 0` is south (`yOrigin`)
 * and `col = 0` is west (`xOrigin`).
 */
export interface UsgsDemGrid {
  numCols: number;
  numRows: number;
  dx: number;
  dy: number;
  dz: number;
  xOrigin: number;
  yOrigin: number;
  minZ: number;
  maxZ: number;
  voidValue: number;
  z: Float64Array;
}

export interface UsgsDemModel {
  header: UsgsDemHeader;
  profiles: UsgsDemProfile[];
  accuracy?: UsgsDemAccuracy | undefined;
  format: DemFormatKind;
  grid: UsgsDemGrid;
  syntaxErrors: UsgsDemSyntaxError[];
}

export interface UsgsDemDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  endLine?: number | undefined;
  endColumn?: number | undefined;
}
