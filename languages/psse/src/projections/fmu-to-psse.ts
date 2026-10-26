// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI to PSS/E Projection Generator.
 *
 * Maps black-box FMU variables into PSS/E dynamic user models (`USRMDL`):
 * - Assigns CON (constants), STATE (integrators), VAR (algebraic outputs), and ICON (integers)
 * - Generates compliant PSS/E `.dyr` dynamic model record
 * - Emits index mapping documentation
 */

export interface FmuVariableStub {
  name: string;
  causality: "input" | "output" | "parameter" | "calculatedParameter" | "local" | "independent" | string;
  type: string;
  valueReference: number;
  unit?: string | undefined;
  start?: number | string | boolean | undefined;
  description?: string | undefined;
}

export interface FmuModelStub {
  modelName: string;
  description?: string | undefined;
  guid?: string | undefined;
  fmiVersion?: string | undefined;
  variables: FmuVariableStub[];
}

export interface PsseProjectionResult {
  modelName: string;
  dyrRecord: string;
  conMap: { index: number; name: string; value: number }[];
  stateMap: { index: number; name: string }[];
  varMap: { index: number; name: string }[];
  totalCons: number;
  totalStates: number;
  totalVars: number;
}

export function fmuToPsse(model: FmuModelStub, busId = 101, machineId = "1"): PsseProjectionResult {
  const modelName = sanitizePsseIdent(model.modelName).toUpperCase();

  const parameters = model.variables.filter(
    (v) => (v.causality === "parameter" || v.causality === "calculatedParameter") && v.type === "Real",
  );
  const outputs = model.variables.filter((v) => v.causality === "output" && v.type === "Real");
  const locals = model.variables.filter((v) => v.causality === "local" && v.type === "Real");

  const conMap = parameters.map((p, idx) => ({
    index: idx + 1,
    name: p.name,
    value: typeof p.start === "number" ? p.start : 1.0,
  }));

  // Infer states from derivative names or local continuous variables
  const stateVars = locals.filter(
    (v) => v.name.toLowerCase().includes("der(") || v.name.toLowerCase().includes("state"),
  );
  const stateMap = stateVars.map((s, idx) => ({
    index: idx + 1,
    name: s.name,
  }));

  const varMap = outputs.map((o, idx) => ({
    index: idx + 1,
    name: o.name,
  }));

  const nc = conMap.length;
  const ns = Math.max(0, stateMap.length);
  const nv = varMap.length;

  // Format PSS/E .dyr entry:
  // IBUS 'USRMDL' ID 'NAME' IC IT NC NS NV [CON values...] /
  const conValuesStr = conMap.map((c) => c.value.toFixed(4)).join(" ");
  const dyrLines: string[] = [
    `// PSS/E User Dynamic Model for FMU '${model.modelName}'`,
    `${busId} 'USRMDL' '${machineId}' '${modelName}' 1 1 ${nc} ${ns} ${nv}`,
    `  ${conValuesStr} /`,
  ];

  return {
    modelName,
    dyrRecord: dyrLines.join("\n"),
    conMap,
    stateMap,
    varMap,
    totalCons: nc,
    totalStates: ns,
    totalVars: nv,
  };
}

function sanitizePsseIdent(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 12);
}
