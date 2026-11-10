// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runOpenScenarioBenchmark } from "./openscenario-benchmark-runner.js";

test("OpenSCENARIO Benchmark: executes multi-agent highway cut-in and emergency braking simulation", () => {
  const metrics = runOpenScenarioBenchmark();

  assert.equal(metrics.entitiesCount, 3);
  assert.equal(metrics.storiesCount, 1);
  assert.equal(metrics.durationSeconds, 8.0);
  assert.ok(metrics.stepsCount >= 160);
  assert.equal(metrics.hasCollision, false);
  assert.ok(metrics.minTtcSeconds > 0 && metrics.minTtcSeconds < 20);
  assert.ok(metrics.minDistanceMeters > 0);
  assert.ok(metrics.daeVarCount >= 18);
  assert.ok(metrics.daeEqCount >= 18);
  assert.ok(metrics.modelicaLines > 20);
});
