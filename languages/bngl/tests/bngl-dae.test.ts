// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { bnglToModelica, bnglToSbmlXml, lowerBnglToDae, parseBngl } from "../src/index.js";

const DAE_BNGL = `
begin model BimolecularBinding
begin parameters
  A0 50.0
  B0 30.0
  k_f 0.02
  k_r 0.01
end parameters

begin compartments
  cell 3 1.0
end compartments

begin molecule types
  A(b)
  B(a)
end molecule types

begin seed species
  A(b) A0
  B(a) B0
end seed species

begin observables
  Molecules FreeA A(b)
  Molecules Dimer A(b!1).B(a!1)
end observables

begin reaction rules
  Bind: A(b) + B(a) <-> A(b!1).B(a!1) k_f, k_r
end reaction rules
end model
`;

test("BNGL DAE: lowers network equations into square DAEBuilder", () => {
  const doc = parseBngl(DAE_BNGL);
  const dae = lowerBnglToDae(doc);

  const vars = dae.variables();
  const eqs = dae.equations();

  assert.ok(vars.length >= 8, `Expected >= 8 variables, got ${vars.length}`);
  assert.equal(vars.length, eqs.length, `DAE must be square: ${vars.length} === ${eqs.length}`);
  assert.notEqual(dae.lookupVariable("obs_FreeA"), -1);
  assert.notEqual(dae.lookupVariable("obs_Dimer"), -1);
});

test("BNGL Projections: generates valid Modelica 3.x and SBML L3 XML", () => {
  const doc = parseBngl(DAE_BNGL);

  const mo = bnglToModelica(doc, "BimolecularModel");
  assert.ok(mo.includes("model BimolecularModel"));
  assert.ok(mo.includes("obs_FreeA"));
  assert.ok(mo.includes("obs_Dimer"));

  const xml = bnglToSbmlXml(doc);
  assert.ok(xml.includes('<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core"'));
  assert.ok(xml.includes('<model id="BimolecularBinding"'));
});
