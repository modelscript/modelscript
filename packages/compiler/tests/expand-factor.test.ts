// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { ArenaDAEBuilder, BinOp, ExprKind } from "../src/dae-arena.js";
import { getArenaLiteralValue } from "../src/symbolics/algebra/solve.js";
import {
  arenaTermsToExpr,
  expandArenaExpr,
  isArenaLiteral,
  normalizeArenaExpr,
} from "../src/symbolics/simplify/expand.js";
import {
  factorOutCommonArena,
  factorQuadraticArena,
  gcd,
  getDivisors,
  isNiceNumber,
  rationalRootsArena,
} from "../src/symbolics/simplify/factor.js";

function evalArenaExpr(arena: ArenaDAEBuilder, exprId: number, vars: Map<string, number>): number {
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return arena.getExprRealValue(exprId);
  if (kind === ExprKind.IntLiteral) return arena.getExprData1(exprId);
  if (kind === ExprKind.Name) {
    const name = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
    return vars.get(name) ?? 0;
  }
  if (kind === ExprKind.Negate) return -evalArenaExpr(arena, arena.getExprLeft(exprId), vars);
  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId);
    const l = evalArenaExpr(arena, arena.getExprLeft(exprId), vars);
    const r = evalArenaExpr(arena, arena.getExprRight(exprId), vars);
    if (op === BinOp.Add) return l + r;
    if (op === BinOp.Sub) return l - r;
    if (op === BinOp.Mul) return l * r;
    if (op === BinOp.Div) return l / r;
    if (op === BinOp.Pow) return Math.pow(l, r);
  }
  if (kind === ExprKind.Call) {
    const fname = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
    const arg = evalArenaExpr(arena, arena.getExprLeft(exprId), vars);
    if (fname === "sin") return Math.sin(arg);
    if (fname === "cos") return Math.cos(arg);
    if (fname === "sqrt") return Math.sqrt(arg);
  }
  return 0;
}

