// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/chemkin — Direct Linear-Memory DAE Arena Lowering for Chemical Kinetics.
 *
 * Compiles CHEMKIN species mass fractions, Arrhenius / Lindemann / Troe forward & reverse
 * mass-action production rates (`der(Y_k) = omega_k * W_k / rho`), and adiabatic energy
 * balance (`der(T)`) directly into `@modelscript/runtime`'s `DAEBuilder` arena.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import {
  convertAToSI,
  convertEaToJPerMol,
  evaluateNasa7,
  GAS_CONSTANT_R,
  resolveSpeciesMolecularWeightKgPerMol,
  resolveSpeciesThermo,
  STANDARD_PRESSURE_PA,
} from "../solver/thermo.js";
import type { ArrheniusParams, ChemkinDocument, ChemkinMechanism, Nasa7ThermoRecord } from "../types.js";

export interface ChemkinDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  mode?: "constant-volume" | "constant-pressure" | undefined;
  isothermal?: boolean | undefined;
  temperature?: number | undefined;
  pressure?: number | undefined;
  massFractions?: Record<string, number> | undefined;
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

function buildArrheniusExpr(
  dae: DAEBuilder,
  params: ArrheniusParams,
  order: number,
  mech: ChemkinMechanism,
  tVar: number,
  rGasVar: number,
): number {
  const aSI = convertAToSI(params.A, order, mech.quantityUnits);
  const eaSI = convertEaToJPerMol(params.Ea, mech.energyUnits);

  let expr = dae.addRealLiteral(aSI);
  if (params.b !== 0) {
    const tPow = dae.addBinaryExpr(BinOp.Pow, dae.addName(tVar), dae.addRealLiteral(params.b));
    expr = dae.addBinaryExpr(BinOp.Mul, expr, tPow);
  }
  if (eaSI !== 0) {
    const negEa = dae.addRealLiteral(-eaSI);
    const rt = dae.addBinaryExpr(BinOp.Mul, dae.addName(rGasVar), dae.addName(tVar));
    const expTerm = dae.addCallExpr("exp", [dae.addBinaryExpr(BinOp.Div, negEa, rt)]);
    expr = dae.addBinaryExpr(BinOp.Mul, expr, expTerm);
  }
  return expr;
}

/**
 * Lowers a parsed `ChemkinDocument` directly into a linear-memory `DAEBuilder` arena.
 */
