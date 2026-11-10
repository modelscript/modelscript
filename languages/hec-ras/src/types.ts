// SPDX-License-Identifier: AGPL-3.0-or-later

export interface StationElevation {
  station: number;
  elevation: number;
}

export interface ReachLengths {
  leftOverbank: number;
  channel: number;
  rightOverbank: number;
}

export interface ManningValues {
  leftOverbank: number;
  channel: number;
  rightOverbank: number;
}

export interface BankStations {
  left: number;
  right: number;
}

export interface HecRasCrossSection {
  river: string;
  reach: string;
  station: number;
  description?: string | undefined;
  stationElevations: StationElevation[];
  reachLengths: ReachLengths;
  manning: ManningValues;
  bankStations: BankStations;
  contractionCoefficient: number;
  expansionCoefficient: number;
  line: number;
}

export interface HecRasReach {
  river: string;
  reach: string;
  coords: { x: number; y: number }[];
  line: number;
}

export interface HecRasInlineStructure {
  river: string;
  reach: string;
  station: number;
  weirCrestElevation: number;
  weirLength: number;
  dischargeCoefficient: number;
  line: number;
}

export interface HecRasGeometry {
  title?: string | undefined;
  version?: string | undefined;
  reaches: HecRasReach[];
  crossSections: HecRasCrossSection[];
  inlineStructures: HecRasInlineStructure[];
}

export type BoundaryType =
  | "Flow Hydrograph"
  | "Stage Hydrograph"
  | "Normal Depth"
  | "Rating Curve"
  | "Known WS";

export interface HydrographPoint {
  timeHours: number;
  flowOrStage: number;
}

export interface BoundaryCondition {
  river: string;
  reach: string;
  station: number;
  type: BoundaryType;
  frictionSlope?: number | undefined;
  knownStage?: number | undefined;
  hydrograph?: HydrographPoint[] | undefined;
  line: number;
}

export interface HecRasFlow {
  title?: string | undefined;
  boundaryConditions: BoundaryCondition[];
}

export interface HecRasProfileResult {
  river: string;
  reach: string;
  station: number;
  waterSurfaceElevation: number;
  energyGradeLine: number;
  velocity: number;
  froudeNumber: number;
  flowArea: number;
  hydraulicRadius: number;
  frictionSlope: number;
}
