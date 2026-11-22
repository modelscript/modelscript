// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AdamsEvalIO, AdamsEvalOutput, AdamsLinkedElementInstance } from "./wasm-adams-loader.js";

export interface AdamsFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface AdamsFmuDescriptor {
  modelName: string;
  variables: AdamsFmuVariableDescriptor[];
}

export interface AdamsFmuProjection {
  modelName: string;
  gseStatement: string;
  parameterNames: string[];
  inputNames: string[];
  outputNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into an MSC Adams `GSE` (General State Equation)
 * co-simulation record so external vendor FMUs (e.g., tire/controller/hydraulic subsystems)
 * can be linked alongside cleanroom `@modelscript/adams-std-lib` elements.
 */
export function fmuToAdamsGse(
  fmu: AdamsFmuDescriptor,
  gseId = 1,
  plantInputId = 1,
  plantOutputId = 1,
): AdamsFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const inputs = fmu.variables.filter((v) => v.causality === "input");
  const outputs = fmu.variables.filter((v) => v.causality === "output");
  const paramValues = params.map((p) => String(p.start ?? 0.0)).join(", ");
  const gseStatement = [
    `GSE/${gseId}`,
    `, U = ${plantInputId}`,
    `, Y = ${plantOutputId}`,
    `, NS = ${Math.max(1, inputs.length)}`,
    `, ROUTINE = fmi_cosim::${fmu.modelName}`,
    params.length > 0 ? `, USER(${paramValues})` : "",
  ].join("");

  return {
    modelName: fmu.modelName,
    gseStatement,
    parameterNames: params.map((p) => p.name),
    inputNames: inputs.map((v) => v.name),
    outputNames: outputs.map((v) => v.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into an `AdamsLinkedElementInstance` compatible with
 * cleanroom WASM elements.
 */
export function createFmuAdamsInstance(
  id: string,
  modelName: string,
  evalFn: (io: AdamsEvalIO, tSec: number, dtSec: number) => Partial<AdamsEvalOutput>,
): AdamsLinkedElementInstance {
  return {
    id,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    evaluate(io, tSec = 0.0, dtSec = 1e-3) {
      const partial = evalFn(io, tSec, dtSec);
      const fx = partial.fx ?? partial.value ?? 0.0;
      const fy = partial.fy ?? 0.0;
      const fz = partial.fz ?? 0.0;
      const tx = partial.tx ?? 0.0;
      const ty = partial.ty ?? 0.0;
      const tz = partial.tz ?? partial.mz ?? 0.0;
      return {
        value: partial.value ?? fx,
        fx,
        fy,
        fz,
        tx,
        ty,
        tz,
        mz: partial.mz ?? tz,
      };
    },
  };
}
