// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { WasmOntologyReasoner } from "@modelscript/runtime";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createArrayTripleSource,
  createOntologyReasonerSource,
  executeSparqlQuery,
  executeSparqlUpdate,
  lintSparqlDocument,
  type SparqlQuad,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
const { parser } = await createWasmParser(wasmPath);

const EX = "http://example.org/";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD_INT = "http://www.w3.org/2001/XMLSchema#integer";

const sampleQuads: SparqlQuad[] = [
  {
    subject: { termType: "NamedNode", value: `${EX}p1` },
    predicate: { termType: "NamedNode", value: RDF_TYPE },
    object: { termType: "NamedNode", value: `${EX}Pump` },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}p1` },
    predicate: { termType: "NamedNode", value: `${EX}name` },
    object: { termType: "Literal", value: "Primary Pump", language: "en" },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}p1` },
    predicate: { termType: "NamedNode", value: `${EX}power` },
    object: { termType: "Literal", value: "120", datatype: XSD_INT },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}p1` },
    predicate: { termType: "NamedNode", value: `${EX}feeds` },
    object: { termType: "NamedNode", value: `${EX}v1` },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}v1` },
    predicate: { termType: "NamedNode", value: RDF_TYPE },
    object: { termType: "NamedNode", value: `${EX}Valve` },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}v1` },
    predicate: { termType: "NamedNode", value: `${EX}power` },
    object: { termType: "Literal", value: "30", datatype: XSD_INT },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}v1` },
    predicate: { termType: "NamedNode", value: `${EX}feeds` },
    object: { termType: "NamedNode", value: `${EX}t1` },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}t1` },
    predicate: { termType: "NamedNode", value: RDF_TYPE },
    object: { termType: "NamedNode", value: `${EX}Tank` },
  },
];

describe("First-Class @modelscript/sparql WASM GLR Language & Execution Engine", () => {
  it("executes SELECT with PREFIX, OPTIONAL, FILTER, BIND, ORDER BY, and LIMIT", () => {
    const source = createArrayTripleSource(sampleQuads);
    const query = `
