// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCompletions, getDocumentSymbols, getHover, hec1Indexing, validateHec1 } from "../src/index.js";

describe("@modelscript/hec1 — LSP Services & UnifiedWorkspace Indexing", () => {
  const sampleDeck = [
    "ID LSP TEST WATERSHED",
    "IT 15 01JUN90 0000 100",
    "KK SUB1",
    "BA 4.0",
    "PB 3.0",
    "LS 0.4 78 15",
    "UC 1.5 2.0",
    "KK RCH1",
    "RM 3 1.2 0.2",
    "ZZ",
  ].join("\n");

  it("provides diagnostics, document symbols, hover docs, and card completions", () => {
    const cleanDiags = validateHec1(sampleDeck);
    assert.equal(cleanDiags.length, 0);

    const badDiags = validateHec1("ID BAD\nKK SUB1\nBA -1\nLS 0.2 120 0\n");
    assert.ok(badDiags.some((d) => d.code === "HEC12001"));
    assert.ok(badDiags.some((d) => d.code === "HEC13001"));
    assert.ok(badDiags.some((d) => d.code === "HEC13002"));

    const symbols = getDocumentSymbols(sampleDeck);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]!.children?.length, 2);
    assert.equal(symbols[0]!.children![0]!.name, "SUB1");
    assert.equal(symbols[0]!.children![1]!.name, "RCH1");

    const rmHover = getHover(sampleDeck, { line: 8, character: 1 });
    assert.ok(rmHover);
    assert.ok(rmHover.contents.value.includes("Muskingum"));

    const subHover = getHover(sampleDeck, { line: 2, character: 4 });
    assert.ok(subHover);
    assert.ok(subHover.contents.value.includes("SUB1"));

    const completions = getCompletions();
    assert.ok(completions.length >= 24);
    assert.ok(completions.some((c) => c.label === "LS"));
    assert.ok(completions.some((c) => c.label === "RM"));
    assert.ok(completions.some((c) => c.label === "HC"));
  });

  it("detects and indexes HEC-1 decks via hec1Indexing", () => {
    assert.equal(hec1Indexing.canIndex("watershed.hec1", ""), true);
    assert.equal(hec1Indexing.canIndex("watershed.h1", ""), true);
    assert.equal(hec1Indexing.canIndex("deck.dat", sampleDeck), true);
    assert.equal(hec1Indexing.canIndex("notes.txt", "hello world"), false);

    const added: Array<{ name: string; kind: string }> = [];
    let parsedModel: unknown;
    hec1Indexing.indexFile({
      uri: "watershed.hec1",
      text: sampleDeck,
      addSymbol(name, kind) {
        added.push({ name, kind });
        return added.length;
      },
      setParsedModel(m) {
        parsedModel = m;
      },
    } as Parameters<typeof hec1Indexing.indexFile>[0]);

    assert.ok(parsedModel);
    assert.equal(added.length, 3); // 1 deck root + 2 stations
    assert.equal(added[0]!.kind, "Package");
    assert.ok(added[1]!.name.includes("SUB1"));
    assert.ok(added[2]!.name.includes("RCH1"));
  });
});
