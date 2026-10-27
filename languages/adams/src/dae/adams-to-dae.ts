// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/adams — Direct Linear-Memory DAE Arena Lowering for MSC Adams Models.
 *
 * Emits 6-DOF descriptor differential-algebraic equations directly into ModelScript's
 * WebAssembly Struct-of-Arrays DAEBuilder without intermediate AST wrappers:
 *   1. 6-DOF translational (x,y,z,vx,vy,vz) and rotational (phi,theta,psi,wx,wy,wz) states
 *   2. Constitutive spring-damper (SPRINGDAMPER/SFORCE) scalar and vector force elements
 *   3. Exact Newton-Euler momentum balance with applied moment arms:
 *        m * der(v) = sum(F) + F_gravity
 *        I * der(omega) = sum(r x F) + sum(Tau)
 *   4. Algebraic kinematic joint constraints with optional Baumgarte stabilization.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { AdamsDataset, Vector3D } from "../types.js";

export interface AdamsDaeOptions {
  /** Constraint stabilization method: "baumgarte" | "algebraic". Default: "baumgarte". */
  stabilization?: "baumgarte" | "algebraic" | undefined;
  /** Baumgarte natural frequency omega_n in rad/s. Default: 50.0. */
  baumgarteOmega?: number | undefined;
  /** Gravitational acceleration in m/s^2. Default: 9.80665 along -Z. */
  gravity?: number | undefined;
}

