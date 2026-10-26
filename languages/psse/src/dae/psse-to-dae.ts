// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — Direct Linear-Memory DAE Arena Lowering for PSS/E Transmission Grids.
 *
 * Compiles multi-machine transient stability and AC power flow equations directly into
 * ModelScript's zero-GC WebAssembly DAEBuilder struct-of-arrays arena:
 *   1. Bus voltage variables: rectangular coordinates (V_{bus}_r, V_{bus}_i) and power injections
 *   2. Synchronous machine rotor angle delta_{gen} and speed omega_{gen} states:
 *        der(delta) = omega - omega_0
 *        (2H / omega_0) * der(omega) = Pm - Pe - D * (omega - omega_0)
 *   3. Algebraic AC nodal active and reactive power balance equations:
 *        P_inj = P_gen - P_load
 *        Q_inj = Q_gen - Q_load
 *        V_r^2 + V_i^2 = V_mag^2
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { PsseCase } from "../types.js";

export interface PsseDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  baseFrequency?: number | undefined; // Hz (default: 60.0)
}

export function lowerPsseToDae(psseCase: PsseCase, options?: PsseDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? (psseCase.title1 || "TransmissionGrid")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);
  const freq = options?.baseFrequency ?? psseCase.header.basfrq ?? 60.0;
  const omega0 = 2 * Math.PI * freq;

  // 1. Declare bus voltage states
  for (const [busNum, bus] of psseCase.buses) {
    const vMag = bus.vm || 1.0;
    const vAng = ((bus.va || 0.0) * Math.PI) / 180.0;
    const vr = vMag * Math.cos(vAng);
    const vi = vMag * Math.sin(vAng);

    dae.addVariable(`V_${busNum}_r`, VarType.Real, Variability.Continuous, Causality.Local, vr);
    dae.addVariable(`V_${busNum}_i`, VarType.Real, Variability.Continuous, Causality.Local, vi);
    dae.addVariable(`P_${busNum}_inj`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`Q_${busNum}_inj`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  }

  // 2. Declare synchronous machine rotor dynamics
  for (const gen of psseCase.generators) {
    if (gen.stat === 0) continue; // offline generator
    const genId = `${gen.i}_${gen.id.trim()}`;
    const H = 3.5; // typical inertia constant [s]
    const D = 1.0; // damping factor

    // delta (rotor angle in rad)
    const deltaVar = dae.addVariable(`delta_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.1);
    // omega (electrical rotor angular velocity in rad/s)
    const omegaVar = dae.addVariable(`omega_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, omega0);
    // Pe (electrical active power output)
    dae.addVariable(`Pe_${genId}`, VarType.Real, Variability.Continuous, Causality.Local, gen.pg);

    // der(delta) = omega - omega0
    const derDelta = dae.addDer(deltaVar);
    const omegaExpr = dae.addNameExpr(`omega_${genId}`);
    const omegaDiff = dae.addBinaryExpr(BinOp.Sub, omegaExpr, dae.addRealLiteral(omega0));
    dae.addEquation(EqKind.Simple, derDelta, omegaDiff);

    // (2H / omega0) * der(omega) = Pm - Pe - D * (omega - omega0)
    const derOmega = dae.addDer(omegaVar);
    const mInertia = (2 * H) / omega0;
    const lhsSwing = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(mInertia), derOmega);

    const pmLiteral = dae.addRealLiteral(gen.pg); // mechanical power input
    const peExpr = dae.addNameExpr(`Pe_${genId}`);
    const pAccel = dae.addBinaryExpr(BinOp.Sub, pmLiteral, peExpr);
    const dampTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(D), omegaDiff);
    const rhsSwing = dae.addBinaryExpr(BinOp.Sub, pAccel, dampTerm);
    dae.addEquation(EqKind.Simple, lhsSwing, rhsSwing);
  }

  // 3. Emit AC nodal power balance equations for each bus
  for (const [busNum] of psseCase.buses) {
    const vrExpr = dae.addNameExpr(`V_${busNum}_r`);
    const viExpr = dae.addNameExpr(`V_${busNum}_i`);

    // Sum of generation at this bus
    const busGens = psseCase.generators.filter((g) => g.i === busNum && g.stat !== 0);
    const totalPg = busGens.reduce((sum, g) => sum + g.pg, 0.0);
    const totalQg = busGens.reduce((sum, g) => sum + g.qg, 0.0);

    // Sum of load at this bus
    const busLoads = psseCase.loads.filter((l) => l.i === busNum && l.status !== 0);
    const totalPl = busLoads.reduce((sum, l) => sum + l.pl, 0.0);
    const totalQl = busLoads.reduce((sum, l) => sum + l.ql, 0.0);

    // P_net = P_gen - P_load
    const pNet = totalPg - totalPl;
    const qNet = totalQg - totalQl;

    // Algebraic equation: P_inj = P_net
    const pInj = dae.addNameExpr(`P_${busNum}_inj`);
    dae.addEquation(EqKind.Simple, pInj, dae.addRealLiteral(pNet));

    // Algebraic equation: Q_inj = Q_net
    const qInj = dae.addNameExpr(`Q_${busNum}_inj`);
    dae.addEquation(EqKind.Simple, qInj, dae.addRealLiteral(qNet));

    // Voltage magnitude constraint: V_r^2 + V_i^2 = V_mag^2
    const vr2 = dae.addBinaryExpr(BinOp.Mul, vrExpr, vrExpr);
    const vi2 = dae.addBinaryExpr(BinOp.Mul, viExpr, viExpr);
    const vMag2 = dae.addBinaryExpr(BinOp.Add, vr2, vi2);
    dae.addEquation(EqKind.Simple, vMag2, dae.addRealLiteral(1.0));
  }

  return dae;
}
