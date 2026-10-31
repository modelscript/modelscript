// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { JointType, SimpackJoint, SimpackMarker, SimpackModel, Vector3D } from "../types.js";

export interface SimpackDaeOptions {
  /** Constraint stabilization method: "baumgarte" | "algebraic" | "lagrange". Default: "algebraic". */
  stabilization?: "baumgarte" | "algebraic" | "lagrange" | undefined;
  /** Baumgarte natural frequency omega_n in rad/s. Default: 50.0. */
  baumgarteOmega?: number | undefined;
  /** Emit explicit Lagrange multiplier variables (lam_<joint>_<k>) and full rotational constraints. */
  includeLagrangeMultipliers?: boolean | undefined;
}

export interface SimpackJointConstraintSpec {
  transAxes: ("x" | "y" | "z")[];
  rotAxes: ("phi" | "theta" | "psi")[];
}

/**
 * Returns the constrained translational and rotational axes for a SIMPACK joint type.
 */
export function getSimpackJointConstraintSpec(jointOrType: SimpackJoint | JointType): SimpackJointConstraintSpec {
  const type = typeof jointOrType === "string" ? jointOrType : jointOrType.type;
  switch (type) {
    case "spherical":
      return { transAxes: ["x", "y", "z"], rotAxes: [] };
    case "universal":
      return { transAxes: ["x", "y", "z"], rotAxes: ["psi"] };
    case "revolute":
      return { transAxes: ["x", "y", "z"], rotAxes: ["phi", "theta"] };
    case "cylindrical":
      return { transAxes: ["x", "y"], rotAxes: ["phi", "theta"] };
    case "prismatic":
      return { transAxes: ["x", "y"], rotAxes: ["phi", "theta", "psi"] };
    case "planar":
      return { transAxes: ["z"], rotAxes: ["phi", "theta"] };
    case "fixed":
      return { transAxes: ["x", "y", "z"], rotAxes: ["phi", "theta", "psi"] };
    case "free":
      return { transAxes: [], rotAxes: [] };
    default:
      return { transAxes: ["x", "y", "z"], rotAxes: [] };
  }
}

/**
 * Lowers a SIMPACK multibody model directly into ModelScript's DAE linear memory arena.
 * Formulates:
 * 1. 6-DOF spatial translational (x,y,z,vx,vy,vz) and rotational (phi,theta,psi,wx,wy,wz) states:
 *      der(p) = v,  der(theta) = omega
 * 2. 3D marker offset lever arms:
 *      r_P = r_B + s_P + theta_B x s_P,  v_P = v_B + omega_B x s_P
 * 3. Constitutive spring-damper/bushing force elements (linear + cubic nonlinear translational
 *    stiffness/damping and 3-axis rotational bushing stiffness/damping):
 *      F = k * delta_r + k3 * delta_r^3 + c * delta_v
 *      Tau = k_r * delta_theta + c_r * delta_omega
 * 4. Exact Newton-Euler momentum balance with applied force, moment arms, and constraint reactions:
 *      m * der(v) = sum(F_forces) + F_gravity + F_constraint
 *      I * der(omega) = sum(s x F_forces) + sum(Tau) + Tau_constraint
 * 5. Algebraic kinematic joint constraint equations across all canonical joint types
 *    (revolute, universal, spherical, cylindrical, prismatic, planar, fixed) with Lagrange
 *    multipliers or Baumgarte stabilization.
 */
