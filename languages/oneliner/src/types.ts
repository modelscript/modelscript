// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ASPEN OneLiner / CAPE Short-Circuit & Relay Coordination Type Definitions.
 *
 * Models sequence networks (Z1, Z0, Z0m mutuals), ANSI 50/51 time-overcurrent curves,
 * ANSI 21 distance zones, and NERC PRC-027 protection coordination data (.olx / .dxt).
 */

export interface ComplexImpedance {
  r: number; // Resistance (p.u. or Ohms)
  x: number; // Reactance (p.u. or Ohms)
}

export type TocCurveFamily =
  | "IEEE_Moderately_Inverse"
  | "IEEE_Very_Inverse"
  | "IEEE_Extremely_Inverse"
  | "US_CO8"
  | "IEC_Standard_Inverse";

export interface OneLinerBus {
  id: string;
  name: string;
  baseKv: number;
  area?: number | undefined;
  zone?: number | undefined;
}

export interface OneLinerBranch {
  id: string;
  bus1: string;
  bus2: string;
  circuitId?: string | undefined;
  z1: ComplexImpedance; // Positive-sequence impedance
  z0: ComplexImpedance; // Zero-sequence impedance
  b1?: number | undefined; // Positive-sequence total line charging (p.u.)
  b0?: number | undefined; // Zero-sequence total line charging (p.u.)
  ratingMva?: number | undefined;
  lengthMiles?: number | undefined;
}

export interface OneLinerMutual {
  branch1Id: string;
  branch2Id: string;
  z0m: ComplexImpedance; // Zero-sequence mutual impedance
}

export interface OneLinerGenerator {
  id: string;
  busId: string;
  mvaRating: number;
  z1Subtransient: ComplexImpedance; // X"d + jR
  z0: ComplexImpedance; // Zero-sequence generator impedance
}

export interface OneLinerOvercurrentRelay {
  id: string;
  name: string;
  branchId: string;
  busId: string;
  pickupA: number; // Primary current pickup
  ctRatio: number; // Current Transformer ratio (e.g. 240 for 1200:5)
  timeDial: number; // Time Dial setting (TD)
  curve: TocCurveFamily;
  instantaneousPickupA?: number | undefined; // ANSI 50 high-set
}

export interface OneLinerDistanceRelay {
  id: string;
  name: string;
  branchId: string;
  busId: string;
  zone1ReachOhms: number; // Primary or secondary ohms
  zone2ReachOhms: number;
  zone2DelaySec: number;
  zone3ReachOhms?: number | undefined;
  zone3DelaySec?: number | undefined;
}

export interface OneLinerCase {
  title: string;
  baseMva: number; // Default 100 MVA
  frequencyHz: number; // 50 or 60 Hz
  busses: OneLinerBus[];
  branches: OneLinerBranch[];
  mutuals: OneLinerMutual[];
  generators: OneLinerGenerator[];
  overcurrentRelays: OneLinerOvercurrentRelay[];
  distanceRelays: OneLinerDistanceRelay[];
}
