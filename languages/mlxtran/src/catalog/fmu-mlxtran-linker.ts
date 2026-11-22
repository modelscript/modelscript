// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MlxtranLinkedModelInstance, MlxtranModelEvalIO, MlxtranModelEvalOutput } from "./wasm-mlxtran-loader.js";

export interface MlxtranFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface MlxtranFmuDescriptor {
  modelName: string;
  variables: MlxtranFmuVariableDescriptor[];
}

export interface MlxtranFmuProjection {
  modelName: string;
  mlxtranBlock: string;
  parameterNames: string[];
  outputNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a cleanroom Mlxtran `[LONGITUDINAL]`
 * external-model declaration block so proprietary/black-box QSP or PBPK FMUs can be
 * linked alongside cleanroom standard library models.
 */
export function fmuToMlxtranBlock(fmu: MlxtranFmuDescriptor): MlxtranFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const outputs = fmu.variables.filter((v) => v.causality === "output");
  const inputList = params.map((p) => p.name).join(", ");
  const outputList = outputs.length > 0 ? outputs.map((o) => o.name).join(", ") : "Cc";
  const lines = [
    `DESCRIPTION: External FMI FMU '${fmu.modelName}'`,
    `[LONGITUDINAL]`,
    `input = {${inputList}}`,
    `EQUATION:`,
    `; FMI co-simulation bridge for ${fmu.modelName}`,
    ...params.map((p) => `; param ${p.name} = ${p.start ?? 0.0}`),
    `OUTPUT:`,
    `output = {${outputList}}`,
  ];
  return {
    modelName: fmu.modelName,
    mlxtranBlock: lines.join("\n"),
    parameterNames: params.map((p) => p.name),
    outputNames: outputs.map((o) => o.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into an `MlxtranLinkedModelInstance` compatible with
 * cleanroom WASM PK/PD/TMDD/TGI models.
 */
export function createFmuMlxtranInstance(
  modelName: string,
  evalFn: (t: number, dt: number, io?: MlxtranModelEvalIO) => Partial<MlxtranModelEvalOutput>,
): MlxtranLinkedModelInstance {
  return {
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    eval(t, dt = 0.0, io) {
      const partial = evalFn(t, dt, io);
      const concOut = partial.concOut ?? 0;
      const effectOut = partial.effectOut ?? 0;
      const tumorOut = partial.tumorOut ?? 0;
      const primary = partial.primary ?? concOut;
      return {
        primary,
        concOut,
        effectOut,
        tumorOut,
        peripheralOut: partial.peripheralOut ?? 0,
        depotOut: partial.depotOut ?? 0,
        aucOut: partial.aucOut ?? 0,
      };
    },
  };
}
