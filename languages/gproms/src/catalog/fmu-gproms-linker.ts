// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GpromsDynamicModelIO, GpromsDynamicStepOutput, GpromsLinkedUnitInstance } from "./wasm-gproms-loader.js";

export interface GpromsFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface GpromsFmuDescriptor {
  modelName: string;
  capeOpenProgId?: string | undefined;
  variables: GpromsFmuVariableDescriptor[];
}

export interface GpromsForeignObjectProjection {
  modelName: string;
  unitName: string;
  gpromsSource: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU or CAPE-OPEN 1.1 Foreign Object descriptor into a gPROMS
 * `MODEL ... FOREIGN_OBJECT` wrapper so proprietary vendor unit operations or property
 * packages can be linked alongside cleanroom `@modelscript/gproms-std-lib` models.
 */
export function fmuToGpromsForeignObject(fmu: GpromsFmuDescriptor, unitName = "FO_1"): GpromsForeignObjectProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const inputs = fmu.variables.filter((v) => v.causality === "input");
  const outputs = fmu.variables.filter((v) => v.causality === "output");
  const foRef = fmu.capeOpenProgId ?? `FMI::${fmu.modelName}`;

  const paramLines = params.map((p) => `    ${p.name} AS ${p.type.toUpperCase()} DEFAULT ${p.start ?? 0.0}`);
  const varLines = [...inputs, ...outputs].map((v) => `    ${v.name} AS NoType`);

  const gpromsSource = [
    `MODEL ${fmu.modelName}`,
    `  PARAMETER`,
    `    FO AS FOREIGN_OBJECT "${foRef}"`,
    ...paramLines,
    `  VARIABLE`,
    ...varLines,
    `  EQUATION`,
    ...outputs.map((o) => `    ${o.name} = FO.${o.name}(${inputs.map((i) => i.name).join(", ")}) ;`),
    `END`,
    `# UNIT ${unitName} AS ${fmu.modelName}`,
  ].join("\n");

  return {
    modelName: fmu.modelName,
    unitName,
    gpromsSource,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI 2.0/3.0 or CAPE-OPEN co-simulation callback into a `GpromsLinkedUnitInstance`
 * compatible with cleanroom WASM PML models.
 */
export function createFmuGpromsInstance(
  unitName: string,
  modelName: string,
  stepFn: (tSec: number, dtSec: number, io: GpromsDynamicModelIO) => Partial<GpromsDynamicStepOutput>,
): GpromsLinkedUnitInstance {
  return {
    unitName,
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
        flowOut: partial.flowOut ?? io.flowIn ?? 0,
        concOut: partial.concOut ?? io.concIn ?? 0,
        tempOut: partial.tempOut ?? io.tempIn ?? 300.0,
        pressureOut: partial.pressureOut ?? io.pressureIn ?? 101325.0,
        heatDuty: partial.heatDuty ?? 0,
        controlOut: partial.controlOut ?? 0,
        holdup: partial.holdup ?? 0,
        conversion: partial.conversion ?? 0,
      };
    },
  };
}
