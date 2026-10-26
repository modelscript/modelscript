// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKinematicDiagram,
  renderKinematicSvg,
  type KinematicSystemLike,
} from "../src/kinematic-diagram-builder.js";

const sampleMechanism: KinematicSystemLike = {
  title: "Four-Bar Multibody Mechanism",
  bodies: [
    { id: "ground", name: "Ground", isGround: true },
    { id: "crank", name: "Crank", mass: 2.5, inertia: { ixx: 0.05, iyy: 0.1, izz: 0.1 } },
    { id: "coupler", name: "Coupler", mass: 4.0, inertia: { ixx: 0.1, iyy: 0.25, izz: 0.25 } },
    { id: "rocker", name: "Rocker", mass: 3.2, inertia: { ixx: 0.08, iyy: 0.15, izz: 0.15 } },
  ],
  joints: [
    { id: "j_ground_crank", name: "Ground-Crank Pin", type: "revolute", fromBody: "ground", toBody: "crank" },
    { id: "j_crank_coupler", name: "Crank-Coupler Pin", type: "revolute", fromBody: "crank", toBody: "coupler" },
    { id: "j_coupler_rocker", name: "Coupler-Rocker Pin", type: "spherical", fromBody: "coupler", toBody: "rocker" },
    { id: "j_rocker_ground", name: "Rocker-Ground Slider", type: "prismatic", fromBody: "rocker", toBody: "ground" },
  ],
  forces: [
    { id: "spring_crank_rocker", type: "spring", body1: "crank", body2: "rocker", stiffness: 1500, damping: 50 },
  ],
};

test("Kinematic Diagram: Builds AntV X6 graph model with bodies, joints, and forces", () => {
  const diag = buildKinematicDiagram(sampleMechanism);
  assert.equal(diag.title, "Four-Bar Multibody Mechanism");

  // 4 bodies + 4 joints + 1 force = 9 cells
  assert.equal(diag.cells.length, 9);

  const groundCell = diag.cells.find((c) => c.id === "body_ground");
  assert.ok(groundCell);
  assert.equal(groundCell.shape, "rect");
  assert.ok(groundCell.label?.includes("Ground"));

  const crankCell = diag.cells.find((c) => c.id === "body_crank");
  assert.ok(crankCell);
  assert.ok(crankCell.label?.includes("2.5 kg"));

  const revJoint = diag.cells.find((c) => c.id === "joint_j_ground_crank");
  assert.ok(revJoint);
  assert.equal(revJoint.shape, "edge");
  assert.ok(revJoint.label?.includes("revolute"));

  const forceCell = diag.cells.find((c) => c.id === "force_spring_crank_rocker");
  assert.ok(forceCell);
  assert.equal(forceCell.shape, "edge");
  assert.ok(forceCell.label?.includes("spring"));
});

test("Kinematic SVG: Renders vector SVG schematic in dark and light modes", () => {
  const darkSvg = renderKinematicSvg(sampleMechanism, { isDark: true });
  assert.ok(darkSvg.startsWith("<svg"));
  assert.ok(darkSvg.includes("Four-Bar Multibody Mechanism"));
  assert.ok(darkSvg.includes("Ground"));
  assert.ok(darkSvg.includes("Crank"));
  assert.ok(darkSvg.includes("Coupler"));
  assert.ok(darkSvg.includes("Rocker"));
  // Joint glyph symbols
  assert.ok(darkSvg.includes("↻") || darkSvg.includes("revolute")); // revolute glyph
  assert.ok(darkSvg.includes("↔") || darkSvg.includes("prismatic")); // prismatic glyph
  assert.ok(darkSvg.includes("⨁") || darkSvg.includes("spherical")); // spherical glyph
  assert.ok(darkSvg.includes("1500 N/m")); // spring force label
  assert.ok(darkSvg.endsWith("</svg>\n"));

  const lightSvg = renderKinematicSvg(sampleMechanism, { isDark: false });
  assert.ok(lightSvg.startsWith("<svg"));
  assert.ok(lightSvg.includes("#ffffff") || lightSvg.includes("#f8fafc"));
});
