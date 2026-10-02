// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  BinOp,
  DAEBuilder,
  EqKind,
  HybridModeConsistencyVerifier,
  NumericalInterval,
  Variability,
  VarType,
} from "../src/index.js";

describe("Phase 3: Hybrid Mode Consistency & Zeno Verifier (@modelscript/runtime)", () => {
  it("should detect impulsive continuous state jumps in when equations", () => {
    const arena = new DAEBuilder();
    const vIdx = arena.addVariable("V_cap", VarType.Real, Variability.Continuous);
    const vName = arena.interner.intern("V_cap");

    // when condition: close_switch
    const switchIdx = arena.addVariable("close_switch", VarType.Boolean, Variability.Discrete);
    const switchName = arena.interner.intern("close_switch");
    const switchExpr = arena.addExpression(0, switchName);

    const whenEq = arena.addWhenEquation(switchExpr);

    // Body: V_cap = 0.0 (shorting capacitor without resistor)
    const vExpr = arena.addExpression(0, vName);
    const zero = arena.addRealLiteral(0.0);
    arena.addWhenBodyEquation(whenEq, EqKind.Simple, vExpr, zero);

    const verifier = new HybridModeConsistencyVerifier(arena, {
      stateVars: new Set([vIdx]),
      variableBounds: new Map([[vIdx, new NumericalInterval(5.0, 10.0)]]),
    });

    const result = verifier.verify();
    assert.strictEqual(result.isCertifiedConsistent, false);
    assert.strictEqual(result.totalWhenEquations, 1);

    const jumpIssue = result.issues.find((i) => i.kind === "state_jump_discontinuity");
    assert.ok(jumpIssue !== undefined);
    assert.strictEqual(jumpIssue.severity, "definite");
    assert.ok(jumpIssue.message.includes("V_cap"));
  });

  it("should detect Zeno event chattering when post-reset condition satisfies entry guard", () => {
    const arena = new DAEBuilder();
    const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
    const xName = arena.interner.intern("x");

    // Guard: x <= 0.0
    const xExpr = arena.addExpression(0, xName);
    const zero = arena.addRealLiteral(0.0);
    const guardExpr = arena.addBinaryExpr(BinOp.Lte, xExpr, zero);

    const whenEq = arena.addWhenEquation(guardExpr);

    // Defective reset: x = -1.0 (still <= 0.0, so guard immediately refires at t^+ = t0!)
    const minusOne = arena.addRealLiteral(-1.0);
    const xTarget = arena.addExpression(0, xName);
    arena.addWhenBodyEquation(whenEq, EqKind.Simple, xTarget, minusOne);

    const verifier = new HybridModeConsistencyVerifier(arena, {
      stateVars: new Set([xIdx]),
      variableBounds: new Map([[xIdx, new NumericalInterval(-0.5, 0.5)]]),
    });

    const result = verifier.verify();
    assert.strictEqual(result.isCertifiedConsistent, false);

    const zenoIssue = result.issues.find((i) => i.kind === "zeno_chattering_detected");
    assert.ok(zenoIssue !== undefined);
    assert.strictEqual(zenoIssue.severity, "definite");
  });

  it("should certify valid reset transitions that prevent Zeno chattering (reversing velocity)", () => {
    const arena = new DAEBuilder();
    const vIdx = arena.addVariable("v", VarType.Real, Variability.Continuous);
    const vName = arena.interner.intern("v");

    // Guard: v <= 0.0 (falling into floor)
    const vExpr = arena.addExpression(0, vName);
    const zero = arena.addRealLiteral(0.0);
    const guardExpr = arena.addBinaryExpr(BinOp.Lte, vExpr, zero);

    const whenEq = arena.addWhenEquation(guardExpr);

    // Reset: v = +5.0 (rebounding upward, so post-reset guard v <= 0 is false)
    const plusFive = arena.addRealLiteral(5.0);
    const vTarget = arena.addExpression(0, vName);
    arena.addWhenBodyEquation(whenEq, EqKind.Simple, vTarget, plusFive);

    const verifier = new HybridModeConsistencyVerifier(arena, {
      stateVars: new Set([]), // Not tracking as unconstrained jump
      variableBounds: new Map([[vIdx, new NumericalInterval(-10.0, -1.0)]]),
    });

    const result = verifier.verify();
    const zenoIssue = result.issues.find((i) => i.kind === "zeno_chattering_detected");
    assert.strictEqual(zenoIssue, undefined);
  });
});
