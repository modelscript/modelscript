// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AspenLinkedModelInstance, AspenModelIO, AspenModelOutput } from "./wasm-aspen-loader.js";

export interface AspenFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface AspenFmuDescriptor {
  modelName: string;
  variables: AspenFmuVariableDescriptor[];
}

export interface AspenFmuProjection {
  modelName: string;
  blockId: string;
  aspenBlockSnippet: string;
  parameterNames: string[];
}

export interface CapeOpenUnitDescriptor {
  progId: string;
  name: string;
  capeOpenVersion?: "1.0" | "1.1" | undefined;
  inletPorts: string[];
  outletPorts: string[];
  parameters: Array<{ name: string; defaultValue: number; unit?: string | undefined }>;
}

export interface CapeOpenProjection {
  blockId: string;
  progId: string;
  aspenBlockSnippet: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into an Aspen Plus `USER2` custom unit operation block
 * so proprietary/black-box vendor FMUs can be linked alongside cleanroom standard models.
 */
export function fmuToAspenUser2(
  fmu: AspenFmuDescriptor,
  blockId: string,
  inletStream = "FEED",
  outletStream = "PROD",
): AspenFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const realParamLines = params.map((p, idx) => `    REAL-PARAM ${idx + 1} ${p.start ?? 0.0} ; ${p.name}`).join("\n");
  const aspenBlockSnippet = [
    `FLOWSHEET`,
    `    BLOCK ${blockId} IN=${inletStream} OUT=${outletStream}`,
    `BLOCK ${blockId} USER2`,
    `    SUBROUTINE MODEL=${fmu.modelName}`,
    realParamLines,
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  return {
    modelName: fmu.modelName,
    blockId,
    aspenBlockSnippet,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Projects a CAPE-OPEN 1.0/1.1 unit operation descriptor into an Aspen Plus `CAPE-OPEN`
 * external unit operation block snippet.
 */
export function capeOpenToAspenBlock(unit: CapeOpenUnitDescriptor, blockId: string): CapeOpenProjection {
  const inClause = unit.inletPorts.join(" ");
  const outClause = unit.outletPorts.join(" ");
  const paramLines = unit.parameters
    .map((p) => `    PARAM "${p.name}" = ${p.defaultValue}${p.unit ? ` ; ${p.unit}` : ""}`)
    .join("\n");

  const aspenBlockSnippet = [
    `FLOWSHEET`,
    `    BLOCK ${blockId} IN=${inClause} OUT=${outClause}`,
    `BLOCK ${blockId} CAPE-OPEN`,
    `    PROG-ID "${unit.progId}"`,
    `    CAPE-VERSION "${unit.capeOpenVersion ?? "1.1"}"`,
    paramLines,
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  return {
    blockId,
    progId: unit.progId,
    aspenBlockSnippet,
    parameterNames: unit.parameters.map((p) => p.name),
  };
}

/**
 * Wraps an FMI 2.0/3.0 or CAPE-OPEN unit operation evaluation callback into an
 * `AspenLinkedModelInstance` compatible with cleanroom WASM models.
 */
export function createFmuAspenInstance(
  id: string,
  modelName: string,
  evalFn: (io: AspenModelIO) => Partial<AspenModelOutput>,
): AspenLinkedModelInstance {
  return {
    id,
    modelType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    eval(io: AspenModelIO): AspenModelOutput {
      const partial = evalFn(io);
      return {
        T_out: partial.T_out ?? io.T_in,
        P_out: partial.P_out ?? io.P_in,
        vaporFraction: partial.vaporFraction ?? 0,
        dutyW: partial.dutyW ?? 0,
        compressibilityOrLmtd: partial.compressibilityOrLmtd ?? 1,
        fugacityOrY1OrPsat: partial.fugacityOrY1OrPsat ?? 1,
        aux1: partial.aux1 ?? 0,
        aux2: partial.aux2 ?? 0,
        status: partial.status ?? 0,
      };
    },
  };
}
