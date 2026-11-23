// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mcnpIndexing } from "../src/indexing.js";
import { executeMcnpAction, getMcnpDocumentSymbols, getMcnpHover, validateMcnp } from "../src/lsp.js";

describe("MCNP LSP Services & UnifiedWorkspace Indexing", () => {
  const sampleText = `Godiva LSP Deck
1 1 -18.74 -1 IMP:N=1
2 0 1 IMP:N=0

1 SO 8.741

MODE N
M1 92235.80c 1.0
KCODE 400 1.0 5 15
KSRC 0 0 0
F4:N 1
`;

  it("validates decks, extracts hierarchical document symbols, and provides ZAID/card hover", () => {
    const diags = validateMcnp(sampleText);
    assert.strictEqual(diags.length, 0);

    const symbols = getMcnpDocumentSymbols(sampleText);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]!.name, "Godiva LSP Deck");
    assert.strictEqual(symbols[0]!.children?.length, 5); // 2 cells + 1 surface + 1 material + 1 tally

    // Hover on M1 92235.80c line (line index 7)
    const isoHover = getMcnpHover(sampleText, { line: 7, character: 5 });
    assert.ok(isoHover?.contents.value.includes("92235"));
    assert.ok(isoHover?.contents.value.includes("U-235"));

    // Hover on KCODE line (line index 8)
    const kcodeHover = getMcnpHover(sampleText, { line: 8, character: 2 });
    assert.ok(kcodeHover?.contents.value.includes("KCODE"));
  });

  it("executes LSP domain actions (lint, solve, to_dae, to_modelica, to_scad)", async () => {
    const daeRes = (await executeMcnpAction("to_dae", { content: sampleText })) as {
      varCount: number;
      eqCount: number;
    };
    assert.strictEqual(daeRes.varCount, 9);
    assert.strictEqual(daeRes.eqCount, 9);

    const solveRes = (await executeMcnpAction("solve", { content: sampleText, seed: 7 })) as {
      mode: string;
      kEff: number;
    };
    assert.strictEqual(solveRes.mode, "criticality");
    assert.ok(solveRes.kEff > 0.7 && solveRes.kEff < 1.3);

    const mo = (await executeMcnpAction("to_modelica", { content: sampleText })) as string;
    assert.ok(mo.includes("model Godiva_LSP_Deck"));

    const scad = (await executeMcnpAction("to_scad", { content: sampleText })) as string;
    assert.ok(scad.includes("sphere(r = 8.741"));
  });

  it("detects and indexes MCNP files in mcnpIndexing", () => {
    assert.strictEqual(mcnpIndexing.canIndex("reactor.mcnp", ""), true);
    assert.strictEqual(mcnpIndexing.canIndex("deck.inp", sampleText), true);
    assert.strictEqual(mcnpIndexing.canIndex("notes.txt", "hello world"), false);

    const added: string[] = [];
    mcnpIndexing.indexFile({
      uri: "godiva.mcnp",
      text: sampleText,
      setParsedModel: () => {},
      addSymbol: (name: string) => {
        added.push(name);
        return added.length;
      },
    } as never);
    assert.ok(added.includes("Godiva LSP Deck"));
    assert.ok(added.includes("Cell 1 [M1]"));
    assert.ok(added.includes("Surface 1 [SO]"));
    assert.ok(added.includes("M1"));
    assert.ok(added.includes("F4:N"));
  });
});
