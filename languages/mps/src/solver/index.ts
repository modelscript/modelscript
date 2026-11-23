// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mps — Unified LP/MILP Solver Entry Point with Presolve.
 */

import { parseMps } from "../parser/mps-parser.js";
import type { MpsModel, MpsSolveResult } from "../types.js";
import { solveMpsMip, type MpsMipSolverOptions } from "./mip.js";
import { presolveMps, type MpsPresolveResult } from "./presolve.js";
import { solveMpsLp, type MpsLpSolverOptions } from "./simplex.js";

export {
  presolveMps,
  solveMpsLp,
  solveMpsMip,
  type MpsLpSolverOptions,
  type MpsMipSolverOptions,
  type MpsPresolveResult,
};

export interface MpsSolveOptions extends MpsLpSolverOptions, MpsMipSolverOptions {
  /** Enable algebraic presolve before solving (default: true). */
  presolve?: boolean | undefined;
}

/**
 * Solves an MPS LP or MILP model (parsed MpsModel or raw MPS source string).
 */
export function solveMps(input: MpsModel | string, options?: MpsSolveOptions): MpsSolveResult {
  const model = typeof input === "string" ? parseMps(input) : input;
  const usePresolve = options?.presolve ?? true;

  let activeModel = model;
  let fixedValues = new Map<string, number>();
  let presolveStats: MpsPresolveResult["stats"] | undefined;

  if (usePresolve) {
    const pre = presolveMps(model);
    presolveStats = pre.stats;
    if (pre.status === "infeasible") {
      return {
        status: "infeasible",
        objectiveValue: Number.NaN,
        primal: {},
        dual: {},
        reducedCosts: {},
        iterations: 0,
        presolve: pre.stats,
      };
    }
    if (pre.status === "unbounded") {
      return {
        status: "unbounded",
        objectiveValue: model.sense === "MAX" ? Infinity : -Infinity,
        primal: {},
        dual: {},
        reducedCosts: {},
        iterations: 0,
        presolve: pre.stats,
      };
    }
    activeModel = pre.reducedModel;
    fixedValues = pre.fixedValues;
  }

  // If presolve eliminated all columns, return immediately
  if (activeModel.columns.size === 0) {
    const primal: Record<string, number> = {};
    for (const [k, v] of fixedValues) primal[k] = v;
    return {
      status: "optimal",
      objectiveValue: presolveStats?.objectiveOffset ?? 0,
      primal,
      dual: {},
      reducedCosts: {},
      iterations: 0,
      presolve: presolveStats,
    };
  }

  const hasDiscrete = [...activeModel.columns.values()].some((c) => c.varType === "integer" || c.varType === "binary");

  const res = hasDiscrete ? solveMpsMip(activeModel, options) : solveMpsLp(activeModel, options);

  // Postsolve: merge fixed values and objective offset
  if (res.status === "optimal") {
    for (const [k, v] of fixedValues) {
      res.primal[k] = v;
    }
    if (presolveStats) {
      res.objectiveValue += presolveStats.objectiveOffset;
      if (Math.abs(res.objectiveValue) < 1e-12) res.objectiveValue = 0;
    }
  }
  res.presolve = presolveStats;
  return res;
}
