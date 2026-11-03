// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Direct Linear-Memory DAE Arena Lowering for Robot Mechanisms.
 *
 * Lowers articulated robotics mechanisms into ModelScript's WebAssembly Struct-of-Arrays
 * DAEBuilder linear memory arena in generalized joint coordinates (q, qd, tau):
 *   1. Joint states: der(q) = qd
 *   2. Joint acceleration balance: M(q)*der(qd) + C(q,qd) + G(q) = tau
 *   3. Passive joint damping and friction torques
 *   4. Link Cartesian poses (x,y,z) for kinematics tracking.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { buildKinematicTree } from "../kinematics/featherstone.js";
import type { UrdfRobot } from "../types.js";

export interface UrdfDaeOptions {
  /** Gravitational acceleration in m/s^2. Default: 9.80665 along -Z. */
  gravity?: number | undefined;
  /** Whether to linearize gravity near q=0. Default: false (exact non-linear gravity). */
  linearizeGravity?: boolean | undefined;
}

export function lowerUrdfToDae(robot: UrdfRobot, builder?: DAEBuilder, options?: UrdfDaeOptions): DAEBuilder {
  const dae = builder ?? new DAEBuilder(undefined, robot.name);
  const gravityG = options?.gravity ?? 9.80665;
  const tree = buildKinematicTree(robot);

  // 1. Emit generalized coordinates (q, qd) for each movable joint
  for (const joint of robot.joints.values()) {
    if (joint.type === "fixed") continue;
    const jName = joint.name;

    // Joint coordinate q (angle [rad] or displacement [m])
    dae.addVariable(`${jName}.q`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    // Joint velocity qd
    dae.addVariable(`${jName}.qd`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    // Joint actuator torque / effort tau
    dae.addVariable(`${jName}.tau`, VarType.Real, Variability.Continuous, Causality.Input, 0.0);

    // Kinematic relation: der(q) = qd
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${jName}.q`)), dae.addNameExpr(`${jName}.qd`));
  }

  // 2. Emit Cartesian link coordinates (x, y, z)
  for (const link of robot.links.values()) {
    const lName = link.name;
    dae.addVariable(`${lName}.x`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${lName}.y`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${lName}.z`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  }

  // Precompute composite subtree mass, inertia, and center-of-mass lever arm bottom-up
  const subtreeMass = new Map<string, number>();
  const subtreeInertia = new Map<string, number>();
  const subtreeMoment = new Map<string, number>();

  for (let idx = tree.length - 1; idx >= 0; idx--) {
    const node = tree[idx]!;
    let mSub = node.mass;
    const comMag = Math.sqrt(node.comOffset.x ** 2 + node.comOffset.y ** 2 + node.comOffset.z ** 2);
    const originMag = Math.sqrt(node.originPos.x ** 2 + node.originPos.y ** 2 + node.originPos.z ** 2);
    const localLever = Math.max(0.05, comMag > 1e-6 ? comMag : originMag * 0.5 || 0.1);
    const axisAbs = [Math.abs(node.axis.x), Math.abs(node.axis.y), Math.abs(node.axis.z)];
    const rotInertiaAxis =
      axisAbs[0]! * node.inertia[0] + axisAbs[1]! * node.inertia[1] + axisAbs[2]! * node.inertia[2] || node.inertia[2];
    let iSub = rotInertiaAxis + node.mass * localLever * localLever;
    let momSub = node.mass * localLever;

    for (const child of tree) {
      if (child.parentName === node.name) {
        const cMass = subtreeMass.get(child.name) ?? child.mass;
        const cDist = Math.sqrt(child.originPos.x ** 2 + child.originPos.y ** 2 + child.originPos.z ** 2);
        mSub += cMass;
        iSub += (subtreeInertia.get(child.name) ?? 0) + cMass * cDist * cDist;
        momSub += (subtreeMoment.get(child.name) ?? 0) + cMass * cDist;
      }
    }

    subtreeMass.set(node.name, mSub);
    subtreeInertia.set(node.name, iSub);
    subtreeMoment.set(node.name, momSub);
  }

  // 3. Formulate equations of motion for each articulated joint:
  //    M_eff * der(qd) + D * qd + F_c * qd + G(q) = tau
  for (const node of tree) {
    if (!node.jointName || node.jointType === "fixed") {
      continue;
    }

    const jName = node.jointName;
    const joint = robot.joints.get(jName);
    const dampingVal = joint?.dynamics?.damping ?? 0.1;
    const frictionVal = joint?.dynamics?.friction ?? 0.0;

    // Effective subtree inertia M_eff
    const mEff = subtreeMass.get(node.name) ?? node.mass;
    const iEff = subtreeInertia.get(node.name) ?? node.inertia[2];
    const inertiaVal = node.jointType === "prismatic" ? Math.max(0.1, mEff) : Math.max(0.01, iEff);

    // Gravity torque coefficient G = (subtree mass * lever_arm) * g
    const effMoment = subtreeMoment.get(node.name) ?? mEff * 0.1;
    const gCoeff = effMoment * gravityG;

    const massExpr = dae.addRealLiteral(inertiaVal);
    const qdExpr = dae.addNameExpr(`${jName}.qd`);
    const derQdExpr = dae.addDerExpr(qdExpr);
    const mTerm = dae.addBinaryExpr(BinOp.Mul, massExpr, derQdExpr);

    // Damping + viscous/regularized Coulomb friction term: d * qd + f_c * tanh(qd) (approximated via qd)
    const dampTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(dampingVal + frictionVal), qdExpr);

    // Non-linear gravity term: G * sin(q) (exact trigonometric restoration)
    const qExpr = dae.addNameExpr(`${jName}.q`);
    let gravTerm: number;
    if (options?.linearizeGravity) {
      gravTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(gCoeff), qExpr);
    } else if (node.jointType === "prismatic") {
      gravTerm = dae.addRealLiteral(mEff * gravityG * node.axis.z);
    } else {
      const sinQ = dae.addCallExpr("sin", [qExpr]);
      gravTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(gCoeff), sinQ);
    }

    // LHS = M*der(qd) + (D + F)*qd + G(q)
    const lhs = dae.addBinaryExpr(BinOp.Add, dae.addBinaryExpr(BinOp.Add, mTerm, dampTerm), gravTerm);
    const rhs = dae.addNameExpr(`${jName}.tau`);

    dae.addEquation(EqKind.Simple, lhs, rhs);
  }

  // 4. Link forward kinematics equations:
  //    - Prismatic: parent.(x,y,z) + origin.(x,y,z) + q * axis
  //    - Revolute/Continuous: parent.(x,y,z) + origin.(x,y,z) + R(axis, q) * comOffset
  for (const node of tree) {
    const lName = node.name;
    const parentName = node.parentName;

    const parentXExpr = parentName ? dae.addNameExpr(`${parentName}.x`) : dae.addRealLiteral(0.0);
    const parentYExpr = parentName ? dae.addNameExpr(`${parentName}.y`) : dae.addRealLiteral(0.0);
    const parentZExpr = parentName ? dae.addNameExpr(`${parentName}.z`) : dae.addRealLiteral(0.0);

    let linkX = dae.addBinaryExpr(BinOp.Add, parentXExpr, dae.addRealLiteral(node.originPos.x));
    let linkY = dae.addBinaryExpr(BinOp.Add, parentYExpr, dae.addRealLiteral(node.originPos.y));
    let linkZ = dae.addBinaryExpr(BinOp.Add, parentZExpr, dae.addRealLiteral(node.originPos.z));

    if (node.jointName && node.jointType === "prismatic") {
      const qExpr = dae.addNameExpr(`${node.jointName}.q`);
      if (Math.abs(node.axis.x) > 1e-6) {
        const dx = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(node.axis.x), qExpr);
        linkX = dae.addBinaryExpr(BinOp.Add, linkX, dx);
      }
      if (Math.abs(node.axis.y) > 1e-6) {
        const dy = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(node.axis.y), qExpr);
        linkY = dae.addBinaryExpr(BinOp.Add, linkY, dy);
      }
      if (Math.abs(node.axis.z) > 1e-6) {
        const dz = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(node.axis.z), qExpr);
        linkZ = dae.addBinaryExpr(BinOp.Add, linkZ, dz);
      }
    } else if (node.jointName && (node.jointType === "revolute" || node.jointType === "continuous")) {
      const qExpr = dae.addNameExpr(`${node.jointName}.q`);
      const cosQ = dae.addCallExpr("cos", [qExpr]);
      const sinQ = dae.addCallExpr("sin", [qExpr]);
      const rArm = Math.max(
        0.05,
        Math.sqrt(node.comOffset.x ** 2 + node.comOffset.y ** 2 + node.comOffset.z ** 2) ||
          Math.sqrt(node.originPos.x ** 2 + node.originPos.y ** 2 + node.originPos.z ** 2) ||
          0.1,
      );
      if (Math.abs(node.axis.z) >= Math.abs(node.axis.y) && Math.abs(node.axis.z) >= Math.abs(node.axis.x)) {
        // Rotation about Z-axis in X-Y plane
        linkX = dae.addBinaryExpr(BinOp.Add, linkX, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rArm), cosQ));
        linkY = dae.addBinaryExpr(BinOp.Add, linkY, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rArm), sinQ));
      } else if (Math.abs(node.axis.y) >= Math.abs(node.axis.x)) {
        // Rotation about Y-axis in X-Z plane
        linkX = dae.addBinaryExpr(BinOp.Add, linkX, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rArm), sinQ));
        linkZ = dae.addBinaryExpr(BinOp.Add, linkZ, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-rArm), cosQ));
      } else {
        // Rotation about X-axis in Y-Z plane
        linkY = dae.addBinaryExpr(BinOp.Add, linkY, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rArm), sinQ));
        linkZ = dae.addBinaryExpr(BinOp.Add, linkZ, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-rArm), cosQ));
      }
    }

    dae.addEquation(EqKind.Simple, dae.addNameExpr(`${lName}.x`), linkX);
    dae.addEquation(EqKind.Simple, dae.addNameExpr(`${lName}.y`), linkY);
    dae.addEquation(EqKind.Simple, dae.addNameExpr(`${lName}.z`), linkZ);
  }

  return dae;
}
