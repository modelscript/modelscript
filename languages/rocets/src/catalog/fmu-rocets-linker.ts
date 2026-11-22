// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RocetsLinkedModuleInstance, RocetsModuleIO, RocetsStepOutput } from "./wasm-rocets-loader.js";

export interface RocetsFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface RocetsFmuDescriptor {
  modelName: string;
  variables: RocetsFmuVariableDescriptor[];
}

export interface RocetsFmuProjection {
  modelName: string;
  deckBlock: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a ROCETS `USER_ROUTINE` module deck block
 * so proprietary or external vendor FMUs can be linked alongside cleanroom standard modules.
 */
export function fmuToRocetsModule(fmu: RocetsFmuDescriptor, instanceId = "FMU1"): RocetsFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const paramLines = params.map((p) => `  ${p.name} = ${p.start ?? 0.0}`).join("\n");
  const deckBlock = [
    `MODULE ${instanceId} = USER_ROUTINE`,
    `  FMU_MODEL = "${fmu.modelName}"`,
    ...(paramLines.length > 0 ? [paramLines] : []),
    `END MODULE`,
  ].join("\n");
  return {
    modelName: fmu.modelName,
    deckBlock,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into a `RocetsLinkedModuleInstance` compatible with
 * cleanroom `@modelscript/rocets-std-lib` WASM modules.
 */
export function createFmuRocetsInstance(
  id: string,
  modelName: string,
  stepFn: (tSec: number, dtSec: number, io: RocetsModuleIO) => Partial<RocetsStepOutput>,
): RocetsLinkedModuleInstance {
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
        pOut: partial.pOut ?? io.pOut ?? io.pIn ?? 0,
        tOut: partial.tOut ?? io.tOut ?? io.tIn ?? 0,
        mdotOut: partial.mdotOut ?? io.mdotOut ?? io.mdotIn ?? 0,
        mdotSecondary: partial.mdotSecondary ?? io.mdotFuel ?? 0,
        speedRpm: partial.speedRpm ?? io.speedRpm ?? 0,
        torqueNm: partial.torqueNm ?? io.torqueNm ?? 0,
        powerW: partial.powerW ?? io.powerW ?? 0,
        density: partial.density ?? io.density ?? 0,
        enthalpy: partial.enthalpy ?? io.enthalpy ?? 0,
        thrustN: partial.thrustN ?? 0,
        ispSec: partial.ispSec ?? 0,
        headM: partial.headM ?? 0,
      };
    },
  };
}
