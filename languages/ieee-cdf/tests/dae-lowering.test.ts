// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IEEE_14_BUS_CDF, IEEE_5_BUS_CDF } from "../src/catalog/ieee-cdf-std-schemas.js";
import { ieeeCdfToDae, lowerIeeeCdfToDae } from "../src/dae/index.js";
import { parseIeeeCdf } from "../src/parser/index.js";

describe("@modelscript/ieee-cdf DAE Lowering Suite", () => {
  it("lowers IEEE 5-bus AC power-flow equations directly into DAEBuilder linear memory", () => {
    const net = parseIeeeCdf(IEEE_5_BUS_CDF);
    const builder = new DAEBuilder(undefined, "IEEE_5_Bus");
    const result = lowerIeeeCdfToDae(builder, net);

    assert.strictEqual(result.busVarIndices.size, 5);
    assert.strictEqual(result.variableCount, 20); // 4 per bus (V, theta, P_spec, Q_spec)
    assert.strictEqual(result.equationCount, 10); // 2 algebraic equations per bus
    assert.strictEqual(builder.varCount, 20);
    assert.strictEqual(builder.eqCount, 10);

    for (const bus of net.buses) {
      assert.ok(builder.lookupVariable(`V_${bus.busNumber}`) >= 0);
      assert.ok(builder.lookupVariable(`theta_${bus.busNumber}`) >= 0);
      assert.ok(builder.lookupVariable(`P_spec_${bus.busNumber}`) >= 0);
      assert.ok(builder.lookupVariable(`Q_spec_${bus.busNumber}`) >= 0);
    }
  });

  it("lowers IEEE 14-bus network via ieeeCdfToDae convenience wrapper", () => {
    const net = parseIeeeCdf(IEEE_14_BUS_CDF);
    const dae = ieeeCdfToDae(net, { modelName: "IEEE14Bus" });

    assert.strictEqual(dae.varCount, 14 * 4);
    assert.strictEqual(dae.eqCount, 14 * 2);
    assert.ok(dae.lookupVariable("V_1") >= 0);
    assert.ok(dae.lookupVariable("theta_14") >= 0);
  });
});
