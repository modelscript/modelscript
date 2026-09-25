// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembly,
  box,
  DynamicClearanceVerifier,
  part,
  translate,
  type DynamicTransformBinding,
  type TrajectoryStepEnclosure,
} from "../src/index.js";

describe("CAD Reachability-Certified Dynamic Spatial Clearance Verifier", () => {
  it("should certify safe dynamic clearance when reachable envelope maintains required distance", () => {
    // Static base chassis: 100x20x100mm, origin centered
    // Bounds: X [-50, 50], Y [-10, 10], Z [-50, 50]
    const chassis = box({ width: 100, height: 20, depth: 100, name: "Chassis" });

    // Moving sensor pod: 20x20x20mm, initially placed at Y=40
    // Initial bounds: X [-10, 10], Y [30, 50], Z [-10, 10]
    // Initial distance to chassis: 30 - 10 = 20mm
    const rawSensor = box({ width: 20, height: 20, depth: 20, name: "SensorPod" });
    const initialSensor = translate(rawSensor, [0, 40, 0]);

    const asm = assembly("DroneSystem", [part(chassis), part(initialSensor)]);

    // Dynamic trajectory with small oscillation along Y in [-3, +3]mm
    // Minimum gap: 20 - 3 = 17mm
    const trajectory: TrajectoryStepEnclosure[] = [
      {
        time: 0.0,
        states: { "suspension.dispY": { lo: -1.0, hi: 1.0 } },
        nominal: { "suspension.dispY": 0.0 },
      },
      {
        time: 0.5,
        states: { "suspension.dispY": { lo: -2.0, hi: 0.5 } },
        nominal: { "suspension.dispY": -0.8 },
      },
      {
        time: 1.0,
        states: { "suspension.dispY": { lo: -3.0, hi: 2.0 } },
        nominal: { "suspension.dispY": -1.0 },
      },
    ];

    const bindings: DynamicTransformBinding[] = [
      {
        partName: "SensorPod",
        translation: { y: "suspension.dispY" },
      },
    ];

    // Verify against 10mm clearance threshold
    const report = DynamicClearanceVerifier.verify({
      assembly: asm,
      bindings,
      trajectory,
      defaultMinClearance: 10.0,
    });

    assert.strictEqual(report.isCertifiedSafe, true);
    assert.strictEqual(report.violations.length, 0);
    // Distance at t=1.0 is 20 - 3 = 17mm, margin is 17 - 10 = 7mm
    assert.strictEqual(Math.round(report.worstMargin), 7);
    assert.strictEqual(report.timeHistory.length, 3);
    assert.strictEqual(report.counterexampleAssembly, undefined);
    assert(report.summary.includes("CERTIFIED SAFE"));
  });

  it("should detect dynamic clearance violation when flowpipe approaches obstacle", () => {
    const chassis = box({ width: 100, height: 20, depth: 100, name: "Chassis" });
    const rawSensor = box({ width: 20, height: 20, depth: 20, name: "SensorPod" });
    const initialSensor = translate(rawSensor, [0, 40, 0]); // Base gap = 20mm

    const asm = assembly("DroneSystem", [part(chassis), part(initialSensor)]);

    // Disturbance drives sensor down by up to 15mm: actual gap = 20 - 15 = 5mm < 10mm required
    const trajectory: TrajectoryStepEnclosure[] = [
      {
        time: 0.0,
        states: { "suspension.dispY": { lo: -1.0, hi: 1.0 } },
      },
      {
        time: 1.5,
        states: { "suspension.dispY": { lo: -15.0, hi: 0.0 } }, // Gap becomes 5mm
      },
    ];

    const bindings: DynamicTransformBinding[] = [
      {
        partName: "SensorPod",
        translation: { y: "suspension.dispY" },
      },
    ];

    const report = DynamicClearanceVerifier.verify({
      assembly: asm,
      bindings,
      trajectory,
      defaultMinClearance: 10.0,
    });

    assert.strictEqual(report.isCertifiedSafe, false);
    assert.strictEqual(report.violations.length, 1);
    assert.strictEqual(report.violations[0]!.status, "clearance_violation");
    assert.strictEqual(report.violations[0]!.time, 1.5);
    assert.strictEqual(Math.round(report.violations[0]!.actualDistance), 5);
    assert.strictEqual(report.counterexampleAssembly !== undefined, true);
    assert(report.summary.includes("Dynamic clearance FALSIFIED"));
  });

  it("should detect dynamic collision and generate concrete witness assembly", () => {
    const chassis = box({ width: 100, height: 20, depth: 100, name: "Chassis" });
    const arm = box({ width: 20, height: 10, depth: 20, name: "DeployableArm" });
    const initialArm = translate(arm, [0, 20, 0]); // Base gap = 20 - (5 + 10) = 5mm

    const asm = assembly("CollidingSystem", [part(chassis), part(initialArm)]);

    // Aerodynamic load pushes arm downwards by up to 10mm (penetration depth = 5mm)
    const trajectory: TrajectoryStepEnclosure[] = [
      {
        time: 0.0,
        states: { dy: { lo: 0.0, hi: 0.0 } },
        nominal: { dy: 0.0 },
      },
      {
        time: 2.4,
        states: { dy: { lo: -10.0, hi: 0.0 } },
        nominal: { dy: -8.0 },
      },
    ];

    const bindings: DynamicTransformBinding[] = [
      {
        partName: "DeployableArm",
        translation: { y: "dy" },
      },
    ];

    const report = DynamicClearanceVerifier.verify({
      assembly: asm,
      bindings,
      trajectory,
      defaultMinClearance: 2.0,
    });

    assert.strictEqual(report.isCertifiedSafe, false);
    assert.strictEqual(report.violations.length, 1);
    assert.strictEqual(report.violations[0]!.status, "collision");
    assert(report.violations[0]!.actualDistance < 0, "Penetration distance must be negative");
    assert.strictEqual(report.worstCaseTime, 2.4);

    // Witness assembly must exist with the parts transformed
    assert.strictEqual(report.counterexampleAssembly !== undefined, true);
    assert.strictEqual(report.counterexampleAssembly!.parts.length, 2);
    assert(report.counterexampleAssembly!.name.includes("Counterexample_t2.40"));
  });

  it("should evaluate dynamic rotation envelope over angular intervals", () => {
    // Wall at X = 60..80, Y = -50..50, Z = -10..10
    const rawWall = box({ width: 20, height: 100, depth: 20, name: "Wall" });
    const wall = translate(rawWall, [70, 0, 0]);

    // Rotating arm: length 40, width 10, depth 10, centered at origin
    // Length extends to X = +20, -20.
    const arm = box({ width: 40, height: 10, depth: 10, name: "SwivelArm" });

    const asm = assembly("SwivelSystem", [part(wall), part(arm)]);

    // When angle = 0, arm tip is at X = 20. Wall is at X = 60. Distance = 40mm.
    // If angle rotates by up to 90 degrees, arm tip is at Y = 20, X = 0.
    // However, if arm is translated to X = 45 and rotates:
    const armBase = translate(arm, [45, 0, 0]); // arm tip at X = 65 -> overlaps wall (60)
    const asm2 = assembly("RotatingSystem", [part(wall), part(armBase)]);

    const trajectory: TrajectoryStepEnclosure[] = [
      {
        time: 0.0,
        states: { theta: { lo: 0.0, hi: 0.1 } }, // rad
        nominal: { theta: 0.05 },
      },
      {
        time: 1.0,
        states: { theta: { lo: 0.0, hi: 0.8 } }, // rad
        nominal: { theta: 0.4 },
      },
    ];

    const bindings: DynamicTransformBinding[] = [
      {
        partName: "SwivelArm",
        rotation: {
          axis: [0, 0, 1],
          angle: "theta",
        },
      },
    ];

    const report = DynamicClearanceVerifier.verify({
      assembly: asm2,
      bindings,
      trajectory,
      defaultMinClearance: 5.0,
    });

    // Arm at X = 45, tip reaches 45 + 20 = 65 > 60 => collision detected
    assert.strictEqual(report.isCertifiedSafe, false);
    assert(report.violations.some((v) => v.status === "collision"));
  });
});
