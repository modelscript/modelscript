// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plscadd — Core Types for PLS-CADD Overhead Line Models.
 */

export interface PlsStructure {
  id: string;
  stationM: number;
  x: number;
  y: number;
  zBaseM: number;
  heightM: number;
  phaseSpacingM: number;
}

export interface PlsConductor {
  name: string;
  weightNPerM: number;
  rOhmPerKm: number;
  gmrM: number;
  ratedTensionN: number;
}

export interface PlsSpan {
  id: string;
  fromStructure: string;
  toStructure: string;
  conductor: string;
  tensionN: number;
  minClearanceM: number;
}

export interface PlsTerrainPoint {
  x: number;
  y: number;
  z: number;
  featureCode?: string | undefined;
}

export interface PlsCaddModel {
  lineName: string;
  voltageKv: number;
  frequencyHz: number;
  structures: PlsStructure[];
  structureById: Map<string, PlsStructure>;
  conductors: PlsConductor[];
  conductorByName: Map<string, PlsConductor>;
  spans: PlsSpan[];
  terrainPoints: PlsTerrainPoint[];
}

export interface PlsDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  elementId?: string | undefined;
}
