// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  DAEBuilder,
  EqKind,
  ExprKind,
  Variability,
  differentiateArenaExpression,
  simplifyArenaExpression,
} from "../dae/wasm_dae.js";
import type { StringId } from "../workspace/wasm_string_pool.js";
import { collectArenaExprDeps } from "./wasm_blt.js";

/**
 * Result of Pryce's Sigma-method structural analysis on the DAE arena.
 */
export interface PryceSignatureMatrix {
  /** Active equation indices in the arena (rows of Sigma) */
  eqIdxs: number[];
  /** Active fundamental variable indices in the arena (columns of Sigma: states + algebraic variables) */
  varIdxs: number[];
  /**
   * Signature matrix Sigma[i][j]: highest derivative order of variable varIdxs[j]
   * appearing in equation eqIdxs[i], or -Infinity if varIdxs[j] does not appear.
   */
  sigma: number[][];
  /** Equation differentiation offsets c[i] >= 0 from Pryce's Sigma-method */
  c: number[];
  /** Variable highest derivative orders d[j] >= 0 from Pryce's Sigma-method */
  d: number[];
  /** Bipartite matching on the highest-order transversal: eqRow -> varCol (-1 if unmatched) */
  rowMatch: number[];
  /** Bipartite matching on the highest-order transversal: varCol -> eqRow (-1 if unmatched) */
  colMatch: number[];
  /** Structural index computed from Pryce's dual offsets (1 for index-1 ODE/DAE, >= 2 for higher-index) */
  structuralIndex: number;
}

/**
 * Full structural DAE index analysis result.
 */
export interface StructuralDaeIndexAnalysis {
  structuralIndex: number;
  signatureMatrix: PryceSignatureMatrix;
  singularSubsets: number[][];
  equationDiffOrders: Map<number, number>;
  variableOrders: Map<number, number>;
}

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
  /** Optional Pryce Sigma-method dual offsets (c_i for equations, d_j for variables) */
  pryceOffsets?: { c: Map<number, number>; d: Map<number, number> } | undefined;
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

function isSkipArenaEq(arena: DAEBuilder, eqIdx: number): boolean {
  if (arena.isEqRemoved?.(eqIdx) || arena.isEqInitial?.(eqIdx)) return true;
  const eqFlags = arena.getEqFlags?.(eqIdx) ?? 0;
  return eqFlags !== -1 && eqFlags >>> 0 !== 0xffffffff && (eqFlags & 1) /* FLAG_EQ_INITIAL */ !== 0;
}

function containsTargetExpr(arena: DAEBuilder, exprId: number, matchFn: (id: number) => boolean): boolean {
  if (exprId < 0) return false;
  if (matchFn(exprId)) return true;
  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Binary:
    case ExprKind.IfElse:
    case ExprKind.Range:
      if (containsTargetExpr(arena, arena.getExprLeft(exprId), matchFn)) return true;
      if (containsTargetExpr(arena, arena.getExprRight(exprId), matchFn)) return true;
      if (kind === ExprKind.IfElse || kind === ExprKind.Range) {
        if (containsTargetExpr(arena, arena.getExprData1(exprId), matchFn)) return true;
      }
      return false;
    case ExprKind.Unary:
    case ExprKind.Negate: {
      const inner = arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId);
      return containsTargetExpr(arena, inner, matchFn);
    }
    case ExprKind.Der:
    case ExprKind.Pre:
      return containsTargetExpr(arena, arena.getExprData1(exprId), matchFn);
    case ExprKind.Subscript: {
      if (containsTargetExpr(arena, arena.getExprData1(exprId), matchFn)) return true;
      const subCount = Math.max(1, arena.getExprRight(exprId));
      const firstSub = arena.getExprLeft(exprId);
      for (let i = 0; i < subCount; i++) {
        const subExpr = i === 0 ? firstSub : arena.getExprLeft(exprId + i);
        if (subExpr >= 0 && subExpr !== 0xffffffff && containsTargetExpr(arena, subExpr, matchFn)) return true;
      }
      return false;
    }
    case ExprKind.Call:
    case ExprKind.ArrayCtor:
    case ExprKind.Tuple: {
      const rightVal = arena.getExprRight(exprId);
      const data1Val = arena.getExprData1(exprId);
      const count = kind === ExprKind.Call ? rightVal : rightVal > 0 ? rightVal : data1Val;
      const first = arena.getExprLeft(exprId);
      if (count > 0 && first >= 0) {
        if (containsTargetExpr(arena, first, matchFn)) return true;
        for (let j = 1; j < count; j++) {
          const slotIdx = exprId + j;
          const argExpr =
            slotIdx < arena.exprCount && arena.getExprKind(slotIdx) === ExprKind.Tuple
              ? arena.getExprLeft(slotIdx)
              : first + j;
          if (containsTargetExpr(arena, argExpr, matchFn)) return true;
        }
      }
      return false;
    }
    default:
      return false;
  }
}

