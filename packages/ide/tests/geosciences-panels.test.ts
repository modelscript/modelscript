// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseCdlClimateGrid, renderClimateRasterSvg } from "@modelscript/diagram/climate-raster";
import { createSyntheticSeismicSurvey, renderSegyWvaSvg } from "@modelscript/diagram/segy-trace";
import { diffEpanetNetworks, renderEpanetDiffSvg, type EpanetModelLike } from "@modelscript/diagram/water-network-diff";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClimateRasterEditorProvider, ClimateRasterPanel } from "../src/climate-raster-panel.js";
import { SeismicViewerEditorProvider, SeismicViewerPanel } from "../src/seismic-viewer-panel.js";
import { WaterDiffEditorProvider, WaterDiffPanel } from "../src/water-diff-panel.js";

describe("Geosciences, Climate & Hydrology IDE Custom Editors & Panels (Path C)", () => {
  it("exposes ClimateRasterPanel and ClimateRasterEditorProvider viewType identifiers", () => {
    assert.equal(ClimateRasterPanel.viewType, "modelscript.climateRasterViewer");
    assert.equal(ClimateRasterEditorProvider.viewType, "modelscript.climateRasterEditor");
  });

  it("exposes SeismicViewerPanel and SeismicViewerEditorProvider viewType identifiers", () => {
    assert.equal(SeismicViewerPanel.viewType, "modelscript.seismicViewer");
    assert.equal(SeismicViewerEditorProvider.viewType, "modelscript.seismicViewer");
  });

  it("exposes WaterDiffPanel and WaterDiffEditorProvider viewType identifiers", () => {
    assert.equal(WaterDiffPanel.viewType, "modelscript.waterDiffViewer");
    assert.equal(WaterDiffEditorProvider.viewType, "modelscript.waterDiffEditor");
  });

  it("renders ClimateRasterPanel webview shell with scientific colormaps and graticule", () => {
    const cdl = `netcdf test {
dimensions: lat = 3; lon = 4;
variables:
  float lat(lat);
  float lon(lon);
  float sst(lat, lon);
    sst:standard_name = "sea_surface_temperature";
    sst:units = "degC";
data:
  lat = -30, 0, 30;
  lon = -60, -20, 20, 60;
  sst = 18.5, 20.0, 22.5, 21.0, 24.0, 26.5, 28.0, 25.5, 19.0, 21.5, 23.0, 20.5;
}`;
    const grid = parseCdlClimateGrid(cdl);
    const svg = renderClimateRasterSvg(grid, { colormap: "viridis", showGraticule: true });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("sea_surface_temperature"), "Should render variable name");
    assert.ok(svg.includes("degC"), "Should display units");
    assert.ok(svg.includes("0° (Eq)"), "Should include equator line");
  });

  it("renders SeismicViewerPanel webview shell with WVA trace deflection and time axis", () => {
    const survey = createSyntheticSeismicSurvey({ numTraces: 12, numSamples: 150 });
    const svg = renderSegyWvaSvg(survey, { gain: 2.0, applyAgc: false, polarity: "normal" });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("SEG-Y Rev 1"), "Should include SEG-Y specification badge");
    assert.ok(svg.includes("Time"), "Should render vertical time axis");
    assert.ok(svg.includes("path d="), "Should render wiggle curves");
  });

  it("renders WaterDiffPanel webview shell with Git-style network additions, deletions, and modifications", () => {
    const baseModel: EpanetModelLike = {
      title: "Base Network",
      junctions: [{ id: "J1", elevation: 100, demand: 10, pressure: 40 }],
      reservoirs: [{ id: "R1", totalHead: 140 }],
      tanks: [],
      pipes: [{ id: "P1", node1: "R1", node2: "J1", length: 500, diameter: 200, roughness: 100 }],
    };

    const targetModel: EpanetModelLike = {
      title: "Target Network",
      junctions: [
        { id: "J1", elevation: 100, demand: 10, pressure: 45 },
        { id: "J2_New", elevation: 95, demand: 15, pressure: 38 },
      ],
      reservoirs: [{ id: "R1", totalHead: 140 }],
      tanks: [],
      pipes: [
        { id: "P1", node1: "R1", node2: "J1", length: 500, diameter: 250, roughness: 120 }, // Modified diameter
        { id: "P2_New", node1: "J1", node2: "J2_New", length: 400, diameter: 150, roughness: 110 }, // Added
      ],
    };

    const diff = diffEpanetNetworks(baseModel, targetModel);
    assert.equal(diff.stats.addedNodes, 1);
    assert.equal(diff.stats.addedLinks, 1);
    assert.equal(diff.stats.modifiedLinks, 1);

    const svg = renderEpanetDiffSvg(diff, { theme: "dark", width: 800, height: 500 });
    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("J2_New"), "Should include added node");
    assert.ok(svg.includes("Pipes: +1 added"), "Should indicate added pipe in HUD");
  });
});
