// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MagicDrawEvalOutput, MagicDrawLinkedInstance, MagicDrawModelIO } from "./wasm-magicdraw-loader.js";

export interface MagicDrawFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
  unit?: string | undefined;
}

export interface MagicDrawFmuDescriptor {
  modelName: string;
  fmiVersion?: "2.0" | "3.0" | undefined;
  variables: MagicDrawFmuVariableDescriptor[];
}

export interface MagicDrawFmuProjection {
  modelName: string;
  xmiBlockFragment: string;
  parameterNames: string[];
  inputNames: string[];
  outputNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into a MagicDraw / Cameo SysML `«Block»` + `«FMU»`
 * XMI fragment so external simulation FMUs can be co-simulated alongside cleanroom standard models.
 */
export function fmuToMagicDrawBlock(fmu: MagicDrawFmuDescriptor, elementId = "fmu_block_1"): MagicDrawFmuProjection {
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const inputs = fmu.variables.filter((v) => v.causality === "input");
  const outputs = fmu.variables.filter((v) => v.causality === "output");

  const attrLines: string[] = [];
  for (const p of params) {
    attrLines.push(
      `  <ownedAttribute xmi:type="uml:Property" xmi:id="${elementId}_p_${p.valueReference}" name="${p.name}">` +
        `<defaultValue xmi:type="uml:LiteralReal" value="${p.start ?? 0.0}"/></ownedAttribute>`,
    );
  }
  for (const inp of inputs) {
    attrLines.push(
      `  <ownedAttribute xmi:type="uml:Port" xmi:id="${elementId}_in_${inp.valueReference}" name="${inp.name}"/>`,
    );
  }
  for (const out of outputs) {
    attrLines.push(
      `  <ownedAttribute xmi:type="uml:Port" xmi:id="${elementId}_out_${out.valueReference}" name="${out.name}"/>`,
    );
  }

  const xmiBlockFragment = [
    `<packagedElement xmi:type="uml:Class" xmi:id="${elementId}" name="${fmu.modelName}">`,
    ...attrLines,
    `</packagedElement>`,
    `<sysml:Block xmi:id="${elementId}_st" base_Class="${elementId}"/>`,
    `<CST:FMU xmi:id="${elementId}_fmu" base_Class="${elementId}" fmiVersion="${fmu.fmiVersion ?? "2.0"}" modelName="${fmu.modelName}"/>`,
  ].join("\n");

  return {
    modelName: fmu.modelName,
    xmiBlockFragment,
    parameterNames: params.map((p) => p.name),
    inputNames: inputs.map((i) => i.name),
    outputNames: outputs.map((o) => o.name),
  };
}

/**
 * Wraps an FMI co-simulation callback into a `MagicDrawLinkedInstance` compatible with
 * cleanroom WASM standard library models.
 */
export function createFmuMagicDrawInstance(
  elementId: string,
  modelName: string,
  evalFn: (io: MagicDrawModelIO, tSec: number, dtSec: number) => Partial<MagicDrawEvalOutput>,
): MagicDrawLinkedInstance {
  let evalCount = 0;
  let minObserved = 0;
  let maxObserved = 0;

  return {
    elementId,
    modelType: modelName,
    archetypeId: 0,
    init() {
      evalCount = 0;
      minObserved = 0;
      maxObserved = 0;
      return 0;
    },
    eval(io, tSec = 0.0, dtSec = 0.01) {
      const partial = evalFn(io, tSec, dtSec);
      const val = partial.value ?? io.x ?? 0;
      evalCount += 1;
      if (evalCount === 1 || val < minObserved) minObserved = val;
      if (evalCount === 1 || val > maxObserved) maxObserved = val;
      const pass = partial.pass ?? true;
      return {
        value: val,
        pass,
        secondary: partial.secondary ?? val,
        tertiary: partial.tertiary ?? val,
        evalCount,
        minObserved,
        maxObserved,
        statusCode: partial.statusCode ?? (pass ? 1 : -1),
      };
    },
  };
}
