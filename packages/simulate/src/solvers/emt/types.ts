// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Types for the WebAssembly / TypeScript Electromagnetic Transient (EMT) Companion Solver.
 */

export interface EmtSolverOptions {
  timeStepSec: number; // e.g. 20e-6 s (20 microseconds)
  durationSec: number; // e.g. 1.0 s
  nominalFrequencyHz?: number; // 50 or 60 Hz
  enableCda?: boolean; // Critical Damping Adjustment for switch chatter
  enableInterpolation?: boolean; // Linear sub-step switching interpolation at zero-crossing
  steadyStateInit?: boolean; // Initialize companion history buffers from AC load-flow phasor solution at t = 0^-
  threePhase?: boolean; // Enable full 3-phase (abc) unbalanced MANA network formulation
  maxNonlinearIterations?: number; // Within-step Newton-Raphson / fixed-point iterations for non-linear elements (default: 1)
  nonlinearToleranceVolts?: number; // Voltage convergence tolerance |v^(m) - v^(m-1)| in Volts (default: 1.0 V)
}

export interface ThreePhaseWaveform {
  a: Float64Array;
  b: Float64Array;
  c: Float64Array;
}

export interface SequenceWaveform {
  v0: Float64Array; // Zero-sequence magnitude (V peak)
  v1: Float64Array; // Positive-sequence magnitude (V peak)
  v2: Float64Array; // Negative-sequence magnitude (V peak)
}

export interface EmtSimulationResult {
  time: Float64Array; // Time points
  busVoltages: Map<string, Float64Array>; // Bus voltages over time (Phase A in 3-phase mode)
  busPhaseVoltages?: Map<string, ThreePhaseWaveform> | undefined; // 3-phase (a, b, c) bus voltages
  sequenceVoltages?: Map<string, SequenceWaveform> | undefined; // Symmetrical component (V0, V1, V2) envelopes
  branchCurrents: Map<string, Float64Array>; // Branch currents over time (Phase A in 3-phase mode)
  branchPhaseCurrents?: Map<string, ThreePhaseWaveform> | undefined; // 3-phase (a, b, c) branch currents
  controlSignals?: Map<string, Float64Array> | undefined; // CSMF control block output trajectories
  metrics: {
    totalSteps: number;
    wallClockTimeMs: number;
    factorizationCount: number;
    subsystemCount?: number | undefined;
    totalNonlinearIterations?: number | undefined;
  };
}

export type FaultKind =
  | "3LG"
  | "ABC"
  | "SLG"
  | "AG"
  | "BG"
  | "CG"
  | "LL"
  | "AB"
  | "BC"
  | "CA"
  | "LLG"
  | "ABG"
  | "BCG"
  | "CAG";

export interface RlcBranchState {
  id: string;
  fromNode: number;
  toNode: number;
  r: number;
  l: number;
  c: number;
  gL: number;
  alphaL: number;
  gC: number;
  gTotal: number;
  iHistL: number;
  iHistC: number;
  current: number;
  hasZeroSeq?: boolean | undefined;
  r0?: number | undefined;
  l0?: number | undefined;
  c0?: number | undefined;
  gL0?: number | undefined;
  alphaL0?: number | undefined;
  gC0?: number | undefined;
  gMutual?: number | undefined;
  iHistL0?: number | undefined;
  iHistC0?: number | undefined;
}

/**
 * 4-terminal coupled transformer winding state supporting arbitrary turns ratio a = N1/N2
 * and 3-phase vector groups (Yg-Yg, Yg-D, D-Yg, D-D).
 * Primary winding between (pPosNode, pNegNode), secondary winding between (sPosNode, sNegNode).
 */
export interface TransformerWindingState {
  id: string;
  phaseIndex: number; // 0 = A, 1 = B, 2 = C
  pPosNode: number;
  pNegNode: number;
  sPosNode: number;
  sNegNode: number;
  turnsRatio: number; // Effective turns ratio a_eff
  gLeakage: number; // Primary-referred companion conductance dt / (2*L + R*dt)
  alphaL: number; // (2*L - R*dt) / (2*L + R*dt)
  iHistPrimary: number; // Companion history current on primary side
  currentPrimary: number;
  currentSecondary: number;
}

/**
 * Circuit breaker pole state with physical current zero-crossing arc extinction.
 */
export interface BreakerPoleState {
  id: string;
  phaseIndex: number; // 0 = A, 1 = B, 2 = C
  fromNode: number;
  toNode: number;
  gClosed: number;
  gOpen: number;
  gCurrent: number;
  isClosed: boolean;
  pendingOpen: boolean;
  /** Set by a status actuator; the pole recloses at the start of the next step. */
  pendingClose?: boolean | undefined;
  openTimeSec: number;
  closeTimeSec: number;
  choppingCurrentAmp: number;
  current: number;
  /** Naturally commutated diode: no external control, switches on own V/I. */
  diode?: boolean | undefined;
  clearedAtSec?: number | undefined;
}

export interface BergeronLineState {
  id: string;
  fromNode: number;
  toNode: number;
  lengthKm: number;
  rTotal: number;
  zc: number; // Characteristic surge impedance sqrt(L/C)
  tauSec: number; // Wave propagation delay
  delaySteps: number; // delay in integer steps floor(tau / dt)
  delayFraction: number; // fractional interpolation weight in [0, 1)
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
