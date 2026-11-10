// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { solveBiogas } from "../solver/index.js";
import type { LandgemModel } from "../types.js";

/**
 * Lowers LandGEM methane generation curves and ADM1 anaerobic digester mass balances
 * directly into ModelScript's zero-overhead DAEBuilder linear arena.
 */
export function lowerLandgemToDae(model: LandgemModel, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? (model.sites[0]?.name ? `LandGEM_${model.sites[0].name}` : "Biogas_RNG_System");
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const summary = solveBiogas(model);

  // 1. Landfill Methane Variables and Equations
  if (model.sites.length > 0) {
    const site = model.sites[0]!;
    const cleanSite = site.name.replace(/[^a-zA-Z0-9_]/g, "_");

    // Peak Methane generation
    const qMethaneName = `Q_CH4_${cleanSite}`;
    const qMethaneId = interner.intern(qMethaneName);
    arena.addVariable(
      qMethaneName,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      summary.peakMethaneM3PerYear,
    );
    const qMethaneExpr = arena.addExpression(ExprKind.Name, qMethaneId);

    // Initial value equation
    const qMethaneLit = arena.addRealLiteral(summary.peakMethaneM3PerYear);
    arena.addEquation(EqKind.Simple, qMethaneExpr, qMethaneLit);

    // Power Generation Potential (MW)
    const pGenName = `P_LFG_MW_${cleanSite}`;
    const pGenId = interner.intern(pGenName);
    const peakPower = summary.peakMethaneM3PerYear * 4.19e-7;
    arena.addVariable(pGenName, VarType.Real, Variability.Continuous, Causality.Local, peakPower);
    const pGenExpr = arena.addExpression(ExprKind.Name, pGenId);

    // Equation: P_LFG_MW = Q_CH4 * 4.19e-7
    const coeffLit = arena.addRealLiteral(4.19e-7);
    const rhsPower = arena.addBinaryExpr(BinOp.Mul, qMethaneExpr, coeffLit);
    arena.addEquation(EqKind.Simple, pGenExpr, rhsPower);
  }

  // 2. Anaerobic Digester Variables and Equations
  for (const d of summary.digesters) {
    const cleanDig = d.name.replace(/[^a-zA-Z0-9_]/g, "_");

    // Daily Biogas Flow (m^3/day)
    const qBioName = `Q_biogas_${cleanDig}`;
    const qBioId = interner.intern(qBioName);
    arena.addVariable(qBioName, VarType.Real, Variability.Continuous, Causality.Local, d.dailyBiogasM3);
    const qBioExpr = arena.addExpression(ExprKind.Name, qBioId);

    const qBioLit = arena.addRealLiteral(d.dailyBiogasM3);
    arena.addEquation(EqKind.Simple, qBioExpr, qBioLit);

    // CHP Electric Power (kW)
    const pElecName = `P_elec_kW_${cleanDig}`;
    const pElecId = interner.intern(pElecName);
    arena.addVariable(pElecName, VarType.Real, Variability.Continuous, Causality.Local, d.electricalPowerKW);
    const pElecExpr = arena.addExpression(ExprKind.Name, pElecId);

    const pElecLit = arena.addRealLiteral(d.electricalPowerKW);
    arena.addEquation(EqKind.Simple, pElecExpr, pElecLit);

    // CHP Thermal Power (kW)
    const pThermName = `P_thermal_kW_${cleanDig}`;
    const pThermId = interner.intern(pThermName);
    arena.addVariable(pThermName, VarType.Real, Variability.Continuous, Causality.Local, d.thermalPowerKW);
    const pThermExpr = arena.addExpression(ExprKind.Name, pThermId);

    const pThermLit = arena.addRealLiteral(d.thermalPowerKW);
    arena.addEquation(EqKind.Simple, pThermExpr, pThermLit);
  }

  return arena;
}
