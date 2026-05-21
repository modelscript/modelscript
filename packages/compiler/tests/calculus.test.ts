// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { ArenaDAEBuilder, BinOp, ExprKind } from "../src/dae-arena.js";
import { differentiateArenaExpr, simplifyArenaExpr } from "../src/symbolics/calculus/derivative.js";
import {
  integrateArenaExpr,
  limitArena,
  nthDerivativeArena,
  taylorSeriesArena,
} from "../src/symbolics/calculus/integrate.js";

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
    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId);
      return `unary_${op}(${printExpr(arena, arena.getExprLeft(exprId))})`;
    }
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
    case ExprKind.Call: {
      const fname = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
      const argCount = arena.getExprRight(exprId);
      const firstArg = arena.getExprLeft(exprId);
      const args: string[] = [];
      if (argCount > 0) {
        args.push(printExpr(arena, firstArg));
        for (let i = 1; i < argCount; i++) {
          args.push(printExpr(arena, arena.getExprLeft(exprId + i)));
        }
      }
      return `${fname}(${args.join(", ")})`;
    }
    default:
      return `unknown_${kind}`;
  }
}

describe("Arena DAE Symbolic Calculus", () => {
  it("differentiates polynomials", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    // x^3 + 2*x + 1
    const expr = arena.addBinaryExpr(
      BinOp.Add,
      arena.addBinaryExpr(
        BinOp.Add,
        arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(3.0)),
        arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.0), x),
      ),
      arena.addRealLiteral(1.0),
    );

    const diff = differentiateArenaExpr(arena, expr, "x");
    const simp = simplifyArenaExpr(arena, diff);

    // Expected derivative: 3 * x^2 + 2
    expect(printExpr(arena, simp)).toBe("((3 * (x ^ 2)) + 2)");
  });

  it("differentiates chain rule (sin/cos)", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    // sin(3 * x)
    const expr = arena.addCallExpr("sin", [arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(3.0), x)]);

    const diff = differentiateArenaExpr(arena, expr, "x");
    const simp = simplifyArenaExpr(arena, diff);

    // Expected: cos(3 * x) * 3
    expect(printExpr(arena, simp)).toBe("(cos((3 * x)) * 3)");
  });

  it("integrates polynomials and constants", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");

    // 5
    const expr1 = arena.addRealLiteral(5.0);
    const int1 = integrateArenaExpr(arena, expr1, "x");
    expect(int1).not.toBeNull();
    expect(printExpr(arena, int1 ?? -1)).toBe("(5 * x)");

    // x^2
    const expr2 = arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2.0));
    const int2 = integrateArenaExpr(arena, expr2, "x");
    expect(int2).not.toBeNull();
    expect(printExpr(arena, int2 ?? -1)).toBe("((x ^ 3) / 3)");
  });

  it("computes Taylor series expansion", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    // exp(x)
    const expr = arena.addCallExpr("exp", [x]);

    // Taylor series around 0 to order 3: 1 + x + 0.5 * x^2
    const series = taylorSeriesArena(arena, expr, "x", 0.0, 3);
    expect(printExpr(arena, series)).toBe("((1 + x) + (0.5 * (x ^ 2)))");
  });

  it("evaluates limit using L'Hopital's rule", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    // (x^2 - 1) / (x - 1)
    const expr = arena.addBinaryExpr(
      BinOp.Div,
      arena.addBinaryExpr(
        BinOp.Sub,
        arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2.0)),
        arena.addRealLiteral(1.0),
      ),
      arena.addBinaryExpr(BinOp.Sub, x, arena.addRealLiteral(1.0)),
    );

    const limitVal = limitArena(arena, expr, "x", 1.0);
    expect(limitVal).toBe(2);
  });

  it("computes nth derivatives", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    // x^3
    const expr = arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(3.0));

    // d^3(x^3)/dx^3 = 6
    const deriv = nthDerivativeArena(arena, expr, "x", 3);
    expect(printExpr(arena, deriv)).toBe("6");
  });
});
