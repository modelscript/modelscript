// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerC37118ToDae } from "../src/dae/c37118-to-dae.js";
import { parseC37118 } from "../src/parser/c37118-parser.js";

describe("IEEE C37.118 DAE Lowering", () => {
  it("lowers frequency, ROCOF, and phasor channels into DAEBuilder", () => {
    const cfg = parseC37118(`
pmu PMU_A idcode=1 fnom=60 rate=30
phasor VA V mag=138000 ang=0
phasor IA I mag=400 ang=-10
analog P_MW units=MW init=95.0
`);
    const dae = lowerC37118ToDae(cfg);
    assert.notEqual(dae.lookupVariable("freq_PMU_A"), -1);
    assert.notEqual(dae.lookupVariable("rocof_PMU_A"), -1);
    assert.notEqual(dae.lookupVariable("V_VA_mag"), -1);
    assert.notEqual(dae.lookupVariable("I_IA_ang"), -1);
    assert.notEqual(dae.lookupVariable("analog_P_MW"), -1);
    assert.ok(dae.equations().length >= 1);
  });
});
