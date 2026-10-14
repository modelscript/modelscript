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
}

export interface ComtradeDigitalChannel {
  index: number;
  name: string;
  phase?: string | undefined;
  circuitComponent?: string | undefined;
  normalState: 0 | 1;
}

export interface ComtradeSamplingRate {
  rateHz: number;
  lastSampleNumber: number;
}

export interface ComtradeConfig {
  stationName: string;
  recordingDeviceId: string;
  standardVersionYear: 1991 | 1999 | 2013;
  analogChannels: ComtradeAnalogChannel[];
  digitalChannels: ComtradeDigitalChannel[];
  lineFrequencyHz: number;
  samplingRates: ComtradeSamplingRate[];
  startTime: Date;
  triggerTime: Date;
  dataFormat: "ASCII" | "BINARY" | "FLOAT32";
  timeMultiplicationFactor: number; // typically 1.0 (microseconds)
}

export interface ComtradeRecord {
  config: ComtradeConfig;
  timeSec: Float64Array;
  analogData: Map<string, Float64Array>;
  digitalData: Map<string, Uint8Array>;
}
