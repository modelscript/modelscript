// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { RelationalVerifier, TvpiPlanarPolygon, TvpiState } from "../src/index.js";

describe("TVPI Abstract Domain & Relational Self-Composition (2-Safety)", () => {
  describe("TVPI Planar Polygon Operations", () => {
    it("should add planar constraints and evaluate support functions", () => {
      const poly = new TvpiPlanarPolygon();
      // x <= 5
      poly.addConstraint(1, 0, 5);
      // y <= 4
      poly.addConstraint(0, 1, 4);
      // x + y <= 7
      poly.addConstraint(1, 1, 7);
      // x >= 0 => -x <= 0
      poly.addConstraint(-1, 0, 0);
      // y >= 0 => -y <= 0
      poly.addConstraint(0, -1, 0);

      assert.strictEqual(poly.isBottomState, false);
      assert.ok(poly.constraints.length >= 3);

      // Support function along (1, 0) should be 5
      const sX = poly.support(1, 0);
      assert.ok(Math.abs(sX - 5) < 1e-4);

      // Support function along (0, 1) should be 4
      const sY = poly.support(0, 1);
      assert.ok(Math.abs(sY - 4) < 1e-4);

      // Support function along (1, 1) should be 7
      const sXY = poly.support(1, 1);
      assert.ok(Math.abs(sXY - 7) < 1e-4);
    });

    it("should compute exact meet and detect contradictory halfspaces", () => {
      const p1 = new TvpiPlanarPolygon();
      p1.addConstraint(1, 1, 2); // x + y <= 2

      const p2 = new TvpiPlanarPolygon();
      p2.addConstraint(-1, -1, -5); // -(x + y) <= -5 => x + y >= 5

      const meet = p1.meet(p2);
      assert.strictEqual(meet.isBottomState, true);
    });

    it("should compute planar convex hull join and widening", () => {
      const p1 = new TvpiPlanarPolygon();
      p1.addConstraint(1, 0, 2); // x <= 2
      p1.addConstraint(0, 1, 2); // y <= 2

      const p2 = new TvpiPlanarPolygon();
      p2.addConstraint(1, 0, 6); // x <= 6
      p2.addConstraint(0, 1, 6); // y <= 6

      const joined = p1.join(p2);
      assert.strictEqual(joined.isBottomState, false);
      assert.ok(joined.support(1, 0) >= 5.99);
      assert.ok(joined.support(0, 1) >= 5.99);

      const widened = p1.widen(p2);
      assert.strictEqual(widened.isBottomState, false);
    });
  });

  describe("TVPI Multi-Variable Network & Transitive Planar Closure", () => {
    it("should propagate transitive constraints across variable triples (u, v, w)", () => {
      const state = TvpiState.top();

      // u - v <= 3 => 1*u - 1*v <= 3
      state.addInequality("u", "v", 1, -1, 3);

      // v - w <= 4 => 1*v - 1*w <= 4
      state.addInequality("v", "w", 1, -1, 4);

      // Planar closure should derive u - w <= 7
      const { poly: pUW } = state.getPolygon("u", "w");
      assert.ok(pUW.constraints.length > 0);

      // Support along direction (1, -1) should be bounded by 7
      const sUW = pUW.support(1, -1);
      assert.ok(sUW <= 7.01);
    });

    it("should maintain non-axis-aligned digital filter linear constraints", () => {
      const state = TvpiState.top();
      // Digital filter equation: 2*x + 3*y <= 12
      state.addInequality("x", "y", 2, 3, 12);
      // y >= 0 => -y <= 0
      state.addInequality("x", "y", 0, -1, 0);
      // x >= 0 => -x <= 0
      state.addInequality("x", "y", -1, 0, 0);

      assert.strictEqual(state.isBottomState, false);
      const { poly } = state.getPolygon("x", "y");
      // Along (2, 3), max is 12
      const supp = poly.support(2, 3);
      assert.ok(Math.abs(supp - 12) < 1e-3);
    });
  });

  describe("Relational Verifier & Self-Composition (2-Safety Hyperproperties)", () => {
    const verifier = new RelationalVerifier();

    it("should verify Lipschitz continuity of digital gain controller", () => {
      // Plant / Controller transfer function: y = 2.5 * x
      // Constraint: y - 2.5 * x == 0
      const transfer = [
        {
          expr: {
            kind: "sub" as const,
            left: { kind: "var" as const, name: "y" },
            right: {
              kind: "mul" as const,
              left: { kind: "const" as const, value: 2.5 },
              right: { kind: "var" as const, name: "x" },
            },
          },
          rel: "==" as const,
          rhs: 0,
        },
      ];

      // Target Lipschitz bound: L = 2.5
      const res = verifier.verifyLipschitz("x", "y", transfer, 2.5, { min: -10, max: 10 });
      assert.strictEqual(res.status, "VERIFIED");
      assert.strictEqual(res.property, "LIPSCHITZ_CONTINUITY");
      assert.strictEqual(res.certifiedLipschitzConstant, 2.5);
      assert.ok(res.summary.includes("VERIFIED"));
    });

    it("should detect violation when target Lipschitz constant is exceeded", () => {
      // Transfer: y = 3.0 * x
      const transfer = [
        {
          expr: {
            kind: "sub" as const,
            left: { kind: "var" as const, name: "y" },
            right: {
              kind: "mul" as const,
              left: { kind: "const" as const, value: 3.0 },
              right: { kind: "var" as const, name: "x" },
            },
          },
          rel: "==" as const,
          rhs: 0,
        },
      ];

      // Target L = 2.0 (should fail because slope is 3.0)
      const res = verifier.verifyLipschitz("x", "y", transfer, 2.0, { min: 0, max: 5 });
      assert.strictEqual(res.status, "VIOLATED");
      assert.ok(res.counterexample);
      assert.ok(res.counterexample.outputDiff > res.counterexample.inputDiff * 2.0);
      assert.ok(res.summary.includes("VIOLATED"));
    });

    it("should verify sensor noise / jitter robustness", () => {
      // Transfer function with unity gain: y = x
      const transfer = [
        {
          expr: {
            kind: "sub" as const,
            left: { kind: "var" as const, name: "y" },
            right: { kind: "var" as const, name: "x" },
          },
          rel: "==" as const,
          rhs: 0,
        },
      ];

      // Sensor jitter |x1 - x2| <= 0.05 guarantees |y1 - y2| <= 0.05
      const res = verifier.verifyNoiseRobustness("x", "y", transfer, 0.05, 0.05);
      assert.strictEqual(res.status, "VERIFIED");
      assert.strictEqual(res.property, "NOISE_ROBUSTNESS");
      assert.ok(res.summary.includes("VERIFIED"));
    });

    it("should detect noise threshold breach when sensor jitter causes output divergence", () => {
      // Amplifier with gain 4: y = 4 * x
      const transfer = [
        {
          expr: {
            kind: "sub" as const,
            left: { kind: "var" as const, name: "y" },
            right: {
              kind: "mul" as const,
              left: { kind: "const" as const, value: 4.0 },
              right: { kind: "var" as const, name: "x" },
            },
          },
          rel: "==" as const,
          rhs: 0,
        },
      ];

      // Noise delta = 0.05, but output epsilon limit is only 0.10 (4 * 0.05 = 0.20 > 0.10)
      const res = verifier.verifyNoiseRobustness("x", "y", transfer, 0.05, 0.1);
      assert.strictEqual(res.status, "VIOLATED");
      assert.ok(res.counterexample);
      assert.ok(res.counterexample.outputDiff > 0.1);
      assert.ok(res.summary.includes("VIOLATED"));
    });

    it("should verify observational determinism / non-interference", () => {
      // System: y_pub = 2 * x_pub (secret 's' does not affect y_pub)
      const transfer = [
        {
          expr: {
            kind: "sub" as const,
            left: { kind: "var" as const, name: "y_pub" },
            right: {
              kind: "mul" as const,
              left: { kind: "const" as const, value: 2.0 },
              right: { kind: "var" as const, name: "x_pub" },
            },
          },
          rel: "==" as const,
          rhs: 0,
        },
      ];

      const res = verifier.verifyObservationalDeterminism(["x_pub"], ["y_pub"], transfer);
      assert.strictEqual(res.status, "VERIFIED");
      assert.strictEqual(res.property, "OBSERVATIONAL_DETERMINISM");
      assert.ok(res.summary.includes("VERIFIED"));
    });

    it("should detect leakage of confidential internal state to public output", () => {
      // System: y_pub = 2 * x_pub + s (leaks secret state 's')
      const transfer = [
        {
          expr: {
            kind: "sub" as const,
            left: { kind: "var" as const, name: "y_pub" },
            right: {
              kind: "add" as const,
              left: {
                kind: "mul" as const,
                left: { kind: "const" as const, value: 2.0 },
                right: { kind: "var" as const, name: "x_pub" },
              },
              right: { kind: "var" as const, name: "s" },
            },
          },
          rel: "==" as const,
          rhs: 0,
        },
        // Range on s
        { expr: { kind: "var" as const, name: "s_1" }, rel: "==" as const, rhs: 0 },
        { expr: { kind: "var" as const, name: "s_2" }, rel: "==" as const, rhs: 5 },
      ];

      const res = verifier.verifyObservationalDeterminism(["x_pub"], ["y_pub"], transfer);
      assert.strictEqual(res.status, "VIOLATED");
      assert.strictEqual(res.property, "OBSERVATIONAL_DETERMINISM");
      assert.ok(res.summary.includes("VIOLATED"));
    });
  });
});
