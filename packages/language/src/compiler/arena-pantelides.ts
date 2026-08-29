// SPDX-License-Identifier: AGPL-3.0-or-later

import { collectArenaExprDeps } from "./arena-blt.js";
import { differentiateArenaExpression, simplifyArenaExpression } from "./arena-cas.js";
import { ArenaDAEBuilder, EqKind, ExprKind } from "./dae-arena.js";
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
 * Returns true if the expression contains a derivative operator `der()`.
 */
function containsDerivative(arena: ArenaDAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Der) return true;

  // Recurse into children based on kind
  switch (kind) {
    case ExprKind.Binary:
    case ExprKind.IfElse:
    case ExprKind.Subscript:
    case ExprKind.Range:
      if (containsDerivative(arena, arena.getExprLeft(exprId))) return true;
      if (containsDerivative(arena, arena.getExprRight(exprId))) return true;
      if (kind === ExprKind.IfElse || kind === ExprKind.Subscript || kind === ExprKind.Range) {
        if (containsDerivative(arena, arena.getExprData1(exprId))) return true;
      }
      return false;
    case ExprKind.Unary:
    case ExprKind.Negate:
    case ExprKind.Pre:
      return containsDerivative(arena, arena.getExprLeft(exprId));
    case ExprKind.Call:
    case ExprKind.ArrayCtor:
    case ExprKind.Tuple: {
      const count = kind === ExprKind.Call ? arena.getExprRight(exprId) : arena.getExprData1(exprId);
      const first = arena.getExprLeft(exprId);
      for (let j = 0; j < count; j++) {
        if (containsDerivative(arena, first + j)) return true;
      }
      return false;
    }
  }
  return false;
}

/**
 * Pantelides index reduction using ArenaDAEBuilder indices.
 * Identifies algebraic constraints between states and differentiates them.
 */
export function pantelidesIndexReductionArena(
  arena: ArenaDAEBuilder,
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

    // If the equation contains a derivative ANYWHERE, it's an ODE, not an algebraic constraint on states.
    if (containsDerivative(arena, left) || containsDerivative(arena, right)) continue;

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
