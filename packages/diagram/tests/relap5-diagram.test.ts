// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRelap5Diagram,
  getCoolantTempColor,
  renderRelap5Svg,
  type Relap5DeckLike,
} from "../src/relap5-diagram-builder.js";

const sampleRelap: Relap5DeckLike = {
  title: "Westinghouse 4-Loop PWR Plant",
  volumes: [
    { id: 101, name: "CoreActive", elevation: 10.0, tempK: 595.0, pressurePa: 15.5e6 },
    { id: 102, name: "HotLegPipe", elevation: 12.0, tempK: 592.0, pressurePa: 15.4e6 },
    { id: 103, name: "SgPrimary", elevation: 16.0, tempK: 560.0, pressurePa: 15.3e6 },
    { id: 104, name: "ColdLegPipe", elevation: 11.0, tempK: 545.0, pressurePa: 15.6e6 },
  ],
  junctions: [
    { id: 10101, fromVolume: 101, toVolume: 102, massFlow: 14000.0 },
    { id: 10201, fromVolume: 102, toVolume: 103, massFlow: 14000.0 },
    { id: 10301, fromVolume: 103, toVolume: 104, massFlow: 14000.0 },
  ],
};

test("RELAP5 Coolant Temperature Colors: Maps thermal ranges to colors", () => {
  assert.equal(getCoolantTempColor(600), "#ef4444"); // Hot Leg Red (> 317 C)
  assert.equal(getCoolantTempColor(575), "#f59e0b"); // Core Mid Amber
  assert.equal(getCoolantTempColor(555), "#10b981"); // SG Exit Green
  assert.equal(getCoolantTempColor(530), "#0284c7"); // Cold Leg Blue
});

test("RELAP5 Diagram: Builds X6 graph cells for RPV, steam generator, pressurizer, and coolant loops", () => {
  const diag = buildRelap5Diagram(sampleRelap);
  assert.equal(diag.title, "Westinghouse 4-Loop PWR Plant");
  assert.ok(diag.cells.length >= 8);

  const rpv = diag.cells.find((c) => c.id === "rpv_vessel");
  assert.ok(rpv);
  assert.equal(rpv.shape, "rect");

  const sg = diag.cells.find((c) => c.id === "sg_vessel");
  assert.ok(sg);

  const pzr = diag.cells.find((c) => c.id === "pzr_vessel");
  assert.ok(pzr);

  const rcp = diag.cells.find((c) => c.id === "rcp_pump");
  assert.ok(rcp);
  assert.equal(rcp.shape, "circle");

  const hotLeg = diag.cells.find((c) => c.id === "pipe_hot_leg");
  assert.ok(hotLeg);
  assert.equal(hotLeg.shape, "edge");
});

test("RELAP5 SVG: Renders standalone thermal-hydraulic loop flowsheet with fuel hashes and U-tubes", () => {
  const svg = renderRelap5Svg(sampleRelap);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("Westinghouse 4-Loop PWR Plant"));
  assert.ok(svg.includes("RPV Core"));
  assert.ok(svg.includes("Steam Generator"));
  assert.ok(svg.includes("Pressurizer"));
  assert.ok(svg.includes("Hot Leg (~320°C)"));
  assert.ok(svg.includes("Cold Leg (~285°C)"));
  assert.ok(svg.endsWith("</svg>\n"));
});

test("RELAP5 Diagram: Builds dynamic control volume cells and directed junctions for arbitrary hydrodynamic decks", () => {
  const customDeck: Relap5DeckLike = {
    title: "Edwards Pipe Blowdown Experiment",
    volumes: [
      { id: 201, name: "PipeSection1", elevation: 0.0, tempK: 515.0, pressurePa: 7.0e6 },
      { id: 202, name: "PipeSection2", elevation: 0.0, tempK: 510.0, pressurePa: 6.9e6 },
      { id: 203, name: "BreakDischarge", elevation: 0.0, tempK: 373.0, pressurePa: 1.0e5 },
    ],
    junctions: [
      { id: 20101, fromVolume: 201, toVolume: 202, massFlow: 85.5 },
      { id: 20201, fromVolume: 202, toVolume: 203, massFlow: 120.0 },
    ],
  };

  const diag = buildRelap5Diagram(customDeck);
  assert.equal(diag.title, "Edwards Pipe Blowdown Experiment");

  const vol1 = diag.cells.find((c) => c.id === "vol_201");
  assert.ok(vol1);
  assert.equal(vol1.data?.["volumeId"], 201);
  assert.ok(vol1.label?.includes("PipeSection1"));

  const junc1 = diag.cells.find((c) => c.id === "junc_20101");
  assert.ok(junc1);
  assert.equal(junc1.shape, "edge");
  assert.deepEqual(junc1.source, { cell: "vol_201" });
  assert.deepEqual(junc1.target, { cell: "vol_202" });

  const svg = renderRelap5Svg(customDeck);
  assert.ok(svg.includes("Edwards Pipe Blowdown Experiment"));
  assert.ok(svg.includes("PipeSection1"));
  assert.ok(svg.includes("85.5 kg/s"));
});
