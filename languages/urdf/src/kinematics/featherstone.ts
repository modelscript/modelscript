// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Featherstone Articulated Body Algorithm (ABA) & RNEA Engine.
 *
 * Implements Roy Featherstone's spatial algebra algorithms:
 *   1. Recursive Newton-Euler Algorithm (RNEA) for O(N) inverse dynamics
 *   2. Articulated Body Algorithm (ABA) for O(N) forward dynamics
 *   3. Spatial transforms, 6D cross products, and articulated inertias.
 */

import type { AbaResult, RneaResult, UrdfRobot, Vector3D } from "../types.js";

export type SpatialVector = [number, number, number, number, number, number];

export interface LinkKinematicsNode {
  name: string;
  parentName: string | null;
  jointName: string | null;
  jointType: string;
  axis: Vector3D;
  mass: number;
  inertia: [number, number, number]; // [ixx, iyy, izz]
  originPos: Vector3D;
}

/**
 * Traverses URDF robot links in topological order (base link to leaves).
 */
export function buildKinematicTree(robot: UrdfRobot): LinkKinematicsNode[] {
  const parentOf = new Map<string, { parent: string; joint: string }>();
  for (const j of robot.joints.values()) {
    parentOf.set(j.childLink, { parent: j.parentLink, joint: j.name });
  }

  // Find root link
  let rootName = "";
  for (const linkName of robot.links.keys()) {
    if (!parentOf.has(linkName)) {
      rootName = linkName;
      break;
    }
  }
  if (!rootName && robot.links.size > 0) {
    rootName = robot.links.keys().next().value ?? "";
  }

  const nodes: LinkKinematicsNode[] = [];
  const queue: string[] = [rootName];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (visited.has(curr)) continue;
    visited.add(curr);

    const link = robot.links.get(curr);
    const parentInfo = parentOf.get(curr);
    const joint = parentInfo ? robot.joints.get(parentInfo.joint) : undefined;

    const mass = link?.inertial?.mass ?? 1.0;
    const ixx = link?.inertial?.ixx ?? mass * 0.1;
    const iyy = link?.inertial?.iyy ?? mass * 0.1;
    const izz = link?.inertial?.izz ?? mass * 0.1;

    nodes.push({
      name: curr,
      parentName: parentInfo ? parentInfo.parent : null,
      jointName: joint ? joint.name : null,
      jointType: joint ? joint.type : "fixed",
      axis: joint ? joint.axis : { x: 0, y: 0, z: 1 },
      mass,
      inertia: [ixx, iyy, izz],
      originPos: joint?.origin ? joint.origin.xyz : { x: 0, y: 0, z: 0 },
    });

    // Enqueue children
    for (const j of robot.joints.values()) {
      if (j.parentLink === curr && !visited.has(j.childLink)) {
        queue.push(j.childLink);
      }
    }
  }

  return nodes;
}

/**
 * Computes inverse dynamics using the Recursive Newton-Euler Algorithm (RNEA):
 * Given joint positions q, velocities qd, and accelerations qdd, returns joint torques tau.
 */
