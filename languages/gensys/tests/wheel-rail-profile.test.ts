// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateS1002WheelProfile,
  evaluateUic60RailProfile,
  evaluateWheelsetContactGeometry,
  generateWheelRailLutTable,
  interpolateWheelRailLut,
} from "../src/index.js";

describe("GENSYS Nonlinear Wheel-Rail Profile Tracing (S1002 / UIC 60)", () => {
  it("should evaluate S1002 wheel profile and UIC 60 rail profile heights", () => {
    // S1002 wheel profile
    const zWheelTread = evaluateS1002WheelProfile(0.0); // at taping line
    assert.equal(zWheelTread, 0.0);

    const zWheelFlange = evaluateS1002WheelProfile(0.05); // at flange crest (+y is towards flange)
    assert.ok(zWheelFlange > 0.02, "Flange crest must be higher than tread");

    // UIC 60 rail profile
    const zRailCrown = evaluateUic60RailProfile(0.0); // at crown center
    assert.equal(zRailCrown, 0.0);

    const zRailGaugeCorner = evaluateUic60RailProfile(0.03); // gauge corner drops down
    assert.ok(zRailGaugeCorner < 0.0, "Gauge corner must drop downward");
  });

  it("should evaluate symmetric contact at zero lateral shift", () => {
    const res = evaluateWheelsetContactGeometry(0.0, 0.46, 0.75, 1 / 40);

    assert.equal(res.wheelsetLateralY, 0.0);
    assert.ok(Math.abs(res.deltaRollingRadius) < 1e-4, "Delta r at center must be ~0");
    assert.ok(Math.abs(res.rollAngleRad) < 1e-4, "Kinematic roll angle at center must be ~0");
    assert.ok(res.equivalentConicity > 0.02 && res.equivalentConicity < 0.2);
  });

  it("should evaluate rolling radius difference Delta r under lateral wheelset shift", () => {
    // Shift wheelset right by +4 mm (toward flange on right, tread field side on left)
    const resRightShift = evaluateWheelsetContactGeometry(0.004, 0.46, 0.75, 1 / 40);

    // Left wheel shifts towards tread taper/field, right wheel shifts towards flange
    // Delta r = r_left - r_right
    assert.notEqual(resRightShift.deltaRollingRadius, 0.0);
    assert.ok(resRightShift.equivalentConicity >= 0.03 && resRightShift.equivalentConicity <= 0.4);

    // Shift in opposite direction (-4 mm) produces opposite Delta r
    const resLeftShift = evaluateWheelsetContactGeometry(-0.004, 0.46, 0.75, 1 / 40);
    assert.ok(Math.abs(resRightShift.deltaRollingRadius + resLeftShift.deltaRollingRadius) < 1e-4);
  });

  it("should generate precomputed look-up table (LUT) and interpolate high-speed contact metrics", () => {
    const table = generateWheelRailLutTable(31, 0.012, 0.46, 0.75, 1 / 40);

    assert.equal(table.lateralDisplacements.length, 31);
    assert.equal(table.deltaRollingRadius.length, 31);

    // Midpoint (y=0) should have ~0 Delta r
    const midIdx = 15;
    assert.equal(table.lateralDisplacements[midIdx], 0.0);
    assert.ok(Math.abs(table.deltaRollingRadius[midIdx]!) < 1e-4);

    // Interpolation at y = 0.0025 m
    const interp = interpolateWheelRailLut(table, 0.0025);
    assert.ok(interp.conicity > 0.02 && interp.conicity < 0.4);
    assert.ok(Math.abs(interp.deltaR) > 0);

    // High throughput benchmark: 10,000 lookups
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) {
      const y = -0.01 + (i / 10000) * 0.02;
      interpolateWheelRailLut(table, y);
    }
    const dt = performance.now() - t0;
    assert.ok(dt < 100, `Expected 10,000 lookups under 100ms, took ${dt.toFixed(2)}ms`);
  });
});
