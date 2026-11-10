// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintSwmm, parseSwmm } from "../src/index.js";
import { SWMM_URBAN_WATERSHED_BENCHMARK } from "./swmm-benchmark-runner.js";

test("SWMM Linter: valid reference benchmark reports 0 critical errors", () => {
  const project = parseSwmm(SWMM_URBAN_WATERSHED_BENCHMARK);
  const diags = lintSwmm(project);

  const errors = diags.filter((d) => d.severity === "error");
  assert.equal(errors.length, 0, `Expected 0 errors on valid benchmark, got: ${JSON.stringify(errors)}`);
});

test("SWMM Linter: detects disconnected links and unknown node references", () => {
  const invalidInp = `[JUNCTIONS]
J1 10.0 2.0 0.0 0.0 0.0

[CONDUITS]
C1 J1 MISSING_NODE 100.0 0.013 0.0 0.0
`;
  const project = parseSwmm(invalidInp);
  const diags = lintSwmm(project);

  assert.ok(diags.length > 0, "Linter must report diagnostic for missing destination node");
});
