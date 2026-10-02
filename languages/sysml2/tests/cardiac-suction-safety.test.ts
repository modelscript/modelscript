// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PhysicsSafetyBridge, type FailureMode } from "../src/index.js";

describe("SysML v2 Clinical Safety & Ventricular Suction Hazard Analysis", () => {
  it("should discover multi-fault physiological cascade leading to ventricular suction collapse", () => {
    // Clinical hazard failure modes (ISO 14971 Risk Analysis)
    const failureModes: FailureMode[] = [
      {
        id: "SevereHypovolemia",
        name: "Acute Patient Blood Loss / Dehydration",
        component: "VascularSystem",
        probability: 1e-2,
      },
      {
        id: "ExcessiveSpeedCommand",
        name: "Controller Manual RPM Override",
        component: "LvadFirmware",
        probability: 5e-3,
      },
      {
        id: "LossOfBaroreflex",
        name: "Autonomic Neuropathy / Dysautonomia",
        component: "NervousSystem",
        probability: 2e-3,
      },
    ];

    // Continuous coupled physiological plant simulation (0D/3D coupled dynamics)
    // Evaluates dynamic clearance between LV apex and cannula tip
    const simulateCardiacClearance = (params: Record<string, number>) => {
      const times = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2]; // Seconds
      const baseVenousReturn = params.venousReturn ?? 5.0; // L/min (nominal 5.0)
      const bloodLoss = params.bloodLoss ?? 0.0; // Reduction in venous return
      const venousReturn = Math.max(1.0, baseVenousReturn - bloodLoss);
      const pumpRpm = params.pumpRpm ?? 5000.0; // RPM (nominal 5000)
      const antiSuctionActive = params.antiSuctionActive ?? 1.0; // Controller safety law active

      // Clearance dynamics:
      // Base cavity radius r0 = 25mm. Cannula tip at 15.5mm (nominal gap = 9.5mm)
      // High pump speed draws volume out; low venous return fails to refill.
      // Net flow balance:
      const pumpFlow = (pumpRpm / 5000.0) * 4.5; // L/min
      const netFillRate = venousReturn - pumpFlow; // Positive = fills, Negative = collapses

      const clearanceDistances = times.map((t) => {
        // If anti-suction controller is disabled or fails to catch in time, volume collapses
        const effectiveNetFill =
          antiSuctionActive > 0.5 && t > 0.6 && netFillRate < -1.0
            ? 0.2 // Controller throttles RPM, stabilizing volume
            : netFillRate;

        const volumeL = Math.max(0.015, 0.12 + effectiveNetFill * (t / 60.0)); // Chamber volume in Liters
        const radiusMm = 25.0 * Math.cbrt(volumeL / 0.12);
        const cannulaTipMm = 15.5; // Cannula tip at 15.5mm
        const clearanceMm = radiusMm - cannulaTipMm;
        return clearanceMm * 0.001; // In meters
      });

      return {
        times,
        signals: {
          "ventricle.clearance.distance": clearanceDistances,
        },
      };
    };

    // Parameter overrides per failure mode (orthogonal parameter keys to prevent clobbering):
    // - SevereHypovolemia drops venous return by 2.5 L/min
    // - ExcessiveSpeedCommand pushes pump to 7500 RPM (draws ~6.75 L/min)
    // - With antiSuctionActive = 0, both together cause catastrophic collapse below 1.5mm threshold!
    const faultInjections = {
      SevereHypovolemia: { bloodLoss: 2.5 },
      ExcessiveSpeedCommand: { pumpRpm: 7500.0, antiSuctionActive: 0.0 },
      LossOfBaroreflex: { baroFailure: 1.0 },
    };

    // ISO 14971 Safety Hazard: Inflow cannula suction occurs if clearance <= 1.5mm (0.0015 m)
    const result = PhysicsSafetyBridge.analyzePhysicsSafety({
      hazardId: "HAZ_VentricularSuction",
      hazardName: "Ventricular Wall Suction & Apical Impingement",
      severity: 5, // Catastrophic clinical hazard
      failureModes,
      faultInjections,
      baselineParams: { venousReturn: 5.0, pumpRpm: 5000.0, antiSuctionActive: 1.0 },
      simulate: simulateCardiacClearance,
      hazardCondition: {
        variable: "ventricle.clearance.distance",
        operator: "<=",
        threshold: 0.0015, // 1.5mm in meters
      },
      maxOrder: 2,
    });

    assert.strictEqual(
      result.isHazardReachable,
      true,
      "Ventricular suction hazard must be reachable under adverse combination",
    );
    assert(result.minimalCutSets.length >= 1, "Must discover minimal cut sets causing suction");

    // The combination of SevereHypovolemia + ExcessiveSpeedCommand triggers the hazard
    const hasCriticalCutSet = result.minimalCutSets.some(
      (cs) => cs.faultIds.includes("SevereHypovolemia") && cs.faultIds.includes("ExcessiveSpeedCommand"),
    );
    assert.strictEqual(hasCriticalCutSet, true, "Must isolate Hypovolemia + ExcessiveSpeed cut set");

    assert(result.physicalFailureTraces.length >= 1, "Must capture physical collapse traces");
    const trace = result.physicalFailureTraces[0]!;
    assert.strictEqual(trace.violatingVariable, "ventricle.clearance.distance");
    assert(trace.peakValue <= 0.0015, `Peak breach value must be <= 0.0015, got ${trace.peakValue}`);
    assert(result.summary.includes("Physics-informed simulation discovered"));
  });

  it("should certify safe clearance across all single-fault scenarios when anti-suction controller is active", () => {
    const failureModes: FailureMode[] = [
      { id: "MildHypovolemia", name: "Mild Dehydration", component: "Patient" },
      { id: "PosturalChange", name: "Patient Rapid Standing", component: "Patient" },
    ];

    const simulateSafeClosedLoop = (params: Record<string, number>) => {
      const times = [0, 0.5, 1.0, 1.5, 2.0];
      const venousReturn = params.venousReturn ?? 5.0;
      // Closed loop controller actively regulates speed, maintaining clearance > 3mm (0.003m)
      const clearance = times.map((t) => {
        const transientDip = t < 1.0 ? (5.0 - venousReturn) * 0.0005 : 0.0;
        return 0.008 - transientDip; // Always >= 0.005m (5mm)
      });
      return {
        times,
        signals: {
          "ventricle.clearance.distance": clearance,
        },
      };
    };

    const result = PhysicsSafetyBridge.analyzePhysicsSafety({
      hazardId: "HAZ_VentricularSuction",
      hazardName: "Ventricular Wall Suction",
      failureModes,
      faultInjections: {
        MildHypovolemia: { venousReturn: 3.5 },
        PosturalChange: { venousReturn: 3.0 },
      },
      simulate: simulateSafeClosedLoop,
      hazardCondition: {
        variable: "ventricle.clearance.distance",
        operator: "<=",
        threshold: 0.0015,
      },
    });

    assert.strictEqual(
      result.isHazardReachable,
      false,
      "Controller must certify safety under mild physiological challenges",
    );
    assert.strictEqual(result.minimalCutSets.length, 0);
    assert.strictEqual(result.physicalFailureTraces.length, 0);
    assert(result.summary.includes("0 physical violation trajectories"));
  });
});
