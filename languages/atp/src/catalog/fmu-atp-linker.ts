// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AtpComponentIO, AtpComponentStepOutput, AtpLinkedComponentInstance } from "./wasm-atp-loader.js";

export interface AtpFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface AtpFmuDescriptor {
  modelName: string;
  variables: AtpFmuVariableDescriptor[];
}

export interface AtpFmuProjection {
  modelName: string;
  modelsCard: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into an ATP `MODELS` FOREIGN MODEL block
 * so proprietary/black-box vendor FMUs can be co-simulated alongside cleanroom ATP components.
 */
export function fmuToAtpModelsCard(fmu: AtpFmuDescriptor, instanceName = "FMU1"): AtpFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const inputs = fmu.variables.filter((v) => v.causality === "input");
  const outputs = fmu.variables.filter((v) => v.causality === "output");

  const lines: string[] = ["MODELS", `  MODEL ${fmu.modelName} FOREIGN ${fmu.modelName}`];
  if (inputs.length > 0) {
    lines.push(`    INPUT ${inputs.map((v) => v.name).join(", ")}`);
  }
  if (outputs.length > 0) {
    lines.push(`    OUTPUT ${outputs.map((v) => v.name).join(", ")}`);
  }
  if (params.length > 0) {
    lines.push(`    DATA ${params.map((p) => `${p.name} {dflt: ${p.start ?? 0.0}}`).join(", ")}`);
  }
  lines.push("  ENDMODEL");
  lines.push(`  USE ${fmu.modelName} AS ${instanceName}`);
  for (const p of params) {
    lines.push(`    DATA ${p.name} := ${p.start ?? 0.0}`);
  }
  lines.push("  ENDUSE");
  lines.push("ENDMODELS");

  return {
    modelName: fmu.modelName,
    modelsCard: lines.join("\n"),
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into an `AtpLinkedComponentInstance` compatible with
 * cleanroom WASM components.
 */
export function createFmuAtpInstance(
  id: string,
  node1: string,
  node2: string,
  modelName: string,
  stepFn: (tSec: number, dtSec: number, io?: AtpComponentIO) => Partial<AtpComponentStepOutput>,
): AtpLinkedComponentInstance {
  return {
    id,
    node1,
    node2,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    doStep(tSec, dtSec, io) {
      const partial = stepFn(tSec, dtSec, io);
      return {
        iBranch: partial.iBranch ?? 0,
        gEq: partial.gEq ?? 0,
        iHist: partial.iHist ?? 0,
        iHist2: partial.iHist2 ?? 0,
        vSource: partial.vSource ?? 0,
        switchState: partial.switchState ?? 0,
        ctrlOut: partial.ctrlOut ?? 0,
        flux: partial.flux ?? 0,
        powerW: partial.powerW ?? 0,
        omegaRadS: partial.omegaRadS ?? 0,
        torqueNm: partial.torqueNm ?? 0,
        auxOut: partial.auxOut ?? 0,
      };
    },
  };
}
