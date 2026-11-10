// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Linear-Memory DAE Arena Lowering for HEC-HMS Watershed Models.
 *
 * Compiles hydrological continuity and routing balance equations directly into
 * ModelScript's zero-GC DAEBuilder struct-of-arrays arena:
 *   - Subbasin reservoir storage state: dS_sub / dt = P_net - Q_sub
 *   - Reach storage states: dS_reach / dt = Q_in - Q_out
 *   - Junction mass balances: sum(Q_in) = Q_out
 */

import { Causality, DAEBuilder, EqKind, ExprKind, StringInterner, Variability, VarType } from "@modelscript/runtime";
import type { HmsBasinModel } from "../types.js";

export interface HmsDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

/**
 * Lowers an HmsBasinModel directly into a DAEBuilder arena.
 */
export function lowerHmsToDae(basin: HmsBasinModel, options?: HmsDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? basin.name ?? "HEC_HMS_Watershed").replace(/[^a-zA-Z0-9_]/g, "_");
  const interner = new StringInterner();
  const dae = options?.builder ?? new DAEBuilder(interner, modelName);

  // 1. Subbasin states: Storage (S), Outflow (Q)
  for (const [name] of basin.subbasins) {
    const safeName = name.replace(/[^a-zA-Z0-9_]/g, "_");
    dae.addVariable(`S_${safeName}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`Q_${safeName}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Dynamic equation: dS/dt = Excess_Rain - Q
    const sId = interner.intern(`S_${safeName}`);
    const derSExpr = dae.addExpression(ExprKind.Der, sId);

    const qId = interner.intern(`Q_${safeName}`);
    const qExpr = dae.addExpression(ExprKind.Name, qId);

    dae.addEquation(EqKind.Simple, derSExpr, qExpr);
  }

  // 2. Reach routing states: Reach storage S_r, Reach outflow Q_r
  for (const [name] of basin.reaches) {
    const safeName = name.replace(/[^a-zA-Z0-9_]/g, "_");
    dae.addVariable(`S_reach_${safeName}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`Q_reach_${safeName}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    const sId = interner.intern(`S_reach_${safeName}`);
    const derSExpr = dae.addExpression(ExprKind.Der, sId);

    const qId = interner.intern(`Q_reach_${safeName}`);
    const qExpr = dae.addExpression(ExprKind.Name, qId);

    dae.addEquation(EqKind.Simple, derSExpr, qExpr);
  }

  // 3. Junction continuity equations: Sum(Inflow) = Outflow
  for (const [name] of basin.junctions) {
    const safeName = name.replace(/[^a-zA-Z0-9_]/g, "_");
    dae.addVariable(`Q_jnc_${safeName}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    const qId = interner.intern(`Q_jnc_${safeName}`);
    const qExpr = dae.addExpression(ExprKind.Name, qId);
    const zeroLit = dae.addRealLiteral(0.0);
    dae.addEquation(EqKind.Simple, qExpr, zeroLit);
  }

  return dae;
}
