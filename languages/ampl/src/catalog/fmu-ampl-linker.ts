// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AmplFunctionEvalOutput, AmplFunctionIO, AmplLinkedFunctionInstance } from "./wasm-ampl-loader.js";

export interface AmplFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface AmplFmuDescriptor {
  modelName: string;
  variables: AmplFmuVariableDescriptor[];
}

export interface AmplFmuProjection {
  modelName: string;
  amplDeclaration: string;
  parameterNames: string[];
  inputNames: string[];
  outputNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into AMPL external `function`, `param`, and `var`
 * declarations so proprietary/black-box vendor FMUs can be linked alongside cleanroom
 * `@modelscript/ampl-std-lib` functions.
 */
export function fmuToAmplModel(fmu: AmplFmuDescriptor, instanceName?: string): AmplFmuProjection {
  const prefix = instanceName ?? fmu.modelName;
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const inputs = fmu.variables.filter((v) => v.causality === "input");
  const outputs = fmu.variables.filter((v) => v.causality === "output");

  const lines: string[] = [
    `function ${fmu.modelName};`,
    ...params.map((p) => `param ${prefix}_${p.name} := ${p.start ?? 0.0};`),
    ...inputs.map((v) => `var ${prefix}_${v.name}${v.start !== undefined ? ` := ${v.start}` : ""};`),
    ...outputs.map((v) => `var ${prefix}_${v.name};`),
  ];

  if (outputs.length > 0) {
    const argList = [...inputs.map((v) => `${prefix}_${v.name}`), ...params.map((p) => `${prefix}_${p.name}`)].join(
      ", ",
    );
    lines.push(`subject to ${prefix}_fmu_link: ${prefix}_${outputs[0]!.name} = ${fmu.modelName}(${argList});`);
  }

  return {
    modelName: fmu.modelName,
    amplDeclaration: lines.join("\n"),
    parameterNames: params.map((p) => p.name),
    inputNames: inputs.map((v) => v.name),
    outputNames: outputs.map((v) => v.name),
  };
}

/**
 * Wraps an FMI co-simulation / external function callback into an `AmplLinkedFunctionInstance`
 * compatible with cleanroom WASM standard library functions.
 */
export function createFmuAmplInstance(
  id: string,
  modelName: string,
  evalFn: (io: AmplFunctionIO) => Partial<AmplFunctionEvalOutput>,
): AmplLinkedFunctionInstance {
  return {
    id,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    eval(io) {
      const partial = evalFn(io);
      return {
        result: partial.result ?? 0,
        aux1: partial.aux1 ?? 0,
        aux2: partial.aux2 ?? 0,
        deriv: partial.deriv ?? 0,
        status: partial.status ?? 0,
      };
    },
  };
}
