// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simulateEsl } from "../src/index.js";

function relErr(actual: number, expected: number): number {
  const denom = Math.max(1e-12, Math.abs(expected));
  return Math.abs(actual - expected) / denom;
}

function rmse(actual: number[], expected: number[]): number {
  assert.strictEqual(actual.length, expected.length);
  let sumSq = 0;
  for (let i = 0; i < actual.length; i++) {
    const d = actual[i]! - expected[i]!;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / Math.max(1, actual.length));
}

describe("@modelscript/esl Aerospace & Hybrid Simulation Benchmarks", () => {
  it("Benchmark 1: Spacecraft Attitude Bang-Bang Control (phase-plane convergence & analytical acceleration)", () => {
    const src = `
-- ESA AOCS 1-Axis Spacecraft Bang-Bang Thruster Attitude Control
MODEL SpacecraftBangBang
  CONSTANT REAL: I_sc = 100.0;
  CONSTANT REAL: u_max = 10.0;
  CONSTANT REAL: kd = 2.0;
  CONSTANT REAL: deadband = 0.005;
  REAL: theta, omega, s, torque;
INITIAL
  theta = 0.5;
  omega = 0.0;
DYNAMIC
  s = theta + kd * omega;
  IF s > deadband THEN
    torque = -u_max;
  ELSE
    IF s < -deadband THEN
      torque = u_max;
    ELSE
      torque = 0.0;
    END_IF
  END_IF
  theta' = omega;
  omega' = torque / I_sc;
END MODEL SpacecraftBangBang
`;

    const res = simulateEsl(src, { tStart: 0.0, tEnd: 20.0, dt: 0.01 });
    assert.ok(res.times.length > 100);

    // 1. Verify initial bang-bang acceleration phase (0 <= t <= 1.0s) against analytical parabola:
    //    theta(t) = 0.5 - 0.5 * (u_max / I_sc) * t^2
    const actualEarly: number[] = [];
    const expectedEarly: number[] = [];
    for (let i = 0; i < res.times.length; i++) {
      const t = res.times[i]!;
      if (t <= 1.0) {
        actualEarly.push(res.trajectories["theta"]![i]!);
        expectedEarly.push(0.5 - 0.5 * (10.0 / 100.0) * t * t);
      }
    }
    const earlyRmse = rmse(actualEarly, expectedEarly);
    assert.ok(earlyRmse < 1e-6, `Expected early bang-bang phase RMSE < 1e-6, got ${earlyRmse}`);

    // 2. Verify attitude converges tightly inside the deadband by t = 20s
    const finalTheta = res.finalValues["theta"]!;
    const finalOmega = res.finalValues["omega"]!;
    assert.ok(Math.abs(finalTheta) < 0.02, `Expected |theta(20)| < 0.02 rad, got ${finalTheta}`);
    assert.ok(Math.abs(finalOmega) < 0.02, `Expected |omega(20)| < 0.02 rad/s, got ${finalOmega}`);
  });

  it("Benchmark 2: Keplerian 2-Body Orbital Mechanics (energy & trajectory conservation)", () => {
    const mu = 3.986004418e14;
    const r0 = 7000e3; // 7000 km circular LEO
    const v0 = Math.sqrt(mu / r0);
    const omega = Math.sqrt(mu / (r0 * r0 * r0));
    const period = (2.0 * Math.PI) / omega;
    const eps0 = 0.5 * v0 * v0 - mu / r0;

    const src = `
-- ESA ESOC 2-Body Keplerian Circular Orbit Benchmark
MODEL KeplerOrbit
  CONSTANT REAL: mu = 3.986004418e14;
  REAL: x, y, vx, vy, r, r3, eps;
INITIAL
  x = ${r0};
  y = 0.0;
  vx = 0.0;
  vy = ${v0};
DYNAMIC
  r = SQRT(x * x + y * y);
  r3 = r * r * r;
  eps = 0.5 * (vx * vx + vy * vy) - mu / r;
  x' = vx;
  y' = vy;
  vx' = -mu * x / r3;
  vy' = -mu * y / r3;
END MODEL KeplerOrbit
`;

    const res = simulateEsl(src, { tStart: 0.0, tEnd: period, dt: 2.0 });
    const xs = res.trajectories["x"]!;
    const ys = res.trajectories["y"]!;
    const vxs = res.trajectories["vx"]!;
    const vys = res.trajectories["vy"]!;

    let maxEnergyRelErr = 0;
    let maxRadiusRelErr = 0;
    const energyActual: number[] = [];
    const energyExpected: number[] = [];
    const xNormActual: number[] = [];
    const xNormExpected: number[] = [];

    for (let i = 0; i < res.times.length; i++) {
      const t = res.times[i]!;
      const x = xs[i]!;
      const y = ys[i]!;
      const vx = vxs[i]!;
      const vy = vys[i]!;
      const r = Math.hypot(x, y);
      const eps = 0.5 * (vx * vx + vy * vy) - mu / r;

      const eErr = relErr(eps, eps0);
      if (eErr > maxEnergyRelErr) maxEnergyRelErr = eErr;

      const rErr = relErr(r, r0);
      if (rErr > maxRadiusRelErr) maxRadiusRelErr = rErr;

      energyActual.push(eps / Math.abs(eps0));
      energyExpected.push(-1.0);

      xNormActual.push(x / r0);
      xNormExpected.push(Math.cos(omega * t));
    }

    const energyRmse = rmse(energyActual, energyExpected);
    const orbitRmse = rmse(xNormActual, xNormExpected);

    assert.ok(maxEnergyRelErr < 1e-6, `Expected orbital energy max relErr < 1e-6, got ${maxEnergyRelErr}`);
    assert.ok(energyRmse < 1e-6, `Expected normalized energy RMSE < 1e-6, got ${energyRmse}`);
    assert.ok(maxRadiusRelErr < 1e-6, `Expected circular radius max relErr < 1e-6, got ${maxRadiusRelErr}`);
    assert.ok(orbitRmse < 1e-5, `Expected normalized circular trajectory RMSE < 1e-5, got ${orbitRmse}`);
  });

  it("Benchmark 3: Bouncing Ball WHEN Discontinuity (exact impact times & analytical trajectory)", () => {
    const g = 9.81;
    const h0 = 10.0;
    const e = 0.8;

    const src = `
-- Hybrid Bouncing Ball with ESL WHEN zero-crossing discontinuity
MODEL BouncingBall
  CONSTANT REAL: g = 9.81;
  CONSTANT REAL: e = 0.8;
  REAL: h, v;
INITIAL
  h = 10.0;
  v = 0.0;
DYNAMIC
  h' = v;
  v' = -g;
  WHEN h <= 0.0 AND v < 0.0 THEN
    v := -e * v;
    h := 0.0;
  END_WHEN
END MODEL BouncingBall
`;

    const res = simulateEsl(src, { tStart: 0.0, tEnd: 6.0, dt: 0.01 });

    // Analytical impact times:
    // t1 = sqrt(2*h0/g), t2 = t1*(1 + 2*e), t3 = t1*(1 + 2*e + 2*e^2)
    const t1 = Math.sqrt((2.0 * h0) / g);
    const t2 = t1 * (1.0 + 2.0 * e);
    const t3 = t1 * (1.0 + 2.0 * e + 2.0 * e * e);

    assert.ok(res.events.length >= 3, `Expected at least 3 bounce events in [0, 6]s, got ${res.events.length}`);
    assert.ok(relErr(res.events[0]!.time, t1) < 1e-6, `1st bounce time relErr=${relErr(res.events[0]!.time, t1)}`);
    assert.ok(relErr(res.events[1]!.time, t2) < 1e-6, `2nd bounce time relErr=${relErr(res.events[1]!.time, t2)}`);
    assert.ok(relErr(res.events[2]!.time, t3) < 1e-6, `3rd bounce time relErr=${relErr(res.events[2]!.time, t3)}`);

    // Analytical rebound velocity after first bounce: v1+ = e * sqrt(2*g*h0)
    const v1Expected = e * Math.sqrt(2.0 * g * h0);
    const v1Actual = res.events[0]!.stateAfter["v"]!;
    assert.ok(relErr(v1Actual, v1Expected) < 1e-6, `1st rebound velocity relErr=${relErr(v1Actual, v1Expected)}`);

    // Check first rebound apex height h1 = e^2 * h0
    let maxHBetween1And2 = 0;
    const hActual: number[] = [];
    const hExpected: number[] = [];
    for (let i = 0; i < res.times.length; i++) {
      const t = res.times[i]!;
      const h = res.trajectories["h"]![i]!;
      if (t > t1 && t < t2) {
        if (h > maxHBetween1And2) maxHBetween1And2 = h;
      }
      if (t <= t2 - 1e-4) {
        const expected = t <= t1 ? h0 - 0.5 * g * t * t : v1Expected * (t - t1) - 0.5 * g * (t - t1) * (t - t1);
        hActual.push(h);
        hExpected.push(Math.max(0, expected));
      }
    }

    const h1Expected = e * e * h0;
    assert.ok(
      relErr(maxHBetween1And2, h1Expected) < 5e-4,
      `Apex height relErr=${relErr(maxHBetween1And2, h1Expected)}`,
    );

    const trajRmse = rmse(hActual, hExpected);
    assert.ok(trajRmse < 1e-4, `Expected bouncing ball trajectory RMSE < 1e-4, got ${trajRmse}`);
  });
});
