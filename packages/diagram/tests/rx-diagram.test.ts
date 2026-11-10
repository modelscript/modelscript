// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { renderRxDiagramSvg, type RxZoneGraphic } from "../src/rx-diagram-builder.js";

const sampleZones: RxZoneGraphic[] = [
  {
    zoneNumber: 1,
    characteristic: "mho",
    reachOhm: 10.0,
    lineAngleDeg: 75.0,
  },
  {
    zoneNumber: 2,
    characteristic: "mho",
    reachOhm: 15.0,
    lineAngleDeg: 75.0,
  },
  {
    zoneNumber: 3,
    characteristic: "quadrilateral",
    reachOhm: 25.0,
    lineAngleDeg: 75.0,
    resistanceReachOhm: 20.0,
  },
];

test("renderRxDiagramSvg: generates standalone SVG with Mho circles and Quad envelopes", () => {
  const svg = renderRxDiagramSvg({
    title: "Substation Alpha Distance Protection",
    zones: sampleZones,
    trajectory: [
      { tSec: 0.0, rOhm: 30.0, xOhm: 20.0 },
      { tSec: 0.04, rOhm: 2.0, xOhm: 6.0 },
    ],
    tripPoint: { tSec: 0.04, rOhm: 2.0, xOhm: 6.0, zone: 1 },
  });

  assert.ok(svg.includes("<svg"));
  assert.ok(svg.includes("Zone 1"));
  assert.ok(svg.includes("Zone 2"));
  assert.ok(svg.includes("Zone 3 (Quad)"));
  assert.ok(svg.includes("TRIP Zone 1"));
  assert.ok(svg.includes("Z_app(t) Trajectory"));
  assert.ok(svg.includes("</svg>"));
});
