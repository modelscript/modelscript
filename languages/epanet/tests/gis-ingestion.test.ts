// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEpanetFromGis,
  DemRaster,
  serializeInp,
  solveHydraulics,
} from "../src/index.js";

const SAMPLE_ASCII_DEM = `ncols         5
nrows         5
xllcorner     500000.0
yllcorner     4000000.0
cellsize      10.0
NODATA_value  -9999
100.0 102.0 104.0 106.0 108.0
90.0  92.0  94.0  96.0  98.0
80.0  82.0  84.0  86.0  88.0
70.0  72.0  74.0  76.0  78.0
60.0  62.0  64.0  66.0  68.0
`;

describe("EPANET GIS / DEM Ingestion Engine", () => {
  describe("DemRaster: ASCII Grid Parsing & Surface Geometry", () => {
    it("parses Esri ASCII grid header and linear elevation matrix", () => {
      const dem = DemRaster.parseAsciiGrid(SAMPLE_ASCII_DEM);
      assert.equal(dem.ncols, 5);
      assert.equal(dem.nrows, 5);
      assert.equal(dem.xllcorner, 500000.0);
      assert.equal(dem.yllcorner, 4000000.0);
      assert.equal(dem.cellsize, 10.0);
      assert.equal(dem.nodata, -9999);
      assert.equal(dem.elevations.length, 25);
    });

    it("performs bilinear interpolation across continuous (x, y) coordinates", () => {
      const dem = DemRaster.parseAsciiGrid(SAMPLE_ASCII_DEM);
      // Top-left cell center (row 0, col 0) is at x = 500005, y = 4000045 (elev: 100.0)
      const elev1 = dem.sample(500005.0, 4000045.0);
      assert(elev1 !== null);
      assert(Math.abs(elev1 - 100.0) < 0.1, `Expected ~100.0, got ${elev1}`);

      // Midpoint between row 0 col 0 (100) and row 0 col 1 (102) -> ~101.0
      const elevMid = dem.sample(500010.0, 4000045.0);
      assert(elevMid !== null);
      assert(Math.abs(elevMid - 101.0) < 0.2, `Expected ~101.0, got ${elevMid}`);

      // Out of bounds coordinate returns null
      assert.equal(dem.sample(400000.0, 3000000.0), null);
    });

    it("computes Horn 3x3 slope and aspect on DEM raster", () => {
      const dem = DemRaster.parseAsciiGrid(SAMPLE_ASCII_DEM);
      // Grid slopes uniformly from north to south (10m per 10m cell = 100% gradient)
      // and west to east (2m per 10m cell = 20% gradient)
      const { slopePct, aspectDeg } = dem.sampleSlopeAspect(500025.0, 4000025.0);
      assert(slopePct > 0, `Expected positive slope, got ${slopePct}`);
      assert(aspectDeg >= 0 && aspectDeg <= 360, `Expected valid aspect 0..360, got ${aspectDeg}`);
    });

    it("computes average slope across polygon boundary", () => {
      const dem = DemRaster.parseAsciiGrid(SAMPLE_ASCII_DEM);
      const polygonRing: [number, number][] = [
        [500010.0, 4000010.0],
        [500040.0, 4000010.0],
        [500040.0, 4000040.0],
        [500010.0, 4000040.0],
        [500010.0, 4000010.0],
      ];
      const avgSlope = dem.samplePolygonAverageSlope(polygonRing);
      assert(avgSlope > 0, `Expected average polygon slope > 0, got ${avgSlope}`);
    });
  });

  describe("buildEpanetFromGis: Topological Snapping & Network Assembly", () => {
    it("assembles connected EPANET network from GeoJSON line centerlines and DEM elevations", () => {
      // Projected UTM pipe centerlines
      const pipesGeoJson = {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            id: "P101",
            properties: { id: "P101", diameter: 300, roughness: 130 },
            geometry: {
              type: "LineString",
              coordinates: [
                [500005.0, 4000045.0],
                [500025.0, 4000045.0],
              ],
            },
          },
          {
            type: "Feature" as const,
            id: "P102",
            properties: { id: "P102", diameter: 200, roughness: 120 },
            geometry: {
              type: "LineString",
              coordinates: [
                // Start point within 1.0m snap tolerance of P101 end ([500025.0, 4000045.0])
                [500025.5, 4000045.2],
                [500045.0, 4000025.0],
              ],
            },
          },
        ],
      };

      // Explicit source reservoir at P101 origin
      const nodesGeoJson = {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            id: "RES_1",
            properties: { id: "RES_1", type: "reservoir", head: 120.0 },
            geometry: {
              type: "Point",
              coordinates: [500005.0, 4000045.0],
            },
          },
        ],
      };

      const dem = DemRaster.parseAsciiGrid(SAMPLE_ASCII_DEM);
      const network = buildEpanetFromGis({
        pipesGeoJson,
        nodesGeoJson,
        dem,
        snapToleranceM: 2.0,
        defaultDemandLps: 5.0,
      });

      // Verify topological snapping
      assert.equal(network.pipes.length, 2);
      assert.equal(network.reservoirs.length, 1);
      assert.equal(network.reservoirs[0]!.id, "RES_1");
      assert.equal(network.reservoirs[0]!.totalHead, 120.0);

      // P101 should connect RES_1 to shared snapped node
      const p1 = network.pipes.find((p) => p.id === "P101");
      const p2 = network.pipes.find((p) => p.id === "P102");
      assert(p1 !== undefined);
      assert(p2 !== undefined);
      assert.equal(p1.node1, "RES_1");
      assert.equal(p1.node2, p2.node1, "Pipe 1 end should snap to Pipe 2 start");

      // Verify node elevation was sampled from DEM
      const snappedJunction = network.junctions.find((j) => j.id === p1.node2);
      assert(snappedJunction !== undefined);
      assert(snappedJunction.elevation > 90.0, `Expected DEM elevation > 90m, got ${snappedJunction.elevation}`);

      // Verify pipe length was calculated from coordinates: 20m for P101
      assert.equal(Math.round(p1.length), 20);

      // Verify network serialization to standard EPANET INP
      const inp = serializeInp(network);
      assert(inp.includes("[RESERVOIRS]"));
      assert(inp.includes("[JUNCTIONS]"));
      assert(inp.includes("[PIPES]"));
      assert(inp.includes("RES_1"));
      assert(inp.includes("P101"));

      // Verify network solves in hydraulic engine
      const simResult = solveHydraulics(network);
      assert.equal(simResult.converged, true);
      assert((simResult.linkFlows.get("P101") ?? 0) > 0);
    });

    it("computes geodesic Haversine lengths for WGS84 geographic GeoJSON", () => {
      const wgs84Pipes = {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            id: "GEO_P1",
            properties: { diameter: 250 },
            geometry: {
              type: "LineString",
              // ~111 meters apart in latitude (0.001 deg ~ 111m)
              coordinates: [
                [-74.0060, 40.7128],
                [-74.0060, 40.7138],
              ],
            },
          },
        ],
      };

      const network = buildEpanetFromGis({
        pipesGeoJson: wgs84Pipes,
      });

      assert.equal(network.pipes.length, 1);
      const pipe = network.pipes[0]!;
      // Expected Haversine distance ~ 111.2 meters
      assert(Math.abs(pipe.length - 111.2) < 5.0, `Expected ~111.2m, got ${pipe.length}`);
      assert.equal(network.junctions.length, 2);
    });
  });
});
