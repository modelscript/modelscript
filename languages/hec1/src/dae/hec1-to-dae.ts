// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Linear-Memory DAE Arena Lowering for USACE HEC-1 Watershed Models.
 *
 * Compiles watershed linear-reservoir runoff ODEs, Muskingum channel routing
 * ODEs, and hydrograph combine mass balances directly into `@modelscript/runtime`'s
 * zero-GC `DAEBuilder` struct-of-arrays arena without intermediate AST wrappers:
 *   - Subbasin storage ODE:   der(S_sub) = P_net - Q_sub,   Q_sub = S_sub / R + Q_bf
 *   - Muskingum routing ODE:  der(S_reach) = Q_in - Q_out,  S_reach = K * (X * Q_in + (1 - X) * Q_out)
 *   - Hydrograph combine:     Q_comb = sum(Q_up_k)
 */

import { BinOp, Causality, DAEBuilder, EqKind, type IDaeBuilder, Variability, VarType } from "@modelscript/runtime";
import type { Hec1Deck } from "../types.js";

export interface Hec1DaeOptions {
  modelName?: string | undefined;
  builder?: DAEBuilder | undefined;
}

export interface Hec1DaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

function sanitizeIdent(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `S_${cleaned}`;
}

/**
 * Lowers a parsed `Hec1Deck` directly into an `IDaeBuilder` arena.
 */
