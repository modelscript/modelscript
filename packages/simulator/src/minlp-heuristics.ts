// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MINLP Heuristics for Mixed-Integer Initialization.
 *
 * When initialization algebraic loops contain both continuous (Real) and
 * discrete (Integer/Boolean) variables, standard Newton-Raphson fails because
 * the Jacobian is undefined for discrete dimensions.
 *
 * This module implements a "Freeze-and-Solve" heuristic:
 *   1. Freeze discrete variables to their current (start) values
 *   2. Solve the continuous subsystem via Newton-Raphson with AD
 *   3. Re-evaluate discrete expressions from the solved continuous state
 *   4. Repeat until mutual equilibrium or max iterations
 *
 * Reference: Belotti, P. et al. (2013),
 *   "Mixed-integer nonlinear optimization", Acta Numerica.
 */

import type { ModelicaExpression } from "@modelscript/symbolics";
import { StaticTapeBuilder, type TapeOp } from "@modelscript/symbolics";
import { evaluateTapeForward, evaluateTapeReverse } from "./ad-jacobian.js";
import type { ImplicitInitBlock } from "./system-initializer.js";

/** Result of the MINLP freeze-and-solve iteration. */
export interface MinlpResult {
  /** Solved variable values (both continuous and discrete). */
  values: Map<string, number>;
  /** Number of outer freeze-and-solve iterations. */
  outerIterations: number;
  /** Total inner Newton iterations across all outer iterations. */
  totalNewtonIterations: number;
  /** Final residual norm. */
  residualNorm: number;
  /** Whether the solver converged. */
  converged: boolean;
}

/**
 * Solve a mixed discrete/continuous initialization block using
 * the freeze-and-solve heuristic.
 *
 * @param block       The implicit init block (must have hasDiscreteVars=true)
 * @param env         Current variable values (will be mutated with solution)
 * @param discreteSet Set of variable names that are Integer/Boolean
 * @param maxOuter    Maximum outer freeze-and-solve iterations (default: 10)
 * @param maxNewton   Maximum inner Newton iterations per solve (default: 30)
 * @param tol         Convergence tolerance (default: 1e-10)
 */
export function freezeAndSolve(
  block: ImplicitInitBlock,
  env: Map<string, number>,
  discreteSet: Set<string>,
  maxOuter = 10,
  maxNewton = 30,
  tol = 1e-10,
): MinlpResult {
  const result: MinlpResult = {
    values: new Map<string, number>(),
    outerIterations: 0,
    totalNewtonIterations: 0,
    residualNorm: Infinity,
    converged: false,
  };

  // Separate unknowns into continuous and discrete
  const continuousUnknowns: string[] = [];
  const discreteUnknowns: string[] = [];
  for (const u of block.unknowns) {
    if (discreteSet.has(u)) {
      discreteUnknowns.push(u);
    } else {
      continuousUnknowns.push(u);
    }
  }

  // Build AD tapes for residuals: R_i = LHS_i - RHS_i
  const tapeData: { ops: TapeOp[]; outputIndex: number }[] = [];
  for (const eq of block.equations) {
    const tape = new StaticTapeBuilder();
    const lhsIdx = tape.walk(eq.lhs);
    const rhsIdx = tape.walk(eq.rhs);
    const residualIdx = tape.pushOp({ type: "sub", a: lhsIdx, b: rhsIdx });
    tapeData.push({ ops: [...tape.ops], outputIndex: residualIdx });
  }

  const nResiduals = tapeData.length;
  const nContinuous = continuousUnknowns.length;
  const nSolve = Math.min(nResiduals, nContinuous);

  if (nSolve === 0) {
    // No continuous unknowns — just evaluate discrete variables directly
    for (const u of block.unknowns) {
      result.values.set(u, env.get(u) ?? 0);
    }
    result.converged = true;
    return result;
  }

  // Initialize continuous unknowns from env
  const z = continuousUnknowns.map((name) => env.get(name) ?? 0);

  // Outer loop: freeze-and-solve
  for (let outer = 0; outer < maxOuter; outer++) {
    result.outerIterations = outer + 1;

    // Phase 1: Freeze discrete variables at current values
    // (they are already in env)

    // Phase 2: Newton-Raphson on continuous subsystem
    for (let iter = 0; iter < maxNewton; iter++) {
      result.totalNewtonIterations++;

      // Update env with current continuous values
      for (let i = 0; i < nContinuous; i++) {
        const name = continuousUnknowns[i];
        if (name) env.set(name, z[i] ?? 0);
      }

      // Evaluate residuals and Jacobian
      const R = new Array(nSolve).fill(0) as number[];
      const J: number[][] = [];
      for (let i = 0; i < nSolve; i++) {
        J[i] = new Array(nSolve).fill(0) as number[];
      }

      for (let row = 0; row < nSolve; row++) {
        const td = tapeData[row];
        if (!td) continue;
        const t = evaluateTapeForward(td.ops, env);
        R[row] = t[td.outputIndex] ?? 0;
        const grads = evaluateTapeReverse(td.ops, t, td.outputIndex);
        const jRow = J[row];
        if (!jRow) continue;
        for (let col = 0; col < nSolve; col++) {
          const varName = continuousUnknowns[col];
          if (varName) jRow[col] = grads.get(varName) ?? 0;
        }
      }

      // Check convergence
      let norm = 0;
      for (let i = 0; i < nSolve; i++) norm += Math.abs(R[i] ?? 0);
      result.residualNorm = norm;

      if (norm < tol) break;

      // Solve J * dz = -R via LU
      const negR = R.map((r) => -(r ?? 0));
      const dz = solveLUMinlp(J, negR, nSolve);
      for (let i = 0; i < nSolve; i++) {
        z[i] = (z[i] ?? 0) + (dz[i] ?? 0);
      }
    }

    // Update env with solved continuous values
    for (let i = 0; i < nContinuous; i++) {
      const name = continuousUnknowns[i];
      if (name) env.set(name, z[i] ?? 0);
    }

    // Phase 3: Re-evaluate discrete variables from solved continuous state
    let discreteChanged = false;
    for (const dv of discreteUnknowns) {
      const oldVal = env.get(dv) ?? 0;
      // Evaluate the equation that computes this discrete variable
      // For now, use the residual evaluation to check consistency
      const newVal = evaluateDiscreteFromResiduals(dv, block, env);
      if (newVal !== null && Math.abs(newVal - oldVal) > 0.5) {
        // Discrete value changed (round to nearest integer for Integer vars)
        env.set(dv, Math.round(newVal));
        discreteChanged = true;
      }
    }

    // Phase 4: Check convergence — both continuous residuals and discrete stability
    if (result.residualNorm < tol && !discreteChanged) {
      result.converged = true;
      break;
    }
  }

  // Store final values
  for (const u of block.unknowns) {
    result.values.set(u, env.get(u) ?? 0);
  }

  return result;
}