function isStructuralZeroExpr(arena: DAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const k = arena.getExprKind(exprId);
  if (k === ExprKind.RealLiteral) return arena.getExprRealValue(exprId) === 0;
  if (k === ExprKind.IntLiteral) return arena.getExprData1(exprId) === 0;
  if (k === ExprKind.Name) {
    const nameId = arena.getExprData1(exprId);
    const varIdx = arena.lookupVariable(nameId);
    if (varIdx !== -1) {
      const v = arena.getVarVariability(varIdx);
      if (v === Variability.Parameter || v === Variability.Constant) {
        const bindExpr = arena.getExplicitVarExpression
          ? arena.getExplicitVarExpression(varIdx)
          : arena.getVarExpression(varIdx);
        if (bindExpr !== undefined && bindExpr >= 0) {
          return isStructuralZeroExpr(arena, bindExpr);
        }
        const startExpr = arena.getVarAttr?.(varIdx, "start");
        if (startExpr !== undefined && startExpr >= 0) {
          return isStructuralZeroExpr(arena, startExpr);
        }
      }
    }
    return false;
  }
  if (k === ExprKind.Negate) {
    const left = arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId);
    return isStructuralZeroExpr(arena, left);
  }
  if (k === ExprKind.Binary) {
    const op = arena.getExprData1(exprId);
    if (op === BinOp.Mul || op === BinOp.ElemMul) {
      return (
        isStructuralZeroExpr(arena, arena.getExprLeft(exprId)) ||
        isStructuralZeroExpr(arena, arena.getExprRight(exprId))
      );
    }
  }
  return false;
}

function solveLinearSideForTarget(
  arena: DAEBuilder,
  exprId: number,
  otherSideExprId: number,
  matchFn: (id: number) => boolean,
): number | null {
  if (exprId < 0) return null;
  if (matchFn(exprId)) {
    if (containsTargetExpr(arena, otherSideExprId, matchFn)) return null;
    return otherSideExprId;
  }
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Negate) {
    const inner = arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId);
    const negOther = isStructuralZeroExpr(arena, otherSideExprId)
      ? otherSideExprId
      : arena.addNegateExpr(otherSideExprId);
    return solveLinearSideForTarget(arena, inner, negOther, matchFn);
  }
  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId);
    const l = arena.getExprLeft(exprId);
    const r = arena.getExprRight(exprId);
    const inL = containsTargetExpr(arena, l, matchFn);
    const inR = containsTargetExpr(arena, r, matchFn);
    if ((inL && inR) || (!inL && !inR)) return null;

    if (op === BinOp.Add) {
      if (inL) {
        const nextOther = isStructuralZeroExpr(arena, otherSideExprId)
          ? arena.addNegateExpr(r)
          : arena.addBinaryExpr(BinOp.Sub, otherSideExprId, r);
        return solveLinearSideForTarget(arena, l, nextOther, matchFn);
      } else {
        const nextOther = isStructuralZeroExpr(arena, otherSideExprId)
          ? arena.addNegateExpr(l)
          : arena.addBinaryExpr(BinOp.Sub, otherSideExprId, l);
        return solveLinearSideForTarget(arena, r, nextOther, matchFn);
      }
    }
    if (op === BinOp.Sub) {
      if (inL) {
        const nextOther = isStructuralZeroExpr(arena, otherSideExprId)
          ? r
          : arena.addBinaryExpr(BinOp.Add, otherSideExprId, r);
        return solveLinearSideForTarget(arena, l, nextOther, matchFn);
      } else {
        const nextOther = isStructuralZeroExpr(arena, otherSideExprId)
          ? l
          : arena.addBinaryExpr(BinOp.Sub, l, otherSideExprId);
        return solveLinearSideForTarget(arena, r, nextOther, matchFn);
      }
    }
    if (op === BinOp.Mul) {
      if (inL && !isStructuralZeroExpr(arena, r)) {
        const nextOther = isStructuralZeroExpr(arena, otherSideExprId)
          ? otherSideExprId
          : arena.addBinaryExpr(BinOp.Div, otherSideExprId, r);
        return solveLinearSideForTarget(arena, l, nextOther, matchFn);
      }
      if (inR && !isStructuralZeroExpr(arena, l)) {
        const nextOther = isStructuralZeroExpr(arena, otherSideExprId)
          ? otherSideExprId
          : arena.addBinaryExpr(BinOp.Div, otherSideExprId, l);
        return solveLinearSideForTarget(arena, r, nextOther, matchFn);
      }
    }
  }
  return null;
}

function tryIsolateLinearTargetInEq(
  arena: DAEBuilder,
  lhs: number,
  rhs: number,
  matchFn: (id: number) => boolean,
): number | null {
  const inL = containsTargetExpr(arena, lhs, matchFn);
  const inR = containsTargetExpr(arena, rhs, matchFn);
  if (inL && !inR) {
    return solveLinearSideForTarget(arena, lhs, rhs, matchFn);
  }
  if (inR && !inL) {
    return solveLinearSideForTarget(arena, rhs, lhs, matchFn);
  }
  return null;
}

