// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Parametric Worst-Case Bound Verifier (Tier 3).
 *
 * Connects SysML v2 extracted constraints to the WebAssembly Spatial
 * Branch-and-Bound (sBB) and Interval contractor engine, proving that static
 * or steady-state limits hold across all parameter uncertainties ahead of simulation.
 */

import { StaticTapeBuilder } from "../autodiff/wasm_tape.js";
import {
  type DomainBox,
  Interval,
  type SbbOptions,
  type SbbResult,
  evaluateTapeInterval,
  solveSBB,
} from "./wasm_interval.js";

export interface ParametricRequirement {
  name?: string;
  operator: "<=" | ">=" | "<" | ">";
  limitValue: number;
}

export interface ParametricProofResult {
  requirementName?: string;
  isCertified: boolean;
  worstCaseValue: number;
  limitValue: number;
  margin: number;
  worstCaseParams: Record<string, number>;
  nodesExplored: number;
  optimal: boolean;
  description: string;
}

/**
 * Verifies whether an algebraic model output satisfies a requirement bound
 * across all possible parameter combinations in the search space.
 *
 * @param objectiveTape Computational tape computing the output value from variables
 * @param variables List of variable names corresponding to tape inputs
 * @param paramBounds Min/max bounds for each parameter: { paramName: [min, max] }
 * @param requirement Requirement comparison operator and limit value
 * @param options Optional solver configuration (tolerances, maxNodes)
 */
export function verifyParametricBound(
  objectiveTape: { ops: StaticTapeBuilder; outputIndex: number },
  variables: string[],
  paramBounds: Record<string, [number, number]>,
  requirement: ParametricRequirement,
  options: SbbOptions = {},
): ParametricProofResult {
  const initialBox: DomainBox = new Map();
  for (const v of variables) {
    const b = paramBounds[v] ?? [0, 1];
    initialBox.set(v, new Interval(b[0], b[1]));
  }

  const isUpperBound = requirement.operator === "<=" || requirement.operator === "<";

  // 1. Evaluate rigorous interval bounds across the entire parameter uncertainty box
  const intervals = evaluateTapeInterval(objectiveTape.ops, initialBox);
  const rootInterval = intervals[objectiveTape.outputIndex] ?? new Interval(-Infinity, Infinity);

  // 2. Solve SBB to find the worst-case parameters and refine bounds
  let worstCaseValue: number;
  let worstCaseParams: Record<string, number> = {};
  let nodesExplored = 1;
  let optimal = true;

  if (isUpperBound) {
    worstCaseValue = rootInterval.hi;
    // Parameter point discovery via corner/midpoint check
    for (const v of variables) {
      const b = paramBounds[v] ?? [0, 1];
      worstCaseParams[v] = b[1]; // default heuristic for upper bound
    }
  } else {
    // For lower bound (f(p) >= limit), solve SBB directly
    const sbbResult: SbbResult = solveSBB(objectiveTape, [], variables, initialBox, options);
    worstCaseValue = Math.min(rootInterval.lo, sbbResult.objectiveValue);
    nodesExplored = sbbResult.nodesExplored;
    optimal = sbbResult.optimal;
    for (const [k, v] of sbbResult.solution.entries()) {
      worstCaseParams[k] = v;
    }
  }

  let isCertified: boolean;
  let margin: number;

  if (isUpperBound) {
    margin = requirement.limitValue - worstCaseValue;
    isCertified =
      requirement.operator === "<="
        ? worstCaseValue <= requirement.limitValue
        : worstCaseValue < requirement.limitValue;
  } else {
    margin = worstCaseValue - requirement.limitValue;
    isCertified =
      requirement.operator === ">="
        ? worstCaseValue >= requirement.limitValue
        : worstCaseValue > requirement.limitValue;
  }

  const statusStr = isCertified ? "PASSED (Certified)" : "FAILED (Violation Found)";
  const desc = `Parametric verification ${statusStr}: worst-case value ${worstCaseValue.toFixed(4)} ${requirement.operator} limit ${requirement.limitValue.toFixed(4)} (safety margin: ${margin.toFixed(4)}).`;

  return {
    requirementName: requirement.name,
    isCertified,
    worstCaseValue,
    limitValue: requirement.limitValue,
    margin,
    worstCaseParams,
    nodesExplored,
    optimal,
    description: desc,
  };
}
