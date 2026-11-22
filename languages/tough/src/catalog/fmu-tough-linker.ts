// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ToughEvalOutput, ToughLinkedModelInstance, ToughModelIO } from "./wasm-tough-loader.js";

export interface ToughFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface ToughFmuDescriptor {
  modelName: string;
  variables: ToughFmuVariableDescriptor[];
}

export interface ToughFmuProjection {
  modelName: string;
  rockRecord: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a TOUGH2/TOUGH3 `ROCKS` user-defined constitutive
 * record so proprietary/black-box vendor EOS or petrophysical FMUs can be linked alongside
 * cleanroom standard library models.
 */
export function fmuToToughRockBlock(fmu: ToughFmuDescriptor, rockName = "FMU01"): ToughFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const paramList = params.map((p) => `${p.name}=${(p.start ?? 0.0).toExponential(4)}`).join(" ");
  const cleanRock = rockName.slice(0, 5).padEnd(5, " ");
  const rockRecord = `ROCKS\n${cleanRock}    2 2600.0e+00 0.2000e+00 1.0000e-13 1.0000e-13 1.0000e-13 2.5000e+00 920.00e+00\n! FMU=${fmu.modelName} ${paramList}`;
  return {
    modelName: fmu.modelName,
    rockRecord,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation / constitutive evaluation callback into a `ToughLinkedModelInstance`
 * compatible with cleanroom WASM models.
 */
export function createFmuToughInstance(
  id: string,
  modelName: string,
  evalFn: (io: ToughModelIO) => Partial<ToughEvalOutput>,
): ToughLinkedModelInstance {
  return {
    id,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    eval(io: ToughModelIO): ToughEvalOutput {
      const partial = evalFn(io);
      return {
        krLiquid: partial.krLiquid ?? 0,
        krGas: partial.krGas ?? 0,
        capillaryPressurePa: partial.capillaryPressurePa ?? 0,
        liquidDensity: partial.liquidDensity ?? 997.0,
        gasDensity: partial.gasDensity ?? 1.2,
        liquidViscosity: partial.liquidViscosity ?? 8.9e-4,
        saturationPressurePa: partial.saturationPressurePa ?? 3169.0,
        liquidEnthalpy: partial.liquidEnthalpy ?? 104600.0,
        co2Solubility: partial.co2Solubility ?? 0,
        effectiveConductivity: partial.effectiveConductivity ?? 0,
      };
    },
  };
}
