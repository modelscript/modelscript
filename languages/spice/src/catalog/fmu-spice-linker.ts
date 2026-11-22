// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SpiceDeviceEvalInput, SpiceDeviceEvalOutput, SpiceLinkedDeviceInstance } from "./wasm-spice-loader.js";

export interface SpiceFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface SpiceFmuDescriptor {
  modelName: string;
  variables: SpiceFmuVariableDescriptor[];
}

export interface SpiceFmuProjection {
  modelName: string;
  subcktDeck: string;
  instanceCard: string;
  portNames: string[];
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a SPICE `.SUBCKT` wrapper and `X` instance card
 * so vendor black-box FMUs (e.g., encrypted power IC or gate-driver models) can be co-simulated
 * alongside cleanroom SPICE standard library devices.
 */
export function fmuToSpiceSubckt(fmu: SpiceFmuDescriptor, instanceName = "XFMU1"): SpiceFmuProjection {
  const ports = fmu.variables.filter((v) => v.causality === "input" || v.causality === "output");
  const params = fmu.variables.filter((v) => v.causality === "parameter");

  const portNames = ports.length > 0 ? ports.map((p) => p.name) : ["IN", "OUT", "GND"];
  const paramDefs = params.map((p) => `${p.name}=${p.start ?? 0.0}`).join(" ");
  const paramSuffix = paramDefs.length > 0 ? ` PARAMS: ${paramDefs}` : "";

  const subcktDeck = [
    `* FMI 2.0/3.0 Co-Simulation FMU Wrapper for ${fmu.modelName}`,
    `.SUBCKT ${fmu.modelName} ${portNames.join(" ")}${paramSuffix}`,
    `* Coupled via @modelscript/spice FMU linker`,
    `.ENDS ${fmu.modelName}`,
  ].join("\n");

  const instanceCard = `${instanceName} ${portNames.join(" ")} ${fmu.modelName}${paramDefs.length > 0 ? ` ${paramDefs}` : ""}`;

  return {
    modelName: fmu.modelName,
    subcktDeck,
    instanceCard,
    portNames,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into a `SpiceLinkedDeviceInstance` compatible with
 * cleanroom WASM SPICE devices.
 */
export function createFmuSpiceInstance(
  name: string,
  modelName: string,
  evalFn: (input: SpiceDeviceEvalInput) => Partial<SpiceDeviceEvalOutput>,
): SpiceLinkedDeviceInstance {
  return {
    name,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    eval(input: SpiceDeviceEvalInput): SpiceDeviceEvalOutput {
      const partial = evalFn(input);
      return {
        iOut: partial.iOut ?? 0,
        iAux: partial.iAux ?? 0,
        vOut: partial.vOut ?? 0,
        gm: partial.gm ?? 0,
        gds: partial.gds ?? 0,
        region: partial.region ?? 1,
      };
    },
  };
}
