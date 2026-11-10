// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runIbisBenchmark } from "./ibis-benchmark-runner.js";

test("IBIS Benchmark: simulates 10 Gbps SerDes channel with algorithmic equalization and DAE lowering", () => {
  const metrics = runIbisBenchmark();

  assert.equal(metrics.componentsCount, 1);
  assert.equal(metrics.pinsCount, 6);
  assert.equal(metrics.modelsCount, 2);
  assert.ok(metrics.rOnLowOhms > 10.0 && metrics.rOnLowOhms < 60.0);
  assert.ok(metrics.rOnHighOhms > 10.0 && metrics.rOnHighOhms < 60.0);
  assert.ok(metrics.equalizedEyeHeightV > metrics.unequalizedEyeHeightV);
  assert.ok(metrics.equalizedEyeWidthPs > 20.0);
  assert.ok(metrics.eyeHeightBer1e12V > 0);
  assert.ok(metrics.daeVarCount >= 8);
  assert.equal(metrics.isSquare, true);
  assert.ok(metrics.modelicaLines > 20);
});
