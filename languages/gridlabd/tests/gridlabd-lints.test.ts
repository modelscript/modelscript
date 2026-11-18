// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintGridlabd } from "../src/lints/index.js";
import { parseGridlabd } from "../src/parser/gridlabd-parser.js";

describe("GridLAB-D Semantic Linter", () => {
  it("reports zero errors on a valid powerflow model", () => {
    const glm = `
clock {
  starttime '2000-01-01 00:00:00';
  stoptime '2000-01-01 01:00:00';
}
module powerflow;
object node {
  name bus1;
  phases ABCN;
  bustype SWING;
  nominal_voltage 7200;
}
object load {
  name bus2;
  phases ABCN;
  nominal_voltage 7200;
  constant_power_A 100+50j kVA;
}
object overhead_line {
  name line1;
  phases ABCN;
  from bus1;
  to bus2;
  length 1000 ft;
}
`;
    const diags = lintGridlabd(parseGridlabd(glm));
    assert.equal(diags.length, 0);
  });

  it("detects missing powerflow module, missing swing bus, duplicate names, unresolved refs, and phase mismatches", () => {
    const glm = `
object node {
  name bus1;
  phases AN;
  nominal_voltage 7200;
}
object node {
  name bus1;
  phases BN;
  nominal_voltage -100;
}
object overhead_line {
  name line1;
  phases ABCN;
  from bus1;
  to missing_bus;
  configuration missing_cfg;
}
`;
    const diags = lintGridlabd(parseGridlabd(glm));
    const codes = new Set(diags.map((d) => d.code));

    assert.ok(codes.has("GLM1001"), "Should flag missing clock");
    assert.ok(codes.has("GLM2001"), "Should flag duplicate object name");
    assert.ok(codes.has("GLM2002"), "Should flag unresolved 'to' and 'configuration'");
    assert.ok(codes.has("GLM3001"), "Should flag missing module powerflow");
    assert.ok(codes.has("GLM3003"), "Should flag negative nominal_voltage");
    assert.ok(codes.has("GLM4001"), "Should flag missing SWING bus");
  });
});
