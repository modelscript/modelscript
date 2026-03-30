// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Co-simulation participant interface.
 *
 * Defines the contract that all participant types (JS-native, FMU-JS, FMU-native, external)
 * must implement to participate in a co-simulation session.
 */

import type { CosimValue } from "./coupling.js";
import type { ParticipantMetadata } from "./mqtt/protocol.js";

/**
 * Base interface for a co-simulation participant.
 *
 * Each participant wraps a simulation model (Modelica JS simulator, FMU, or external device)
 * and exposes FMI-2.0-style methods for initialization, stepping, and variable exchange.
 */
export interface CoSimParticipant {
  /** Unique participant identifier. */
  readonly id: string;

  /** Model name. */
  readonly modelName: string;

  /** Modelica-compatible metadata for this participant. */
  readonly metadata: ParticipantMetadata;

  /**
   * Initialize the participant for a simulation run.
   *
   * @param startTime  Simulation start time
   * @param stopTime   Simulation stop time
   * @param stepSize   Communication step size
   */
  initialize(startTime: number, stopTime: number, stepSize: number): Promise<void>;

  /**
   * Advance the simulation by one communication step.
   *
   * @param currentTime  Current simulation time
   * @param stepSize     Step size to advance
   */
  doStep(currentTime: number, stepSize: number): Promise<void>;

  /**
   * Get current output variable values.
   * Called after doStep() to read results.
   */
  getOutputs(): Promise<Map<string, CosimValue>>;

  /**
   * Set input variable values before the next step.
   * Called before doStep() to provide coupled values.
   */
  setInputs(values: Map<string, CosimValue>): Promise<void>;

  /**
   * Terminate the participant and release resources.
   */
  terminate(): Promise<void>;

  // ── Optional: FMU state save/restore (for advanced master algorithms) ──

  /** Whether this participant supports state save/restore. */
  readonly canGetAndSetState?: boolean;

  /**
   * Save a snapshot of the current FMU state.
   * @returns An opaque state handle.
   */
  getState?(): Promise<unknown>;

  /**
   * Restore a previously saved FMU state.
   * @param state The opaque state handle from getState().
   */
  setState?(state: unknown): Promise<void>;

  /**
   * Free a previously saved FMU state.
   * @param state The opaque state handle to free.
   */
  freeState?(state: unknown): Promise<void>;

  // ── Optional: Tunable parameters ──

  /**
   * Modify tunable parameters between communication steps.
   * FMI 2.0 allows setting variables with variability="tunable" between steps.
   * @param values Map of parameter name → new value.
   */
  setParameters?(values: Map<string, CosimValue>): Promise<void>;

  /**
   * Cancel an in-progress asynchronous step.
   * For FMUs whose fmi2DoStep returns fmi2Pending.
   */
  cancelStep?(): Promise<void>;

  // ── Optional: Directional derivatives (for implicit master algorithms) ──

  /** Whether this participant can provide directional derivatives. */
  readonly providesDirectionalDerivatives?: boolean;

  /**
   * Compute directional derivatives: dv_unknown = (∂unknown/∂known) · dv_known.
   *
   * @param unknownRefs  Value references of the unknown variables (e.g., outputs).
   * @param knownRefs    Value references of the known variables (e.g., inputs).
   * @param dvKnown      Seed vector (perturbation of known variables).
   * @returns The resulting directional derivative vector (one entry per unknown).
   */
  getDirectionalDerivative?(unknownRefs: number[], knownRefs: number[], dvKnown: number[]): Promise<number[]>;
}
