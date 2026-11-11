// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import {
  SEQUENCE_ONTOLOGY,
  SbolErrorCode,
  executeSbolAction,
  getSbolDocumentSymbols,
  getSbolHover,
  lintSbol,
  lowerSbolToDae,
  parseSbol,
  provideSbolCompletions,
  sbolLanguage,
  sbolToModelica,
  sbolToSbmlXml,
  serializeSbol,
  solveGeneticCircuit,
  validateSbol,
} from "../src/index.js";

const VALID_REPRESSILATOR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:sbol="http://sbols.org/v3#" xml:base="http://modelscript.org/sbol/repressilator#">
  <sbol:Sequence displayId="seq_TetR" encoding="IUPAC_DNA">
    <sbol:elements>ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG</sbol:elements>
  </sbol:Sequence>
  <sbol:Sequence displayId="seq_cI" encoding="IUPAC_DNA">
    <sbol:elements>ATGAAAGCAATTTTCGTACTGAAAGGTTGGTGGCGGTAA</sbol:elements>
  </sbol:Sequence>
</rdf:RDF>`;

const FULL_VALID_CIRCUIT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:sbol="http://sbols.org/v3#" xml:base="http://modelscript.org/sbol/repressilator#">
  <sbol:Sequence displayId="seq_tetR_tu" encoding="IUPAC_DNA">
    <sbol:elements>TTGACAAAGAGGAGAAATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAGTTTTTT</sbol:elements>
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
</rdf:RDF>`;

const TOGGLE_SWITCH_TURTLE = `
@prefix sbol: <http://sbols.org/v3#> .
@prefix SO: <https://identifiers.org/SO:> .
@prefix SBO: <https://identifiers.org/SBO:> .
@prefix : <http://modelscript.org/sbol/toggle#> .

:seq_LacI a sbol:Sequence ;
  sbol:displayId "seq_LacI" ;
  sbol:encoding "IUPAC_DNA" ;
  sbol:elements "ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG" .

:LacI a sbol:Component ;
  sbol:displayId "LacI" ;
  sbol:name "LacI Repressor" ;
  sbol:role SO:0000316 ;
  sbol:hasSequence :seq_LacI ;
  sbol:initialConcentration 3.0 ;
  sbol:basalRate 0.02 ;
  sbol:maxExpressionRate 10.0 ;
  sbol:degradationRate 1.0 .

:TetR a sbol:Component ;
  sbol:displayId "TetR" ;
  sbol:name "TetR Repressor" ;
  sbol:role SO:0000316 ;
  sbol:initialConcentration 0.1 ;
  sbol:basalRate 0.02 ;
  sbol:maxExpressionRate 10.0 ;
  sbol:degradationRate 1.0 .

:rep_LacI_on_TetR a sbol:Interaction ;
  sbol:displayId "rep_LacI_on_TetR" ;
  sbol:type SBO:0000169 ;
  sbol:K 1.0 ;
  sbol:n 2.5 ;
  sbol:alpha 10.0 ;
  sbol:hasParticipation [ sbol:participant :LacI ; sbol:role SBO:0000020 ] ;
  sbol:hasParticipation [ sbol:participant :TetR ; sbol:role SBO:0000642 ] .

:rep_TetR_on_LacI a sbol:Interaction ;
  sbol:displayId "rep_TetR_on_LacI" ;
  sbol:type SBO:0000169 ;
  sbol:K 1.0 ;
  sbol:n 2.5 ;
  sbol:alpha 10.0 ;
  sbol:hasParticipation [ sbol:participant :TetR ; sbol:role SBO:0000020 ] ;
  sbol:hasParticipation [ sbol:participant :LacI ; sbol:role SBO:0000642 ] .
`;

