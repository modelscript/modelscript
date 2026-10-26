// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateCrossWindAerodynamics,
  evaluateWheelUnloading,
  evaluateWindProfile,
  generateCharacteristicWindCurve,
} from "../src/index.js";

describe("Cross-Wind Vehicle Aerodynamics (EN 14067-6)", () => {
  const defaultParams = {
    referenceArea: 10.0, // 10 m^2
    referenceHeight: 2.5, // 2.5 m
    airDensity: 1.225,
  };

  it("should evaluate steady and Chinese Hat wind gust profiles", () => {
    // Steady wind
    const steady = evaluateWindProfile({ type: "steady", meanWindSpeed: 20, windAngleDeg: 90 }, 1.0);
    assert.equal(steady.windSpeed, 20);
    assert.equal(steady.windAngleDeg, 90);

    // Chinese Hat gust: mean 15 m/s, amplitude +10 m/s, duration 2s, start at 1.0s
    const gustProfile = {
      type: "chinese_hat" as const,
      meanWindSpeed: 15,
      gustAmplitude: 10,
      gustDuration: 2.0,
      gustStartTime: 1.0,
      windAngleDeg: 90,
    };

    // Before gust
    assert.equal(evaluateWindProfile(gustProfile, 0.5).windSpeed, 15);

    // Peak at t = 2.0s (midpoint of gust)
    const peak = evaluateWindProfile(gustProfile, 2.0);
    assert.ok(Math.abs(peak.windSpeed - 25) < 1e-4, `Expected peak ~ 25 m/s, got ${peak.windSpeed}`);

    // After gust
    assert.equal(evaluateWindProfile(gustProfile, 3.5).windSpeed, 15);
  });

  it("should calculate aerodynamic forces and overturning moment under crosswind", () => {
    // No crosswind (headwind only, vTrain = 50 m/s = 180 km/h)
    const noWind = evaluateCrossWindAerodynamics({
      trainSpeed: 50,
      windSpeed: 0,
      windAngleDeg: 90,
      params: defaultParams,
    });

    assert.equal(noWind.yawAngleDeg, 0);
    assert.equal(noWind.sideForceY, 0);
    assert.equal(noWind.rollMomentX, 0);
    assert.ok(noWind.dragForceX > 0);
    assert.ok(noWind.liftForceZ > 0);

    // Perpendicular crosswind (vTrain = 50 m/s, vWind = 20 m/s)
    const crossWind = evaluateCrossWindAerodynamics({
      trainSpeed: 50,
      windSpeed: 20,
      windAngleDeg: 90,
      params: defaultParams,
    });

    // Effective airspeed: sqrt(50^2 + 20^2) = sqrt(2900) ~ 53.85 m/s
    assert.ok(Math.abs(crossWind.effectiveAirspeed - Math.hypot(50, 20)) < 1e-3);
    assert.ok(crossWind.yawAngleDeg > 15 && crossWind.yawAngleDeg < 30);
    assert.ok(crossWind.sideForceY > 5000, `Expected positive side force, got ${crossWind.sideForceY}`);
    assert.ok(crossWind.rollMomentX > 10000, `Expected overturning roll moment, got ${crossWind.rollMomentX}`);
    assert.ok(crossWind.liftForceZ > 0);
  });

  it("should evaluate dynamic wheel unloading ratio Delta Q / Q0 per EN 14067-6", () => {
    const nominalWheelLoadN = 50000; // 50 kN per wheel (200 kN axle load / 4 wheels)

    // Moderate crosswind (vWind = 15 m/s) -> Safe run
    const safeForces = evaluateCrossWindAerodynamics({
      trainSpeed: 40, // ~144 km/h
      windSpeed: 15,
      windAngleDeg: 90,
      params: defaultParams,
    });

    const safeAssessment = evaluateWheelUnloading({
      nominalWheelLoadN,
      trackGaugeM: 1.5,
      forces: safeForces,
    });

    assert.equal(safeAssessment.overturningLimitPassed, true);
    assert.ok(safeAssessment.wheelUnloadingRatio < 0.9);
    assert.ok(safeAssessment.windwardWheelLoadN < nominalWheelLoadN);
    assert.ok(safeAssessment.leewardWheelLoadN > nominalWheelLoadN);

    // Extreme storm wind (vWind = 50 m/s) -> Overturning violation
    const stormForces = evaluateCrossWindAerodynamics({
      trainSpeed: 60, // ~216 km/h
      windSpeed: 50,
      windAngleDeg: 90,
      params: defaultParams,
    });

    const stormAssessment = evaluateWheelUnloading({
      nominalWheelLoadN,
      trackGaugeM: 1.5,
      forces: stormForces,
    });

    assert.equal(stormAssessment.overturningLimitPassed, false);
    assert.ok(stormAssessment.wheelUnloadingRatio >= 0.9);
    assert.equal(stormAssessment.windwardWheelLoadN, 0); // Completely lifted off
  });

  it("should generate Characteristic Wind Curves (CWC) across operating speed range", () => {
    const nominalWheelLoadN = 55000; // 55 kN per wheel
    const speedsKmh = [120, 160, 200, 250, 300];

    const cwc = generateCharacteristicWindCurve(speedsKmh, nominalWheelLoadN, defaultParams, 90, 0.2);

    assert.equal(cwc.length, 5);

    // Physical monotonicity: As train speed increases, allowable crosswind speed decreases
    for (let i = 1; i < cwc.length; i++) {
      const prev = cwc[i - 1]!;
      const curr = cwc[i]!;
      assert.ok(
        curr.criticalWindSpeedMs <= prev.criticalWindSpeedMs,
        `CWC must be monotonically decreasing with train speed: at ${curr.trainSpeedKmh}km/h got ${curr.criticalWindSpeedMs}m/s vs ${prev.criticalWindSpeedMs}m/s at ${prev.trainSpeedKmh}km/h`,
      );
    }

    // Verify reasonable physical values (e.g. at 300 km/h, critical wind is in 20-40 m/s range)
    const at300 = cwc[4]!;
    assert.ok(at300.criticalWindSpeedKmh > 60 && at300.criticalWindSpeedKmh < 160);
  });
});
