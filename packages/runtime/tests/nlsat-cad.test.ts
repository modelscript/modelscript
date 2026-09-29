// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { Interval } from "../src/analysis/wasm_interval.js";
import { DpllTSolver, type SmtProblem } from "../src/formal/dpll_t_solver.js";
import {
  build1DCells,
  buildSturmSequence,
  countRootsInRange,
  isolateRealRoots,
  MultiPoly,
  NlsatSolver,
  UnivariatePoly,
} from "../src/formal/nlsat_solver.js";

describe("Native NLSAT Non-Linear CAD Real Arithmetic Suite (T_NRA)", () => {
  describe("Univariate Real Root Isolation via Sturm Sequences", () => {
    it("should isolate irrational algebraic roots of quadratic polynomial", () => {
      // p(x) = x^2 - 2 = 0 => roots: -sqrt(2), +sqrt(2)
      const p = new UnivariatePoly([-2, 0, 1]);
      const roots = isolateRealRoots(p, 1e-8);

      assert.strictEqual(roots.length, 2);
      assert.ok(Math.abs(roots[0]! - -Math.SQRT2) < 1e-6);
      assert.ok(Math.abs(roots[1]! - Math.SQRT2) < 1e-6);
    });

    it("should isolate multiple integer roots of cubic polynomial", () => {
      // p(x) = (x - 1)(x - 2)(x - 3) = x^3 - 6x^2 + 11x - 6
      const p = new UnivariatePoly([-6, 11, -6, 1]);
      const roots = isolateRealRoots(p, 1e-8);

      assert.strictEqual(roots.length, 3);
      assert.ok(Math.abs(roots[0]! - 1.0) < 1e-6);
      assert.ok(Math.abs(roots[1]! - 2.0) < 1e-6);
      assert.ok(Math.abs(roots[2]! - 3.0) < 1e-6);
    });

    it("should isolate all real roots of quartic polynomial", () => {
      // p(x) = (x^2 - 1)(x^2 - 9) = x^4 - 10x^2 + 9
      const p = new UnivariatePoly([9, 0, -10, 0, 1]);
      const roots = isolateRealRoots(p, 1e-8);

      assert.strictEqual(roots.length, 4);
      assert.ok(Math.abs(roots[0]! - -3.0) < 1e-6);
      assert.ok(Math.abs(roots[1]! - -1.0) < 1e-6);
      assert.ok(Math.abs(roots[2]! - 1.0) < 1e-6);
      assert.ok(Math.abs(roots[3]! - 3.0) < 1e-6);
    });

    it("should correctly identify polynomials with no real roots", () => {
      // p(x) = x^2 + 4 = 0
      const p = new UnivariatePoly([4, 0, 1]);
      const roots = isolateRealRoots(p);
      assert.strictEqual(roots.length, 0);

      // p(x) = x^4 + 2x^2 + 1 = (x^2 + 1)^2
      const p4 = new UnivariatePoly([1, 0, 2, 0, 1]);
      const roots4 = isolateRealRoots(p4);
      assert.strictEqual(roots4.length, 0);
    });

    it("should compute exact Cauchy root bounds and Sturm root counts in interval ranges", () => {
      // p(x) = x^3 - 4x = x(x - 2)(x + 2)
      const p = new UnivariatePoly([0, -4, 0, 1]);
      const bound = p.cauchyRootBound();
      assert.ok(bound >= 4);

      const seq = buildSturmSequence(p);
      assert.strictEqual(countRootsInRange(seq, -3, 3), 3);
      assert.strictEqual(countRootsInRange(seq, -1, 1), 1);
      assert.strictEqual(countRootsInRange(seq, 0.5, 1.5), 0);
      assert.strictEqual(countRootsInRange(seq, 1.5, 2.5), 1);
    });
  });

  describe("1D Cylindrical Cell Decomposition", () => {
    it("should partition the real line into alternating point and interval cells", () => {
      const roots = [-1, 2];
      const cells = build1DCells(roots);

      // Cells: (-inf, -1), [-1, -1], (-1, 2), [2, 2], (2, +inf)
      assert.strictEqual(cells.length, 5);

      assert.strictEqual(cells[0]!.kind, "interval");
      assert.strictEqual(cells[0]!.hi, -1);
      assert.ok(cells[0]!.sample < -1);

      assert.strictEqual(cells[1]!.kind, "point");
      assert.strictEqual(cells[1]!.lo, -1);
      assert.strictEqual(cells[1]!.hi, -1);
      assert.strictEqual(cells[1]!.sample, -1);

      assert.strictEqual(cells[2]!.kind, "interval");
      assert.strictEqual(cells[2]!.lo, -1);
      assert.strictEqual(cells[2]!.hi, 2);
      assert.ok(cells[2]!.sample > -1 && cells[2]!.sample < 2);

      assert.strictEqual(cells[3]!.kind, "point");
      assert.strictEqual(cells[3]!.sample, 2);

      assert.strictEqual(cells[4]!.kind, "interval");
      assert.strictEqual(cells[4]!.lo, 2);
      assert.ok(cells[4]!.sample > 2);
    });
  });

  describe("Multivariate NLSAT Real Arithmetic Solving", () => {
    it("should prove non-intersecting non-linear circles UNSAT via CAD cell search", () => {
      // Circle 1: x^2 + y^2 < 1
      // Circle 2: (x - 2)^2 + y^2 < 1  (i.e. x^2 - 4x + 4 + y^2 - 1 = x^2 - 4x + y^2 + 3 < 0)
      const p1 = new MultiPoly([
        { deg: new Map([["x", 2]]), coeff: 1 },
        { deg: new Map([["y", 2]]), coeff: 1 },
        { deg: new Map(), coeff: -1 },
      ]);
      const p2 = new MultiPoly([
        { deg: new Map([["x", 2]]), coeff: 1 },
        { deg: new Map([["x", 1]]), coeff: -4 },
        { deg: new Map([["y", 2]]), coeff: 1 },
        { deg: new Map(), coeff: 3 },
      ]);

      const solver = new NlsatSolver([
        { id: 1, poly: p1, op: "<", vars: ["x", "y"] },
        { id: 2, poly: p2, op: "<", vars: ["x", "y"] },
      ]);

      const res = solver.solve();
      assert.strictEqual(res.status, "UNSAT");
      assert.ok(res.summary.includes("UNSAT"));
    });

    it("should certify SAT with exact real model for overlapping circles", () => {
      // Circle 1: x^2 + y^2 < 2
      // Circle 2: (x - 1)^2 + y^2 < 2  (i.e. x^2 - 2x + 1 + y^2 - 2 = x^2 - 2x + y^2 - 1 < 0)
      const p1 = new MultiPoly([
        { deg: new Map([["x", 2]]), coeff: 1 },
        { deg: new Map([["y", 2]]), coeff: 1 },
        { deg: new Map(), coeff: -2 },
      ]);
      const p2 = new MultiPoly([
        { deg: new Map([["x", 2]]), coeff: 1 },
        { deg: new Map([["x", 1]]), coeff: -2 },
        { deg: new Map([["y", 2]]), coeff: 1 },
        { deg: new Map(), coeff: -1 },
      ]);

      const solver = new NlsatSolver([
        { id: 1, poly: p1, op: "<", vars: ["x", "y"] },
        { id: 2, poly: p2, op: "<", vars: ["x", "y"] },
      ]);

      const res = solver.solve();
      assert.strictEqual(res.status, "SAT");
      assert.ok(res.model);

      const xVal = res.model.get("x")!;
      const yVal = res.model.get("y")!;
      assert.ok(xVal * xVal + yVal * yVal < 2);
      assert.ok((xVal - 1) * (xVal - 1) + yVal * yVal < 2);
    });

    it("should prove parabola and linear halfspace contradiction UNSAT", () => {
      // y - x^2 == 0  (y = x^2 >= 0)
      // y + x <= -2   (x^2 + x + 2 <= 0, which has discriminant 1 - 8 = -7 < 0, impossible)
      const pParabola = new MultiPoly([
        { deg: new Map([["y", 1]]), coeff: 1 },
        { deg: new Map([["x", 2]]), coeff: -1 },
      ]);
      const pLine = new MultiPoly([
        { deg: new Map([["y", 1]]), coeff: 1 },
        { deg: new Map([["x", 1]]), coeff: 1 },
        { deg: new Map(), coeff: 2 },
      ]);

      const solver = new NlsatSolver([
        { id: 1, poly: pParabola, op: "==", vars: ["x", "y"] },
        { id: 2, poly: pLine, op: "<=", vars: ["x", "y"] },
      ]);

      const res = solver.solve();
      assert.strictEqual(res.status, "UNSAT");
    });

    it("should solve 3-variable coupled polynomial sphere and quadrant bounds", () => {
      // x^2 + y^2 + z^2 <= 3
      // x >= 1, y >= 1, z >= 1
      // The only real solution is x = 1, y = 1, z = 1!
      const pSphere = new MultiPoly([
        { deg: new Map([["x", 2]]), coeff: 1 },
        { deg: new Map([["y", 2]]), coeff: 1 },
        { deg: new Map([["z", 2]]), coeff: 1 },
        { deg: new Map(), coeff: -3 },
      ]);
      const px = new MultiPoly([
        { deg: new Map([["x", 1]]), coeff: 1 },
        { deg: new Map(), coeff: -1 },
      ]);
      const py = new MultiPoly([
        { deg: new Map([["y", 1]]), coeff: 1 },
        { deg: new Map(), coeff: -1 },
      ]);
      const pz = new MultiPoly([
        { deg: new Map([["z", 1]]), coeff: 1 },
        { deg: new Map(), coeff: -1 },
      ]);

      const solver = new NlsatSolver([
        { id: 1, poly: pSphere, op: "<=", vars: ["x", "y", "z"] },
        { id: 2, poly: px, op: ">=", vars: ["x"] },
        { id: 3, poly: py, op: ">=", vars: ["y"] },
        { id: 4, poly: pz, op: ">=", vars: ["z"] },
      ]);

      const res = solver.solve();
      assert.strictEqual(res.status, "SAT");
      assert.ok(res.model);

      const x = res.model.get("x")!;
      const y = res.model.get("y")!;
      const z = res.model.get("z")!;
      assert.ok(Math.abs(x - 1.0) < 1e-4);
      assert.ok(Math.abs(y - 1.0) < 1e-4);
      assert.ok(Math.abs(z - 1.0) < 1e-4);
    });
  });

  describe("Integration with DpllTSolver (DPLL(T) + NLSAT)", () => {
    it("should certify non-linear polynomial SMT problem via NLSAT CAD engine", () => {
      // Boolean literal 1: x^2 + y^2 < 1
      // Boolean literal 2: (x - 2)^2 + y^2 < 1
      // Clause: [1] (assert circle 1)
      // Clause: [2] (assert circle 2)
      // Should be UNSAT!
      const problem: SmtProblem = {
        clauses: [[1], [2]],
        theoryLiterals: new Map([
          [
            1,
            {
              expr: {
                kind: "add",
                left: { kind: "sqr", child: { kind: "var", name: "x" } },
                right: { kind: "sqr", child: { kind: "var", name: "y" } },
              },
              rel: "<=",
              rhs: 0.99,
            },
          ],
          [
            2,
            {
              expr: {
                kind: "add",
                left: {
                  kind: "sqr",
                  child: {
                    kind: "sub",
                    left: { kind: "var", name: "x" },
                    right: { kind: "const", value: 2 },
                  },
                },
                right: { kind: "sqr", child: { kind: "var", name: "y" } },
              },
              rel: "<=",
              rhs: 0.99,
            },
          ],
        ]),
        initialBox: new Map([
          ["x", new Interval(-5, 5)],
          ["y", new Interval(-5, 5)],
        ]),
        useNlsat: true,
      };

      const solver = new DpllTSolver(problem);
      const res = solver.solve();

      assert.strictEqual(res.status, "UNSAT");
      assert.ok(res.summary.includes("UNSAT"));
    });

    it("should certify satisfiable non-linear SMT problem with exact model", () => {
      // x^2 + y^2 <= 2
      // x - y >= 0
      const problem: SmtProblem = {
        clauses: [[1], [2]],
        theoryLiterals: new Map([
          [
            1,
            {
              expr: {
                kind: "add",
                left: { kind: "sqr", child: { kind: "var", name: "x" } },
                right: { kind: "sqr", child: { kind: "var", name: "y" } },
              },
              rel: "<=",
              rhs: 2,
            },
          ],
          [
            2,
            {
              expr: {
                kind: "sub",
                left: { kind: "var", name: "x" },
                right: { kind: "var", name: "y" },
              },
              rel: ">=",
              rhs: 0,
            },
          ],
        ]),
        initialBox: new Map([
          ["x", new Interval(-5, 5)],
          ["y", new Interval(-5, 5)],
        ]),
        useNlsat: true,
      };

      const solver = new DpllTSolver(problem);
      const res = solver.solve();

      assert.strictEqual(res.status, "DELTA_SAT");
      assert.ok(res.solutionBox);
      const xMid = res.solutionBox.get("x")!.mid;
      const yMid = res.solutionBox.get("y")!.mid;
      assert.ok(xMid * xMid + yMid * yMid <= 2.01);
      assert.ok(xMid - yMid >= -0.01);
    });
  });
});
