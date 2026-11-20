// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — Generic Polyglot Phasor <-> EMT Co-Simulation Contracts
 *
 * Domain-agnostic interfaces allowing ANY phasor/RMS network solver
 * (PSS/E, PSLF, PowerFactory, OpenDSS, CGMES, or `fmi-ls-rms` FMU)
 * to couple in lock-step with ANY 3-phase EMT solver
 * (PSCAD, ATP, SPICE, Modelica EMT, or `fmi-ls-emt` FMU).
 */

/** Complex phasor value in rectangular coordinates (real + j * imag). */
export interface ComplexPhasor {
  re: number;
  im: number;
}

/**
 * Symmetrical-component sequence phasors (positive, negative, zero) in per-unit.
 */
export interface SequencePhasors {
  /** Positive-sequence phasor (required). */
  pos: ComplexPhasor;
  /** Negative-sequence phasor (optional; 0 for balanced 1-sequence coupling). */
  neg?: ComplexPhasor | undefined;
  /** Zero-sequence phasor (optional; 0 for balanced 1-sequence coupling). */
  zero?: ComplexPhasor | undefined;
}

/**
 * Instantaneous 3-phase electrical quantity (Volts or Amperes).
 */
export interface ThreePhaseValues {
  a: number;
  b: number;
  c: number;
}

/**
 * Multi-port boundary admittance / Thévenin equivalent computed from the
 * external phasor network (Kron reduction at boundary buses).
 */
export interface MultiPortBoundaryEquivalent {
  /** Ordered boundary bus identifiers matching the matrix rows/columns. */
  busIds: string[];
  /**
   * Positive-sequence reduced nodal admittance matrix Y_eq1 (pu on system MVA base),
   * flattened row-major of length `n * n` with `{ re, im }` entries.
   */
  yEqPos: ComplexPhasor[];
  /** Optional negative-sequence reduced admittance matrix Y_eq2 (pu, flattened row-major). */
  yEqNeg?: ComplexPhasor[] | undefined;
  /** Optional zero-sequence reduced admittance matrix Y_eq0 (pu, flattened row-major). */
  yEqZero?: ComplexPhasor[] | undefined;
  /** Per-bus base line-to-line voltage in kV. */
  baseKvLL: number[];
  /** System base power in MVA. */
  baseMva: number;
  /** Monotonic revision counter incremented whenever network topology (e.g. fault/line trip) changes. */
  topologyVersion: number;
}

/**
 * Boundary current injection from EMT plant(s) into a phasor network bus.
 */
export interface PhasorBoundaryInjection {
  /** Bus identifier in the phasor network (e.g. "3" for PSS/E bus 3). */
  busId: string;
  /** Complex sequence current injection in per-unit (into the phasor network). */
  currentPu: SequencePhasors;
  /** Optional simultaneous Norton admittance stamp (G_eq + j B_eq in pu). */
  nortonAdmittancePu?: ComplexPhasor | undefined;
}

/**
 * Solved phasor network boundary bus voltage after a macro-step.
 */
export interface PhasorBoundaryBusVoltage {
  busId: string;
  /** Positive-sequence magnitude in pu. */
  vmPu: number;
  /** Positive-sequence phase angle in radians. */
  vaRad: number;
  /** Full sequence voltage phasors in pu. */
  voltagePu: SequencePhasors;
  /** Nominal base line-to-line voltage in kV. */
  baseKvLL: number;
  /** Optional instantaneous local/COI electrical frequency in Hz for frequency-adaptive DFT. */
  freqHz?: number | undefined;
}

/**
 * Result returned by `PhasorNetworkParticipant.initialize()`.
 */
export interface PhasorInitResult {
  /** Initial steady-state boundary bus voltages from solved power flow. */
  boundaryVoltages: Map<string, PhasorBoundaryBusVoltage>;
  /** Initial multi-port boundary equivalent from Y_bus. */
  boundaryEquivalent: MultiPortBoundaryEquivalent;
  /** Fundamental frequency in Hz. */
  frequencyHz: number;
  /** System MVA base. */
  baseMva: number;
  /** Whether power flow converged at t=0. */
  convergedPowerFlow: boolean;
}

/**
 * Result returned by `PhasorNetworkParticipant.stepMacro()`.
 */
export interface PhasorMacroStepResult {
  timeSec: number;
  boundaryVoltages: Map<string, PhasorBoundaryBusVoltage>;
  /** Set if network topology changed (fault inception/clearing, line trip) during this step. */
  boundaryEquivalent?: MultiPortBoundaryEquivalent | undefined;
  topologyChanged: boolean;
}

/**
 * Final trajectory summary returned by `PhasorNetworkParticipant.finalize()`.
 */
export interface PhasorTrajectoryResult {
  t: number[];
  states: string[];
  y: number[][];
  summary: {
    convergedPowerFlow: boolean;
    stable: boolean;
    maxRotorAngleSpreadDeg: number;
  };
}

/**
 * Step-wise Phasor / RMS network participant contract.
 * Implemented natively by PSS/E (and future PSLF/PowerFactory/OpenDSS) or via FMI 3.0 (`fmi-ls-rms`).
 */
export interface PhasorNetworkParticipant {
  readonly id: string;
  readonly language: string;

  initialize(options: {
    durationSec: number;
    dtMacroSec: number;
    boundaryBusIds: string[];
    sequences?: 1 | 3 | undefined;
    fault?:
      | {
          busId: string;
          startSec: number;
          clearSec: number;
          susceptancePu?: number | undefined;
          faultType?: "3ph" | "slg" | "ll" | "llg" | undefined;
        }
      | undefined;
  }): Promise<PhasorInitResult> | PhasorInitResult;

