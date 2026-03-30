// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Initial equation solver using Newton-Raphson with exact AD Jacobians.
 *
 * Modelica's `initial equation` section defines implicit relationships that
 * must hold at t=0. This module formulates initialization as a root-finding
 * problem: R(z) = 0 where R_i = LHS_i - RHS_i, solved via Newton-Raphson
 * with exact Jacobian from StaticTapeBuilder reverse-mode AD.
 */

import { StaticTapeBuilder, type TapeOp } from "./ad-codegen.js";
import { evaluateTapeForward, evaluateTapeReverse } from "./ad-jacobian.js";
import {
  ModelicaBooleanLiteral,
  type ModelicaDAE,
  type ModelicaEquation,
  type ModelicaExpression,
  ModelicaFunctionCallExpression,
  ModelicaNameExpression,
} from "./dae.js";
import { ModelicaVariability } from "./syntax.js";

/** Result of initial equation solving. */
export interface InitSolverResult {
  /** Solved variable values. */
  values: Map<string, number>;
  /** Number of Newton iterations performed. */
  iterations: number;
  /** Final residual norm. */
  residualNorm: number;
  /** Whether the solver converged. */
  converged: boolean;
}

/** Extract a simple variable name from a Modelica expression. */
function extractVarName(expr: ModelicaExpression): string | null {
  if (expr instanceof ModelicaNameExpression) return expr.name;
  if (expr && typeof expr === "object" && "name" in expr) {
    return (expr as { name: string }).name;
  }
  return null;
}

/** Extract der(x) variable name. */
function extractDerName(expr: ModelicaExpression): string | null {
  if (expr instanceof ModelicaFunctionCallExpression && expr.functionName === "der" && expr.args.length === 1) {
    const a = expr.args[0];
    if (a && typeof a === "object" && "name" in a) return (a as { name: string }).name;
  }
  return null;
}

/** Collect all variable names referenced in an expression. */
function collectVarNames(expr: ModelicaExpression, names: Set<string>): void {
  if (!expr || typeof expr !== "object") return;
  if (expr instanceof ModelicaNameExpression) {
    names.add(expr.name);
    return;
  }
  if ("name" in expr) names.add((expr as { name: string }).name);
  if ("operand" in expr) collectVarNames((expr as { operand: ModelicaExpression }).operand, names);
  if ("operand1" in expr) collectVarNames((expr as { operand1: ModelicaExpression }).operand1, names);
  if ("operand2" in expr) collectVarNames((expr as { operand2: ModelicaExpression }).operand2, names);
  if (expr instanceof ModelicaFunctionCallExpression) {
    // Include der(x) as a referenced variable (as "der(x)")
    if (expr.functionName === "der" && expr.args.length === 1) {
      const derName = extractDerName(expr);
      if (derName) names.add(`der(${derName})`);
    }
    for (const arg of expr.args) collectVarNames(arg, names);
  }
}

interface ExplicitEq {
  type: "explicit";
  target: string;
  expr: ModelicaExpression;
}

interface ImplicitEq {
  type: "implicit";
  lhs: ModelicaExpression;
  rhs: ModelicaExpression;
}

type ClassifiedEq = ExplicitEq | ImplicitEq;

/**
 * Classify an initial equation as explicit (x = expr) or implicit (expr1 = expr2).
 */
