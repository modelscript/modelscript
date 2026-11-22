// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NmtranEvalIO, NmtranEvalOutput, NmtranLinkedModelInstance } from "./wasm-nmtran-loader.js";

export interface NmtranFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface NmtranFmuDescriptor {
  modelName: string;
  variables: NmtranFmuVariableDescriptor[];
}

export interface NmtranFmuProjection {
  modelName: string;
  controlStream: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a NONMEM / NMTRAN `$PROBLEM` + `$PRED`
 * control stream stub so proprietary/black-box QSP/PK/PD FMUs can be linked alongside
 * cleanroom PREDPP standard models.
 */
export function fmuToNmtranPred(
  fmu: NmtranFmuDescriptor,
  problemTitle = "FMI External PK/PD Co-Simulation Model",
): NmtranFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const thetaLines = params.map((p, idx) => `  (0, ${(p.start ?? 1.0).toString()}) ; THETA(${idx + 1}) ${p.name}`);
  const pkLines = params.map((p, idx) => `  ${p.name.toUpperCase()} = THETA(${idx + 1})`);

  const controlStream = [
    `$PROBLEM ${problemTitle} (${fmu.modelName})`,
    `$INPUT ID TIME AMT DV`,
    `$SUBROUTINES OTHER=${fmu.modelName}.fmu`,
    `$PRED`,
    ...pkLines,
    `  ; External FMU kernel: ${fmu.modelName}`,
    `  IPRED = F`,
    `  Y = IPRED * (1 + EPS(1))`,
    `$THETA`,
    ...(thetaLines.length > 0 ? thetaLines : ["  (0, 1.0) ; THETA(1) SCALE"]),
    `$SIGMA 0.01`,
  ].join("\n");

  return {
    modelName: fmu.modelName,
    controlStream,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into an `NmtranLinkedModelInstance` compatible with
 * cleanroom WASM PREDPP models.
 */
export function createFmuNmtranInstance(
  modelName: string,
  evalFn: (tHours: number, io?: NmtranEvalIO) => Partial<NmtranEvalOutput>,
): NmtranLinkedModelInstance {
  return {
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    evalAt(tHours, io) {
      const partial = evalFn(tHours, io);
      const conc = partial.conc ?? io?.conc ?? 0;
      const effect = partial.effect ?? 0;
      const ipred = partial.ipred ?? conc;
      const value = partial.value ?? ipred;
      return {
        value,
        time: tHours,
        conc,
        amountCentral: partial.amountCentral ?? 0,
        amountDepot: partial.amountDepot ?? 0,
        amountPeriph1: partial.amountPeriph1 ?? 0,
        amountPeriph2: partial.amountPeriph2 ?? 0,
        effect,
        ipred,
        dv: partial.dv ?? ipred,
        states: partial.states ?? [],
      };
    },
  };
}
