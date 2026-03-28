// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Co-simulation participant interface.
 *
 * Defines the contract that all participant types (JS-native, FMU-JS, FMU-native, external)
 * must implement to participate in a co-simulation session.
 */

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
  getOutputs(): Promise<Map<string, number>>;

  /**
   * Set input variable values before the next step.
   * Called before doStep() to provide coupled values.
   */
  setInputs(values: Map<string, number>): Promise<void>;

  /**
   * Terminate the participant and release resources.
   */
  terminate(): Promise<void>;
}
