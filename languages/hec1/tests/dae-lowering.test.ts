// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hec1ToDae, lowerHec1ToDae, parseHec1Deck } from "../src/index.js";

describe("@modelscript/hec1 — Direct Linear-Memory DAE Arena Lowering", () => {
  const sampleDeck = parseHec1Deck(
    [
      "ID TWO-BRANCH WATERSHED DAE",
      "IT 15 01JUN90 0000 100",
      "KK SUB1",
      "BA 6.0",
      "PB 4.0",
      "LS 0.5 76 12",
      "UC 2.0 1.8",
      "BF 15.0 0.0 1.0",
      "KK RCH1",
      "RM 3 1.5 0.2",
      "KK SUB2",
      "BA 4.0",
      "PB 4.0",
      "LS 0.4 82 25",
      "UD 1.2",
      "KK OUTLET",
      "HC 2",
      "ZZ",
    ].join("\n"),
  );

  it("lowers subbasin storage ODEs, Muskingum routing ODEs, and HC combine directly into DAEBuilder", () => {
    const builder = new DAEBuilder(undefined, "WatershedDAE");
    const res = lowerHec1ToDae(builder, sampleDeck);

    // 2 subbasins (2 eqs each) + 1 Muskingum reach (2 eqs) + 1 combine (1 eq) = 7 equations
    assert.equal(res.equationCount, 7);
    assert.equal(builder.getEqCount(), 7);

    // 3 differential state variables: S_SUB1, S_reach_RCH1, S_SUB2
    assert.equal(res.stateVarIndices.length, 3);
    assert.ok(res.variableMap.has("S_SUB1"));
    assert.ok(res.variableMap.has("Q_SUB1"));
    assert.ok(res.variableMap.has("S_reach_RCH1"));
    assert.ok(res.variableMap.has("Q_RCH1"));
    assert.ok(res.variableMap.has("K_RCH1"));
    assert.ok(res.variableMap.has("X_RCH1"));
    assert.ok(res.variableMap.has("S_SUB2"));
    assert.ok(res.variableMap.has("Q_OUTLET"));
  });

  it("supports convenience wrapper hec1ToDae with custom modelName", () => {
    const dae = hec1ToDae(sampleDeck, { modelName: "CastroValleyDAE" });
    assert.equal(dae.getEqCount(), 7);
    assert.ok(dae.getVarCount() >= 15);
  });
});
