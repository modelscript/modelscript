// SPDX-License-Identifier: AGPL-3.0-or-later

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
  structuralIndex?: number | undefined;
  /** Mattsson-Söderlind dynamic state selection mapping: constraint eqIdx -> chosen dummy derivative state */
  stateSelectionMap?: Map<number, number> | undefined;
}

export interface PantelidesOptions {
  /** Optional state prioritization for Mattsson-Söderlind dynamic state selection (higher score preferred) */
  statePriority?: Map<number, number> | ((varIdx: number) => number) | undefined;
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
    case ExprKind.Range:
      if (containsDerivative(arena, arena.getExprLeft(exprId))) return true;
      if (containsDerivative(arena, arena.getExprRight(exprId))) return true;
      if (kind === ExprKind.IfElse || kind === ExprKind.Range) {
        if (containsDerivative(arena, arena.getExprData1(exprId))) return true;
      }
      return false;
    case ExprKind.Subscript: {
      if (containsDerivative(arena, arena.getExprData1(exprId))) return true;
      const subCount = Math.max(1, arena.getExprRight(exprId));
      const firstSub = arena.getExprLeft(exprId);
      for (let i = 0; i < subCount; i++) {
        const subExpr = i === 0 ? firstSub : arena.getExprLeft(exprId + i);
        if (subExpr >= 0 && subExpr !== 0xffffffff && containsDerivative(arena, subExpr)) return true;
      }
      return false;
    }
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

function substituteStateDerAliases(arena: DAEBuilder, exprId: number, derToStateNameId: Map<number, number>): number {
  if (exprId < 0 || derToStateNameId.size === 0) return exprId;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Der) {
    const argId = arena.getExprData1(exprId);
    if (argId >= 0 && arena.getExprKind(argId) === ExprKind.Name) {
      const stateNameId = arena.getExprData1(argId);
      const velNameId = derToStateNameId.get(stateNameId);
      if (velNameId !== undefined) {
        return arena.addExpression(ExprKind.Name, velNameId);
      }
    }
    const newArg = substituteStateDerAliases(arena, argId, derToStateNameId);
    return newArg !== argId ? arena.addDerExpr(newArg) : exprId;
  }
  switch (kind) {
    case ExprKind.Binary: {
      const l = arena.getExprLeft(exprId);
      const r = arena.getExprRight(exprId);
      const nl = substituteStateDerAliases(arena, l, derToStateNameId);
      const nr = substituteStateDerAliases(arena, r, derToStateNameId);
      if (nl !== l || nr !== r) {
        return arena.addBinaryExpr(arena.getExprData1(exprId), nl, nr);
      }
      return exprId;
    }
    case ExprKind.Negate: {
      const l = arena.getExprLeft(exprId);
      const nl = substituteStateDerAliases(arena, l, derToStateNameId);
      return nl !== l ? arena.addNegateExpr(nl) : exprId;
    }
    case ExprKind.Unary: {
      const l = arena.getExprLeft(exprId);
      const nl = substituteStateDerAliases(arena, l, derToStateNameId);
      return nl !== l ? arena.addUnaryExpr(arena.getExprData1(exprId), nl) : exprId;
    }
    case ExprKind.IfElse: {
      const cond = arena.getExprData1(exprId);
      const l = arena.getExprLeft(exprId);
      const r = arena.getExprRight(exprId);
      const nCond = substituteStateDerAliases(arena, cond, derToStateNameId);
      const nl = substituteStateDerAliases(arena, l, derToStateNameId);
      const nr = substituteStateDerAliases(arena, r, derToStateNameId);
      if (nCond !== cond || nl !== l || nr !== r) {
        return arena.addExpression(ExprKind.IfElse, nCond, nl, nr);
      }
      return exprId;
    }
    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const firstArg = arena.getExprLeft(exprId);
      const count = arena.getExprRight(exprId);
      if (count <= 0 || firstArg < 0) return exprId;
      let changed = false;
      const newArgs: number[] = [];
      for (let j = 0; j < count; j++) {
        const slotIdx = exprId + j;
        const origArg =
          j === 0
            ? firstArg
            : slotIdx < arena.exprCount && arena.getExprKind(slotIdx) === ExprKind.Tuple
              ? arena.getExprLeft(slotIdx)
              : firstArg + j;
        const substArg = substituteStateDerAliases(arena, origArg, derToStateNameId);
        if (substArg !== origArg) changed = true;
        newArgs.push(substArg);
      }
      if (!changed) return exprId;
      const callId = arena.addExpression(ExprKind.Call, funcNameId, newArgs[0]!, count);
      for (let j = 1; j < count; j++) {
        arena.addExpression(ExprKind.Tuple, 0, newArgs[j]!, 0);
      }
      return callId;
    }
    case ExprKind.Subscript: {
      const baseExpr = arena.getExprData1(exprId);
      const subCount = Math.max(1, arena.getExprRight(exprId));
      const nBase = substituteStateDerAliases(arena, baseExpr, derToStateNameId);
      let changed = nBase !== baseExpr;
      const newSubs: number[] = [];
      for (let j = 0; j < subCount; j++) {
        const slotIdx = exprId + j;
        const origSub =
          j === 0
            ? arena.getExprLeft(exprId)
            : slotIdx < arena.exprCount && arena.getExprKind(slotIdx) === ExprKind.Tuple
              ? arena.getExprLeft(slotIdx)
              : arena.getExprLeft(exprId + j);
        const nSub = substituteStateDerAliases(arena, origSub, derToStateNameId);
        if (nSub !== origSub) changed = true;
        newSubs.push(nSub);
      }
      if (changed) {
        return arena.addSubscriptExpr(nBase, newSubs);
      }
      return exprId;
    }
    case ExprKind.ArrayCtor:
    case ExprKind.Tuple: {
      const rightVal = arena.getExprRight(exprId);
      const data1Val = arena.getExprData1(exprId);
      const count = rightVal > 0 ? rightVal : data1Val;
      const first = arena.getExprLeft(exprId);
      if (count <= 0 || first < 0) return exprId;
      let changed = false;
      const newElems: number[] = [];
      for (let j = 0; j < count; j++) {
        const slotIdx = exprId + j;
        const origElem =
          j === 0
            ? first
            : slotIdx < arena.exprCount && arena.getExprKind(slotIdx) === ExprKind.Tuple
              ? arena.getExprLeft(slotIdx)
              : first + j;
        const substElem = substituteStateDerAliases(arena, origElem, derToStateNameId);
        if (substElem !== origElem) changed = true;
        newElems.push(substElem);
      }
      if (!changed) return exprId;
      const headId = arena.addExpression(kind, count, newElems[0]!, count);
      for (let j = 1; j < count; j++) {
        arena.addExpression(ExprKind.Tuple, 0, newElems[j]!, 0);
      }
      return headId;
    }
    case ExprKind.Range: {
      const startExpr = arena.getExprData1(exprId);
      const stepExpr = arena.getExprLeft(exprId);
      const stopExpr = arena.getExprRight(exprId);
      const nStart = substituteStateDerAliases(arena, startExpr, derToStateNameId);
      const nStep = stepExpr >= 0 ? substituteStateDerAliases(arena, stepExpr, derToStateNameId) : stepExpr;
      const nStop = substituteStateDerAliases(arena, stopExpr, derToStateNameId);
      if (nStart !== startExpr || nStep !== stepExpr || nStop !== stopExpr) {
        return arena.addExpression(ExprKind.Range, nStart, nStep, nStop);
      }
      return exprId;
    }
    default:
      return exprId;
  }
}

