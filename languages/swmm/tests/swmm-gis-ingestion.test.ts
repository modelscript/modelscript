// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSwmmFromGis,
  DemRaster,
  serializeSwmm,
  solveSwmmHydraulics,
} from "../src/index.js";

const SAMPLE_ASCII_DEM = `ncols         5
nrows         5
xllcorner     600000.0
yllcorner     4500000.0
cellsize      20.0
NODATA_value  -9999
150.0 148.0 146.0 144.0 142.0
140.0 138.0 136.0 134.0 132.0
130.0 128.0 126.0 124.0 122.0
120.0 118.0 116.0 114.0 112.0
110.0 108.0 106.0 104.0 102.0
`;

describe("SWMM GIS / DEM Ingestion Engine", () => {
  describe("DemRaster: Topographic Surface Sampling", () => {
    it("parses ASCII Grid header and computes continuous bilinear elevations", () => {
      const dem = DemRaster.parseAsciiGrid(SAMPLE_ASCII_DEM);
      assert.equal(dem.ncols, 5);
      assert.equal(dem.nrows, 5);
      assert.equal(dem.cellsize, 20.0);
      assert.equal(dem.nodata, -9999);

      // Top-left cell center: x = 600010, y = 4500090 (elevation: 150.0)
      const elevCenter = dem.sample(600010.0, 4500090.0);
      assert(elevCenter !== null);
      assert(Math.abs(elevCenter - 150.0) < 0.1, `Expected ~150.0, got ${elevCenter}`);

      // Midpoint between row 0 col 0 (150) and row 0 col 1 (148) -> 149.0
      const elevMid = dem.sample(600020.0, 4500090.0);
      assert(elevMid !== null);
      assert(Math.abs(elevMid - 149.0) < 0.2, `Expected ~149.0, got ${elevMid}`);
    });

    it("evaluates Horn 3x3 slope and compass aspect", () => {
      const dem = DemRaster.parseAsciiGrid(SAMPLE_ASCII_DEM);
      const { slopePct, aspectDeg } = dem.sampleSlopeAspect(600050.0, 4500050.0);
      assert(slopePct > 0, `Expected positive slope, got ${slopePct}`);
      assert(aspectDeg >= 0 && aspectDeg <= 360, `Expected aspect between 0 and 360, got ${aspectDeg}`);
    });
  });

  describe("buildSwmmFromGis: Vector Sewer & Catchment Assembly", () => {
    it("ingests conduits, manholes, and subcatchment polygons with automatic outlet snapping and DEM slopes", () => {
      const dem = DemRaster.parseAsciiGrid(SAMPLE_ASCII_DEM);

      // Conduits GeoJSON: 2 pipe segments
      const conduitsGeoJson = {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            id: "C_MAIN_1",
            properties: { id: "C_MAIN_1", diameter: 0.9, roughness: 0.013 },
            geometry: {
              type: "LineString",
              coordinates: [
                [600010.0, 4500090.0],
                [600050.0, 4500050.0],
              ],
            },
          },
          {
            type: "Feature" as const,
            id: "C_MAIN_2",
            properties: { id: "C_MAIN_2", diameter: 1.2, roughness: 0.013 },
            geometry: {
              type: "LineString",
              coordinates: [
                // Snaps to previous outlet within tolerance
                [600050.5, 4500050.2],
                [600090.0, 4500010.0],
              ],
            },
          },
        ],
      };

      // Explicit manhole and outfall
      const manholesGeoJson = {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            id: "MH_UPSTREAM",
            properties: { id: "MH_UPSTREAM", maxDepth: 3.0 },
            geometry: {
              type: "Point",
              coordinates: [600010.0, 4500090.0],
            },
          },
          {
            type: "Feature" as const,
            id: "OF_OUTFALL",
            properties: { id: "OF_OUTFALL", type: "outfall" },
            geometry: {
              type: "Point",
              coordinates: [600090.0, 4500010.0],
            },
          },
        ],
      };

      // Subcatchment polygon (approx 40m x 40m = 1600m^2 = 0.16 ha)
      const subcatchmentsGeoJson = {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            id: "BASIN_A",
            properties: { id: "BASIN_A", imperv: 65.0 },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [600000.0, 4500070.0],
                  [600040.0, 4500070.0],
                  [600040.0, 4500100.0],
                  [600000.0, 4500100.0],
                  [600000.0, 4500070.0],
                ],
              ],
            },
          },
        ],
      };

      const deck = buildSwmmFromGis({
        conduitsGeoJson,
        manholesGeoJson,
        subcatchmentsGeoJson,
        dem,
        snapToleranceM: 2.0,
      });

      // Conduits check
      assert.equal(deck.conduits.size, 2);
      const c1 = deck.conduits.get("C_MAIN_1");
      const c2 = deck.conduits.get("C_MAIN_2");
      assert(c1 !== undefined);
      assert(c2 !== undefined);

      assert.equal(c1.inletNode, "MH_UPSTREAM");
      assert.equal(c1.outletNode, c2.inletNode, "Conduit 1 outlet should snap to Conduit 2 inlet");
      assert.equal(c2.outletNode, "OF_OUTFALL");

      // Verify Cross Sections were created for each conduit
      assert.equal(deck.crossSections.size, 2);
      assert.equal(deck.crossSections.get("C_MAIN_1")?.geom1, 0.9);
      assert.equal(deck.crossSections.get("C_MAIN_2")?.geom1, 1.2);

      // Outfall check
      assert.equal(deck.outfalls.size, 1);
      assert(deck.outfalls.has("OF_OUTFALL"));

      // Subcatchment metrics check
      assert.equal(deck.subcatchments.size, 1);
      const sub = deck.subcatchments.get("BASIN_A");
      assert(sub !== undefined);
      // Area: 40m x 30m = 1200 m^2 = 0.12 ha
      assert(Math.abs(sub.area - 0.12) < 0.05, `Expected ~0.12 ha, got ${sub.area}`);
      assert.equal(sub.impervPct, 65.0);
      assert(sub.width > 0, `Expected positive flow width, got ${sub.width}`);
      // Centroid is around (600020, 4500085), nearest manhole should be MH_UPSTREAM (600010, 4500090)
      assert.equal(sub.outlet, "MH_UPSTREAM");
      // Slope sampled from DEM
      assert(sub.slopePct > 0, `Expected DEM slope > 0, got ${sub.slopePct}`);

      // Verify Deck Serialization to valid INP deck
      const inpText = serializeSwmm(deck);
      assert(inpText.includes("[CONDUITS]"));
      assert(inpText.includes("[XSECTIONS]"));
      assert(inpText.includes("[SUBCATCHMENTS]"));
      assert(inpText.includes("C_MAIN_1"));
      assert(inpText.includes("MH_UPSTREAM"));
      assert(inpText.includes("OF_OUTFALL"));
      assert(inpText.includes("BASIN_A"));

      // Solve hydraulics on generated deck
      const sim = solveSwmmHydraulics(deck, {
        totalDurationHours: 1.0,
        reportStepMinutes: 15.0,
      });
      assert.equal(sim.conduits.size, 2);
      assert(sim.nodes.size >= 1);
    });
  });
});
