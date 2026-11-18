// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/powerworld — Direct Linear-Memory DAE Arena Lowering for PowerWorld (.aux).
 *
 * Lowers PowerWorld Bus, Branch, Gen, Load, and Shunt records into ModelScript's
 * zero-GC DAEBuilder (per-unit DC/AC power-balance & branch flow equations on 100 MVA base).
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { PowerWorldAuxModel } from "../types.js";

export interface PowerWorldDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  baseMva?: number | undefined;
}

/**
 * Lower a PowerWorldAuxModel into a linear-memory DAEBuilder arena.
 */
export function lowerPowerWorldToDae(model: PowerWorldAuxModel, options?: PowerWorldDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? "PowerWorldGrid").replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);
  const baseMva = options?.baseMva ?? 100.0;

  const busBranchFlows = new Map<number, { exprId: number; isLeaving: boolean }[]>();
  const busNetGenPu = new Map<number, number>();
  const busNetLoadPu = new Map<number, number>();

  for (const bus of model.buses) {
    const vVar = dae.addVariable(
      `V_bus_${bus.busNum}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      bus.puVolt,
    );
    const thVar = dae.addVariable(
      `theta_bus_${bus.busNum}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      (bus.angleDeg * Math.PI) / 180.0,
    );
    dae.addVariable(`P_inj_bus_${bus.busNum}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    busBranchFlows.set(bus.busNum, []);
    busNetGenPu.set(bus.busNum, 0.0);
    busNetLoadPu.set(bus.busNum, 0.0);

    if (bus.isSlack && vVar !== -1 && thVar !== -1) {
      dae.addEquation(EqKind.Simple, dae.addName(vVar), dae.addRealLiteral(bus.puVolt));
      dae.addEquation(EqKind.Simple, dae.addName(thVar), dae.addRealLiteral((bus.angleDeg * Math.PI) / 180.0));
    }
  }

  for (const gen of model.generators) {
    if (gen.status === "Open") continue;
    const prev = busNetGenPu.get(gen.busNum) ?? 0.0;
    busNetGenPu.set(gen.busNum, prev + gen.mw / baseMva);
  }

  for (const load of model.loads) {
    if (load.status === "Open") continue;
    const prev = busNetLoadPu.get(load.busNum) ?? 0.0;
    busNetLoadPu.set(load.busNum, prev + load.mw / baseMva);
  }

  for (const shunt of model.shunts) {
    if (shunt.status === "Open") continue;
    const prev = busNetLoadPu.get(shunt.busNum) ?? 0.0;
    busNetLoadPu.set(shunt.busNum, prev + shunt.mw / baseMva);
  }

  // Branch active-power flow equations: P_br = ((theta_from - theta_to - phi) / x_pu)
  let brIdx = 0;
  for (const br of model.branches) {
    brIdx++;
    const thFrom = dae.lookupVariable(`theta_bus_${br.fromBus}`);
    const thTo = dae.lookupVariable(`theta_bus_${br.toBus}`);
    if (thFrom === -1 || thTo === -1) continue;

    const cktSafe = br.circuit.replace(/[^a-zA-Z0-9_]/g, "_");
    const pBrVar = dae.addVariable(
      `P_br_${br.fromBus}_${br.toBus}_${cktSafe}_${brIdx}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      0.0,
    );
    if (pBrVar === -1) continue;

    if (br.status === "Open") {
      dae.addEquation(EqKind.Simple, dae.addName(pBrVar), dae.addRealLiteral(0.0));
    } else {
      const xSafe = Math.abs(br.xPu) > 1e-6 ? br.xPu : 1e-3;
      const bSeries = 1.0 / (xSafe * (br.tapRatio > 0 ? br.tapRatio : 1.0));
      const phiRad = (br.phaseShiftDeg * Math.PI) / 180.0;
      let angleDiff = dae.addBinaryExpr(BinOp.Sub, dae.addName(thFrom), dae.addName(thTo));
      if (phiRad !== 0) {
        angleDiff = dae.addBinaryExpr(BinOp.Sub, angleDiff, dae.addRealLiteral(phiRad));
      }
      const rhs = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(bSeries), angleDiff);
      dae.addEquation(EqKind.Simple, dae.addName(pBrVar), rhs);
    }

    busBranchFlows.get(br.fromBus)?.push({ exprId: dae.addName(pBrVar), isLeaving: true });
    busBranchFlows.get(br.toBus)?.push({ exprId: dae.addName(pBrVar), isLeaving: false });
  }

  // Nodal active power balance: P_inj = P_gen - P_load = sum(P_leaving) - sum(P_entering)
  for (const bus of model.buses) {
    const pInjVar = dae.lookupVariable(`P_inj_bus_${bus.busNum}`);
    if (pInjVar === -1) continue;

    const pNetPu = (busNetGenPu.get(bus.busNum) ?? 0.0) - (busNetLoadPu.get(bus.busNum) ?? 0.0);
    const flows = busBranchFlows.get(bus.busNum) ?? [];

    let flowSum: number | null = null;
    for (const f of flows) {
      if (flowSum === null) {
        flowSum = f.isLeaving ? f.exprId : dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), f.exprId);
      } else {
        flowSum = dae.addBinaryExpr(f.isLeaving ? BinOp.Add : BinOp.Sub, flowSum, f.exprId);
      }
    }

    if (flowSum !== null) {
      dae.addEquation(EqKind.Simple, dae.addName(pInjVar), flowSum);
    } else {
      dae.addEquation(EqKind.Simple, dae.addName(pInjVar), dae.addRealLiteral(0.0));
    }

    if (!bus.isSlack) {
      dae.addEquation(EqKind.Simple, dae.addName(pInjVar), dae.addRealLiteral(pNetPu));
    }
  }

  return dae;
}
