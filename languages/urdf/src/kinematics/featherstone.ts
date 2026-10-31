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
  inertiaProducts?: [number, number, number] | undefined; // [ixy, ixz, iyz]
  originPos: Vector3D;
  originRpy: Vector3D;
  comOffset: Vector3D;
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
    const ixy = link?.inertial?.ixy ?? 0;
    const ixz = link?.inertial?.ixz ?? 0;
    const iyz = link?.inertial?.iyz ?? 0;

    nodes.push({
      name: curr,
      parentName: parentInfo ? parentInfo.parent : null,
      jointName: joint ? joint.name : null,
      jointType: joint ? joint.type : "fixed",
      axis: joint ? joint.axis : { x: 0, y: 0, z: 1 },
      mass,
      inertia: [ixx, iyy, izz],
      inertiaProducts: [ixy, ixz, iyz],
      originPos: joint?.origin ? joint.origin.xyz : { x: 0, y: 0, z: 0 },
      originRpy: joint?.origin?.rpy ? joint.origin.rpy : { x: 0, y: 0, z: 0 },
      comOffset: link?.inertial?.origin?.xyz ? link.inertial.origin.xyz : { x: 0, y: 0, z: 0 },
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

function cross3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

type RotMatrix9 = [number, number, number, number, number, number, number, number, number];

function rotationMatrixFromAxisAngle(axis: Vector3D, angleRad: number): RotMatrix9 {
  const norm = Math.hypot(axis.x, axis.y, axis.z);
  if (norm < 1e-12 || Math.abs(angleRad) < 1e-12) {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
  const ux = axis.x / norm;
  const uy = axis.y / norm;
  const uz = axis.z / norm;

  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const oneMinusC = 1 - c;

  return [
    c + ux * ux * oneMinusC,
    ux * uy * oneMinusC - uz * s,
    ux * uz * oneMinusC + uy * s,

    uy * ux * oneMinusC + uz * s,
    c + uy * uy * oneMinusC,
    uy * uz * oneMinusC - ux * s,

    uz * ux * oneMinusC - uy * s,
    uz * uy * oneMinusC + ux * s,
    c + uz * uz * oneMinusC,
  ];
}

function rotationMatrixFromRpy(rpy: Vector3D): RotMatrix9 {
  if (Math.abs(rpy.x) < 1e-12 && Math.abs(rpy.y) < 1e-12 && Math.abs(rpy.z) < 1e-12) {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
  const cr = Math.cos(rpy.x);
  const sr = Math.sin(rpy.x);
  const cp = Math.cos(rpy.y);
  const sp = Math.sin(rpy.y);
  const cy = Math.cos(rpy.z);
  const sy = Math.sin(rpy.z);

  return [
    cy * cp,
    cy * sp * sr - sy * cr,
    cy * sp * cr + sy * sr,
    sy * cp,
    sy * sp * sr + cy * cr,
    sy * sp * cr - cy * sr,
    -sp,
    cp * sr,
    cp * cr,
  ];
}

function multiplyRot9(A: RotMatrix9, B: RotMatrix9): RotMatrix9 {
  return [
    A[0] * B[0] + A[1] * B[3] + A[2] * B[6],
    A[0] * B[1] + A[1] * B[4] + A[2] * B[7],
    A[0] * B[2] + A[1] * B[5] + A[2] * B[8],
    A[3] * B[0] + A[4] * B[3] + A[5] * B[6],
    A[3] * B[1] + A[4] * B[4] + A[5] * B[7],
    A[3] * B[2] + A[4] * B[5] + A[5] * B[8],
    A[6] * B[0] + A[7] * B[3] + A[8] * B[6],
    A[6] * B[1] + A[7] * B[4] + A[8] * B[7],
    A[6] * B[2] + A[7] * B[5] + A[8] * B[8],
  ];
}

function multRotVec(R: RotMatrix9, v: [number, number, number]): [number, number, number] {
  return [
    R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
    R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
    R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
  ];
}

function multRotTranspVec(R: RotMatrix9, v: [number, number, number]): [number, number, number] {
  return [
    R[0] * v[0] + R[3] * v[1] + R[6] * v[2],
    R[1] * v[0] + R[4] * v[1] + R[7] * v[2],
    R[2] * v[0] + R[5] * v[1] + R[8] * v[2],
  ];
}

export interface SpatialTransform {
  R: RotMatrix9;
  r: [number, number, number];
}

function computeJointSpatialTransform(node: LinkKinematicsNode, q_val: number): SpatialTransform {
  const R_rpy = rotationMatrixFromRpy(node.originRpy ?? { x: 0, y: 0, z: 0 });
  let R: RotMatrix9 = R_rpy;
  let rTrans: [number, number, number] = [node.originPos.x, node.originPos.y, node.originPos.z];

  if (node.jointType === "revolute" || node.jointType === "continuous") {
    const R_joint = rotationMatrixFromAxisAngle(node.axis, q_val);
    R = multiplyRot9(R_joint, R_rpy);
  } else if (node.jointType === "prismatic") {
    const deltaParent = multRotTranspVec(R_rpy, [q_val * node.axis.x, q_val * node.axis.y, q_val * node.axis.z]);
    rTrans = [node.originPos.x + deltaParent[0], node.originPos.y + deltaParent[1], node.originPos.z + deltaParent[2]];
  }
  return { R, r: rTrans };
}

/**
 * Transforms motion vector m from parent to child: m_child = X * m_parent
 */
function transformSpatialMotion(xform: SpatialTransform, m: SpatialVector): SpatialVector {
  const mw: [number, number, number] = [m[0], m[1], m[2]];
  const mv: [number, number, number] = [m[3], m[4], m[5]];
  const rCrossW = cross3(xform.r, mw);
  const mvShifted: [number, number, number] = [mv[0] - rCrossW[0], mv[1] - rCrossW[1], mv[2] - rCrossW[2]];
  const wX = multRotVec(xform.R, mw);
  const vX = multRotVec(xform.R, mvShifted);
  return [wX[0], wX[1], wX[2], vX[0], vX[1], vX[2]];
}

/**
 * Transforms force vector f from child to parent: f_parent = X^T * f_child
 */
function transformSpatialForce(xform: SpatialTransform, f: SpatialVector): SpatialVector {
  const fn: [number, number, number] = [f[0], f[1], f[2]];
  const fl: [number, number, number] = [f[3], f[4], f[5]];
  const forceParentRot = multRotTranspVec(xform.R, fl);
  const torqueParentRot = multRotTranspVec(xform.R, fn);
  const rCrossF = cross3(xform.r, forceParentRot);
  return [
    torqueParentRot[0] + rCrossF[0],
    torqueParentRot[1] + rCrossF[1],
    torqueParentRot[2] + rCrossF[2],
    forceParentRot[0],
    forceParentRot[1],
    forceParentRot[2],
  ];
}

/**
 * Transforms 6x6 spatial inertia matrix I from child to parent: I_parent = X^T * I * X
 */
function transformSpatialInertia(xform: SpatialTransform, I: number[][]): number[][] {
  const B: number[][] = Array.from({ length: 6 }, () => [0, 0, 0, 0, 0, 0]);
  for (let j = 0; j < 6; j++) {
    const ej: SpatialVector = [0, 0, 0, 0, 0, 0];
    ej[j] = 1;
    const Xej = transformSpatialMotion(xform, ej);
    for (let row = 0; row < 6; row++) {
      let sum = 0;
      for (let col = 0; col < 6; col++) {
        sum += (I[row]?.[col] ?? 0) * (Xej[col] ?? 0);
      }
      B[row]![j] = sum;
    }
  }

  const result: number[][] = Array.from({ length: 6 }, () => [0, 0, 0, 0, 0, 0]);
  for (let j = 0; j < 6; j++) {
    const Bj: SpatialVector = [B[0]![j]!, B[1]![j]!, B[2]![j]!, B[3]![j]!, B[4]![j]!, B[5]![j]!];
    const XtBj = transformSpatialForce(xform, Bj);
    for (let row = 0; row < 6; row++) {
      result[row]![j] = XtBj[row]!;
    }
  }
  return result;
}

/**
 * Spatial cross product for motion vectors: v x m = [w x m_w; w x m_v + v_0 x m_w]
 */
function spatialCrossMotion(v: SpatialVector, m: SpatialVector): SpatialVector {
  const vw: [number, number, number] = [v[0], v[1], v[2]];
  const vv: [number, number, number] = [v[3], v[4], v[5]];
  const mw: [number, number, number] = [m[0], m[1], m[2]];
  const mv: [number, number, number] = [m[3], m[4], m[5]];
  const cw = cross3(vw, mw);
  const cv1 = cross3(vw, mv);
  const cv2 = cross3(vv, mw);
  return [cw[0], cw[1], cw[2], cv1[0] + cv2[0], cv1[1] + cv2[1], cv1[2] + cv2[2]];
}

/**
 * Spatial cross product for force vectors: v x* f = [w x n + v_0 x l; w x l]
 */
function spatialCrossForce(v: SpatialVector, f: SpatialVector): SpatialVector {
  const vw: [number, number, number] = [v[0], v[1], v[2]];
  const vv: [number, number, number] = [v[3], v[4], v[5]];
  const fn: [number, number, number] = [f[0], f[1], f[2]];
  const fl: [number, number, number] = [f[3], f[4], f[5]];
  const cn1 = cross3(vw, fn);
  const cn2 = cross3(vv, fl);
  const cl = cross3(vw, fl);
  return [cn1[0] + cn2[0], cn1[1] + cn2[1], cn1[2] + cn2[2], cl[0], cl[1], cl[2]];
}

function linkSpatialInertia(node: LinkKinematicsNode): number[][] {
  const m = node.mass;
  const [ixx, iyy, izz] = node.inertia;
  const [ixy, ixz, iyz] = node.inertiaProducts ?? [0, 0, 0];
  const c = node.comOffset ?? { x: 0, y: 0, z: 0 };
  const cx = c.x;
  const cy = c.y;
  const cz = c.z;

  // Parallel-axis theorem: I_bar = I_com + m * [c]_x * [c]_x^T
  const ixxBar = ixx + m * (cy * cy + cz * cz);
  const iyyBar = iyy + m * (cx * cx + cz * cz);
  const izzBar = izz + m * (cx * cx + cy * cy);
  const ixyBar = ixy - m * cx * cy;
  const ixzBar = ixz - m * cx * cz;
  const iyzBar = iyz - m * cy * cz;

  // Upper-right block: m * [c]_x; Lower-left block: m * [c]_x^T = -m * [c]_x
  const mcx = m * cx;
  const mcy = m * cy;
  const mcz = m * cz;

  return [
    [ixxBar, ixyBar, ixzBar, 0, -mcz, mcy],
    [ixyBar, iyyBar, iyzBar, mcz, 0, -mcx],
    [ixzBar, iyzBar, izzBar, -mcy, mcx, 0],
    [0, mcz, -mcy, m, 0, 0],
    [-mcz, 0, mcx, 0, m, 0],
    [mcy, -mcx, 0, 0, 0, m],
  ];
}

function matVec6(M: number[][], vec: SpatialVector): SpatialVector {
  const out: SpatialVector = [0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 6; r++) {
    let sum = 0;
    const row = M[r]!;
    for (let c = 0; c < 6; c++) {
      sum += (row[c] ?? 0) * (vec[c] ?? 0);
    }
    out[r] = sum;
  }
  return out;
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

  // Cache rotation and translation transforms per link node for backward pass
  const linkTransforms = new Map<string, SpatialTransform>();

  // Forward Pass (Base to tips)
  for (const node of tree) {
    const q_val = node.jointName ? (q.get(node.jointName) ?? 0) : 0;
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

    // Compute frame transform X_i from parent to child including joint origin RPY
    const xform = computeJointSpatialTransform(node, q_val);
    linkTransforms.set(node.name, xform);

    // Transform parent spatial velocity: v_shifted = X * v_parent
    const vParentXformed = transformSpatialMotion(xform, parentV);

    // Link velocity: v_i = X_i * v_p + S * qd
    const vi: SpatialVector = [
      vParentXformed[0] + S[0] * qd_val,
      vParentXformed[1] + S[1] * qd_val,
      vParentXformed[2] + S[2] * qd_val,
      vParentXformed[3] + S[3] * qd_val,
      vParentXformed[4] + S[4] * qd_val,
      vParentXformed[5] + S[5] * qd_val,
    ];
    v.set(node.name, vi);

    // Transform parent spatial acceleration: a_parent_X = X * a_p
    const aParentXformed = transformSpatialMotion(xform, parentA);

    // Coriolis / centripetal cross product: v_i x (S * qd)
    const Sqd: SpatialVector = [
      S[0] * qd_val,
      S[1] * qd_val,
      S[2] * qd_val,
      S[3] * qd_val,
      S[4] * qd_val,
      S[5] * qd_val,
    ];
    const c_i = spatialCrossMotion(vi, Sqd);

    // Link acceleration: a_i = X_i * a_p + S * qdd + c_i
    const ai: SpatialVector = [
      aParentXformed[0] + S[0] * qdd_val + c_i[0],
      aParentXformed[1] + S[1] * qdd_val + c_i[1],
      aParentXformed[2] + S[2] * qdd_val + c_i[2],
      aParentXformed[3] + S[3] * qdd_val + c_i[3],
      aParentXformed[4] + S[4] * qdd_val + c_i[4],
      aParentXformed[5] + S[5] * qdd_val + c_i[5],
    ];
    a.set(node.name, ai);

    // Inertial force: f_i = I * a_i + v_i x* (I * v_i) using full 6x6 spatial inertia (with COM offset & off-diagonals)
    const I = linkSpatialInertia(node);
    const Ia = matVec6(I, ai);
    const Iv = matVec6(I, vi);
    const vCrossIv = spatialCrossForce(vi, Iv);
    const fi: SpatialVector = [
      Ia[0] + vCrossIv[0],
      Ia[1] + vCrossIv[1],
      Ia[2] + vCrossIv[2],
      Ia[3] + vCrossIv[3],
      Ia[4] + vCrossIv[4],
      Ia[5] + vCrossIv[5],
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

    // Transmit force to parent link: f_parent += X_i^T * f_i
    if (node.parentName && f.has(node.parentName)) {
      const fp = f.get(node.parentName)!;
      const xform = linkTransforms.get(node.name) ?? {
        R: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        r: [0, 0, 0],
      };
      const fParentContrib = transformSpatialForce(xform, fi);
      for (let j = 0; j < 6; j++) {
        fp[j] = (fp[j] ?? 0) + (fParentContrib[j] ?? 0);
      }
    }
  }

  return { jointTorques };
}

/**
 * Computes forward dynamics using the exact 3-pass Articulated Body Algorithm (ABA):
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

  // Pass 1: Kinematics, link velocities, and Coriolis accelerations
  const v = new Map<string, SpatialVector>();
  const c = new Map<string, SpatialVector>();
  const S_map = new Map<string, SpatialVector>();
  const xform_map = new Map<string, SpatialTransform>();
  const IA_map = new Map<string, number[][]>();
  const pA_map = new Map<string, SpatialVector>();

  for (const node of tree) {
    const q_val = node.jointName ? (q.get(node.jointName) ?? 0) : 0;
    const qd_val = node.jointName ? (qd.get(node.jointName) ?? 0) : 0;

    const parentV: SpatialVector =
      node.parentName && v.has(node.parentName) ? (v.get(node.parentName) ?? [0, 0, 0, 0, 0, 0]) : [0, 0, 0, 0, 0, 0];

    const S: SpatialVector =
      node.jointType === "prismatic"
        ? [0, 0, 0, node.axis.x, node.axis.y, node.axis.z]
        : node.jointType === "revolute" || node.jointType === "continuous"
          ? [node.axis.x, node.axis.y, node.axis.z, 0, 0, 0]
          : [0, 0, 0, 0, 0, 0];
    S_map.set(node.name, S);

    const xform = computeJointSpatialTransform(node, q_val);
    xform_map.set(node.name, xform);

    const vParentXformed = transformSpatialMotion(xform, parentV);
    const vi: SpatialVector = [
      vParentXformed[0] + S[0] * qd_val,
      vParentXformed[1] + S[1] * qd_val,
      vParentXformed[2] + S[2] * qd_val,
      vParentXformed[3] + S[3] * qd_val,
      vParentXformed[4] + S[4] * qd_val,
      vParentXformed[5] + S[5] * qd_val,
    ];
    v.set(node.name, vi);

    const Sqd: SpatialVector = [
      S[0] * qd_val,
      S[1] * qd_val,
      S[2] * qd_val,
      S[3] * qd_val,
      S[4] * qd_val,
      S[5] * qd_val,
    ];
    const ci = spatialCrossMotion(vi, Sqd);
    c.set(node.name, ci);

    // Initial articulated body inertia and bias force
    const I = linkSpatialInertia(node);
    IA_map.set(node.name, I);

    // p_i = v_i x* (I * v_i)
    const Iv = matVec6(I, vi);
    const pi = spatialCrossForce(vi, Iv);
    pA_map.set(node.name, pi);
  }

  // Pass 2: Articulated body inertias and bias forces (Tips to base)
  const U_map = new Map<string, SpatialVector>();
  const D_map = new Map<string, number>();
  const u_map = new Map<string, number>();

  for (let i = tree.length - 1; i >= 0; i--) {
    const node = tree[i]!;
    const IA = IA_map.get(node.name)!;
    const pA = pA_map.get(node.name)!;
    const S = S_map.get(node.name)!;

    if (!node.jointName || node.jointType === "fixed") {
      // Fixed joints: transmit articulated inertia and bias directly to parent
      if (node.parentName && IA_map.has(node.parentName)) {
        const parentIA = IA_map.get(node.parentName)!;
        const parentPA = pA_map.get(node.parentName)!;
        const xform = xform_map.get(node.name)!;

        const Ia_p = transformSpatialInertia(xform, IA);
        const pa_p = transformSpatialForce(xform, pA);

        for (let r = 0; r < 6; r++) {
          parentPA[r] = (parentPA[r] ?? 0) + (pa_p[r] ?? 0);
          const pIaRow = parentIA[r];
          const IaRow = Ia_p[r];
          if (pIaRow && IaRow) {
            for (let col = 0; col < 6; col++) {
              pIaRow[col] = (pIaRow[col] ?? 0) + (IaRow[col] ?? 0);
            }
          }
        }
      }
      continue;
    }

    // U = I^A * S
    const U: SpatialVector = [0, 0, 0, 0, 0, 0];
    for (let r = 0; r < 6; r++) {
      let sum = 0;
      for (let col = 0; col < 6; col++) {
        sum += (IA[r]?.[col] ?? 0) * (S[col] ?? 0);
      }
      U[r] = sum;
    }
    U_map.set(node.name, U);

    // D = S^T * U
    let D = 0;
    for (let j = 0; j < 6; j++) {
      D += (S[j] ?? 0) * (U[j] ?? 0);
    }
    if (Math.abs(D) < 1e-9) {
      D = 1e-6; // Regularization for singular DOF
    }
    D_map.set(node.name, D);

    // u = tau - S^T * p^A
    const tau_val = tau.get(node.jointName) ?? 0;
    let St_pA = 0;
    for (let j = 0; j < 6; j++) {
      St_pA += (S[j] ?? 0) * (pA[j] ?? 0);
    }
    const u = tau_val - St_pA;
    u_map.set(node.name, u);

    // Articulated inertia correction: I_a = I^A - (U * U^T) / D
    const Ia: number[][] = Array.from({ length: 6 }, () => [0, 0, 0, 0, 0, 0]);
    for (let r = 0; r < 6; r++) {
      const iaRow = Ia[r]!;
      for (let col = 0; col < 6; col++) {
        iaRow[col] = (IA[r]?.[col] ?? 0) - ((U[r] ?? 0) * (U[col] ?? 0)) / D;
      }
    }

    // Bias force correction: p_a = p^A + I_a * c + (U * u) / D
    const ci = c.get(node.name)!;
    const pa: SpatialVector = [0, 0, 0, 0, 0, 0];
    for (let r = 0; r < 6; r++) {
      let Ia_c = 0;
      for (let col = 0; col < 6; col++) {
        Ia_c += (Ia[r]?.[col] ?? 0) * (ci[col] ?? 0);
      }
      pa[r] = (pA[r] ?? 0) + Ia_c + ((U[r] ?? 0) * u) / D;
    }

    // Propagate to parent
    if (node.parentName && IA_map.has(node.parentName)) {
      const parentIA = IA_map.get(node.parentName)!;
      const parentPA = pA_map.get(node.parentName)!;
      const xform = xform_map.get(node.name)!;

      const Ia_p = transformSpatialInertia(xform, Ia);
      const pa_p = transformSpatialForce(xform, pa);

      for (let r = 0; r < 6; r++) {
        parentPA[r] = (parentPA[r] ?? 0) + (pa_p[r] ?? 0);
        const pIaRow = parentIA[r];
        const IaRow = Ia_p[r];
        if (pIaRow && IaRow) {
          for (let col = 0; col < 6; col++) {
            pIaRow[col] = (pIaRow[col] ?? 0) + (IaRow[col] ?? 0);
          }
        }
      }
    }
  }

  // Pass 3: Joint and link accelerations (Base to tips)
  const a = new Map<string, SpatialVector>();
  const a0: SpatialVector = [0, 0, 0, 0, 0, gravity];

  for (const node of tree) {
    const parentA: SpatialVector = node.parentName && a.has(node.parentName) ? (a.get(node.parentName) ?? a0) : a0;
    const xform = xform_map.get(node.name)!;
    const ci = c.get(node.name)!;

    // Shifted parent acceleration: a'_i = X * a_p + c_i
    const aPXformed = transformSpatialMotion(xform, parentA);
    const aPrime: SpatialVector = [
      aPXformed[0] + ci[0],
      aPXformed[1] + ci[1],
      aPXformed[2] + ci[2],
      aPXformed[3] + ci[3],
      aPXformed[4] + ci[4],
      aPXformed[5] + ci[5],
    ];

    if (!node.jointName || node.jointType === "fixed") {
      a.set(node.name, aPrime);
      continue;
    }

    const U = U_map.get(node.name)!;
    const D = D_map.get(node.name)!;
    const u = u_map.get(node.name)!;
    const S = S_map.get(node.name)!;

    // qdd = (u - U^T * a') / D
    let Ut_aPrime = 0;
    for (let j = 0; j < 6; j++) {
      Ut_aPrime += (U[j] ?? 0) * (aPrime[j] ?? 0);
    }
    const qdd = (u - Ut_aPrime) / D;
    jointAccelerations.set(node.jointName, qdd);

    // Link acceleration: a_i = a'_i + S * qdd
    const ai: SpatialVector = [
      aPrime[0] + S[0] * qdd,
      aPrime[1] + S[1] * qdd,
      aPrime[2] + S[2] * qdd,
      aPrime[3] + S[3] * qdd,
      aPrime[4] + S[4] * qdd,
      aPrime[5] + S[5] * qdd,
    ];
    a.set(node.name, ai);
  }

  return { jointAccelerations };
}
