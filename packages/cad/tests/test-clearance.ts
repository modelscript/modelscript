// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { assembly, box, part, translate, verifyAssemblyClearance } from "../src/index.js";

console.log("=== Testing CAD 3D Spatial Clearance and Interference Verifier ===");

{
  // Part 1: Chassis base at origin [width: 100, height: 10, depth: 100] -> X: [-50, 50], Y: [-5, 5], Z: [-50, 50]
  const chassis = box({ width: 100, height: 10, depth: 100, name: "Chassis" });

  // Part 2: Battery box [width: 40, height: 20, depth: 40]
  const rawBattery = box({ width: 40, height: 20, depth: 40, name: "Battery" });

  // 1. Safe clearance placement:
  // Move battery above chassis by Y = 5 (half chassis) + 15 (clearance) + 10 (half battery) = 30
  // Gap along Y: 30 - 10 = 20 (min Y) - 5 (max Y of chassis) = 15
  const safeBattery = translate(rawBattery, [0, 30, 0]);
  const safeAssembly = assembly("SafeDroneAssembly", [part(chassis), part(safeBattery)]);

  const report1 = verifyAssemblyClearance(safeAssembly, 10.0);
  assert.strictEqual(report1.isCompliant, true, "Assembly with 15mm clearance should pass 10mm threshold");
  assert.strictEqual(report1.violations.length, 0);
  assert.strictEqual(Math.round(report1.pairEvaluations[0].distance), 15);
  console.log("  ✓ Safe clearance test passed (distance: 15.0)");

  // 2. Clearance violation:
  // Required clearance is 20mm, but actual is 15mm
  const report2 = verifyAssemblyClearance(safeAssembly, 20.0);
  assert.strictEqual(report2.isCompliant, false, "Should fail when actual clearance (15mm) < required (20mm)");
  assert.strictEqual(report2.violations.length, 1);
  assert.strictEqual(report2.violations[0].status, "clearance_violation");
  console.log("  ✓ Clearance violation detected correctly:", report2.violations[0].description);

  // 3. Collision / Interference:
  // Move battery down into the chassis: Y = 5 (overlapping by 10mm)
  const collidingBattery = translate(rawBattery, [0, 5, 0]);
  const collidingAssembly = assembly("CollidingAssembly", [part(chassis), part(collidingBattery)]);

  const report3 = verifyAssemblyClearance(collidingAssembly, 5.0);
  assert.strictEqual(report3.isCompliant, false, "Assembly with collision must fail");
  assert.strictEqual(report3.violations.length, 1);
  assert.strictEqual(report3.violations[0].status, "collision");
  assert(report3.violations[0].actualDistance < 0, "Penetration depth must be negative");
  console.log("  ✓ Collision detected correctly:", report3.violations[0].description);
}

console.log("All CAD Spatial Clearance tests passed successfully!");