function substituteDerExpressions(
  arena: DAEBuilder,
  exprId: number,
  derDefsByStateVarIdx: Map<number, number>,
  depth = 0,
): number {
  if (exprId < 0 || derDefsByStateVarIdx.size === 0 || depth > 8) return exprId;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Der) {
    const argId = arena.getExprData1(exprId);
    if (argId >= 0 && arena.getExprKind(argId) === ExprKind.Name) {
      const stateNameId = arena.getExprData1(argId);
      const qIdx = arena.lookupVariable(stateNameId);
      if (qIdx >= 0) {
        const defExpr = derDefsByStateVarIdx.get(qIdx);
        if (defExpr !== undefined) {
          return substituteDerExpressions(arena, defExpr, derDefsByStateVarIdx, depth + 1);
        }
      }
    }
    const nArg = substituteDerExpressions(arena, argId, derDefsByStateVarIdx, depth);
    return nArg !== argId ? arena.addDerExpr(nArg) : exprId;
  }
  if (kind === ExprKind.Name) {
    const nameId = arena.getExprData1(exprId);
    const name = arena.interner.resolve(nameId);
    if (name && name.startsWith("der(") && name.endsWith(")")) {
      const innerName = name.slice(4, -1);
      const qIdx = arena.getVarIdxByName(innerName);
      if (qIdx >= 0) {
        const defExpr = derDefsByStateVarIdx.get(qIdx);
        if (defExpr !== undefined) {
          return substituteDerExpressions(arena, defExpr, derDefsByStateVarIdx, depth + 1);
        }
      }
    }
    return exprId;
  }
  switch (kind) {
    case ExprKind.Binary: {
      const l = arena.getExprLeft(exprId);
      const r = arena.getExprRight(exprId);
      const nl = substituteDerExpressions(arena, l, derDefsByStateVarIdx, depth);
      const nr = substituteDerExpressions(arena, r, derDefsByStateVarIdx, depth);
      return nl !== l || nr !== r ? arena.addBinaryExpr(arena.getExprData1(exprId), nl, nr) : exprId;
    }
    case ExprKind.Negate: {
      const l = arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId);
      const nl = substituteDerExpressions(arena, l, derDefsByStateVarIdx, depth);
      return nl !== l ? arena.addNegateExpr(nl) : exprId;
    }
    case ExprKind.Unary: {
      const l = arena.getExprLeft(exprId);
      const nl = substituteDerExpressions(arena, l, derDefsByStateVarIdx, depth);
      return nl !== l ? arena.addUnaryExpr(arena.getExprData1(exprId), nl) : exprId;
    }
    case ExprKind.IfElse: {
      const c = arena.getExprData1(exprId);
      const l = arena.getExprLeft(exprId);
      const r = arena.getExprRight(exprId);
      const nc = substituteDerExpressions(arena, c, derDefsByStateVarIdx, depth);
      const nl = substituteDerExpressions(arena, l, derDefsByStateVarIdx, depth);
      const nr = substituteDerExpressions(arena, r, derDefsByStateVarIdx, depth);
      return nc !== c || nl !== l || nr !== r ? arena.addExpression(ExprKind.IfElse, nc, nl, nr) : exprId;
    }
    default:
      return exprId;
  }
}

/**
 * Computes Pryce's Sigma-Method signature matrix Sigma_ij and dual offsets (c_i, d_j)
 * via maximum-weight bipartite matching and fixed-point dual propagation.
 */
