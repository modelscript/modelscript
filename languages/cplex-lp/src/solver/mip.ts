// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Branch-and-Bound Mixed-Integer Linear Programming (MILP) Solver.
 *
 * Uses `solveLpSimplex` for LP relaxations and best-bound node selection
 * with most-fractional branching to solve binary and general integer models.
 */

import type { CplexLpModel } from "../types.js";
import { solveLpSimplex, type LpSolveOptions, type SolverStatus } from "./simplex.js";

export interface MipSolveOptions extends LpSolveOptions {
  maxNodes?: number | undefined;
  integralityTolerance?: number | undefined;
  mipGapTolerance?: number | undefined;
}

export interface MipSolution {
  status: SolverStatus;
  objectiveValue: number;
  values: Record<string, number>;
  iterations: number;
  nodesExplored: number;
  gap: number;
}

interface BbNode {
  bounds: Map<string, { lower: number; upper: number }>;
  boundEstimate: number;
}

function cloneBounds(
  src: Map<string, { lower: number; upper: number }>,
): Map<string, { lower: number; upper: number }> {
  const copy = new Map<string, { lower: number; upper: number }>();
  for (const [k, v] of src) {
    copy.set(k, { lower: v.lower, upper: v.upper });
  }
  return copy;
}

/**
 * Solves a CPLEX LP or MILP model using Two-Phase Simplex (for pure LPs)
 * or Branch-and-Bound (when binary or general integer variables are present).
 */
