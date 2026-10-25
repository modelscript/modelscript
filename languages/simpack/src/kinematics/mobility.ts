// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JointType, SimpackModel } from "../types.js";

export interface MobilityAnalysisResult {
  numBodies: number; // excluding inertial frame
  numJoints: number;
  totalJointDof: number;
  totalConstraintEquations: number;
  calculatedMobility: number; // Grübler-Kutzbach degrees of freedom
  isOverconstrained: boolean;
}

const JOINT_CONSTRAINTS: Record<JointType, number> = {
  fixed: 6,
  revolute: 5,
  prismatic: 5,
  cylindrical: 4,
  spherical: 3,
  planar: 3,
  universal: 4,
  free: 0,
};

/**
 * Grübler-Kutzbach Mobility Criterion for 3D spatial multibody systems:
 *   M = 6 * (n - 1) - \sum_{i=1}^j (6 - f_i)
 * where n is number of bodies (including ground/inertial), j is number of joints,
 * and f_i is degrees of freedom of joint i.
 */
export function analyzeMobility(model: SimpackModel): MobilityAnalysisResult {
  const n = model.bodies.size; // number of moving bodies
  let totalConstraints = 0;
  let totalDof = 0;

  for (const joint of model.joints.values()) {
    const c = JOINT_CONSTRAINTS[joint.type] ?? 6;
    totalConstraints += c;
    totalDof += 6 - c;
  }

  // Moving bodies contribute 6 unconstrained DOF each
  const calculatedMobility = 6 * n - totalConstraints;

  return {
    numBodies: n,
    numJoints: model.joints.size,
    totalJointDof: totalDof,
    totalConstraintEquations: totalConstraints,
    calculatedMobility,
    isOverconstrained: calculatedMobility < 0,
  };
}