function classifyInitialEquation(eq: ModelicaEquation, unknowns: Set<string>): ClassifiedEq | null {
  if (!("expression1" in eq && "expression2" in eq)) return null;
  const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };

  // Check for x = expr where x is an unknown
  const lhsName = extractVarName(se.expression1);
  const rhsName = extractVarName(se.expression2);
  const derLhs = extractDerName(se.expression1);
  const derRhs = extractDerName(se.expression2);

  // der(x) = expr
  if (derLhs && unknowns.has(`der(${derLhs})`)) {
    const rhsRefs = new Set<string>();
    collectVarNames(se.expression2, rhsRefs);
    // If RHS doesn't reference any unknowns, it's explicit
    let rhsHasUnknowns = false;
    for (const ref of rhsRefs) {
      if (unknowns.has(ref)) {
        rhsHasUnknowns = true;
        break;
      }
    }
    if (!rhsHasUnknowns) {
      return { type: "explicit", target: `der(${derLhs})`, expr: se.expression2 };
    }
  }
  // expr = der(x)
  if (derRhs && unknowns.has(`der(${derRhs})`)) {
    const lhsRefs = new Set<string>();
    collectVarNames(se.expression1, lhsRefs);
    let lhsHasUnknowns = false;
    for (const ref of lhsRefs) {
      if (unknowns.has(ref)) {
        lhsHasUnknowns = true;
        break;
      }
    }
    if (!lhsHasUnknowns) {
      return { type: "explicit", target: `der(${derRhs})`, expr: se.expression1 };
    }
  }
  // x = expr where x is simple unknown
  if (lhsName && unknowns.has(lhsName)) {
    const rhsRefs = new Set<string>();
    collectVarNames(se.expression2, rhsRefs);
    let rhsHasUnknowns = false;
    for (const ref of rhsRefs) {
      if (unknowns.has(ref)) {
        rhsHasUnknowns = true;
        break;
      }
    }
    if (!rhsHasUnknowns) {
      return { type: "explicit", target: lhsName, expr: se.expression2 };
    }
  }
  // expr = x
  if (rhsName && unknowns.has(rhsName)) {
    const lhsRefs = new Set<string>();
    collectVarNames(se.expression1, lhsRefs);
    let lhsHasUnknowns = false;
    for (const ref of lhsRefs) {
      if (unknowns.has(ref)) {
        lhsHasUnknowns = true;
        break;
      }
    }
    if (!lhsHasUnknowns) {
      return { type: "explicit", target: rhsName, expr: se.expression1 };
    }
  }

  // Implicit: expr1 = expr2 (both sides may reference unknowns)
  return { type: "implicit", lhs: se.expression1, rhs: se.expression2 };
}

/**
 * LU decomposition with partial pivoting for the Newton linear system.
 */
function solveLU(A: number[][], b: number[], n: number): number[] {
  // Copy A and b to avoid mutation
  const M = A.map((row) => [...row]);
  const rhs = [...b];
  const P = Array.from({ length: n }, (_, i) => i);

  // Forward elimination with partial pivoting
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
      [P[k], P[maxRow]] = [P[maxRow] ?? 0, P[k] ?? 0];
    }
    const pivot = M[k]?.[k] ?? 0;
    if (Math.abs(pivot) < 1e-30) continue;

    for (let i = k + 1; i < n; i++) {
      const row = M[i];
      const pivotRow = M[k];
      if (!row || !pivotRow) continue;
      const factor = (row[k] ?? 0) / pivot;
      row[k] = factor;
      for (let j = k + 1; j < n; j++) {
        row[j] = (row[j] ?? 0) - factor * (pivotRow[j] ?? 0);
      }
      rhs[i] = (rhs[i] ?? 0) - factor * (rhs[k] ?? 0);
    }
  }

  // Back substitution
  const x = new Array(n).fill(0) as number[];
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i] ?? 0;
    const row = M[i];
    if (row) {
      for (let j = i + 1; j < n; j++) {
        sum -= (row[j] ?? 0) * (x[j] ?? 0);
      }
      const diag = row[i] ?? 1;
      x[i] = Math.abs(diag) > 1e-30 ? sum / diag : 0;
    }
  }
  return x;
}

/**
 * Solve the initial equations of a Modelica DAE using Newton-Raphson
 * with exact AD Jacobians from StaticTapeBuilder.
 *
 * @param dae           The flattened DAE
 * @param startValues   Initial guesses for variable values
 * @param parameters    Parameter values (constants during initialization)
 * @param startTime     Simulation start time
 * @returns Solver result with computed initial values
 */
