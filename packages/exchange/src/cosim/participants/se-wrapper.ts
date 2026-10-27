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

/** Callback invoked when a scheduled model partition is activated. */
export type PartitionHandler = (
  clockRef: number,
  activationTime: number,
  variables: Map<string, CosimValue>,
) => void | Promise<void>;

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
  private partitionHandlers = new Map<number, PartitionHandler>();
  private activationCounts = new Map<number, number>();
  private lastActivationTimes = new Map<number, number>();
  private defaultHandler?: PartitionHandler | undefined;

  constructor(
    id: string,
    modelName: string,
    metadata: ParticipantMetadata,
    clocks: ClockConfig[],
    defaultHandler?: PartitionHandler,
  ) {
    this.id = id;
    this.modelName = modelName;
    this.metadata = metadata;
    this.clocks = clocks.map((c) => ({ ...c }));
    this.defaultHandler = defaultHandler;
  }

  /** Register a partition handler for a specific clock value reference. */
  registerPartitionHandler(clockRef: number, handler: PartitionHandler): void {
    this.partitionHandlers.set(clockRef, handler);
  }

  /** Get the number of times a clock partition (or all partitions if omitted) has been activated. */
  getActivationCount(clockRef?: number): number {
    if (clockRef !== undefined) {
      return this.activationCounts.get(clockRef) ?? 0;
    }
    let total = 0;
    for (const c of this.activationCounts.values()) total += c;
    return total;
  }

  /** Get the last activation time for a clock partition. */
  getLastActivationTime(clockRef: number): number | undefined {
    return this.lastActivationTimes.get(clockRef);
  }

  async initialize(startTime: number, _stopTime: number, _stepSize: number): Promise<void> {
    this.activationCounts.clear();
    this.lastActivationTimes.clear();
    for (const v of this.metadata.variables) {
      if (v.start !== undefined) {
        this.variables.set(v.name, v.start);
      }
    }
    // Initialize all clock activation times relative to startTime
    for (const clock of this.clocks) {
      clock.nextActivation = startTime + clock.interval;
      this.activationCounts.set(clock.valueReference, 0);
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
    for (const { clock, time } of activations) {
      await this.activatePartition(clock.valueReference, time);
    }
  }

  /**
   * Activate a clock partition. Override in native implementations
   * to call fmi3ActivateModelPartition on the FMU instance, or register
   * a partition handler via registerPartitionHandler().
   */
  protected async activatePartition(clockRef: number, activationTime = 0): Promise<void> {
    const prevCount = this.activationCounts.get(clockRef) ?? 0;
    const nextCount = prevCount + 1;
    this.activationCounts.set(clockRef, nextCount);
    this.lastActivationTimes.set(clockRef, activationTime);

    const handler = this.partitionHandlers.get(clockRef) ?? this.defaultHandler;
    if (handler) {
      await handler(clockRef, activationTime, this.variables);
    }
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
    this.activationCounts.clear();
    this.lastActivationTimes.clear();
  }
}