/**
 * Evaluate a discrete variable's value from the system equations.
 * Tries to find the equation where the discrete variable appears on one side
 * and evaluate the other side.
 */
function evaluateDiscreteFromResiduals(
  varName: string,
  block: ImplicitInitBlock,
  env: Map<string, number>,
): number | null {
  for (const eq of block.equations) {
    // Check if LHS is just this variable
    if (isSimpleName(eq.lhs, varName)) {
      return simpleEvalMinlp(eq.rhs, env);
    }
    if (isSimpleName(eq.rhs, varName)) {
      return simpleEvalMinlp(eq.lhs, env);
    }
  }
  return null;
}

function isSimpleName(expr: ModelicaExpression, name: string): boolean {
  if (!expr || typeof expr !== "object") return false;
  if ("name" in expr && (expr as { name: string }).name === name) {
    return !("operand" in expr) && !("operand1" in expr);
  }
  return false;
}

/** Simple expression evaluator for discrete variable re-evaluation. */
function simpleEvalMinlp(expr: ModelicaExpression, env: Map<string, number>): number | null {
  if (!expr) return null;
  if (typeof expr === "number") return expr;
  if ("value" in expr && typeof (expr as { value: unknown }).value === "number") {
    return (expr as { value: number }).value;
  }
  if ("value" in expr && typeof (expr as { value: unknown }).value === "boolean") {
    return (expr as { value: boolean }).value ? 1 : 0;
  }
  if ("name" in expr && !("operand" in expr) && !("operand1" in expr)) {
    return env.get((expr as { name: string }).name) ?? null;
  }
  if ("operator" in expr && "operand" in expr) {
    const a = simpleEvalMinlp((expr as { operand: ModelicaExpression }).operand, env);
    return a !== null ? -a : null;
  }
  if ("operator" in expr && "operand1" in expr && "operand2" in expr) {
    const a = simpleEvalMinlp((expr as { operand1: ModelicaExpression }).operand1, env);
    const b = simpleEvalMinlp((expr as { operand2: ModelicaExpression }).operand2, env);
    if (a === null || b === null) return null;
    const op = (expr as { operator: number }).operator;
    if (op <= 1) return a + b;
    if (op <= 3) return a - b;
    if (op <= 5) return a * b;
    if (op <= 7) return a / b;
    if (op <= 9) return Math.pow(a, b);
    return a + b;
  }
  return null;
}

/** LU solve for the MINLP continuous Newton step. */
function solveLUMinlp(A: number[][], b: number[], n: number): number[] {
  const M = A.map((row) => [...row]);
  const rhs = [...b];

  for (let k = 0; k < n; k++) {
    let maxVal = Math.abs(M[k]?.[k] ?? 0);
    let maxRow = k;
    for (let i = k + 1; i < n; i++) {
      const val = Math.abs(M[i]?.[k] ?? 0);
      if (val > maxVal) {
        maxVal = val;
        maxRow = i;
      }
    }
    if (maxRow !== k) {
      [M[k], M[maxRow]] = [M[maxRow] ?? [], M[k] ?? []];
      [rhs[k], rhs[maxRow]] = [rhs[maxRow] ?? 0, rhs[k] ?? 0];
    }
    const pivot = M[k]?.[k] ?? 0;
    if (Math.abs(pivot) < 1e-30) continue;
    for (let i = k + 1; i < n; i++) {
      const row = M[i];
      const pivotRow = M[k];
      if (!row || !pivotRow) continue;
      const factor = (row[k] ?? 0) / pivot;
      for (let j = k + 1; j < n; j++) row[j] = (row[j] ?? 0) - factor * (pivotRow[j] ?? 0);
      rhs[i] = (rhs[i] ?? 0) - factor * (rhs[k] ?? 0);
    }
  }

  const x = new Array(n).fill(0) as number[];
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i] ?? 0;
    const row = M[i];
    if (row) {
      for (let j = i + 1; j < n; j++) sum -= (row[j] ?? 0) * (x[j] ?? 0);
      const diag = row[i] ?? 1;
      x[i] = Math.abs(diag) > 1e-30 ? sum / diag : 0;
    }
  }
  return x;
}
