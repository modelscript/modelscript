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
});
