// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core types and data models for optical transport networks,
 * compatible with OpenROADM MSA and TIP GNPy specifications.
 */

export type OpticalNodeType = "rdm" | "ila" | "terminal" | "transponder" | "fused";

export type ModulationFormat = "PM-BPSK" | "PM-QPSK" | "PM-8QAM" | "PM-16QAM" | "PM-32QAM" | "PM-64QAM";

export interface OpticalPort {
  id: string;
  name: string;
  portType: "line" | "client" | "add-drop";
  direction: "tx" | "rx" | "bidirectional";
}

export interface OpticalDegree {
  degreeNumber: number;
  maxWavelengths: number;
  circuitPackName?: string | undefined;
}

export interface OpticalSrg {
  srgNumber: number;
  maxAddDropWavelengths: number;
  isColorless: boolean;
  isDirectionless: boolean;
  isContentionless: boolean;
}

export interface OpticalNode {
  id: string;
  name: string;
  nodeType: OpticalNodeType;
  degrees: OpticalDegree[];
  srgs: OpticalSrg[];
  ports: OpticalPort[];
  latitude?: number | undefined;
  longitude?: number | undefined;
}

export interface OpticalAmplifier {
  id: string;
  ampType: "edfa" | "raman" | "hybrid";
  gainDb: number;
  noiseFigureDb: number;
  maxOutputPowerDbm: number;
  tiltDb?: number | undefined;
}

export interface OpticalSpan {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  lengthKm: number;
  fiberType: "SSMF" | "NZDSF" | "PSCF" | "LEAF" | "custom";
  attenuationDbPerKm: number; // e.g. 0.20 dB/km at 1550nm
  dispersionPsPerNmKm: number; // e.g. 16.7 ps/(nm*km)
  pmdPsPerSqrtKm: number; // e.g. 0.04 ps/sqrt(km)
  nonLinearCoeffPerWKm: number; // Gamma, e.g. 1.3 1/(W*km)
  amplifiers: OpticalAmplifier[];
  conduitId?: string | undefined;
  srlgIds?: string[] | undefined;
}

export interface OpticalChannel {
  id: string;
  sourceNodeId: string;
  destinationNodeId: string;
  centerFrequencyThz: number; // e.g. 193.1 THz (1552.52 nm)
  baudRateGbaud: number; // e.g. 64 or 96 GBaud
  modulation: ModulationFormat;
  launchPowerDbm: number; // e.g. 0.0 dBm (1 mW)
  requiredOsnrDb: number; // e.g. 15.0 dB for 16-QAM
  pathSpanIds: string[];
}

export interface OpticalTopology {
  name: string;
  nodes: Map<string, OpticalNode>;
  spans: Map<string, OpticalSpan>;
  channels: Map<string, OpticalChannel>;

  addNode(node: OpticalNode): void;
  addSpan(span: OpticalSpan): void;
  addChannel(channel: OpticalChannel): void;
  getNode(id: string): OpticalNode | undefined;
  getSpan(id: string): OpticalSpan | undefined;
}
