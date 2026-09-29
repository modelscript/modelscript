// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DecomposedReachabilitySolver, type DecomposedSystemProblem } from "../src/analysis/wasm_decomposed_reach.js";
import { Interval } from "../src/analysis/wasm_interval.js";
import { StarSet } from "../src/analysis/wasm_star_set.js";

describe("Native High-Dimensional Star Set & Subsystem Decomposition Suite", () => {
  it("should scale Star Sets seamlessly up to 10+ dimensions with zero wrapping error", () => {
    // 10-dimensional hypercube [-1, 1]^10
    const dim = 10;
    const initialBoxes = Array.from({ length: dim }, () => new Interval(-1, 1));
    const star = StarSet.fromIntervals(initialBoxes);

    assert.strictEqual(star.dim, 10);
    assert.strictEqual(star.numBasisVectors, 10);

    // Exact 10D diagonal scaling
    const M: number[][] = [];
    for (let i = 0; i < dim; i++) {
      const row = new Array<number>(dim).fill(0);
      row[i] = (i + 1) * 0.5; // scaling factors
      M.push(row);
    }

    const mapped = star.linearMap(M);
    const intervals = mapped.toIntervals();

    for (let i = 0; i < dim; i++) {
      const expectedRadius = (i + 1) * 0.5;
      assert(Math.abs(intervals[i]!.lo - -expectedRadius) < 1e-6);
      assert(Math.abs(intervals[i]!.hi - expectedRadius) < 1e-6);
    }
  });

  it("should clip 10D Star Sets with exact halfspace constraints", () => {
    const dim = 10;
    const initialBoxes = Array.from({ length: dim }, () => new Interval(-2, 2));
    const star = StarSet.fromIntervals(initialBoxes);

    // Intersect with halfspace x0 <= 0.5
    const h = new Array<number>(dim).fill(0);
    h[0] = 1.0;

    const clipped = star.intersectHalfspace(h, 0.5);
    const intervals = clipped.toIntervals();

    assert.strictEqual(intervals[0]!.lo, -2);
    assert.strictEqual(intervals[0]!.hi, 0.5, "x0 must be clipped exactly to 0.5");
    assert.strictEqual(intervals[1]!.hi, 2);
  });

  it("should verify 6D system via Subsystem Decomposition without 6D grid explosion", () => {
    // 6D vehicle decoupled into:
    // Subsystem 1: Position [x, y] (states 0, 1)
    // Subsystem 2: Velocity [vx, vy] (states 2, 3)
    // Subsystem 3: Attitude [theta, omega] (states 4, 5)
    const problem: DecomposedSystemProblem = {
      totalDim: 6,
      subsystems: [
        {
          name: "PositionPlanar",
          stateIndices: [0, 1],
          bounds: [
            [-1, 1],
            [-1, 1],
          ],
          gridPoints: [11, 11],
          f: (x, u, w) => [u + w, 0.5 * u],
          controlBounds: [-1, 1],
          couplingBounds: [-0.2, 0.2],
          targetLevelSet: (x) => x[0]!, // x0 <= 0 unsafe
        },
        {
          name: "VelocityPlanar",
          stateIndices: [2, 3],
          bounds: [
            [-2, 2],
            [-2, 2],
          ],
          gridPoints: [11, 11],
          f: (x, u, w) => [-x[0]! + u, -x[1]! + w],
          controlBounds: [-1, 1],
          couplingBounds: [-0.1, 0.1],
          targetLevelSet: (x) => x[0]! + 1.0,
        },
      ],
      initialEnclosure: Array.from({ length: 6 }, () => new Interval(-1, 1)),
      tEnd: 0.1,
      dt: 0.05,
    };

    const res = DecomposedReachabilitySolver.solve(problem);

    assert(res.isCertifiedSafe);
    assert.strictEqual(res.totalDim, 6);
    assert.strictEqual(res.subsystemResults.length, 2);
    assert.strictEqual(res.composedStarSet.dim, 6);
  });
});
