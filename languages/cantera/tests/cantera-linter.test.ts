// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { CanteraErrorCode, lintCantera, parseCantera } from "../src/index.js";

const FLAWED_YAML = `
phases:
- name: gas
  thermo: ideal-gas
  elements: [H, O, Xe]
  species: [H2, O2, H2O, H3O+, OH-, BadBoundsSp, DiscontSp, NoThermoSp, GhostPhaseSp]

species:
- name: H2
  composition: {H: 2}
  transport:
    model: gas
    geometry: linear
    diameter: -2.92
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
  rate-constant: {A: 1.0e+05, b: 0.0, Ea: -120000.0}
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

test("Cantera Linter: triggers all 13 diagnostic rules M9201 through M9213", () => {
  const doc = parseCantera(FLAWED_YAML);
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
  assert.ok(codes.has(CanteraErrorCode.ACTIVATION_ENERGY_OUT_OF_BOUNDS.code), "Expected M9211");
  assert.ok(codes.has(CanteraErrorCode.TRANSPORT_COLLISION_DIAMETER_NEGATIVE.code), "Expected M9212");
  assert.ok(codes.has(CanteraErrorCode.UNREFERENCED_ELEMENT_DECLARATION.code), "Expected M9213");
});
