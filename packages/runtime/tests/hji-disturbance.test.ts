// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HjiLevelSetSolver, type HjiProblem } from "../src/analysis/wasm_hji_solver.js";

describe("Native Hamilton-Jacobi-Isaacs (HJI) Adversarial Disturbance Suite", () => {
  it("should compute spatial derivative stencils accurately", () => {
    // Linear function V(x) = 2*x on [0, 10]
    const n = 11;
    const V = new Float64Array(n);
    for (let i = 0; i < n; i++) V[i] = 2.0 * i;

    const res = HjiLevelSetSolver.weno5Derivatives(V, 5, 1, 1.0, n);
    assert.strictEqual(res.derivMinus, 2.0);
    assert.strictEqual(res.derivPlus, 2.0);
  });

  it("should compute Backward Reachable Tube (BRT) under adversarial disturbance", () => {
    // 1D vehicle with input u in [-1, 1] and disturbance w in [-0.5, 0.5]
    // dx/dt = u + w
    // Unsafe set: x <= 0 (so l(x) = x)
    const problem: HjiProblem = {
      bounds: [[-2.0, 2.0]],
      gridPoints: [21],
      f: (_x, u, w) => [u + w],
      controlBounds: [-1.0, 1.0],
      disturbanceBounds: [-0.5, 0.5],
      targetLevelSet: (x) => x[0]!,
    };

    const result = HjiLevelSetSolver.solve(problem, 0.2, 0.05);

    assert(result.isSafe);
    assert(result.finalLevelSet.length === 21);
    // Left boundary (x = -2) is in the unsafe set (level <= 0)
    assert(result.finalLevelSet[0]! <= 0);
    // Right boundary (x = 2) is far outside the unsafe set (level > 0)
    assert(result.finalLevelSet[20]! > 0);
  });
});
