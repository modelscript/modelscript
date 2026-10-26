// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { adamsToKinematicSystem, buildAdamsDiagram, renderAdamsSvg } from "../src/diagram/index.js";
import type { AdamsDataset } from "../src/types.js";

const sampleAdamsDataset: AdamsDataset = {
  title: "SliderCrank_Mechanism",
  parts: new Map([
    ["1", { id: "1", name: "ground", isGround: true, mass: 0, inertia: { ixx: 0, iyy: 0, izz: 0 } }],
    ["2", { id: "2", name: "crank", isGround: false, mass: 1.5, inertia: { ixx: 0.02, iyy: 0.05, izz: 0.05 } }],
    ["3", { id: "3", name: "conrod", isGround: false, mass: 2.2, inertia: { ixx: 0.04, iyy: 0.12, izz: 0.12 } }],
    ["4", { id: "4", name: "piston", isGround: false, mass: 0.8, inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 } }],
  ]),
  markers: new Map([
    [
      "101",
      {
        id: "101",
        name: "m_crank_base",
        partId: "2",
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0 },
        useEuler: false,
      },
    ],
    [
      "102",
      {
        id: "102",
        name: "m_ground_base",
        partId: "1",
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0 },
        useEuler: false,
      },
    ],
    [
      "201",
      {
        id: "201",
        name: "m_crank_pin",
        partId: "2",
        position: { x: 0.2, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0 },
        useEuler: false,
      },
    ],
    [
      "202",
      {
        id: "202",
        name: "m_conrod_big",
        partId: "3",
        position: { x: 0.2, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0 },
        useEuler: false,
      },
    ],
    [
      "301",
      {
        id: "301",
        name: "m_conrod_small",
        partId: "3",
        position: { x: 0.6, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0 },
        useEuler: false,
      },
    ],
    [
      "302",
      {
        id: "302",
        name: "m_piston_pin",
        partId: "4",
        position: { x: 0.6, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0 },
        useEuler: false,
      },
    ],
    [
      "401",
      {
        id: "401",
        name: "m_piston_slider",
        partId: "4",
        position: { x: 0.6, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0 },
        useEuler: false,
      },
    ],
    [
      "402",
      {
        id: "402",
        name: "m_ground_rail",
        partId: "1",
        position: { x: 0.6, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0 },
        useEuler: false,
      },
    ],
  ]),
  joints: new Map([
    ["1", { id: "1", name: "rev_crank_ground", type: "REVOLUTE", iMarkerId: "101", jMarkerId: "102", dofCount: 1 }],
    ["2", { id: "2", name: "rev_crank_conrod", type: "REVOLUTE", iMarkerId: "201", jMarkerId: "202", dofCount: 1 }],
    ["3", { id: "3", name: "rev_conrod_piston", type: "REVOLUTE", iMarkerId: "301", jMarkerId: "302", dofCount: 1 }],
    [
      "4",
      { id: "4", name: "trans_piston_ground", type: "TRANSLATIONAL", iMarkerId: "401", jMarkerId: "402", dofCount: 1 },
    ],
  ]),
  forces: new Map([
    [
      "10",
      {
        id: "10",
        name: "gas_force",
        type: "SPRINGDAMPER",
        iMarkerId: "401",
        jMarkerId: "402",
        stiffness: 5000,
        damping: 200,
      },
    ],
  ]),
  motions: new Map(),
  requests: new Map(),
};

test("Adams Diagram: Translates AdamsDataset to KinematicSystem and X6 graph", () => {
  const system = adamsToKinematicSystem(sampleAdamsDataset);
  assert.equal(system.title, "SliderCrank_Mechanism");
  assert.equal(system.bodies.length, 4); // ground, crank, conrod, piston
  assert.equal(system.joints.length, 4);
  assert.equal(system.forces?.length, 1);

  const diag = buildAdamsDiagram(sampleAdamsDataset);
  assert.equal(diag.cells.length, 9); // 4 bodies + 4 joints + 1 force
  const crankCell = diag.cells.find((c) => c.id === "body_2");
  assert.ok(crankCell);
  assert.ok(crankCell.label?.includes("1.5 kg"));
});

test("Adams SVG: Generates standalone vector SVG schematic", () => {
  const svg = renderAdamsSvg(sampleAdamsDataset);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("SliderCrank_Mechanism"));
  assert.ok(svg.includes("ground"));
  assert.ok(svg.includes("crank"));
  assert.ok(svg.includes("conrod"));
  assert.ok(svg.includes("piston"));
  assert.ok(svg.includes("gas_force"));
  assert.ok(svg.endsWith("</svg>\n"));
});
