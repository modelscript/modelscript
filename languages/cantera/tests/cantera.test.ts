// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  CanteraErrorCode,
  CanteraWorkspaceIndex,
  canteraLanguage,
  canteraToModelica,
  evaluateArrheniusRate,
  evaluateNasa7Thermo,
  executeCanteraAction,
  getCanteraDocumentSymbols,
  getCanteraHover,
  lintCantera,
  lowerCanteraToDae,
  parseCantera,
  provideCanteraCompletions,
  serializeCantera,
  solveCanteraReactor,
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

test("Cantera YAML Parser: parses phases, NASA-7 species, and elementary/three-body/falloff reactions", () => {
  const doc = parseCantera(VALID_H2O2_YAML, "h2o2.yaml");
  assert.equal(doc.format, "yaml");

  const mech = doc.mechanism;
  assert.equal(mech.name, "gas");
  assert.equal(mech.phases.size, 1);

  const gas = mech.phases.get("gas");
  assert.ok(gas);
  assert.equal(gas.thermo, "ideal-gas");
  assert.equal(gas.kinetics, "gas");
  assert.deepEqual(gas.elements, ["O", "H", "Ar"]);
  assert.equal(gas.species.length, 9);
  assert.equal(gas.state?.T, 1200.0);
  assert.equal(gas.state?.P, 101325.0);
  assert.equal(gas.state?.X?.["H2"], 2.0);

  assert.equal(mech.species.size, 9);
  const h2o = mech.species.get("H2O");
  assert.ok(h2o);
  assert.deepEqual(h2o.composition, { H: 2, O: 1 });
  assert.ok(h2o.thermo);
  assert.equal(h2o.thermo.model, "NASA7");
  assert.equal(h2o.thermo.Tmin, 200.0);
  assert.equal(h2o.thermo.Tmid, 1000.0);
  assert.equal(h2o.thermo.Tmax, 3500.0);
  assert.equal(h2o.thermo.lowCoeffs.length, 7);
  assert.equal(h2o.thermo.highCoeffs.length, 7);

  assert.equal(mech.reactions.length, 3);
  const r1 = mech.reactions[0]!;
  assert.equal(r1.type, "elementary");
  assert.equal(r1.reversible, true);
  assert.deepEqual(r1.reactants, [
    { species: "H2", stoichiometry: 2 },
    { species: "O2", stoichiometry: 1 },
  ]);
  assert.deepEqual(r1.products, [{ species: "H2O", stoichiometry: 2 }]);
  assert.equal(r1.rateConstant.A, 2.5e3);
  assert.equal(r1.rateConstant.Ea, 45000.0);

  const r2 = mech.reactions[1]!;
  assert.equal(r2.type, "three-body");
  assert.equal(r2.efficiencies?.["H2O"], 12.0);

  const r3 = mech.reactions[2]!;
  assert.equal(r3.type, "falloff");
  assert.ok(r3.lowRateConstant);
  assert.ok(r3.troe);
  assert.equal(r3.troe.A, 0.7346);
  assert.equal(r3.troe.T3, 94.0);
  assert.equal(r3.troe.T1, 1756.0);
  assert.equal(r3.troe.T2, 5182.0);
});

test("Cantera CTI Parser & YAML Serializer: parses legacy .cti and roundtrips YAML", () => {
  const ctiText = `
ideal_gas(name = "cti_gas", elements = "H O", species = "H2 O2 H2O")
species(name = "H2", atoms = "H:2",
        thermo = (NASA([200.0, 1000.0], [3.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
                  NASA([1000.0, 3500.0], [3.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])))
species(name = "O2", atoms = "O:2",
        thermo = (NASA([200.0, 1000.0], [3.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
                  NASA([1000.0, 3500.0], [3.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])))
species(name = "H2O", atoms = "H:2 O:1",
        thermo = (NASA([200.0, 1000.0], [4.0, 0.0, 0.0, 0.0, 0.0, -30000.0, 0.0]),
                  NASA([1000.0, 3500.0], [4.0, 0.0, 0.0, 0.0, 0.0, -30000.0, 0.0])))
reaction("2 H2 + O2 <=> 2 H2O", [1.0e5, 0.0, 20000.0])
`;
  const ctiDoc = parseCantera(ctiText, "mech.cti");
  assert.equal(ctiDoc.format, "cti");
  assert.equal(ctiDoc.mechanism.species.size, 3);
  assert.equal(ctiDoc.mechanism.reactions.length, 1);

  const yamlOut = serializeCantera(ctiDoc);
  const reloaded = parseCantera(yamlOut, "mech.yaml");
  assert.equal(reloaded.mechanism.species.size, 3);
  assert.equal(reloaded.mechanism.reactions.length, 1);
  assert.equal(reloaded.mechanism.reactions[0]?.equation, "2 H2 + O2 <=> 2 H2O");
});

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

