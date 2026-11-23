// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executeGpssAction,
  getGpssCompletions,
  getGpssDocumentSymbols,
  getGpssHover,
  validateGpss,
} from "../src/lsp.js";

const SAMPLE_DECK = `* MODEL: ShopLSP
CHAIRS STORAGE 3
      GENERATE 10,2
      QUEUE    LINE
LOOP  SEIZE    JOE
      ENTER    CHAIRS,1
      DEPART   LINE
      ADVANCE  8,2
      LEAVE    CHAIRS,1
      RELEASE  JOE
      TERMINATE 1
      START    50
      END
`;

describe("GPSS Language Server Protocol (LSP) Services", () => {
  it("returns document symbols for facilities, storages, queues, and block labels", () => {
    const symbols = getGpssDocumentSymbols(SAMPLE_DECK);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]!.name, "ShopLSP");
    const childNames = new Set((symbols[0]!.children ?? []).map((c) => c.name));
    assert.ok(childNames.has("JOE"));
    assert.ok(childNames.has("CHAIRS"));
    assert.ok(childNames.has("LINE"));
    assert.ok(childNames.has("LOOP"));
  });

  it("provides contextual hover for GPSS blocks, SNAs, and user-declared entities", () => {
    // Hover over GENERATE on line 2
    const genHover = getGpssHover(SAMPLE_DECK, { line: 2, character: 8 });
    assert.ok(genHover && genHover.contents.value.includes("GENERATE"));

    // Hover over CHAIRS storage on line 1
    const storageHover = getGpssHover(SAMPLE_DECK, { line: 1, character: 2 });
    assert.ok(storageHover && storageHover.contents.value.includes("Capacity"));

    // Hover over SNA Q$LINE
    const snaHover = getGpssHover("TEST G Q$LINE,5,LOOP", { line: 0, character: 8 });
    assert.ok(snaHover && snaHover.contents.value.includes("Q$"));
  });

  it("provides completions for GPSS opcodes, SNAs, and declared entities", () => {
    const genCompletions = getGpssCompletions(SAMPLE_DECK + "\nGEN", { line: 14, character: 3 });
    assert.ok(genCompletions.some((c) => c.label === "GENERATE"));

    const allCompletions = getGpssCompletions(SAMPLE_DECK + "\n", { line: 14, character: 0 });
    assert.ok(allCompletions.some((c) => c.label === "SEIZE"));
    assert.ok(allCompletions.some((c) => c.label === "Q$"));
    assert.ok(allCompletions.some((c) => c.label === "CHAIRS"));
  });

  it("validates GPSS diagnostics and executes LSP actions (simulate, to_dae, to_modelica)", async () => {
    const validDiags = validateGpss(SAMPLE_DECK);
    assert.strictEqual(validDiags.length, 0);

    const invalidDiags = validateGpss("GENERATE 10,2\nSEIZE JOE\nTERMINATE 1\n");
    assert.ok(invalidDiags.some((d) => d.code === "GPSS3001"));
    assert.ok(invalidDiags.some((d) => d.code === "GPSS5001"));

    const simRes = (await executeGpssAction("simulate", { content: SAMPLE_DECK, seed: 42 })) as {
      completedTransactions: number;
    };
    assert.strictEqual(simRes.completedTransactions, 50);

    const daeRes = (await executeGpssAction("to_dae", { content: SAMPLE_DECK })) as {
      varCount: number;
      eqCount: number;
    };
    assert.ok(daeRes.varCount > 0 && daeRes.eqCount > 0);

    const moRes = (await executeGpssAction("to_modelica", { content: SAMPLE_DECK })) as string;
    assert.ok(moRes.includes("model ShopLSP"));
  });
});
