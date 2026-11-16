// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Direct Linear-Memory DAE Arena Lowering for Robot Mechanisms.
 *
 * Lowers articulated robotics mechanisms into ModelScript's WebAssembly Struct-of-Arrays
 * DAEBuilder linear memory arena:
 *   1. Fixed-base articulated chains: generalized coordinates (q, qd, tau) & link poses.
 *   2. 6-DOF floating-base robots (<freejoint>): (x,y,z), unit quaternion (qw,qx,qy,qz)
 *      with Baumgarte stabilization, full 3D articulated child-link kinematics (Rodrigues),
 *      and Newton-Euler spatial dynamics.
 *   3. Arena-native MuJoCo soft pyramidal contact wrenches (solref, solimp, friction)
 *      with full Jacobian transpose wrench projection J_c(q)^T F_c onto child joints.
 *   4. Synthetic IMU (accelerometer, gyro, framequat) and joint sensor outputs.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { buildKinematicTree, type LinkKinematicsNode } from "../kinematics/featherstone.js";
import type { UrdfRobot, Vector3D } from "../types.js";
import {
  extractContactPointsFromRobot,
  lowerSoftContactPointToDae,
  type LoweredContactWrench,
} from "./contact-lowering.js";

export interface UrdfDaeOptions {
  /** Gravitational acceleration in m/s^2. Default: 9.80665 along -Z. */
  gravity?: number | undefined;
  /** Whether to linearize gravity near q=0. Default: false (exact non-linear gravity). */
  linearizeGravity?: boolean | undefined;
  /** Enable MuJoCo-compatible soft pyramidal contact lowering for collision geoms. Default: auto (true if floating base + collision geoms). */
  enableContact?: boolean | undefined;
  /** Initial floating-base Z height [m] override. */
  initialBaseZ?: number | undefined;
  /** Prefix for emitted DAE variables (optional, e.g. "robot."). */
  prefix?: string | undefined;
}

type Vec3Expr = [number, number, number];
// Row-major 3x3 ExprId matrix: [r00, r01, r02, r10, r11, r12, r20, r21, r22]
type Mat3Expr = [number, number, number, number, number, number, number, number, number];

function addSumExpr(dae: DAEBuilder, terms: number[]): number {
  if (terms.length === 0) return dae.addRealLiteral(0.0);
  let acc = terms[0]!;
  for (let i = 1; i < terms.length; i++) {
    acc = dae.addBinaryExpr(BinOp.Add, acc, terms[i]!);
  }
  return acc;
}

function mat3FromRpyNumeric(rpy: Vector3D): number[] {
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

function mat3Literal(dae: DAEBuilder, m: number[]): Mat3Expr {
  return [
    dae.addRealLiteral(m[0]!),
    dae.addRealLiteral(m[1]!),
    dae.addRealLiteral(m[2]!),
    dae.addRealLiteral(m[3]!),
    dae.addRealLiteral(m[4]!),
    dae.addRealLiteral(m[5]!),
    dae.addRealLiteral(m[6]!),
    dae.addRealLiteral(m[7]!),
    dae.addRealLiteral(m[8]!),
  ];
}

function mat3VecMulExpr(dae: DAEBuilder, M: Mat3Expr, v: Vec3Expr): Vec3Expr {
  return [
    addSumExpr(dae, [
      dae.addBinaryExpr(BinOp.Mul, M[0], v[0]),
      dae.addBinaryExpr(BinOp.Mul, M[1], v[1]),
      dae.addBinaryExpr(BinOp.Mul, M[2], v[2]),
    ]),
    addSumExpr(dae, [
      dae.addBinaryExpr(BinOp.Mul, M[3], v[0]),
      dae.addBinaryExpr(BinOp.Mul, M[4], v[1]),
      dae.addBinaryExpr(BinOp.Mul, M[5], v[2]),
    ]),
    addSumExpr(dae, [
      dae.addBinaryExpr(BinOp.Mul, M[6], v[0]),
      dae.addBinaryExpr(BinOp.Mul, M[7], v[1]),
      dae.addBinaryExpr(BinOp.Mul, M[8], v[2]),
    ]),
  ];
}

function mat3MulExpr(dae: DAEBuilder, A: Mat3Expr, B: Mat3Expr): Mat3Expr {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out.push(
        addSumExpr(dae, [
          dae.addBinaryExpr(BinOp.Mul, A[r * 3]!, B[c]!),
          dae.addBinaryExpr(BinOp.Mul, A[r * 3 + 1]!, B[3 + c]!),
          dae.addBinaryExpr(BinOp.Mul, A[r * 3 + 2]!, B[6 + c]!),
        ]),
      );
    }
  }
  return out as Mat3Expr;
}

function vec3AddExpr(dae: DAEBuilder, a: Vec3Expr, b: Vec3Expr): Vec3Expr {
  return [
    dae.addBinaryExpr(BinOp.Add, a[0], b[0]),
    dae.addBinaryExpr(BinOp.Add, a[1], b[1]),
    dae.addBinaryExpr(BinOp.Add, a[2], b[2]),
  ];
}

function vec3SubExpr(dae: DAEBuilder, a: Vec3Expr, b: Vec3Expr): Vec3Expr {
  return [
    dae.addBinaryExpr(BinOp.Sub, a[0], b[0]),
    dae.addBinaryExpr(BinOp.Sub, a[1], b[1]),
    dae.addBinaryExpr(BinOp.Sub, a[2], b[2]),
  ];
}

