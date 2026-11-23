// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Branch-and-Bound MILP Solver.
 *
 * Solves Mixed-Integer Linear Programs (`binary` and `integer` variables) by
 * branching on fractional integer variables over the Two-Phase Simplex LP relaxation.
 */

import type { GamsSolveStatus, InstantiatedGamsProblem } from "../types.js";
import { solveLpSimplex, type SimplexBoundOverride } from "./simplex.js";

export interface MipResult {
  status: GamsSolveStatus;
  objectiveValue: number;
  primal: number[];
  duals: number[];
  iterations: number;
  nodesExplored: number;
  message?: string | undefined;
}

const INT_TOL = 1e-6;

interface BbNode {
  bounds: Map<number, SimplexBoundOverride>;
  parentBound: number;
}

/**
 * Solves an `InstantiatedGamsProblem` with binary/integer variables using Branch-and-Bound.
 */
export function solveMipBranchAndBound(problem: InstantiatedGamsProblem, maxNodes = 10000): MipResult {
  const intVarIds: number[] = [];
  for (const v of problem.variables) {
    if (v.varKind === "binary" || v.varKind === "integer") {
      intVarIds.push(v.id);
    }
  }

  // Pure LP shortcut
  if (intVarIds.length === 0) {
    const lp = solveLpSimplex(problem);
    return { ...lp, nodesExplored: 1 };
  }

  const isMax = problem.sense === "maximizing";
  let bestObj = isMax ? -Infinity : Infinity;
  let bestPrimal: number[] | null = null;
  let bestDuals: number[] = new Array(problem.constraints.length).fill(0);
  let totalIterations = 0;
  let nodesExplored = 0;

  const isBetter = (candidate: number, incumbent: number): boolean =>
    isMax ? candidate > incumbent + 1e-7 : candidate < incumbent - 1e-7;

  const canBeat = (relaxBound: number, incumbent: number): boolean =>
    isMax ? relaxBound > incumbent + 1e-7 : relaxBound < incumbent - 1e-7;

  const queue: BbNode[] = [{ bounds: new Map(), parentBound: isMax ? Infinity : -Infinity }];

  while (queue.length > 0 && nodesExplored < maxNodes) {
    // Best-first node selection
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      const a = queue[i]!.parentBound;
      const b = queue[bestIdx]!.parentBound;
      if (isMax ? a > b : a < b) {
        bestIdx = i;
      }
    }
    const node = queue.splice(bestIdx, 1)[0]!;

    if (bestPrimal !== null && !canBeat(node.parentBound, bestObj)) {
      continue;
    }

    nodesExplored++;
    const lp = solveLpSimplex(problem, node.bounds);
    totalIterations += lp.iterations;

    if (lp.status !== "optimal") {
      continue;
    }

    if (bestPrimal !== null && !canBeat(lp.objectiveValue, bestObj)) {
      continue;
    }

    // Find most fractional integer variable (closest to 0.5)
    let branchVar = -1;
    let bestFracDist = Infinity;
    let branchVal = 0;
    for (const vid of intVarIds) {
      const val = lp.primal[vid] ?? 0;
      const frac = Math.abs(val - Math.round(val));
      if (frac > INT_TOL) {
        const distToHalf = Math.abs(frac - 0.5);
        if (distToHalf < bestFracDist) {
          bestFracDist = distToHalf;
          branchVar = vid;
          branchVal = val;
        }
      }
    }

    if (branchVar === -1) {
      // Integer-feasible incumbent!
      if (bestPrimal === null || isBetter(lp.objectiveValue, bestObj)) {
        bestObj = lp.objectiveValue;
        bestPrimal = lp.primal.map((val, idx) => (intVarIds.includes(idx) ? Math.round(val) : val));
        bestDuals = lp.duals;
      }
      continue;
    }

    // Branch: x_k <= floor(val) and x_k >= ceil(val)
    const fl = Math.floor(branchVal);
    const cl = Math.ceil(branchVal);

    const leftBounds = new Map(node.bounds);
    const prevL = leftBounds.get(branchVar);
    leftBounds.set(branchVar, {
      lb: prevL?.lb,
      ub: prevL?.ub !== undefined ? Math.min(prevL.ub, fl) : fl,
    });
    queue.push({ bounds: leftBounds, parentBound: lp.objectiveValue });

    const rightBounds = new Map(node.bounds);
    const prevR = rightBounds.get(branchVar);
    rightBounds.set(branchVar, {
      lb: prevR?.lb !== undefined ? Math.max(prevR.lb, cl) : cl,
      ub: prevR?.ub,
    });
    queue.push({ bounds: rightBounds, parentBound: lp.objectiveValue });
  }

  if (bestPrimal === null) {
    return {
      status: "infeasible",
      objectiveValue: NaN,
      primal: new Array(problem.variables.length).fill(0),
      duals: new Array(problem.constraints.length).fill(0),
      iterations: totalIterations,
      nodesExplored,
      message: "No integer-feasible solution found",
    };
  }

  return {
    status: "optimal",
    objectiveValue: bestObj,
    primal: bestPrimal,
    duals: bestDuals,
    iterations: totalIterations,
    nodesExplored,
  };
}
