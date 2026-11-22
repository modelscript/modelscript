// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  PowerFactoryDynamicModelIO,
  PowerFactoryDynamicStepOutput,
  PowerFactoryLinkedDynamicInstance,
} from "./wasm-dsl-loader.js";

export interface PowerFactoryFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface PowerFactoryFmuDescriptor {
  modelName: string;
  variables: PowerFactoryFmuVariableDescriptor[];
}

export interface PowerFactoryFmuProjection {
  modelName: string;
  dslBlock: string;
  parameterNames: string[];
  inputNames: string[];
  outputNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a PowerFactory `BlkDef` / `ElmDsl` wrapper
 * declaration so proprietary or black-box vendor FMUs can be co-simulated alongside
 * cleanroom `@modelscript/powerfactory-std-lib` models.
 */
export function fmuToPowerFactoryDsl(
  fmu: PowerFactoryFmuDescriptor,
  blockName = fmu.modelName,
): PowerFactoryFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const inputs = fmu.variables.filter((v) => v.causality === "input");
  const outputs = fmu.variables.filter((v) => v.causality === "output");

  const lines: string[] = [`! FMI 2.0/3.0 Co-Simulation Wrapper for ${fmu.modelName}`, `BlkDef ${blockName}`];
  if (inputs.length > 0) {
    lines.push(`  input ${inputs.map((v) => v.name).join(", ")};`);
  }
  if (outputs.length > 0) {
    lines.push(`  output ${outputs.map((v) => v.name).join(", ")};`);
  }
  for (const p of params) {
    lines.push(`  parameter ${p.name} = ${p.start ?? 0.0};`);
  }
  lines.push(`  external_fmu "${fmu.modelName}";`);
  lines.push("end;");

  return {
    modelName: fmu.modelName,
    dslBlock: lines.join("\n"),
    parameterNames: params.map((p) => p.name),
    inputNames: inputs.map((i) => i.name),
    outputNames: outputs.map((o) => o.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into a `PowerFactoryLinkedDynamicInstance`
 * compatible with cleanroom WASM DSL & equipment instances.
 */
export function createFmuPowerFactoryInstance(
  name: string,
  modelName: string,
  stepFn: (tSec: number, dtSec: number, io: PowerFactoryDynamicModelIO) => Partial<PowerFactoryDynamicStepOutput>,
): PowerFactoryLinkedDynamicInstance {
  return {
    name,
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
