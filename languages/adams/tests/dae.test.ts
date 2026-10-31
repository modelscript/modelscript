// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  compileAdamsFunctionToDae,
  evaluateAdamsFunction,
  getJointConstraintSpec,
  lowerAdamsToDae,
} from "../src/dae/adams-to-dae.js";
import { parseAdams } from "../src/parser/adams-parser.js";

const DECK = `
PART/1, GROUND
PART/2, MASS = 5.0, IP = 0.2, 0.2, 0.3
MARKER/1, PART = 1, QP = 0, 0, 0
MARKER/2, PART = 2, QP = 0, 0, 0
MARKER/3, PART = 2, QP = 1, 0.5, 0.25
MARKER/4, PART = 1, QP = 1, 0, 0
JOINT/1, REVOLUTE, I = 1, J = 2
SPRINGDAMPER/1, TRANSLATIONAL, I = 3, J = 4, K = 2000.0, C = 100.0
`;

test("Adams DAE Lowering - Arena variables, momentum balance, and stabilization", () => {
  const dataset = parseAdams(DECK);
  const dae = lowerAdamsToDae(dataset, undefined, { stabilization: "baumgarte" });

  assert.ok(dae);
  // 1 moving body (12 vars) + 1 springdamper (3 vars) = 15 vars & 15 eqs
  assert.equal(dae.varCount, 15);
  assert.equal(dae.eqCount, 15);

  const referencedVars = new Set<string>();
  for (const eq of dae.getEquations()) {
    dae.collectExprVarNames(eq.lhs, referencedVars);
    dae.collectExprVarNames(eq.rhs, referencedVars);
  }
  // Verify 3D rotational lever arm terms (theta * sz - psi * sy) are emitted for offset MARKER/3
  assert.ok(referencedVars.has("2.theta") && referencedVars.has("2.psi"));
});

test("Adams DAE Lowering - Algebraic Lagrange multipliers for REVOLUTE, UNIVERSAL, CYLINDRICAL, FIXED", () => {
  const algebraicDeck = `
PART/1, GROUND
PART/2, MASS = 4.0, IP = 0.1, 0.2, 0.3
PART/3, MASS = 3.0, IP = 0.1, 0.1, 0.1
MARKER/10, PART = 1, QP = 0, 0, 0
MARKER/20, PART = 2, QP = 0.5, 0.2, 0.1
MARKER/21, PART = 2, QP = 1.0, 0, 0
MARKER/30, PART = 3, QP = 0, 0.3, 0
JOINT/1, REVOLUTE, I = 10, J = 20
JOINT/2, UNIVERSAL, I = 21, J = 30
`;
  const dataset = parseAdams(algebraicDeck);
  const dae = lowerAdamsToDae(dataset, undefined, { stabilization: "algebraic" });

  // 2 moving bodies (24 vars) + REVOLUTE (5 multipliers) + UNIVERSAL (4 multipliers) = 33
  assert.equal(dae.varCount, 33);
  assert.equal(dae.eqCount, 33);

  const varNames = dae.getVariables().map((v) => v.name);
  // REVOLUTE has 5 Lagrange multipliers lam_1_0 .. lam_1_4
  for (let k = 0; k < 5; k++) {
    assert.ok(varNames.includes(`lam_1_${k}`), `Missing lam_1_${k}`);
  }
  // UNIVERSAL has 4 Lagrange multipliers lam_2_0 .. lam_2_3
  for (let k = 0; k < 4; k++) {
    assert.ok(varNames.includes(`lam_2_${k}`), `Missing lam_2_${k}`);
  }

  // Verify constraint counts for all canonical joint types
  assert.equal(
    getJointConstraintSpec({ id: 1, name: "j", type: "SPHERICAL", iMarkerId: 1, jMarkerId: 2, dofCount: 3 }).transAxes
      .length,
    3,
  );
  assert.equal(
    getJointConstraintSpec({ id: 1, name: "j", type: "CYLINDRICAL", iMarkerId: 1, jMarkerId: 2, dofCount: 2 }).transAxes
      .length +
      getJointConstraintSpec({ id: 1, name: "j", type: "CYLINDRICAL", iMarkerId: 1, jMarkerId: 2, dofCount: 2 }).rotAxes
        .length,
    4,
  );
  assert.equal(
    getJointConstraintSpec({ id: 1, name: "j", type: "TRANSLATIONAL", iMarkerId: 1, jMarkerId: 2, dofCount: 1 })
      .transAxes.length +
      getJointConstraintSpec({ id: 1, name: "j", type: "TRANSLATIONAL", iMarkerId: 1, jMarkerId: 2, dofCount: 1 })
        .rotAxes.length,
    5,
  );
  assert.equal(
    getJointConstraintSpec({ id: 1, name: "j", type: "FIXED", iMarkerId: 1, jMarkerId: 2, dofCount: 0 }).transAxes
      .length +
      getJointConstraintSpec({ id: 1, name: "j", type: "FIXED", iMarkerId: 1, jMarkerId: 2, dofCount: 0 }).rotAxes
        .length,
    6,
  );
});

