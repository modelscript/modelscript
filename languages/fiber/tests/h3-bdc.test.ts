// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  discretizeCoverageToH3,
  generateHexagonVertices,
  latLonToH3,
  type BdcTechnologyProfile,
} from "../src/index.js";

test("FCC Broadband Data Collection (BDC) H3 Spatial Engine Suite", async (t) => {
  await t.test("generates valid 15-character H3 indices for lat/lon coordinates", () => {
    // Manhattan (40.7128° N, -74.0060° W)
    const h3Res9 = latLonToH3(40.7128, -74.006, 9);
    assert.equal(h3Res9.length, 15);
    assert.ok(h3Res9.startsWith("892a"));

    const h3Res8 = latLonToH3(40.7128, -74.006, 8);
    assert.equal(h3Res8.length, 15);
    assert.ok(h3Res8.startsWith("882a"));
  });

  await t.test("generates closed 6-vertex polygon boundaries for hexagons", () => {
    const vertices = generateHexagonVertices(-74.006, 40.7128, 9);
    assert.equal(vertices.length, 7); // 6 vertices + 1 closed loop point
    // First point must equal last point
    assert.deepEqual(vertices[0], vertices[6]);

    // Check all vertices are numeric coordinates
    for (const [lon, lat] of vertices) {
      assert.ok(lon < -73.0 && lon > -75.0);
      assert.ok(lat > 40.0 && lat < 41.0);
    }
  });

  await t.test("discretizes fiber route into FCC BDC-compliant GeoJSON and CSV", () => {
    const fiberPoints: Array<[number, number]> = [
      [-74.006, 40.7128],
      [-74.008, 40.714],
      [-74.01, 40.716],
      [-74.012, 40.718],
    ];

    const profile: BdcTechnologyProfile = {
      techCode: 50, // Optical Carrier / FTTH
      maxDownloadMbps: 1000,
      maxUploadMbps: 1000,
      lowLatency: true,
      providerName: "MetroFiber Networks LLC",
    };

    const result = discretizeCoverageToH3(fiberPoints, profile, 9);
    assert.ok(result.totalHexagons > 0);
    assert.equal(result.technologyCode, 50);
    assert.equal(result.geojson.type, "FeatureCollection");
    assert.equal(result.geojson.features.length, result.totalHexagons);

    // Verify CSV header and format
    const lines = result.csvSummary.split("\n");
    assert.equal(lines[0], "h3_index,technology,max_advertised_download_mbps,max_advertised_upload_mbps,low_latency");
    assert.ok(lines.length > 1);
    assert.ok(lines[1]!.includes(",50,1000,1000,1"));
  });
});
