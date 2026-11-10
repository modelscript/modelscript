// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE C37.111 / IEC 60255-24 COMTRADE (Common format for Transient Data Exchange) Types.
 */

export interface ComtradeAnalogChannel {
  index: number;
  name: string;
  phase: string; // e.g. "A", "B", "C", or ""
  circuitComponent?: string | undefined;
  unit: string; // e.g. "kV", "V", "A", "kA"
  multiplierA: number;
  offsetB: number;
  skew: number;
  min: number;
  max: number;
  primaryRatio: number;
  secondaryRatio: number;
  scalingIdentifier: "P" | "S"; // Primary or Secondary

  // Convenience aliases for IEEE C37.111 short form
  chId?: string | undefined;
  uu?: string | undefined;
  a?: number | undefined;
  b?: number | undefined;
  minVal?: number | undefined;
  maxVal?: number | undefined;
  primary?: number | undefined;
  secondary?: number | undefined;
  scaling?: "P" | "S" | undefined;
  ccbm?: string | undefined;
}

export interface ComtradeDigitalChannel {
  index: number;
  name: string;
  phase?: string | undefined;
  circuitComponent?: string | undefined;
  normalState: 0 | 1;

  // Convenience aliases
  chId?: string | undefined;
  ccbm?: string | undefined;
}

export interface ComtradeSamplingRate {
  rateHz?: number | undefined;
  rate: number;
  lastSampleNumber: number;
}

export type ComtradeDataFormat = "ASCII" | "BINARY" | "BINARY32" | "FLOAT32";

export interface ComtradeConfig {
  stationName: string;
  recordingDeviceId: string;
  standardVersionYear: 1991 | 1999 | 2013;
  analogChannels: ComtradeAnalogChannel[];
  digitalChannels: ComtradeDigitalChannel[];
  lineFrequencyHz: number;
  samplingRates: ComtradeSamplingRate[];
  startTime: Date | string;
  triggerTime: Date | string;
  dataFormat: ComtradeDataFormat;
  timeMultiplicationFactor: number; // typically 1.0 (microseconds)
  timeCode?: string | undefined;
  localCode?: string | undefined;
  timeQualityIndicatorCode?: string | undefined;
  leapSecIndicator?: number | undefined;

  // Convenience aliases
  recDevId?: string | undefined;
  revYear?: number | undefined;
  totalChannels?: number | undefined;
  analogCount?: number | undefined;
  digitalCount?: number | undefined;
  nominalFrequency?: number | undefined;
  sampleRateCount?: number | undefined;
  sampleRates?: ComtradeSamplingRate[] | undefined;
  analogs: ComtradeAnalogChannel[];
  digitals: ComtradeDigitalChannel[];
  fileType?: ComtradeDataFormat | string | undefined;
  timeMult?: number | undefined;
}

export interface ComtradeRecord {
  config?: ComtradeConfig | undefined;
  timeSec?: Float64Array | undefined;
  analogData: Map<string, Float64Array> | number[][];
  digitalData: Map<string, Uint8Array> | number[][];
  infoText?: string | undefined;

  // Convenience aliases
  cfg?: ComtradeConfig | undefined;
  timestamps?: number[] | Float64Array | undefined;
}

export interface ComtradePhasorPoint {
  timeSec: number;
  magnitudeRms: number;
  phaseDeg: number;

  // Convenience alias
  time?: number | undefined;
}

export interface ComtradePhasorResult {
  channelName: string;
  nominalFreqHz: number;
  phasors: ComtradePhasorPoint[];
}
