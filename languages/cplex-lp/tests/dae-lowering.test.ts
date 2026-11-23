// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cplexLpToDae, lowerCplexLpToDae, parseCplexLp } from "../src/index.js";

describe("@modelscript/cplex-lp DAE Lowering Suite", () => {
  it("lowers a linear program with equality and inequality constraints directly to DAEBuilder", () => {
    const source = `
Maximize
  profit: 3 x1 + 5 x2
Subject To
  plant1: x1 <= 4
  plant2: 2 x2 >= 2
  balance: x1 + x2 = 5
End
`;
    const model = parseCplexLp(source, "ProductionLP");
    const res = lowerCplexLpToDae(model);

    assert.strictEqual(res.variableIds.size, 2);
    assert.ok(res.objectiveVarId !== undefined);
    // plant1 (<=) gets slack, plant2 (>=) gets surplus, balance (=) gets none
    assert.strictEqual(res.slackVarIds.size, 2);
    assert.ok(res.slackVarIds.has("plant1"));
    assert.ok(res.slackVarIds.has("plant2"));
    assert.strictEqual(res.equationCount, 4); // 1 objective + 3 constraints
    assert.strictEqual(res.quadraticTermCount, 0);
    assert.strictEqual(res.builder.eqCount, 4);
    assert.strictEqual(res.builder.varCount, 5); // x1, x2, _obj_profit, _slack_plant1_0, _surplus_plant2_1
  });

  it("lowers a MILP + QP model preserving integer variable types and quadratic terms", () => {
    const source = `
Minimize
  risk: - 2 x1 - 3 x2 + [ 4 x1 ^ 2 + 2 x1 * x2 + 6 x2 ^ 2 ] / 2
Subject To
  budget: x1 + x2 <= 10
  link: x1 - 10 y1 <= 0
Binaries
  y1
End
`;
    const model = parseCplexLp(source, "PortfolioMIQP");
    const res = lowerCplexLpToDae(model);

    assert.strictEqual(res.variableIds.size, 3);
    assert.strictEqual(res.quadraticTermCount, 3);
    assert.strictEqual(res.equationCount, 3); // 1 objective + 2 constraints
    assert.strictEqual(res.builder.eqCount, 3);

    const dae = cplexLpToDae(model, { modelName: "CustomMIQP" });
    assert.strictEqual(dae.eqCount, 3);
    assert.ok(dae.varCount >= 5);
  });
});
