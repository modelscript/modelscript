// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runFeaBenchmark } from "./fea-benchmark-runner.js";

test("FEA Benchmark: Abaqus/CalculiX cantilever beam modal dynamics and DAE lowering", () => {
  const metrics = runFeaBenchmark();

  assert.equal(metrics.nodesCount, 12);
  assert.equal(metrics.elementsCount, 2);
  assert.equal(metrics.materialsCount, 1);
  assert.equal(metrics.stepsCount, 2);
  assert.equal(metrics.youngsModulusGPa, 210.0);
  assert.equal(metrics.densityKgM3, 7850.0);
  assert.ok(metrics.analyticalDeflectionMm > 1.5 && metrics.analyticalDeflectionMm < 2.5);
  assert.ok(metrics.fundamentalFreqHz > 30.0 && metrics.fundamentalFreqHz < 50.0);
  assert.ok(metrics.daeVarCount >= 40);
  assert.ok(metrics.daeEqCount >= 38);
});
