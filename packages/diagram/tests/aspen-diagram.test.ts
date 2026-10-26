// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAspenDiagram,
  getStreamColor,
  renderAspenSvg,
  type AspenModelLike,
} from "../src/aspen-diagram-builder.js";

const sampleModel: AspenModelLike = {
  title: "Methanol Distillation Plant",
  components: [
    { name: "METHANOL", formula: "CH4O" },
    { name: "WATER", formula: "H2O" },
  ],
  blocks: [
    {
      name: "FEEDPUMP",
      type: "PUMP",
      inStreams: ["RAWFEED"],
      outStreams: ["PRESSFEED"],
    },
    {
      name: "PREHEATER",
      type: "HEATX",
      inStreams: ["PRESSFEED"],
      outStreams: ["HOTFEED"],
    },
    {
      name: "COL1",
      type: "RADFRAC",
      inStreams: ["HOTFEED"],
      outStreams: ["DISTILLATE", "BOTTOMS"],
    },
  ],
  streams: [
    { name: "RAWFEED", toBlock: "FEEDPUMP", temperature: 298.15, pressure: 1.0, phase: "liquid" },
    {
      name: "PRESSFEED",
      fromBlock: "FEEDPUMP",
      toBlock: "PREHEATER",
      temperature: 299.0,
      pressure: 3.5,
      phase: "liquid",
    },
    { name: "HOTFEED", fromBlock: "PREHEATER", toBlock: "COL1", temperature: 350.0, pressure: 3.2, phase: "mixed" },
    { name: "DISTILLATE", fromBlock: "COL1", temperature: 337.8, pressure: 1.2, phase: "vapor" },
    { name: "BOTTOMS", fromBlock: "COL1", temperature: 373.15, pressure: 1.3, phase: "liquid" },
  ],
};

test("Aspen Stream Phase Colors: Maps thermodynamic phases accurately", () => {
  assert.equal(getStreamColor("vapor"), "#f59e0b");
  assert.equal(getStreamColor("liquid"), "#06b6d4");
  assert.equal(getStreamColor("mixed"), "#8b5cf6");
  assert.equal(getStreamColor(undefined), "#38bdf8");
});

test("Aspen Diagram: Builds X6 graph cells for unit operations and process streams", () => {
  const diag = buildAspenDiagram(sampleModel);
  assert.equal(diag.title, "Methanol Distillation Plant");
  assert.ok(diag.cells.length >= 8);

  const col1 = diag.cells.find((c) => c.id === "block_COL1");
  assert.ok(col1);
  assert.equal(col1.shape, "rect");
  assert.equal((col1.data as any)?.blockType, "RADFRAC");
  assert.ok((col1.height ?? 0) >= 120); // Column is drawn elongated vertically

  const pump = diag.cells.find((c) => c.id === "block_FEEDPUMP");
  assert.ok(pump);

  const streamDist = diag.cells.find((c) => c.id === "stream_DISTILLATE");
  assert.ok(streamDist);
  assert.equal(streamDist.shape, "edge");
});

test("Aspen SVG: Renders standalone vector PFD with trays, markers, and legend", () => {
  const svg = renderAspenSvg(sampleModel);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("Methanol Distillation Plant"));
  assert.ok(svg.includes("RADFRAC"));
  assert.ok(svg.includes("COL1"));
  assert.ok(svg.includes("FEEDPUMP"));
  assert.ok(svg.includes("Vapor"));
  assert.ok(svg.includes("Liquid"));
  assert.ok(svg.includes('stroke-dasharray="2,2"')); // Tray hashes
  assert.ok(svg.endsWith("</svg>\n"));
});

test("Aspen Sugiyama DAG Layout: Positions blocks by topological flow rank and handles recycles", () => {
  // Scrambled order with recycle loop from Reactor back to Mixer
  const recyclePlant: AspenModelLike = {
    title: "Ammonia Synthesis Loop",
    blocks: [
      { name: "CONDENSER", type: "HEATX" },
      { name: "REACTOR", type: "PLUGFLOW" },
      { name: "MIXER", type: "MIXER" },
    ],
    streams: [
      { name: "MAKEUP", toBlock: "MIXER", phase: "vapor" },
      { name: "FEED", fromBlock: "MIXER", toBlock: "REACTOR", phase: "vapor" },
      { name: "HOTGAS", fromBlock: "REACTOR", toBlock: "CONDENSER", phase: "mixed" },
      { name: "RECYCLE", fromBlock: "CONDENSER", toBlock: "MIXER", phase: "vapor" }, // Recycle back-edge!
      { name: "PRODUCT", fromBlock: "CONDENSER", phase: "liquid" },
    ],
  };

  const diag = buildAspenDiagram(recyclePlant);
  assert.equal(diag.title, "Ammonia Synthesis Loop");

  const mixer = diag.cells.find((c) => c.id === "block_MIXER");
  const reactor = diag.cells.find((c) => c.id === "block_REACTOR");
  const condenser = diag.cells.find((c) => c.id === "block_CONDENSER");

  assert.ok(mixer && reactor && condenser);

  // Sugiyama DAG ranking must position Mixer (Rank 0) < Reactor (Rank 1) < Condenser (Rank 2) horizontally
  assert.ok((mixer.x ?? 0) < (reactor.x ?? 0), "Mixer must precede Reactor horizontally");
  assert.ok((reactor.x ?? 0) < (condenser.x ?? 0), "Reactor must precede Condenser horizontally");

  // SVG rendering with A* perimeter obstacle routing on the recycle stream
  const svg = renderAspenSvg(recyclePlant);
  assert.ok(svg.includes("Ammonia Synthesis Loop"));
  assert.ok(svg.includes("RECYCLE"));
  assert.ok(svg.includes("MIXER"));
  assert.ok(svg.includes("REACTOR"));
  assert.ok(svg.includes("CONDENSER"));
});
