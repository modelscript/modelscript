// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for Synthetic Biology Open Language (SBOL 3).
 *
 * Evaluates:
 * 1. Elowitz & Leibler Repressilator synthetic oscillatory genetic circuit
 * 2. Sequence Ontology (SO) feature hierarchy and Systems Biology Ontology (SBO) interactions
 * 3. Hill kinetics numerical integration & limit-cycle oscillation detection
 * 4. Lowering to structurally square DAEBuilder linear memory arena
 * 5. Projections to Modelica 3.x and SBML Level 3 XML
 */

import assert from "node:assert/strict";
import {
  lowerSbolToDae,
  parseSbol,
  sbolToModelica,
  sbolToSbmlXml,
  solveGeneticCircuit,
  type SbolDocument,
} from "../src/index.js";

export const SBOL_REPRESSILATOR_BENCHMARK = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:sbol="http://sbols.org/v3#" xml:base="http://modelscript.org/sbol/repressilator#">
  <sbol:Sequence displayId="seq_tetR_tu" encoding="IUPAC_DNA">
    <sbol:elements>TTGACAAAGAGGAGAAATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAGTTTTTT</sbol:elements>
  </sbol:Sequence>
  <sbol:Sequence displayId="seq_cI_tu" encoding="IUPAC_DNA">
    <sbol:elements>AATTGTGAGCGGATAACAATTTCACACAGGAATGAAAGCAATTTTCGTACTGAAAGGTTGGTGGCGGTAATTTTTT</sbol:elements>
  </sbol:Sequence>
  <sbol:Sequence displayId="seq_lacI_tu" encoding="IUPAC_DNA">
    <sbol:elements>TAATGTGAGTTAGCTCACTCATTAGGCACCCCAGGCTTTACACTTTATGCTTCCGGCTCGTATGTTGTGTGGTTTTTT</sbol:elements>
  </sbol:Sequence>

  <sbol:Component displayId="pLac" name="LacI-repressible promoter" role="SO:0000167"/>
  <sbol:Component displayId="rbs1" name="Strong bacterial RBS" role="SO:0000139"/>
  <sbol:Component displayId="TetR" name="Tetracycline repressor" role="SO:0000316" initialConcentration="2.5" basalRate="0.05" maxExpressionRate="15.0" degradationRate="1.0"/>
  <sbol:Component displayId="term1" name="Double terminator" role="SO:0000141"/>

  <sbol:Component displayId="pTet" name="TetR-repressible promoter" role="SO:0000167"/>
  <sbol:Component displayId="cI" name="Lambda repressor cI" role="SO:0000316" initialConcentration="0.1" basalRate="0.05" maxExpressionRate="15.0" degradationRate="1.0"/>

  <sbol:Component displayId="pCI" name="cI-repressible promoter" role="SO:0000167"/>
  <sbol:Component displayId="LacI" name="Lactose repressor" role="SO:0000316" initialConcentration="0.5" basalRate="0.05" maxExpressionRate="15.0" degradationRate="1.0"/>

  <sbol:Component displayId="tu_TetR" name="TetR Transcriptional Unit" role="SO:0000804" hasSequence="seq_tetR_tu">
    <sbol:SubComponent displayId="sub_pLac" instanceOf="pLac" start="1" end="6"/>
    <sbol:SubComponent displayId="sub_rbs1" instanceOf="rbs1" start="7" end="16"/>
    <sbol:SubComponent displayId="sub_TetR" instanceOf="TetR" start="17" end="55"/>
    <sbol:SubComponent displayId="sub_term1" instanceOf="term1" start="56" end="61"/>
  </sbol:Component>

  <sbol:Interaction displayId="rep_TetR_cI" type="SBO:0000169" K="1.0" n="3.5" alpha="15.0">
    <sbol:Participation participant="TetR" role="SBO:0000020"/>
    <sbol:Participation participant="cI" role="SBO:0000642"/>
  </sbol:Interaction>

  <sbol:Interaction displayId="rep_cI_LacI" type="SBO:0000169" K="1.0" n="3.5" alpha="15.0">
    <sbol:Participation participant="cI" role="SBO:0000020"/>
    <sbol:Participation participant="LacI" role="SBO:0000642"/>
  </sbol:Interaction>

  <sbol:Interaction displayId="rep_LacI_TetR" type="SBO:0000169" K="1.0" n="3.5" alpha="15.0">
    <sbol:Participation participant="LacI" role="SBO:0000020"/>
    <sbol:Participation participant="TetR" role="SBO:0000642"/>
  </sbol:Interaction>
</rdf:RDF>
`;

export interface SbolBenchmarkMetrics {
  componentsCount: number;
  sequencesCount: number;
  interactionsCount: number;
  speciesCount: number;
  trajectoryStepsCount: number;
  oscillationAmplitude: number;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
  modelicaLines: number;
  sbmlXmlBytes: number;
}

export function runSbolBenchmark(
  xml = SBOL_REPRESSILATOR_BENCHMARK,
): SbolBenchmarkMetrics {
  const doc: SbolDocument = parseSbol(xml, "repressilator.sbol.xml");

  assert.ok(doc.components.length >= 8);
  assert.equal(doc.sequences.length, 3);
  assert.equal(doc.interactions.length, 3);

  // 1. Solve genetic circuit ODEs (Hill kinetics)
  const sim = solveGeneticCircuit(doc, { duration: 40.0, timeStep: 0.05 });
  assert.equal(sim.speciesNames.length, 3);
  assert.ok(sim.trajectory.length >= 700);

  // Check Repressilator sustained limit cycle oscillation
  let minTetR = Infinity;
  let maxTetR = -Infinity;
  for (const step of sim.trajectory.slice(200)) {
    const conc = step.concentrations["TetR"] ?? 0;
    if (conc < minTetR) minTetR = conc;
    if (conc > maxTetR) maxTetR = conc;
  }
  const oscillationAmplitude = maxTetR - minTetR;
  assert.ok(
    oscillationAmplitude > 1.0,
    `Expected sustained oscillation amplitude > 1.0, got ${oscillationAmplitude}`,
  );

  // 2. Lower to DAEBuilder linear memory arena
  const dae = lowerSbolToDae(doc);
  const vars = dae.variables();
  const eqs = dae.equations();

  assert.ok(vars.length >= 6, `Expected >= 6 DAE variables, got ${vars.length}`);
  assert.equal(vars.length, eqs.length, `Expected square DAE: vars=${vars.length}, eqs=${eqs.length}`);

  // 3. Projections
  const mo = sbolToModelica(doc, "RepressilatorCircuit");
  assert.ok(mo.includes("model RepressilatorCircuit"));
  assert.ok(mo.includes("Real P_TetR"));
  assert.ok(mo.includes("der(P_TetR)"));

  const sbmlXml = sbolToSbmlXml(doc);
  assert.ok(sbmlXml.includes("<sbml"));
  assert.ok(sbmlXml.includes("TetR"));

  return {
    componentsCount: doc.components.length,
    sequencesCount: doc.sequences.length,
    interactionsCount: doc.interactions.length,
    speciesCount: sim.speciesNames.length,
    trajectoryStepsCount: sim.trajectory.length,
    oscillationAmplitude,
    daeVarCount: vars.length,
    daeEqCount: eqs.length,
    isSquare: vars.length === eqs.length,
    modelicaLines: mo.split("\n").length,
    sbmlXmlBytes: sbmlXml.length,
  };
}
