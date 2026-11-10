// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSwmm,
  solveSwmmHydraulics,
  computeSubcatchmentRunoff,
  computePreissmannSection,
} from "../src/index.js";
import { SWMM_URBAN_WATERSHED_BENCHMARK } from "./swmm-benchmark-runner.js";

test("SWMM Solver: executes dynamic wave routing with positive conduits flow", () => {
  const project = parseSwmm(SWMM_URBAN_WATERSHED_BENCHMARK);
  const result = solveSwmmHydraulics(project, { durationSeconds: 60.0, timeStepSeconds: 5.0 });

  assert.ok(result.totalInflow > 0, "Total system inflow must be positive");
  assert.ok(result.totalOutflow > 0, "Outfall discharge must be positive");

  for (const [cid, conduitRes] of result.conduits) {
    assert.ok(typeof conduitRes.flowRate === "number", `Conduit ${cid} must have valid numerical flow rate`);
  }
});

test("SWMM Solver: Preissmann slot calculation handles circular sections", () => {
  const partial = computePreissmannSection(1.0, 0.5, 50.0);
  const surcharged = computePreissmannSection(1.0, 1.2, 50.0);

  assert.ok(partial.area > 0, "Partial area must be positive");
  assert.ok(surcharged.area > partial.area, "Surcharged area must exceed partial area");
  assert.ok(surcharged.topWidth > 0, "Preissmann slot top width must be positive");
});
