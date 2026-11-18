// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeParabolicSagM,
  computeSpanImpedanceOhms,
  computeSpanLengthM,
  parsePlsCadd,
} from "../src/parser/plscadd-parser.js";

const SAMPLE_PLS = `
LINE Line_230kV voltage_kv=230 freq=60
CONDUCTOR Drake_795 weight_n_per_m=16.0 r_ohm_per_km=0.072 gmr_m=0.0114 rated_tension_n=140000
STRUCTURE T101 station_m=0 x=0 y=0 z_base=100 height_m=30 phase_spacing_m=6.0
STRUCTURE T102 station_m=300 x=300 y=0 z_base=100 height_m=30 phase_spacing_m=6.0
SPAN S1 from=T101 to=T102 conductor=Drake_795 tension_n=30000 min_clearance_m=8.0
TERRAIN 150 0 102.5
`;

describe("PLS-CADD Parser & Physics Helpers", () => {
  it("parses structures, conductors, spans, and terrain and computes sag & impedance", () => {
    const model = parsePlsCadd(SAMPLE_PLS);
    assert.equal(model.lineName, "Line_230kV");
    assert.equal(model.structures.length, 2);
    assert.equal(model.conductors.length, 1);
    assert.equal(model.spans.length, 1);
    assert.equal(model.terrainPoints.length, 1);

    const len = computeSpanLengthM(model.structures[0]!, model.structures[1]!);
    assert.equal(len, 300);

    const sag = computeParabolicSagM(16.0, 300, 30000);
    assert.equal(sag, 6);

    const z = computeSpanImpedanceOhms(300, model.conductors[0]!, 6.0, 60);
    assert.ok(z.rOhms > 0);
    assert.ok(z.xOhms > 0);
  });
});
