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
    predicate: { termType: "NamedNode", value: `${EX}next` },
    object: { termType: "NamedNode", value: `${EX}b` },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}b` },
    predicate: { termType: "NamedNode", value: `${EX}next` },
    object: { termType: "NamedNode", value: `${EX}c` },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}c` },
    predicate: { termType: "NamedNode", value: `${EX}alt` },
    object: { termType: "NamedNode", value: `${EX}d` },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}a` },
    predicate: { termType: "NamedNode", value: `${EX}tag` },
    object: { termType: "Literal", value: "root" },
  },
];

describe("SPARQL 1.1 Property Paths", () => {
  it("evaluates +, *, ?, ^, /, |, and !(...) property paths", () => {
    const src = createArrayTripleSource(quads);

    const star = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> SELECT ?x WHERE { ex:a ex:next* ?x }`,
      src,
    );
    assert.equal(star.queryType, "SELECT");
    assert.deepEqual(star.bindings.map((b) => b["x"]!.value).sort(), [`${EX}a`, `${EX}b`, `${EX}c`]);

    const inv = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> SELECT ?x WHERE { ex:c ^ex:next+ ?x }`,
      src,
    );
    assert.equal(inv.queryType, "SELECT");
    assert.deepEqual(inv.bindings.map((b) => b["x"]!.value).sort(), [`${EX}a`, `${EX}b`]);

    const seq = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> SELECT ?x WHERE { ex:a ex:next/ex:next/ex:alt ?x }`,
      src,
    );
    assert.equal(seq.queryType, "SELECT");
    assert.deepEqual(
      seq.bindings.map((b) => b["x"]!.value),
      [`${EX}d`],
    );

    const alt = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> SELECT ?x WHERE { ex:c (ex:next|ex:alt) ?x }`,
      src,
    );
    assert.equal(alt.queryType, "SELECT");
    assert.deepEqual(
      alt.bindings.map((b) => b["x"]!.value),
      [`${EX}d`],
    );

    const qmark = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> SELECT ?x WHERE { ex:a ex:next? ?x }`,
      src,
    );
    assert.equal(qmark.queryType, "SELECT");
    assert.deepEqual(qmark.bindings.map((b) => b["x"]!.value).sort(), [`${EX}a`, `${EX}b`]);

    const neg = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> SELECT ?x WHERE { ex:a !ex:next ?x }`,
      src,
    );
    assert.equal(neg.queryType, "SELECT");
    assert.deepEqual(
      neg.bindings.map((b) => b["x"]!.value),
      ["root"],
    );
  });
});
