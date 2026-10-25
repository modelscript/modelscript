// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { GensysModel } from "../types.js";

/**
 * Lowers a GENSYS vehicle model directly into ModelScript's DAE linear memory arena.
 * Formulates:
 * 1. 3D translational kinematics: der(p) = v
 * 2. Constitutive spring-damper coupling equations: F = k * (p2 - p1) + c * (v2 - v1)
 * 3. Newton dynamic momentum equations with net coupling forces and gravity:
 *      m * der(v) = sum(F_couplings) + F_gravity
 */
export function lowerGensysToDae(model: GensysModel, builder?: DAEBuilder): DAEBuilder {
  const dae = builder ?? new DAEBuilder(undefined, model.name);

  // 1. Emit state variables for each body: position (x, y, z), velocity (vx, vy, vz)
  for (const [name, body] of model.bodies.entries()) {
    dae.addVariable(`${name}.x`, VarType.Real, Variability.Continuous, Causality.Local, body.position.x);
    dae.addVariable(`${name}.y`, VarType.Real, Variability.Continuous, Causality.Local, body.position.y);
    dae.addVariable(`${name}.z`, VarType.Real, Variability.Continuous, Causality.Local, body.position.z);

    dae.addVariable(`${name}.vx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${name}.vy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${name}.vz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Kinematic differential relations: der(p) = v
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${name}.x`)), dae.addNameExpr(`${name}.vx`));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${name}.y`)), dae.addNameExpr(`${name}.vy`));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${name}.z`)), dae.addNameExpr(`${name}.vz`));
  }

  // 2. Track net force applied on each body in X, Y, Z
  // Maps bodyName -> array of force variable expressions (or signed terms)
  const bodyForcesX = new Map<string, number[]>();
  const bodyForcesY = new Map<string, number[]>();
  const bodyForcesZ = new Map<string, number[]>();

  for (const name of model.bodies.keys()) {
    bodyForcesX.set(name, []);
    bodyForcesY.set(name, []);
    bodyForcesZ.set(name, []);
  }

  // 3. Lower constitutive spring-damper couplings: F = k * (p2 - p1) + c * (v2 - v1)
  for (const [sName, s] of model.couplings.entries()) {
    const b1 = s.body1;
    const b2 = s.body2;

    // Intermediate force variables for this coupling
    dae.addVariable(`${sName}.fx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${sName}.fy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${sName}.fz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    const fxVar = dae.addNameExpr(`${sName}.fx`);
    const fyVar = dae.addNameExpr(`${sName}.fy`);
    const fzVar = dae.addNameExpr(`${sName}.fz`);

    // Helper to build F_axis = k * (p2 - p1) + c * (v2 - v1)
    const buildAxisForce = (axis: "x" | "y" | "z", kVal: number, cVal: number): number => {
      const p1Expr = b1 === "ground" ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${b1}.${axis}`);
      const p2Expr = b2 === "ground" ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${b2}.${axis}`);

      const v1Expr = b1 === "ground" ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${b1}.v${axis}`);
      const v2Expr = b2 === "ground" ? dae.addRealLiteral(0.0) : dae.addNameExpr(`${b2}.v${axis}`);

      const deltaP = dae.addBinaryExpr(BinOp.Sub, p2Expr, p1Expr);
      const deltaV = dae.addBinaryExpr(BinOp.Sub, v2Expr, v1Expr);

      const kExpr = dae.addRealLiteral(kVal);
      const cExpr = dae.addRealLiteral(cVal);

      const kTerm = dae.addBinaryExpr(BinOp.Mul, kExpr, deltaP);
      const cTerm = dae.addBinaryExpr(BinOp.Mul, cExpr, deltaV);

      return dae.addBinaryExpr(BinOp.Add, kTerm, cTerm);
    };

    const rhsFx = buildAxisForce("x", s.stiffness.x, s.damping.x);
    const rhsFy = buildAxisForce("y", s.stiffness.y, s.damping.y);
    const rhsFz = buildAxisForce("z", s.stiffness.z, s.damping.z);

    dae.addEquation(EqKind.Simple, fxVar, rhsFx);
    dae.addEquation(EqKind.Simple, fyVar, rhsFy);
    dae.addEquation(EqKind.Simple, fzVar, rhsFz);

    // Action-reaction:
    // +F is applied to body1 (pulling towards body2)
    // -F is applied to body2 (pulling towards body1)
    if (b1 !== "ground" && bodyForcesX.has(b1)) {
      bodyForcesX.get(b1)!.push(fxVar);
      bodyForcesY.get(b1)!.push(fyVar);
      bodyForcesZ.get(b1)!.push(fzVar);
    }
    if (b2 !== "ground" && bodyForcesX.has(b2)) {
      const negFx = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fxVar);
      const negFy = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fyVar);
      const negFz = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), fzVar);

      bodyForcesX.get(b2)!.push(negFx);
      bodyForcesY.get(b2)!.push(negFy);
      bodyForcesZ.get(b2)!.push(negFz);
    }
  }

  // 4. Formulate Newton momentum balance: m * der(v) = sum(F_couplings) + F_gravity
  for (const [name, body] of model.bodies.entries()) {
    const massExpr = dae.addRealLiteral(body.mass);

    // Sum forces in X
    const forcesX = bodyForcesX.get(name) ?? [];
    let netFx = dae.addRealLiteral(0.0);
    for (const f of forcesX) {
      netFx = dae.addBinaryExpr(BinOp.Add, netFx, f);
    }
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, massExpr, dae.addDerExpr(dae.addNameExpr(`${name}.vx`))),
      netFx,
    );

    // Sum forces in Y
    const forcesY = bodyForcesY.get(name) ?? [];
    let netFy = dae.addRealLiteral(0.0);
    for (const f of forcesY) {
      netFy = dae.addBinaryExpr(BinOp.Add, netFy, f);
    }
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, massExpr, dae.addDerExpr(dae.addNameExpr(`${name}.vy`))),
      netFy,
    );

    // Sum forces in Z including gravity -m * 9.81
    const forcesZ = bodyForcesZ.get(name) ?? [];
    const gravityForce = dae.addRealLiteral(-body.mass * 9.81);
    let netFz = gravityForce;
    for (const f of forcesZ) {
      netFz = dae.addBinaryExpr(BinOp.Add, netFz, f);
    }
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, massExpr, dae.addDerExpr(dae.addNameExpr(`${name}.vz`))),
      netFz,
    );
  }

  return dae;
}
