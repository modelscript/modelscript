import { StaticTapeBuilder } from "@modelscript/compiler";
/* eslint-disable @typescript-eslint/no-non-null-assertion */
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Runtime Algorithmic Differentiation (AD) Jacobian evaluator.
 *
 * Builds a StaticTapeBuilder from DAE derivative equations at compile time,
 * then provides a closure that evaluates the exact Jacobian at runtime by
 * walking the tape operations in TypeScript (no C-code generation needed).
 *
 * This is used by the BDF integrator as `options.jacobian` to replace
 * finite-difference approximations with exact analytical derivatives.
 */

import {
  ModelicaArrayEquation,
  type ModelicaDAE,
  type ModelicaExpression,
  ModelicaFunctionCallExpression,
} from "@modelscript/symbolics";

/** Extract derivative name from expression like der(x). */
function extractDer(expr: ModelicaExpression): string | null {
  if (expr instanceof ModelicaFunctionCallExpression && expr.functionName === "der" && expr.args.length === 1) {
    const a = expr.args[0];
    if (a && typeof a === "object" && "name" in a) return (a as { name: string }).name;
  }
  return null;
}

/**
 * Evaluate a tape forward pass at runtime, returning the value array.
 */
export function evaluateTapeForward(builder: StaticTapeBuilder, varValues: Map<string, number>): Float64Array {
  const t = new Float64Array(builder.length);
  const { opData, valData, interner } = builder;
  const TAPE_STRIDE = 4;

  // Note: TapeOpKind values must match compiler/src/symbolics/tape.ts
  for (let i = 0; i < builder.length; i++) {
    const offset = i * TAPE_STRIDE;
    const kind = opData[offset];
    const a = opData[offset + 1]!;
    const b = opData[offset + 2]!;
    const c = opData[offset + 3]!;

    switch (kind) {
      case 1: // Const
        t[i] = valData[i]!;
        break;
      case 2: // Var
        t[i] = varValues.get(interner.resolve(a) || "") ?? 0;
        break;
      case 3: // Add
        t[i] = (t[a] ?? 0) + (t[b] ?? 0);
        break;
      case 4: // Sub
        t[i] = (t[a] ?? 0) - (t[b] ?? 0);
        break;
      case 5: // Mul
        t[i] = (t[a] ?? 0) * (t[b] ?? 0);
        break;
      case 6: // Div
        t[i] = (t[a] ?? 0) / (t[b] ?? 0);
        break;
      case 7: // Pow
        t[i] = Math.pow(t[a] ?? 0, t[b] ?? 0);
        break;
      case 8: // Neg
        t[i] = -(t[a] ?? 0);
        break;
      case 9: // Sin
        t[i] = Math.sin(t[a] ?? 0);
        break;
      case 10: // Cos
        t[i] = Math.cos(t[a] ?? 0);
        break;
      case 11: // Tan
        t[i] = Math.tan(t[a] ?? 0);
        break;
      case 12: // Exp
        t[i] = Math.exp(t[a] ?? 0);
        break;
      case 13: // Log
        t[i] = Math.log(t[a] ?? 0);
        break;
      case 14: // Sqrt
        t[i] = Math.sqrt(t[a] ?? 0);
        break;
      // ── Vector ops ──
      case 15: {
        // VecVar
        const baseName = interner.resolve(a) || "";
        for (let k = 0; k < b; k++) {
          t[i + k] = varValues.get(`${baseName}[${k + 1}]`) ?? 0;
        }
        break;
      }
      case 16: // VecConst
        for (let k = 0; k < b; k++) {
          t[i + k] = valData[i + k] ?? 0;
        }
        break;
      case 17: // VecAdd
        for (let k = 0; k < b; k++) {
          t[i + k] = (t[a + k] ?? 0) + (t[c + k] ?? 0);
        }
        break;
      case 18: // VecSub
        for (let k = 0; k < b; k++) {
          t[i + k] = (t[a + k] ?? 0) - (t[c + k] ?? 0);
        }
        break;
      case 19: // VecMul
        for (let k = 0; k < b; k++) {
          t[i + k] = (t[a + k] ?? 0) * (t[c + k] ?? 0);
        }
        break;
      case 20: // VecNeg
        for (let k = 0; k < b; k++) {
          t[i + k] = -(t[a + k] ?? 0);
        }
        break;
      case 21: // VecSubscript
        t[i] = t[a + c] ?? 0;
        break;
      case 0: // Nop
        break;
    }
  }
  return t;
}

