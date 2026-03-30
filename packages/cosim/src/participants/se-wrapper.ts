// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI 3.0 Scheduled Execution co-simulation participant.
 *
 * Wraps an FMU that supports Scheduled Execution mode where the
 * orchestrator controls clock activations and the FMU processes
 * discrete state updates on a per-clock basis.
 *
 * Architecture:
 *   Orchestrator → ScheduledExecutionParticipant.doStep(t, h)
 *                      │
 *                      ├─ For each clock due in [t, t+h]:
 *                      │     activateModelPartition(clockRef, t_activation)
 *                      └─ Collect outputs
 */

import type { CosimValue } from "../coupling.js";
import type { ParticipantMetadata } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

/** Clock configuration for a scheduled partition. */
export interface ClockConfig {
  /** Value reference of the clock variable. */
  valueReference: number;
  /** Clock interval in seconds (periodic clocks). */
  interval: number;
  /** Next activation time (mutable). */
  nextActivation: number;
}

/**
 * FMI 3.0 Scheduled Execution participant.
 *
 * Drives FMU partitions by activating clocks at their scheduled times.
 * Each clock activation triggers discrete state updates within the FMU.
 */
export class ScheduledExecutionParticipant implements CoSimParticipant {
  readonly id: string;
  readonly modelName: string;
  readonly metadata: ParticipantMetadata;
  private clocks: ClockConfig[];
  private variables = new Map<string, CosimValue>();

  constructor(id: string, modelName: string, metadata: ParticipantMetadata, clocks: ClockConfig[]) {
    this.id = id;
    this.modelName = modelName;
    this.metadata = metadata;
    this.clocks = clocks.map((c) => ({ ...c }));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async initialize(startTime: number, stopTime: number, stepSize: number): Promise<void> {
    // Initialize all clock activation times
    for (const clock of this.clocks) {
      clock.nextActivation = clock.interval;
    }
  }

  async doStep(t: number, h: number): Promise<void> {
    const tEnd = t + h;

    // Collect all clocks that fire during [t, t+h]
    const activations: { clock: ClockConfig; time: number }[] = [];
    for (const clock of this.clocks) {
      while (clock.nextActivation <= tEnd + 1e-15) {
        activations.push({ clock, time: clock.nextActivation });
        clock.nextActivation += clock.interval;
      }
    }

    // Sort activations by time
    activations.sort((a, b) => a.time - b.time);

    // Process each clock activation in chronological order
    for (const { clock } of activations) {
      // In a real FMI 3.0 implementation, this would call:
      //   fmi3ActivateModelPartition(instance, clock.valueReference, activationTime)
      await this.activatePartition(clock.valueReference);
    }
  }

  /**
   * Activate a clock partition. Override in native implementations
   * to call fmi3ActivateModelPartition on the FMU instance.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async activatePartition(clockRef: number): Promise<void> {
    // Base implementation — no-op. Native wrapper overrides this.
  }

  async setInputs(values: Map<string, CosimValue>): Promise<void> {
    for (const [name, value] of values) {
      this.variables.set(name, value);
    }
  }

  async getOutputs(): Promise<Map<string, CosimValue>> {
    return new Map(this.variables);
  }

  async terminate(): Promise<void> {
    this.variables.clear();
  }
}
