// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Easy5LinkedComponentInstance, Easy5ModelIO, Easy5StepOutput } from "./wasm-easy5-loader.js";

export interface Easy5FmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface Easy5FmuDescriptor {
  modelName: string;
  variables: Easy5FmuVariableDescriptor[];
}

export interface Easy5FmuProjection {
  modelName: string;
  componentId: string;
  easy5Block: string;
  parameterNames: string[];
  inputNames: string[];
  outputNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into an Easy5 `UG` (User General / External FMU)
 * component declaration so black-box vendor FMUs can be linked alongside cleanroom standard blocks.
 */
export function fmuToEasy5Block(fmu: Easy5FmuDescriptor, componentId = "FMU1"): Easy5FmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const inputs = fmu.variables.filter((v) => v.causality === "input");
  const outputs = fmu.variables.filter((v) => v.causality === "output");

  const lines: string[] = [
    `COMPONENT ${componentId} = GP/UG`,
    `  TITLE = "FMU: ${fmu.modelName}"`,
    `  PARAMETER FMU_MODEL = "${fmu.modelName}"`,
  ];
  for (const p of params) {
    lines.push(`  PARAMETER ${p.name} = ${p.start ?? 0.0}`);
  }
  for (const inp of inputs) {
    lines.push(`  INPUT ${inp.name}`);
  }
  for (const out of outputs) {
    lines.push(`  OUTPUT ${out.name}`);
  }
  lines.push("END COMPONENT");

  return {
    modelName: fmu.modelName,
    componentId,
    easy5Block: lines.join("\n"),
    parameterNames: params.map((p) => p.name),
    inputNames: inputs.map((i) => i.name),
    outputNames: outputs.map((o) => o.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into an `Easy5LinkedComponentInstance` compatible with
 * cleanroom WASM standard library components.
 */
export function createFmuEasy5Instance(
  id: string,
  modelName: string,
  stepFn: (tSec: number, dtSec: number, io: Easy5ModelIO) => Partial<Easy5StepOutput>,
): Easy5LinkedComponentInstance {
  return {
    id,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    checkFlatStart() {
      return 0;
    },
    doStep(tSec, dtSec, io) {
      const partial = stepFn(tSec, dtSec, io);
      return {
        y0: partial.y0 ?? 0.0,
        y1: partial.y1 ?? 0.0,
        y2: partial.y2 ?? 0.0,
        y3: partial.y3 ?? 0.0,
      };
    },
  };
}
