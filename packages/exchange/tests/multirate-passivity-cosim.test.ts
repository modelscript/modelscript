// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { CouplingGraph, HermiteInterpolator, PassivityObserver, type VariableCoupling } from "../src/cosim/coupling.js";

test("Multi-Rate Hermite Polynomial Interpolation and Extrapolation", () => {
  const interp = new HermiteInterpolator();

  // 1. Single point fallback
  interp.addPoint(0.0, 10.0);
  assert.strictEqual(interp.evaluate(0.0), 10.0);
  assert.strictEqual(interp.evaluate(0.5), 10.0);

  // 2. Smooth function: y(t) = t^2 (exact derivative y'(t) = 2t)
  interp.clear();
  interp.addPoint(0.0, 0.0, 0.0);
  interp.addPoint(1.0, 1.0, 2.0);
  interp.addPoint(2.0, 4.0, 4.0);

  // Midpoint t = 0.5: Exact is 0.25
  const val05 = interp.evaluate(0.5);
  assert.ok(
    Math.abs(val05 - 0.25) < 1e-4,
    `Cubic Hermite interpolation at t=0.5 must match exact quadratic 0.25, got ${val05}`,
  );

  // Midpoint t = 1.5: Exact is 2.25
  const val15 = interp.evaluate(1.5);
  assert.ok(
    Math.abs(val15 - 2.25) < 1e-4,
    `Cubic Hermite interpolation at t=1.5 must match exact quadratic 2.25, got ${val15}`,
  );

  // 3. Extrapolation beyond last point t = 2.5:
  // Using last derivative 4.0: y(2.5) = 4.0 + 4.0 * 0.5 = 6.0
  const val25 = interp.evaluate(2.5);
  assert.ok(Math.abs(val25 - 6.0) < 1e-3, `Tangent extrapolation at t=2.5 must match 6.0, got ${val25}`);

  // 4. Boundary clamping before first point
  assert.strictEqual(interp.evaluate(-1.0), 0.0);
});

test("Energy-Preserving Passivity Observer (PO) for Cyber-Physical Interface", () => {
  const po = new PassivityObserver();

  // Case 1: Passive mechanical damper: Force F = c * v with c = 5.0 N/(m/s)
  // Power P = F * v = 5 * v^2 >= 0 (strictly dissipative / passive)
  const dt = 0.01;
  for (let k = 0; k < 100; k++) {
    const t = k * dt;
    const v = 2.0 * Math.sin(2 * Math.PI * 1.0 * t);
    const f = 5.0 * v;
    const metrics = po.step(t, f, v);

    assert.ok(metrics.isPassive, `Passive system must remain passive at t=${t}`);
    assert.strictEqual(metrics.energyInjectedJoules, 0.0);
  }

  // Case 2: Non-physical active energy generation caused by communication delay
  // e.g. Force and velocity in counter-phase: P = F * v < 0 (acting as an energy source)
  const activePo = new PassivityObserver();
  for (let k = 0; k < 50; k++) {
    const t = k * dt;
    const v = 2.0;
    const f = -10.0; // Negative power P = -20 W
    const metrics = activePo.step(t, f, v);

    if (k > 5) {
      assert.strictEqual(metrics.isPassive, false, "System with sustained negative power must become non-passive");
      assert.ok(metrics.energyInjectedJoules > 0.0, "Must measure positive injected energy");
    }
  }
});

test("CouplingGraph with Multi-Rate Hermite Interpolation & Conjugate Energy Pairs", () => {
  const graph = new CouplingGraph();

  const coupling: VariableCoupling = {
    from: { participantId: "MotorPlant", variableName: "speed", unit: "rad/s" },
    to: { participantId: "Controller", variableName: "measuredSpeed", unit: "rad/s" },
    interpolation: "HERMITE",
    conjugatePair: { effortVariable: "torque", flowVariable: "speed" },
  };

  graph.addCoupling(coupling);

  // Step 1: Slow participant updates at t = 0.0
  const outputs0 = new Map([
    [
      "MotorPlant",
      new Map<string, any>([
        ["speed", 100.0],
        ["torque", 50.0],
      ]),
    ],
  ]);
  const inputs0 = graph.applyCouplings(outputs0, 0.0);
  assert.strictEqual(inputs0.get("Controller")?.get("measuredSpeed"), 100.0);

  // Step 2: Slow participant updates at t = 0.1
  const outputs1 = new Map([
    [
      "MotorPlant",
      new Map<string, any>([
        ["speed", 110.0],
        ["torque", 45.0],
      ]),
    ],
  ]);
  graph.applyCouplings(outputs1, 0.1);

  // Step 3: Fast participant queries at intermediate multi-rate timestamp t = 0.05
  // Hermite interpolator should provide smooth midpoint ~ 105.0 rad/s
  const inputsMid = graph.applyCouplings(outputs1, 0.05);
  const midSpeed = inputsMid.get("Controller")?.get("measuredSpeed") as number;
  assert.ok(
    midSpeed > 102.0 && midSpeed < 108.0,
    `Hermite interpolation at t=0.05 should yield smooth intermediate value ~105, got ${midSpeed}`,
  );

  // Verify passivity observer tracking on conjugate pair
  const passObs = graph.getPassivityObserver("MotorPlant->Controller");
  assert.ok(passObs, "Passivity observer must be instantiated on conjugate pair");
  const metrics = passObs.step(0.1, 45.0, 110.0);
  assert.ok(metrics.isPassive);
  assert.ok(metrics.accumulatedEnergyJoules > 0);
});
