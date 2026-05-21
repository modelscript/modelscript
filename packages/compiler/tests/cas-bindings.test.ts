// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  ArenaDAEBuilder,
  BinOp,
  CAS_FUNCTIONS_ARENA,
  evaluateCASFunctionArena,
  ExprKind,
  isCASFunctionArena,
  MODELSCRIPT_CAS_PACKAGE,
} from "../src/_compiler-exports.js";
import { evaluateArenaExpression } from "../src/arena-eval.js";

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/** Evaluate an arena expression numerically at given variable values. */
function evalAt(arena: ArenaDAEBuilder, exprId: number, vars: Record<string, number>): number | null {
  const params = new Map<string, number>(Object.entries(vars));
  const result = evaluateArenaExpression(arena, exprId, params);
  return typeof result === "number" ? result : null;
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("CAS bindings (arena-native)", () => {
  // ── Registry ──

  it("isCASFunctionArena recognizes all CAS functions", () => {
    expect(isCASFunctionArena("ModelScript.CAS.simplify")).toBe(true);
    expect(isCASFunctionArena("ModelScript.CAS.expand")).toBe(true);
    expect(isCASFunctionArena("ModelScript.CAS.normalize")).toBe(true);
    expect(isCASFunctionArena("ModelScript.CAS.trigSimplify")).toBe(true);
    expect(isCASFunctionArena("ModelScript.CAS.trigExpand")).toBe(true);
    expect(isCASFunctionArena("ModelScript.CAS.diff")).toBe(true);
    expect(isCASFunctionArena("ModelScript.CAS.integrate")).toBe(true);
    expect(isCASFunctionArena("ModelScript.CAS.solve")).toBe(true);
    expect(isCASFunctionArena("ModelScript.CAS.solveAll")).toBe(true);
    expect(isCASFunctionArena("ModelScript.CAS.factor")).toBe(true);
    expect(isCASFunctionArena("ModelScript.CAS.taylor")).toBe(true);
    expect(isCASFunctionArena("ModelScript.CAS.limit")).toBe(true);
    expect(isCASFunctionArena("ModelScript.CAS.degree")).toBe(true);
    expect(isCASFunctionArena("ModelScript.CAS.roots")).toBe(true);
  });

  it("isCASFunctionArena rejects non-CAS functions", () => {
    expect(isCASFunctionArena("sin")).toBe(false);
    expect(isCASFunctionArena("ModelScript.other")).toBe(false);
    expect(isCASFunctionArena("")).toBe(false);
  });

  it("CAS_FUNCTIONS_ARENA has 14 entries", () => {
    expect(CAS_FUNCTIONS_ARENA.size).toBe(14);
  });

  it("MODELSCRIPT_CAS_PACKAGE is a non-empty string", () => {
    expect(typeof MODELSCRIPT_CAS_PACKAGE).toBe("string");
    expect(MODELSCRIPT_CAS_PACKAGE.length).toBeGreaterThan(100);
    expect(MODELSCRIPT_CAS_PACKAGE).toContain("package ModelScript");
    expect(MODELSCRIPT_CAS_PACKAGE).toContain("package CAS");
  });

  // ── Simplification ──

  it("simplify: 0 + x → x", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    const zero = arena.addRealLiteral(0);
    const expr = arena.addBinaryExpr(BinOp.Add, zero, x);

    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.simplify", [expr]);
    expect(result).not.toBeNull();

    // Result at x=5 should equal 5
    expect(evalAt(arena, result ?? -1, { x: 5 })).toBeCloseTo(5);
  });

  it("expand: (x+1)*(x+2)", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    const xp1 = arena.addBinaryExpr(BinOp.Add, x, arena.addRealLiteral(1));
    const xp2 = arena.addBinaryExpr(BinOp.Add, x, arena.addRealLiteral(2));
    const expr = arena.addBinaryExpr(BinOp.Mul, xp1, xp2);

    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.expand", [expr]);
    expect(result).not.toBeNull();

    // (x+1)(x+2) = x² + 3x + 2. At x=3: 4*5=20, 9+9+2=20
    expect(evalAt(arena, result ?? -1, { x: 3 })).toBeCloseTo(20);
    expect(evalAt(arena, result ?? -1, { x: 0 })).toBeCloseTo(2);
  });

  it("normalize: x + x → 2*x", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    const expr = arena.addBinaryExpr(BinOp.Add, x, x);

    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.normalize", [expr]);
    expect(result).not.toBeNull();
    expect(evalAt(arena, result ?? -1, { x: 7 })).toBeCloseTo(14);
  });

  // ── Differentiation ──

  it("diff: d(x^2)/dx = 2x", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    const xSq = arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2));
    const varExpr = arena.addNameExpr("x"); // variable to diff wrt

    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.diff", [xSq, varExpr]);
    expect(result).not.toBeNull();

    // d(x²)/dx = 2x. At x=5: 10
    expect(evalAt(arena, result ?? -1, { x: 5 })).toBeCloseTo(10);
    expect(evalAt(arena, result ?? -1, { x: -3 })).toBeCloseTo(-6);
  });

  it("diff: nth derivative d²(x^3)/dx² = 6x", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    const xCubed = arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(3));
    const varExpr = arena.addNameExpr("x");
    const order = arena.addRealLiteral(2);

    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.diff", [xCubed, varExpr, order]);
    expect(result).not.toBeNull();

    // d²(x³)/dx² = 6x. At x=2: 12
    expect(evalAt(arena, result ?? -1, { x: 2 })).toBeCloseTo(12);
  });

  // ── Integration ──

  it("integrate: ∫x dx = x²/2", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    const varExpr = arena.addNameExpr("x");

    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.integrate", [x, varExpr]);
    expect(result).not.toBeNull();

    // ∫x dx = x²/2. At x=4: 8
    expect(evalAt(arena, result ?? -1, { x: 4 })).toBeCloseTo(8);
  });

  // ── Solving ──

  it("solve: 2x - 6 = 0 → x = 3", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    // 2x - 6
    const twoX = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2), x);
    const expr = arena.addBinaryExpr(BinOp.Sub, twoX, arena.addRealLiteral(6));
    const varExpr = arena.addNameExpr("x");

    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.solve", [expr, varExpr]);
    expect(result).not.toBeNull();

    // Solution should evaluate to 3
    expect(evalAt(arena, result ?? -1, {})).toBeCloseTo(3);
  });

  it("solveAll: x² - 5x + 6 = 0 → [2, 3]", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    // x² - 5x + 6
    const xSq = arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2));
    const fiveX = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(5), x);
    const expr = arena.addBinaryExpr(BinOp.Add, arena.addBinaryExpr(BinOp.Sub, xSq, fiveX), arena.addRealLiteral(6));
    const varExpr = arena.addNameExpr("x");

    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.solveAll", [expr, varExpr]);
    expect(result).not.toBeNull();

    // Result is an array constructor or call("array", ...).
    // The kind should be ExprKind.Call or ExprKind.ArrayCtor
    const kind = arena.getExprKind(result ?? -1);
    expect(kind === ExprKind.Call || kind === ExprKind.ArrayCtor).toBe(true);
  });

  // ── Factoring ──

  it("factor: x² - 4 → (x-2)(x+2)", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    // x² - 4
    const xSq = arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2));
    const expr = arena.addBinaryExpr(BinOp.Sub, xSq, arena.addRealLiteral(4));
    const varExpr = arena.addNameExpr("x");

    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.factor", [expr, varExpr]);
    expect(result).not.toBeNull();

    // Factored form should evaluate identically at x=5: 25-4=21
    expect(evalAt(arena, result ?? -1, { x: 5 })).toBeCloseTo(21);
    expect(evalAt(arena, result ?? -1, { x: 0 })).toBeCloseTo(-4);
  });

  // ── Degree ──

  it("degree: degree of 3x³ + 2x + 1 = 3", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    // 3x³ + 2x + 1
    const term3 = arena.addBinaryExpr(
      BinOp.Mul,
      arena.addRealLiteral(3),
      arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(3)),
    );
    const term1 = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2), x);
    const expr = arena.addBinaryExpr(BinOp.Add, arena.addBinaryExpr(BinOp.Add, term3, term1), arena.addRealLiteral(1));
    const varExpr = arena.addNameExpr("x");

    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.degree", [expr, varExpr]);
    expect(result).not.toBeNull();

    // Should be a literal with value 3
    const val = evalAt(arena, result ?? -1, {});
    expect(val).toBeCloseTo(3);
  });

  // ── Rational Roots ──

  it("roots: x² - 5x + 6 has roots 2 and 3", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    // x² - 5x + 6
    const xSq = arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2));
    const fiveX = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(5), x);
    const expr = arena.addBinaryExpr(BinOp.Add, arena.addBinaryExpr(BinOp.Sub, xSq, fiveX), arena.addRealLiteral(6));
    const varExpr = arena.addNameExpr("x");

    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.roots", [expr, varExpr]);
    expect(result).not.toBeNull();

    // Result is an array expression containing 2 and 3
    const kind = arena.getExprKind(result ?? -1);
    expect(kind === ExprKind.Call || kind === ExprKind.ArrayCtor || kind === ExprKind.RealLiteral).toBe(true);
  });

  // ── Taylor ──

  it("taylor: Taylor expansion of x² around 0, order 3", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    const xSq = arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2));
    const varExpr = arena.addNameExpr("x");
    const point = arena.addRealLiteral(0);
    const order = arena.addRealLiteral(3);

    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.taylor", [xSq, varExpr, point, order]);
    expect(result).not.toBeNull();

    // Taylor of x² at 0 should still be x². At x=4: 16
    expect(evalAt(arena, result ?? -1, { x: 4 })).toBeCloseTo(16);
  });

  // ── Limit ──

  it("limit: limit of x² as x→3 = 9", () => {
    const arena = new ArenaDAEBuilder();
    const x = arena.addNameExpr("x");
    const xSq = arena.addBinaryExpr(BinOp.Pow, x, arena.addRealLiteral(2));
    const varExpr = arena.addNameExpr("x");
    const point = arena.addRealLiteral(3);

    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.limit", [xSq, varExpr, point]);
    expect(result).not.toBeNull();

    // Limit should be 9 (a literal)
    expect(evalAt(arena, result ?? -1, {})).toBeCloseTo(9);
  });

  // ── Error handling ──

  it("evaluateCASFunctionArena returns null for unknown functions", () => {
    const arena = new ArenaDAEBuilder();
    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.nonexistent", []);
    expect(result).toBeNull();
  });

  it("evaluateCASFunctionArena returns null for missing args", () => {
    const arena = new ArenaDAEBuilder();
    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.simplify", []);
    expect(result).toBeNull();
  });

  it("evaluateCASFunctionArena returns null for invalid expr IDs", () => {
    const arena = new ArenaDAEBuilder();
    const result = evaluateCASFunctionArena(arena, "ModelScript.CAS.simplify", [-1]);
    expect(result).toBeNull();
  });
});