test("Cantera Linter: valid H2/O2 mechanism produces zero diagnostics", () => {
  const doc = parseCantera(VALID_H2O2_YAML);
  const diags = lintCantera(doc);
  assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
});

test("Cantera Linter: triggers all 10 diagnostic rules M9201 through M9210", () => {
  const flawedYaml = `
phases:
- name: gas
  thermo: ideal-gas
  elements: [H, O]
  species: [H2, O2, H2O, H3O+, OH-, BadBoundsSp, DiscontSp, NoThermoSp, GhostPhaseSp]

species:
- name: H2
  composition: {H: 2}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [3.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    - [3.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
- name: O2
  composition: {O: 2}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [3.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    - [3.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
- name: H2O
  composition: {H: 2, O: 1}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [4.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    - [4.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
- name: H3O+
  composition: {H: 3, O: 1}
  charge: 1
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [4.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    - [4.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
- name: OH-
  composition: {H: 1, O: 1}
  charge: -1
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [3.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    - [3.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
- name: BadBoundsSp
  composition: {H: 1}
  thermo:
    model: NASA7
    temperature-ranges: [1200.0, 1000.0, 800.0]
    data:
    - [2.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    - [2.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
- name: DiscontSp
  composition: {O: 1}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [2.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    - [9.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
- name: NoThermoSp
  composition: {H: 1}

reactions:
- equation: H2 + O2 <=> H2O
  rate-constant: {A: 1.0e+05, b: 0.0, Ea: 1000.0}
- equation: 2 H2O <=> H3O+ + OH-
  rate-constant: {A: 1.0e+05, b: 0.0, Ea: 1000.0}
- equation: H3O+ + OH- <=> H2O + H3O+
  rate-constant: {A: 1.0e+05, b: 0.0, Ea: 1000.0}
- equation: H2 + UnknownSp <=> H2O
  rate-constant: {A: 1.0e+05, b: 0.0, Ea: 1000.0}
- equation: 2 H2 + O2 <=> 2 H2O
  rate-constant: {A: -50.0, b: 0.0, Ea: 1000.0}
- equation: 2 H2 + O2 <=> 2 H2O
  rate-constant: {A: 1.0e+05, b: 0.0, Ea: 2000.0}
- equation: H2 + O2 (+M) <=> H2O2 (+M)
  type: falloff
  rate-constant: {A: 1.0e+05, b: 0.0, Ea: 1000.0}
  efficiencies: {H2: -1.5}
`;

  const doc = parseCantera(flawedYaml);
  const diags = lintCantera(doc);
  const codes = new Set(diags.map((d) => d.code));

  assert.ok(codes.has(CanteraErrorCode.ELEMENT_BALANCE_VIOLATION.code), "Expected M9201");
  assert.ok(codes.has(CanteraErrorCode.CHARGE_BALANCE_VIOLATION.code), "Expected M9202");
  assert.ok(codes.has(CanteraErrorCode.UNDECLARED_PHASE_SPECIES.code), "Expected M9203");
  assert.ok(codes.has(CanteraErrorCode.NASA7_TEMPERATURE_DISCONTINUITY.code), "Expected M9204");
  assert.ok(codes.has(CanteraErrorCode.INVALID_NASA7_TEMPERATURE_BOUNDS.code), "Expected M9205");
  assert.ok(codes.has(CanteraErrorCode.NEGATIVE_PRE_EXPONENTIAL_FACTOR.code), "Expected M9206");
  assert.ok(codes.has(CanteraErrorCode.MISSING_FALLOFF_LOW_PRESSURE_LIMIT.code), "Expected M9207");
  assert.ok(codes.has(CanteraErrorCode.DUPLICATE_REACTION_DECLARATION.code), "Expected M9208");
  assert.ok(codes.has(CanteraErrorCode.NEGATIVE_THIRD_BODY_EFFICIENCY.code), "Expected M9209");
  assert.ok(codes.has(CanteraErrorCode.MISSING_SPECIES_THERMO.code), "Expected M9210");
});

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