export function computePryceSignatureMatrix(
  arena: DAEBuilder,
  stateVars?: Set<number>,
  derivativeVars?: Set<number>,
  parameters?: Set<number>,
): PryceSignatureMatrix {
  const eqIdxs: number[] = [];
  for (let i = 0; i < arena.eqCount; i++) {
    if (isSkipArenaEq(arena, i)) continue;
    if (arena.getEqKind(i) === EqKind.Simple) {
      eqIdxs.push(i);
    }
  }

  // Map explicit derivative variables `der(x)` to their base variable `x`
  const derVarToBase = new Map<number, { baseVarIdx: number; order: number }>();
  const inferredStates = new Set<number>(stateVars);

  for (let v = 0; v < arena.varCount; v++) {
    if (arena.isVarRemoved(v)) continue;
    const name = arena.getVarName(v);
    let curName = name;
    let order = 0;
    while (curName.startsWith("der(") && curName.endsWith(")")) {
      curName = curName.slice(4, -1);
      order++;
    }
    if (order > 0) {
      const baseIdx = arena.getVarIdxByName(curName);
      if (baseIdx >= 0) {
        derVarToBase.set(v, { baseVarIdx: baseIdx, order });
        inferredStates.add(baseIdx);
      }
    }
  }

  const varIdxs: number[] = [];
  const varToCol = new Map<number, number>();
  for (let v = 0; v < arena.varCount; v++) {
    if (arena.isVarRemoved(v)) continue;
    if (derVarToBase.has(v) || derivativeVars?.has(v)) continue;
    const variability = arena.getVarVariability(v);
    if (variability === Variability.Parameter || variability === Variability.Constant || parameters?.has(v)) {
      continue;
    }
    varToCol.set(v, varIdxs.length);
    varIdxs.push(v);
  }

  const M = eqIdxs.length;
  const N = varIdxs.length;
  const sigma: number[][] = Array.from({ length: M }, () => Array(N).fill(-Infinity));

  const collectOrders = (exprId: number, curOrder: number, row: number): void => {
    if (exprId < 0) return;
    const kind = arena.getExprKind(exprId);
    switch (kind) {
      case ExprKind.Der: {
        collectOrders(arena.getExprData1(exprId), curOrder + 1, row);
        break;
      }
      case ExprKind.Name: {
        const nameId = arena.getExprData1(exprId);
        const vIdx = arena.lookupVariable(nameId);
        if (vIdx >= 0) {
          const derInfo = derVarToBase.get(vIdx);
          if (derInfo) {
            const col = varToCol.get(derInfo.baseVarIdx);
            if (col !== undefined) {
              const totalOrd = curOrder + derInfo.order;
              if (totalOrd > sigma[row]![col]!) sigma[row]![col] = totalOrd;
            }
          } else {
            const col = varToCol.get(vIdx);
            if (col !== undefined) {
              if (curOrder > sigma[row]![col]!) sigma[row]![col] = curOrder;
              if (curOrder > 0) inferredStates.add(vIdx);
            }
          }
        }
        break;
      }
      case ExprKind.Binary: {
        const op = arena.getExprData1(exprId);
        const l = arena.getExprLeft(exprId);
        const r = arena.getExprRight(exprId);
        if (
          (op === BinOp.Mul || op === BinOp.ElemMul) &&
          (isStructuralZeroExpr(arena, l) || isStructuralZeroExpr(arena, r))
        ) {
          break;
        }
        collectOrders(l, curOrder, row);
        collectOrders(r, curOrder, row);
        break;
      }
      case ExprKind.Negate:
      case ExprKind.Unary: {
        const inner = arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId);
        collectOrders(inner, curOrder, row);
        break;
      }
      case ExprKind.Pre:
        collectOrders(arena.getExprData1(exprId), curOrder, row);
        break;
      case ExprKind.IfElse:
      case ExprKind.Range:
        collectOrders(arena.getExprData1(exprId), curOrder, row);
        collectOrders(arena.getExprLeft(exprId), curOrder, row);
        collectOrders(arena.getExprRight(exprId), curOrder, row);
        break;
      case ExprKind.Call:
      case ExprKind.ArrayCtor:
      case ExprKind.Tuple: {
        const rightVal = arena.getExprRight(exprId);
        const data1Val = arena.getExprData1(exprId);
        const count = kind === ExprKind.Call ? rightVal : rightVal > 0 ? rightVal : data1Val;
        const first = arena.getExprLeft(exprId);
        if (count > 0 && first >= 0) {
          collectOrders(first, curOrder, row);
          for (let j = 1; j < count; j++) {
            const slotIdx = exprId + j;
            const argExpr =
              slotIdx < arena.exprCount && arena.getExprKind(slotIdx) === ExprKind.Tuple
                ? arena.getExprLeft(slotIdx)
                : first + j;
            collectOrders(argExpr, curOrder, row);
          }
        }
        break;
      }
      case ExprKind.Subscript: {
        collectOrders(arena.getExprData1(exprId), curOrder, row);
        const subCount = Math.max(1, arena.getExprRight(exprId));
        const firstSub = arena.getExprLeft(exprId);
        for (let i = 0; i < subCount; i++) {
          const subExpr = i === 0 ? firstSub : arena.getExprLeft(exprId + i);
          if (subExpr >= 0 && subExpr !== 0xffffffff) collectOrders(subExpr, curOrder, row);
        }
        break;
      }
    }
  };

  for (let i = 0; i < M; i++) {
    const eqIdx = eqIdxs[i]!;
    collectOrders(arena.getEqLhs(eqIdx), 0, i);
    collectOrders(arena.getEqRhs(eqIdx), 0, i);
  }

  // Maximum-cardinality, maximum-weight bipartite matching via Bellman-Ford augmenting paths
  const rowMatch = new Array<number>(M).fill(-1);
  const colMatch = new Array<number>(N).fill(-1);
  const W_MAX = 1000;

  while (true) {
    // Nodes: 0..M-1 (rows), M..M+N-1 (cols), M+N (sink)
    const totalNodes = M + N + 1;
    const SINK = M + N;
    const dist = new Array<number>(totalNodes).fill(Infinity);
    const parent = new Array<number>(totalNodes).fill(-1);

    for (let i = 0; i < M; i++) {
      if (rowMatch[i] === -1) {
        dist[i] = 0;
      }
    }

    let updated = true;
    for (let iter = 0; iter < totalNodes && updated; iter++) {
      updated = false;
      // Forward edges: row i -> col j (unmatched edge)
      for (let i = 0; i < M; i++) {
        if (dist[i] === Infinity) continue;
        for (let j = 0; j < N; j++) {
          if (rowMatch[i] === j) continue;
          const s = sigma[i]![j]!;
          if (s < 0) continue;
          const cost = W_MAX - s;
          if (dist[i]! + cost < dist[M + j]!) {
            dist[M + j] = dist[i]! + cost;
            parent[M + j] = i;
            updated = true;
          }
        }
      }
      // Backward edges: col j -> matched row i, or col j -> SINK if unmatched
      for (let j = 0; j < N; j++) {
        const dCol = dist[M + j]!;
        if (dCol === Infinity) continue;
        const mRow = colMatch[j]!;
        if (mRow === -1) {
          if (dCol < dist[SINK]!) {
            dist[SINK] = dCol;
            parent[SINK] = M + j;
            updated = true;
          }
        } else {
          const s = sigma[mRow]![j]!;
          const revCost = -(W_MAX - s);
          if (dCol + revCost < dist[mRow]!) {
            dist[mRow] = dCol + revCost;
            parent[mRow] = M + j;
            updated = true;
          }
        }
      }
    }

    if (dist[SINK] === Infinity) break;

    // Augment along shortest path
    let cur = parent[SINK]!;
    while (cur !== -1) {
      const col = cur - M;
      const row = parent[cur]!;
      const prevColNode = parent[row]!;
      rowMatch[row] = col;
      colMatch[col] = row;
      cur = prevColNode;
    }
  }

  // Pryce's Fixed-Point Iteration for dual offsets c_i >= 0 and d_j >= 0
  const c = new Array<number>(M).fill(0);
  const d = new Array<number>(N).fill(0);
  const maxIter = M * N + 10;

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let j = 0; j < N; j++) {
      const vIdx = varIdxs[j]!;
      let maxVal = inferredStates.has(vIdx) ? 1 : 0;
      for (let i = 0; i < M; i++) {
        const s = sigma[i]![j]!;
        if (s >= 0 && s + c[i]! > maxVal) {
          maxVal = s + c[i]!;
        }
      }
      if (maxVal !== d[j]) {
        d[j] = maxVal;
        changed = true;
      }
    }

    for (let i = 0; i < M; i++) {
      const mCol = rowMatch[i]!;
      if (mCol >= 0) {
        const s = sigma[i]![mCol]!;
        if (s >= 0) {
          const reqC = d[mCol]! - s;
          if (reqC > c[i]!) {
            c[i] = reqC;
            changed = true;
          }
        }
      } else {
        // Unmatched equation in a structurally singular subset:
        // must be differentiated at least enough to reach the highest derivative order of its variables
        let reqC = c[i]!;
        for (let j = 0; j < N; j++) {
          const s = sigma[i]![j]!;
          if (s >= 0 && d[j]! - s > reqC) {
            reqC = d[j]! - s;
          }
        }
        if (reqC === 0) reqC = 1;
        if (reqC > c[i]!) {
          c[i] = reqC;
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  let maxC = 0;
  for (let i = 0; i < M; i++) {
    if (c[i]! > maxC) maxC = c[i]!;
  }

  return {
    eqIdxs,
    varIdxs,
    sigma,
    c,
    d,
    rowMatch,
    colMatch,
    structuralIndex: maxC > 0 ? 1 + maxC : 1,
  };
}

/**
 * Analyzes the structural index and minimal structurally singular (MSS) equation subsets
 * of a DAE in the arena using Pryce's Sigma-method and bipartite augmenting paths.
 */
export function analyzeStructuralDaeIndex(
  arena: DAEBuilder,
  stateVars?: Set<number>,
  derivativeVars?: Set<number>,
  parameters?: Set<number>,
): StructuralDaeIndexAnalysis {
  const sig = computePryceSignatureMatrix(arena, stateVars, derivativeVars, parameters);
  const equationDiffOrders = new Map<number, number>();
  const variableOrders = new Map<number, number>();
  const singularSubsets: number[][] = [];

  for (let i = 0; i < sig.eqIdxs.length; i++) {
    equationDiffOrders.set(sig.eqIdxs[i]!, sig.c[i]!);
  }
  for (let j = 0; j < sig.varIdxs.length; j++) {
    variableOrders.set(sig.varIdxs[j]!, sig.d[j]!);
  }

  // Build highest-derivative incidence graph (edges where sigma[i][j] === maxOrderOfCol(j))
  // to identify Hall / KönigMinimal Structurally Singular (MSS) subsets
  const M = sig.eqIdxs.length;
  const N = sig.varIdxs.length;
  const colMaxSigma = new Array<number>(N).fill(0);
  for (let j = 0; j < N; j++) {
    const vIdx = sig.varIdxs[j]!;
    let mx = stateVars?.has(vIdx) ? 1 : 0;
    for (let i = 0; i < M; i++) {
      if (sig.sigma[i]![j]! > mx) mx = sig.sigma[i]![j]!;
    }
    colMaxSigma[j] = mx;
  }

  const rowToHighCols: number[][] = Array.from({ length: M }, () => []);
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < N; j++) {
      const sVal = sig.sigma[i]![j]!;
      if (sVal >= 0 && sVal === colMaxSigma[j]) {
        rowToHighCols[i]!.push(j);
      }
    }
  }

  const highColMatch = new Array<number>(N).fill(-1);
  for (let i = 0; i < M; i++) {
    const visitedRows = new Set<number>();
    const visitedCols = new Set<number>();
    const dfs = (r: number): boolean => {
      visitedRows.add(r);
      for (const c of rowToHighCols[r]!) {
        if (visitedCols.has(c)) continue;
        visitedCols.add(c);
        if (highColMatch[c] === -1 || dfs(highColMatch[c]!)) {
          highColMatch[c] = r;
          return true;
        }
      }
      return false;
    };
    if (!dfs(i)) {
      const subset = Array.from(visitedRows).map((r) => sig.eqIdxs[r]!);
      singularSubsets.push(subset);
    }
  }

  return {
    structuralIndex: sig.structuralIndex,
    signatureMatrix: sig,
    singularSubsets,
    equationDiffOrders,
    variableOrders,
  };
}

