// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Multi-Strategy Automatic Homotopy Continuation.
 *
 * When Newton-Raphson fails to converge on difficult initialization problems,
 * this module provides multiple homotopy continuation strategies that
 * smoothly deform a simple solvable system into the target system.
 *
 * Each strategy defines a homotopy function H(z, λ) where:
 *   λ = 0 → trivial/simple system
 *   λ = 1 → actual target system R(z) = 0
 *
 * Available strategies:
 *   - Residual:    H = λ·R(z) + (1-λ)·(z - z₀)
 *   - Fixed-Point: H = λ·R(z) + (1-λ)·(z - z₀) with aggressive damping
 *   - Symbolic:    Linearize nonlinear operators via λ blending in the tape
 *   - Parameter:   Throttle boundary parameters from 0 → actual via λ
 *
 * The "auto" mode tries each strategy in order until one converges.
 *
 * Reference: Allgower, E.L. & Georg, K. (2003),
 *   "Introduction to Numerical Continuation Methods", SIAM.
 */

import type { TapeOp } from "@modelscript/symbolics";
import { evaluateTapeForward, evaluateTapeReverse } from "./ad-jacobian.js";
import type { HomotopyMode } from "./init-solver.js";

/** Result of a homotopy solve attempt. */
export interface HomotopyResult {
  /** Solved variable values. */
  values: Map<string, number>;
  /** Total iterations used. */
  iterations: number;
  /** Final residual norm. */
  residualNorm: number;
  /** Whether the solver converged (λ reached 1). */
  converged: boolean;
  /** Strategy that was used. */
  strategy: string;
}

/** Common interface for all homotopy strategies. */
export interface HomotopyStrategy {
  /** Human-readable strategy name. */
  name: string;
  /** Attempt to solve the system via homotopy continuation. */
  solve(
    tapeData: { ops: TapeOp[]; outputIndex: number }[],
    unknownList: string[],
    nSolve: number,
    env: Map<string, number>,
    startValues: Map<string, number>,
    maxSteps: number,
  ): HomotopyResult;
}

// ── Strategy implementations ──

/**
 * Residual Homotopy: H(z,λ) = λ·R(z) + (1-λ)·(z - z₀)
 *
 * At λ=0, the solution is trivially z = z₀.
 * Smoothly transitions to the actual residual system at λ=1.
 */
export class ResidualHomotopy implements HomotopyStrategy {
  name = "residual";

  solve(
    tapeData: { ops: TapeOp[]; outputIndex: number }[],
    unknownList: string[],
    nSolve: number,
    env: Map<string, number>,
    startValues: Map<string, number>,
    maxSteps: number,
  ): HomotopyResult {
    return runHomotopyContinuation(
      tapeData,
      unknownList,
      nSolve,
      env,
      startValues,
      maxSteps,
      "residual",
      // Residual formulation blends residual with identity
      (Ri, zRow, z0Row, lambda) => lambda * Ri + (1 - lambda) * (zRow - z0Row),
      (dRdz, row, col, lambda) => lambda * dRdz + (row === col ? 1 - lambda : 0),
    );
  }
}

/**
 * Fixed-Point Homotopy: Same formula but with aggressive damping.
 *
 * Uses smaller λ steps and lower step growth for stiff systems where
 * the residual homotopy takes too large Newton steps.
 */
export class FixedPointHomotopy implements HomotopyStrategy {
  name = "fixed-point";

  solve(
    tapeData: { ops: TapeOp[]; outputIndex: number }[],
    unknownList: string[],
    nSolve: number,
    env: Map<string, number>,
    startValues: Map<string, number>,
    maxSteps: number,
  ): HomotopyResult {
    return runHomotopyContinuation(
      tapeData,
      unknownList,
      nSolve,
      env,
      startValues,
      maxSteps,
      "fixed-point",
      (Ri, zRow, z0Row, lambda) => lambda * Ri + (1 - lambda) * (zRow - z0Row),
      (dRdz, row, col, lambda) => lambda * dRdz + (row === col ? 1 - lambda : 0),
      { initialStep: 0.02, maxGrowth: 1.2, dampingFactor: 0.5 },
    );
  }
}

/**
 * Symbolic Homotopy: Linearize nonlinear operators via λ blending.
 *
 * Conceptually replaces sin(x) → λ·sin(x) + (1-λ)·x in the tape, making
 * the system increasingly linear as λ → 0. In practice, we achieve this
 * by blending the residual with a linearized approximation around z₀.
 */
export class SymbolicHomotopy implements HomotopyStrategy {
  name = "symbolic";

