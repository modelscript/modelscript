// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE P3743 Electromagnetic Transient (EMT) Data & Vendor Model Encapsulation Types.
 *
 * Provides a vendor-neutral interchange schema for:
 * - Multi-phase EMT network buses, branches, and wideband line corridors
 * - Parallel-corridor mutual electromagnetic coupling matrices
 * - IP-protected black-box vendor models (CIGRE TB 881 / IEEE P2800.2, FMU, DLL, WASM)
 * - Short-circuit boundary equivalents (from ASPEN OneLiner / .seq)
 */

import type { CigreModelInfo, CigreModelInitParams } from "../firmware/cigre-tb881-abi.js";

export type P3743VendorPayloadKind = "cigre-tb881-wasm" | "cigre-tb881-dll" | "fmu-2.0" | "fmu-3.0";

export interface P3743Metadata {
  schemaVersion: "IEEE-P3743-draft-1.0";
  caseId: string;
  title: string;
  nominalFrequencyHz: 50 | 60;
  baseMva: number;
  createdAtIso: string;
  author?: string | undefined;
  utilityOrRto?: string | undefined;
}

export interface P3743Bus {
  id: string;
  busNumber?: number | undefined;
  name: string;
  baseKvLL: number;
  phases: ("A" | "B" | "C")[];
  isPoi?: boolean | undefined;
}

export interface P3743MutualCouplingEntry {
  corridorA: string;
  corridorB: string;
  /** Frequency points in Hz where mutual impedance Z_m(f) is tabulated. */
  frequenciesHz: number[];
  /** Mutual resistance R_m(f) in Ohm/km corresponding to frequenciesHz. */
  rMutualOhmPerKm: number[];
  /** Mutual inductance L_m(f) in H/km corresponding to frequenciesHz. */
  lMutualHPerKm: number[];
  /** Mutual capacitance C_m in F/km (optional). */
  cMutualFPerKm?: number | undefined;
  couplingLengthKm: number;
}

export interface P3743Corridor {
  id: string;
  fromBusId: string;
  toBusId: string;
  lengthKm: number;
  soilModel:
    | { kind: "homogeneous"; rhoOhmM: number }
    | { kind: "two-layer"; upperRhoOhmM: number; lowerRhoOhmM: number; upperDepthM: number };
  mutualCouplings?: P3743MutualCouplingEntry[] | undefined;
}

export interface P3743VendorModelEncapsulation {
  id: string;
  busId: string;
  payloadKind: P3743VendorPayloadKind;
  modelInfo: CigreModelInfo;
  initParams: CigreModelInitParams;
  /** Base64-encoded binary payload (WASM, DLL, or FMU archive) or external URI. */
  payloadBase64?: string | undefined;
  payloadUri?: string | undefined;
  /** Lowercase hex SHA-256 digest of the raw binary payload for IP & integrity verification. */
  sha256: string;
  /** Exposed terminal parameter names (non-IP operational settings). */
  publicParameters?: Record<string, number> | undefined;
}

export interface P3743BoundaryEquivalent {
  busId: string;
  shortCircuitMva: number;
  xOverRRatio: number;
  z1Ohm: { r: number; x: number };
  z0Ohm: { r: number; x: number };
  sourceTool?: "aspen-oneliner" | "psse-seq" | "pscad" | undefined;
}

export interface P3743Package {
  metadata: P3743Metadata;
  buses: P3743Bus[];
  corridors: P3743Corridor[];
  vendorModels: P3743VendorModelEncapsulation[];
  boundaryEquivalents: P3743BoundaryEquivalent[];
}

export interface P3743ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