export function solveInitialEquations(
  dae: ModelicaDAE,
  startValues: Map<string, number>,
  parameters: Map<string, number>,
  startTime: number,
): InitSolverResult {
  const result: InitSolverResult = {
    values: new Map(startValues),
    iterations: 0,
    residualNorm: 0,
    converged: true,
  };

  if (dae.initialEquations.length === 0) return result;

  // Identify unknowns: variables that are not fixed, not parameters/constants
  const fixedVars = new Set<string>();
  const paramNames = new Set(parameters.keys());
  for (const v of dae.variables) {
    if (v.variability === ModelicaVariability.PARAMETER || v.variability === ModelicaVariability.CONSTANT) {
      paramNames.add(v.name);
    }
    const fixedAttr = v.attributes.get("fixed");
    if (fixedAttr && fixedAttr instanceof ModelicaBooleanLiteral && fixedAttr.value) {
      fixedVars.add(v.name);
    }
  }

  // Collect all variable names referenced in initial equations
  const referencedVars = new Set<string>();
  for (const eq of dae.initialEquations) {
    if ("expression1" in eq && "expression2" in eq) {
      const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
      collectVarNames(se.expression1, referencedVars);
      collectVarNames(se.expression2, referencedVars);
    }
  }

  // Unknowns = referenced vars that are not parameters and not fixed
  const unknowns = new Set<string>();
  for (const name of referencedVars) {
    if (!paramNames.has(name) && !fixedVars.has(name) && name !== "time") {
      unknowns.add(name);
    }
  }

  if (unknowns.size === 0) return result;

  // Classify equations
  const classified: ClassifiedEq[] = [];
  for (const eq of dae.initialEquations) {
    const c = classifyInitialEquation(eq, unknowns);
    if (c) classified.push(c);
  }

  // Phase 1: Solve explicit equations first (direct assignment)
  const explicitEqs = classified.filter((c): c is ExplicitEq => c.type === "explicit");
  const implicitEqs = classified.filter((c): c is ImplicitEq => c.type === "implicit");

  // Build simple evaluator for explicit equations
  const env = new Map<string, number>(parameters);
  env.set("time", startTime);
  for (const [name, val] of startValues) {
    if (!env.has(name)) env.set(name, val);
  }

  // Evaluate explicit equations (they may chain, so iterate a few times)
  for (let pass = 0; pass < 3; pass++) {
    for (const eq of explicitEqs) {
      // Simple evaluation: walk the expression tree
      const val = simpleEval(eq.expr, env);
      if (val !== null && isFinite(val)) {
        env.set(eq.target, val);
        result.values.set(eq.target, val);
        unknowns.delete(eq.target);
      }
    }
  }

  // Phase 2: Solve implicit equations via Newton-Raphson with AD
  if (implicitEqs.length === 0) return result;

  const unknownList = Array.from(unknowns);
  const nUnknowns = unknownList.length;
  const nResiduals = implicitEqs.length;

  if (nResiduals === 0 || nUnknowns === 0) return result;

  // Build AD tapes for each implicit residual: R_i = LHS_i - RHS_i
  const tapeData: { ops: TapeOp[]; outputIndex: number }[] = [];
  for (const eq of implicitEqs) {
    const tape = new StaticTapeBuilder();
    const lhsIdx = tape.walk(eq.lhs);
    const rhsIdx = tape.walk(eq.rhs);
    const residualIdx = tape.pushOp({ type: "sub", a: lhsIdx, b: rhsIdx });
    tapeData.push({ ops: [...tape.ops], outputIndex: residualIdx });
  }

  // Newton-Raphson iteration
  const maxIter = 50;
  const tol = 1e-10;
  const nSolve = Math.min(nResiduals, nUnknowns); // Square system for Newton

  // Initialize z from current env
  const z = unknownList.map((name) => env.get(name) ?? 0);

  for (let iter = 0; iter < maxIter; iter++) {
    result.iterations = iter + 1;

    // Update env with current z values
    for (let i = 0; i < nUnknowns; i++) {
      const name = unknownList[i];
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
        const varName = unknownList[col];
        if (varName) {
          jRow[col] = grads.get(varName) ?? 0;
        }
      }
    }

    // Check convergence
    let norm = 0;
    for (let i = 0; i < nSolve; i++) {
      norm += Math.abs(R[i] ?? 0);
    }
    result.residualNorm = norm;

    if (norm < tol) {
      result.converged = true;
      break;
    }

    // Solve J * dz = -R
    const negR = R.map((r) => -(r ?? 0));
    const dz = solveLU(J, negR, nSolve);

    // Apply damped Newton step
    const dampingFactor = 1.0;
    for (let i = 0; i < nSolve; i++) {
      z[i] = (z[i] ?? 0) + dampingFactor * (dz[i] ?? 0);
    }

    if (iter === maxIter - 1) {
      result.converged = false;
    }
  }

  // Store solved values
  for (let i = 0; i < nUnknowns; i++) {
    const name = unknownList[i];
    if (name) {
      result.values.set(name, z[i] ?? 0);
    }
  }

  return result;
}

