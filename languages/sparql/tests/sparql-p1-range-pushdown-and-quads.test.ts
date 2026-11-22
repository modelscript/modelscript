// SPDX-License-Identifier: AGPL-3.0-or-later

import { PagedStorageEngine, type PagedWasmExports } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createPagedStorageSource, executeSparqlAlgebra } from "../src/engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeWasmPath = path.resolve(__dirname, "../../../packages/runtime/build/release.wasm");

async function loadPagedWasm(): Promise<PagedWasmExports> {
  const bytes = fs.readFileSync(runtimeWasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      abort: () => {
        throw new Error("WASM abort");
      },
      seed: () => Date.now(),
    },
  });
  return instance.exports as unknown as PagedWasmExports;
}

describe("P1: PagedStorageEngine Numeric Range Pushdown & Named Graph Quads", () => {
  it("pushes FILTER numeric ranges (including negative-to-positive and decimals) directly to B+Tree POS index scans", async () => {
    const wasm = await loadPagedWasm();
    const engine = new PagedStorageEngine(wasm, 512);

    const TEMP = "http://ex.org/temp";
    const PRESS = "http://ex.org/pressure";
    const XSD_INT = "http://www.w3.org/2001/XMLSchema#integer";
    const XSD_DEC = "http://www.w3.org/2001/XMLSchema#decimal";

    // Insert 1,000 integer temperatures (-500 .. +499) and 200 fixed-point decimals (-10.0 .. +9.9)
    for (let i = -500; i < 500; i++) {
      engine.insertTriple(`http://ex.org/sensor_${i}`, TEMP, engine.encodeLiteral(i));
    }
    for (let i = -100; i < 100; i++) {
      const dec = i / 10; // exact 1e-3 representable
      engine.insertTriple(`http://ex.org/gauge_${i}`, PRESS, engine.encodeLiteral(dec));
    }

    const source = createPagedStorageSource(engine);
    assert.ok(source.matchNumericRange, "createPagedStorageSource must expose matchNumericRange");

    // 1. Range crossing zero: [-5, 5] inclusive -> 11 sensors (with unary minus in FILTER!)
    const r1 = executeSparqlAlgebra(
      {
        queryType: "SELECT",
        prefixes: {},
        variables: ["s", "t"],
        where: {
          kind: "group",
          patterns: [
            {
              kind: "bgp",
              triples: [
                {
                  subject: { termType: "Variable", value: "s" },
                  predicate: { termType: "NamedNode", value: TEMP },
                  object: { termType: "Variable", value: "t" },
                },
              ],
            },
            {
              kind: "filter",
              expr: {
                kind: "binary",
                op: "&&",
                left: {
                  kind: "binary",
                  op: ">=",
                  left: { kind: "term", term: { termType: "Variable", value: "t" } },
                  right: {
                    kind: "unary",
                    op: "-",
                    arg: { kind: "term", term: { termType: "Literal", value: "5", datatype: XSD_INT } },
                  },
                },
                right: {
                  kind: "binary",
                  op: "<=",
                  left: { kind: "term", term: { termType: "Variable", value: "t" } },
                  right: { kind: "term", term: { termType: "Literal", value: "5", datatype: XSD_INT } },
                },
              },
            },
          ],
        },
        modifier: {
          groupBy: [],
          having: [],
          orderBy: [{ expr: { kind: "term", term: { termType: "Variable", value: "t" } }, direction: "ASC" }],
        },
      },
      source,
    );
    assert.equal(r1.queryType, "SELECT");
    assert.equal(r1.bindings.length, 11);
    assert.equal(Number(r1.bindings[0]!.t?.value), -5);
    assert.equal(Number(r1.bindings[10]!.t?.value), 5);

    // 2. Exclusive positive range: (100, 105) -> 101, 102, 103, 104
    const r2 = executeSparqlAlgebra(
      {
        queryType: "SELECT",
        prefixes: {},
        variables: ["s", "t"],
        where: {
          kind: "group",
          patterns: [
            {
              kind: "bgp",
              triples: [
                {
                  subject: { termType: "Variable", value: "s" },
                  predicate: { termType: "NamedNode", value: TEMP },
                  object: { termType: "Variable", value: "t" },
                },
              ],
            },
            {
              kind: "filter",
              expr: {
                kind: "binary",
                op: "&&",
                left: {
                  kind: "binary",
                  op: ">",
                  left: { kind: "term", term: { termType: "Variable", value: "t" } },
                  right: { kind: "term", term: { termType: "Literal", value: "100", datatype: XSD_INT } },
                },
                right: {
                  kind: "binary",
                  op: "<",
                  left: { kind: "term", term: { termType: "Variable", value: "t" } },
                  right: { kind: "term", term: { termType: "Literal", value: "105", datatype: XSD_INT } },
                },
              },
            },
          ],
        },
        modifier: {
          groupBy: [],
          having: [],
          orderBy: [{ expr: { kind: "term", term: { termType: "Variable", value: "t" } }, direction: "ASC" }],
        },
      },
      source,
    );
    assert.equal(r2.queryType, "SELECT");
    assert.deepEqual(
      r2.bindings.map((b) => Number(b.t?.value)),
      [101, 102, 103, 104],
    );

    // 3. Inline fixed-point decimal range: [-0.5, 0.5] inclusive -> 11 gauges
    const r3 = executeSparqlAlgebra(
      {
        queryType: "SELECT",
        prefixes: {},
        variables: ["g", "p"],
        where: {
          kind: "group",
          patterns: [
            {
              kind: "bgp",
              triples: [
                {
                  subject: { termType: "Variable", value: "g" },
                  predicate: { termType: "NamedNode", value: PRESS },
                  object: { termType: "Variable", value: "p" },
                },
              ],
            },
            {
              kind: "filter",
              expr: {
                kind: "binary",
                op: "&&",
                left: {
                  kind: "binary",
                  op: ">=",
                  left: { kind: "term", term: { termType: "Variable", value: "p" } },
                  right: { kind: "term", term: { termType: "Literal", value: "-0.5", datatype: XSD_DEC } },
                },
                right: {
                  kind: "binary",
                  op: "<=",
                  left: { kind: "term", term: { termType: "Variable", value: "p" } },
                  right: { kind: "term", term: { termType: "Literal", value: "0.5", datatype: XSD_DEC } },
                },
              },
            },
          ],
        },
        modifier: {
          groupBy: [],
          having: [],
          orderBy: [{ expr: { kind: "term", term: { termType: "Variable", value: "p" } }, direction: "ASC" }],
        },
      },
      source,
    );
    assert.equal(r3.queryType, "SELECT");
    assert.equal(r3.bindings.length, 11);
    assert.equal(Number(r3.bindings[0]!.p?.value), -0.5);
    assert.equal(Number(r3.bindings[10]!.p?.value), 0.5);
  });

  it("stores and queries named-graph quads via GRAPH <iri> + range pushdown over PagedStorageEngine", async () => {
    const wasm = await loadPagedWasm();
    const engine = new PagedStorageEngine(wasm, 256);

    const G1 = "http://ex.org/graph/thermal";
    const G2 = "http://ex.org/graph/electrical";
    const HAS_TEMP = "http://ex.org/temp";
    const XSD_INT = "http://www.w3.org/2001/XMLSchema#integer";

    engine.insertQuad("http://ex.org/compA", HAS_TEMP, engine.encodeLiteral(350), G1);
    engine.insertQuad("http://ex.org/compB", HAS_TEMP, engine.encodeLiteral(420), G1);
    engine.insertQuad("http://ex.org/compC", HAS_TEMP, engine.encodeLiteral(360), G2);

    const source = createPagedStorageSource(engine);

    const res = executeSparqlAlgebra(
      {
        queryType: "SELECT",
        prefixes: {},
        variables: ["c", "t"],
        modifier: { groupBy: [], having: [], orderBy: [] },
        where: {
          kind: "graph",
          graph: { termType: "NamedNode", value: G1 },
          pattern: {
            kind: "group",
            patterns: [
              {
                kind: "bgp",
                triples: [
                  {
                    subject: { termType: "Variable", value: "c" },
                    predicate: { termType: "NamedNode", value: HAS_TEMP },
                    object: { termType: "Variable", value: "t" },
                  },
                ],
              },
              {
                kind: "filter",
                expr: {
                  kind: "binary",
                  op: "&&",
                  left: {
                    kind: "binary",
                    op: ">=",
                    left: { kind: "term", term: { termType: "Variable", value: "t" } },
                    right: { kind: "term", term: { termType: "Literal", value: "300", datatype: XSD_INT } },
                  },
                  right: {
                    kind: "binary",
                    op: "<=",
                    left: { kind: "term", term: { termType: "Variable", value: "t" } },
                    right: { kind: "term", term: { termType: "Literal", value: "400", datatype: XSD_INT } },
                  },
                },
              },
            ],
          },
        },
      },
      source,
    );
    assert.equal(res.queryType, "SELECT");
    assert.equal(res.bindings.length, 1);
    assert.equal(res.bindings[0]!.c?.value, "http://ex.org/compA");
    assert.equal(Number(res.bindings[0]!.t?.value), 350);
  });
});
