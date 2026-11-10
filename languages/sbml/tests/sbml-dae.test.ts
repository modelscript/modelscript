// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerSbmlToDae, parseSbml, sbmlToModelica } from "../src/index.js";

const VALID_SBML_MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level2/version4" level="2" version="4">
  <model id="EnzymeKinetics" name="Michaelis-Menten Reaction Cascade">
    <listOfCompartments>
      <compartment id="cytosol" size="1.0" constant="true"/>
    </listOfCompartments>
    <listOfSpecies>
      <species id="S" compartment="cytosol" initialConcentration="10.0" constant="false"/>
      <species id="E" compartment="cytosol" initialConcentration="2.0" constant="false"/>
      <species id="ES" compartment="cytosol" initialConcentration="0.0" constant="false"/>
      <species id="P" compartment="cytosol" initialConcentration="0.0" constant="false"/>
    </listOfSpecies>
    <listOfParameters>
      <parameter id="k1" value="0.5" constant="true"/>
      <parameter id="k2" value="0.2" constant="true"/>
      <parameter id="k3" value="0.8" constant="true"/>
    </listOfParameters>
    <listOfReactions>
      <reaction id="r1" reversible="true">
        <listOfReactants>
          <speciesReference species="S" stoichiometry="1"/>
          <speciesReference species="E" stoichiometry="1"/>
        </listOfReactants>
        <listOfProducts>
          <speciesReference species="ES" stoichiometry="1"/>
        </listOfProducts>
        <kineticLaw>
          <formula>(k1 * S * E) - (k2 * ES)</formula>
        </kineticLaw>
      </reaction>
    </listOfReactions>
  </model>
</sbml>`;

test("SBML DAE Lowering: compiles species mass balances into DAEBuilder", () => {
  const doc = parseSbml(VALID_SBML_MODEL);
  const dae = lowerSbmlToDae(doc);

  assert.ok(dae.variables().length >= 8);
  assert.equal(dae.variables().length, dae.equations().length, "Expected structurally square DAE");

  assert.notEqual(dae.lookupVariable("S_S"), -1);
  assert.notEqual(dae.lookupVariable("S_E"), -1);
  assert.notEqual(dae.lookupVariable("v_r1"), -1);
});

test("SBML Modelica Projection: generates syntactically valid Modelica 3.x pathway", () => {
  const doc = parseSbml(VALID_SBML_MODEL);
  const mo = sbmlToModelica(doc, "MichaelisMentenPathway");

  assert.ok(mo.includes("model MichaelisMentenPathway"));
  assert.ok(mo.includes("parameter Real V_cytosol = 1.0000"));
  assert.ok(mo.includes("Real S_S(start = 1.0000e+1)"));
  assert.ok(mo.includes("Real v_r1"));
  assert.ok(mo.includes("der(S_S) = (- v_r1) / V_cytosol;"));
  assert.ok(mo.includes("end MichaelisMentenPathway;"));
});
