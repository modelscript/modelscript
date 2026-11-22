// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OlgaEvalOutput, OlgaLinkedModelInstance, OlgaModelIO } from "./wasm-olga-loader.js";

export interface OlgaFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface OlgaFmuDescriptor {
  modelName: string;
  variables: OlgaFmuVariableDescriptor[];
}

export interface OlgaFmuProjection {
  modelName: string;
  keyKeywordBlock: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into an OLGA `.key` `SERVER` / external plugin block
 * so proprietary or vendor FMUs (e.g. subsea control, separator, or PVT plugins) can be linked
 * alongside cleanroom standard OLGA models.
 */
export function fmuToOlgaKey(fmu: OlgaFmuDescriptor, branchName = "BRANCH-1", label = "FMU_EXT_1"): OlgaFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const paramPairs = params.map((p) => `${p.name.toUpperCase()}=${p.start ?? 0.0}`).join(", ");
  const keyKeywordBlock =
    `CONTROLLER LABEL=${label}, TYPE=EXTERNAL_FMU, BRANCH=${branchName}, FMU="${fmu.modelName}"` +
    (paramPairs.length > 0 ? `, ${paramPairs}` : "");
  return {
    modelName: fmu.modelName,
    keyKeywordBlock,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into an `OlgaLinkedModelInstance` compatible with
 * cleanroom WASM models.
 */
export function createFmuOlgaInstance(
  id: string,
  branch: string,
  modelName: string,
  evalFn: (tSec: number, dtSec: number, io: OlgaModelIO) => Partial<OlgaEvalOutput>,
): OlgaLinkedModelInstance {
  return {
    id,
    branch,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    eval(tSec, dtSec, io) {
      const partial = evalFn(tSec, dtSec, io);
      return {
        voidFraction: partial.voidFraction ?? 0,
        pressureDrop: partial.pressureDrop ?? 0,
        massFlowOut: partial.massFlowOut ?? io.massFlowIn ?? 0,
        heatFlux: partial.heatFlux ?? 0,
        solutionGor: partial.solutionGor ?? 0,
        oilFvf: partial.oilFvf ?? 1,
        temperatureOut: partial.temperatureOut ?? io.temperatureIn ?? 300,
        controlOut: partial.controlOut ?? io.opening ?? 1,
      };
    },
  };
}
