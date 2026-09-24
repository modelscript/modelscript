// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConstrainedZonotope } from "../src/analysis/wasm_constrained_zonotope.js";
import { Interval } from "../src/analysis/wasm_interval.js";
import { Zonotope } from "../src/analysis/wasm_zonotope.js";

describe("Native Constrained Zonotope (CZ) Bifurcation Suite", () => {
  it("should construct Constrained Zonotope from standard Zonotope", () => {
    // 2D Box [-2, 2] x [-3, 3]
    const baseZ = Zonotope.fromIntervals([new Interval(-2, 2), new Interval(-3, 3)]);
    const cz = ConstrainedZonotope.fromZonotope(baseZ);

    assert.strictEqual(cz.dim, 2);
    assert.strictEqual(cz.numGenerators, 2);

    const intervals = cz.toIntervals();
    assert.strictEqual(intervals[0]!.lo, -2);
    assert.strictEqual(intervals[0]!.hi, 2);
    assert.strictEqual(intervals[1]!.lo, -3);
    assert.strictEqual(intervals[1]!.hi, 3);
  });

  it("should compute exact halfspace intersection without over-approximation", () => {
    // Box [-2, 2] x [-2, 2]
    // Intersect with halfspace x0 <= 1.0
    const baseZ = Zonotope.fromIntervals([new Interval(-2, 2), new Interval(-2, 2)]);
    const cz = ConstrainedZonotope.fromZonotope(baseZ);

    const clipped = cz.intersectHalfspace([1.0, 0.0], 1.0);
    const intervals = clipped.toIntervals();

    assert.strictEqual(intervals[0]!.lo, -2);
    assert.strictEqual(intervals[0]!.hi, 1.0, "x0 upper bound should be clipped exactly to 1.0");
    assert.strictEqual(intervals[1]!.lo, -2);
    assert.strictEqual(intervals[1]!.hi, 2);
  });

  it("should apply linear transformation with zero wrapping effect", () => {
    // Unit square [-1, 1] x [-1, 1]
    const baseZ = Zonotope.fromIntervals([new Interval(-1, 1), new Interval(-1, 1)]);
    const cz = ConstrainedZonotope.fromZonotope(baseZ);

    // Diagonal scaling matrix [[2, 0], [0, 3]]
    const M = [
      [2, 0],
      [0, 3],
    ];
    const mapped = cz.linearMap(M);
    const intervals = mapped.toIntervals();

    assert.strictEqual(intervals[0]!.lo, -2);
    assert.strictEqual(intervals[0]!.hi, 2);
    assert.strictEqual(intervals[1]!.lo, -3);
    assert.strictEqual(intervals[1]!.hi, 3);
  });

  it("should perform exact hyperplane guard crossing slicing", () => {
    // 2D state [height, velocity], height in [-1, 1]
    // Guard: height == 0
    const baseZ = Zonotope.fromIntervals([new Interval(-1, 1), new Interval(-5, 5)]);
    const cz = ConstrainedZonotope.fromZonotope(baseZ);

    const sliced = cz.intersectHyperplane([1.0, 0.0], 0.0);
    assert.strictEqual(sliced.A.length, 1);
    assert.strictEqual(sliced.b.length, 1);
  });

  it("should perform Girard order reduction to bound generator count", () => {
    // 2D zonotope with 5 generators
    const cz = new ConstrainedZonotope(
      [0, 0],
      [
        [5, 0],
        [0, 5],
        [1, 1],
        [0.5, -0.5],
        [-0.2, 0.3],
      ],
    );

    assert.strictEqual(cz.numGenerators, 5);
    // Reduce to at most 3 generators (keeping top 1 + 2 box generators)
    const reduced = cz.reduce(3);
    assert.strictEqual(reduced.numGenerators, 3);
    assert.strictEqual(reduced.dim, 2);

    // Over-approximation check: original intervals must be contained in reduced intervals
    const origIntervals = cz.toIntervals();
    const redIntervals = reduced.toIntervals();
    assert(redIntervals[0]!.lo <= origIntervals[0]!.lo + 1e-9);
    assert(redIntervals[0]!.hi >= origIntervals[0]!.hi - 1e-9);
    assert(redIntervals[1]!.lo <= origIntervals[1]!.lo + 1e-9);
    assert(redIntervals[1]!.hi >= origIntervals[1]!.hi - 1e-9);
  });
});
