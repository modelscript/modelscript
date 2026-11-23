// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ceaIndexing,
  ceaLanguageService,
  getCeaCompletions,
  getCeaDocumentSymbols,
  getCeaHover,
  validateCea,
} from "../src/index.js";

const SAMPLE_DECK = `problem case=MethaneRocket rocket equilibrium p,bar=100 o/f=3.6 supar=40
reactants
  fuel=CH4 wt%=100 t(k)=111.66
  oxid=O2 wt%=100 t(k)=90.17
output siunits short
end
`;

describe("@modelscript/cea — LSP Services & UnifiedWorkspace Indexing", () => {
  it("returns zero diagnostics for valid deck and structured LSP diagnostics for invalid deck", () => {
    const clean = validateCea(SAMPLE_DECK);
    assert.equal(clean.length, 0);

    const invalid = validateCea("problem rocket p,bar=-10\nreactants\n  fuel=FOOBAR wt%=50\n");
    assert.ok(invalid.length >= 3, "Expected multiple LSP diagnostics");
    assert.ok(invalid.some((d) => d.code === "CEA3001" && d.source === "modelscript-cea"));
    assert.ok(invalid.some((d) => d.code === "CEA2002"));
    assert.ok(invalid.some((d) => d.code === "CEA4001"));
  });

  it("extracts hierarchical document symbols for problem and reactants", () => {
    const symbols = getCeaDocumentSymbols(SAMPLE_DECK);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]!.name, "MethaneRocket");
    assert.ok(symbols[0]!.children && symbols[0]!.children.length === 3);
    assert.equal(symbols[0]!.children[0]!.name, "problem (rocket)");
    assert.equal(symbols[0]!.children[1]!.name, "CH4");
    assert.equal(symbols[0]!.children[2]!.name, "O2");
  });

  it("provides Markdown hover cards for CEA keywords and thermodynamic species", () => {
    const kwHover = getCeaHover(SAMPLE_DECK, { line: 0, character: 2 });
    assert.ok(kwHover && kwHover.contents.value.includes("problem"));

    const spHover = getCeaHover(SAMPLE_DECK, { line: 2, character: 8 });
    assert.ok(spHover && spHover.contents.value.includes("CH4") && spHover.contents.value.includes("NASA-7"));
  });

  it("provides completions for CEA keywords and all 17 standard-library species", () => {
    const items = getCeaCompletions(SAMPLE_DECK, { line: 0, character: 0 });
    const labels = new Set(items.map((it) => it.label));
    assert.ok(labels.has("problem"));
    assert.ok(labels.has("reactants"));
    assert.ok(labels.has("H2O"));
    assert.ok(labels.has("RP-1"));
    assert.ok(labels.has("N2O4"));
    assert.ok(ceaLanguageService.validate === validateCea);
  });

  it("recognizes .cea and CEA-formatted .inp files in ceaIndexing.canIndex", () => {
    assert.equal(ceaIndexing.canIndex("ssme.cea", ""), true);
    assert.equal(ceaIndexing.canIndex("deck.inp", SAMPLE_DECK), true);
    assert.equal(ceaIndexing.canIndex("other.inp", "COMPONENTS:\nCONNECTIONS:\n"), false);
  });
});
