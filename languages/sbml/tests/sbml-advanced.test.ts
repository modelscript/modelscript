// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseSbml, simulateSbmlReactions } from "../src/index.js";

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

  assert.ok(
    Math.abs((res.finalConcentrations["Stot"] ?? 0) - 14.0) < 1e-6,
    `Expected Stot == 14.0 after bolus event, got ${res.finalConcentrations["Stot"]}`,
  );
  assert.ok(
    Math.abs((res.finalConcentrations["X"] ?? 0) - Math.exp(-2.5)) < 0.01,
    `Expected X(5) ~ exp(-2.5), got ${res.finalConcentrations["X"]}`,
  );
});
