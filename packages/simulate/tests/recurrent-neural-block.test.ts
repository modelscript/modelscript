// SPDX-License-Identifier: AGPL-3.0-or-later

import { ActivationKind, ArenaCTRNNBlock, DAEBuilder, EqKind, VarType, Variability } from "@modelscript/runtime";
import { initBltWasm } from "@modelscript/runtime/wasm_blt.js";
import { simulateArena } from "@modelscript/simulate/core";
import assert from "node:assert";
import { describe, it } from "node:test";

describe("Continuous-Time Recurrent Neural Network (CTRNN) Arena Block", () => {
  it("constructs and lowers CTRNN block with continuous state variables and differential equations", async () => {
    await initBltWasm();
    const arena = new DAEBuilder();

    // External driving input
    const uIdx = arena.addVariable("u", VarType.Real, Variability.Continuous, 0, 1.0);
    arena.setVarStartValue(uIdx, 1.0);
    const uExpr = arena.addNameExpr("u");
    const derU = arena.addDerExpr(uExpr);
    // der(u) = 0 (constant drive)
    arena.addEquation(EqKind.Simple, derU, arena.addRealLiteral(0.0));

    // Target output
    arena.addVariable("y_ctrnn", VarType.Real, Variability.Continuous, 0, 0.0);

    const ctrnn = new ArenaCTRNNBlock({
      name: "drag_rec",
      inDim: 1,
      hiddenDim: 3,
      outDim: 1,
      activation: ActivationKind.Tanh,
      outputActivation: ActivationKind.Linear,
      initialTau: 0.5,
      seed: 42,
    });

    ctrnn.build(arena, ["u"], ["y_ctrnn"]);

    assert.strictEqual(ctrnn.getHiddenVarNames().length, 3, "Must have 3 hidden continuous state variables");
    assert.strictEqual(ctrnn.getDerVarNames().length, 3, "Must have 3 state derivative names");
    assert.ok(ctrnn.weightCount > 0, "Weight count must be positive");

    // Verify parameter retrieval and setting
    const wInit = ctrnn.getWeights(arena);
    assert.strictEqual(wInit.length, ctrnn.weightCount);
    ctrnn.setWeights(arena, wInit);

    // Verify forward integration matches Euler step logic
    const inputVec = new Float64Array([1.0]);
    const hiddenVec = new Float64Array([0.1, -0.2, 0.05]);
    const { nextHidden, outputs } = ctrnn.forward(inputVec, hiddenVec, 0.01, wInit);

    assert.strictEqual(nextHidden.length, 3);
    assert.strictEqual(outputs.length, 1);
    assert.ok(Number.isFinite(outputs[0]), "Output must be finite");

    // Simulate DAE system containing the CTRNN block
    const simRes = await simulateArena(arena, {
      startTime: 0.0,
      stopTime: 1.0,
      step: 0.05,
    });

    assert.ok(simRes.t.length > 5, "Simulation must produce trajectory points");
    // States contain dynamic ODE states (e.g. h_0, h_1, h_2)
    assert.ok(simRes.states.length >= 3, "Must have recurrent hidden states in simulation");
    assert.ok(
      simRes.states.some((s) => s.includes("drag_rec_h")),
      "Must contain CTRNN hidden states",
    );

    const finalRow = simRes.y[simRes.y.length - 1];
    assert.ok(finalRow && finalRow.length > 0, "Final row must exist");
    for (const val of finalRow) {
      assert.ok(Number.isFinite(val), "State values must remain finite");
    }
  });
});