test("SBOL3 Parser: parses RDF/XML genetic circuit components, sequences, subcomponents, and SBO interactions", () => {
  const doc = parseSbol(FULL_VALID_CIRCUIT_XML, "repressilator.sbol");

  assert.equal(doc.namespace, "http://modelscript.org/sbol/repressilator#");
  assert.equal(doc.sequences.length, 1);
  assert.equal(doc.sequences[0]?.displayId, "seq_tetR_tu");
  assert.equal(doc.sequences[0]?.elements.length, 61);

  assert.equal(doc.components.length, 9);
  const tu = doc.components.find((c) => c.displayId === "tu_TetR");
  assert.ok(tu);
  assert.ok(tu.roles.includes(SEQUENCE_ONTOLOGY.ENGINEERED_REGION));
  assert.equal(tu.subComponents.length, 4);
  assert.equal(tu.subComponents[0]?.instanceOf, "pLac");
  assert.equal(tu.subComponents[2]?.start, 17);
  assert.equal(tu.subComponents[2]?.end, 55);

  assert.equal(doc.interactions.length, 3);
  assert.equal(doc.interactions[0]?.type, "inhibition");
  assert.equal(doc.interactions[0]?.parameters["n"], 3.5);
  assert.equal(doc.interactions[0]?.participants[0]?.roles[0], "inhibitor");
  assert.equal(doc.interactions[0]?.participants[1]?.roles[0], "inhibited");
});

test("SBOL3 Parser & Serializer: parses Turtle (.ttl) and roundtrips both XML and Turtle", () => {
  const doc = parseSbol(TOGGLE_SWITCH_TURTLE, "toggle.ttl");

  assert.equal(doc.namespace, "http://modelscript.org/sbol/toggle#");
  assert.equal(doc.components.length, 2);
  assert.equal(doc.sequences.length, 1);
  assert.equal(doc.interactions.length, 2);

  const xmlOut = serializeSbol(doc, "xml");
  assert.ok(xmlOut.includes('<sbol:Component displayId="LacI"'));
  assert.ok(xmlOut.includes('<sbol:Interaction displayId="rep_LacI_on_TetR"'));
  const reparsedXml = parseSbol(xmlOut);
  assert.equal(reparsedXml.components.length, 2);
  assert.equal(reparsedXml.interactions.length, 2);

  const ttlOut = serializeSbol(doc, "turtle");
  assert.ok(ttlOut.includes(":LacI a sbol:Component"));
  const reparsedTtl = parseSbol(ttlOut);
  assert.equal(reparsedTtl.components.length, 2);
  assert.equal(reparsedTtl.interactions.length, 2);
});

test("SBOL3 Linter: valid genetic circuit produces zero diagnostics", () => {
  const doc = parseSbol(FULL_VALID_CIRCUIT_XML);
  const diags = lintSbol(doc);
  assert.equal(diags.length, 0, JSON.stringify(diags));

  const validSeqDoc = parseSbol(VALID_REPRESSILATOR_XML);
  assert.equal(lintSbol(validSeqDoc).length, 0);
});

test("SBOL3 Linter M9501: detects non-IUPAC nucleotide characters in sequence", () => {
  const xml = `
  <rdf:RDF xmlns:sbol="http://sbols.org/v3#">
    <sbol:Sequence displayId="bad_seq" encoding="IUPAC_DNA">
      <sbol:elements>ATGBZTTCGA</sbol:elements>
    </sbol:Sequence>
  </rdf:RDF>`;
  const diags = lintSbol(parseSbol(xml));
  const m9501 = diags.find((d) => d.code === SbolErrorCode.INVALID_NUCLEOTIDE_SEQUENCE.code);
  assert.ok(m9501);
  assert.ok(m9501.message.includes("'bad_seq'"));
  assert.ok(m9501.message.includes("'B'"));
});

test("SBOL3 Linter M9502: detects sequence feature range out of bounds", () => {
  const xml = `
  <rdf:RDF xmlns:sbol="http://sbols.org/v3#">
    <sbol:Sequence displayId="short_seq" encoding="IUPAC_DNA">
      <sbol:elements>ATGCGATAA</sbol:elements>
    </sbol:Sequence>
    <sbol:Component displayId="comp1" hasSequence="short_seq">
      <sbol:SequenceFeature displayId="feat_oob" role="SO:0000167" start="1" end="25"/>
    </sbol:Component>
  </rdf:RDF>`;
  const diags = lintSbol(parseSbol(xml));
  const m9502 = diags.find((d) => d.code === SbolErrorCode.SEQUENCE_RANGE_OUT_OF_BOUNDS.code);
  assert.ok(m9502);
  assert.ok(m9502.message.includes("'feat_oob'"));
  assert.ok(m9502.message.includes("'[1..25]'"));
  assert.ok(m9502.message.includes("'9'"));
});

