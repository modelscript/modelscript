// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OGC WaterML 2.0 (OGC 12-031r4 / WMO No. 1083) & TimeseriesML Type Definitions.
 */

export type WaterQualityCode = "good" | "suspect" | "estimate" | "missing" | "unchecked";

export type WaterInterpolationType = "Instantaneous" | "Continuous" | "Discontinuous" | "Average" | "Total";

export interface WaterObservation {
  time: Date;
  value: number;
  quality: WaterQualityCode;
  censoredReason?: string | undefined;
  comment?: string | undefined;
}

export interface MonitoringPoint {
  stationId: string;
  stationName: string;
  latitude?: number | undefined;
  longitude?: number | undefined;
  elevationM?: number | undefined;
  waterBodyName?: string | undefined;
  organization?: string | undefined;
}

export interface WaterTimeSeries {
  seriesId: string;
  seriesName?: string | undefined;
  observedProperty: string; // e.g. "Discharge", "Stage", "WaterLevel", "Precipitation"
  unit: string; // e.g. "m3/s", "cfs", "m", "ft", "mm"
  interpolationType: WaterInterpolationType;
  monitoringPoint: MonitoringPoint;
  points: WaterObservation[];
}

export interface WaterMlDocument {
  id: string;
  title?: string | undefined;
  generationDate: Date;
  timeSeriesList: WaterTimeSeries[];
}

export interface RatingCurveEquation {
  a: number; // multiplier
  h0: number; // gauge datum / zero-flow stage (m or ft)
  b: number; // exponent (typically 1.5 - 2.5)
}

export interface RatingCurve {
  curveId: string;
  stationId: string;
  equation?: RatingCurveEquation | undefined;
  tablePoints?: Array<{ stageM: number; dischargeM3S: number }> | undefined;
}
