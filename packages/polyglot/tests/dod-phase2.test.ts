// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  ArenaDAEBuilder,
  BinOp,
  Causality,
  EqKind,
  ExprKind,
  UnaryOp,
  VarType,
  Variability,
} from "../src/dae-arena.js";

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

describe("ArenaDAEBuilder — Variables", () => {
  it("adds and reads back variable fields", () => {
    const b = new ArenaDAEBuilder(undefined, "TestModel");

    const idx = b.addVariable("resistor1.R", VarType.Real, Variability.Parameter, Causality.Local, 100.0);

    expect(idx).toBe(0);
    expect(b.varCount).toBe(1);
    expect(b.getVarName(0)).toBe("resistor1.R");
    expect(b.getVarType(0)).toBe(VarType.Real);
    expect(b.getVarVariability(0)).toBe(Variability.Parameter);
    expect(b.getVarCausality(0)).toBe(Causality.Local);
    expect(b.getVarStartValue(0)).toBeCloseTo(100.0);
  });

  it("handles multiple variable types", () => {
    const b = new ArenaDAEBuilder();

    b.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    b.addVariable("n", VarType.Integer, Variability.Discrete, Causality.Local, 42);
    b.addVariable("active", VarType.Boolean, Variability.Discrete, Causality.Output, 1.0);

    expect(b.varCount).toBe(3);
    expect(b.getVarName(1)).toBe("n");
    expect(b.getVarType(1)).toBe(VarType.Integer);
    expect(b.getVarStartValue(1)).toBeCloseTo(42);
    expect(b.getVarType(2)).toBe(VarType.Boolean);
    expect(b.getVarCausality(2)).toBe(Causality.Output);
  });

  it("preserves Float64 start values with full precision", () => {
    const b = new ArenaDAEBuilder();

    const pi = 3.141592653589793;
    b.addVariable("pi", VarType.Real, Variability.Constant, Causality.Local, pi);
    expect(b.getVarStartValue(0)).toBe(pi); // exact, not approximate

    const tiny = 1.23e-15;
    b.addVariable("tiny", VarType.Real, Variability.Constant, Causality.Local, tiny);
    expect(b.getVarStartValue(1)).toBe(tiny);

    const neg = -273.15;
    b.addVariable("neg", VarType.Real, Variability.Constant, Causality.Local, neg);
    expect(b.getVarStartValue(2)).toBe(neg);
  });

  it("supports variable flags", () => {
    const b = new ArenaDAEBuilder();

    // isProtected=1, isState=2, isAlias=4, isFlow=8
    b.addVariable("v", VarType.Real, Variability.Continuous, Causality.Local, 0, 0b1010); // isState + isFlow

    expect(b.isVarProtected(0)).toBe(false);
    expect(b.isVarState(0)).toBe(true);
    expect(b.isVarAlias(0)).toBe(false);
    expect(b.isVarFlow(0)).toBe(true);
  });

  it("supports array dimensions", () => {
    const b = new ArenaDAEBuilder();

    b.addVariable("T", VarType.Real);
    b.setVarShape(0, [10, 3]);

    expect(b.getVarShape(0)).toEqual([10, 3]);
    expect(b.getVarShape(999)).toEqual([]); // non-existent
  });

  it("supports alias variables", () => {
    const b = new ArenaDAEBuilder();

    b.addVariable("a", VarType.Real);
    b.addVariable("b", VarType.Real);
    b.setVarAlias(1, "a");

    expect(b.isVarAlias(0)).toBe(false);
    expect(b.isVarAlias(1)).toBe(true);
    expect(b.getVarAliasTarget(1)).toBe("a");
    expect(b.getVarAliasTarget(0)).toBeNull();
  });

  it("grows automatically for many variables", () => {
    const b = new ArenaDAEBuilder();

    for (let i = 0; i < 1000; i++) {
      b.addVariable(`var_${i}`, VarType.Real, Variability.Continuous, Causality.Local, i * 0.1);
    }

    expect(b.varCount).toBe(1000);
    expect(b.getVarName(999)).toBe("var_999");
    expect(b.getVarStartValue(500)).toBeCloseTo(50.0);
  });
});

// ---------------------------------------------------------------------------
// Equations
// ---------------------------------------------------------------------------

