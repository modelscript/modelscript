// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/adams — Spatial Kinematics Kernel & Coordinate Transformations.
 *
 * Implements Tait-Bryan and Euler 3-1-3 rotation matrix algebra, forward kinematics,
 * marker orientation composition, joint constraint residual evaluations across all
 * canonical Adams joint types (SPHERICAL, REVOLUTE, UNIVERSAL, CYLINDRICAL,
 * TRANSLATIONAL, PLANAR, FIXED, SCREW), and coordinate partitioning helpers.
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
 * Multiplies two 3x3 rotation matrices: C = A * B.
 */
export function multiplyMatrices3x3(a: Matrix3x3, b: Matrix3x3): Matrix3x3 {
  const [a0, a1, a2] = a;
  const [b0, b1, b2] = b;
  return [
    [
      a0[0] * b0[0] + a0[1] * b1[0] + a0[2] * b2[0],
      a0[0] * b0[1] + a0[1] * b1[1] + a0[2] * b2[1],
      a0[0] * b0[2] + a0[1] * b1[2] + a0[2] * b2[2],
    ],
    [
      a1[0] * b0[0] + a1[1] * b1[0] + a1[2] * b2[0],
      a1[0] * b0[1] + a1[1] * b1[1] + a1[2] * b2[1],
      a1[0] * b0[2] + a1[1] * b1[2] + a1[2] * b2[2],
    ],
    [
      a2[0] * b0[0] + a2[1] * b1[0] + a2[2] * b2[0],
      a2[0] * b0[1] + a2[1] * b1[1] + a2[2] * b2[1],
      a2[0] * b0[2] + a2[1] * b1[2] + a2[2] * b2[2],
    ],
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
 * Computes the dot product of two 3D vectors.
 */
export function dotVector3D(a: Vector3D, b: Vector3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Computes the cross product of two 3D vectors: a x b.
 */
export function crossVector3D(a: Vector3D, b: Vector3D): Vector3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
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
 * Computes the global 3x3 orientation matrix of an Adams marker given its parent part rotation.
 */
export function computeMarkerGlobalOrientation(marker: AdamsMarker, partRot: Matrix3x3): Matrix3x3 {
  const { x, y, z } = marker.orientation;
  if (x === 0 && y === 0 && z === 0) return partRot;
  const localRot = marker.useEuler ? rotationMatrixEuler313(x, y, z) : rotationMatrixTaitBryan(x, y, z);
  return multiplyMatrices3x3(partRot, localRot);
}

/**
 * Evaluates the geometric constraint residual vector Phi(q) for an Adams joint.
 * Supports SPHERICAL (3), REVOLUTE (5), UNIVERSAL (4), CYLINDRICAL (4),
 * TRANSLATIONAL (5), PLANAR (3), FIXED (6), and SCREW (5).
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
  const rotA = computeMarkerGlobalOrientation(mA, partRotations.get(mA.partId) ?? identityRot);
  const posB = partPositions.get(mB.partId) ?? defaultPos;
  const rotB = computeMarkerGlobalOrientation(mB, partRotations.get(mB.partId) ?? identityRot);

  const globA = computeMarkerGlobalPosition(mA, posA, partRotations.get(mA.partId) ?? identityRot);
  const globB = computeMarkerGlobalPosition(mB, posB, partRotations.get(mB.partId) ?? identityRot);

  const dx = globA.x - globB.x;
  const dy = globA.y - globB.y;
  const dz = globA.z - globB.z;
  const dr: Vector3D = { x: dx, y: dy, z: dz };

  const xA = transformVector(rotA, { x: 1, y: 0, z: 0 });
  const zA = transformVector(rotA, { x: 0, y: 0, z: 1 });
  const xB = transformVector(rotB, { x: 1, y: 0, z: 0 });
  const yB = transformVector(rotB, { x: 0, y: 1, z: 0 });
  const zB = transformVector(rotB, { x: 0, y: 0, z: 1 });

  switch (joint.type) {
    case "SPHERICAL":
      // 3 translational constraints
      return [dx, dy, dz];

    case "REVOLUTE": {
      // 3 translational constraints + 2 rotational perpendicularity constraints (zA x zB = 0)
      const rotRes1 = zA.y * zB.z - zA.z * zB.y;
      const rotRes2 = zA.z * zB.x - zA.x * zB.z;
      return [dx, dy, dz, rotRes1, rotRes2];
    }

    case "UNIVERSAL": {
      // 3 translational constraints + 1 rotational perpendicularity constraint (zA . xB = 0)
      return [dx, dy, dz, dotVector3D(zA, xB)];
    }

    case "CYLINDRICAL": {
      // 2 translational constraints perpendicular to zB + 2 rotational constraints (zA parallel to zB)
      return [dotVector3D(dr, xB), dotVector3D(dr, yB), dotVector3D(zA, xB), dotVector3D(zA, yB)];
    }

    case "TRANSLATIONAL": {
      // 2 translational constraints perpendicular to zB + 3 rotational constraints
      return [dotVector3D(dr, xB), dotVector3D(dr, yB), dotVector3D(zA, xB), dotVector3D(zA, yB), dotVector3D(xA, yB)];
    }

    case "PLANAR": {
      // 1 translational constraint along zB + 2 rotational constraints (zA parallel to zB)
      return [dotVector3D(dr, zB), dotVector3D(zA, xB), dotVector3D(zA, yB)];
    }

    case "FIXED": {
      // 6 constraints: 3 translational + 3 rotational
      return [dx, dy, dz, dotVector3D(zA, xB), dotVector3D(zA, yB), dotVector3D(xA, yB)];
    }

    case "SCREW": {
      // 2 translational perpendicular to zB + 2 rotational + 1 helical coupling (dz - pitch * dpsi / 2pi)
      const pitch = joint.pitch ?? 0.01;
      const dpsi = Math.atan2(dotVector3D(xA, yB), dotVector3D(xA, xB));
      return [
        dotVector3D(dr, xB),
        dotVector3D(dr, yB),
        dotVector3D(zA, xB),
        dotVector3D(zA, yB),
        dotVector3D(dr, zB) - (pitch / (2 * Math.PI)) * dpsi,
      ];
    }

    default:
      return [dx, dy, dz];
  }
}
