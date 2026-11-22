// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { elaborateAtopileProject } from "../src/netlist.js";
import { parseAtopile } from "../src/parser/atopile-parser.js";

describe("@modelscript/atopile — Multi-File Hierarchical Module Elaboration", () => {
  it("resolves imported sub-modules and flattens nested instances across files", () => {
    const libFile = parseAtopile(`
module RCStage:
    signal input
    signal output
    signal gnd
    r = new Resistor
    c = new Capacitor
    r.resistance = 1kohm
    c.capacitance = 100nF
    input ~> r ~> output
    output ~> c ~> gnd
`);
    const topFile = parseAtopile(`
from "rc_stage.ato" import RCStage

module TopBoard:
    signal vin
    signal vout
    signal gnd
    stage1 = new RCStage
    vin ~ stage1.input
    vout ~ stage1.output
    gnd ~ stage1.gnd
`);

    const elab = elaborateAtopileProject(topFile, { "rc_stage.ato": libFile });
    assert.strictEqual(elab.components.length, 2);
    assert(elab.components.some((c) => c.refDes === "stage1_r"));
    assert(elab.components.some((c) => c.refDes === "stage1_c"));
    assert.strictEqual(elab.pinNetMap.get("stage1_r.p1"), "vin");
    assert.strictEqual(elab.pinNetMap.get("stage1_c.p1"), "vout");
    assert.strictEqual(elab.pinNetMap.get("stage1_c.p2"), "gnd");
  });
});
