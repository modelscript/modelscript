// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  CanteraWorkspaceIndex,
  canteraLanguage,
  canteraToModelica,
  executeCanteraAction,
  getCanteraDocumentSymbols,
  getCanteraHover,
  lowerCanteraToDae,
  parseCantera,
  provideCanteraCompletions,
  validateCantera,
} from "../src/index.js";

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

test("Cantera DAE Lowering: compiles species concentrations and Arrhenius rates into DAEBuilder", () => {
  const doc = parseCantera(VALID_H2O2_YAML);
  const dae = lowerCanteraToDae(doc, { modelName: "H2O2Reactor" });

  assert.ok(dae.variables().length >= 18);
  assert.equal(dae.variables().length, dae.equations().length, "Expected structurally square DAE (N_vars == N_eqs)");

  assert.notEqual(dae.lookupVariable("R_gas"), -1);
  assert.notEqual(dae.lookupVariable("T"), -1);
  assert.notEqual(dae.lookupVariable("P"), -1);
  assert.notEqual(dae.lookupVariable("C_H2"), -1);
  assert.notEqual(dae.lookupVariable("C_O2"), -1);
  assert.notEqual(dae.lookupVariable("C_H2O"), -1);
  assert.notEqual(dae.lookupVariable("kf_R1"), -1);
  assert.notEqual(dae.lookupVariable("q_R1"), -1);
});

test("Cantera Modelica Projection, WorkspaceIndex, and LSP Services", async () => {
  const doc = parseCantera(VALID_H2O2_YAML);
  const mo = canteraToModelica(doc, "H2O2Combustion");
  assert.ok(mo.includes("model H2O2Combustion"));
  assert.ok(mo.includes("parameter Real R_gas ="));
  assert.ok(mo.includes("Real C_H2("));
  assert.ok(mo.includes("kf_R1 ="));
  assert.ok(mo.includes("der(C_H2O) ="));
  assert.ok(mo.includes("end H2O2Combustion;"));

  const index = new CanteraWorkspaceIndex();
  index.indexFile("file:///chem/h2o2.yaml", VALID_H2O2_YAML);
  assert.equal(index.fileCount, 1);
  assert.ok(index.findDefinition("H2O"));
  assert.ok(index.findDefinition("gas"));
  assert.ok(index.findDefinition("R1"));

  const lspDiags = validateCantera(VALID_H2O2_YAML);
  assert.equal(lspDiags.length, 0);

  const docSymbols = getCanteraDocumentSymbols(VALID_H2O2_YAML);
  assert.equal(docSymbols.length, 1);
  assert.ok((docSymbols[0]?.children?.length ?? 0) >= 10);

  const hover = getCanteraHover(VALID_H2O2_YAML, { line: 31, character: 8 });
  assert.ok(hover);
  assert.ok(hover.contents.value.includes("H2O"));

  const completions = provideCanteraCompletions(VALID_H2O2_YAML);
  assert.ok(completions.some((c) => c.label === "NASA7"));
  assert.ok(completions.some((c) => c.label === "H2O"));

  const daeSummary = await executeCanteraAction("cantera_to_dae", VALID_H2O2_YAML);
  assert.equal(daeSummary.variableCount, daeSummary.equationCount);
  assert.equal(canteraLanguage.name, "cantera");
});
