// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateRatingCurve,
  evaluateRatingEquation,
  filterValidObservations,
  fitRatingCurve,
  invertRatingEquation,
} from "../src/analysis/rating-curve.js";
import type { RatingCurve, RatingCurveEquation, WaterTimeSeries } from "../src/types.js";

describe("WaterML Rating Curve & Hydrologic Benchmark Suite", () => {
  it("evaluates stage-discharge power law with numerical precision and tolerance", () => {
    // Q = 25.0 * (h - 0.5)^2.1
    const eq: RatingCurveEquation = { a: 25.0, h0: 0.5, b: 2.1 };
    const tolerance = 1e-4;

    const qZero = evaluateRatingEquation(eq, 0.4);
    assert.equal(qZero, 0);

    const qBase = evaluateRatingEquation(eq, 1.5); // (1.5 - 0.5)^2.1 = 1^2.1 = 1 -> Q = 25.0
    assert.ok(Math.abs(qBase - 25.0) < tolerance);

    const qHigh = evaluateRatingEquation(eq, 2.5);
    const expected = 25.0 * Math.pow(2.0, 2.1);
    assert.ok(Math.abs(qHigh - expected) < tolerance);

    // Inverse rating curve check
    const hInvert = invertRatingEquation(eq, expected);
    assert.ok(Math.abs(hInvert - 2.5) < tolerance);
  });

  it("performs piecewise-linear interpolation on table rating curves within residual tolerance", () => {
    const curve: RatingCurve = {
      curveId: "RC_TABLE_01",
      stationId: "GAGE_RIVER",
      tablePoints: [
        { stageM: 1.0, dischargeM3S: 10.0 },
        { stageM: 2.0, dischargeM3S: 30.0 },
        { stageM: 3.0, dischargeM3S: 70.0 },
      ],
    };

    const tolerance = 1e-4;
    // Midpoint between 1.0 and 2.0 -> stage 1.5 should yield discharge 20.0
    const qMid = evaluateRatingCurve(curve, 1.5);
    const residual = Math.abs(qMid - 20.0);
    assert.ok(residual < tolerance);

    // Clamping boundaries
    assert.equal(evaluateRatingCurve(curve, 0.5), 10.0);
    assert.equal(evaluateRatingCurve(curve, 4.0), 70.0);
  });

  it("fits power-law rating curve minimizing RMSE and residual to converge within tolerance", () => {
    // True relationship: Q = 15.0 * (h - 0.2)^1.8
    const trueA = 15.0;
    const trueH0 = 0.2;
    const trueB = 1.8;

    const stages = [0.8, 1.2, 1.8, 2.5, 3.2, 4.0];
    const pairs = stages.map((h) => ({
      stageM: h,
      dischargeM3S: trueA * Math.pow(h - trueH0, trueB),
    }));

    const fit = fitRatingCurve(pairs, { h0Candidates: [0.2], tolerance: 1e-3 });

    assert.equal(fit.converged, true);
    assert.equal(fit.sampleCount, 6);

    // Verify RMSE is near zero for exact synthetic data
    assert.ok(fit.rmse < 1e-3);
    assert.ok(fit.residualMax < 1e-3);

    // Verify estimated parameters match true parameters within tolerance
    const tolerance = 1e-2;
    assert.ok(Math.abs(fit.equation.a - trueA) < tolerance);
    assert.ok(Math.abs(fit.equation.b - trueB) < tolerance);
  });

  it("filters out suspect and missing telemetry observations", () => {
    const series: WaterTimeSeries = {
      seriesId: "TS_FILTER",
      observedProperty: "Discharge",
      unit: "m3/s",
      interpolationType: "Instantaneous",
      monitoringPoint: { stationId: "STA1", stationName: "Station 1" },
      points: [
        { time: new Date("2026-05-01T00:00:00Z"), value: 10.0, quality: "good" },
        { time: new Date("2026-05-01T01:00:00Z"), value: 999.0, quality: "suspect" },
        { time: new Date("2026-05-01T02:00:00Z"), value: 0.0, quality: "missing" },
        { time: new Date("2026-05-01T03:00:00Z"), value: 12.5, quality: "estimate" },
      ],
    };

    const valid = filterValidObservations(series);
    assert.equal(valid.length, 2);
    assert.equal(valid[0]!.value, 10.0);
    assert.equal(valid[1]!.value, 12.5);
  });
});
