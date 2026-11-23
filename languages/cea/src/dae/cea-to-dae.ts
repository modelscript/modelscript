// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cea — Direct Linear-Memory DAE Arena Lowering.
 *
 * Lowers NASA CEA chemical equilibrium element balances, enthalpy/state relations,
 * and 1D isentropic rocket nozzle performance equations directly into ModelScript's
 * zero-GC `DAEBuilder` struct-of-arrays arena.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { G0_STANDARD, lookupCeaSpecies, P_STD_PA, R_UNIVERSAL, solveCeaDeck } from "../solver/index.js";
import type { CeaDeck, CeaSolveResult } from "../types.js";

export interface CeaDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  solveResult?: CeaSolveResult | undefined;
}

function sanitizeId(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
  return cleaned.length > 0 && /^[A-Za-z_]/.test(cleaned) ? cleaned : `cea_${cleaned}`;
}

/**
 * Lowers a parsed `CeaDeck` (and its solved equilibrium/nozzle state) directly into `DAEBuilder`.
 */
export function lowerCeaToDae(deck: CeaDeck, options?: CeaDaeOptions): DAEBuilder {
  const modelName = sanitizeId(options?.modelName ?? deck.name);
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);
  const result = options?.solveResult ?? solveCeaDeck(deck);
  const eq = result.equilibrium;
  const rocket = result.rocket;

  const addAdd = (a: number, b: number) => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number) => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number) => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number) => dae.addBinaryExpr(BinOp.Div, a, b);

  // 1. Fundamental constants
  const rGasVar = dae.addVariable("R_u", VarType.Real, Variability.Parameter, Causality.Local, R_UNIVERSAL);
  dae.addEquation(EqKind.Simple, dae.addName(rGasVar), dae.addRealLiteral(R_UNIVERSAL));

  const g0Var = dae.addVariable("g0", VarType.Real, Variability.Parameter, Causality.Local, G0_STANDARD);
  dae.addEquation(EqKind.Simple, dae.addName(g0Var), dae.addRealLiteral(G0_STANDARD));

  if (!eq) {
    return dae;
  }

  // 2. Chamber / Equilibrium thermodynamic state variables
  const pVar = dae.addVariable("P_c", VarType.Real, Variability.Parameter, Causality.Local, eq.pressurePa);
  dae.addEquation(EqKind.Simple, dae.addName(pVar), dae.addRealLiteral(eq.pressurePa));

  const tVar = dae.addVariable("T_c", VarType.Real, Variability.Continuous, Causality.Local, eq.temperatureK);
  const mwVar = dae.addVariable("M_w", VarType.Real, Variability.Continuous, Causality.Local, eq.molarMassKgMol);
  const rhoVar = dae.addVariable("rho_c", VarType.Real, Variability.Continuous, Causality.Local, eq.densityKgM3);
  const gammaVar = dae.addVariable("gamma", VarType.Real, Variability.Continuous, Causality.Local, eq.gamma);
  const hVar = dae.addVariable("h_c", VarType.Real, Variability.Continuous, Causality.Local, eq.enthalpyJKg);
  const sVar = dae.addVariable("s_c", VarType.Real, Variability.Continuous, Causality.Local, eq.entropyJKgK);
  const nTotVar = dae.addVariable("n_total", VarType.Real, Variability.Continuous, Causality.Local, eq.totalMolesPerKg);

  // Ideal gas EOS: P_c = rho_c * (R_u / M_w) * T_c
  dae.addEquation(
    EqKind.Simple,
    dae.addName(pVar),
    addMul(dae.addName(rhoVar), addMul(addDiv(dae.addName(rGasVar), dae.addName(mwVar)), dae.addName(tVar))),
  );

  // Molar mass definition: M_w * n_total = 1.0
  dae.addEquation(EqKind.Simple, addMul(dae.addName(mwVar), dae.addName(nTotVar)), dae.addRealLiteral(1.0));

  // Equilibrium state closure equations
  dae.addEquation(EqKind.Simple, dae.addName(tVar), dae.addRealLiteral(eq.temperatureK));
  dae.addEquation(EqKind.Simple, dae.addName(gammaVar), dae.addRealLiteral(eq.gamma));
  dae.addEquation(EqKind.Simple, dae.addName(hVar), dae.addRealLiteral(eq.enthalpyJKg));
  dae.addEquation(EqKind.Simple, dae.addName(sVar), dae.addRealLiteral(eq.entropyJKgK));

  // 3. Species moles & mole fractions + sum(X_j) = 1 + elemental conservation sum_j a_ij n_j = b_i
  const speciesNames = Object.keys(eq.speciesMolesPerKg);
  const nVars = new Map<string, number>();
  let sumXExpr: number | null = null;
  let sumNExpr: number | null = null;

  for (const spName of speciesNames) {
    const njVal = eq.speciesMolesPerKg[spName] ?? 0;
    const xjVal = eq.moleFractions[spName] ?? 0;
    const sid = sanitizeId(spName);
    const nVar = dae.addVariable(`n_${sid}`, VarType.Real, Variability.Continuous, Causality.Local, njVal);
    const xVar = dae.addVariable(`X_${sid}`, VarType.Real, Variability.Continuous, Causality.Local, xjVal);
    nVars.set(spName, nVar);

    // X_j * n_total = n_j
    dae.addEquation(EqKind.Simple, addMul(dae.addName(xVar), dae.addName(nTotVar)), dae.addName(nVar));

    sumXExpr = sumXExpr === null ? dae.addName(xVar) : addAdd(sumXExpr, dae.addName(xVar));
    sumNExpr = sumNExpr === null ? dae.addName(nVar) : addAdd(sumNExpr, dae.addName(nVar));
  }

  if (sumNExpr !== null) {
    dae.addEquation(EqKind.Simple, dae.addName(nTotVar), sumNExpr);
  }
  if (sumXExpr !== null) {
    dae.addEquation(EqKind.Simple, sumXExpr, dae.addRealLiteral(1.0));
  }

  // Elemental mass conservation equations: sum_j a_ij * n_j = b_i
  for (const [el, bVal] of Object.entries(eq.elementMolesPerKg)) {
    const bParam = dae.addVariable(`b_${el}`, VarType.Real, Variability.Parameter, Causality.Local, bVal);
    dae.addEquation(EqKind.Simple, dae.addName(bParam), dae.addRealLiteral(bVal));

    let lhsExpr: number | null = null;
    for (const spName of speciesNames) {
      const spData = lookupCeaSpecies(spName);
      const stoich = spData?.formula[el] ?? 0;
      if (stoich === 0) continue;
      const nVar = nVars.get(spName)!;
      const term = stoich === 1 ? dae.addName(nVar) : addMul(dae.addRealLiteral(stoich), dae.addName(nVar));
      lhsExpr = lhsExpr === null ? term : addAdd(lhsExpr, term);
    }
    if (lhsExpr !== null) {
      dae.addEquation(EqKind.Simple, lhsExpr, dae.addName(bParam));
    }
  }

  // 4. 1D Isentropic Rocket Nozzle Balance (if rocket problem)
  if (rocket) {
    const lastExit = rocket.exits[rocket.exits.length - 1] ?? rocket.throat;
    const cStarVar = dae.addVariable("c_star", VarType.Real, Variability.Continuous, Causality.Local, rocket.cStarMS);
    const cfVar = dae.addVariable("C_F", VarType.Real, Variability.Continuous, Causality.Local, rocket.cf);
    const cfVacVar = dae.addVariable("C_F_vac", VarType.Real, Variability.Continuous, Causality.Local, rocket.cfVac);
    const ispVacVar = dae.addVariable(
      "I_sp_vac",
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      rocket.ispVacS,
    );
    const ispSlVar = dae.addVariable("I_sp_sl", VarType.Real, Variability.Continuous, Causality.Local, rocket.ispSlS);
    const veVar = dae.addVariable("v_exit", VarType.Real, Variability.Continuous, Causality.Local, lastExit.velocityMS);
    const peVar = dae.addVariable(
      "P_exit",
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      lastExit.state.pressurePa,
    );
    const epsVar = dae.addVariable("epsilon", VarType.Real, Variability.Parameter, Causality.Local, lastExit.areaRatio);

    dae.addEquation(EqKind.Simple, dae.addName(cStarVar), dae.addRealLiteral(rocket.cStarMS));
    dae.addEquation(EqKind.Simple, dae.addName(peVar), dae.addRealLiteral(lastExit.state.pressurePa));
    dae.addEquation(EqKind.Simple, dae.addName(epsVar), dae.addRealLiteral(lastExit.areaRatio));

    // v_exit = C_F * c_star
    dae.addEquation(EqKind.Simple, dae.addName(veVar), addMul(dae.addName(cfVar), dae.addName(cStarVar)));

    // C_F_vac = C_F + (P_exit / P_c) * epsilon
    dae.addEquation(
      EqKind.Simple,
      dae.addName(cfVacVar),
      addAdd(dae.addName(cfVar), addMul(addDiv(dae.addName(peVar), dae.addName(pVar)), dae.addName(epsVar))),
    );

    // I_sp_vac * g0 = C_F_vac * c_star
    dae.addEquation(
      EqKind.Simple,
      addMul(dae.addName(ispVacVar), dae.addName(g0Var)),
      addMul(dae.addName(cfVacVar), dae.addName(cStarVar)),
    );

    // I_sp_sl * g0 = v_exit + ((P_exit - P_std) / P_c) * epsilon * c_star
    const pStdExpr = dae.addRealLiteral(P_STD_PA);
    dae.addEquation(
      EqKind.Simple,
      addMul(dae.addName(ispSlVar), dae.addName(g0Var)),
      addAdd(
        dae.addName(veVar),
        addMul(
          addMul(addDiv(addSub(dae.addName(peVar), pStdExpr), dae.addName(pVar)), dae.addName(epsVar)),
          dae.addName(cStarVar),
        ),
      ),
    );
  }

  return dae;
}
