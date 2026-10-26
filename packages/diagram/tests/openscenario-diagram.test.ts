// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenScenarioDiagram,
  getEntityColor,
  renderOpenScenarioSvg,
  type OscScenarioLike,
} from "../src/openscenario-diagram-builder.js";

const sampleScenario: OscScenarioLike = {
  title: "Highway Cut-In Safety Verification",
  roadLengthMeters: 200,
  laneCount: 3,
  entities: [
    { name: "EgoVehicle", role: "ego", speed: 28.0, x: 40.0, lane: 2 },
    { name: "TargetCar", role: "target", speed: 25.0, x: 85.0, lane: 3 },
    { name: "SlowTruck", role: "obstacle", speed: 18.0, x: 140.0, lane: 1 },
  ],
  safety: {
    ttcSec: 2.1,
    minDistanceMeters: 24.5,
    rssViolated: false,
  },
};

test("OpenSCENARIO Entity Colors: Maps actor roles to indicator colors", () => {
  assert.equal(getEntityColor("ego"), "#10b981"); // Emerald
  assert.equal(getEntityColor("target"), "#f43f5e"); // Rose Cut-In
  assert.equal(getEntityColor("obstacle"), "#facc15"); // Amber
});

test("OpenSCENARIO Diagram: Builds X6 graph cells for road bed, vehicles, velocity vectors, and RSS envelope", () => {
  const diag = buildOpenScenarioDiagram(sampleScenario);
  assert.equal(diag.title, "Highway Cut-In Safety Verification");
  assert.ok(diag.cells.length >= 7);

  const road = diag.cells.find((c) => c.id === "roadway_corridor");
  assert.ok(road);
  assert.equal(road.shape, "rect");

  const ego = diag.cells.find((c) => c.id === "ent_EgoVehicle");
  assert.ok(ego);
  assert.equal((ego.data as any)?.role, "ego");

  const target = diag.cells.find((c) => c.id === "ent_TargetCar");
  assert.ok(target);

  const rss = diag.cells.find((c) => c.id === "safety_envelope");
  assert.ok(rss);
  assert.ok(rss.label?.includes("24.5m"));
});

test("OpenSCENARIO SVG: Renders standalone 2D bird's-eye view with lane markings and actors", () => {
  const svg = renderOpenScenarioSvg(sampleScenario);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("Highway Cut-In Safety Verification"));
  assert.ok(svg.includes("EgoVehicle"));
  assert.ok(svg.includes("TargetCar"));
  assert.ok(svg.includes("SlowTruck"));
  assert.ok(svg.includes("RSS: 24.5m"));
  assert.ok(svg.includes('stroke-dasharray="14,10"')); // Dashed lane divider
  assert.ok(svg.endsWith("</svg>\n"));
});