test("SBOL3 Linter M9503: detects CDS nucleotide length not divisible by 3", () => {
  const xml = `
  <rdf:RDF xmlns:sbol="http://sbols.org/v3#">
    <sbol:Sequence displayId="seq_frameshift" encoding="IUPAC_DNA">
      <sbol:elements>ATGGCCATAA</sbol:elements>
    </sbol:Sequence>
    <sbol:Component displayId="cds_frameshift" role="SO:0000316" hasSequence="seq_frameshift"/>
  </rdf:RDF>`;
  const diags = lintSbol(parseSbol(xml));
  const m9503 = diags.find((d) => d.code === SbolErrorCode.CDS_LENGTH_NOT_MULTIPLE_OF_THREE.code);
  assert.ok(m9503);
  assert.ok(m9503.message.includes("'cds_frameshift'"));
  assert.ok(m9503.message.includes("'10'"));
});

test("SBOL3 Linter M9504: detects unresolved SubComponent instanceOf reference", () => {
  const xml = `
  <rdf:RDF xmlns:sbol="http://sbols.org/v3#">
    <sbol:Component displayId="tu_broken" role="SO:0000804">
      <sbol:SubComponent displayId="sub_missing" instanceOf="non_existent_part"/>
    </sbol:Component>
  </rdf:RDF>`;
  const diags = lintSbol(parseSbol(xml));
  const m9504 = diags.find((d) => d.code === SbolErrorCode.UNRESOLVED_SUBCOMPONENT_REFERENCE.code);
  assert.ok(m9504);
  assert.ok(m9504.message.includes("'sub_missing'"));
  assert.ok(m9504.message.includes("'non_existent_part'"));
});

test("SBOL3 Linter M9505: detects terminator placed upstream of promoter without intervening CDS", () => {
  const xml = `
  <rdf:RDF xmlns:sbol="http://sbols.org/v3#">
    <sbol:Component displayId="tu_inverted" role="SO:0000804">
      <sbol:SequenceFeature displayId="term_early" role="SO:0000141" start="1" end="20"/>
      <sbol:SequenceFeature displayId="prom_late" role="SO:0000167" start="21" end="50"/>
    </sbol:Component>
  </rdf:RDF>`;
  const diags = lintSbol(parseSbol(xml));
  const m9505 = diags.find((d) => d.code === SbolErrorCode.INVALID_TRANSCRIPTIONAL_UNIT_ORDER.code);
  assert.ok(m9505);
  assert.ok(m9505.message.includes("'tu_inverted'"));
  assert.ok(m9505.message.includes("'term_early'"));
  assert.ok(m9505.message.includes("'prom_late'"));
});

test("SBOL3 Linter M9506 & M9507: detects dangling interaction participant and missing SBO role", () => {
  const xml = `
  <rdf:RDF xmlns:sbol="http://sbols.org/v3#">
    <sbol:Component displayId="TetR" role="SO:0000316"/>
    <sbol:Interaction displayId="int_broken" type="inhibition">
      <sbol:Participation participant="TetR"/>
      <sbol:Participation participant="GhostProtein" role="inhibited"/>
    </sbol:Interaction>
  </rdf:RDF>`;
  const diags = lintSbol(parseSbol(xml));
  const m9506 = diags.find((d) => d.code === SbolErrorCode.DANGLING_INTERACTION_PARTICIPANT.code);
  const m9507 = diags.find((d) => d.code === SbolErrorCode.MISSING_INTERACTION_ROLE.code);
  assert.ok(m9506);
  assert.ok(m9506.message.includes("'GhostProtein'"));
  assert.ok(m9507);
  assert.ok(m9507.message.includes("'TetR'"));
});

