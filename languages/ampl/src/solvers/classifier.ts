// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Problem Classifier: Analyzes problem structure and computes sparsity and problem statistics.
 */

import type { InstantiatedProblem, ProblemClass } from "../types.js";

export interface ProblemStatistics {
  problemClass: ProblemClass;
  numVars: number;
  numContinuous: number;
  numInteger: number;
  numBinary: number;
  numConstraints: number;
  numEquality: number;
  numInequality: number;
  numNonzeros: number;
  density: number;
  numCones?: number;
}

export function classifyProblem(problem: InstantiatedProblem): ProblemStatistics {
  const numVars = problem.variables.length;
  let numContinuous = 0;
  let numInteger = 0;
  let numBinary = 0;

  for (const v of problem.variables) {
    if (v.type === "binary") numBinary++;
    else if (v.type === "integer") numInteger++;
    else numContinuous++;
  }

  const numConstraints = problem.constraints.length;
  let numEquality = 0;
  let numInequality = 0;
  let numNonzeros = 0;

  for (const c of problem.constraints) {
    const isEq =
      Number.isFinite(c.lb) &&
      Number.isFinite(c.ub) &&
      Math.abs(c.lb - c.ub) < 1e-9;
    if (isEq) numEquality++;
    else numInequality++;

    numNonzeros += c.expr.linearTerms.length;
  }

  const totalEntries = numVars * numConstraints;
  const density = totalEntries > 0 ? numNonzeros / totalEntries : 0;

  return {
    problemClass: problem.problemClass,
    numVars,
    numContinuous,
    numInteger,
    numBinary,
    numConstraints,
    numEquality,
    numInequality,
    numNonzeros,
    density,
    numCones: problem.cones?.length ?? 0,
  };
}