test("Adams DAE Lowering - FUNCTION= expressions (STEP, SHF, POLY, DX, VX, SIN, degree suffix D)", () => {
  const funcDeck = `
PART/1, GROUND
PART/2, MASS = 2.0, IP = 0.1, 0.1, 0.1
MARKER/1, PART = 1, QP = 0, 0, 0
MARKER/2, PART = 2, QP = 0, 0, 1.0
JOINT/1, TRANSLATIONAL, I = 1, J = 2
SFORCE/10, TRANSLATIONAL, I = 2, J = 1, FUNCTION = STEP(TIME, 0.0, 0.0, 1.0, 50.0) + SHF(TIME, 0.0, 10.0, 180D, 0.0, 0.0) - 20.0 * DZ(2, 1) - 5.0 * VZ(2, 1)
MOTION/20, JOINT = 1, TRANSLATIONAL, FUNCTION = POLY(TIME, 0.0, 0.0, 1.5, 0.25)
`;
  const dataset = parseAdams(funcDeck);
  const dae = lowerAdamsToDae(dataset, undefined, { stabilization: "algebraic" });

  // 1 body (12) + TRANSLATIONAL joint (5 lam) + SFORCE (3) + MOTION (1) = 21 vars & 21 eqs
  assert.equal(dae.varCount, 21);
  assert.equal(dae.eqCount, 21);

  const referencedVars = new Set<string>();
  for (const eq of dae.getEquations()) {
    dae.collectExprVarNames(eq.lhs, referencedVars);
    dae.collectExprVarNames(eq.rhs, referencedVars);
  }
  assert.ok(referencedVars.has("time"));
  assert.ok(referencedVars.has("2.z"));
  assert.ok(referencedVars.has("2.vz"));
  assert.ok(referencedVars.has("motion_20"));

  // Verify numerical evaluation of STEP, SHF, POLY, and degree suffix D
  assert.ok(Math.abs(evaluateAdamsFunction("STEP(0.5, 0.0, 0.0, 1.0, 100.0)") - 50.0) < 1e-9);
  assert.ok(Math.abs(evaluateAdamsFunction("STEP(2.0, 0.0, 0.0, 1.0, 100.0)") - 100.0) < 1e-9);
  assert.ok(Math.abs(evaluateAdamsFunction("POLY(2.0, 0.0, 1.0, 3.0, 2.0)") - (1 + 3 * 2 + 2 * 4)) < 1e-9);
  assert.ok(Math.abs(evaluateAdamsFunction("SIN(90D)") - 1.0) < 1e-9);
  assert.ok(compileAdamsFunctionToDae("TIME * 2.0", dae, dataset) >= 0);
});
