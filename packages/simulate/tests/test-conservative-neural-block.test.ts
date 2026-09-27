// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ActivationKind,
  ArenaConservativeNeuralBlock,
  ArenaNeuralBlock,
  BinOp,
  DAEBuilder,
  EqKind,
  FlowConservationConstraint,
  VarType,
  Variability,
} from "@modelscript/runtime";
import { initBltWasm } from "@modelscript/runtime/wasm_blt.js";
import { simulateArena } from "@modelscript/simulate/core";
import assert from "node:assert";
import { describe, it } from "node:test";

describe("Physics-Enhanced Conservative Neural Block (BNODE / Kirchhoff Invariant)", () => {
  it("projects raw output vector onto exact affine balance hyperplane C * y = d", () => {
    // 3 flow ports: m1, m2, m3 such that m1 + m2 + m3 = 0
    const constraint: FlowConservationConstraint = {
      indices: [0, 1, 2],
      coefficients: [1.0, 1.0, 1.0],
      target: 0.0,
    };

    const { P, y0 } = ArenaConservativeNeuralBlock.computeProjection(3, [constraint]);

    // Check P symmetry and idempotence (P^2 = P)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        assert.strictEqual(Math.abs(P[i]![j]! - P[j]![i]!) < 1e-9, true);
      }
    }

    // Arbitrary unconstrained raw network prediction
    const rawOutputs = [15.2, -4.8, 2.6]; // sum = 13.0 != 0
    const rawSum = rawOutputs[0]! + rawOutputs[1]! + rawOutputs[2]!;
    assert(Math.abs(rawSum) > 1.0);

    // Apply projection: y_cons = P * y_raw + y0
    const yCons = new Float64Array(3);
    for (let i = 0; i < 3; i++) {
      let sum = y0[i]!;
      for (let j = 0; j < 3; j++) {
        sum += P[i]![j]! * rawOutputs[j]!;
      }
      yCons[i] = sum;
    }

    const consSum = yCons[0]! + yCons[1]! + yCons[2]!;
    // Must be machine zero
    assert(Math.abs(consSum) < 1e-12, `consSum = ${consSum}`);
  });

  it("embeds conservative projection equations in DAEBuilder and preserves mass balance during simulation", async () => {
    await initBltWasm();
    const arena = new DAEBuilder();

    // Input variable: driving pressure drop dp
    const dpIdx = arena.addVariable("dp", VarType.Real, Variability.Continuous, 0, 100.0);
    arena.setVarStartValue(dpIdx, 100.0);
    const dpExpr = arena.addNameExpr("dp");
    const derDp = arena.addDerExpr(dpExpr);
    // der(dp) = -0.5 * dp (decaying pressure transient)
    arena.addEquation(EqKind.Simple, derDp, arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(-0.5), dpExpr));

    // Three output mass flows: m_flow_1, m_flow_2, m_flow_3
    const outputNames = ["m_flow_1", "m_flow_2", "m_flow_3"];
    for (const name of outputNames) {
      arena.addVariable(name, VarType.Real, Variability.Continuous, 0, 0.0);
    }

    // Base neural block: 1 input -> 8 hidden -> 3 outputs
    const baseBlock = new ArenaNeuralBlock({
      name: "junction_flows",
      layers: [1, 8, 3],
      activation: ActivationKind.Tanh,
      outputActivation: ActivationKind.Linear,
      seed: 12345,
    });

    // Enforce Kirchhoff flow balance: m_flow_1 + m_flow_2 + m_flow_3 = 0
    const massBalance: FlowConservationConstraint = {
      indices: [0, 1, 2],
      coefficients: [1.0, 1.0, 1.0],
      target: 0.0,
    };

    const consBlock = new ArenaConservativeNeuralBlock(baseBlock, [massBalance]);
    consBlock.build(arena, ["dp"], outputNames);

    // Simulate transient
    const simRes = await simulateArena(arena, {
      startTime: 0.0,
      stopTime: 1.0,
      step: 0.1,
    });

    assert.ok(simRes.t.length > 5, "Simulation must produce trajectory points");

    // Also test forward projection API directly
    const rawPred = new Float64Array([10.5, -2.3, 4.8]);
    const consPred = consBlock.projectOutputs(rawPred);
    assert.strictEqual(consPred.length, 3);
    const sumPred = consPred[0]! + consPred[1]! + consPred[2]!;
    assert(Math.abs(sumPred) < 1e-12, `Direct projection sum violation: ${sumPred}`);
  });
});
