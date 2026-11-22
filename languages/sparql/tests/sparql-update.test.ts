// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createArrayTripleSource, executeSparqlQuery, executeSparqlUpdate } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { parser } = await createWasmParser(path.resolve(__dirname, "../dist/parser.wasm"));

describe("SPARQL 1.1 Update Operations", () => {
  it("executes INSERT DATA, INSERT WHERE, DELETE/INSERT WHERE, and DELETE DATA", () => {
    const src = createArrayTripleSource([]);

    const r1 = executeSparqlUpdate(
      parser as any,
      `PREFIX ex: <http://example.org/> INSERT DATA { ex:n1 ex:state "cold" . ex:n2 ex:state "cold" . }`,
      src,
    );
    assert.equal(r1.insertedCount, 2);

    const r2 = executeSparqlUpdate(
      parser as any,
      `PREFIX ex: <http://example.org/> INSERT { ?s ex:ready "true" } WHERE { ?s ex:state "cold" }`,
      src,
    );
    assert.equal(r2.insertedCount, 2);

    const r3 = executeSparqlUpdate(
      parser as any,
      `PREFIX ex: <http://example.org/> DELETE DATA { ex:n2 ex:state "cold" . }`,
      src,
    );
    assert.equal(r3.deletedCount, 1);

    const check = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/> SELECT ?s WHERE { ?s ex:state "cold" }`,
      src,
    );
    assert.equal(check.queryType, "SELECT");
    assert.deepEqual(
      check.bindings.map((b) => b["s"]!.value),
      ["http://example.org/n1"],
    );
  });
});
