// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { importBathymetrySurvey, parseSurveyData } from "../src/index.js";

test("OLGA 3D Seabed Bathymetry Survey Ingestion", async (t) => {
  const sampleSurveyCsv = `Easting,Northing,Depth
0.0,0.0,-450.0
1200.0,250.0,-475.0
2800.0,700.0,-520.0
4200.0,1100.0,-410.0
5000.0,1350.0,-50.0
5200.0,1400.0,25.0`;

  await t.test("1. parseSurveyData parses coordinates and cumulative 3D distance", () => {
    const points = parseSurveyData(sampleSurveyCsv);
    assert.equal(points.length, 6);
    assert.equal(points[0]!.x, 0.0);
    assert.equal(points[0]!.z, -450.0);
    assert.equal(points[0]!.distanceAlongRoute, 0.0);

    const endPt = points[points.length - 1]!;
    assert.ok(endPt.distanceAlongRoute > 5200, "Cumulative 3D distance should exceed 5200m");
    assert.equal(endPt.z, 25.0);
  });

  await t.test("2. importBathymetrySurvey produces curvature-adaptive OLGA pipes", () => {
    const result = importBathymetrySurvey(sampleSurveyCsv, {
      defaultDiameter: 0.3556, // 14"
      targetCellLength: 100.0,
      fineCellLengthAtCurvature: 25.0,
      doglegThresholdDegPer30m: 1.0,
    });

    assert.ok(result.totalLengthM > 5200);
    assert.equal(result.minElevationM, -520.0);
    assert.equal(result.maxElevationM, 25.0);
    assert.ok(result.pipes.length >= 5, "Should generate pipe segments for all survey steps");
    assert.ok(result.maxDoglegSeverity > 0, "Should compute dogleg severity");

    // Check steep riser section (from -410m to -50m: dz = 360m)
    const riserPipe = result.pipes.find((p) => p.elevation > 200);
    assert.ok(riserPipe, "Should identify steep platform catenary riser pipe");
    assert.ok(riserPipe.discretization >= 10, "Steep riser should have fine adaptive discretization");

    // Check XML snippet
    assert.ok(result.opiXmlSnippet.includes("<Pipe Label="));
    assert.ok(result.opiXmlSnippet.includes('Diameter="0.3556"'));
    assert.ok(result.opiXmlSnippet.includes('Elevation="'));
  });

  await t.test("3. 2D KP/Elevation survey format parsing", () => {
    const kpSurvey = `# Chainage (m), Elevation (m)
0, -300
1000, -320
2500, -315
4000, 30`;
    const result = importBathymetrySurvey(kpSurvey);
    assert.equal(result.surveyPoints.length, 4);
    assert.equal(result.minElevationM, -320);
    assert.equal(result.maxElevationM, 30);
  });
});