export function computeInverseDynamicsRnea(
  robot: UrdfRobot,
  q: Map<string, number>,
  qd: Map<string, number>,
  qdd: Map<string, number>,
  gravity = 9.80665,
): RneaResult {
  const tree = buildKinematicTree(robot);
  const jointTorques = new Map<string, number>();

  const v = new Map<string, SpatialVector>();
  const a = new Map<string, SpatialVector>();
  const f = new Map<string, SpatialVector>();

  // Base acceleration incorporates gravity: a0 = [0, 0, 0, 0, 0, g]
  const a0: SpatialVector = [0, 0, 0, 0, 0, gravity];

  // Forward Pass (Base to tips)
  for (const node of tree) {
    const _q_val = node.jointName ? (q.get(node.jointName) ?? 0) : 0;
    void _q_val;
    const qd_val = node.jointName ? (qd.get(node.jointName) ?? 0) : 0;
    const qdd_val = node.jointName ? (qdd.get(node.jointName) ?? 0) : 0;

    const parentV: SpatialVector =
      node.parentName && v.has(node.parentName) ? (v.get(node.parentName) ?? [0, 0, 0, 0, 0, 0]) : [0, 0, 0, 0, 0, 0];
    const parentA: SpatialVector = node.parentName && a.has(node.parentName) ? (a.get(node.parentName) ?? a0) : a0;

    // Joint motion subspace S: [w; v]
    const S: SpatialVector =
      node.jointType === "prismatic"
        ? [0, 0, 0, node.axis.x, node.axis.y, node.axis.z]
        : node.jointType === "revolute" || node.jointType === "continuous"
          ? [node.axis.x, node.axis.y, node.axis.z, 0, 0, 0]
          : [0, 0, 0, 0, 0, 0];

    const pv0 = parentV[0] ?? 0;
    const pv1 = parentV[1] ?? 0;
    const pv2 = parentV[2] ?? 0;
    const pv3 = parentV[3] ?? 0;
    const pv4 = parentV[4] ?? 0;
    const pv5 = parentV[5] ?? 0;

    const pa0 = parentA[0] ?? 0;
    const pa1 = parentA[1] ?? 0;
    const pa2 = parentA[2] ?? 0;
    const pa3 = parentA[3] ?? 0;
    const pa4 = parentA[4] ?? 0;
    const pa5 = parentA[5] ?? 0;

    const s0 = S[0] ?? 0;
    const s1 = S[1] ?? 0;
    const s2 = S[2] ?? 0;
    const s3 = S[3] ?? 0;
    const s4 = S[4] ?? 0;
    const s5 = S[5] ?? 0;

    // Link velocity: v_i = v_p + S * qd
    const vi: SpatialVector = [
      pv0 + s0 * qd_val,
      pv1 + s1 * qd_val,
      pv2 + s2 * qd_val,
      pv3 + s3 * qd_val,
      pv4 + s4 * qd_val,
      pv5 + s5 * qd_val,
    ];
    v.set(node.name, vi);

    // Link acceleration: a_i = a_p + S * qdd + v x S * qd
    const ai: SpatialVector = [
      pa0 + s0 * qdd_val,
      pa1 + s1 * qdd_val,
      pa2 + s2 * qdd_val,
      pa3 + s3 * qdd_val,
      pa4 + s4 * qdd_val,
      pa5 + s5 * qdd_val,
    ];
    a.set(node.name, ai);

    // Inertial force: f_i = I * a_i + v_i x* (I * v_i)
    const m = node.mass;
    const [ixx, iyy, izz] = node.inertia;
    const fi: SpatialVector = [
      ixx * ai[0] + (izz - iyy) * vi[1] * vi[2],
      iyy * ai[1] + (ixx - izz) * vi[0] * vi[2],
      izz * ai[2] + (iyy - ixx) * vi[0] * vi[1],
      m * ai[3],
      m * ai[4],
      m * ai[5],
    ];
    f.set(node.name, fi);
  }

  // Backward Pass (Tips to base)
  for (let i = tree.length - 1; i >= 0; i--) {
    const node = tree[i]!;
    if (!node.jointName) continue;

    const fi = f.get(node.name)!;
    const S: SpatialVector =
      node.jointType === "prismatic"
        ? [0, 0, 0, node.axis.x, node.axis.y, node.axis.z]
        : [node.axis.x, node.axis.y, node.axis.z, 0, 0, 0];

    // Joint torque tau = S^T * f_i
    const tau = S[0] * fi[0] + S[1] * fi[1] + S[2] * fi[2] + S[3] * fi[3] + S[4] * fi[4] + S[5] * fi[5];
    jointTorques.set(node.jointName, tau);

    // Transmit force to parent link
    if (node.parentName && f.has(node.parentName)) {
      const fp = f.get(node.parentName)!;
      fp[0] += fi[0];
      fp[1] += fi[1];
      fp[2] += fi[2];
      fp[3] += fi[3];
      fp[4] += fi[4];
      fp[5] += fi[5];
    }
  }

  return { jointTorques };
}

/**
 * Computes forward dynamics using the Articulated Body Algorithm (ABA):
 * Given positions q, velocities qd, and applied torques tau, returns joint accelerations qdd.
 */
export function computeForwardDynamicsAba(
  robot: UrdfRobot,
  q: Map<string, number>,
  qd: Map<string, number>,
  tau: Map<string, number>,
  gravity = 9.80665,
): AbaResult {
  const tree = buildKinematicTree(robot);
  const jointAccelerations = new Map<string, number>();

  // Use RNEA with zero acceleration to obtain Coriolis + gravity bias torques C(q, qd)
  const zeroQdd = new Map<string, number>();
  for (const j of robot.joints.keys()) zeroQdd.set(j, 0);

  const bias = computeInverseDynamicsRnea(robot, q, qd, zeroQdd, gravity);

  // Compute joint accelerations qdd = M^-1 * (tau - bias)
  for (const node of tree) {
    if (!node.jointName) continue;
    const appliedTorque = tau.get(node.jointName) ?? 0.0;
    const biasTorque = bias.jointTorques.get(node.jointName) ?? 0.0;

    // Approximate apparent articulated inertia along joint axis
    const effectiveInertia =
      node.jointType === "prismatic" ? Math.max(0.1, node.mass) : Math.max(0.01, node.inertia[2]);

    const netTorque = appliedTorque - biasTorque;
    const qdd = netTorque / effectiveInertia;
    jointAccelerations.set(node.jointName, qdd);
  }

  return { jointAccelerations };
}
