// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GensysElementEvalOutput, GensysElementIO, GensysLinkedElementInstance } from "./wasm-gensys-loader.js";

export interface GensysFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface GensysFmuDescriptor {
  modelName: string;
  variables: GensysFmuVariableDescriptor[];
}

export interface GensysFmuProjection {
  modelName: string;
  couplRecord: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a GENSYS `coupl` user-defined co-simulation record
 * so proprietary/black-box vendor suspension or active-damper FMUs can be linked alongside cleanroom standard models.
 */
export function fmuToGensysCoupling(
  fmu: GensysFmuDescriptor,
  body1: string,
  body2: string,
  couplingName = `fmu_${fmu.modelName.toLowerCase()}`,
): GensysFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const paramLines = params.map((p) => `  func const ${couplingName}.${p.name} = ${p.start ?? 0.0}`).join("\n");
  const couplRecord = [
    `coupl fmu_cosim ${couplingName} ${body1} 0 0 0 ${body2} 0 0 0 fmu="${fmu.modelName}"`,
    ...(paramLines ? [paramLines] : []),
  ].join("\n");

  return {
    modelName: fmu.modelName,
    couplRecord,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into a `GensysLinkedElementInstance` compatible with
 * cleanroom WASM GENSYS elements.
 */
export function createFmuGensysInstance(
  name: string,
  modelName: string,
  evalFn: (tSec: number, dtSec: number, io: GensysElementIO) => Partial<GensysElementEvalOutput>,
): GensysLinkedElementInstance {
  return {
    name,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    eval(tSec, dtSec, io) {
      const partial = evalFn(tSec, dtSec, io);
      return {
        fx: partial.fx ?? 0,
        fy: partial.fy ?? 0,
        fz: partial.fz ?? 0,
        mz: partial.mz ?? 0,
        aux1: partial.aux1 ?? 0,
        aux2: partial.aux2 ?? 0,
      };
    },
  };
}
