// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cplexLpToModelica, cplexLpToMps, parseCplexLp } from "../src/index.js";

describe("@modelscript/cplex-lp Projections Suite (MPS & Modelica)", () => {
  const sampleSource = `
\\ Mixed-integer quadratic optimization model
Minimize
  cost: 4 x1 - 3 x2 + [ 2 x1 ^ 2 - 2 x1 * x2 + 4 x2 ^ 2 ] / 2
Subject To
  c_le: x1 + 2 x2 <= 10
  c_ge: x1 + x2 >= 2
  c_eq: x1 - 5 y1 = 0
Bounds
  1 <= x1 <= 8
  x2 free
Binaries
  y1
SOS
  s1: S1:: x1:1 x2:2
End
`;

  it("projects CPLEX LP model to valid MPS format with OBJSENSE, ROWS, COLUMNS, INTORG/INTEND, RHS, BOUNDS, QUADOBJ, SOS", () => {
    const model = parseCplexLp(sampleSource, "MiqpDemo");
    const mps = cplexLpToMps(model);

    assert.ok(mps.includes("NAME          MiqpDemo"));
    assert.ok(mps.includes("OBJSENSE\n MIN"));
    assert.ok(mps.includes("ROWS"));
    assert.ok(mps.includes(" N  cost"));
    assert.ok(mps.includes(" L  c_le"));
    assert.ok(mps.includes(" G  c_ge"));
    assert.ok(mps.includes(" E  c_eq"));
    assert.ok(mps.includes("COLUMNS"));
    assert.ok(mps.includes("'INTORG'"));
    assert.ok(mps.includes("'INTEND'"));
    assert.ok(mps.includes("RHS"));
    assert.ok(mps.includes("BOUNDS"));
    assert.ok(mps.includes(" FR BND1       x2"));
    assert.ok(mps.includes(" BV BND1       y1"));
    assert.ok(mps.includes("QUADOBJ"));
    assert.ok(mps.includes("SOS"));
    assert.ok(mps.includes(" S1 s1"));
    assert.ok(mps.trimEnd().endsWith("ENDATA"));
  });

  it("projects CPLEX LP model to valid Modelica source", () => {
    const model = parseCplexLp(sampleSource, "MiqpDemo");
    const mo = cplexLpToModelica(model, { modelName: "MiqpOptimization" });

    assert.ok(mo.includes("model MiqpOptimization"));
    assert.ok(mo.includes("Real x1(min = 1, max = 8, start = 1)"));
    assert.ok(mo.includes("Integer y1(min = 0, max = 1, start = 0)"));
    assert.ok(mo.includes("Real _slack_c_le_0(min = 0, start = 0);"));
    assert.ok(mo.includes("Real _surplus_c_ge_1(min = 0, start = 0);"));
    assert.ok(mo.includes("equation"));
    assert.ok(mo.includes("cost = 4 * x1 - 3 * x2 + 1 * x1^2 - 1 * x1 * x2 + 2 * x2^2;"));
    assert.ok(mo.includes("end MiqpOptimization;"));
  });
});
