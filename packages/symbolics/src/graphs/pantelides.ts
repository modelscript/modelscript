// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pantelides algorithm for structural index reduction of DAE systems.
 *
 * High-index DAEs (e.g., constrained mechanical systems like pendulums)
 * cannot be solved directly by standard ODE solvers. The Pantelides
 * algorithm systematically differentiates constraint equations to reduce
 * the index to 1 (or 0), producing an augmented system that standard
 * solvers can handle.
 *
 * Algorithm outline:
 *   1. Build a bipartite graph: equations ↔ variables
 *   2. Find a maximum matching using augmenting paths
 *   3. If not all equations are matched, differentiate the unmatched
 *      constraint equations symbolically
 *   4. Introduce derivative variables (dummy derivatives)
 *   5. Repeat until a complete matching exists
 *
 * Reference: Pantelides, C.C. (1988),
 *   "The Consistent Initialization of Differential-Algebraic Systems",
 *   SIAM J. Sci. Stat. Comput., 9(2), 213-231.
 *
 * Note: This is an opt-in, pre-processing step before BLT analysis.
 * Invoke via the `--index-reduction` CLI flag.
 */

// ── Public interface ──

/**
 * A symbolic equation in the bipartite graph.
 * Each equation references a set of variables by index.
 */
export interface PantelidesEquation {
  /** Unique equation index. */
  index: number;
  /** Variable indices that appear in this equation. */
  variableIndices: number[];
  /** Original equation identifier (for traceability). */
  originalName: string;
  /** Differentiation level (0 = original, 1 = first derivative, etc.). */
  diffLevel: number;
}

/**
 * A variable in the bipartite graph.
 */
export interface PantelidesVariable {
  /** Unique variable index. */
  index: number;
  /** Variable name (dot-qualified). */
  name: string;
  /** If this is a derivative variable, the index of its parent. */
  derivativeOf?: number;
  /** Whether this is a state variable (has a derivative). */
  isState: boolean;
  /** Whether selected as a dummy derivative for index reduction. */
  isDummy: boolean;
}

/**
 * Result of the Pantelides index reduction.
 */
export interface IndexReductionResult {
  /** Original equations (unmodified). */
  originalEquations: PantelidesEquation[];
  /** Augmented equations (includes differentiated constraints). */
  augmentedEquations: PantelidesEquation[];
  /** Augmented variable list (includes derivative variables). */
  augmentedVariables: PantelidesVariable[];
  /** Indices of variables selected as dummy derivatives. */
  dummyDerivatives: number[];
  /** The maximum matching: equation index → variable index. */
  matching: Map<number, number>;
  /** Number of differentiation rounds performed. */
  diffRounds: number;
  /** Structural index of the original system. */
  structuralIndex: number;
}

/**
 * Callback to symbolically differentiate an equation.
 *
 * Given an equation index and the current variable set,
 * returns a new equation (with updated variable references)
 * and any new derivative variables introduced.
 */
export type DifferentiateCallback = (
  eq: PantelidesEquation,
  variables: PantelidesVariable[],
) => {
  /** The differentiated equation. */
  equation: PantelidesEquation;
  /** New derivative variables introduced (if any). */
  newVariables: PantelidesVariable[];
};

// ── Pantelides algorithm ──

/**
 * Run the Pantelides structural index reduction algorithm.
 *
 * @param equations   Initial equation set
 * @param variables   Initial variable set
 * @param differentiate  Callback to symbolically differentiate an equation
 * @returns Index reduction result with augmented system
 */
