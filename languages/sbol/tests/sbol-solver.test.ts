// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseSbol, solveGeneticCircuit } from "../src/index.js";

const TOGGLE_SWITCH_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:sbol="http://sbols.org/v3#">
  <sbol:Component displayId="LacI" name="LacI Repressor" role="SO:0000316" initialConcentration="4.0" basalRate="0.05" maxExpressionRate="12.0" degradationRate="1.0"/>
  <sbol:Component displayId="TetR" name="TetR Repressor" role="SO:0000316" initialConcentration="0.2" basalRate="0.05" maxExpressionRate="12.0" degradationRate="1.0"/>

  <sbol:Interaction displayId="rep_LacI_on_TetR" type="SBO:0000169" K="1.0" n="2.5" alpha="12.0">
    <sbol:Participation participant="LacI" role="SBO:0000020"/>
    <sbol:Participation participant="TetR" role="SBO:0000642"/>
  </sbol:Interaction>

  <sbol:Interaction displayId="rep_TetR_on_LacI" type="SBO:0000169" K="1.0" n="2.5" alpha="12.0">
    <sbol:Participation participant="TetR" role="SBO:0000020"/>
    <sbol:Participation participant="LacI" role="SBO:0000642"/>
  </sbol:Interaction>
</rdf:RDF>
`;

test("SBOL Solver: simulates bistable toggle switch dynamics", () => {
  const doc = parseSbol(TOGGLE_SWITCH_XML);
  const sim = solveGeneticCircuit(doc, { duration: 20.0, timeStep: 0.05 });

  assert.equal(sim.speciesNames.length, 2);
  assert.ok(sim.trajectory.length >= 400);

  // LacI starts high (4.0) vs TetR (0.2) -> LacI stays high, TetR suppressed
  const finalLacI = sim.finalConcentrations["LacI"] ?? 0;
  const finalTetR = sim.finalConcentrations["TetR"] ?? 0;

  assert.ok(finalLacI > 5.0, `Expected LacI high state (> 5.0), got ${finalLacI}`);
  assert.ok(finalTetR < 0.5, `Expected TetR suppressed state (< 0.5), got ${finalTetR}`);
});
