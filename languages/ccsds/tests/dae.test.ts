// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lowerCcsdsToDae } from "../src/dae/index.js";
import { parseCcsds } from "../src/parser/index.js";

const SAMPLE_OPM = `CCSDS_OPM_VERS = 2.0
OBJECT_NAME = HUBBLE
REF_FRAME = EME2000
TIME_SYSTEM = UTC
EPOCH = 2026-10-26T00:00:00.000
SEMI_MAJOR_AXIS = 6920.0
ECCENTRICITY = 0.0003
INCLINATION = 28.47
MASS = 11110.0
`;

describe("CCSDS Zero-GC Linear DAE Lowering", () => {
  it("lowers spacecraft orbit model into DAEBuilder linear arena", () => {
    const doc = parseCcsds(SAMPLE_OPM, "hubble.opm");
    const arena = lowerCcsdsToDae(doc);

    assert(arena.getVarCount() >= 12, `Expected >= 12 variables, got ${arena.getVarCount()}`);
    assert(arena.getEqCount() >= 7, `Expected >= 7 equations, got ${arena.getEqCount()}`);

    // Verify key state variables were emitted
    const xVar = arena.findVar("HUBBLE_x");
    assert(xVar !== null);
    const vxVar = arena.findVar("HUBBLE_vx");
    assert(vxVar !== null);
    const rVar = arena.findVar("HUBBLE_r");
    assert(rVar !== null);
    const altVar = arena.findVar("HUBBLE_altitude");
    assert(altVar !== null);
  });
});
