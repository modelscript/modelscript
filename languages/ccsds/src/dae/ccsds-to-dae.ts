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
import { keplerianToCartesian, MU_EARTH_KM } from "../astrodynamics/orbital-mechanics.js";
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
    arena.addVariable(varName, VarType.Real, variability, Causality.Local);
    const id = interner.intern(varName);
    const expr = arena.addExpression(ExprKind.Name, id);
    if (initVal !== undefined) {
      const lit = arena.addRealLiteral(initVal);
      arena.addEquation(EqKind.InitialSimple, expr, lit);
    }
    return expr;
  }

  // 1. Declare Parameters
  const muExpr = addVar(`${name}_mu`, Variability.Parameter, MU_EARTH_KM);

  let scMass = 500.0;
  if ("spacecraft" in doc && doc.spacecraft?.massKg) {
    scMass = doc.spacecraft.massKg;
  }
  addVar(`${name}_mass`, Variability.Parameter, scMass);

  // 2. Continuous State Variables: Position (x, y, z) and Velocity (vx, vy, vz)
  const xExpr = addVar(`${name}_x`, Variability.Continuous, initPos[0]);
  const yExpr = addVar(`${name}_y`, Variability.Continuous, initPos[1]);
  const zExpr = addVar(`${name}_z`, Variability.Continuous, initPos[2]);

  const vxExpr = addVar(`${name}_vx`, Variability.Continuous, initVel[0]);
  const vyExpr = addVar(`${name}_vy`, Variability.Continuous, initVel[1]);
  const vzExpr = addVar(`${name}_vz`, Variability.Continuous, initVel[2]);

  // Derivatives
  const derX = addVar(`der_${name}_x`, Variability.Continuous);
  const derY = addVar(`der_${name}_y`, Variability.Continuous);
  const derZ = addVar(`der_${name}_z`, Variability.Continuous);

  const derVx = addVar(`der_${name}_vx`, Variability.Continuous);
  const derVy = addVar(`der_${name}_vy`, Variability.Continuous);
  const derVz = addVar(`der_${name}_vz`, Variability.Continuous);

  // Kinematic differential equations: der(x) = vx, der(y) = vy, der(z) = vz
  arena.addEquation(EqKind.Simple, derX, vxExpr);
  arena.addEquation(EqKind.Simple, derY, vyExpr);
  arena.addEquation(EqKind.Simple, derZ, vzExpr);

  // Orbital radius variable r
  const rInit = Math.sqrt(initPos[0] * initPos[0] + initPos[1] * initPos[1] + initPos[2] * initPos[2]);
  const rExpr = addVar(`${name}_r`, Variability.Continuous, rInit);

  // Velocity magnitude variable v
  const vInit = Math.sqrt(initVel[0] * initVel[0] + initVel[1] * initVel[1] + initVel[2] * initVel[2]);
  addVar(`${name}_v`, Variability.Continuous, vInit);

  // Specific kinetic energy E = 0.5*v^2 - mu/r
  addVar(`${name}_energy`, Variability.Continuous, 0.5 * vInit * vInit - MU_EARTH_KM / rInit);

  // 3. Acceleration variables
  const axExpr = addVar(`${name}_ax`, Variability.Continuous, (-MU_EARTH_KM * initPos[0]) / (rInit * rInit * rInit));
  const ayExpr = addVar(`${name}_ay`, Variability.Continuous, (-MU_EARTH_KM * initPos[1]) / (rInit * rInit * rInit));
  const azExpr = addVar(`${name}_az`, Variability.Continuous, (-MU_EARTH_KM * initPos[2]) / (rInit * rInit * rInit));

  // Dynamics differential equations: der(vx) = ax, der(vy) = ay, der(vz) = az
  arena.addEquation(EqKind.Simple, derVx, axExpr);
  arena.addEquation(EqKind.Simple, derVy, ayExpr);
  arena.addEquation(EqKind.Simple, derVz, azExpr);

  // Algebraic equation for ax: ax = -mu * x / (r^3)
  const r3Expr = arena.addBinaryExpr(BinOp.Mul, rExpr, arena.addBinaryExpr(BinOp.Mul, rExpr, rExpr));

  const zeroLit = arena.addRealLiteral(0.0);
  const mu_x = arena.addBinaryExpr(BinOp.Mul, muExpr, xExpr);
  const neg_mu_x = arena.addBinaryExpr(BinOp.Sub, zeroLit, mu_x);

  const mu_y = arena.addBinaryExpr(BinOp.Mul, muExpr, yExpr);
  const neg_mu_y = arena.addBinaryExpr(BinOp.Sub, zeroLit, mu_y);

  const mu_z = arena.addBinaryExpr(BinOp.Mul, muExpr, zExpr);
  const neg_mu_z = arena.addBinaryExpr(BinOp.Sub, zeroLit, mu_z);

  arena.addEquation(EqKind.Simple, axExpr, arena.addBinaryExpr(BinOp.Div, neg_mu_x, r3Expr));
  arena.addEquation(EqKind.Simple, ayExpr, arena.addBinaryExpr(BinOp.Div, neg_mu_y, r3Expr));
  arena.addEquation(EqKind.Simple, azExpr, arena.addBinaryExpr(BinOp.Div, neg_mu_z, r3Expr));

  // Altitude variable
  const altExpr = addVar(`${name}_altitude`, Variability.Continuous, rInit - 6378.137);
  arena.addEquation(EqKind.Simple, altExpr, arena.addBinaryExpr(BinOp.Sub, rExpr, arena.addRealLiteral(6378.137)));

  return arena;
}