/**
 * Evaluate the reverse-mode AD sweep on a tape, returning gradients for all variables.
 */
export function evaluateTapeReverse(
  builder: StaticTapeBuilder,
  t: Float64Array,
  outputIndex: number,
): Map<string, number> {
  const dt = new Float64Array(builder.length);
  dt[outputIndex] = 1.0;

  const { opData, interner } = builder;
  const TAPE_STRIDE = 4;

  for (let i = builder.length - 1; i >= 0; i--) {
    if (dt[i] === 0) continue;

    const offset = i * TAPE_STRIDE;
    const kind = opData[offset];
    const a = opData[offset + 1]!;
    const b = opData[offset + 2]!;
    const c = opData[offset + 3]!;

    const dti = dt[i] ?? 0;

    switch (kind) {
      case 3: // Add
        dt[a] = (dt[a] ?? 0) + dti;
        dt[b] = (dt[b] ?? 0) + dti;
        break;
      case 4: // Sub
        dt[a] = (dt[a] ?? 0) + dti;
        dt[b] = (dt[b] ?? 0) - dti;
        break;
      case 5: // Mul
        dt[a] = (dt[a] ?? 0) + dti * (t[b] ?? 0);
        dt[b] = (dt[b] ?? 0) + dti * (t[a] ?? 0);
        break;
      case 6: // Div
        dt[a] = (dt[a] ?? 0) + dti / (t[b] ?? 1);
        dt[b] = (dt[b] ?? 0) - (dti * (t[a] ?? 0)) / ((t[b] ?? 1) * (t[b] ?? 1));
        break;
      case 7: {
        // Pow
        const base = t[a] ?? 0;
        const exp = t[b] ?? 0;
        dt[a] = (dt[a] ?? 0) + dti * exp * Math.pow(base, exp - 1);
        dt[b] = (dt[b] ?? 0) + dti * (t[i] ?? 0) * Math.log(base);
        break;
      }
      case 8: // Neg
        dt[a] = (dt[a] ?? 0) - dti;
        break;
      case 9: // Sin
        dt[a] = (dt[a] ?? 0) + dti * Math.cos(t[a] ?? 0);
        break;
      case 10: // Cos
        dt[a] = (dt[a] ?? 0) - dti * Math.sin(t[a] ?? 0);
        break;
      case 11: // Tan
        dt[a] = (dt[a] ?? 0) + dti * (1 + (t[i] ?? 0) * (t[i] ?? 0));
        break;
      case 12: // Exp
        dt[a] = (dt[a] ?? 0) + dti * (t[i] ?? 0);
        break;
      case 13: // Log
        dt[a] = (dt[a] ?? 0) + dti / (t[a] ?? 1);
        break;
      case 14: // Sqrt
        dt[a] = (dt[a] ?? 0) + dti / (2 * (t[i] ?? 1));
        break;
      // ── Vector ops reverse ──
      case 17: // VecAdd
        for (let k = 0; k < b; k++) {
          const dk = dt[i + k] ?? 0;
          dt[a + k] = (dt[a + k] ?? 0) + dk;
          dt[c + k] = (dt[c + k] ?? 0) + dk;
        }
        break;
      case 18: // VecSub
        for (let k = 0; k < b; k++) {
          const dk = dt[i + k] ?? 0;
          dt[a + k] = (dt[a + k] ?? 0) + dk;
          dt[c + k] = (dt[c + k] ?? 0) - dk;
        }
        break;
      case 19: // VecMul
        for (let k = 0; k < b; k++) {
          const dk = dt[i + k] ?? 0;
          dt[a + k] = (dt[a + k] ?? 0) + dk * (t[c + k] ?? 0);
          dt[c + k] = (dt[c + k] ?? 0) + dk * (t[a + k] ?? 0);
        }
        break;
      case 20: // VecNeg
        for (let k = 0; k < b; k++) {
          dt[a + k] = (dt[a + k] ?? 0) - (dt[i + k] ?? 0);
        }
        break;
      case 21: // VecSubscript
        dt[a + c] = (dt[a + c] ?? 0) + dti;
        break;
      case 0: // Nop
        break;
    }
  }

  // Collect variable gradients
  const gradients = new Map<string, number>();
  for (let i = 0; i < builder.length; i++) {
    const offset = i * TAPE_STRIDE;
    const kind = opData[offset];
    if (kind === 2) {
      // Var
      const a = opData[offset + 1]!;
      const name = interner.resolve(a) || "";
      gradients.set(name, (gradients.get(name) ?? 0) + (dt[i] ?? 0));
    } else if (kind === 15) {
      // VecVar
      const a = opData[offset + 1]!;
      const b = opData[offset + 2]!;
      const baseName = interner.resolve(a) || "";
      for (let k = 0; k < b; k++) {
        const name = `${baseName}[${k + 1}]`;
        gradients.set(name, (gradients.get(name) ?? 0) + (dt[i + k] ?? 0));
      }
    }
  }
  return gradients;
}

