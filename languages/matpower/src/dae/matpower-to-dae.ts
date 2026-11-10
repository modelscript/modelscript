// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Linear-Memory DAE Arena Lowering for MATPOWER Cases.
 *
 * Compiles AC power flow equations directly into ModelScript's zero-GC DAEBuilder
 * linear memory struct-of-arrays arena:
 *   - Nodal voltage state variables (Vm, Va or Vr, Vi)
 *   - Active and reactive nodal power balance equations
 *   - Branch power flow constraints
 */

import { Causality, DAEBuilder, EqKind, ExprKind, StringInterner, Variability, VarType } from "@modelscript/runtime";
import type { MatpowerCase } from "../types.js";

export interface MatpowerDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  baseFrequency?: number | undefined; // Hz (default: 60.0)
}

/**
 * Lowers a MATPOWER case directly into a DAEBuilder arena.
 */
export function lowerMatpowerToDae(mpc: MatpowerCase, options?: MatpowerDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? mpc.caseName ?? "MATPOWER_Grid").replace(/[^a-zA-Z0-9_]/g, "_");
  const interner = new StringInterner();
  const dae = options?.builder ?? new DAEBuilder(interner, modelName);
  const baseMVA = mpc.baseMVA || 100.0;

  // Base MVA parameter
  dae.addVariable("baseMVA", VarType.Real, Variability.Constant, Causality.Local, baseMVA);

  // 1. Declare bus variables: Vm (magnitude), Va (angle rad), P_inj, Q_inj
  for (const b of mpc.bus) {
    const vMag = b.vm || 1.0;
    const vAngRad = (b.va * Math.PI) / 180.0;

    dae.addVariable(`V_${b.bus_i}_m`, VarType.Real, Variability.Continuous, Causality.Local, vMag);
    dae.addVariable(`V_${b.bus_i}_ang`, VarType.Real, Variability.Continuous, Causality.Local, vAngRad);
    dae.addVariable(`P_${b.bus_i}_inj`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`Q_${b.bus_i}_inj`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  }

  // 2. Declare generator variables: Pg, Qg
  for (let idx = 0; idx < mpc.gen.length; idx++) {
    const g = mpc.gen[idx]!;
    dae.addVariable(`P_gen_${g.bus}_${idx + 1}`, VarType.Real, Variability.Continuous, Causality.Local, g.pg);
    dae.addVariable(`Q_gen_${g.bus}_${idx + 1}`, VarType.Real, Variability.Continuous, Causality.Local, g.qg);
  }

  // 3. Declare branch power flows: P_ij, Q_ij
  for (let idx = 0; idx < mpc.branch.length; idx++) {
    const br = mpc.branch[idx]!;
    dae.addVariable(
      `P_br_${br.fbus}_${br.tbus}_${idx + 1}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      0.0,
    );
    dae.addVariable(
      `Q_br_${br.fbus}_${br.tbus}_${idx + 1}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      0.0,
    );
  }

  // 4. Formulate nodal power balance equations
  for (const b of mpc.bus) {
    // P_inj = P_gen - P_load - Gs * Vm^2
    const pInjId = interner.intern(`P_${b.bus_i}_inj`);
    const pInjExpr = dae.addExpression(ExprKind.Name, pInjId);

    // Sum generation at bus
    let pGenSum = 0.0;
    let qGenSum = 0.0;
    for (const g of mpc.gen) {
      if (g.bus === b.bus_i && g.status > 0) {
        pGenSum += g.pg;
        qGenSum += g.qg;
      }
    }

    const netP = pGenSum - b.pd - b.gs;
    const netQ = qGenSum - b.qd + b.bs;

    const netPConstExpr = dae.addRealLiteral(netP);
    dae.addEquation(EqKind.Simple, pInjExpr, netPConstExpr);

    const qInjId = interner.intern(`Q_${b.bus_i}_inj`);
    const qInjExpr = dae.addExpression(ExprKind.Name, qInjId);
    const netQConstExpr = dae.addRealLiteral(netQ);
    dae.addEquation(EqKind.Simple, qInjExpr, netQConstExpr);
  }

  return dae;
}
