// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, initBltWasm, Variability, VarType } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { synthesizeHinfStateFeedback } from "../src/control/hinf-synthesis.js";
import { RtiNonlinearMpcController } from "../src/control/nmpc.js";
import { calibrateJointExperiments } from "../src/optimizer/core/calibrator.js";

describe("WS5: H-Infinity Synthesis, RTI-NMPC & Multi-Experiment Joint Calibration", () => {
  it("synthesizes a stabilizing H-infinity state-feedback controller with ||T_zw||_inf < gamma", () => {
    // 2nd-order damped oscillator with disturbance B1 and control B2:
    //   dx1/dt = x2
    //   dx2/dt = -x1 - 0.5*x2 + w + u
    const res = synthesizeHinfStateFeedback(
      {
        A: [
          [0, 1],
          [-1, -0.5],
        ],
        B1: [[0], [1]],
        B2: [[0], [1]],
        C1: [
          [1, 0],
          [0, 0.5],
        ],
      },
      { gammaMin: 0.1, gammaMax: 20.0, gammaTol: 0.05 },
    );

    assert.equal(res.converged, true);
    assert.ok(res.gamma < 5.0, `Expected reasonable H_inf gamma < 5, got ${res.gamma}`);
    assert.ok(
      res.achievedHinfNorm <= res.gamma * 1.05,
      `Achieved H_inf norm (${res.achievedHinfNorm}) must satisfy <= gamma (${res.gamma})`,
    );
    assert.equal(res.K.length, 1);
    assert.equal(res.K[0]!.length, 2);
  });

  it("RTI Nonlinear MPC stabilizes nonlinear pendulum/damped system within control bounds", () => {
    // Nonlinear pendulum dynamics: d(theta)/dt = omega, d(omega)/dt = -sin(theta) - 0.1*omega + u
    const dynamics = (x: number[], u: number[]) => [x[1]!, -Math.sin(x[0]!) - 0.1 * x[1]! + u[0]!];
    const mpc = new RtiNonlinearMpcController({
      dynamics,
      nStates: 2,
      nControls: 1,
      horizon: 12,
      dt: 0.05,
      Q: [10.0, 1.0],
      R: [0.1],
      uMin: [-3.0],
      uMax: [3.0],
      rtiInnerIterations: 6,
    });

    let x = [0.8, 0.0];
    const xRef = [0.0, 0.0];
    for (let step = 0; step < 40; step++) {
      const { u0 } = mpc.computeControl(x, xRef);
      assert.ok(u0[0]! >= -3.0 - 1e-12 && u0[0]! <= 3.0 + 1e-12, `Control ${u0[0]} violated box bounds`);
      // Advance plant with RK4
      const dt = 0.05;
      const k1 = dynamics(x, u0);
      const k2 = dynamics([x[0]! + 0.5 * dt * k1[0]!, x[1]! + 0.5 * dt * k1[1]!], u0);
      const k3 = dynamics([x[0]! + 0.5 * dt * k2[0]!, x[1]! + 0.5 * dt * k2[1]!], u0);
      const k4 = dynamics([x[0]! + dt * k3[0]!, x[1]! + dt * k3[1]!], u0);
      x = [
        x[0]! + (dt / 6) * (k1[0]! + 2 * k2[0]! + 2 * k3[0]! + k4[0]!),
        x[1]! + (dt / 6) * (k1[1]! + 2 * k2[1]! + 2 * k3[1]! + k4[1]!),
      ];
    }

    assert.ok(Math.abs(x[0]!) < 0.15, `Expected NMPC to drive angle near 0, got ${x[0]}`);
  });

  it("calibrateJointExperiments recovers shared global parameter across multiple experiments", async () => {
    await initBltWasm();
    // Thermal cooling model: der(T) = -k * (T - T_amb)
    // True shared k = 1.5, measured across two experiments with different T_amb and T(0)
    const dae = new DAEBuilder();
    const tIdx = dae.addVariable("T", VarType.Real, Variability.Continuous, 0, 100.0);
    dae.setVarStartValue(tIdx, 100.0);
    dae.addVariable("k", VarType.Real, Variability.Parameter, 0, 1.0);
    dae.addVariable("T_amb", VarType.Real, Variability.Parameter, 0, 20.0);

    const tRef = dae.addNameExpr("T");
    const kRef = dae.addNameExpr("k");
    const ambRef = dae.addNameExpr("T_amb");
    const rhs = dae.addBinaryExpr(
      BinOp.Sub,
      dae.addRealLiteral(0.0),
      dae.addBinaryExpr(BinOp.Mul, kRef, dae.addBinaryExpr(BinOp.Sub, tRef, ambRef)),
    );
    dae.addEquation(EqKind.Simple, dae.addDerExpr(tRef), rhs);

    const kTrue = 1.5;
    const tGrid = [0, 0.25, 0.5, 0.75, 1.0];
    const exp1Y = tGrid.map((t) => 20 + (100 - 20) * Math.exp(-kTrue * t));
    const exp2Y = tGrid.map((t) => 10 + (60 - 10) * Math.exp(-kTrue * t));

    const res = calibrateJointExperiments(dae, {
      globalParameters: ["k"],
      parameterBounds: new Map([["k", { min: 0.1, max: 5.0 }]]),
      initialGuess: new Map([["k", 0.5]]),
      experiments: [
        {
          id: "hot_run",
          parameterOverrides: new Map([["T_amb", 20]]),
          initialStateOverrides: new Map([["T", 100]]),
          measurements: new Map([["T", { t: tGrid, y: exp1Y }]]),
        },
        {
          id: "cold_run",
          parameterOverrides: new Map([["T_amb", 10]]),
          initialStateOverrides: new Map([["T", 60]]),
          measurements: new Map([["T", { t: tGrid, y: exp2Y }]]),
        },
      ],
    });

    const kEst = res.globalParameters.get("k") ?? NaN;
    assert.ok(Math.abs(kEst - kTrue) < 0.02, `Expected joint k ≈ ${kTrue}, got ${kEst}`);
    assert.ok(res.totalResidual < 1e-2, `Expected low joint residual, got ${res.totalResidual}`);
  });
});
