// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  gamsIndexing,
  getGamsCompletions,
  getGamsDefinition,
  getGamsDocumentSymbols,
  getGamsHover,
  validateGams,
} from "../src/index.js";

const SAMPLE_GMS = `Sets
  i canning plants / seattle, san-diego / ;
Parameter a(i) capacity / seattle 350, san-diego 600 / ;
Positive Variable x(i) ;
Variable z ;
Equations cost, cap ;
cost.. z =e= sum(i, a(i) * x(i)) ;
cap..  sum(i, x(i)) =l= 100 ;
Model demo / all / ;
Solve demo using lp minimizing z ;
`;

describe("@modelscript/gams — Indexing & LSP Services", () => {
  it("validates GAMS documents and returns LSP diagnostics", () => {
    assert.equal(validateGams(SAMPLE_GMS).length, 0);

    const bad = `Variables x, z ; Equations eq ; eq.. z =e= x ; Model m / eq / ; Solve m using bogus minimizing z ;`;
    const diags = validateGams(bad);
    assert.ok(diags.some((d) => d.code === "GAMS4003" && d.severity === 1));
  });

  it("extracts document symbols for sets, parameters, variables, equations, and models", () => {
    const symbols = getGamsDocumentSymbols(SAMPLE_GMS);
    const names = symbols.map((s) => s.name);
    assert.ok(names.includes("i"));
    assert.ok(names.includes("a"));
    assert.ok(names.includes("x"));
    assert.ok(names.includes("z"));
    assert.ok(names.includes("cost"));
    assert.ok(names.includes("demo"));
  });

  it("provides hover documentation for local symbols and cleanroom stdlib operators", () => {
    // Hover over `sum` on line 6 ("cost.. z =e= sum(i, a(i) * x(i)) ;")
    const hoverSum = getGamsHover(SAMPLE_GMS, { line: 6, character: 14 });
    assert.ok(hoverSum, "Expected hover for 'sum'");
    assert.ok(hoverSum.contents.value.includes("Indexed Summation"));

    // Hover over `a` on line 2
    const hoverParam = getGamsHover(SAMPLE_GMS, { line: 2, character: 10 });
    assert.ok(hoverParam, "Expected hover for parameter 'a'");
    assert.ok(hoverParam.contents.value.includes("PARAMETER"));
  });

  it("provides completions and go-to-definition", () => {
    const completions = getGamsCompletions(SAMPLE_GMS);
    assert.ok(completions.some((c) => c.label === "Solve"));
    assert.ok(completions.some((c) => c.label === "demo"));

    // Go-to-definition on `demo` in `Solve demo using lp minimizing z ;` (line 9)
    const def = getGamsDefinition(SAMPLE_GMS, { line: 9, character: 7 }, "demo.gms");
    assert.ok(def, "Expected definition location for 'demo'");
    assert.equal(def.uri, "demo.gms");
    assert.equal(def.range.start.line, 8);
  });

  it("detects GAMS files in gamsIndexing.canIndex", () => {
    assert.equal(gamsIndexing.canIndex("file:///trnsport.gms", ""), true);
    assert.equal(gamsIndexing.canIndex("file:///model.gams", ""), true);
    assert.equal(gamsIndexing.canIndex("file:///snippet.txt", SAMPLE_GMS), true);
    assert.equal(gamsIndexing.canIndex("file:///unrelated.txt", "hello world"), false);
  });
});
