// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { buildAspenDiagram } from "../src/aspen-diagram-builder.js";
import { buildOpenDssDiagram } from "../src/opendss-diagram-builder.js";
import { buildRelap5Diagram } from "../src/relap5-diagram-builder.js";
import { buildSpiceDiagram } from "../src/spice-diagram-builder.js";
import { cellsToDiagramData, renderCellsSvg } from "../src/svg-renderer.js";

test("Unified Engine: cellsToDiagramData converts domain cell graphs into canonical DiagramData", () => {
  const dssDeck = {
    circuit: { name: "FeedA", baseKv: 12.47, bus1: "SourceBus", phases: 3 },
    lines: [{ name: "L1", bus1: "SourceBus", bus2: "Bus1", phases: 3 }],
    loads: [{ name: "Load1", bus: "Bus1", kw: 100 }],
  };

  const dssGraph = buildOpenDssDiagram(dssDeck);
  const data = cellsToDiagramData(dssGraph);

  assert.ok(data.nodes.length >= 3, "Must convert node cells to DiagramNodes");
  assert.ok(data.edges.length >= 2, "Must convert edge cells to DiagramEdges");
  assert.ok(data.coordinateSystem.width > 0, "Coordinate system width must be positive");
  assert.ok(data.coordinateSystem.height > 0, "Coordinate system height must be positive");

  const bus1 = data.nodes.find((n) => n.id === "bus_Bus1");
  assert.ok(bus1, "Bus node must exist");
  assert.equal(bus1.attrs.body.stroke, "#38bdf8");
});

test("Unified Engine: renderCellsSvg renders standalone SVG with orthogonal routing and themes", () => {
  const aspenModel = {
    title: "Process Train Alpha",
    blocks: [
      { name: "PUMP1", type: "PUMP" },
      { name: "HX1", type: "HEATX" },
    ],
    streams: [{ name: "S1", fromBlock: "PUMP1", toBlock: "HX1", phase: "liquid" as const }],
  };

  const aspenGraph = buildAspenDiagram(aspenModel);

  // Render dark theme
  const darkSvg = renderCellsSvg(aspenGraph, { theme: "dark" });
  assert.ok(darkSvg.startsWith("<svg"));
  assert.ok(darkSvg.includes('id="nodes"'));
  assert.ok(darkSvg.includes('id="edges"'));
  assert.ok(darkSvg.includes("block_PUMP1"));
  assert.ok(darkSvg.includes("block_HX1"));
  assert.ok(darkSvg.endsWith("</svg>"));

  // Render blueprint theme
  const blueprintSvg = renderCellsSvg(aspenGraph, { theme: "blueprint" });
  assert.ok(blueprintSvg.includes('style="background-color: #1e3a8a;"'));

  // Render light theme
  const lightSvg = renderCellsSvg(aspenGraph, { theme: "light" });
  assert.ok(lightSvg.includes('style="background-color: #ffffff;"'));
});

test("Unified Engine: renders multi-domain graphs (RELAP5, SPICE) with port routing and markers", () => {
  const relapDeck = {
    title: "SMR Loop Flow",
    volumes: [
      { id: 1, name: "Downcomer", tempK: 540 },
      { id: 2, name: "Core", tempK: 590 },
    ],
    junctions: [{ id: 12, fromVolume: 1, toVolume: 2, massFlow: 450 }],
  };

  const relapGraph = buildRelap5Diagram(relapDeck);
  const relapSvg = renderCellsSvg(relapGraph);
  assert.ok(relapSvg.includes("vol_1"));
  assert.ok(relapSvg.includes("vol_2"));
  assert.ok(relapSvg.includes('marker-end="url(#marker-classic)"'));

  const spiceCircuit = {
    title: "Voltage Divider",
    components: [
      { name: "R1", kind: "R", nodes: ["in", "mid"], value: 1000 },
      { name: "R2", kind: "R", nodes: ["mid", "0"], value: 2000 },
    ],
  };

  const spiceGraph = buildSpiceDiagram(spiceCircuit);
  const spiceSvg = renderCellsSvg(spiceGraph);
  assert.ok(spiceSvg.includes("comp_R1"));
  assert.ok(spiceSvg.includes("comp_R2"));
});
