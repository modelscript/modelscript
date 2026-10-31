// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ccsds — Zero-GC Linear DAE Arena Lowering for Spacecraft Orbits.
 *
 * Emits 6-DOF Cowell perturbed orbital equations of motion directly into
 * linear memory DAEBuilder arena integers (ExprId, EqId, VarId).
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { J2_EARTH, keplerianToCartesian, MU_EARTH_KM, R_EARTH_KM } from "../astrodynamics/orbital-mechanics.js";
import type { CcsdsDocument } from "../types.js";

export function lowerCcsdsToDae(doc: CcsdsDocument, modelTitle?: string): DAEBuilder {
  const interner = new StringInterner();
  const name = (modelTitle ?? (doc.format === "XTCE" ? doc.name : doc.metadata.objectName)).replace(
    /[^a-zA-Z0-9_]/g,
    "_",
  );
  const arena = new DAEBuilder(interner, name);

  // Determine initial state vector
  let initPos: [number, number, number] = [7000.0, 0.0, 0.0]; // km
  let initVel: [number, number, number] = [0.0, 7.546, 0.0]; // km/s

  if (doc.format === "OPM") {
    if (doc.stateVector.x !== 0 || doc.stateVector.y !== 0 || doc.stateVector.z !== 0) {
      initPos = [doc.stateVector.x, doc.stateVector.y, doc.stateVector.z];
      initVel = [doc.stateVector.vx, doc.stateVector.vy, doc.stateVector.vz];
    } else if (doc.keplerian) {
      const sv = keplerianToCartesian(doc.keplerian);
      initPos = [sv.x, sv.y, sv.z];
      initVel = [sv.vx, sv.vy, sv.vz];
    }
  } else if (doc.format === "OMM") {
    const sv = keplerianToCartesian(doc.meanElements);
    initPos = [sv.x, sv.y, sv.z];
    initVel = [sv.vx, sv.vy, sv.vz];
  } else if (doc.format === "OEM" && doc.points.length > 0) {
    const p0 = doc.points[0]!;
    initPos = [p0.x, p0.y, p0.z];
    initVel = [p0.vx, p0.vy, p0.vz];
  }

  function addVar(varName: string, variability: Variability, initVal?: number): number {
    arena.addVariable(varName, VarType.Real, variability, Causality.Local, initVal ?? 0.0);
    const id = interner.intern(varName);
    return arena.addExpression(ExprKind.Name, id);
  }

  // 1. Declare Parameters with defining equations (keeps varCount === eqCount)
  const muExpr = addVar(`${name}_mu`, Variability.Parameter, MU_EARTH_KM);
  arena.addEquation(EqKind.Simple, muExpr, arena.addRealLiteral(MU_EARTH_KM));

  let scMass = 500.0;
  if ("spacecraft" in doc && doc.spacecraft?.massKg) {
    scMass = doc.spacecraft.massKg;
  }
  const massExpr = addVar(`${name}_mass`, Variability.Parameter, scMass);
  arena.addEquation(EqKind.Simple, massExpr, arena.addRealLiteral(scMass));

  // 2. Continuous State Variables: Position (x, y, z) and Velocity (vx, vy, vz)
  const xExpr = addVar(`${name}_x`, Variability.Continuous, initPos[0]);
  const yExpr = addVar(`${name}_y`, Variability.Continuous, initPos[1]);
  const zExpr = addVar(`${name}_z`, Variability.Continuous, initPos[2]);

  const vxExpr = addVar(`${name}_vx`, Variability.Continuous, initVel[0]);
  const vyExpr = addVar(`${name}_vy`, Variability.Continuous, initVel[1]);
  const vzExpr = addVar(`${name}_vz`, Variability.Continuous, initVel[2]);

  // Kinematic differential equations using arena.addDer: der(x) = vx, der(y) = vy, der(z) = vz
  arena.addEquation(EqKind.Simple, arena.addDer(xExpr), vxExpr);
  arena.addEquation(EqKind.Simple, arena.addDer(yExpr), vyExpr);
  arena.addEquation(EqKind.Simple, arena.addDer(zExpr), vzExpr);

  // Orbital radius variable r: r = sqrt(x^2 + y^2 + z^2)
  const rInit = Math.sqrt(initPos[0] * initPos[0] + initPos[1] * initPos[1] + initPos[2] * initPos[2]);
  const rExpr = addVar(`${name}_r`, Variability.Continuous, rInit);
  const x2 = arena.addBinaryExpr(BinOp.Mul, xExpr, xExpr);
  const y2 = arena.addBinaryExpr(BinOp.Mul, yExpr, yExpr);
  const z2 = arena.addBinaryExpr(BinOp.Mul, zExpr, zExpr);
  const r2Sum = arena.addBinaryExpr(BinOp.Add, arena.addBinaryExpr(BinOp.Add, x2, y2), z2);
  arena.addEquation(EqKind.Simple, rExpr, arena.addCallExpr("sqrt", [r2Sum]));

  // Velocity magnitude variable v: v = sqrt(vx^2 + vy^2 + vz^2)
  const vInit = Math.sqrt(initVel[0] * initVel[0] + initVel[1] * initVel[1] + initVel[2] * initVel[2]);
  const vExpr = addVar(`${name}_v`, Variability.Continuous, vInit);
  const vx2 = arena.addBinaryExpr(BinOp.Mul, vxExpr, vxExpr);
  const vy2 = arena.addBinaryExpr(BinOp.Mul, vyExpr, vyExpr);
  const vz2 = arena.addBinaryExpr(BinOp.Mul, vzExpr, vzExpr);
  const v2Sum = arena.addBinaryExpr(BinOp.Add, arena.addBinaryExpr(BinOp.Add, vx2, vy2), vz2);
  arena.addEquation(EqKind.Simple, vExpr, arena.addCallExpr("sqrt", [v2Sum]));

  // Specific orbital energy: E = 0.5*v^2 - mu/r
  const energyExpr = addVar(`${name}_energy`, Variability.Continuous, 0.5 * vInit * vInit - MU_EARTH_KM / rInit);
  const kineticTerm = arena.addBinaryExpr(
    BinOp.Mul,
    arena.addRealLiteral(0.5),
    arena.addBinaryExpr(BinOp.Mul, vExpr, vExpr),
  );
  const potentialTerm = arena.addBinaryExpr(BinOp.Div, muExpr, rExpr);
  arena.addEquation(EqKind.Simple, energyExpr, arena.addBinaryExpr(BinOp.Sub, kineticTerm, potentialTerm));

  // 3. Acceleration variables including two-body gravity + J2 zonal harmonic perturbation
  const axExpr = addVar(`${name}_ax`, Variability.Continuous, (-MU_EARTH_KM * initPos[0]) / (rInit * rInit * rInit));
  const ayExpr = addVar(`${name}_ay`, Variability.Continuous, (-MU_EARTH_KM * initPos[1]) / (rInit * rInit * rInit));
  const azExpr = addVar(`${name}_az`, Variability.Continuous, (-MU_EARTH_KM * initPos[2]) / (rInit * rInit * rInit));

  // Dynamics differential equations using arena.addDer: der(vx) = ax, der(vy) = ay, der(vz) = az
  arena.addEquation(EqKind.Simple, arena.addDer(vxExpr), axExpr);
  arena.addEquation(EqKind.Simple, arena.addDer(vyExpr), ayExpr);
  arena.addEquation(EqKind.Simple, arena.addDer(vzExpr), azExpr);

  // Algebraic equations for ax, ay, az with J2 oblateness perturbation:
  // a_xy = -mu * pos / r^3 + (1.5 * J2 * mu * R_E^2 / r^5) * pos * (5 * z^2 / r^2 - 1)
  // a_z  = -mu * z / r^3   + (1.5 * J2 * mu * R_E^2 / r^5) * z   * (5 * z^2 / r^2 - 3)
  const r2Expr = arena.addBinaryExpr(BinOp.Mul, rExpr, rExpr);
  const r3Expr = arena.addBinaryExpr(BinOp.Mul, r2Expr, rExpr);
  const r5Expr = arena.addBinaryExpr(BinOp.Mul, r3Expr, r2Expr);

  const z2OverR2 = arena.addBinaryExpr(BinOp.Div, z2, r2Expr);
  const fiveZ2OverR2 = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(5.0), z2OverR2);
  const j2Coeff = 1.5 * J2_EARTH * MU_EARTH_KM * R_EARTH_KM * R_EARTH_KM;
  const j2Factor = arena.addBinaryExpr(BinOp.Div, arena.addRealLiteral(j2Coeff), r5Expr);

  const j2XYBracket = arena.addBinaryExpr(BinOp.Sub, fiveZ2OverR2, arena.addRealLiteral(1.0));
  const j2ZBracket = arena.addBinaryExpr(BinOp.Sub, fiveZ2OverR2, arena.addRealLiteral(3.0));

  const zeroLit = arena.addRealLiteral(0.0);
  const negMuX = arena.addBinaryExpr(BinOp.Sub, zeroLit, arena.addBinaryExpr(BinOp.Mul, muExpr, xExpr));
  const negMuY = arena.addBinaryExpr(BinOp.Sub, zeroLit, arena.addBinaryExpr(BinOp.Mul, muExpr, yExpr));
  const negMuZ = arena.addBinaryExpr(BinOp.Sub, zeroLit, arena.addBinaryExpr(BinOp.Mul, muExpr, zExpr));

  const gravAx = arena.addBinaryExpr(BinOp.Div, negMuX, r3Expr);
  const gravAy = arena.addBinaryExpr(BinOp.Div, negMuY, r3Expr);
  const gravAz = arena.addBinaryExpr(BinOp.Div, negMuZ, r3Expr);

  const j2Ax = arena.addBinaryExpr(BinOp.Mul, arena.addBinaryExpr(BinOp.Mul, j2Factor, xExpr), j2XYBracket);
  const j2Ay = arena.addBinaryExpr(BinOp.Mul, arena.addBinaryExpr(BinOp.Mul, j2Factor, yExpr), j2XYBracket);
  const j2Az = arena.addBinaryExpr(BinOp.Mul, arena.addBinaryExpr(BinOp.Mul, j2Factor, zExpr), j2ZBracket);

  arena.addEquation(EqKind.Simple, axExpr, arena.addBinaryExpr(BinOp.Add, gravAx, j2Ax));
  arena.addEquation(EqKind.Simple, ayExpr, arena.addBinaryExpr(BinOp.Add, gravAy, j2Ay));
  arena.addEquation(EqKind.Simple, azExpr, arena.addBinaryExpr(BinOp.Add, gravAz, j2Az));

  // Altitude variable: altitude = r - R_EARTH_KM
  const altExpr = addVar(`${name}_altitude`, Variability.Continuous, rInit - R_EARTH_KM);
  arena.addEquation(EqKind.Simple, altExpr, arena.addBinaryExpr(BinOp.Sub, rExpr, arena.addRealLiteral(R_EARTH_KM)));

  return arena;
}
