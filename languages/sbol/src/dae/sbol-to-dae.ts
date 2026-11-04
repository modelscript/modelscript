// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbol — Direct Linear-Memory DAE Arena Lowering for Synthetic Genetic Circuits.
 *
 * Compiles SBOL3 genetic components and transcriptional regulatory interactions into
 * ModelScript's zero-GC DAEBuilder:
 *   1. Protein state variables: P_i
 *   2. Kinetic parameters: alpha0_i, alpha_i, gamma_i, K_{i,j}, n_{i,j}
 *   3. Hill synthesis flux variables: v_synth_i
 *   4. Differential balance equations: der(P_i) = v_synth_i - gamma_i * P_i
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { extractRegulatoryNetwork, type GeneticCircuitSolverOptions } from "../solvers/genetic-circuit-solver.js";
import type { SbolDocument } from "../types.js";

export interface SbolDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  solverOptions?: GeneticCircuitSolverOptions | undefined;
}

export function lowerSbolToDae(doc: SbolDocument, options?: SbolDaeOptions): DAEBuilder {
  const defaultName = doc.components[0]?.displayId ?? "SbolGeneticCircuit";
  const modelName = (options?.modelName ?? defaultName).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Div, a, b);
  const addPow = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Pow, a, b);

  const network = extractRegulatoryNetwork(doc, options?.solverOptions);

  // 1. Declare Protein State Variables
  const speciesVarMap = new Map<string, number>();
  for (const s of network) {
    const pVar = dae.addVariable(
      `P_${s.id}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      s.initialConcentration,
    );
    speciesVarMap.set(s.id, pVar);
  }

  // 2. Declare Parameters, Hill Synthesis Fluxes, and ODEs for each Regulated Species
  for (const s of network) {
    const pVar = speciesVarMap.get(s.id);
    if (pVar === undefined) continue;

    const alpha0Var = dae.addVariable(`alpha0_${s.id}`, VarType.Real, Variability.Parameter, Causality.Local, s.alpha0);
    dae.addEquation(EqKind.Simple, dae.addName(alpha0Var), dae.addRealLiteral(s.alpha0));

    const alphaVar = dae.addVariable(`alpha_${s.id}`, VarType.Real, Variability.Parameter, Causality.Local, s.alpha);
    dae.addEquation(EqKind.Simple, dae.addName(alphaVar), dae.addRealLiteral(s.alpha));

    const gammaVar = dae.addVariable(`gamma_${s.id}`, VarType.Real, Variability.Parameter, Causality.Local, s.gamma);
    dae.addEquation(EqKind.Simple, dae.addName(gammaVar), dae.addRealLiteral(s.gamma));

    // Build Hill regulatory product expression
    let hillFactorExpr = dae.addRealLiteral(1.0);
    for (let idx = 0; idx < s.regulators.length; idx++) {
      const reg = s.regulators[idx]!;
      const regVar = speciesVarMap.get(reg.regulatorId);
      if (regVar === undefined) continue;

      const kVar = dae.addVariable(
        `K_${s.id}_${reg.regulatorId}_${idx}`,
        VarType.Real,
        Variability.Parameter,
        Causality.Local,
        reg.K,
      );
      dae.addEquation(EqKind.Simple, dae.addName(kVar), dae.addRealLiteral(reg.K));

      const nVar = dae.addVariable(
        `n_${s.id}_${reg.regulatorId}_${idx}`,
        VarType.Real,
        Variability.Parameter,
        Causality.Local,
        reg.n,
      );
      dae.addEquation(EqKind.Simple, dae.addName(nVar), dae.addRealLiteral(reg.n));

      const pPow = addPow(dae.addName(regVar), dae.addName(nVar));
      const kPow = addPow(dae.addName(kVar), dae.addName(nVar));
      const denom = addAdd(kPow, pPow);

      const term = reg.role === "activator" ? addDiv(pPow, denom) : addDiv(kPow, denom);
      hillFactorExpr = addMul(hillFactorExpr, term);
    }

    const synthVar = dae.addVariable(`v_synth_${s.id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const synthExpr = addAdd(dae.addName(alpha0Var), addMul(dae.addName(alphaVar), hillFactorExpr));
    dae.addEquation(EqKind.Simple, dae.addName(synthVar), synthExpr);

    const degTerm = addMul(dae.addName(gammaVar), dae.addName(pVar));
    const rhs = addSub(dae.addName(synthVar), degTerm);
    dae.addEquation(EqKind.Simple, dae.addDer(pVar), rhs);
  }

  return dae;
}
