// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerTrnsysToDae, parseTrnsysDeck } from "../src/index.js";

describe("@modelscript/trnsys — Direct DAE Arena Lowering", () => {
  it("lowers solar collector (Type 1), stratified tank (Type 4), and building zone (Type 56) directly into DAEBuilder", () => {
    const deck = parseTrnsysDeck(`
VERSION 18
SIMULATION 0 24 0.25

UNIT 1 TYPE 15 Weather
PARAMETERS 5
  20.0 5.0 2880.0 6.0 18.0

UNIT 2 TYPE 1 Collector
PARAMETERS 5
  4.0 4.19 0.75 15.0 0.0
INPUTS 4
  3,1 0,0 1,1 1,2
  20.0 200.0 20.0 0.0

UNIT 3 TYPE 4 Tank
PARAMETERS 6
  0.3 4.19 1000.0 1.5 1.5 3
INPUTS 5
  2,1 2,2 0,0 0,0 1,1
  20.0 0.0 15.0 0.0 20.0
DERIVATIVES 3
  25.0 22.0 20.0

UNIT 4 TYPE 56 BuildingZone
PARAMETERS 4
  5000.0 250.0 6.0 21.0
INPUTS 4
  1,1 1,2 0,0 0,0
  20.0 0.0 500.0 0.0

END
`);

    const builder = new DAEBuilder();
    const res = lowerTrnsysToDae(builder, deck);

    // 3 tank node states + 1 building zone state = 4 differential state variables
    assert.equal(res.stateVarIndices.length, 4);
    assert.ok(res.equationCount >= 20, `Expected >= 20 lowered DAE equations, got ${res.equationCount}`);

    // Verify key variables exist in the arena
    assert.notEqual(builder.lookupVariable("u2_out3"), -1, "Collector Qu variable should exist");
    assert.notEqual(builder.lookupVariable("u3_T1"), -1, "Tank top node state should exist");
    assert.notEqual(builder.lookupVariable("u3_T3"), -1, "Tank bottom node state should exist");
    assert.notEqual(builder.lookupVariable("u4_Tzone"), -1, "Building zone state should exist");
  });
});
