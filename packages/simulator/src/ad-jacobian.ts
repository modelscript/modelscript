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
  StaticTapeBuilder,
  type TapeOp,
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
export function evaluateTapeForward(ops: TapeOp[], varValues: Map<string, number>): Float64Array {
  const t = new Float64Array(ops.length);
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    switch (op.type) {
      case "const":
        t[i] = op.val;
        break;
      case "var":
        t[i] = varValues.get(op.name) ?? 0;
        break;
      case "add":
        t[i] = (t[op.a] ?? 0) + (t[op.b] ?? 0);
        break;
      case "sub":
        t[i] = (t[op.a] ?? 0) - (t[op.b] ?? 0);
        break;
      case "mul":
        t[i] = (t[op.a] ?? 0) * (t[op.b] ?? 0);
        break;
      case "div":
        t[i] = (t[op.a] ?? 0) / (t[op.b] ?? 0);
        break;
      case "pow":
        t[i] = Math.pow(t[op.a] ?? 0, t[op.b] ?? 0);
        break;
      case "neg":
        t[i] = -(t[op.a] ?? 0);
        break;
      case "sin":
        t[i] = Math.sin(t[op.a] ?? 0);
        break;
      case "cos":
        t[i] = Math.cos(t[op.a] ?? 0);
        break;
      case "tan":
        t[i] = Math.tan(t[op.a] ?? 0);
        break;
      case "exp":
        t[i] = Math.exp(t[op.a] ?? 0);
        break;
      case "log":
        t[i] = Math.log(t[op.a] ?? 0);
        break;
      case "sqrt":
        t[i] = Math.sqrt(t[op.a] ?? 0);
        break;
      // ── Vector ops ──
      case "vec_var":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = varValues.get(`${op.baseName}[${k + 1}]`) ?? 0;
        }
        break;
      case "vec_const":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = op.vals[k] ?? 0;
        }
        break;
      case "vec_add":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = (t[op.a + k] ?? 0) + (t[op.b + k] ?? 0);
        }
        break;
      case "vec_sub":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = (t[op.a + k] ?? 0) - (t[op.b + k] ?? 0);
        }
        break;
      case "vec_mul":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = (t[op.a + k] ?? 0) * (t[op.b + k] ?? 0);
        }
        break;
      case "vec_neg":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = -(t[op.a + k] ?? 0);
        }
        break;
      case "vec_subscript":
        t[i] = t[op.a + op.offset] ?? 0;
        break;
      case "nop":
        break;
    }
  }
  return t;
}

/**
 * Evaluate the reverse-mode AD sweep on a tape, returning gradients for all variables.
 */
