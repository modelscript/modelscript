// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GtSuiteLinkedInstance, GtSuiteModelIO, GtSuiteStepOutput } from "./wasm-gtsuite-loader.js";

export interface GtSuiteFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface GtSuiteFmuDescriptor {
  modelName: string;
  variables: GtSuiteFmuVariableDescriptor[];
}

export interface GtSuiteFmuProjection {
  modelName: string;
  gtmRecord: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a GT-SUITE `FMI_CoSim` external template block
 * so proprietary or supplier FMUs can be linked alongside cleanroom standard templates.
 */
export function fmuToGtSuiteBlock(fmu: GtSuiteFmuDescriptor, instanceId = "fmu_1"): GtSuiteFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const paramLines = params.map((p) => `  ${p.name} = ${p.start ?? 0.0};`).join("\n");
  const gtmRecord = [
    `component FMI_CoSim "${instanceId}" {`,
    `  fmuModelName = "${fmu.modelName}";`,
    ...(paramLines.length > 0 ? [paramLines] : []),
    `}`,
  ].join("\n");
  return {
    modelName: fmu.modelName,
    gtmRecord,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into a `GtSuiteLinkedInstance` compatible with
 * cleanroom WASM models.
 */
export function createFmuGtSuiteInstance(
  id: string,
  modelName: string,
  stepFn: (tSec: number, dtSec: number, io: GtSuiteModelIO) => Partial<GtSuiteStepOutput>,
): GtSuiteLinkedInstance {
  return {
    id,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    checkFlatStart() {
      return 0;
    },
    doStep(tSec, dtSec, io = {}) {
      const partial = stepFn(tSec, dtSec, io);
      return {
        pOut: partial.pOut ?? io.pOut ?? io.pIn ?? 101325.0,
        tOut: partial.tOut ?? io.tOut ?? io.tIn ?? 300.0,
        massFlow: partial.massFlow ?? io.massFlow ?? 0,
        burnFraction: partial.burnFraction ?? 0,
        heatTransferCoeff: partial.heatTransferCoeff ?? 0,
        powerW: partial.powerW ?? io.powerW ?? 0,
        speedRpm: partial.speedRpm ?? io.speedRpm ?? 0,
        qHeatW: partial.qHeatW ?? io.qHeatW ?? 0,
        tempK: partial.tempK ?? io.tOut ?? 300.0,
        voltageV: partial.voltageV ?? 0,
        soc: partial.soc ?? 0,
        auxOut: partial.auxOut ?? 0,
      };
    },
  };
}
