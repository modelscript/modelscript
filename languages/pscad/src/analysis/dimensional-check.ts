// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PscadDiagnostic, PscxProject } from "../types.js";

/**
 * 7D SI physical dimension vector: `[M, L, T, I, Theta, N, J]` (mass, length, time, current, temp, amount, luminous).
 */
type DimVec = readonly [number, number, number, number, number, number, number];

const DIM_RESISTANCE: DimVec = [1, 2, -3, -2, 0, 0, 0]; // Ohm = kg m^2 s^-3 A^-2
const DIM_INDUCTANCE: DimVec = [1, 2, -2, -2, 0, 0, 0]; // H   = kg m^2 s^-2 A^-2
const DIM_CAPACITANCE: DimVec = [-1, -2, 4, 2, 0, 0, 0]; // F   = kg^-1 m^-2 s^4 A^2
const DIM_VOLTAGE: DimVec = [1, 2, -3, -1, 0, 0, 0]; // V   = kg m^2 s^-3 A^-1
const DIM_CURRENT: DimVec = [0, 0, 0, 1, 0, 0, 0]; // A
const DIM_POWER: DimVec = [1, 2, -3, 0, 0, 0, 0]; // W / VA / var
const DIM_FREQUENCY: DimVec = [0, 0, -1, 0, 0, 0, 0]; // Hz (cycles/s)
const DIM_TIME: DimVec = [0, 0, 1, 0, 0, 0, 0]; // s

interface UnitSpec {
  dim: DimVec;
  kind: string;
}

const UNIT_TABLE: Record<string, UnitSpec> = {
  ohm: { dim: DIM_RESISTANCE, kind: "resistance" },
  ohms: { dim: DIM_RESISTANCE, kind: "resistance" },
  mohm: { dim: DIM_RESISTANCE, kind: "resistance" },
  kohm: { dim: DIM_RESISTANCE, kind: "resistance" },
  h: { dim: DIM_INDUCTANCE, kind: "inductance" },
  mh: { dim: DIM_INDUCTANCE, kind: "inductance" },
  uh: { dim: DIM_INDUCTANCE, kind: "inductance" },
  f: { dim: DIM_CAPACITANCE, kind: "capacitance" },
  uf: { dim: DIM_CAPACITANCE, kind: "capacitance" },
  nf: { dim: DIM_CAPACITANCE, kind: "capacitance" },
  pf: { dim: DIM_CAPACITANCE, kind: "capacitance" },
  mf: { dim: DIM_CAPACITANCE, kind: "capacitance" },
  v: { dim: DIM_VOLTAGE, kind: "voltage" },
  kv: { dim: DIM_VOLTAGE, kind: "voltage" },
  mv: { dim: DIM_VOLTAGE, kind: "voltage" },
  a: { dim: DIM_CURRENT, kind: "current" },
  ka: { dim: DIM_CURRENT, kind: "current" },
  ma: { dim: DIM_CURRENT, kind: "current" },
  w: { dim: DIM_POWER, kind: "power" },
  kw: { dim: DIM_POWER, kind: "power" },
  mw: { dim: DIM_POWER, kind: "power" },
  va: { dim: DIM_POWER, kind: "power" },
  kva: { dim: DIM_POWER, kind: "power" },
  mva: { dim: DIM_POWER, kind: "power" },
  mvar: { dim: DIM_POWER, kind: "power" },
  hz: { dim: DIM_FREQUENCY, kind: "frequency" },
  khz: { dim: DIM_FREQUENCY, kind: "frequency" },
  "rad/s": { dim: DIM_FREQUENCY, kind: "angular-frequency" },
  s: { dim: DIM_TIME, kind: "time" },
  sec: { dim: DIM_TIME, kind: "time" },
  ms: { dim: DIM_TIME, kind: "time" },
  us: { dim: DIM_TIME, kind: "time" },
};

const EXPECTED_PARAM_KIND: Record<string, { dim: DimVec; kind: string }> = {
  r: { dim: DIM_RESISTANCE, kind: "resistance" },
  resistance: { dim: DIM_RESISTANCE, kind: "resistance" },
  l: { dim: DIM_INDUCTANCE, kind: "inductance" },
  inductance: { dim: DIM_INDUCTANCE, kind: "inductance" },
  c: { dim: DIM_CAPACITANCE, kind: "capacitance" },
  capacitance: { dim: DIM_CAPACITANCE, kind: "capacitance" },
  v: { dim: DIM_VOLTAGE, kind: "voltage" },
  vm: { dim: DIM_VOLTAGE, kind: "voltage" },
  vbase: { dim: DIM_VOLTAGE, kind: "voltage" },
  v_nom: { dim: DIM_VOLTAGE, kind: "voltage" },
  mva: { dim: DIM_POWER, kind: "power" },
  rated_mva: { dim: DIM_POWER, kind: "power" },
  p_mw: { dim: DIM_POWER, kind: "power" },
  f: { dim: DIM_FREQUENCY, kind: "frequency" },
  f0: { dim: DIM_FREQUENCY, kind: "frequency" },
  fsw: { dim: DIM_FREQUENCY, kind: "frequency" },
  fc: { dim: DIM_FREQUENCY, kind: "frequency" },
  ti: { dim: DIM_TIME, kind: "time" },
  td: { dim: DIM_TIME, kind: "time" },
  tau: { dim: DIM_TIME, kind: "time" },
};

function dimsEqual(a: DimVec, b: DimVec): boolean {
  for (let i = 0; i < 7; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * `M6071`: 7D SI physical dimensional consistency verifier for explicit PSCAD parameter unit tags
 * (e.g. catches `R = "10 [mH]"`, `f = "377 [rad/s]"`, `L = "50 [uF]"`, `Vbase = "100 [MVA]"`).
 */
export function verifyPscadDimensionalUnits(project: PscxProject): PscadDiagnostic[] {
  const diagnostics: PscadDiagnostic[] = [];
  const allModules = [project.rootModule, ...Array.from(project.subModules?.values() ?? [])];

  for (const mod of allModules) {
    for (const cmp of mod.components) {
      if (cmp.disabled) continue;
      for (const [paramName, rawVal] of Object.entries(cmp.parameters)) {
        if (typeof rawVal !== "string") continue;
        const unitMatch = /\[\s*([^\]]+?)\s*\]\s*$/.exec(rawVal);
        if (!unitMatch) continue;
        const unitRaw = unitMatch[1]!.trim();
        const unitLower = unitRaw.toLowerCase();
        if (unitLower === "pu" || unitLower === "p.u." || unitLower === "%") continue;

        const actual = UNIT_TABLE[unitLower];
        const expected = EXPECTED_PARAM_KIND[paramName.toLowerCase()];
        if (!actual || !expected) continue;

        if (!dimsEqual(actual.dim, expected.dim) || actual.kind !== expected.kind) {
          const pLoc = cmp.paramLocations?.[paramName];
          diagnostics.push({
            code: "M6071",
            rule: "dimensional-unit-mismatch",
            severity: "error",
            componentId: cmp.id,
            line: pLoc?.line ?? cmp.line,
            column: pLoc?.column ?? cmp.column,
            message: `Component '${cmp.instanceName || cmp.id}' parameter '${paramName}' has unit '[${unitRaw}]' (${actual.kind}), incompatible with expected physical dimension (${expected.kind}).`,
            rigor: "rigorous",
          });
        }
      }
    }
  }

  return diagnostics;
}
