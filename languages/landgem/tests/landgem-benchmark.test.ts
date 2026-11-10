// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runLandgemBenchmark } from "./landgem-benchmark-runner.js";

test("LandGEM Benchmark 42 — Regional Solid Waste & Anaerobic Co-Digestion CHP Facility", () => {
  const metrics = runLandgemBenchmark();

  assert.strictEqual(metrics.siteName, "MetroRegionalLandfill");
  assert.strictEqual(metrics.digesterName, "CentralCoDigestionCHP");
  assert.strictEqual(metrics.wasteCohortsCount, 6);

  // Peak methane should occur around 2010 (last cohort year)
  assert.strictEqual(metrics.peakMethaneYear, 2010);
  assert.ok(metrics.peakMethaneM3PerYear > 5.0e6, "Peak methane rate must exceed 5M m^3/yr");
  assert.ok(metrics.cumulativeMethaneM3 > 5.0e7, "Cumulative methane must exceed 50M m^3");
  assert.ok(metrics.powerPotentialMW > 2.0, "LFG electric capacity should exceed 2 MW");

  // Digester outputs
  assert.ok(metrics.digesterDailyBiogasM3 > 5000, "Daily biogas must exceed 5,000 m^3/day");
  assert.ok(metrics.digesterElectricPowerKW > 500, "CHP electric capacity must exceed 500 kW");
  assert.ok(metrics.digesterThermalPowerKW > 600, "CHP thermal capacity must exceed 600 kW");
  assert.strictEqual(metrics.vfaRisk, "low");

  // DAE Arena
  assert.strictEqual(metrics.daeVarCount, 5);
  assert.strictEqual(metrics.daeEqCount, 5);
  assert.strictEqual(metrics.isSquare, true);
});
