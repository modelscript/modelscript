// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canIndexChemkin,
  getChemkinCompletions,
  getChemkinDocumentSymbols,
  getChemkinHover,
  validateChemkin,
} from "../src/index.js";

const LSP_DECK = `! H2/O2 LSP sample
ELEMENTS
  H O N
END
SPECIES
  H2 O2 H2O N2
END
REACTIONS CAL/MOLE MOLES
  2 H2 + O2 <=> 2 H2O  1.0E+13 0.0 40000.0
END
`;

describe("@modelscript/chemkin — LSP Services & Workspace Indexing", () => {
  it("disambiguates CHEMKIN files (.inp, .ck, .therm) via canIndexChemkin", () => {
    assert.equal(canIndexChemkin("mech.ck"), true);
    assert.equal(canIndexChemkin("nasa.therm"), true);
    assert.equal(canIndexChemkin("gri30.inp", LSP_DECK), true);
    assert.equal(canIndexChemkin("unrelated.inp", "COMPONENTS:\n  PUMP1 PUMP\n"), false);
    assert.equal(canIndexChemkin("model.mo", "model A end A;"), false);
  });

  it("produces hierarchical LSP document symbols for ELEMENTS, SPECIES, and REACTIONS", () => {
    const symbols = getChemkinDocumentSymbols(LSP_DECK);
    const topNames = symbols.map((s) => s.name);
    assert.deepEqual(topNames, ["ELEMENTS", "SPECIES", "REACTIONS"]);

    const speciesNode = symbols.find((s) => s.name === "SPECIES")!;
    assert.equal(speciesNode.children?.length, 4);
    assert.ok(speciesNode.children?.some((c) => c.name === "H2O"));
  });

  it("provides Markdown hover cards for keywords, elements, and species with NASA-7 properties", () => {
    // Line 1: "ELEMENTS"
    const kwHover = getChemkinHover(LSP_DECK, { line: 1, character: 2 });
    assert.ok(kwHover?.contents.value.includes("ELEMENTS"));

    // Line 5: "  H2 O2 H2O N2" -> hover over H2O
    const spHover = getChemkinHover(LSP_DECK, { line: 5, character: 9 });
    assert.ok(spHover?.contents.value.includes("H2O"));
    assert.ok(spHover?.contents.value.includes("Cp (298.15 K)"), "Should display NASA-7 Cp");
    assert.ok(spHover?.contents.value.includes("Hf (298.15 K)"), "Should display NASA-7 Hf");

    // Line 2: "  H O N" -> hover over N
    const elHover = getChemkinHover(LSP_DECK, { line: 2, character: 6 });
    assert.ok(elHover?.contents.value.includes("Atomic Weight") || elHover?.contents.value.includes("N"));
  });

  it("provides completions and validates diagnostics via validateChemkin", () => {
    const completions = getChemkinCompletions(LSP_DECK, { line: 8, character: 2 });
    assert.ok(completions.some((c) => c.label === "REACTIONS"));
    assert.ok(completions.some((c) => c.label === "TROE"));
    assert.ok(completions.some((c) => c.label === "H2O"));
    assert.ok(completions.some((c) => c.label === "CH4"));

    const invalidDeck = `
ELEMENTS H O END
SPECIES H2 O2 END
REACTIONS
  H2 + O2 => H2O  -1.0E+10 0.0 0.0
END
`;
    const diags = validateChemkin(invalidDeck);
    assert.ok(
      diags.some((d) => d.code === "CK2003"),
      "Expected undeclared species H2O diagnostic",
    );
    assert.ok(
      diags.some((d) => d.code === "CK3001"),
      "Expected stoichiometric imbalance diagnostic",
    );
    assert.ok(
      diags.some((d) => d.code === "CK5001"),
      "Expected negative A diagnostic",
    );
  });
});
