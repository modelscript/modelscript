// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileToIPC2581, exportToSpecctraDsn, parseIPC2581 } from "@modelscript/cad/ecad";
import assert from "node:assert";
import { describe, it } from "node:test";
import { elaborateAtopile } from "../src/netlist.js";
import { parseAtopile } from "../src/parser/atopile-parser.js";

describe("@modelscript/atopile — End-to-End ECAD Manufacturing Round-Trip", () => {
  it("lowers .ato -> NetlistGraph -> IPC-2581C -> parseIPC2581 -> Specctra DSN", () => {
    const file = parseAtopile(`
module SensorPullup:
    signal vcc
    signal sda
    signal gnd
    r_pull = new Resistor
    r_pull.resistance = 4.7kohm +/- 1%
    r_pull.footprint = "0603"
    vcc ~> r_pull ~> sda
`);
    const elab = elaborateAtopile(file);
    const ipcXml = compileToIPC2581({
      traces: [],
      pads: [],
      vias: [],
      outline: {
        vertices: [
          [0, 0],
          [30, 0],
          [30, 20],
          [0, 20],
        ],
      },
      netlist: elab.netlist,
      bom: elab.bom,
    });
    const parsed = parseIPC2581(ipcXml);
    assert.strictEqual(parsed.diagnostics.length, 0);
    const dsn = exportToSpecctraDsn(parsed.layout, { designName: "SensorPullup" });
    assert(dsn.includes("(net vcc"));
    assert(dsn.includes("(net sda"));
  });
});
