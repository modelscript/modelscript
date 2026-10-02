// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  DAEBuilder,
  DaeFlowpipeBridge,
  EqKind,
  ExprKind,
  NumericalInterval,
  UnaryOp,
  Variability,
  VarType,
} from "../src/index.js";

describe("Phase 4: Automated Flowpipe & Barrier Bridge (@modelscript/runtime)", () => {
  it("should lower DAEBuilder differential and algebraic equations into a DaeSystem", () => {
    const arena = new DAEBuilder();
    // Differential state x
    const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
    const xName = arena.interner.intern("x");

    // Algebraic state z
    const zIdx = arena.addVariable("z", VarType.Real, Variability.Continuous);
    const zName = arena.interner.intern("z");

    // Differential equation: der(x) = -x + z
    const xExpr1 = arena.addExpression(0, xName);
    const derX = arena.addExpression(ExprKind.Der, xExpr1);
    const xExpr2 = arena.addExpression(0, xName);
    const negX = arena.addUnaryExpr(UnaryOp.Negate, xExpr2);
    const zExpr1 = arena.addExpression(0, zName);
    const rhsDiff = arena.addBinaryExpr(0 /* BinOp.Add */, negX, zExpr1);
    arena.addEquation(EqKind.Simple, derX, rhsDiff);

    // Algebraic constraint: z = 0.5 * x  =>  z - 0.5 * x = 0
    const zExpr2 = arena.addExpression(0, zName);
    const half = arena.addRealLiteral(0.5);
    const xExpr3 = arena.addExpression(0, xName);
    const halfX = arena.addBinaryExpr(2 /* BinOp.Mul */, half, xExpr3);
    arena.addEquation(EqKind.Simple, zExpr2, halfX);

    const lowered = DaeFlowpipeBridge.lowerDaeToSystem(arena);
    assert.strictEqual(lowered.dae.numDiffStates, 1);
    assert.strictEqual(lowered.dae.numAlgStates, 1);
    assert.strictEqual(lowered.diffVarNames[0], "x");
    assert.strictEqual(lowered.algVarNames[0], "z");

    // Test evaluation of f(t, x, z) at x=2, z=1: f = -x + z = -2 + 1 = -1
    const fVal = lowered.dae.f(0, [2.0], [1.0]);
    assert.strictEqual(fVal[0], -1.0);

    // Test evaluation of g(x, z) at x=2, z=1: g = z - 0.5*x = 1 - 1 = 0
    const gVal = lowered.dae.g([2.0], [1.0]);
    assert.strictEqual(gVal[0], 0.0);

    // Test symbolic Jacobian J_z = \partial g / \partial z = 1.0
    const Jz = lowered.dae.jacobianGz([2.0], [1.0]);
    assert.strictEqual(Jz[0]![0], 1.0);
  });

  it("should compute validated flowpipe tubes across continuous DAE integration steps", () => {
    const arena = new DAEBuilder();
    const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
    const xName = arena.interner.intern("x");

    // der(x) = -x
    const xExpr1 = arena.addExpression(0, xName);
    const derX = arena.addExpression(ExprKind.Der, xExpr1);
    const xExpr2 = arena.addExpression(0, xName);
    const negX = arena.addUnaryExpr(UnaryOp.Negate, xExpr2);
    arena.addEquation(EqKind.Simple, derX, negX);

    const result = DaeFlowpipeBridge.solveFlowpipe(arena, {
      tSpan: [0.0, 1.0],
      dt: 0.2,
      initialBounds: new Map([[xIdx, new NumericalInterval(0.9, 1.1)]]),
    });

    assert.ok(result.totalSteps > 0);
    assert.strictEqual(result.isCertifiedSafe, true);

    const firstStep = result.steps[0]!;
    assert.strictEqual(firstStep.time, 0.0);
    assert.strictEqual(firstStep.xTubes[0]!.lo, 0.9);
    assert.strictEqual(firstStep.xTubes[0]!.hi, 1.1);

    const lastStep = result.steps[result.steps.length - 1]!;
    // In decay system der(x) = -x, trajectory contracts towards 0
    assert.ok(lastStep.xTubes[0]!.lo < 0.9);
    assert.ok(lastStep.xTubes[0]!.hi < 1.1);
    assert.ok(lastStep.xTubes[0]!.lo > 0.0); // Remains positive
  });
});
