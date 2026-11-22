// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PslfDynamicModelIO, PslfDynamicStepOutput, PslfLinkedDynamicInstance } from "./wasm-dyd-loader.js";

export interface PslfFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface PslfFmuDescriptor {
  modelName: string;
  variables: PslfFmuVariableDescriptor[];
}

export interface PslfFmuProjection {
  modelName: string;
  dydRecord: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a PSLF `.dyd` `epcmod` user-defined record
 * so proprietary/black-box vendor FMUs can be linked alongside cleanroom standard models.
 */
export function fmuToPslfDyd(
  fmu: PslfFmuDescriptor,
  busNumber: number,
  unitId = "1",
  baseKv = 138.0,
): PslfFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const paramTokens = params.map((p) => `"${p.name}" ${p.start ?? 0.0}`).join(" ");
  const dydRecord = `epcmod ${busNumber} "BUS_${busNumber}" ${baseKv.toFixed(2)} "${unitId}" : #9 "${fmu.modelName}" ${paramTokens}`;
  return {
    modelName: fmu.modelName,
    dydRecord,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into a `PslfLinkedDynamicInstance` compatible with
 * cleanroom WASM models.
 */
export function createFmuPslfInstance(
  busNumber: number,
  id: string,
  modelName: string,
  stepFn: (tSec: number, dtSec: number, io: PslfDynamicModelIO) => Partial<PslfDynamicStepOutput>,
): PslfLinkedDynamicInstance {
  return {
    busNumber,
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
