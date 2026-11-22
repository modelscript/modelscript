// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectSparqlQueryForm } from "../src/routes/sparql.js";

describe("SPARQL 1.1 Query Form Detection", () => {
  it("detects SELECT, ASK, CONSTRUCT, and DESCRIBE after comments, BASE, and PREFIX prologues", () => {
    assert.equal(detectSparqlQueryForm("SELECT ?s WHERE { ?s ?p ?o }"), "SELECT");
    assert.equal(
      detectSparqlQueryForm(`
# Leading comment
BASE <http://example.org/>
PREFIX mo: <https://modelica.org/ontology#>
# Another comment
ASK { ?s a mo:Class }
`),
      "ASK",
    );
    assert.equal(
      detectSparqlQueryForm(`
PREFIX mo: <https://modelica.org/ontology#>
CONSTRUCT { ?s mo:className ?n } WHERE { ?s mo:className ?n }
`),
      "CONSTRUCT",
    );
    assert.equal(detectSparqlQueryForm("DESCRIBE <urn:modelica:MSL:4.0.0:Resistor>"), "DESCRIBE");
    assert.equal(detectSparqlQueryForm("INSERT DATA { <a> <b> <c> }"), "UNKNOWN");
  });
});
