import { describe, expect, it } from "vitest";
import { isExplicitlySolvableArena, isolateSymbolicallyArena } from "../src/arena-isolation.js";
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
    // B = ((2 * 0) + 5) - 0
    // A = ((2 * 1) + 0) - 0
    expect(printExpr(arena, isolatedId)).toBe("((-1 * (((2 * 0) + 5) - 0)) / (((2 * 1) + 0) - 0))");
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
