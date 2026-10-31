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
  const sRef = Math.max(1.0, model.metrics.wingArea);
  const cChord = Math.max(0.5, model.metrics.chord);
  const iyy = Math.max(10.0, model.massBalance.iyy);
  const rho5k = 0.002048; // slugs/ft^3 at 5000 ft

  let clAlpha = 4.8;
  let cd0 = 0.027;
  const cdInduced = 0.045;
  let cmAlpha = -0.75;
  for (const c of model.aeroCoefficients) {
    if (c.axis === "LIFT" && Math.abs(c.baseValue) > 0) clAlpha = c.baseValue;
    if (c.axis === "DRAG" && Math.abs(c.baseValue) > 0) cd0 = c.baseValue;
    if (c.axis === "PITCH" && c.baseValue !== 0) cmAlpha = c.baseValue;
  }

  const maxThrust = model.engines.reduce((acc, e) => acc + (e.maxThrust > 0 ? e.maxThrust : 400.0), 0);
  const nominalThrust = maxThrust > 0 ? 0.7 * maxThrust : 300.0;

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
  const qbarVar = dae.addVariable("qbar", VarType.Real, Variability.Continuous, Causality.Local, 33.18);

  const thrustVar = dae.addVariable("thrust", VarType.Real, Variability.Continuous, Causality.Local, nominalThrust);
  const clVar = dae.addVariable("CL", VarType.Real, Variability.Continuous, Causality.Local, 0.35);
  const cdVar = dae.addVariable("CD", VarType.Real, Variability.Continuous, Causality.Local, cd0);

  // 3. Formulate Aerodynamic and Kinematic Equations
  // alpha = w / u (small angle approx)
  const alphaExpr = dae.addBinaryExpr(BinOp.Div, dae.addName(wVar), dae.addName(uVar));
  dae.addEquation(EqKind.Simple, dae.addName(alphaVar), alphaExpr);

  // beta = v / u
  const betaExpr = dae.addBinaryExpr(BinOp.Div, dae.addName(vVar), dae.addName(uVar));
  dae.addEquation(EqKind.Simple, dae.addName(betaVar), betaExpr);

  // CL = 0.35 + clAlpha * alpha
  const clTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(clAlpha), dae.addName(alphaVar));
  const clExpr = dae.addBinaryExpr(BinOp.Add, dae.addRealLiteral(0.35), clTerm);
  dae.addEquation(EqKind.Simple, dae.addName(clVar), clExpr);

  // CD = cd0 + cdInduced * CL^2 (parabolic drag polar)
  const clSq = dae.addBinaryExpr(BinOp.Mul, dae.addName(clVar), dae.addName(clVar));
  const cdTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cdInduced), clSq);
  const cdExpr = dae.addBinaryExpr(BinOp.Add, dae.addRealLiteral(cd0), cdTerm);
  dae.addEquation(EqKind.Simple, dae.addName(cdVar), cdExpr);

  // thrust = nominalThrust
  dae.addEquation(EqKind.Simple, dae.addName(thrustVar), dae.addRealLiteral(nominalThrust));

  // qbar = 0.5 * rho * u^2
  const uSq = dae.addBinaryExpr(BinOp.Mul, dae.addName(uVar), dae.addName(uVar));
  const qbarExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.5 * rho5k), uSq);
  dae.addEquation(EqKind.Simple, dae.addName(qbarVar), qbarExpr);

  // 4. Equations of Motion (ODE)
  // der(u) = (thrust - qbar * S * CD) / m - g * theta - q * w
  const dragForce = dae.addBinaryExpr(
    BinOp.Mul,
    dae.addBinaryExpr(BinOp.Mul, dae.addName(qbarVar), dae.addRealLiteral(sRef)),
    dae.addName(cdVar),
  );
  const netAxialForce = dae.addBinaryExpr(BinOp.Sub, dae.addName(thrustVar), dragForce);
  const axialAccel = dae.addBinaryExpr(BinOp.Div, netAxialForce, dae.addRealLiteral(mass));
  const gravAxial = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(g), dae.addName(thetaVar));
  const qwTerm = dae.addBinaryExpr(BinOp.Mul, dae.addName(qVar), dae.addName(wVar));
  const duExpr = dae.addBinaryExpr(BinOp.Sub, dae.addBinaryExpr(BinOp.Sub, axialAccel, gravAxial), qwTerm);
  dae.addEquation(EqKind.Simple, dae.addDer(uVar), duExpr);

  // der(v) = 0.0 (longitudinal symmetric flight)
  dae.addEquation(EqKind.Simple, dae.addDer(vVar), dae.addRealLiteral(0.0));

  // der(w) = -(qbar * S * CL) / m + g + q * u
  const liftForce = dae.addBinaryExpr(
    BinOp.Mul,
    dae.addBinaryExpr(BinOp.Mul, dae.addName(qbarVar), dae.addRealLiteral(-sRef / mass)),
    dae.addName(clVar),
  );
  const quTerm = dae.addBinaryExpr(BinOp.Mul, dae.addName(qVar), dae.addName(uVar));
  const dwExpr = dae.addBinaryExpr(BinOp.Add, dae.addBinaryExpr(BinOp.Add, liftForce, dae.addRealLiteral(g)), quTerm);
  dae.addEquation(EqKind.Simple, dae.addDer(wVar), dwExpr);

  // der(p) = 0.0
  dae.addEquation(EqKind.Simple, dae.addDer(pVar), dae.addRealLiteral(0.0));

  // der(q) = (cmAlpha * alpha) * qbar * S * c / Iyy
  const qScale = (sRef * cChord * cmAlpha) / iyy;
  const dqExpr = dae.addBinaryExpr(
    BinOp.Mul,
    dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(qScale), dae.addName(qbarVar)),
    dae.addName(alphaVar),
  );
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
