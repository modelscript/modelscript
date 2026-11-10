// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runSwmmBenchmark } from "./swmm-benchmark-runner.js";

test("EPA SWMM Benchmark: 5-node urban drainage network with dynamic wave routing", () => {
  const metrics = runSwmmBenchmark();

  assert.ok(metrics.nodesCount >= 5, "Total nodes must be >= 5");
  assert.ok(metrics.conduitsCount >= 5, "Total conduits must be >= 5");
  assert.ok(metrics.subcatchmentsCount >= 3, "Subcatchments count must be >= 3");
  assert.ok(metrics.totalInflowCms > 0, "Total system inflow must be positive");
  assert.ok(metrics.outfallDischargeCms > 0, "Outfall discharge must be positive");
  assert.ok(metrics.totalInflowCms >= metrics.outfallDischargeCms, "Total conduit flow volume must exceed outfall discharge");
  assert.ok(metrics.preissmannCelerityMS > 1.0, "Preissmann gravity wave celerity must exceed 1 m/s");
  assert.ok(metrics.daeVarCount > 10, "DAE state variables must exceed 10");
  assert.ok(metrics.daeEqCount > 10, "DAE equations must exceed 10");
});
