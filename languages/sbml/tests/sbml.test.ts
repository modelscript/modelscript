// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  SbmlErrorCode,
  SbmlWorkspaceIndex,
  lintSbml,
  lowerSbmlToDae,
  parseSbml,
  sbmlToModelica,
  serializeSbml,
  simulateSbmlGillespie,
  simulateSbmlReactions,
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
  assert.equal(dae.variables().length, dae.equations().length, "Expected structurally square DAE (N_vars == N_eqs)");

  assert.notEqual(dae.lookupVariable("S_S"), -1);
  assert.notEqual(dae.lookupVariable("S_E"), -1);
  assert.notEqual(dae.lookupVariable("S_ES"), -1);
  assert.notEqual(dae.lookupVariable("S_P"), -1);
  assert.notEqual(dae.lookupVariable("v_r1"), -1);
  assert.notEqual(dae.lookupVariable("V_cytosol"), -1);
});

test("SBML L3 localParameter parsing and M8809 undefined kinetic parameter lint", () => {
  const l3Model = `<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level3/version1/core" level="3" version="1">
  <model id="L3Test">
    <listOfCompartments>
      <compartment id="cell" size="1.0" constant="true"/>
    </listOfCompartments>
    <listOfSpecies>
      <species id="A" compartment="cell" initialConcentration="5.0"/>
      <species id="B" compartment="cell" initialConcentration="0.0"/>
    </listOfSpecies>
    <listOfReactions>
      <reaction id="rxn1" reversible="false">
        <listOfReactants>
          <speciesReference species="A" stoichiometry="1"/>
        </listOfReactants>
        <listOfProducts>
          <speciesReference species="B" stoichiometry="1"/>
        </listOfProducts>
        <kineticLaw>
          <math xmlns="http://www.w3.org/1998/Math/MathML">
            <apply><times/><ci>k_local</ci><ci>unknown_param</ci><ci>A</ci></apply>
          </math>
          <listOfLocalParameters>
            <localParameter id="k_local" value="0.25"/>
          </listOfLocalParameters>
        </kineticLaw>
      </reaction>
    </listOfReactions>
  </model>
</sbml>`;
  const doc = parseSbml(l3Model);
  const rxn1 = doc.model.reactions.get("rxn1")!;
  assert.ok(rxn1.kineticLaw?.parameters.has("k_local"), "Should parse <localParameter> in <listOfLocalParameters>");
  assert.equal(rxn1.kineticLaw?.parameters.get("k_local")?.value, 0.25);

  const diags = lintSbml(doc);
  assert.ok(
    diags.some((d) => d.code === SbmlErrorCode.UNDEFINED_KINETIC_PARAMETER.code && d.message.includes("unknown_param")),
  );
  assert.ok(
    !diags.some((d) => d.code === SbmlErrorCode.UNDEFINED_KINETIC_PARAMETER.code && d.message.includes("k_local")),
  );

  const dae = lowerSbmlToDae(doc);
  assert.equal(dae.variables().length, dae.equations().length);
  assert.notEqual(dae.lookupVariable("param_rxn1_k_local"), -1);
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

test("SBML Rules, Events, FunctionDefinitions, and Stiff Rosenbrock Integration", () => {
  const advancedSbml = `<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level2/version4" level="2" version="4">
  <model id="AdvancedPathway">
    <listOfFunctionDefinitions>
      <functionDefinition id="mm_rate">
        <math xmlns="http://www.w3.org/1998/Math/MathML">
          <lambda>
            <bvar><ci>vmax</ci></bvar>
            <bvar><ci>sub</ci></bvar>
            <bvar><ci>km</ci></bvar>
            <apply>
              <divide/>
              <apply><times/><ci>vmax</ci><ci>sub</ci></apply>
              <apply><plus/><ci>km</ci><ci>sub</ci></apply>
            </apply>
          </lambda>
        </math>
      </functionDefinition>
    </listOfFunctionDefinitions>
    <listOfCompartments>
      <compartment id="cell" size="1.0" constant="true"/>
    </listOfCompartments>
    <listOfSpecies>
      <species id="S" compartment="cell" initialConcentration="10.0" constant="false"/>
      <species id="P" compartment="cell" initialConcentration="0.0" constant="false"/>
      <species id="Stot" compartment="cell" initialConcentration="10.0" constant="false"/>
      <species id="X" compartment="cell" initialConcentration="1.0" boundaryCondition="true" constant="false"/>
    </listOfSpecies>
    <listOfParameters>
      <parameter id="Vmax" value="2.0" constant="false"/>
      <parameter id="Km" value="1.0" constant="true"/>
    </listOfParameters>
    <listOfRules>
      <assignmentRule variable="Stot">
        <math xmlns="http://www.w3.org/1998/Math/MathML">
          <apply><plus/><ci>S</ci><ci>P</ci></apply>
        </math>
      </assignmentRule>
      <rateRule variable="X">
        <math xmlns="http://www.w3.org/1998/Math/MathML">
          <apply><times/><cn>-0.5</cn><ci>X</ci></apply>
        </math>
      </rateRule>
    </listOfRules>
    <listOfReactions>
      <reaction id="enz_rxn" reversible="false">
        <listOfReactants>
          <speciesReference species="S" stoichiometry="1"/>
        </listOfReactants>
        <listOfProducts>
          <speciesReference species="P" stoichiometry="1"/>
        </listOfProducts>
        <kineticLaw>
          <math xmlns="http://www.w3.org/1998/Math/MathML">
            <apply><ci>mm_rate</ci><ci>Vmax</ci><ci>S</ci><ci>Km</ci></apply>
          </math>
        </kineticLaw>
      </reaction>
    </listOfReactions>
    <listOfEvents>
      <event id="bolus_event">
        <trigger>
          <math xmlns="http://www.w3.org/1998/Math/MathML">
            <apply><lt/><ci>S</ci><cn>5.0</cn></apply>
          </math>
        </trigger>
        <listOfEventAssignments>
          <eventAssignment variable="S">
            <math xmlns="http://www.w3.org/1998/Math/MathML">
              <apply><plus/><ci>S</ci><cn>4.0</cn></apply>
            </math>
          </eventAssignment>
        </listOfEventAssignments>
      </event>
    </listOfEvents>
  </model>
</sbml>`;

  const doc = parseSbml(advancedSbml);
  assert.equal(doc.model.functionDefinitions?.size, 1);
  assert.equal(doc.model.rules?.length, 2);
  assert.equal(doc.model.events?.length, 1);

  const res = simulateSbmlReactions(doc, {
    duration: 5.0,
    timeStep: 0.02,
    method: "rosenbrock",
  });

  // Event added +4.0 to S when S dropped below 5.0, so Stot = S + P should now be 14.0
  assert.ok(
    Math.abs((res.finalConcentrations["Stot"] ?? 0) - 14.0) < 1e-6,
    `Expected Stot == 14.0 after bolus event, got ${res.finalConcentrations["Stot"]}`,
  );
  // Rate rule dX/dt = -0.5 * X => X(5) = exp(-2.5) ~ 0.082085
  assert.ok(
    Math.abs((res.finalConcentrations["X"] ?? 0) - Math.exp(-2.5)) < 0.01,
    `Expected X(5) ~ ${Math.exp(-2.5)}, got ${res.finalConcentrations["X"]}`,
  );
});

test("SBML Gillespie SSA: exact discrete stochastic simulation conserves moiety counts", () => {
  const doc = parseSbml(VALID_SBML_MODEL);
  // Scale initial amounts to discrete molecule counts
  doc.model.species.get("S")!.initialAmount = 100;
  doc.model.species.get("E")!.initialAmount = 20;
  doc.model.species.get("ES")!.initialAmount = 0;
  doc.model.species.get("P")!.initialAmount = 0;
  for (const s of doc.model.species.values()) {
    s.initialConcentration = undefined;
  }

  const ssa = simulateSbmlGillespie(doc, { duration: 5.0, seed: 12345 });
  assert.ok(ssa.stepsCount > 0, "Expected positive number of discrete SSA reaction firings");
  assert.ok((ssa.reactionCounts["r1"] ?? 0) > 0);
  assert.ok((ssa.reactionCounts["r2"] ?? 0) > 0);

  // Exact integer conservation of total enzyme (E + ES == 20) and substrate moiety (S + ES + P == 100)
  const totalEnzyme = (ssa.finalCounts["E"] ?? 0) + (ssa.finalCounts["ES"] ?? 0);
  const totalSubstrate = (ssa.finalCounts["S"] ?? 0) + (ssa.finalCounts["ES"] ?? 0) + (ssa.finalCounts["P"] ?? 0);
  assert.equal(totalEnzyme, 20);
  assert.equal(totalSubstrate, 100);
  assert.ok((ssa.finalCounts["P"] ?? 0) > 0);
});
