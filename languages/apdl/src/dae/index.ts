// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { ensureBuiltInApdlLibraryRegistered } from "../catalog/library-package-adapter.js";
import { solveApdlModal, solveApdlStatic } from "../solver/fea-solver.js";
import { expandApdlMacros } from "../solver/macro-expander.js";
import type { ApdlModel } from "../types.js";

export interface ApdlDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  numModes?: number | undefined;
  dampingRatio?: number | undefined;
}

/**
 * Lowers an ANSYS APDL structural model directly into ModelScript's zero-GC
 * WebAssembly `DAEBuilder` struct-of-arrays arena.
 *
 * Emits:
 * - Material & geometric parameters (`EX`, `PRXY`, `DENS`, plus user APDL parameters)
 * - Static equilibrium variables & equations (`u_<node>_<dof>` and `StrainEnergy`, `MaxDisplacement`)
 * - Second-order modal dynamics ODEs (`der(q_r) = v_r`, `der(v_r) = Q_r - 2*zeta*omega_r*v_r - omega_r^2*q_r`)
 */
export function apdlToDae(sourceOrModel: string | ApdlModel, options?: ApdlDaeOptions): DAEBuilder {
  ensureBuiltInApdlLibraryRegistered();
  const model = typeof sourceOrModel === "string" ? expandApdlMacros(sourceOrModel) : sourceOrModel;

  const modelName =
    (options?.modelName ?? model.title ?? "ApdlStructure").replace(/[^a-zA-Z0-9_]/g, "_") || "ApdlStructure";
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const zeta = options?.dampingRatio ?? 0.02;
  const requestedModes = options?.numModes ?? Math.min(model.numModes || 3, 4);

  // 1. Emit APDL material parameters
  for (const [matId, mat] of model.materials.entries()) {
    if (mat.EX !== undefined) {
      dae.addVariable(`MAT${matId}_EX`, VarType.Real, Variability.Parameter, Causality.Local, mat.EX);
    }
    if (mat.PRXY !== undefined) {
      dae.addVariable(`MAT${matId}_PRXY`, VarType.Real, Variability.Parameter, Causality.Local, mat.PRXY);
    }
    if (mat.DENS !== undefined) {
      dae.addVariable(`MAT${matId}_DENS`, VarType.Real, Variability.Parameter, Causality.Local, mat.DENS);
    }
  }

  // 2. Emit scalar structural outputs
  const strainEnergyVar = dae.addVariable("StrainEnergy", VarType.Real, Variability.Continuous, Causality.Output, 0.0);
  const maxDispVar = dae.addVariable("MaxDisplacement", VarType.Real, Variability.Continuous, Causality.Output, 0.0);

  // 3. Solve static equilibrium (if constrained) to bind static equilibrium equations
  let staticSol = undefined;
  if (model.elements.size > 0 && model.constraints.length > 0) {
    try {
      staticSol = solveApdlStatic(model);
    } catch {
      staticSol = undefined;
    }
  }

  if (staticSol) {
    dae.addEquation(EqKind.Simple, maxDispVar, dae.addRealLiteral(staticSol.maxDisplacement));
    let count = 0;
    for (const [nodeId, disp] of staticSol.displacements.entries()) {
      if (count++ >= 16) break;
      const uxVar = dae.addVariable(`N${nodeId}_UX`, VarType.Real, Variability.Continuous, Causality.Output, disp.ux);
      const uyVar = dae.addVariable(`N${nodeId}_UY`, VarType.Real, Variability.Continuous, Causality.Output, disp.uy);
      const rotzVar = dae.addVariable(
        `N${nodeId}_ROTZ`,
        VarType.Real,
        Variability.Continuous,
        Causality.Output,
        disp.rotz,
      );
      dae.addEquation(EqKind.Simple, uxVar, dae.addRealLiteral(disp.ux));
      dae.addEquation(EqKind.Simple, uyVar, dae.addRealLiteral(disp.uy));
      dae.addEquation(EqKind.Simple, rotzVar, dae.addRealLiteral(disp.rotz));
    }
  } else {
    dae.addEquation(EqKind.Simple, maxDispVar, dae.addRealLiteral(0.0));
  }

  // 4. Lower modal structural dynamics: q_r'' + 2*zeta*omega_r*q_r' + omega_r^2*q_r = Q_r
  let omegas: number[] = [];
  if (model.elements.size > 0 && model.constraints.length > 0) {
    try {
      const modalSol = solveApdlModal(model, requestedModes);
      omegas = modalSol.modes.map((m) => m.omega);
    } catch {
      omegas = [];
    }
  }
  if (omegas.length === 0) {
    for (let r = 0; r < requestedModes; r++) {
      omegas.push(2 * Math.PI * 10 * (r + 1));
    }
  }

  let energyExpr: number | null = null;
  for (let r = 0; r < omegas.length; r++) {
    const omega = omegas[r]!;
    const omega2 = omega * omega;
    const dampCoeff = 2.0 * zeta * omega;

    const qVar = dae.addVariable(`q_${r + 1}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const vVar = dae.addVariable(`v_${r + 1}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const qForceVar = dae.addVariable(`Q_${r + 1}`, VarType.Real, Variability.Continuous, Causality.Input, 0.0);

    // der(q_r) = v_r
    dae.addEquation(EqKind.Simple, dae.addDer(qVar), vVar);

    // der(v_r) = Q_r - (2*zeta*omega_r*v_r + omega_r^2*q_r)
    const dampTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(dampCoeff), vVar);
    const stiffTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(omega2), qVar);
    const restoring = dae.addBinaryExpr(BinOp.Add, dampTerm, stiffTerm);
    const netAccel = dae.addBinaryExpr(BinOp.Sub, qForceVar, restoring);
    dae.addEquation(EqKind.Simple, dae.addDer(vVar), netAccel);

    // Modal strain energy contribution: 0.5 * omega_r^2 * q_r^2
    const qSq = dae.addBinaryExpr(BinOp.Mul, qVar, qVar);
    const modeEnergy = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.5 * omega2), qSq);
    energyExpr = energyExpr === null ? modeEnergy : dae.addBinaryExpr(BinOp.Add, energyExpr, modeEnergy);
  }

  dae.addEquation(EqKind.Simple, strainEnergyVar, energyExpr ?? dae.addRealLiteral(0.0));
  return dae;
}
