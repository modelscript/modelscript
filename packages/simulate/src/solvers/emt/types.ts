// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Types for the WebAssembly / TypeScript Electromagnetic Transient (EMT) Companion Solver.
 */

export interface EmtSolverOptions {
  timeStepSec: number; // e.g. 20e-6 s (20 microseconds)
  durationSec: number; // e.g. 1.0 s
  nominalFrequencyHz?: number | undefined; // 50 or 60 Hz
  enableCda?: boolean | undefined; // Critical Damping Adjustment for switch chatter
}

export interface EmtSimulationResult {
  time: Float64Array; // Time points
  busVoltages: Map<string, Float64Array>; // Bus voltages over time
  branchCurrents: Map<string, Float64Array>; // Branch currents over time
  metrics: {
    totalSteps: number;
    wallClockTimeMs: number;
    factorizationCount: number;
  };
}

export interface RlcBranchState {
  id: string;
  fromNode: number;
  toNode: number;
  r: number;
  l: number;
  c: number;
  gL: number;
  gC: number;
  gTotal: number;
  iHistL: number;
  iHistC: number;
  current: number;
}

export interface BergeronLineState {
  id: string;
  fromNode: number;
  toNode: number;
  lengthKm: number;
  rTotal: number;
  zc: number; // Characteristic surge impedance sqrt(L/C)
  tauSec: number; // Wave propagation delay
  delaySteps: number; // delay in integer steps tau / dt
  bufferFrom: Float64Array; // Circular history buffer for sending end
  bufferTo: Float64Array; // Circular history buffer for receiving end
  bufferIdx: number;
  gc: number; // 1 / Zc
}

export interface FmuIbrState {
  id: string;
  node: number;
  ratedMva: number;
  ratedKv: number;
  gEq: number; // Equivalent high-frequency Norton conductance for interface stability
  iInjected: number;
  pSetpointMw: number;
  qSetpointMvar: number;
  // Internal control state for white-box emulation or FMI wrapper
  pllAngle: number;
  iReal: number;
  iImag: number;
}
