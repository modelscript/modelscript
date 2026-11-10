// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  projectWaterMlToEpanet,
  projectWaterMlToHecRas,
  projectWaterMlToSwmm,
} from "../src/projections/waterml-to-boundary.js";
import type { WaterTimeSeries } from "../src/types.js";

describe("WaterML Boundary Condition Projections", () => {
  const sampleSeries: WaterTimeSeries = {
    seriesId: "TS_STREAM_POTOMAC",
    observedProperty: "Discharge",
    unit: "m3/s",
    interpolationType: "Instantaneous",
    monitoringPoint: {
      stationId: "01646500",
      stationName: "Potomac River at Little Falls",
    },
    points: [
      { time: new Date("2026-05-01T00:00:00Z"), value: 140.0, quality: "good" },
      { time: new Date("2026-05-01T01:00:00Z"), value: 145.5, quality: "good" },
      { time: new Date("2026-05-01T02:00:00Z"), value: 152.0, quality: "good" },
      { time: new Date("2026-05-01T03:00:00Z"), value: 160.2, quality: "good" },
    ],
  };

  it("projects WaterML timeseries to HEC-RAS unsteady flow boundary block", () => {
    const hecRasText = projectWaterMlToHecRas(sampleSeries, {
      river: "Potomac",
      reach: "MainStem",
      riverStation: "100.5",
    });

    assert.ok(hecRasText.includes("Boundary Location=Potomac,MainStem,100.5, , , , ,"));
    assert.ok(hecRasText.includes("Interval=1HOUR"));
    assert.ok(hecRasText.includes("Flow Hydrograph=4"));
    assert.ok(hecRasText.includes("140.00"));
    assert.ok(hecRasText.includes("145.50"));
    assert.ok(hecRasText.includes("152.00"));
    assert.ok(hecRasText.includes("160.20"));
  });

  it("projects WaterML timeseries to EPANET [PATTERNS] block", () => {
    const epanetText = projectWaterMlToEpanet(sampleSeries, "PAT_INFLOW");
    assert.ok(epanetText.includes("[PATTERNS]"));
    assert.ok(epanetText.includes("PAT_INFLOW"));
    assert.ok(epanetText.includes("140.0000 145.5000 152.0000 160.2000"));
  });

  it("projects WaterML timeseries to SWMM [TIMESERIES] block", () => {
    const swmmText = projectWaterMlToSwmm(sampleSeries, "TS_INFLOW");
    assert.ok(swmmText.includes("[TIMESERIES]"));
    assert.ok(swmmText.includes("TS_INFLOW"));
    assert.ok(swmmText.includes("05/01/2026 00:00   140.000"));
    assert.ok(swmmText.includes("05/01/2026 01:00   145.500"));
  });
});
