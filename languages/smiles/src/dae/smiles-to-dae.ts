// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/smiles — Direct Linear-Memory DAE Arena Lowering for Chemical Species & Thermophysical EOS.
 *
 * Compiles molecular species, Joback-Reid critical parameters, ideal-gas Cp(T) polynomials,
 * and Antoine / Lee-Kesler saturation vapor pressure equations into ModelScript's zero-GC DAEBuilder.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { estimateThermophysicalProperties } from "../solvers/property-estimator.js";
import type { MolecularGraph, SmilesDocument } from "../types.js";

export interface SmilesDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  temperature?: number | undefined; // K (default 298.15)
  pressure?: number | undefined; // bar (default 1.01325)
}

function sanitizeId(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const code = ch.charCodeAt(0);
    const isAlnum =
      (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || ch === "_";
    out += isAlnum ? ch : "_";
  }
  if (out.length === 0) return "Species";
  const firstCode = out.charCodeAt(0);
  if (firstCode >= 48 && firstCode <= 57) return `S_${out}`;
  return out;
}

function isSmilesDocument(input: SmilesDocument | MolecularGraph): input is SmilesDocument {
  return "molecules" in input && Array.isArray(input.molecules);
}

export function lowerSmilesToDae(input: SmilesDocument | MolecularGraph, options?: SmilesDaeOptions): DAEBuilder {
  const molecules: MolecularGraph[] = isSmilesDocument(input) ? input.molecules : [input];

  const firstMol = molecules[0];
  const rawName = options?.modelName ?? firstMol?.name ?? "SmilesThermophysicalSystem";
  const modelName = sanitizeId(rawName);
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const T0 = options?.temperature ?? 298.15;
  const P0 = options?.pressure ?? 1.01325;

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Div, a, b);
  const addPow = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Pow, a, b);

  // 1. System Temperature T [K] and Pressure P [bar]
  const tVar = dae.addVariable("T", VarType.Real, Variability.Parameter, Causality.Local, T0);
  dae.addEquation(EqKind.Simple, dae.addName(tVar), dae.addRealLiteral(T0));

  const pVar = dae.addVariable("P", VarType.Real, Variability.Parameter, Causality.Local, P0);
  dae.addEquation(EqKind.Simple, dae.addName(pVar), dae.addRealLiteral(P0));

  // 2. Lower each molecule's thermophysical parameters & state equations
  for (let idx = 0; idx < molecules.length; idx++) {
    const mol = molecules[idx]!;
    const est = estimateThermophysicalProperties(mol);
    const id = sanitizeId(mol.name || mol.id || `Species_${idx + 1}`);

    // Critical & formation parameters
    const mwVar = dae.addVariable(
      `MW_${id}`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      est.molecularWeight,
    );
    dae.addEquation(EqKind.Simple, dae.addName(mwVar), dae.addRealLiteral(est.molecularWeight));

    const tbVar = dae.addVariable(`Tb_${id}`, VarType.Real, Variability.Parameter, Causality.Local, est.Tb);
    dae.addEquation(EqKind.Simple, dae.addName(tbVar), dae.addRealLiteral(est.Tb));

    const tcVar = dae.addVariable(`Tc_${id}`, VarType.Real, Variability.Parameter, Causality.Local, est.Tc);
    dae.addEquation(EqKind.Simple, dae.addName(tcVar), dae.addRealLiteral(est.Tc));

    const pcVar = dae.addVariable(`Pc_${id}`, VarType.Real, Variability.Parameter, Causality.Local, est.Pc);
    dae.addEquation(EqKind.Simple, dae.addName(pcVar), dae.addRealLiteral(est.Pc));

    const vcVar = dae.addVariable(`Vc_${id}`, VarType.Real, Variability.Parameter, Causality.Local, est.Vc);
    dae.addEquation(EqKind.Simple, dae.addName(vcVar), dae.addRealLiteral(est.Vc));

    const omegaVar = dae.addVariable(
      `omega_${id}`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      est.acentricFactor,
    );
    dae.addEquation(EqKind.Simple, dae.addName(omegaVar), dae.addRealLiteral(est.acentricFactor));

    const hfVar = dae.addVariable(
      `Hf298_${id}`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      est.enthalpyOfFormation298K,
    );
    dae.addEquation(EqKind.Simple, dae.addName(hfVar), dae.addRealLiteral(est.enthalpyOfFormation298K));

    // Ideal-gas heat capacity equation: Cp_<id> = a + b*T + c*T^2 + d*T^3
    const [cpA, cpB, cpC, cpD] = est.idealGasCpCoeffs;
    const cpVar = dae.addVariable(
      `Cp_${id}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      est.idealGasCp298K,
    );
    const tExpr = dae.addName(tVar);
    const t2Expr = addPow(tExpr, dae.addRealLiteral(2.0));
    const t3Expr = addPow(tExpr, dae.addRealLiteral(3.0));
    const cpRhs = addAdd(
      addAdd(dae.addRealLiteral(cpA), addMul(dae.addRealLiteral(cpB), tExpr)),
      addAdd(addMul(dae.addRealLiteral(cpC), t2Expr), addMul(dae.addRealLiteral(cpD), t3Expr)),
    );
    dae.addEquation(EqKind.Simple, dae.addName(cpVar), cpRhs);

    // Antoine saturation vapor pressure equation: Psat_<id> = 10^(A - B / (T + C))
    const { A, B, C } = est.antoineCoeffs;
    const psatInit = Math.pow(10, A - B / (T0 + C));
    const psatVar = dae.addVariable(`Psat_${id}`, VarType.Real, Variability.Continuous, Causality.Local, psatInit);
    const antoineExp = addSub(
      dae.addRealLiteral(A),
      addDiv(dae.addRealLiteral(B), addAdd(dae.addName(tVar), dae.addRealLiteral(C))),
    );
    const psatRhs = addPow(dae.addRealLiteral(10.0), antoineExp);
    dae.addEquation(EqKind.Simple, dae.addName(psatVar), psatRhs);

    // Vapor-liquid equilibrium K-value: K_<id> = Psat_<id> / P
    const kVar = dae.addVariable(`K_${id}`, VarType.Real, Variability.Continuous, Causality.Local, psatInit / P0);
    dae.addEquation(EqKind.Simple, dae.addName(kVar), addDiv(dae.addName(psatVar), dae.addName(pVar)));

    // Molar holdup state ODE: der(n_<id>) = 0.0
    const nVar = dae.addVariable(`n_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 1.0);
    dae.addEquation(EqKind.Simple, dae.addDer(nVar), dae.addRealLiteral(0.0));
  }

  return dae;
}
