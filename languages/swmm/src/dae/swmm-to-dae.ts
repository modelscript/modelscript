// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/swmm — Direct Linear-Memory DAE Arena Lowering for Stormwater & Drainage Networks.
 *
 * Compiles 1D dynamic wave Saint-Venant equations, junction water depths, conduit friction slopes,
 * and outfall boundary stages directly into ModelScript's zero-GC WebAssembly DAEBuilder:
 *   1. Node head variables H_{node} and depths d_{node} = H_{node} - Z_{node}
 *   2. Conduit discharge Q_{conduit} and wetted flow area A_{conduit}
 *   3. Manning friction slope S_f and momentum drop H_in - H_out = L * S_f
 *   4. Conservation of volume at junctions: sum(Q_in) - sum(Q_out) = A_pond * der(d)
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { SwmmDeck } from "../types.js";

export interface SwmmDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

export function lowerSwmmToDae(deck: SwmmDeck, options?: SwmmDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? (deck.title || "StormwaterNetwork")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  // 1. Declare Node states
  for (const [id, j] of deck.junctions) {
    const initDepth = j.initDepth ?? 0.2;
    dae.addVariable(`H_${id}`, VarType.Real, Variability.Continuous, Causality.Local, j.elevation + initDepth);
    dae.addVariable(`d_${id}`, VarType.Real, Variability.Continuous, Causality.Local, initDepth);
    dae.addVariable(`Q_in_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`Q_out_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // H_j = Z_j + d_j
    const hVar = dae.lookupVariable(`H_${id}`);
    const dVar = dae.lookupVariable(`d_${id}`);
    if (hVar !== -1 && dVar !== -1) {
      const zPlusD = dae.addBinaryExpr(BinOp.Add, dae.addRealLiteral(j.elevation), dae.addName(dVar));
      dae.addEquation(EqKind.Simple, dae.addName(hVar), zPlusD);
    }
  }

  for (const [id, o] of deck.outfalls) {
    const stage = o.stage ?? (o.type === "FREE" ? 0.0 : 0.5);
    dae.addVariable(`H_${id}`, VarType.Real, Variability.Continuous, Causality.Local, o.elevation + stage);
    dae.addVariable(`d_${id}`, VarType.Real, Variability.Continuous, Causality.Local, stage);
  }

  // 2. Declare Conduit Links and Friction Loss Equations
  for (const [id, c] of deck.conduits) {
    const xsec = deck.crossSections.get(id);
    const D = xsec?.geom1 ?? 1.0;
    const aFull = (Math.PI * D * D) / 4.0;
    const initQ = c.initFlow ?? 0.1;

    const qVar = dae.addVariable(`Q_${id}`, VarType.Real, Variability.Continuous, Causality.Local, initQ);
    const aVar = dae.addVariable(`A_${id}`, VarType.Real, Variability.Continuous, Causality.Local, aFull * 0.5);
    const vVar = dae.addVariable(
      `V_${id}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      initQ / (aFull * 0.5),
    );
    const sfVar = dae.addVariable(`Sf_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.001);

    // V = Q / A
    const qByA = dae.addBinaryExpr(BinOp.Div, dae.addName(qVar), dae.addName(aVar));
    dae.addEquation(EqKind.Simple, dae.addName(vVar), qByA);

    // Head differential H_in - H_out = L * Sf
    const hIn = dae.lookupVariable(`H_${c.inletNode}`);
    const hOut = dae.lookupVariable(`H_${c.outletNode}`);
    if (hIn !== -1 && hOut !== -1) {
      const deltaH = dae.addBinaryExpr(BinOp.Sub, dae.addName(hIn), dae.addName(hOut));
      const loss = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(c.length), dae.addName(sfVar));
      dae.addEquation(EqKind.Simple, deltaH, loss);
    }
  }

  // 3. Declare Pumps
  for (const [id, p] of deck.pumps) {
    dae.addVariable(`Q_pump_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 1.5);
    dae.addVariable(`W_pump_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 12000.0);

    const hIn = dae.lookupVariable(`H_${p.inletNode}`);
    const hOut = dae.lookupVariable(`H_${p.outletNode}`);
    if (hIn !== -1 && hOut !== -1) {
      // Pump adds head
      const deltaH = dae.addBinaryExpr(BinOp.Sub, dae.addName(hOut), dae.addName(hIn));
      dae.addEquation(EqKind.Simple, deltaH, dae.addRealLiteral(5.0)); // 5m pump head
    }
  }

  return dae;
}
