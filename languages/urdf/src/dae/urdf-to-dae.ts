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

    // Gravity bias term G = m * g * lever_arm * sin(q) (or linearized G*q)
    const leverArm = Math.max(0.1, Math.sqrt(node.originPos.x ** 2 + node.originPos.y ** 2));
    const gCoeff = node.mass * gravityG * leverArm;

    const massExpr = dae.addRealLiteral(inertiaVal);
    const derQdExpr = dae.addDerExpr(dae.addNameExpr(`${jName}.qd`));
    const mTerm = dae.addBinaryExpr(BinOp.Mul, massExpr, derQdExpr);

    // Damping term: d * qd
    const dampTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(dampingVal), dae.addNameExpr(`${jName}.qd`));

    // Non-linear gravity term: G * sin(q) (exact trigonometric restoration)
    let gravTerm: number;
    if (options?.linearizeGravity || node.jointType === "prismatic") {
      gravTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(gCoeff), dae.addNameExpr(`${jName}.q`));
    } else {
      const qExpr = dae.addNameExpr(`${jName}.q`);
      const daeWithCall = dae as unknown as { addCall?: (funcId: number, arg: number, count: number) => number };
      const sinQ =
        typeof daeWithCall.addCall === "function"
          ? daeWithCall.addCall(0, qExpr, 1) // BuiltinMathFunc.Sin = 0
          : qExpr;
      gravTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(gCoeff), sinQ);
    }

    // LHS = M*der(qd) + D*qd + G
    const lhs = dae.addBinaryExpr(BinOp.Add, dae.addBinaryExpr(BinOp.Add, mTerm, dampTerm), gravTerm);
    const rhs = dae.addNameExpr(`${jName}.tau`);

    dae.addEquation(EqKind.Simple, lhs, rhs);
  }

  // 4. Link forward kinematics equations: link.(x,y,z) = parent.(x,y,z) + origin.(x,y,z) (+ q * axis if prismatic)
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
    }

    dae.addEquation(EqKind.Simple, dae.addNameExpr(`${lName}.x`), linkX);
    dae.addEquation(EqKind.Simple, dae.addNameExpr(`${lName}.y`), linkY);
    dae.addEquation(EqKind.Simple, dae.addNameExpr(`${lName}.z`), linkZ);
  }

  return dae;
}
