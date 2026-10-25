// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JointType, Vector3D } from "../types.js";
import { dotProduct, type SpatialTransform } from "./transformations.js";
import { getWasmKinematicsBridge } from "./wasm-bridge.js";

export interface JointConstraintResidual {
  jointId: string;
  type: JointType;
  positionError: Vector3D;
  orientationError: Vector3D;
  constraintNorm: number;
}

/**
 * Pure TypeScript implementation of evaluateJointConstraint.
 */
export function pureTsEvaluateJointConstraint(
  jointId: string,
  type: JointType,
  markerA: SpatialTransform,
  markerB: SpatialTransform,
  _jointAxisLocal: Vector3D = { x: 0, y: 0, z: 1 },
): JointConstraintResidual {
  // Relative position residual: Delta r = r_B - r_A
  const dx = markerB.position.x - markerA.position.x;
  const dy = markerB.position.y - markerA.position.y;
  const dz = markerB.position.z - markerA.position.z;
  const deltaR: Vector3D = { x: dx, y: dy, z: dz };

  let posError: Vector3D = { x: 0, y: 0, z: 0 };
  let orientError: Vector3D = { x: 0, y: 0, z: 0 };

  const xA: Vector3D = {
    x: markerA.rotation[0]![0]!,
    y: markerA.rotation[1]![0]!,
    z: markerA.rotation[2]![0]!,
  };

  const yA: Vector3D = {
    x: markerA.rotation[0]![1]!,
    y: markerA.rotation[1]![1]!,
    z: markerA.rotation[2]![1]!,
  };

  const zA: Vector3D = {
    x: markerA.rotation[0]![2]!,
    y: markerA.rotation[1]![2]!,
    z: markerA.rotation[2]![2]!,
  };

  const xB: Vector3D = {
    x: markerB.rotation[0]![0]!,
    y: markerB.rotation[1]![0]!,
    z: markerB.rotation[2]![0]!,
  };

  const zB: Vector3D = {
    x: markerB.rotation[0]![2]!,
    y: markerB.rotation[1]![2]!,
    z: markerB.rotation[2]![2]!,
  };

  switch (type) {
    case "spherical":
      // 3 translation constraints, 0 rotation constraints
      posError = deltaR;
      break;

    case "revolute":
      // 3 translation constraints + 2 orientation constraints (z_A parallel to z_B, so z_B . x_A = 0, z_B . y_A = 0)
      posError = deltaR;
      orientError = {
        x: dotProduct(zB, xA),
        y: dotProduct(zB, yA),
        z: 0,
      };
      break;

    case "prismatic":
      // 2 translation constraints (deltaR . x_A = 0, deltaR . y_A = 0), free along z_A
      posError = {
        x: dotProduct(deltaR, xA),
        y: dotProduct(deltaR, yA),
        z: 0,
      };
      // 3 orientation constraints (locked relative orientation)
      orientError = {
        x: dotProduct(zB, xA),
        y: dotProduct(zB, yA),
        z: dotProduct(xB, yA),
      };
      break;

    case "fixed":
      posError = deltaR;
      orientError = {
        x: dotProduct(zB, xA),
        y: dotProduct(zB, yA),
        z: dotProduct(xB, yA),
      };
      break;

    case "cylindrical":
      // 2 translation constraints, 2 orientation constraints
      posError = {
        x: dotProduct(deltaR, xA),
        y: dotProduct(deltaR, yA),
        z: 0,
      };
      orientError = {
        x: dotProduct(zB, xA),
        y: dotProduct(zB, yA),
        z: 0,
      };
      break;

    case "planar":
      // 1 translation constraint along z_A, 2 orientation constraints
      posError = {
        x: 0,
        y: 0,
        z: dotProduct(deltaR, zA),
      };
      orientError = {
        x: dotProduct(zB, xA),
        y: dotProduct(zB, yA),
        z: 0,
      };
      break;

    case "universal":
      // 3 translation constraints + 1 orientation constraint (cross axes)
      posError = deltaR;
      orientError = {
        x: dotProduct(zB, xA),
        y: 0,
        z: 0,
      };
      break;

    case "free":
    default:
      break;
  }

  const pNorm = Math.sqrt(posError.x * posError.x + posError.y * posError.y + posError.z * posError.z);
  const oNorm = Math.sqrt(
    orientError.x * orientError.x + orientError.y * orientError.y + orientError.z * orientError.z,
  );

  return {
    jointId,
    type,
    positionError: posError,
    orientationError: orientError,
    constraintNorm: Math.sqrt(pNorm * pNorm + oNorm * oNorm),
  };
}

/**
 * Evaluates algebraic kinematic constraint equations Phi(q) = 0 for standard joints:
 * - Spherical: 3 translation constraints (point coincidence r_A = r_B)
 * - Revolute: 3 translation constraints + 2 orientation constraints (collinear z-axes)
 * - Prismatic: 2 translation constraints (perpendicular to translation axis) + 3 orientation constraints (locked rotation)
 * - Fixed: 3 translation + 3 orientation constraints
 * - Cylindrical: 2 translation + 2 orientation constraints
 * - Planar: 1 translation + 2 orientation constraints
 * - Free: 0 constraints
 *
 * Accelerated via WebAssembly linear memory kernel with transparent TypeScript fallback.
 */
export function evaluateJointConstraint(
  jointId: string,
  type: JointType,
  markerA: SpatialTransform,
  markerB: SpatialTransform,
  jointAxisLocal: Vector3D = { x: 0, y: 0, z: 1 },
): JointConstraintResidual {
  try {
    return getWasmKinematicsBridge().evaluateJointConstraint(jointId, type, markerA, markerB);
  } catch {
    return pureTsEvaluateJointConstraint(jointId, type, markerA, markerB, jointAxisLocal);
  }
}
