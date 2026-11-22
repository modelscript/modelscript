// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SimulinkLinkedBlockInstance } from "./wasm-block-loader.js";

export interface SimulinkFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface SimulinkFmuDescriptor {
  modelName: string;
  variables: SimulinkFmuVariableDescriptor[];
}

export interface SimulinkFmuBlockProjection {
  blockName: string;
  blockType: "S-Function";
  parameters: Record<string, string | number>;
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a Simulink `S-Function` block configuration
 * for linking proprietary/black-box Simulink blocks or S-Functions alongside cleanroom blocks.
 */
export function fmuToSimulinkBlock(fmu: SimulinkFmuDescriptor): SimulinkFmuBlockProjection {
  const parameters: Record<string, string | number> = {
    FunctionName: fmu.modelName,
  };
  for (const v of fmu.variables) {
    if (v.causality === "parameter") {
      parameters[v.name] = v.start ?? 0.0;
    }
  }
  return {
    blockName: fmu.modelName,
    blockType: "S-Function",
    parameters,
  };
}

/**
 * Wraps an FMI co-simulation callback into a `SimulinkLinkedBlockInstance`.
 */
export function createFmuSimulinkBlockInstance(
  modelName: string,
  stepFn: (tSec: number, dtSec: number, inputs: readonly number[]) => number,
): SimulinkLinkedBlockInstance {
  let lastOutput = 0.0;
  return {
    blockType: modelName,
    archetypeId: 0,
    init() {
      lastOutput = 0.0;
      return 0;
    },
    step(tSec, dtSec, inputs = []) {
      lastOutput = stepFn(tSec, dtSec, inputs);
      return lastOutput;
    },
    getOutput(index = 0) {
      return index === 0 ? lastOutput : 0.0;
    },
  };
}
