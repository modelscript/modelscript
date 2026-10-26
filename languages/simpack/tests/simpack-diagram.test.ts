// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { buildSimpackDiagram, renderSimpackSvg, simpackToKinematicSystem } from "../src/diagram/index.js";
import type { SimpackModel } from "../src/types.js";

const sampleSimpackModel: SimpackModel = {
  name: "Bogie_Suspension_Model",
  bodies: new Map([
    [
      "bogie_frame",
      {
        id: "bogie_frame",
        name: "Bogie Frame",
        mass: 2500,
        inertia: { ixx: 1200, iyy: 1500, izz: 2200 },
        markerId: "$m_frame",
      },
    ],
    [
      "wheelset_1",
      {
        id: "wheelset_1",
        name: "Leading Wheelset",
        mass: 1400,
        inertia: { ixx: 600, iyy: 800, izz: 600 },
        markerId: "$m_ws1",
      },
    ],
  ]),
  markers: new Map([
    [
      "$m_frame",
      {
        id: "$m_frame",
        name: "frame_cm",
        bodyId: "bogie_frame",
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0 },
      },
    ],
    [
      "$m_ws1",
      {
        id: "$m_ws1",
        name: "ws1_cm",
        bodyId: "wheelset_1",
        position: { x: 1, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0 },
      },
    ],
    [
      "$m_track",
      {
        id: "$m_track",
        name: "track_ref",
        bodyId: "$inertial",
        position: { x: 0, y: 0, z: -0.5 },
        orientation: { x: 0, y: 0, z: 0 },
      },
    ],
  ]),
  joints: new Map([
    [
      "primary_axle_joint",
      {
        id: "primary_axle_joint",
        name: "Axle Bearing Pin",
        type: "revolute",
        fromMarker: "$m_frame",
        toMarker: "$m_ws1",
        dofCount: 1,
      },
    ],
  ]),
  forces: new Map([
    [
      "primary_spring",
      {
        id: "primary_spring",
        name: "Primary Coil Spring",
        type: "spring_damper",
        markerA: "$m_frame",
        markerB: "$m_ws1",
        stiffness: { x: 200000, y: 200000, z: 800000 },
        damping: { x: 5000, y: 5000, z: 20000 },
      },
    ],
  ]),
};

test("SIMPACK Diagram: Translates SimpackModel to KinematicSystem and X6 graph", () => {
  const system = simpackToKinematicSystem(sampleSimpackModel);
  assert.equal(system.title, "Bogie_Suspension_Model");
  assert.equal(system.bodies.length, 3); // bogie_frame, wheelset_1, and ground ($inertial)
  assert.equal(system.joints.length, 1);
  assert.equal(system.forces?.length, 1);

  const diag = buildSimpackDiagram(sampleSimpackModel);
  assert.ok(diag.cells.length >= 5);
  const frameCell = diag.cells.find((c) => c.id === "body_bogie_frame");
  assert.ok(frameCell);
  assert.ok(frameCell.label?.includes("2500.0 kg"));
});

test("SIMPACK SVG: Generates standalone vector SVG schematic", () => {
  const svg = renderSimpackSvg(sampleSimpackModel);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("Bogie_Suspension_Model"));
  assert.ok(svg.includes("Bogie Frame"));
  assert.ok(svg.includes("Leading Wheelset"));
  assert.ok(svg.includes("↻") || svg.includes("revolute"));
  assert.ok(svg.includes("primary_spring"));
  assert.ok(svg.endsWith("</svg>\n"));
});