function crossExpr(dae: DAEBuilder, a: Vec3Expr, b: Vec3Expr): Vec3Expr {
  return [
    dae.addBinaryExpr(BinOp.Sub, dae.addBinaryExpr(BinOp.Mul, a[1], b[2]), dae.addBinaryExpr(BinOp.Mul, a[2], b[1])),
    dae.addBinaryExpr(BinOp.Sub, dae.addBinaryExpr(BinOp.Mul, a[2], b[0]), dae.addBinaryExpr(BinOp.Mul, a[0], b[2])),
    dae.addBinaryExpr(BinOp.Sub, dae.addBinaryExpr(BinOp.Mul, a[0], b[1]), dae.addBinaryExpr(BinOp.Mul, a[1], b[0])),
  ];
}

function dotExpr(dae: DAEBuilder, a: Vec3Expr, b: Vec3Expr): number {
  return addSumExpr(dae, [
    dae.addBinaryExpr(BinOp.Mul, a[0], b[0]),
    dae.addBinaryExpr(BinOp.Mul, a[1], b[1]),
    dae.addBinaryExpr(BinOp.Mul, a[2], b[2]),
  ]);
}

function quatToMat3Expr(dae: DAEBuilder, qw: number, qx: number, qy: number, qz: number): Mat3Expr {
  const two = dae.addRealLiteral(2.0);
  const one = dae.addRealLiteral(1.0);
  const qx2 = dae.addBinaryExpr(BinOp.Mul, qx, qx);
  const qy2 = dae.addBinaryExpr(BinOp.Mul, qy, qy);
  const qz2 = dae.addBinaryExpr(BinOp.Mul, qz, qz);
  const qxy = dae.addBinaryExpr(BinOp.Mul, qx, qy);
  const qxz = dae.addBinaryExpr(BinOp.Mul, qx, qz);
  const qyz = dae.addBinaryExpr(BinOp.Mul, qy, qz);
  const qwx = dae.addBinaryExpr(BinOp.Mul, qw, qx);
  const qwy = dae.addBinaryExpr(BinOp.Mul, qw, qy);
  const qwz = dae.addBinaryExpr(BinOp.Mul, qw, qz);

  return [
    dae.addBinaryExpr(BinOp.Sub, one, dae.addBinaryExpr(BinOp.Mul, two, dae.addBinaryExpr(BinOp.Add, qy2, qz2))),
    dae.addBinaryExpr(BinOp.Mul, two, dae.addBinaryExpr(BinOp.Sub, qxy, qwz)),
    dae.addBinaryExpr(BinOp.Mul, two, dae.addBinaryExpr(BinOp.Add, qxz, qwy)),
    dae.addBinaryExpr(BinOp.Mul, two, dae.addBinaryExpr(BinOp.Add, qxy, qwz)),
    dae.addBinaryExpr(BinOp.Sub, one, dae.addBinaryExpr(BinOp.Mul, two, dae.addBinaryExpr(BinOp.Add, qx2, qz2))),
    dae.addBinaryExpr(BinOp.Mul, two, dae.addBinaryExpr(BinOp.Sub, qyz, qwx)),
    dae.addBinaryExpr(BinOp.Mul, two, dae.addBinaryExpr(BinOp.Sub, qxz, qwy)),
    dae.addBinaryExpr(BinOp.Mul, two, dae.addBinaryExpr(BinOp.Add, qyz, qwx)),
    dae.addBinaryExpr(BinOp.Sub, one, dae.addBinaryExpr(BinOp.Mul, two, dae.addBinaryExpr(BinOp.Add, qx2, qy2))),
  ];
}

/** Rodrigues' rotation matrix R(axis, q) in DAEBuilder expressions. */
function rodriguesExpr(dae: DAEBuilder, axis: Vector3D, qExpr: number): Mat3Expr {
  const len = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const ux = axis.x / len;
  const uy = axis.y / len;
  const uz = axis.z / len;
  const c = dae.addCallExpr("cos", [qExpr]);
  const s = dae.addCallExpr("sin", [qExpr]);
  const omc = dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(1.0), c);

  const entry = (uA: number, uB: number, skewCoeff: number, diag: boolean): number => {
    const prod = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(uA * uB), omc);
    const base = diag ? dae.addBinaryExpr(BinOp.Add, c, prod) : prod;
    if (Math.abs(skewCoeff) < 1e-12) return base;
    const skew = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(skewCoeff), s);
    return dae.addBinaryExpr(BinOp.Add, base, skew);
  };

  return [
    entry(ux, ux, 0, true),
    entry(ux, uy, -uz, false),
    entry(ux, uz, uy, false),
    entry(uy, ux, uz, false),
    entry(uy, uy, 0, true),
    entry(uy, uz, -ux, false),
    entry(uz, ux, -uy, false),
    entry(uz, uy, ux, false),
    entry(uz, uz, 0, true),
  ];
}

/**
 * Lowers a 6-DOF floating-base robot with 3D articulated child-link kinematics,
 * soft pyramidal contact, Jacobian wrench projection, and IMU sensors.
 */
