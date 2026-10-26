// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { analyzeAdamsMobility, lintAdamsModel } from "../src/lints/rules.js";
import { parseAdams } from "../src/parser/adams-parser.js";

test("Adams Linter - Mobility Analysis (Grübler-Kutzbach)", () => {
  // 1 ground + 3 moving bodies = 4 bodies total
  // 4 revolute joints (each removes 5 DOF) => 20 constraints
  // M = 6 * 3 - 20 = 18 - 20 = -2 in 3D spatial (overconstrained if all 4 are 3D revolute)
  const deck = `
PART/1, GROUND
PART/2, MASS = 1.0, IP = 0.1, 0.1, 0.1
PART/3, MASS = 1.0, IP = 0.1, 0.1, 0.1
PART/4, MASS = 1.0, IP = 0.1, 0.1, 0.1
MARKER/1, PART=1, QP=0,0,0
MARKER/2, PART=2, QP=0,0,0
MARKER/3, PART=2, QP=1,0,0
MARKER/4, PART=3, QP=1,0,0
MARKER/5, PART=3, QP=2,0,0
MARKER/6, PART=4, QP=2,0,0
MARKER/7, PART=4, QP=0,0,0
MARKER/8, PART=1, QP=0,0,0
JOINT/1, REVOLUTE, I=1, J=2
JOINT/2, REVOLUTE, I=3, J=4
JOINT/3, REVOLUTE, I=5, J=6
JOINT/4, REVOLUTE, I=7, J=8
`;
  const dataset = parseAdams(deck);
  const mobility = analyzeAdamsMobility(dataset);

  assert.equal(mobility.numBodies, 4);
  assert.equal(mobility.numJoints, 4);
  assert.equal(mobility.totalConstraintEquations, 20);
  assert.equal(mobility.calculatedMobility, -2);
  assert.equal(mobility.isOverconstrained, true);

  const diags = lintAdamsModel(dataset);
  const m7301 = diags.find((d) => d.code === "M7301");
  assert.ok(m7301);
  assert.equal(m7301.severity, "warning");
});

test("Adams Linter - M7309: Missing ground part", () => {
  const deck = `
PART/2, MASS = 1.0, IP = 0.1, 0.1, 0.1
MARKER/1, PART=2, QP=0,0,0
`;
  const dataset = parseAdams(deck);
  const diags = lintAdamsModel(dataset);
  const m7309 = diags.find((d) => d.code === "M7309");
  assert.ok(m7309);
  assert.equal(m7309.severity, "error");
  assert.ok(m7309.quickFix);
});

test("Adams Linter - M7303: Dangling marker references", () => {
  const deck = `
PART/1, GROUND
PART/2, MASS = 1.0, CM = 999, IP = 0.1, 0.1, 0.1
MARKER/1, PART=1, QP=0,0,0
JOINT/1, REVOLUTE, I=1, J=888
SPRINGDAMPER/1, TRANSLATIONAL, I=1, J=777, K=100, C=10
`;
  const dataset = parseAdams(deck);
  const diags = lintAdamsModel(dataset);

  const dangling = diags.filter((d) => d.code === "M7303");
  assert.equal(dangling.length, 3);
  assert.ok(dangling.some((d) => d.message.includes("CM marker '999'")));
  assert.ok(dangling.some((d) => d.message.includes("marker '888'")));
  assert.ok(dangling.some((d) => d.message.includes("marker '777'")));
});

test("Adams Linter - M7304: Non-physical inertia tensor violating triangle inequalities", () => {
  const deck = `
PART/1, GROUND
PART/2, MASS = 1.0, IP = 0.01, 0.02, 0.50
MARKER/1, PART=1, QP=0,0,0
MARKER/2, PART=2, QP=0,0,0
JOINT/1, REVOLUTE, I=1, J=2
`;
  const dataset = parseAdams(deck);
  const diags = lintAdamsModel(dataset);

  const m7304 = diags.find((d) => d.code === "M7304");
  assert.ok(m7304);
  assert.equal(m7304.severity, "error");
  assert.ok(m7304.message.includes("violates physical rigid body triangle inequalities"));
});

test("Adams Linter - M7305: Massless moving part", () => {
  const deck = `
PART/1, GROUND
PART/2, MASS = 0.0, IP = 0.1, 0.1, 0.1
MARKER/1, PART=1, QP=0,0,0
MARKER/2, PART=2, QP=0,0,0
JOINT/1, REVOLUTE, I=1, J=2
`;
  const dataset = parseAdams(deck);
  const diags = lintAdamsModel(dataset);

  const m7305 = diags.find((d) => d.code === "M7305");
  assert.ok(m7305);
  assert.equal(m7305.severity, "error");
  assert.ok(m7305.message.includes("zero or negative mass"));
});

test("Adams Linter - M7308: Negative spring stiffness or damping", () => {
  const deck = `
PART/1, GROUND
PART/2, MASS = 1.0, IP = 0.1, 0.1, 0.1
MARKER/1, PART=1, QP=0,0,0
MARKER/2, PART=2, QP=0,0,0
SPRINGDAMPER/1, TRANSLATIONAL, I=1, J=2, K=-500.0, C=-10.0
`;
  const dataset = parseAdams(deck);
  const diags = lintAdamsModel(dataset);

  const m7308 = diags.filter((d) => d.code === "M7308");
  assert.equal(m7308.length, 2);
});
