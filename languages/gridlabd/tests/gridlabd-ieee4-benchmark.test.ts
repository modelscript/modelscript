// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerGridlabdToDae } from "../src/dae/gridlabd-to-dae.js";
import { parseGridlabd } from "../src/parser/gridlabd-parser.js";
import { projectGridlabdToOpenDss } from "../src/projections/gridlabd-to-opendss.js";

const IEEE4_BENCHMARK_GLM = `
clock {
  timezone EST+5EDT;
  starttime '2000-01-01 00:00:00';
  stoptime '2000-01-01 01:00:00';
}
module powerflow;
object line_configuration { name lc300; z11 0.4576+1.0780j; }
object transformer_configuration {
  name tc400;
  primary_voltage 12470 V;
  secondary_voltage 4160 V;
  power_rating 6000 kVA;
  resistance 0.01;
  reactance 0.06;
}
object node { name N1; phases ABCN; bustype SWING; nominal_voltage 7200 V; }
object node { name N2; phases ABCN; nominal_voltage 7200 V; }
object node { name N3; phases ABCN; nominal_voltage 2400 V; }
object load {
  name N4;
  phases ABCN;
  nominal_voltage 2400 V;
  constant_power_A 1800+871.78j kVA;
  constant_power_B 1800+871.78j kVA;
  constant_power_C 1800+871.78j kVA;
}
object overhead_line { name L12; phases ABCN; from N1; to N2; length 2000 ft; configuration lc300; }
object transformer { name T23; phases ABCN; from N2; to N3; configuration tc400; }
object overhead_line { name L34; phases ABCN; from N3; to N4; length 2500 ft; configuration lc300; }
`;

describe("GridLAB-D IEEE 4-Node Benchmark & OpenDSS Projection", () => {
  it("projects IEEE 4-node feeder to OpenDSS and lowers to DAEBuilder", () => {
    const model = parseGridlabd(IEEE4_BENCHMARK_GLM);
    const dss = projectGridlabdToOpenDss(model, "IEEE4Node");
    assert.ok(dss.includes("New Circuit.IEEE4Node"));
    assert.ok(dss.includes("New Line.L12"));
    assert.ok(dss.includes("New Transformer.T23"));
    assert.ok(dss.includes("New Load.N4"));

    const dae = lowerGridlabdToDae(model, { modelName: "IEEE4Node" });
    assert.notEqual(dae.lookupVariable("V_N1"), -1);
    assert.notEqual(dae.lookupVariable("I_line_L12"), -1);
    assert.notEqual(dae.lookupVariable("I_xfmr_T23"), -1);
    assert.notEqual(dae.lookupVariable("I_load_N4"), -1);
  });
});
