// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, initBltWasm, Variability, VarType } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { solveDaeAdjoint } from "../src/core/dae-adjoint-solver.js";
import { extractArenaResetEvents } from "../src/core/hybrid-adjoint.js";

describe("WS3: Solver-Agnostic & Event-Aware Adjoint Sensitivity", () => {
  it("computes exact parameter gradients using adaptive Rodas5P and Tsit5 forward integrators with Quadrature/Gauss adjoints", async () => {
    await initBltWasm();
    // Exponential decay: der(x) = -k * x, x(0) = 1 => x(T) = exp(-k*T)
    // Terminal loss L = 0.5 * x(T)^2 => dL/dk = -T * exp(-2*k*T)
    const buildDecayDae = () => {
      const dae = new DAEBuilder();
      const xIdx = dae.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
      dae.setVarStartValue(xIdx, 1.0);
      dae.addVariable("k", VarType.Real, Variability.Parameter, 0, 2.0);

      const xRef = dae.addNameExpr("x");
      const kRef = dae.addNameExpr("k");
      const negKx = dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), dae.addBinaryExpr(BinOp.Mul, kRef, xRef));
      dae.addEquation(EqKind.Simple, dae.addDerExpr(xRef), negKx);
      return dae;
    };

    const T = 0.5;
    const kVal = 2.0;
    const exactGrad = -T * Math.exp(-2 * kVal * T); // -0.5 * exp(-2)

    const dae1 = buildDecayDae();
    const resRodas5P = solveDaeAdjoint(dae1, {
      startTime: 0,
      stopTime: T,
      numberOfIntervals: 50,
      forwardIntegrator: "rodas5p",
      adjointMethod: "quadrature",
      parametersToDifferentiate: ["k"],
      terminalLoss: (states) => {
        const xT = states.get("x") ?? 0;
        return { loss: 0.5 * xT * xT, gradState: new Map([["x", xT]]) };
      },
    });

    const gradRodas = resRodas5P.gradients.get("k") ?? NaN;
    assert.ok(
      Math.abs(gradRodas - exactGrad) < 1e-3,
      `Rodas5P+QuadratureAdjoint gradient ${gradRodas} should match exact ${exactGrad}`,
    );

    const dae2 = buildDecayDae();
    const resTsit5 = solveDaeAdjoint(dae2, {
      startTime: 0,
      stopTime: T,
      numberOfIntervals: 50,
      forwardIntegrator: "tsit5",
      adjointMethod: "gauss",
      parametersToDifferentiate: ["k"],
      terminalLoss: (states) => {
        const xT = states.get("x") ?? 0;
        return { loss: 0.5 * xT * xT, gradState: new Map([["x", xT]]) };
      },
    });

    const gradTsit = resTsit5.gradients.get("k") ?? NaN;
    assert.ok(
      Math.abs(gradTsit - exactGrad) < 1e-3,
      `Tsit5+GaussAdjoint gradient ${gradTsit} should match exact ${exactGrad}`,
    );
  });

  it("extractArenaResetEvents automatically synthesizes AD saltation gradients from DAEBuilder when/reinit equations", () => {
    const dae = new DAEBuilder();
    dae.addVariable("h", VarType.Real, Variability.Continuous);
    dae.addVariable("v", VarType.Real, Variability.Continuous);
    dae.addVariable("e", VarType.Real, Variability.Parameter, 0, 0.8);

    const hRef = dae.addNameExpr("h");
    const vRef = dae.addNameExpr("v");
    const eRef = dae.addNameExpr("e");
    const cond = dae.addBinaryExpr(BinOp.Lt, hRef, dae.addRealLiteral(0.0));
    const resetExpr = dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), dae.addBinaryExpr(BinOp.Mul, eRef, vRef));

    const bodyStart = dae.eqCount + 1;
    dae.addEquation(EqKind.When, cond, bodyStart, 1);
    dae.addEquation(EqKind.Simple, vRef, resetExpr);

    const events = extractArenaResetEvents(dae);
    assert.equal(events.length, 1);
    const evt = events[0]!;
    const xMinus = new Map([
      ["h", 0.0],
      ["v", -5.0],
    ]);
    const p = new Map([["e", 0.8]]);

    const gradH = evt.gradIndicatorState(0.5, xMinus, p);
    assert.equal(gradH.get("h"), 1);
    assert.equal(gradH.get("v"), 0);

    const xPlus = evt.resetMap(0.5, xMinus, p);
    assert.ok(Math.abs((xPlus.get("v") ?? 0) - 4.0) < 1e-12);

    const jState = evt.jacobianResetState(0.5, xMinus, p);
    assert.ok(Math.abs((jState.get("v")?.get("v") ?? 0) - -0.8) < 1e-12);

    const jParam = evt.jacobianResetParam!(0.5, xMinus, p);
    assert.ok(Math.abs((jParam.get("v")?.get("e") ?? 0) - 5.0) < 1e-12);
  });
});