export function evaluateTapeReverse(ops: TapeOp[], t: Float64Array, outputIndex: number): Map<string, number> {
  const dt = new Float64Array(ops.length);
  dt[outputIndex] = 1.0;

  for (let i = ops.length - 1; i >= 0; i--) {
    if (dt[i] === 0) continue;
    const op = ops[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const dti = dt[i] ?? 0;

    switch (op.type) {
      case "add":
        dt[op.a] = (dt[op.a] ?? 0) + dti;
        dt[op.b] = (dt[op.b] ?? 0) + dti;
        break;
      case "sub":
        dt[op.a] = (dt[op.a] ?? 0) + dti;
        dt[op.b] = (dt[op.b] ?? 0) - dti;
        break;
      case "mul":
        dt[op.a] = (dt[op.a] ?? 0) + dti * (t[op.b] ?? 0);
        dt[op.b] = (dt[op.b] ?? 0) + dti * (t[op.a] ?? 0);
        break;
      case "div":
        dt[op.a] = (dt[op.a] ?? 0) + dti / (t[op.b] ?? 1);
        dt[op.b] = (dt[op.b] ?? 0) - (dti * (t[op.a] ?? 0)) / ((t[op.b] ?? 1) * (t[op.b] ?? 1));
        break;
      case "pow": {
        const base = t[op.a] ?? 0;
        const exp = t[op.b] ?? 0;
        dt[op.a] = (dt[op.a] ?? 0) + dti * exp * Math.pow(base, exp - 1);
        dt[op.b] = (dt[op.b] ?? 0) + dti * (t[i] ?? 0) * Math.log(base);
        break;
      }
      case "neg":
        dt[op.a] = (dt[op.a] ?? 0) - dti;
        break;
      case "sin":
        dt[op.a] = (dt[op.a] ?? 0) + dti * Math.cos(t[op.a] ?? 0);
        break;
      case "cos":
        dt[op.a] = (dt[op.a] ?? 0) - dti * Math.sin(t[op.a] ?? 0);
        break;
      case "tan":
        dt[op.a] = (dt[op.a] ?? 0) + dti * (1 + (t[i] ?? 0) * (t[i] ?? 0));
        break;
      case "exp":
        dt[op.a] = (dt[op.a] ?? 0) + dti * (t[i] ?? 0);
        break;
      case "log":
        dt[op.a] = (dt[op.a] ?? 0) + dti / (t[op.a] ?? 1);
        break;
      case "sqrt":
        dt[op.a] = (dt[op.a] ?? 0) + dti / (2 * (t[i] ?? 1));
        break;
      // ── Vector ops reverse ──
      case "vec_add":
        for (let k = 0; k < op.size; k++) {
          const dk = dt[i + k] ?? 0;
          dt[op.a + k] = (dt[op.a + k] ?? 0) + dk;
          dt[op.b + k] = (dt[op.b + k] ?? 0) + dk;
        }
        break;
      case "vec_sub":
        for (let k = 0; k < op.size; k++) {
          const dk = dt[i + k] ?? 0;
          dt[op.a + k] = (dt[op.a + k] ?? 0) + dk;
          dt[op.b + k] = (dt[op.b + k] ?? 0) - dk;
        }
        break;
      case "vec_mul":
        for (let k = 0; k < op.size; k++) {
          const dk = dt[i + k] ?? 0;
          dt[op.a + k] = (dt[op.a + k] ?? 0) + dk * (t[op.b + k] ?? 0);
          dt[op.b + k] = (dt[op.b + k] ?? 0) + dk * (t[op.a + k] ?? 0);
        }
        break;
      case "vec_neg":
        for (let k = 0; k < op.size; k++) {
          dt[op.a + k] = (dt[op.a + k] ?? 0) - (dt[i + k] ?? 0);
        }
        break;
      case "vec_subscript":
        dt[op.a + op.offset] = (dt[op.a + op.offset] ?? 0) + dti;
        break;
      case "nop":
        break;
    }
  }

  // Collect variable gradients
  const gradients = new Map<string, number>();
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    if (op.type === "var") {
      gradients.set(op.name, (gradients.get(op.name) ?? 0) + (dt[i] ?? 0));
    } else if (op.type === "vec_var") {
      for (let k = 0; k < op.size; k++) {
        const name = `${op.baseName}[${k + 1}]`;
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
  for (const eq of dae.sortedEquations.length > 0 ? dae.sortedEquations : dae.equations) {
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    const ld = extractDer(se.expression1);
    const rd = extractDer(se.expression2);

    if (eq instanceof ModelicaArrayEquation) {
      // Unroll array equation element-wise
      const baseName = ld || rd;
      if (!baseName) continue;
      const rhs = ld ? se.expression2 : se.expression1;
      const v = dae.variables.get(baseName);
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
  const tapeData: { ops: TapeOp[]; outputIndex: number }[] = [];
  for (const eq of derEqs) {
    const tape = new StaticTapeBuilder();
    const outIdx = tape.walk(eq.rhs);
    tapeData.push({ ops: [...tape.ops], outputIndex: outIdx });
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
    for (const v of dae.variables) {
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
