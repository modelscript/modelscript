// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/touchstone — Direct Linear-Memory DAE Arena Lowering for N-Port Networks.
 *
 * Compiles Touchstone N-port scattering/admittance matrices into rational pole-residue
 * companion state-space differential algebraic equations in ModelScript's zero-GC DAEBuilder:
 *   1. Port voltage variables v_1, ..., v_N
 *   2. Port current variables i_1, ..., i_N
 *   3. Rational internal state variables x_1, ..., x_M (where M = order * N)
 *   4. State evolution equations der(x_k) = A[k][k] * x_k + B[k] * v_p
 *   5. Nodal current equations i_p = sum(C[p][k] * x_k) + D[p][p] * v_p
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { fitStateSpaceModel } from "../solvers/vector-fitting.js";
import type { TouchstoneDeck } from "../types.js";

export interface TouchstoneDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  macromodelOrder?: number | undefined;
}

export function lowerTouchstoneToDae(deck: TouchstoneDeck, options?: TouchstoneDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? "NPortMacromodel").replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);
  const numPorts = deck.numPorts;
  const order = options?.macromodelOrder ?? 2;

  // Fit rational state-space macromodel
  const ss = fitStateSpaceModel(deck, order);
  const z0 = deck.options.referenceResistance || 50.0;

  // 1. Declare Port reference impedance parameters
  for (let p = 1; p <= numPorts; p++) {
    dae.addVariable(`R_ref_${p}`, VarType.Real, Variability.Parameter, Causality.Local, z0);
  }

  // 2. Declare Port voltages and currents
  for (let p = 1; p <= numPorts; p++) {
    dae.addVariable(`v_${p}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable(`i_${p}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  }

  // 3. Declare internal macromodel state variables
  const totalStates = ss.order * numPorts;
  for (let s = 1; s <= totalStates; s++) {
    dae.addVariable(`x_${s}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  }

  // 4. Construct state differential equations: der(x_k) = A_k * x_k + B_k * v_p
  for (let s = 0; s < totalStates; s++) {
    const stateVar = dae.lookupVariable(`x_${s + 1}`);
    const portIdx = Math.floor(s / ss.order) + 1;
    const vPortVar = dae.lookupVariable(`v_${portIdx}`);

    if (stateVar !== -1 && vPortVar !== -1) {
      const aVal = ss.A[s]![s]!;
      const bVal = ss.B[s]![portIdx - 1]!;

      // der(x_s) on LHS
      const derX = dae.addDer(stateVar);
      // A * x + B * v on RHS
      const aTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(aVal), dae.addName(stateVar));
      const bTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(bVal), dae.addName(vPortVar));
      const rhs = dae.addBinaryExpr(BinOp.Add, aTerm, bTerm);

      dae.addEquation(EqKind.Simple, derX, rhs);
    }
  }

  // 5. Construct port current algebraic equations: i_p = sum(C[p][k] * x_k) + D[p][p] * v_p
  for (let p = 0; p < numPorts; p++) {
    const portNum = p + 1;
    const iVar = dae.lookupVariable(`i_${portNum}`);
    const vVar = dae.lookupVariable(`v_${portNum}`);

    if (iVar !== -1 && vVar !== -1) {
      // Direct term D * v
      const dVal = ss.D[p]?.[p] ?? 0.0;
      let rhs = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(dVal), dae.addName(vVar));

      // Sum C_pk * x_k
      for (let s = 0; s < totalStates; s++) {
        const cVal = ss.C[p]![s]!;
        if (Math.abs(cVal) > 1e-12) {
          const sVar = dae.lookupVariable(`x_${s + 1}`);
          if (sVar !== -1) {
            const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cVal), dae.addName(sVar));
            rhs = dae.addBinaryExpr(BinOp.Add, rhs, term);
          }
        }
      }

      dae.addEquation(EqKind.Simple, dae.addName(iVar), rhs);
    }
  }

  return dae;
}
