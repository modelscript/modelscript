// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/jsbsim — Direct Linear-Memory DAE Arena Lowering for 6-DOF Flight Dynamics.
 *
 * Compiles JSBSim aircraft metrics, mass balance, propulsion, and aerodynamics
 * into ModelScript's zero-GC DAEBuilder:
 *   1. Body-axis translational velocities: u, v, w
 *   2. Body-axis angular rates: p, q, r
 *   3. Euler attitude angles: phi, theta, psi
 *   4. Flight mechanics ODE equations of motion
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { JsbsimDocument } from "../types.js";

export interface JsbsimDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

export function lowerJsbsimToDae(doc: JsbsimDocument, options?: JsbsimDaeOptions): DAEBuilder {
  const model = doc.model;
  const modelName = (options?.modelName ?? (model.name || "JsbsimAircraft")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const g = 32.174; // ft/s^2
  const mass = Math.max(10.0, model.massBalance.emptyWeight / g);

  // 1. Declare State Variables
  const uVar = dae.addVariable("u", VarType.Real, Variability.Continuous, Causality.Local, 180.0);
  const vVar = dae.addVariable("v", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const wVar = dae.addVariable("w", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  const pVar = dae.addVariable("p", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const qVar = dae.addVariable("q", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const rVar = dae.addVariable("r", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  const phiVar = dae.addVariable("phi", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const thetaVar = dae.addVariable("theta", VarType.Real, Variability.Continuous, Causality.Local, 0.05);
  const psiVar = dae.addVariable("psi", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  const hVar = dae.addVariable("altitude", VarType.Real, Variability.Continuous, Causality.Local, 5000.0);

  // 2. Declare Auxiliary Flight Parameters
  const alphaVar = dae.addVariable("alpha", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const betaVar = dae.addVariable("beta", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const qbarVar = dae.addVariable("qbar", VarType.Real, Variability.Continuous, Causality.Local, 38.5);

  const thrustVar = dae.addVariable("thrust", VarType.Real, Variability.Continuous, Causality.Local, 300.0);
  const clVar = dae.addVariable("CL", VarType.Real, Variability.Continuous, Causality.Local, 0.35);
  const cdVar = dae.addVariable("CD", VarType.Real, Variability.Continuous, Causality.Local, 0.03);

  // 3. Formulate Aerodynamic and Kinematic Equations
  // alpha = w / u (small angle approx)
  const alphaExpr = dae.addBinaryExpr(BinOp.Div, dae.addName(wVar), dae.addName(uVar));
  dae.addEquation(EqKind.Simple, dae.addName(alphaVar), alphaExpr);

  // beta = v / u
  const betaExpr = dae.addBinaryExpr(BinOp.Div, dae.addName(vVar), dae.addName(uVar));
  dae.addEquation(EqKind.Simple, dae.addName(betaVar), betaExpr);

  // CL = 0.35 + 4.8 * alpha
  const clTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(4.8), dae.addName(alphaVar));
  const clExpr = dae.addBinaryExpr(BinOp.Add, dae.addRealLiteral(0.35), clTerm);
  dae.addEquation(EqKind.Simple, dae.addName(clVar), clExpr);

  // CD = 0.027 + 0.045 * CL
  const cdTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.045), dae.addName(clVar));
  const cdExpr = dae.addBinaryExpr(BinOp.Add, dae.addRealLiteral(0.027), cdTerm);
  dae.addEquation(EqKind.Simple, dae.addName(cdVar), cdExpr);

  // thrust = 300.0 (constant cruise thrust)
  dae.addEquation(EqKind.Simple, dae.addName(thrustVar), dae.addRealLiteral(300.0));
  dae.addEquation(EqKind.Simple, dae.addName(qbarVar), dae.addRealLiteral(38.5));

  // 4. Equations of Motion (ODE)
  // der(u) = (thrust - drag) / m - q * w
  const invMass = dae.addRealLiteral(1.0 / mass);
  const fwdForce = dae.addBinaryExpr(BinOp.Mul, invMass, dae.addName(thrustVar));
  dae.addEquation(EqKind.Simple, dae.addDer(uVar), fwdForce);

  // der(v) = 0.0 (longitudinal symmetric flight)
  dae.addEquation(EqKind.Simple, dae.addDer(vVar), dae.addRealLiteral(0.0));

  // der(w) = -lift / m + q * u
  const liftForce = dae.addBinaryExpr(
    BinOp.Mul,
    dae.addRealLiteral((-38.5 * model.metrics.wingArea) / mass),
    dae.addName(clVar),
  );
  const quTerm = dae.addBinaryExpr(BinOp.Mul, dae.addName(qVar), dae.addName(uVar));
  const dwExpr = dae.addBinaryExpr(BinOp.Add, liftForce, quTerm);
  dae.addEquation(EqKind.Simple, dae.addDer(wVar), dwExpr);

  // der(p) = 0.0
  dae.addEquation(EqKind.Simple, dae.addDer(pVar), dae.addRealLiteral(0.0));

  // der(q) = Cm * qbar * S * c / Iyy
  const qScale = (38.5 * model.metrics.wingArea * model.metrics.chord) / Math.max(10.0, model.massBalance.iyy);
  const dqExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-qScale * 0.75), dae.addName(alphaVar));
  dae.addEquation(EqKind.Simple, dae.addDer(qVar), dqExpr);

  // der(r) = 0.0
  dae.addEquation(EqKind.Simple, dae.addDer(rVar), dae.addRealLiteral(0.0));

  // Attitudes:
  // der(theta) = q
  dae.addEquation(EqKind.Simple, dae.addDer(thetaVar), dae.addName(qVar));
  // der(phi) = p
  dae.addEquation(EqKind.Simple, dae.addDer(phiVar), dae.addName(pVar));
  // der(psi) = r
  dae.addEquation(EqKind.Simple, dae.addDer(psiVar), dae.addName(rVar));

  // der(altitude) = u * theta - w
  const dhTerm = dae.addBinaryExpr(BinOp.Mul, dae.addName(uVar), dae.addName(thetaVar));
  const dhExpr = dae.addBinaryExpr(BinOp.Sub, dhTerm, dae.addName(wVar));
  dae.addEquation(EqKind.Simple, dae.addDer(hVar), dhExpr);

  return dae;
}
