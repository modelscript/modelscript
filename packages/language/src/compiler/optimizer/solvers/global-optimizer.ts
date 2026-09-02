// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly Global & Mixed-Integer Optimization Bridge.
 *
 * Unifies continuous NLP, Spatial Branch-and-Bound (sBB) with McCormick relaxations,
 * and Mixed-Integer Nonlinear Programming (MINLP) heuristic equilibrium solvers
 * on DAEBuilder arenas.
 */

import { DAEBuilder } from "../../../runtime/wasm_dae.js";
import { type ImplicitInitBlock } from "../../../runtime/wasm_init.js";
import { type DomainBox, Interval, solveSBB } from "../../../runtime/wasm_interval.js";
import { freezeAndSolve, type MinlpResult } from "../../../runtime/wasm_minlp.js";
import { StaticTapeBuilder } from "../../../runtime/wasm_tape.js";

export interface GlobalOptimizationOptions {
  maxIterations?: number;
  tolerance?: number;
  timeoutMs?: number;
}

export interface GlobalOptimizationProblem {
  dae: DAEBuilder;
  objectiveExpr: number; // ExprId in dae
  variables: string[];
  bounds: Map<string, { min: number; max: number }>;
  discreteVariables?: Set<string>;
}

export interface GlobalOptimizationResult {
  converged: boolean;
  optimumValue: number;
  solution: Map<string, number>;
  iterations: number;
  method: "spatial-branch-and-bound" | "minlp-freeze-and-solve";
}

/**
 * Solve a global optimization or mixed-integer problem backed by WASM kernels.
 */
export function solveGlobalProblem(
  problem: GlobalOptimizationProblem,
  options?: GlobalOptimizationOptions,
): GlobalOptimizationResult {
  const { dae, objectiveExpr, variables, bounds, discreteVariables } = problem;
  const tol = options?.tolerance ?? 1e-6;
  const maxIter = options?.maxIterations ?? 200;

  // If discrete variables are present, use MINLP freeze-and-solve heuristic
  if (discreteVariables && discreteVariables.size > 0) {
    const env = new Map<string, number>();
    for (const v of variables) {
      const b = bounds.get(v);
      env.set(v, b ? (b.min + b.max) / 2 : 0);
    }

    const initBlock: ImplicitInitBlock = {
      type: "implicit",
      equations: [
        {
          lhs: objectiveExpr,
          rhs: dae.addRealLiteral(0.0),
        },
      ],
      unknowns: variables,
      hasDiscreteVars: true,
    };

    const minlpRes: MinlpResult = freezeAndSolve(initBlock, env, discreteVariables, dae, 10, maxIter, tol);

    return {
      converged: minlpRes.converged,
      optimumValue: minlpRes.residualNorm,
      solution: minlpRes.values,
      iterations: minlpRes.totalNewtonIterations,
      method: "minlp-freeze-and-solve",
    };
  }

  // Continuous non-convex global optimization via Spatial Branch-and-Bound on Tape
  const tape = new StaticTapeBuilder(dae.interner);
  const targetNode = tape.addExpression(objectiveExpr, dae);

  const box: DomainBox = new Map();
  for (const v of variables) {
    const b = bounds.get(v);
    box.set(v, new Interval(b?.min ?? -1e4, b?.max ?? 1e4));
  }

  const sbbRes = solveSBB({ ops: tape, outputIndex: targetNode }, [], variables, box, {
    absTol: tol,
    maxNodes: maxIter,
  });

  return {
    converged: sbbRes.optimal,
    optimumValue: sbbRes.objectiveValue,
    solution: sbbRes.solution,
    iterations: sbbRes.nodesExplored,
    method: "spatial-branch-and-bound",
  };
}
