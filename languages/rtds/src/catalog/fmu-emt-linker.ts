// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RtdsEmtIO, RtdsEmtStepOutput, RtdsLinkedEmtInstance } from "./wasm-emt-loader.js";

export interface RtdsFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface RtdsFmuDescriptor {
  modelName: string;
  variables: RtdsFmuVariableDescriptor[];
}

export interface RtdsFmuProjection {
  modelName: string;
  cbuilderBlock: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into an RTDS RSCAD CBuilder / user-defined
 * component descriptor block so black-box vendor FMUs can co-simulate alongside cleanroom EMT models.
 */
export function fmuToRtdsCBuilder(
  fmu: RtdsFmuDescriptor,
  instanceName = "FMU_1",
  subsystem = 1,
  timeStepUs = 50,
): RtdsFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const paramLines = params.map((p) => `  PARAM ${p.name} = ${p.start ?? 0.0}`).join("\n");
  const cbuilderBlock = [
    `COMPONENT CBUILDER_FMU ${instanceName}`,
    `  SUBSYSTEM ${subsystem}`,
    `  MODEL "${fmu.modelName}"`,
    `  TIMESTEP_US ${timeStepUs}`,
    ...(paramLines ? [paramLines] : []),
    `END_COMPONENT`,
  ].join("\n");

  return {
    modelName: fmu.modelName,
    cbuilderBlock,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into an `RtdsLinkedEmtInstance` compatible with
 * cleanroom WASM EMT models.
 */
export function createFmuRtdsInstance(
  name: string,
  subsystem: number,
  modelName: string,
  stepFn: (tSec: number, dtSec: number, io: RtdsEmtIO) => Partial<RtdsEmtStepOutput>,
): RtdsLinkedEmtInstance {
  return {
    name,
    subsystem,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    doStep(tSec, dtSec, io = {}) {
      const partial = stepFn(tSec, dtSec, io);
      return {
        va: partial.va ?? io.va ?? 0,
        vb: partial.vb ?? io.vb ?? 0,
        vc: partial.vc ?? io.vc ?? 0,
        ia: partial.ia ?? io.ia ?? 0,
        ib: partial.ib ?? io.ib ?? 0,
        ic: partial.ic ?? io.ic ?? 0,
        vdc: partial.vdc ?? io.vdc ?? 0,
        idc: partial.idc ?? io.idc ?? 0,
        vd: partial.vd ?? io.vd ?? 0,
        vq: partial.vq ?? io.vq ?? 0,
        v0: partial.v0 ?? io.v0 ?? 0,
        theta: partial.theta ?? io.theta ?? 0,
        omega: partial.omega ?? io.omega ?? 0,
        freqHz: partial.freqHz ?? io.freqHz ?? 60,
        ctrlOut: partial.ctrlOut ?? 0,
        trip: partial.trip ?? 0,
        gEq: partial.gEq ?? 0,
        iHist: partial.iHist ?? 0,
        pOut: partial.pOut ?? 0,
        qOut: partial.qOut ?? 0,
        va2: partial.va2 ?? io.va2 ?? 0,
        ia2: partial.ia2 ?? io.ia2 ?? 0,
      };
    },
  };
}
