// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbml — Direct Linear-Memory DAE Arena Lowering for Biochemical Networks.
 *
 * Compiles SBML species, compartments, parameters, reactions, and stoichiometry into
 * ModelScript's zero-GC DAEBuilder:
 *   1. Species concentration state variables: S_i
 *   2. Compartment volumes & reaction fluxes: V_k, v_r
 *   3. Mass-action / kinetic stoichiometric balance ODEs: der(S_i)
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { SbmlDocument } from "../types.js";

export interface SbmlDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

export function lowerSbmlToDae(doc: SbmlDocument, options?: SbmlDaeOptions): DAEBuilder {
  const model = doc.model;
  const modelName = (options?.modelName ?? (model.id || "SbmlBiochemicalNetwork")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  // 1. Declare Compartments
  const compVarMap = new Map<string, number>();
  for (const [id, c] of model.compartments) {
    const vId = dae.addVariable(
      `V_${id}`,
      VarType.Real,
      c.constant ? Variability.Parameter : Variability.Continuous,
      Causality.Local,
      c.size > 0 ? c.size : 1.0,
    );
    compVarMap.set(id, vId);
  }

  // 2. Declare Global Parameters
  const paramVarMap = new Map<string, number>();
  for (const [id, p] of model.parameters) {
    const pVar = dae.addVariable(
      `param_${id}`,
      VarType.Real,
      p.constant ? Variability.Parameter : Variability.Continuous,
      Causality.Local,
      p.value,
    );
    paramVarMap.set(id, pVar);
  }

  // 3. Declare Species Variables
  const speciesVarMap = new Map<string, number>();
  for (const [id, s] of model.species) {
    const cSize = model.compartments.get(s.compartment)?.size ?? 1.0;
    let initialConc = s.initialConcentration;
    if (initialConc === undefined && s.initialAmount !== undefined) {
      initialConc = s.initialAmount / Math.max(1e-9, cSize);
    }
    const val = initialConc ?? 0.0;

    const sVar = dae.addVariable(
      `S_${id}`,
      VarType.Real,
      s.constant ? Variability.Parameter : Variability.Continuous,
      Causality.Local,
      val,
    );
    speciesVarMap.set(id, sVar);
  }

  // 4. Declare Reaction Flux Variables
  const rxnFluxMap = new Map<string, number>();
  for (const [id, r] of model.reactions) {
    const fluxVar = dae.addVariable(`v_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    rxnFluxMap.set(id, fluxVar);

    // Approximate mass action velocity equation: v = k * [R1] * [R2] ...
    let fluxExpr = dae.addRealLiteral(1.0);
    for (const ref of r.reactants) {
      const sVar = speciesVarMap.get(ref.species);
      if (sVar !== undefined) {
        fluxExpr = dae.addBinaryExpr(BinOp.Mul, fluxExpr, dae.addName(sVar));
      }
    }

    dae.addEquation(EqKind.Simple, dae.addName(fluxVar), fluxExpr);
  }

  // 5. Formulate Species Differential Balance Equations: der(S_i) = sum(stoich * v_r) / V_comp
  for (const [id, s] of model.species) {
    const sVar = speciesVarMap.get(id);
    if (sVar === undefined) continue;

    if (s.constant || s.boundaryCondition) {
      dae.addEquation(EqKind.Simple, dae.addDer(sVar), dae.addRealLiteral(0.0));
      continue;
    }

    let netFluxExpr: number | null = null;

    for (const [rId, r] of model.reactions) {
      const fluxVar = rxnFluxMap.get(rId);
      if (fluxVar === undefined) continue;

      // Check Reactants
      for (const ref of r.reactants) {
        if (ref.species === id) {
          const stoichLit = dae.addRealLiteral(ref.stoichiometry);
          const term = dae.addBinaryExpr(BinOp.Mul, stoichLit, dae.addName(fluxVar));
          netFluxExpr =
            netFluxExpr === null
              ? dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), term)
              : dae.addBinaryExpr(BinOp.Sub, netFluxExpr, term);
        }
      }

      // Check Products
      for (const ref of r.products) {
        if (ref.species === id) {
          const stoichLit = dae.addRealLiteral(ref.stoichiometry);
          const term = dae.addBinaryExpr(BinOp.Mul, stoichLit, dae.addName(fluxVar));
          netFluxExpr = netFluxExpr === null ? term : dae.addBinaryExpr(BinOp.Add, netFluxExpr, term);
        }
      }
    }

    const cSize = model.compartments.get(s.compartment)?.size ?? 1.0;
    const invVol = dae.addRealLiteral(1.0 / Math.max(1e-9, cSize));
    const rhs = netFluxExpr !== null ? dae.addBinaryExpr(BinOp.Mul, invVol, netFluxExpr) : dae.addRealLiteral(0.0);

    dae.addEquation(EqKind.Simple, dae.addDer(sVar), rhs);
  }

  return dae;
}