export function solveCplexLp(model: CplexLpModel, options?: MipSolveOptions): MipSolution {
  if (!model.objective) {
    return {
      status: "infeasible",
      objectiveValue: NaN,
      values: {},
      iterations: 0,
      nodesExplored: 0,
      gap: Infinity,
    };
  }

  // Collect integer & binary variables
  const intVars: string[] = [];
  const baseBounds = new Map<string, { lower: number; upper: number }>();

  for (const name of model.variableOrder) {
    const info = model.variables.get(name)!;
    let lower = info.lower;
    let upper = info.upper;
    if (info.domain === "binary") {
      lower = Math.max(0, lower);
      upper = Math.min(1, upper);
      intVars.push(name);
    } else if (info.domain === "general") {
      intVars.push(name);
    }
    baseBounds.set(name, { lower, upper });
  }

  // Pure LP fast path
  if (intVars.length === 0) {
    const lp = solveLpSimplex(model, options);
    return {
      ...lp,
      nodesExplored: 1,
      gap: lp.status === "optimal" ? 0 : Infinity,
    };
  }

  const isMax = model.objective.sense === "maximize";
  const maxNodes = options?.maxNodes ?? 5000;
  const intTol = options?.integralityTolerance ?? 1e-6;
  const gapTol = options?.mipGapTolerance ?? 1e-6;

  let bestObj = isMax ? -Infinity : Infinity;
  let bestValues: Record<string, number> | null = null;
  let totalIterations = 0;
  let nodesExplored = 0;

  const isBetter = (candidate: number, incumbent: number): boolean =>
    isMax ? candidate > incumbent + 1e-9 : candidate < incumbent - 1e-9;

  const isPrunable = (relaxObj: number, incumbent: number): boolean => {
    if (!Number.isFinite(incumbent)) return false;
    const scale = Math.max(1, Math.abs(incumbent));
    return isMax ? relaxObj <= incumbent + gapTol * scale : relaxObj >= incumbent - gapTol * scale;
  };

  // Root node
  const rootLp = solveLpSimplex(model, { ...options, boundOverrides: baseBounds });
  totalIterations += rootLp.iterations;
  nodesExplored++;

  if (rootLp.status === "infeasible") {
    return {
      status: "infeasible",
      objectiveValue: NaN,
      values: {},
      iterations: totalIterations,
      nodesExplored,
      gap: Infinity,
    };
  }
  if (rootLp.status === "unbounded") {
    return {
      status: "unbounded",
      objectiveValue: rootLp.objectiveValue,
      values: {},
      iterations: totalIterations,
      nodesExplored,
      gap: Infinity,
    };
  }
  if (rootLp.status !== "optimal") {
    return {
      status: rootLp.status,
      objectiveValue: NaN,
      values: {},
      iterations: totalIterations,
      nodesExplored,
      gap: Infinity,
    };
  }

  // Helper to find most fractional integer variable
  const findBranchVar = (vals: Record<string, number>): { name: string; value: number } | null => {
    let bestVar: string | null = null;
    let bestVal = 0;
    let bestFrac = intTol;
    for (const v of intVars) {
      const val = vals[v] ?? 0;
      const frac = Math.min(val - Math.floor(val), Math.ceil(val) - val);
      if (frac > bestFrac) {
        bestFrac = frac;
        bestVar = v;
        bestVal = val;
      }
    }
    return bestVar ? { name: bestVar, value: bestVal } : null;
  };

  const rootBranch = findBranchVar(rootLp.values);
  if (!rootBranch) {
    // Root relaxation is already integer-feasible!
    const rounded: Record<string, number> = { ...rootLp.values };
    for (const v of intVars) {
      rounded[v] = Math.round(rounded[v] ?? 0);
    }
    return {
      status: "optimal",
      objectiveValue: rootLp.objectiveValue,
      values: rounded,
      iterations: totalIterations,
      nodesExplored,
      gap: 0,
    };
  }

  // Priority queue (best-bound first)
  const openNodes: BbNode[] = [];

  const pushChildren = (
    parentBounds: Map<string, { lower: number; upper: number }>,
    branchVar: string,
    branchVal: number,
    parentEst: number,
  ): void => {
    const fl = Math.floor(branchVal);
    const ce = Math.ceil(branchVal);
    const cur = parentBounds.get(branchVar)!;

    if (fl >= cur.lower - 1e-9) {
      const left = cloneBounds(parentBounds);
      left.set(branchVar, { lower: cur.lower, upper: Math.min(cur.upper, fl) });
      openNodes.push({ bounds: left, boundEstimate: parentEst });
    }
    if (ce <= cur.upper + 1e-9) {
      const right = cloneBounds(parentBounds);
      right.set(branchVar, { lower: Math.max(cur.lower, ce), upper: cur.upper });
      openNodes.push({ bounds: right, boundEstimate: parentEst });
    }
  };

  pushChildren(baseBounds, rootBranch.name, rootBranch.value, rootLp.objectiveValue);

  while (openNodes.length > 0 && nodesExplored < maxNodes) {
    // Select best-bound node
    let bestIdx = 0;
    for (let i = 1; i < openNodes.length; i++) {
      const a = openNodes[i]!.boundEstimate;
      const b = openNodes[bestIdx]!.boundEstimate;
      if (isMax ? a > b : a < b) {
        bestIdx = i;
      }
    }
    const node = openNodes.splice(bestIdx, 1)[0]!;

    if (isPrunable(node.boundEstimate, bestObj)) {
      continue;
    }

    const lp = solveLpSimplex(model, { ...options, boundOverrides: node.bounds });
    totalIterations += lp.iterations;
    nodesExplored++;

    if (lp.status !== "optimal") {
      continue;
    }

    if (isPrunable(lp.objectiveValue, bestObj)) {
      continue;
    }

    const branch = findBranchVar(lp.values);
    if (!branch) {
      // Integer-feasible solution found
      if (isBetter(lp.objectiveValue, bestObj)) {
        bestObj = lp.objectiveValue;
        const rounded: Record<string, number> = { ...lp.values };
        for (const v of intVars) {
          rounded[v] = Math.round(rounded[v] ?? 0);
        }
        bestValues = rounded;
      }
    } else {
      pushChildren(node.bounds, branch.name, branch.value, lp.objectiveValue);
    }
  }

  if (!bestValues) {
    return {
      status: nodesExplored >= maxNodes ? "iteration_limit" : "infeasible",
      objectiveValue: NaN,
      values: {},
      iterations: totalIterations,
      nodesExplored,
      gap: Infinity,
    };
  }

  // Compute remaining optimality gap
  let bestBound = bestObj;
  for (const n of openNodes) {
    if (isMax ? n.boundEstimate > bestBound : n.boundEstimate < bestBound) {
      bestBound = n.boundEstimate;
    }
  }
  const gap = openNodes.length === 0 ? 0 : Math.abs(bestBound - bestObj) / Math.max(1, Math.abs(bestObj));

  return {
    status: openNodes.length === 0 || gap <= gapTol ? "optimal" : "iteration_limit",
    objectiveValue: bestObj,
    values: bestValues,
    iterations: totalIterations,
    nodesExplored,
    gap,
  };
}
