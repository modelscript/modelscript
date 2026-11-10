// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembly,
  box,
  DynamicClearanceVerifier,
  part,
  toVerification3DOverlay,
  translate,
  type DynamicTransformBinding,
  type TrajectoryStepEnclosure,
  type Verification3DOverlayPayload,
} from "@modelscript/cad";

describe("3D Formal Verification Integration Suite", () => {
  it("generates a rich Verification3DOverlayPayload consumable by Morsel, VS Code, and Artifact Viewers", () => {
    // 1. Build a moving assembly with a deliberate safety envelope violation
    const chassis = box({ width: 80, height: 20, depth: 80, name: "RobotBase" });
    const payloadArm = box({ width: 15, height: 15, depth: 15, name: "ToolFlange" });
    const initialArm = translate(payloadArm, [0, 35, 0]);

    const asm = assembly("IndustrialRobotCell", [part(chassis), part(initialArm)]);

    const trajectory: TrajectoryStepEnclosure[] = [
      {
        time: 0.0,
        states: { "joint.dispY": { lo: 0.0, hi: 0.0 } },
        nominal: { "joint.dispY": 0.0 },
      },
      {
        time: 1.5,
        // Large descent into base causing collision at t=1.5s
        states: { "joint.dispY": { lo: -22.0, hi: -18.0 } },
        nominal: { "joint.dispY": -20.0 },
      },
    ];

    const bindings: DynamicTransformBinding[] = [
      {
        partName: "ToolFlange",
        translation: { y: "joint.dispY" },
      },
    ];

    const report = DynamicClearanceVerifier.verify({
      assembly: asm,
      bindings,
      trajectory,
      defaultMinClearance: 8.0,
    });

    assert.strictEqual(report.isCertifiedSafe, false, "Must detect clearance failure");

    // 2. Convert to unified 3D verification overlay
    const overlay: Verification3DOverlayPayload = toVerification3DOverlay(report);

    // 3. Verify protocol integrity
    assert.strictEqual(overlay.version, 1);
    assert.strictEqual(overlay.verdict, "violated");
    assert.ok(overlay.counterexamples && overlay.counterexamples.length > 0);
    assert.ok(overlay.clearanceHistory && overlay.clearanceHistory.length > 0);
    assert.ok(overlay.spatialPins && overlay.spatialPins.length > 0);

    // Verify counterexample witness state
    const ce = overlay.counterexamples[0]!;
    assert.strictEqual(ce.contractId, "clearance_RobotBase_ToolFlange");
    assert.strictEqual(ce.time, 1.5);
    assert.ok(ce.actualValue < 8.0);
    assert.strictEqual(ce.focusPoint.length, 3);

    // Verify spatial pin
    const pin = overlay.spatialPins[0]!;
    assert.strictEqual(pin.severity, "error");
    assert.ok(pin.label.includes("Collision") || pin.label.includes("Clearance Breach"));

    // 4. Verify breach markers transformation for AnimationTimeline
    const breachMarkers = overlay.counterexamples.map((item) => ({
      time: item.time,
      label: `${item.metricName} violated`,
      contractId: item.contractId,
    }));
    assert.strictEqual(breachMarkers.length, 1);
    assert.strictEqual(breachMarkers[0]!.time, 1.5);
    assert.strictEqual(breachMarkers[0]!.contractId, "clearance_RobotBase_ToolFlange");
  });
});
