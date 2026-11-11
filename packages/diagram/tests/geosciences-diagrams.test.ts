// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lintClimateRaster,
  parseCdlClimateGrid,
  renderClimateRasterSvg,
  type ClimateRasterGrid,
} from "../src/climate-raster-builder.js";
import {
  createSyntheticSeismicSurvey,
  lintSegySurvey,
  renderSegyWvaSvg,
  type SegySurvey,
} from "../src/segy-trace-builder.js";

describe("Geosciences, Climate & Hydrology Diagram Builders (Path C)", () => {
  const sampleCdl = `
netcdf global_temperature {
dimensions:
    lat = 5 ;
    lon = 6 ;
variables:
    float lat(lat) ;
        lat:standard_name = "latitude" ;
        lat:units = "degrees_north" ;
    float lon(lon) ;
        lon:standard_name = "longitude" ;
        lon:units = "degrees_east" ;
    float tas(lat, lon) ;
        tas:standard_name = "surface_air_temperature" ;
        tas:units = "K" ;
        tas:_FillValue = -999.0f ;

data:
    lat = -90, -45, 0, 45, 90 ;
    lon = -180, -120, -60, 0, 60, 120 ;
    tas =
      240.5, 245.0, 248.2, 247.9, 246.1, 242.0,
      260.1, 265.4, 270.0, 268.5, 266.0, 261.2,
      295.2, 298.0, 301.5, 300.2, 299.1, 296.0,
      275.0, 278.2, 280.1, 279.0, 277.5, 274.0,
      235.1, 238.0, 240.2, 239.5, 237.8, 234.0 ;
}
`;

  it("parses CDL text representation and renders publication-grade climate raster SVG", () => {
    const grid = parseCdlClimateGrid(sampleCdl);
    assert.strictEqual(grid.variableName, "tas");
    assert.strictEqual(grid.standardName, "surface_air_temperature");
    assert.strictEqual(grid.units, "K");
    assert.strictEqual(grid.latitudes.length, 5);
    assert.strictEqual(grid.longitudes.length, 6);
    assert.strictEqual(grid.data.length, 5);
    assert.strictEqual(grid.data[0]!.length, 6);
    assert.strictEqual(grid.data[2]![2], 301.5);

    const svg = renderClimateRasterSvg(grid, {
      colormap: "coolwarm",
      showGraticule: true,
      title: "Global Surface Air Temperature",
    });

    assert.ok(svg.includes("<svg"), "Output must contain <svg root element");
    assert.ok(svg.includes("Global Surface Air Temperature"), "SVG must include title");
    assert.ok(svg.includes("CF-1.8"), "SVG must embed CF standard badge");
    assert.ok(svg.includes("0° (Eq)"), "SVG must include Equator graticule label");
    assert.ok(svg.includes("0° (PM)"), "SVG must include Prime Meridian graticule label");
    assert.ok(svg.includes("<rect"), "SVG must render raster cells");
  });

  it("evaluates CF conventions linter and catches non-monotonic coordinates & missing attributes", () => {
    const validGrid = parseCdlClimateGrid(sampleCdl);
    const cleanDiag = lintClimateRaster(validGrid);
    assert.strictEqual(cleanDiag.length, 0, "Valid CF grid should trigger 0 diagnostics");

    const invalidGrid: ClimateRasterGrid = {
      id: "bad_grid",
      title: "Broken Grid",
      variableName: "var1",
      standardName: "", // Missing CF standard_name
      units: "", // Missing units
      latitudes: [0, 10, 5, 20], // Non-monotonic!
      longitudes: [0, 10, 20, 30],
      data: [
        [1, 2, 3, 4],
        [2, 3, 4, 5],
        [3, 4, 5, 6],
        // Missing 4th row!
      ],
    };

    const diagnostics = lintClimateRaster(invalidGrid);
    assert.ok(
      diagnostics.some((d) => d.code === "CF1001"),
      "Should detect non-monotonic latitude",
    );
    assert.ok(
      diagnostics.some((d) => d.code === "CF1002"),
      "Should detect missing standard_name/units",
    );
    assert.ok(
      diagnostics.some((d) => d.code === "CF1004"),
      "Should detect dimension mismatch",
    );
  });

  it("generates synthetic 2D seismic reflection survey and renders multi-trace WVA SVG", () => {
    const survey = createSyntheticSeismicSurvey({
      numTraces: 16,
      numSamples: 250,
      sampleIntervalUs: 2000,
      reflectorDepthsMs: [150, 300],
    });

    assert.strictEqual(survey.traces.length, 16);
    assert.strictEqual(survey.binaryHeader.samplesPerTrace, 250);
    assert.strictEqual(survey.binaryHeader.sampleIntervalUs, 2000);

    const svg = renderSegyWvaSvg(survey, {
      gain: 2.0,
      applyAgc: true,
      polarity: "normal",
      showVariableArea: true,
    });

    assert.ok(svg.includes("<svg"), "Output must contain <svg root element");
    assert.ok(svg.includes("Synthetic 2D Seismic Section"), "SVG must include survey title");
    assert.ok(svg.includes("SEG-Y Rev 1"), "SVG must include SEG-Y specification badge");
    assert.ok(svg.includes("path d="), "SVG must render wiggle polyline and WVA lobes");
    assert.ok(svg.includes("ms</text>"), "SVG must render time depth axis labels");
  });

  it("evaluates geophysical SEG-Y linter and detects sample count mismatches and invalid intervals", () => {
    const validSurvey = createSyntheticSeismicSurvey({ numTraces: 8, numSamples: 100 });
    const cleanDiag = lintSegySurvey(validSurvey);
    assert.strictEqual(cleanDiag.length, 0, "Clean survey must produce 0 geophysical diagnostics");

    const brokenSurvey: SegySurvey = {
      id: "broken_survey",
      title: "Corrupted SEG-Y",
      textHeaders: ["C01 ..."],
      binaryHeader: {
        sampleIntervalUs: -500, // Invalid!
        samplesPerTrace: 200,
        formatCode: 5,
      },
      traces: [
        {
          header: {
            traceNumber: 1,
            cdp: 100,
            inline: 1,
            crossline: 1,
            sourceX: 0,
            sourceY: 0,
            receiverX: 0,
            receiverY: 0,
            elevation: 0,
            delayMs: 0,
          },
          samples: [0, 1, 2], // Only 3 samples instead of 200!
        },
        {
          header: {
            traceNumber: 0, // Non-monotonic trace number!
            cdp: 101,
            inline: 1,
            crossline: 2,
            sourceX: 0,
            sourceY: 0,
            receiverX: 0,
            receiverY: 0,
            elevation: 0,
            delayMs: 0,
          },
          samples: [NaN, 0, 1], // Contains NaN!
        },
      ],
    };

    const diagnostics = lintSegySurvey(brokenSurvey);
    assert.ok(
      diagnostics.some((d) => d.code === "SEGY1001"),
      "Should detect sample length mismatch",
    );
    assert.ok(
      diagnostics.some((d) => d.code === "SEGY1002"),
      "Should detect negative sample interval",
    );
    assert.ok(
      diagnostics.some((d) => d.code === "SEGY1003"),
      "Should detect NaN sample anomaly",
    );
    assert.ok(
      diagnostics.some((d) => d.code === "SEGY1004"),
      "Should detect non-monotonic trace numbering",
    );
  });
});
