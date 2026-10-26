// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeMarkerGlobalPosition,
  evaluateJointResidual,
  rotationMatrixEuler313,
  rotationMatrixTaitBryan,
  transformVector,
} from "../src/kinematics/adams-kinematics.js";
import { parseAdams } from "../src/parser/adams-parser.js";
import type { Vector3D } from "../src/types.js";

test("Adams Kinematics - Euler 3-1-3 Rotation Matrix", () => {
  // Test identity rotation (0, 0, 0)
  const r0 = rotationMatrixEuler313(0, 0, 0);
  assert.ok(Math.abs(r0[0][0] - 1.0) < 1e-9);
  assert.ok(Math.abs(r0[1][1] - 1.0) < 1e-9);
  assert.ok(Math.abs(r0[2][2] - 1.0) < 1e-9);

  // Test 90 deg rotation around X (psi=0, theta=pi/2, phi=0)
  const r90x = rotationMatrixEuler313(0, Math.PI / 2, 0);
  const vY: Vector3D = { x: 0, y: 1, z: 0 };
  const vOut = transformVector(r90x, vY);
  // Y rotated 90 deg around X should become +Z
  assert.ok(Math.abs(vOut.x) < 1e-9);
  assert.ok(Math.abs(vOut.y) < 1e-9);
  assert.ok(Math.abs(vOut.z - 1.0) < 1e-9);
});

test("Adams Kinematics - Tait-Bryan 1-2-3 Rotation Matrix", () => {
  // Test 90 deg yaw around Z (roll=0, pitch=0, yaw=pi/2)
  const r90z = rotationMatrixTaitBryan(0, 0, Math.PI / 2);
  const vX: Vector3D = { x: 1, y: 0, z: 0 };
  const vOut = transformVector(r90z, vX);
  // X rotated 90 deg around Z should become +Y
  assert.ok(Math.abs(vOut.x) < 1e-9);
  assert.ok(Math.abs(vOut.y - 1.0) < 1e-9);
  assert.ok(Math.abs(vOut.z) < 1e-9);
});

test("Adams Kinematics - Marker Global Position Transformation", () => {
  const marker = {
    id: 1,
    name: "marker_1",
    partId: 2,
    position: { x: 0.5, y: 0.0, z: 0.0 },
    orientation: { x: 0, y: 0, z: 0 },
    useEuler: false,
  };
  const partPos: Vector3D = { x: 10.0, y: 5.0, z: 2.0 };
  const partRot = rotationMatrixTaitBryan(0, 0, Math.PI / 2); // 90 deg around Z

  const glob = computeMarkerGlobalPosition(marker, partPos, partRot);
  // local (0.5, 0, 0) rotated by 90 around Z becomes (0, 0.5, 0)
  // translated by (10, 5, 2) becomes (10, 5.5, 2)
  assert.ok(Math.abs(glob.x - 10.0) < 1e-9);
  assert.ok(Math.abs(glob.y - 5.5) < 1e-9);
  assert.ok(Math.abs(glob.z - 2.0) < 1e-9);
});

test("Adams Kinematics - Evaluate Joint Residuals", () => {
  const deck = `
PART/1, GROUND
PART/2, MASS=1.0, IP=0.1, 0.1, 0.1
MARKER/1, PART=1, QP=0.0, 0.0, 0.0
MARKER/2, PART=2, QP=0.0, 0.0, 0.0
JOINT/1, SPHERICAL, I=1, J=2
`;
  const dataset = parseAdams(deck);
  const joint = dataset.joints.get(1)!;

  const partPositions = new Map<string | number, Vector3D>([
    [1, { x: 0, y: 0, z: 0 }],
    [2, { x: 0.1, y: -0.2, z: 0.05 }],
  ]);
  const partRotations = new Map();

  const residual = evaluateJointResidual(joint, dataset, partPositions, partRotations);
  assert.equal(residual.length, 3);
  assert.ok(Math.abs((residual[0] ?? 0) - -0.1) < 1e-9);
  assert.ok(Math.abs((residual[1] ?? 0) - 0.2) < 1e-9);
  assert.ok(Math.abs((residual[2] ?? 0) - -0.05) < 1e-9);
});
