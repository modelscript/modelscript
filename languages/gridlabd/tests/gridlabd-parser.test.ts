// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseGlmComplex,
  parseGlmLengthMiles,
  parseGlmPowerW,
  parseGlmVoltageV,
  parseGridlabd,
} from "../src/parser/gridlabd-parser.js";

const IEEE4_GLM = `
// IEEE 4-node test feeder excerpt
#set profiler=1
#define VSOURCE=7200

clock {
  timezone EST+5EDT;
  starttime '2000-01-01 00:00:00';
  stoptime '2000-01-01 01:00:00';
}

module powerflow {
  solver_method NR;
}

schedule load_shape {
  * 0-5 * * * 0.5;
  * 6-17 * * * 1.0;
  * 18-23 * * * 0.8;
}

object overhead_line_conductor:100 {
  name cond_336;
  resistance 0.306;
}

object line_configuration:300 {
  name lc_300;
  conductor_A cond_336;
  z11 0.4576+1.0780j;
}

object transformer_configuration:400 {
  name xfmr_cfg_400;
  connect_type WYE_WYE;
  power_rating 6000 kVA;
  primary_voltage 12470 V;
  secondary_voltage 4160 V;
  resistance 0.01;
  reactance 0.06;
}

object node {
  name node_1;
  phases ABCN;
  bustype SWING;
  nominal_voltage 7.2 kV;
}

object node {
  name node_2;
  phases ABCN;
  nominal_voltage 7200 V;
}

object overhead_line {
  name line_1_2;
  phases ABCN;
  from node_1;
  to node_2;
  length 2000 ft;
  configuration lc_300;
}

object transformer {
  name xfmr_2_3;
  phases ABCN;
  from node_2;
  to node_3;
  configuration xfmr_cfg_400;
}

object load {
  name node_3;
  phases ABCN;
  nominal_voltage 2400 V;
  constant_power_A 1800+871.78j kVA;
  constant_power_B 1800+871.78j kVA;
  constant_power_C 1800+871.78j kVA;

  object inverter {
    name inv_3;
    rated_power 50 kW;
    object solar {
      name pv_3;
      area 250;
      efficiency 0.2;
    }
  }
}
`;

describe("GridLAB-D Parser & Unit Helpers", () => {
  it("parses directives, clock, modules, schedules, and nested objects", () => {
    const model = parseGridlabd(IEEE4_GLM);

    assert.equal(model.directives.length, 2);
    assert.equal(model.directives[0]?.kind, "set");
    assert.equal(model.directives[0]?.name, "profiler");
    assert.equal(model.directives[0]?.value, "1");

    assert.ok(model.clock);
    assert.equal(model.clock.timezone, "EST+5EDT");
    assert.equal(model.clock.starttime, "2000-01-01 00:00:00");

    assert.equal(model.modules.length, 1);
    assert.equal(model.modules[0]?.name, "powerflow");
    assert.equal(model.modules[0]?.properties["solver_method"], "NR");

    assert.equal(model.schedules.length, 1);
    assert.equal(model.schedules[0]?.name, "load_shape");

    // 8 top-level objects + 2 nested (inv_3, pv_3) = 10 total
    assert.equal(model.objects.length, 8);
    assert.equal(model.allObjects.length, 10);

    const inv = model.objectsByName.get("inv_3");
    assert.ok(inv);
    assert.equal(inv.parent, "node_3");

    const pv = model.objectsByName.get("pv_3");
    assert.ok(pv);
    assert.equal(pv.parent, "inv_3");
  });

  it("parses GridLAB-D physical units and complex numbers accurately", () => {
    assert.equal(parseGlmVoltageV("7.2 kV"), 7200);
    assert.equal(parseGlmVoltageV("2400 V"), 2400);

    const p = parseGlmPowerW("1800+871.78j kVA");
    assert.ok(p);
    assert.equal(p.pWatts, 1_800_000);
    assert.ok(Math.abs(p.qVAr - 871_780) < 1e-3);

    const c = parseGlmComplex("0.4576+1.0780j");
    assert.ok(c);
    assert.ok(Math.abs(c.re - 0.4576) < 1e-6);
    assert.ok(Math.abs(c.im - 1.078) < 1e-6);

    const miles = parseGlmLengthMiles("2640 ft");
    assert.ok(miles !== null && Math.abs(miles - 0.5) < 1e-6);
  });
});
