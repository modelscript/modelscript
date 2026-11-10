// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runHecRasBenchmark } from "./hec-ras-benchmark-runner.js";

test("HEC-RAS Benchmark: 4-cross-section river reach step-backwater hydraulic simulation and DAE lowering", () => {
  const metrics = runHecRasBenchmark();

  assert.equal(metrics.crossSectionsCount, 4);
  assert.equal(metrics.dischargeM3s, 120.0);
  assert.ok(metrics.downstreamNormalDepthM > 2.0 && metrics.downstreamNormalDepthM < 4.0);
  assert.ok(metrics.upstreamWselM > metrics.downstreamWselM);
  assert.ok(metrics.maxFroudeNumber < 1.0, "Flow must be subcritical");
  assert.ok(metrics.totalHeadLossM > 0, "Head loss must be positive");
  assert.equal(metrics.daeVarCount, 17);
  assert.equal(metrics.daeEqCount, 12);
});
