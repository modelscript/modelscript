// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { ArenaDAEBuilder, BinOp, ExprKind } from "../src/dae-arena.js";
import {
  EGraph,
  egraphSimplify,
  emitFusedKernelC,
  identifyFusableChains,
  tensorEgraphSimplify,
  trigExpand,
  trigSimplify,
} from "../src/symbolics/simplify/egraph.js";

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

describe("Arena DAE E-Graph Simplification", () => {
  it("simplifies scalar arithmetic identities", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    const zero = arena.addRealLiteral(0.0);
    const one = arena.addRealLiteral(1.0);

    // x + 0 -> x
    const addZero = arena.addBinaryExpr(BinOp.Add, x, zero);
    expect(printExpr(arena, egraphSimplify(arena, addZero))).toBe("x");

    // x * 1 -> x
    const mulOne = arena.addBinaryExpr(BinOp.Mul, x, one);
    expect(printExpr(arena, egraphSimplify(arena, mulOne))).toBe("x");

    // x * 0 -> 0
    const mulZero = arena.addBinaryExpr(BinOp.Mul, x, zero);
    expect(printExpr(arena, egraphSimplify(arena, mulZero))).toBe("0");

    // constant folding: 2 + 3 -> 5
    const two = arena.addRealLiteral(2.0);
    const three = arena.addRealLiteral(3.0);
    const sum = arena.addBinaryExpr(BinOp.Add, two, three);
    expect(printExpr(arena, egraphSimplify(arena, sum))).toBe("5");
  });

  it("performs common factor factorization", () => {
    const arena = new ArenaDAEBuilder();
    const a = arena.addNameExpr("a");
    const b = arena.addNameExpr("b");
    const c = arena.addNameExpr("c");

    // a*b + a*c -> a*(b+c)
    const ab = arena.addBinaryExpr(BinOp.Mul, a, b);
    const ac = arena.addBinaryExpr(BinOp.Mul, a, c);
    const expr = arena.addBinaryExpr(BinOp.Add, ab, ac);

    const simp = egraphSimplify(arena, expr);
    // Since AstSizeCost is used, it should prefer the factored form: (a * (b + c)) which has fewer operations than (a * b) + (a * c)
    expect(printExpr(arena, simp)).toBe("(a * (b + c))");
  });

  it("simplifies trigonometric identities", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    const sin = arena.addCallExpr("sin", [x]);
    const cos = arena.addCallExpr("cos", [x]);
    const two = arena.addRealLiteral(2.0);

    // sin(x)^2 + cos(x)^2 -> 1
    const sin2 = arena.addBinaryExpr(BinOp.Pow, sin, two);
    const cos2 = arena.addBinaryExpr(BinOp.Pow, cos, two);
    const sum = arena.addBinaryExpr(BinOp.Add, sin2, cos2);

    expect(printExpr(arena, trigSimplify(arena, sum))).toBe("1");
  });

  it("expands trigonometric sums", () => {
    const arena = new ArenaDAEBuilder();
    const a = arena.addNameExpr("a");
    const b = arena.addNameExpr("b");
    const sum = arena.addBinaryExpr(BinOp.Add, a, b);
    const sinSum = arena.addCallExpr("sin", [sum]);

    const expanded = trigExpand(arena, sinSum);
    expect(printExpr(arena, expanded)).toBe("((sin(a) * cos(b)) + (cos(a) * sin(b)))");
  });

  it("simplifies tensor expressions", () => {
    const arena = new ArenaDAEBuilder();
    const A = arena.addNameExpr("A");
    const B = arena.addNameExpr("B");

    // (A^T)^T -> A
    const transA = arena.addCallExpr("ttranspose", [A]);
    const transTransA = arena.addCallExpr("ttranspose", [transA]);
    expect(printExpr(arena, tensorEgraphSimplify(arena, transTransA))).toBe("A");

    // (A * B)^T -> B^T * A^T
    const matmul = arena.addCallExpr("tmatmul", [A, B]);
    const transMatmul = arena.addCallExpr("ttranspose", [matmul]);
    const simplified = tensorEgraphSimplify(arena, transMatmul);
    expect(printExpr(arena, simplified)).toBe("tmatmul(ttranspose(B), ttranspose(A))");
  });

  it("fuses elementwise tensor chains and emits C code", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    const y = arena.addNameExpr("y");

    const sinX = arena.addCallExpr("tsin", [x]);
    const cosY = arena.addCallExpr("tcos", [y]);
    const sum = arena.addCallExpr("tadd", [sinX, cosY]);

    const egraph = new EGraph();
    egraph.add(arena, sum);

    const kernels = identifyFusableChains(egraph);
    expect(kernels.length).toBeGreaterThan(0);

    const firstKernel = kernels[0];
    expect(firstKernel).toBeDefined();
    if (firstKernel) {
      expect(firstKernel.ops).toContain("tadd");
      expect(firstKernel.ops).toContain("tsin");
      expect(firstKernel.ops).toContain("tcos");

      const cCode = emitFusedKernelC(firstKernel, 100);
      expect(cCode.join("\n")).toContain("fused_kernel_0");
      expect(cCode.join("\n")).toContain("double r0");
      expect(cCode.join("\n")).toContain("sin(");
      expect(cCode.join("\n")).toContain("cos(");
    }
  });
});
