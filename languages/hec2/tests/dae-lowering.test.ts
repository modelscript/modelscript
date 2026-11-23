// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerHec2ToDae, parseHec2Deck } from "../src/index.js";

describe("@modelscript/hec2 — Saint-Venant Steady Energy & Continuity DAE Lowering", () => {
  it("lowers a multi-section HEC-2 deck directly into DAEBuilder with balanced variables and equations", () => {
    const deckText = [
      "T1  THREE-SECTION CHANNEL DAE",
      "J1,0,0,0,0,0.001,1,0,40,12.5",
      "NC,0.04,0.04,0.025,0.1,0.3",
      "X1,0,4,0,10,0,0,0",
      "GR,20,0,10,0,10,10,20,10",
      "X1,500,4,0,10,500,500,500",
      "GR,20.5,0,10.5,0,10.5,10,20.5,10",
      "X1,1000,4,0,10,500,500,500",
      "GR,21.0,0,11.0,0,11.0,10,21.0,10",
      "EJ",
    ].join("\n");

    const deck = parseHec2Deck(deckText);
    const arena = lowerHec2ToDae(deck);

    // 2 global constants (gravity, manning_phi) + 5 continuous vars per section (wsel, egl, Q, V, Sf)
    const expectedVars = 2 + 5 * 3;
    // 4 equations per section (Q, V*A=Q, EGL, Sf) + 1 downstream BC + (N-1) reach energy equations = 5*N
    const expectedEqs = 5 * 3;

    assert.equal(arena.getVarCount(), expectedVars, `Expected ${expectedVars} variables`);
    assert.equal(arena.getEqCount(), expectedEqs, `Expected ${expectedEqs} equations`);
  });

  it("handles empty HEC-2 decks gracefully", () => {
    const deck = parseHec2Deck("T1 EMPTY\nEJ\n");
    const arena = lowerHec2ToDae(deck);
    assert.equal(arena.getVarCount(), 0);
    assert.equal(arena.getEqCount(), 0);
  });
});