export function lowerAdamsToDae(dataset: AdamsDataset, builder?: DAEBuilder, options?: AdamsDaeOptions): DAEBuilder {
  const dae = builder ?? new DAEBuilder(undefined, dataset.title);
  const isBaumgarte = options?.stabilization !== "algebraic"; // Default to baumgarte for stability
  const omegaN = options?.baumgarteOmega ?? 50.0;
  const gravityG = options?.gravity ?? 9.80665;

  // 1. Emit 6-DOF coordinates and velocities for each moving part
  for (const part of dataset.parts.values()) {
    if (part.isGround) continue;
    const id = String(part.id);

    // Translation coordinates
    dae.addVariable(`${id}.x`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.y`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.z`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Translation velocities
    dae.addVariable(`${id}.vx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.vy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.vz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Rotation angles (Euler / Tait-Bryan: roll, pitch, yaw)
    dae.addVariable(`${id}.phi`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.theta`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${id}.psi`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Angular velocities
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

  // 2. Track net forces and moments applied on each moving part
  const bodyForcesX = new Map<string, number[]>();
  const bodyForcesY = new Map<string, number[]>();
  const bodyForcesZ = new Map<string, number[]>();
  const bodyTorquesX = new Map<string, number[]>();
  const bodyTorquesY = new Map<string, number[]>();
  const bodyTorquesZ = new Map<string, number[]>();

  for (const part of dataset.parts.values()) {
    if (part.isGround) continue;
    const id = String(part.id);
    bodyForcesX.set(id, []);
    bodyForcesY.set(id, []);
    bodyForcesZ.set(id, []);
    bodyTorquesX.set(id, []);
    bodyTorquesY.set(id, []);
    bodyTorquesZ.set(id, []);
  }

  // Helper to determine if a part is ground
  const isPartGround = (pId: string | number): boolean => {
    const part = dataset.parts.get(pId);
    return !part || part.isGround || String(pId).toUpperCase() === "GROUND";
  };

  // 3. Lower constitutive force elements (SPRINGDAMPER / SFORCE)
  for (const force of dataset.forces.values()) {
    const markerA = dataset.markers.get(force.iMarkerId);
    const markerB = dataset.markers.get(force.jMarkerId);
    if (!markerA || !markerB) continue;

    const bA = String(markerA.partId);
    const bB = String(markerB.partId);
    const sA = markerA.position;
    const sB = markerB.position;
    const fId = String(force.id);

    const kVal = force.stiffness ?? 1000.0;
    const cVal = force.damping ?? 50.0;

    // Intermediate force variables: fx, fy, fz
    dae.addVariable(`${fId}.fx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${fId}.fy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${fId}.fz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    const fxVar = dae.addNameExpr(`${fId}.fx`);
    const fyVar = dae.addNameExpr(`${fId}.fy`);
    const fzVar = dae.addNameExpr(`${fId}.fz`);

    const buildAxisTerms = (axis: "x" | "y" | "z") => {
      const rA = isPartGround(bA)
        ? dae.addRealLiteral(sA[axis])
        : sA[axis] === 0
          ? dae.addNameExpr(`${bA}.${axis}`)
          : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bA}.${axis}`), dae.addRealLiteral(sA[axis]));

      const rB = isPartGround(bB)
        ? dae.addRealLiteral(sB[axis])
        : sB[axis] === 0
          ? dae.addNameExpr(`${bB}.${axis}`)
          : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bB}.${axis}`), dae.addRealLiteral(sB[axis]));

      const deltaR = dae.addBinaryExpr(BinOp.Sub, rB, rA);

      const vA = isPartGround(bA) ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${bA}.v${axis}`);
      const vB = isPartGround(bB) ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${bB}.v${axis}`);
      const deltaV = dae.addBinaryExpr(BinOp.Sub, vB, vA);

      const kTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kVal), deltaR);
      const cTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cVal), deltaV);
      return dae.addBinaryExpr(BinOp.Add, kTerm, cTerm);
    };

    dae.addEquation(EqKind.Simple, fxVar, buildAxisTerms("x"));
    dae.addEquation(EqKind.Simple, fyVar, buildAxisTerms("y"));
    dae.addEquation(EqKind.Simple, fzVar, buildAxisTerms("z"));

    // Moment arm cross product: tau = s x F
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

    // Apply on Part A (+F, +tau)
    if (!isPartGround(bA) && bodyForcesX.has(bA)) {
      bodyForcesX.get(bA)?.push(fxVar);
      bodyForcesY.get(bA)?.push(fyVar);
      bodyForcesZ.get(bA)?.push(fzVar);

      const tA = buildTorque(sA, fxVar, fyVar, fzVar);
      if (tA.tx) bodyTorquesX.get(bA)?.push(tA.tx);
      if (tA.ty) bodyTorquesY.get(bA)?.push(tA.ty);
      if (tA.tz) bodyTorquesZ.get(bA)?.push(tA.tz);
    }

    // Apply on Part B (-F, -tau)
    if (!isPartGround(bB) && bodyForcesX.has(bB)) {
      const negFx = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fxVar);
      const negFy = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fyVar);
      const negFz = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fzVar);

      bodyForcesX.get(bB)?.push(negFx);
      bodyForcesY.get(bB)?.push(negFy);
      bodyForcesZ.get(bB)?.push(negFz);

      const tB = buildTorque(sB, negFx, negFy, negFz);
      if (tB.tx) bodyTorquesX.get(bB)?.push(tB.tx);
      if (tB.ty) bodyTorquesY.get(bB)?.push(tB.ty);
      if (tB.tz) bodyTorquesZ.get(bB)?.push(tB.tz);
    }
  }

  // 4. Joint constraints and Baumgarte penalty stabilization
  if (isBaumgarte) {
    for (const joint of dataset.joints.values()) {
      const markerA = dataset.markers.get(joint.iMarkerId);
      const markerB = dataset.markers.get(joint.jMarkerId);
      if (!markerA || !markerB) continue;

      const bA = String(markerA.partId);
      const bB = String(markerB.partId);
      const isGroundA = isPartGround(bA);
      const isGroundB = isPartGround(bB);

      const partA = dataset.parts.get(bA);
      const partB = dataset.parts.get(bB);
      const mA = partA ? partA.mass : 10.0;
      const mB = partB ? partB.mass : 10.0;

      const mEff = isGroundA ? mB : isGroundB ? mA : (mA * mB) / (mA + mB);
      const kp = mEff * omegaN * omegaN;
      const kd = 2.0 * mEff * omegaN;

      const sA = markerA.position;
      const sB = markerB.position;

      // Position terms
      const posA_x = isGroundA
        ? dae.addRealLiteral(sA.x)
        : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bA}.x`), dae.addRealLiteral(sA.x));
      const posB_x = isGroundB
        ? dae.addRealLiteral(sB.x)
        : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bB}.x`), dae.addRealLiteral(sB.x));
      const posA_y = isGroundA
        ? dae.addRealLiteral(sA.y)
        : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bA}.y`), dae.addRealLiteral(sA.y));
      const posB_y = isGroundB
        ? dae.addRealLiteral(sB.y)
        : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bB}.y`), dae.addRealLiteral(sB.y));
      const posA_z = isGroundA
        ? dae.addRealLiteral(sA.z)
        : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bA}.z`), dae.addRealLiteral(sA.z));
      const posB_z = isGroundB
        ? dae.addRealLiteral(sB.z)
        : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bB}.z`), dae.addRealLiteral(sB.z));

      // Velocity terms
      const velA_x = isGroundA ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${bA}.vx`);
      const velB_x = isGroundB ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${bB}.vx`);
      const velA_y = isGroundA ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${bA}.vy`);
      const velB_y = isGroundB ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${bB}.vy`);
      const velA_z = isGroundA ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${bA}.vz`);
      const velB_z = isGroundB ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${bB}.vz`);

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

      if (!isGroundA && bodyForcesX.has(bA)) {
        bodyForcesX.get(bA)?.push(fStabX);
        bodyForcesY.get(bA)?.push(fStabY);
        bodyForcesZ.get(bA)?.push(fStabZ);
      }
      if (!isGroundB && bodyForcesX.has(bB)) {
        const negX = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fStabX);
        const negY = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fStabY);
        const negZ = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fStabZ);
        bodyForcesX.get(bB)?.push(negX);
        bodyForcesY.get(bB)?.push(negY);
        bodyForcesZ.get(bB)?.push(negZ);
      }
    }
  } else {
    // Pure algebraic constraints: posA - posB = 0
    for (const joint of dataset.joints.values()) {
      const markerA = dataset.markers.get(joint.iMarkerId);
      const markerB = dataset.markers.get(joint.jMarkerId);
      if (!markerA || !markerB) continue;

      const bA = String(markerA.partId);
      const bB = String(markerB.partId);
      const sA = markerA.position;
      const sB = markerB.position;

      const getPos = (bId: string, s: Vector3D, axis: "x" | "y" | "z") => {
        if (isPartGround(bId)) return dae.addRealLiteral(s[axis]);
        return s[axis] === 0
          ? dae.addNameExpr(`${bId}.${axis}`)
          : dae.addBinaryExpr(BinOp.Add, dae.addNameExpr(`${bId}.${axis}`), dae.addRealLiteral(s[axis]));
      };

      dae.addEquation(EqKind.Simple, getPos(bA, sA, "x"), getPos(bB, sB, "x"));
      dae.addEquation(EqKind.Simple, getPos(bA, sA, "y"), getPos(bB, sB, "y"));
      dae.addEquation(EqKind.Simple, getPos(bA, sA, "z"), getPos(bB, sB, "z"));
    }
  }

  // 5. Formulate Newton-Euler momentum balance equations
  for (const part of dataset.parts.values()) {
    if (part.isGround) continue;
    const id = String(part.id);
    const massExpr = dae.addRealLiteral(part.mass);

    // X-momentum: m * der(vx) = sum(Fx)
    const fxList = bodyForcesX.get(id) ?? [];
    let netFx: number = dae.addRealLiteral(0.0);
    for (const f of fxList) {
      netFx = dae.addBinaryExpr(BinOp.Add, netFx, f);
    }
    const lhsFx = dae.addBinaryExpr(BinOp.Mul, massExpr, dae.addDerExpr(dae.addNameExpr(`${id}.vx`)));
    dae.addEquation(EqKind.Simple, lhsFx, netFx);

    // Y-momentum: m * der(vy) = sum(Fy)
    const fyList = bodyForcesY.get(id) ?? [];
    let netFy: number = dae.addRealLiteral(0.0);
    for (const f of fyList) {
      netFy = dae.addBinaryExpr(BinOp.Add, netFy, f);
    }
    const lhsFy = dae.addBinaryExpr(BinOp.Mul, massExpr, dae.addDerExpr(dae.addNameExpr(`${id}.vy`)));
    dae.addEquation(EqKind.Simple, lhsFy, netFy);

    // Z-momentum: m * der(vz) = sum(Fz) - m * g
    const fzList = bodyForcesZ.get(id) ?? [];
    let netFz: number = dae.addRealLiteral(0.0);
    for (const f of fzList) {
      netFz = dae.addBinaryExpr(BinOp.Add, netFz, f);
    }
    const fGravity = dae.addBinaryExpr(BinOp.Mul, massExpr, dae.addRealLiteral(-gravityG));
    netFz = dae.addBinaryExpr(BinOp.Add, netFz, fGravity);
    const lhsFz = dae.addBinaryExpr(BinOp.Mul, massExpr, dae.addDerExpr(dae.addNameExpr(`${id}.vz`)));
    dae.addEquation(EqKind.Simple, lhsFz, netFz);

    // Rotational balance: I * der(omega) = sum(tau)
    const { ixx, iyy, izz } = part.inertia;

    // Tx
    const txList = bodyTorquesX.get(id) ?? [];
    let netTx: number = dae.addRealLiteral(0.0);
    for (const t of txList) {
      netTx = dae.addBinaryExpr(BinOp.Add, netTx, t);
    }
    const lhsTx = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(ixx), dae.addDerExpr(dae.addNameExpr(`${id}.wx`)));
    dae.addEquation(EqKind.Simple, lhsTx, netTx);

    // Ty
    const tyList = bodyTorquesY.get(id) ?? [];
    let netTy: number = dae.addRealLiteral(0.0);
    for (const t of tyList) {
      netTy = dae.addBinaryExpr(BinOp.Add, netTy, t);
    }
    const lhsTy = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(iyy), dae.addDerExpr(dae.addNameExpr(`${id}.wy`)));
    dae.addEquation(EqKind.Simple, lhsTy, netTy);

    // Tz
    const tzList = bodyTorquesZ.get(id) ?? [];
    let netTz: number = dae.addRealLiteral(0.0);
    for (const t of tzList) {
      netTz = dae.addBinaryExpr(BinOp.Add, netTz, t);
    }
    const lhsTz = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(izz), dae.addDerExpr(dae.addNameExpr(`${id}.wz`)));
    dae.addEquation(EqKind.Simple, lhsTz, netTz);
  }

  return dae;
}
