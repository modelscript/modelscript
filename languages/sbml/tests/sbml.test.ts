// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  SbmlWorkspaceIndex,
  lintSbml,
  lowerSbmlToDae,
  parseSbml,
  sbmlToModelica,
  serializeSbml,
  solveReactions,
} from "../src/index.js";

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
      <reaction id="r2" reversible="false">
        <listOfReactants>
          <speciesReference species="ES" stoichiometry="1"/>
        </listOfReactants>
        <listOfProducts>
          <speciesReference species="P" stoichiometry="1"/>
          <speciesReference species="E" stoichiometry="1"/>
        </listOfProducts>
        <kineticLaw>
          <formula>k3 * ES</formula>
        </kineticLaw>
      </reaction>
    </listOfReactions>
  </model>
</sbml>`;

test("SBML Parser: parses enzymatic reaction network XML into structured AST", () => {
  const doc = parseSbml(VALID_SBML_MODEL, "enzyme.sbml");
  const m = doc.model;

  assert.equal(m.id, "EnzymeKinetics");
  assert.equal(m.name, "Michaelis-Menten Reaction Cascade");
  assert.equal(doc.level, 2);
  assert.equal(doc.version, 4);

  assert.equal(m.compartments.size, 1);
  const cyt = m.compartments.get("cytosol");
  assert.ok(cyt);
  assert.equal(cyt.size, 1.0);

  assert.equal(m.species.size, 4);
  assert.equal(m.species.get("S")?.initialConcentration, 10.0);
  assert.equal(m.species.get("E")?.initialConcentration, 2.0);
  assert.equal(m.species.get("P")?.initialConcentration, 0.0);

  assert.equal(m.parameters.size, 3);
  assert.equal(m.parameters.get("k1")?.value, 0.5);

  assert.equal(m.reactions.size, 2);
  const r1 = m.reactions.get("r1");
  assert.ok(r1);
  assert.equal(r1.reversible, true);
  assert.equal(r1.reactants.length, 2);
  assert.equal(r1.products.length, 1);
  assert.equal(r1.kineticLaw?.formula, "(k1 * S * E) - (k2 * ES)");

  const r2 = m.reactions.get("r2");
  assert.ok(r2);
  assert.equal(r2.reversible, false);
  assert.equal(r2.products.length, 2);
});

test("SBML Serializer: roundtrips AST into valid SBML XML", () => {
  const doc = parseSbml(VALID_SBML_MODEL);
  const xml = serializeSbml(doc);

  assert.ok(xml.includes('<model id="EnzymeKinetics"'));
  assert.ok(xml.includes('<compartment id="cytosol"'));
  assert.ok(xml.includes('<species id="S"'));
  assert.ok(xml.includes('<reaction id="r1"'));
  assert.ok(xml.includes("<formula>(k1 * S * E) - (k2 * ES)</formula>"));

  const reloaded = parseSbml(xml);
  assert.equal(reloaded.model.id, doc.model.id);
  assert.equal(reloaded.model.species.size, doc.model.species.size);
  assert.equal(reloaded.model.reactions.size, doc.model.reactions.size);
});

test("SBML Linter: valid model produces zero diagnostics", () => {
  const doc = parseSbml(VALID_SBML_MODEL);
  const diags = lintSbml(doc);

  const errors = diags.filter((d) => d.severity === "error");
  assert.equal(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
});

test("SBML Linter: detects missing model ID and negative compartment size", () => {
  const flawedXml = `<?xml version="1.0" encoding="UTF-8"?>
<sbml level="2" version="4">
  <model id="">
    <listOfCompartments>
      <compartment id="cytosol" size="-2.5"/>
    </listOfCompartments>
  </model>
</sbml>`;

  const doc = parseSbml(flawedXml);
  const diags = lintSbml(doc);

  const m8801 = diags.find((d) => d.code === 8801);
  assert.ok(m8801, "Expected M8801 missing model id");

  const m8804 = diags.find((d) => d.code === 8804);
  assert.ok(m8804, "Expected M8804 negative compartment size");
});

test("SBML Linter: detects undefined compartment, negative initial quantity, and empty reaction", () => {
  const flawedXml = `<?xml version="1.0" encoding="UTF-8"?>
<sbml level="2" version="4">
  <model id="FlawedModel">
    <listOfCompartments>
      <compartment id="cytosol" size="1.0"/>
    </listOfCompartments>
    <listOfSpecies>
      <species id="S" compartment="mitochondria" initialConcentration="-5.0"/>
    </listOfSpecies>
    <listOfReactions>
      <reaction id="emptyRxn" reversible="false"/>
    </listOfReactions>
  </model>
