// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for USAF Stability and Control Digital DATCOM.
 *
 * Lowers a DATCOM case and its solved semi-empirical aerodynamic derivatives directly into
 * `@modelscript/runtime`'s `IDaeBuilder` linear-memory arena as a 6-DOF linearized
 * longitudinal (`u, w, q, theta`) and lateral (`v, p, r, phi`) flight-dynamics state-space model.
 */

import { BinOp, Causality, EqKind, VarType, Variability, type IDaeBuilder } from "@modelscript/runtime";
import { solveDatcomCase, type SolveDatcomOptions } from "../solver/aero-solver.js";
import type { DatcomAeroResult, DatcomCase } from "../types.js";

const G0 = 9.80665;

export interface DatcomDaeLoweringResult {
  aeroResult: DatcomAeroResult;
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

function addLinearCombination(builder: IDaeBuilder, terms: Array<{ coeff: number; varIdx: number }>): number {
  let acc: number | null = null;
  for (const term of terms) {
    const prod = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(term.coeff), builder.addName(term.varIdx));
    if (acc === null) {
      acc = prod;
    } else {
      acc = builder.addBinaryExpr(BinOp.Add, acc, prod);
    }
  }
  return acc ?? builder.addRealLiteral(0.0);
}

/**
 * Lowers a parsed Digital DATCOM case into an existing `IDaeBuilder` arena.
 */
