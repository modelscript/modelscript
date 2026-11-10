// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembly,
  box,
  DynamicClearanceVerifier,
  part,
  spatialOracleToVerification3DOverlay,
  toVerification3DOverlay,
  translate,
  type DynamicTransformBinding,
  type TrajectoryStepEnclosure,
} from "../src/index.js";

describe("Verification 3D Visual Protocol & Adapters", () => {
  it("converts a DynamicClearanceReport into a Verification3DOverlayPayload with vectors and counterexamples", () => {
    const chassis = box({ width: 100, height: 20, depth: 100, name: "Base" });
    const rawSensor = box({ width: 20, height: 20, depth: 20, name: "Arm" });
    const initialSensor = translate(rawSensor, [0, 40, 0]);

    const asm = assembly("TestSystem", [part(chassis), part(initialSensor)]);

    const trajectory: TrajectoryStepEnclosure[] = [
      {
        time: 0.0,
        states: { "pos.y": { lo: 0.0, hi: 0.0 } },
        nominal: { "pos.y": 0.0 },
      },
      {
        time: 1.0,
        // Large downward displacement causing clearance breach:
        // Initial sensor at Y=[30, 50], displacement -25 => Y=[5, 25], base at Y=[-10, 10]
        // Overlap: collision!
        states: { "pos.y": { lo: -25.0, hi: -20.0 } },
        nominal: { "pos.y": -22.5 },
      },
    ];

    const bindings: DynamicTransformBinding[] = [
      {
        partName: "Arm",
        translation: { y: "pos.y" },
      },
    ];

    const report = DynamicClearanceVerifier.verify({
      assembly: asm,
      bindings,
      trajectory,
      defaultMinClearance: 10.0,
    });

    assert.strictEqual(report.isCertifiedSafe, false, "Verification must detect clearance failure");

    // Convert to 3D visual overlay
    const overlay = toVerification3DOverlay(report);

    assert.strictEqual(overlay.version, 1);
    assert.strictEqual(overlay.isCertifiedSafe, false);
    assert.strictEqual(overlay.verdict, "violated");
    assert.ok(overlay.clearanceHistory && overlay.clearanceHistory.length > 0, "Clearance history should be populated");
    assert.ok(overlay.counterexamples && overlay.counterexamples.length > 0, "Counterexamples should be populated");
    assert.ok(overlay.spatialPins && overlay.spatialPins.length > 0, "Spatial pins should be populated");

    const ce = overlay.counterexamples[0]!;
    assert.strictEqual(ce.contractId, "clearance_Base_Arm");
    assert.ok(ce.focusPoint.length === 3, "Focus point must be 3D vector");

    const pin = overlay.spatialPins[0]!;
    assert.strictEqual(pin.severity, "error");
    assert.ok(pin.label.includes("Collision") || pin.label.includes("Clearance Breach"));
  });

  it("converts SpatialPhysicsOracle integrity reports into 3D spatial pins and stress witnesses", () => {
    const status = {
      stresses: {
        Bracket: {
          maxVonMisesPa: 320e6,
          allowableYieldStressPa: 250e6,
          marginOfSafety: -0.218,
          status: "UNSAT" as const,
        },
      },
      deflections: {
        Arm: {
          maxDisplacementMeters: 0.015,
          allowableDisplacementMeters: 0.008,
          status: "UNSAT" as const,
        },
      },
      solids: {
        Impeller: {
          isWatertight: false,
          volumeM3: 0.002,
          status: "UNSAT" as const,
        },
      },
    };

    const positions: Record<string, [number, number, number]> = {
      Bracket: [0.1, 0.2, 0.3],
      Arm: [0.4, 0.5, 0.6],
      Impeller: [0.7, 0.8, 0.9],
    };

    const overlay = spatialOracleToVerification3DOverlay(status, positions);

    assert.strictEqual(overlay.isCertifiedSafe, false);
    assert.strictEqual(overlay.verdict, "violated");
    assert.strictEqual(overlay.counterexamples?.length, 2); // 1 stress + 1 deflection
    assert.strictEqual(overlay.spatialPins?.length, 3); // 1 stress + 1 deflection + 1 non-watertight

    const stressPin = overlay.spatialPins?.find((p) => p.contractId === "yield_stress_Bracket");
    assert.ok(stressPin);
    assert.deepStrictEqual(stressPin.position, [0.1, 0.2, 0.3]);
    assert.ok(stressPin.label.includes("Yield Exceeded"));

    const solidPin = overlay.spatialPins?.find((p) => p.contractId === "watertight_Impeller");
    assert.ok(solidPin);
    assert.strictEqual(solidPin.severity, "warning");
    assert.ok(solidPin.label.includes("Non-watertight"));
  });
});
