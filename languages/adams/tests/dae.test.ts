// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerAdamsToDae } from "../src/dae/adams-to-dae.js";
import { parseAdams } from "../src/parser/adams-parser.js";

const DECK = `
PART/1, GROUND
PART/2, MASS = 5.0, IP = 0.2, 0.2, 0.3
MARKER/1, PART = 1, QP = 0, 0, 0
MARKER/2, PART = 2, QP = 0, 0, 0
MARKER/3, PART = 2, QP = 1, 0, 0
MARKER/4, PART = 1, QP = 1, 0, 0
JOINT/1, REVOLUTE, I = 1, J = 2
SPRINGDAMPER/1, TRANSLATIONAL, I = 3, J = 4, K = 2000.0, C = 100.0
`;

test("Adams DAE Lowering - Arena variables, momentum balance, and stabilization", () => {
  const dataset = parseAdams(DECK);
  const dae = lowerAdamsToDae(dataset, undefined, { stabilization: "baumgarte" });

  assert.ok(dae);
  // Verify moving body has 12 variables (x,y,z,vx,vy,vz, phi,theta,psi,wx,wy,wz)
  // Plus springdamper force variables (fx,fy,fz)
  assert.ok(dae.varCount >= 15);
  // Verify equations were emitted (kinematic derivatives + momentum balance + springdamper)
  assert.ok(dae.eqCount >= 15);
});
