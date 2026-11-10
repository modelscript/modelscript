// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerWaterMlToDae } from "../src/dae/waterml-to-dae.js";
import type { WaterMlDocument } from "../src/types.js";

describe("WaterML Linear-Memory DAE Arena Lowering", () => {
  it("lowers WaterMlDocument into DAEBuilder arena with boundary equations", () => {
    const doc: WaterMlDocument = {
      id: "DOC_DAE_TEST",
      generationDate: new Date("2026-05-01T00:00:00Z"),
      timeSeriesList: [
        {
          seriesId: "TS_STREAMFLOW",
          observedProperty: "Discharge",
          unit: "m3/s",
          interpolationType: "Instantaneous",
          monitoringPoint: {
            stationId: "GAGE_POTOMAC",
            stationName: "Potomac River Gaging Station",
          },
          points: [
            { time: new Date("2026-05-01T00:00:00Z"), value: 125.4, quality: "good" },
            { time: new Date("2026-05-01T01:00:00Z"), value: 130.8, quality: "good" },
          ],
        },
        {
          seriesId: "TS_STAGE",
          observedProperty: "Stage",
          unit: "m",
          interpolationType: "Continuous",
          monitoringPoint: {
            stationId: "GAGE_POTOMAC",
            stationName: "Potomac River Gaging Station",
          },
          points: [
            { time: new Date("2026-05-01T00:00:00Z"), value: 3.42, quality: "good" },
            { time: new Date("2026-05-01T01:00:00Z"), value: 3.51, quality: "good" },
          ],
        },
      ],
    };

    const dae = lowerWaterMlToDae(doc);
    assert.ok(dae instanceof DAEBuilder);

    // 1 time var + 2 * (1 state var + 1 count param) = 5 variables
    assert.ok(dae.varCount >= 4, `Expected at least 4 variables, got ${dae.varCount}`);
    // 2 boundary equations + 2 parameter bindings = 4 equations
    assert.ok(dae.eqCount >= 2, `Expected at least 2 equations, got ${dae.eqCount}`);
  });

  it("lowers stage-discharge rating curve algebraic parameters into DAEBuilder arena", () => {
    const doc: WaterMlDocument = {
      id: "DOC_RATING_DAE",
      generationDate: new Date("2026-05-01T00:00:00Z"),
      timeSeriesList: [
        {
          seriesId: "TS_01",
          observedProperty: "Discharge",
          unit: "m3/s",
          interpolationType: "Instantaneous",
          monitoringPoint: { stationId: "STA1", stationName: "Station 1" },
          points: [{ time: new Date("2026-05-01T00:00:00Z"), value: 50.0, quality: "good" }],
        },
      ],
    };

    const dae = lowerWaterMlToDae(doc, {
      ratingCurve: {
        curveId: "RC_01",
        stationId: "STA1",
        equation: { a: 18.5, h0: 0.35, b: 2.2 },
      },
    });

    // 1 time + 2 for series + 3 for rating curve = 6 variables
    assert.ok(dae.varCount >= 6, `Expected at least 6 variables, got ${dae.varCount}`);
    // 2 for series + 3 for rating curve = 5 equations
    assert.ok(dae.eqCount >= 5, `Expected at least 5 equations, got ${dae.eqCount}`);
  });
});
