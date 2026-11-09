// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Types and data models for Telcordia/Bellcore Standard Optical Report (*.sor)
 * OTDR trace files following GR-196-CORE and SR-4731 (Rev 1.0 & Rev 2.0).
 */

export type SorVersion = "1.0" | "2.0";

export type SorEventType = "reflective" | "non-reflective" | "end-of-fiber" | "macro-bend" | "continuous" | "unknown";

export interface SorBlockInfo {
  name: string;
  revision: number;
  size: number;
}

export interface SorGenParams {
  cableId: string;
  fiberId: string;
  fiberType: string;
  nominalWavelengthNm: number;
  originLocation: string;
  terminateLocation: string;
  cableCode: string;
  currentCondition: string;
  operator: string;
  comments: string;
}

export interface SorSupParams {
  supplierName: string;
  otdrName: string;
  otdrSerialNumber: string;
  moduleName: string;
  moduleSerialNumber: string;
  softwareVersion: string;
}

export interface SorFxdParams {
  dateTime: Date;
  distanceUnits: "km" | "mt" | "mi" | "kf";
  actualWavelengthNm: number;
  acquisitionOffset: number;
  pulseWidthNs: number;
  sampleSpacingNs: number;
  numPoints: number;
  refractiveIndex: number;
  backscatterCoefficientDb: number;
  numAverages: number;
  rangeKm: number;
  frontPanelLossDb: number;
}

export interface SorKeyEvent {
  eventNumber: number;
  distanceMeters: number;
  slopeDbPerKm: number;
  eventLossDb: number;
  reflectanceDb: number;
  eventCode: string;
  eventType: SorEventType;
  leadInLossDb: number;
  comments: string;
}

export interface SorDataPoints {
  numPoints: number;
  scalingFactor: number;
  powerDb: Float64Array;
  distanceMeters: Float64Array;
}

export interface SorDocument {
  version: SorVersion;
  blocks: SorBlockInfo[];
  genParams: SorGenParams;
  supParams: SorSupParams;
  fxdParams: SorFxdParams;
  dataPoints: SorDataPoints;
  keyEvents: SorKeyEvent[];
  checksum?: number | undefined;

  /** Compute two-point attenuation (dB) between two distance markers (meters) */
  computeTwoPointLoss(startDistMeters: number, endDistMeters: number): number;
  /** Compute least-squares attenuation (LSA) slope (dB/km) over a linear span */
  computeLsaSlope(startDistMeters: number, endDistMeters: number): number;
  /** Total cumulative span loss from launch to fiber end */
  totalSpanLossDb(): number;
  /** Total fiber length in meters */
  fiberLengthMeters(): number;
}