  stepMacro(
    tSec: number,
    dtSec: number,
    injections: PhasorBoundaryInjection[],
  ): Promise<PhasorMacroStepResult> | PhasorMacroStepResult;

  computeBoundaryEquivalent(boundaryBusIds: string[]): MultiPortBoundaryEquivalent;

  /**
   * Optional multi-frequency Kron-reduced admittance scan Y_eq(j * 2 * pi * f) (in Siemens)
   * at a boundary bus for true multi-bus FDNE Vector Fitting.
   */
  scanBoundaryAdmittance?(busId: string, freqGridHz: number[]): Array<{ freqHz: number; ySiemens: ComplexPhasor }>;

  /** Optional state snapshot for macro-step Picard/waveform-relaxation rollback. */
  getState?(): unknown | Promise<unknown>;
  setState?(snapshot: unknown): void | Promise<void>;

  finalize(): Promise<PhasorTrajectoryResult> | PhasorTrajectoryResult;
}

/**
 * 3-phase Thévenin / Norton boundary feed delivered to an EMT plant for a macro-step.
 */
export interface EmtBoundaryFeedSpec {
  /** Bus identifier inside the local EMT sub-network. */
  busId: string;
  /**
   * Optional fitted FDNE rational model (`FdneRationalModel`) for per-micro-step
   * recursive-convolution Dommel stamping inside the EMT solver.
   */
  fdneModel?: import("./fdne-fitter.js").FdneRationalModel | undefined;
  /**
   * Evaluates the instantaneous 3-phase open-circuit Thévenin voltage source (Volts)
   * and 3x3 symmetric Thévenin conductance matrix (Siemens, flattened row-major 9 entries)
   * at micro-step time `t`.
   */
  evaluateThevenin: (tSec: number) => {
    ea: number;
    eb: number;
    ec: number;
    /** Scalar conductance (S) used if `gMatrix3x3` is omitted. */
    gSrc: number;
    /** Optional full 3x3 phase conductance matrix (S, row-major length 9) for 3-sequence / coupled equivalents. */
    gMatrix3x3?: Float64Array | number[] | undefined;
    /** Optional off-diagonal multi-port mutual conductance blocks to peer boundary buses in the same EMT plant. */
    mutualCouplings?: Array<{ peerBusId: string; gMatrix3x3: Float64Array | number[] }> | undefined;
    /** Optional FDNE or additional Norton history current (Amperes) injected into phases a, b, c. */
    iHistA?: number | undefined;
    iHistB?: number | undefined;
    iHistC?: number | undefined;
  };
}

/**
 * Sub-step sampling result returned by `EmtNetworkParticipant.stepSubSteps()`.
 */
export interface EmtSubStepResult {
  /** End time of the completed macro-step interval (seconds). */
  timeSec: number;
  /** Number of EMT micro-steps executed. */
  stepsExecuted: number;
  /** Per-boundary-bus instantaneous 3-phase currents injected INTO the phasor network (Amperes) over the macro-step. */
  boundaryCurrents: Map<string, { ia: number[]; ib: number[]; ic: number[] }>;
  /** Per-boundary-bus instantaneous 3-phase voltages at the EMT boundary bus (Volts) over the macro-step. */
  boundaryVoltages: Map<string, { va: number[]; vb: number[]; vc: number[] }>;
}

/**
 * Final EMT trajectory returned by `EmtNetworkParticipant.finalize()`.
 */
export interface EmtTrajectoryResult {
  time: Float64Array;
  busPhaseVoltages: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>;
  controlSignals?: Map<string, Float64Array> | undefined;
}

/**
 * Step-wise 3-phase EMT network participant contract.
 * Implemented natively by PSCAD `EmtSolver` (and future ATP/SPICE/Modelica) or via FMI 3.0 (`fmi-ls-emt`).
 */
export interface EmtNetworkParticipant {
  readonly id: string;
  readonly language: string;

  initialize(options: {
    durationSec: number;
    dtEmtSec: number;
    frequencyHz: number;
    boundaryBusIds: string[];
    initialBoundaryVoltages?: Map<string, PhasorBoundaryBusVoltage> | undefined;
    initialFeeds?: EmtBoundaryFeedSpec[] | undefined;
  }): Promise<void> | void;

  stepSubSteps(
    tStartSec: number,
    dtEmtSec: number,
    nSubSteps: number,
    feeds: EmtBoundaryFeedSpec[],
    topologyChanged?: boolean,
  ): Promise<EmtSubStepResult> | EmtSubStepResult;

  /** Optional state snapshot for macro-step Picard/waveform-relaxation rollback. */
  getState?(): unknown | Promise<unknown>;
  setState?(snapshot: unknown): void | Promise<void>;

  finalize(): Promise<EmtTrajectoryResult> | EmtTrajectoryResult;
}

/**
 * Mapping between a bus in the bulk Phasor network and a bus in an EMT plant.
 */
export interface PhasorEmtBoundaryPort {
  /** Bus ID in the bulk Phasor network (e.g. "3" for PSS/E Bus 3). */
  phasorBusId: string;
  /** Bus ID in the local EMT sub-network (e.g. "Bus3"). */
  emtBusId: string;
  /** Nominal line-to-line base voltage in kV (overrides phasor case baseKv if set). */
  baseKvLL?: number | undefined;
  /** Base power in MVA (default: phasor system baseMva or 100 MVA). */
  baseMva?: number | undefined;
  /** Fallback scalar Thévenin source conductance in Siemens when Y_eq is not provided (default: 20.0 S). */
  theveninConductanceSiemens?: number | undefined;
}
