// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Types and interfaces for Radio Access Networks (RAN),
 * antenna radiation patterns, and microwave link modeling.
 */

export type AntennaPolarization = "V" | "H" | "Dual" | "Circular" | "Cross-Pol";

export interface AntennaPatternPoint {
  angleDeg: number;
  attenuationDb: number; // attenuation relative to main lobe peak (>= 0 dB)
}

export interface AntennaCut {
  cutType: "horizontal" | "vertical";
  points: AntennaPatternPoint[];
}

export interface AntennaPatternDeck {
  name: string;
  description: string;
  manufacturer: string;
  model: string;
  peakGainDbi: number;
  frequencyRangeMhz: [number, number];
  nominalFrequencyMhz?: number | undefined;
  polarization: AntennaPolarization;
  electricalDowntiltDeg: number;
  mechanicalTiltDeg: number;
  horizontalCut?: AntennaCut | undefined;
  verticalCut?: AntennaCut | undefined;
  frontToBackRatioDb?: number | undefined;
  horizontalBeamwidthDeg?: number | undefined;
  verticalBeamwidthDeg?: number | undefined;
}

export interface MicrowaveLink {
  id: string;
  txSiteName: string;
  rxSiteName: string;
  frequencyGhz: number;
  pathLengthKm: number;
  txPowerDbm: number;
  txAntennaGainDbi: number;
  rxAntennaGainDbi: number;
  txFeederLossDb: number;
  rxFeederLossDb: number;
  requiredMarginDb: number;
  polarization: "V" | "H";
}
