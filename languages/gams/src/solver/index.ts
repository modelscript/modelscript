// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Unified LP / MIP Solver Entrypoint.
 */

import { instantiateGams } from "../dae/instantiator.js";
import type { GamsModel, GamsSolveResult, InstantiatedGamsProblem } from "../types.js";
import { solveMipBranchAndBound } from "./branch-and-bound.js";
import { solveLpSimplex } from "./simplex.js";

export interface GamsSolveOptions {
  maxIterations?: number | undefined;
  maxNodes?: number | undefined;
}

/**
 * Solves a GAMS source string, parsed `GamsModel`, or `InstantiatedGamsProblem`
 * using the built-in Two-Phase Simplex (LP) or Branch-and-Bound (MIP) solver.
 */
export function solveGams(
  input: string | GamsModel | InstantiatedGamsProblem,
  options?: GamsSolveOptions,
): GamsSolveResult {
  const problem: InstantiatedGamsProblem =
    typeof input === "string" || "equationDefs" in input ? instantiateGams(input) : input;

  const hasIntVars = problem.variables.some((v) => v.varKind === "binary" || v.varKind === "integer");
  const useMip = hasIntVars && problem.solverType !== "rmip" && problem.solverType !== "lp";

  const raw = useMip
    ? solveMipBranchAndBound(problem, options?.maxNodes ?? 10000)
    : { ...solveLpSimplex(problem, undefined, options?.maxIterations ?? 50000), nodesExplored: 1 };

  const variableValues: Record<string, number> = {};
  const indexedValues: Record<string, Record<string, number>> = {};

  for (let j = 0; j < problem.variables.length; j++) {
    const v = problem.variables[j]!;
    const val = raw.primal[j] ?? 0;
    variableValues[v.name] = val;
    if (!indexedValues[v.baseName]) indexedValues[v.baseName] = {};
    indexedValues[v.baseName]![v.indices.join(".")] = val;
  }

  const duals: Record<string, number> = {};
  for (let i = 0; i < problem.constraints.length; i++) {
    duals[problem.constraints[i]!.name] = raw.duals[i] ?? 0;
  }

  return {
    status: raw.status,
    objectiveValue: raw.objectiveValue,
    sense: problem.sense,
    solverType: problem.solverType,
    iterations: raw.iterations,
    nodesExplored: raw.nodesExplored,
    variableValues,
    indexedValues,
    duals,
    message: raw.message,
  };
}

export { solveMipBranchAndBound, type MipResult } from "./branch-and-bound.js";
export { solveLpSimplex, type SimplexBoundOverride, type SimplexResult } from "./simplex.js";
