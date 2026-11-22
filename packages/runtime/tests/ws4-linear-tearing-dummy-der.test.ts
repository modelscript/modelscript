// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeLinearSccBlock,
  DynamicDummyDerivativeSelector,
  solveLinearSccBlockDirect,
} from "../src/analysis/linear_tearing_and_dummy_der.js";
import { BinOp, DAEBuilder, EqKind, Variability, VarType } from "../src/dae/wasm_dae.js";

describe("WS4: Symbolic Linear-Loop Elimination & Dynamic Dummy Derivatives", () => {
  it("classifies linear algebraic loop and solves it directly in 0 Newton iterations", () => {
    // 2×2 resistive bridge algebraic loop:
    //   3*v1 - v2 = Vin
    //   -v1 + 2*v2 = 0
    // For Vin = 10 => v1 = 4, v2 = 2
    const dae = new DAEBuilder();
    const v1Idx = dae.addVariable("v1", VarType.Real, Variability.Continuous);
    const v2Idx = dae.addVariable("v2", VarType.Real, Variability.Continuous);
    dae.addVariable("Vin", VarType.Real, Variability.Parameter, 0, 10.0);

    const v1 = dae.addNameExpr("v1");
    const v2 = dae.addNameExpr("v2");
    const vin = dae.addNameExpr("Vin");

    const eq0 = dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Sub, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(3.0), v1), v2),
      vin,
    );
    const eq1 = dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Sub, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(2.0), v2), v1),
      dae.addRealLiteral(0.0),
    );

    const plan = analyzeLinearSccBlock(dae, [eq0, eq1], [v1Idx, v2Idx]);
    assert.equal(plan.isLinear, true);

    const maxId = Math.max(dae.interner.intern("v1"), dae.interner.intern("v2"), dae.interner.intern("Vin"));
    const vals = new Float64Array(maxId + 16);
    vals[dae.interner.intern("Vin")] = 10.0;
    const res = solveLinearSccBlockDirect(dae, plan, vals);
    assert.equal(res.solved, true);
    assert.equal(res.newtonIterations, 0);
    assert.ok(Math.abs(vals[dae.interner.intern("v1")]! - 4.0) < 1e-12);
    assert.ok(Math.abs(vals[dae.interner.intern("v2")]! - 2.0) < 1e-12);
  });

  it("rejects nonlinear algebraic loops from direct linear elimination", () => {
    const dae = new DAEBuilder();
    const xIdx = dae.addVariable("x", VarType.Real, Variability.Continuous);
    const x = dae.addNameExpr("x");
    const eq0 = dae.addEquation(EqKind.Simple, dae.addBinaryExpr(BinOp.Mul, x, x), dae.addRealLiteral(4.0));

    const plan = analyzeLinearSccBlock(dae, [eq0], [xIdx]);
    assert.equal(plan.isLinear, false);
  });

  it("DynamicDummyDerivativeSelector switches active state cleanly across full Cartesian pendulum revolution", () => {
    // Constraint g(x, y) = x^2 + y^2 - L^2 = 0  =>  G = [2x, 2y]
    const selector = new DynamicDummyDerivativeSelector(2, 1, 1.4, 0.2);
    const L = 1.0;

    // Sweep theta from 0 to 2*pi (full revolution)
    for (let step = 0; step <= 72; step++) {
      const theta = (2 * Math.PI * step) / 72;
      const x = L * Math.cos(theta);
      const y = L * Math.sin(theta);
      const G = [[2 * x, 2 * y]];

      const part = selector.selectPartition(G);
      assert.equal(part.activeStateIndices.length, 1);
      assert.equal(part.dummyDerIndices.length, 1);
      // Active dummy pivot must NEVER approach zero (singularity avoided at x=0 and y=0!)
      assert.ok(part.minPivot > 0.2, `Singularity encountered at theta=${theta}: pivot=${part.minPivot}`);
    }

    assert.ok(
      selector.totalSwitches >= 3,
      `Expected dynamic state switches during full revolution, got ${selector.totalSwitches}`,
    );
  });
});