PREFIX ex: <http://example.org/>
SELECT ?dev ?power ?label WHERE {
  ?dev ex:power ?power .
  OPTIONAL { ?dev ex:name ?label }
  FILTER (?power >= 30)
}
ORDER BY DESC(?power)
LIMIT 5
`;
    const res = executeSparqlQuery(parser as any, query, source);
    assert.equal(res.queryType, "SELECT");
    assert.equal(res.bindings.length, 2);
    assert.equal(res.bindings[0]!["dev"]!.value, `${EX}p1`);
    assert.equal(res.bindings[0]!["label"]!.value, "Primary Pump");
    assert.equal(res.json.results.bindings[0]!["label"]!["xml:lang"], "en");
    assert.equal(res.bindings[1]!["dev"]!.value, `${EX}v1`);
    assert.equal(res.bindings[1]!["label"], undefined);
  });

  it("evaluates SPARQL 1.1 Property Paths (+, *, ^, /, |) and ASK/CONSTRUCT/DESCRIBE", () => {
    const source = createArrayTripleSource(sampleQuads);

    const plusRes = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> SELECT ?dst WHERE { ex:p1 ex:feeds+ ?dst }`,
      source,
    );
    assert.equal(plusRes.queryType, "SELECT");
    const dsts = plusRes.bindings.map((b) => b["dst"]!.value).sort();
    assert.deepEqual(dsts, [`${EX}t1`, `${EX}v1`]);

    const askRes = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> ASK { ex:p1 ex:feeds+ ex:t1 }`,
      source,
    );
    assert.equal(askRes.queryType, "ASK");
    assert.equal(askRes.boolean, true);

    const constructRes = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> CONSTRUCT { ?s ex:reaches ?o } WHERE { ?s ex:feeds+ ?o }`,
      source,
    );
    assert.equal(constructRes.queryType, "CONSTRUCT");
    assert.equal(constructRes.quads.length, 3);

    const descRes = executeSparqlQuery(parser as any, `PREFIX ex: <http://example.org/> DESCRIBE ex:p1`, source);
    assert.equal(descRes.queryType, "DESCRIBE");
    assert.equal(descRes.quads.length, 4);
  });

  it("evaluates GROUP BY, COUNT, SUM, UNION, MINUS, and VALUES", () => {
    const source = createArrayTripleSource(sampleQuads);
    const aggRes = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> SELECT (COUNT(?d) AS ?cnt) (SUM(?p) AS ?total) WHERE { ?d ex:power ?p }`,
      source,
    );
    assert.equal(aggRes.queryType, "SELECT");
    assert.equal(aggRes.bindings[0]!["cnt"]!.value, "2");
    assert.equal(aggRes.bindings[0]!["total"]!.value, "150");

    const minusRes = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> SELECT ?d WHERE { ?d a ?t . MINUS { ?d ex:power ?p } }`,
      source,
    );
    assert.equal(minusRes.queryType, "SELECT");
    assert.deepEqual(
      minusRes.bindings.map((b) => b["d"]!.value),
      [`${EX}t1`],
    );
  });

  it("queries inferred triples directly from WasmOntologyReasoner", () => {
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      { type: "SubClassOf", subClassIri: "http://example.org/ServoMotor", superClassIri: "http://example.org/Motor" },
      { type: "ClassAssertion", classIri: "http://example.org/ServoMotor", individualIri: "http://example.org/m1" },
    ]);
    const source = createOntologyReasonerSource(reasoner);
    const res = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> SELECT ?x WHERE { ?x a ex:Motor }`,
      source,
    );
    assert.equal(res.queryType, "SELECT");
    assert.deepEqual(
      res.bindings.map((b) => b["x"]!.value),
      ["http://example.org/m1"],
    );
  });

  it("rejects federated SERVICE clauses at the AST/algebra level and lints undeclared prefixes / unbound vars", () => {
    const source = createArrayTripleSource(sampleQuads);
    const serviceQuery = `SELECT ?s WHERE { SERVICE <http://evil.example/sparql> { ?s ?p ?o } }`;
    assert.throws(
      () => executeSparqlQuery(parser as any, serviceQuery, source, { disallowService: true }),
      /SERVICE clauses are not permitted/,
    );

    const tree = parser.parse(`SELECT ?s ?unused WHERE { ?s unknown:prop ?o }`);
    const diags = lintSparqlDocument(tree.rootNode as any, `SELECT ?s ?unused WHERE { ?s unknown:prop ?o }`);
    assert.ok(
      diags.some((d) => d.code === 2001),
      "Expected S2001 undeclared prefix",
    );
    assert.ok(
      diags.some((d) => d.code === 3001),
      "Expected S3001 unbound select variable",
    );
  });

  it("supports SubSelect, negated property sets, generalized Leapfrog Triejoin triangles, and SPARQL 1.1 Update", () => {
    const source = createArrayTripleSource([
      ...sampleQuads,
      {
        subject: { termType: "NamedNode", value: `${EX}t1` },
        predicate: { termType: "NamedNode", value: `${EX}feeds` },
        object: { termType: "NamedNode", value: `${EX}p1` },
      },
    ]);

    // 1. Generalized Leapfrog Triejoin on a 3-node cyclic triangle (?x feeds ?y . ?y feeds ?z . ?z feeds ?x)
    const triRes = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> SELECT ?x ?y ?z WHERE { ?x ex:feeds ?y . ?y ex:feeds ?z . ?z ex:feeds ?x }`,
      source,
    );
    assert.equal(triRes.queryType, "SELECT");
    assert.equal(triRes.bindings.length, 3);

    // 2. SubSelect
    const subRes = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> SELECT ?dev ?p WHERE { { SELECT ?dev ?p WHERE { ?dev ex:power ?p } ORDER BY DESC(?p) LIMIT 1 } }`,
      source,
    );
    assert.equal(subRes.queryType, "SELECT");
    assert.equal(subRes.bindings.length, 1);
    assert.equal(subRes.bindings[0]!["dev"]!.value, `${EX}p1`);

    // 3. Negated property set !(a|ex:feeds)
    const negRes = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> SELECT ?o WHERE { ex:p1 !(a|ex:feeds) ?o }`,
      source,
    );
    assert.equal(negRes.queryType, "SELECT");
    assert.equal(negRes.bindings.length, 2); // ex:name and ex:power

    // 4. SPARQL 1.1 Update (INSERT DATA, DELETE/INSERT WHERE, DELETE DATA)
    const insRes = executeSparqlUpdate(
      parser as any,
      `PREFIX ex: <http://example.org/> INSERT DATA { ex:sensor1 a ex:Sensor ; ex:status "init" . }`,
      source,
    );
    assert.equal(insRes.insertedCount, 2);

    const modRes = executeSparqlUpdate(
      parser as any,
      `PREFIX ex: <http://example.org/> DELETE { ?s ex:status "init" } INSERT { ?s ex:status "active" } WHERE { ?s ex:status "init" }`,
      source,
    );
    assert.equal(modRes.deletedCount, 1);
    assert.equal(modRes.insertedCount, 1);

    const checkRes = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> ASK { ex:sensor1 ex:status "active" }`,
      source,
    );
    assert.equal(checkRes.queryType, "ASK");
    assert.equal(checkRes.boolean, true);
  });
});