export function pantelides(
  equations: PantelidesEquation[],
  variables: PantelidesVariable[],
  differentiate: DifferentiateCallback,
): IndexReductionResult {
  // Work copies
  const eqs = equations.map((e) => ({ ...e, variableIndices: [...e.variableIndices] }));
  const vars = variables.map((v) => ({ ...v }));
  let diffRounds = 0;
  const maxRounds = 50; // Safety limit

  while (diffRounds < maxRounds) {
    // Step 1: Build bipartite adjacency
    const eqToVars = new Map<number, Set<number>>();
    for (const eq of eqs) {
      eqToVars.set(eq.index, new Set(eq.variableIndices));
    }

    // Step 2: Find maximum matching using augmenting paths
    const matching = findMaxMatching(eqs, vars, eqToVars);

    // Step 3: Check if all equations are matched
    const unmatchedEqs: PantelidesEquation[] = [];
    for (const eq of eqs) {
      if (!matching.has(eq.index)) {
        unmatchedEqs.push(eq);
      }
    }

    if (unmatchedEqs.length === 0) {
      // All equations matched — index reduction complete
      return {
        originalEquations: equations,
        augmentedEquations: eqs,
        augmentedVariables: vars,
        dummyDerivatives: vars.filter((v) => v.isDummy).map((v) => v.index),
        matching,
        diffRounds,
        structuralIndex: diffRounds + 1,
      };
    }

    // Step 4: Differentiate unmatched equations
    diffRounds++;
    for (const unmatchedEq of unmatchedEqs) {
      const { equation: diffEq, newVariables } = differentiate(unmatchedEq, vars);

      // Assign new index to the differentiated equation
      diffEq.index = eqs.length;
      diffEq.diffLevel = unmatchedEq.diffLevel + 1;
      eqs.push(diffEq);

      // Add new derivative variables
      for (const newVar of newVariables) {
        newVar.index = vars.length;
        vars.push(newVar);
      }
    }
  }

  // Reached max rounds — return best effort
  const finalMatching = findMaxMatching(eqs, vars, buildAdjacency(eqs));
  return {
    originalEquations: equations,
    augmentedEquations: eqs,
    augmentedVariables: vars,
    dummyDerivatives: vars.filter((v) => v.isDummy).map((v) => v.index),
    matching: finalMatching,
    diffRounds,
    structuralIndex: diffRounds + 1,
  };
}

// ── Matching algorithm ──

/**
 * Find a maximum matching in the bipartite equation–variable graph
 * using the Hopcroft-Karp-inspired augmenting path algorithm.
 */
function findMaxMatching(
  eqs: PantelidesEquation[],
  _vars: PantelidesVariable[],
  eqToVars: Map<number, Set<number>>,
): Map<number, number> {
  const matchEqToVar = new Map<number, number>(); // equation → variable
  const matchVarToEq = new Map<number, number>(); // variable → equation

  for (const eq of eqs) {
    const visited = new Set<number>();
    augment(eq.index, eqToVars, matchEqToVar, matchVarToEq, visited);
  }

  return matchEqToVar;
}

/**
 * Try to find an augmenting path starting from equation `eqIdx`.
 * Returns true if a path is found and the matching is augmented.
 */
function augment(
  eqIdx: number,
  eqToVars: Map<number, Set<number>>,
  matchEqToVar: Map<number, number>,
  matchVarToEq: Map<number, number>,
  visited: Set<number>,
): boolean {
  const neighbors = eqToVars.get(eqIdx);
  if (!neighbors) return false;

  for (const varIdx of neighbors) {
    if (visited.has(varIdx)) continue;
    visited.add(varIdx);

    const matchedEq = matchVarToEq.get(varIdx);
    if (matchedEq === undefined || augment(matchedEq, eqToVars, matchEqToVar, matchVarToEq, visited)) {
      matchEqToVar.set(eqIdx, varIdx);
      matchVarToEq.set(varIdx, eqIdx);
      return true;
    }
  }

  return false;
}

/** Build adjacency map from equations. */
function buildAdjacency(eqs: PantelidesEquation[]): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  for (const eq of eqs) {
    adj.set(eq.index, new Set(eq.variableIndices));
  }
  return adj;
}

/**
 * Select dummy derivatives using the Mattsson-Söderlind algorithm.
 *
 * After Pantelides augments the system, some derivative variables
 * need to be "demoted" to algebraic variables (dummy derivatives)
 * so the augmented system has the correct structure.
 *
 * @param result The Pantelides result to post-process
 * @returns Updated result with dummy derivatives selected
 */
export function selectDummyDerivatives(result: IndexReductionResult): IndexReductionResult {
  // For each differentiation level > 0, find variables that were
  // introduced as derivatives and mark them as dummy if their
  // parent variable is already a state.
  const stateVars = new Set<number>();
  for (const v of result.augmentedVariables) {
    if (v.isState) stateVars.add(v.index);
  }

  for (const v of result.augmentedVariables) {
    if (v.derivativeOf !== undefined && stateVars.has(v.derivativeOf)) {
      // This derivative's parent is already a state — check if
      // the derivative itself is also matched as a state
      const isMatchedAsState = result.augmentedEquations.some(
        (eq) => eq.diffLevel > 0 && result.matching.get(eq.index) === v.index,
      );
      if (!isMatchedAsState) {
        v.isDummy = true;
        result.dummyDerivatives.push(v.index);
      }
    }
  }

  return result;
}
