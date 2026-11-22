// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OneLinerEvalInput, OneLinerEvalOutput, OneLinerLinkedWasmInstance } from "./wasm-oneliner-loader.js";

export interface OneLinerFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface OneLinerFmuDescriptor {
  modelName: string;
  variables: OneLinerFmuVariableDescriptor[];
}

export interface OneLinerFmuProjection {
  modelName: string;
  olxRecord: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into an ASPEN OneLiner `.olx` / `.dxt`
 * user-defined relay block (`USER_RELAY`) so vendor/black-box protection FMUs can be
 * linked alongside cleanroom IEEE/IEC standard library models.
 */
export function fmuToOneLinerRecord(
  fmu: OneLinerFmuDescriptor,
  busId: string,
  branchId: string,
  relayId = "FMU_1",
): OneLinerFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const paramTokens = params.map((p) => `${p.name}=${p.start ?? 0.0}`).join(" ");
  const olxRecord =
    `USER_RELAY "${relayId}" BUS="${busId}" BRANCH="${branchId}" FMU="${fmu.modelName}" ${paramTokens}`.trim();
  return {
    modelName: fmu.modelName,
    olxRecord,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into an `OneLinerLinkedWasmInstance` compatible
 * with cleanroom WASM protection relay models.
 */
export function createFmuOneLinerInstance(
  id: string,
  busId: string,
  branchId: string,
  modelName: string,
  evalFn: (input: OneLinerEvalInput) => Partial<OneLinerEvalOutput>,
): OneLinerLinkedWasmInstance {
  return {
    id,
    busId,
    branchId,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    evaluate(input: OneLinerEvalInput): OneLinerEvalOutput {
      const partial = evalFn(input);
      return {
        tripped: partial.tripped ?? false,
        tripTimeSec: partial.tripTimeSec ?? 1e9,
        pickupMultiple: partial.pickupMultiple ?? 0,
        margin: partial.margin ?? 0,
        z1Mag: partial.z1Mag ?? 0,
        z0Mag: partial.z0Mag ?? 0,
        rTotal: partial.rTotal ?? 0,
        xTotal: partial.xTotal ?? 0,
      };
    },
  };
}
