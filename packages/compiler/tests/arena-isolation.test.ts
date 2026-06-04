import { describe, expect, it } from "vitest";
import {
  isExplicitlySolvableArena,
  isolateSymbolicallyArena,
  tryOptimizeLoopWithGroebner,
} from "../src/arena-isolation.js";
import { ArenaDAEBuilder, BinOp, EqKind, ExprKind } from "../src/dae-arena.js";

// Helper to recursively stringify an expression in the arena
function printExpr(arena: ArenaDAEBuilder, id: number): string {
  if (id < 0) return "";
  const kind = arena.getExprKind(id);
  switch (kind) {
    case ExprKind.Name: {
      const nameId = arena.getExprData1(id);
      return arena.interner.resolve(nameId) ?? "";
    }
    case ExprKind.IntLiteral:
      return String(arena.getExprData1(id));
    case ExprKind.RealLiteral:
      return String(arena.getExprRealValue(id));
    case ExprKind.BoolLiteral:
      return arena.getExprData1(id) === 1 ? "true" : "false";
    case ExprKind.StringLiteral: {
      const strId = arena.getExprData1(id);
      return `"${arena.interner.resolve(strId) ?? ""}"`;
    }
    case ExprKind.Negate: {
      const operand = arena.getExprLeft(id) >= 0 ? arena.getExprLeft(id) : arena.getExprData1(id);
      return `(-${printExpr(arena, operand)})`;
    }
    case ExprKind.Binary: {
      const op = arena.getExprData1(id) as BinOp;
      const left = arena.getExprLeft(id);
      const right = arena.getExprRight(id);
      let opStr: string;
      switch (op) {
        case BinOp.Add:
          opStr = "+";
          break;
        case BinOp.Sub:
          opStr = "-";
          break;
        case BinOp.Mul:
          opStr = "*";
          break;
        case BinOp.Div:
          opStr = "/";
          break;
        case BinOp.Pow:
          opStr = "^";
          break;
        default:
          opStr = "?";
      }
      return `(${printExpr(arena, left)} ${opStr} ${printExpr(arena, right)})`;
    }
    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(id);
      const funcName = arena.interner.resolve(funcNameId) ?? "";
      const firstArg = arena.getExprLeft(id);
      const count = arena.getExprRight(id);
      const args: string[] = [];
      for (let i = 0; i < count; i++) {
        args.push(printExpr(arena, firstArg + i));
      }
      return `${funcName}(${args.join(", ")})`;
    }
    default:
      return `Expr[kind=${kind}]`;
  }
}

describe("isExplicitlySolvableArena", () => {
  it("should solve simple explicit equations", () => {
    const arena = new ArenaDAEBuilder();
    const xIdx = arena.addVariable("x");
    arena.addVariable("a");
    arena.addVariable("b");

    const xExpr = arena.addNameExpr("x");
    const aExpr = arena.addNameExpr("a");
    const bExpr = arena.addNameExpr("b");

    const sumExpr = arena.addBinaryExpr(BinOp.Add, aExpr, bExpr);

    // Equation: x = a + b
    const eq1 = arena.addEquation(EqKind.Simple, xExpr, sumExpr);
    expect(isExplicitlySolvableArena(arena, eq1, xIdx)).toBe(sumExpr);

    // Equation: a + b = x
    const eq2 = arena.addEquation(EqKind.Simple, sumExpr, xExpr);
    expect(isExplicitlySolvableArena(arena, eq2, xIdx)).toBe(sumExpr);
  });

  it("should return -1 if the target variable appears on both sides", () => {
    const arena = new ArenaDAEBuilder();
    const xIdx = arena.addVariable("x");

    const xExpr = arena.addNameExpr("x");
    const sumExpr = arena.addBinaryExpr(BinOp.Add, xExpr, arena.addRealLiteral(1));

    // Equation: x = x + 1
    const eq = arena.addEquation(EqKind.Simple, xExpr, sumExpr);
    expect(isExplicitlySolvableArena(arena, eq, xIdx)).toBe(-1);
  });
});

