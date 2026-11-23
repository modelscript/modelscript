// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simulateAcsl } from "../src/solver/index.js";

function computeMetrics(simulated: number[], reference: number[]): { rmse: number; maxRelErr: number } {
  assert.strictEqual(simulated.length, reference.length);
  let sumSq = 0;
  let maxRelErr = 0;
  for (let i = 0; i < simulated.length; i++) {
    const err = Math.abs(simulated[i]! - reference[i]!);
    sumSq += err * err;
    const denom = Math.max(1e-6, Math.abs(reference[i]!));
    const rel = err / denom;
    if (rel > maxRelErr) maxRelErr = rel;
  }
  return {
    rmse: Math.sqrt(sumSq / Math.max(1, simulated.length)),
    maxRelErr,
  };
}

describe("ACSL Analytical ODE & Hybrid Simulation Benchmarks", () => {
  it("matches exact analytical solution for first-order exponential decay (RK4 & RK45)", () => {
    const src = `
PROGRAM EXP_DECAY
  INITIAL
    CONSTANT k = 0.7, x0 = 5.0
    CINTERVAL cint = 0.1
    MAXTERVAL maxt = 0.01
  END
  DYNAMIC
    DERIVATIVE
      x = INTEG(xdot, x0)
      xdot = -k * x
    END
    TERMT(t .GE. 4.0)
  END
END
`;
    for (const method of ["rk4", "rk45"] as const) {
      const res = simulateAcsl(src, { tEnd: 4.0, method });
      const ref = res.times.map((t) => 5.0 * Math.exp(-0.7 * t));
      const { rmse, maxRelErr } = computeMetrics(res.series["x"]!, ref);
      assert.ok(rmse < 1e-6, `[${method}] Exponential decay RMSE too high: ${rmse}`);
      assert.ok(maxRelErr < 1e-5, `[${method}] Exponential decay maxRelErr too high: ${maxRelErr}`);
    }
  });

  it("matches exact analytical solution for undamped harmonic oscillator (x'' + w^2 x = 0)", () => {
    const w = 2.5;
    const src = `
PROGRAM HARMONIC_OSC
  INITIAL
    CONSTANT w = 2.5, x0 = 1.0, v0 = 0.0
    CINTERVAL cint = 0.05
    MAXTERVAL maxt = 0.005
  END
  DYNAMIC
    DERIVATIVE
      a = -w**2 * x
      v = INTEG(a, v0)
      x = INTEG(v, x0)
    END
    TERMT(t .GE. 6.0)
  END
END
`;
    const res = simulateAcsl(src, { tEnd: 6.0, method: "rk4" });
    const refX = res.times.map((t) => Math.cos(w * t));
    const refV = res.times.map((t) => -w * Math.sin(w * t));

    const metricsX = computeMetrics(res.series["x"]!, refX);
    const metricsV = computeMetrics(res.series["v"]!, refV);
    assert.ok(metricsX.rmse < 1e-5, `Harmonic oscillator x RMSE: ${metricsX.rmse}`);
    assert.ok(metricsV.rmse < 1e-5, `Harmonic oscillator v RMSE: ${metricsV.rmse}`);
  });

  it("achieves tight RK4 vs adaptive RK45 parity on nonlinear Van der Pol oscillator (mu = 1.0)", () => {
    const src = `
PROGRAM VAN_DER_POL
  INITIAL
    CONSTANT mu = 1.0
    CINTERVAL cint = 0.1
    MAXTERVAL maxt = 0.005
  END
  DYNAMIC
    DERIVATIVE
      ydot = mu * (1.0 - x**2) * y - x
      x = INTEG(y, 2.0)
      y = INTEG(ydot, 0.0)
    END
    TERMT(t .GE. 10.0)
  END
END
`;
    const rk4 = simulateAcsl(src, { tEnd: 10.0, method: "rk4", cinterval: 0.1, maxterval: 0.002 });
    const rk45 = simulateAcsl(src, {
      tEnd: 10.0,
      method: "rk45",
      cinterval: 0.1,
      maxterval: 0.05,
      rtol: 1e-8,
      atol: 1e-10,
    });

    assert.strictEqual(rk4.times.length, rk45.times.length);
    const { rmse, maxRelErr } = computeMetrics(rk4.series["x"]!, rk45.series["x"]!);
    assert.ok(rmse < 1e-4, `Van der Pol RK4 vs RK45 RMSE: ${rmse}`);
    assert.ok(maxRelErr < 1e-3, `Van der Pol RK4 vs RK45 maxRelErr: ${maxRelErr}`);

    // Verify limit cycle amplitude approaches ~2.0
    const peak = Math.max(...rk45.series["x"]!.slice(Math.floor(rk45.series["x"]!.length / 2)).map(Math.abs));
    assert.ok(peak > 1.9 && peak < 2.1, `Expected Van der Pol limit cycle peak ~2.0, got ${peak}`);
  });

  it("matches exact bi-exponential analytical solution for PBPK 2-compartment pharmacokinetic model", () => {
    // 2-compartment IV bolus PBPK model:
    //   dA1/dt = -(k10 + k12)*A1 + k21*A2,  A1(0) = D0 = 100 mg
    //   dA2/dt = k12*A1 - k21*A2,           A2(0) = 0 mg
    const k10 = 0.25;
    const k12 = 0.4;
    const k21 = 0.15;
    const D0 = 100.0;

    // Eigenvalues alpha, beta of characteristic polynomial s^2 + (k10+k12+k21)s + k10*k21 = 0
    const sum = k10 + k12 + k21;
    const prod = k10 * k21;
    const disc = Math.sqrt(sum * sum - 4 * prod);
    const alpha = 0.5 * (sum + disc);
    const beta = 0.5 * (sum - disc);
    const A = (D0 * (alpha - k21)) / (alpha - beta);
    const B = (D0 * (k21 - beta)) / (alpha - beta);

    const src = `
PROGRAM PBPK_2COMP
  ! Two-compartment pharmacokinetic model (IV bolus)
  INITIAL
    CONSTANT k10 = 0.25, k12 = 0.4, k21 = 0.15, D0 = 100.0
    CINTERVAL cint = 0.2
    MAXTERVAL maxt = 0.01
  END
  DYNAMIC
    DERIVATIVE
      dA1 = -(k10 + k12) * A1 + k21 * A2
      dA2 = k12 * A1 - k21 * A2
      A1 = INTEG(dA1, D0)
      A2 = INTEG(dA2, 0.0)
    END
    TERMT(t .GE. 12.0)
  END
END
`;
    const res = simulateAcsl(src, { tEnd: 12.0, method: "rk45" });
    const refA1 = res.times.map((t) => A * Math.exp(-alpha * t) + B * Math.exp(-beta * t));
    const refA2 = res.times.map((t) => ((D0 * k12) / (alpha - beta)) * (Math.exp(-beta * t) - Math.exp(-alpha * t)));

    const m1 = computeMetrics(res.series["A1"]!, refA1);
    const m2 = computeMetrics(res.series["A2"]!, refA2);
    assert.ok(m1.rmse < 1e-5, `PBPK A1 RMSE: ${m1.rmse}`);
    assert.ok(m1.maxRelErr < 1e-4, `PBPK A1 maxRelErr: ${m1.maxRelErr}`);
    assert.ok(m2.rmse < 1e-5, `PBPK A2 RMSE: ${m2.rmse}`);
  });

  it("simulates hybrid DISCRETE events, SCHEDULE triggers, TERMT stopping, and TERMINAL post-processing", () => {
    const src = `
PROGRAM HYBRID_BOUNCE
  INITIAL
    CONSTANT k = 1.0
    hits = 0.0
    CINTERVAL cint = 0.05
    MAXTERVAL maxt = 0.01
  END
  DYNAMIC
    DERIVATIVE
      x = INTEG(1.0, 0.0)
      SCHEDULE bump .AT. 1.0
    END
    DISCRETE bump
      hits = hits + 1.0
    END
    TERMT(x .GE. 2.5)
  END
  TERMINAL
    score = x + hits
  END
END
`;
    const res = simulateAcsl(src, { tEnd: 10.0, method: "rk4" });
    assert.strictEqual(res.terminatedByTermt, true);
    assert.strictEqual(res.eventsFired, 1);
    assert.ok(Math.abs((res.terminalValues["score"] ?? 0) - 3.5) < 0.05);
  });
});
