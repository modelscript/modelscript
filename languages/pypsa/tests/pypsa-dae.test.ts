// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerPypsaToDae } from "../src/dae/pypsa-to-dae.js";
import { parsePypsa } from "../src/parser/pypsa-parser.js";

describe("PyPSA DAE Lowering", () => {
  it("lowers buses, lines, links, and storage ODEs into DAEBuilder", () => {
    const net = parsePypsa(`
bus North v_nom=380
bus South v_nom=380
generator G1 bus=North p_nom=200
load L1 bus=South p_set=150
line Line1 bus0=North bus1=South r=1.0 x=10.0
storage_unit BESS bus=South p_nom=50 max_hours=4 efficiency_store=0.9 efficiency_dispatch=0.9
`);
    const dae = lowerPypsaToDae(net);
    assert.notEqual(dae.lookupVariable("theta_North"), -1);
    assert.notEqual(dae.lookupVariable("P_line_Line1"), -1);
    assert.notEqual(dae.lookupVariable("E_stor_BESS"), -1);
    assert.ok(dae.equations().length >= 5);
  });
});
