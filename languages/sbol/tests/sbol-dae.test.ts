// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerSbolToDae, parseSbol, sbolToModelica, sbolToSbmlXml } from "../src/index.js";

const DAE_SBOL = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:sbol="http://sbols.org/v3#">
  <sbol:Component displayId="A" name="Activator" role="SO:0000316" initialConcentration="1.0" basalRate="0.1" maxExpressionRate="5.0" degradationRate="0.5"/>
  <sbol:Component displayId="B" name="Repressed" role="SO:0000316" initialConcentration="2.0" basalRate="0.1" maxExpressionRate="5.0" degradationRate="0.5"/>

  <sbol:Interaction displayId="rep_A_B" type="SBO:0000169" K="1.5" n="2.0" alpha="5.0">
    <sbol:Participation participant="A" role="SBO:0000020"/>
    <sbol:Participation participant="B" role="SBO:0000642"/>
  </sbol:Interaction>
</rdf:RDF>
`;

test("SBOL DAE: lowers genetic circuit into square DAEBuilder arena", () => {
  const doc = parseSbol(DAE_SBOL);
  const dae = lowerSbolToDae(doc);

  const vars = dae.variables();
  const eqs = dae.equations();

  assert.ok(vars.length >= 4, `Expected >= 4 variables, got ${vars.length}`);
  assert.equal(vars.length, eqs.length, `DAE must be square: ${vars.length} === ${eqs.length}`);
  assert.notEqual(dae.lookupVariable("P_A"), -1);
  assert.notEqual(dae.lookupVariable("P_B"), -1);
});

test("SBOL Projections: exports valid Modelica and SBML Level 3 XML", () => {
  const doc = parseSbol(DAE_SBOL);

  const mo = sbolToModelica(doc, "GeneticDaeModel");
  assert.ok(mo.includes("model GeneticDaeModel"));
  assert.ok(mo.includes("Real P_A"));
  assert.ok(mo.includes("Real P_B"));

  const xml = sbolToSbmlXml(doc, "GeneticDaeModel");
  assert.ok(xml.includes("<sbml"));
  assert.ok(xml.includes('<species id="A"'));
});
