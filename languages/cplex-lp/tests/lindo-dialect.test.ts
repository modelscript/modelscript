// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintCplexLp, parseCplexLp, solveCplexLp } from "../src/index.js";

describe("@modelscript/cplex-lp LINDO Dialect Suite", () => {
  it("parses and solves LINDO syntax with TITLE, ! comments, MIN/MAX, ST, < / >, FREE, SLB, SUB, GIN, INT", () => {
    const source = `
TITLE LindoWarehouse
! Classic LINDO algebraic formulation
MAX 12 x1 + 8 x2 - 2 x3 + 5 y1
S.T.
  2) x1 + x2 < 10
  3) x2 - x3 > 1
  4) x1 + 3 y1 <= 9
END
SLB x1 1
SUB x1 6
FREE x3
GIN x1
INT y1
`;
    const model = parseCplexLp(source);
    assert.strictEqual(model.dialect, "lindo");
    assert.strictEqual(model.name, "LindoWarehouse");
    assert.strictEqual(model.hasEnd, true);
    assert.strictEqual(model.parseErrors.length, 0);
    assert.strictEqual(model.comments.length, 1);

    assert.strictEqual(model.constraints.length, 3);
    assert.strictEqual(model.constraints[0]?.operator, "<");
    assert.strictEqual(model.constraints[0]?.sense, "<=");
    assert.strictEqual(model.constraints[1]?.operator, ">");
    assert.strictEqual(model.constraints[1]?.sense, ">=");

    assert.strictEqual(model.variables.get("x1")?.domain, "general");
    assert.strictEqual(model.variables.get("x1")?.lower, 1);
    assert.strictEqual(model.variables.get("x1")?.upper, 6);
    assert.strictEqual(model.variables.get("x3")?.isFree, true);
    assert.strictEqual(model.variables.get("y1")?.domain, "binary");

    const diags = lintCplexLp(model);
    assert.strictEqual(diags.filter((d) => d.severity === "error").length, 0);
  });

  it("supports LINDO numeric-count GIN N and INT N directives after END", () => {
    const source = `
! Knapsack using LINDO INT 3 shorthand
MAX 10 item1 + 14 item2 + 12 item3
ST
  weight: 4 item1 + 5 item2 + 3 item3 < 7
END
INT 3
`;
    const model = parseCplexLp(source);
    assert.strictEqual(model.dialect, "lindo");
    assert.strictEqual(model.binaries.has("item1"), true);
    assert.strictEqual(model.binaries.has("item2"), true);
    assert.strictEqual(model.binaries.has("item3"), true);

    const sol = solveCplexLp(model);
    assert.strictEqual(sol.status, "optimal");
    // Best subset with weight <= 7: item1 (4, val 10) + item3 (3, val 12) = 22
    assert.ok(Math.abs(sol.objectiveValue - 22) < 1e-6, `Expected 22, got ${sol.objectiveValue}`);
    assert.strictEqual(sol.values["item1"], 1);
    assert.strictEqual(sol.values["item2"], 0);
    assert.strictEqual(sol.values["item3"], 1);
  });
});
