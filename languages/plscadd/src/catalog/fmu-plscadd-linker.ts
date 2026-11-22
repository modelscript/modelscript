// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PlsCaddEvalInput, PlsCaddEvalOutput, PlsCaddLinkedWasmInstance } from "./wasm-plscadd-loader.js";

export interface PlsCaddFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface PlsCaddFmuDescriptor {
  modelName: string;
  variables: PlsCaddFmuVariableDescriptor[];
}

export interface PlsCaddFmuProjection {
  modelName: string;
  plsRecord: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a PLS-CADD user-defined external model record
 * so proprietary conductor/structure/aeroelastic FMUs can be linked alongside cleanroom models.
 */
export function fmuToPlsCaddRecord(
  fmu: PlsCaddFmuDescriptor,
  elementId: string,
  voltageKv = 230.0,
): PlsCaddFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const paramTokens = params.map((p) => `${p.name}=${p.start ?? 0.0}`).join(" ");
  const plsRecord =
    `FMU_ELEMENT "${elementId}" MODEL="${fmu.modelName}" KV=${voltageKv.toFixed(1)} ${paramTokens}`.trim();
  return {
    modelName: fmu.modelName,
    plsRecord,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into a `PlsCaddLinkedWasmInstance` compatible with
 * cleanroom WASM models.
 */
export function createFmuPlsCaddInstance(
  id: string,
  modelName: string,
  evalFn: (input: PlsCaddEvalInput) => Partial<PlsCaddEvalOutput>,
): PlsCaddLinkedWasmInstance {
  return {
    id,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    eval(input) {
      const partial = evalFn(input);
      return {
        sagM: partial.sagM ?? 0,
        arcLengthM: partial.arcLengthM ?? input.spanM ?? 0,
        maxTensionN: partial.maxTensionN ?? input.horizontalTensionN ?? 0,
        resultantUnitWeightNPerM: partial.resultantUnitWeightNPerM ?? input.unitWeightNPerM ?? 0,
        stateChangeTensionN: partial.stateChangeTensionN ?? input.horizontalTensionN ?? 0,
        ampacityA: partial.ampacityA ?? 0,
        conductorTempC: partial.conductorTempC ?? input.ambientTempC ?? 25.0,
        utilizationRatio: partial.utilizationRatio ?? 0,
      };
    },
  };
}