  solve(
    tapeData: { ops: TapeOp[]; outputIndex: number }[],
    unknownList: string[],
    nSolve: number,
    env: Map<string, number>,
    startValues: Map<string, number>,
    maxSteps: number,
  ): HomotopyResult {
    const nUnknowns = unknownList.length;
    const z0 = unknownList.map((name) => startValues.get(name) ?? env.get(name) ?? 0);

    // Pre-compute the linearized residual at z₀: R₀ + J₀·(z - z₀)
    // Set env to z₀ for linearization
    const envCopy = new Map(env);
    for (let i = 0; i < nUnknowns; i++) {
      const name = unknownList[i];
      if (name) envCopy.set(name, z0[i] ?? 0);
    }

    // Compute R₀ and J₀ at z₀
    const R0 = new Array(nSolve).fill(0) as number[];
    const J0: number[][] = [];
    for (let i = 0; i < nSolve; i++) J0[i] = new Array(nSolve).fill(0) as number[];

    for (let row = 0; row < nSolve; row++) {
      const td = tapeData[row];
      if (!td) continue;
      const t = evaluateTapeForward(td.ops, envCopy);
      R0[row] = t[td.outputIndex] ?? 0;
      const grads = evaluateTapeReverse(td.ops, t, td.outputIndex);
      const jRow = J0[row];
      if (!jRow) continue;
      for (let col = 0; col < nSolve; col++) {
        const varName = unknownList[col];
        if (varName) jRow[col] = grads.get(varName) ?? 0;
      }
    }

    // H(z,λ) = λ·R(z) + (1-λ)·[R₀ + J₀·(z - z₀)]
    // At λ=0: linear system J₀·(z - z₀) = -R₀ (easy to solve)
    // At λ=1: full nonlinear R(z) = 0
    return runHomotopyContinuation(
      tapeData,
      unknownList,
      nSolve,
      env,
      startValues,
      maxSteps,
      "symbolic",
      (Ri, zRow, z0Row, lambda, row, z) => {
        // Compute linearized residual: R₀[row] + J₀[row]·(z - z₀)
        let linearR = R0[row] ?? 0;
        const jRow = J0[row];
        if (jRow) {
          for (let col = 0; col < nSolve; col++) {
            linearR += (jRow[col] ?? 0) * ((z[col] ?? 0) - (z0[col] ?? 0));
          }
        }
        return lambda * Ri + (1 - lambda) * linearR;
      },
      (dRdz, row, col, lambda) => {
        const jVal = J0[row]?.[col] ?? 0;
        return lambda * dRdz + (1 - lambda) * jVal;
      },
    );
  }
}

/**
 * Parameter Continuation: Throttle boundary parameters from 0 → actual via λ.
 *
 * For sensitivity-dominated systems, this gradually introduces the effect
 * of boundary parameters by scaling them: p_eff = λ · p_actual.
 * At λ=0 the system uses zero parameters (often trivially solvable).
 */
export class ParameterContinuation implements HomotopyStrategy {
  name = "parameter";

  solve(
    tapeData: { ops: TapeOp[]; outputIndex: number }[],
    unknownList: string[],
    nSolve: number,
    env: Map<string, number>,
    startValues: Map<string, number>,
    maxSteps: number,
  ): HomotopyResult {
    // Identify parameter-like variables (those in env but not in unknowns)
    const unknownSet = new Set(unknownList);
    const paramNames: string[] = [];
    const paramOriginal = new Map<string, number>();
    for (const [name, val] of env) {
      if (!unknownSet.has(name) && name !== "time") {
        paramNames.push(name);
        paramOriginal.set(name, val);
      }
    }

    // Use residual homotopy as the continuation engine, but before each
    // λ step, scale parameters: p_eff = λ · p_actual
    return runHomotopyContinuation(
      tapeData,
      unknownList,
      nSolve,
      env,
      startValues,
      maxSteps,
      "parameter",
      (Ri, zRow, z0Row, lambda) => lambda * Ri + (1 - lambda) * (zRow - z0Row),
      (dRdz, row, col, lambda) => lambda * dRdz + (row === col ? 1 - lambda : 0),
      {
        beforeStep: (lambda: number) => {
          for (const name of paramNames) {
            env.set(name, lambda * (paramOriginal.get(name) ?? 0));
          }
        },
        afterSolve: () => {
          // Restore original parameters
          for (const [name, val] of paramOriginal) env.set(name, val);
        },
      },
    );
  }
}

// ── Auto mode ──

/** Strategy order for auto mode. */
const AUTO_STRATEGIES: HomotopyStrategy[] = [
  new ResidualHomotopy(),
  new FixedPointHomotopy(),
  new SymbolicHomotopy(),
  new ParameterContinuation(),
];

/**
 * Resolve a homotopy mode into a list of strategies to try.
 */
export function resolveStrategies(mode: HomotopyMode): HomotopyStrategy[] {
  switch (mode) {
    case "none":
      return [];
    case "residual":
      return [new ResidualHomotopy()];
    case "fixed-point":
      return [new FixedPointHomotopy()];
    case "symbolic":
      return [new SymbolicHomotopy()];
    case "parameter":
      return [new ParameterContinuation()];
    case "auto":
    default:
      return AUTO_STRATEGIES;
  }
}

/**
 * Try multiple homotopy strategies in order, returning the first convergent result.
 */
