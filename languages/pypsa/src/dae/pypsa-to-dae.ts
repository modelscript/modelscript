// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pypsa — Direct Linear-Memory DAE Arena Lowering for PyPSA Networks.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { PypsaNetwork } from "../types.js";

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function lowerPypsaToDae(net: PypsaNetwork, builder?: DAEBuilder): DAEBuilder {
  const dae = builder ?? new DAEBuilder(undefined, sanitize(net.name || "PypsaNetwork"));
  const baseMva = net.baseMva || 100.0;

  const busFlows = new Map<string, { exprId: number; isLeaving: boolean }[]>();
  const busGenMw = new Map<string, number>();
  const busLoadMw = new Map<string, number>();

  for (let i = 0; i < net.buses.length; i++) {
    const bus = net.buses[i]!;
    const id = sanitize(bus.name);
    const thVar = dae.addVariable(`theta_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`P_inj_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    busFlows.set(bus.name, []);
    busGenMw.set(bus.name, 0.0);
    busLoadMw.set(bus.name, 0.0);

    // Pin first bus as reference angle
    if (i === 0 && thVar !== -1) {
      dae.addEquation(EqKind.Simple, dae.addName(thVar), dae.addRealLiteral(0.0));
    }
  }

  for (const gen of net.generators) {
    busGenMw.set(gen.bus, (busGenMw.get(gen.bus) ?? 0) + gen.p_nom * gen.p_max_pu);
  }
  for (const load of net.loads) {
    busLoadMw.set(load.bus, (busLoadMw.get(load.bus) ?? 0) + load.p_set);
  }

  for (const line of net.lines) {
    const th0 = dae.lookupVariable(`theta_${sanitize(line.bus0)}`);
    const th1 = dae.lookupVariable(`theta_${sanitize(line.bus1)}`);
    if (th0 === -1 || th1 === -1) continue;

    const pVar = dae.addVariable(
      `P_line_${sanitize(line.name)}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      0.0,
    );
    if (pVar === -1) continue;

    const vNom = net.busByName.get(line.bus0)?.v_nom ?? 110;
    const zBase = (vNom * vNom) / baseMva;
    const xPu = Math.max(1e-5, line.x / Math.max(1e-3, zBase));
    const bSeries = baseMva / xPu;

    const diff = dae.addBinaryExpr(BinOp.Sub, dae.addName(th0), dae.addName(th1));
    dae.addEquation(EqKind.Simple, dae.addName(pVar), dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(bSeries), diff));

    busFlows.get(line.bus0)?.push({ exprId: dae.addName(pVar), isLeaving: true });
    busFlows.get(line.bus1)?.push({ exprId: dae.addName(pVar), isLeaving: false });
  }

  for (const link of net.links) {
    const pVar = dae.addVariable(
      `P_link_${sanitize(link.name)}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      link.p_nom * 0.5,
    );
    if (pVar === -1) continue;
    busFlows.get(link.bus0)?.push({ exprId: dae.addName(pVar), isLeaving: true });
    const delivered = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(link.efficiency), dae.addName(pVar));
    busFlows.get(link.bus1)?.push({ exprId: delivered, isLeaving: false });
  }

  for (const st of net.storageUnits) {
    const id = sanitize(st.name);
    const eVar = dae.addVariable(
      `E_stor_${id}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      st.p_nom * st.max_hours * 0.5,
    );
    const pChg = dae.addVariable(`P_chg_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const pDis = dae.addVariable(`P_dis_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    if (eVar !== -1 && pChg !== -1 && pDis !== -1) {
      // der(E) = eta_in * P_chg - P_dis / eta_out - loss * E
      const inTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(st.efficiency_store), dae.addName(pChg));
      const outTerm = dae.addBinaryExpr(BinOp.Div, dae.addName(pDis), dae.addRealLiteral(st.efficiency_dispatch));
      const lossTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(st.standing_loss), dae.addName(eVar));
      const rhs = dae.addBinaryExpr(BinOp.Sub, dae.addBinaryExpr(BinOp.Sub, inTerm, outTerm), lossTerm);
      dae.addEquation(EqKind.Simple, dae.addDer(eVar), rhs);
    }
  }

  for (let i = 0; i < net.buses.length; i++) {
    const bus = net.buses[i]!;
    const pInjVar = dae.lookupVariable(`P_inj_${sanitize(bus.name)}`);
    if (pInjVar === -1) continue;

    const flows = busFlows.get(bus.name) ?? [];
    let sumExpr: number | null = null;
    for (const f of flows) {
      if (sumExpr === null) {
        sumExpr = f.isLeaving ? f.exprId : dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), f.exprId);
      } else {
        sumExpr = dae.addBinaryExpr(f.isLeaving ? BinOp.Add : BinOp.Sub, sumExpr, f.exprId);
      }
    }
    dae.addEquation(EqKind.Simple, dae.addName(pInjVar), sumExpr ?? dae.addRealLiteral(0.0));

    if (i > 0) {
      const netMw = (busGenMw.get(bus.name) ?? 0) - (busLoadMw.get(bus.name) ?? 0);
      dae.addEquation(EqKind.Simple, dae.addName(pInjVar), dae.addRealLiteral(netMw));
    }
  }

  return dae;
}
