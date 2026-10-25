// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { FbiModel } from "../parser/fbi-parser.js";

export interface FbiLoweringOptions {
  builder?: DAEBuilder | undefined;
  prefix?: string | undefined;
  defaultDampingRatio?: number | undefined;
  appliedModalForces?: Map<number, number> | undefined; // modeIndex -> static/harmonic force amplitude
}

/**
 * Lowers SIMPACK Flexible Body (.fbi) modal coordinates and Craig-Bampton
 * condensed equations of motion directly into ModelScript's linear memory DAEBuilder arena:
 *
 * For each mode i in [1..numModes]:
 *   1. der(q_i) = vq_i
 *   2. m_i * der(vq_i) + c_i * vq_i + k_i * q_i = Q_i
 *      where c_i = 2 * zeta_i * sqrt(m_i * k_i)
 *   3. Boundary node elastic deformation recovery:
 *      u_j = sum_i(Phi_{j,i} * q_i)
 */
export function lowerFbiToDae(fbi: FbiModel, options?: FbiLoweringOptions): DAEBuilder {
  const name = options?.prefix ?? fbi.name ?? "FlexBody";
  const dae = options?.builder ?? new DAEBuilder(undefined, name);
  const defaultZeta = options?.defaultDampingRatio ?? 0.02;

  // Track mode coordinates for elastic recovery expressions
  const modeExprs = new Map<number, number>();

  for (const mode of fbi.modes) {
    const idx = mode.modeIndex;
    const qName = `${name}.q${idx}`;
    const vqName = `${name}.vq${idx}`;

    // Generalized modal displacement q_i and velocity vq_i
    dae.addVariable(qName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(vqName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    const qExpr = dae.addNameExpr(qName);
    const vqExpr = dae.addNameExpr(vqName);
    modeExprs.set(idx, qExpr);

    // 1. Kinematic differential equation: der(q_i) = vq_i
    dae.addEquation(EqKind.Simple, dae.addDerExpr(qExpr), vqExpr);

    // 2. Modal oscillator equation:
    // m_i * der(vq_i) = Q_i - c_i * vq_i - k_i * q_i
    const mVal = mode.generalizedMass > 0 ? mode.generalizedMass : 1.0;
    const kVal =
      mode.generalizedStiffness > 0 ? mode.generalizedStiffness : Math.pow(2 * Math.PI * mode.frequencyHz, 2) * mVal;
    const zeta = mode.dampingRatio ?? defaultZeta;
    const cVal = 2 * zeta * Math.sqrt(mVal * kVal);

    const mExpr = dae.addRealLiteral(mVal);
    const cExpr = dae.addRealLiteral(cVal);
    const kExpr = dae.addRealLiteral(kVal);

    const appliedF = options?.appliedModalForces?.get(idx) ?? 0.0;
    const qForceExpr = dae.addRealLiteral(appliedF);

    // netForce = Q_i - c * vq - k * q
    const dampingTerm = dae.addBinaryExpr(BinOp.Mul, cExpr, vqExpr);
    const stiffnessTerm = dae.addBinaryExpr(BinOp.Mul, kExpr, qExpr);
    const restoringForce = dae.addBinaryExpr(BinOp.Add, dampingTerm, stiffnessTerm);
    const netForce = dae.addBinaryExpr(BinOp.Sub, qForceExpr, restoringForce);

    dae.addEquation(EqKind.Simple, dae.addBinaryExpr(BinOp.Mul, mExpr, dae.addDerExpr(vqExpr)), netForce);
  }

  // 3. Elastic recovery at boundary attachment nodes
  // For each node that appears in mode shape entries:
  const nodeShapesMap = new Map<string | number, { modeIdx: number; phi: { x: number; y: number; z: number } }[]>();

  for (const mode of fbi.modes) {
    if (!mode.shapes) continue;
    for (const s of mode.shapes) {
      const list = nodeShapesMap.get(s.nodeId) ?? [];
      list.push({ modeIdx: mode.modeIndex, phi: s.phi });
      nodeShapesMap.set(s.nodeId, list);
    }
  }

  for (const [nodeId, shapeList] of nodeShapesMap.entries()) {
    // Elastic deflection in Z: u_z = sum_i(phi_{z,i} * q_i)
    const varNameZ = `${name}.u_node_${nodeId}_z`;
    dae.addVariable(varNameZ, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const uVarExpr = dae.addNameExpr(varNameZ);

    let sumExpr: number = dae.addRealLiteral(0.0);
    for (const item of shapeList) {
      const qExpr = modeExprs.get(item.modeIdx);
      if (!qExpr) continue;
      if (item.phi.z !== 0) {
        const phiExpr = dae.addRealLiteral(item.phi.z);
        const term = dae.addBinaryExpr(BinOp.Mul, phiExpr, qExpr);
        sumExpr = dae.addBinaryExpr(BinOp.Add, sumExpr, term);
      }
    }

    dae.addEquation(EqKind.Simple, uVarExpr, sumExpr);
  }

  return dae;
}
