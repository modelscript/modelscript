// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerPlsCaddToDae } from "../src/dae/plscadd-to-dae.js";
import { parsePlsCadd } from "../src/parser/plscadd-parser.js";

describe("PLS-CADD DAE Lowering", () => {
  it("lowers span sag-tension and R/X impedance into DAEBuilder", () => {
    const model = parsePlsCadd(`
LINE L230 voltage_kv=230
CONDUCTOR Drake weight_n_per_m=16.0 r_ohm_per_km=0.072 gmr_m=0.0114
STRUCTURE T1 x=0 y=0 height_m=30
STRUCTURE T2 x=300 y=0 height_m=30
SPAN S1 from=T1 to=T2 conductor=Drake tension_n=30000
`);
    const dae = lowerPlsCaddToDae(model);
    assert.notEqual(dae.lookupVariable("H_S1"), -1);
    assert.notEqual(dae.lookupVariable("sag_S1"), -1);
    assert.notEqual(dae.lookupVariable("R_S1"), -1);
    assert.notEqual(dae.lookupVariable("X_S1"), -1);
    assert.ok(dae.equations().length >= 4);
  });
});
