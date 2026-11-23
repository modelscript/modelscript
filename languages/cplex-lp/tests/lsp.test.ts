// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cplexLpIndexing,
  getCplexLpDocumentSymbols,
  getCplexLpHover,
  LspSymbolKind,
  validateCplexLp,
} from "../src/index.js";

describe("@modelscript/cplex-lp Indexing & LSP Suite", () => {
  const sampleLp = `Maximize
  profit: 3 x1 + 5 x2
Subject To
  plant1: x1 <= 4
  plant2: 2 x2 <= 12
Bounds
  0 <= x1 <= 10
Binaries
  y1
End
`;

  it("provides LSP diagnostics with ranges and codes via validateCplexLp", () => {
    const cleanDiags = validateCplexLp(sampleLp);
    // y1 is unreferenced -> LP5006 info only, 0 errors
    assert.strictEqual(cleanDiags.filter((d) => d.severity === 1).length, 0);
    assert.ok(cleanDiags.some((d) => d.code === "LP5006" && d.source === "modelscript-cplex-lp"));

    const brokenLp = `Subject To
  c1: x1 <= 5
  c1: x2 <= 5
`;
    const errDiags = validateCplexLp(brokenLp);
    assert.ok(errDiags.some((d) => d.code === "LP2001" && d.severity === 1));
    assert.ok(errDiags.some((d) => d.code === "LP3001" && d.severity === 1));
    assert.ok(errDiags.some((d) => d.code === "LP2002" && d.severity === 2));
  });

  it("extracts document symbols for objective, constraints, and decision variables", () => {
    const symbols = getCplexLpDocumentSymbols(sampleLp);
    assert.ok(symbols.some((s) => s.name === "profit" && s.kind === LspSymbolKind.Function));
    assert.ok(symbols.some((s) => s.name === "plant1" && s.kind === LspSymbolKind.Property));
    assert.ok(symbols.some((s) => s.name === "x1" && s.kind === LspSymbolKind.Variable));
    assert.ok(symbols.some((s) => s.name === "y1" && s.detail?.includes("binary")));
  });

  it("provides hover documentation for keywords, variables, and constraints", () => {
    const kwHover = getCplexLpHover(sampleLp, { line: 0, character: 2 });
    assert.ok(kwHover);
    assert.ok(kwHover.contents.value.includes("Maximize"));

    const varHover = getCplexLpHover(sampleLp, { line: 1, character: 12 });
    assert.ok(varHover);
    assert.ok(varHover.contents.value.includes("x1"));
    assert.ok(varHover.contents.value.includes("[0, 10]"));

    const conHover = getCplexLpHover(sampleLp, { line: 3, character: 3 });
    assert.ok(conHover);
    assert.ok(conHover.contents.value.includes("plant1"));
  });

  it("indexes CPLEX LP and LINDO files via cplexLpIndexing", () => {
    assert.strictEqual(cplexLpIndexing.canIndex("problem.lp", ""), true);
    assert.strictEqual(cplexLpIndexing.canIndex("model.lindo", ""), true);
    assert.strictEqual(cplexLpIndexing.canIndex("unknown.txt", sampleLp), true);
    assert.strictEqual(cplexLpIndexing.canIndex("other.txt", "hello world"), false);

    const added: Array<{ name: string; kind: string }> = [];
    let parsedModel: unknown;
    cplexLpIndexing.indexFile({
      uri: "file:///problem.lp",
      text: sampleLp,
      setParsedModel: (m: unknown) => {
        parsedModel = m;
      },
      addSymbol: (name: string, kind: string) => {
        added.push({ name, kind });
        return added.length;
      },
    } as never);

    assert.ok(parsedModel);
    assert.ok(added.some((s) => s.kind === "Package"));
    assert.ok(added.some((s) => s.name === "profit" && s.kind === "Function"));
    assert.ok(added.some((s) => s.name === "plant1" && s.kind === "Property"));
    assert.ok(added.some((s) => s.name === "x1" && s.kind === "Variable"));
  });
});
