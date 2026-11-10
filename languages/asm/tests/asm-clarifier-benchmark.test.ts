// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateTakacsSettlingVelocity,
  DEFAULT_TAKACS_CONFIG,
  evaluateTakacsClarifierDerivatives,
} from "../src/clarifier/takacs.js";

describe("Takács 10-Layer Clarifier Sedimentation Benchmark", () => {
  it("should evaluate double-exponential settling velocity curve satisfying tolerance bounds", () => {
    const xMin = 10.0; // g SS/m3

    // At low concentration (flocculant regime, e.g. 500 g/m3)
    const vsLow = calculateTakacsSettlingVelocity(500, xMin);
    assert.ok(vsLow > 0, "Settling velocity should be positive");
    assert.ok(vsLow <= DEFAULT_TAKACS_CONFIG.v0Prime, "Settling velocity must not exceed v0Prime limit");

    // At high concentration (hindered zone, e.g. 8000 g/m3), settling velocity drops significantly
    const vsHigh = calculateTakacsSettlingVelocity(8000, xMin);
    assert.ok(vsHigh < vsLow, "Hindered settling velocity at 8000 g/m3 must be lower than at 500 g/m3");

    // Exact Vesilind limit check
    const vsPeak = calculateTakacsSettlingVelocity(1500, xMin);
    const tolerance = 1e-3;
    const residual = vsPeak - DEFAULT_TAKACS_CONFIG.v0Prime;
    assert.ok(
      residual <= tolerance,
      `Peak settling velocity ${vsPeak} must converge within tolerance ${tolerance} of v0Prime ${DEFAULT_TAKACS_CONFIG.v0Prime}`,
    );
  });

  it("should evaluate 10-layer mass fluxes and concentration derivatives", () => {
    const layerTss = [
      12.0, // Layer 1 (effluent)
      25.0, // Layer 2
      40.0, // Layer 3
      80.0, // Layer 4
      2800.0, // Layer 5 (feed)
      3500.0, // Layer 6
      4500.0, // Layer 7
      5500.0, // Layer 8
      6500.0, // Layer 9
      7800.0, // Layer 10 (underflow)
    ];

    const Qin = 18446.0;
    const Qras = 18446.0;
    const Qwas = 385.0;
    const Qu = Qras + Qwas;

    const result = evaluateTakacsClarifierDerivatives(layerTss, Qin, 2800.0, Qu);

    assert.equal(result.layerStates.length, 10);
    assert.equal(result.layerConcentrationDerivatives.length, 10);
    assert.equal(result.effluentTss, 12.0);
    assert.equal(result.underflowTss, 7800.0);

    // Verify all derivatives are finite real numbers
    for (let m = 0; m < 10; m++) {
      const dX = result.layerConcentrationDerivatives[m]!;
      assert.ok(!Number.isNaN(dX) && Number.isFinite(dX), `Layer ${m + 1} derivative must be finite`);
    }
  });
});