function substituteAlgebraicDefinitions(
  arena: DAEBuilder,
  exprId: number,
  algVarDefs: Map<number, number>,
  depth = 0,
): number {
  if (exprId < 0 || algVarDefs.size === 0 || depth > 8) return exprId;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    const nameId = arena.getExprData1(exprId);
    const varIdx = arena.lookupVariable(nameId);
    if (varIdx >= 0) {
      const defExpr = algVarDefs.get(varIdx);
      if (defExpr !== undefined) {
        return substituteAlgebraicDefinitions(arena, defExpr, algVarDefs, depth + 1);
      }
    }
    return exprId;
  }
  switch (kind) {
    case ExprKind.Binary: {
      const l = arena.getExprLeft(exprId);
      const r = arena.getExprRight(exprId);
      const nl = substituteAlgebraicDefinitions(arena, l, algVarDefs, depth);
      const nr = substituteAlgebraicDefinitions(arena, r, algVarDefs, depth);
      return nl !== l || nr !== r ? arena.addBinaryExpr(arena.getExprData1(exprId), nl, nr) : exprId;
    }
    case ExprKind.Negate: {
      const l = arena.getExprLeft(exprId);
      const nl = substituteAlgebraicDefinitions(arena, l, algVarDefs, depth);
      return nl !== l ? arena.addNegateExpr(nl) : exprId;
    }
    case ExprKind.Unary: {
      const l = arena.getExprLeft(exprId);
      const nl = substituteAlgebraicDefinitions(arena, l, algVarDefs, depth);
      return nl !== l ? arena.addUnaryExpr(arena.getExprData1(exprId), nl) : exprId;
    }
    case ExprKind.Der: {
      const inner = arena.getExprData1(exprId);
      const nInner = substituteAlgebraicDefinitions(arena, inner, algVarDefs, depth);
      return nInner !== inner ? arena.addDerExpr(nInner) : exprId;
    }
    case ExprKind.Pre: {
      const inner = arena.getExprData1(exprId);
      const nInner = substituteAlgebraicDefinitions(arena, inner, algVarDefs, depth);
      return nInner !== inner ? arena.addPreExpr(nInner) : exprId;
    }
    case ExprKind.IfElse: {
      const c = arena.getExprData1(exprId);
      const l = arena.getExprLeft(exprId);
      const r = arena.getExprRight(exprId);
      const nc = substituteAlgebraicDefinitions(arena, c, algVarDefs, depth);
      const nl = substituteAlgebraicDefinitions(arena, l, algVarDefs, depth);
      const nr = substituteAlgebraicDefinitions(arena, r, algVarDefs, depth);
      return nc !== c || nl !== l || nr !== r ? arena.addExpression(ExprKind.IfElse, nc, nl, nr) : exprId;
    }
    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const firstArg = arena.getExprLeft(exprId);
      const count = arena.getExprRight(exprId);
      if (count <= 0 || firstArg < 0) return exprId;
      let changed = false;
      const newArgs: number[] = [];
      for (let j = 0; j < count; j++) {
        const slotIdx = exprId + j;
        const origArg =
          j === 0
            ? firstArg
            : slotIdx < arena.exprCount && arena.getExprKind(slotIdx) === ExprKind.Tuple
              ? arena.getExprLeft(slotIdx)
              : firstArg + j;
        const substArg = substituteAlgebraicDefinitions(arena, origArg, algVarDefs, depth);
        if (substArg !== origArg) changed = true;
        newArgs.push(substArg);
      }
      if (!changed) return exprId;
      const callId = arena.addExpression(ExprKind.Call, funcNameId, newArgs[0]!, count);
      for (let j = 1; j < count; j++) {
        arena.addExpression(ExprKind.Tuple, 0, newArgs[j]!, 0);
      }
      return callId;
    }
    case ExprKind.Subscript: {
      const baseExpr = arena.getExprData1(exprId);
      const subCount = Math.max(1, arena.getExprRight(exprId));
      const nBase = substituteAlgebraicDefinitions(arena, baseExpr, algVarDefs, depth);
      let changed = nBase !== baseExpr;
      const newSubs: number[] = [];
      for (let j = 0; j < subCount; j++) {
        const slotIdx = exprId + j;
        const origSub =
          j === 0
            ? arena.getExprLeft(exprId)
            : slotIdx < arena.exprCount && arena.getExprKind(slotIdx) === ExprKind.Tuple
              ? arena.getExprLeft(slotIdx)
              : arena.getExprLeft(exprId + j);
        const nSub = substituteAlgebraicDefinitions(arena, origSub, algVarDefs, depth);
        if (nSub !== origSub) changed = true;
        newSubs.push(nSub);
      }
      return changed ? arena.addSubscriptExpr(nBase, newSubs) : exprId;
    }
    case ExprKind.ArrayCtor:
    case ExprKind.Tuple: {
      const rightVal = arena.getExprRight(exprId);
      const data1Val = arena.getExprData1(exprId);
      const count = rightVal > 0 ? rightVal : data1Val;
      const first = arena.getExprLeft(exprId);
      if (count <= 0 || first < 0) return exprId;
      let changed = false;
      const newElems: number[] = [];
      for (let j = 0; j < count; j++) {
        const slotIdx = exprId + j;
        const origElem =
          j === 0
            ? first
            : slotIdx < arena.exprCount && arena.getExprKind(slotIdx) === ExprKind.Tuple
              ? arena.getExprLeft(slotIdx)
              : first + j;
        const substElem = substituteAlgebraicDefinitions(arena, origElem, algVarDefs, depth);
        if (substElem !== origElem) changed = true;
        newElems.push(substElem);
      }
      if (!changed) return exprId;
      const headId = arena.addExpression(kind, count, newElems[0]!, count);
      for (let j = 1; j < count; j++) {
        arena.addExpression(ExprKind.Tuple, 0, newElems[j]!, 0);
      }
      return headId;
    }
    case ExprKind.Range: {
      const startExpr = arena.getExprData1(exprId);
      const stepExpr = arena.getExprLeft(exprId);
      const stopExpr = arena.getExprRight(exprId);
      const nStart = substituteAlgebraicDefinitions(arena, startExpr, algVarDefs, depth);
      const nStep = stepExpr >= 0 ? substituteAlgebraicDefinitions(arena, stepExpr, algVarDefs, depth) : stepExpr;
      const nStop = substituteAlgebraicDefinitions(arena, stopExpr, algVarDefs, depth);
      return nStart !== startExpr || nStep !== stepExpr || nStop !== stopExpr
        ? arena.addExpression(ExprKind.Range, nStart, nStep, nStop)
        : exprId;
    }
    default:
      return exprId;
  }
}

