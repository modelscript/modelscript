// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { instantiateAmpl, parseAmplModel, solveAmpl } from "../src/index.js";

test("AMPL NLP Solver — solves convex quadratic optimization problem", async () => {
  const modelSrc = `
    var x1 := 0.5;
    var x2 := 0.5;

    minimize DistanceSq:
      (x1 - 3)^2 + (x2 - 4)^2;
  `;

  const model = parseAmplModel(modelSrc);
  const problem = instantiateAmpl(model);
  assert.strictEqual(problem.problemClass, "NLP");

  const result = await solveAmpl(problem);
  assert.strictEqual(result.status, "OPTIMAL");
  assert.ok(Math.abs(result.variables["x1"]! - 3) < 0.1, `Expected x1 ≈ 3, got ${result.variables["x1"]}`);
  assert.ok(Math.abs(result.variables["x2"]! - 4) < 0.1, `Expected x2 ≈ 4, got ${result.variables["x2"]}`);
  assert.ok(result.objectiveValue < 0.05, `Expected near zero, got ${result.objectiveValue}`);
});
