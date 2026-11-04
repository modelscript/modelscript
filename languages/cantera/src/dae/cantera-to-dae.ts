// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cantera — Direct Linear-Memory DAE Arena Lowering for Chemical Kinetics.
 *
 * Compiles Cantera species concentrations, reactor temperature/pressure, modified Arrhenius
 * rate expressions, third-body efficiencies, and molar production rates directly into
 * ModelScript's zero-GC DAEBuilder struct-of-arrays arena.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { GAS_CONSTANT_R, STANDARD_PRESSURE_PA } from "../solvers/kinetics-solver.js";
import type { CanteraDocument } from "../types.js";

export interface CanteraDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  temperature?: number | undefined;
  pressure?: number | undefined;
}

function sanitizeIdentifier(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const ch = name[i] ?? "";
    const code = ch.charCodeAt(0);
    const isAlnum = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (isAlnum || ch === "_") {
      out += ch;
    } else if (ch === "+") {
      out += "_plus";
    } else if (ch === "-") {
      out += "_minus";
    } else {
      out += "_";
    }
  }
  return out.length > 0 ? out : "sp";
}

export function lowerCanteraToDae(doc: CanteraDocument, options?: CanteraDaeOptions): DAEBuilder {
  const mech = doc.mechanism;
  const firstPhase = mech.phases.values().next().value;
  const modelName = sanitizeIdentifier(options?.modelName ?? (mech.name || "CanteraReactor"));
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Div, a, b);
  const addPow = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Pow, a, b);
  const addCall = (fn: string, args: number[]): number => dae.addCallExpr(fn, args);

  const T0 = options?.temperature ?? firstPhase?.state?.T ?? 1000.0;
  const P0 = options?.pressure ?? firstPhase?.state?.P ?? STANDARD_PRESSURE_PA;

  // 1. Thermodynamic State & Universal Gas Constant
  const rGasVar = dae.addVariable("R_gas", VarType.Real, Variability.Parameter, Causality.Local, GAS_CONSTANT_R);
  dae.addEquation(EqKind.Simple, dae.addName(rGasVar), dae.addRealLiteral(GAS_CONSTANT_R));

  const tVar = dae.addVariable("T", VarType.Real, Variability.Continuous, Causality.Local, T0);
  dae.addEquation(EqKind.Simple, dae.addDer(tVar), dae.addRealLiteral(0.0));

  const pVar = dae.addVariable("P", VarType.Real, Variability.Parameter, Causality.Local, P0);
  dae.addEquation(EqKind.Simple, dae.addName(pVar), dae.addRealLiteral(P0));

  // 2. Species Concentration State Variables [mol/m^3]
  const speciesList =
    firstPhase && firstPhase.species.length > 0 ? [...firstPhase.species] : Array.from(mech.species.keys());
  for (const spName of mech.species.keys()) {
    if (!speciesList.includes(spName)) {
      speciesList.push(spName);
    }
  }

  const totalC0 = P0 / (GAS_CONSTANT_R * T0);
  const rawX = firstPhase?.state?.X;
  let sumX = 0;
  if (rawX) {
    for (const val of Object.values(rawX)) {
      sumX += Math.max(0, val);
    }
  }

  const speciesVarMap = new Map<string, number>();
  for (const spName of speciesList) {
    let initC = totalC0 / Math.max(1, speciesList.length);
    if (rawX && sumX > 0) {
      initC = (Math.max(0, rawX[spName] ?? 0) / sumX) * totalC0;
    }
    const safeSp = sanitizeIdentifier(spName);
    const cVar = dae.addVariable(`C_${safeSp}`, VarType.Real, Variability.Continuous, Causality.Local, initC);
    speciesVarMap.set(spName, cVar);
  }

  // 3. Reaction Forward Rate Constants kf_r and Rates of Progress q_r
  const rxnRateVarMap = new Map<string, number>();
  for (let i = 0; i < mech.reactions.length; i++) {
    const rxn = mech.reactions[i]!;
    const rId = sanitizeIdentifier(rxn.id || `R${i + 1}`);

    const kfVar = dae.addVariable(`kf_${rId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Arrhenius expression: A * (T ^ b) * exp(-Ea / (R_gas * T))
    let kfExpr = dae.addRealLiteral(rxn.rateConstant.A);
    if (rxn.rateConstant.b !== 0) {
      const tPow = addPow(dae.addName(tVar), dae.addRealLiteral(rxn.rateConstant.b));
      kfExpr = addMul(kfExpr, tPow);
    }
    if (rxn.rateConstant.Ea !== 0) {
      const negEa = dae.addRealLiteral(-rxn.rateConstant.Ea);
      const rt = addMul(dae.addName(rGasVar), dae.addName(tVar));
      const expTerm = addCall("exp", [addDiv(negEa, rt)]);
      kfExpr = addMul(kfExpr, expTerm);
    }
    dae.addEquation(EqKind.Simple, dae.addName(kfVar), kfExpr);

    // Rate of progress q_r = kf_r * [M]_eff * prod([X_i]^nu_i)
    const qVar = dae.addVariable(`q_${rId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    rxnRateVarMap.set(rxn.id, qVar);

    let ropExpr = dae.addName(kfVar);
    for (const react of rxn.reactants) {
      const cVar = speciesVarMap.get(react.species);
      if (cVar !== undefined) {
        const order = rxn.orders?.[react.species] ?? react.stoichiometry;
        const term = order === 1 ? dae.addName(cVar) : addPow(dae.addName(cVar), dae.addRealLiteral(order));
        ropExpr = addMul(ropExpr, term);
      }
    }

    if (rxn.type === "three-body") {
      let mSumExpr: number | null = null;
      for (const spName of speciesList) {
        const cVar = speciesVarMap.get(spName);
        if (cVar === undefined) continue;
        const eff = rxn.efficiencies?.[spName] ?? 1.0;
        if (eff === 0) continue;
        const term = eff === 1.0 ? dae.addName(cVar) : addMul(dae.addRealLiteral(eff), dae.addName(cVar));
        mSumExpr = mSumExpr === null ? term : addAdd(mSumExpr, term);
      }
      if (mSumExpr !== null) {
        ropExpr = addMul(ropExpr, mSumExpr);
      }
    }

    dae.addEquation(EqKind.Simple, dae.addName(qVar), ropExpr);
  }

  // 4. Species Molar Production Rate ODEs: der(C_k) = sum_r (nu''_{k,r} - nu'_{k,r}) * q_r
  for (const spName of speciesList) {
    const cVar = speciesVarMap.get(spName);
    if (cVar === undefined) continue;

    let netOmegaExpr: number | null = null;

    for (const rxn of mech.reactions) {
      const qVar = rxnRateVarMap.get(rxn.id);
      if (qVar === undefined) continue;

      let netStoich = 0;
      for (const prod of rxn.products) {
        if (prod.species === spName) netStoich += prod.stoichiometry;
      }
      for (const react of rxn.reactants) {
        if (react.species === spName) netStoich -= react.stoichiometry;
      }

      if (Math.abs(netStoich) > 1e-12) {
        const absStoich = Math.abs(netStoich);
        const term = absStoich === 1.0 ? dae.addName(qVar) : addMul(dae.addRealLiteral(absStoich), dae.addName(qVar));

        if (netStoich > 0) {
          netOmegaExpr = netOmegaExpr === null ? term : addAdd(netOmegaExpr, term);
        } else {
          netOmegaExpr = netOmegaExpr === null ? addSub(dae.addRealLiteral(0.0), term) : addSub(netOmegaExpr, term);
        }
      }
    }

    const rhs = netOmegaExpr !== null ? netOmegaExpr : dae.addRealLiteral(0.0);
    dae.addEquation(EqKind.Simple, dae.addDer(cVar), rhs);
  }

  return dae;
}
