// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects a USACE HEC-1 card deck into an executable Modelica (`.mo`) model
 * containing watershed linear-reservoir ODEs, Muskingum channel routing ODEs,
 * and hydrograph combine balances.
 */

import type { Hec1Deck } from "../types.js";

export interface Hec1ToModelicaOptions {
  modelName?: string | undefined;
}

function sanitizeIdent(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `S_${cleaned}`;
}

/**
 * Generates Modelica `.mo` source code representing the watershed ODE system
 * defined by a USACE HEC-1 card deck.
 */
export function hec1ToModelica(deck: Hec1Deck, options?: Hec1ToModelicaOptions): string {
  const rawName = options?.modelName ?? deck.titleLines[0] ?? "HEC1_Watershed";
  const modelName = sanitizeIdent(rawName);

  const decls: string[] = [];
  const eqs: string[] = [];
  const flowStack: string[] = [];

  for (const st of deck.stationList) {
    const id = sanitizeIdent(st.id);

    if (st.kind === "subbasin") {
      const area = st.area && st.area > 0 ? st.area : 1.0;
      const cn = st.loss?.method === "SCS" && Number.isFinite(st.loss.curveNumber) ? st.loss.curveNumber : 75.0;
      const r =
        st.unitHydrograph?.method === "Clark"
          ? Math.max(1e-3, st.unitHydrograph.r)
          : st.unitHydrograph?.method === "SCS"
            ? Math.max(1e-3, st.unitHydrograph.tlag)
            : st.unitHydrograph?.method === "Snyder"
              ? Math.max(1e-3, st.unitHydrograph.tp)
              : 1.0;
      const bf = st.baseflow ? Math.max(0.0, st.baseflow.strtq) : 0.0;

      decls.push(`  // Subbasin ${st.id}`);
      decls.push(`  parameter Real A_${id} = ${area};`);
      decls.push(`  parameter Real CN_${id} = ${cn};`);
      decls.push(`  parameter Real R_${id} = ${r};`);
      decls.push(`  input Real P_net_${id}(start = 0.0);`);
      decls.push(`  Real S_${id}(start = 0.0);`);
      decls.push(`  Real Q_${id}(start = ${bf});`);

      eqs.push(`  // Subbasin ${st.id} storage continuity & linear reservoir outflow`);
      eqs.push(`  der(S_${id}) = P_net_${id} - Q_${id};`);
      eqs.push(bf > 0 ? `  Q_${id} = S_${id} / R_${id} + ${bf};` : `  Q_${id} = S_${id} / R_${id};`);

      flowStack.push(`Q_${id}`);
    } else if (st.kind === "route") {
      const qIn = flowStack.pop() ?? `Q_in_${id}`;
      const k = st.muskingum && st.muskingum.amskk > 0 ? st.muskingum.amskk : 1.0;
      const x = st.muskingum && Number.isFinite(st.muskingum.x) ? Math.max(0.0, Math.min(0.5, st.muskingum.x)) : 0.2;

      decls.push(`  // Muskingum Reach ${st.id}`);
      decls.push(`  parameter Real K_${id} = ${k};`);
      decls.push(`  parameter Real X_${id} = ${x};`);
      decls.push(`  Real S_reach_${id}(start = 0.0);`);
      decls.push(`  Real Q_${id}(start = 0.0);`);

      eqs.push(`  // Reach ${st.id} Muskingum routing ODE`);
      eqs.push(`  der(S_reach_${id}) = ${qIn} - Q_${id};`);
      eqs.push(`  S_reach_${id} = K_${id} * (X_${id} * ${qIn} + (1.0 - X_${id}) * Q_${id});`);

      flowStack.push(`Q_${id}`);
    } else if (st.kind === "combine") {
      const count = Math.max(2, st.combineCount ?? 2);
      const popped: string[] = [];
      for (let k = 0; k < count && flowStack.length > 0; k++) {
        popped.push(flowStack.pop()!);
      }
      decls.push(`  // Combine Junction ${st.id}`);
      decls.push(`  Real Q_${id}(start = 0.0);`);
      eqs.push(`  // Hydrograph combine ${st.id}`);
      eqs.push(`  Q_${id} = ${popped.length > 0 ? popped.join(" + ") : "0.0"};`);
      flowStack.push(`Q_${id}`);
    }
  }

  return [
    `model ${modelName}`,
    `  // Projected from USACE HEC-1 card deck`,
    ...decls,
    `equation`,
    ...eqs,
    `end ${modelName};`,
    ``,
  ].join("\n");
}