function lowerFloatingBaseUrdfToDae(
  robot: UrdfRobot,
  tree: LinkKinematicsNode[],
  dae: DAEBuilder,
  options: UrdfDaeOptions,
): DAEBuilder {
  const p = options.prefix ?? "";
  const gravityG = options.gravity ?? 9.80665;
  const floatingJoint = Array.from(robot.joints.values()).find((j) => j.type === "floating")!;
  const baseLinkName = floatingJoint.childLink;
  const baseNode = tree.find((n) => n.name === baseLinkName) ?? tree[0]!;
  const basePrefix = `${p}${baseLinkName}`;

  const initX = floatingJoint.origin?.xyz.x ?? 0.0;
  const initY = floatingJoint.origin?.xyz.y ?? 0.0;
  const initZ = options.initialBaseZ ?? floatingJoint.origin?.xyz.z ?? 0.25;

  // 1. Floating-base 6-DOF states: position, velocity, quaternion, angular velocity
  dae.addVariable(`${basePrefix}.x`, VarType.Real, Variability.Continuous, Causality.Local, initX);
  dae.addVariable(`${basePrefix}.y`, VarType.Real, Variability.Continuous, Causality.Local, initY);
  dae.addVariable(`${basePrefix}.z`, VarType.Real, Variability.Continuous, Causality.Local, initZ);
  dae.addVariable(`${basePrefix}.vx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  dae.addVariable(`${basePrefix}.vy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  dae.addVariable(`${basePrefix}.vz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  dae.addVariable(`${basePrefix}.qw`, VarType.Real, Variability.Continuous, Causality.Local, 1.0);
  dae.addVariable(`${basePrefix}.qx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  dae.addVariable(`${basePrefix}.qy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  dae.addVariable(`${basePrefix}.qz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  dae.addVariable(`${basePrefix}.wx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  dae.addVariable(`${basePrefix}.wy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  dae.addVariable(`${basePrefix}.wz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  dae.addEquation(
    EqKind.Simple,
    dae.addDerExpr(dae.addNameExpr(`${basePrefix}.x`)),
    dae.addNameExpr(`${basePrefix}.vx`),
  );
  dae.addEquation(
    EqKind.Simple,
    dae.addDerExpr(dae.addNameExpr(`${basePrefix}.y`)),
    dae.addNameExpr(`${basePrefix}.vy`),
  );
  dae.addEquation(
    EqKind.Simple,
    dae.addDerExpr(dae.addNameExpr(`${basePrefix}.z`)),
    dae.addNameExpr(`${basePrefix}.vz`),
  );

  const qw = dae.addNameExpr(`${basePrefix}.qw`);
  const qx = dae.addNameExpr(`${basePrefix}.qx`);
  const qy = dae.addNameExpr(`${basePrefix}.qy`);
  const qz = dae.addNameExpr(`${basePrefix}.qz`);
  const wx = dae.addNameExpr(`${basePrefix}.wx`);
  const wy = dae.addNameExpr(`${basePrefix}.wy`);
  const wz = dae.addNameExpr(`${basePrefix}.wz`);

  const normSq = addSumExpr(dae, [
    dae.addBinaryExpr(BinOp.Mul, qw, qw),
    dae.addBinaryExpr(BinOp.Mul, qx, qx),
    dae.addBinaryExpr(BinOp.Mul, qy, qy),
    dae.addBinaryExpr(BinOp.Mul, qz, qz),
  ]);
  const baumgarte = dae.addBinaryExpr(
    BinOp.Mul,
    dae.addRealLiteral(10.0),
    dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(1.0), normSq),
  );
  const half = dae.addRealLiteral(0.5);

  dae.addEquation(
    EqKind.Simple,
    dae.addDerExpr(qw),
    dae.addBinaryExpr(
      BinOp.Add,
      dae.addBinaryExpr(
        BinOp.Mul,
        half,
        addSumExpr(dae, [
          dae.addBinaryExpr(BinOp.Mul, dae.addUnaryExpr(0, qx), wx),
          dae.addBinaryExpr(BinOp.Mul, dae.addUnaryExpr(0, qy), wy),
          dae.addBinaryExpr(BinOp.Mul, dae.addUnaryExpr(0, qz), wz),
        ]),
      ),
      dae.addBinaryExpr(BinOp.Mul, baumgarte, qw),
    ),
  );
  dae.addEquation(
    EqKind.Simple,
    dae.addDerExpr(qx),
    dae.addBinaryExpr(
      BinOp.Add,
      dae.addBinaryExpr(
        BinOp.Mul,
        half,
        addSumExpr(dae, [
          dae.addBinaryExpr(BinOp.Mul, qw, wx),
          dae.addBinaryExpr(BinOp.Mul, qy, wz),
          dae.addBinaryExpr(BinOp.Mul, dae.addUnaryExpr(0, qz), wy),
        ]),
      ),
      dae.addBinaryExpr(BinOp.Mul, baumgarte, qx),
    ),
  );
  dae.addEquation(
    EqKind.Simple,
    dae.addDerExpr(qy),
    dae.addBinaryExpr(
      BinOp.Add,
      dae.addBinaryExpr(
        BinOp.Mul,
        half,
        addSumExpr(dae, [
          dae.addBinaryExpr(BinOp.Mul, qw, wy),
          dae.addBinaryExpr(BinOp.Mul, dae.addUnaryExpr(0, qx), wz),
          dae.addBinaryExpr(BinOp.Mul, qz, wx),
        ]),
      ),
      dae.addBinaryExpr(BinOp.Mul, baumgarte, qy),
    ),
  );
  dae.addEquation(
    EqKind.Simple,
    dae.addDerExpr(qz),
    dae.addBinaryExpr(
      BinOp.Add,
      dae.addBinaryExpr(
        BinOp.Mul,
        half,
        addSumExpr(dae, [
          dae.addBinaryExpr(BinOp.Mul, qw, wz),
          dae.addBinaryExpr(BinOp.Mul, qx, wy),
          dae.addBinaryExpr(BinOp.Mul, dae.addUnaryExpr(0, qy), wx),
        ]),
      ),
      dae.addBinaryExpr(BinOp.Mul, baumgarte, qz),
    ),
  );

  function materializeVec3(name: string, v: Vec3Expr): Vec3Expr {
    const out: number[] = [];
    for (let i = 0; i < 3; i++) {
      const vn = `${name}_${i}`;
      dae.addVariable(vn, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      dae.addEquation(EqKind.Simple, dae.addNameExpr(vn), v[i]!);
      out.push(dae.addNameExpr(vn));
    }
    return out as Vec3Expr;
  }

  function materializeMat3(name: string, m: Mat3Expr): Mat3Expr {
    const out: number[] = [];
    for (let i = 0; i < 9; i++) {
      const vn = `${name}_${i}`;
      dae.addVariable(
        vn,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        i === 0 || i === 4 || i === 8 ? 1.0 : 0.0,
      );
      dae.addEquation(EqKind.Simple, dae.addNameExpr(vn), m[i]!);
      out.push(dae.addNameExpr(vn));
    }
    return out as Mat3Expr;
  }

  // Base world position and rotation matrix R_base
  const basePosWorld: Vec3Expr = [
    dae.addNameExpr(`${basePrefix}.x`),
    dae.addNameExpr(`${basePrefix}.y`),
    dae.addNameExpr(`${basePrefix}.z`),
  ];
  const baseVelWorld: Vec3Expr = [
    dae.addNameExpr(`${basePrefix}.vx`),
    dae.addNameExpr(`${basePrefix}.vy`),
    dae.addNameExpr(`${basePrefix}.vz`),
  ];
  const baseOmegaWorld: Vec3Expr = [wx, wy, wz];
  const Rbase = materializeMat3(`${basePrefix}._R`, quatToMat3Expr(dae, qw, qx, qy, qz));

  // 2. Declare articulated child joints (q, qd, tau) before kinematics so expressions can reference q
  let totalMass = 0.0;
  for (const node of tree) {
    if (node.name !== "world") totalMass += node.mass;
  }
  totalMass = Math.max(0.05, totalMass);

  for (const joint of robot.joints.values()) {
    if (joint.type === "fixed" || joint.type === "floating") continue;
    const jName = `${p}${joint.name}`;
    dae.addVariable(`${jName}.q`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${jName}.qd`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${jName}.tau`, VarType.Real, Variability.Continuous, Causality.Input, 0.0);
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${jName}.q`)), dae.addNameExpr(`${jName}.qd`));
  }

  // 3. Full 3D articulated forward kinematics (Rodrigues + parent rotation, O(1) depth per link)
  interface LinkFrameExpr {
    posInBase: Vec3Expr;
    rotInBase: Mat3Expr;
    posWorld: Vec3Expr;
    rotWorld: Mat3Expr;
    ancestors: {
      jointName: string;
      jointType: string;
      axisWorld: Vec3Expr;
      originWorld: Vec3Expr;
    }[];
  }

  const linkFrames = new Map<string, LinkFrameExpr>();
  linkFrames.set(baseLinkName, {
    posInBase: [dae.addRealLiteral(0.0), dae.addRealLiteral(0.0), dae.addRealLiteral(0.0)],
    rotInBase: mat3Literal(dae, [1, 0, 0, 0, 1, 0, 0, 0, 1]),
    posWorld: basePosWorld,
    rotWorld: Rbase,
    ancestors: [],
  });

  for (const node of tree) {
    if (node.name === "world" || node.name === baseLinkName) continue;
    const lPrefix = `${p}${node.name}`;
    const parentFrame = linkFrames.get(node.parentName ?? baseLinkName) ?? linkFrames.get(baseLinkName)!;
    const originVec: Vec3Expr = [
      dae.addRealLiteral(node.originPos.x),
      dae.addRealLiteral(node.originPos.y),
      dae.addRealLiteral(node.originPos.z),
    ];
    const rotatedOffset = mat3VecMulExpr(dae, parentFrame.rotInBase, originVec);
    let posInBase = vec3AddExpr(dae, parentFrame.posInBase, rotatedOffset);
    const Rorigin = mat3Literal(dae, mat3FromRpyNumeric(node.originRpy));
    const Rpre = mat3MulExpr(dae, parentFrame.rotInBase, Rorigin);
    let rotInBase = Rpre;
    const ancestors = [...parentFrame.ancestors];

    if (node.jointName && node.jointType === "prismatic") {
      const qExpr = dae.addNameExpr(`${p}${node.jointName}.q`);
      const axisVec: Vec3Expr = [
        dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(node.axis.x), qExpr),
        dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(node.axis.y), qExpr),
        dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(node.axis.z), qExpr),
      ];
      posInBase = vec3AddExpr(dae, posInBase, mat3VecMulExpr(dae, Rpre, axisVec));
      const axisInBase = mat3VecMulExpr(dae, Rpre, [
        dae.addRealLiteral(node.axis.x),
        dae.addRealLiteral(node.axis.y),
        dae.addRealLiteral(node.axis.z),
      ]);
      posInBase = materializeVec3(`${lPrefix}._pb`, posInBase);
      rotInBase = materializeMat3(`${lPrefix}._Rb`, rotInBase);
      ancestors.push({
        jointName: node.jointName,
        jointType: node.jointType,
        axisWorld: materializeVec3(`${p}${node.jointName}._aw`, mat3VecMulExpr(dae, Rbase, axisInBase)),
        originWorld: materializeVec3(
          `${p}${node.jointName}._ow`,
          vec3AddExpr(dae, basePosWorld, mat3VecMulExpr(dae, Rbase, posInBase)),
        ),
      });
    } else if (node.jointName && (node.jointType === "revolute" || node.jointType === "continuous")) {
      const qExpr = dae.addNameExpr(`${p}${node.jointName}.q`);
      const Rjoint = rodriguesExpr(dae, node.axis, qExpr);
      rotInBase = mat3MulExpr(dae, Rpre, Rjoint);
      const axisInBase = mat3VecMulExpr(dae, Rpre, [
        dae.addRealLiteral(node.axis.x),
        dae.addRealLiteral(node.axis.y),
        dae.addRealLiteral(node.axis.z),
      ]);
      posInBase = materializeVec3(`${lPrefix}._pb`, posInBase);
      rotInBase = materializeMat3(`${lPrefix}._Rb`, rotInBase);
      ancestors.push({
        jointName: node.jointName,
        jointType: node.jointType,
        axisWorld: materializeVec3(`${p}${node.jointName}._aw`, mat3VecMulExpr(dae, Rbase, axisInBase)),
        originWorld: materializeVec3(
          `${p}${node.jointName}._ow`,
          vec3AddExpr(dae, basePosWorld, mat3VecMulExpr(dae, Rbase, posInBase)),
        ),
      });
    } else {
      posInBase = materializeVec3(`${lPrefix}._pb`, posInBase);
      rotInBase = materializeMat3(`${lPrefix}._Rb`, rotInBase);
    }

    const posWorld = vec3AddExpr(dae, basePosWorld, mat3VecMulExpr(dae, Rbase, posInBase));
    const rotWorld = materializeMat3(`${lPrefix}._Rw`, mat3MulExpr(dae, Rbase, rotInBase));

    dae.addVariable(`${lPrefix}.x`, VarType.Real, Variability.Continuous, Causality.Local, initX + node.originPos.x);
    dae.addVariable(`${lPrefix}.y`, VarType.Real, Variability.Continuous, Causality.Local, initY + node.originPos.y);
    dae.addVariable(`${lPrefix}.z`, VarType.Real, Variability.Continuous, Causality.Local, initZ + node.originPos.z);
    dae.addEquation(EqKind.Simple, dae.addNameExpr(`${lPrefix}.x`), posWorld[0]);
    dae.addEquation(EqKind.Simple, dae.addNameExpr(`${lPrefix}.y`), posWorld[1]);
    dae.addEquation(EqKind.Simple, dae.addNameExpr(`${lPrefix}.z`), posWorld[2]);
    const matPosWorld: Vec3Expr = [
      dae.addNameExpr(`${lPrefix}.x`),
      dae.addNameExpr(`${lPrefix}.y`),
      dae.addNameExpr(`${lPrefix}.z`),
    ];
    linkFrames.set(node.name, { posInBase, rotInBase, posWorld: matPosWorld, rotWorld, ancestors });
  }

  // 4. Soft Pyramidal Contact Wrenches + Jacobian Transpose Projection J_c(q)^T F_c
  const enableContact = options.enableContact ?? true;
  const fxTerms: number[] = [];
  const fyTerms: number[] = [];
  const fzTerms: number[] = [];
  const txTerms: number[] = [];
  const tyTerms: number[] = [];
  const tzTerms: number[] = [];
  const jointContactTauTerms = new Map<string, number[]>();

  if (enableContact) {
    const contactPoints = extractContactPointsFromRobot(robot);
    const numPts = Math.max(1, contactPoints.length);
    for (const pt of contactPoints) {
      const frame = linkFrames.get(pt.linkName) ?? linkFrames.get(baseLinkName)!;
      const localOffExpr: Vec3Expr = [
        dae.addRealLiteral(pt.localOffset.x),
        dae.addRealLiteral(pt.localOffset.y),
        dae.addRealLiteral(pt.localOffset.z),
      ];
      const rInBase = vec3AddExpr(dae, frame.posInBase, mat3VecMulExpr(dae, frame.rotInBase, localOffExpr));
      const rWorldRelBase = mat3VecMulExpr(dae, Rbase, rInBase);
      const pWorld = vec3AddExpr(dae, basePosWorld, rWorldRelBase);

      // Contact velocity = v_base + omega_base x r_world + sum_j qd_j * (a_j x (p_c - p_j))
      const rigidVel = vec3AddExpr(dae, baseVelWorld, crossExpr(dae, baseOmegaWorld, rWorldRelBase));
      const vxParts: number[] = [rigidVel[0]];
      const vyParts: number[] = [rigidVel[1]];
      const vzParts: number[] = [rigidVel[2]];
      for (const anc of frame.ancestors) {
        const qdExpr = dae.addNameExpr(`${p}${anc.jointName}.qd`);
        if (anc.jointType === "prismatic") {
          vxParts.push(dae.addBinaryExpr(BinOp.Mul, anc.axisWorld[0], qdExpr));
          vyParts.push(dae.addBinaryExpr(BinOp.Mul, anc.axisWorld[1], qdExpr));
          vzParts.push(dae.addBinaryExpr(BinOp.Mul, anc.axisWorld[2], qdExpr));
        } else {
          const lever = vec3SubExpr(dae, pWorld, anc.originWorld);
          const jVel = crossExpr(dae, anc.axisWorld, lever);
          vxParts.push(dae.addBinaryExpr(BinOp.Mul, jVel[0], qdExpr));
          vyParts.push(dae.addBinaryExpr(BinOp.Mul, jVel[1], qdExpr));
          vzParts.push(dae.addBinaryExpr(BinOp.Mul, jVel[2], qdExpr));
        }
      }

      const lowered: LoweredContactWrench = lowerSoftContactPointToDae(
        dae,
        { ...pt, name: `${p}${pt.name}`, effectiveMass: totalMass / numPts },
        { x: pWorld[0], y: pWorld[1], z: pWorld[2] },
        { vx: addSumExpr(dae, vxParts), vy: addSumExpr(dae, vyParts), vz: addSumExpr(dae, vzParts) },
      );

      const fcVec: Vec3Expr = [lowered.fxExprId, lowered.fyExprId, lowered.fzExprId];
      fxTerms.push(fcVec[0]);
      fyTerms.push(fcVec[1]);
      fzTerms.push(fcVec[2]);

      // Floating-base moment: r_world x F_c
      const baseMoment = crossExpr(dae, rWorldRelBase, fcVec);
      txTerms.push(baseMoment[0]);
      tyTerms.push(baseMoment[1]);
      tzTerms.push(baseMoment[2]);

      // Project contact wrench onto ancestor articulated joints: tau_j += a_j . ((p_c - p_j) x F_c)
      for (const anc of frame.ancestors) {
        let tauTerm: number;
        if (anc.jointType === "prismatic") {
          tauTerm = dotExpr(dae, anc.axisWorld, fcVec);
        } else {
          const lever = vec3SubExpr(dae, pWorld, anc.originWorld);
          tauTerm = dotExpr(dae, anc.axisWorld, crossExpr(dae, lever, fcVec));
        }
        const list = jointContactTauTerms.get(anc.jointName) ?? [];
        list.push(tauTerm);
        jointContactTauTerms.set(anc.jointName, list);
      }
    }
  }

  // 5. Composite Rigid Body (CRB) inertia, generalized gravity G(q), and child joint equations
  const jointGravityTauTerms = new Map<string, number[]>();
  const linkChildrenMap = new Map<string, LinkKinematicsNode[]>();
  for (const node of tree) {
    if (node.parentName) {
      const arr = linkChildrenMap.get(node.parentName) ?? [];
      arr.push(node);
      linkChildrenMap.set(node.parentName, arr);
    }
  }

  // Exact generalized gravity projection onto each ancestor joint: tau_g = a_j . ((p_com - p_j) x [0, 0, -m*g])
  for (const node of tree) {
    if (node.name === "world" || node.name === baseLinkName) continue;
    const frame = linkFrames.get(node.name);
    if (!frame || frame.ancestors.length === 0) continue;
    const comLocal: Vec3Expr = [
      dae.addRealLiteral(node.comOffset.x),
      dae.addRealLiteral(node.comOffset.y),
      dae.addRealLiteral(node.comOffset.z),
    ];
    const comWorld = vec3AddExpr(dae, frame.posWorld, mat3VecMulExpr(dae, frame.rotWorld, comLocal));
    const gravForce: Vec3Expr = [
      dae.addRealLiteral(0.0),
      dae.addRealLiteral(0.0),
      dae.addRealLiteral(-node.mass * gravityG),
    ];
    for (const anc of frame.ancestors) {
      let gTau: number;
      if (anc.jointType === "prismatic") {
        gTau = dotExpr(dae, anc.axisWorld, gravForce);
      } else {
        const lever = vec3SubExpr(dae, comWorld, anc.originWorld);
        gTau = dotExpr(dae, anc.axisWorld, crossExpr(dae, lever, gravForce));
      }
      const list = jointGravityTauTerms.get(anc.jointName) ?? [];
      list.push(gTau);
      jointGravityTauTerms.set(anc.jointName, list);
    }
  }

  // Bottom-up composite inertia & parallel-axis Steiner accumulation for each joint's subtree
  const crbMass = new Map<string, number>();
  const crbInertiaDiag = new Map<string, [number, number, number]>();
  for (let idx = tree.length - 1; idx >= 0; idx--) {
    const node = tree[idx]!;
    if (node.name === "world") continue;
    let mSub = node.mass;
    let ixxSub = node.inertia[0];
    let iyySub = node.inertia[1];
    let izzSub = node.inertia[2];
    for (const ch of linkChildrenMap.get(node.name) ?? []) {
      const mc = crbMass.get(ch.name) ?? ch.mass;
      const ic = crbInertiaDiag.get(ch.name) ?? ch.inertia;
      const dx = ch.originPos.x + ch.comOffset.x;
      const dy = ch.originPos.y + ch.comOffset.y;
      const dz = ch.originPos.z + ch.comOffset.z;
      mSub += mc;
      ixxSub += ic[0] + mc * (dy * dy + dz * dz);
      iyySub += ic[1] + mc * (dx * dx + dz * dz);
      izzSub += ic[2] + mc * (dx * dx + dy * dy);
    }
    crbMass.set(node.name, mSub);
    crbInertiaDiag.set(node.name, [ixxSub, iyySub, izzSub]);
  }

  // Collect joint actuator reaction torques on the floating base: -sum(tau_j * axis_j)
  for (const joint of robot.joints.values()) {
    if (joint.type === "fixed" || joint.type === "floating") continue;
    const jName = `${p}${joint.name}`;
    const node = tree.find((n) => n.jointName === joint.name);
    const subI: [number, number, number] = node ? (crbInertiaDiag.get(node.name) ?? node.inertia) : [0.01, 0.01, 0.01];
    const ax = node?.axis ?? { x: 0, y: 0, z: 1 };
    const iProj = Math.abs(ax.x) * subI[0] + Math.abs(ax.y) * subI[1] + Math.abs(ax.z) * subI[2];
    const iEff = Math.max(0.002, iProj);
    const damping = joint.dynamics?.damping ?? 0.05;
    const qdExpr = dae.addNameExpr(`${jName}.qd`);
    const lhs = dae.addBinaryExpr(
      BinOp.Add,
      dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(iEff), dae.addDerExpr(qdExpr)),
      dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(damping), qdExpr),
    );
    const tauInputExpr = dae.addNameExpr(`${jName}.tau`);
    const rhsTerms: number[] = [
      tauInputExpr,
      ...(jointContactTauTerms.get(joint.name) ?? []),
      ...(jointGravityTauTerms.get(joint.name) ?? []),
    ];
    dae.addEquation(EqKind.Simple, lhs, addSumExpr(dae, rhsTerms));

    // Equal-and-opposite reaction moment from joint actuator onto floating trunk
    if (node && joint.type !== "prismatic") {
      const frame = linkFrames.get(node.name);
      const anc = frame?.ancestors[frame.ancestors.length - 1];
      if (anc) {
        txTerms.push(dae.addUnaryExpr(0, dae.addBinaryExpr(BinOp.Mul, tauInputExpr, anc.axisWorld[0])));
        tyTerms.push(dae.addUnaryExpr(0, dae.addBinaryExpr(BinOp.Mul, tauInputExpr, anc.axisWorld[1])));
        tzTerms.push(dae.addUnaryExpr(0, dae.addBinaryExpr(BinOp.Mul, tauInputExpr, anc.axisWorld[2])));
      }
    }
  }

  // 6. Newton-Euler 6-DOF composite base equations with Euler gyroscopic omega x (I*omega)
  const sumFx = addSumExpr(dae, fxTerms);
  const sumFy = addSumExpr(dae, fyTerms);
  const sumFz = dae.addBinaryExpr(BinOp.Sub, addSumExpr(dae, fzTerms), dae.addRealLiteral(totalMass * gravityG));

  dae.addEquation(
    EqKind.Simple,
    dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(totalMass), dae.addDerExpr(dae.addNameExpr(`${basePrefix}.vx`))),
    sumFx,
  );
  dae.addEquation(
    EqKind.Simple,
    dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(totalMass), dae.addDerExpr(dae.addNameExpr(`${basePrefix}.vy`))),
    sumFy,
  );
  dae.addEquation(
    EqKind.Simple,
    dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(totalMass), dae.addDerExpr(dae.addNameExpr(`${basePrefix}.vz`))),
    sumFz,
  );

  const baseCrbI = crbInertiaDiag.get(baseLinkName) ?? baseNode.inertia;
  const ixx = Math.max(1e-4, baseCrbI[0]);
  const iyy = Math.max(1e-4, baseCrbI[1]);
  const izz = Math.max(1e-4, baseCrbI[2]);
  const iOmega: Vec3Expr = [
    dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(ixx), wx),
    dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(iyy), wy),
    dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(izz), wz),
  ];
  const gyro = crossExpr(dae, baseOmegaWorld, iOmega);

  dae.addEquation(
    EqKind.Simple,
    dae.addBinaryExpr(BinOp.Add, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(ixx), dae.addDerExpr(wx)), gyro[0]),
    addSumExpr(dae, txTerms),
  );
  dae.addEquation(
    EqKind.Simple,
    dae.addBinaryExpr(BinOp.Add, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(iyy), dae.addDerExpr(wy)), gyro[1]),
    addSumExpr(dae, tyTerms),
  );
  dae.addEquation(
    EqKind.Simple,
    dae.addBinaryExpr(BinOp.Add, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(izz), dae.addDerExpr(wz)), gyro[2]),
    addSumExpr(dae, tzTerms),
  );

  // 7. Synthetic IMU & Joint Sensor outputs
  if (robot.sensors) {
    for (const sensor of robot.sensors) {
      const sName = `${p}${sensor.name}`;
      if (sensor.kind === "gyro") {
        dae.addVariable(`${sName}.x`, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
        dae.addVariable(`${sName}.y`, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
        dae.addVariable(`${sName}.z`, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
        dae.addEquation(EqKind.Simple, dae.addNameExpr(`${sName}.x`), wx);
        dae.addEquation(EqKind.Simple, dae.addNameExpr(`${sName}.y`), wy);
        dae.addEquation(EqKind.Simple, dae.addNameExpr(`${sName}.z`), wz);
      } else if (sensor.kind === "accelerometer") {
        dae.addVariable(`${sName}.x`, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
        dae.addVariable(`${sName}.y`, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
        dae.addVariable(`${sName}.z`, VarType.Real, Variability.Continuous, Causality.Output, gravityG);
        dae.addEquation(
          EqKind.Simple,
          dae.addNameExpr(`${sName}.x`),
          dae.addDerExpr(dae.addNameExpr(`${basePrefix}.vx`)),
        );
        dae.addEquation(
          EqKind.Simple,
          dae.addNameExpr(`${sName}.y`),
          dae.addDerExpr(dae.addNameExpr(`${basePrefix}.vy`)),
        );
        dae.addEquation(
          EqKind.Simple,
          dae.addNameExpr(`${sName}.z`),
          dae.addBinaryExpr(
            BinOp.Add,
            dae.addDerExpr(dae.addNameExpr(`${basePrefix}.vz`)),
            dae.addRealLiteral(gravityG),
          ),
        );
      } else if (sensor.kind === "framequat") {
        dae.addVariable(`${sName}.qw`, VarType.Real, Variability.Continuous, Causality.Output, 1.0);
        dae.addVariable(`${sName}.qx`, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
        dae.addVariable(`${sName}.qy`, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
        dae.addVariable(`${sName}.qz`, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
        dae.addEquation(EqKind.Simple, dae.addNameExpr(`${sName}.qw`), qw);
        dae.addEquation(EqKind.Simple, dae.addNameExpr(`${sName}.qx`), qx);
        dae.addEquation(EqKind.Simple, dae.addNameExpr(`${sName}.qy`), qy);
        dae.addEquation(EqKind.Simple, dae.addNameExpr(`${sName}.qz`), qz);
      } else if ((sensor.kind === "jointpos" || sensor.kind === "jointvel") && sensor.joint) {
        const suffix = sensor.kind === "jointpos" ? "q" : "qd";
        dae.addVariable(`${sName}.value`, VarType.Real, Variability.Continuous, Causality.Output, 0.0);
        dae.addEquation(
          EqKind.Simple,
          dae.addNameExpr(`${sName}.value`),
          dae.addNameExpr(`${p}${sensor.joint}.${suffix}`),
        );
      }
    }
  }

  return dae;
}

export function lowerUrdfToDae(robot: UrdfRobot, builder?: DAEBuilder, options?: UrdfDaeOptions): DAEBuilder {
  const dae = builder ?? new DAEBuilder(undefined, robot.name);
  const gravityG = options?.gravity ?? 9.80665;
  const tree = buildKinematicTree(robot);

  const hasFloatingJoint = Array.from(robot.joints.values()).some((j) => j.type === "floating");
  if (hasFloatingJoint) {
    return lowerFloatingBaseUrdfToDae(robot, tree, dae, options ?? {});
  }

  // Fixed-base articulated chain lowering
  for (const joint of robot.joints.values()) {
    if (joint.type === "fixed") continue;
    const jName = joint.name;

    dae.addVariable(`${jName}.q`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${jName}.qd`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${jName}.tau`, VarType.Real, Variability.Continuous, Causality.Input, 0.0);
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${jName}.q`)), dae.addNameExpr(`${jName}.qd`));
  }

  for (const link of robot.links.values()) {
    const lName = link.name;
    dae.addVariable(`${lName}.x`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${lName}.y`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${lName}.z`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  }

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

  for (const node of tree) {
    if (!node.jointName || node.jointType === "fixed") continue;

    const jName = node.jointName;
    const joint = robot.joints.get(jName);
    const dampingVal = joint?.dynamics?.damping ?? 0.1;
    const frictionVal = joint?.dynamics?.friction ?? 0.0;

    const mEff = subtreeMass.get(node.name) ?? node.mass;
    const iEff = subtreeInertia.get(node.name) ?? node.inertia[2];
    const inertiaVal = node.jointType === "prismatic" ? Math.max(0.1, mEff) : Math.max(0.01, iEff);
    const effMoment = subtreeMoment.get(node.name) ?? mEff * 0.1;
    const gCoeff = effMoment * gravityG;

    const massExpr = dae.addRealLiteral(inertiaVal);
    const qdExpr = dae.addNameExpr(`${jName}.qd`);
    const derQdExpr = dae.addDerExpr(qdExpr);
    const mTerm = dae.addBinaryExpr(BinOp.Mul, massExpr, derQdExpr);
    const dampTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(dampingVal + frictionVal), qdExpr);

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

    const lhs = dae.addBinaryExpr(BinOp.Add, dae.addBinaryExpr(BinOp.Add, mTerm, dampTerm), gravTerm);
    const rhs = dae.addNameExpr(`${jName}.tau`);
    dae.addEquation(EqKind.Simple, lhs, rhs);
  }

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
        linkX = dae.addBinaryExpr(
          BinOp.Add,
          linkX,
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(node.axis.x), qExpr),
        );
      }
      if (Math.abs(node.axis.y) > 1e-6) {
        linkY = dae.addBinaryExpr(
          BinOp.Add,
          linkY,
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(node.axis.y), qExpr),
        );
      }
      if (Math.abs(node.axis.z) > 1e-6) {
        linkZ = dae.addBinaryExpr(
          BinOp.Add,
          linkZ,
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(node.axis.z), qExpr),
        );
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
        linkX = dae.addBinaryExpr(BinOp.Add, linkX, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rArm), cosQ));
        linkY = dae.addBinaryExpr(BinOp.Add, linkY, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rArm), sinQ));
      } else if (Math.abs(node.axis.y) >= Math.abs(node.axis.x)) {
        linkX = dae.addBinaryExpr(BinOp.Add, linkX, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rArm), sinQ));
        linkZ = dae.addBinaryExpr(BinOp.Add, linkZ, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-rArm), cosQ));
      } else {
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
