// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSwmmDiagram,
  getCapacityColor,
  renderSwmmProfileSvg,
  renderSwmmSvg,
  type SwmmModelLike,
} from "../src/swmm-diagram-builder.js";

const sampleSwmm: SwmmModelLike = {
  title: "Municipal Trunk Storm Sewer",
  junctions: [
    { id: "J1", elevation: 120.0, maxDepth: 4.5, initDepth: 1.0, surchargeDepth: 0.0, x: 100, y: 150 },
    { id: "J2", elevation: 115.0, maxDepth: 5.0, initDepth: 1.2, surchargeDepth: 0.0, x: 280, y: 150 },
    { id: "J3", elevation: 110.0, maxDepth: 6.0, initDepth: 2.0, surchargeDepth: 0.5, x: 460, y: 150 },
  ],
  outfalls: [{ id: "OUT1", elevation: 104.0, type: "FREE", stage: 0.5, x: 650, y: 150 }],
  conduits: [
    { id: "C1", fromNode: "J1", toNode: "J2", length: 180, roughness: 0.013, diameter: 1.0, capacityFraction: 0.45 },
    { id: "C2", fromNode: "J2", toNode: "J3", length: 200, roughness: 0.013, diameter: 1.2, capacityFraction: 0.85 },
    { id: "C3", fromNode: "J3", toNode: "OUT1", length: 150, roughness: 0.013, diameter: 1.5, capacityFraction: 1.05 },
  ],
};

test("SWMM Capacity Colors: Maps conduit flow utilization to hydraulic risk levels", () => {
  assert.equal(getCapacityColor(0.4), "#06b6d4"); // Low Flow
  assert.equal(getCapacityColor(0.6), "#10b981"); // Normal Flow
  assert.equal(getCapacityColor(0.85), "#f59e0b"); // Near Capacity
  assert.equal(getCapacityColor(1.1), "#ef4444"); // Surcharged / Overflow
  assert.equal(getCapacityColor(undefined), "#38bdf8"); // Standard
});

test("SWMM Diagram: Builds 2D conveyance network cells for junctions, outfalls, and pipes", () => {
  const diag = buildSwmmDiagram(sampleSwmm);
  assert.equal(diag.title, "Municipal Trunk Storm Sewer");
  assert.equal(diag.cells.length, 7); // 3 junctions + 1 outfall + 3 conduits

  const j1 = diag.cells.find((c) => c.id === "junction_J1");
  assert.ok(j1);
  assert.equal(j1.shape, "circle");
  assert.equal((j1.data as any)?.elevation, 120.0);

  const out1 = diag.cells.find((c) => c.id === "outfall_OUT1");
  assert.ok(out1);
  assert.equal(out1.shape, "polygon"); // Outfall triangular flap shape

  const c3 = diag.cells.find((c) => c.id === "conduit_C3");
  assert.ok(c3);
  assert.equal(c3.shape, "edge");
  assert.equal((c3.attrs?.["line"] as any)?.stroke, "#ef4444"); // Capacity 1.05 -> red
});

test("SWMM Plan SVG: Renders valid 2D conveyance network markup", () => {
  const svg = renderSwmmSvg(sampleSwmm);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("Municipal Trunk Storm Sewer"));
  assert.ok(svg.includes("J1"));
  assert.ok(svg.includes("OUT1"));
  assert.ok(svg.includes("C1"));
  assert.ok(svg.includes("Capacity (Q/Q_full)"));
  assert.ok(svg.endsWith("</svg>\n"));
});

test("SWMM Profile SVG: Renders longitudinal HGL elevation profile along path", () => {
  const svg = renderSwmmProfileSvg(sampleSwmm, ["J1", "J2", "J3", "OUT1"]);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("Ground Rim"));
  assert.ok(svg.includes("HGL Water Surface"));
  assert.ok(svg.includes("Conduit Invert"));
  assert.ok(svg.includes("J1"));
  assert.ok(svg.includes("J2"));
  assert.ok(svg.includes("J3"));
  assert.ok(svg.includes("OUT1"));
  assert.ok(svg.endsWith("</svg>\n"));
});

test("SWMM Topological Layout: Automatically lays out unplaced network by gravity drainage DAG rank", () => {
  const unplacedModel: SwmmModelLike = {
    title: "Unplaced Catchment Drainage",
    junctions: [
      { id: "Inlet_A", elevation: 130.0, maxDepth: 3.0 },
      { id: "Inlet_B", elevation: 128.0, maxDepth: 3.0 },
      { id: "Manhole_C", elevation: 120.0, maxDepth: 4.0 },
      { id: "Manhole_D", elevation: 110.0, maxDepth: 5.0 },
    ],
    outfalls: [{ id: "River_Outfall", elevation: 100.0, type: "FREE" }],
    conduits: [
      { id: "P1", fromNode: "Inlet_A", toNode: "Manhole_C", length: 100, roughness: 0.013 },
      { id: "P2", fromNode: "Inlet_B", toNode: "Manhole_C", length: 120, roughness: 0.013 },
      { id: "P3", fromNode: "Manhole_C", toNode: "Manhole_D", length: 200, roughness: 0.013 },
      { id: "P4", fromNode: "Manhole_D", toNode: "River_Outfall", length: 150, roughness: 0.013 },
    ],
  };

  const diag = buildSwmmDiagram(unplacedModel);
  const inletA = diag.cells.find((c) => c.id === "junction_Inlet_A")!;
  const inletB = diag.cells.find((c) => c.id === "junction_Inlet_B")!;
  const manholeC = diag.cells.find((c) => c.id === "junction_Manhole_C")!;
  const manholeD = diag.cells.find((c) => c.id === "junction_Manhole_D")!;
  const outfall = diag.cells.find((c) => c.id === "outfall_River_Outfall")!;

  // Inlets A and B have in-degree 0 -> rank 0 (same x)
  assert.equal(inletA.x, inletB.x);

  // Manhole C is downstream of A and B -> rank 1
  assert.ok(manholeC.x! > inletA.x!);

  // Manhole D is downstream of C -> rank 2
  assert.ok(manholeD.x! > manholeC.x!);

  // River_Outfall is downstream of D -> rank 3 (rightmost)
  assert.ok(outfall.x! > manholeD.x!);
});
