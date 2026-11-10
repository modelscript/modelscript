// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { instantiateAmpl, parseAmplData, parseAmplModel, solveAmpl } from "../src/index.js";

test("AMPL LP Solver — solves 2-variable linear production planning LP", async () => {
  const modelSrc = `
    var x1 >= 0;
    var x2 >= 0;

    maximize Profit:
      3 * x1 + 5 * x2;

    s.t. Labor:
      x1 <= 4;

    s.t. Machine:
      2 * x2 <= 12;

    s.t. Resource:
      3 * x1 + 2 * x2 <= 18;
  `;

  const model = parseAmplModel(modelSrc);
  const problem = instantiateAmpl(model);
  const result = await solveAmpl(problem);

  assert.strictEqual(result.status, "OPTIMAL");
  assert.ok(Math.abs(result.objectiveValue - 36) < 1e-4, `Expected profit 36, got ${result.objectiveValue}`);
  assert.ok(Math.abs(result.variables["x1"]! - 2) < 1e-4, `Expected x1=2, got ${result.variables["x1"]}`);
  assert.ok(Math.abs(result.variables["x2"]! - 6) < 1e-4, `Expected x2=6, got ${result.variables["x2"]}`);
});

test("AMPL LP Solver — solves Dantzig diet problem", async () => {
  const modSrc = `
    set FOOD;
    set NUTR;

    param cost {FOOD} >= 0;
    param min_req {NUTR} >= 0;
    param content {NUTR, FOOD} >= 0;

    var Buy {FOOD} >= 0;

    minimize Total_Cost:
      sum {j in FOOD} cost[j] * Buy[j];

    subject to Requirement {i in NUTR}:
      sum {j in FOOD} content[i, j] * Buy[j] >= min_req[i];
  `;

  const datSrc = `
    set FOOD := BREAD MILK CHEESE ;
    set NUTR := CAL PRO ;

    param cost :=
      BREAD  2.0
      MILK   3.0
      CHEESE 2.5 ;

    param min_req :=
      CAL 2000
      PRO   50 ;

    param content :
             BREAD MILK CHEESE :=
      CAL     1000  500   800
      PRO       20   30    25 ;
  `;

  const model = parseAmplModel(modSrc);
  const data = parseAmplData(datSrc);
  const problem = instantiateAmpl(model, data);
  const result = await solveAmpl(problem);

  assert.strictEqual(result.status, "OPTIMAL");
  assert.ok(result.objectiveValue > 0);
  assert.ok(result.variables["Buy[BREAD]"] !== undefined);
  assert.ok(result.variables["Buy[MILK]"] !== undefined);
  assert.ok(result.variables["Buy[CHEESE]"] !== undefined);
});
