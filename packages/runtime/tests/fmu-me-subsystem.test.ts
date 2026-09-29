// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  FmuSubsystemRegistry,
  ModelExchangeFmuSubsystem,
  createCoSimFromModelExchange,
} from "../src/simulation/wasm_fmu_subsystem.js";

console.log("=== Running Model Exchange Subsystem & Co-Simulation Adapter Tests ===");

// Define a second-order linear oscillator (mass-spring-damper):
// m * d2x/dt2 + c * dx/dt + k * x = u
// In state space:
// x1 = position, x2 = velocity
// dx1/dt = x2
// dx2/dt = (u - c*x2 - k*x1) / m
const m = 1.0;
const c = 0.5;
const k = 4.0;

const meSubsystem = new ModelExchangeFmuSubsystem({
  modelName: "MassSpringDamper_ME",
  stateNames: ["x1", "x2"],
  derivativeNames: ["der(x1)", "der(x2)"],
  inputNames: ["u"],
  outputNames: ["pos", "vel"],
  initialStates: [1.0, 0.0], // Initial displacement of 1.0 m, at rest
  derivativeFn: (_t, x, inputs) => {
    const u = inputs.get("u") ?? 0;
    const x1 = x[0]!;
    const x2 = x[1]!;
    const dx1 = x2;
    const dx2 = (u - c * x2 - k * x1) / m;
    return new Float64Array([dx1, dx2]);
  },
  outputFn: (_t, x, _inputs) => {
    return new Map([
      ["pos", x[0]!],
      ["vel", x[1]!],
    ]);
  },
});

// Test 1: Direct continuous evaluation (Model Exchange mode)
meSubsystem.initialize(0.0, 10.0);
assert.strictEqual(meSubsystem.numberOfContinuousStates, 2);
assert.strictEqual(meSubsystem.stateNames[0], "x1");
assert.strictEqual(meSubsystem.stateNames[1], "x2");

const initX = meSubsystem.getContinuousStates();
assert.strictEqual(initX[0], 1.0);
assert.strictEqual(initX[1], 0.0);

const initDer = meSubsystem.getContinuousStateDerivatives();
assert.strictEqual(initDer[0], 0.0); // velocity is 0
assert.strictEqual(initDer[1], -4.0); // -k * x1 = -4.0 m/s^2

const initOut = meSubsystem.getOutputs();
assert.strictEqual(initOut.get("pos"), 1.0);
assert.strictEqual(initOut.get("vel"), 0.0);

// Test continuous state updating
meSubsystem.setTime(0.5);
meSubsystem.setContinuousStates(new Float64Array([0.5, -1.0]));
const derMid = meSubsystem.getContinuousStateDerivatives();
assert.strictEqual(derMid[0], -1.0); // dx1 = x2 = -1.0
// dx2 = (-0.5 * (-1.0) - 4 * 0.5) / 1.0 = (0.5 - 2.0) = -1.5
assert.strictEqual(derMid[1], -1.5);

// Test 2: Wrapping into Co-Simulation with RK4 micro-integrator
const cosimParticipant = createCoSimFromModelExchange(meSubsystem, "rk4");
meSubsystem.setContinuousStates([1.0, 0.0]); // Reset state
cosimParticipant.initialize(0.0, 1.0, 0.01);

const dt = 0.005;
let t = 0.0;
for (let step = 0; step < 100; step++) {
  cosimParticipant.doStep(t, dt);
  t += dt;
}

const finalOutputs = cosimParticipant.getOutputs();
const finalPos = finalOutputs.get("pos") ?? 0;
const finalVel = finalOutputs.get("vel") ?? 0;

console.log(`At t=${t.toFixed(3)}s: pos=${finalPos.toFixed(4)}, vel=${finalVel.toFixed(4)}`);
// For underdamped oscillator, at t=0.5s position should oscillate into [-1, 1]
assert.ok(Math.abs(finalPos) < 1.0, "Position should be in damped oscillation range");
assert.ok(!isNaN(finalPos), "Position should be finite");
assert.ok(!isNaN(finalVel), "Velocity should be finite");

// Test 3: FmuSubsystemRegistry with Model Exchange
const registry = new FmuSubsystemRegistry();
registry.registerME("oscillator1", meSubsystem);

assert.ok(registry.hasME("oscillator1"), "Registry should have ME instance");
assert.ok(registry.has("oscillator1"), "Registry should also have auto-wrapped CoSim participant");
assert.strictEqual(registry.getME("oscillator1")?.modelName, "MassSpringDamper_ME");
assert.strictEqual(registry.get("oscillator1")?.modelName, "MassSpringDamper_ME");

console.log("✓ All Model Exchange Subsystem & Co-Simulation Adapter tests passed successfully!");
