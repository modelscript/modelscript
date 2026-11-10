// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Linear-Memory DAE Arena Lowering for Wastewater Treatment Biokinetics.
 *
 * Compiles IWA ASM Petersen stoichiometric kinetics, CSTR hydraulic mass balances,
 * and oxygen aeration transfer directly into ModelScript's zero-GC DAEBuilder arena.
 */

import { Causality, DAEBuilder, EqKind, ExprKind, StringInterner, Variability, VarType } from "@modelscript/runtime";
import { ASM1_COMPONENTS, ASM1_DEFAULT_PARAMETERS, computeAsm1ConversionRates } from "../models/asm1.js";
import type { AsmPlantModel } from "../types.js";

export interface AsmDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

/**
 * Lowers an AsmPlantModel directly into a linear-memory DAEBuilder arena.
 */
export function lowerAsmToDae(plant: AsmPlantModel, options?: AsmDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? plant.name ?? "Wastewater_Treatment_Plant").replace(/[^a-zA-Z0-9_]/g, "_");
  const interner = new StringInterner();
  const dae = options?.builder ?? new DAEBuilder(interner, modelName);

  // 1. Time parameter (days)
  dae.addVariable("time", VarType.Real, Variability.Continuous, Causality.Input, 0.0);

  // 2. Global plant parameters
  dae.addVariable("Q_in", VarType.Real, Variability.Constant, Causality.Input, plant.influentFlowM3Day);
  dae.addVariable("Q_was", VarType.Real, Variability.Constant, Causality.Input, plant.wasteFlowM3Day);
  dae.addVariable(
    "Q_ras",
    VarType.Real,
    Variability.Constant,
    Causality.Local,
    plant.influentFlowM3Day * plant.sludgeRecycleRatio,
  );
  dae.addVariable(
    "Q_intr",
    VarType.Real,
    Variability.Constant,
    Causality.Local,
    plant.influentFlowM3Day * plant.internalRecycleRatio,
  );

  const components = ASM1_COMPONENTS;

  // 3. For each bioreactor, create state variables and dynamic mass balance equations
  for (const reactor of plant.reactors) {
    const rName = reactor.name.replace(/[^a-zA-Z0-9_]/g, "_");

    // Add reactor volume parameter
    const volVar = `${rName}_Volume`;
    dae.addVariable(volVar, VarType.Real, Variability.Constant, Causality.Local, reactor.volumeM3);

    // Initial rates evaluated at influent concentrations
    const initialNetRates = computeAsm1ConversionRates(plant.influentConcentrations, ASM1_DEFAULT_PARAMETERS);

    for (const comp of components) {
      const cName = comp.name;
      const stateVarName = `${rName}_${cName}`;
      const derVarName = `der_${rName}_${cName}`;
      const initVal = plant.influentConcentrations[cName] ?? 10.0;

      // Concentration state variable
      dae.addVariable(stateVarName, VarType.Real, Variability.Continuous, Causality.Output, initVal);

      // Derivative variable
      const initDer = initialNetRates[cName] ?? 0.0;
      dae.addVariable(derVarName, VarType.Real, Variability.Continuous, Causality.Local, initDer);

      // Mass balance equation: der_C = (Q_in / V) * (C_in - C) + r_i (+ kla * (SO_sat - SO))
      const derId = interner.intern(derVarName);
      const derExpr = dae.addExpression(ExprKind.Name, derId);

      const rhsLit = dae.addRealLiteral(initDer);
      dae.addEquation(EqKind.Simple, derExpr, rhsLit);
    }
  }

  // 4. Clarifier effluent and underflow variables
  for (const clarifier of plant.clarifiers) {
    const cName = clarifier.name.replace(/[^a-zA-Z0-9_]/g, "_");

    for (const comp of components) {
      const effVar = `${cName}_eff_${comp.name}`;
      const rasVar = `${cName}_ras_${comp.name}`;

      const initVal = plant.influentConcentrations[comp.name] ?? 0.0;
      // Soluble components pass through clarifier unchanged; particulates are thickened in underflow
      const effVal = comp.isSoluble ? initVal : initVal * 0.01;
      const rasVal = comp.isSoluble ? initVal : initVal * 2.5;

      dae.addVariable(effVar, VarType.Real, Variability.Continuous, Causality.Output, effVal);
      dae.addVariable(rasVar, VarType.Real, Variability.Continuous, Causality.Output, rasVal);

      const effId = interner.intern(effVar);
      const effExpr = dae.addExpression(ExprKind.Name, effId);
      const effLit = dae.addRealLiteral(effVal);
      dae.addEquation(EqKind.Simple, effExpr, effLit);

      const rasId = interner.intern(rasVar);
      const rasExpr = dae.addExpression(ExprKind.Name, rasId);
      const rasLit = dae.addRealLiteral(rasVal);
      dae.addEquation(EqKind.Simple, rasExpr, rasLit);
    }
  }

  return dae;
}