describe("Arena Polynomial Expand / Factor", () => {
  describe("expandArenaExpr", () => {
    it("distributes (a+b)*c → a*c + b*c", () => {
      const arena = new ArenaDAEBuilder();
      const a = arena.addNameExpr("a");
      const b = arena.addNameExpr("b");
      const c = arena.addNameExpr("c");
      // (a + b) * c
      const sum = arena.addBinaryExpr(BinOp.Add, a, b);
      const expr = arena.addBinaryExpr(BinOp.Mul, sum, c);

      const expanded = expandArenaExpr(arena, expr);
      const vars = new Map([
        ["a", 3],
        ["b", 5],
        ["c", 7],
      ]);
      // (3+5)*7 = 56
      expect(evalArenaExpr(arena, expanded, vars)).toBeCloseTo(56);
      expect(evalArenaExpr(arena, expr, vars)).toBeCloseTo(56);
    });

    it("expands x^2 → x*x", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      const expr = arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2.0));

      const expanded = expandArenaExpr(arena, expr);
      const vars = new Map([["x", 4]]);
      expect(evalArenaExpr(arena, expanded, vars)).toBeCloseTo(16);
    });

    it("expands (x+1)^2 → x^2 + 2x + 1", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      const sum = arena.addBinaryExpr(BinOp.Add, x, arena.addRealLiteral(1.0));
      const expr = arena.addBinaryExpr(BinOp.Pow, sum, arena.addRealLiteral(2.0));

      const expanded = expandArenaExpr(arena, expr);
      // Verify semantically at x=3: (3+1)^2 = 16
      const vars = new Map([["x", 3]]);
      expect(evalArenaExpr(arena, expanded, vars)).toBeCloseTo(16);
      // Verify at x=0: (0+1)^2 = 1
      expect(evalArenaExpr(arena, expanded, new Map([["x", 0]]))).toBeCloseTo(1);
      // Verify at x=-1: (-1+1)^2 = 0
      expect(evalArenaExpr(arena, expanded, new Map([["x", -1]]))).toBeCloseTo(0);
    });

    it("distributes negation: -(a+b) → -a + -b", () => {
      const arena = new ArenaDAEBuilder();
      const a = arena.addNameExpr("a");
      const b = arena.addNameExpr("b");
      const sum = arena.addBinaryExpr(BinOp.Add, a, b);
      const expr = arena.addExpression(ExprKind.Negate, 0, sum);

      const expanded = expandArenaExpr(arena, expr);
      const vars = new Map([
        ["a", 3],
        ["b", 5],
      ]);
      expect(evalArenaExpr(arena, expanded, vars)).toBeCloseTo(-8);
    });
  });

  describe("normalizeArenaExpr", () => {
    it("expands then simplifies", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      // x + 0 → x
      const expr = arena.addBinaryExpr(BinOp.Add, x, arena.addRealLiteral(0));
      const norm = normalizeArenaExpr(arena, expr);
      const vars = new Map([["x", 42]]);
      expect(evalArenaExpr(arena, norm, vars)).toBeCloseTo(42);
    });
  });

  describe("arenaTermsToExpr", () => {
    it("reconstructs polynomial from terms", () => {
      const arena = new ArenaDAEBuilder();
      // 3x^2 + 2x + 1
      const terms = new Map<number, number>();
      terms.set(2, arena.addRealLiteral(3.0));
      terms.set(1, arena.addRealLiteral(2.0));
      terms.set(0, arena.addRealLiteral(1.0));

      const expr = arenaTermsToExpr(arena, terms, "x");
      const vars = new Map([["x", 2]]);
      // 3*4 + 2*2 + 1 = 17
      expect(evalArenaExpr(arena, expr, vars)).toBeCloseTo(17);
    });
  });

  describe("isArenaLiteral", () => {
    it("identifies numeric literals", () => {
      const arena = new ArenaDAEBuilder();
      expect(isArenaLiteral(arena, arena.addRealLiteral(3.14))).toBe(true);
      expect(isArenaLiteral(arena, arena.addIntLiteral(42))).toBe(true);
      expect(isArenaLiteral(arena, arena.addNameExpr("x"))).toBe(false);
    });
  });

  describe("factorOutCommonArena", () => {
    it("extracts GCD factor from 6x^2 + 4x + 2", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      // 6x^2 + 4x + 2
      const expr = arena.addBinaryExpr(
        BinOp.Add,
        arena.addBinaryExpr(
          BinOp.Add,
          arena.addBinaryExpr(
            BinOp.Mul,
            arena.addRealLiteral(6.0),
            arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2.0)),
          ),
          arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(4.0), x),
        ),
        arena.addRealLiteral(2.0),
      );

      const result = factorOutCommonArena(arena, expr, "x");
      expect(result).not.toBeNull();
      if (result) {
        expect(getArenaLiteralValue(arena, result.factor)).toBe(2);
        // Verify: factor * remainder should equal original at x=3
        const vars = new Map([["x", 3]]);
        const originalVal = evalArenaExpr(arena, expr, vars);
        const factorVal = evalArenaExpr(arena, result.factor, vars);
        const remainderVal = evalArenaExpr(arena, result.remainder, vars);
        expect(factorVal * remainderVal).toBeCloseTo(originalVal);
      }
    });

    it("returns null when no common factor", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      // 3x + 5 (GCD = 1)
      const expr = arena.addBinaryExpr(
        BinOp.Add,
        arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(3.0), x),
        arena.addRealLiteral(5.0),
      );

      expect(factorOutCommonArena(arena, expr, "x")).toBeNull();
    });
  });

  describe("factorQuadraticArena", () => {
    it("factors x^2 - 5x + 6 into (x-2)(x-3)", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      // x^2 - 5x + 6
      const expr = arena.addBinaryExpr(
        BinOp.Add,
        arena.addBinaryExpr(
          BinOp.Sub,
          arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2.0)),
          arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(5.0), x),
        ),
        arena.addRealLiteral(6.0),
      );

      const factored = factorQuadraticArena(arena, expr, "x");
      expect(factored).not.toBeNull();
      if (factored !== null) {
        // Verify: factored form should equal original at several x values
        for (const xVal of [0, 1, 2, 3, -1, 5]) {
          const vars = new Map([["x", xVal]]);
          expect(evalArenaExpr(arena, factored, vars)).toBeCloseTo(evalArenaExpr(arena, expr, vars), 8);
        }
      }
    });

    it("returns null for complex roots: x^2 + 1", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      const expr = arena.addBinaryExpr(
        BinOp.Add,
        arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2.0)),
        arena.addRealLiteral(1.0),
      );

      expect(factorQuadraticArena(arena, expr, "x")).toBeNull();
    });
  });

  describe("rationalRootsArena", () => {
    it("finds roots of x^2 - 5x + 6", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      // x^2 - 5x + 6 = (x-2)(x-3)
      const expr = arena.addBinaryExpr(
        BinOp.Add,
        arena.addBinaryExpr(
          BinOp.Sub,
          arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2.0)),
          arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(5.0), x),
        ),
        arena.addRealLiteral(6.0),
      );

      const roots = rationalRootsArena(arena, expr, "x");
      expect(roots).toContain(2);
      expect(roots).toContain(3);
    });

    it("returns empty for irrational roots", () => {
      const arena = new ArenaDAEBuilder();
      const x = arena.addNameExpr("x");
      // x^2 - 2 (roots are ±√2, irrational)
      const expr = arena.addBinaryExpr(
        BinOp.Sub,
        arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2.0)),
        arena.addRealLiteral(2.0),
      );

      const roots = rationalRootsArena(arena, expr, "x");
      expect(roots.length).toBe(0);
    });
  });

  describe("utility functions", () => {
    it("gcd computes correctly", () => {
      expect(gcd(12, 8)).toBeCloseTo(4);
      expect(gcd(7, 3)).toBeCloseTo(1);
      expect(gcd(100, 25)).toBeCloseTo(25);
    });

    it("getDivisors returns correct divisors", () => {
      expect(getDivisors(12)).toEqual([1, 2, 3, 4, 6, 12]);
      expect(getDivisors(1)).toEqual([1]);
      expect(getDivisors(7)).toEqual([1, 7]);
    });

    it("isNiceNumber identifies rational numbers", () => {
      expect(isNiceNumber(3)).toBe(true);
      expect(isNiceNumber(0.5)).toBe(true);
      expect(isNiceNumber(1 / 3)).toBe(true);
      expect(isNiceNumber(Math.PI)).toBe(false);
      expect(isNiceNumber(Infinity)).toBe(false);
    });
  });
});
