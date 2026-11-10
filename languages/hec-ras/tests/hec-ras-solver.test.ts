// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGeometry } from "../src/parser/hec-ras-parser.js";
import {
  computeNormalDepth,
  computeSectionProperties,
  solveWaterSurfaceProfile,
} from "../src/solver/steady-step-solver.js";

const TRAPEZOIDAL_CHANNEL = `
Geom Title=Trapezoidal Channel Benchmark
River Reach=Canal,Main
Reach XY=2
0, 0
1000, 0

Type RM CEM CS= 1 ,1000    ,        ,
Station Elevation Data= 4
0, 105  10, 100  30, 100  40, 105
Cross Section Reach Lengths and Manning Values=
500, 500, 500, 3, 0.025, 0.025, 0.025, 0, 0
Bank Sta=10,30

Type RM CEM CS= 1 ,500     ,        ,
Station Elevation Data= 4
0, 104.5  10, 99.5  30, 99.5  40, 104.5
Cross Section Reach Lengths and Manning Values=
500, 500, 500, 3, 0.025, 0.025, 0.025, 0, 0
Bank Sta=10,30
`;

describe("HEC-RAS Hydraulic Solver", () => {
  it("computes open-channel geometric properties accurately", () => {
    const geom = parseGeometry(TRAPEZOIDAL_CHANNEL);
    const cs = geom.crossSections[0]!;

    // Water level at 102 (depth = 2m above invert 100)
    // Bottom width = 20m, side slopes 1:2 -> top width = 20 + 2 * (2 / 5 * 10) = 28m
    const props = computeSectionProperties(cs, 102);
    assert.ok(props.area > 0);
    assert.ok(props.wettedPerimeter > 0);
    assert.ok(props.hydraulicRadius > 0);
    assert.strictEqual(props.invertElevation, 100);
  });

  it("computes normal depth via Manning equation", () => {
    const geom = parseGeometry(TRAPEZOIDAL_CHANNEL);
    const cs = geom.crossSections[1]!; // downstream section, invert 99.5

    const yn = computeNormalDepth(cs, 50.0, 0.001);
    assert.ok(yn > 99.5, "Normal stage must be higher than invert elevation");
    assert.ok(yn < 104.5, "Normal stage must remain within channel banks");
  });

  it("solves 1D backwater surface profile (WSP) across reach", () => {
    const geom = parseGeometry(TRAPEZOIDAL_CHANNEL);
    const results = solveWaterSurfaceProfile(geom, {
      discharge: 50.0,
      frictionSlope: 0.001,
    });

    assert.strictEqual(results.length, 2);

    const ds = results[1]!; // station 500
    const us = results[0]!; // station 1000

    assert.strictEqual(ds.station, 500);
    assert.strictEqual(us.station, 1000);

    // Subcritical flow check
    assert.ok(ds.froudeNumber < 1.0, `Downstream Froude number ${ds.froudeNumber} should be subcritical (< 1.0)`);
    assert.ok(us.froudeNumber < 1.0, `Upstream Froude number ${us.froudeNumber} should be subcritical (< 1.0)`);

    // Upstream energy grade line must be higher than downstream due to friction losses
    assert.ok(
      us.energyGradeLine > ds.energyGradeLine,
      `Upstream EGL (${us.energyGradeLine}) must be greater than downstream EGL (${ds.energyGradeLine})`,
    );
  });
});
