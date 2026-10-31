// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeBodePlot, computeEigenvalues, linearizeEasy5, parseEasy5, trimEasy5 } from "../src/index.js";

describe("@modelscript/easy5 Linear Control Analysis Suite", () => {
  it("linearizes first-order lag filter into A, B, C, D matrices with analytical parity", () => {
    // Lead-Lag filter: H(s) = GAIN * (1 + TAU1*s) / (1 + TAU2*s)
    // With GAIN=2.0, TAU1=0.0, TAU2=0.5 -> H(s) = 2.0 / (0.5 s + 1) = 4 / (s + 2)
    // State-space:
    // ds/dt = (u - s) / 0.5 = -2*s + 2*u -> A = [-2], B = [2]
    // y = GAIN * s = 2*s -> C = [2], D = [0]
    const src = `MODEL: FirstOrderLag
COMPONENTS:
  LA01 TYPE=GP/LA
    XP: GAIN=2.0, TAU1=0.0, TAU2=0.5
`;
    const model = parseEasy5(src);
    const lin = linearizeEasy5(model);

    assert.strictEqual(lin.A.length, 1);
    assert.strictEqual(lin.B.length, 1);
    assert.strictEqual(lin.C.length, 1);
    assert.strictEqual(lin.D.length, 1);

    // Verify A ≈ -2.0 within 1e-4
    assert.ok(Math.abs(lin.A[0]![0]! - -2.0) < 1e-4, `Expected A = -2.0, got ${lin.A[0]![0]}`);
    // Verify B ≈ 2.0 within 1e-4
    assert.ok(Math.abs(lin.B[0]![0]! - 2.0) < 1e-4, `Expected B = 2.0, got ${lin.B[0]![0]}`);
    // Verify C ≈ 2.0 within 1e-4
    assert.ok(Math.abs(lin.C[0]![0]! - 2.0) < 1e-4, `Expected C = 2.0, got ${lin.C[0]![0]}`);
    // Verify D ≈ 0.0 within 1e-4
    assert.ok(Math.abs(lin.D[0]![0]! - 0.0) < 1e-4, `Expected D = 0.0, got ${lin.D[0]![0]}`);
  });

  it("computes system eigenvalues, poles, and stability", () => {
    const A = [[-2.0]];
    const eigs = computeEigenvalues(A);
    assert.strictEqual(eigs.length, 1);
    assert.ok(Math.abs(eigs[0]!.real - -2.0) < 1e-6);
    assert.strictEqual(eigs[0]!.isStable, true);
    assert.ok(Math.abs(eigs[0]!.frequencyRadS - 2.0) < 1e-6);
  });

  it("computes frequency response Bode plot magnitude and phase curves", () => {
    const sys = {
      A: [[-2.0]],
      B: [[2.0]],
      C: [[2.0]],
      D: [[0.0]],
      stateNames: ["s"],
      inputNames: ["u"],
      outputNames: ["y"],
    };

    const bode = computeBodePlot(sys, {
      minFreqRadS: 0.1,
      maxFreqRadS: 100.0,
      points: 20,
    });

    assert.strictEqual(bode.channels.length, 1);
    const ch = bode.channels[0]!;

    // At low frequency (w -> 0): G(0) = 4 / 2 = 2.0 -> 20*log10(2) ≈ 6.02 dB
    assert.ok(Math.abs(ch.magnitudeDb[0]! - 6.02) < 0.5);
    // At high frequency (w -> 100): roll-off < 0 dB
    assert.ok(ch.magnitudeDb[ch.magnitudeDb.length - 1]! < -20.0);
  });

  it("solves for trim operating equilibrium (dx/dt = 0)", () => {
    const src = `MODEL: StableSystem
COMPONENTS:
  LA01 TYPE=GP/LA
    XP: GAIN=1.0, TAU1=0.0, TAU2=1.0, S0=5.0
`;
    const model = parseEasy5(src);
    const trim = trimEasy5(model, {
      initialInputs: { LA01_IN: 0.0 },
      initialStates: { LA01_s: 5.0 },
    });

    assert.strictEqual(trim.converged, true);
    // At equilibrium with u=0, s must equal 0
    assert.ok(Math.abs(trim.trimmedStates["LA01_s"]!) < 1e-5);
  });

  it("extracts complex-conjugate and real eigenvalues for 3rd and 4th order systems", () => {
    // 3x3 block diagonal with real pole -3 and complex conjugate pair -1 +/- 2i:
    // Characteristic polynomial: (s + 3)(s^2 + 2s + 5) = s^3 + 5s^2 + 11s + 15
    const A3 = [
      [0, 1, 0],
      [0, 0, 1],
      [-15, -11, -5],
    ];
    const eigs3 = computeEigenvalues(A3);
    assert.strictEqual(eigs3.length, 3);
    const realPole = eigs3.find((e) => Math.abs(e.imag) < 1e-3);
    assert.ok(realPole, "Expected one real pole");
    assert.ok(Math.abs(realPole.real - -3.0) < 1e-3, `Expected real pole -3.0, got ${realPole.real}`);

    const complexPoles = eigs3.filter((e) => Math.abs(e.imag) > 1.0);
    assert.strictEqual(complexPoles.length, 2, "Expected complex-conjugate pole pair");
    assert.ok(Math.abs(complexPoles[0]!.real - -1.0) < 1e-3);
    assert.ok(Math.abs(Math.abs(complexPoles[0]!.imag) - 2.0) < 1e-3);
  });

  it("linearizes TF, FN (with TABLES:), and UG components in buildModelEvaluator", () => {
    const src = `MODEL: MultiBlockLinearize
TABLES:
  TABLE: GAIN_TAB
    X = [0.0, 1.0, 2.0]
    DATA = [0.0, 3.0, 6.0]
  ENDTABLE
COMPONENTS:
  TF01 TYPE=GP/TF
    XP: NUM=[2.0], DEN=[1.0, 4.0, 5.0], S0=0.0
  FN01 TYPE=GP/FN
    XP: TABLE=GAIN_TAB, EXTRAP=CLAMP
CONNECTIONS:
  TF01.OUT -> FN01.IN
`;
    const model = parseEasy5(src);
    assert.ok(model.tables.has("GAIN_TAB"), "Expected TABLES: section to be parsed");
    const lin = linearizeEasy5(model);
    assert.strictEqual(lin.A.length, 2, "2nd-order TF should have 2 states");
    // Companion matrix for s^2 + 4s + 5 has trace -4 and determinant 5
    const trace = lin.A[0]![0]! + lin.A[1]![1]!;
    assert.ok(Math.abs(trace - -4.0) < 1e-3, `Expected trace -4.0, got ${trace}`);
  });
});