/**
 * Pantelides index reduction using DAEBuilder indices.
 * Identifies algebraic constraints between states and differentiates them
 * (including multi-step Index-3 holonomic constraints via kinematic derivative substitution).
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

  const isSkipEq = (eqIdx: number): boolean => {
    if (arena.isEqRemoved?.(eqIdx) || arena.isEqInitial?.(eqIdx)) return true;
    const eqFlags = arena.getEqFlags?.(eqIdx) ?? 0;
    return eqFlags !== -1 && eqFlags >>> 0 !== 0xffffffff && (eqFlags & 1) /* FLAG_EQ_INITIAL */ !== 0;
  };

  // Identify explicit kinematic state-derivative definitions `der(q) = v` where both q, v ∈ stateVars
  const derToStateNameId = new Map<number, number>();
  const velocityStates = new Set<number>();
  for (let i = 0; i < arena.eqCount; i++) {
    if (isSkipEq(i)) continue;
    if (arena.getEqKind(i) !== EqKind.Simple) continue;
    const lhs = arena.getEqLhs(i);
    const rhs = arena.getEqRhs(i);
    if (arena.getExprKind(lhs) === ExprKind.Der && arena.getExprKind(rhs) === ExprKind.Name) {
      const argId = arena.getExprData1(lhs);
      if (argId >= 0 && arena.getExprKind(argId) === ExprKind.Name) {
        const qNameId = arena.getExprData1(argId);
        const vNameId = arena.getExprData1(rhs);
        const qIdx = arena.lookupVariable(qNameId);
        const vIdx = arena.lookupVariable(vNameId);
        if (qIdx >= 0 && vIdx >= 0 && stateVars.has(qIdx) && stateVars.has(vIdx)) {
          derToStateNameId.set(qNameId, vNameId);
          velocityStates.add(vIdx);
        }
      }
    } else if (arena.getExprKind(rhs) === ExprKind.Der && arena.getExprKind(lhs) === ExprKind.Name) {
      const argId = arena.getExprData1(rhs);
      if (argId >= 0 && arena.getExprKind(argId) === ExprKind.Name) {
        const qNameId = arena.getExprData1(argId);
        const vNameId = arena.getExprData1(lhs);
        const qIdx = arena.lookupVariable(qNameId);
        const vIdx = arena.lookupVariable(vNameId);
        if (qIdx >= 0 && vIdx >= 0 && stateVars.has(qIdx) && stateVars.has(vIdx)) {
          derToStateNameId.set(qNameId, vNameId);
          velocityStates.add(vIdx);
        }
      }
    }
  }

  let reductionPasses = 0;
  const maxPasses = 4;

  for (let pass = 0; pass < maxPasses; pass++) {
    let differentiatedInPass = false;
    const eqCountSnapshot = arena.eqCount;

    // Collect explicit algebraic definitions `algVar = expr(states, params)` from derivative-free equations
    // where each algebraic variable is defined once, so coupled constraints through algebraic aliases can be reduced.
    const algVarDefs = new Map<number, number>();
    const algDefEqIndices = new Set<number>();
    for (let i = 0; i < eqCountSnapshot; i++) {
      if (isSkipEq(i)) continue;
      if (arena.getEqKind(i) !== EqKind.Simple) continue;
      const lhs = arena.getEqLhs(i);
      const rhs = arena.getEqRhs(i);
      if (containsDerivative(arena, lhs) || containsDerivative(arena, rhs)) continue;

      if (arena.getExprKind(lhs) === ExprKind.Name) {
        const vIdx = arena.lookupVariable(arena.getExprData1(lhs));
        if (
          vIdx >= 0 &&
          !stateVars.has(vIdx) &&
          !derivativeVars.has(vIdx) &&
          !parameters.has(vIdx) &&
          !algVarDefs.has(vIdx)
        ) {
          const rhsDeps = new Set<number>();
          collectArenaExprDeps(arena, rhs, rhsDeps);
          if (!rhsDeps.has(vIdx)) {
            algVarDefs.set(vIdx, rhs);
            algDefEqIndices.add(i);
            continue;
          }
        }
      }
      if (arena.getExprKind(rhs) === ExprKind.Name) {
        const vIdx = arena.lookupVariable(arena.getExprData1(rhs));
        if (
          vIdx >= 0 &&
          !stateVars.has(vIdx) &&
          !derivativeVars.has(vIdx) &&
          !parameters.has(vIdx) &&
          !algVarDefs.has(vIdx)
        ) {
          const lhsDeps = new Set<number>();
          collectArenaExprDeps(arena, lhs, lhsDeps);
          if (!lhsDeps.has(vIdx)) {
            algVarDefs.set(vIdx, lhs);
            algDefEqIndices.add(i);
          }
        }
      }
    }

    for (let i = 0; i < eqCountSnapshot; i++) {
      if (isSkipEq(i)) continue;
      if (arena.getEqKind(i) !== EqKind.Simple) continue;
      if (algDefEqIndices.has(i)) continue;

      const rawLeft = arena.getEqLhs(i);
      const rawRight = arena.getEqRhs(i);

      // If the equation contains a derivative ANYWHERE, it's an ODE, not an algebraic constraint on states.
      if (containsDerivative(arena, rawLeft) || containsDerivative(arena, rawRight)) continue;

      const left = algVarDefs.size > 0 ? substituteAlgebraicDefinitions(arena, rawLeft, algVarDefs) : rawLeft;
      const right = algVarDefs.size > 0 ? substituteAlgebraicDefinitions(arena, rawRight, algVarDefs) : rawRight;

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
          // this equation isn't purely a constraint on states.
          hasUndefinedNonState = true;
        }
      }

      if (involvedStates.size < 1 || hasUndefinedNonState) continue;

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
          score = dummyDerivatives.has(s) ? -100 : velocityStates.has(s) ? 10 : 1;
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

      // If any differentiated state has a known velocity state alias `der(q) = v`,
      // substitute `der(q) -> v` so higher-index constraints expose velocity-level constraints.
      const substLeft = substituteStateDerAliases(arena, simplifiedLeft, derToStateNameId);
      const substRight = substituteStateDerAliases(arena, simplifiedRight, derToStateNameId);

      const newEqIdx = arena.addEquation(EqKind.Simple, substLeft, substRight);
      generatedEquations.push(newEqIdx);
      differentiatedInPass = true;
    }

    if (differentiatedInPass) {
      reductionPasses++;
    } else {
      break;
    }
  }

  return {
    dummyDerivatives,
    generatedEquations,
    structuralIndex: reductionPasses > 0 ? 1 + reductionPasses : 1,
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
    generatedEquations?: number | undefined;
    dummyDerivatives?: number[] | undefined;
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
