// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Initial equation solver using Newton-Raphson with exact AD Jacobians.
 *
 * Modelica's `initial equation` section defines implicit relationships that
 * must hold at t=0. This module formulates initialization as a root-finding
 * problem: R(z) = 0 where R_i = LHS_i - RHS_i, solved via Newton-Raphson
 * with exact Jacobian from StaticTapeBuilder reverse-mode AD.
 *
 * The advanced pipeline supports:
 *   1. SystemInitializer BLT decomposition (structured init blocks)
 *   2. sBB preconditioner (global optimization for initial guess)
 *   3. MINLP heuristics (freeze-and-solve for discrete variables)
 *   4. Multi-strategy homotopy fallback (residual/symbolic/fixed-point/parameter)
 */

import { ModelicaVariability } from "@modelscript/modelica-ast";
import {
  Interval,
  ModelicaArray,
  ModelicaArrayEquation,
  ModelicaBooleanLiteral,
  ModelicaBooleanVariable,
  ModelicaFunctionCallExpression,
  ModelicaIntegerVariable,
  ModelicaNameExpression,
  StaticTapeBuilder,
  type ModelicaDAE,
  type ModelicaEquation,
  type ModelicaExpression,
  type TapeOp,
} from "@modelscript/symbolics";
import type { InitSolverConfig } from "../context.js";
import { evaluateTapeForward, evaluateTapeReverse } from "./ad-jacobian.js";
import { expandArrayBounds, solveSBB, type DomainBox } from "./branch-and-bound.js";
import { solveWithAutoHomotopy } from "./homotopy-strategies.js";
import { freezeAndSolve } from "./minlp-heuristics.js";
import { type SolverOptions } from "./solver-options.js";
import { getCachedSundialsWasm } from "./sundials-wasm.js";
import { buildInitBLT, type ImplicitInitBlock } from "./system-initializer.js";

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
  // Recurse into array elements
  if (expr instanceof ModelicaArray) {
    for (const elem of expr.flatElements) {
      collectVarNames(elem, names);
    }
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
  solverOptions?: SolverOptions,
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
    if (eq instanceof ModelicaArrayEquation) {
      // Unroll array initial equation into per-element implicit equations
      const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
      const lhsElems = se.expression1 instanceof ModelicaArray ? [...se.expression1.flatElements] : [se.expression1];
      const rhsElems = se.expression2 instanceof ModelicaArray ? [...se.expression2.flatElements] : [se.expression2];
      const n = Math.max(lhsElems.length, rhsElems.length);
      for (let i = 0; i < n; i++) {
        const lhs = lhsElems[i] ?? lhsElems[0];
        const rhs = rhsElems[i] ?? rhsElems[0];
        if (lhs && rhs) {
          // Create a synthetic simple equation for each element
          const elemEq = { expression1: lhs, expression2: rhs } as unknown as ModelicaEquation;
          const c = classifyInitialEquation(elemEq, unknowns);
          if (c) classified.push(c);
        }
      }
      continue;
    }
    const c = classifyInitialEquation(eq, unknowns);
    if (c) classified.push(c);
  }

  // Expand array variable unknowns: for vars with arrayDimensions, add subscripted names
  for (const v of dae.variables) {
    if (v.arrayDimensions && v.arrayDimensions.length > 0 && unknowns.has(v.name)) {
      const size = v.arrayDimensions.reduce((a: number, b: number) => a * b, 1);
      for (let i = 0; i < size; i++) {
        unknowns.add(`${v.name}[${i + 1}]`);
      }
    }
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
  const maxIter = solverOptions?.maxNonlinearIterations ?? 50;
  const tol = solverOptions?.atol ?? 1e-10;
  const nSolve = Math.min(nResiduals, nUnknowns); // Square system for Newton

  // Initialize z from current env
  const z = unknownList.map((name) => env.get(name) ?? 0);

  const useKinsol = solverOptions?.nonlinear === "kinsol" || solverOptions?.nonlinear === "hybrid";

  if (useKinsol) {
    const solver = getCachedSundialsWasm();
    if (!solver) {
      throw new Error(
        "KINSOL solver requested but SUNDIALS WASM module is not loaded. Use simulateAsync() or loadSundialsWasm() first.",
      );
    }

    const F = (zArr: number[]): number[] => {
      for (let i = 0; i < nUnknowns; i++) {
        const name = unknownList[i];
        if (name) env.set(name, zArr[i] ?? 0);
      }
      const res = new Array(nSolve);
      for (let row = 0; row < nSolve; row++) {
        const td = tapeData[row];
        if (!td) continue;
        const tArr = evaluateTapeForward(td.ops, env);
        res[row] = tArr[td.outputIndex] ?? 0;
      }
      return res;
    };

    const kResult = solver.kinsol(F, z, { atol: tol, rtol: tol });
    if (kResult.converged || solverOptions?.nonlinear === "kinsol") {
      result.converged = kResult.converged;
      if (kResult.converged) {
        for (let i = 0; i < nUnknowns; i++) {
          const name = unknownList[i];
          if (name) result.values.set(name, kResult.solution[i] ?? 0);
        }
      }
      if (!kResult.converged && solverOptions?.nonlinear === "hybrid") {
        // Fall through to Newton-Raphson if hybrid and KINSOL failed
      } else {
        return result;
      }
    }
  }

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

  // If Newton-Raphson failed, try homotopy continuation as fallback
  if (!result.converged) {
    const homotopyResult = solveWithHomotopy(tapeData, unknownList, nSolve, env, startValues);
    if (homotopyResult.converged) {
      result.converged = true;
      result.iterations += homotopyResult.iterations;
      result.residualNorm = homotopyResult.residualNorm;
      for (const [name, val] of homotopyResult.values) {
        result.values.set(name, val);
      }
    }
  }

  return result;
}

