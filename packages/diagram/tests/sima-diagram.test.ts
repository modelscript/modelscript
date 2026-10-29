// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { renderSimaCatenaryProfileSvg, renderSimaMooringSpreadSvg } from "../src/sima-diagram-builder.js";

test("SIMA Diagram Builder: renders 2D catenary sag profile SVG", () => {
  const svg = renderSimaCatenaryProfileSvg({
    title: "OC4 Semi Mooring Line 1",
    waterDepth: 200,
    horizontalSpan: 800,
    lineLength: 850,
    submergedWeight: 3200,
    fairleadTotalTension: 650000,
    horizontalTension: 350000,
    fairleadAngleDeg: 32.5,
    touchdownDistance: 450,
    groundedLength: 450,
    suspendedLength: 400,
    vesselName: "Deepwater Semi-Submersible",
    vesselDraft: 18,
    vesselLength: 95,
  });

  assert.ok(svg.includes("<svg"), "Must output valid SVG root");
  assert.ok(svg.includes("OC4 Semi Mooring Line 1"), "Must include title");
  assert.ok(svg.includes("Water Depth: 200.0m"), "Must include water depth metadata");
  assert.ok(svg.includes("Mean Water Level"), "Must mark water level");
  assert.ok(svg.includes("Seabed (0m)"), "Must mark seabed level");
  assert.ok(svg.includes("Anchor (0° Uplift)"), "Must include anchor symbol");
  assert.ok(svg.includes("TDP (450.0m)"), "Must mark touchdown point");
  assert.ok(svg.includes("Deepwater Semi-Submersible"), "Must include vessel name label");
  assert.ok(svg.includes("FAIRLEAD TENSION"), "Must include tension HUD card");
});

test("SIMA Diagram Builder: renders overhead polar mooring spread SVG", () => {
  const svg = renderSimaMooringSpreadSvg({
    title: "OC4 Deepwater Spread",
    waterDepth: 200,
    vesselName: "OC4 Semi-Submersible",
    vesselHeadingDeg: 15,
    vesselOffset: { x: 4.5, y: -2.3 },
    watchCircleRadius: 16.0,
    lines: [
      { id: "line_1", name: "Mooring Line 1", fairleadPos: [40, 0, -14], anchorPos: [837.6, 0, -200] },
      { id: "line_2", name: "Mooring Line 2", fairleadPos: [-20, 35, -14], anchorPos: [-418.8, 725.4, -200] },
      { id: "line_3", name: "Mooring Line 3", fairleadPos: [-20, -35, -14], anchorPos: [-418.8, -725.4, -200] },
    ],
    environment: {
      waveDir: 30,
      waveHs: 7.5,
      windDir: 45,
      windSpeed: 22.0,
      currentDir: 60,
      currentSpeed: 1.5,
    },
  });

  assert.ok(svg.includes("<svg"), "Must output valid SVG root");
  assert.ok(svg.includes("OC4 Deepwater Spread"), "Must include title");
  assert.ok(svg.includes("0° (North)"), "Must include compass cardinal headings");
  assert.ok(svg.includes("Watch Circle (16.0m)"), "Must include watch circle boundary");
  assert.ok(svg.includes("Mooring Line 1"), "Must label mooring lines");
  assert.ok(svg.includes("Wave 7.5m"), "Must display wave excitation vector");
  assert.ok(svg.includes("Wind 22m/s"), "Must display wind force vector");
  assert.ok(svg.includes("Curr 1.5m/s"), "Must display current force vector");
});

test("SIMA Diagram Builder: renders multi-segment catenary and 3-column semi-submersible cluster with ALS state", () => {
  const catSvg = renderSimaCatenaryProfileSvg({
    title: "Cluster1_Line1_NNE Catenary",
    waterDepth: 320,
    horizontalSpan: 844,
    lineLength: 895,
    fairleadTotalTension: 6850000,
    horizontalTension: 5400000,
    safetyFactor: 3.09,
    segments: [
      { id: "s1", name: "Bottom_R4_Studless_Chain", length: 220 },
      { id: "s2", name: "Mid_Polyester_Rope", length: 580 },
      { id: "s3", name: "Top_Fairlead_Chain", length: 95 },
    ],
  });

  assert.ok(catSvg.includes("#a855f7"), "Must color polyester rope segment in violet");
  assert.ok(catSvg.includes("SF = 3.09"), "Must render DNV safety factor in HUD");

  const spreadSvg = renderSimaMooringSpreadSvg({
    title: "WindFloat_15MW_SemiSub Mooring Spread",
    waterDepth: 320,
    vesselName: "WindFloat_15MW_SemiSub",
    watchCircleRadius: 25.6,
    selectedLineId: "line_1",
    brokenLineId: "line_2",
    fairleads: [
      { id: "fl_c1", position: [48.5, 0, -18] },
      { id: "fl_c2", position: [-24.25, 42, -18] },
      { id: "fl_c3", position: [-24.25, -42, -18] },
    ],
    lines: [
      {
        id: "line_1",
        name: "Cluster1_Line1_NNE",
        fairleadPos: [48.5, 0, -18],
        anchorPos: [885, 120, -320],
        tension: 6850000,
        safetyFactor: 3.09,
        selected: true,
      },
      {
        id: "line_2",
        name: "Cluster1_Line2_N",
        fairleadPos: [48.5, 0, -18],
        anchorPos: [895, 0, -320],
        broken: true,
      },
      {
        id: "line_5",
        name: "Cluster2_Line5_WSW",
        fairleadPos: [-24.25, 42, -18],
        anchorPos: [-340, 810, -320],
        tension: 5900000,
        safetyFactor: 3.59,
      },
    ],
  });

  assert.ok(spreadSvg.includes("floater-semisub"), "Must render 3-column semi-submersible floater geometry");
  assert.ok(spreadSvg.includes("(SEVERED)"), "Must annotate severed line in ALS mode");
  assert.ok(spreadSvg.includes('data-line-id="line_1"'), "Must include interactive data-line-id attributes");
});
