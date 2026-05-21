// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { ArenaDAEBuilder, BinOp, ExprKind } from "../src/dae-arena.js";
import { collectArenaTerms, getArenaLiteralValue, solveForVariableArena } from "../src/symbolics/algebra/solve.js";

function getNumericValue(arena: ArenaDAEBuilder, exprId: number): number | null {
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return arena.getExprRealValue(exprId);
  if (kind === ExprKind.IntLiteral) return arena.getExprData1(exprId);
  // Check for negation of a literal
  if (kind === ExprKind.Negate) {
    const inner = getNumericValue(arena, arena.getExprLeft(exprId));
    return inner !== null ? -inner : null;
  }
  return null;
}

describe("Arena Symbolic Solver", () => {
  describe("collectArenaTerms", () => {
    it("collects terms from a simple polynomial", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      // 3*x^2 + 2*x + 1
      const expr = arena.addBinaryExpr(
        BinOp.Add,
        arena.addBinaryExpr(
          BinOp.Add,
          arena.addBinaryExpr(
            BinOp.Mul,
            arena.addRealLiteral(3.0),
            arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2.0)),
          ),
          arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.0), x),
        ),
        arena.addRealLiteral(1.0),
      );

      const terms = collectArenaTerms(arena, expr, "x");
      expect(terms.size).toBe(3);
      expect(getArenaLiteralValue(arena, terms.get(2) ?? -1)).toBe(3);
      expect(getArenaLiteralValue(arena, terms.get(1) ?? -1)).toBe(2);
      expect(getArenaLiteralValue(arena, terms.get(0) ?? -1)).toBe(1);
    });

    it("handles subtraction", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      // x - 5
      const expr = arena.addBinaryExpr(BinOp.Sub, x, arena.addRealLiteral(5.0));

      const terms = collectArenaTerms(arena, expr, "x");
      expect(terms.size).toBe(2);
      expect(getArenaLiteralValue(arena, terms.get(1) ?? -1)).toBe(1);
      expect(getArenaLiteralValue(arena, terms.get(0) ?? -1)).toBe(-5);
    });
  });

  describe("solveForVariableArena", () => {
    it("solves linear equation: 2x + 6 = 0 → x = -3", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      // 2*x + 6
      const expr = arena.addBinaryExpr(
        BinOp.Add,
        arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.0), x),
        arena.addRealLiteral(6.0),
      );

      const solutions = solveForVariableArena(arena, expr, "x");
      expect(solutions.length).toBe(1);
      expect(getNumericValue(arena, solutions[0] ?? -1)).toBe(-3);
    });

    it("solves quadratic equation: x^2 - 5x + 6 = 0 → x = 3, x = 2", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      // x^2 - 5*x + 6
      const expr = arena.addBinaryExpr(
        BinOp.Add,
        arena.addBinaryExpr(
          BinOp.Sub,
          arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2.0)),
          arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(5.0), x),
        ),
        arena.addRealLiteral(6.0),
      );

      const solutions = solveForVariableArena(arena, expr, "x");
      expect(solutions.length).toBe(2);
      const vals = solutions.map((s) => getNumericValue(arena, s)).sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(vals[0]).toBeCloseTo(2, 10);
      expect(vals[1]).toBeCloseTo(3, 10);
    });

    it("solves quadratic with double root: x^2 - 4x + 4 = 0 → x = 2", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      // x^2 - 4*x + 4
      const expr = arena.addBinaryExpr(
        BinOp.Add,
        arena.addBinaryExpr(
          BinOp.Sub,
          arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2.0)),
          arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(4.0), x),
        ),
        arena.addRealLiteral(4.0),
      );

      const solutions = solveForVariableArena(arena, expr, "x");
      expect(solutions.length).toBeGreaterThanOrEqual(1);
      for (const s of solutions) {
        expect(getNumericValue(arena, s)).toBeCloseTo(2, 10);
      }
      expect(getNumericValue(arena, solutions[0] ?? -1)).toBeCloseTo(2, 10);
    });

    it("returns empty for quadratic with complex roots: x^2 + 1 = 0", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      // x^2 + 1
      const expr = arena.addBinaryExpr(
        BinOp.Add,
        arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2.0)),
        arena.addRealLiteral(1.0),
      );

      const solutions = solveForVariableArena(arena, expr, "x");
      expect(solutions.length).toBe(0);
    });

    it("solves cubic equation: x^3 - 6x^2 + 11x - 6 = 0 → x = 1, 2, 3", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      // x^3 - 6*x^2 + 11*x - 6
      const x2 = arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2.0));
      const x3 = arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(3.0));
      const expr = arena.addBinaryExpr(
        BinOp.Sub,
        arena.addBinaryExpr(
          BinOp.Add,
          arena.addBinaryExpr(BinOp.Sub, x3, arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(6.0), x2)),
          arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(11.0), x),
        ),
        arena.addRealLiteral(6.0),
      );

      const solutions = solveForVariableArena(arena, expr, "x");
      expect(solutions.length).toBe(3);
      const vals = solutions.map((s) => getNumericValue(arena, s)).sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(vals[0]).toBeCloseTo(1, 6);
      expect(vals[1]).toBeCloseTo(2, 6);
      expect(vals[2]).toBeCloseTo(3, 6);
    });

    it("returns empty for constant expression", () => {
      const arena = new ArenaDAEBuilder();
      // 42 (no variable)
      const expr = arena.addRealLiteral(42.0);
      const solutions = solveForVariableArena(arena, expr, "x");
      expect(solutions.length).toBe(0);
    });

    it("solves simple: x = 0", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");

      const solutions = solveForVariableArena(arena, x, "x");
      expect(solutions.length).toBe(1);
      expect(getNumericValue(arena, solutions[0] ?? -1)).toBeCloseTo(0);
    });
  });
});
