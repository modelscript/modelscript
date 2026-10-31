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

  // 1. Declare Port reference impedance parameters and parameter bindings
  for (let p = 1; p <= numPorts; p++) {
    const rRefVar = dae.addVariable(`R_ref_${p}`, VarType.Real, Variability.Parameter, Causality.Local, z0);
    dae.addEquation(EqKind.Simple, dae.addName(rRefVar), dae.addRealLiteral(z0));
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

  // 4. Construct full state differential equations: der(x_s) = sum_k(A[s][k] * x_k) + sum_q(B[s][q] * v_{q+1})
  for (let s = 0; s < totalStates; s++) {
    const stateVar = dae.lookupVariable(`x_${s + 1}`);
    if (stateVar === -1) continue;

    let rhs: number | null = null;
    for (let k = 0; k < totalStates; k++) {
      const aVal = ss.A[s]?.[k] ?? 0.0;
      if (Math.abs(aVal) > 1e-15 || k === s) {
        const xkVar = dae.lookupVariable(`x_${k + 1}`);
        if (xkVar !== -1) {
          const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(aVal), dae.addName(xkVar));
          rhs = rhs === null ? term : dae.addBinaryExpr(BinOp.Add, rhs, term);
        }
      }
    }

    for (let q = 0; q < numPorts; q++) {
      const bVal = ss.B[s]?.[q] ?? 0.0;
      if (Math.abs(bVal) > 1e-15) {
        const vPortVar = dae.lookupVariable(`v_${q + 1}`);
        if (vPortVar !== -1) {
          const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(bVal), dae.addName(vPortVar));
          rhs = rhs === null ? term : dae.addBinaryExpr(BinOp.Add, rhs, term);
        }
      }
    }

    const derX = dae.addDer(stateVar);
    dae.addEquation(EqKind.Simple, derX, rhs ?? dae.addRealLiteral(0.0));
  }

  // 5. Construct port current algebraic equations: i_p = sum_q(D[p][q] * v_{q+1}) + sum_s(C[p][s] * x_{s+1})
  // and reference port termination equations: v_p = -R_ref_p * i_p
  for (let p = 0; p < numPorts; p++) {
    const portNum = p + 1;
    const iVar = dae.lookupVariable(`i_${portNum}`);
    const vVar = dae.lookupVariable(`v_${portNum}`);
    const rRefVar = dae.lookupVariable(`R_ref_${portNum}`);

    if (iVar !== -1 && vVar !== -1) {
      let rhs: number | null = null;
      for (let q = 0; q < numPorts; q++) {
        const dVal = ss.D[p]?.[q] ?? 0.0;
        if (Math.abs(dVal) > 1e-15 || q === p) {
          const vqVar = dae.lookupVariable(`v_${q + 1}`);
          if (vqVar !== -1) {
            const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(dVal), dae.addName(vqVar));
            rhs = rhs === null ? term : dae.addBinaryExpr(BinOp.Add, rhs, term);
          }
        }
      }

      for (let s = 0; s < totalStates; s++) {
        const cVal = ss.C[p]![s]!;
        if (Math.abs(cVal) > 1e-15) {
          const sVar = dae.lookupVariable(`x_${s + 1}`);
          if (sVar !== -1) {
            const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cVal), dae.addName(sVar));
            rhs = rhs === null ? term : dae.addBinaryExpr(BinOp.Add, rhs, term);
          }
        }
      }

      dae.addEquation(EqKind.Simple, dae.addName(iVar), rhs ?? dae.addRealLiteral(0.0));

      // Port reference termination: v_p = -R_ref_p * i_p
      const rTerm = rRefVar !== -1 ? dae.addName(rRefVar) : dae.addRealLiteral(z0);
      const negRI = dae.addBinaryExpr(
        BinOp.Sub,
        dae.addRealLiteral(0.0),
        dae.addBinaryExpr(BinOp.Mul, rTerm, dae.addName(iVar)),
      );
      dae.addEquation(EqKind.Simple, dae.addName(vVar), negRI);
    }
  }

  return dae;
}
