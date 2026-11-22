// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LpsEvalOutput, LpsHydraulicIO, LpsLinkedModelInstance } from "./wasm-lps-loader.js";

export interface LpsFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface LpsFmuDescriptor {
  modelName: string;
  variables: LpsFmuVariableDescriptor[];
}

export interface LpsFmuProjection {
  modelName: string;
  lpsRecord: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a PipelineStudio / TGNET user-defined equipment block
 * so proprietary compressor/valve/EOS FMUs can be co-simulated alongside cleanroom standard models.
 */
export function fmuToLpsEquipment(
  fmu: LpsFmuDescriptor,
  stationName: string,
  fromNode = "INLET",
  toNode = "OUTLET",
): LpsFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const paramTokens = params.map((p) => `${p.name}=${p.start ?? 0.0}`).join(", ");
  const lpsRecord = `USER_EQUIPMENT "${stationName}" FROM "${fromNode}" TO "${toNode}" FMU "${fmu.modelName}" (${paramTokens})`;
  return {
    modelName: fmu.modelName,
    lpsRecord,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into an `LpsLinkedModelInstance` compatible with
 * cleanroom WASM pipeline models.
 */
export function createFmuLpsInstance(
  id: string,
  modelName: string,
  evalFn: (io: LpsHydraulicIO, tSec: number, dtSec: number) => Partial<LpsEvalOutput>,
): LpsLinkedModelInstance {
  return {
    id,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    eval(io, tSec = 0.0, dtSec = 0.0) {
      const partial = evalFn(io, tSec, dtSec);
      const poutPa = partial.poutPa ?? io.pinPa;
      const toutK = partial.toutK ?? io.tinK ?? 288.15;
      return {
        poutPa,
        toutK,
        deltaPPa: partial.deltaPPa ?? io.pinPa - poutPa,
        powerW: partial.powerW ?? 0,
        headM: partial.headM ?? 0,
        zFactor: partial.zFactor ?? 1,
        densityKgM3: partial.densityKgM3 ?? 0,
        velocityMs: partial.velocityMs ?? 0,
        surgeDeltaPPa: partial.surgeDeltaPPa ?? 0,
        waveSpeedMs: partial.waveSpeedMs ?? 0,
        pressureRatio: partial.pressureRatio ?? (io.pinPa > 0 ? poutPa / io.pinPa : 1),
        opening: partial.opening ?? io.opening ?? 1,
      };
    },
  };
}
