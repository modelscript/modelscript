// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateNadalLimit,
  createHomologationReportFromTrajectory,
  evaluateEn14363Trajectory,
  exportHomologationHtml,
  type En14363TrajectoryInput,
} from "../src/index.js";

describe("EN 14363 / UIC 518 Trajectory-Level Running Safety & Homologation", () => {
  it("should calculate correct analytical Nadal limit based on flange angle and friction", () => {
    // 70 deg flange, mu=0.36 -> tan(70)=2.747, (2.747 - 0.36) / (1 + 0.36*2.747) = 2.387 / 1.989 = 1.20 (clamped)
    const nadal70 = calculateNadalLimit(70.0, 0.36);
    assert.ok(nadal70 >= 0.8 && nadal70 <= 1.2);

    // 60 deg flange, mu=0.36 -> tan(60)=1.732, (1.732 - 0.36) / (1 + 0.36*1.732) = 1.372 / 1.623 = 0.845
    const nadal60 = calculateNadalLimit(60.0, 0.36);
    assert.ok(nadal60 > 0.8 && nadal60 < 0.9);
  });

  it("should perform 2.0-meter sliding window filtering and pass on compliant vehicle trajectory", () => {
    const numPoints = 200;
    const distanceM = new Float64Array(numPoints);
    const yLeft = new Float64Array(numPoints);
    const yRight = new Float64Array(numPoints);
    const qLeft = new Float64Array(numPoints);
    const qRight = new Float64Array(numPoints);
    const curveRadius = new Float64Array(numPoints);

    // Generate a 200-meter track section (1 meter step):
    // First 50m: Tangent (Zone 1)
    // 50m to 120m: Curve R=1000m (Zone 2)
    // 120m to 160m: Curve R=500m (Zone 3)
    // 160m to 200m: Tight Curve R=300m (Zone 4)
    for (let i = 0; i < numPoints; i++) {
      distanceM[i] = i * 1.0;
      qLeft[i] = 95.0 + 5.0 * Math.sin(0.1 * i); // ~95-100 kN (nominal 100 kN per wheel)
      qRight[i] = 105.0 - 5.0 * Math.sin(0.1 * i);

      if (i < 50) {
        curveRadius[i] = 0; // Tangent
        yLeft[i] = 10.0 + 3.0 * Math.sin(0.3 * i);
        yRight[i] = -8.0 + 2.0 * Math.cos(0.3 * i);
      } else if (i < 120) {
        curveRadius[i] = 1000; // Zone 2
        yLeft[i] = 30.0 + 5.0 * Math.sin(0.2 * i);
        yRight[i] = -15.0;
      } else if (i < 160) {
        curveRadius[i] = 500; // Zone 3
        yLeft[i] = 45.0 + 6.0 * Math.sin(0.2 * i);
        yRight[i] = -20.0;
      } else {
        curveRadius[i] = 300; // Zone 4
        yLeft[i] = 55.0 + 4.0 * Math.sin(0.2 * i);
        yRight[i] = -25.0;
      }
    }

    // Add an isolated narrow spike at i=30 that is filtered out by the 2m window
    yLeft[30] = 90.0; // High instantaneous peak: 90 / 95 = 0.947 > 0.80

    const input: En14363TrajectoryInput = {
      distanceM,
      lateralForceYLeftKn: yLeft,
      lateralForceYRightKn: yRight,
      verticalForceQLeftKn: qLeft,
      verticalForceQRightKn: qRight,
      nominalAxleLoadQ0Kn: 200.0, // 200 kN axle load (Q0 = 100 kN per wheel)
      curveRadiusM: curveRadius,
      slidingWindowM: 2.0,
      wheelFlangeAngleDeg: 70.0,
      frictionCoefficient: 0.36,
    };

    const result = evaluateEn14363Trajectory(input);

    // Instantaneous peak at index 30 was 90/95 ~ 0.947
    assert.ok(result.maxInstantYOverQ > 0.9, "Instantaneous peak should be preserved in instant metric");

    // But the 2.0m sliding window smooths the isolated 1m spike:
    // Window averages over 2 meters, reducing peak (Y/Q)_2m significantly below Nadal limit
    assert.ok(
      result.maxSlidingYOverQ < result.nadalLimit,
      `Max sliding Y/Q (${result.maxSlidingYOverQ}) must be smoothed below Nadal limit (${result.nadalLimit})`,
    );

    // Prud'homme limit for 200 kN axle load: 10 + (2/3)*100 = 76.67 kN
    assert.equal(result.prudhommeLimitKn, 10.0 + (2.0 / 3.0) * 100.0);
    assert.ok(result.maxPrudhommeForceKn < result.prudhommeLimitKn);
    assert.equal(result.trackShiftPassed, true);

    // Quasi-static lateral force limit (default 60 kN)
    assert.ok(result.maxQuasiStaticGuidingForceKn < result.quasiStaticLimitKn);
    assert.equal(result.quasiStaticPassed, true);

    // All 4 test zones must be evaluated
    assert.equal(result.zones.length, 4);
    const z1 = result.zones.find((z) => z.zone === "Zone1_Tangent");
    const z2 = result.zones.find((z) => z.zone === "Zone2_LargeCurve");
    const z3 = result.zones.find((z) => z.zone === "Zone3_SmallCurve");
    const z4 = result.zones.find((z) => z.zone === "Zone4_VerySmallCurve");

    assert.ok(z1 && z2 && z3 && z4);
    assert.ok(
      z1.estimatedMaxYOverQ < z4.estimatedMaxYOverQ,
      "Tight curve should have higher guiding force than tangent",
    );
    assert.equal(result.overallPassed, true);
  });

  it("should fail when sustained curve negotiation exceeds Prud'homme or Nadal limits", () => {
    const numPoints = 100;
    const distanceM = new Float64Array(numPoints);
    const yLeft = new Float64Array(numPoints);
    const yRight = new Float64Array(numPoints);
    const qLeft = new Float64Array(numPoints);
    const qRight = new Float64Array(numPoints);
    const curveRadius = new Float64Array(numPoints);

    // Vehicle with severe sustained lateral hunting and high lateral force in small curve
    for (let i = 0; i < numPoints; i++) {
      distanceM[i] = i * 1.0;
      curveRadius[i] = 350; // Zone 4 tight curve
      qLeft[i] = 70.0; // severe wheel unloading on inside rail
      qRight[i] = 130.0;
      yLeft[i] = 85.0; // Sustained lateral force >> Prud'homme limit (76.67 kN)
      yRight[i] = 15.0; // Total track-shift force = 85 + 15 = 100 kN >> 76.67 kN
    }

    const input: En14363TrajectoryInput = {
      distanceM,
      lateralForceYLeftKn: yLeft,
      lateralForceYRightKn: yRight,
      verticalForceQLeftKn: qLeft,
      verticalForceQRightKn: qRight,
      nominalAxleLoadQ0Kn: 200.0,
      curveRadiusM: curveRadius,
      wheelFlangeAngleDeg: 70.0,
      frictionCoefficient: 0.36,
    };

    const result = evaluateEn14363Trajectory(input);

    assert.equal(result.overallPassed, false);
    assert.equal(result.trackShiftPassed, false);
    assert.ok(result.maxPrudhommeForceKn > result.prudhommeLimitKn);

    // Check integration with createHomologationReportFromTrajectory
    const report = createHomologationReportFromTrajectory(result, {
      modelName: "HighAxleLoad_Freight_Bogie",
      vehicleType: "Freight Bogie",
      nominalAxleLoadQ0Kn: 200.0,
      sperlingVerticalWz: 2.8,
      sperlingHorizontalWz: 2.7,
    });

    assert.equal(report.summary.passed, false);
    assert.ok(report.summary.checksFailed >= 1);

    const prudCheck = report.checks.find((c) => c.id === "EN14363-PRUDHOMME-FORCE");
    assert.ok(prudCheck);
    assert.equal(prudCheck.status, "FAIL");

    const html = exportHomologationHtml(report);
    assert.ok(html.includes("HighAxleLoad_Freight_Bogie"));
    assert.ok(html.includes("Prud&#39;homme") || html.includes("Prud'homme"));
    assert.ok(html.includes("FAIL"));
  });
});
