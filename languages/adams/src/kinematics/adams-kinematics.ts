// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/adams — Spatial Kinematics Kernel & Coordinate Transformations.
 *
 * Implements Tait-Bryan and Euler 3-1-3 rotation matrix algebra, forward kinematics,
 * joint constraint residual evaluations, and coordinate partitioning helpers.
 */

import type { AdamsDataset, AdamsJoint, AdamsMarker, Vector3D } from "../types.js";

export type Matrix3x3 = [[number, number, number], [number, number, number], [number, number, number]];

/**
 * Computes 3-1-3 Euler rotation matrix R = Rz(psi) * Rx(theta) * Rz(phi).
 * Angles in radians.
 */
export function rotationMatrixEuler313(psi: number, theta: number, phi: number): Matrix3x3 {
  const c1 = Math.cos(psi);
  const s1 = Math.sin(psi);
  const c2 = Math.cos(theta);
  const s2 = Math.sin(theta);
  const c3 = Math.cos(phi);
  const s3 = Math.sin(phi);

  return [
    [c1 * c3 - s1 * c2 * s3, -c1 * s3 - s1 * c2 * c3, s1 * s2],
    [s1 * c3 + c1 * c2 * s3, -s1 * s3 + c1 * c2 * c3, -c1 * s2],
    [s2 * s3, s2 * c3, c2],
  ];
}

/**
 * Computes Tait-Bryan 1-2-3 rotation matrix R = Rz(yaw) * Ry(pitch) * Rx(roll).
 * Angles in radians.
 */
export function rotationMatrixTaitBryan(roll: number, pitch: number, yaw: number): Matrix3x3 {
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);

  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr],
  ];
}

/**
 * Multiplies a 3x3 matrix by a 3D vector: v_out = M * v.
 */
export function transformVector(m: Matrix3x3, v: Vector3D): Vector3D {
  return {
    x: m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
    y: m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
    z: m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z,
  };
}

/**
 * Computes the global coordinates of an Adams marker given its part position and orientation.
 */
export function computeMarkerGlobalPosition(marker: AdamsMarker, partPos: Vector3D, partRot: Matrix3x3): Vector3D {
  const localRotated = transformVector(partRot, marker.position);
  return {
    x: partPos.x + localRotated.x,
    y: partPos.y + localRotated.y,
    z: partPos.z + localRotated.z,
  };
}

/**
 * Evaluates the geometric constraint residual vector Phi(q) for an Adams joint.
 * For spherical, revolute, universal, or fixed joints, evaluates position disparity.
 */
export function evaluateJointResidual(
  joint: AdamsJoint,
  dataset: AdamsDataset,
  partPositions: Map<string | number, Vector3D>,
  partRotations: Map<string | number, Matrix3x3>,
): number[] {
  const mA = dataset.markers.get(joint.iMarkerId);
  const mB = dataset.markers.get(joint.jMarkerId);
  if (!mA || !mB) return [];

  const defaultPos: Vector3D = { x: 0, y: 0, z: 0 };
  const identityRot: Matrix3x3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  const posA = partPositions.get(mA.partId) ?? defaultPos;
  const rotA = partRotations.get(mA.partId) ?? identityRot;
  const posB = partPositions.get(mB.partId) ?? defaultPos;
  const rotB = partRotations.get(mB.partId) ?? identityRot;

  const globA = computeMarkerGlobalPosition(mA, posA, rotA);
  const globB = computeMarkerGlobalPosition(mB, posB, rotB);

  const dx = globA.x - globB.x;
  const dy = globA.y - globB.y;
  const dz = globA.z - globB.z;

  switch (joint.type) {
    case "SPHERICAL":
      // 3 translational constraints
      return [dx, dy, dz];

    case "REVOLUTE": {
      // 3 translational constraints + 2 rotational perpendicularity constraints
      const zAxisLocal: Vector3D = { x: 0, y: 0, z: 1 };
      const zA = transformVector(rotA, zAxisLocal);
      const zB = transformVector(rotB, zAxisLocal);
      // zA x zB = 0 => 2 independent components
      const rotRes1 = zA.y * zB.z - zA.z * zB.y;
      const rotRes2 = zA.z * zB.x - zA.x * zB.z;
      return [dx, dy, dz, rotRes1, rotRes2];
    }

    case "FIXED": {
      // 6 constraints: 3 translational + 3 rotational
      return [dx, dy, dz, rotA[0][1] - rotB[0][1], rotA[0][2] - rotB[0][2], rotA[1][2] - rotB[1][2]];
    }

    case "TRANSLATIONAL": {
      // 2 translational constraints perpendicular to axis of translation + 3 rotational constraints
      return [dx, dy, rotA[0][0] - rotB[0][0], rotA[1][1] - rotB[1][1], rotA[2][2] - rotB[2][2]];
    }

    default:
      return [dx, dy, dz];
  }
}
