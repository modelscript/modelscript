// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { Interval } from "../src/analysis/wasm_interval.js";
import { CraigInterpolator, type LinearConstraint } from "../src/formal/craig_interpolator.js";
import { InductiveProver, type InductiveSpec } from "../src/formal/inductive_prover.js";

describe("Craig Interpolation Engine (T_LRA & T_EUF)", () => {
  describe("Linear Real Arithmetic (T_LRA) Farkas Lemma Interpolation", () => {
    it("should synthesize exact Craig interpolant over shared variables (1D/2D)", () => {
      // System:
      // A: x >= 2 (-x <= -2), x <= y (x - y <= 0)
      // B: y <= 1
      // Shared variable: y
      // Unshared variable in A: x
      const linA: LinearConstraint[] = [
        { coeffs: new Map([["x", -1]]), rhs: -2 },
        {
          coeffs: new Map([
            ["x", 1],
            ["y", -1],
          ]),
          rhs: 0,
        },
      ];
      const linB: LinearConstraint[] = [{ coeffs: new Map([["y", 1]]), rhs: 1 }];

      const res = CraigInterpolator.interpolateLRA(linA, linB);

      assert.strictEqual(res.status, "INTERPOLANT_FOUND");
      assert.deepStrictEqual(res.sharedVars, ["y"]);
      assert.ok(res.linearInterpolant);

      // Verify unshared variable 'x' is completely absent
      assert.strictEqual(res.linearInterpolant.coeffs.has("x"), false);
      assert.strictEqual(res.linearInterpolant.coeffs.has("y"), true);

      // In interpolant: c * y <= rhs. Since A implies y >= 2 and B has y <= 1,
      // the separating hyperplane must separate [2, inf) from (-inf, 1].
      const yCoeff = res.linearInterpolant.coeffs.get("y")!;
      const rhs = res.linearInterpolant.rhs;
      // Normalized: if yCoeff < 0, y >= rhs / yCoeff
      if (yCoeff < 0) {
        const lowerBound = rhs / yCoeff;
        assert.ok(lowerBound >= 1 && lowerBound <= 2.001);
      } else {
        const upperBound = rhs / yCoeff;
        assert.ok(upperBound <= 1.001);
      }
    });

    it("should eliminate unshared variables on both sides (A-local and B-local)", () => {
      // System:
      // A: x1 >= 5 (-x1 <= -5), x1 - x2 <= 2, y >= x2 (x2 - y <= 0)
      //    => y >= 3. Variables: x1, x2, y.
      // B: y <= 0, z >= 4 (-z <= -4), y + z <= 6
      //    Variables: y, z.
      // Shared variable: y
      // A-local: x1, x2
      // B-local: z
      const linA: LinearConstraint[] = [
        { coeffs: new Map([["x1", -1]]), rhs: -5 },
        {
          coeffs: new Map([
            ["x1", 1],
            ["x2", -1],
          ]),
          rhs: 2,
        },
        {
          coeffs: new Map([
            ["x2", 1],
            ["y", -1],
          ]),
          rhs: 0,
        },
      ];
      const linB: LinearConstraint[] = [
        { coeffs: new Map([["y", 1]]), rhs: 0 },
        { coeffs: new Map([["z", -1]]), rhs: -4 },
        {
          coeffs: new Map([
            ["y", 1],
            ["z", 1],
          ]),
          rhs: 6,
        },
      ];

      const res = CraigInterpolator.interpolateLRA(linA, linB);

      assert.strictEqual(res.status, "INTERPOLANT_FOUND");
      assert.deepStrictEqual(res.sharedVars, ["y"]);
      assert.ok(res.linearInterpolant);

      // Ensure neither A-local (x1, x2) nor B-local (z) appear in interpolant
      assert.strictEqual(res.linearInterpolant.coeffs.has("x1"), false);
      assert.strictEqual(res.linearInterpolant.coeffs.has("x2"), false);
      assert.strictEqual(res.linearInterpolant.coeffs.has("z"), false);
      assert.strictEqual(res.linearInterpolant.coeffs.has("y"), true);
    });

    it("should return CONSISTENT when linear systems are mutually satisfiable", () => {
      // System:
      // A: x <= y (x - y <= 0), x >= 0 (-x <= 0)
      // B: y <= 10, y >= 5 (-y <= -5)
      // Mutually consistent (e.g. x = 5, y = 5)
      const linA: LinearConstraint[] = [
        {
          coeffs: new Map([
            ["x", 1],
            ["y", -1],
          ]),
          rhs: 0,
        },
        { coeffs: new Map([["x", -1]]), rhs: 0 },
      ];
      const linB: LinearConstraint[] = [
        { coeffs: new Map([["y", 1]]), rhs: 10 },
        { coeffs: new Map([["y", -1]]), rhs: -5 },
      ];

      const res = CraigInterpolator.interpolateLRA(linA, linB);
      assert.strictEqual(res.status, "CONSISTENT");
      assert.strictEqual(res.interpolant, undefined);
    });

    it("should synthesize multi-variable separating hyperplanes over polyhedra", () => {
      // Shared variables: u, v
      // A: u + v >= 10 (-u - v <= -10), u - v <= 2, unshared_a >= 1
      // B: u + v <= 4, unshared_b >= 3
      const linA: LinearConstraint[] = [
        {
          coeffs: new Map([
            ["u", -1],
            ["v", -1],
          ]),
          rhs: -10,
        },
        {
          coeffs: new Map([
            ["u", 1],
            ["v", -1],
          ]),
          rhs: 2,
        },
        { coeffs: new Map([["unshared_a", -1]]), rhs: -1 },
      ];
      const linB: LinearConstraint[] = [
        {
          coeffs: new Map([
            ["u", 1],
            ["v", 1],
          ]),
          rhs: 4,
        },
        { coeffs: new Map([["unshared_b", -1]]), rhs: -3 },
      ];

      const res = CraigInterpolator.interpolateLRA(linA, linB);
      assert.strictEqual(res.status, "INTERPOLANT_FOUND");
      assert.ok(res.sharedVars.includes("u") && res.sharedVars.includes("v"));
      assert.strictEqual(res.linearInterpolant?.coeffs.has("unshared_a"), false);
      assert.strictEqual(res.linearInterpolant?.coeffs.has("unshared_b"), false);
    });
  });

  describe("Equality with Uninterpreted Functions (T_EUF) Craig Interpolation", () => {
    it("should synthesize shared equality interpolant from congruence proof", () => {
      // Formula A:
      // a == b, c == f(a), d == f(b)
      // In A: a == b implies f(a) == f(b), hence c == d.
      // Shared variables: c, d. Unshared: a, b, and function symbol f.
      // Formula B:
      // c != d.
      const problem = {
        equalitiesA: [{ left: "a", right: "b" }],
        funcAppsA: [
          { func: "f", args: ["a"], result: "c" },
          { func: "f", args: ["b"], result: "d" },
        ],
        equalitiesB: [],
        funcAppsB: [],
        disequalityB: { left: "c", right: "d" },
      };

      const res = CraigInterpolator.interpolateEUF(problem);

      assert.strictEqual(res.status, "INTERPOLANT_FOUND");
      assert.strictEqual(res.interpolantEqualities.length, 1);
      const eq = res.interpolantEqualities[0]!;
      assert.ok((eq.left === "c" && eq.right === "d") || (eq.left === "d" && eq.right === "c"));
      assert.ok(res.summary.includes("c == d") || res.summary.includes("d == c"));
    });

    it("should eliminate local intermediate variables in multi-step congruence chains", () => {
      // Formula A:
      // x == y, temp1 == f(x), temp2 == f(y), res1 == g(temp1), res2 == g(temp2)
      // Proves res1 == res2.
      // Shared variables with B: res1, res2.
      // Local to A: x, y, temp1, temp2.
      // Formula B:
      // res1 != res2
      const problem = {
        equalitiesA: [{ left: "x", right: "y" }],
        funcAppsA: [
          { func: "f", args: ["x"], result: "temp1" },
          { func: "f", args: ["y"], result: "temp2" },
          { func: "g", args: ["temp1"], result: "res1" },
          { func: "g", args: ["temp2"], result: "res2" },
        ],
        equalitiesB: [],
        funcAppsB: [],
        disequalityB: { left: "res1", right: "res2" },
      };

      const res = CraigInterpolator.interpolateEUF(problem);

      assert.strictEqual(res.status, "INTERPOLANT_FOUND");
      assert.strictEqual(res.interpolantEqualities.length, 1);
      const eq = res.interpolantEqualities[0]!;
      assert.ok((eq.left === "res1" && eq.right === "res2") || (eq.left === "res2" && eq.right === "res1"));
    });

    it("should return CONSISTENT when EUF formulas are mutually satisfiable", () => {
      // Formula A:
      // a == b, c == f(a)
      // Formula B:
      // c == d, e != f
      const problem = {
        equalitiesA: [{ left: "a", right: "b" }],
        funcAppsA: [{ func: "f", args: ["a"], result: "c" }],
        equalitiesB: [{ left: "c", right: "d" }],
        disequalityB: { left: "e", right: "f" },
      };

      const res = CraigInterpolator.interpolateEUF(problem);
      assert.strictEqual(res.status, "CONSISTENT");
      assert.strictEqual(res.interpolantEqualities.length, 0);
    });
  });

  describe("Integration with Inductive Prover", () => {
    it("should synthesize Farkas lemma to block unreachability CTI", () => {
      // Step system:
      // Init: x == 0, y == 0
      // Transition: x' - x == 1, y' - y == 2
      // Fake CTI state: y' >= 10 when x' <= 2
      const spec: InductiveSpec = {
        variables: ["x", "y"],
        init: [
          { expr: { kind: "var", name: "x" }, rel: "==", rhs: 0 },
          { expr: { kind: "var", name: "y" }, rel: "==", rhs: 0 },
        ],
        transition: [
          {
            expr: {
              kind: "sub",
              left: { kind: "var", name: "x_prime" },
              right: { kind: "var", name: "x" },
            },
            rel: "==",
            rhs: 1,
          },
          {
            expr: {
              kind: "sub",
              left: { kind: "var", name: "y_prime" },
              right: { kind: "var", name: "y" },
            },
            rel: "==",
            rhs: 2,
          },
          // Guard: x <= 9 (ensures y terminates at 20)
          {
            expr: { kind: "var", name: "x" },
            rel: "<=",
            rhs: 9,
          },
        ],
        invariant: [{ expr: { kind: "var", name: "y" }, rel: "<=", rhs: 20 }],
        domainBounds: new Map([
          ["x", new Interval(0, 20)],
          ["y", new Interval(0, 50)],
        ]),
      };

      const ctiPreState = new Map([
        ["x", { lo: 0, hi: 5 }],
        ["y", { lo: 19, hi: 20 }],
      ]);

      const lemmas = CraigInterpolator.synthesizeInductiveLemmas(spec, ctiPreState);
      assert.ok(Array.isArray(lemmas));

      // InductiveProver should prove the specification
      const proof = InductiveProver.proveInvariant(spec);
      assert.strictEqual(proof.status, "STRENGTHENED");
      assert.strictEqual(proof.isInductive, true);
    });
  });
});
