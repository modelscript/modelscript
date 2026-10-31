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

  // 1b. Emit state variables for each wheelset: position (x, y, z), velocity (vx, vy, vz), yaw (psi, vyaw)
  for (const [wName, ws] of model.wheelsets.entries()) {
    dae.addVariable(`${wName}.x`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${wName}.y`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${wName}.z`, VarType.Real, Variability.Continuous, Causality.Local, ws.wheelRadius);

    dae.addVariable(`${wName}.vx`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${wName}.vy`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${wName}.vz`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    dae.addVariable(`${wName}.psi`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${wName}.vyaw`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Kinematic differential relations: der(p) = v, der(psi) = vyaw
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${wName}.x`)), dae.addNameExpr(`${wName}.vx`));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${wName}.y`)), dae.addNameExpr(`${wName}.vy`));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${wName}.z`)), dae.addNameExpr(`${wName}.vz`));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr(`${wName}.psi`)), dae.addNameExpr(`${wName}.vyaw`));
  }

  // 2. Track net force applied on each body and wheelset in X, Y, Z
  // Maps entityName -> array of force variable expressions (or signed terms)
  const bodyForcesX = new Map<string, number[]>();
  const bodyForcesY = new Map<string, number[]>();
  const bodyForcesZ = new Map<string, number[]>();

  for (const name of model.bodies.keys()) {
    bodyForcesX.set(name, []);
    bodyForcesY.set(name, []);
    bodyForcesZ.set(name, []);
  }
  for (const wName of model.wheelsets.keys()) {
    bodyForcesX.set(wName, []);
    bodyForcesY.set(wName, []);
    bodyForcesZ.set(wName, []);
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

  // 5. Lower wheelset Kalker/Polach linear creep contact forces and wheelset momentum equations
  const forwardSpeed = Math.max(1.0, model.simulationConfig?.speed ?? 30.0);
  for (const [wName, ws] of model.wheelsets.entries()) {
    const r0 = Math.max(0.1, ws.wheelRadius);
    const conicity = Math.max(0.01, ws.conicity);
    const halfGauge = 0.5 * Math.max(0.5, ws.gauge);
    // Kalker linear creep coefficients (two wheels per axle)
    const f11 = 2.0 * 4.5e6;
    const f22 = 2.0 * 4.1e6;
    const kRailZ = 2.0e8;
    const cRailZ = 1.0e5;

    // Creepage & contact force variables (5 algebraic variables + 5 equations)
    dae.addVariable(`${wName}.creep_x`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${wName}.creep_y`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${wName}.fx_creep`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${wName}.fy_creep`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`${wName}.fz_rail`, VarType.Real, Variability.Continuous, Causality.Local, ws.mass * 9.81);

    const creepXVar = dae.addNameExpr(`${wName}.creep_x`);
    const creepYVar = dae.addNameExpr(`${wName}.creep_y`);
    const fxCreepVar = dae.addNameExpr(`${wName}.fx_creep`);
    const fyCreepVar = dae.addNameExpr(`${wName}.fy_creep`);
    const fzRailVar = dae.addNameExpr(`${wName}.fz_rail`);

    // creep_x = vx / V + (conicity / r0) * y + (halfGauge / V) * vyaw
    const vxOverV = dae.addBinaryExpr(BinOp.Div, dae.addNameExpr(`${wName}.vx`), dae.addRealLiteral(forwardSpeed));
    const conicityTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(conicity / r0), dae.addNameExpr(`${wName}.y`));
    const yawRateTerm = dae.addBinaryExpr(
      BinOp.Mul,
      dae.addRealLiteral(halfGauge / forwardSpeed),
      dae.addNameExpr(`${wName}.vyaw`),
    );
    const creepXRhs = dae.addBinaryExpr(BinOp.Add, dae.addBinaryExpr(BinOp.Add, vxOverV, conicityTerm), yawRateTerm);
    dae.addEquation(EqKind.Simple, creepXVar, creepXRhs);

    // creep_y = vy / V - psi
    const vyOverV = dae.addBinaryExpr(BinOp.Div, dae.addNameExpr(`${wName}.vy`), dae.addRealLiteral(forwardSpeed));
    const creepYRhs = dae.addBinaryExpr(BinOp.Sub, vyOverV, dae.addNameExpr(`${wName}.psi`));
    dae.addEquation(EqKind.Simple, creepYVar, creepYRhs);

    // fx_creep = -f11 * creep_x
    dae.addEquation(EqKind.Simple, fxCreepVar, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-f11), creepXVar));

    // fy_creep = -f22 * creep_y
    dae.addEquation(EqKind.Simple, fyCreepVar, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-f22), creepYVar));

    // fz_rail = -kRailZ * (z - r0) - cRailZ * vz + m_ws * 9.81
    const dzRail = dae.addBinaryExpr(BinOp.Sub, dae.addNameExpr(`${wName}.z`), dae.addRealLiteral(r0));
    const kRailTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-kRailZ), dzRail);
    const cRailTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-cRailZ), dae.addNameExpr(`${wName}.vz`));
    const fzRailRhs = dae.addBinaryExpr(
      BinOp.Add,
      dae.addBinaryExpr(BinOp.Add, kRailTerm, cRailTerm),
      dae.addRealLiteral(ws.mass * 9.81),
    );
    dae.addEquation(EqKind.Simple, fzRailVar, fzRailRhs);

    // Wheelset momentum balance (4 ODEs for vx, vy, vz, vyaw)
    const wsMassExpr = dae.addRealLiteral(Math.max(1.0, ws.mass));
    const wsJzExpr = dae.addRealLiteral(Math.max(1.0, ws.inertia.jz));

    let netWsFx = fxCreepVar;
    for (const f of bodyForcesX.get(wName) ?? []) {
      netWsFx = dae.addBinaryExpr(BinOp.Add, netWsFx, f);
    }
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, wsMassExpr, dae.addDerExpr(dae.addNameExpr(`${wName}.vx`))),
      netWsFx,
    );

    let netWsFy = fyCreepVar;
    for (const f of bodyForcesY.get(wName) ?? []) {
      netWsFy = dae.addBinaryExpr(BinOp.Add, netWsFy, f);
    }
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, wsMassExpr, dae.addDerExpr(dae.addNameExpr(`${wName}.vy`))),
      netWsFy,
    );

    let netWsFz = dae.addBinaryExpr(BinOp.Add, fzRailVar, dae.addRealLiteral(-ws.mass * 9.81));
    for (const f of bodyForcesZ.get(wName) ?? []) {
      netWsFz = dae.addBinaryExpr(BinOp.Add, netWsFz, f);
    }
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, wsMassExpr, dae.addDerExpr(dae.addNameExpr(`${wName}.vz`))),
      netWsFz,
    );

    // Yaw moment: Jz * der(vyaw) = -halfGauge * f11 * ((conicity / r0) * y + (halfGauge / V) * vyaw)
    const yawConicityMoment = dae.addBinaryExpr(
      BinOp.Mul,
      dae.addRealLiteral(-halfGauge * f11 * (conicity / r0)),
      dae.addNameExpr(`${wName}.y`),
    );
    const yawDampingMoment = dae.addBinaryExpr(
      BinOp.Mul,
      dae.addRealLiteral((-halfGauge * halfGauge * f11) / forwardSpeed),
      dae.addNameExpr(`${wName}.vyaw`),
    );
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, wsJzExpr, dae.addDerExpr(dae.addNameExpr(`${wName}.vyaw`))),
      dae.addBinaryExpr(BinOp.Add, yawConicityMoment, yawDampingMoment),
    );
  }

  return dae;
}
