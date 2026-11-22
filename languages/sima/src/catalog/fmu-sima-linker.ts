// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SimaEvalOutput, SimaLinkedInstance, SimaModelIO } from "./wasm-sima-loader.js";

export interface SimaFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface SimaFmuDescriptor {
  modelName: string;
  variables: SimaFmuVariableDescriptor[];
}

export interface SimaFmuProjection {
  modelName: string;
  simaXmlFragment: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a SIMA ExternalControl / ExternalForce XML fragment
 * so vendor co-simulation FMUs (e.g. DP controllers, turbine controllers, proprietary riser models)
 * can be linked alongside cleanroom SIMO/RIFLEX standard models.
 */
export function fmuToSimaXml(fmu: SimaFmuDescriptor, bodyId = "Body1"): SimaFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const paramXml = params
    .map((p) => `  <Parameter name="${p.name}" valueReference="${p.valueReference}" value="${p.start ?? 0.0}" />`)
    .join("\n");
  const simaXmlFragment = [
    `<ExternalFmuForce name="${fmu.modelName}" body="${bodyId}">`,
    paramXml,
    `</ExternalFmuForce>`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    modelName: fmu.modelName,
    simaXmlFragment,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into a `SimaLinkedInstance` compatible with
 * cleanroom WASM models.
 */
export function createFmuSimaInstance(
  id: string,
  modelName: string,
  evalFn: (tSec: number, dtSec: number, io?: SimaModelIO) => Partial<SimaEvalOutput>,
): SimaLinkedInstance {
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
        primary: partial.primary ?? 0,
        secondary: partial.secondary ?? 0,
        tertiary: partial.tertiary ?? 0,
        aux1: partial.aux1 ?? 0,
        aux2: partial.aux2 ?? 0,
        statusFlag: partial.statusFlag ?? 0,
      };
    },
  };
}
