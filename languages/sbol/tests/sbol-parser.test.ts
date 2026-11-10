// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseSbol, serializeSbol } from "../src/index.js";

const SIMPLE_SBOL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:sbol="http://sbols.org/v3#" xml:base="http://example.org/circuit#">
  <sbol:Sequence displayId="seq_cds" encoding="IUPAC_DNA">
    <sbol:elements>ATGAAAGCAATTTTCGTACTGAAAGGTTGGTGGCGGTAA</sbol:elements>
  </sbol:Sequence>
  <sbol:Component displayId="prom1" name="Constitutive Promoter" role="SO:0000167"/>
  <sbol:Component displayId="gfp" name="GFP Reporter" role="SO:0000316" hasSequence="seq_cds" initialConcentration="1.0"/>
  <sbol:Interaction displayId="prod_gfp" type="SBO:0000589">
    <sbol:Participation participant="gfp" role="SBO:0000011"/>
  </sbol:Interaction>
</rdf:RDF>
`;

test("SBOL Parser: parses components, sequences, and interactions", () => {
  const doc = parseSbol(SIMPLE_SBOL_XML, "simple.sbol.xml");

  assert.equal(doc.namespace, "http://example.org/circuit#");
  assert.equal(doc.sequences.length, 1);
  assert.equal(doc.sequences[0]?.displayId, "seq_cds");
  assert.equal(doc.components.length, 2);

  const gfp = doc.components.find((c) => c.displayId === "gfp")!;
  assert.ok(gfp);
  assert.equal(gfp.name, "GFP Reporter");
  assert.equal(gfp.initialConcentration, 1.0);

  assert.equal(doc.interactions.length, 1);
});

test("SBOL Serializer: serializes document to RDF/XML and roundtrips", () => {
  const doc = parseSbol(SIMPLE_SBOL_XML);
  const xml = serializeSbol(doc, "xml");

  assert.ok(xml.includes("<rdf:RDF"));
  assert.ok(xml.includes('displayId="seq_cds"'));
  assert.ok(xml.includes('displayId="gfp"'));

  const reparsed = parseSbol(xml);
  assert.equal(reparsed.sequences.length, 1);
  assert.equal(reparsed.components.length, 2);
  assert.equal(reparsed.interactions.length, 1);
});