/**
 * Pantelides / Pryce Sigma-method index reduction using DAEBuilder indices.
 * Identifies algebraic constraints between states as well as coupled multi-equation
 * structural singularities (via bipartite matching on highest-order derivatives and
 * linear/algebraic elimination) and differentiates them (including multi-step Index-3
 * holonomic constraints such as the Cartesian pendulum).
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

  // Compute initial Pryce signature matrix before mutations for reference offsets
  const initialSig = computePryceSignatureMatrix(arena, stateVars, derivativeVars, parameters);
  const pryceC = new Map<number, number>();
  const pryceD = new Map<number, number>();
  for (let i = 0; i < initialSig.eqIdxs.length; i++) {
    pryceC.set(initialSig.eqIdxs[i]!, initialSig.c[i]!);
  }
  for (let j = 0; j < initialSig.varIdxs.length; j++) {
    pryceD.set(initialSig.varIdxs[j]!, initialSig.d[j]!);
  }

  // We need the string IDs for state vars for the CAS differentiator
  const stateVarStringIds = new Set<StringId>();
  for (const sv of stateVars) {
    stateVarStringIds.add(arena.getVarNameId(sv));
  }

  // Identify explicit or residual kinematic state-derivative definitions `der(q) = v` or `der(q) - v = 0`
  // where both q, v ∈ stateVars
  const derToStateNameId = new Map<number, number>();
  const velocityStates = new Set<number>();
  for (let i = 0; i < arena.eqCount; i++) {
    if (isSkipArenaEq(arena, i)) continue;
    if (arena.getEqKind(i) !== EqKind.Simple) continue;
    const lhs = arena.getEqLhs(i);
    const rhs = arena.getEqRhs(i);

    for (const qIdx of stateVars) {
      const qNameId = arena.getVarNameId(qIdx);
      const isDerOfQ = (id: number): boolean => {
        if (id < 0 || arena.getExprKind(id) !== ExprKind.Der) return false;
        const argId = arena.getExprData1(id);
        return argId >= 0 && arena.getExprKind(argId) === ExprKind.Name && arena.getExprData1(argId) === qNameId;
      };
      const isolated = tryIsolateLinearTargetInEq(arena, lhs, rhs, isDerOfQ);
      if (isolated !== null && arena.getExprKind(isolated) === ExprKind.Name) {
        const vNameId = arena.getExprData1(isolated);
        const vIdx = arena.lookupVariable(vNameId);
        if (vIdx >= 0 && stateVars.has(vIdx) && vIdx !== qIdx) {
          derToStateNameId.set(qNameId, vNameId);
          velocityStates.add(vIdx);
        }
      }
    }
  }

  const selectDummyState = (involvedStates: Set<number>): number => {
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
    return constrainedState;
  };

  let reductionPasses = 0;
  const maxPasses = 4;

  for (let pass = 0; pass < maxPasses; pass++) {
    let differentiatedInPass = false;
    const eqCountSnapshot = arena.eqCount;

    // 1. Collect explicit or linearly-isolable algebraic definitions `algVar = expr(states, params)`
    // from derivative-free equations so coupled constraints through algebraic variables can be reduced.
    const algVarDefs = new Map<number, number>();
    const algDefEqIndices = new Set<number>();
    for (let i = 0; i < eqCountSnapshot; i++) {
      if (isSkipArenaEq(arena, i)) continue;
      if (arena.getEqKind(i) !== EqKind.Simple) continue;
      const lhs = arena.getEqLhs(i);
      const rhs = arena.getEqRhs(i);
      if (containsDerivative(arena, lhs) || containsDerivative(arena, rhs)) continue;

      const eqDeps = new Set<number>();
      collectArenaExprDeps(arena, lhs, eqDeps);
      collectArenaExprDeps(arena, rhs, eqDeps);

      for (const vIdx of eqDeps) {
        if (stateVars.has(vIdx) || derivativeVars.has(vIdx) || parameters.has(vIdx) || algVarDefs.has(vIdx)) {
          continue;
        }
        const vNameId = arena.getVarNameId(vIdx);
        const isolated = tryIsolateLinearTargetInEq(
          arena,
          lhs,
          rhs,
          (id) => arena.getExprKind(id) === ExprKind.Name && arena.getExprData1(id) === vNameId,
        );
        if (isolated !== null) {
          const substIsolated =
            algVarDefs.size > 0 ? substituteAlgebraicDefinitions(arena, isolated, algVarDefs) : isolated;
          const isoDeps = new Set<number>();
          collectArenaExprDeps(arena, substIsolated, isoDeps);
          if (!isoDeps.has(vIdx)) {
            algVarDefs.set(vIdx, substIsolated);
            algDefEqIndices.add(i);
            break;
          }
        }
      }
    }

    for (let i = 0; i < eqCountSnapshot; i++) {
      if (isSkipArenaEq(arena, i)) continue;
      if (arena.getEqKind(i) !== EqKind.Simple) continue;
      if (algDefEqIndices.has(i)) continue;

      const rawLeft = arena.getEqLhs(i);
      const rawRight = arena.getEqRhs(i);

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
          hasUndefinedNonState = true;
        }
      }

      if (involvedStates.size < 1 || hasUndefinedNonState) continue;

      const constrainedState = selectDummyState(involvedStates);
      if (constrainedState < 0 || dummyDerivatives.has(constrainedState)) continue;
      dummyDerivatives.add(constrainedState);
      stateSelectionMap.set(i, constrainedState);

      arena.setEqKind(i, EqKind.InitialSimple);

      const dLeft = differentiateArenaExpression(arena, left, stateVarStringIds);
      const dRight = differentiateArenaExpression(arena, right, stateVarStringIds);

      const simplifiedLeft = simplifyArenaExpression(arena, dLeft);
      const simplifiedRight = simplifyArenaExpression(arena, dRight);

      const substLeft = substituteStateDerAliases(arena, simplifiedLeft, derToStateNameId);
      const substRight = substituteStateDerAliases(arena, simplifiedRight, derToStateNameId);

      const newEqIdx = arena.addEquation(EqKind.Simple, substLeft, substRight);
      generatedEquations.push(newEqIdx);
      differentiatedInPass = true;
    }

    // 2. Bipartite Augmenting-Path MSS (Minimal Structurally Singular) Pass:
    // Detects coupled multi-equation singularities where derivative-containing equations
    // share the same highest-order derivatives / algebraic variables (e.g., Hall deficiency |S_eqs| > |S_vars|).
    if (!differentiatedInPass) {
      const activeEqs: number[] = [];
      for (let i = 0; i < eqCountSnapshot; i++) {
        if (!isSkipArenaEq(arena, i) && arena.getEqKind(i) === EqKind.Simple) {
          activeEqs.push(i);
        }
      }

      // Highest-order variables:
      // - Token >= 0 && < arena.varCount: algebraic variable `vIdx`
      // - Token >= arena.varCount: state derivative `der(stateIdx)` encoded as `arena.varCount + stateIdx`
      const DER_OFFSET = arena.varCount + 1;
      const eqHighTokens = new Map<number, number[]>();

      const collectHighTokens = (exprId: number, tokens: Set<number>): void => {
        if (exprId < 0) return;
        const kind = arena.getExprKind(exprId);
        if (kind === ExprKind.Der) {
          const argId = arena.getExprData1(exprId);
          if (argId >= 0 && arena.getExprKind(argId) === ExprKind.Name) {
            const qIdx = arena.lookupVariable(arena.getExprData1(argId));
            if (qIdx >= 0 && stateVars.has(qIdx)) {
              tokens.add(DER_OFFSET + qIdx);
            }
          }
          return;
        }
        if (kind === ExprKind.Name) {
          const vIdx = arena.lookupVariable(arena.getExprData1(exprId));
          if (vIdx >= 0) {
            const vName = arena.getVarName(vIdx);
            if (vName.startsWith("der(") && vName.endsWith(")")) {
              const baseIdx = arena.getVarIdxByName(vName.slice(4, -1));
              if (baseIdx >= 0 && stateVars.has(baseIdx)) {
                tokens.add(DER_OFFSET + baseIdx);
                return;
              }
            }
            if (!stateVars.has(vIdx) && !derivativeVars.has(vIdx) && !parameters.has(vIdx)) {
              const variability = arena.getVarVariability(vIdx);
              if (variability !== Variability.Parameter && variability !== Variability.Constant) {
                tokens.add(vIdx);
              }
            }
          }
          return;
        }
        switch (kind) {
          case ExprKind.Binary: {
            const op = arena.getExprData1(exprId);
            const l = arena.getExprLeft(exprId);
            const r = arena.getExprRight(exprId);
            if (
              (op === BinOp.Mul || op === BinOp.ElemMul) &&
              (isStructuralZeroExpr(arena, l) || isStructuralZeroExpr(arena, r))
            ) {
              break;
            }
            collectHighTokens(l, tokens);
            collectHighTokens(r, tokens);
            break;
          }
          case ExprKind.Negate:
          case ExprKind.Unary: {
            const inner = arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId);
            collectHighTokens(inner, tokens);
            break;
          }
          case ExprKind.IfElse:
          case ExprKind.Range:
            collectHighTokens(arena.getExprData1(exprId), tokens);
            collectHighTokens(arena.getExprLeft(exprId), tokens);
            collectHighTokens(arena.getExprRight(exprId), tokens);
            break;
        }
      };

      for (const eqIdx of activeEqs) {
        const tSet = new Set<number>();
        collectHighTokens(arena.getEqLhs(eqIdx), tSet);
        collectHighTokens(arena.getEqRhs(eqIdx), tSet);
        eqHighTokens.set(eqIdx, Array.from(tSet));
      }

      const tokenToEq = new Map<number, number>();
      for (const eqIdx of activeEqs) {
        const visitedEqs = new Set<number>();
        const visitedTokens = new Set<number>();

        const dfs = (curEq: number): boolean => {
          visitedEqs.add(curEq);
          for (const tok of eqHighTokens.get(curEq) ?? []) {
            if (visitedTokens.has(tok)) continue;
            visitedTokens.add(tok);
            const matchedEq = tokenToEq.get(tok);
            if (matchedEq === undefined || dfs(matchedEq)) {
              tokenToEq.set(tok, curEq);
              return true;
            }
          }
          return false;
        };

        if (!dfs(eqIdx) && visitedTokens.size > 0) {
          // Found a coupled multi-equation Minimal Structurally Singular (MSS) subset!
          // Isolate matched highest-order tokens from their matched equations in the MSS component
          // and substitute them into the unmatched equation `eqIdx`.
          const derDefs = new Map<number, number>();
          const localAlgDefs = new Map<number, number>(algVarDefs);

          for (const tok of visitedTokens) {
            const mEq = tokenToEq.get(tok);
            if (mEq === undefined || mEq === eqIdx) continue;
            const mLhs = arena.getEqLhs(mEq);
            const mRhs = arena.getEqRhs(mEq);

            if (tok >= DER_OFFSET) {
              const qIdx = tok - DER_OFFSET;
              const qNameId = arena.getVarNameId(qIdx);
              const derVarIdx = arena.getVarIdxByName(`der(${arena.getVarName(qIdx)})`);
              const derVarNameId = derVarIdx >= 0 ? arena.getVarNameId(derVarIdx) : -1;
              const iso = tryIsolateLinearTargetInEq(arena, mLhs, mRhs, (id) => {
                const k = arena.getExprKind(id);
                if (k === ExprKind.Der) {
                  const arg = arena.getExprData1(id);
                  return arg >= 0 && arena.getExprKind(arg) === ExprKind.Name && arena.getExprData1(arg) === qNameId;
                }
                if (k === ExprKind.Name && derVarNameId >= 0) {
                  return arena.getExprData1(id) === derVarNameId;
                }
                return false;
              });
              if (iso !== null) {
                derDefs.set(qIdx, iso);
              }
            } else {
              const vNameId = arena.getVarNameId(tok);
              const iso = tryIsolateLinearTargetInEq(
                arena,
                mLhs,
                mRhs,
                (id) => arena.getExprKind(id) === ExprKind.Name && arena.getExprData1(id) === vNameId,
              );
              if (iso !== null) {
                localAlgDefs.set(tok, iso);
              }
            }
          }

          let redLeft = arena.getEqLhs(eqIdx);
          let redRight = arena.getEqRhs(eqIdx);
          if (derDefs.size > 0) {
            redLeft = substituteDerExpressions(arena, redLeft, derDefs);
            redRight = substituteDerExpressions(arena, redRight, derDefs);
          }
          if (localAlgDefs.size > 0) {
            redLeft = substituteAlgebraicDefinitions(arena, redLeft, localAlgDefs);
            redRight = substituteAlgebraicDefinitions(arena, redRight, localAlgDefs);
          }

          if (!containsDerivative(arena, redLeft) && !containsDerivative(arena, redRight)) {
            const deps = new Set<number>();
            collectArenaExprDeps(arena, redLeft, deps);
            collectArenaExprDeps(arena, redRight, deps);

            const involvedStates = new Set<number>();
            let hasUndefinedNonState = false;
            for (const v of deps) {
              if (stateVars.has(v)) {
                involvedStates.add(v);
              } else if (!derivativeVars.has(v) && !parameters.has(v)) {
                hasUndefinedNonState = true;
              }
            }

            if (involvedStates.size >= 1 && !hasUndefinedNonState) {
              const constrainedState = selectDummyState(involvedStates);
              if (constrainedState >= 0 && !dummyDerivatives.has(constrainedState)) {
                dummyDerivatives.add(constrainedState);
                stateSelectionMap.set(eqIdx, constrainedState);
                arena.setEqKind(eqIdx, EqKind.InitialSimple);

                const dLeft = differentiateArenaExpression(arena, redLeft, stateVarStringIds);
                const dRight = differentiateArenaExpression(arena, redRight, stateVarStringIds);
                const simplifiedLeft = simplifyArenaExpression(arena, dLeft);
                const simplifiedRight = simplifyArenaExpression(arena, dRight);
                const substLeft = substituteStateDerAliases(arena, simplifiedLeft, derToStateNameId);
                const substRight = substituteStateDerAliases(arena, simplifiedRight, derToStateNameId);

                const newEqIdx = arena.addEquation(EqKind.Simple, substLeft, substRight);
                generatedEquations.push(newEqIdx);
                differentiatedInPass = true;
              }
            }
          }
        }
      }
    }

    if (differentiatedInPass) {
      reductionPasses++;
    } else {
      break;
    }
  }

  const computedIndex = reductionPasses > 0 ? Math.max(1 + reductionPasses, initialSig.structuralIndex) : 1;

  return {
    dummyDerivatives,
    generatedEquations,
    structuralIndex: computedIndex,
    stateSelectionMap,
    pryceOffsets: { c: pryceC, d: pryceD },
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
