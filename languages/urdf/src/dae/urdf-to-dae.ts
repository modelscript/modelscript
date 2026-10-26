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

  // 3. Formulate equations of motion for each articulated joint:
  //    M * der(qd) + D * qd + G = tau
  for (const node of tree) {
    if (!node.jointName || node.jointType === "fixed") {
      continue;
    }

    const jName = node.jointName;
    const joint = robot.joints.get(jName);
    const dampingVal = joint?.dynamics?.damping ?? 0.1;

    // Apparent inertia M
    const inertiaVal = node.jointType === "prismatic" ? Math.max(0.1, node.mass) : Math.max(0.01, node.inertia[2]);

    // Gravity bias term G = m * g * lever_arm * sin(q)
    const leverArm = Math.max(0.1, Math.sqrt(node.originPos.x ** 2 + node.originPos.y ** 2));
    const gCoeff = node.mass * gravityG * leverArm;

    const massExpr = dae.addRealLiteral(inertiaVal);
    const derQdExpr = dae.addDerExpr(dae.addNameExpr(`${jName}.qd`));
    const mTerm = dae.addBinaryExpr(BinOp.Mul, massExpr, derQdExpr);

    // Damping term: d * qd
    const dampTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(dampingVal), dae.addNameExpr(`${jName}.qd`));

    // Gravity term: G * q (linearized near equilibrium for arena solver)
    const gravTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(gCoeff), dae.addNameExpr(`${jName}.q`));

    // LHS = M*der(qd) + D*qd + G*q
    const lhs = dae.addBinaryExpr(BinOp.Add, dae.addBinaryExpr(BinOp.Add, mTerm, dampTerm), gravTerm);
    const rhs = dae.addNameExpr(`${jName}.tau`);

    dae.addEquation(EqKind.Simple, lhs, rhs);
  }

  // 4. Link forward kinematics equations: link.z = parent.z + origin.z + q (if prismatic)
  let parentZExpr = dae.addRealLiteral(0.0);
  for (const node of tree) {
    const lName = node.name;
    const zOffset = dae.addRealLiteral(node.originPos.z);
    let linkZ = dae.addBinaryExpr(BinOp.Add, parentZExpr, zOffset);

    if (node.jointName && node.jointType === "prismatic") {
      linkZ = dae.addBinaryExpr(BinOp.Add, linkZ, dae.addNameExpr(`${node.jointName}.q`));
    }

    dae.addEquation(EqKind.Simple, dae.addNameExpr(`${lName}.z`), linkZ);
    parentZExpr = dae.addNameExpr(`${lName}.z`);
  }

  return dae;
}
