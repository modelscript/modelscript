// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCplexLp } from "../src/index.js";

describe("@modelscript/cplex-lp Parser Suite", () => {
  it("parses a standard CPLEX LP problem with comments, bounds, generals, binaries, semi-continuous, and SOS", () => {
    const source = `
\\ Standard CPLEX LP full-feature test
Maximize
  obj: 3 x1 + 2.5 x2 - 4 x3 + 1.5e1 x4 + 10
Subject To
  c1: x1 + 2 x2 <= 10
  c2: 3 x1 - x3 >= 4
  c3: x2 + x4 = 6
Bounds
  0 <= x1 <= 8
  x2 >= 1
  x3 free
  -inf <= x4 <= +infinity
Generals
  x1
Binaries
  y1 y2
Semi-Continuous
  s1
SOS
  sos1: S1:: y1:1 y2:2
End
`;
    const model = parseCplexLp(source, "FullFeature");
    assert.strictEqual(model.dialect, "cplex-lp");
    assert.strictEqual(model.hasEnd, true);
    assert.strictEqual(model.parseErrors.length, 0);
    assert.strictEqual(model.comments.length, 1);

    assert.ok(model.objective);
    assert.strictEqual(model.objective.sense, "maximize");
    assert.strictEqual(model.objective.name, "obj");
    assert.strictEqual(model.objective.linearTerms.length, 4);
    assert.strictEqual(model.objective.constant, 10);
    assert.strictEqual(model.objective.linearTerms[3]?.coeff, 15);

    assert.strictEqual(model.constraints.length, 3);
    assert.strictEqual(model.constraints[0]?.name, "c1");
    assert.strictEqual(model.constraints[0]?.sense, "<=");
    assert.strictEqual(model.constraints[0]?.rhs, 10);
    assert.strictEqual(model.constraints[1]?.sense, ">=");
    assert.strictEqual(model.constraints[2]?.sense, "=");

    assert.strictEqual(model.variables.get("x1")?.domain, "general");
    assert.strictEqual(model.variables.get("x1")?.lower, 0);
    assert.strictEqual(model.variables.get("x1")?.upper, 8);
    assert.strictEqual(model.variables.get("x2")?.lower, 1);
    assert.strictEqual(model.variables.get("x3")?.isFree, true);
    assert.strictEqual(model.variables.get("x3")?.lower, -Infinity);
    assert.strictEqual(model.variables.get("x3")?.upper, Infinity);
    assert.strictEqual(model.variables.get("x4")?.lower, -Infinity);
    assert.strictEqual(model.variables.get("x4")?.upper, Infinity);
    assert.strictEqual(model.variables.get("y1")?.domain, "binary");
    assert.strictEqual(model.variables.get("y2")?.domain, "binary");
    assert.strictEqual(model.variables.get("s1")?.domain, "semi-continuous");

    assert.strictEqual(model.sos.length, 1);
    assert.strictEqual(model.sos[0]?.name, "sos1");
    assert.strictEqual(model.sos[0]?.type, "S1");
    assert.strictEqual(model.sos[0]?.entries.length, 2);
    assert.strictEqual(model.sos[0]?.entries[0]?.weight, 1);
    assert.strictEqual(model.sos[0]?.entries[1]?.weight, 2);
  });

  it("parses quadratic objectives `[ ... ] / 2` and multi-line constraints", () => {
    const source = `
Minimize
  qp_obj: - 4 x1 - 6 x2
          + [ 2 x1 ^ 2 - 2 x1 * x2 + 4 x2 ^ 2 ] / 2
Subject To
  cap: x1
     + 2 x2 <= 5
  eq1: x1 + x2 = 3
End
`;
    const model = parseCplexLp(source);
    assert.strictEqual(model.parseErrors.length, 0);
    assert.ok(model.objective?.quadratic);
    assert.strictEqual(model.objective.quadratic.divisor, 2);
    assert.strictEqual(model.objective.quadratic.terms.length, 3);
    assert.deepStrictEqual(
      model.objective.quadratic.terms.map((t) => [t.coeff, t.var1, t.var2]),
      [
        [2, "x1", "x1"],
        [-2, "x1", "x2"],
        [4, "x2", "x2"],
      ],
    );
    assert.strictEqual(model.constraints.length, 2);
    assert.strictEqual(model.constraints[0]?.linearTerms.length, 2);
  });

  it("parses unnamed constraints and fixed bounds", () => {
    const source = `
Minimize
  x1 + x2
Subject To
  x1 + x2 >= 2
  2 x1 + x2 <= 5
Bounds
  x1 = 1.5
End
`;
    const model = parseCplexLp(source);
    assert.strictEqual(model.parseErrors.length, 0);
    assert.strictEqual(model.constraints.length, 2);
    assert.strictEqual(model.constraints[0]?.hasExplicitName, false);
    assert.strictEqual(model.constraints[0]?.name, "c1");
    assert.strictEqual(model.variables.get("x1")?.lower, 1.5);
    assert.strictEqual(model.variables.get("x1")?.upper, 1.5);
  });
});
