// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runUsdBenchmark } from "./usd-benchmark-runner.js";

test("OpenUSD Benchmark 44 — Pixar 3D Robotic Articulated Arm & UsdPhysics Kinematics", () => {
  const metrics = runUsdBenchmark();

  assert.strictEqual(metrics.defaultPrim, "IndustrialRobot");
  assert.strictEqual(metrics.upAxis, "Z");
  assert.strictEqual(metrics.metersPerUnit, 1.0);
  assert.ok(metrics.primCount >= 5);
  assert.strictEqual(metrics.rigidBodyCount, 2);
  assert.strictEqual(metrics.jointCount, 1);
  assert.strictEqual(metrics.jointAxis, "Z");
  assert.strictEqual(metrics.totalMassKg, 17.0);
  assert.strictEqual(metrics.diagnosticsCount, 0);

  // DAE Arena (1 joint * 3 vars + 2 bodies * 6 vars = 15 vars; 1*2 + 2*6 = 14 eqs)
  assert.strictEqual(metrics.daeVarCount, 15);
  assert.strictEqual(metrics.daeEqCount, 14);
  assert.strictEqual(metrics.isMechanicallyBalanced, true);
});
