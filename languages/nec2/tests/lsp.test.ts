// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getNec2Completions, getNec2DocumentSymbols, getNec2Hover, nec2Indexing, validateNec2 } from "../src/index.js";

describe("@modelscript/nec2 Indexing & LSP Services", () => {
  const sampleDeck = `CM Parametric Dipole
CE
SY halfLen=0.25
GW 1 21 0 0 -halfLen 0 0 halfLen 0.001
GE 0
FR 0 1 0 0 300.0 0
EX 0 1 11 0 1.0 0.0
RP 0 37 1 1000 0 0 5 0
EN`;

  it("recognizes .nec/.nec2/.ant files and indexes symbols via nec2Indexing", () => {
    assert.strictEqual(nec2Indexing.canIndex("file:///dipole.nec", ""), true);
    assert.strictEqual(nec2Indexing.canIndex("file:///dipole.nec2", ""), true);
    assert.strictEqual(nec2Indexing.canIndex("file:///dipole.ant", ""), true);
    assert.strictEqual(nec2Indexing.canIndex("file:///readme.txt", "hello world"), false);

    const addedSymbols: Array<{ name: string; kind: string }> = [];
    let parsedModel: unknown = null;

    nec2Indexing.indexFile({
      uri: "file:///dipole.nec",
      text: sampleDeck,
      setParsedModel: (m: unknown) => {
        parsedModel = m;
      },
      addSymbol: (name: string, kind: string) => {
        addedSymbols.push({ name, kind });
        return addedSymbols.length;
      },
    } as never);

    assert.ok(parsedModel !== null);
    assert.ok(addedSymbols.some((s) => s.kind === "Package" && s.name === "Parametric Dipole"));
    assert.ok(addedSymbols.some((s) => s.kind === "Variable" && s.name === "halfLen"));
    assert.ok(addedSymbols.some((s) => s.kind === "Class" && s.name.includes("Wire_1")));
    assert.ok(addedSymbols.some((s) => s.kind === "Function" && s.name.includes("EX_tag1_seg11")));
  });

  it("provides LSP diagnostics, document symbols, hover docs, and completions", () => {
    const cleanDiags = validateNec2(sampleDeck);
    assert.strictEqual(cleanDiags.length, 0);

    const brokenDiags = validateNec2("CM Broken\nGW 1 11 0 0 0 0 0 0 0.001\nRP 0 19 1 1000 0 0 5 0");
    assert.ok(brokenDiags.length >= 3);
    assert.ok(brokenDiags.some((d) => d.code === "NEC2001"));
    assert.ok(brokenDiags.some((d) => d.code === "NEC5002"));

    const symbols = getNec2DocumentSymbols(sampleDeck);
    assert.strictEqual(symbols.length, 1);
    assert.ok((symbols[0]!.children?.length ?? 0) >= 4);

    // Hover on GW card
    const gwHover = getNec2Hover(sampleDeck, { line: 3, character: 1 });
    assert.ok(gwHover && gwHover.contents.value.includes("GW — Wire Specification"));

    // Hover on SY variable halfLen
    const symHover = getNec2Hover(sampleDeck, { line: 3, character: 16 });
    assert.ok(symHover && symHover.contents.value.includes("0.25"));

    // Completions
    const completions = getNec2Completions();
    assert.ok(completions.length >= 20);
    assert.ok(completions.some((c) => c.label === "GW"));
    assert.ok(completions.some((c) => c.label === "FR"));
    assert.ok(completions.some((c) => c.label === "EX"));
  });
});
