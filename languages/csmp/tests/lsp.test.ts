// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { csmpIndexing, getCsmpCompletions, getCsmpDocumentSymbols, getCsmpHover, validateCsmp } from "../src/index.js";

const SAMPLE_DECK = `TITLE SERVO CONTROL LOOP
PARAM KP = 2.5, TAU = 0.5
INCON Y0 = 0.0
DYNAMIC
SORT
  ERR = STEP(0.0) - Y
  U = LIMIT(-1.0, 1.0, KP * ERR)
  Y = INTGRL(Y0, U / TAU)
TIMER FINTIM = 5.0, DELT = 0.01
METHOD RKSFX
END
`;

describe("@modelscript/csmp — LSP Services & UnifiedWorkspace Indexing", () => {
  it("validates diagnostics via validateCsmp", () => {
    const cleanDiags = validateCsmp(SAMPLE_DECK);
    const errors = cleanDiags.filter((d) => d.severity === 1);
    assert.equal(errors.length, 0, `Expected 0 errors, got: ${errors.map((e) => e.message).join("; ")}`);

    const badDiags = validateCsmp("DYNAMIC\n  A = B + 1\n  B = A + 1\nMETHOD BADMETHOD\n");
    assert.ok(
      badDiags.some((d) => d.code === "CSMP3001"),
      "Expected algebraic loop diagnostic",
    );
    assert.ok(
      badDiags.some((d) => d.code === "CSMP4002"),
      "Expected invalid METHOD diagnostic",
    );
  });

  it("extracts hierarchical document symbols via getCsmpDocumentSymbols", () => {
    const symbols = getCsmpDocumentSymbols(SAMPLE_DECK);
    assert.equal(symbols.length, 1);
    const root = symbols[0]!;
    assert.equal(root.name, "SERVO CONTROL LOOP");
    assert.ok(root.children && root.children.length >= 6);

    const names = root.children.map((c) => c.name);
    assert.ok(names.includes("KP"));
    assert.ok(names.includes("TAU"));
    assert.ok(names.includes("Y0"));
    assert.ok(names.includes("Y"));
  });

  it("provides markdown hover documentation for blocks, keywords, and variables", () => {
    // Hover over INTGRL on line 7 (0-indexed)
    const intgrlHover = getCsmpHover(SAMPLE_DECK, { line: 7, character: 8 });
    assert.ok(intgrlHover);
    assert.ok(intgrlHover.contents.value.includes("Integrator (INTGRL)"));
    assert.ok(intgrlHover.contents.value.includes("IBM System/360 CSMP"));

    // Hover over KP parameter on line 1
    const kpHover = getCsmpHover(SAMPLE_DECK, { line: 1, character: 7 });
    assert.ok(kpHover);
    assert.ok(kpHover.contents.value.includes("PARAM `KP`"));
  });

  it("provides keyword, block, and variable completions via getCsmpCompletions", () => {
    const allItems = getCsmpCompletions(SAMPLE_DECK + "\n", { line: 11, character: 0 });
    const labels = new Set(allItems.map((i) => i.label));
    assert.ok(labels.has("INTGRL"));
    assert.ok(labels.has("REALPL"));
    assert.ok(labels.has("CMPXPL"));
    assert.ok(labels.has("TIMER"));
    assert.ok(labels.has("KP"));

    // Verify prefix filtering on "INT"
    const filtered = getCsmpCompletions(SAMPLE_DECK + "\nINT", { line: 11, character: 3 });
    assert.ok(filtered.some((i) => i.label === "INTGRL"));
  });

  it("supports UnifiedWorkspace indexing via csmpIndexing", () => {
    assert.equal(csmpIndexing.canIndex("servo.csmp", ""), true);
    assert.equal(csmpIndexing.canIndex("plant.cssl", ""), true);
    assert.equal(csmpIndexing.canIndex("unknown.txt", SAMPLE_DECK), true);
    assert.equal(csmpIndexing.canIndex("notes.txt", "hello world"), false);

    const added: string[] = [];
    let parsedModel: unknown = null;
    csmpIndexing.indexFile({
      uri: "servo.csmp",
      text: SAMPLE_DECK,
      setParsedModel(m) {
        parsedModel = m;
      },
      addSymbol(name) {
        added.push(name);
        return added.length;
      },
    } as any);

    assert.ok(parsedModel !== null);
    assert.ok(added.includes("SERVO CONTROL LOOP"));
    assert.ok(added.includes("KP"));
    assert.ok(added.includes("Y"));
  });
});
