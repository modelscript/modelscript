// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runSedmlBenchmark } from "./sedml-benchmark-runner.js";

test("SED-ML Benchmark: executes industrial metabolic experiment with model changes and DAE lowering", () => {
  const metrics = runSedmlBenchmark();

  assert.equal(metrics.simulationsCount, 2);
  assert.equal(metrics.modelsCount, 2);
  assert.equal(metrics.tasksCount, 3);
  assert.equal(metrics.dataGeneratorsCount, 4);
  assert.equal(metrics.outputsCount, 2);
  assert.equal(metrics.timeStepsCount, 101);
  assert.ok(metrics.initialSubstrate >= 50.0);
  assert.ok(metrics.finalSubstrate < metrics.initialSubstrate);
  assert.ok(metrics.finalYieldPct > 75.0);
  assert.equal(metrics.reportRowCount, 101);
  assert.ok(metrics.sweepPointCount >= 200);
  assert.ok(metrics.daeVarCount >= 10);
  assert.equal(metrics.isSquare, true);
  assert.ok(metrics.modelicaLines > 10);
});
