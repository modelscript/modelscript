// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runAntimonyBenchmark } from "./antimony-benchmark-runner.js";

test("Antimony Benchmark: executes Kholodenko 2000 MAPK signaling cascade simulation", () => {
  const metrics = runAntimonyBenchmark();

  assert.equal(metrics.speciesCount, 8);
  assert.equal(metrics.reactionsCount, 10);
  assert.equal(metrics.compartmentsCount, 1);
  assert.ok(metrics.rulesCount >= 3);
  assert.ok(metrics.stepsCount >= 300);
  assert.equal(metrics.totalMkkkConserved, true);
  assert.equal(metrics.totalMkkConserved, true);
  assert.equal(metrics.totalMapkConserved, true);
  assert.ok(metrics.finalActiveMapkPp > 0);
  assert.ok(metrics.daeVarCount >= 20);
  assert.equal(metrics.isSquare, true);
  assert.ok(metrics.modelicaLines > 20);
  assert.ok(metrics.sbmlXmlLength > 500);
});
