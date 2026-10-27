// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, StringInterner, Variability, VarType } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import {
  applyPidToArena,
  autotunePid,
  computeBodeResponse,
  computeEigenStructure,
  computeNyquistContour,
  computeStabilityMargins,
  findSteadyStateTrim,
  linearizeArenaDae,
  LinearMpcController,
  synthesizeLqr,
} from "../src/control/index.js";

describe("Workstream 1: DAE Linearization, Frequency-Domain Analysis & Control Synthesis", () => {
  it("linearizes an Index-1 RLC circuit DAE with algebraic resistor equation via Schur complement", () => {
    // Series RLC circuit with algebraic voltage drop v_R:
    //   States: v_C (capacitor voltage), i_L (inductor current)
    //   Algebraic: v_R (resistor voltage)
    //   Input: u_in (source voltage)
    //   Output: v_R (measured resistor voltage)
    //   Parameters: R = 2.0, L = 0.5, C = 0.25
    //   Equations:
    //     1) C * der(v_C) = i_L               => der(v_C) = 4 * i_L
    //     2) L * der(i_L) + v_R + v_C = u_in  => der(i_L) = -2*v_C - 2*v_R + 2*u_in
    //     3) v_R = R * i_L                    => v_R = 2 * i_L
    //   Eliminating v_R = 2 * i_L yields:
    //     A = [  0,  4 ]    B = [ 0 ]
    //         [ -2, -4 ]        [ 2 ]
    //     C = [  0,  2 ]    D = [ 0 ]
    const interner = new StringInterner();
    const dae = new DAEBuilder(interner, "SeriesRLC");

    dae.addVariable("v_C", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable("i_L", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable("v_R", VarType.Real, Variability.Continuous, Causality.Output, 0.0);
    dae.addVariable("u_in", VarType.Real, Variability.Continuous, Causality.Input, 10.0);

    const rIdx = dae.addVariable("R", VarType.Real, Variability.Parameter, Causality.Local, 2.0);
    dae.setVarExpression(rIdx, dae.addRealLiteral(2.0));
    const lIdx = dae.addVariable("L", VarType.Real, Variability.Parameter, Causality.Local, 0.5);
    dae.setVarExpression(lIdx, dae.addRealLiteral(0.5));
    const cIdx = dae.addVariable("C", VarType.Real, Variability.Parameter, Causality.Local, 0.25);
    dae.setVarExpression(cIdx, dae.addRealLiteral(0.25));

    // Eq 1: C * der(v_C) = i_L
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr("C"), dae.addDerExpr(dae.addNameExpr("v_C"))),
      dae.addNameExpr("i_L"),
    );

    // Eq 2: L * der(i_L) + v_R + v_C = u_in
    const lDerI = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr("L"), dae.addDerExpr(dae.addNameExpr("i_L")));
    const lhs2 = dae.addBinaryExpr(
      BinOp.Add,
      dae.addBinaryExpr(BinOp.Add, lDerI, dae.addNameExpr("v_R")),
      dae.addNameExpr("v_C"),
    );
    dae.addEquation(EqKind.Simple, lhs2, dae.addNameExpr("u_in"));

    // Eq 3: v_R = R * i_L
    dae.addEquation(
      EqKind.Simple,
      dae.addNameExpr("v_R"),
      dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr("R"), dae.addNameExpr("i_L")),
    );

    // 1. Verify steady-state trim at u_in = 10 V => v_C* = 10 V, i_L* = 0 A, v_R* = 0 V
    const trim = findSteadyStateTrim(dae);
    assert.strictEqual(trim.converged, true);
    assert(Math.abs(trim.operatingPoint.states["v_C"]! - 10.0) < 1e-6);
    assert(Math.abs(trim.operatingPoint.states["i_L"]! - 0.0) < 1e-6);
    assert(Math.abs(trim.operatingPoint.algebraics["v_R"]! - 0.0) < 1e-6);

    // 2. Verify Schur-complement linearization
    const lti = linearizeArenaDae(dae, { findEquilibrium: true });
    assert.deepStrictEqual(lti.stateNames, ["v_C", "i_L"]);
    assert.deepStrictEqual(lti.inputNames, ["u_in"]);
    assert.deepStrictEqual(lti.outputNames, ["v_R"]);

    // Expected A = [0, 4; -2, -4], B = [0; 2], C = [0, 2], D = [0]
    assert(Math.abs(lti.A[0]! - 0.0) < 1e-9);
    assert(Math.abs(lti.A[1]! - 4.0) < 1e-9);
    assert(Math.abs(lti.A[2]! - -2.0) < 1e-9);
    assert(Math.abs(lti.A[3]! - -4.0) < 1e-9);

    assert(Math.abs(lti.B[0]! - 0.0) < 1e-9);
    assert(Math.abs(lti.B[1]! - 2.0) < 1e-9);

    assert(Math.abs(lti.C[0]! - 0.0) < 1e-9);
    assert(Math.abs(lti.C[1]! - 2.0) < 1e-9);
    assert(Math.abs(lti.D[0]! - 0.0) < 1e-9);

    // 3. Verify eigenvalues of A: s^2 + 4s + 8 = 0 => s = -2 +- 2j, wn = sqrt(8), zeta = 2/sqrt(8) = 1/sqrt(2)
    const poles = computeEigenStructure(lti.A, 2);
    assert.strictEqual(poles.length, 2);
    for (const p of poles) {
      assert.strictEqual(p.stable, true);
      assert(Math.abs(p.real - -2.0) < 1e-6);
      assert(Math.abs(Math.abs(p.imag) - 2.0) < 1e-6);
      assert(Math.abs(p.naturalFrequency - Math.sqrt(8)) < 1e-6);
      assert(Math.abs(p.dampingRatio - Math.SQRT1_2) < 1e-6);
    }
  });

  it("computes Bode response, Nyquist sensitivity peak, and tunes a PID controller with arena patching", () => {
    // Second-order plant: G(s) = 2 / ((s + 1)(0.5s + 1)) = 4 / (s^2 + 3s + 2)
    // States: x1 (y), x2 (dy/dt)
    //   der(x1) = x2
    //   der(x2) = -2*x1 - 3*x2 + 4*u
    const interner = new StringInterner();
    const dae = new DAEBuilder(interner, "ThermalPlant");
    dae.addVariable("x1", VarType.Real, Variability.Continuous, Causality.Output, 0.0);
    dae.addVariable("x2", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable("u", VarType.Real, Variability.Continuous, Causality.Input, 0.0);
    dae.addVariable("PID.Kp", VarType.Real, Variability.Parameter, Causality.Local, 1.0);
    dae.addVariable("PID.Ti", VarType.Real, Variability.Parameter, Causality.Local, 1.0);
    dae.addVariable("PID.Td", VarType.Real, Variability.Parameter, Causality.Local, 0.0);

    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr("x1")), dae.addNameExpr("x2"));

    const term1 = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-2.0), dae.addNameExpr("x1"));
    const term2 = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-3.0), dae.addNameExpr("x2"));
    const term3 = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(4.0), dae.addNameExpr("u"));
    dae.addEquation(
      EqKind.Simple,
      dae.addDerExpr(dae.addNameExpr("x2")),
      dae.addBinaryExpr(BinOp.Add, dae.addBinaryExpr(BinOp.Add, term1, term2), term3),
    );

    const lti = linearizeArenaDae(dae);
    const bode = computeBodeResponse(lti);
    // DC gain G(0) = 4 / 2 = 2.0
    assert(Math.abs(bode.dcGain - 2.0) < 1e-6);

    const nyquist = computeNyquistContour(lti);
    assert(nyquist.minReturnDifference > 0.5);
    assert(Number.isFinite(nyquist.peakSensitivityMs));

    const margins = computeStabilityMargins(bode);
    assert(margins.phaseMarginDeg > 30);

    const pid = autotunePid(lti, {
      controllerType: "PID",
      minPhaseMarginDeg: 45,
      maxSensitivityMs: 1.6,
    });
    assert(pid.Kp > 0);
    assert(pid.Ki > 0);
    assert(pid.phaseMarginDeg >= 40);
    assert(pid.peakSensitivityMs <= 1.8);

    const patchedCount = applyPidToArena(dae, pid, "PID");
    assert.strictEqual(patchedCount, 3);
  });

  it("solves CARE for LQR state-feedback synthesis and executes box-constrained Linear MPC", () => {
    // Double integrator plant: dx1/dt = x2, dx2/dt = u
    // A = [0, 1; 0, 0], B = [0; 1], Q = I_2, R = [1]
    // Exact analytical CARE solution:
    //   K = [1, sqrt(3)] = [1.0, 1.7320508]
    const A = new Float64Array([0, 1, 0, 0]);
    const B = new Float64Array([0, 1]);
    const Q = new Float64Array([1, 0, 0, 1]);
    const R = new Float64Array([1]);

    const lqr = synthesizeLqr(A, B, Q, R, 2, 1);
    assert(lqr.riccatiResidual < 1e-7, `Expected small CARE residual, got ${lqr.riccatiResidual}`);
    assert(Math.abs(lqr.K[0]! - 1.0) < 1e-4);
    assert(Math.abs(lqr.K[1]! - Math.sqrt(3)) < 1e-4);
    assert(lqr.closedLoopPoles.every((p) => p.stable));

    // Closed-loop step tracking with Box-Constrained LinearMpcController
    const sys = {
      nStates: 2,
      nInputs: 1,
      nOutputs: 1,
      nAlgebraics: 0,
      stateNames: ["pos", "vel"],
      inputNames: ["u"],
      outputNames: ["pos"],
      algebraicNames: [],
      A,
      B,
      C: new Float64Array([1, 0]),
      D: new Float64Array([0]),
      Kzx: new Float64Array(0),
      Kzu: new Float64Array(0),
      operatingPoint: {
        time: 0,
        states: { pos: 0, vel: 0 },
        algebraics: {},
        inputs: { u: 0 },
        stateDerivatives: { pos: 0, vel: 0 },
      },
      pencilConditionMetric: 1.0,
    };

    const mpc = new LinearMpcController(sys, {
      sampleTime: 0.1,
      predictionHorizon: 15,
      controlHorizon: 5,
      outputWeights: [10.0],
      controlRateWeights: [0.2],
      uMin: [-2.0],
      uMax: [2.0],
    });

    const state = new Float64Array([0.0, 0.0]);
    const ref = [1.0];
    for (let step = 0; step < 60; step++) {
      const u = mpc.computeControl(state, ref);
      // Verify box constraint enforcement
      assert(u[0]! >= -2.0 - 1e-9 && u[0]! <= 2.0 + 1e-9);
      // Advance discrete plant x_{k+1} = Ad * x_k + Bd * u_k
      const x0 = mpc.Ad[0]! * state[0]! + mpc.Ad[1]! * state[1]! + mpc.Bd[0]! * u[0]!;
      const x1 = mpc.Ad[2]! * state[0]! + mpc.Ad[3]! * state[1]! + mpc.Bd[1]! * u[0]!;
      state[0] = x0;
      state[1] = x1;
    }

    assert(Math.abs(state[0]! - 1.0) < 0.05, `Expected MPC to track reference 1.0, got ${state[0]}`);
  });
});
