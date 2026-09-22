// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { HybridFlowpipeSolver, type HybridAutomaton } from "../src/analysis/wasm_hybrid_flowpipe.js";
import { Interval } from "../src/analysis/wasm_interval.js";
import { TaylorModel } from "../src/analysis/wasm_taylor_model.js";
import { Zonotope } from "../src/analysis/wasm_zonotope.js";

console.log("=== Testing Zonotope Reachability & Flowpipe Set Branching ===");

// 1. Test Zonotope construction and Interval Hull
const box = [new Interval(-1, 1), new Interval(2, 4)];
const z1 = Zonotope.fromIntervals(box);

assert.strictEqual(z1.dim, 2, "Dimension should be 2");
assert.deepStrictEqual(z1.center, [0, 3], "Center should be [0, 3]");
assert.strictEqual(z1.generators.length, 2, "Should have 2 generators");

const hull1 = z1.toIntervals();
assert(Math.abs(hull1[0]!.lo - -1) < 1e-12 && Math.abs(hull1[0]!.hi - 1) < 1e-12, "Dim 0 interval must match");
assert(Math.abs(hull1[1]!.lo - 2) < 1e-12 && Math.abs(hull1[1]!.hi - 4) < 1e-12, "Dim 1 interval must match");
console.log("  ✓ Zonotope construction & exact interval hull: OK");

// 2. Test Linear Map: A * Z (Zero wrapping effect)
// Rotation matrix 45 degrees
const cos45 = Math.cos(Math.PI / 4);
const sin45 = Math.sin(Math.PI / 4);
const R45 = [
  [cos45, -sin45],
  [sin45, cos45],
];

const zRot = z1.linearMap(R45);
assert.strictEqual(zRot.dim, 2);
// In standard interval arithmetic, rotating a box by 45 degrees causes sqrt(2) expansion (wrapping effect).
// In zonotope arithmetic, the representation is exact:
const supportX = zRot.support([1, 0]);
const exactMaxX = 0 * cos45 - 3 * sin45 + Math.abs(1 * cos45) + Math.abs(-1 * sin45);
assert(Math.abs(supportX.max - exactMaxX) < 1e-12, "Zonotope linear map support function must match exact geometry");
console.log("  ✓ Zonotope linear transformation without wrapping effect: OK");

// 3. Test Minkowski Addition: Z1 \oplus Z2
const z2 = new Zonotope(
  [1, -1],
  [
    [0.5, 0],
    [0, 0.5],
  ],
);
const zSum = z1.minkowskiSum(z2);
assert.deepStrictEqual(zSum.center, [1, 2], "Center of Minkowski sum must be c1 + c2");
assert.strictEqual(zSum.generators.length, 4, "Generators must be concatenated");
console.log("  ✓ Zonotope Minkowski addition: OK");

// 4. Test Giroux Order Reduction
// Create a zonotope with 10 generators in 2D (order 5)
const manyG: number[][] = [];
for (let i = 0; i < 10; i++) {
  manyG.push([Math.cos(i) * 0.1, Math.sin(i) * 0.1]);
}
const zHighOrder = new Zonotope([0, 0], manyG);
assert.strictEqual(zHighOrder.generators.length, 10);

const zReduced = zHighOrder.reduce(2); // Max order 2 -> max 2 * 2 = 4 generators
assert(zReduced.generators.length <= 4, `Reduced generators must be <= 4, got ${zReduced.generators.length}`);

// The reduced zonotope must conservatively enclose the original
const origHull = zHighOrder.toIntervals();
const redHull = zReduced.toIntervals();
assert(redHull[0]!.lo <= origHull[0]!.lo + 1e-12, "Reduced lower bound must enclose original");
assert(redHull[0]!.hi >= origHull[0]!.hi - 1e-12, "Reduced upper bound must enclose original");
assert(redHull[1]!.lo <= origHull[1]!.lo + 1e-12, "Reduced lower bound must enclose original");
assert(redHull[1]!.hi >= origHull[1]!.hi - 1e-12, "Reduced upper bound must enclose original");
console.log("  ✓ Giroux Order Reduction conservative outer-approximation: OK");

// 5. Test Halfspace Intersection / Guard Detection
// Guard: x1 <= 2.5 on z1 (where x1 is in [2, 4])
const guardCheck1 = z1.intersectsHalfspace([0, 1], 2.5);
assert.strictEqual(guardCheck1.intersects, true, "Zonotope spanning [2, 4] must intersect guard x <= 2.5");

const guardCheck2 = z1.intersectsHalfspace([0, 1], 5.0);
assert.strictEqual(guardCheck2.fullyInside, true, "Zonotope spanning [2, 4] must be fully inside x <= 5.0");

const guardCheck3 = z1.intersectsHalfspace([0, 1], 1.0);
assert.strictEqual(guardCheck3.fullyOutside, true, "Zonotope spanning [2, 4] must be fully outside x <= 1.0");
console.log("  ✓ Zonotope guard halfspace intersection: OK");

// 6. Test Set Branching in Hybrid Automaton Reachability
const automaton: HybridAutomaton = {
  modes: [
    {
      id: "ModeA",
      dynamics: (_t, y) => [
        y[0]!.scale(0.0), // Constant x = y[0]
      ],
    },
    {
      id: "ModeB",
      dynamics: (_t, y) => [
        y[0]!.scale(-1.0), // Decaying dx/dt = -x
      ],
    },
  ],
  transitions: [
    {
      id: "A_to_B",
      sourceModeId: "ModeA",
      targetModeId: "ModeB",
      guard: (y) => y[0]!.sub(TaylorModel.constant(1.0, y[0]!.numVars, y[0]!.domain, y[0]!.order)), // Crosses when x <= 1.0
    },
  ],
};

const reachResult = HybridFlowpipeSolver.solve({
  automaton,
  initialModeId: "ModeA",
  initialEnclosure: [new Interval(0.8, 1.2)], // Straddles the guard 1.0!
  nominalInitial: [1.0],
  tSpan: [0.0, 0.5],
  dt: 0.1,
  enableSetBranching: true,
  maxBranches: 4,
});

assert(reachResult.segments.length > 0, "Hybrid reachability must produce segments");
assert(reachResult.jumps.length > 0, "Must trigger discrete jump across guard");
console.log("  ✓ Hybrid Automaton Set Branching with Zonotope enclosure: OK");

console.log("Zonotope Continuous Reachability & Flowpipe Set Branching verified successfully!");
