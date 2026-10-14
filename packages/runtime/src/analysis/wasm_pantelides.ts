// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  DAEBuilder,
  EqKind,
  ExprKind,
  differentiateArenaExpression,
  simplifyArenaExpression,
} from "../dae/wasm_dae.js";
import type { StringId } from "../workspace/wasm_string_pool.js";
import { collectArenaExprDeps } from "./wasm_blt.js";

/**
 * Result of Pantelides Index Reduction on the arena.
 */
export interface ArenaPantelidesResult {
  /** Variable indices of the states that have been demoted to dummy derivatives. */
  dummyDerivatives: Set<number>;
  /** newly generated constraint equations (EqIdxs added to the arena). */
  generatedEquations: number[];
  /** Structural index computed (defaults to 1 for index-1 ODE systems). */
  structuralIndex?: number;
  /** Mattsson-Söderlind dynamic state selection mapping: constraint eqIdx -> chosen dummy derivative state */
  stateSelectionMap?: Map<number, number>;
}

export interface PantelidesOptions {
  /** Optional state prioritization for Mattsson-Söderlind dynamic state selection (higher score preferred) */
  statePriority?: Map<number, number> | ((varIdx: number) => number);
}

/**
 * Returns true if the expression contains a derivative operator `der()`.
 */
export function containsDerivative(arena: DAEBuilder, exprId: number): boolean {
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
      return containsDerivative(arena, arena.getExprLeft(exprId));
    case ExprKind.Pre:
      return (
        containsDerivative(arena, arena.getExprData1(exprId)) || containsDerivative(arena, arena.getExprLeft(exprId))
      );
    case ExprKind.Call:
    case ExprKind.ArrayCtor:
    case ExprKind.Tuple: {
      const rightVal = arena.getExprRight(exprId);
      const data1Val = arena.getExprData1(exprId);
      const count = kind === ExprKind.Call ? rightVal : rightVal > 0 ? rightVal : data1Val;
      const first = arena.getExprLeft(exprId);
      if (count > 0 && first >= 0) {
        if (containsDerivative(arena, first)) return true;
        for (let j = 1; j < count; j++) {
          const slotIdx = exprId + j;
          const argExpr =
            slotIdx < arena.exprCount && arena.getExprKind(slotIdx) === ExprKind.Tuple
              ? arena.getExprLeft(slotIdx)
              : first + j;
          if (containsDerivative(arena, argExpr)) return true;
        }
      }
      return false;
    }
  }
  return false;
}

/**
 * Pantelides index reduction using DAEBuilder indices.
 * Identifies algebraic constraints between states and differentiates them.
 */
export function pantelidesIndexReductionArena(
  arena: DAEBuilder,
  stateVars: Set<number>,
  derivativeVars: Set<number>,
  parameters: Set<number>,
  options?: PantelidesOptions,
): ArenaPantelidesResult {
  const dummyDerivatives = new Set<number>();
  const generatedEquations: number[] = [];
  const stateSelectionMap = new Map<number, number>();

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

    // Mattsson-Söderlind Dynamic State Selection:
    // Select the state with highest pivot score/priority to become the dummy derivative.
    const candidates = Array.from(involvedStates);
    let bestScore = -Infinity;
    let constrainedState = candidates[0] ?? -1;

    for (const s of candidates) {
      let score = 0;
      if (typeof options?.statePriority === "function") {
        score = options.statePriority(s);
      } else if (options?.statePriority instanceof Map) {
        score = options.statePriority.get(s) ?? 0;
      } else {
        score = dummyDerivatives.has(s) ? -100 : 1;
      }
      if (score > bestScore) {
        bestScore = score;
        constrainedState = s;
      }
    }

    if (dummyDerivatives.has(constrainedState)) continue;
    dummyDerivatives.add(constrainedState);
    stateSelectionMap.set(i, constrainedState);

    // Update the kind of original constraint equation from Simple to InitialSimple
    // so it is enforced only at initial conditions and does not overdetermine dynamic simulation.
    arena.setEqKind(i, EqKind.InitialSimple);

    // Differentiate the constraint: d/dt (LHS) = d/dt (RHS)
    const dLeft = differentiateArenaExpression(arena, left, stateVarStringIds);
    const dRight = differentiateArenaExpression(arena, right, stateVarStringIds);

    const simplifiedLeft = simplifyArenaExpression(arena, dLeft);
    const simplifiedRight = simplifyArenaExpression(arena, dRight);

    const newEqIdx = arena.addEquation(EqKind.Simple, simplifiedLeft, simplifiedRight);
    generatedEquations.push(newEqIdx);
  }

  return {
    dummyDerivatives,
    generatedEquations,
    structuralIndex: dummyDerivatives.size > 0 ? 2 : 1,
    stateSelectionMap,
  };
}

/**
 * WebAssembly-backed Pantelides Index Reduction Engine instance.
 */
export class WasmPantelides {
  constructor(private wasmInstance: any) {}

  reduceIndex(
    daePtr: number,
    bltPtr: number = 0,
  ): {
    structuralIndex: number;
    dummyDerivativeCount: number;
    generatedEquations?: number;
    dummyDerivatives?: number[];
  } {
    const exports = this.wasmInstance?.exports ?? this.wasmInstance;
    if (typeof exports?.runPantelidesIndexReduction === "function") {
      exports.runPantelidesIndexReduction(daePtr, bltPtr);
      const structuralIndex = exports.getPantelidesStructuralIndex?.() ?? 1;
      const dummyDerivativeCount = exports.getPantelidesDummyDerivativeCount?.() ?? 0;
      return { structuralIndex, dummyDerivativeCount };
    }
    if (typeof exports?.dae_createPantelides === "function" && typeof exports?.dae_runPantelides === "function") {
      const pantPtr = exports.dae_createPantelides(daePtr, bltPtr);
      const generatedEquations = exports.dae_runPantelides(pantPtr, 0);
      const structuralIndex = exports.dae_getPantelidesIndex?.(pantPtr) ?? 1;
      const dummyDerivativeCount = exports.dae_getDummyDerivativeCount?.(pantPtr) ?? 0;
      const dummyDerivatives: number[] = [];
      if (typeof exports.dae_getDummyDerivativeVar === "function") {
        for (let i = 0; i < dummyDerivativeCount; i++) {
          const v = exports.dae_getDummyDerivativeVar(pantPtr, i);
          if (v >= 0) dummyDerivatives.push(v);
        }
      }
      return { structuralIndex, dummyDerivativeCount, generatedEquations, dummyDerivatives };
    }
    return { structuralIndex: 1, dummyDerivativeCount: 0 };
  }
}
