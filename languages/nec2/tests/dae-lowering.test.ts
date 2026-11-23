// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IDaeBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerNec2ToDae, parseNec2Deck } from "../src/index.js";

describe("@modelscript/nec2 DAE Arena Lowering", () => {
  it("lowers a NEC-2 dipole into an equivalent series RLC resonant circuit in IDaeBuilder", () => {
    const variables: Array<{ name: string; type: number; variability: number; causality: number; startVal: number }> =
      [];
    const equations: Array<{ kind: number; lhs: number; rhs: number }> = [];

    const mockBuilder = {
      addVariable: (name: string, type: number, variability: number, causality: number, startVal: number) => {
        variables.push({ name, type, variability, causality, startVal });
        return variables.length - 1;
      },
      addEquation: (kind: number, lhs: number, rhs: number) => {
        equations.push({ kind, lhs, rhs });
        return equations.length - 1;
      },
      addBinaryExpr: () => 100 + equations.length,
      addUnaryExpr: () => 200,
      addRealLiteral: () => 300,
      addName: (varId: number) => 400 + varId,
      addDer: (varId: number) => 500 + varId,
      addIfElse: () => 600,
      lookupVariable: (name: string) => variables.findIndex((v) => v.name === name),
    } as unknown as IDaeBuilder;

    const deck = parseNec2Deck(`
CM Half-Wave Dipole for DAE Lowering
CE
GW 1 21 0 0 -0.25 0 0 0.25 0.001
GE 0
FR 0 1 0 0 300.0 0
EX 0 1 11 0 1.0 0.0
EN
`);

    const result = lowerNec2ToDae(mockBuilder, deck, { prefix: "dipole" });

    assert.strictEqual(result.stateVarIndices.length, 2, "Expected i_ant and v_cap continuous states");
    assert.strictEqual(result.equationCount, 4, "Expected 4 RLC + radiated power equations");

    const rRad = variables.find((v) => v.name === "dipole_R_rad");
    const lAnt = variables.find((v) => v.name === "dipole_L_ant");
    const cAnt = variables.find((v) => v.name === "dipole_C_ant");
    const iAnt = variables.find((v) => v.name === "dipole_i_ant");
    const vCap = variables.find((v) => v.name === "dipole_v_cap");

    assert.ok(rRad && rRad.startVal > 55 && rRad.startVal < 95, `Expected R_rad ~ 73 Ohm, got ${rRad?.startVal}`);
    assert.ok(lAnt && lAnt.startVal > 0, "Expected positive equivalent inductance L_ant");
    assert.ok(cAnt && cAnt.startVal > 0, "Expected positive equivalent capacitance C_ant");
    assert.ok(iAnt, "Expected dipole_i_ant state variable");
    assert.ok(vCap, "Expected dipole_v_cap state variable");

    // Verify RLC reactance at f0 matches extracted xAntOhm
    const omega0 = 2 * Math.PI * result.rlc.frequencyMhz * 1e6;
    const xRlc = omega0 * result.rlc.lAntH - 1 / (omega0 * result.rlc.cAntF);
    const relErr = Math.abs(xRlc - result.rlc.xAntOhm) / Math.max(1, Math.abs(result.rlc.xAntOhm));
    assert.ok(relErr < 1e-6, `Expected RLC reactance match, relErr=${relErr}`);
  });
});