export function lowerDatcomToDae(
  builder: IDaeBuilder,
  c: DatcomCase,
  options?: SolveDatcomOptions,
): DatcomDaeLoweringResult {
  const aero = solveDatcomCase(c, options);
  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;

  function addVar(
    name: string,
    variability: Variability = Variability.Continuous,
    startVal: number = 0.0,
    causality: Causality = Causality.Local,
  ): number {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const idx = builder.addVariable(name, VarType.Real, variability, causality, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  // Parameters
  addVar("V0", Variability.Parameter, aero.airspeedMS);
  addVar("Sref", Variability.Parameter, aero.SrefM2);
  addVar("cbar", Variability.Parameter, aero.cbarM);
  addVar("bref", Variability.Parameter, aero.brefM);
  addVar("mass", Variability.Parameter, aero.massKg);
  addVar("CL_alpha", Variability.Parameter, aero.CLalphaPerRad);
  addVar("CD0", Variability.Parameter, aero.CD0);
  addVar("Cm_alpha", Variability.Parameter, aero.CmalphaPerRad);
  addVar("Cmq", Variability.Parameter, aero.Cmq);
  addVar("Clp", Variability.Parameter, aero.Clp);
  addVar("Cnr", Variability.Parameter, aero.Cnr);

  // Longitudinal state vector: u (axial perturbation m/s), w (vertical m/s), q (pitch rate rad/s), theta (pitch rad)
  const uVar = addVar("u", Variability.Continuous, 0.0);
  const wVar = addVar("w", Variability.Continuous, 0.0);
  const qVar = addVar("q", Variability.Continuous, 0.0);
  const thetaVar = addVar("theta", Variability.Continuous, 0.0);
  stateVarIndices.push(uVar, wVar, qVar, thetaVar);

  // Lateral-directional state vector: v (side velocity m/s), p (roll rate rad/s), r (yaw rate rad/s), phi (bank rad)
  const vVar = addVar("v", Variability.Continuous, 0.0);
  const pVar = addVar("p", Variability.Continuous, 0.0);
  const rVar = addVar("r", Variability.Continuous, 0.0);
  const phiVar = addVar("phi", Variability.Continuous, 0.0);
  stateVarIndices.push(vVar, pVar, rVar, phiVar);

  // Aerodynamic algebraic outputs
  const alphaVar = addVar("alpha", Variability.Continuous, 0.0, Causality.Output);
  const clVar = addVar("CL", Variability.Continuous, aero.CL0, Causality.Output);
  const cdVar = addVar("CD", Variability.Continuous, aero.CD0, Causality.Output);
  const cmVar = addVar("Cm", Variability.Continuous, aero.Cm0, Causality.Output);

  const lon = aero.longitudinalModes;
  const lat = aero.lateralModes;
  const V0 = aero.airspeedMS;

  // 1. der(u) = Xu*u + Xw*w - g*theta
  builder.addEquation(
    EqKind.Simple,
    builder.addDer(uVar),
    addLinearCombination(builder, [
      { coeff: lon.Xu, varIdx: uVar },
      { coeff: lon.Xw, varIdx: wVar },
      { coeff: -G0, varIdx: thetaVar },
    ]),
  );
  equationCount++;

  // 2. der(w) = Zu*u + Zw*w + V0*q
  builder.addEquation(
    EqKind.Simple,
    builder.addDer(wVar),
    addLinearCombination(builder, [
      { coeff: lon.Zu, varIdx: uVar },
      { coeff: lon.Zw, varIdx: wVar },
      { coeff: V0, varIdx: qVar },
    ]),
  );
  equationCount++;

  // 3. der(q) = Mu*u + Mw*w + Mq*q
  builder.addEquation(
    EqKind.Simple,
    builder.addDer(qVar),
    addLinearCombination(builder, [
      { coeff: lon.Mu, varIdx: uVar },
      { coeff: lon.Mw, varIdx: wVar },
      { coeff: lon.Mq, varIdx: qVar },
    ]),
  );
  equationCount++;

  // 4. der(theta) = q
  builder.addEquation(EqKind.Simple, builder.addDer(thetaVar), builder.addName(qVar));
  equationCount++;

  // 5. der(v) = Yv*v + Yp*p + (Yr - V0)*r + g*phi
  builder.addEquation(
    EqKind.Simple,
    builder.addDer(vVar),
    addLinearCombination(builder, [
      { coeff: lat.Yv, varIdx: vVar },
      { coeff: lat.Yp, varIdx: pVar },
      { coeff: lat.Yr - V0, varIdx: rVar },
      { coeff: G0, varIdx: phiVar },
    ]),
  );
  equationCount++;

  // 6. der(p) = Lv*v + Lp*p + Lr*r
  builder.addEquation(
    EqKind.Simple,
    builder.addDer(pVar),
    addLinearCombination(builder, [
      { coeff: lat.Lv, varIdx: vVar },
      { coeff: lat.Lp, varIdx: pVar },
      { coeff: lat.Lr, varIdx: rVar },
    ]),
  );
  equationCount++;

  // 7. der(r) = Nv*v + Np*p + Nr*r
  builder.addEquation(
    EqKind.Simple,
    builder.addDer(rVar),
    addLinearCombination(builder, [
      { coeff: lat.Nv, varIdx: vVar },
      { coeff: lat.Np, varIdx: pVar },
      { coeff: lat.Nr, varIdx: rVar },
    ]),
  );
  equationCount++;

  // 8. der(phi) = p
  builder.addEquation(EqKind.Simple, builder.addDer(phiVar), builder.addName(pVar));
  equationCount++;

  // 9. alpha = w / V0
  builder.addEquation(
    EqKind.Simple,
    builder.addName(alphaVar),
    builder.addBinaryExpr(BinOp.Div, builder.addName(wVar), builder.addRealLiteral(V0)),
  );
  equationCount++;

  // 10. CL = CL0 + CL_alpha * alpha
  builder.addEquation(
    EqKind.Simple,
    builder.addName(clVar),
    builder.addBinaryExpr(
      BinOp.Add,
      builder.addRealLiteral(aero.CL0),
      builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(aero.CLalphaPerRad), builder.addName(alphaVar)),
    ),
  );
  equationCount++;

  // 11. CD = CD0 + CL * CL / (pi * e * AR)
  const kInduced = 1.0 / (Math.PI * aero.oswaldEfficiency * aero.aspectRatio);
  const clSq = builder.addBinaryExpr(BinOp.Mul, builder.addName(clVar), builder.addName(clVar));
  builder.addEquation(
    EqKind.Simple,
    builder.addName(cdVar),
    builder.addBinaryExpr(
      BinOp.Add,
      builder.addRealLiteral(aero.CD0),
      builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(kInduced), clSq),
    ),
  );
  equationCount++;

  // 12. Cm = Cm0 + Cm_alpha * alpha
  builder.addEquation(
    EqKind.Simple,
    builder.addName(cmVar),
    builder.addBinaryExpr(
      BinOp.Add,
      builder.addRealLiteral(aero.Cm0),
      builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(aero.CmalphaPerRad), builder.addName(alphaVar)),
    ),
  );
  equationCount++;

  return {
    aeroResult: aero,
    stateVarIndices,
    equationCount,
    variableMap,
  };
}
