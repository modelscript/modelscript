// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simulateTwentySim } from "../src/solver/index.js";

describe("20-sim Numerical Simulation Benchmarks & Analytical Tolerance Checks", () => {
  it("matches exact closed-form underdamped Mass-Spring-Damper step response within tolerance < 1e-4", () => {
    // m*x'' + b*x' + (1/C)*x = F with m=1, b=1, C=0.5 (k=2), F=2
    const msdSid = `
model MassSpringDamperBenchmark
  submodels
    Se F (effort = 2.0);
    OneJunction j1;
    I m (i = 1.0, p0 = 0.0);
    R b (r = 1.0);
    C k (c = 0.5, q0 = 0.0);
  connections
    F.p => j1.p;
    j1.p => m.p;
    j1.p => b.p;
    j1.p => k.p;
end MassSpringDamperBenchmark;
`;
    const res = simulateTwentySim(msdSid, { startTime: 0, finishTime: 5.0, stepSize: 0.01 });
    const qTraj = res.variables["k_q"];
    assert.ok(qTraj && qTraj.length === res.times.length);

    const alpha = 0.5;
    const wd = Math.sqrt(1.75);
    let maxErr = 0;

    for (let i = 0; i < res.times.length; i++) {
      const t = res.times[i]!;
      const exact = 1.0 - Math.exp(-alpha * t) * (Math.cos(wd * t) + (alpha / wd) * Math.sin(wd * t));
      const err = Math.abs(qTraj[i]! - exact);
      if (err > maxErr) maxErr = err;
    }

    assert.ok(maxErr < 1e-4, `Expected max displacement error < 1e-4, got ${maxErr}`);
    assert.ok(res.maxPowerResidual < 1e-12, `Expected junction power residual < 1e-12, got ${res.maxPowerResidual}`);
  });

  it("matches exact parallel RC Bond Graph exponential charging response on a 0-junction", () => {
    // C*dV/dt + V/R = Is => q(t) = Is*R*C * (1 - exp(-t/(R*C)))
    // With Is = 2, R = 5, C = 0.2 => tau = 1.0, q_inf = 2.0
    const rcSid = `
model ParallelRC
  submodels
    Sf Is (flow = 2.0);
    ZeroJunction j0;
    R R1 (r = 5.0);
    C C1 (c = 0.2, q0 = 0.0);
  connections
    Is.p => j0.p;
    j0.p => R1.p;
    j0.p => C1.p;
end ParallelRC;
`;
    const res = simulateTwentySim(rcSid, { startTime: 0, finishTime: 3.0, stepSize: 0.01 });
    const qTraj = res.variables["C1_q"]!;
    let maxErr = 0;
    for (let i = 0; i < res.times.length; i++) {
      const t = res.times[i]!;
      const exact = 2.0 * (1.0 - Math.exp(-t));
      maxErr = Math.max(maxErr, Math.abs(qTraj[i]! - exact));
    }

    assert.ok(maxErr < 1e-5, `Expected max charge error < 1e-5, got ${maxErr}`);
    assert.ok(res.maxPowerResidual < 1e-12, `Expected 0-junction power residual < 1e-12, got ${res.maxPowerResidual}`);
  });

  it("conserves power across Transformer (TF) and Gyrator (GY) two-port elements", () => {
    const tfGySid = `
model ElectroMechanicalDrive
  submodels
    Se V (effort = 12.0);
    GY motor (r = 0.5);
    TF gear (r = 3.0);
    R load (r = 2.0);
  connections
    V.p => motor.p1;
    motor.p2 => gear.p1;
    gear.p2 => load.p;
end ElectroMechanicalDrive;
`;
    const res = simulateTwentySim(tfGySid, { startTime: 0, finishTime: 1.0, stepSize: 0.1 });
    assert.ok(res.maxPowerResidual < 1e-12, `Expected TF/GY power residual < 1e-12, got ${res.maxPowerResidual}`);
  });

  it("simulates standalone SIDOPS exponential decay against exact analytical solution", () => {
    const sid = `
model Decay
  parameters
    real tau = 0.5;
  variables
    real x = 1.0;
  equations
    x = int(-x / tau, 1.0);
end Decay;
`;
    const res = simulateTwentySim(sid, { startTime: 0, finishTime: 2.0, stepSize: 0.01 });
    const xTraj = res.variables["x"]!;
    let maxErr = 0;
    for (let i = 0; i < res.times.length; i++) {
      const t = res.times[i]!;
      const exact = Math.exp(-2.0 * t);
      maxErr = Math.max(maxErr, Math.abs(xTraj[i]! - exact));
    }
    assert.ok(maxErr < 1e-5, `Expected max SIDOPS error < 1e-5, got ${maxErr}`);
  });
});
