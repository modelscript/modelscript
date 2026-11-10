// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseCantera, solveCanteraReactor } from "../src/index.js";

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
- name: H2
  composition: {H: 2}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [2.34433112, 7.98052075e-03, -1.9478151e-05, 2.01572094e-08, -7.37611761e-12, -917.935173, 0.683010238]
    - [3.3372792, -4.94024731e-05, 4.99456778e-07, -1.79566394e-10, 2.00255376e-14, -950.158922, -3.20502331]
- name: O2
  composition: {O: 2}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [3.78245636, -2.99673416e-03, 9.84730201e-06, -9.68129509e-09, 3.24372837e-12, -1063.94356, 3.65767573]
    - [3.28253784, 1.48308754e-03, -7.57966669e-07, 2.09470555e-10, -2.16717794e-14, -1088.45772, 5.45323129]
- name: H2O
  composition: {H: 2, O: 1}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [4.19864056, -2.0364341e-03, 6.52040211e-06, -5.48797062e-09, 1.77197817e-12, -30293.7267, -0.849032208]
    - [3.03399249, 2.17691804e-03, -1.64072518e-07, -9.7041987e-11, 1.68200992e-14, -30004.2971, 4.9667701]
- name: H
  composition: {H: 1}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [2.5, 0.0, 0.0, 0.0, 0.0, 25473.66, -0.44668285]
    - [2.5, 0.0, 0.0, 0.0, 0.0, 25473.66, -0.44668285]
- name: O
  composition: {O: 1}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [2.5, 0.0, 0.0, 0.0, 0.0, 29150.0, 4.92]
    - [2.5, 0.0, 0.0, 0.0, 0.0, 29150.0, 4.92]
- name: OH
  composition: {O: 1, H: 1}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [3.5, 0.0, 0.0, 0.0, 0.0, 3600.0, 2.1]
    - [3.5, 0.0, 0.0, 0.0, 0.0, 3600.0, 2.1]
- name: HO2
  composition: {H: 1, O: 2}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [4.0, 0.0, 0.0, 0.0, 0.0, 250.0, 3.0]
    - [4.0, 0.0, 0.0, 0.0, 0.0, 250.0, 3.0]
- name: H2O2
  composition: {H: 2, O: 2}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [4.5, 0.0, 0.0, 0.0, 0.0, -17700.0, 3.5]
    - [4.5, 0.0, 0.0, 0.0, 0.0, -17700.0, 3.5]
- name: AR
  composition: {Ar: 1}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [2.5, 0.0, 0.0, 0.0, 0.0, -745.375, 4.37967491]
    - [2.5, 0.0, 0.0, 0.0, 0.0, -745.375, 4.37967491]

reactions:
- equation: 2 H2 + O2 <=> 2 H2O
  type: elementary
  rate-constant: {A: 2.5e+03, b: 0.0, Ea: 45000.0}
- equation: H + O2 + M <=> HO2 + M
  type: three-body
  rate-constant: {A: 1.5e+02, b: -0.8, Ea: 0.0}
  efficiencies: {H2: 2.5, H2O: 12.0, AR: 0.7}
- equation: 2 OH (+M) <=> H2O2 (+M)
  type: falloff
  rate-constant: {A: 7.4e+04, b: -0.37, Ea: 0.0}
  low-P-rate-constant: {A: 2.3e+06, b: -0.9, Ea: -7100.0}
  Troe: {A: 0.7346, T3: 94.0, T1: 1756.0, T2: 5182.0}
  efficiencies: {H2: 2.0, H2O: 6.0}
`;

test("Cantera Batch Reactor Solver: integrates H2/O2 kinetics and conserves atomic elements", () => {
  const doc = parseCantera(VALID_H2O2_YAML);
  const res = solveCanteraReactor(doc, {
    temperature: 1200.0,
    pressure: 101325.0,
    duration: 0.01,
    timeStep: 0.0001,
    energy: "adiabatic",
  });

  assert.equal(res.mechanismName, "gas");
  assert.equal(res.stepsCount, 100);

  // H2 and O2 should react to form H2O
  assert.ok(res.finalConcentrations["H2"]! < res.initialConcentrations["H2"]!);
  assert.ok(res.finalConcentrations["O2"]! < res.initialConcentrations["O2"]!);
  assert.ok(res.finalConcentrations["H2O"]! > res.initialConcentrations["H2O"]!);

  // Exothermic H2 + O2 -> H2O increases temperature in adiabatic reactor
  assert.ok(res.finalTemperature > 1200.0);

  // Exact conservation of H, O, and Ar atomic totals
  for (const el of ["H", "O", "Ar"]) {
    const initEl = res.elementTotalsInitial[el] ?? 0;
    const finalEl = res.elementTotalsFinal[el] ?? 0;
    assert.ok(Math.abs(initEl - finalEl) < 1e-9, `Element ${el} not conserved: initial=${initEl}, final=${finalEl}`);
  }
});
