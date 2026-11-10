// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintSbol, parseSbol, SbolErrorCode } from "../src/index.js";

test("SBOL Linter: detects invalid nucleotide sequence (M9501)", () => {
  const xml = `
  <rdf:RDF xmlns:sbol="http://sbols.org/v3#">
    <sbol:Sequence displayId="seq_invalid" encoding="IUPAC_DNA">
      <sbol:elements>ATGCX99</sbol:elements>
    </sbol:Sequence>
  </rdf:RDF>`;
  const diags = lintSbol(parseSbol(xml));
  assert.ok(diags.some((d) => d.code === SbolErrorCode.INVALID_NUCLEOTIDE_SEQUENCE.code));
});

test("SBOL Linter: detects unresolved subcomponent reference (M9504)", () => {
  const xml = `
  <rdf:RDF xmlns:sbol="http://sbols.org/v3#">
    <sbol:Component displayId="tu1" role="SO:0000804">
      <sbol:SubComponent displayId="sub1" instanceOf="missing_part"/>
    </sbol:Component>
  </rdf:RDF>`;
  const diags = lintSbol(parseSbol(xml));
  assert.ok(diags.some((d) => d.code === SbolErrorCode.UNRESOLVED_SUBCOMPONENT_REFERENCE.code));
});

test("SBOL Linter: detects dangling interaction participant (M9506)", () => {
  const xml = `
  <rdf:RDF xmlns:sbol="http://sbols.org/v3#">
    <sbol:Component displayId="c1" role="SO:0000316"/>
    <sbol:Interaction displayId="int1" type="inhibition">
      <sbol:Participation participant="c1"/>
      <sbol:Participation participant="missing_species"/>
    </sbol:Interaction>
  </rdf:RDF>`;
  const diags = lintSbol(parseSbol(xml));
  assert.ok(diags.some((d) => d.code === SbolErrorCode.DANGLING_INTERACTION_PARTICIPANT.code));
});

test("SBOL Linter: detects circular component hierarchy (M9508)", () => {
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
  assert.ok(diags.some((d) => d.code === SbolErrorCode.CIRCULAR_COMPONENT_HIERARCHY.code));
});
