// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Algebraic expression simplification and symbolic substitution over the DAE arena.
 */

import type { WasmDaeEquations } from "./equations.js";
import { BinOp, ExprKind, UnaryOp } from "./types.js";

/**
 * Extracts the numeric value of an `IntLiteral` or `RealLiteral` expression node,
 * returning `null` for non-numeric expressions.
 */
export function getNumericLiteralValue(arena: WasmDaeEquations, exprId: number): number | null {
  if (exprId < 0) return null;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return arena.getExprRealValue(exprId);
  if (kind === ExprKind.IntLiteral) return arena.getExprData1(exprId);
  return null;
}

/**
 * Recursively checks structural and numeric equivalence of two expression nodes `a` and `b`
 * within the same `WasmDaeEquations` arena.
 */
function areArenaExprsEqual(arena: WasmDaeEquations, a: number, b: number): boolean {
  if (a === b) return true;
  if (a < 0 || b < 0) return false;
  const kindA = arena.getExprKind(a);
  const kindB = arena.getExprKind(b);
  if (kindA !== kindB) {
    const valA = getNumericLiteralValue(arena, a);
    const valB = getNumericLiteralValue(arena, b);
    return valA !== null && valB !== null && valA === valB;
  }
  switch (kindA) {
    case ExprKind.Colon:
      return true;
    case ExprKind.RealLiteral:
      return arena.getExprRealValue(a) === arena.getExprRealValue(b);
    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.StringLiteral:
    case ExprKind.Name:
      return arena.getExprData1(a) === arena.getExprData1(b);
    case ExprKind.EnumLiteral:
      return arena.getExprData1(a) === arena.getExprData1(b) && arena.getExprLeft(a) === arena.getExprLeft(b);
    case ExprKind.Der:
    case ExprKind.Pre:
      return areArenaExprsEqual(arena, arena.getExprData1(a), arena.getExprData1(b));
    case ExprKind.Negate:
      return areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b));
    case ExprKind.Unary:
      return (
        arena.getExprData1(a) === arena.getExprData1(b) &&
        areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b))
      );
    case ExprKind.Binary:
      return (
        arena.getExprData1(a) === arena.getExprData1(b) &&
        areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b)) &&
        areArenaExprsEqual(arena, arena.getExprRight(a), arena.getExprRight(b))
      );
    case ExprKind.IfElse:
      return (
        areArenaExprsEqual(arena, arena.getExprData1(a), arena.getExprData1(b)) &&
        areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b)) &&
        areArenaExprsEqual(arena, arena.getExprRight(a), arena.getExprRight(b))
      );
    case ExprKind.Range: {
      const stepA = arena.getExprLeft(a);
      const stepB = arena.getExprLeft(b);
      const hasStepA = stepA >= 0 && stepA !== 0xffffffff;
      const hasStepB = stepB >= 0 && stepB !== 0xffffffff;
      if (hasStepA !== hasStepB) return false;
      if (hasStepA && !areArenaExprsEqual(arena, stepA, stepB)) return false;
      return (
        areArenaExprsEqual(arena, arena.getExprData1(a), arena.getExprData1(b)) &&
        areArenaExprsEqual(arena, arena.getExprRight(a), arena.getExprRight(b))
      );
    }
    case ExprKind.Call: {
      if (arena.getExprFuncName(a) !== arena.getExprFuncName(b)) return false;
      const countA = arena.getExprRight(a);
      const countB = arena.getExprRight(b);
      if (countA !== countB) return false;
      if (countA <= 0) return true;
      if (!areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b))) return false;
      for (let i = 1; i < countA; i++) {
        if (!areArenaExprsEqual(arena, arena.getExprLeft(a + i), arena.getExprLeft(b + i))) return false;
      }
      return true;
    }
    case ExprKind.Subscript: {
      if (!areArenaExprsEqual(arena, arena.getExprData1(a), arena.getExprData1(b))) return false;
      const countA = arena.getExprRight(a);
      const countB = arena.getExprRight(b);
      if (countA !== countB) return false;
      if (countA <= 0) return true;
      if (!areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b))) return false;
      for (let i = 1; i < countA; i++) {
        if (!areArenaExprsEqual(arena, arena.getExprLeft(a + i), arena.getExprLeft(b + i))) return false;
      }
      return true;
    }
    case ExprKind.ArrayCtor: {
      const countA = arena.getExprData1(a);
      const countB = arena.getExprData1(b);
      if (countA !== countB) return false;
      if (countA <= 0) return true;
      if (!areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b))) return false;
      const redA = arena.getExprRight(a);
      const redB = arena.getExprRight(b);
      const baseA = redA >= 0 && redA !== 0xffffffff ? redA : a;
      const baseB = redB >= 0 && redB !== 0xffffffff ? redB : b;
      for (let i = 1; i < countA; i++) {
        if (!areArenaExprsEqual(arena, arena.getExprLeft(baseA + i), arena.getExprLeft(baseB + i))) return false;
      }
      return true;
    }
    case ExprKind.Tuple: {
      const countA = arena.getExprData1(a);
      const countB = arena.getExprData1(b);
      if (countA !== countB) return false;
      if (countA <= 0) return true;
      if (!areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b))) return false;
      for (let i = 1; i < countA; i++) {
        if (!areArenaExprsEqual(arena, arena.getExprLeft(a + i), arena.getExprLeft(b + i))) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

/**
 * Algebraically simplifies an arena expression tree (`exprId`) in-place by folding constants,
 * eliminating additive/multiplicative identities ($x + 0 \to x$, $x \cdot 1 \to x$, $x \cdot 0 \to 0$),
 * and pruning constant-condition `if` branches.
 *
 * @param arena - Target DAE arena.
 * @param exprId - Root expression arena ID to simplify.
 * @returns Simplified expression arena ID.
 */
export function simplifyArenaExpression(arena: WasmDaeEquations, exprId: number): number {
  if (exprId < 0) return exprId;
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.IntLiteral:
    case ExprKind.RealLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.StringLiteral:
    case ExprKind.EnumLiteral:
    case ExprKind.Name:
    case ExprKind.Colon:
      return exprId;

    case ExprKind.Der:
    case ExprKind.Pre: {
      const inner = arena.getExprData1(exprId);
      const simpInner = simplifyArenaExpression(arena, inner);
      if (kind === ExprKind.Der && getNumericLiteralValue(arena, simpInner) !== null) {
        return arena.addRealLiteral(0.0);
      }
      if (simpInner === inner) return exprId;
      return arena.addExpression(kind, simpInner);
    }

    case ExprKind.Negate:
    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId) as UnaryOp;
      const isNeg = kind === ExprKind.Negate || op === UnaryOp.Negate;
      const operand = arena.getExprLeft(exprId);
      const simpOp = simplifyArenaExpression(arena, operand);

      if (isNeg) {
        const numVal = getNumericLiteralValue(arena, simpOp);
        if (numVal !== null) {
          if (numVal === 0) return arena.addRealLiteral(0.0);
          return arena.getExprKind(simpOp) === ExprKind.IntLiteral
            ? arena.addIntLiteral(-numVal)
            : arena.addRealLiteral(-numVal);
        }
        const subKind = arena.getExprKind(simpOp);
        if (
          subKind === ExprKind.Negate ||
          (subKind === ExprKind.Unary && arena.getExprData1(simpOp) === UnaryOp.Negate)
        ) {
          return arena.getExprLeft(simpOp);
        }
        if (simpOp === operand) return exprId;
        return kind === ExprKind.Negate
          ? arena.addExpression(ExprKind.Negate, 0, simpOp)
          : arena.addUnaryExpr(UnaryOp.Negate, simpOp);
      }

      if (op === UnaryOp.Not) {
        if (arena.getExprKind(simpOp) === ExprKind.BoolLiteral) {
          return arena.addBoolLiteral(arena.getExprData1(simpOp) === 0);
        }
        if (arena.getExprKind(simpOp) === ExprKind.Unary && arena.getExprData1(simpOp) === UnaryOp.Not) {
          return arena.getExprLeft(simpOp);
        }
      }

      if (simpOp === operand) return exprId;
      return arena.addUnaryExpr(op, simpOp);
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const rawLeft = arena.getExprLeft(exprId);
      const rawRight = arena.getExprRight(exprId);
      const left = simplifyArenaExpression(arena, rawLeft);
      const right = simplifyArenaExpression(arena, rawRight);

      const lVal = getNumericLiteralValue(arena, left);
      const rVal = getNumericLiteralValue(arena, right);
      const bothInt =
        lVal !== null &&
        rVal !== null &&
        arena.getExprKind(left) === ExprKind.IntLiteral &&
        arena.getExprKind(right) === ExprKind.IntLiteral;

      if (lVal !== null && rVal !== null) {
        switch (op) {
          case BinOp.Add:
          case BinOp.ElemAdd:
            return bothInt ? arena.addIntLiteral(lVal + rVal) : arena.addRealLiteral(lVal + rVal);
          case BinOp.Sub:
          case BinOp.ElemSub:
            return bothInt ? arena.addIntLiteral(lVal - rVal) : arena.addRealLiteral(lVal - rVal);
          case BinOp.Mul:
          case BinOp.ElemMul:
            return bothInt ? arena.addIntLiteral(lVal * rVal) : arena.addRealLiteral(lVal * rVal);
          case BinOp.Div:
          case BinOp.ElemDiv:
            if (rVal !== 0) return arena.addRealLiteral(lVal / rVal);
            break;
          case BinOp.Pow:
          case BinOp.ElemPow:
            return arena.addRealLiteral(Math.pow(lVal, rVal));
        }
      }

      switch (op) {
        case BinOp.Add:
        case BinOp.ElemAdd:
          if (lVal === 0) return right;
          if (rVal === 0) return left;
          break;

        case BinOp.Sub:
        case BinOp.ElemSub:
          if (rVal === 0) return left;
          if (lVal === 0) return simplifyArenaExpression(arena, arena.addExpression(ExprKind.Negate, 0, right));
          if (areArenaExprsEqual(arena, left, right)) return arena.addRealLiteral(0.0);
          break;

        case BinOp.Mul:
        case BinOp.ElemMul:
          if (lVal === 0 || rVal === 0) return arena.addRealLiteral(0.0);
          if (lVal === 1) return right;
          if (rVal === 1) return left;
          if (lVal === -1) return simplifyArenaExpression(arena, arena.addExpression(ExprKind.Negate, 0, right));
          if (rVal === -1) return simplifyArenaExpression(arena, arena.addExpression(ExprKind.Negate, 0, left));
          break;

        case BinOp.Div:
        case BinOp.ElemDiv:
          if (lVal === 0 && rVal !== 0) return arena.addRealLiteral(0.0);
          if (rVal === 1) return left;
          if (rVal === -1) return simplifyArenaExpression(arena, arena.addExpression(ExprKind.Negate, 0, left));
          if (areArenaExprsEqual(arena, left, right) && lVal !== 0) return arena.addRealLiteral(1.0);
          break;

        case BinOp.Pow:
        case BinOp.ElemPow:
          if (rVal === 0) return arena.addRealLiteral(1.0);
          if (rVal === 1) return left;
          if (lVal === 1) return arena.addRealLiteral(1.0);
          if (lVal === 0 && rVal !== null && rVal > 0) return arena.addRealLiteral(0.0);
          break;
      }

      if (left === rawLeft && right === rawRight) return exprId;
      return arena.addBinaryExpr(op, left, right);
    }

    case ExprKind.IfElse: {
      const cond = simplifyArenaExpression(arena, arena.getExprData1(exprId));
      const trueBranch = simplifyArenaExpression(arena, arena.getExprLeft(exprId));
      const falseBranch = simplifyArenaExpression(arena, arena.getExprRight(exprId));
      if (arena.getExprKind(cond) === ExprKind.BoolLiteral) {
        return arena.getExprData1(cond) !== 0 ? trueBranch : falseBranch;
      }
      if (areArenaExprsEqual(arena, trueBranch, falseBranch)) {
        return trueBranch;
      }
      if (
        cond === arena.getExprData1(exprId) &&
        trueBranch === arena.getExprLeft(exprId) &&
        falseBranch === arena.getExprRight(exprId)
      ) {
        return exprId;
      }
      return arena.addIfElse(cond, trueBranch, falseBranch);
    }

    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const argCount = arena.getExprRight(exprId);
      if (argCount <= 0) return exprId;
      const args: number[] = [];
      let changed = false;
      const firstArg = arena.getExprLeft(exprId);
      const simpFirst = simplifyArenaExpression(arena, firstArg);
      if (simpFirst !== firstArg) changed = true;
      args.push(simpFirst);
      for (let i = 1; i < argCount; i++) {
        const argId = arena.getExprLeft(exprId + i);
        const simpArg = simplifyArenaExpression(arena, argId);
        if (simpArg !== argId) changed = true;
        args.push(simpArg);
      }
      if (!changed) return exprId;
      return arena.addCallExpr(funcNameId, args);
    }

    case ExprKind.Subscript: {
      const baseExpr = arena.getExprData1(exprId);
      const subCount = arena.getExprRight(exprId);
      const simpBase = simplifyArenaExpression(arena, baseExpr);
      let changed = simpBase !== baseExpr;
      const subs: number[] = [];
      if (subCount > 0) {
        const s0 = arena.getExprLeft(exprId);
        const ss0 = simplifyArenaExpression(arena, s0);
        if (ss0 !== s0) changed = true;
        subs.push(ss0);
        for (let i = 1; i < subCount; i++) {
          const si = arena.getExprLeft(exprId + i);
          const ssi = simplifyArenaExpression(arena, si);
          if (ssi !== si) changed = true;
          subs.push(ssi);
        }
      }
      if (!changed) return exprId;
      return arena.addSubscriptExpr(simpBase, subs);
    }

    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const redirect = arena.getExprRight(exprId);
      const baseId = redirect >= 0 && redirect !== 0xffffffff ? redirect : exprId;
      const elems: number[] = [];
      let changed = false;
      const e0 = arena.getExprLeft(exprId);
      const se0 = simplifyArenaExpression(arena, e0);
      if (se0 !== e0) changed = true;
      elems.push(se0);
      for (let i = 1; i < count; i++) {
        const ei = arena.getExprLeft(baseId + i);
        const sei = simplifyArenaExpression(arena, ei);
        if (sei !== ei) changed = true;
        elems.push(sei);
      }
      if (!changed) return exprId;
      return arena.addArrayCtorExpr(elems);
    }

    case ExprKind.Tuple: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const elems: number[] = [];
      let changed = false;
      const e0 = arena.getExprLeft(exprId);
      const se0 = simplifyArenaExpression(arena, e0);
      if (se0 !== e0) changed = true;
      elems.push(se0);
      for (let i = 1; i < count; i++) {
        const ei = arena.getExprLeft(exprId + i);
        const sei = simplifyArenaExpression(arena, ei);
        if (sei !== ei) changed = true;
        elems.push(sei);
      }
      if (!changed) return exprId;
      return arena.addTupleExpr(elems);
    }

    case ExprKind.Range: {
      const start = arena.getExprData1(exprId);
      const step = arena.getExprLeft(exprId);
      const stop = arena.getExprRight(exprId);
      const simpStart = simplifyArenaExpression(arena, start);
      const simpStep = step >= 0 && step !== 0xffffffff ? simplifyArenaExpression(arena, step) : step;
      const simpStop = simplifyArenaExpression(arena, stop);
      if (simpStart === start && simpStep === step && simpStop === stop) return exprId;
      return arena.addRange(simpStart, simpStop, simpStep);
    }

    default:
      return exprId;
  }
}

