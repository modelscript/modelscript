import { ArenaDAE, Causality } from "@modelscript/compiler";
import { simulateArena } from "@modelscript/compiler/simulator";
import type { CoSimParticipant, CosimValue, ParticipantMetadata } from "@modelscript/cosim";

export class ModelScriptParticipant implements CoSimParticipant {
  id: string;
  modelName: string;
  metadata: ParticipantMetadata;
  private arena: ArenaDAE;
  private currentValues: Map<string, number>;

  constructor(id: string, modelName: string, arena: ArenaDAE) {
    this.id = id;
    this.modelName = modelName;
    this.arena = arena;
    this.currentValues = new Map<string, number>();

    // Initialize current values from start attributes
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      const startVal = arena.getVarStartValue(i);
      if (startVal !== undefined && typeof startVal === "number") {
        this.currentValues.set(arena.getVarName(i), startVal);
      }
    }

    const variables: { name: string; causality: string; type: string }[] = [];
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      const causalityVal = arena.getVarCausality(i);
      const causalityStr =
        causalityVal === Causality.Input ? "input" : causalityVal === Causality.Output ? "output" : "local";
      variables.push({
        name: arena.getVarName(i),
        causality: causalityStr,
        type: "Real", // Currently simplified to Real
      });
    }

    this.metadata = {
      participantId: id,
      type: "js-simulator",
      classKind: "model",
      modelName,
      timestamp: new Date().toISOString(),
      variables,
    };
  }

  async initialize() {
    /* no-op */
  }

  async doStep(time: number, stepSize: number) {
    // Write all current values to the arena's start values before simulating
    for (const [name, val] of this.currentValues) {
      try {
        const idx = this.arena.getVarIdxByName(name);
        if (idx !== -1) {
          this.arena.setVarStartValue(idx, val);
        }
      } catch {
        // ignore
      }
    }

    // Step the simulation by one communication interval
    const result = simulateArena(this.arena, {
      startTime: time,
      stopTime: time + stepSize,
      step: stepSize,
      solver: "rk4",
    });

    // Extract values from the last time point
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
  }

  async getOutputs(): Promise<Map<string, CosimValue>> {
    const outputs = new Map<string, CosimValue>();
    for (let i = 0; i < this.arena.varCount; i++) {
      if (this.arena.isVarRemoved(i)) continue;
      if (this.arena.getVarCausality(i) === Causality.Output) {
        const name = this.arena.getVarName(i);
        const val = this.currentValues.get(name);
        if (val !== undefined) {
          outputs.set(name, val);
        }
      }
    }
    return outputs;
  }

  async setInputs(values: Map<string, CosimValue>) {
    for (const [name, value] of values) {
      if (typeof value === "number") {
        this.currentValues.set(name, value);
      }
    }
  }

  async terminate() {
    /* no-op */
  }
}