describe("ArenaDAEBuilder — Equations", () => {
  it("adds and reads back equation fields", () => {
    const b = new ArenaDAEBuilder();

    const lhs = b.addNameExpr("x");
    const rhs = b.addRealLiteral(1.0);
    const idx = b.addEquation(EqKind.Simple, lhs, rhs);

    expect(idx).toBe(0);
    expect(b.eqCount).toBe(1);
    expect(b.getEqKind(0)).toBe(EqKind.Simple);
    expect(b.getEqLhs(0)).toBe(lhs);
    expect(b.getEqRhs(0)).toBe(rhs);
  });

  it("supports multiple equation kinds", () => {
    const b = new ArenaDAEBuilder();

    b.addEquation(EqKind.Simple, 0, 1);
    b.addEquation(EqKind.Array, 2, 3);
    b.addEquation(EqKind.When, 4, 5);

    expect(b.eqCount).toBe(3);
    expect(b.getEqKind(0)).toBe(EqKind.Simple);
    expect(b.getEqKind(1)).toBe(EqKind.Array);
    expect(b.getEqKind(2)).toBe(EqKind.When);
  });
});

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

describe("ArenaDAEBuilder — Expressions", () => {
  it("creates name expressions", () => {
    const b = new ArenaDAEBuilder();

    const id = b.addNameExpr("resistor1.v");

    expect(b.exprCount).toBe(1);
    expect(b.getExprKind(id)).toBe(ExprKind.Name);
    expect(b.interner.resolve(b.getExprData1(id))).toBe("resistor1.v");
  });

  it("creates integer literals", () => {
    const b = new ArenaDAEBuilder();

    const id = b.addIntLiteral(42);

    expect(b.getExprKind(id)).toBe(ExprKind.IntLiteral);
    expect(b.getExprData1(id)).toBe(42);
  });

  it("creates real literals with full precision", () => {
    const b = new ArenaDAEBuilder();

    const id = b.addRealLiteral(3.14159);

    expect(b.getExprKind(id)).toBe(ExprKind.RealLiteral);
    expect(b.getExprRealValue(id)).toBeCloseTo(3.14159);
  });

  it("creates boolean literals", () => {
    const b = new ArenaDAEBuilder();

    const t = b.addBoolLiteral(true);
    const f = b.addBoolLiteral(false);

    expect(b.getExprData1(t)).toBe(1);
    expect(b.getExprData1(f)).toBe(0);
  });

  it("creates binary expressions", () => {
    const b = new ArenaDAEBuilder();

    const lhs = b.addNameExpr("x");
    const rhs = b.addRealLiteral(2.0);
    const mul = b.addBinaryExpr(BinOp.Mul, lhs, rhs);

    expect(b.getExprKind(mul)).toBe(ExprKind.Binary);
    expect(b.getExprData1(mul)).toBe(BinOp.Mul);
    expect(b.getExprLeft(mul)).toBe(lhs);
    expect(b.getExprRight(mul)).toBe(rhs);
  });

  it("creates unary expressions", () => {
    const b = new ArenaDAEBuilder();

    const x = b.addNameExpr("x");
    const neg = b.addUnaryExpr(UnaryOp.Negate, x);

    expect(b.getExprKind(neg)).toBe(ExprKind.Unary);
    expect(b.getExprData1(neg)).toBe(UnaryOp.Negate);
    expect(b.getExprLeft(neg)).toBe(x);
  });

  it("creates der() expressions", () => {
    const b = new ArenaDAEBuilder();

    const x = b.addNameExpr("x");
    const derX = b.addDerExpr(x);

    expect(b.getExprKind(derX)).toBe(ExprKind.Der);
    expect(b.getExprData1(derX)).toBe(x);
  });

  it("creates function call expressions", () => {
    const b = new ArenaDAEBuilder();

    const arg1 = b.addNameExpr("x");
    const arg2 = b.addRealLiteral(1.0);
    const callId = b.addCallExpr("sin", [arg1, arg2]);

    expect(b.getExprKind(callId)).toBe(ExprKind.Call);
    expect(b.interner.resolve(b.getExprData1(callId))).toBe("sin");
    expect(b.getExprLeft(callId)).toBe(arg1); // first arg
    expect(b.getExprRight(callId)).toBe(2); // arg count
  });

  it("builds a complete expression tree: der(x) = -k * x", () => {
    const b = new ArenaDAEBuilder();

    // LHS: der(x)
    const xRef = b.addNameExpr("x");
    const derX = b.addDerExpr(xRef);

    // RHS: -k * x
    const kRef = b.addNameExpr("k");
    const negK = b.addUnaryExpr(UnaryOp.Negate, kRef);
    const xRef2 = b.addNameExpr("x");
    const mulExpr = b.addBinaryExpr(BinOp.Mul, negK, xRef2);

    // Equation: der(x) = -k * x
    b.addEquation(EqKind.Simple, derX, mulExpr);

    expect(b.eqCount).toBe(1);
    expect(b.exprCount).toBe(6); // xRef, derX, kRef, negK, xRef2, mulExpr

    // Verify the tree structure
    const eq = b.getEqLhs(0);
    expect(b.getExprKind(eq)).toBe(ExprKind.Der);
    const rhs = b.getEqRhs(0);
    expect(b.getExprKind(rhs)).toBe(ExprKind.Binary);
    expect(b.getExprData1(rhs)).toBe(BinOp.Mul);
  });
});

