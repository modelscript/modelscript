// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  BinOp,
  Causality,
  DAEBuilder,
  DaeObjectiveSense,
  EqKind,
  JumpAffectMode,
  JumpRateKind,
  Variability,
  VarType,
} from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { solveArena } from "../src/core/arena-solve-dispatch.js";

describe("Unified solveArena(dae) Auto-Dispatch", () => {
  it("auto-dispatches PROBLEM_OPTIMIZATION to WASM AD gradient/penalty solver", () => {
    // Minimize (x - 3)^2 + (y + 2)^2
    const dae = new DAEBuilder(undefined, "QuadOpt");
    const x = dae.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const y = dae.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const dx = dae.addBinaryExpr(BinOp.Sub, dae.addName(x), dae.addRealLiteral(3.0));
    const dy = dae.addBinaryExpr(BinOp.Add, dae.addName(y), dae.addRealLiteral(2.0));
    const obj = dae.addBinaryExpr(
      BinOp.Add,
      dae.addBinaryExpr(BinOp.Mul, dx, dx),
      dae.addBinaryExpr(BinOp.Mul, dy, dy),
    );
    dae.optimization.addObjective(obj, -1, DaeObjectiveSense.Minimize);

    const res = solveArena(dae, { maxIterations: 300 });
    assert.equal(res.kind, "optimization");
    assert.ok(Math.abs(res.optimalValues![0]! - 3.0) < 1e-2);
    assert.ok(Math.abs(res.optimalValues![1]! - -2.0) < 1e-2);
    assert.ok(res.objectiveValue! < 1e-3);
  });

  it("auto-dispatches PROBLEM_SDE to zero-GC WASM Milstein solver + STL robustness", () => {
    const dae = new DAEBuilder(undefined, "SdeAuto");
    const S = dae.addVariable("S", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
    const drift = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.05), dae.addName(S));
    const diff = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.1), dae.addName(S));
    dae.addEquation(EqKind.Simple, dae.addDer(S), drift);
    dae.stochastic.addDiffusion(S, diff, 0);

    // Attach STL safety spec: Always_[0, 1] (S > 0)
    const atomic = dae.uncertainty.addStlAtomic(dae.addName(S));
    dae.uncertainty.addStlAlways(atomic, 0.0, 1.0);

    const res = solveArena(dae, { tSpan: [0, 1], steps: 100, seed: 7 });
    assert.equal(res.kind, "sde");
    assert.equal(res.times!.length, 101);
    assert.ok(res.stlRobustness !== undefined && res.stlRobustness[0]! > 0);
  });

  it("auto-dispatches PROBLEM_JUMP to zero-GC WASM Gillespie Direct SSA", () => {
    const dae = new DAEBuilder(undefined, "JumpAuto");
    const X = dae.addVariable("X", VarType.Real, Variability.Discrete, Causality.Local, 5.0);
    dae.jumps.addJump(
      dae.addRealLiteral(3.0),
      [{ targetVarId: X, deltaExprId: dae.addRealLiteral(1.0), mode: JumpAffectMode.Additive }],
      JumpRateKind.ConstantRate,
    );

    const res = solveArena(dae, { tSpan: [0, 2], maxEvents: 100, seed: 123 });
    assert.equal(res.kind, "jump");
    assert.ok(res.times!.length > 1);
    assert.ok(res.states![res.states!.length - 1]![0]! > 5.0);
  });

  it("auto-dispatches PROBLEM_BVP to BVP solver using WASM boundary residuals", () => {
    // Simple 2-state linear BVP: y0' = y1, y1' = 0; y0(0) = 0, y0(1) = 2 => y0(t) = 2t, y1(t) = 2
    const dae = new DAEBuilder(undefined, "LinearBVP");
    const y0 = dae.addVariable("y0", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const y1 = dae.addVariable("y1", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
    dae.addEquation(EqKind.Simple, dae.addDer(y0), dae.addName(y1));
    dae.addEquation(EqKind.Simple, dae.addDer(y1), dae.addRealLiteral(0.0));
    dae.bvp.addBoundaryEquation(dae.bvp.atStart(y0), dae.addRealLiteral(0.0));
    dae.bvp.addBoundaryEquation(dae.bvp.atEnd(y0), dae.addRealLiteral(2.0));

    const res = solveArena(dae, { tSpan: [0, 1] });
    assert.equal(res.kind, "bvp");
    assert.ok(res.times!.length >= 2);
    const last = res.states![res.states!.length - 1]!;
    assert.ok(Math.abs(last[0]! - 2.0) < 1e-3);
    assert.ok(Math.abs(last[1]! - 2.0) < 1e-3);
  });

  it("auto-dispatches PROBLEM_DDE to Method-of-Steps backed by WASM delay channels", () => {
    // Delayed decay: x'(t) = -x(t - 0.5), x(t) = 1.0 for t <= 0 => x(0.5) = 0.5
    const dae = new DAEBuilder(undefined, "DelayDecay");
    const x = dae.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
    const { exprId: delayedX } = dae.delays.addDelayExpr(
      dae.addName(x),
      dae.addRealLiteral(0.5),
      dae.addRealLiteral(1.0),
    );
    const negDelayed = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), delayedX);
    dae.addEquation(EqKind.Simple, dae.addDer(x), negDelayed);

    const res = solveArena(dae, { tSpan: [0, 0.5] });
    assert.equal(res.kind, "dde");
    const endVal = res.states![res.states!.length - 1]![0]!;
    assert.ok(Math.abs(endVal - 0.5) < 1e-2, `Expected x(0.5) ≈ 0.5, got ${endVal}`);
  });

  it("auto-dispatches SDE ensemble and Jump tau-leaping options", () => {
    const sde = new DAEBuilder(undefined, "SdeEnsDispatch");
    const S = sde.addVariable("S", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
    sde.addEquation(EqKind.Simple, sde.addDer(S), daeMul(sde, 0.05, S));
    sde.stochastic.addDiffusion(S, daeMul(sde, 0.1, S), 0);
    const ensRes = solveArena(sde, { tSpan: [0, 1], steps: 40, sdeMethod: "ensemble", ensemblePaths: 32, seed: 11 });
    assert.equal(ensRes.kind, "sde");
    assert.ok(ensRes.variance !== undefined && ensRes.variance.length === 41);

    const jmp = new DAEBuilder(undefined, "JumpTauDispatch");
    const X = jmp.addVariable("X", VarType.Real, Variability.Discrete, Causality.Local, 20.0);
    jmp.jumps.addJump(
      jmp.addRealLiteral(5.0),
      [{ targetVarId: X, deltaExprId: jmp.addRealLiteral(1.0), mode: JumpAffectMode.Additive }],
      JumpRateKind.ConstantRate,
    );
    const tlRes = solveArena(jmp, { tSpan: [0, 2], steps: 20, jumpMethod: "tau-leaping", seed: 19 });
    assert.equal(tlRes.kind, "jump");
    assert.equal(tlRes.times!.length, 21);
  });
});

function daeMul(dae: DAEBuilder, coeff: number, varId: number): number {
  return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(coeff), dae.addName(varId));
}
