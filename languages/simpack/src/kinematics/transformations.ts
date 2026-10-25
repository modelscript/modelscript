// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Vector3D } from "../types.js";
import { getWasmKinematicsBridge } from "./wasm-bridge.js";

/**
 * 3x3 Direction Cosine Rotation Matrix:
 *   [ [r00, r01, r02],
 *     [r10, r11, r12],
 *     [r20, r21, r22] ]
 */
export type RotationMatrix = [[number, number, number], [number, number, number], [number, number, number]];

/**
 * Pure TypeScript reference implementation of rotationMatrixFromEuler.
 */
export function pureTsRotationMatrixFromEuler(alpha: number, beta: number, gamma: number): RotationMatrix {
  const ca = Math.cos(alpha);
  const sa = Math.sin(alpha);
  const cb = Math.cos(beta);
  const sb = Math.sin(beta);
  const cg = Math.cos(gamma);
  const sg = Math.sin(gamma);

  return [
    [ca * cb, ca * sb * sg - sa * cg, ca * sb * cg + sa * sg],
    [sa * cb, sa * sb * sg + ca * cg, sa * sb * cg - ca * sg],
    [-sb, cb * sg, cb * cg],
  ];
}

/**
 * Computes direction cosine matrix from Tait-Bryan angles (Z-Y'-X'' sequence: yaw, pitch, roll).
 * alpha: rotation around Z [rad] (yaw)
 * beta:  rotation around Y [rad] (pitch)
 * gamma: rotation around X [rad] (roll)
 *
 * Accelerated via WebAssembly linear memory kernel with transparent TypeScript fallback.
 */
export function rotationMatrixFromEuler(alpha: number, beta: number, gamma: number): RotationMatrix {
  try {
    return getWasmKinematicsBridge().rotationMatrixFromEuler(alpha, beta, gamma);
  } catch {
    return pureTsRotationMatrixFromEuler(alpha, beta, gamma);
  }
}

/**
 * Identity 3x3 matrix (Pure TypeScript).
 */
export function pureTsIdentityMatrix(): RotationMatrix {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

/**
 * Identity 3x3 matrix.
 */
export function identityMatrix(): RotationMatrix {
  try {
    return getWasmKinematicsBridge().identityMatrix();
  } catch {
    return pureTsIdentityMatrix();
  }
}

/**
 * Multiplies two 3x3 matrices: R = A * B (Pure TypeScript).
 */
export function pureTsMultiplyMatrices(A: RotationMatrix, B: RotationMatrix): RotationMatrix {
  const R: RotationMatrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      R[r]![c] = A[r]![0]! * B[0]![c]! + A[r]![1]! * B[1]![c]! + A[r]![2]! * B[2]![c]!;
    }
  }

  return R;
}

/**
 * Multiplies two 3x3 matrices: R = A * B
 * Accelerated via WebAssembly linear memory kernel.
 */
export function multiplyMatrices(A: RotationMatrix, B: RotationMatrix): RotationMatrix {
  try {
    return getWasmKinematicsBridge().multiplyMatrices(A, B);
  } catch {
    return pureTsMultiplyMatrices(A, B);
  }
}

/**
 * Transforms a local vector v into global frame: v_global = R * v_local (Pure TypeScript).
 */
export function pureTsTransformVector(R: RotationMatrix, v: Vector3D): Vector3D {
  return {
    x: R[0]![0]! * v.x + R[0]![1]! * v.y + R[0]![2]! * v.z,
    y: R[1]![0]! * v.x + R[1]![1]! * v.y + R[1]![2]! * v.z,
    z: R[2]![0]! * v.x + R[2]![1]! * v.y + R[2]![2]! * v.z,
  };
}

/**
 * Transforms a local vector v into global frame: v_global = R * v_local
 */
export function transformVector(R: RotationMatrix, v: Vector3D): Vector3D {
  try {
    return getWasmKinematicsBridge().transformVector(R, v);
  } catch {
    return pureTsTransformVector(R, v);
  }
}

/**
 * Computes vector cross product: u x v (Pure TypeScript).
 */
export function pureTsCrossProduct(u: Vector3D, v: Vector3D): Vector3D {
  return {
    x: u.y * v.z - u.z * v.y,
    y: u.z * v.x - u.x * v.z,
    z: u.x * v.y - u.y * v.x,
  };
}

/**
 * Computes vector cross product: u x v
 */
export function crossProduct(u: Vector3D, v: Vector3D): Vector3D {
  try {
    return getWasmKinematicsBridge().crossProduct(u, v);
  } catch {
    return pureTsCrossProduct(u, v);
  }
}

/**
 * Vector dot product: u . v (Pure TypeScript).
 */
export function pureTsDotProduct(u: Vector3D, v: Vector3D): number {
  return u.x * v.x + u.y * v.y + u.z * v.z;
}

/**
 * Vector dot product: u . v
 */
export function dotProduct(u: Vector3D, v: Vector3D): number {
  try {
    return getWasmKinematicsBridge().dotProduct(u, v);
  } catch {
    return pureTsDotProduct(u, v);
  }
}

/**
 * Spatial coordinate transformation for a marker attached to a body:
 *   r_marker = r_body + R_body * s_local
 *   R_marker = R_body * R_local
 */
export interface SpatialTransform {
  position: Vector3D;
  rotation: RotationMatrix;
}

/**
 * Marker spatial transform (Pure TypeScript).
 */
export function pureTsComputeMarkerSpatialTransform(
  bodyPosition: Vector3D,
  bodyRotation: RotationMatrix,
  markerLocalPosition: Vector3D,
  markerLocalRotation: RotationMatrix,
): SpatialTransform {
  const globalMarkerPosRel = pureTsTransformVector(bodyRotation, markerLocalPosition);
  return {
    position: {
      x: bodyPosition.x + globalMarkerPosRel.x,
      y: bodyPosition.y + globalMarkerPosRel.y,
      z: bodyPosition.z + globalMarkerPosRel.z,
    },
    rotation: pureTsMultiplyMatrices(bodyRotation, markerLocalRotation),
  };
}

/**
 * Computes marker world position and orientation.
 * Accelerated via WebAssembly linear memory kernel.
 */
export function computeMarkerSpatialTransform(
  bodyPosition: Vector3D,
  bodyRotation: RotationMatrix,
  markerLocalPosition: Vector3D,
  markerLocalRotation: RotationMatrix,
): SpatialTransform {
  try {
    return getWasmKinematicsBridge().computeMarkerSpatialTransform(
      bodyPosition,
      bodyRotation,
      markerLocalPosition,
      markerLocalRotation,
    );
  } catch {
    return pureTsComputeMarkerSpatialTransform(bodyPosition, bodyRotation, markerLocalPosition, markerLocalRotation);
  }
}
