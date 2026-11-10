// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateArcFlashHazard,
  calculateArcingCurrent,
} from "../src/solvers/protection/arc-flash.js";

test("calculateArcingCurrent: evaluates arcing currents across LV and MV configurations", () => {
  // Low Voltage 480V (0.48 kV), 25 kA bolted fault, 25mm gap
  const lvRes = calculateArcingCurrent(0.48, 25.0, 25.0, "VCB");
  assert.ok(lvRes.iArcKa > 10.0 && lvRes.iArcKa < 25.0, "Arcing current should be realistic fraction of bolted fault");
  assert.ok(lvRes.iArcMinKa < lvRes.iArcKa, "Reduced current should be ~85% of arcing current");

  // Medium Voltage 4.16 kV, 20 kA bolted fault, 104mm gap
  const mvRes = calculateArcingCurrent(4.16, 20.0, 104.0, "HCB");
  assert.ok(mvRes.iArcKa > 12.0 && mvRes.iArcKa < 20.0);
});

test("calculateArcFlashHazard: computes incident energy, boundary, and PPE category", () => {
  const result = calculateArcFlashHazard({
    vNominalKv: 0.48,
    iBoltedFaultKa: 30.0,
    electrodeConfig: "VCB",
    gapMm: 25.0,
    workingDistanceMm: 457.0, // 18 inches
    clearingTimeSec: 0.15, // 150 ms clearing time
  });

  assert.ok(result.incidentEnergyCalPerCm2 > 1.0, "Incident energy should be greater than 1 cal/cm2");
  assert.ok(result.arcFlashBoundaryMm > 457.0, "AFB should exceed working distance");
  assert.ok(result.arcFlashBoundaryInches > 18.0);
  assert.ok(result.warningLabel.includes("ARC FLASH HAZARD ASSESSMENT"));
  assert.ok(["Category 1", "Category 2", "Category 3"].includes(result.ppeCategory));
});

test("calculateArcFlashHazard: flags high incident energy as dangerous", () => {
  const severeResult = calculateArcFlashHazard({
    vNominalKv: 13.8,
    iBoltedFaultKa: 40.0,
    electrodeConfig: "HCB",
    gapMm: 152.0,
    workingDistanceMm: 914.0, // 36 inches
    clearingTimeSec: 1.5, // Slow clearing time: 1.5 seconds
  });

  assert.ok(severeResult.incidentEnergyCalPerCm2 > 40.0, "Severe arc should exceed 40 cal/cm2");
  assert.strictEqual(severeResult.ppeCategory, "DANGEROUS: EXCEEDS PPE 4");
});
