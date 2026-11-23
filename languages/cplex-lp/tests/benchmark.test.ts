// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCplexLp, solveCplexLp } from "../src/index.js";

function relErr(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(1e-12, Math.abs(expected));
}

describe("@modelscript/cplex-lp Optimization Benchmark Suite", () => {
  it("solves classic LINDO production-mix LP (Astro/Cosmo) within tolerance", () => {
    const source = `
! Classic LINDO production-mix LP (Schrage)
MAX 20 ASTRO + 30 COSMO
ST
  ASTRO_CAP: ASTRO < 60
  COSMO_CAP: COSMO < 50
  LABOR:     ASTRO + 2 COSMO < 120
END
`;
    const model = parseCplexLp(source, "AstroCosmo");
    const sol = solveCplexLp(model);
    const tolerance = 1e-6;

    assert.strictEqual(sol.status, "optimal");
    assert.ok(relErr(sol.objectiveValue, 2100) <= tolerance, `Expected 2100, got ${sol.objectiveValue}`);
    assert.ok(relErr(sol.values["ASTRO"] ?? 0, 60) <= tolerance);
    assert.ok(relErr(sol.values["COSMO"] ?? 0, 30) <= tolerance);
  });

  it("solves Stigler Diet LP (1945 canonical 5-food nutrient basis) within tolerance", () => {
    // Canonical Stigler (1945) diet LP in $/day (multiply by 365 for $/year).
    // Exact LP optimum (Dantzig 1947 / Stigler 1945) for the 5 optimal foods
    // (wheat flour, beef liver, cabbage, spinach, navy beans) across 9 nutrients:
    // optimal daily cost ≈ $0.10866228/day ($39.6617/year).
    const source = `
\\ Stigler (1945) Diet Problem - Optimal Basis Foods ($/day)
Minimize
  cost: wheat + liver + cabbage + spinach + beans
Subject To
  calories:   44.7 wheat + 2.2 liver + 2.6 cabbage + 1.1 spinach + 26.9 beans >= 3.0
  protein:    1411 wheat + 333 liver + 125 cabbage + 106 spinach + 1691 beans >= 70
  calcium:    2.0 wheat + 0.2 liver + 4.0 cabbage + 11.4 beans >= 0.8
  iron:       365 wheat + 139 liver + 36 cabbage + 138 spinach + 792 beans >= 12
  vit_a:      169.2 liver + 7.2 cabbage + 918.4 spinach >= 5.0
  thiamine:   55.4 wheat + 6.4 liver + 9.0 cabbage + 5.7 spinach + 38.4 beans >= 1.8
  riboflavin: 33.3 wheat + 50.8 liver + 4.5 cabbage + 13.8 spinach + 24.6 beans >= 2.7
  niacin:     441 wheat + 316 liver + 26 cabbage + 33 spinach + 217 beans >= 18
  vit_c:      525 liver + 5369 cabbage + 2755 spinach >= 75
End
`;
    const model = parseCplexLp(source, "StiglerDiet");
    const sol = solveCplexLp(model);
    const tolerance = 1e-4;

    assert.strictEqual(sol.status, "optimal");
    const annualCost = sol.objectiveValue * 365;
    // Published Dantzig/Stigler LP optimum is $39.6617/year ($0.108662/day)
    assert.ok(
      relErr(annualCost, 39.6617) <= tolerance,
      `Expected Stigler annual cost ≈ $39.6617, got $${annualCost.toFixed(4)}`,
    );
    assert.ok((sol.values["wheat"] ?? 0) > 0.02);
    assert.ok((sol.values["beans"] ?? 0) > 0.05);
    assert.ok((sol.values["cabbage"] ?? 0) > 0.01);
  });

  it("solves capacitated facility-location binary MIP within tolerance", () => {
    const source = `
\\ Capacitated Facility Location Binary MIP (3 warehouses, 3 customers)
Minimize
  total_cost:
    50 y1 + 60 y2 + 40 y3
    + 2 x11 + 4 x12 + 5 x13
    + 5 x21 + 2 x22 + 3 x23
    + 4 x31 + 3 x32 + 1 x33
Subject To
  dem1: x11 + x21 + x31 = 40
  dem2: x12 + x22 + x32 = 50
  dem3: x13 + x23 + x33 = 30
  cap1: x11 + x12 + x13 - 100 y1 <= 0
  cap2: x21 + x22 + x23 - 100 y2 <= 0
  cap3: x31 + x32 + x33 - 100 y3 <= 0
Binaries
  y1 y2 y3
End
`;
    const model = parseCplexLp(source, "FacilityLocationMIP");
    const sol = solveCplexLp(model);
    const tolerance = 1e-6;

    assert.strictEqual(sol.status, "optimal");
    // Exact global optimum: open W1 & W3 (fixed 90) + ship d1 from W1 (80) + d2 from W3 (150) + d3 from W3 (30) = 350
    assert.ok(relErr(sol.objectiveValue, 350) <= tolerance, `Expected 350, got ${sol.objectiveValue}`);
    assert.strictEqual(sol.values["y1"], 1);
    assert.strictEqual(sol.values["y2"], 0);
    assert.strictEqual(sol.values["y3"], 1);
    assert.ok(sol.gap <= tolerance);
  });

  it("detects infeasible and unbounded LPs cleanly", () => {
    const infeasibleModel = parseCplexLp(`
Minimize
  x1 + x2
Subject To
  c1: x1 + x2 >= 10
  c2: x1 + x2 <= 5
End
`);
    assert.strictEqual(solveCplexLp(infeasibleModel).status, "infeasible");

    const unboundedModel = parseCplexLp(`
Maximize
  x1 + x2
Subject To
  c1: x1 - x2 <= 5
End
`);
    assert.strictEqual(solveCplexLp(unboundedModel).status, "unbounded");
  });
});
