// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * JS-native co-simulation participant.
 *
 * Wraps the `@modelscript/core` ModelicaSimulator in a co-simulation participant
 * that supports incremental stepping via setInputs/doStep/getOutputs.
 *
 * For now this runs in-process; a child_process.fork variant can be added
 * for CPU isolation when needed.
 */

import type { ModelicaDAE } from "@modelscript/core";
import type { ParticipantMetadata, ParticipantVariable } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

/**
 * Options for creating a JS simulator participant.
 */
export interface JsSimulatorParticipantOptions {
  /** Unique participant ID. */
  id: string;
  /** Flattened DAE system to simulate. */
  dae: ModelicaDAE;
  /** Optional SVG icon. */
  iconSvg?: string | undefined;
}

/**
 * Co-simulation participant backed by the ModelScript JS simulator.
 *
 * Wraps a ModelicaDAE and uses the ModelicaSimulator internally,
 * exposing the FMI-style stepping interface required by the orchestrator.
 */
export class JsSimulatorParticipant implements CoSimParticipant {
  readonly id: string;
  readonly modelName: string;
  readonly metadata: ParticipantMetadata;

  private readonly dae: ModelicaDAE;
  private simulator: unknown = null;
  private currentValues = new Map<string, number>();
  private inputOverrides = new Map<string, number>();
  private currentTime = 0;

  // Dependencies injected at runtime (avoids circular import with @modelscript/core)
  private static SimulatorClass:
    | (new (dae: ModelicaDAE) => {
        prepare(): void;
        simulate(start: number, stop: number, step: number): { t: number[]; y: number[][]; states: string[] };
      })
    | null = null;

  /** Register the ModelicaSimulator class (call once at startup). */
  static registerSimulator(ctor: typeof JsSimulatorParticipant.SimulatorClass): void {
    JsSimulatorParticipant.SimulatorClass = ctor;
  }

  constructor(options: JsSimulatorParticipantOptions) {
    this.id = options.id;
    this.dae = options.dae;
    this.modelName = options.dae.name;

    // Build Modelica-compatible metadata from the DAE
    const variables: ParticipantVariable[] = [];
    for (const v of this.dae.variables) {
      let causality: ParticipantVariable["causality"] = "local";
      if (v.causality === "input") causality = "input";
      else if (v.causality === "output") causality = "output";
      else if (v.variability?.toString() === "parameter") causality = "parameter";

      // Extract start value from attributes if available
      const startAttr = v.attributes.get("start");
      const startValue = startAttr && "value" in startAttr ? (startAttr as { value: number }).value : undefined;

      // Extract unit from attributes if available (only on RealVariable)
      const unitAttr = v.attributes.get("unit");
      const unitValue = unitAttr && "value" in unitAttr ? String((unitAttr as { value: unknown }).value) : undefined;

      variables.push({
        name: v.name,
        causality,
        type: "Real",
        unit: unitValue,
        start: startValue,
        description: v.description ?? undefined,
      });
    }

    this.metadata = {
      participantId: this.id,
      modelName: this.modelName,
      type: "js-simulator",
      classKind: "model",
      description: undefined,
      variables,
      iconSvg: options.iconSvg,
      timestamp: new Date().toISOString(),
    };
  }

  async initialize(startTime: number, stopTime: number, stepSize: number): Promise<void> {
    if (!JsSimulatorParticipant.SimulatorClass) {
      throw new Error("ModelicaSimulator not registered. Call JsSimulatorParticipant.registerSimulator() first.");
    }

    this.simulator = new JsSimulatorParticipant.SimulatorClass(this.dae);
    (this.simulator as { prepare(): void }).prepare();
    this.currentTime = startTime;
    void stopTime;
    void stepSize;

    // Initialize current values from DAE start values (via attributes)
    for (const v of this.dae.variables) {
      const startAttr = v.attributes.get("start");
      if (startAttr && "value" in startAttr) {
        const val = (startAttr as { value: number }).value;
        if (typeof val === "number") {
          this.currentValues.set(v.name, val);
        }
      }
    }
  }

  async doStep(currentTime: number, stepSize: number): Promise<void> {
    if (!this.simulator) throw new Error("Participant not initialized");

    const sim = this.simulator as {
      simulate(start: number, stop: number, step: number): { t: number[]; y: number[][]; states: string[] };
    };

    // Step the simulation by one communication interval
    const result = sim.simulate(currentTime, currentTime + stepSize, stepSize);

    // Extract final values from the last time point
    const lastIdx = result.t.length - 1;
    if (lastIdx >= 0) {
      for (let i = 0; i < result.states.length; i++) {
        const name = result.states[i];
        const value = result.y[lastIdx]?.[i];
        if (name && value !== undefined) {
          this.currentValues.set(name, value);
        }
      }
    }

    this.currentTime = currentTime + stepSize;
    this.inputOverrides.clear();
  }

  async getOutputs(): Promise<Map<string, number>> {
    const outputs = new Map<string, number>();
    for (const v of this.metadata.variables) {
      if (v.causality === "output") {
        const value = this.currentValues.get(v.name);
        if (value !== undefined) {
          outputs.set(v.name, value);
        }
      }
    }
    return outputs;
  }

  async setInputs(values: Map<string, number>): Promise<void> {
    for (const [name, value] of values) {
      this.inputOverrides.set(name, value);
      this.currentValues.set(name, value);
    }
  }

  async terminate(): Promise<void> {
    this.simulator = null;
    this.currentValues.clear();
    this.inputOverrides.clear();
  }
}
