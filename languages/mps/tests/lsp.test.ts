// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMpsDocumentSymbols, getMpsHover, LspSymbolKind, mpsIndexing, validateMps } from "../src/index.js";

describe("@modelscript/mps Indexing & LSP Suite", () => {
  const deck = [
    "NAME          LSP_DEMO",
    "OBJSENSE",
    "  MAX",
    "ROWS",
    " N  PROFIT",
    " L  CAP",
    "COLUMNS",
    "    X1        PROFIT    10       CAP       2",
    "    X2        PROFIT    15       CAP       3",
    "RHS",
    "    RHS1      CAP       12",
    "BOUNDS",
    " UP BND1      X1        5",
    "ENDATA",
  ].join("\n");

  it("validates clean and erroneous MPS documents via validateMps", () => {
    const clean = validateMps(deck, "demo.mps");
    assert.strictEqual(clean.length, 0);

    const bad = validateMps("ROWS\n L R1\nCOLUMNS\n X1 NO_ROW 1\n", "bad.mps");
    assert.ok(bad.length >= 3);
    assert.ok(bad.some((d) => d.code === "MPS1002"));
    assert.ok(bad.some((d) => d.code === "MPS2002"));
    assert.ok(bad.some((d) => d.code === "MPS1004"));
  });

  it("extracts hierarchical LSP document symbols for problem, rows, and columns", () => {
    const symbols = getMpsDocumentSymbols(deck);
    assert.strictEqual(symbols.length, 1);
    const root = symbols[0]!;
    assert.strictEqual(root.name, "LSP_DEMO");
    assert.strictEqual(root.kind, LspSymbolKind.Package);
    assert.ok(root.children);
    assert.strictEqual(root.children.length, 4); // 2 rows + 2 cols

    const profitSym = root.children.find((s) => s.name === "PROFIT");
    assert.ok(profitSym);
    assert.strictEqual(profitSym.kind, LspSymbolKind.Function);

    const x1Sym = root.children.find((s) => s.name === "X1");
    assert.ok(x1Sym);
    assert.strictEqual(x1Sym.kind, LspSymbolKind.Variable);
  });

  it("provides hover documentation for section keywords, rows, and variables", () => {
    const secHover = getMpsHover(deck, { line: 3, character: 1 }); // "ROWS"
    assert.ok(secHover?.contents.value.includes("ROWS"));

    const rowHover = getMpsHover(deck, { line: 5, character: 5 }); // "CAP"
    assert.ok(rowHover?.contents.value.includes("Constraint Row"));

    const colHover = getMpsHover(deck, { line: 7, character: 5 }); // "X1"
    assert.ok(colHover?.contents.value.includes("Decision Variable"));
  });

  it("indexes MPS files via mpsIndexing.canIndex and indexFile", () => {
    assert.strictEqual(mpsIndexing.canIndex("afiro.mps", ""), true);
    assert.strictEqual(mpsIndexing.canIndex("model.qps", ""), true);
    assert.strictEqual(mpsIndexing.canIndex("problem.txt", deck), true);
    assert.strictEqual(mpsIndexing.canIndex("notes.txt", "hello world"), false);

    const added: Array<{ name: string; kind: string }> = [];
    let parsedModel: unknown;
    mpsIndexing.indexFile({
      uri: "demo.mps",
      text: deck,
      setParsedModel: (m: unknown) => {
        parsedModel = m;
      },
      addSymbol: (name: string, kind: string) => {
        added.push({ name, kind });
        return added.length;
      },
    } as Parameters<typeof mpsIndexing.indexFile>[0]);

    assert.ok(parsedModel);
    assert.strictEqual(added.length, 5); // 1 package + 2 rows + 2 cols
    assert.strictEqual(added[0]?.name, "LSP_DEMO");
    assert.strictEqual(added[0]?.kind, "Package");
  });
});
