// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLpsDiagram,
  getLpsPressureColor,
  renderCompressorMapSvg,
  renderLpsPressureProfileSvg,
  renderLpsSchematicSvg,
  type LpsModelLike,
} from "../src/lps-diagram-builder.js";

const sampleModel: LpsModelLike = {
  id: "test_pipeline",
  title: "Cross-Country Gas Transmission Network",
  type: "TGNET",
  nodes: [
    { name: "SUPPLY_HUB", type: "SUPPLY", elevation: 500, pressure: 75e5 },
    { name: "INTERMEDIATE_JCT", type: "JUNCTION", elevation: 450 },
    { name: "CITY_GATE", type: "DELIVERY", elevation: 120, flowRate: 85.0 },
  ],
  pipes: [
    {
      name: "MAIN_LINE_1",
      fromNode: "SUPPLY_HUB",
      toNode: "INTERMEDIATE_JCT",
      length: 65000,
      diameter: 0.9144,
      maop: 85e5,
    },
    {
      name: "MAIN_LINE_2",
      fromNode: "INTERMEDIATE_JCT",
      toNode: "CITY_GATE",
      length: 85000,
      diameter: 0.762,
      maop: 80e5,
    },
  ],
  compressors: [{ name: "BOOSTER_STA_1", fromNode: "SUPPLY_HUB", toNode: "INTERMEDIATE_JCT", ratedPowerKw: 15000 }],
};

test("LPS Pressure Colors: Maps pressure levels and MAOP ratios", () => {
  assert.equal(getLpsPressureColor(90.0, 80.0), "#ef4444"); // MAOP breach
  assert.equal(getLpsPressureColor(70.0, 80.0), "#06b6d4"); // High transmission
  assert.equal(getLpsPressureColor(50.0, 80.0), "#3b82f6"); // Nominal transmission
  assert.equal(getLpsPressureColor(30.0, 80.0), "#10b981"); // City gate
  assert.equal(getLpsPressureColor(10.0, 80.0), "#f59e0b"); // Warning low
});

test("LPS Diagram: Builds X6 graph model with nodes, pipes, and compressors", () => {
  const diag = buildLpsDiagram(sampleModel);
  assert.equal(diag.title, "Cross-Country Gas Transmission Network");
  assert.ok(diag.cells.length >= 6);

  const supplyNode = diag.cells.find((c) => c.id === "node_SUPPLY_HUB");
  assert.ok(supplyNode);
  assert.equal(supplyNode.shape, "rect");

  const pipe1 = diag.cells.find((c) => c.id === "pipe_MAIN_LINE_1");
  assert.ok(pipe1);
  assert.equal(pipe1.shape, "edge");

  const comp = diag.cells.find((c) => c.id === "comp_BOOSTER_STA_1");
  assert.ok(comp);
  assert.equal(comp.shape, "circle");
});

test("LPS Schematic SVG: Renders valid standalone dark-mode SVG markup", () => {
  const svg = renderLpsSchematicSvg(sampleModel);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("Cross-Country Gas Transmission Network"));
  assert.ok(svg.includes("SUPPLY_HUB"));
  assert.ok(svg.includes("CITY_GATE"));
  assert.ok(svg.includes("MAIN_LINE_1"));
  assert.ok(svg.includes("BOOSTER_STA_1"));
});

test("LPS Pressure Profile SVG: Renders chainage gradient profile vs MAOP", () => {
  const svg = renderLpsPressureProfileSvg(sampleModel);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("Pipeline Chainage [km]"));
  assert.ok(svg.includes("Pressure [bar]"));
  assert.ok(svg.includes("MAOP 80 bar"));
  assert.ok(svg.includes("Contract Delivery Floor 35 bar"));
});

test("LPS Compressor Map SVG: Renders multi-speed curves, surge line, and operating point", () => {
  const svg = renderCompressorMapSvg("BOOSTER_STA_1", 15000, 9500, {
    speedRpm: 9500,
    flowM3s: 3.1,
    headKjKg: 82.5,
    isSurging: false,
    isStonewalled: false,
    antiSurgeRecycleM3s: 0.0,
  });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("BOOSTER_STA_1 — Centrifugal Performance Map"));
  assert.ok(svg.includes("Surge Line"));
  assert.ok(svg.includes("9500 RPM"));
  assert.ok(svg.includes("NORMAL GOVERNOR"));
});
