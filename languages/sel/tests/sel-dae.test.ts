// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerSELToDae } from "../src/dae/sel-to-dae.js";
import { parseSELAscii } from "../src/parser/sel-parser.js";

const SAMPLE_RELAY = `
RELAY="SEL-411L"
RID="SUB_SOUTH_L1"
TID="SEL-411L"
GROUP 1
50P1P=12.00
51P1P=4.00
51P1TD=1.50
Z1P=3.00
Z2P=10.00
TRIP=50P1P OR 51P1 OR Z1P
CLOSE=!51P1
OUT101=TRIP
`;

describe("SEL Domain Lowering to Linear-Memory DAE Arena", () => {
  it("lowers SEL relay settings to DAEBuilder with correct variable and equation allocations", () => {
    const settings = parseSELAscii(SAMPLE_RELAY);
    const dae: DAEBuilder = lowerSELToDae(settings);

    // Verify DAE was instantiated and populated
    assert.ok(dae.varCount > 0, "DAE arena should contain allocated variables");
    assert.ok(dae.eqCount > 0, "DAE arena should contain allocated equations");

    // Channels: time (1) + analog inputs (5) + digital inputs (8) + params (7) + outputs/targets (14) = 35 vars
    assert.ok(dae.varCount >= 25, `Expected >= 25 variables, got ${dae.varCount}`);
    assert.ok(dae.eqCount >= 15, `Expected >= 15 equations, got ${dae.eqCount}`);
  });
});
