// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ddeSteps } from "../src/solvers/dde-solver.js";
import { tsit5InterpolateDerivative } from "../src/solvers/tsit5.js";

describe("Phase 4 Track 3: Neutral & State-Dependent Delay Differential Equations", () => {
  it("evaluates exact analytic derivative of cubic Hermite step interpolant (tsit5InterpolateDerivative)", () => {
    // Let y(t) = t^3 - 2*t^2 + t + 1 on [0, h] with h = 0.5
    // y'(t) = 3*t^2 - 4*t + 1
    const h = 0.5;
    const y0 = [1.0];
    const y1 = [h ** 3 - 2 * h ** 2 + h + 1];
    const f0 = [1.0];
    const f1 = [3 * h ** 2 - 4 * h + 1];
    const k: number[][] = [f0, [0], [0], [0], [0], [0], f1];

    for (const theta of [0.0, 0.25, 0.5, 0.75, 1.0]) {
      const t = theta * h;
      const exactDeriv = 3 * t * t - 4 * t + 1;
      const interpDeriv = tsit5InterpolateDerivative(y0, y1, k, h, theta)[0]!;
      assert.ok(
        Math.abs(interpDeriv - exactDeriv) < 1e-14,
        `theta=${theta}: got ${interpDeriv}, expected ${exactDeriv}`,
      );
    }
  });

  it("solves a smooth Neutral DDE (NDDE) with delayed derivative dy/dt(t - tau)", () => {
    // dy/dt = -y(t) + 0.5 * y(t - 1) + 0.5 * y'(t - 1), h(t) = exp(-t), t in [0, 3]
    // Exact solution: y(t) = exp(-t)
    const res = ddeSteps(
      {
        f: (_t, y, history, _p, derivHistory) => {
          const yLag = history(_t - 1.0)[0]!;
          const dyLag = derivHistory!(_t - 1.0)[0]!;
          return [-y[0]! + 0.5 * yLag + 0.5 * dyLag];
        },
        h: (t) => [Math.exp(-t)],
        hPrime: (t) => [-Math.exp(-t)],
        y0: [1.0],
        tSpan: [0.0, 3.0],
        constantDelays: [1.0],
      },
      { atol: 1e-9, rtol: 1e-9 },
    );

    assert.ok(res.stats.converged);
    const yEnd = res.states[res.states.length - 1]![0]!;
    const exactEnd = Math.exp(-3.0);
    assert.ok(Math.abs(yEnd - exactEnd) < 1e-6, `Neutral DDE y(3) = ${yEnd}, expected ${exactEnd}`);
  });

  it("solves a Neutral DDE with derivative discontinuity propagation across breaking points", () => {
    // dy/dt = -y(t - 1) - 0.5 * y'(t - 1), with h(t) = 1 + t for t <= 0, y(0) = 1
    // On [0, 1]: y(t) = 1 - 0.5*t - 0.5*t^2 => y(1) = 0
    // On [1, 2]: y(1 + s) = -0.75*s + 0.5*s^2 + (1/6)*s^3 => y(2) = -1/12
    const res = ddeSteps(
      {
        f: (t, _y, history) => {
          const yLag = history(t - 1.0)[0]!;
          const dyLag = history.derivative(t - 1.0)[0]!;
          return [-yLag - 0.5 * dyLag];
        },
        h: (t) => [1.0 + t],
        // Omit hPrime to also test automatic finite-difference initial derivative fallback
        y0: [1.0],
        tSpan: [0.0, 2.0],
        constantDelays: [1.0],
      },
      { atol: 1e-9, rtol: 1e-9 },
    );

    assert.ok(res.stats.converged);
    const yFinal = res.states[res.states.length - 1]![0]!;
    const expectedY2 = -1.0 / 12.0;
    assert.ok(Math.abs(yFinal - expectedY2) < 1e-6, `NDDE y(2) = ${yFinal}, expected ${expectedY2}`);
  });

  it("tracks state-dependent delay breaking-point crossing and matches closed-form solution", () => {
    // dy/dt = -y(t - tau(t, y)), where tau(t, y) = 0.5 + 0.25 * y(t)
    // History: h(t) = 1 for t <= 0, y(0) = 1
    // Pre-crossing (t in [0, 0.6]): y(t) = 1 - t
    // Crossing time t* where t* - (0.5 + 0.25*(1 - t*)) = 0 => 1.25 * t* = 0.75 => t* = 0.6
    // Post-crossing (t in [0.6, 1.0]): y(t) = 4*t - 22 + 20 * exp(-0.25 * (t - 0.6))
    const tauFn = (_t: number, y: number[]) => 0.5 + 0.25 * y[0]!;
    const res = ddeSteps(
      {
        f: (t, y, history) => {
          const tau = tauFn(t, y);
          return [-history(t - tau)[0]!];
        },
        h: () => [1.0],
        y0: [1.0],
        tSpan: [0.0, 1.0],
        stateDependentDelays: [tauFn],
      },
      { atol: 1e-9, rtol: 1e-9, maxStep: 0.15 },
    );

    assert.ok(res.stats.converged);
    assert.ok(res.breakingPoints && res.breakingPoints.length >= 2);
    const detectedBreakingPoint = res.breakingPoints!.find((bp) => Math.abs(bp - 0.6) < 1e-5);
    assert.ok(
      detectedBreakingPoint !== undefined,
      `Expected state-dependent breaking point near 0.6, got ${JSON.stringify(res.breakingPoints)}`,
    );

    const y1 = res.states[res.states.length - 1]![0]!;
    const exactY1 = 4.0 * 1.0 - 22.0 + 20.0 * Math.exp(-0.25 * (1.0 - 0.6));
    assert.ok(Math.abs(y1 - exactY1) < 1e-6, `State-dependent DDE y(1.0) = ${y1}, expected ${exactY1}`);
  });
});
