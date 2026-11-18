// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerGridlabdToDae } from "../src/dae/gridlabd-to-dae.js";
import { parseGridlabd } from "../src/parser/gridlabd-parser.js";

describe("GridLAB-D to DAEBuilder Lowering", () => {
  it("lowers nodes, lines, transformers, switches, loads, and DERs into DAEBuilder", () => {
    const glm = `
module powerflow;
object line_configuration {
  name lc1;
  z11 0.4+0.8j;
}
object transformer_configuration {
  name tc1;
  primary_voltage 7200 V;
  secondary_voltage 240 V;
  power_rating 500 kVA;
  resistance 0.01;
  reactance 0.05;
}
object node {
  name sub;
  bustype SWING;
  nominal_voltage 7200 V;
}
object node {
  name mid;
  nominal_voltage 7200 V;
}
object meter {
  name mtr;
  nominal_voltage 240 V;
}
object load {
  name ld1;
  nominal_voltage 240 V;
  constant_power_A 10 kW;
}
object overhead_line {
  name l1;
  from sub;
  to mid;
  length 0.5 mile;
  configuration lc1;
}
object transformer {
  name t1;
  from mid;
  to mtr;
  configuration tc1;
}
object switch {
  name sw1;
  from mtr;
  to ld1;
  status CLOSED;
}
object solar {
  name pv1;
  parent mtr;
  rated_power 5 kW;
}
`;
    const model = parseGridlabd(glm);
    const dae = lowerGridlabdToDae(model, { modelName: "TestFeeder" });

    assert.notEqual(dae.lookupVariable("V_sub"), -1);
    assert.notEqual(dae.lookupVariable("V_mid"), -1);
    assert.notEqual(dae.lookupVariable("V_mtr"), -1);
    assert.notEqual(dae.lookupVariable("V_ld1"), -1);
    assert.notEqual(dae.lookupVariable("I_line_l1"), -1);
    assert.notEqual(dae.lookupVariable("I_xfmr_t1"), -1);
    assert.notEqual(dae.lookupVariable("I_sw_sw1"), -1);
    assert.notEqual(dae.lookupVariable("I_load_ld1"), -1);
    assert.notEqual(dae.lookupVariable("I_der_pv1"), -1);

    assert.ok(dae.variables().length >= 13);
    assert.ok(dae.equations().length >= 10);
  });
});