export function lowerSimpackToDae(model: SimpackModel, builder?: DAEBuilder, options?: SimpackDaeOptions): DAEBuilder {
  const dae = builder ?? new DAEBuilder(undefined, model.name);
  const isBaumgarte = options?.stabilization === "baumgarte";
  const omegaN = options?.baumgarteOmega ?? 50.0;

  // 1. Emit 6-DOF coordinates and velocities for each body
  for (const [id, _body] of model.bodies.entries()) {
    // Translation
    dae.addVariable(`${id}.x`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.y`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.z`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    dae.addVariable(`${id}.vx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.vy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.vz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Rotation (Tait-Bryan angles: roll, pitch, yaw) and angular velocities
    dae.addVariable(`${id}.phi`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.theta`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.psi`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    dae.addVariable(`${id}.wx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.wy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.wz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Kinematic relations: der(p) = v
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${id}.x`)), dae.addNameExpr(`${id}.vx`));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${id}.y`)), dae.addNameExpr(`${id}.vy`));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${id}.z`)), dae.addNameExpr(`${id}.vz`));

    // Rotational kinematic relations: der(angle) = omega
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${id}.phi`)), dae.addNameExpr(`${id}.wx`));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${id}.theta`)), dae.addNameExpr(`${id}.wy`));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${id}.psi`)), dae.addNameExpr(`${id}.wz`));
  }

  // 2. Track net forces and net torques applied on each body
  const bodyForcesX = new Map<string, number[]>();
  const bodyForcesY = new Map<string, number[]>();
  const bodyForcesZ = new Map<string, number[]>();
  const bodyTorquesX = new Map<string, number[]>();
  const bodyTorquesY = new Map<string, number[]>();
  const bodyTorquesZ = new Map<string, number[]>();

  for (const id of model.bodies.keys()) {
    bodyForcesX.set(id, []);
    bodyForcesY.set(id, []);
    bodyForcesZ.set(id, []);
    bodyTorquesX.set(id, []);
    bodyTorquesY.set(id, []);
    bodyTorquesZ.set(id, []);
  }

  const isInertial = (bId: string): boolean => bId === "$inertial" || !model.bodies.has(bId);

  /**
   * 3D marker global position with rotational lever arm:
   *   r_P = r_B + s_P + theta_B x s_P
   */
  const getMarkerPos = (marker: SimpackMarker, axis: "x" | "y" | "z"): number => {
    const bId = marker.bodyId;
    const s = marker.position;
    if (isInertial(bId)) {
      return dae.addRealLiteral(s[axis]);
    }
    let expr =
      s[axis] === 0
        ? dae.addNameExpr(`${bId}.${axis}`)
        : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bId}.${axis}`), dae.addRealLiteral(s[axis]));

    if (axis === "x") {
      if (s.z !== 0) {
        expr = dae.addBinaryExpr(
          BinOp.Add,
          expr,
          dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.theta`), dae.addRealLiteral(s.z)),
        );
      }
      if (s.y !== 0) {
        expr = dae.addBinaryExpr(
          BinOp.Sub,
          expr,
          dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.psi`), dae.addRealLiteral(s.y)),
        );
      }
    } else if (axis === "y") {
      if (s.x !== 0) {
        expr = dae.addBinaryExpr(
          BinOp.Add,
          expr,
          dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.psi`), dae.addRealLiteral(s.x)),
        );
      }
      if (s.z !== 0) {
        expr = dae.addBinaryExpr(
          BinOp.Sub,
          expr,
          dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.phi`), dae.addRealLiteral(s.z)),
        );
      }
    } else {
      if (s.y !== 0) {
        expr = dae.addBinaryExpr(
          BinOp.Add,
          expr,
          dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.phi`), dae.addRealLiteral(s.y)),
        );
      }
      if (s.x !== 0) {
        expr = dae.addBinaryExpr(
          BinOp.Sub,
          expr,
          dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.theta`), dae.addRealLiteral(s.x)),
        );
      }
    }
    return expr;
  };

  /**
   * 3D marker global velocity with angular velocity lever arm:
   *   v_P = v_B + omega_B x s_P
   */
  const getMarkerVel = (marker: SimpackMarker, axis: "x" | "y" | "z"): number => {
    const bId = marker.bodyId;
    const s = marker.position;
    if (isInertial(bId)) return dae.addRealLiteral(0.0);
    const vBase = dae.addNameExpr(`${bId}.v${axis}`);
    let omegaCross = 0;
    if (axis === "x") {
      const t1 = s.z !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wy`), dae.addRealLiteral(s.z)) : 0;
      const t2 = s.y !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wz`), dae.addRealLiteral(s.y)) : 0;
      if (t1 && t2) omegaCross = dae.addBinaryExpr(BinOp.Sub, t1, t2);
      else if (t1) omegaCross = t1;
      else if (t2) omegaCross = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), t2);
    } else if (axis === "y") {
      const t1 = s.x !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wz`), dae.addRealLiteral(s.x)) : 0;
      const t2 = s.z !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wx`), dae.addRealLiteral(s.z)) : 0;
      if (t1 && t2) omegaCross = dae.addBinaryExpr(BinOp.Sub, t1, t2);
      else if (t1) omegaCross = t1;
      else if (t2) omegaCross = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), t2);
    } else {
      const t1 = s.y !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wx`), dae.addRealLiteral(s.y)) : 0;
      const t2 = s.x !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wy`), dae.addRealLiteral(s.x)) : 0;
      if (t1 && t2) omegaCross = dae.addBinaryExpr(BinOp.Sub, t1, t2);
      else if (t1) omegaCross = t1;
      else if (t2) omegaCross = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), t2);
    }
    return omegaCross !== 0 ? dae.addBinaryExpr(BinOp.Add, vBase, omegaCross) : vBase;
  };

  const getMarkerAngle = (marker: SimpackMarker, axis: "phi" | "theta" | "psi"): number => {
    const bId = marker.bodyId;
    const orient = marker.orientation ?? { x: 0, y: 0, z: 0 };
    const orientOffset = axis === "phi" ? (orient.x ?? 0) : axis === "theta" ? (orient.y ?? 0) : (orient.z ?? 0);
    if (isInertial(bId)) return dae.addRealLiteral(orientOffset);
    return orientOffset === 0
      ? dae.addNameExpr(`${bId}.${axis}`)
      : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bId}.${axis}`), dae.addRealLiteral(orientOffset));
  };

  const getMarkerOmega = (marker: SimpackMarker, axis: "wx" | "wy" | "wz"): number => {
    const bId = marker.bodyId;
    if (isInertial(bId)) return dae.addRealLiteral(0.0);
    return dae.addNameExpr(`${bId}.${axis}`);
  };

  // Helper to compute cross product moment tau = s x F
  const buildTorque = (s: Vector3D, fx: number, fy: number, fz: number) => {
    const buildComp = (pA: number, fA: number, pB: number, fB: number) => {
      const t1 = pA !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(pA), fA) : 0;
      const t2 = pB !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(pB), fB) : 0;
      if (t1 && t2) return dae.addBinaryExpr(BinOp.Sub, t1, t2);
      if (t1) return t1;
      if (t2) return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), t2);
      return 0;
    };

    return {
      tx: buildComp(s.y, fz, s.z, fy),
      ty: buildComp(s.z, fx, s.x, fz),
      tz: buildComp(s.x, fy, s.y, fx),
    };
  };

  // 3. Lower constitutive force elements (spring-damper, bushing with rotational stiffness/damping & cubic stiffness)
  for (const [id, f] of (model.forces ?? new Map()).entries()) {
    const markerA = model.markers.get(f.markerA);
    const markerB = model.markers.get(f.markerB);
    if (!markerA || !markerB) continue;

    const bA = markerA.bodyId;
    const bB = markerB.bodyId;
    const sA = markerA.position;
    const sB = markerB.position;

    // Intermediate force variables for this element: F = [fx, fy, fz]
    dae.addVariable(`${id}.fx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.fy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.fz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    const fxVar = dae.addNameExpr(`${id}.fx`);
    const fyVar = dae.addNameExpr(`${id}.fy`);
    const fzVar = dae.addNameExpr(`${id}.fz`);

    const buildAxisTerms = (axis: "x" | "y" | "z", kVal: number, cVal: number, k3Val = 0) => {
      const rA = getMarkerPos(markerA, axis);
      const rB = getMarkerPos(markerB, axis);
      const deltaR = dae.addBinaryExpr(BinOp.Sub, rB, rA);

      const vA = getMarkerVel(markerA, axis);
      const vB = getMarkerVel(markerB, axis);
      const deltaV = dae.addBinaryExpr(BinOp.Sub, vB, vA);

      const kTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kVal), deltaR);
      const cTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cVal), deltaV);
      let total = dae.addBinaryExpr(BinOp.Add, kTerm, cTerm);

      if (k3Val !== 0) {
        const dr2 = dae.addBinaryExpr(BinOp.Mul, deltaR, deltaR);
        const dr3 = dae.addBinaryExpr(BinOp.Mul, dr2, deltaR);
        const k3Term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(k3Val), dr3);
        total = dae.addBinaryExpr(BinOp.Add, total, k3Term);
      }
      return total;
    };

    const rhsFx = buildAxisTerms("x", f.stiffness.x, f.damping.x, f.nonlinearStiffness?.x ?? 0);
    const rhsFy = buildAxisTerms("y", f.stiffness.y, f.damping.y, f.nonlinearStiffness?.y ?? 0);
    const rhsFz = buildAxisTerms("z", f.stiffness.z, f.damping.z, f.nonlinearStiffness?.z ?? 0);

    dae.addEquation(EqKind.Simple, fxVar, rhsFx);
    dae.addEquation(EqKind.Simple, fyVar, rhsFy);
    dae.addEquation(EqKind.Simple, fzVar, rhsFz);

    // Action-reaction on body A: +F, tau = sA x F
    if (!isInertial(bA) && bodyForcesX.has(bA)) {
      bodyForcesX.get(bA)!.push(fxVar);
      bodyForcesY.get(bA)!.push(fyVar);
      bodyForcesZ.get(bA)!.push(fzVar);

      const tA = buildTorque(sA, fxVar, fyVar, fzVar);
      if (tA.tx) bodyTorquesX.get(bA)!.push(tA.tx);
      if (tA.ty) bodyTorquesY.get(bA)!.push(tA.ty);
      if (tA.tz) bodyTorquesZ.get(bA)!.push(tA.tz);
    }

    // Action-reaction on body B: -F, tau = sB x (-F)
    if (!isInertial(bB) && bodyForcesX.has(bB)) {
      const negFx = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fxVar);
      const negFy = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fyVar);
      const negFz = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fzVar);

      bodyForcesX.get(bB)!.push(negFx);
      bodyForcesY.get(bB)!.push(negFy);
      bodyForcesZ.get(bB)!.push(negFz);

      const tB = buildTorque(sB, negFx, negFy, negFz);
      if (tB.tx) bodyTorquesX.get(bB)!.push(tB.tx);
      if (tB.ty) bodyTorquesY.get(bB)!.push(tB.ty);
      if (tB.tz) bodyTorquesZ.get(bB)!.push(tB.tz);
    }

    // 3-axis rotational bushing stiffness & damping (krx, kry, krz, crx, cry, crz)
    const kr = f.rotationalStiffness;
    const cr = f.rotationalDamping;
    const hasRotBushing =
      (kr && (kr.x !== 0 || kr.y !== 0 || kr.z !== 0)) || (cr && (cr.x !== 0 || cr.y !== 0 || cr.z !== 0));

    if (hasRotBushing) {
      dae.addVariable(`${id}.tx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      dae.addVariable(`${id}.ty`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      dae.addVariable(`${id}.tz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

      const txVar = dae.addNameExpr(`${id}.tx`);
      const tyVar = dae.addNameExpr(`${id}.ty`);
      const tzVar = dae.addNameExpr(`${id}.tz`);

      const buildRotAxisTerms = (
        angAxis: "phi" | "theta" | "psi",
        omegaAxis: "wx" | "wy" | "wz",
        krVal: number,
        crVal: number,
      ) => {
        const angA = getMarkerAngle(markerA, angAxis);
        const angB = getMarkerAngle(markerB, angAxis);
        const deltaAng = dae.addBinaryExpr(BinOp.Sub, angB, angA);

        const wA = getMarkerOmega(markerA, omegaAxis);
        const wB = getMarkerOmega(markerB, omegaAxis);
        const deltaW = dae.addBinaryExpr(BinOp.Sub, wB, wA);

        const krTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(krVal), deltaAng);
        const crTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(crVal), deltaW);
        return dae.addBinaryExpr(BinOp.Add, krTerm, crTerm);
      };

      dae.addEquation(EqKind.Simple, txVar, buildRotAxisTerms("phi", "wx", kr?.x ?? 0, cr?.x ?? 0));
      dae.addEquation(EqKind.Simple, tyVar, buildRotAxisTerms("theta", "wy", kr?.y ?? 0, cr?.y ?? 0));
      dae.addEquation(EqKind.Simple, tzVar, buildRotAxisTerms("psi", "wz", kr?.z ?? 0, cr?.z ?? 0));

      if (!isInertial(bA)) {
        bodyTorquesX.get(bA)?.push(txVar);
        bodyTorquesY.get(bA)?.push(tyVar);
        bodyTorquesZ.get(bA)?.push(tzVar);
      }
      if (!isInertial(bB)) {
        bodyTorquesX.get(bB)?.push(dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), txVar));
        bodyTorquesY.get(bB)?.push(dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), tyVar));
        bodyTorquesZ.get(bB)?.push(dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), tzVar));
      }
    }
  }

  // 3b. Joint constraint forces/torques (Baumgarte penalty or Algebraic Lagrange multipliers)
  const rotAxisToOmega: Record<"phi" | "theta" | "psi", "wx" | "wy" | "wz"> = {
    phi: "wx",
    theta: "wy",
    psi: "wz",
  };

  // Deferred constraint equations to emit in Step 5 after momentum balance equations
  const deferredJointConstraintEqs: { lhs: number; rhs: number }[] = [];

  for (const [id, joint] of model.joints.entries()) {
    const markerA = model.markers.get(joint.fromMarker);
    const markerB = model.markers.get(joint.toMarker);
    if (!markerA || !markerB) continue;

    const bA = markerA.bodyId;
    const bB = markerB.bodyId;
    const isInertialA = isInertial(bA);
    const isInertialB = isInertial(bB);
    const sA = markerA.position;
    const sB = markerB.position;
    const spec = getSimpackJointConstraintSpec(joint);

    if (isBaumgarte) {
      const mA = model.bodies.get(bA)?.mass ?? 10.0;
      const mB = model.bodies.get(bB)?.mass ?? 10.0;
      const mEff = isInertialA ? mB : isInertialB ? mA : (mA * mB) / (mA + mB);
      const kp = mEff * omegaN * omegaN;
      const kd = 2.0 * mEff * omegaN;

      const iEff = !isInertialA
        ? (model.bodies.get(bA)?.inertia.ixx ?? 1.0)
        : (model.bodies.get(bB)?.inertia.ixx ?? 1.0);
      const kpRot = iEff * omegaN * omegaN;
      const kdRot = 2.0 * iEff * omegaN;

      const stabForces: Record<"x" | "y" | "z", number> = {
        x: dae.addRealLiteral(0.0),
        y: dae.addRealLiteral(0.0),
        z: dae.addRealLiteral(0.0),
      };

      for (const axis of spec.transAxes) {
        const posA = getMarkerPos(markerA, axis);
        const posB = getMarkerPos(markerB, axis);
        const velA = getMarkerVel(markerA, axis);
        const velB = getMarkerVel(markerB, axis);

        const deltaPos = dae.addBinaryExpr(BinOp.Sub, posB, posA);
        const deltaVel = dae.addBinaryExpr(BinOp.Sub, velB, velA);

        const fStab = dae.addBinaryExpr(
          BinOp.Add,
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kp), deltaPos),
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kd), deltaVel),
        );
        stabForces[axis] = fStab;

        if (!isInertialA && bodyForcesX.has(bA)) {
          if (axis === "x") bodyForcesX.get(bA)!.push(fStab);
          else if (axis === "y") bodyForcesY.get(bA)!.push(fStab);
          else bodyForcesZ.get(bA)!.push(fStab);
        }
        if (!isInertialB && bodyForcesX.has(bB)) {
          const negF = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fStab);
          if (axis === "x") bodyForcesX.get(bB)!.push(negF);
          else if (axis === "y") bodyForcesY.get(bB)!.push(negF);
          else bodyForcesZ.get(bB)!.push(negF);
        }

        // Residual monitoring variable & equation
        dae.addVariable(`${id}.residual_${axis}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        deferredJointConstraintEqs.push({
          lhs: dae.addNameExpr(`${id}.residual_${axis}`),
          rhs: deltaPos,
        });
      }

      if (!isInertialA && (sA.x !== 0 || sA.y !== 0 || sA.z !== 0)) {
        const tA = buildTorque(sA, stabForces.x, stabForces.y, stabForces.z);
        if (tA.tx) bodyTorquesX.get(bA)?.push(tA.tx);
        if (tA.ty) bodyTorquesY.get(bA)?.push(tA.ty);
        if (tA.tz) bodyTorquesZ.get(bA)?.push(tA.tz);
      }
      if (!isInertialB && (sB.x !== 0 || sB.y !== 0 || sB.z !== 0)) {
        const negX = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), stabForces.x);
        const negY = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), stabForces.y);
        const negZ = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), stabForces.z);
        const tB = buildTorque(sB, negX, negY, negZ);
        if (tB.tx) bodyTorquesX.get(bB)?.push(tB.tx);
        if (tB.ty) bodyTorquesY.get(bB)?.push(tB.ty);
        if (tB.tz) bodyTorquesZ.get(bB)?.push(tB.tz);
      }

      for (const rotAxis of spec.rotAxes) {
        const omegaAxis = rotAxisToOmega[rotAxis];
        const angA = getMarkerAngle(markerA, rotAxis);
        const angB = getMarkerAngle(markerB, rotAxis);
        const wA = getMarkerOmega(markerA, omegaAxis);
        const wB = getMarkerOmega(markerB, omegaAxis);

        const deltaAng = dae.addBinaryExpr(BinOp.Sub, angB, angA);
        const deltaW = dae.addBinaryExpr(BinOp.Sub, wB, wA);

        const tauStab = dae.addBinaryExpr(
          BinOp.Add,
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kpRot), deltaAng),
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kdRot), deltaW),
        );

        if (!isInertialA) {
          if (rotAxis === "phi") bodyTorquesX.get(bA)?.push(tauStab);
          else if (rotAxis === "theta") bodyTorquesY.get(bA)?.push(tauStab);
          else bodyTorquesZ.get(bA)?.push(tauStab);
        }
        if (!isInertialB) {
          const negTau = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), tauStab);
          if (rotAxis === "phi") bodyTorquesX.get(bB)?.push(negTau);
          else if (rotAxis === "theta") bodyTorquesY.get(bB)?.push(negTau);
          else bodyTorquesZ.get(bB)?.push(negTau);
        }

        dae.addVariable(`${id}.residual_${rotAxis}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        deferredJointConstraintEqs.push({
          lhs: dae.addNameExpr(`${id}.residual_${rotAxis}`),
          rhs: deltaAng,
        });
      }
    } else if (options?.stabilization === "lagrange" || options?.includeLagrangeMultipliers === true) {
      // Full Lagrange multiplier mode: emit lam_${id}_${k} variables and translational + rotational constraints
      let lamIdx = 0;
      const lamTransExprs: Record<"x" | "y" | "z", number> = {
        x: dae.addRealLiteral(0.0),
        y: dae.addRealLiteral(0.0),
        z: dae.addRealLiteral(0.0),
      };

      for (const axis of spec.transAxes) {
        const lamName = `lam_${id}_${lamIdx++}`;
        dae.addVariable(lamName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        const lamExpr = dae.addNameExpr(lamName);
        lamTransExprs[axis] = lamExpr;

        if (!isInertialA && bodyForcesX.has(bA)) {
          if (axis === "x") bodyForcesX.get(bA)!.push(lamExpr);
          else if (axis === "y") bodyForcesY.get(bA)!.push(lamExpr);
          else bodyForcesZ.get(bA)!.push(lamExpr);
        }
        if (!isInertialB && bodyForcesX.has(bB)) {
          const negLam = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), lamExpr);
          if (axis === "x") bodyForcesX.get(bB)!.push(negLam);
          else if (axis === "y") bodyForcesY.get(bB)!.push(negLam);
          else bodyForcesZ.get(bB)!.push(negLam);
        }

        deferredJointConstraintEqs.push({
          lhs: getMarkerPos(markerA, axis),
          rhs: getMarkerPos(markerB, axis),
        });
      }

      if (!isInertialA && (sA.x !== 0 || sA.y !== 0 || sA.z !== 0)) {
        const tA = buildTorque(sA, lamTransExprs.x, lamTransExprs.y, lamTransExprs.z);
        if (tA.tx) bodyTorquesX.get(bA)?.push(tA.tx);
        if (tA.ty) bodyTorquesY.get(bA)?.push(tA.ty);
        if (tA.tz) bodyTorquesZ.get(bA)?.push(tA.tz);
      }
      if (!isInertialB && (sB.x !== 0 || sB.y !== 0 || sB.z !== 0)) {
        const negX = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), lamTransExprs.x);
        const negY = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), lamTransExprs.y);
        const negZ = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), lamTransExprs.z);
        const tB = buildTorque(sB, negX, negY, negZ);
        if (tB.tx) bodyTorquesX.get(bB)?.push(tB.tx);
        if (tB.ty) bodyTorquesY.get(bB)?.push(tB.ty);
        if (tB.tz) bodyTorquesZ.get(bB)?.push(tB.tz);
      }

      for (const rotAxis of spec.rotAxes) {
        const lamName = `lam_${id}_${lamIdx++}`;
        dae.addVariable(lamName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        const lamExpr = dae.addNameExpr(lamName);

        if (!isInertialA) {
          if (rotAxis === "phi") bodyTorquesX.get(bA)?.push(lamExpr);
          else if (rotAxis === "theta") bodyTorquesY.get(bA)?.push(lamExpr);
          else bodyTorquesZ.get(bA)?.push(lamExpr);
        }
        if (!isInertialB) {
          const negLam = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), lamExpr);
          if (rotAxis === "phi") bodyTorquesX.get(bB)?.push(negLam);
          else if (rotAxis === "theta") bodyTorquesY.get(bB)?.push(negLam);
          else bodyTorquesZ.get(bB)?.push(negLam);
        }

        deferredJointConstraintEqs.push({
          lhs: getMarkerAngle(markerA, rotAxis),
          rhs: getMarkerAngle(markerB, rotAxis),
        });
      }
    } else if (joint.type === "spherical" || joint.type === "revolute" || joint.type === "fixed") {
      const posA_x = isInertialA ? dae.addRealLiteral(markerA.position.x) : dae.addNameExpr(`${bA}.x`);
      const posB_x = isInertialB ? dae.addRealLiteral(markerB.position.x) : dae.addNameExpr(`${bB}.x`);
      const posA_y = isInertialA ? dae.addRealLiteral(markerA.position.y) : dae.addNameExpr(`${bA}.y`);
      const posB_y = isInertialB ? dae.addRealLiteral(markerB.position.y) : dae.addNameExpr(`${bB}.y`);
      const posA_z = isInertialA ? dae.addRealLiteral(markerA.position.z) : dae.addNameExpr(`${bA}.z`);
      const posB_z = isInertialB ? dae.addRealLiteral(markerB.position.z) : dae.addNameExpr(`${bB}.z`);
      deferredJointConstraintEqs.push({ lhs: posA_x, rhs: posB_x });
      deferredJointConstraintEqs.push({ lhs: posA_y, rhs: posB_y });
      deferredJointConstraintEqs.push({ lhs: posA_z, rhs: posB_z });
    }
  }

  // 4. Formulate Newton-Euler momentum balance equations
  for (const [id, body] of model.bodies.entries()) {
    const massExpr = dae.addRealLiteral(body.mass);

    // Sum forces in X
    const forcesX = bodyForcesX.get(id) ?? [];
    let netFx = dae.addRealLiteral(0.0);
    for (const f of forcesX) {
      netFx = dae.addBinaryExpr(BinOp.Add, netFx, f);
    }
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, massExpr, dae.addDerExpr(dae.addNameExpr(`${id}.vx`))),
      netFx,
    );

    // Sum forces in Y
    const forcesY = bodyForcesY.get(id) ?? [];
    let netFy = dae.addRealLiteral(0.0);
    for (const f of forcesY) {
      netFy = dae.addBinaryExpr(BinOp.Add, netFy, f);
    }
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, massExpr, dae.addDerExpr(dae.addNameExpr(`${id}.vy`))),
      netFy,
    );

    // Sum forces in Z including gravity -m * 9.81
    const forcesZ = bodyForcesZ.get(id) ?? [];
    let netFz = dae.addRealLiteral(-body.mass * 9.81);
    for (const f of forcesZ) {
      netFz = dae.addBinaryExpr(BinOp.Add, netFz, f);
    }
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, massExpr, dae.addDerExpr(dae.addNameExpr(`${id}.vz`))),
      netFz,
    );

    // Rotational Euler momentum equations: I * der(omega) = sum(Tau)
    const ixxExpr = dae.addRealLiteral(body.inertia.ixx);
    const iyyExpr = dae.addRealLiteral(body.inertia.iyy);
    const izzExpr = dae.addRealLiteral(body.inertia.izz);

    const torquesX = bodyTorquesX.get(id) ?? [];
    let netTx = dae.addRealLiteral(0.0);
    for (const t of torquesX) {
      netTx = dae.addBinaryExpr(BinOp.Add, netTx, t);
    }
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, ixxExpr, dae.addDerExpr(dae.addNameExpr(`${id}.wx`))),
      netTx,
    );

    const torquesY = bodyTorquesY.get(id) ?? [];
    let netTy = dae.addRealLiteral(0.0);
    for (const t of torquesY) {
      netTy = dae.addBinaryExpr(BinOp.Add, netTy, t);
    }
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, iyyExpr, dae.addDerExpr(dae.addNameExpr(`${id}.wy`))),
      netTy,
    );

    const torquesZ = bodyTorquesZ.get(id) ?? [];
    let netTz = dae.addRealLiteral(0.0);
    for (const t of torquesZ) {
      netTz = dae.addBinaryExpr(BinOp.Add, netTz, t);
    }
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, izzExpr, dae.addDerExpr(dae.addNameExpr(`${id}.wz`))),
      netTz,
    );
  }

  // 5. Emit algebraic kinematic constraint equations for joints
  for (const eq of deferredJointConstraintEqs) {
    dae.addEquation(EqKind.Simple, eq.lhs, eq.rhs);
  }

  return dae;
}
