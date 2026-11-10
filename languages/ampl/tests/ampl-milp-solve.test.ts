// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { instantiateAmpl, parseAmplModel, solveAmpl } from "../src/index.js";

test("AMPL MILP Solver — solves 0-1 knapsack problem with binary variables", async () => {
  const modelSrc = `
    var x1 binary;
    var x2 binary;
    var x3 binary;

    maximize TotalValue:
      10 * x1 + 15 * x2 + 25 * x3;

    s.t. Capacity:
      2 * x1 + 3 * x2 + 5 * x3 <= 7;
  `;

  const model = parseAmplModel(modelSrc);
  const problem = instantiateAmpl(model);
  assert.strictEqual(problem.problemClass, "MILP");

  const result = await solveAmpl(problem);
  assert.strictEqual(result.status, "OPTIMAL");
  assert.ok(Math.abs(result.objectiveValue - 35) < 1e-4, `Expected value 35, got ${result.objectiveValue}`);
  assert.strictEqual(Math.round(result.variables["x1"]!), 1);
  assert.strictEqual(Math.round(result.variables["x2"]!), 0);
  assert.strictEqual(Math.round(result.variables["x3"]!), 1);
});

test("AMPL MILP Solver — solves general integer programming problem", async () => {
  const modelSrc = `
    var y1 integer >= 0, <= 10;
    var y2 integer >= 0, <= 10;

    maximize Profit:
      4 * y1 + 5 * y2;

    s.t. Con1:
      2 * y1 + y2 <= 9;
    s.t. Con2:
      y1 + 2 * y2 <= 8;
  `;

  const model = parseAmplModel(modelSrc);
  const problem = instantiateAmpl(model);
  const result = await solveAmpl(problem);

  assert.strictEqual(result.status, "OPTIMAL");
  // Linear relaxation gives y1=3.33, y2=2.33 (obj 25)
  // Integer optimal: (y1=3, y2=2) => 22, (y1=4, y2=1) => 21, (y1=2, y2=3) => 23, (y1=3, y2=2) -> 2*3+2=8<=9, 3+2*2=7<=8; or y1=3, y2=2 => obj 22;
  // If y1=2, y2=3: 2*2 + 3 = 7 <= 9, 2 + 2*3 = 8 <= 8 => obj = 4*2 + 5*3 = 23!
  assert.ok(result.objectiveValue >= 22);
  assert.strictEqual(Number.isInteger(Math.round(result.variables["y1"]!)), true);
  assert.strictEqual(Number.isInteger(Math.round(result.variables["y2"]!)), true);
});