test("SBOL3 Linter M9508: detects circular SubComponent containment hierarchy", () => {
  const xml = `
  <rdf:RDF xmlns:sbol="http://sbols.org/v3#">
    <sbol:Component displayId="CompA" role="SO:0000804">
      <sbol:SubComponent displayId="sub_b" instanceOf="CompB"/>
    </sbol:Component>
    <sbol:Component displayId="CompB" role="SO:0000804">
      <sbol:SubComponent displayId="sub_a" instanceOf="CompA"/>
    </sbol:Component>
  </rdf:RDF>`;
  const diags = lintSbol(parseSbol(xml));
  const m9508 = diags.find((d) => d.code === SbolErrorCode.CIRCULAR_COMPONENT_HIERARCHY.code);
  assert.ok(m9508);
  assert.ok(m9508.message.includes("'CompA'"));
});

test("SBOL3 Linter M9509: detects duplicate displayId within the same namespace", () => {
  const xml = `
  <rdf:RDF xmlns:sbol="http://sbols.org/v3#" xml:base="http://example.org/sbol#">
    <sbol:Component displayId="dup_part" role="SO:0000167"/>
    <sbol:Component displayId="dup_part" role="SO:0000316"/>
  </rdf:RDF>`;
  const diags = lintSbol(parseSbol(xml));
  const m9509 = diags.find((d) => d.code === SbolErrorCode.DUPLICATE_DISPLAY_ID.code);
  assert.ok(m9509);
  assert.ok(m9509.message.includes("'dup_part'"));
});

test("SBOL3 Linter M9510: detects bacterial CDS lacking an upstream RBS (SO:0000139)", () => {
  const xml = `
  <rdf:RDF xmlns:sbol="http://sbols.org/v3#">
    <sbol:Component displayId="tu_no_rbs" role="SO:0000804">
      <sbol:SequenceFeature displayId="prom1" role="SO:0000167" start="1" end="10"/>
      <sbol:SequenceFeature displayId="cds_gfp" role="SO:0000316" start="11" end="40"/>
      <sbol:SequenceFeature displayId="term1" role="SO:0000141" start="41" end="55"/>
    </sbol:Component>
  </rdf:RDF>`;
  const diags = lintSbol(parseSbol(xml));
  const m9510 = diags.find((d) => d.code === SbolErrorCode.MISSING_CDS_RIBOSOME_BINDING_SITE.code);
  assert.ok(m9510);
  assert.ok(m9510.message.includes("'tu_no_rbs'"));
  assert.ok(m9510.message.includes("'cds_gfp'"));
});

test("SBOL3 Hill ODE Solver: simulates Elowitz-Leibler Repressilator oscillations and Collins Toggle Switch bistability", () => {
  // 1. Repressilator oscillation test
  const repDoc = parseSbol(FULL_VALID_CIRCUIT_XML);
  const repSim = solveGeneticCircuit(repDoc, { duration: 30.0, timeStep: 0.05 });

  assert.equal(repSim.speciesNames.length, 3);
  assert.ok(repSim.trajectory.length > 500);

  let minTetR = Infinity;
  let maxTetR = -Infinity;
  for (const step of repSim.trajectory.slice(100)) {
    const val = step.concentrations["TetR"] ?? 0;
    if (val < minTetR) minTetR = val;
    if (val > maxTetR) maxTetR = val;
  }
  assert.ok(maxTetR - minTetR > 1.0, `Expected Repressilator oscillation amplitude > 1.0, got ${maxTetR - minTetR}`);

  // 2. Collins Toggle Switch bistability test (LacI starts high, TetR starts low -> LacI stays high, TetR suppressed)
  const toggleDoc = parseSbol(TOGGLE_SWITCH_TURTLE);
  const stateHighLacI = solveGeneticCircuit(toggleDoc, {
    duration: 20.0,
    timeStep: 0.05,
    initialConcentrations: { LacI: 5.0, TetR: 0.1 },
  });
  assert.ok((stateHighLacI.finalConcentrations["LacI"] ?? 0) > 5.0);
  assert.ok((stateHighLacI.finalConcentrations["TetR"] ?? 0) < 0.5);

  // Flip initial conditions (TetR starts high, LacI starts low -> TetR stays high, LacI suppressed)
  const stateHighTetR = solveGeneticCircuit(toggleDoc, {
    duration: 20.0,
    timeStep: 0.05,
    initialConcentrations: { LacI: 0.1, TetR: 5.0 },
  });
  assert.ok((stateHighTetR.finalConcentrations["TetR"] ?? 0) > 5.0);
  assert.ok((stateHighTetR.finalConcentrations["LacI"] ?? 0) < 0.5);
});

