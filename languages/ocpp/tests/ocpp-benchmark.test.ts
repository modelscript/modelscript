// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runOcppBenchmark } from "./ocpp-benchmark-runner.js";

test("OCPP Benchmark: 4-EVSE fleet depot smart charging allocation and DAE lowering", () => {
  const metrics = runOcppBenchmark();

  assert.equal(metrics.stationsCount, 1);
  assert.equal(metrics.evseCount, 4);
  assert.equal(metrics.activeSessionsCount, 4);
  assert.ok(metrics.totalAllocatedPowerKW > 200 && metrics.totalAllocatedPowerKW <= 350);
  assert.equal(metrics.gridLimitRespected, true);
  assert.ok(metrics.busAllocatedKW > 0);
  assert.ok(metrics.vanAllocatedKW > 0);
  assert.equal(metrics.daeVarCount, 14);
  assert.equal(metrics.daeEqCount, 14);
  assert.equal(metrics.isSquare, true);
});
