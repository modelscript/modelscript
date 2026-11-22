// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createArrayTripleSource, executeSparqlQuery, type SparqlQuad } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { parser } = await createWasmParser(path.resolve(__dirname, "../dist/parser.wasm"));

const EX = "http://example.org/";
const XSD_INT = "http://www.w3.org/2001/XMLSchema#integer";

const quads: SparqlQuad[] = [
  {
    subject: { termType: "NamedNode", value: `${EX}i1` },
    predicate: { termType: "NamedNode", value: `${EX}grp` },
    object: { termType: "Literal", value: "A" },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}i1` },
    predicate: { termType: "NamedNode", value: `${EX}val` },
    object: { termType: "Literal", value: "10", datatype: XSD_INT },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}i2` },
    predicate: { termType: "NamedNode", value: `${EX}grp` },
    object: { termType: "Literal", value: "A" },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}i2` },
    predicate: { termType: "NamedNode", value: `${EX}val` },
    object: { termType: "Literal", value: "30", datatype: XSD_INT },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}i3` },
    predicate: { termType: "NamedNode", value: `${EX}grp` },
    object: { termType: "Literal", value: "B" },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}i3` },
    predicate: { termType: "NamedNode", value: `${EX}val` },
    object: { termType: "Literal", value: "5", datatype: XSD_INT },
  },
];

describe("SPARQL 1.1 GROUP BY, HAVING, and Aggregates", () => {
  it("computes COUNT, SUM, AVG, MIN, MAX with GROUP BY and HAVING", () => {
    const src = createArrayTripleSource(quads);
    const res = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/>
       SELECT ?g (COUNT(?v) AS ?c) (SUM(?v) AS ?s) (AVG(?v) AS ?a) (MIN(?v) AS ?mn) (MAX(?v) AS ?mx)
       WHERE { ?i ex:grp ?g ; ex:val ?v }
       GROUP BY ?g
       HAVING (SUM(?v) > 10)`,
      src,
    );
    assert.equal(res.queryType, "SELECT");
    assert.equal(res.bindings.length, 1);
    const row = res.bindings[0]!;
    assert.equal(row["g"]!.value, "A");
    assert.equal(row["c"]!.value, "2");
    assert.equal(row["s"]!.value, "40");
    assert.equal(row["a"]!.value, "20");
    assert.equal(row["mn"]!.value, "10");
    assert.equal(row["mx"]!.value, "30");
  });
});
