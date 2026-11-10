// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WaterMlErrorCode, lintRatingCurve, lintWaterMlDocument, lintWaterTimeSeries } from "../src/lints/index.js";
import type { WaterMlDocument, WaterTimeSeries } from "../src/types.js";

describe("WaterML Diagnostic Linter", () => {
  it("detects empty document collection (WML1001)", () => {
    const doc: WaterMlDocument = {
      id: "EMPTY_DOC",
      generationDate: new Date(),
      timeSeriesList: [],
    };

    const lints = lintWaterMlDocument(doc);
    assert.ok(lints.some((l) => l.code === WaterMlErrorCode.EMPTY_COLLECTION));
  });

  it("detects missing time series identifier (WML1002)", () => {
    const series: WaterTimeSeries = {
      seriesId: "",
      observedProperty: "Discharge",
      unit: "m3/s",
      interpolationType: "Instantaneous",
      monitoringPoint: { stationId: "STA1", stationName: "Station 1" },
      points: [{ time: new Date(), value: 10.0, quality: "good" }],
    };

    const lints = lintWaterTimeSeries(series);
    assert.ok(lints.some((l) => l.code === WaterMlErrorCode.MISSING_SERIES_ID));
  });

  it("detects non-monotonic timestamps in time series (WML2001)", () => {
    const series: WaterTimeSeries = {
      seriesId: "TS_REVERSAL",
      observedProperty: "Discharge",
      unit: "m3/s",
      interpolationType: "Instantaneous",
      monitoringPoint: { stationId: "STA1", stationName: "Station 1" },
      points: [
        { time: new Date("2026-05-01T02:00:00Z"), value: 10.0, quality: "good" },
        { time: new Date("2026-05-01T01:00:00Z"), value: 12.0, quality: "good" },
      ],
    };

    const lints = lintWaterTimeSeries(series);
    assert.ok(lints.some((l) => l.code === WaterMlErrorCode.NON_MONOTONIC_TIME));
  });

  it("warns on negative discharge observations in open channel flow (WML3001)", () => {
    const series: WaterTimeSeries = {
      seriesId: "TS_NEG_FLOW",
      observedProperty: "River Discharge",
      unit: "m3/s",
      interpolationType: "Instantaneous",
      monitoringPoint: { stationId: "STA1", stationName: "Station 1" },
      points: [{ time: new Date("2026-05-01T00:00:00Z"), value: -5.2, quality: "good" }],
    };

    const lints = lintWaterTimeSeries(series);
    assert.ok(lints.some((l) => l.code === WaterMlErrorCode.NEGATIVE_OBSERVATION));
  });

  it("validates rating curve coefficients and exponents (WML4001)", () => {
    const lintsBadA = lintRatingCurve({
      curveId: "RC_BAD_A",
      stationId: "STA1",
      equation: { a: -2.0, h0: 0.0, b: 2.0 },
    });
    assert.ok(lintsBadA.some((l) => l.code === WaterMlErrorCode.INVALID_RATING_CURVE));

    const lintsBadB = lintRatingCurve({
      curveId: "RC_BAD_B",
      stationId: "STA1",
      equation: { a: 10.0, h0: 0.0, b: 0.0 },
    });
    assert.ok(lintsBadB.some((l) => l.code === WaterMlErrorCode.INVALID_RATING_CURVE));
  });
});
