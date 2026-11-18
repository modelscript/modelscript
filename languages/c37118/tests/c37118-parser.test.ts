// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseC37118 } from "../src/parser/c37118-parser.js";

describe("IEEE C37.118 Parser", () => {
  it("parses text and JSON PMU configurations", () => {
    const src = `
pmu Sub_East_PMU idcode=101 fnom=60 rate=30
phasor VA_1 V format=polar scale=1.0 mag=138000 ang=0.0
phasor IA_1 I format=polar scale=1.0 mag=420 ang=-12.5
analog P_MW units=MW scale=1.0 init=100.4
digital BRK_52A
frame 2026-11-17T20:00:00.000Z 60.002 -0.01
`;
    const cfg = parseC37118(src);
    assert.equal(cfg.stn, "Sub_East_PMU");
    assert.equal(cfg.idcode, 101);
    assert.equal(cfg.fnom, 60);
    assert.equal(cfg.dataRate, 30);
    assert.equal(cfg.phasors.length, 2);
    assert.equal(cfg.analogs.length, 1);
    assert.equal(cfg.digitals.length, 1);
    assert.equal(cfg.frames.length, 1);

    const jsonCfg = parseC37118(JSON.stringify(cfg));
    assert.equal(jsonCfg.phasors.length, 2);
  });
});