export function solveWithAutoHomotopy(
  mode: HomotopyMode,
  tapeData: { ops: TapeOp[]; outputIndex: number }[],
  unknownList: string[],
  nSolve: number,
  env: Map<string, number>,
  startValues: Map<string, number>,
  maxSteps: number,
): HomotopyResult {
  const strategies = resolveStrategies(mode);

  for (const strategy of strategies) {
    // Save env state for rollback on failure
    const envSnapshot = new Map(env);
    const result = strategy.solve(tapeData, unknownList, nSolve, env, startValues, maxSteps);
    if (result.converged) return result;
    // Restore env on failure
    for (const [k, v] of envSnapshot) env.set(k, v);
  }

  return {
    values: new Map<string, number>(),
    iterations: 0,
    residualNorm: Infinity,
    converged: false,
    strategy: "none",
  };
}

// ── Core continuation engine ──

interface ContinuationOptions {
  initialStep?: number;
  maxGrowth?: number;
  dampingFactor?: number;
  beforeStep?: (lambda: number) => void;
  afterSolve?: () => void;
}

type ResidualFn = (Ri: number, zRow: number, z0Row: number, lambda: number, row: number, z: number[]) => number;
type JacobianFn = (dRdz: number, row: number, col: number, lambda: number) => number;

function runHomotopyContinuation(
  tapeData: { ops: TapeOp[]; outputIndex: number }[],
  unknownList: string[],
  nSolve: number,
  env: Map<string, number>,
  startValues: Map<string, number>,
  maxSteps: number,
  strategyName: string,
  hResidual: ResidualFn,
  hJacobian: JacobianFn,
  options?: ContinuationOptions,
): HomotopyResult {
  const result: HomotopyResult = {
    values: new Map<string, number>(),
    iterations: 0,
    residualNorm: Infinity,
    converged: false,
    strategy: strategyName,
  };

  const nUnknowns = unknownList.length;
  const z0 = unknownList.map((name) => startValues.get(name) ?? env.get(name) ?? 0);
  const z = [...z0];

  let lambda = 0;
  let lambdaStep = options?.initialStep ?? 0.1;
  const maxGrowth = options?.maxGrowth ?? 1.5;
  const damping = options?.dampingFactor ?? 1.0;
  const maxTotalIter = maxSteps * 20; // Newton iters across all λ steps
  let totalIter = 0;

  while (lambda < 1.0 && totalIter < maxTotalIter) {
    const targetLambda = Math.min(lambda + lambdaStep, 1.0);

    options?.beforeStep?.(targetLambda);

    let convergedAtLambda = false;
    const maxNewtonIter = 20;

    for (let iter = 0; iter < maxNewtonIter && totalIter < maxTotalIter; iter++) {
      totalIter++;
      result.iterations = totalIter;

      // Update env
      for (let i = 0; i < nUnknowns; i++) {
        const name = unknownList[i];
        if (name) env.set(name, z[i] ?? 0);
      }

      // Evaluate homotopy residuals and Jacobian
      const H = new Array(nSolve).fill(0) as number[];
      const J: number[][] = [];
      for (let i = 0; i < nSolve; i++) J[i] = new Array(nSolve).fill(0) as number[];

      for (let row = 0; row < nSolve; row++) {
        const td = tapeData[row];
        if (!td) continue;

        const t = evaluateTapeForward(td.ops, env);
        const Ri = t[td.outputIndex] ?? 0;
        const grads = evaluateTapeReverse(td.ops, t, td.outputIndex);

        const zRow = row < nUnknowns ? (z[row] ?? 0) : 0;
        const z0Row = row < nUnknowns ? (z0[row] ?? 0) : 0;
        H[row] = hResidual(Ri, zRow, z0Row, targetLambda, row, z);

        const jRow = J[row];
        if (!jRow) continue;
        for (let col = 0; col < nSolve; col++) {
          const varName = unknownList[col];
          if (!varName) continue;
          const dRdz = grads.get(varName) ?? 0;
          jRow[col] = hJacobian(dRdz, row, col, targetLambda);
        }
      }

      // Check convergence
      let norm = 0;
      for (let i = 0; i < nSolve; i++) norm += Math.abs(H[i] ?? 0);
      result.residualNorm = norm;

      if (norm < 1e-10) {
        convergedAtLambda = true;
        break;
      }

      // Solve J·dz = -H
      const negH = H.map((h) => -(h ?? 0));
      const dz = solveLUHomotopy(J, negH, nSolve);
      for (let i = 0; i < nSolve; i++) {
        z[i] = (z[i] ?? 0) + damping * (dz[i] ?? 0);
      }
    }

    if (convergedAtLambda) {
      lambda = targetLambda;
      lambdaStep = Math.min(lambdaStep * maxGrowth, 0.5);
    } else {
      lambdaStep *= 0.5;
      if (lambdaStep < 1e-6) break;
    }
  }

  options?.afterSolve?.();

  result.converged = lambda >= 1.0 - 1e-10;
  for (let i = 0; i < nUnknowns; i++) {
    const name = unknownList[i];
    if (name) result.values.set(name, z[i] ?? 0);
  }

  return result;
}

/** LU solve for homotopy Newton systems. */
function solveLUHomotopy(A: number[][], b: number[], n: number): number[] {
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