</sbml>`;

  const doc = parseSbml(flawedXml);
  const diags = lintSbml(doc);

  const m8802 = diags.find((d) => d.code === 8802);
  assert.ok(m8802, "Expected M8802 undefined compartment reference");

  const m8805 = diags.find((d) => d.code === 8805);
  assert.ok(m8805, "Expected M8805 negative initial quantity");

  const m8806 = diags.find((d) => d.code === 8806);
  assert.ok(m8806, "Expected M8806 empty reaction");
});

test("SBML Linter: detects undefined species in reaction and circular stoichiometry", () => {
  const flawedXml = `<?xml version="1.0" encoding="UTF-8"?>
<sbml level="2" version="4">
  <model id="CircModel">
    <listOfCompartments>
      <compartment id="cytosol" size="1.0"/>
    </listOfCompartments>
    <listOfSpecies>
      <species id="A" compartment="cytosol" initialConcentration="1.0"/>
    </listOfSpecies>
    <listOfReactions>
      <reaction id="badRxn">
        <listOfReactants>
          <speciesReference species="A" stoichiometry="1"/>
          <speciesReference species="Ghost" stoichiometry="1"/>
        </listOfReactants>
        <listOfProducts>
          <speciesReference species="A" stoichiometry="1"/>
        </listOfProducts>
      </reaction>
    </listOfReactions>
  </model>
</sbml>`;

  const doc = parseSbml(flawedXml);
  const diags = lintSbml(doc);

  const m8803 = diags.find((d) => d.code === 8803);
  assert.ok(m8803, "Expected M8803 undefined species reference (Ghost)");

  const m8810 = diags.find((d) => d.code === 8810);
  assert.ok(m8810, "Expected M8810 circular species assignment for A");
});

test("SBML Solver: simulates enzymatic reaction network ODEs with RK4", () => {
  const doc = parseSbml(VALID_SBML_MODEL);
  const res = solveReactions(doc, { duration: 10.0, timeStep: 0.01 });

  assert.equal(res.modelId, "EnzymeKinetics");
  assert.ok(res.stepsCount >= 100);

  // Substrate should decrease
  assert.ok(res.finalConcentrations["S"]! < res.initialConcentrations["S"]!);
  // Product should increase
  assert.ok(res.finalConcentrations["P"]! > 0);
  // Total enzyme conservation: [E] + [ES] approx constant
  const initEtot = res.initialConcentrations["E"]! + res.initialConcentrations["ES"]!;
  const finalEtot = res.finalConcentrations["E"]! + res.finalConcentrations["ES"]!;
  assert.ok(
    Math.abs(initEtot - finalEtot) < 0.05,
    `Enzyme conservation violated: init=${initEtot}, final=${finalEtot}`,
  );
});

test("SBML DAE Lowering: compiles species and reaction fluxes into DAEBuilder", () => {
  const doc = parseSbml(VALID_SBML_MODEL);
  const dae = lowerSbmlToDae(doc);

  assert.ok(dae.variables().length >= 8, "Expected at least 8 variables");
  assert.ok(dae.equations().length >= 6, "Expected at least 6 equations");

  assert.notEqual(dae.lookupVariable("S_S"), -1);
  assert.notEqual(dae.lookupVariable("S_E"), -1);
  assert.notEqual(dae.lookupVariable("S_ES"), -1);
  assert.notEqual(dae.lookupVariable("S_P"), -1);
  assert.notEqual(dae.lookupVariable("v_r1"), -1);
  assert.notEqual(dae.lookupVariable("V_cytosol"), -1);
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

test("SBML Workspace Index: indexes multi-file symbols accurately", () => {
  const index = new SbmlWorkspaceIndex();
  index.indexFile("file:///bio/enzyme.sbml", VALID_SBML_MODEL);

  assert.equal(index.fileCount, 1);
  const symbols = index.getSymbols("file:///bio/enzyme.sbml");
  assert.ok(symbols.length >= 8);

  const modelSym = index.findDefinition("EnzymeKinetics");
  assert.ok(modelSym);

  const sSym = index.findDefinition("S");
  assert.ok(sSym);
  assert.equal(sSym.name, "S");

  const rSym = index.findDefinition("r1");
  assert.ok(rSym);
  assert.equal(rSym.name, "r1");
});
