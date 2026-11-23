// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsmpDeck, simulateCsmp } from "../src/index.js";

function computeMetrics(simulated: number[], analytical: number[]): { rmse: number; maxRelErr: number } {
  let sumSq = 0;
  let maxRelErr = 0;
  const n = Math.min(simulated.length, analytical.length);
  const scale = Math.max(1e-12, ...analytical.map((v) => Math.abs(v)));
  for (let i = 0; i < n; i++) {
    const err = Math.abs(simulated[i]! - analytical[i]!);
    sumSq += err * err;
    const rel = err / scale;
    if (rel > maxRelErr) maxRelErr = rel;
  }
  return {
    rmse: Math.sqrt(sumSq / Math.max(1, n)),
    maxRelErr,
  };
}

describe("@modelscript/csmp — Classic IBM CSMP/360 Numerical Benchmarks", () => {
  it("Benchmark 1: Damped Spring-Mass Oscillator (RKSFX & MILNE vs exact analytical solution)", () => {
    // m*x'' + c*x' + k*x = 0, m = 1, c = 0.4, k = 4.0 -> wn = 2.0, zeta = 0.1, wd = wn*sqrt(1 - zeta^2)
    // x(0) = 1.0, x'(0) = 0.0
    const deck = `
* Classic IBM System/360 CSMP Damped Spring-Mass Oscillator
TITLE DAMPED SPRING-MASS OSCILLATOR
PARAM M = 1.0, C = 0.4, K = 4.0
INCON X0 = 1.0, V0 = 0.0
DYNAMIC
SORT
  XDD = (-C * XD - K * X) / M
  XD = INTGRL(V0, XDD)
  X = INTGRL(X0, XD)
TIMER FINTIM = 10.0, DELT = 0.01, PRDEL = 0.1
METHOD RKSFX
PRINT X, XD
END
STOP
`;
    const prog = parseCsmpDeck(deck);

    const wn = 2.0;
    const zeta = 0.1;
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    const analyticalX = (t: number): number =>
      Math.exp(-zeta * wn * t) * (Math.cos(wd * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t));

    // 1. Verify RKSFX (RK4)
    const rk4Res = simulateCsmp(prog, { method: "RKSFX" });
    const exactRk4 = rk4Res.times.map(analyticalX);
    const rk4Metrics = computeMetrics(rk4Res.series["X"]!, exactRk4);
    assert.ok(
      rk4Metrics.rmse < 1e-6 && rk4Metrics.maxRelErr < 1e-5,
      `RK4 spring-mass error too high: rmse=${rk4Metrics.rmse}, relErr=${rk4Metrics.maxRelErr}`,
    );

    // 2. Verify MILNE predictor-corrector
    const milneRes = simulateCsmp(prog, { method: "MILNE" });
    const exactMilne = milneRes.times.map(analyticalX);
    const milneMetrics = computeMetrics(milneRes.series["X"]!, exactMilne);
    assert.ok(
      milneMetrics.rmse < 1e-4 && milneMetrics.maxRelErr < 5e-4,
      `Milne spring-mass error too high: rmse=${milneMetrics.rmse}, relErr=${milneMetrics.maxRelErr}`,
    );
  });

  it("Benchmark 2: Second-Order Servo Step Response via CMPXPL (vs exact analytical solution)", () => {
    // y'' + 2*zeta*wn*y' + wn^2*y = wn^2 * u(t), u(t) = 1 for t >= 0
    // zeta = 0.5, wn = 2.0 -> wd = wn*sqrt(1 - zeta^2) = sqrt(3)
    const deck = `
TITLE SECOND-ORDER SERVO STEP RESPONSE
PARAM ZETA = 0.5, WN = 2.0
DYNAMIC
SORT
  U = STEP(0.0)
  Y = CMPXPL(0.0, 0.0, ZETA, WN, WN * WN * U)
TIMER FINTIM = 6.0, DELT = 0.005, PRDEL = 0.1
METHOD RKSFX
PRINT Y
END
`;
    const prog = parseCsmpDeck(deck);
    const res = simulateCsmp(prog);

    const zeta = 0.5;
    const wn = 2.0;
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    const phi = Math.acos(zeta);
    const analyticalY = (t: number): number =>
      1.0 - (Math.exp(-zeta * wn * t) / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t + phi);

    const exact = res.times.map(analyticalY);
    const metrics = computeMetrics(res.series["Y"]!, exact);
    assert.ok(
      metrics.rmse < 1e-6 && metrics.maxRelErr < 1e-5,
      `Servo step response error too high: rmse=${metrics.rmse}, relErr=${metrics.maxRelErr}`,
    );
  });

  it("Benchmark 3: Chemical Reactor Consecutive Kinetics A -> B -> C (vs exact analytical solution)", () => {
    // dCA/dt = -k1*CA, dCB/dt = k1*CA - k2*CB, dCC/dt = k2*CB
    // CA(0) = 1.0, CB(0) = 0.0, CC(0) = 0.0, k1 = 0.8, k2 = 0.3
    const deck = `
TITLE CHEMICAL REACTOR CONSECUTIVE KINETICS
PARAM K1 = 0.8, K2 = 0.3
INCON CA0 = 1.0, CB0 = 0.0, CC0 = 0.0
DYNAMIC
SORT
  DCA = -K1 * CA
  DCB = K1 * CA - K2 * CB
  DCC = K2 * CB
  CA = INTGRL(CA0, DCA)
  CB = INTGRL(CB0, DCB)
  CC = INTGRL(CC0, DCC)
  TOTAL = CA + CB + CC
TERMINAL
  YIELD_C = CC / CA0
TIMER FINTIM = 10.0, DELT = 0.01, PRDEL = 0.2
METHOD RKSFX
PRINT CA, CB, CC, TOTAL
END
`;
    const prog = parseCsmpDeck(deck);
    const res = simulateCsmp(prog);

    const k1 = 0.8;
    const k2 = 0.3;
    const exactCA = res.times.map((t) => Math.exp(-k1 * t));
    const exactCB = res.times.map((t) => (k1 / (k2 - k1)) * (Math.exp(-k1 * t) - Math.exp(-k2 * t)));
    const exactCC = res.times.map((t, i) => 1.0 - exactCA[i]! - exactCB[i]!);

    const mA = computeMetrics(res.series["CA"]!, exactCA);
    const mB = computeMetrics(res.series["CB"]!, exactCB);
    const mC = computeMetrics(res.series["CC"]!, exactCC);

    assert.ok(mA.rmse < 1e-6 && mA.maxRelErr < 1e-5, `CA error too high: rmse=${mA.rmse}, relErr=${mA.maxRelErr}`);
    assert.ok(mB.rmse < 1e-6 && mB.maxRelErr < 1e-5, `CB error too high: rmse=${mB.rmse}, relErr=${mB.maxRelErr}`);
    assert.ok(mC.rmse < 1e-6 && mC.maxRelErr < 1e-5, `CC error too high: rmse=${mC.rmse}, relErr=${mC.maxRelErr}`);

    // Mass conservation check across entire trajectory
    for (const tot of res.series["TOTAL"]!) {
      assert.ok(Math.abs(tot - 1.0) < 1e-9, `Mass conservation violated: total=${tot}`);
    }
    assert.ok(res.terminalValues["YIELD_C"]! > 0.9, "Expected TERMINAL YIELD_C > 0.9 at t=10");
  });
});