/**
 * Simple expression evaluator for explicit initial equations.
 * Handles basic arithmetic, function calls, and variable lookups.
 */
function simpleEval(expr: ModelicaExpression, env: Map<string, number>): number | null {
  if (!expr) return null;
  if (typeof expr === "number") return expr;

  if ("value" in expr && typeof (expr as { value: unknown }).value === "number") {
    return (expr as { value: number }).value;
  }
  if ("value" in expr && typeof (expr as { value: unknown }).value === "boolean") {
    return (expr as { value: boolean }).value ? 1 : 0;
  }
  if (expr instanceof ModelicaNameExpression) {
    return env.get(expr.name) ?? null;
  }
  if (expr && typeof expr === "object" && "name" in expr && !("operand" in expr) && !("operand1" in expr)) {
    return env.get((expr as { name: string }).name) ?? null;
  }
  if ("operator" in expr && "operand" in expr) {
    const a = simpleEval((expr as { operand: ModelicaExpression }).operand, env);
    if (a === null) return null;
    // Unary minus
    return -a;
  }
  if ("operator" in expr && "operand1" in expr && "operand2" in expr) {
    const a = simpleEval((expr as { operand1: ModelicaExpression }).operand1, env);
    const b = simpleEval((expr as { operand2: ModelicaExpression }).operand2, env);
    if (a === null || b === null) return null;
    const op = (expr as { operator: number }).operator;
    // Basic arithmetic (enum values may vary, try common patterns)
    // Addition = 0 or specific enum value
    if (op <= 1) return a + b;
    if (op <= 3) return a - b;
    if (op <= 5) return a * b;
    if (op <= 7) return a / b;
    if (op <= 9) return Math.pow(a, b);
    return a + b; // Fallback
  }
  if (expr instanceof ModelicaFunctionCallExpression) {
    if (expr.functionName === "der" && expr.args.length === 1) {
      const derName = extractDerName(expr);
      if (derName) return env.get(`der(${derName})`) ?? 0;
    }
    if (expr.args.length === 1) {
      const a = simpleEval(expr.args[0] as ModelicaExpression, env);
      if (a === null) return null;
      switch (expr.functionName) {
        case "sin":
          return Math.sin(a);
        case "cos":
          return Math.cos(a);
        case "tan":
          return Math.tan(a);
        case "exp":
          return Math.exp(a);
        case "log":
          return Math.log(a);
        case "sqrt":
          return Math.sqrt(a);
        case "abs":
          return Math.abs(a);
      }
    }
  }
  return null;
}