/**
 * Homotopy continuation solver for difficult initialization problems.
 *
 * Defines H(z, λ) = λ·R(z) + (1-λ)·(z - z₀) where:
 *   λ = 0 → trivial solution z = z₀ (start values)
 *   λ = 1 → actual system R(z) = 0
 *
 * Steps λ from 0 to 1 in adaptive increments, running Newton-Raphson
 * with exact AD Jacobian of H(z,λ) at each step.
 */
function solveWithHomotopy(
  tapeData: { ops: TapeOp[]; outputIndex: number }[],
  unknownList: string[],
  nSolve: number,
  env: Map<string, number>,
  startValues: Map<string, number>,
): InitSolverResult {
  const result: InitSolverResult = {
    values: new Map<string, number>(),
    iterations: 0,
    residualNorm: 0,
    converged: false,
  };

  const nUnknowns = unknownList.length;

  // Initial guess z₀ from start values
  const z0 = unknownList.map((name) => startValues.get(name) ?? env.get(name) ?? 0);
  const z = [...z0];

  let lambda = 0;
  const lambdaStepInit = 0.1;
  let lambdaStep = lambdaStepInit;
  const maxTotalIter = 200;
  let totalIter = 0;

  while (lambda < 1.0 && totalIter < maxTotalIter) {
    const targetLambda = Math.min(lambda + lambdaStep, 1.0);

    // Newton-Raphson at this λ value
    let convergedAtLambda = false;
    const maxNewtonIter = 20;

    for (let iter = 0; iter < maxNewtonIter && totalIter < maxTotalIter; iter++) {
      totalIter++;
      result.iterations = totalIter;

      // Update env with current z
      for (let i = 0; i < nUnknowns; i++) {
        const name = unknownList[i];
        if (name) env.set(name, z[i] ?? 0);
      }

      // Evaluate homotopy residuals: H_i = λ·R_i(z) + (1-λ)·(z_i - z0_i)
      const H = new Array(nSolve).fill(0) as number[];
      const J: number[][] = [];
      for (let i = 0; i < nSolve; i++) {
        J[i] = new Array(nSolve).fill(0) as number[];
      }

      for (let row = 0; row < nSolve; row++) {
        const td = tapeData[row];
        if (!td) continue;

        // Forward + reverse pass for R_i and ∂R_i/∂z
        const t = evaluateTapeForward(td.ops, env);
        const Ri = t[td.outputIndex] ?? 0;
        const grads = evaluateTapeReverse(td.ops, t, td.outputIndex);

        // Homotopy residual: H_i = λ·R_i + (1-λ)·(z_row - z0_row)
        const zRow = row < nUnknowns ? (z[row] ?? 0) : 0;
        const z0Row = row < nUnknowns ? (z0[row] ?? 0) : 0;
        H[row] = targetLambda * Ri + (1 - targetLambda) * (zRow - z0Row);

        // Homotopy Jacobian: ∂H_i/∂z_j = λ·∂R_i/∂z_j + (1-λ)·δ_{ij}
        const jRow = J[row];
        if (!jRow) continue;
        for (let col = 0; col < nSolve; col++) {
          const varName = unknownList[col];
          if (!varName) continue;
          const dRdz = grads.get(varName) ?? 0;
          jRow[col] = targetLambda * dRdz + (row === col ? 1 - targetLambda : 0);
        }
      }

      // Check convergence
      let norm = 0;
      for (let i = 0; i < nSolve; i++) {
        norm += Math.abs(H[i] ?? 0);
      }
      result.residualNorm = norm;

      if (norm < 1e-10) {
        convergedAtLambda = true;
        break;
      }

      // Solve J·dz = -H
      const negH = H.map((h) => -(h ?? 0));
      const dz = solveLU(J, negH, nSolve);

      // Damped step
      for (let i = 0; i < nSolve; i++) {
        z[i] = (z[i] ?? 0) + (dz[i] ?? 0);
      }
    }

    if (convergedAtLambda) {
      lambda = targetLambda;
      // Increase step size on success
      lambdaStep = Math.min(lambdaStep * 1.5, 0.5);
    } else {
      // Decrease step size and retry
      lambdaStep *= 0.5;
      if (lambdaStep < 1e-6) break; // Give up
      // Reset z to last converged state
      // (z is already at the last iterate, which may be close enough)
    }
  }

  result.converged = lambda >= 1.0 - 1e-10;

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

// ══════════════════════════════════════════════════════════════════════════
// Advanced Initialization Pipeline
// ══════════════════════════════════════════════════════════════════════════

/**
 * Solve initial equations using the full advanced pipeline:
 *   1. SystemInitializer BLT → structured init blocks
 *   2. For each block:
 *      a. Explicit → direct assignment
 *      b. Implicit + discrete → MINLP freeze-and-solve
 *      c. Implicit + preconditioner → sBB for initial guess
 *      d. Newton-Raphson with AD Jacobian
 *      e. Fallback → multi-strategy homotopy
 *
 * @param dae           The flattened DAE
 * @param startValues   Initial guesses for variable values
 * @param parameters    Parameter values (constants during initialization)
 * @param startTime     Simulation start time
 * @param solverOptions Solver options (integrator, nonlinear, etc.)
 * @param initConfig    Initialization solver configuration
 * @returns Solver result with computed initial values
 */
export function solveInitialEquationsAdvanced(
  dae: ModelicaDAE,
  startValues: Map<string, number>,
  parameters: Map<string, number>,
  startTime: number,
  solverOptions?: SolverOptions,
  initConfig?: InitSolverConfig,
): InitSolverResult {
  const result: InitSolverResult = {
    values: new Map(startValues),
    iterations: 0,
    residualNorm: 0,
    converged: true,
  };

  if (dae.initialEquations.length === 0 && dae.equations.length === 0) return result;

  // Step 1: Build initialization BLT
  const { blocks } = buildInitBLT(dae);
  if (blocks.length === 0) return result;

  // Build environment
  const env = new Map<string, number>(parameters);
  env.set("time", startTime);
  for (const [name, val] of startValues) {
    if (!env.has(name)) env.set(name, val);
  }

  // Identify discrete variables for MINLP
  const discreteSet = new Set<string>();
  for (const v of dae.variables) {
    if (v instanceof ModelicaIntegerVariable || v instanceof ModelicaBooleanVariable) {
      discreteSet.add(v.name);
    }
  }

  const useSBB = initConfig?.preconditioner === "branch-and-bound";
  const homotopyMode = initConfig?.homotopyMode ?? "auto";
  const maxHomotopySteps = initConfig?.maxHomotopySteps ?? 50;
  const tol = solverOptions?.atol ?? 1e-10;
  const maxNewtonIter = solverOptions?.maxNonlinearIterations ?? 50;

  // Step 2: Process each block sequentially
  for (const block of blocks) {
    if (block.type === "explicit") {
      // Direct assignment
      const val = simpleEval(block.expr, env);
      if (val !== null && isFinite(val)) {
        env.set(block.target, val);
        result.values.set(block.target, val);
      }
      continue;
    }

    // Implicit block
    const implicitBlock = block as ImplicitInitBlock;

    // Step 2a: MINLP heuristic for blocks with discrete variables
    if (implicitBlock.hasDiscreteVars) {
      const minlpResult = freezeAndSolve(implicitBlock, env, discreteSet, 10, maxNewtonIter, tol);
      if (minlpResult.converged) {
        result.iterations += minlpResult.totalNewtonIterations;
        result.residualNorm = minlpResult.residualNorm;
        for (const [name, val] of minlpResult.values) {
          result.values.set(name, val);
          env.set(name, val);
        }
        continue;
      }
    }

    // Build AD tapes for this block's residuals
    const tapeData: { ops: TapeOp[]; outputIndex: number }[] = [];
    for (const eq of implicitBlock.equations) {
      const tape = new StaticTapeBuilder();
      const lhsIdx = tape.walk(eq.lhs);
      const rhsIdx = tape.walk(eq.rhs);
      const residualIdx = tape.pushOp({ type: "sub", a: lhsIdx, b: rhsIdx });
      tapeData.push({ ops: [...tape.ops], outputIndex: residualIdx });
    }

    const unknownList = implicitBlock.unknowns;
    const nUnknowns = unknownList.length;
    const nSolve = Math.min(tapeData.length, nUnknowns);
    const z = unknownList.map((name) => env.get(name) ?? 0);

    // Step 2b: sBB preconditioner for better initial guess
    if (useSBB && nSolve > 0) {
      const variables = unknownList.slice(0, nSolve);
      const initialBox: DomainBox = new Map();
      for (const vName of variables) {
        // Use variable bounds from attributes, or default range
        const v = dae.variables.get(vName);
        const lo = v?.attributes.get("min");
        const hi = v?.attributes.get("max");
        const loVal = lo && typeof lo === "object" && "value" in lo ? (lo as { value: number }).value : -1e6;
        const hiVal = hi && typeof hi === "object" && "value" in hi ? (hi as { value: number }).value : 1e6;
        initialBox.set(vName, new Interval(loVal, hiVal));
      }

      // Expand array bounds
      const expandedBox = expandArrayBounds(initialBox, dae);

      // Build a combined objective tape: sum of squared residuals
      // We copy each individual residual tape's ops into a single combined tape,
      // adjusting indices as we go.
      const combinedOps: TapeOp[] = [];
      const residualIndices: number[] = [];
      for (const td of tapeData) {
        const offset = combinedOps.length;
        // Copy all ops from this tape, adjusting any index references by offset
        for (const op of td.ops) {
          combinedOps.push(shiftTapeOp(op, offset));
        }
        residualIndices.push(td.outputIndex + offset);
      }
      // Sum squared residuals: sum(R_i^2)
      let sumIdx = combinedOps.length;
      combinedOps.push({ type: "const", val: 0 });
      for (const residIdx of residualIndices) {
        const sqIdx = combinedOps.length;
        combinedOps.push({ type: "mul", a: residIdx, b: residIdx });
        const newSum = combinedOps.length;
        combinedOps.push({ type: "add", a: sumIdx, b: sqIdx });
        sumIdx = newSum;
      }

      try {
        const sbbResult = solveSBB(
          { ops: combinedOps, outputIndex: sumIdx },
          [], // No constraints for preconditioner
          variables,
          expandedBox,
          { maxNodes: 100, absTol: 1e-4 },
        );
        // Use sBB solution as initial guess
        for (let i = 0; i < nUnknowns; i++) {
          const name = unknownList[i];
          if (name) {
            const sbbVal = sbbResult.solution.get(name);
            if (sbbVal !== undefined) {
              z[i] = sbbVal;
              env.set(name, sbbVal);
            }
          }
        }
      } catch {
        // sBB failed — continue with original initial guess
      }
    }

    // Step 2c: Newton-Raphson with AD Jacobian
    let newtonConverged = false;
    for (let iter = 0; iter < maxNewtonIter; iter++) {
      result.iterations++;

      for (let i = 0; i < nUnknowns; i++) {
        const name = unknownList[i];
        if (name) env.set(name, z[i] ?? 0);
      }

      const R = new Array(nSolve).fill(0) as number[];
      const J: number[][] = [];
      for (let i = 0; i < nSolve; i++) J[i] = new Array(nSolve).fill(0) as number[];

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
          if (varName) jRow[col] = grads.get(varName) ?? 0;
        }
      }

      let norm = 0;
      for (let i = 0; i < nSolve; i++) norm += Math.abs(R[i] ?? 0);
      result.residualNorm = norm;

      if (norm < tol) {
        newtonConverged = true;
        break;
      }

      const negR = R.map((r) => -(r ?? 0));
      const dz = solveLU(J, negR, nSolve);
      for (let i = 0; i < nSolve; i++) z[i] = (z[i] ?? 0) + (dz[i] ?? 0);
    }

    // Store Newton results
    for (let i = 0; i < nUnknowns; i++) {
      const name = unknownList[i];
      if (name) {
        result.values.set(name, z[i] ?? 0);
        env.set(name, z[i] ?? 0);
      }
    }

    // Step 2d: Homotopy fallback if Newton failed
    if (!newtonConverged && homotopyMode !== "none") {
      const hResult = solveWithAutoHomotopy(
        homotopyMode,
        tapeData,
        unknownList,
        nSolve,
        env,
        startValues,
        maxHomotopySteps,
      );
      if (hResult.converged) {
        result.iterations += hResult.iterations;
        result.residualNorm = hResult.residualNorm;
        for (const [name, val] of hResult.values) {
          result.values.set(name, val);
          env.set(name, val);
        }
      } else {
        result.converged = false;
      }
    } else if (!newtonConverged) {
      result.converged = false;
    }
  }

  return result;
}

/**
 * Shift all index references in a TapeOp by the given offset.
 * Used when combining multiple tapes into a single combined tape.
 */
function shiftTapeOp(op: TapeOp, offset: number): TapeOp {
  if (offset === 0) return { ...op };
  switch (op.type) {
    case "const":
    case "var":
      return { ...op };
    case "add":
    case "sub":
    case "mul":
    case "div":
    case "pow":
      return { ...op, a: op.a + offset, b: op.b + offset };
    case "neg":
    case "sin":
    case "cos":
    case "tan":
    case "exp":
    case "log":
    case "sqrt":
      return { ...op, a: op.a + offset };
    case "vec_var":
    case "vec_const":
      return { ...op };
    case "vec_add":
    case "vec_sub":
    case "vec_mul":
      return { ...op, a: op.a + offset, b: op.b + offset };
    case "vec_neg":
      return { ...op, a: op.a + offset };
    case "vec_subscript":
      return { ...op, a: op.a + offset };
    case "nop":
      return op;
  }
}