export function lowerChemkinToDae(doc: ChemkinDocument, options?: ChemkinDaeOptions): DAEBuilder {
  const mech = doc.mechanism;
  const modelName = sanitizeIdentifier(options?.modelName ?? (mech.name || "ChemkinReactor"));
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const mode = options?.mode ?? "constant-pressure";
  const isothermal = options?.isothermal ?? false;
  const T0 = options?.temperature ?? 1000.0;
  const P0 = options?.pressure ?? STANDARD_PRESSURE_PA;

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Div, a, b);
  const addPow = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Pow, a, b);
  const addCall = (fn: string, args: number[]): number => dae.addCallExpr(fn, args);

  // 1. Global Thermodynamic Parameters & State Variables
  const rGasVar = dae.addVariable("R_gas", VarType.Real, Variability.Parameter, Causality.Local, GAS_CONSTANT_R);
  dae.addEquation(EqKind.Simple, dae.addName(rGasVar), dae.addRealLiteral(GAS_CONSTANT_R));

  const tVar = dae.addVariable("T", VarType.Real, Variability.Continuous, Causality.Local, T0);
  const pVar = dae.addVariable(
    "P",
    VarType.Real,
    mode === "constant-pressure" ? Variability.Parameter : Variability.Continuous,
    Causality.Local,
    P0,
  );
  if (mode === "constant-pressure") {
    dae.addEquation(EqKind.Simple, dae.addName(pVar), dae.addRealLiteral(P0));
  }

  // Ordered species list
  const speciesList = Array.from(mech.species.keys());
  if (speciesList.length === 0) {
    const seen = new Set<string>();
    for (const rxn of mech.reactions) {
      for (const r of rxn.reactants) seen.add(r.species);
      for (const p of rxn.products) seen.add(p.species);
    }
    speciesList.push(...seen);
  }

  // Compute initial mass fractions & density
  const mwMap = new Map<string, number>();
  const thermoMap = new Map<string, Nasa7ThermoRecord>();
  const initYMap = new Map<string, number>();
  let sumY = 0;
  for (const sp of speciesList) {
    mwMap.set(sp, resolveSpeciesMolecularWeightKgPerMol(mech, sp));
    const rec = resolveSpeciesThermo(mech, sp);
    if (rec) thermoMap.set(sp, rec);
    const yRaw = options?.massFractions
      ? Math.max(0, options.massFractions[sp] ?? 0)
      : 1.0 / Math.max(1, speciesList.length);
    initYMap.set(sp, yRaw);
    sumY += yRaw;
  }
  if (sumY > 0) {
    for (const sp of speciesList) {
      initYMap.set(sp, (initYMap.get(sp) ?? 0) / sumY);
    }
  }

  let invW0 = 0;
  for (const sp of speciesList) {
    invW0 += (initYMap.get(sp) ?? 0) / (mwMap.get(sp) ?? 0.028);
  }
  const wMix0 = invW0 > 0 ? 1.0 / invW0 : 0.028;
  const rho0 = (P0 * wMix0) / (GAS_CONSTANT_R * T0);

  const rhoVar = dae.addVariable(
    "rho",
    VarType.Real,
    mode === "constant-volume" ? Variability.Parameter : Variability.Continuous,
    Causality.Local,
    rho0,
  );

  // 2. Species Variables: W_k, Y_k, C_k, omega_k
  const wVarMap = new Map<string, number>();
  const yVarMap = new Map<string, number>();
  const cVarMap = new Map<string, number>();
  const omegaVarMap = new Map<string, number>();

  let invWExpr: number | null = null;
  for (const sp of speciesList) {
    const safeSp = sanitizeIdentifier(sp);
    const wk = mwMap.get(sp) ?? 0.028;
    const y0 = initYMap.get(sp) ?? 0;
    const c0 = (rho0 * y0) / wk;

    const wVar = dae.addVariable(`W_${safeSp}`, VarType.Real, Variability.Parameter, Causality.Local, wk);
    dae.addEquation(EqKind.Simple, dae.addName(wVar), dae.addRealLiteral(wk));
    wVarMap.set(sp, wVar);

    const yVar = dae.addVariable(`Y_${safeSp}`, VarType.Real, Variability.Continuous, Causality.Local, y0);
    yVarMap.set(sp, yVar);

    const cVar = dae.addVariable(`C_${safeSp}`, VarType.Real, Variability.Continuous, Causality.Local, c0);
    cVarMap.set(sp, cVar);
    // C_k = rho * Y_k / W_k
    dae.addEquation(
      EqKind.Simple,
      dae.addName(cVar),
      addDiv(addMul(dae.addName(rhoVar), dae.addName(yVar)), dae.addName(wVar)),
    );

    const omegaVar = dae.addVariable(`omega_${safeSp}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    omegaVarMap.set(sp, omegaVar);

    const term = addDiv(dae.addName(yVar), dae.addName(wVar));
    invWExpr = invWExpr === null ? term : addAdd(invWExpr, term);
  }

  // Equation of state: rho (constant-pressure) or P (constant-volume)
  if (mode === "constant-volume") {
    dae.addEquation(EqKind.Simple, dae.addName(rhoVar), dae.addRealLiteral(rho0));
    const rt = addMul(dae.addName(rGasVar), dae.addName(tVar));
    const pExpr = invWExpr !== null ? addMul(addMul(dae.addName(rhoVar), rt), invWExpr) : dae.addRealLiteral(P0);
    dae.addEquation(EqKind.Simple, dae.addName(pVar), pExpr);
  } else {
    const rt = addMul(dae.addName(rGasVar), dae.addName(tVar));
    const rhoExpr = invWExpr !== null ? addDiv(dae.addName(pVar), addMul(rt, invWExpr)) : dae.addRealLiteral(rho0);
    dae.addEquation(EqKind.Simple, dae.addName(rhoVar), rhoExpr);
  }

  // 3. Reaction Forward/Reverse Rate Constants & Rates of Progress
  const qVarMap = new Map<string, number>();
  for (let i = 0; i < mech.reactions.length; i++) {
    const rxn = mech.reactions[i]!;
    const rId = sanitizeIdentifier(rxn.id || `R${i + 1}`);
    const reactOrder = rxn.reactants.reduce((s, r) => s + r.stoichiometry, 0);
    const prodOrder = rxn.products.reduce((s, p) => s + p.stoichiometry, 0);

    // Optional third-body concentration expression [M]_eff
    let mEffExpr: number | null = null;
    if (rxn.thirdBody || rxn.falloff) {
      if (rxn.thirdBodySpecies) {
        const cVar = cVarMap.get(rxn.thirdBodySpecies);
        if (cVar !== undefined) mEffExpr = dae.addName(cVar);
      } else {
        for (const sp of speciesList) {
          const cVar = cVarMap.get(sp);
          if (cVar === undefined) continue;
          const eff = rxn.efficiencies[sp] ?? 1.0;
          if (eff === 0) continue;
          const term = eff === 1.0 ? dae.addName(cVar) : addMul(dae.addRealLiteral(eff), dae.addName(cVar));
          mEffExpr = mEffExpr === null ? term : addAdd(mEffExpr, term);
        }
      }
    }

    const kfVar = dae.addVariable(`kf_${rId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    if (rxn.falloff && rxn.low && mEffExpr !== null) {
      // Lindemann / Troe falloff: kf = k_inf * (Pr / (1 + Pr)) * F_troe
      const kInfExpr = buildArrheniusExpr(dae, rxn.rate, reactOrder, mech, tVar, rGasVar);
      const k0Expr = buildArrheniusExpr(dae, rxn.low, reactOrder + 1, mech, tVar, rGasVar);
      const prVar = dae.addVariable(`Pr_${rId}`, VarType.Real, Variability.Continuous, Causality.Local, 1.0);
      dae.addEquation(EqKind.Simple, dae.addName(prVar), addDiv(addMul(k0Expr, mEffExpr), kInfExpr));

      const lindemann = addMul(
        kInfExpr,
        addDiv(dae.addName(prVar), addAdd(dae.addRealLiteral(1.0), dae.addName(prVar))),
      );

      if (rxn.troe) {
        const fCentVar = dae.addVariable(`Fcent_${rId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.5);
        let fCentExpr = addAdd(
          addMul(
            dae.addRealLiteral(1.0 - rxn.troe.a),
            addCall("exp", [
              addDiv(addSub(dae.addRealLiteral(0.0), dae.addName(tVar)), dae.addRealLiteral(rxn.troe.T3)),
            ]),
          ),
          addMul(
            dae.addRealLiteral(rxn.troe.a),
            addCall("exp", [
              addDiv(addSub(dae.addRealLiteral(0.0), dae.addName(tVar)), dae.addRealLiteral(rxn.troe.T1)),
            ]),
          ),
        );
        if (rxn.troe.T2 !== undefined && rxn.troe.T2 > 0) {
          fCentExpr = addAdd(fCentExpr, addCall("exp", [addDiv(dae.addRealLiteral(-rxn.troe.T2), dae.addName(tVar))]));
        }
        dae.addEquation(EqKind.Simple, dae.addName(fCentVar), fCentExpr);
        dae.addEquation(EqKind.Simple, dae.addName(kfVar), addMul(lindemann, dae.addName(fCentVar)));
      } else {
        dae.addEquation(EqKind.Simple, dae.addName(kfVar), lindemann);
      }
    } else if (rxn.thirdBody && mEffExpr !== null) {
      const kBase = buildArrheniusExpr(dae, rxn.rate, reactOrder + 1, mech, tVar, rGasVar);
      dae.addEquation(EqKind.Simple, dae.addName(kfVar), addMul(kBase, mEffExpr));
    } else {
      const kBase = buildArrheniusExpr(dae, rxn.rate, reactOrder, mech, tVar, rGasVar);
      dae.addEquation(EqKind.Simple, dae.addName(kfVar), kBase);
    }

    // Forward concentration product
    let fwdExpr = dae.addName(kfVar);
    for (const r of rxn.reactants) {
      const cVar = cVarMap.get(r.species);
      if (cVar !== undefined) {
        const term =
          r.stoichiometry === 1 ? dae.addName(cVar) : addPow(dae.addName(cVar), dae.addRealLiteral(r.stoichiometry));
        fwdExpr = addMul(fwdExpr, term);
      }
    }

    let ropExpr = fwdExpr;
    if (rxn.reversible) {
      const krVar = dae.addVariable(`kr_${rId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      if (rxn.rev) {
        const krBase = buildArrheniusExpr(dae, rxn.rev, prodOrder + (rxn.thirdBody ? 1 : 0), mech, tVar, rGasVar);
        dae.addEquation(
          EqKind.Simple,
          dae.addName(krVar),
          rxn.thirdBody && mEffExpr !== null ? addMul(krBase, mEffExpr) : krBase,
        );
      } else {
        // Thermodynamic consistency kr = kf / Kc(T0)
        let deltaG = 0;
        let deltaNu = 0;
        for (const r of rxn.reactants) {
          const rec = thermoMap.get(r.species);
          if (rec) deltaG -= r.stoichiometry * evaluateNasa7(rec, T0).gMolar;
          deltaNu -= r.stoichiometry;
        }
        for (const p of rxn.products) {
          const rec = thermoMap.get(p.species);
          if (rec) deltaG += p.stoichiometry * evaluateNasa7(rec, T0).gMolar;
          deltaNu += p.stoichiometry;
        }
        const kcVal =
          Math.exp(Math.max(-500, Math.min(500, -deltaG / (GAS_CONSTANT_R * T0)))) *
          Math.pow(STANDARD_PRESSURE_PA / (GAS_CONSTANT_R * T0), deltaNu);
        dae.addEquation(
          EqKind.Simple,
          dae.addName(krVar),
          addDiv(dae.addName(kfVar), dae.addRealLiteral(Math.max(1e-300, kcVal))),
        );
      }

      let revExpr = dae.addName(krVar);
      for (const p of rxn.products) {
        const cVar = cVarMap.get(p.species);
        if (cVar !== undefined) {
          const term =
            p.stoichiometry === 1 ? dae.addName(cVar) : addPow(dae.addName(cVar), dae.addRealLiteral(p.stoichiometry));
          revExpr = addMul(revExpr, term);
        }
      }
      ropExpr = addSub(fwdExpr, revExpr);
    }

    const qVar = dae.addVariable(`q_${rId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addEquation(EqKind.Simple, dae.addName(qVar), ropExpr);
    qVarMap.set(rxn.id, qVar);
  }

  // 4. Species Molar Production Rates & Mass-Fraction ODEs: der(Y_k) = omega_k * W_k / rho
  for (const sp of speciesList) {
    const omegaVar = omegaVarMap.get(sp)!;
    const yVar = yVarMap.get(sp)!;
    const wVar = wVarMap.get(sp)!;

    let sumOmega: number | null = null;
    for (const rxn of mech.reactions) {
      let netNu = 0;
      for (const r of rxn.reactants) {
        if (r.species === sp) netNu -= r.stoichiometry;
      }
      for (const p of rxn.products) {
        if (p.species === sp) netNu += p.stoichiometry;
      }
      if (netNu === 0) continue;
      const qVar = qVarMap.get(rxn.id);
      if (qVar === undefined) continue;

      const term =
        netNu === 1
          ? dae.addName(qVar)
          : netNu === -1
            ? addSub(dae.addRealLiteral(0.0), dae.addName(qVar))
            : addMul(dae.addRealLiteral(netNu), dae.addName(qVar));
      sumOmega = sumOmega === null ? term : addAdd(sumOmega, term);
    }

    dae.addEquation(EqKind.Simple, dae.addName(omegaVar), sumOmega ?? dae.addRealLiteral(0.0));
    dae.addEquation(
      EqKind.Simple,
      dae.addDer(yVar),
      addDiv(addMul(dae.addName(omegaVar), dae.addName(wVar)), dae.addName(rhoVar)),
    );
  }

  // 5. Energy Balance Equation: der(T)
  if (isothermal || speciesList.length === 0) {
    dae.addEquation(EqKind.Simple, dae.addDer(tVar), dae.addRealLiteral(0.0));
  } else {
    let heatNum: number | null = null;
    let capDen: number | null = null;
    for (const sp of speciesList) {
      const omegaVar = omegaVarMap.get(sp)!;
      const cVar = cVarMap.get(sp)!;
      const rec = thermoMap.get(sp);
      const th = rec ? evaluateNasa7(rec, T0) : null;
      const eMolar = th ? (mode === "constant-volume" ? th.uMolar : th.hMolar) : 0.0;
      const capMolar = th
        ? mode === "constant-volume"
          ? th.cvMolar
          : th.cpMolar
        : (mode === "constant-volume" ? 2.5 : 3.5) * GAS_CONSTANT_R;

      const hTerm = addMul(dae.addName(omegaVar), dae.addRealLiteral(eMolar));
      const cTerm = addMul(dae.addName(cVar), dae.addRealLiteral(capMolar));
      heatNum = heatNum === null ? hTerm : addAdd(heatNum, hTerm);
      capDen = capDen === null ? cTerm : addAdd(capDen, cTerm);
    }

    if (heatNum !== null && capDen !== null) {
      dae.addEquation(EqKind.Simple, dae.addDer(tVar), addDiv(addSub(dae.addRealLiteral(0.0), heatNum), capDen));
    } else {
      dae.addEquation(EqKind.Simple, dae.addDer(tVar), dae.addRealLiteral(0.0));
    }
  }

  return dae;
}
