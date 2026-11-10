// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runSbolBenchmark } from "./sbol-benchmark-runner.js";

test("SBOL Benchmark: simulates Repressilator oscillatory genetic circuit and lowers to DAE arena", () => {
  const metrics = runSbolBenchmark();

  assert.ok(metrics.componentsCount >= 8);
  assert.equal(metrics.sequencesCount, 3);
  assert.equal(metrics.interactionsCount, 3);
  assert.equal(metrics.speciesCount, 3);
  assert.ok(metrics.trajectoryStepsCount >= 700);
  assert.ok(metrics.oscillationAmplitude > 1.0);
  assert.ok(metrics.daeVarCount >= 6);
  assert.equal(metrics.isSquare, true);
  assert.ok(metrics.modelicaLines > 10);
  assert.ok(metrics.sbmlXmlBytes > 200);
});
