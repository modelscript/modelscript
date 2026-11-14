// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { solveBiogas } from "../solver/index.js";
import type { LandgemModel } from "../types.js";

/**
 * Lowers a LandGEM landfill and anaerobic digester model into an executable
 * WebAssembly DAE arena featuring first-order waste methane decay ODEs and
 * continuous-flow stirred-tank reactor (CSTR) substrate degradation dynamics.
 */
export function lowerLandgemToDae(model: LandgemModel, arenaTitle?: string): DAEBuilder {
  const arena = new DAEBuilder(undefined, arenaTitle || "Landgem_Biogas_Arena");
  if (model.sites.length === 0 && model.digesters.length === 0) {
    return arena;
  }

  const summary = solveBiogas(model);

  // 1. First-order LandGEM anaerobic waste decomposition ODEs per site
  for (let i = 0; i < model.sites.length; i++) {
    const site = model.sites[i]!;
    const siteSummary = model.sites.length === 1 && i === 0 ? summary : solveBiogas({ sites: [site], digesters: [] });

    const k = Math.max(site.params.k, 1e-4);
    const firstPositiveQ =
      siteSummary.annualLfg.find((r) => r.methaneM3PerYear > 0)?.methaneM3PerYear ?? siteSummary.peakMethaneM3PerYear;
    const q0 = Math.max(siteSummary.peakMethaneM3PerYear || firstPositiveQ, 1.0);
    const mPot0 = q0 / k;

    // Remaining methane generation potential M_pot [m^3]: der(M_pot) = -k * M_pot
    const potVar = `M_pot_${site.name}`;
    arena.addVariable(potVar, VarType.Real, Variability.Continuous, Causality.Local, mPot0);
    arena.addEquation(
      EqKind.Simple,
      arena.addDerExpr(arena.addNameExpr(potVar)),
      arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(-k), arena.addNameExpr(potVar)),
    );

    // Methane generation rate Q_CH4 [m^3/yr] = k * M_pot
    const ch4Var = `Q_CH4_${site.name}`;
    arena.addVariable(ch4Var, VarType.Real, Variability.Continuous, Causality.Local, q0);
    arena.addEquation(
      EqKind.Simple,
      arena.addNameExpr(ch4Var),
      arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(k), arena.addNameExpr(potVar)),
    );

    // LFG electrical power potential P_LFG_MW [MW] = Q_CH4 * 4.19e-7
    const pVar = `P_LFG_MW_${site.name}`;
    arena.addVariable(pVar, VarType.Real, Variability.Continuous, Causality.Local, q0 * 4.19e-7);
    arena.addEquation(
      EqKind.Simple,
      arena.addNameExpr(pVar),
      arena.addBinaryExpr(BinOp.Mul, arena.addNameExpr(ch4Var), arena.addRealLiteral(4.19e-7)),
    );

    // Cumulative methane recovery V_CH4_cum [m^3]: der(V_CH4_cum) = Q_CH4
    const cumVar = `V_CH4_cum_${site.name}`;
    arena.addVariable(cumVar, VarType.Real, Variability.Continuous, Causality.Local, q0);
    arena.addEquation(EqKind.Simple, arena.addDerExpr(arena.addNameExpr(cumVar)), arena.addNameExpr(ch4Var));
  }

  // 2. Dynamic CSTR COD degradation and biogas CHP balances per anaerobic digester
  for (let i = 0; i < model.digesters.length; i++) {
    const dig = model.digesters[i]!;
    const digRes = summary.digesters[i];

    const tauHrt = Math.max(dig.hrtDays, 1.0);
    const eff = Math.min(Math.max(dig.codRemovalEfficiency ?? 0.7, 0.05), 0.98);
    const sFeed = Math.max(dig.feedCodGL, 0.1);
    const sSteady = sFeed * (1.0 - eff);
    const kDeg = eff / ((1.0 - eff) * tauHrt);
    const gasYieldPerKgCod = (0.35 * ((273.15 + dig.temperatureC) / 273.15)) / 0.65;
    const biogasCoeff = gasYieldPerKgCod * dig.volumeM3 * kDeg;

    const qBiogasStart = digRes ? digRes.dailyBiogasM3 : biogasCoeff * sSteady;
    const pElecStart = digRes ? digRes.electricalPowerKW : qBiogasStart * ((0.65 * 10.0 * 0.38) / 24.0);
    const pThermStart = digRes ? digRes.thermalPowerKW : qBiogasStart * ((0.65 * 10.0 * 0.45) / 24.0);

    // Reactor substrate COD concentration [g/L]: der(S_cod) = (S_feed - S_cod) / HRT - k_deg * S_cod
    const codVar = `S_cod_${dig.name}`;
    arena.addVariable(codVar, VarType.Real, Variability.Continuous, Causality.Local, sSteady);
    const dilutionTerm = arena.addBinaryExpr(
      BinOp.Div,
      arena.addBinaryExpr(BinOp.Sub, arena.addRealLiteral(sFeed), arena.addNameExpr(codVar)),
      arena.addRealLiteral(tauHrt),
    );
    const uptakeTerm = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(kDeg), arena.addNameExpr(codVar));
    arena.addEquation(
      EqKind.Simple,
      arena.addDerExpr(arena.addNameExpr(codVar)),
      arena.addBinaryExpr(BinOp.Sub, dilutionTerm, uptakeTerm),
    );

    // Biogas production rate [m^3/day] = biogasCoeff * S_cod
    const qVar = `Q_biogas_${dig.name}`;
    arena.addVariable(qVar, VarType.Real, Variability.Continuous, Causality.Local, qBiogasStart);
    arena.addEquation(
      EqKind.Simple,
      arena.addNameExpr(qVar),
      arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(biogasCoeff), arena.addNameExpr(codVar)),
    );

    // CHP electrical power output [kW]
    const peVar = `P_elec_kW_${dig.name}`;
    arena.addVariable(peVar, VarType.Real, Variability.Continuous, Causality.Local, pElecStart);
    arena.addEquation(
      EqKind.Simple,
      arena.addNameExpr(peVar),
      arena.addBinaryExpr(BinOp.Mul, arena.addNameExpr(qVar), arena.addRealLiteral((0.65 * 10.0 * 0.38) / 24.0)),
    );

    // CHP thermal power output [kW]
    const ptVar = `P_thermal_kW_${dig.name}`;
    arena.addVariable(ptVar, VarType.Real, Variability.Continuous, Causality.Local, pThermStart);
    arena.addEquation(
      EqKind.Simple,
      arena.addNameExpr(ptVar),
      arena.addBinaryExpr(BinOp.Mul, arena.addNameExpr(qVar), arena.addRealLiteral((0.65 * 10.0 * 0.45) / 24.0)),
    );
  }

  return arena;
}