describe("isolateSymbolicallyArena", () => {
  it("should isolate linear equations", () => {
    const arena = new ArenaDAEBuilder();
    const xIdx = arena.addVariable("x");
    const xExpr = arena.addNameExpr("x");

    // Equation: 2 * x + 5 = 0
    const two = arena.addRealLiteral(2);
    const five = arena.addRealLiteral(5);
    const zero = arena.addRealLiteral(0);

    const term1 = arena.addBinaryExpr(BinOp.Mul, two, xExpr);
    const lhs = arena.addBinaryExpr(BinOp.Add, term1, five);

    const eq = arena.addEquation(EqKind.Simple, lhs, zero);

    const isolatedId = isolateSymbolicallyArena(arena, eq, xIdx);
    expect(isolatedId).toBeGreaterThanOrEqual(0);
    // Expected symbolic representation from linear coefficient extraction:
    // B = ((2 * 0) + 5) - 0 -> folded to 5
    // A = ((2 * 1) + 0) - 0 -> folded to 2
    expect(printExpr(arena, isolatedId)).toBe("((-1 * 5) / 2)");
  });

  it("should isolate single-occurrence math functions (inversion)", () => {
    const arena = new ArenaDAEBuilder();
    const xIdx = arena.addVariable("x");
    arena.addVariable("y");

    const xExpr = arena.addNameExpr("x");
    const yExpr = arena.addNameExpr("y");

    // Equation: sin(x) = y
    const sinExpr = arena.addCallExpr("sin", [xExpr]);
    const eqSin = arena.addEquation(EqKind.Simple, sinExpr, yExpr);
    const isolatedSin = isolateSymbolicallyArena(arena, eqSin, xIdx);
    expect(printExpr(arena, isolatedSin)).toBe("asin(y)");

    // Equation: exp(x) = y
    const expExpr = arena.addCallExpr("exp", [xExpr]);
    const eqExp = arena.addEquation(EqKind.Simple, expExpr, yExpr);
    const isolatedExp = isolateSymbolicallyArena(arena, eqExp, xIdx);
    expect(printExpr(arena, isolatedExp)).toBe("log(y)");

    // Equation: log(x) = y
    const logExpr = arena.addCallExpr("log", [xExpr]);
    const eqLog = arena.addEquation(EqKind.Simple, logExpr, yExpr);
    const isolatedLog = isolateSymbolicallyArena(arena, eqLog, xIdx);
    expect(printExpr(arena, isolatedLog)).toBe("exp(y)");
  });

  it("should isolate hyperbolic functions", () => {
    const arena = new ArenaDAEBuilder();
    const xIdx = arena.addVariable("x");
    arena.addVariable("y");

    const xExpr = arena.addNameExpr("x");
    const yExpr = arena.addNameExpr("y");

    // Equation: sinh(x) = y
    // Inverse: log(y + sqrt(y^2 + 1))
    const sinhExpr = arena.addCallExpr("sinh", [xExpr]);
    const eqSinh = arena.addEquation(EqKind.Simple, sinhExpr, yExpr);
    const isolatedSinh = isolateSymbolicallyArena(arena, eqSinh, xIdx);
    expect(printExpr(arena, isolatedSinh)).toBe("log((y + sqrt(((y * y) + 1))))");

    // Equation: tanh(x) = y
    // Inverse: 0.5 * log((1+y)/(1-y))
    const tanhExpr = arena.addCallExpr("tanh", [xExpr]);
    const eqTanh = arena.addEquation(EqKind.Simple, tanhExpr, yExpr);
    const isolatedTanh = isolateSymbolicallyArena(arena, eqTanh, xIdx);
    expect(printExpr(arena, isolatedTanh)).toBe("(0.5 * log(((1 + y) / (1 - y))))");
  });

  it("should isolate nested single-occurrence expressions", () => {
    const arena = new ArenaDAEBuilder();
    const xIdx = arena.addVariable("x");
    arena.addVariable("y");

    const xExpr = arena.addNameExpr("x");
    const yExpr = arena.addNameExpr("y");

    // Equation: exp(2 * x + 1) = y
    const two = arena.addRealLiteral(2);
    const one = arena.addRealLiteral(1);
    const innerLhs = arena.addBinaryExpr(BinOp.Add, arena.addBinaryExpr(BinOp.Mul, two, xExpr), one);
    const expExpr = arena.addCallExpr("exp", [innerLhs]);
    const eqExp = arena.addEquation(EqKind.Simple, expExpr, yExpr);

    const isolatedId = isolateSymbolicallyArena(arena, eqExp, xIdx);
    // exp(2*x + 1) = y -> 2*x + 1 = log(y) -> 2*x = log(y) - 1 -> x = (log(y) - 1) / 2
    expect(printExpr(arena, isolatedId)).toBe("((log(y) - 1) / 2)");
  });
});

