// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gdsiiIndexing } from "../src/indexing.js";
import { getGdsiiCompletions, getGdsiiDocumentSymbols, getGdsiiHover, validateGdsii } from "../src/lsp.js";

const LSP_SAMPLE = `HEADER 600
BGNLIB
LIBNAME LSP_DEMO
UNITS 1e-3 1e-9
BGNSTR
STRNAME INV
  BOUNDARY
  LAYER 5
  DATATYPE 0
  XY 0: 0  500: 0  500: 500  0: 500  0: 0
  ENDEL
ENDSTR
ENDLIB
`;

describe("GDSII Indexing & LSP Services", () => {
  it("recognizes .gdt / .gdsii files and indexes library and structure symbols", () => {
    assert.equal(gdsiiIndexing.canIndex("layout.gdt", ""), true);
    assert.equal(gdsiiIndexing.canIndex("layout.gdsii", ""), true);
    assert.equal(gdsiiIndexing.canIndex("unknown.txt", LSP_SAMPLE), true);

    const added: Array<{ name: string; kind: string }> = [];
    gdsiiIndexing.indexFile({
      uri: "file:///demo.gdt",
      text: LSP_SAMPLE,
      setParsedModel: () => {},
      addSymbol: (name: string, kind: string) => {
        added.push({ name, kind });
        return added.length;
      },
    } as unknown as Parameters<typeof gdsiiIndexing.indexFile>[0]);

    assert.equal(added.length, 2);
    assert.deepEqual(added[0], { name: "LSP_DEMO", kind: "Package" });
    assert.deepEqual(added[1], { name: "INV", kind: "Class" });
  });

  it("provides LSP diagnostics, document symbols, hover, and completions", () => {
    const cleanDiags = validateGdsii(LSP_SAMPLE);
    assert.equal(cleanDiags.length, 0);

    const symbols = getGdsiiDocumentSymbols(LSP_SAMPLE);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]!.name, "LSP_DEMO");
    assert.equal(symbols[0]!.children?.length, 1);
    assert.equal(symbols[0]!.children![0]!.name, "INV");

    // Hover on BOUNDARY keyword (line 6, char 4)
    const kwHover = getGdsiiHover(LSP_SAMPLE, { line: 6, character: 4 });
    assert.ok(kwHover && kwHover.contents.value.includes("BOUNDARY"));

    // Hover on LAYER 5 (line 7, char 8)
    const layerHover = getGdsiiHover(LSP_SAMPLE, { line: 7, character: 8 });
    assert.ok(layerHover && layerHover.contents.value.includes("METAL1"));

    // Hover on structure name INV (line 5, char 9)
    const structHover = getGdsiiHover(LSP_SAMPLE, { line: 5, character: 9 });
    assert.ok(structHover && structHover.contents.value.includes("Structure `INV`"));

    const completions = getGdsiiCompletions();
    assert.ok(completions.some((c) => c.label === "BOUNDARY"));
    assert.ok(completions.some((c) => c.label === "METAL1"));
    assert.ok(completions.some((c) => c.label === "NAND2"));
  });
});
