// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToleranceStackVerifier, type DimensionTolerance } from "../src/index.js";

describe("CAD Dynamic GD&T and Operational Tolerance Stack-Up Verifier", () => {
  it("should certify positive clearance for pin-in-housing across thermal operating envelope", () => {
    // Housing bore: Aluminum (nominal 50.0 mm, +0.04/-0.00 mm, CTE = 23 ppm/K)
    // Shaft/Pin: Steel (nominal 49.80 mm, +0.00/-0.03 mm, CTE = 12 ppm/K)
    // Nominal gap = 50.0 - 49.80 = 0.20 mm
    const dimensions: DimensionTolerance[] = [
      {
        name: "HousingBore",
        nominal: 50.0,
        lowerTol: 0.0,
        upperTol: 0.04,
        direction: 1, // Adds to clearance
        material: {
          name: "Aluminum6061",
          ctePpmK: 23.0,
        },
      },
      {
        name: "ShaftDiameter",
        nominal: 49.8,
        lowerTol: -0.03,
        upperTol: 0.0,
        direction: -1, // Subtracts from clearance
        material: {
          name: "Steel4140",
          ctePpmK: 12.0,
        },
      },
    ];

    const result = ToleranceStackVerifier.verify({
      name: "ShaftHousingClearance",
      dimensions,
      environment: {
        refTempC: 20.0,
        operatingTempRange: [-20.0, 100.0],
      },
      minRequiredClearance: 0.1, // Must maintain at least 0.10 mm oil film
    });

    assert.strictEqual(result.isCertifiedSafe, true);
    assert(result.worstCaseMinGap >= 0.1, `Expected min gap >= 0.10, got ${result.worstCaseMinGap}`);
    assert(Math.abs(result.nominalGap - 0.2) < 1e-6);
    assert(result.contributors.length === 2);
    assert(result.summary.includes("CERTIFIED SAFE"));
  });

  it("should detect thermal binding / interference when shaft expands faster than housing", () => {
    // Inverted material scenario:
    // Steel Housing (nominal 30.02 mm, CTE = 12 ppm/K)
    // Brass Shaft (nominal 30.00 mm, CTE = 19 ppm/K)
    // Room temp nominal gap = 0.02 mm (20 microns)
    // High temp 180 degC (+160 degC delta):
    // Brass expands by 30 * 19e-6 * 160 = +0.0912 mm
    // Steel expands by 30 * 12e-6 * 160 = +0.0576 mm
    // Differential thermal expansion closes gap by 0.0336 mm > 0.02 mm => INTERFERENCE!
    const dimensions: DimensionTolerance[] = [
      {
        name: "SteelHousing",
        nominal: 30.02,
        lowerTol: -0.005,
        upperTol: 0.005,
        direction: 1,
        material: {
          name: "Steel",
          ctePpmK: 12.0,
        },
      },
      {
        name: "BrassShaft",
        nominal: 30.0,
        lowerTol: -0.005,
        upperTol: 0.005,
        direction: -1,
        material: {
          name: "Brass",
          ctePpmK: 19.0,
        },
      },
    ];

    const result = ToleranceStackVerifier.verify({
      name: "HighTempBearing",
      dimensions,
      environment: {
        refTempC: 20.0,
        operatingTempRange: [20.0, 180.0],
      },
      minRequiredClearance: 0.005, // 5 microns min
    });

    assert.strictEqual(result.isCertifiedSafe, false);
    assert(result.worstCaseMinGap < 0, `Expected interference (negative gap), got ${result.worstCaseMinGap}`);
    assert(result.summary.includes("Binding or interference risk detected"));
  });
});
