// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerSwmmToDae, parseSwmm } from "../src/index.js";
import { SWMM_URBAN_WATERSHED_BENCHMARK } from "./swmm-benchmark-runner.js";

test("SWMM DAE Lowering: builds valid DAE arena with continuity equations", () => {
  const project = parseSwmm(SWMM_URBAN_WATERSHED_BENCHMARK);
  const dae = lowerSwmmToDae(project);

  assert.ok(dae.getVarCount() >= 5, "DAE must declare junction heads and conduit flows");
  assert.ok(dae.getEqCount() >= 5, "DAE must declare momentum and mass continuity equations");
});
