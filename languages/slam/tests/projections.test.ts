// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSlamDeck } from "../src/parser/index.js";
import { slamToModelica } from "../src/projections/index.js";

describe("@modelscript/slam — Modelica 3.x Projection", () => {
  it("projects continuous ODEs, INTLC starts, RESOURCE balances, and DETECT when-clauses to Modelica", () => {
    const deck = `
GEN, PRITSKER, TANK_PROJ, 1/1/1979, 1;
CONTINUOUS, 1, 0, 0.01, 0.1, 0.1;
INTLC, SS(1)=10.0, XX(1)=1.0;
INITIALIZE, 0.0, 15.0;
DD(1) = 300.0 * XX(1) - 150.0;
NETWORK;
  RESOURCE/BERTH(2), 1;
  FULL DETECT, SS(1), XP, 150.0, 0.01;
       TERMINATE;
ENDNETWORK;
FIN;
`;
    const mo = slamToModelica(parseSlamDeck(deck));

    assert.ok(mo.includes("model TANK_PROJ"));
    assert.ok(mo.includes("Real SS_1(start = 10, fixed = true);"));
    assert.ok(mo.includes("discrete Real XX_1(start = 1, fixed = true);"));
    assert.ok(mo.includes("parameter Real RES_BERTH_cap = 2.0;"));
    assert.ok(mo.includes("der(SS_1) = ((300.0 * XX_1) - 150.0);"));
    assert.ok(mo.includes("RES_BERTH_avail = RES_BERTH_cap - RES_BERTH_busy;"));
    assert.ok(mo.includes("when SS_1 >= 150 then"));
    assert.ok(mo.includes("FULL_crossings = pre(FULL_crossings) + 1;"));
    assert.ok(mo.includes("experiment(StartTime = 0, StopTime = 15)"));
    assert.ok(mo.includes("end TANK_PROJ;"));
  });
});
