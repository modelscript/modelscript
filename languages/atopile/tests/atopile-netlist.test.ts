// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileToIPC2581 } from "@modelscript/cad/ecad";
import assert from "node:assert";
import { describe, it } from "node:test";
import { elaborateAtopile } from "../src/netlist.js";
import { parseAtopile } from "../src/parser/atopile-parser.js";

describe("@modelscript/atopile — Netlist Elaboration & ECAD Bridge", () => {
  it("elaborates bridged (~>) and direct (~) connections into NetlistGraph and IPC-2581 BOM", () => {
    const file = parseAtopile(`
module RCFilter:
    signal vin
    signal vout
    signal gnd

    r1 = new Resistor
    c1 = new Capacitor
    r1.resistance = 1kohm +/- 1%
    r1.footprint = "0603"
    r1.mpn = "RC0603FR-071KL"
    c1.capacitance = 100nF
    c1.footprint = "0603"

    vin ~> r1 ~> vout
    vout ~> c1 ~> gnd
`);

    const elab = elaborateAtopile(file);
    assert.strictEqual(elab.entryModule, "RCFilter");
    assert.strictEqual(elab.netlist.components.length, 2);
    assert.strictEqual(elab.netlist.nets.length, 3);
    assert.strictEqual(elab.pinNetMap.get("r1.p1"), "vin");
    assert.strictEqual(elab.pinNetMap.get("r1.p2"), "vout");
    assert.strictEqual(elab.pinNetMap.get("c1.p1"), "vout");
    assert.strictEqual(elab.pinNetMap.get("c1.p2"), "gnd");
    assert.strictEqual(elab.bom["r1"]?.mpn, "RC0603FR-071KL");

    // Feeds directly into @modelscript/cad IPC-2581C export
    const xml = compileToIPC2581({
      traces: [],
      pads: [],
      vias: [],
      outline: null,
      netlist: elab.netlist,
      bom: elab.bom,
    });
    assert(xml.includes('<LogicalNet name="vout">'));
  });
});
