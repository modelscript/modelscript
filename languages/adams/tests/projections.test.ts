// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseAdams } from "../src/parser/adams-parser.js";
import { adamsToModelica } from "../src/projections/modelica.js";
import { adamsToSimpack, simpackToAdams } from "../src/projections/simpack.js";

const DECK = `
PART/1, GROUND
PART/2, MASS = 3.5, IP = 0.1, 0.15, 0.12
MARKER/1, PART = 1, QP = 0.0, 0.0, 0.0
MARKER/2, PART = 2, QP = 0.0, 0.0, 0.0
JOINT/1, REVOLUTE, I = 1, J = 2
SPRINGDAMPER/1, TRANSLATIONAL, I = 1, J = 2, K = 1200.0, C = 60.0
`;

test("Adams Projections - Modelica.Mechanics.MultiBody", () => {
  const dataset = parseAdams(DECK);
  const mo = adamsToModelica(dataset);

  assert.ok(mo.includes("model adams_model"));
  assert.ok(mo.includes("MultiBody.World world"));
  assert.ok(mo.includes("Parts.Body part_2(m = 3.5"));
  assert.ok(mo.includes("Joints.Revolute(n = {0, 0, 1}) joint_1"));
  assert.ok(mo.includes("Forces.SpringDamper force_1(c = 1200, d = 60"));
  assert.ok(mo.includes("connect("));
});

test("Adams Projections - Bidirectional SIMPACK projection", () => {
  const dataset = parseAdams(DECK);
  const simpackModel = adamsToSimpack(dataset);

  assert.equal(simpackModel.bodies.size, 2);
  assert.equal(simpackModel.markers.size, 2);
  assert.equal(simpackModel.joints.size, 1);
  assert.equal(simpackModel.forces.size, 1);

  // Round-trip back to Adams
  const roundTripAdams = simpackToAdams(simpackModel);
  assert.equal(roundTripAdams.parts.size, dataset.parts.size);
  assert.equal(roundTripAdams.markers.size, dataset.markers.size);
  assert.equal(roundTripAdams.joints.size, dataset.joints.size);
  assert.equal(roundTripAdams.forces.size, dataset.forces.size);
});
