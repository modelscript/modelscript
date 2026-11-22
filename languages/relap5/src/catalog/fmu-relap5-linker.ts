// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Relap5LinkedInstance, Relap5ModelIO, Relap5StepOutput } from "./wasm-relap5-loader.js";

export interface Relap5FmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface Relap5FmuDescriptor {
  modelName: string;
  variables: Relap5FmuVariableDescriptor[];
}

export interface Relap5FmuProjection {
  modelName: string;
  controlCardDeck: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into RELAP5 205-series control-variable / external-model
 * coupling cards so vendor or multi-physics FMUs can be linked alongside cleanroom RELAP5 components.
 */
export function fmuToRelap5Deck(
  fmu: Relap5FmuDescriptor,
  componentId: number,
  baseCard = 20500100,
): Relap5FmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const lines: string[] = [
    `* External FMI 2.0/3.0 FMU Coupling for ${fmu.modelName} (Component ${componentId})`,
    `${baseCard} "${fmu.modelName}" extfmu 1.0 0.0 0`,
  ];
  params.forEach((p, idx) => {
    lines.push(`${baseCard + idx + 1} "${p.name}" ${(p.start ?? 0.0).toExponential(6)}`);
  });
  return {
    modelName: fmu.modelName,
    controlCardDeck: lines.join("\n"),
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into a `Relap5LinkedInstance` compatible with
 * cleanroom `@modelscript/relap5-std-lib` WASM models.
 */
export function createFmuRelap5Instance(
  componentId: number,
  modelName: string,
  stepFn: (tSec: number, dtSec: number, io: Relap5ModelIO) => Partial<Relap5StepOutput>,
): Relap5LinkedInstance {
  return {
    componentId,
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
        pressure: partial.pressure ?? io.pressure ?? 0,
        pressure2: partial.pressure2 ?? io.pressure2 ?? 0,
        temperature: partial.temperature ?? io.temperature ?? 0,
        massFlow: partial.massFlow ?? io.massFlow ?? 0,
        voidFraction: partial.voidFraction ?? io.voidFraction ?? 0,
        power: partial.power ?? io.power ?? 0,
        htc: partial.htc ?? io.htc ?? 0,
        qFlux: partial.qFlux ?? 0,
        tSat: partial.tSat ?? 0,
        decayFraction: partial.decayFraction ?? 0,
        aux: partial.aux ?? 0,
      };
    },
  };
}