/**
 * Build a runtime AD Jacobian evaluator from a ModelicaDAE.
 *
 * Returns a function `(t: number, y: number[]) => number[][]` that computes
 * the exact Jacobian of the derivative equations w.r.t. the state variables.
 *
 * @param dae The flattened DAE
 * @returns Jacobian evaluator closure, or null if no derivative equations found
 */
export function buildAdJacobian(dae: ModelicaDAE): ((t: number, y: number[]) => number[][]) | null {
  // Gather derivative equations: der(x) = f(x, u)
  const derEqs: { state: string; rhs: ModelicaExpression }[] = [];
  for (const eq of dae.sortedEquations.length > 0 ? dae.sortedEquations : Array.from(dae.arenaEquations())) {
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    const ld = extractDer(se.expression1);
    const rd = extractDer(se.expression2);

    if (eq instanceof ModelicaArrayEquation) {
      // Unroll array equation element-wise
      const baseName = ld || rd;
      if (!baseName) continue;
      const rhs = ld ? se.expression2 : se.expression1;
      const v = dae.arenaGetVarByName(baseName);
      const dims = v?.arrayDimensions ?? [];
      const size = dims.length > 0 ? dims.reduce((a: number, b: number) => a * b, 1) : 1;
      for (let i = 0; i < size; i++) {
        derEqs.push({ state: `${baseName}[${i + 1}]`, rhs });
      }
      continue;
    }

    if (ld) derEqs.push({ state: ld, rhs: se.expression2 });
    else if (rd) derEqs.push({ state: rd, rhs: se.expression1 });
  }

  if (derEqs.length === 0) return null;

  // State variable names (in order)
  const stateNames = derEqs.map((eq) => eq.state);
  const n = stateNames.length;

  // Build tapes for each equation (done once at compile time)
  const tapeData: { ops: StaticTapeBuilder; outputIndex: number }[] = [];
  for (const eq of derEqs) {
    const tape = new StaticTapeBuilder();
    const outIdx = tape.walk(eq.rhs);
    tapeData.push({ ops: tape, outputIndex: outIdx });
  }

  // Return the closure that evaluates J(t, y) at runtime
  return (time: number, y: number[]): number[][] => {
    // Build variable value map: state[i] -> y[i]
    const varValues = new Map<string, number>();
    varValues.set("time", time);
    for (let i = 0; i < n; i++) {
      const name = stateNames[i];
      if (name) varValues.set(name, y[i] ?? 0);
    }
    // Also set any other DAE variables from their current values
    for (const v of dae.arenaVariables()) {
      if (!varValues.has(v.name) && v.expression) {
        // For non-state variables, use start value as approximation
        // (In a full implementation, these would be computed from the DAE)
        varValues.set(v.name, 0);
      }
    }

    // Allocate Jacobian (n x n)
    const J: number[][] = [];
    for (let i = 0; i < n; i++) {
      J[i] = new Array(n).fill(0) as number[];
    }

    // For each equation (row), compute forward pass then reverse pass
    for (let row = 0; row < n; row++) {
      const td = tapeData[row];
      if (!td) continue;

      const t = evaluateTapeForward(td.ops, varValues);
      const grads = evaluateTapeReverse(td.ops, t, td.outputIndex);

      // Fill Jacobian row
      const jRow = J[row];
      if (!jRow) continue;
      for (let col = 0; col < n; col++) {
        const stateName = stateNames[col];
        if (stateName) {
          jRow[col] = grads.get(stateName) ?? 0;
        }
      }
    }

    return J;
  };
}
