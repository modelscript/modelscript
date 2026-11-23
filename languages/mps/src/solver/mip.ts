// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mps — Branch-and-Bound MILP Solver.
 *
 * Solves Mixed-Integer Linear Programs (integer & binary variables) by solving
 * LP relaxations with Two-Phase Revised Simplex and branching on the most
 * fractional discrete variable using best-bound node selection.
 */

import type { MpsColumn, MpsModel, MpsSolveResult } from "../types.js";
import { solveMpsLp } from "./simplex.js";

export interface MpsMipSolverOptions {
  maxNodes?: number | undefined;
  maxLpIterations?: number | undefined;
  integralityTol?: number | undefined;
  mipGapTol?: number | undefined;
}

interface BbNode {
  lbOverrides: Map<string, number>;
  ubOverrides: Map<string, number>;
  parentBound: number;
}

function applyBounds(model: MpsModel, lbMap: Map<string, number>, ubMap: Map<string, number>): MpsModel {
  const columns = new Map<string, MpsColumn>();
  for (const [k, c] of model.columns) {
    columns.set(k, {
      ...c,
      lb: lbMap.get(k) ?? c.lb,
      ub: ubMap.get(k) ?? c.ub,
    });
  }
  return { ...model, columns };
}

/**
 * Solves a Mixed-Integer Linear Program via Branch-and-Bound.
 */
export function solveMpsMip(model: MpsModel, options?: MpsMipSolverOptions): MpsSolveResult {
  const maxNodes = options?.maxNodes ?? 2000;
  const intTol = options?.integralityTol ?? 1e-6;
  const gapTol = options?.mipGapTol ?? 1e-6;
  const isMax = model.sense === "MAX";

  const discreteCols = [...model.columns.values()]
    .filter((c) => c.varType === "integer" || c.varType === "binary")
    .map((c) => c.name);

  if (discreteCols.length === 0) {
    return solveMpsLp(model, { maxIterations: options?.maxLpIterations });
  }

  let bestObj = isMax ? -Infinity : Infinity;
  let bestPrimal: Record<string, number> | null = null;
  let totalIterations = 0;
  let nodesExplored = 0;

  const isBetter = (a: number, b: number): boolean => (isMax ? a > b + 1e-9 : a < b - 1e-9);
  const canPrune = (bound: number): boolean => {
    if (bestPrimal === null) return false;
    if (isMax) {
      return bound <= bestObj + Math.max(1e-8, gapTol * Math.abs(bestObj));
    }
    return bound >= bestObj - Math.max(1e-8, gapTol * Math.abs(bestObj));
  };

  const queue: BbNode[] = [
    {
      lbOverrides: new Map(),
      ubOverrides: new Map(),
      parentBound: isMax ? Infinity : -Infinity,
    },
  ];

  while (queue.length > 0 && nodesExplored < maxNodes) {
    // Best-bound node selection
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      const a = queue[i]!.parentBound;
      const b = queue[bestIdx]!.parentBound;
      if (isMax ? a > b : a < b) {
        bestIdx = i;
      }
    }
    const node = queue.splice(bestIdx, 1)[0]!;

    if (canPrune(node.parentBound)) {
      continue;
    }

    const subModel = applyBounds(model, node.lbOverrides, node.ubOverrides);
    const lpRes = solveMpsLp(subModel, { maxIterations: options?.maxLpIterations });
    totalIterations += lpRes.iterations;
    nodesExplored++;

    if (lpRes.status === "infeasible") {
      continue;
    }
    if (lpRes.status === "unbounded") {
      return {
        status: "unbounded",
        objectiveValue: isMax ? Infinity : -Infinity,
        primal: {},
        dual: {},
        reducedCosts: {},
        iterations: totalIterations,
        nodesExplored,
      };
    }
    if (lpRes.status !== "optimal") {
      continue;
    }

    if (canPrune(lpRes.objectiveValue)) {
      continue;
    }

    // Find most fractional discrete variable (closest to 0.5)
    let branchVar: string | null = null;
    let branchVal = 0;
    let maxFrac = -1;

    for (const colName of discreteCols) {
      const val = lpRes.primal[colName] ?? 0;
      const frac = Math.abs(val - Math.round(val));
      if (frac > intTol) {
        const distFromHalf = 0.5 - Math.abs(frac - 0.5);
        if (distFromHalf > maxFrac) {
          maxFrac = distFromHalf;
          branchVar = colName;
          branchVal = val;
        }
      }
    }

    if (branchVar === null) {
      // Integer-feasible incumbent found!
      if (isBetter(lpRes.objectiveValue, bestObj)) {
        bestObj = lpRes.objectiveValue;
        bestPrimal = { ...lpRes.primal };
        for (const colName of discreteCols) {
          bestPrimal[colName] = Math.round(bestPrimal[colName] ?? 0);
        }
      }
      continue;
    }

    const floorVal = Math.floor(branchVal);
    const ceilVal = Math.ceil(branchVal);
    const col = subModel.columns.get(branchVar)!;

    // Left branch: x <= floorVal
    if (floorVal >= col.lb - 1e-9) {
      const nextUb = new Map(node.ubOverrides);
      nextUb.set(branchVar, Math.min(col.ub, floorVal));
      queue.push({
        lbOverrides: new Map(node.lbOverrides),
        ubOverrides: nextUb,
        parentBound: lpRes.objectiveValue,
      });
    }

    // Right branch: x >= ceilVal
    if (ceilVal <= col.ub + 1e-9) {
      const nextLb = new Map(node.lbOverrides);
      nextLb.set(branchVar, Math.max(col.lb, ceilVal));
      queue.push({
        lbOverrides: nextLb,
        ubOverrides: new Map(node.ubOverrides),
        parentBound: lpRes.objectiveValue,
      });
    }
  }

  if (bestPrimal === null) {
    return {
      status: nodesExplored >= maxNodes ? "node_limit" : "infeasible",
      objectiveValue: Number.NaN,
      primal: {},
      dual: {},
      reducedCosts: {},
      iterations: totalIterations,
      nodesExplored,
    };
  }

  return {
    status: queue.length === 0 ? "optimal" : "node_limit",
    objectiveValue: Math.abs(bestObj) < 1e-12 ? 0 : bestObj,
    primal: bestPrimal,
    dual: {},
    reducedCosts: {},
    iterations: totalIterations,
    nodesExplored,
    mipGap: queue.length === 0 ? 0 : undefined,
  };
}
