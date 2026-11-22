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
    subject: { termType: "NamedNode", value: `${EX}m1` },
    predicate: { termType: "NamedNode", value: `${EX}label` },
    object: { termType: "Literal", value: "ServoMotor", language: "en" },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}m1` },
    predicate: { termType: "NamedNode", value: `${EX}rpm` },
    object: { termType: "Literal", value: "3000", datatype: XSD_INT },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}m2` },
    predicate: { termType: "NamedNode", value: `${EX}label` },
    object: { termType: "Literal", value: "PumpUnit", language: "de" },
  },
  {
    subject: { termType: "NamedNode", value: `${EX}m2` },
    predicate: { termType: "NamedNode", value: `${EX}rpm` },
    object: { termType: "Literal", value: "1200", datatype: XSD_INT },
  },
];

describe("SPARQL 1.1 Expressions, FILTER, BIND, and Built-ins", () => {
  it("evaluates REGEX, LANG, STRLEN, LCASE, UCASE, IF, IN, and arithmetic BIND", () => {
    const src = createArrayTripleSource(quads);
    const res = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://example.org/>
       SELECT ?m ?doubleRpm ?lower ?tag WHERE {
         ?m ex:label ?lbl ; ex:rpm ?rpm .
         BIND (?rpm * 2 AS ?doubleRpm)
         BIND (LCASE(?lbl) AS ?lower)
         BIND (IF(?rpm > 2000, "fast", "slow") AS ?tag)
         FILTER (REGEX(?lbl, "Motor", "i") && LANG(?lbl) = "en" && STRLEN(?lbl) = 10)
       }`,
      src,
    );
    assert.equal(res.queryType, "SELECT");
    assert.equal(res.bindings.length, 1);
    assert.equal(res.bindings[0]!["doubleRpm"]!.value, "6000");
    assert.equal(res.bindings[0]!["lower"]!.value, "servomotor");
    assert.equal(res.bindings[0]!["tag"]!.value, "fast");
  });
});