// ---------------------------------------------------------------------------
// Memory & Lifecycle
// ---------------------------------------------------------------------------

describe("ArenaDAEBuilder — Memory", () => {
  it("estimates memory usage", () => {
    const b = new ArenaDAEBuilder();

    for (let i = 0; i < 100; i++) {
      b.addVariable(`v_${i}`, VarType.Real, Variability.Continuous, Causality.Local, i);
      const lhs = b.addNameExpr(`v_${i}`);
      const rhs = b.addRealLiteral(i);
      b.addEquation(EqKind.Simple, lhs, rhs);
    }

    const bytes = b.estimateMemoryBytes();
    expect(bytes).toBeGreaterThan(0);
    // 100 vars + 100 eqs + 200 exprs in typed arrays should be very compact
    expect(bytes).toBeLessThan(500_000);
  });

  it("clear resets counts but keeps buffers", () => {
    const b = new ArenaDAEBuilder();

    b.addVariable("x", VarType.Real);
    b.addEquation(EqKind.Simple, 0, 0);
    b.addExpression(ExprKind.Name);

    b.clear();
    expect(b.varCount).toBe(0);
    expect(b.eqCount).toBe(0);
    expect(b.exprCount).toBe(0);
  });

  it("release frees buffers", () => {
    const b = new ArenaDAEBuilder();

    for (let i = 0; i < 50; i++) b.addVariable(`v_${i}`);

    b.release();
    expect(b.varCount).toBe(0);
    // Only interner memory remains
    expect(b.estimateMemoryBytes()).toBeLessThan(100_000);
  });

  it("provides bulk views", () => {
    const b = new ArenaDAEBuilder();

    b.addVariable("x", VarType.Real);
    b.addVariable("y", VarType.Integer);

    const view = b.varView();
    // 2 variables × 8 fields = 16 Int32 entries
    expect(view.length).toBe(16);
  });

  it("handles a realistic model size (1000 equations)", () => {
    const b = new ArenaDAEBuilder(undefined, "HeatConduction1D_1000");

    // 1000 temperature variables + 999 equations
    for (let i = 0; i < 1000; i++) {
      b.addVariable(`T[${i}]`, VarType.Real, Variability.Continuous, Causality.Local, 293.15);
    }

    for (let i = 0; i < 999; i++) {
      const lhs = b.addDerExpr(b.addNameExpr(`T[${i}]`));
      const ti = b.addNameExpr(`T[${i}]`);
      const ti1 = b.addNameExpr(`T[${i + 1}]`);
      const diff = b.addBinaryExpr(BinOp.Sub, ti1, ti);
      b.addEquation(EqKind.Simple, lhs, diff);
    }

    expect(b.varCount).toBe(1000);
    expect(b.eqCount).toBe(999);

    // Memory should be very small compared to object-based DAE
    const bytes = b.estimateMemoryBytes();
    // Object-based: ~200 bytes/var + ~400 bytes/eq ≈ 600 KB
    // Arena-based: ~32 bytes/var + ~16 bytes/eq ≈ 48 KB (+ interner)
    expect(bytes).toBeLessThan(500_000); // Well under 500 KB
  });
});
