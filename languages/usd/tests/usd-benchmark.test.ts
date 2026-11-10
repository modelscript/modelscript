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

  // DAE Arena
  assert.strictEqual(metrics.daeVarCount, 9);
  assert.strictEqual(metrics.daeEqCount, 8);
  assert.strictEqual(metrics.isMechanicallyBalanced, true);
});
