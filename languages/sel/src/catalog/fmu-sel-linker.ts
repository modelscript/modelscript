// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SelElementEvalOutput, SelElementIO, SelLinkedElementInstance } from "./wasm-sel-loader.js";

export interface SelFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface SelFmuDescriptor {
  modelName: string;
  variables: SelFmuVariableDescriptor[];
}

export interface SelFmuProjection {
  modelName: string;
  relayId: string;
  groupId: number;
  selSettingsBlock: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into an SEL settings / SELogic binding block
 * so proprietary or vendor relay FMUs can be linked alongside cleanroom standard elements.
 */
export function fmuToSelSettings(fmu: SelFmuDescriptor, relayId = "SEL_FMU_1", groupId = 1): SelFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const lines = [
    `[GROUP ${groupId}]`,
    `RID := "${relayId}"`,
    `FMU_MODEL := "${fmu.modelName}"`,
    ...params.map((p) => `${p.name.toUpperCase()} := ${p.start ?? 0.0}`),
  ];
  return {
    modelName: fmu.modelName,
    relayId,
    groupId,
    selSettingsBlock: lines.join("\n"),
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into a `SelLinkedElementInstance` compatible with
 * cleanroom WASM protection elements and TCC curves.
 */
export function createFmuSelInstance(
  id: string,
  relayId: string,
  modelName: string,
  evalFn: (tSec: number, dtSec: number, io: SelElementIO) => Partial<SelElementEvalOutput>,
): SelLinkedElementInstance {
  return {
    id,
    relayId,
    elementType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    evalStep(tSec, dtSec, io) {
      const partial = evalFn(tSec, dtSec, io);
      return {
        pickup: partial.pickup ?? false,
        trip: partial.trip ?? false,
        operateTimeSec: partial.operateTimeSec ?? -1.0,
        integrator: partial.integrator ?? 0.0,
      };
    },
  };
}
