// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Vector3D } from "../types.js";

export interface BumpStopConfig {
  name: string;
  clearanceGap: number; // free play clearance gap delta_0 [m]
  linearStiffness: number; // initial contact stiffness k1 [N/m]
  nonlinearStiffnessCoeff: number; // cubic hardening coefficient k3 [N/m^3]
  damping: number; // damping coefficient c [N*s/m]
}

export interface BumpStopForceResult {
  penetration: number; // contact indentation [m]
  elasticForce: number; // restoring spring force [N]
  dampingForce: number; // viscous resistance force [N]
  totalForce: number; // total transmitted force [N]
  inContact: boolean;
}

/**
 * Non-linear railway suspension bump-stop (limit stop) element:
 * Models free travel gap followed by progressively stiffening contact with damping:
 *   F_spring = k1 * delta + k3 * delta^3   (for delta = |x| - gap > 0)
 *   F_damper = c * v_rel
 */
export function evaluateBumpStop(
  config: BumpStopConfig,
  relativeDisplacement: number,
  relativeVelocity: number,
): BumpStopForceResult {
  const dispMag = Math.abs(relativeDisplacement);
  const gap = config.clearanceGap;

  if (dispMag <= gap) {
    return {
      penetration: 0,
      elasticForce: 0,
      dampingForce: 0,
      totalForce: 0,
      inContact: false,
    };
  }

  // Active contact penetration
  const delta = dispMag - gap;
  const sign = Math.sign(relativeDisplacement);

  // Progressive hardening stiffness: F_e = k1 * delta + k3 * delta^3
  const elasticForceMag = config.linearStiffness * delta + config.nonlinearStiffnessCoeff * Math.pow(delta, 3);
  const elasticForce = sign * elasticForceMag;

  // Damping is active only during compression (relative velocity opposes displacement)
  // or bidirectional contact
  const isCompressing = relativeVelocity * relativeDisplacement > 0;
  const dampingForce = isCompressing ? config.damping * relativeVelocity : 0;

  const totalForce = elasticForce + dampingForce;

  return {
    penetration: delta,
    elasticForce,
    dampingForce,
    totalForce,
    inContact: true,
  };
}

/**
 * 3D Railway Suspension Bushing (Maxwell series model for rubber mounts):
 * Evaluates directional forces including bump-stop limits in lateral (Y) direction.
 */
export function evaluate3DSuspensionCoupling(
  stiffness: Vector3D,
  damping: Vector3D,
  relPos: Vector3D,
  relVel: Vector3D,
  lateralBumpStop?: BumpStopConfig,
): Vector3D {
  const fx = stiffness.x * relPos.x + damping.x * relVel.x;
  let fy = stiffness.y * relPos.y + damping.y * relVel.y;
  const fz = stiffness.z * relPos.z + damping.z * relVel.z;

  if (lateralBumpStop) {
    const stopResult = evaluateBumpStop(lateralBumpStop, relPos.y, relVel.y);
    fy += stopResult.totalForce;
  }

  return { x: fx, y: fy, z: fz };
}
