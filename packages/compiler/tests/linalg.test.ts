// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { ArenaDAEBuilder, BinOp, ExprKind } from "../src/dae-arena.js";
import { determinantArena, gaussianEliminationArena, solveLinearSystemArena } from "../src/symbolics/algebra/linalg.js";

function printExpr(arena: ArenaDAEBuilder, exprId: number): string {
  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.RealLiteral:
      return arena.getExprRealValue(exprId).toString();
    case ExprKind.IntLiteral:
      return arena.getExprData1(exprId).toString();
    case ExprKind.Name:
      return arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
    case ExprKind.Negate:
      return `-${printExpr(arena, arena.getExprLeft(exprId))}`;
    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId);
      let opStr = "";
      if (op === BinOp.Add) opStr = " + ";
      else if (op === BinOp.Sub) opStr = " - ";
      else if (op === BinOp.Mul) opStr = " * ";
      else if (op === BinOp.Div) opStr = " / ";
      else if (op === BinOp.Pow) opStr = " ^ ";
      return `(${printExpr(arena, arena.getExprLeft(exprId))}${opStr}${printExpr(arena, arena.getExprRight(exprId))})`;
    }
    default:
      return `unknown_${kind}`;
  }
}

describe("Arena DAE Symbolic Linear Algebra", () => {
  it("computes determinant of 2x2 and 3x3 matrices", () => {
    const arena = new ArenaDAEBuilder();
    const a = arena.addNameExpr("a");
    const b = arena.addNameExpr("b");
    const c = arena.addNameExpr("c");
    const d = arena.addNameExpr("d");

    // 2x2 Matrix:
    // [a, b]
    // [c, d]
    const A2 = [
      [a, b],
      [c, d],
    ];
    const det2 = determinantArena(arena, A2);
    expect(printExpr(arena, det2)).toBe("((a * d) - (b * c))");

    // 3x3 Matrix:
    // [1, 2, 3]
    // [0, 4, 5]
    // [1, 0, 6]
    // Det = 1*(24) - 2*(-5) + 3*(-4) = 24 + 10 - 12 = 22
    const A3 = [
      [arena.addRealLiteral(1.0), arena.addRealLiteral(2.0), arena.addRealLiteral(3.0)],
      [arena.addRealLiteral(0.0), arena.addRealLiteral(4.0), arena.addRealLiteral(5.0)],
      [arena.addRealLiteral(1.0), arena.addRealLiteral(0.0), arena.addRealLiteral(6.0)],
    ];
    const det3 = determinantArena(arena, A3);
    expect(printExpr(arena, det3)).toBe("22");
  });

  it("performs Gaussian elimination on symbolic systems", () => {
    const arena = new ArenaDAEBuilder();

    // System:
    // x + 2*y = 5
    // 3*x - y = 1
    // Ax = b
    // A = [[1, 2], [3, -1]]
    // b = [5, 1]
    const A = [
      [arena.addRealLiteral(1.0), arena.addRealLiteral(2.0)],
      [arena.addRealLiteral(3.0), arena.addRealLiteral(-1.0)],
    ];
    const b = [arena.addRealLiteral(5.0), arena.addRealLiteral(1.0)];

    const sol = gaussianEliminationArena(arena, A, b);
    expect(sol).not.toBeNull();
    // sol = [1, 2]
    if (sol) {
      const sol0 = sol[0];
      const sol1 = sol[1];
      if (sol0 !== undefined && sol1 !== undefined) {
        expect(printExpr(arena, sol0)).toBe("1");
        expect(printExpr(arena, sol1)).toBe("2");
      } else {
        throw new Error("sol elements are undefined");
      }
    }
  });

  it("solves linear systems of equations directly", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    const y = arena.addNameExpr("y");

    // Eq 1: x + 2*y - 5 = 0
    const eq1 = arena.addBinaryExpr(
      BinOp.Sub,
      arena.addBinaryExpr(BinOp.Add, x, arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.0), y)),
      arena.addRealLiteral(5.0),
    );

    // Eq 2: 3*x - y - 1 = 0
    const eq2 = arena.addBinaryExpr(
      BinOp.Sub,
      arena.addBinaryExpr(BinOp.Sub, arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(3.0), x), y),
      arena.addRealLiteral(1.0),
    );

    const solution = solveLinearSystemArena(arena, [eq1, eq2], ["x", "y"]);
    expect(solution).not.toBeNull();
    if (solution) {
      expect(solution.has("x")).toBe(true);
      expect(solution.has("y")).toBe(true);
      const valX = solution.get("x");
      const valY = solution.get("y");
      if (valX !== undefined && valY !== undefined) {
        expect(printExpr(arena, valX)).toBe("1");
        expect(printExpr(arena, valY)).toBe("2");
      } else {
        throw new Error("solution values are undefined");
      }
    }
  });
});
