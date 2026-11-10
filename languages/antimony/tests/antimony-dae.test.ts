// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  antimonyToModelica,
  antimonyToSbmlXml,
  lowerAntimonyToDae,
  parseAntimony,
} from "../src/index.js";

const TEST_MODEL = `
model TwoStepPathway()
  compartment vol = 1.0;
  species S in vol = 20.0, I in vol = 0.0, P in vol = 0.0;
  const k1 = 0.5, k2 = 0.25;

  J1: S => I; k1 * S;
  J2: I => P; k2 * I;

  TotalSpecies := S + I + P;
end
`;

test("Antimony DAE Lowering: builds square DAE arena with continuous species ODEs", () => {
  const doc = parseAntimony(TEST_MODEL);
  const dae = lowerAntimonyToDae(doc);

  assert.ok(dae.variables().length >= 7);
  assert.equal(dae.variables().length, dae.equations().length, "DAE must be structurally square");

  assert.notEqual(dae.lookupVariable("S_S"), -1);
  assert.notEqual(dae.lookupVariable("S_I"), -1);
  assert.notEqual(dae.lookupVariable("S_P"), -1);
  assert.notEqual(dae.lookupVariable("v_J1"), -1);
  assert.notEqual(dae.lookupVariable("v_J2"), -1);
});

test("Antimony Projections: converts pathway model to Modelica 3.x and SBML L3 XML", () => {
  const doc = parseAntimony(TEST_MODEL);

  const mo = antimonyToModelica(doc, "TwoStepPathwayModel");
  assert.ok(mo.includes("model TwoStepPathwayModel"));
  assert.ok(mo.includes("Real S_S(start = 2.0000e+1)"));
  assert.ok(mo.includes("der(S_S)"));
  assert.ok(mo.includes("end TwoStepPathwayModel;"));

  const sbml = antimonyToSbmlXml(doc);
  assert.ok(sbml.includes("<sbml"));
  assert.ok(sbml.includes('id="TwoStepPathway"'));
  assert.ok(sbml.includes('id="J1"'));
  assert.ok(sbml.includes('id="J2"'));
});
