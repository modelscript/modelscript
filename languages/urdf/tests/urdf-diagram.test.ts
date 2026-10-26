// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { buildUrdfDiagram, renderUrdfSvg, urdfToKinematicSystem } from "../src/diagram/index.js";
import type { UrdfRobot } from "../src/types.js";

const sampleUrdfRobot: UrdfRobot = {
  name: "TwoLinkManipulator",
  links: new Map([
    [
      "base_link",
      {
        name: "base_link",
        visuals: [],
        collisions: [],
        inertial: { mass: 10.0, ixx: 0.1, ixy: 0, ixz: 0, iyy: 0.1, iyz: 0, izz: 0.1 },
      },
    ],
    [
      "link_1",
      {
        name: "link_1",
        visuals: [],
        collisions: [],
        inertial: { mass: 3.5, ixx: 0.05, ixy: 0, ixz: 0, iyy: 0.05, iyz: 0, izz: 0.02 },
      },
    ],
    [
      "link_2",
      {
        name: "link_2",
        visuals: [],
        collisions: [],
        inertial: { mass: 1.8, ixx: 0.02, ixy: 0, ixz: 0, iyy: 0.02, iyz: 0, izz: 0.01 },
      },
    ],
  ]),
  joints: new Map([
    [
      "joint_1",
      {
        name: "joint_1",
        type: "revolute",
        parentLink: "base_link",
        childLink: "link_1",
        axis: { x: 0, y: 0, z: 1 },
        limits: { lower: -Math.PI, upper: Math.PI, effort: 100, velocity: 5 },
      },
    ],
    [
      "joint_2",
      {
        name: "joint_2",
        type: "revolute",
        parentLink: "link_1",
        childLink: "link_2",
        axis: { x: 0, y: 1, z: 0 },
        limits: { lower: -Math.PI / 2, upper: Math.PI / 2, effort: 50, velocity: 8 },
      },
    ],
  ]),
  materials: new Map(),
};

test("URDF Diagram: Translates UrdfRobot to KinematicSystem and X6 graph", () => {
  const system = urdfToKinematicSystem(sampleUrdfRobot);
  assert.equal(system.title, "TwoLinkManipulator");
  assert.equal(system.bodies.length, 3); // base_link, link_1, link_2
  assert.equal(system.joints.length, 2);

  const diag = buildUrdfDiagram(sampleUrdfRobot);
  assert.equal(diag.cells.length, 5); // 3 bodies + 2 joints
  const baseCell = diag.cells.find((c) => c.id === "body_base_link");
  assert.ok(baseCell);
  assert.ok(baseCell.label?.includes("10.0 kg"));
});

test("URDF SVG: Generates standalone vector SVG schematic", () => {
  const svg = renderUrdfSvg(sampleUrdfRobot);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("TwoLinkManipulator"));
  assert.ok(svg.includes("base_link"));
  assert.ok(svg.includes("link_1"));
  assert.ok(svg.includes("link_2"));
  assert.ok(svg.includes("joint_1"));
  assert.ok(svg.includes("joint_2"));
  assert.ok(svg.includes("↻") || svg.includes("revolute"));
  assert.ok(svg.endsWith("</svg>\n"));
});
