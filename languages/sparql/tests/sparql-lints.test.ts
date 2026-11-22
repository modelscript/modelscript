// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { lintSparqlDocument } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { parser } = await createWasmParser(path.resolve(__dirname, "../dist/parser.wasm"));

describe("SPARQL 1.1 Static Linter (S1001-S4001)", () => {
  it("emits S2001 undeclared prefix, S2002 duplicate prefix, S3001 unbound var, and S4001 disallowed SERVICE", () => {
    const q = `
PREFIX ex: <http://example.org/>
PREFIX ex: <http://example.org/dup#>
SELECT ?s ?ghost WHERE {
  ?s missing:pred ?o .
  SERVICE <http://remote.example/sparql> { ?s ex:p ?o }
}`;
    const tree = parser.parse(q);
    const diags = lintSparqlDocument(tree.rootNode as any, q, { disallowService: true });
    assert.ok(
      diags.some((d) => d.code === 2001),
      "Expected S2001",
    );
    assert.ok(
      diags.some((d) => d.code === 2002),
      "Expected S2002",
    );
    assert.ok(
      diags.some((d) => d.code === 3001),
      "Expected S3001",
    );
    assert.ok(
      diags.some((d) => d.code === 4001),
      "Expected S4001",
    );
  });
});
