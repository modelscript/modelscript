// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { SimpackModel, Vector3D } from "../types.js";

export interface SimpackDaeOptions {
  /** Constraint stabilization method: "baumgarte" | "algebraic". Default: "algebraic". */
  stabilization?: "baumgarte" | "algebraic" | undefined;
  /** Baumgarte natural frequency omega_n in rad/s. Default: 50.0. */
  baumgarteOmega?: number | undefined;
}

/**
 * Lowers a SIMPACK multibody model directly into ModelScript's DAE linear memory arena.
 * Formulates:
 * 1. 6-DOF spatial translational (x,y,z,vx,vy,vz) and rotational (phi,theta,psi,wx,wy,wz) states:
 *      der(p) = v,  der(theta) = omega
 * 2. Constitutive spring-damper/bushing force elements:
 *      F = k * delta_r + c * delta_v
 * 3. Exact Newton-Euler momentum balance with applied force and moment arms:
 *      m * der(v) = sum(F_forces) + F_gravity
 *      I * der(omega) = sum(r_arm x F_forces) + sum(Tau)
 * 4. Algebraic kinematic joint constraint equations with optional Baumgarte stabilization.
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

  // 3. Lower constitutive force elements (spring-damper, bushing)
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

    // Helper to build axis relative displacement and velocity:
    // delta_r = (r_B + s_B) - (r_A + s_A)
    // delta_v = (v_B + omega_B x s_B) - (v_A + omega_A x s_A)
    const buildAxisTerms = (axis: "x" | "y" | "z", kVal: number, cVal: number) => {
      // Position terms
      const rA =
        bA === "$inertial"
          ? dae.addRealLiteral(sA[axis])
          : sA[axis] === 0
            ? dae.addNameExpr(`${bA}.${axis}`)
            : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bA}.${axis}`), dae.addRealLiteral(sA[axis]));

      const rB =
        bB === "$inertial"
          ? dae.addRealLiteral(sB[axis])
          : sB[axis] === 0
            ? dae.addNameExpr(`${bB}.${axis}`)
            : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bB}.${axis}`), dae.addRealLiteral(sB[axis]));

      const deltaR = dae.addBinaryExpr(BinOp.Sub, rB, rA);

      // Velocity terms
      // omega x s components:
      // (w x s)_x = w_y * s_z - w_z * s_y
      // (w x s)_y = w_z * s_x - w_x * s_z
      // (w x s)_z = w_x * s_y - w_y * s_x
      const getVel = (bId: string, s: Vector3D) => {
        if (bId === "$inertial") return dae.addRealLiteral(0.0);
        const vBase = dae.addNameExpr(`${bId}.v${axis}`);
        let omegaCross = 0;
        if (axis === "x") {
          // wy * sz - wz * sy
          const t1 =
            s.z !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wy`), dae.addRealLiteral(s.z)) : 0;
          const t2 =
            s.y !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wz`), dae.addRealLiteral(s.y)) : 0;
          if (t1 && t2) omegaCross = dae.addBinaryExpr(BinOp.Sub, t1, t2);
          else if (t1) omegaCross = t1;
          else if (t2) omegaCross = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), t2);
        } else if (axis === "y") {
          // wz * sx - wx * sz
          const t1 =
            s.x !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wz`), dae.addRealLiteral(s.x)) : 0;
          const t2 =
            s.z !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wx`), dae.addRealLiteral(s.z)) : 0;
          if (t1 && t2) omegaCross = dae.addBinaryExpr(BinOp.Sub, t1, t2);
          else if (t1) omegaCross = t1;
          else if (t2) omegaCross = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), t2);
        } else {
          // wx * sy - wy * sx
          const t1 =
            s.y !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wx`), dae.addRealLiteral(s.y)) : 0;
          const t2 =
            s.x !== 0 ? dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr(`${bId}.wy`), dae.addRealLiteral(s.x)) : 0;
          if (t1 && t2) omegaCross = dae.addBinaryExpr(BinOp.Sub, t1, t2);
          else if (t1) omegaCross = t1;
          else if (t2) omegaCross = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), t2);
        }

        return omegaCross !== 0 ? dae.addBinaryExpr(BinOp.Add, vBase, omegaCross) : vBase;
      };

      const vA = getVel(bA, sA);
      const vB = getVel(bB, sB);
      const deltaV = dae.addBinaryExpr(BinOp.Sub, vB, vA);

      const kTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kVal), deltaR);
      const cTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cVal), deltaV);
      return dae.addBinaryExpr(BinOp.Add, kTerm, cTerm);
    };

    const rhsFx = buildAxisTerms("x", f.stiffness.x, f.damping.x);
    const rhsFy = buildAxisTerms("y", f.stiffness.y, f.damping.y);
    const rhsFz = buildAxisTerms("z", f.stiffness.z, f.damping.z);

    dae.addEquation(EqKind.Simple, fxVar, rhsFx);
    dae.addEquation(EqKind.Simple, fyVar, rhsFy);
    dae.addEquation(EqKind.Simple, fzVar, rhsFz);

    // Helper to compute cross product moment tau = s x F
    const buildTorque = (s: Vector3D, fx: number, fy: number, fz: number) => {
      // tau_x = sy * Fz - sz * Fy
      // tau_y = sz * Fx - sx * Fz
      // tau_z = sx * Fy - sy * Fx
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

    // Action-reaction on body A: +F, tau = sA x F
    if (bA !== "$inertial" && bodyForcesX.has(bA)) {
      bodyForcesX.get(bA)!.push(fxVar);
      bodyForcesY.get(bA)!.push(fyVar);
      bodyForcesZ.get(bA)!.push(fzVar);

      const tA = buildTorque(sA, fxVar, fyVar, fzVar);
      if (tA.tx) bodyTorquesX.get(bA)!.push(tA.tx);
      if (tA.ty) bodyTorquesY.get(bA)!.push(tA.ty);
      if (tA.tz) bodyTorquesZ.get(bA)!.push(tA.tz);
    }

    // Action-reaction on body B: -F, tau = sB x (-F)
    if (bB !== "$inertial" && bodyForcesX.has(bB)) {
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
  }

  // 3b. If Baumgarte stabilization is active, inject stabilizing penalty forces across joints
  if (isBaumgarte) {
    for (const [_jointId, joint] of model.joints.entries()) {
      const markerA = model.markers.get(joint.fromMarker);
      const markerB = model.markers.get(joint.toMarker);
      if (!markerA || !markerB) continue;

      const bA = markerA.bodyId;
      const bB = markerB.bodyId;

      const mA = model.bodies.get(bA)?.mass ?? 10.0;
      const mB = model.bodies.get(bB)?.mass ?? 10.0;
      const mEff = bA === "$inertial" ? mB : bB === "$inertial" ? mA : (mA * mB) / (mA + mB);
      const kp = mEff * omegaN * omegaN;
      const kd = 2.0 * mEff * omegaN;

      if (joint.type === "spherical" || joint.type === "revolute" || joint.type === "fixed") {
        const sA = markerA.position;
        const sB = markerB.position;

        const posA_x =
          bA === "$inertial"
            ? dae.addRealLiteral(sA.x)
            : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bA}.x`), dae.addRealLiteral(sA.x));
        const posB_x =
          bB === "$inertial"
            ? dae.addRealLiteral(sB.x)
            : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bB}.x`), dae.addRealLiteral(sB.x));
        const posA_y =
          bA === "$inertial"
            ? dae.addRealLiteral(sA.y)
            : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bA}.y`), dae.addRealLiteral(sA.y));
        const posB_y =
          bB === "$inertial"
            ? dae.addRealLiteral(sB.y)
            : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bB}.y`), dae.addRealLiteral(sB.y));
        const posA_z =
          bA === "$inertial"
            ? dae.addRealLiteral(sA.z)
            : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bA}.z`), dae.addRealLiteral(sA.z));
        const posB_z =
          bB === "$inertial"
            ? dae.addRealLiteral(sB.z)
            : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bB}.z`), dae.addRealLiteral(sB.z));

        const velA_x = bA === "$inertial" ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${bA}.vx`);
        const velB_x = bB === "$inertial" ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${bB}.vx`);
        const velA_y = bA === "$inertial" ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${bA}.vy`);
        const velB_y = bB === "$inertial" ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${bB}.vy`);
        const velA_z = bA === "$inertial" ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${bA}.vz`);
        const velB_z = bB === "$inertial" ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${bB}.vz`);

        const deltaX = dae.addBinaryExpr(BinOp.Sub, posB_x, posA_x);
        const deltaY = dae.addBinaryExpr(BinOp.Sub, posB_y, posA_y);
        const deltaZ = dae.addBinaryExpr(BinOp.Sub, posB_z, posA_z);

        const deltaVx = dae.addBinaryExpr(BinOp.Sub, velB_x, velA_x);
        const deltaVy = dae.addBinaryExpr(BinOp.Sub, velB_y, velA_y);
        const deltaVz = dae.addBinaryExpr(BinOp.Sub, velB_z, velA_z);

        const fStabX = dae.addBinaryExpr(
          BinOp.Add,
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kp), deltaX),
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kd), deltaVx),
        );
        const fStabY = dae.addBinaryExpr(
          BinOp.Add,
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kp), deltaY),
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kd), deltaVy),
        );
        const fStabZ = dae.addBinaryExpr(
          BinOp.Add,
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kp), deltaZ),
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kd), deltaVz),
        );

        if (bA !== "$inertial" && bodyForcesX.has(bA)) {
          bodyForcesX.get(bA)!.push(fStabX);
          bodyForcesY.get(bA)!.push(fStabY);
          bodyForcesZ.get(bA)!.push(fStabZ);
        }

        if (bB !== "$inertial" && bodyForcesX.has(bB)) {
          const negFX = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fStabX);
          const negFY = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fStabY);
          const negFZ = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fStabZ);
          bodyForcesX.get(bB)!.push(negFX);
          bodyForcesY.get(bB)!.push(negFY);
          bodyForcesZ.get(bB)!.push(negFZ);
        }
      }
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

  // 5. Emit algebraic kinematic constraint variables and equations for joints
  for (const [id, joint] of model.joints.entries()) {
    const markerA = model.markers.get(joint.fromMarker);
    const markerB = model.markers.get(joint.toMarker);
    if (!markerA || !markerB) continue;

    const bA = markerA.bodyId;
    const bB = markerB.bodyId;

    // Relative position constraint in global frame: r_B + s_B - (r_A + s_A) = 0
    if (joint.type === "spherical" || joint.type === "revolute" || joint.type === "fixed") {
      const posA_x = bA === "$inertial" ? dae.addRealLiteral(markerA.position.x) : dae.addNameExpr(`${bA}.x`);
      const posB_x = bB === "$inertial" ? dae.addRealLiteral(markerB.position.x) : dae.addNameExpr(`${bB}.x`);
      const posA_y = bA === "$inertial" ? dae.addRealLiteral(markerA.position.y) : dae.addNameExpr(`${bA}.y`);
      const posB_y = bB === "$inertial" ? dae.addRealLiteral(markerB.position.y) : dae.addNameExpr(`${bB}.y`);
      const posA_z = bA === "$inertial" ? dae.addRealLiteral(markerA.position.z) : dae.addNameExpr(`${bA}.z`);
      const posB_z = bB === "$inertial" ? dae.addRealLiteral(markerB.position.z) : dae.addNameExpr(`${bB}.z`);

      if (isBaumgarte) {
        // Track constraint residuals without freezing ODE integrators
        dae.addVariable(`${id}.residual_x`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        dae.addVariable(`${id}.residual_y`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        dae.addVariable(`${id}.residual_z`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        dae.addEquation(
          EqKind.Simple,
          dae.addNameExpr(`${id}.residual_x`),
          dae.addBinaryExpr(BinOp.Sub, posB_x, posA_x),
        );
        dae.addEquation(
          EqKind.Simple,
          dae.addNameExpr(`${id}.residual_y`),
          dae.addBinaryExpr(BinOp.Sub, posB_y, posA_y),
        );
        dae.addEquation(
          EqKind.Simple,
          dae.addNameExpr(`${id}.residual_z`),
          dae.addBinaryExpr(BinOp.Sub, posB_z, posA_z),
        );
      } else {
        dae.addEquation(EqKind.Simple, posA_x, posB_x);
        dae.addEquation(EqKind.Simple, posA_y, posB_y);
        dae.addEquation(EqKind.Simple, posA_z, posB_z);
      }
    }
  }

  return dae;
}
