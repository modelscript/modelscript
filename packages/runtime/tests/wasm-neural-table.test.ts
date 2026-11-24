// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDefaultWasmExports } from "../src/dae/wasm_loader.js";
import { ActivationKind, ArenaNeuralBlock } from "../src/dae/wasm_neural_block.js";
import { interpolate1DTable } from "../src/dae/wasm_table.js";

describe("WASM Neural MLP & Table Interpolation Kernels", () => {
  it("executes ArenaNeuralBlock forwardVectorized and vjpVectorized in WASM matching finite differences", () => {
    const w = getDefaultWasmExports();
    assert.equal(typeof w?.nn_mlpForward, "function", "nn_mlpForward should be exported from release.wasm");
    assert.equal(typeof w?.nn_mlpVjp, "function", "nn_mlpVjp should be exported from release.wasm");

    const nn = new ArenaNeuralBlock({
      name: "test_mlp",
      layers: [3, 5, 4, 2],
      activation: ActivationKind.Tanh,
      outputActivation: ActivationKind.Linear,
      seed: 123,
    });
    const weights = nn.generateXavierWeights();
    const x = new Float64Array([0.4, -0.7, 1.2]);
    const u = new Float64Array([0.9, -0.3]);

    const y = nn.forwardVectorized(x, weights);
    assert.equal(y.length, 2);
    assert.ok(Number.isFinite(y[0]!) && Number.isFinite(y[1]!));

    const { gradInputs, gradWeights } = nn.vjpVectorized(u, x, weights);
    assert.equal(gradInputs.length, 3);
    assert.equal(gradWeights.length, weights.length);

    // Verify input gradient against central finite differences
    const eps = 1e-6;
    for (let i = 0; i < x.length; i++) {
      const xp = new Float64Array(x);
      const xm = new Float64Array(x);
      xp[i] = xp[i]! + eps;
      xm[i] = xm[i]! - eps;
      const yp = nn.forwardVectorized(xp, weights);
      const ym = nn.forwardVectorized(xm, weights);
      const fd = (u[0]! * (yp[0]! - ym[0]!) + u[1]! * (yp[1]! - ym[1]!)) / (2 * eps);
      assert.ok(Math.abs(gradInputs[i]! - fd) < 1e-6, `gradInputs[${i}] mismatch: wasm=${gradInputs[i]} fd=${fd}`);
    }

    // Verify weight gradient against central finite differences
    for (let k = 0; k < weights.length; k++) {
      const wp = new Float64Array(weights);
      const wm = new Float64Array(weights);
      wp[k] = wp[k]! + eps;
      wm[k] = wm[k]! - eps;
      const yp = nn.forwardVectorized(x, wp);
      const ym = nn.forwardVectorized(x, wm);
      const fd = (u[0]! * (yp[0]! - ym[0]!) + u[1]! * (yp[1]! - ym[1]!)) / (2 * eps);
      assert.ok(Math.abs(gradWeights[k]! - fd) < 1e-6, `gradWeights[${k}] mismatch: wasm=${gradWeights[k]} fd=${fd}`);
    }
  });

  it("executes interpolate1DTable in WASM with clamping and linear interpolation", () => {
    const w = getDefaultWasmExports();
    assert.equal(typeof w?.table_interpolate1D, "function", "table_interpolate1D should be exported from release.wasm");

    const table = [
      [0.0, 10.0, 100.0],
      [1.0, 20.0, 200.0],
      [3.0, 50.0, 400.0],
    ];
    assert.equal(interpolate1DTable(table, 1, -1.0), 10.0);
    assert.equal(interpolate1DTable(table, 1, 0.5), 15.0);
    assert.equal(interpolate1DTable(table, 1, 2.0), 35.0);
    assert.equal(interpolate1DTable(table, 2, 2.0), 300.0);
    assert.equal(interpolate1DTable(table, 1, 5.0), 50.0);
  });

  it("executes DAEEventRelaxer in WASM linear memory (if-else and abs)", async () => {
    const w = getDefaultWasmExports();
    assert.equal(typeof w?.dae_relaxAllEquations, "function", "dae_relaxAllEquations should be exported");
    assert.equal(typeof w?.dae_relaxExpression, "function", "dae_relaxExpression should be exported");

    const { BinOp, Causality, DAEBuilder, EqKind, ExprKind, VarType, Variability } =
      await import("../src/dae/wasm_dae.js");
    const { relaxArenaEvents } = await import("../src/autodiff/wasm_event_relaxer.js");
    const { evaluateArenaExpression } = await import("../src/dae/wasm_evaluator.js");

    const dae = new DAEBuilder();
    dae.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const xExpr = dae.addNameExpr("x");
    const yExpr = dae.addNameExpr("y");
    const absX = dae.addCallExpr("abs", [xExpr]);
    dae.addEquation(EqKind.Simple, yExpr, absX);

    relaxArenaEvents(dae, { smoothness: 100.0 });
    const relaxedRhs = dae.getEqRhs(0);
    // Should no longer be a direct abs(x) call; should be sqrt(x^2 + eps^2)
    assert.equal(dae.getExprKind(relaxedRhs), ExprKind.Call);
    assert.equal(dae.interner.resolve(dae.getExprData1(relaxedRhs)), "sqrt");

    const env = new Map<string, number>([["x", -3.0]]);
    const val = evaluateArenaExpression(dae, relaxedRhs, env);
    assert.ok(Math.abs(val - 3.0) < 1e-3, `Expected ~3.0, got ${val}`);
  });

  it("executes certifyPsdInterval in WASM linear memory", async () => {
    const w = getDefaultWasmExports();
    assert.equal(typeof w?.sos_certifyPsdInterval, "function", "sos_certifyPsdInterval should be exported");
    const { certifyPsdInterval } = await import("../src/analysis/wasm_sos_barrier.js");

    const pd = certifyPsdInterval(
      [
        [4.0, 1.0],
        [1.0, 3.0],
      ],
      0.5,
    );
    assert.equal(pd.certified, true);
    assert.ok(pd.minPivotLo > 0);

    const notPd = certifyPsdInterval(
      [
        [1.0, 2.0],
        [2.0, 1.0],
      ],
      0.0,
    );
    assert.equal(notPd.certified, false);
  });
});
