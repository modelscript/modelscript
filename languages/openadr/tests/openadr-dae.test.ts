// SPDX-License-Identifier: AGPL-3.0-or-later

import { ExprKind } from "@modelscript/runtime";
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
  it("compiles demand response limit and ramp dynamics into square DAE arena", () => {
    const deck = parseOpenAdr(DAE_TEST_DECK);
    const arena = lowerOpenAdrToDae(deck);

    // 5 variables: P_curtail_limit, P_baseline, tau_ramp (Parameter) + P_target_demand, E_shed_kWh (Continuous states)
    assert.strictEqual(arena.getVarCount(), 5);
    assert.strictEqual(arena.getEqCount(), 5);

    const derEqCount = Array.from({ length: arena.getEqCount() }, (_, i) =>
      arena.getExprKind(arena.getEqLhs(i)),
    ).filter((k) => k === ExprKind.Der).length;
    assert.strictEqual(derEqCount, 2, "Expected differential equations for P_target_demand and E_shed_kWh");
  });
});
