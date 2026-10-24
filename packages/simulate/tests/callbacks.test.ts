// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Causality,
  DAEBuilder,
  DAEPass,
  DAEPassManager,
  EqKind,
  PassContext,
  PassResult,
  VarType,
  Variability,
  initBltWasm,
} from "@modelscript/runtime";
import assert from "node:assert";
import {
  ContinuousCallback,
  DiscreteCallback,
  ManifoldProjectionCallback,
  PeriodicCallback,
  simulateArena,
} from "../src/core/index.js";

async function main() {
  console.log("=== Testing Rich Integrator Callback & Control Protocol ===");
  await initBltWasm();

  // 1. Continuous Zero-Crossing Callback with State Reinitialization
  console.log("1. Testing ContinuousCallback (Zero-Crossing + Reinit)...");
  // Model: Linear decay der(x) = -1.0, x(0) = 1.0
  // When x reaches 0.5 (falling: direction -1), reinitialize x to 2.0!
  const dae1 = new DAEBuilder();
  dae1.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
  const derX1 = dae1.derExpr("x");
  const rhs1 = dae1.lit(-1.0);
  dae1.addEquation(EqKind.Simple, derX1.id, rhs1.id);

  let rootCount = 0;
  const bounceCallback: ContinuousCallback = {
    type: "continuous",
    condition: (_t, y) => y[0]! - 0.5,
    direction: -1,
    affect: (_t, _y, controls) => {
      rootCount++;
      controls.reinit("x", 2.0);
    },
  };

  const res1 = simulateArena(dae1, {
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.05,
    solver: "rk4",
    callbacks: [bounceCallback],
  });

  assert.ok(rootCount > 0, "Continuous callback should have triggered at least once");
  const maxStateAfterMid = Math.max(...res1.y.slice(10).map((row) => row[0]!));
  assert.ok(maxStateAfterMid > 1.0, `State should have been reinitialized above 1.0 (got ${maxStateAfterMid})`);
  console.log(`  ✔ Continuous callback triggered ${rootCount} times, reinit verified.`);

  // 2. Discrete Callback with Early Termination
  console.log("2. Testing DiscreteCallback (Early Termination)...");
  const dae2 = new DAEBuilder();
  dae2.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const derY2 = dae2.derExpr("y");
  dae2.addEquation(EqKind.Simple, derY2.id, dae2.lit(1.0).id);

  let discreteTriggered = false;
  const terminateCallback: DiscreteCallback = {
    type: "discrete",
    condition: (t, _y) => t >= 0.4,
    affect: (_t, _y, controls) => {
      discreteTriggered = true;
      controls.terminate("Target reached at t=0.4");
    },
  };

  const res2 = simulateArena(dae2, {
    startTime: 0.0,
    stopTime: 5.0, // Requested 5s, but callback should terminate at ~0.4s
    step: 0.05,
    solver: "rk4",
    callbacks: [terminateCallback],
  });

  assert.strictEqual(discreteTriggered, true);
  const finalTime = res2.t[res2.t.length - 1]!;
  assert.ok(finalTime < 1.0, `Simulation should have terminated near 0.4s, got final time ${finalTime}`);
  console.log(`  ✔ Discrete callback early terminated simulation at t=${finalTime.toFixed(2)}s.`);

  // 3. Periodic Callback
  console.log("3. Testing PeriodicCallback...");
  const dae3 = new DAEBuilder();
  dae3.addVariable("counter", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const derC = dae3.derExpr("counter");
  dae3.addEquation(EqKind.Simple, derC.id, dae3.lit(0.0).id);

  let periodicFired = 0;
  const periodicCb: PeriodicCallback = {
    type: "periodic",
    interval: 0.1,
    affect: (_t, _y, controls) => {
      periodicFired++;
      controls.reinit("counter", periodicFired);
    },
  };

  const res3 = simulateArena(dae3, {
    startTime: 0.0,
    stopTime: 0.5,
    step: 0.02,
    solver: "rk4",
    callbacks: [periodicCb],
  });

  assert.ok(periodicFired >= 4, `Periodic callback should fire ~5 times (fired ${periodicFired})`);
  const finalVal = res3.y[res3.y.length - 1]![0]!;
  assert.strictEqual(finalVal, periodicFired);
  console.log(`  ✔ Periodic callback fired ${periodicFired} times across interval.`);

  // 4. Manifold Projection Callback
  console.log("4. Testing ManifoldProjectionCallback (Invariant Preservation)...");
  // Model: Free unconstrained growth
  const dae4 = new DAEBuilder();
  dae4.addVariable("q", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
  const derQ = dae4.derExpr("q");
  dae4.addEquation(EqKind.Simple, derQ.id, dae4.lit(10.0).id);

  // Invariant manifold: Clamp q <= 5.0
  const manifoldCb: ManifoldProjectionCallback = {
    type: "manifold",
    project: (_t, y) => {
      if (y[0]! > 5.0) {
        y[0] = 5.0;
      }
    },
  };

  const res4 = simulateArena(dae4, {
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.05,
    solver: "rk4",
    callbacks: [manifoldCb],
  });

  const maxQ = Math.max(...res4.y.map((row) => row[0]!));
  assert.ok(maxQ <= 5.0 + 1e-9, `Manifold projection should constrain q <= 5.0, got ${maxQ}`);
  console.log(`  ✔ Manifold projection strictly enforced invariant q <= 5.0.`);

  // 5. Custom DAEPassManager in simulateArena options
  console.log("5. Testing DAEPassManager integration into simulateArena...");
  const dae5 = new DAEBuilder();
  dae5.addVariable("z", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
  dae5.addVariable("scale", VarType.Real, Variability.Parameter, Causality.Local, 1.0);
  const derZ = dae5.derExpr("z");
  const rhsZ = dae5.varExpr("scale").mul(1.0);
  dae5.addEquation(EqKind.Simple, derZ.id, rhsZ.id);

  class ParameterScalingPass implements DAEPass {
    readonly name = "param-scaling";
    run(arena: DAEBuilder, _ctx: PassContext): PassResult {
      const p = arena.variable("scale");
      if (p) {
        p.setStart(4.0);
        return { changed: true, message: "Set scale to 4.0" };
      }
      return { changed: false };
    }
  }

  const customPm = new DAEPassManager().addPass(new ParameterScalingPass());
  const res5 = simulateArena(dae5, {
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.1,
    solver: "rk4",
    passManager: customPm,
  });

  // z(1) should be 1.0 + 4.0 * 1.0 = 5.0
  const finalZ = res5.y[res5.y.length - 1]![0]!;
  assert.ok(Math.abs(finalZ - 5.0) < 1e-2, `Expected z(1) ~ 5.0, got ${finalZ}`);
  console.log(`  ✔ Custom DAEPassManager in simulateArena successfully executed.`);

  console.log("=== All Callback Protocol tests passed successfully! ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
