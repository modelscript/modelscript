// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FeaConstitutiveInput, FeaConstitutiveOutput, FeaLinkedCardInstance } from "./wasm-fea-loader.js";

export interface FeaFmuVariableDescriptor {
  name: string;
  causality: "parameter" | "input" | "output" | "local";
  type: "Real" | "Integer" | "Boolean" | "String";
  valueReference: number;
  start?: number | undefined;
}

export interface FeaFmuDescriptor {
  modelName: string;
  variables: FeaFmuVariableDescriptor[];
}

export interface FeaFmuProjection {
  modelName: string;
  materialName: string;
  inpCard: string;
  bdfCard: string;
  parameterNames: string[];
}

/**
 * Projects an FMI 2.0/3.0 FMU descriptor into Abaqus `*USER MATERIAL` (`.inp`) and
 * NASTRAN `MATUSR` (`.bdf`) records so proprietary/black-box vendor UMAT FMUs can be
 * linked alongside cleanroom standard FEA constitutive models.
 */
export function fmuToFeaInpCard(fmu: FeaFmuDescriptor, materialName?: string): FeaFmuProjection {
  const matName = materialName ?? fmu.modelName.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const params = fmu.variables.filter((v) => v.causality === "parameter");
  const valuesLine = params.map((p) => (p.start ?? 0.0).toString()).join(", ");
  const inpCard = [
    `*MATERIAL, NAME=${matName}`,
    `*USER MATERIAL, CONSTANTS=${params.length}, TYPE=MECHANICAL`,
    `** FMU: ${fmu.modelName} (${params.map((p) => p.name).join(", ")})`,
    valuesLine,
  ].join("\n");

  const bdfFields = params.slice(0, 6).map((p) => (p.start ?? 0.0).toString());
  const bdfCard = `MATUSR,1,${fmu.modelName},${bdfFields.join(",")}`;

  return {
    modelName: fmu.modelName,
    materialName: matName,
    inpCard,
    bdfCard,
    parameterNames: params.map((p) => p.name),
  };
}

/**
 * Wraps an FMI co-simulation UMAT callback into a `FeaLinkedCardInstance` compatible with
 * cleanroom WASM constitutive models.
 */
export function createFmuFeaInstance(
  id: string,
  modelName: string,
  evalFn: (input: FeaConstitutiveInput) => Partial<FeaConstitutiveOutput>,
): FeaLinkedCardInstance {
  return {
    id,
    cardType: modelName,
    archetypeId: 0,
    init() {
      return 0;
    },
    evaluate(input) {
      const partial = evalFn(input);
      const sig11 = partial.sig11 ?? 0;
      const sig22 = partial.sig22 ?? 0;
      const sig33 = partial.sig33 ?? 0;
      const tau12 = partial.tau12 ?? 0;
      const vm =
        partial.vonMises ??
        Math.sqrt(0.5 * ((sig11 - sig22) ** 2 + (sig22 - sig33) ** 2 + (sig33 - sig11) ** 2) + 3 * tau12 ** 2);
      return {
        sig11,
        sig22,
        sig33,
        tau12,
        vonMises: vm,
        strainEnergy: partial.strainEnergy ?? 0.5 * sig11 * input.eps11,
        aux1: partial.aux1 ?? 0,
        aux2: partial.aux2 ?? 0,
      };
    },
  };
}
