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

test("AMPL Global Solvers — ex4_1_1.p1 finds global minimum with couenne/de/cma-es/pso vs local minimum with lbfgsb", async () => {
  // Starting at x1 := 0.5 (inside local minimum basin around 0.486188)
  const localProblem = instantiateAmpl(
    parseAmplModel(`
      var x1 := 0.5, >= -2, <= 11;
      minimize obj: x1^6 - 2.08*x1^5 + 0.4875*x1^4 + 7.1*x1^3 - 3.95*x1^2 - x1 + 0.1;
    `),
  );
  const localRes = await solveAmpl(localProblem, { solver: "lbfgsb" });
  assert.strictEqual(localRes.status, "OPTIMAL");
  assert.ok(
    Math.abs(localRes.variables["x1"]! - 0.486188) < 1e-3,
    `Expected local min x1 ≈ 0.486188, got ${localRes.variables["x1"]}`,
  );

  // Starting at x1 := 10 (exact ex4_1_1.p1 from minlplib.org): global solvers find x1 ≈ -1.1913, obj ≈ -7.487312
  const globalProblem = instantiateAmpl(
    parseAmplModel(`
      var x1 := 10, >= -2, <= 11;
      minimize obj: x1^6 - 2.08*x1^5 + 0.4875*x1^4 + 7.1*x1^3 - 3.95*x1^2 - x1 + 0.1;
    `),
  );
  for (const solver of ["couenne", "de", "cma-es", "pso"] as const) {
    const globalRes = await solveAmpl(globalProblem, { solver });
    assert.strictEqual(globalRes.status, "OPTIMAL", `${solver} failed`);
    assert.ok(
      Math.abs(globalRes.objectiveValue - -7.487312) < 1e-2,
      `${solver}: Expected global obj ≈ -7.487312, got ${globalRes.objectiveValue} (x1=${globalRes.variables["x1"]})`,
    );
  }
});

test("AMPL MINLP Solvers — bonmin and couenne solve constrained MINLP accurately", async () => {
  const modelSrc = `
    var x integer >= 0, <= 5;
    var y >= 0, <= 5;
    minimize obj: (x - 2.2)^2 + (y - 1.5)^2;
    subject to c1: x + y >= 3;
  `;
  const problem = instantiateAmpl(parseAmplModel(modelSrc));
  assert.strictEqual(problem.problemClass, "MINLP");

  for (const solver of ["bonmin", "couenne"] as const) {
    const res = await solveAmpl(problem, { solver });
    assert.strictEqual(res.status, "OPTIMAL", `${solver} failed`);
    // Integer x=2, y=1.5 gives obj = 0.04 and x+y=3.5 >= 3
    assert.strictEqual(res.variables["x"], 2, `${solver}: Expected x=2, got ${res.variables["x"]}`);
    assert.ok(Math.abs(res.variables["y"]! - 1.5) < 1e-2, `${solver}: Expected y ≈ 1.5, got ${res.variables["y"]}`);
    assert.ok(Math.abs(res.objectiveValue - 0.04) < 1e-3, `${solver}: Expected obj ≈ 0.04, got ${res.objectiveValue}`);
  }
});
