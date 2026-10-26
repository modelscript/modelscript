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
