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

    // Eq 1: H_j = Z_j + d_j
    const hVar = dae.lookupVariable(`H_${id}`);
    const dVar = dae.lookupVariable(`d_${id}`);
    if (hVar !== -1 && dVar !== -1) {
      const zPlusD = dae.addBinaryExpr(BinOp.Add, dae.addRealLiteral(j.elevation), dae.addName(dVar));
      dae.addEquation(EqKind.Simple, dae.addName(hVar), zPlusD);
    }
  }

  for (const [id, o] of deck.outfalls) {
    const stage = o.stage ?? (o.type === "FREE" ? 0.0 : 0.5);
    const hVar = dae.addVariable(`H_${id}`, VarType.Real, Variability.Continuous, Causality.Local, o.elevation + stage);
    const dVar = dae.addVariable(`d_${id}`, VarType.Real, Variability.Continuous, Causality.Local, stage);

    // Outfall stage & head boundary equations (2 variables, 2 equations)
    dae.addEquation(EqKind.Simple, dae.addName(dVar), dae.addRealLiteral(stage));
    const zPlusD = dae.addBinaryExpr(BinOp.Add, dae.addRealLiteral(o.elevation), dae.addName(dVar));
    dae.addEquation(EqKind.Simple, dae.addName(hVar), zPlusD);
  }

  // 2. Declare Conduit Links and Friction Loss Equations (4 variables, 4 equations per conduit)
  for (const [id, c] of deck.conduits) {
    const xsec = deck.crossSections.get(id);
    const D = Math.max(0.1, xsec?.geom1 ?? 1.0);
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

    // Eq 1: Wetted cross-sectional area A_id = 0.785 * D * d_inlet (or nominal half-full area)
    const dInVar = dae.lookupVariable(`d_${c.inletNode}`);
    if (dInVar !== -1) {
      const areaExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.785 * D), dae.addName(dInVar));
      dae.addEquation(EqKind.Simple, dae.addName(aVar), areaExpr);
    } else {
      dae.addEquation(EqKind.Simple, dae.addName(aVar), dae.addRealLiteral(aFull * 0.5));
    }

    // Eq 2: Velocity V = Q / A
    const qByA = dae.addBinaryExpr(BinOp.Div, dae.addName(qVar), dae.addName(aVar));
    dae.addEquation(EqKind.Simple, dae.addName(vVar), qByA);

    // Eq 3: Manning friction slope Sf = (n^2 / R_h^(4/3)) * V^2
    const nManning = Math.max(0.001, c.roughness);
    const rHyd = D / 4.0;
    const manningCoeff = (nManning * nManning) / Math.pow(rHyd, 4.0 / 3.0);
    const vSq = dae.addBinaryExpr(BinOp.Mul, dae.addName(vVar), dae.addName(vVar));
    const sfRhs = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(manningCoeff), vSq);
    dae.addEquation(EqKind.Simple, dae.addName(sfVar), sfRhs);

    // Eq 4: Head differential H_in - H_out = L * Sf
    const hIn = dae.lookupVariable(`H_${c.inletNode}`);
    const hOut = dae.lookupVariable(`H_${c.outletNode}`);
    if (hIn !== -1 && hOut !== -1) {
      const deltaH = dae.addBinaryExpr(BinOp.Sub, dae.addName(hIn), dae.addName(hOut));
      const loss = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(c.length), dae.addName(sfVar));
      dae.addEquation(EqKind.Simple, deltaH, loss);
    } else {
      dae.addEquation(EqKind.Simple, dae.addName(qVar), dae.addRealLiteral(initQ));
    }
  }

  // 3. Declare Pumps (2 variables, 2 equations per pump)
  for (const [id, p] of deck.pumps) {
    const qPumpVar = dae.addVariable(`Q_pump_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 1.5);
    const wPumpVar = dae.addVariable(`W_pump_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 12000.0);

    const hIn = dae.lookupVariable(`H_${p.inletNode}`);
    const hOut = dae.lookupVariable(`H_${p.outletNode}`);
    if (hIn !== -1 && hOut !== -1) {
      // Eq 1: Pump characteristic H_out - H_in = 5.0 - 0.5 * Q_pump
      const deltaH = dae.addBinaryExpr(BinOp.Sub, dae.addName(hOut), dae.addName(hIn));
      const qTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.5), dae.addName(qPumpVar));
      const pumpCurveRhs = dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(5.0), qTerm);
      dae.addEquation(EqKind.Simple, deltaH, pumpCurveRhs);
    } else {
      dae.addEquation(EqKind.Simple, dae.addName(qPumpVar), dae.addRealLiteral(1.5));
    }
    // Eq 2: Hydraulic power W_pump = rho * g * H_nom * Q_pump
    const powerRhs = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(9810.0 * 5.0), dae.addName(qPumpVar));
    dae.addEquation(EqKind.Simple, dae.addName(wPumpVar), powerRhs);
  }

  // 4. Junction Continuity & Volume Conservation Equations (remaining 3 equations per junction: Q_in, Q_out, der(d))
  for (const [id, j] of deck.junctions) {
    const dVar = dae.lookupVariable(`d_${id}`);
    const qInVar = dae.lookupVariable(`Q_in_${id}`);
    const qOutVar = dae.lookupVariable(`Q_out_${id}`);
    if (dVar === -1 || qInVar === -1 || qOutVar === -1) continue;

    // Surface runoff inflow from subcatchments draining to this junction
    let runoffInflow = 0.0;
    for (const [, sc] of deck.subcatchments) {
      if (sc.outlet === id) {
        runoffInflow += sc.area * (sc.impervPct / 100.0) * 0.05;
      }
    }

    let qInExpr = dae.addRealLiteral(runoffInflow);
    let qOutExpr = dae.addRealLiteral(0.0);

    for (const [cId, c] of deck.conduits) {
      const qConduit = dae.lookupVariable(`Q_${cId}`);
      if (qConduit === -1) continue;
      if (c.outletNode === id) {
        qInExpr = dae.addBinaryExpr(BinOp.Add, qInExpr, dae.addName(qConduit));
      }
      if (c.inletNode === id) {
        qOutExpr = dae.addBinaryExpr(BinOp.Add, qOutExpr, dae.addName(qConduit));
      }
    }

    for (const [pId, p] of deck.pumps) {
      const qPump = dae.lookupVariable(`Q_pump_${pId}`);
      if (qPump === -1) continue;
      if (p.outletNode === id) {
        qInExpr = dae.addBinaryExpr(BinOp.Add, qInExpr, dae.addName(qPump));
      }
      if (p.inletNode === id) {
        qOutExpr = dae.addBinaryExpr(BinOp.Add, qOutExpr, dae.addName(qPump));
      }
    }

    // Eq 2: Q_in_id = sum(Q_entering) + runoff
    dae.addEquation(EqKind.Simple, dae.addName(qInVar), qInExpr);

    // Eq 3: Q_out_id = sum(Q_leaving)
    dae.addEquation(EqKind.Simple, dae.addName(qOutVar), qOutExpr);

    // Eq 4: A_pond * der(d_id) = Q_in_id - Q_out_id
    const aPond = Math.max(1.0, j.aPond && j.aPond > 0 ? j.aPond : 10.0);
    const netQ = dae.addBinaryExpr(BinOp.Sub, dae.addName(qInVar), dae.addName(qOutVar));
    const derD = dae.addDer(dVar);
    const rhsDer = dae.addBinaryExpr(BinOp.Div, netQ, dae.addRealLiteral(aPond));
    dae.addEquation(EqKind.Simple, derD, rhsDer);
  }

  return dae;
}
