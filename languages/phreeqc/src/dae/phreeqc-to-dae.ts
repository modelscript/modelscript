// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/phreeqc — Direct Linear-Memory DAE Arena Lowering for Aqueous Geochemistry & Reactive Transport.
 *
 * Compiles PHREEQC solutions, carbonate equilibria, Davies activity coefficients, ionic strength,
 * mineral saturation indices, and kinetic mineral dissolution/precipitation rates into
 * ModelScript's zero-GC DAEBuilder struct-of-arrays arena.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import {
  computeDebyeHuckelA,
  computeTemperatureLogK,
  KNOWN_MASTER_SPECIES,
  solvePhreeqcSpeciation,
  STANDARD_MINERAL_PHASES,
} from "../solvers/speciation-solver.js";
import type { PhreeqcDocument } from "../types.js";

export interface PhreeqcDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  solutionNumber?: number | undefined;
}

function sanitizeIdentifier(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const code = ch.charCodeAt(0);
    const isAlphaNum = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (isAlphaNum || ch === "_") {
      out += ch;
    } else if (ch === "+") {
      out += "p";
    } else if (ch === "-") {
      out += "m";
    } else {
      out += "_";
    }
  }
  return out.length > 0 ? out : "var";
}

export function lowerPhreeqcToDae(doc: PhreeqcDocument, options?: PhreeqcDaeOptions): DAEBuilder {
  const rawTitle = options?.modelName ?? doc.title ?? "PhreeqcAqueousSystem";
  const modelName = sanitizeIdentifier(rawTitle);
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Div, a, b);
  const addPow = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Pow, a, b);
  const addCall = (fn: string, args: number[]): number => dae.addCallExpr(fn, args);

  // Solve initial speciation for baseline values
  const spec = solvePhreeqcSpeciation(doc, { solutionNumber: options?.solutionNumber });
  const tempC = spec.temperatureC;
  const debyeA = computeDebyeHuckelA(tempC);

  const Kw = Math.pow(10, computeTemperatureLogK(-14.0, 55.84, tempC));
  const K1 = Math.pow(10, computeTemperatureLogK(-6.352, 9.15, tempC));
  const K2 = Math.pow(10, computeTemperatureLogK(-10.329, 14.9, tempC));

  // 1. Thermodynamic state parameters: T_C, pH, pe
  const vTemp = dae.addVariable("T_C", VarType.Real, Variability.Parameter, Causality.Local, tempC);
  dae.addEquation(EqKind.Simple, dae.addName(vTemp), dae.addRealLiteral(tempC));

  const vPh = dae.addVariable("pH", VarType.Real, Variability.Continuous, Causality.Local, spec.pH);
  dae.addEquation(EqKind.Simple, dae.addName(vPh), dae.addRealLiteral(spec.pH));

  const vPe = dae.addVariable("pe", VarType.Real, Variability.Parameter, Causality.Local, spec.pe);
  dae.addEquation(EqKind.Simple, dae.addName(vPe), dae.addRealLiteral(spec.pe));

  // 2. Ionic Strength & Davies Activity Coefficients (gamma_1, gamma_2)
  const vI = dae.addVariable(
    "I",
    VarType.Real,
    Variability.Continuous,
    Causality.Local,
    Math.max(1.0e-7, spec.ionicStrength),
  );
  const vGamma1 = dae.addVariable(
    "gamma_1",
    VarType.Real,
    Variability.Continuous,
    Causality.Local,
    spec.activityCoefficients["HCO3-"] ?? 1.0,
  );
  const vGamma2 = dae.addVariable(
    "gamma_2",
    VarType.Real,
    Variability.Continuous,
    Causality.Local,
    spec.activityCoefficients["CO3-2"] ?? 1.0,
  );

  // Davies term: sqrt(I) / (1 + sqrt(I)) - 0.3 * I
  const sqrtIExpr = addCall("sqrt", [dae.addName(vI)]);
  const daviesBracket = addSub(
    addDiv(sqrtIExpr, addAdd(dae.addRealLiteral(1.0), sqrtIExpr)),
    addMul(dae.addRealLiteral(0.3), dae.addName(vI)),
  );
  const logGamma1Expr = addMul(dae.addRealLiteral(-debyeA), daviesBracket);
  const logGamma2Expr = addMul(dae.addRealLiteral(-4.0 * debyeA), daviesBracket);

  dae.addEquation(EqKind.Simple, dae.addName(vGamma1), addPow(dae.addRealLiteral(10.0), logGamma1Expr));
  dae.addEquation(EqKind.Simple, dae.addName(vGamma2), addPow(dae.addRealLiteral(10.0), logGamma2Expr));

  // 3. Proton & Hydroxide Molalities (m_H, m_OH)
  const aHExpr = addPow(dae.addRealLiteral(10.0), dae.addNegateExpr(dae.addName(vPh)));
  const vMH = dae.addVariable(
    "m_H",
    VarType.Real,
    Variability.Continuous,
    Causality.Local,
    spec.speciesMolalities["H+"] ?? 1.0e-7,
  );
  dae.addEquation(EqKind.Simple, dae.addName(vMH), addDiv(aHExpr, dae.addName(vGamma1)));

  const vMOH = dae.addVariable(
    "m_OH",
    VarType.Real,
    Variability.Continuous,
    Causality.Local,
    spec.speciesMolalities["OH-"] ?? 1.0e-7,
  );
  dae.addEquation(
    EqKind.Simple,
    dae.addName(vMOH),
    addDiv(dae.addRealLiteral(Kw), addMul(aHExpr, dae.addName(vGamma1))),
  );

  // 4. Carbonate Speciation (C_tot, m_H2CO3, m_HCO3, m_CO3)
  const vCTot = dae.addVariable(
    "C_tot",
    VarType.Real,
    Variability.Continuous,
    Causality.Local,
    spec.carbonateSpeciation.totalCarbon,
  );
  const vMH2CO3 = dae.addVariable(
    "m_H2CO3",
    VarType.Real,
    Variability.Continuous,
    Causality.Local,
    spec.carbonateSpeciation.h2co3,
  );
  const vMHCO3 = dae.addVariable(
    "m_HCO3",
    VarType.Real,
    Variability.Continuous,
    Causality.Local,
    spec.carbonateSpeciation.hco3,
  );
  const vMCO3 = dae.addVariable(
    "m_CO3",
    VarType.Real,
    Variability.Continuous,
    Causality.Local,
    spec.carbonateSpeciation.co3,
  );

  // m_H2CO3 = C_tot / (1 + K1/(aH*gamma_1) + K1*K2/(aH^2*gamma_2))
  const term1Expr = addDiv(dae.addRealLiteral(K1), addMul(aHExpr, dae.addName(vGamma1)));
  const term2Expr = addDiv(dae.addRealLiteral(K1 * K2), addMul(addMul(aHExpr, aHExpr), dae.addName(vGamma2)));
  const denomExpr = addAdd(dae.addRealLiteral(1.0), addAdd(term1Expr, term2Expr));
  dae.addEquation(EqKind.Simple, dae.addName(vMH2CO3), addDiv(dae.addName(vCTot), denomExpr));

  // m_HCO3 = K1 * m_H2CO3 / (aH * gamma_1)
  dae.addEquation(
    EqKind.Simple,
    dae.addName(vMHCO3),
    addDiv(addMul(dae.addRealLiteral(K1), dae.addName(vMH2CO3)), addMul(aHExpr, dae.addName(vGamma1))),
  );

  // m_CO3 = K2 * gamma_1 * m_HCO3 / (aH * gamma_2)
  dae.addEquation(
    EqKind.Simple,
    dae.addName(vMCO3),
    addDiv(
      addMul(dae.addRealLiteral(K2), addMul(dae.addName(vGamma1), dae.addName(vMHCO3))),
      addMul(aHExpr, dae.addName(vGamma2)),
    ),
  );

  // 5. Dissolved Master Ion Molalities (m_Ca, m_Mg, m_Na, m_Cl, m_SO4, etc.)
  const ionVarMap = new Map<string, { varId: number; charge: number; varName: string }>();

  const ensureIonVar = (aqueousSpecies: string, charge: number, initMolality: number) => {
    const existing = ionVarMap.get(aqueousSpecies);
    if (existing) return existing;
    // Clean variable name: e.g. "Ca+2" -> "m_Ca", "SO4-2" -> "m_SO4"
    let baseName = aqueousSpecies;
    let plusMinusIdx = -1;
    for (let i = 0; i < aqueousSpecies.length; i++) {
      if (aqueousSpecies[i] === "+" || aqueousSpecies[i] === "-") {
        plusMinusIdx = i;
        break;
      }
    }
    if (plusMinusIdx > 0) {
      baseName = aqueousSpecies.slice(0, plusMinusIdx);
    }
    const varName = `m_${sanitizeIdentifier(baseName)}`;
    const varId = dae.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, initMolality);
    const info = { varId, charge, varName };
    ionVarMap.set(aqueousSpecies, info);
    return info;
  };

  for (const [spName, molality] of Object.entries(spec.speciesMolalities)) {
    if (spName === "H+" || spName === "OH-" || spName === "H2CO3" || spName === "HCO3-" || spName === "CO3-2") {
      continue;
    }
    let charge = 0;
    for (const meta of KNOWN_MASTER_SPECIES.values()) {
      if (meta.aqueousSpecies === spName) {
        charge = meta.charge;
        break;
      }
    }
    ensureIonVar(spName, charge, molality);
  }

  // Ensure ions required by equilibriumPhases and kinetics exist
  const activeMinerals = new Set<string>();
  for (const ep of doc.equilibriumPhases) {
    if (STANDARD_MINERAL_PHASES.has(ep.name)) {
      activeMinerals.add(ep.name);
    }
  }
  for (const kin of doc.kinetics) {
    if (STANDARD_MINERAL_PHASES.has(kin.name)) {
      activeMinerals.add(kin.name);
    }
  }
  if (activeMinerals.size === 0 && ionVarMap.has("Ca+2") && spec.carbonateSpeciation.totalCarbon > 0) {
    activeMinerals.add("Calcite");
  }

  for (const minName of activeMinerals) {
    const minMeta = STANDARD_MINERAL_PHASES.get(minName);
    if (!minMeta) continue;
    for (const ion of minMeta.ions) {
      if (ion.species === "CO3-2") continue;
      let charge = 2;
      for (const meta of KNOWN_MASTER_SPECIES.values()) {
        if (meta.aqueousSpecies === ion.species) {
          charge = meta.charge;
          break;
        }
      }
      ensureIonVar(ion.species, charge, spec.speciesMolalities[ion.species] ?? 1.0e-6);
    }
  }

  // 6. Ionic Strength Equation: I = 0.5 * (m_H + m_OH + m_HCO3 + 4*m_CO3 + sum(z_i^2 * m_i))
  let sumMZ2Expr = addAdd(
    addAdd(dae.addName(vMH), dae.addName(vMOH)),
    addAdd(dae.addName(vMHCO3), addMul(dae.addRealLiteral(4.0), dae.addName(vMCO3))),
  );
  for (const info of ionVarMap.values()) {
    if (info.charge !== 0) {
      const z2 = info.charge * info.charge;
      const term = z2 === 1 ? dae.addName(info.varId) : addMul(dae.addRealLiteral(z2), dae.addName(info.varId));
      sumMZ2Expr = addAdd(sumMZ2Expr, term);
    }
  }
  dae.addEquation(EqKind.Simple, dae.addName(vI), addMul(dae.addRealLiteral(0.5), sumMZ2Expr));

  // Helper to get activity expression for an ion
  const getIonActivityExpr = (speciesName: string): number => {
    if (speciesName === "CO3-2") {
      return addMul(dae.addName(vMCO3), dae.addName(vGamma2));
    }
    if (speciesName === "HCO3-") {
      return addMul(dae.addName(vMHCO3), dae.addName(vGamma1));
    }
    const info = ionVarMap.get(speciesName);
    if (!info) return dae.addRealLiteral(1.0e-9);
    const absZ = Math.abs(info.charge);
    if (absZ === 1) return addMul(dae.addName(info.varId), dae.addName(vGamma1));
    if (absZ === 2) return addMul(dae.addName(info.varId), dae.addName(vGamma2));
    return dae.addName(info.varId);
  };

  // 7. Mineral IAP & Saturation Index (SI) Equations
  const iapVarMap = new Map<string, { iapVar: number; ksp: number }>();
  for (const minName of activeMinerals) {
    const minMeta = STANDARD_MINERAL_PHASES.get(minName);
    if (!minMeta) continue;

    const logKsp = computeTemperatureLogK(minMeta.logKsp25, minMeta.deltaHkJ, tempC);
    const ksp = Math.pow(10, logKsp);
    const initSat = spec.saturationIndices[minName];

    const vIAP = dae.addVariable(
      `IAP_${minName}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      initSat?.iap ?? ksp,
    );
    const vSI = dae.addVariable(
      `SI_${minName}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      initSat?.si ?? 0.0,
    );

    let iapExpr: number | null = null;
    for (const ion of minMeta.ions) {
      const actExpr = getIonActivityExpr(ion.species);
      const factor = ion.stoich === 1 ? actExpr : addPow(actExpr, dae.addRealLiteral(ion.stoich));
      iapExpr = iapExpr === null ? factor : addMul(iapExpr, factor);
    }
    const finalIapExpr = iapExpr ?? dae.addRealLiteral(ksp);

    dae.addEquation(EqKind.Simple, dae.addName(vIAP), finalIapExpr);
    dae.addEquation(
      EqKind.Simple,
      dae.addName(vSI),
      addCall("log10", [addDiv(dae.addName(vIAP), dae.addRealLiteral(ksp))]),
    );
    iapVarMap.set(minName, { iapVar: vIAP, ksp });
  }

  // 8. Kinetic Mineral Dissolution / Precipitation Rate Equations & Solid Mass Balances
  const ionSourceTerms = new Map<string, number[]>(); // speciesName -> array of flux expression IDs
  const carbonSourceTerms: number[] = [];

  for (const kin of doc.kinetics) {
    const safeName = sanitizeIdentifier(kin.name);
    const vM = dae.addVariable(`M_${safeName}`, VarType.Real, Variability.Continuous, Causality.Local, kin.m0);
    const vRate = dae.addVariable(`rate_${safeName}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Rate law: rate = k * A_surf * (1 - IAP / Ksp)
    const kA = kin.rateConstant * kin.surfaceArea;
    const iapEntry = iapVarMap.get(kin.name);
    let rateExpr: number;
    if (iapEntry) {
      const omegaExpr = addDiv(dae.addName(iapEntry.iapVar), dae.addRealLiteral(iapEntry.ksp));
      rateExpr = addMul(dae.addRealLiteral(kA), addSub(dae.addRealLiteral(1.0), omegaExpr));
    } else {
      rateExpr = addMul(dae.addRealLiteral(kA), dae.addName(vM));
    }

    dae.addEquation(EqKind.Simple, dae.addName(vRate), rateExpr);
    dae.addEquation(EqKind.Simple, dae.addDer(vM), dae.addNegateExpr(dae.addName(vRate)));

    // Contribute stoichiometric source terms to aqueous ions
    const minMeta = STANDARD_MINERAL_PHASES.get(kin.name);
    if (minMeta) {
      for (const ion of minMeta.ions) {
        const term = ion.stoich === 1 ? dae.addName(vRate) : addMul(dae.addRealLiteral(ion.stoich), dae.addName(vRate));
        if (ion.species === "CO3-2") {
          carbonSourceTerms.push(term);
        } else {
          const list = ionSourceTerms.get(ion.species) ?? [];
          list.push(term);
          ionSourceTerms.set(ion.species, list);
        }
      }
    }
  }

  // 9. Differential Mass Balance Equations for C_tot and Aqueous Master Ions
  let cTotRhs: number = dae.addRealLiteral(0.0);
  for (const term of carbonSourceTerms) {
    cTotRhs = addAdd(cTotRhs, term);
  }
  dae.addEquation(EqKind.Simple, dae.addDer(vCTot), cTotRhs);

  for (const [spName, info] of ionVarMap) {
    const terms = ionSourceTerms.get(spName);
    let rhs: number = dae.addRealLiteral(0.0);
    if (terms && terms.length > 0) {
      rhs = terms[0]!;
      for (let i = 1; i < terms.length; i++) {
        rhs = addAdd(rhs, terms[i]!);
      }
    }
    dae.addEquation(EqKind.Simple, dae.addDer(info.varId), rhs);
  }

  return dae;
}
