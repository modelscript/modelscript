// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseAdams, parseAdamsNumber, serializeAdams } from "../src/parser/adams-parser.js";

const SAMPLE_FOUR_BAR_ADM = `!------------------------------------------------------------------
! MSC Adams Dataset: Four Bar Linkage
!------------------------------------------------------------------
ADAMS/
!
!----------------------------------- PARTS ------------------------
PART/1, GROUND
!
PART/2, MASS = 2.5 &
  , CM = 201 &
  , IP = 0.05, 0.08, 0.06
!
PART/3, MASS = 4.2 &
  , CM = 301 &
  , IP = 0.12, 0.18, 0.15
!
PART/4, MASS = 3.0 &
  , CM = 401 &
  , IP = 0.08, 0.10, 0.09
!
!---------------------------------- MARKERS -----------------------
MARKER/101, PART = 1, QP = 0.0, 0.0, 0.0, REULER = 0.0, 0.0, 0.0
MARKER/102, PART = 1, QP = 1.0, 0.0, 0.0, REULER = 0.0, 0.0, 0.0
!
MARKER/201, PART = 2, QP = 0.0, 0.25, 0.0, REULER = 0.0, 0.0, 0.0
MARKER/202, PART = 2, QP = 0.0, 0.0, 0.0, REULER = 0.0, 0.0, 0.0
MARKER/203, PART = 2, QP = 0.0, 0.5, 0.0, REULER = 0.0, 0.0, 0.0
!
MARKER/301, PART = 3, QP = 0.5, 0.5, 0.0, REULER = 0.0, 0.0, 0.0
MARKER/302, PART = 3, QP = 0.0, 0.5, 0.0, REULER = 0.0, 0.0, 0.0
MARKER/303, PART = 3, QP = 1.0, 0.5, 0.0, REULER = 0.0, 0.0, 0.0
!
MARKER/401, PART = 4, QP = 1.0, 0.25, 0.0, REULER = 0.0, 0.0, 0.0
MARKER/402, PART = 4, QP = 1.0, 0.5, 0.0, REULER = 0.0, 0.0, 0.0
MARKER/403, PART = 4, QP = 1.0, 0.0, 0.0, REULER = 0.0, 0.0, 0.0
!
!----------------------------------- JOINTS -----------------------
JOINT/1, REVOLUTE, I = 101, J = 202
JOINT/2, REVOLUTE, I = 203, J = 302
JOINT/3, REVOLUTE, I = 303, J = 402
JOINT/4, REVOLUTE, I = 403, J = 102
!
!----------------------------------- FORCES -----------------------
SPRINGDAMPER/1, TRANSLATIONAL, I = 203, J = 402, K = 1500.0, C = 75.0, LENGTH = 1.0
!
!---------------------------------- MOTIONS -----------------------
MOTION/1, JOINT = 1, ROTATIONAL, FUNCTION = 30D * SIN(TIME)
!
!--------------------------- SIMULATION CONTROL -------------------
SIMULATE/DYNAMIC, END = 5.0, DTOUT = 0.01
END
`;

test("Adams Parser - parseAdamsNumber", () => {
  assert.equal(parseAdamsNumber("12.5"), 12.5);
  assert.equal(parseAdamsNumber("-3.4e-2"), -0.034);
  // 30D = 30 * pi / 180 = pi / 6
  const val30D = parseAdamsNumber("30D");
  assert.ok(Math.abs(val30D - Math.PI / 6) < 1e-6);
  assert.ok(Math.abs(parseAdamsNumber("PI") - Math.PI) < 1e-6);
});

test("Adams Parser - parse Sample Four-Bar Mechanism Deck", () => {
  const dataset = parseAdams(SAMPLE_FOUR_BAR_ADM);

  assert.equal(dataset.title, "Four Bar Linkage");
  assert.equal(dataset.parts.size, 4);
  assert.equal(dataset.markers.size, 11);
  assert.equal(dataset.joints.size, 4);
  assert.equal(dataset.forces.size, 1);
  assert.equal(dataset.motions.size, 1);
  assert.ok(dataset.simulation);

  // Check ground part
  const ground = dataset.parts.get(1);
  assert.ok(ground);
  assert.equal(ground.isGround, true);
  assert.equal(ground.mass, 0);

  // Check crank part
  const crank = dataset.parts.get(2);
  assert.ok(crank);
  assert.equal(crank.isGround, false);
  assert.equal(crank.mass, 2.5);
  assert.equal(crank.cmMarkerId, 201);
  assert.equal(crank.inertia.ixx, 0.05);
  assert.equal(crank.inertia.iyy, 0.08);
  assert.equal(crank.inertia.izz, 0.06);

  // Check marker
  const m102 = dataset.markers.get(102);
  assert.ok(m102);
  assert.equal(m102.partId, 1);
  assert.deepEqual(m102.position, { x: 1.0, y: 0.0, z: 0.0 });

  // Check joints
  const j1 = dataset.joints.get(1);
  assert.ok(j1);
  assert.equal(j1.type, "REVOLUTE");
  assert.equal(j1.iMarkerId, 101);
  assert.equal(j1.jMarkerId, 202);
  assert.equal(j1.dofCount, 1);

  // Check spring-damper
  const sd = dataset.forces.get(1);
  assert.ok(sd);
  assert.equal(sd.type, "SPRINGDAMPER");
  assert.equal(sd.stiffness, 1500.0);
  assert.equal(sd.damping, 75.0);
  assert.equal(sd.freeLength, 1.0);

  // Check motion
  const mot = dataset.motions.get(1);
  assert.ok(mot);
  assert.equal(mot.jointId, 1);
  assert.equal(mot.type, "ROTATIONAL");
  assert.equal(mot.functionExpr, "30D * SIN(TIME)");

  // Check simulation control
  assert.equal(dataset.simulation?.type, "DYNAMIC");
  assert.equal(dataset.simulation?.endTime, 5.0);
  assert.equal(dataset.simulation?.dtOut, 0.01);
});

test("Adams Parser - Lossless Round-Trip Serialization", () => {
  const dataset = parseAdams(SAMPLE_FOUR_BAR_ADM);
  const serialized = serializeAdams(dataset);
  const reParsed = parseAdams(serialized);

  assert.equal(reParsed.parts.size, dataset.parts.size);
  assert.equal(reParsed.markers.size, dataset.markers.size);
  assert.equal(reParsed.joints.size, dataset.joints.size);
  assert.equal(reParsed.forces.size, dataset.forces.size);
  assert.equal(reParsed.motions.size, dataset.motions.size);
});