export function lowerHec1ToDae(builder: IDaeBuilder, deck: Hec1Deck): Hec1DaeLoweringResult {
  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;

  function addVar(
    name: string,
    variability: Variability = Variability.Continuous,
    causality: Causality = Causality.Local,
    startVal = 0.0,
  ): number {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const idx = builder.addVariable(name, VarType.Real, variability, causality, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  // HEC-1 hydrograph stack of outflow variable indices
  const flowStack: number[] = [];

  for (const st of deck.stationList) {
    const safeId = sanitizeIdent(st.id);

    if (st.kind === "subbasin") {
      const area = st.area && st.area > 0 ? st.area : 1.0;
      const cn = st.loss?.method === "SCS" && Number.isFinite(st.loss.curveNumber) ? st.loss.curveNumber : 75.0;
      const storageCoeff =
        st.unitHydrograph?.method === "Clark"
          ? Math.max(1e-3, st.unitHydrograph.r)
          : st.unitHydrograph?.method === "SCS"
            ? Math.max(1e-3, st.unitHydrograph.tlag)
            : st.unitHydrograph?.method === "Snyder"
              ? Math.max(1e-3, st.unitHydrograph.tp)
              : 1.0;
      const baseflow = st.baseflow ? Math.max(0.0, st.baseflow.strtq) : 0.0;

      addVar(`A_${safeId}`, Variability.Parameter, Causality.Local, area);
      addVar(`CN_${safeId}`, Variability.Parameter, Causality.Local, cn);
      const rParam = addVar(`R_${safeId}`, Variability.Parameter, Causality.Local, storageCoeff);

      const sVar = addVar(`S_${safeId}`, Variability.Continuous, Causality.Local, 0.0);
      const qVar = addVar(`Q_${safeId}`, Variability.Continuous, Causality.Local, baseflow);
      const pNetVar = addVar(`P_net_${safeId}`, Variability.Continuous, Causality.Input, 0.0);
      stateVarIndices.push(sVar);

      // ODE: der(S) = P_net - Q
      const derS = builder.addDer(sVar);
      const netFlow = builder.addBinaryExpr(BinOp.Sub, builder.addName(pNetVar), builder.addName(qVar));
      builder.addEquation(EqKind.Simple, derS, netFlow);
      equationCount++;

      // Linear reservoir outflow: Q = S / R (+ baseflow)
      const sOverR = builder.addBinaryExpr(BinOp.Div, builder.addName(sVar), builder.addName(rParam));
      const qRhs = baseflow > 0 ? builder.addBinaryExpr(BinOp.Add, sOverR, builder.addRealLiteral(baseflow)) : sOverR;
      builder.addEquation(EqKind.Simple, builder.addName(qVar), qRhs);
      equationCount++;

      flowStack.push(qVar);
    } else if (st.kind === "route") {
      const upstreamQ = flowStack.pop() ?? addVar(`Q_in_${safeId}`, Variability.Continuous, Causality.Input, 0.0);
      const kVal = st.muskingum && st.muskingum.amskk > 0 ? st.muskingum.amskk : 1.0;
      const xVal = st.muskingum && Number.isFinite(st.muskingum.x) ? Math.max(0.0, Math.min(0.5, st.muskingum.x)) : 0.2;

      const kParam = addVar(`K_${safeId}`, Variability.Parameter, Causality.Local, kVal);
      const xParam = addVar(`X_${safeId}`, Variability.Parameter, Causality.Local, xVal);

      const sReachVar = addVar(`S_reach_${safeId}`, Variability.Continuous, Causality.Local, 0.0);
      const qOutVar = addVar(`Q_${safeId}`, Variability.Continuous, Causality.Local, 0.0);
      stateVarIndices.push(sReachVar);

      // Continuity ODE: der(S_reach) = Q_in - Q_out
      const derS = builder.addDer(sReachVar);
      const netFlow = builder.addBinaryExpr(BinOp.Sub, builder.addName(upstreamQ), builder.addName(qOutVar));
      builder.addEquation(EqKind.Simple, derS, netFlow);
      equationCount++;

      // Muskingum storage equation: S_reach = K * (X * Q_in + (1 - X) * Q_out)
      const xQin = builder.addBinaryExpr(BinOp.Mul, builder.addName(xParam), builder.addName(upstreamQ));
      const oneMinusX = builder.addBinaryExpr(BinOp.Sub, builder.addRealLiteral(1.0), builder.addName(xParam));
      const oneMinusXQout = builder.addBinaryExpr(BinOp.Mul, oneMinusX, builder.addName(qOutVar));
      const weightedQ = builder.addBinaryExpr(BinOp.Add, xQin, oneMinusXQout);
      const storageRhs = builder.addBinaryExpr(BinOp.Mul, builder.addName(kParam), weightedQ);
      builder.addEquation(EqKind.Simple, builder.addName(sReachVar), storageRhs);
      equationCount++;

      flowStack.push(qOutVar);
    } else if (st.kind === "combine") {
      const count = Math.max(2, st.combineCount ?? 2);
      const popped: number[] = [];
      for (let k = 0; k < count && flowStack.length > 0; k++) {
        popped.push(flowStack.pop()!);
      }
      const qCombVar = addVar(`Q_${safeId}`, Variability.Continuous, Causality.Local, 0.0);

      if (popped.length === 0) {
        builder.addEquation(EqKind.Simple, builder.addName(qCombVar), builder.addRealLiteral(0.0));
      } else {
        let sumExpr = builder.addName(popped[0]!);
        for (let k = 1; k < popped.length; k++) {
          sumExpr = builder.addBinaryExpr(BinOp.Add, sumExpr, builder.addName(popped[k]!));
        }
        builder.addEquation(EqKind.Simple, builder.addName(qCombVar), sumExpr);
      }
      equationCount++;
      flowStack.push(qCombVar);
    }
  }

  return {
    stateVarIndices,
    equationCount,
    variableMap,
  };
}

/**
 * Convenience wrapper that creates a `DAEBuilder` and lowers an `Hec1Deck` into it.
 */
export function hec1ToDae(deck: Hec1Deck, options?: Hec1DaeOptions): DAEBuilder {
  const defaultTitle = deck.titleLines[0] ?? "HEC1_Watershed";
  const modelName = sanitizeIdent(options?.modelName ?? defaultTitle);
  const builder = options?.builder ?? new DAEBuilder(undefined, modelName);
  lowerHec1ToDae(builder, deck);
  return builder;
}
