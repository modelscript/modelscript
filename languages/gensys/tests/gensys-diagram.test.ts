// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { buildGensysDiagram, gensysToKinematicSystem, renderGensysSvg } from "../src/diagram/index.js";
import type { GensysModel } from "../src/types.js";

const sampleGensysModel: GensysModel = {
  name: "PassengerCoach_CoCo",
  subsystems: [],
  bodies: new Map([
    [
      "carbody",
      {
        name: "carbody",
        mass: 32000,
        inertia: { jx: 45000, jy: 1800000, jz: 1800000 },
        position: { x: 0, y: 0, z: 1.8 },
      },
    ],
    [
      "bogie_front",
      {
        name: "bogie_front",
        mass: 4200,
        inertia: { jx: 2800, jy: 4500, jz: 6800 },
        position: { x: 8.5, y: 0, z: 0.6 },
      },
    ],
  ]),
  wheelsets: new Map([
    [
      "ws1",
      {
        name: "ws1",
        mass: 1500,
        inertia: { jx: 800, jy: 150, jz: 800 },
        gauge: 1.435,
        wheelRadius: 0.46,
        conicity: 0.1,
      },
    ],
  ]),
  couplings: new Map([
    [
      "secondary_airspring",
      {
        name: "secondary_airspring",
        type: "linear",
        body1: "carbody",
        body2: "bogie_front",
        attachPoint1: { x: 8.5, y: 1.0, z: 1.2 },
        attachPoint2: { x: 8.5, y: 1.0, z: 0.8 },
        stiffness: { x: 180000, y: 180000, z: 450000 },
        damping: { x: 15000, y: 15000, z: 30000 },
      },
    ],
    [
      "primary_coil",
      {
        name: "primary_coil",
        type: "linear",
        body1: "bogie_front",
        body2: "ws1",
        attachPoint1: { x: 8.5, y: 1.0, z: 0.6 },
        attachPoint2: { x: 8.5, y: 1.0, z: 0.46 },
        stiffness: { x: 1200000, y: 1200000, z: 800000 },
        damping: { x: 25000, y: 25000, z: 20000 },
      },
    ],
  ]),
};

test("GENSYS Diagram: Translates GensysModel to KinematicSystem and X6 graph", () => {
  const system = gensysToKinematicSystem(sampleGensysModel);
  assert.equal(system.title, "PassengerCoach_CoCo");
  assert.equal(system.bodies.length, 3); // carbody, bogie_front, ws1
  assert.equal(system.forces?.length, 2); // secondary_airspring, primary_coil

  const diag = buildGensysDiagram(sampleGensysModel);
  assert.ok(diag.cells.length >= 5);
  const carCell = diag.cells.find((c) => c.id === "body_carbody");
  assert.ok(carCell);
  assert.ok(carCell.label?.includes("32000.0 kg"));
});

test("GENSYS SVG: Generates standalone vector SVG schematic", () => {
  const svg = renderGensysSvg(sampleGensysModel);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("PassengerCoach_CoCo"));
  assert.ok(svg.includes("carbody"));
  assert.ok(svg.includes("bogie_front"));
  assert.ok(svg.includes("ws1 (Wheelset)"));
  assert.ok(svg.includes("secondary_airspring"));
  assert.ok(svg.includes("primary_coil"));
  assert.ok(svg.endsWith("</svg>\n"));
});
