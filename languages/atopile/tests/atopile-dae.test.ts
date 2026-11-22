// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lowerAtopileToDAE } from "../src/dae/dae-lower.js";
import { parseAtopile } from "../src/parser/atopile-parser.js";

describe("@modelscript/atopile — Direct DAEBuilder MNA Lowering", () => {
  it("lowers an .ato RC low-pass filter into a balanced linear-memory DAEBuilder arena", () => {
    const file = parseAtopile(`
module RCLowPass:
    signal vin
    signal vout
    signal gnd

    v1 = new VoltageSource
    r1 = new Resistor
    c1 = new Capacitor
    v1.voltage = 5V
    r1.resistance = 1kohm
    c1.capacitance = 100nF

    v1.p1 ~ vin
    v1.p2 ~ gnd
    vin ~> r1 ~> vout
    vout ~> c1 ~> gnd
`);

    const dae = lowerAtopileToDAE(file);
    assert.strictEqual(dae.groundNet, "gnd");
    assert.strictEqual(dae.nodeCount, 3);
    assert.strictEqual(dae.loweredComponentCount, 3);
    // 3 node voltages + 3 branch currents + 1 cap state + 3 params = 10 vars; 7 equations
    assert.strictEqual(dae.arena.varCount, 10);
    assert.strictEqual(dae.arena.eqCount, 7);
  });
});
