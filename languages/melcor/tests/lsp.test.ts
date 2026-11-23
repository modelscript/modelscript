// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { melcorIndexing } from "../src/indexing.js";
import { getMelcorCompletions, getMelcorDocumentSymbols, getMelcorHover, validateMelcor } from "../src/lsp.js";

const SAMPLE = `MELGEN_INPUT
TITLE 'LSP Test Deck'
EXEC_INPUT
  EXEC_TEND 25.0
CVH_INPUT
  CV_ID 'RCS' 100
  CV_THR 1.5e7 580.0
  CV_PAS 50.0
FL_INPUT
  FL_ID 'BadPath' 10
  FL_FT 100 999
  FL_GEO 0.1 1.0
END
`;

describe("@modelscript/melcor — Indexing & LSP Services", () => {
  it("validates MELCOR deck and returns structured LSP diagnostics", () => {
    const diags = validateMelcor(SAMPLE);
    assert.ok(
      diags.some((d) => d.code === "MEL3001"),
      "Should report MEL3001 for undefined CV 999",
    );
  });

  it("extracts hierarchical document symbols for CVH, FL, and root deck", () => {
    const syms = getMelcorDocumentSymbols(SAMPLE);
    assert.equal(syms.length, 1);
    assert.equal(syms[0]?.name, "LSP Test Deck");
    assert.ok((syms[0]?.children?.length ?? 0) >= 2);
  });

  it("provides hover documentation for MELCOR keywords and stdlib materials", () => {
    const hover = getMelcorHover(SAMPLE, { line: 5, character: 3 }); // CV_ID
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("CV_ID"));

    const matHover = getMelcorHover("MP_ID 'Fuel' 1 UO2 CP 310", { line: 0, character: 16 });
    assert.ok(matHover);
    assert.ok(matHover.contents.value.includes("MP_UO2"));
  });

  it("provides keyword completions filtered by prefix", () => {
    const cvCompletions = getMelcorCompletions("CV_");
    assert.ok(cvCompletions.length >= 3);
    assert.ok(cvCompletions.every((c) => c.label.startsWith("CV_")));
  });

  it("recognizes and indexes MELCOR decks via melcorIndexing", () => {
    assert.equal(melcorIndexing.canIndex?.("file:///plant.mel", ""), true);
    assert.equal(melcorIndexing.canIndex?.("file:///deck.inp", SAMPLE), true);
    assert.equal(melcorIndexing.canIndex?.("file:///other.txt", "hello"), false);

    const added: Array<{ name: string; kind: string }> = [];
    let parsedModel: unknown = null;
    melcorIndexing.indexFile?.({
      uri: "file:///plant.mel",
      text: SAMPLE,
      setParsedModel: (m: unknown) => {
        parsedModel = m;
      },
      addSymbol: (name: string, kind: string) => {
        added.push({ name, kind });
        return added.length;
      },
    } as never);

    assert.ok(parsedModel !== null);
    assert.ok(added.some((s) => s.name === "LSP Test Deck"));
    assert.ok(added.some((s) => s.name === "RCS"));
    assert.ok(added.some((s) => s.name === "BadPath"));
  });
});
