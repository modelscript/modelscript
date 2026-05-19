// SPDX-License-Identifier: AGPL-3.0-or-later

import { collectArenaExprDeps } from "./arena-blt.js";
import { differentiateArenaExpression, simplifyArenaExpression } from "./arena-cas.js";
import { DAEArenaBuilder, EqKind } from "./dae-arena.js";
import type { StringId } from "./interner.js";

/**
 * Result of Pantelides Index Reduction on the arena.
 */
export interface ArenaPantelidesResult {
  /** Variable indices of the states that have been demoted to dummy derivatives. */
  dummyDerivatives: Set<number>;
  /** newly generated constraint equations (EqIdxs added to the arena). */
  generatedEquations: number[];
}

/**
 * Pantelides index reduction using DAEArenaBuilder indices.
 * Identifies algebraic constraints between states and differentiates them.
 */
export function pantelidesIndexReductionArena(
  arena: DAEArenaBuilder,
  stateVars: Set<number>,
  derivativeVars: Set<number>,
  parameters: Set<number>,
): ArenaPantelidesResult {
  const dummyDerivatives = new Set<number>();
  const generatedEquations: number[] = [];

  // We need the string IDs for state vars for the CAS differentiator
  const stateVarStringIds = new Set<StringId>();
  for (const sv of stateVars) {
    stateVarStringIds.add(arena.getVarNameId(sv));
  }

  for (let i = 0; i < arena.eqCount; i++) {
    if (arena.getEqKind(i) !== EqKind.Simple) continue;

    const left = arena.getEqLhs(i);
    const right = arena.getEqRhs(i);

    const deps = new Set<number>();
    collectArenaExprDeps(arena, left, deps);
    collectArenaExprDeps(arena, right, deps);

    const involvedStates = new Set<number>();
    let hasUndefinedNonState = false;

    for (const v of deps) {
      if (stateVars.has(v)) {
        involvedStates.add(v);
      } else if (!derivativeVars.has(v) && !parameters.has(v)) {
        // If there's an algebraic variable that is not a parameter or a derivative,
        // this equation isn't purely a constraint between states.
        hasUndefinedNonState = true;
      }
    }

    if (involvedStates.size < 2 || hasUndefinedNonState) continue;

    // We found a constraint equation involving only states and parameters.
    // E.g., C1.v - C2.v = 0
    // Pick one state to demote. For now, just pick the first one.
    // (A more sophisticated approach looks at the subtracted state, etc.)
    const constrainedState = Array.from(involvedStates)[0] ?? -1;

    if (dummyDerivatives.has(constrainedState)) continue;
    dummyDerivatives.add(constrainedState);

    // Differentiate the constraint: d/dt (LHS) = d/dt (RHS)
    const dLeft = differentiateArenaExpression(arena, left, stateVarStringIds);
    const dRight = differentiateArenaExpression(arena, right, stateVarStringIds);

    const simplifiedLeft = simplifyArenaExpression(arena, dLeft);
    const simplifiedRight = simplifyArenaExpression(arena, dRight);

    const newEqIdx = arena.addEquation(EqKind.Simple, simplifiedLeft, simplifiedRight);
    generatedEquations.push(newEqIdx);
  }

  return { dummyDerivatives, generatedEquations };
}
