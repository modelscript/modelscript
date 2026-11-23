// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IDaeBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerGaussianToDae, parseGaussianInput } from "../src/index.js";

function createMockDaeBuilder() {
  const variables: Array<{ name: string; type: number; variability: number; causality: number; startVal: number }> = [];
  const equations: Array<{ kind: number; lhs: number; rhs: number }> = [];
  let exprCounter = 1000;

  const builder = {
    addVariable: (name: string, type: number, variability: number, causality: number, startVal: number) => {
      variables.push({ name, type, variability, causality, startVal });
      return variables.length - 1;
    },
    addEquation: (kind: number, lhs: number, rhs: number) => {
      equations.push({ kind, lhs, rhs });
      return equations.length - 1;
    },
    addBinaryExpr: () => ++exprCounter,
    addUnaryExpr: () => ++exprCounter,
    addRealLiteral: () => ++exprCounter,
    addName: (varId: number) => 100 + varId,
    addDer: (varId: number) => 500 + varId,
    lookupVariable: (name: string) => variables.findIndex((v) => v.name === name),
  } as unknown as IDaeBuilder;

  return { builder, variables, equations };
}

describe("@modelscript/gaussian — DAE Lowering (Molecular Mechanics & Vibrational Normal Modes)", () => {
  it("lowers Water (H2O) 3N-6 = 3 harmonic vibrational modes and inertia invariants into IDaeBuilder", () => {
    const waterGjf = `#p B3LYP/6-31G(d) freq

Water vibrational DAE lowering

0 1
O
H 1 0.9572
H 1 0.9572 2 104.52
`;
    const doc = parseGaussianInput(waterGjf);
    const job = doc.jobs[0]!;
    const { builder, variables, equations } = createMockDaeBuilder();

    const result = lowerGaussianToDae(builder, job, { initialAmplitude: 0.02 });

    assert.equal(result.atoms.length, 3);
    assert.equal(result.normalModes.vibrationalModes.length, 3, "Water (nonlinear, N=3) has 3N-6 = 3 modes");
    // 2 states (Q_k, v_k) per vibrational mode = 6 states
    assert.equal(result.stateVarIndices.length, 6);
    // 3 equations per mode (der(Q), der(v), E_mode) + 1 total energy equation = 10 equations
    assert.equal(result.equationCount, 10);
    assert.equal(equations.length, 10);

    // B3LYP ZPE scale factor from cleanroom stdlib
    assert.ok(Math.abs(result.zpeScaleFactor - 0.9614) < 1e-6);

    // Check molecular mass parameter (~18.015 amu)
    const massVar = variables.find((v) => v.name === "mol_total_mass_amu");
    assert.ok(massVar && Math.abs(massVar.startVal - 18.01528) < 1e-3);

    // Check O-H equilibrium bond parameters
    const ohBond1 = variables.find((v) => v.name === "r0_bond_1_2");
    const ohBond2 = variables.find((v) => v.name === "r0_bond_1_3");
    assert.ok(ohBond1 && Math.abs(ohBond1.startVal - 0.9572) < 1e-6);
    assert.ok(ohBond2 && Math.abs(ohBond2.startVal - 0.9572) < 1e-6);

    // Check vibrational frequencies are positive physical values (bending + symmetric/antisymmetric stretches)
    for (const freq of result.normalModes.frequenciesCm1) {
      assert.ok(freq > 500 && freq < 5000, `Expected physical H2O frequency in cm^-1, got ${freq}`);
    }
    assert.ok(result.normalModes.zeroPointEnergyKcalMol > 5.0);
  });

  it("lowers Methane (CH4) 3N-6 = 9 harmonic vibrational modes with optional modal damping", () => {
    const methaneGjf = `# HF/6-31G(d) freq

Methane tetrahedral DAE lowering

0 1
C
H 1 1.089
H 1 1.089 2 109.471220634
H 1 1.089 2 109.471220634 3 120.0
H 1 1.089 2 109.471220634 3 -120.0
`;
    const doc = parseGaussianInput(methaneGjf);
    const { builder } = createMockDaeBuilder();
    const result = lowerGaussianToDae(builder, doc.jobs[0]!, { damping: 0.05 });

    assert.equal(result.normalModes.vibrationalModes.length, 9, "Methane (N=5, nonlinear) has 3*5-6 = 9 modes");
    assert.equal(result.stateVarIndices.length, 18);
    assert.equal(result.equationCount, 28); // 9 * 3 + 1
    assert.ok(Math.abs(result.zpeScaleFactor - 0.8953) < 1e-6);
  });
});