/**
 * Substitutes all occurrences of variable `targetNameId` with `replacementExprId` inside
 * the expression tree rooted at `exprId`, returning the resulting arena expression ID.
 *
 * @param arena - Target DAE arena.
 * @param exprId - Root expression arena ID.
 * @param targetNameId - Interned `StringId` of the variable to replace.
 * @param replacementExprId - Expression arena ID to substitute in place of `targetNameId`.
 * @returns Rewritten expression arena ID (or `exprId` if unchanged).
 */
export function substituteArenaExpr(
  arena: WasmDaeEquations,
  exprId: number,
  targetNameId: number,
  replacementExprId: number,
): number {
  if (exprId < 0) return exprId;
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      if (nameId === targetNameId) {
        return replacementExprId;
      }
      return exprId;
    }

    case ExprKind.IntLiteral:
    case ExprKind.RealLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.StringLiteral:
    case ExprKind.EnumLiteral:
    case ExprKind.Colon:
      return exprId;

    case ExprKind.Der:
    case ExprKind.Pre: {
      const inner = arena.getExprData1(exprId);
      const newInner = substituteArenaExpr(arena, inner, targetNameId, replacementExprId);
      if (newInner === inner) return exprId;
      return arena.addExpression(kind, newInner);
    }

    case ExprKind.Negate:
    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId);
      const operand = arena.getExprLeft(exprId);
      const newOperand = substituteArenaExpr(arena, operand, targetNameId, replacementExprId);
      if (newOperand === operand) return exprId;
      return kind === ExprKind.Negate
        ? arena.addExpression(ExprKind.Negate, 0, newOperand)
        : arena.addUnaryExpr(op as UnaryOp, newOperand);
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const left = arena.getExprLeft(exprId);
      const right = arena.getExprRight(exprId);
      const newLeft = substituteArenaExpr(arena, left, targetNameId, replacementExprId);
      const newRight = substituteArenaExpr(arena, right, targetNameId, replacementExprId);
      if (newLeft === left && newRight === right) return exprId;
      return arena.addBinaryExpr(op, newLeft, newRight);
    }

    case ExprKind.IfElse: {
      const cond = arena.getExprData1(exprId);
      const trueBranch = arena.getExprLeft(exprId);
      const falseBranch = arena.getExprRight(exprId);
      const newCond = substituteArenaExpr(arena, cond, targetNameId, replacementExprId);
      const newTrue = substituteArenaExpr(arena, trueBranch, targetNameId, replacementExprId);
      const newFalse = substituteArenaExpr(arena, falseBranch, targetNameId, replacementExprId);
      if (newCond === cond && newTrue === trueBranch && newFalse === falseBranch) return exprId;
      return arena.addIfElse(newCond, newTrue, newFalse);
    }

    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const argCount = arena.getExprRight(exprId);
      if (argCount <= 0) return exprId;
      const args: number[] = [];
      let changed = false;
      const firstArg = arena.getExprLeft(exprId);
      const newFirst = substituteArenaExpr(arena, firstArg, targetNameId, replacementExprId);
      if (newFirst !== firstArg) changed = true;
      args.push(newFirst);
      for (let i = 1; i < argCount; i++) {
        const argId = arena.getExprLeft(exprId + i);
        const newArg = substituteArenaExpr(arena, argId, targetNameId, replacementExprId);
        if (newArg !== argId) changed = true;
        args.push(newArg);
      }
      if (!changed) return exprId;
      return arena.addCallExpr(funcNameId, args);
    }

    case ExprKind.Subscript: {
      const baseExpr = arena.getExprData1(exprId);
      const subCount = arena.getExprRight(exprId);
      const newBase = substituteArenaExpr(arena, baseExpr, targetNameId, replacementExprId);
      let changed = newBase !== baseExpr;
      const subs: number[] = [];
      if (subCount > 0) {
        const s0 = arena.getExprLeft(exprId);
        const ns0 = substituteArenaExpr(arena, s0, targetNameId, replacementExprId);
        if (ns0 !== s0) changed = true;
        subs.push(ns0);
        for (let i = 1; i < subCount; i++) {
          const si = arena.getExprLeft(exprId + i);
          const nsi = substituteArenaExpr(arena, si, targetNameId, replacementExprId);
          if (nsi !== si) changed = true;
          subs.push(nsi);
        }
      }
      if (!changed) return exprId;
      // Also check if newBase is a Name and all subs are integer literals that match a scalarized variable
      if (arena.getExprKind(newBase) === ExprKind.Name && subs.length > 0) {
        const baseName = arena.interner.resolve(arena.getExprData1(newBase));
        if (baseName) {
          const litVals: number[] = [];
          for (const s of subs) {
            const v = getNumericLiteralValue(arena, s);
            if (v !== null && Number.isInteger(v)) litVals.push(v);
          }
          if (litVals.length === subs.length) {
            const scalarName = `${baseName}[${litVals.join(",")}]`;
            if (arena.lookupVariable(scalarName) >= 0) {
              return arena.addNameExpr(scalarName);
            }
          }
        }
      }
      return arena.addSubscriptExpr(newBase, subs);
    }

    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const redirect = arena.getExprRight(exprId);
      const baseId = redirect >= 0 && redirect !== 0xffffffff ? redirect : exprId;
      const elems: number[] = [];
      let changed = false;
      const e0 = arena.getExprLeft(exprId);
      const ne0 = substituteArenaExpr(arena, e0, targetNameId, replacementExprId);
      if (ne0 !== e0) changed = true;
      elems.push(ne0);
      for (let i = 1; i < count; i++) {
        const ei = arena.getExprLeft(baseId + i);
        const nei = substituteArenaExpr(arena, ei, targetNameId, replacementExprId);
        if (nei !== ei) changed = true;
        elems.push(nei);
      }
      if (!changed) return exprId;
      return arena.addArrayCtorExpr(elems);
    }

    case ExprKind.Tuple: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const elems: number[] = [];
      let changed = false;
      const e0 = arena.getExprLeft(exprId);
      const ne0 = substituteArenaExpr(arena, e0, targetNameId, replacementExprId);
      if (ne0 !== e0) changed = true;
      elems.push(ne0);
      for (let i = 1; i < count; i++) {
        const ei = arena.getExprLeft(exprId + i);
        const nei = substituteArenaExpr(arena, ei, targetNameId, replacementExprId);
        if (nei !== ei) changed = true;
        elems.push(nei);
      }
      if (!changed) return exprId;
      return arena.addTupleExpr(elems);
    }

    case ExprKind.Range: {
      const start = arena.getExprData1(exprId);
      const step = arena.getExprLeft(exprId);
      const stop = arena.getExprRight(exprId);
      const newStart = substituteArenaExpr(arena, start, targetNameId, replacementExprId);
      const newStep =
        step >= 0 && step !== 0xffffffff ? substituteArenaExpr(arena, step, targetNameId, replacementExprId) : step;
      const newStop = substituteArenaExpr(arena, stop, targetNameId, replacementExprId);
      if (newStart === start && newStep === step && newStop === stop) return exprId;
      return arena.addRange(newStart, newStop, newStep);
    }

    case ExprKind.Comprehension: {
      const sId = arena.getExprData1(exprId);
      const bodyId = arena.getExprLeft(exprId);
      const iterCount = arena.getExprRight(exprId);
      const iters: { iterNameId: number; rangeExprId: number }[] = [];
      let shadowed = false;
      let changed = false;
      for (let i = 0; i < iterCount; i++) {
        const iterSlot = exprId + 1 + i;
        const iterNameId = arena.getExprData1(iterSlot);
        const rangeExprId = arena.getExprLeft(iterSlot);
        const newRangeExprId = shadowed
          ? rangeExprId
          : substituteArenaExpr(arena, rangeExprId, targetNameId, replacementExprId);
        if (newRangeExprId !== rangeExprId) changed = true;
        if (iterNameId === targetNameId) shadowed = true;
        iters.push({ iterNameId, rangeExprId: newRangeExprId });
      }
      const newBodyId = shadowed ? bodyId : substituteArenaExpr(arena, bodyId, targetNameId, replacementExprId);
      if (newBodyId !== bodyId) changed = true;
      if (!changed) return exprId;
      const compId = arena.addExpression(ExprKind.Comprehension, sId, newBodyId, iters.length);
      for (const iter of iters) {
        arena.addExpression(ExprKind.Tuple, iter.iterNameId, iter.rangeExprId, 0);
      }
      return compId;
    }

    default:
      return exprId;
  }
}
