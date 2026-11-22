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
const quads: SparqlQuad[] = [
  {
    subject: { termType: "NamedNode", value: `${EX}a` },
    predicate: { termType: "NamedNode", value: `${EX}p` },
    object: { termType: "NamedNode", value: `${EX}x` },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}b` },
    predicate: { termType: "NamedNode", value: `${EX}q` },
    object: { termType: "NamedNode", value: `${EX}y` },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}c` },
    predicate: { termType: "NamedNode", value: `${EX}p` },
    object: { termType: "NamedNode", value: `${EX}z` },
    graph: { termType: "NamedNode", value: `${EX}g1` },
  },
];

describe("SPARQL 1.1 Subqueries, UNION, VALUES, GRAPH, DISTINCT, OFFSET", () => {
  it("evaluates UNION, VALUES, GRAPH, and DISTINCT/OFFSET/LIMIT", () => {
    const src = createArrayTripleSource(quads);

    const unionRes = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/>
       SELECT DISTINCT ?s WHERE { { ?s ex:p ?o } UNION { ?s ex:q ?o } }
       ORDER BY ASC(?s) OFFSET 1 LIMIT 2`,
      src,
    );
    assert.equal(unionRes.queryType, "SELECT");
    assert.deepEqual(
      unionRes.bindings.map((b) => b["s"]!.value),
      [`${EX}b`, `${EX}c`],
    );

    const valRes = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/>
       SELECT ?s ?o WHERE { ?s ex:p ?o . VALUES ?s { ex:a } }`,
      src,
    );
    assert.equal(valRes.queryType, "SELECT");
    assert.equal(valRes.bindings.length, 1);
    assert.equal(valRes.bindings[0]!["o"]!.value, `${EX}x`);

    const graphRes = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/>
       SELECT ?s WHERE { GRAPH ex:g1 { ?s ex:p ?o } }`,
      src,
    );
    assert.equal(graphRes.queryType, "SELECT");
    assert.deepEqual(
      graphRes.bindings.map((b) => b["s"]!.value),
      [`${EX}c`],
    );
  });
});
