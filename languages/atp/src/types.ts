// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Alternative Transients Program (ATP-EMTP) Type Definitions.
 *
 * Supports electromagnetic transient simulation cards for RLC branches,
 * distributed parameter transmission lines, time-controlled switches, and AC sources.
 */

export type AtpBranchType = "RLC" | "Line" | "Switch" | "Transformer";

export interface AtpBranch {
  node1: string;
  node2: string;
  rOhms: number;
  lMh: number; // Inductance in millihenries
  cUf: number; // Capacitance in microfarads
  lengthKm?: number | undefined;
  surgeZOhms?: number | undefined;
  propSpeedKmSec?: number | undefined;
  comment?: string | undefined;
}

export interface AtpSwitch {
  node1: string;
  node2: string;
  tCloseSec: number;
  tOpenSec: number;
  iMargin?: number | undefined;
  comment?: string | undefined;
}

export interface AtpSource {
  node: string;
  typeCode: number; // 14 for standard cosinusoidal AC, 11 for ramp, 1 for DC
  amplitude: number; // Peak voltage (V) or current (A)
  frequencyHz: number;
  phaseDeg: number;
  t0Sec?: number | undefined;
  tStopSec?: number | undefined;
  comment?: string | undefined;
}

export interface AtpSimulationControl {
  deltaTSec: number; // Time step (s), typically 1e-6 to 1e-4
  tMaxSec: number; // End time (s)
  xOpt?: number | undefined;
  cOpt?: number | undefined;
}

export interface AtpCase {
  title: string;
  control: AtpSimulationControl;
  branches: AtpBranch[];
  switches: AtpSwitch[];
  sources: AtpSource[];
  outputNodes: string[];
}
