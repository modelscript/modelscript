// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SimpackElementIO, SimpackElementOutput, SimpackLinkedElementInstance } from "./wasm-simpack-loader.js";

export interface SimpackFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface SimpackFmuDescriptor {
  modelName: string;
  variables: SimpackFmuVariableDescriptor[];
}

export interface SimpackFmuProjection {
  modelName: string;
  elementName: string;
  spckBlock: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a SIMPACK `.spck` FMU co-simulation
 * force/control element declaration (`$F_FMU_CoSim`) so vendor black-box FMUs can be
 * linked alongside cleanroom standard library elements.
 */
export function fmuToSimpackElement(
  fmu: SimpackFmuDescriptor,
  elementName = "$F_FMU_1",
  fromMarker = "$M_BodyA",
  toMarker = "$M_BodyB",
): SimpackFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const paramLines = params.map((p) => `  param.${p.name} = ${p.start ?? 0.0};`).join("\n");
  const spckBlock = [
    `force.${elementName} = $F_FMU_CoSim {`,
    `  fmuModel = "${fmu.modelName}";`,
    `  markerI = ${fromMarker};`,
    `  markerJ = ${toMarker};`,
    ...(paramLines ? [paramLines] : []),
    `}`,
  ].join("\n");

  return {
    modelName: fmu.modelName,
    elementName,
    spckBlock,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into a `SimpackLinkedElementInstance` compatible with
 * cleanroom WASM elements.
 */
export function createFmuSimpackInstance(
  id: string,
  modelName: string,
  evalFn: (tSec: number, dtSec: number, io: SimpackElementIO) => Partial<SimpackElementOutput>,
): SimpackLinkedElementInstance {
  return {
    id,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    eval(tSec, dtSec, io) {
      const partial = evalFn(tSec, dtSec, io);
      return {
        fx: partial.fx ?? 0,
        fy: partial.fy ?? 0,
        fz: partial.fz ?? io.normalLoad ?? 0,
        tx: partial.tx ?? 0,
        ty: partial.ty ?? 0,
        tz: partial.tz ?? 0,
        stiffnessEff: partial.stiffnessEff ?? 0,
        powerLoss: partial.powerLoss ?? 0,
      };
    },
  };
}
