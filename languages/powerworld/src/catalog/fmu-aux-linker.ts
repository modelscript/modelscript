// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  PowerWorldDynamicModelIO,
  PowerWorldDynamicStepOutput,
  PowerWorldLinkedDynamicInstance,
} from "./wasm-aux-loader.js";

export interface PowerWorldFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface PowerWorldFmuDescriptor {
  modelName: string;
  variables: PowerWorldFmuVariableDescriptor[];
}

export interface PowerWorldFmuProjection {
  modelName: string;
  auxSection: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a PowerWorld Simulator `.aux`
 * `DATA (TSUserDefinedModel, ...)` section so vendor/black-box FMUs can be linked
 * alongside cleanroom standard models.
 */
export function fmuToPowerWorldAux(
  fmu: PowerWorldFmuDescriptor,
  busNum: number,
  unitId = "1",
): PowerWorldFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const fieldHeader = ["BusNum", "GenID", "TSModelName", ...params.map((p) => p.name)].join(", ");
  const rowValues = [
    String(busNum),
    `"${unitId}"`,
    `"${fmu.modelName}"`,
    ...params.map((p) => String(p.start ?? 0.0)),
  ].join(" ");
  const auxSection = `DATA (TSUserDefinedModel, [${fieldHeader}])\n{\n  ${rowValues}\n}`;
  return {
    modelName: fmu.modelName,
    auxSection,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into a `PowerWorldLinkedDynamicInstance`
 * compatible with cleanroom WASM models.
 */
export function createFmuPowerWorldInstance(
  busNum: number,
  id: string,
  modelName: string,
  stepFn: (tSec: number, dtSec: number, io: PowerWorldDynamicModelIO) => Partial<PowerWorldDynamicStepOutput>,
): PowerWorldLinkedDynamicInstance {
  return {
    busNum,
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
        efd: partial.efd ?? io.efd,
        pmech: partial.pmech ?? io.pmech,
        vsPss: partial.vsPss ?? io.vsPss ?? 0,
        pelec: partial.pelec ?? io.pelec ?? io.pmech,
        irInj: partial.irInj ?? 0,
        iiInj: partial.iiInj ?? 0,
        qSvc: partial.qSvc ?? 0,
        tripMult: partial.tripMult ?? 1,
      };
    },
  };
}