test("SBOL3 DAE Lowering & Projections: compiles to DAEBuilder, Modelica 3.x, and SBML Level 3 XML", () => {
  const doc = parseSbol(TOGGLE_SWITCH_TURTLE);
  const dae = lowerSbolToDae(doc, { modelName: "CollinsToggleSwitch" });

  // For each of 2 species: P_i, alpha0_i, alpha_i, gamma_i, K_i_j_0, n_i_j_0, v_synth_i = 7 vars * 2 = 14 variables
  assert.equal(dae.variables().length, 14);
  assert.equal(dae.equations().length, 14);

  const mo = sbolToModelica(doc, "CollinsToggleSwitch");
  assert.ok(mo.includes("model CollinsToggleSwitch"));
  assert.ok(mo.includes("der(P_LacI) = v_synth_LacI - gamma_LacI * P_LacI;"));
  assert.ok(mo.includes("end CollinsToggleSwitch;"));

  const sbml = sbolToSbmlXml(doc, "CollinsToggleSwitch");
  assert.ok(sbml.includes('<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">'));
  assert.ok(sbml.includes('<species id="LacI"'));
  assert.ok(sbml.includes('<reaction id="synth_LacI"'));
  assert.ok(sbml.includes('<reaction id="deg_LacI"'));
});

test("SBOL3 UnifiedWorkspace & LSP: indexes symbols, validates, hovers, completes, and executes actions", async () => {
  const ws = new UnifiedWorkspace(sbolLanguage);
  const uri = "file:///workspace/toggle.ttl";

  ws.setDocument(uri, TOGGLE_SWITCH_TURTLE);
  assert.equal(ws.hasDocument(uri), true);
  assert.equal(ws.fileCount, 1);

  const symbols = ws.getSymbolsForUri(uri);
  assert.ok(symbols.length >= 5);
  const lacDef = ws.findSymbolsByName("LacI")[0];
  assert.ok(lacDef);
  assert.equal(lacDef.name, "LacI");
  assert.equal(ws.findSymbolsByName("LacI").length, 1);

  const lspSyms = getSbolDocumentSymbols(TOGGLE_SWITCH_TURTLE);
  assert.equal(lspSyms.length, 1);
  assert.ok((lspSyms[0]?.children?.length ?? 0) >= 4);

  const hover = getSbolHover(TOGGLE_SWITCH_TURTLE, { line: 11, character: 2 });
  assert.ok(hover);
  assert.ok(hover.contents.value.includes("SBOL3 Component: **LacI**"));

  const completions = provideSbolCompletions(TOGGLE_SWITCH_TURTLE);
  assert.ok(completions.some((c) => c.label === "SO:0000167"));
  assert.ok(completions.some((c) => c.label === "LacI"));

  const diags = validateSbol(TOGGLE_SWITCH_TURTLE);
  assert.equal(diags.length, 0);

  const daeInfo = await executeSbolAction("sbol_to_dae", TOGGLE_SWITCH_TURTLE, {
    modelName: "ToggleSwitch",
  });
  assert.equal(daeInfo.variableCount, 14);
  assert.equal(daeInfo.equationCount, 14);

  assert.equal(sbolLanguage.name, "sbol");
  assert.deepEqual(sbolLanguage.fileExtensions, [".sbol", ".ttl"]);
});
