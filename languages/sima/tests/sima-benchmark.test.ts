// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runSimaBenchmark } from "./sima-benchmark-runner.js";

test("SIMA Benchmark: OC4 semi-submersible 6-DOF Cummins dynamics, DNV-OS-E301 compliance, and DAE lowering", () => {
  const metrics = runSimaBenchmark();

  assert.equal(metrics.vesselsCount, 1);
  assert.equal(metrics.mooringLinesCount, 3);
  assert.equal(metrics.waterDepthM, 200.0);
  assert.equal(metrics.watchCircleRadiusM, 16.0);
  assert.ok(metrics.meanOffsetM > 0 && metrics.meanOffsetM < 16.0);
  assert.ok(metrics.maxSurgeExcursionM >= 0);
  assert.equal(metrics.dnvCompliancePassed, true);
  assert.ok(metrics.minSafetyFactor >= 1.67);
  assert.ok(metrics.fatigueAnnualDamage > 0);
  assert.ok(metrics.daeVarCount > 20);
  assert.ok(metrics.daeEqCount >= 15);
  assert.equal(metrics.daeVarCount, metrics.daeEqCount);
});
