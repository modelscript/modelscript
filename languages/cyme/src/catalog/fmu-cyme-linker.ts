// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CymeEvalInput, CymeEvalOutput, CymeLinkedEquipmentInstance } from "./wasm-cyme-loader.js";

export interface CymeFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface CymeFmuDescriptor {
  modelName: string;
  variables: CymeFmuVariableDescriptor[];
}

export interface CymeFmuProjection {
  modelName: string;
  sxstDeviceRecord: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a CYME `.sxst` / ASCII custom user-defined device
 * record so proprietary/black-box vendor DER or protection FMUs can be linked alongside cleanroom
 * standard equipment models.
 */
export function fmuToCymeSxst(
  fmu: CymeFmuDescriptor,
  equipmentId: string,
  sectionId = "SEC_1",
  nominalKv = 12.47,
): CymeFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const paramTokens = params.map((p) => `${p.name}=${p.start ?? 0.0}`).join(";");
  const sxstDeviceRecord =
    `[USER_DEFINED_MODEL]\n` +
    `EQUIPMENT_ID=${equipmentId}\n` +
    `SECTION_ID=${sectionId}\n` +
    `FMU_MODEL=${fmu.modelName}\n` +
    `NOMINAL_KV=${nominalKv.toFixed(2)}\n` +
    `PARAMETERS=${paramTokens}`;
  return {
    modelName: fmu.modelName,
    sxstDeviceRecord,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into a `CymeLinkedEquipmentInstance` compatible with
 * cleanroom WASM distribution equipment models.
 */
export function createFmuCymeInstance(
  equipmentId: string,
  modelName: string,
  evalFn: (input: CymeEvalInput) => Partial<CymeEvalOutput>,
): CymeLinkedEquipmentInstance {
  return {
    equipmentId,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    evaluate(input: CymeEvalInput): CymeEvalOutput {
      const partial = evalFn(input);
      return {
        r1Ohm: partial.r1Ohm ?? 0,
        x1Ohm: partial.x1Ohm ?? 0,
        r0Ohm: partial.r0Ohm ?? 0,
        x0Ohm: partial.x0Ohm ?? 0,
        tripTimeSec: partial.tripTimeSec ?? -1,
        tapRatio: partial.tapRatio ?? 1,
        pOutPu: partial.pOutPu ?? 0,
        qOutPu: partial.qOutPu ?? 0,
      };
    },
  };
}
