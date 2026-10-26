// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { executeSbmlAction, getSbmlDocumentSymbols, getSbmlHover, validateSbml } from "../src/index.js";

const VALID_SBML = `<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level2/version4" level="2" version="4">
  <model id="MetabolicLspTest" name="Metabolic Cycle Test">
    <listOfCompartments>
      <compartment id="cytosol" size="1.0"/>
    </listOfCompartments>
    <listOfSpecies>
      <species id="Glucose" compartment="cytosol" initialConcentration="5.0"/>
      <species id="G6P" compartment="cytosol" initialConcentration="0.0"/>
    </listOfSpecies>
    <listOfParameters>
      <parameter id="k_hexokinase" value="0.25"/>
    </listOfParameters>
    <listOfReactions>
      <reaction id="HexokinaseRxn" reversible="false">
        <listOfReactants>
          <speciesReference species="Glucose" stoichiometry="1"/>
        </listOfReactants>
        <listOfProducts>
          <speciesReference species="G6P" stoichiometry="1"/>
        </listOfProducts>
        <kineticLaw>
          <formula>k_hexokinase * Glucose</formula>
        </kineticLaw>
      </reaction>
    </listOfReactions>
  </model>
</sbml>`;

test("SBML LSP: validateSbml returns 0 diagnostics on clean document", () => {
  const diags = validateSbml(VALID_SBML);
  assert.equal(diags.length, 0);
});

test("SBML LSP: validateSbml returns diagnostics on flawed document", () => {
  const flawed = `<?xml version="1.0" encoding="UTF-8"?>
<sbml level="2" version="4">
  <model id="">
    <listOfCompartments>
      <compartment id="cytosol" size="-1.0"/>
    </listOfCompartments>
  </model>
</sbml>`;

  const diags = validateSbml(flawed);
  assert.ok(diags.length >= 2);
  assert.ok(diags.some((d) => d.code === "M8801"));
  assert.ok(diags.some((d) => d.code === "M8804"));
});

test("SBML LSP: getSbmlDocumentSymbols returns document symbols hierarchy", () => {
  const symbols = getSbmlDocumentSymbols(VALID_SBML);
  assert.equal(symbols.length, 1);
  const root = symbols[0]!;
  assert.equal(root.name, "MetabolicLspTest");
  assert.ok(root.children && root.children.length >= 3);
  assert.ok(root.children.some((c) => c.name === "Glucose"));
  assert.ok(root.children.some((c) => c.name === "HexokinaseRxn"));
});

test("SBML LSP: getSbmlHover returns markdown hover info for species and reactions", () => {
  const lines = VALID_SBML.split("\n");
  const glucLine = lines.findIndex((l) => l.includes('id="Glucose"'));
  assert.ok(glucLine >= 0);

  const hover = getSbmlHover(VALID_SBML, { line: glucLine, character: 10 });
  assert.ok(hover);
  assert.ok(hover.contents.value.includes("SBML Species: **Glucose**"));
  assert.ok(hover.contents.value.includes("cytosol"));
});

test("SBML LSP: executeSbmlAction executes solver and export actions", async () => {
  const simRes = await executeSbmlAction("sbml_simulate", VALID_SBML, {
    options: { duration: 5.0 },
  });
  assert.equal(simRes.modelId, "MetabolicLspTest");
  assert.ok(simRes.finalConcentrations["G6P"] > 0);

  const daeRes = await executeSbmlAction("sbml_to_dae", VALID_SBML);
  assert.ok(daeRes.variableCount >= 4);

  const moRes = await executeSbmlAction("sbml_to_modelica", VALID_SBML, {
    modelName: "MetabolicModel",
  });
  assert.ok(moRes.includes("model MetabolicModel"));
  assert.ok(moRes.includes("der(S_Glucose)"));
});
