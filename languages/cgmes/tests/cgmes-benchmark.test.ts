// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runCgmesBenchmark } from "./cgmes-benchmark-runner.js";

test("CGMES Benchmark: ingests ENTSO-E transmission corridor and solves AC power flow & DAE lowering", () => {
  const metrics = runCgmesBenchmark();

  assert.equal(metrics.substationsCount, 3);
  assert.equal(metrics.nodesCount, 3);
  assert.equal(metrics.linesCount, 3);
  assert.equal(metrics.generatorsCount, 2);
  assert.equal(metrics.loadsCount, 2);
  assert.equal(metrics.powerFlowConverged, true);
  assert.equal(metrics.totalGenerationMw, 770.0);
  assert.equal(metrics.totalLoadMw, 750.0);
  assert.ok(metrics.daeVarCount >= 10);
  assert.ok(metrics.daeEqCount >= 6);
  assert.ok(metrics.modelicaLines > 20);
});
