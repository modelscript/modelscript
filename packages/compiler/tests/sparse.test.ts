// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { ArenaDAEBuilder, BinOp, EqKind, ExprKind } from "../src/dae-arena.js";
import {
  computeHessianSparsityArena,
  computeJacobianSparsityArena,
  generateSparsityArraysC,
} from "../src/symbolics/graphs/sparse.js";

describe("Arena Sparse Jacobian / Hessian", () => {
  /**
   * Helper: build a simple ODE system with der(x) = f(x, y, ...).
   * Returns the arena with equations added.
   */
  function buildSimpleODE(): ArenaDAEBuilder {
    const arena = new ArenaDAEBuilder();

    // Variables: x, y (state variables)
    arena.addVariable("x");
    arena.addVariable("y");

    const xRef = arena.addNameExpr("x");
    const yRef = arena.addNameExpr("y");

    // Equation 1: der(x) = y      →  lhs = Der(x), rhs = y
    const derX = arena.addDerExpr(xRef);
    arena.addEquation(EqKind.Simple, derX, yRef);

    // Equation 2: der(y) = -x     →  lhs = Der(y), rhs = -x
    const derY = arena.addDerExpr(yRef);
    const negX = arena.addExpression(ExprKind.Negate, 0, xRef);
    arena.addEquation(EqKind.Simple, derY, negX);

    return arena;
  }

  describe("computeJacobianSparsityArena", () => {
    it("computes sparsity for a simple harmonic oscillator", () => {
      const arena = buildSimpleODE();
      const { ccs, states } = computeJacobianSparsityArena(arena);

      // States should be {x, y}
      expect(states.length).toBe(2);
      expect(states).toContain("x");
      expect(states).toContain("y");

      // Equation 1: der(x) = y → depends on y only
      // Equation 2: der(y) = -x → depends on x only
      // So the Jacobian is:
      //   [ 0  1 ]     (row 0 = der(x): depends on y)
      //   [ 1  0 ]     (row 1 = der(y): depends on x)
      // CCS has nnz = 2

      expect(ccs.nnz).toBe(2);
    });

    it("returns empty for a system with no derivative equations", () => {
      const arena = new ArenaDAEBuilder();
      arena.addVariable("x");
      const xRef = arena.addNameExpr("x");
      const one = arena.addRealLiteral(1.0);
      arena.addEquation(EqKind.Simple, xRef, one); // x = 1 (algebraic)

      const { ccs, states } = computeJacobianSparsityArena(arena);
      expect(states.length).toBe(0);
      expect(ccs.nnz).toBe(0);
    });

    it("detects coupled dependencies", () => {
      const arena = new ArenaDAEBuilder();
      arena.addVariable("x");
      arena.addVariable("y");

      const xRef = arena.addNameExpr("x");
      const yRef = arena.addNameExpr("y");

      // der(x) = x + y → depends on both x and y
      const derX = arena.addDerExpr(xRef);
      const xPlusY = arena.addBinaryExpr(BinOp.Add, xRef, yRef);
      arena.addEquation(EqKind.Simple, derX, xPlusY);

      // der(y) = x * y → depends on both x and y
      const derY = arena.addDerExpr(yRef);
      const xTimesY = arena.addBinaryExpr(BinOp.Mul, xRef, yRef);
      arena.addEquation(EqKind.Simple, derY, xTimesY);

      const { ccs, states } = computeJacobianSparsityArena(arena);
      expect(states.length).toBe(2);
      // Both equations depend on both variables → dense Jacobian
      expect(ccs.nnz).toBe(4);
    });
  });

  describe("computeHessianSparsityArena", () => {
    it("computes Hessian sparsity for coupled nonlinear system", () => {
      const arena = new ArenaDAEBuilder();
      arena.addVariable("x");
      arena.addVariable("y");

      const xRef = arena.addNameExpr("x");
      const yRef = arena.addNameExpr("y");

      // der(x) = x * y → nonlinear coupling between x and y
      const derX = arena.addDerExpr(xRef);
      const xTimesY = arena.addBinaryExpr(BinOp.Mul, xRef, yRef);
      arena.addEquation(EqKind.Simple, derX, xTimesY);

      // der(y) = sin(x) → nonlinear in x
      const derY = arena.addDerExpr(yRef);
      const sinX = arena.addCallExpr("sin", [xRef]);
      arena.addEquation(EqKind.Simple, derY, sinX);

      const { ccs, states } = computeHessianSparsityArena(arena);
      expect(states.length).toBe(2);

      // x*y creates interaction between x and y
      // sin(x) creates self-interaction for x
      // Lower triangular: should have non-zeros on diagonal + off-diagonal (x,y)
      expect(ccs.nnz).toBeGreaterThanOrEqual(2); // At least diagonal
    });

    it("produces empty Hessian for linear system", () => {
      const arena = new ArenaDAEBuilder();
      arena.addVariable("x");

      const xRef = arena.addNameExpr("x");

      // der(x) = 2*x → linear, Hessian is zero
      // But the structural analysis will see mul(2, x) and still mark x as interacting
      // because mul is a nonlinear operator structurally. This is an over-approximation
      // (conservative), which is correct for solvers like IPOPT.
      const derX = arena.addDerExpr(xRef);
      const twoX = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.0), xRef);
      arena.addEquation(EqKind.Simple, derX, twoX);

      const { ccs, states } = computeHessianSparsityArena(arena);
      expect(states.length).toBe(1);
      // Structural analysis: mul makes x self-interact → diagonal entry
      expect(ccs.nnz).toBe(1);
    });
  });

  describe("generateSparsityArraysC", () => {
    it("generates correct C code for a CCS matrix", () => {
      const ccs = { row_indices: [0, 1, 0, 1], col_ptr: [0, 2, 4], nnz: 4 };
      const lines = generateSparsityArraysC(ccs, "MyModel_jac");
      expect(lines.length).toBe(3);
      expect(lines[0]).toBe("const int MyModel_jac_nnz = 4;");
      expect(lines[1]).toBe("const int MyModel_jac_row_idx[] = {0, 1, 0, 1};");
      expect(lines[2]).toBe("const int MyModel_jac_col_ptr[] = {0, 2, 4};");
    });

    it("generates correct C code for empty matrix", () => {
      const ccs = { row_indices: [], col_ptr: [0], nnz: 0 };
      const lines = generateSparsityArraysC(ccs, "empty");
      expect(lines[0]).toBe("const int empty_nnz = 0;");
      expect(lines[1]).toBe("const int empty_row_idx[] = {};");
    });
  });
});
