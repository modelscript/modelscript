// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getHec2Completions,
  getHec2Diagnostics,
  getHec2DocumentSymbols,
  getHec2Hover,
  hec2Indexing,
} from "../src/index.js";

const SAMPLE_DECK = [
  "T1  LSP TEST DECK",
  "J1,0,0,0,0,0.001,1,0,50,104.0",
  "NC,0.04,0.04,0.025,0.1,0.3",
  "X1,100,4,0,10,0,0,0",
  "GR,115,0,100,0,100,10,115,10",
  "X1,200,4,0,10,100,100,100",
  "GR,115.1,0,100.1,0,100.1,10,115.1,10",
  "EJ",
].join("\n");

describe("@modelscript/hec2 — LSP Services & UnifiedWorkspace Indexing", () => {
  it("extracts document symbols for title, J1 job card, and X1 cross-sections", () => {
    const syms = getHec2DocumentSymbols(SAMPLE_DECK);
    assert.equal(syms.length, 1);
    assert.equal(syms[0]!.name, "LSP TEST DECK");
    assert.ok(syms[0]!.children && syms[0]!.children.length === 3);
    assert.equal(syms[0]!.children[0]!.name, "J1 Job Control");
    assert.equal(syms[0]!.children[1]!.name, "XS 100");
    assert.equal(syms[0]!.children[2]!.name, "XS 200");
  });

  it("provides hover documentation and card-code completions", () => {
    const hoverJ1 = getHec2Hover(SAMPLE_DECK, { line: 1, character: 1 });
    assert.ok(hoverJ1 && hoverJ1.contents.value.includes("J1"));

    const hoverGr = getHec2Hover(SAMPLE_DECK, { line: 4, character: 0 });
    assert.ok(hoverGr && hoverGr.contents.value.includes("GR"));

    const xCompletions = getHec2Completions("X");
    assert.ok(xCompletions.some((c) => c.label === "X1"));
    assert.ok(xCompletions.some((c) => c.label === "X2"));

    const allCompletions = getHec2Completions();
    assert.ok(allCompletions.length >= 15);
  });

  it("produces LSP diagnostics with HEC2 codes on invalid decks", () => {
    const bad = "T1 BAD\nNC,-0.02,0.03,0.03,0.1,0.3\n";
    const diags = getHec2Diagnostics(bad);
    assert.ok(diags.some((d) => d.code === "HEC22001"));
    assert.ok(diags.some((d) => d.code === "HEC23001"));
    assert.ok(diags.every((d) => d.source === "hec2"));
  });

  it("indexes HEC-2 decks via hec2Indexing into a DslIndexFileContext", () => {
    assert.equal(hec2Indexing.canIndex?.("file:///river.hc2", ""), true);
    assert.equal(hec2Indexing.canIndex?.("file:///river.dat", SAMPLE_DECK), true);

    const addedSymbols: Array<{ name: string; kind: string }> = [];
    let storedModel: unknown;
    hec2Indexing.indexFile({
      uri: "file:///river.hc2",
      text: SAMPLE_DECK,
      addSymbol: (name: string, kind: string) => {
        addedSymbols.push({ name, kind });
        return addedSymbols.length;
      },
      setParsedModel: (model: unknown) => {
        storedModel = model;
      },
    } as Parameters<typeof hec2Indexing.indexFile>[0]);

    assert.ok(storedModel, "Expected parsed deck to be stored");
    assert.ok(addedSymbols.some((s) => s.name === "LSP TEST DECK" && s.kind === "Package"));
    assert.ok(addedSymbols.some((s) => s.name === "XS_100" && s.kind === "Component"));
    assert.ok(addedSymbols.some((s) => s.name === "XS_200" && s.kind === "Component"));
  });
});