describe("tryOptimizeLoopWithGroebner", () => {
  it("should decouple a linear 2D algebraic loop", () => {
    const arena = new ArenaDAEBuilder();
    const xIdx = arena.addVariable("x");
    const yIdx = arena.addVariable("y");
    arena.addVariable("u");
    arena.addVariable("v");

    const xExpr = arena.addNameExpr("x");
    const yExpr = arena.addNameExpr("y");
    const uExpr = arena.addNameExpr("u");
    const vExpr = arena.addNameExpr("v");

    // Eq 1: x + y = u
    const eq1 = arena.addEquation(EqKind.Simple, arena.addBinaryExpr(BinOp.Add, xExpr, yExpr), uExpr);
    // Eq 2: x - y = v
    const eq2 = arena.addEquation(EqKind.Simple, arena.addBinaryExpr(BinOp.Sub, xExpr, yExpr), vExpr);

    const blocks = tryOptimizeLoopWithGroebner(arena, [eq1, eq2], [xIdx, yIdx]);
    expect(blocks).not.toBeNull();
    // Since it's linear and decoupled, it should return two single blocks
    expect(blocks?.length).toBe(2);
    expect(blocks?.[0]?.type).toBe("single");
    expect(blocks?.[1]?.type).toBe("single");

    // Verify the solved expressions
    const block0 = blocks?.[0] as { type: "single"; varIdx: number; exprId: number };
    const block1 = blocks?.[1] as { type: "single"; varIdx: number; exprId: number };

    expect([block0.varIdx, block1.varIdx]).toContain(xIdx);
    expect([block0.varIdx, block1.varIdx]).toContain(yIdx);
  });

  it("should partially triangularize a coupled non-linear loop", () => {
    const arena = new ArenaDAEBuilder();
    const xIdx = arena.addVariable("x");
    const yIdx = arena.addVariable("y");
    arena.addVariable("u");
    arena.addVariable("v");

    const xExpr = arena.addNameExpr("x");
    const yExpr = arena.addNameExpr("y");
    const uExpr = arena.addNameExpr("u");
    const vExpr = arena.addNameExpr("v");

    // Eq 1: x^2 + y = u
    const xSq = arena.addBinaryExpr(BinOp.Pow, xExpr, arena.addIntLiteral(2));
    const eq1 = arena.addEquation(EqKind.Simple, arena.addBinaryExpr(BinOp.Add, xSq, yExpr), uExpr);

    // Eq 2: x + y^2 = v
    const ySq = arena.addBinaryExpr(BinOp.Pow, yExpr, arena.addIntLiteral(2));
    const eq2 = arena.addEquation(EqKind.Simple, arena.addBinaryExpr(BinOp.Add, xExpr, ySq), vExpr);

    const blocks = tryOptimizeLoopWithGroebner(arena, [eq1, eq2], [xIdx, yIdx]);
    expect(blocks).not.toBeNull();
    // We expect it to split into:
    // 1. A 1x1 system for y (since y^4 ... cannot be isolated simply)
    // 2. A single block for x (since x + y^2 = v is linear in x once y is known)
    expect(blocks?.length).toBe(2);

    // One block should be a system of size 1 (for y), and one single (for x)
    const systemBlock = blocks?.find((b) => b.type === "system");
    const singleBlock = blocks?.find((b) => b.type === "single");

    expect(systemBlock).toBeDefined();
    expect(singleBlock).toBeDefined();

    if (systemBlock?.type === "system") {
      expect(systemBlock.vars).toEqual([yIdx]);
    }
    if (singleBlock?.type === "single") {
      expect(singleBlock.varIdx).toBe(xIdx);
    }
  });
});
