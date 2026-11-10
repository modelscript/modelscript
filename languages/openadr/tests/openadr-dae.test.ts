// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerOpenAdrToDae } from "../src/dae/openadr-to-dae.js";
import { parseOpenAdr } from "../src/parser/openadr-parser.js";

const DAE_TEST_DECK = `
event "DR_EVENT_1" {
  status: "active"
  signalType: "setpoint"

  interval {
    durationSeconds: 3600
    payload: 120.0
  }
}
`;

describe("OpenADR DAE Lowering", () => {
  it("compiles demand response limit into DAE arena parameters and variables", () => {
    const deck = parseOpenAdr(DAE_TEST_DECK);
    const arena = lowerOpenAdrToDae(deck);

    // Should create 2 variables: P_curtail_limit (Parameter), P_target_demand (Continuous)
    assert.strictEqual(arena.getVarCount(), 2);

    // 2 equations: P_curtail_limit = 120.0, P_target_demand = P_curtail_limit
    assert.strictEqual(arena.getEqCount(), 2);
  });
});
