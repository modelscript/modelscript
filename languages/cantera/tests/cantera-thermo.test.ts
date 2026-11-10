// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateArrheniusRate, evaluateNasa7Thermo, parseCantera } from "../src/index.js";

const VALID_H2O2_YAML = `description: "Hydrogen-Oxygen Combustion Submechanism"
phases:
- name: gas
  thermo: ideal-gas
  kinetics: gas
  elements: [O, H, Ar]
  species: [H2, O2, H2O, H, O, OH, HO2, H2O2, AR]
  state:
    T: 1200.0
    P: 101325.0
    X: {H2: 2.0, O2: 1.0, AR: 4.0}

species:
- name: H2O
  composition: {H: 2, O: 1}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [4.19864056, -2.0364341e-03, 6.52040211e-06, -5.48797062e-09, 1.77197817e-12, -30293.7267, -0.849032208]
    - [3.03399249, 2.17691804e-03, -1.64072518e-07, -9.7041987e-11, 1.68200992e-14, -30004.2971, 4.9667701]
`;

test("NASA-7 Thermo & Arrhenius Evaluator: computes accurate Cp, H, S, G and k(T)", () => {
  const doc = parseCantera(VALID_H2O2_YAML);
  const h2o = doc.mechanism.species.get("H2O")!;
  const th298 = evaluateNasa7Thermo(h2o.thermo!, 298.15);

  // Standard molar heat capacity of H2O(g) at 298.15 K is ~33.58 J/(mol*K)
  assert.ok(
    Math.abs(th298.cp_J_molK - 33.58) < 0.2,
    `Expected Cp(H2O, 298.15K) ~ 33.58 J/(mol*K), got ${th298.cp_J_molK}`,
  );
  // Standard enthalpy of formation of H2O(g) at 298.15 K is ~ -241.8 kJ/mol
  assert.ok(
    Math.abs(th298.h_J_mol / 1000.0 - -241.82) < 0.5,
    `Expected H(H2O, 298.15K) ~ -241.82 kJ/mol, got ${th298.h_J_mol / 1000.0}`,
  );
  // Standard entropy of H2O(g) at 298.15 K is ~ 188.8 J/(mol*K)
  assert.ok(
    Math.abs(th298.s_J_molK - 188.83) < 0.5,
    `Expected S(H2O, 298.15K) ~ 188.83 J/(mol*K), got ${th298.s_J_molK}`,
  );
  assert.ok(Math.abs(th298.g_J_mol - (th298.h_J_mol - 298.15 * th298.s_J_molK)) < 1e-6);

  const kVal = evaluateArrheniusRate({ A: 1.0e8, b: 0.5, Ea: 0.0 }, 1000.0);
  assert.ok(Math.abs(kVal - 1.0e8 * Math.sqrt(1000.0)) < 1e-3);
});
