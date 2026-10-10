// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - Binary & Operator Expression Handling.
 *
 * Implements operator records dispatching, matrix/vector multiplication,
 * array binary broadcasting, arithmetic simplifications, and expression equivalence.
 */

import { ExprKind } from "@modelscript/dsl";
import {
  BinOp,
  DAEBuilder,
  inferArenaExprVarType,
  UnaryOp,
  Variability,
  VarType,
  type QueryDB,
  type SymbolId,
} from "@modelscript/runtime";
import { ModelicaErrorCode } from "../../errors.js";
import { castToRealExpr, evalDaeExpr, getExprDims, isRealExpr } from "./eval.js";

export function exprReferencesRuntimeParameter(exprId: number, dae: DAEBuilder): boolean {
  if (exprId < 0) return false;
  const k = dae.getExprKind(exprId);
  if (k === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (!name) return false;
    const varIdx = dae.lookupVariable(name);
    if (varIdx >= 0) {
      const v = dae.getVarVariability(varIdx);
      if (v === Variability.Parameter && !dae.isVarFinal(varIdx)) {
        if (dae.getVarType(varIdx) !== VarType.Integer) {
          return true;
        }
      }
    }
    return false;
  }
  const l = dae.getExprLeft(exprId);
  const r = dae.getExprRight(exprId);
  const d1 = dae.getExprData1(exprId);
  if (l >= 0 && exprReferencesRuntimeParameter(l, dae)) return true;
  if (r >= 0 && exprReferencesRuntimeParameter(r, dae)) return true;
  if (k === ExprKind.Call || k === ExprKind.Der || k === ExprKind.IfElse) {
    if (d1 >= 0 && exprReferencesRuntimeParameter(d1, dae)) return true;
  }
  return false;
}

export function exprReferencesEnumParameter(exprId: number, dae: DAEBuilder): boolean {
  if (exprId < 0) return false;
  const k = dae.getExprKind(exprId);
  if (k === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (!name) return false;
    const varIdx = dae.lookupVariable(name);
    if (varIdx >= 0) {
      const v = dae.getVarVariability(varIdx);
      if (v === Variability.Parameter && !dae.isVarFinal(varIdx)) {
        return dae.getVarType(varIdx) === VarType.Enumeration;
      }
    }
    return false;
  }
  const l = dae.getExprLeft(exprId);
  const r = dae.getExprRight(exprId);
  const d1 = dae.getExprData1(exprId);
  if (l >= 0 && exprReferencesEnumParameter(l, dae)) return true;
  if (r >= 0 && exprReferencesEnumParameter(r, dae)) return true;
  if (k === ExprKind.Call || k === ExprKind.Der || k === ExprKind.IfElse) {
    if (d1 >= 0 && exprReferencesEnumParameter(d1, dae)) return true;
  }
  return false;
}

export function getArrayCtorElements(id: number, dae: DAEBuilder): number[] {
  if (id < 0) return [];
  const kind = dae.getExprKind(id);
  if (kind === ExprKind.Negate) {
    const innerElems = getArrayCtorElements(dae.getExprLeft(id), dae);
    return innerElems.map((e) => dae.addExpression(ExprKind.Negate, 0, e));
  }
  if (kind === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate) {
    const innerElems = getArrayCtorElements(dae.getExprLeft(id), dae);
    return innerElems.map((e) => dae.addExpression(ExprKind.Negate, 0, e));
  }
  if (kind === ExprKind.IfElse) {
    const condId = dae.getExprData1(id);
    const thenElems = getArrayCtorElements(dae.getExprLeft(id), dae);
    const elseElems = getArrayCtorElements(dae.getExprRight(id), dae);
    if (thenElems.length === elseElems.length && thenElems.length > 0 && exprReferencesRuntimeParameter(condId, dae)) {
      const len = thenElems.length;
      const elems: number[] = [];
      for (let i = 0; i < len; i++) {
        elems.push(dae.addExpression(ExprKind.IfElse, condId, thenElems[i]!, elseElems[i]!));
      }
      return elems;
    }
    const condVal = evalDaeExpr(condId, dae);
    if (condVal === true) {
      return thenElems;
    }
    if (condVal === false) {
      return elseElems;
    }
    const len = Math.max(thenElems.length, elseElems.length);
    const elems: number[] = [];
    for (let i = 0; i < len; i++) {
      const t = i < thenElems.length ? thenElems[i]! : thenElems[0]!;
      const e = i < elseElems.length ? elseElems[i]! : elseElems[0]!;
      elems.push(dae.addExpression(ExprKind.IfElse, condId, t, e));
    }
    return elems;
  }
  if (kind !== ExprKind.ArrayCtor) {
    return [id];
  }
  const count = dae.getExprData1(id);
  const redirect = dae.getExprRight(id);
  const baseId = redirect >= 0 ? redirect : id;
  const elems: number[] = [];
  if (count > 0) elems.push(dae.getExprLeft(id));
  for (let i = 1; i < count; i++) {
    elems.push(dae.getExprLeft(baseId + i));
  }
  return elems;
}

export function getArrayCtorRank(id: number, dae: DAEBuilder): number {
  if (id < 0) return 0;
  const k = dae.getExprKind(id);
  if (k === ExprKind.Negate) {
    return getArrayCtorRank(dae.getExprLeft(id), dae);
  }
  if (k === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate) {
    return getArrayCtorRank(dae.getExprLeft(id), dae);
  }
  if (k !== ExprKind.ArrayCtor) return 0;
  const elems = getArrayCtorElements(id, dae);
  if (elems.length === 0) return 1;
  return 1 + getArrayCtorRank(elems[0]!, dae);
}

export function getArrayCtorShape(id: number, dae: DAEBuilder): number[] {
  if (id < 0) return [];
  const k = dae.getExprKind(id);
  if (k !== ExprKind.ArrayCtor) return [];
  const elems = getArrayCtorElements(id, dae);
  if (elems.length === 0) return [0];
  return [elems.length, ...getArrayCtorShape(elems[0]!, dae)];
}

export function exprsEqual(id1: number, id2: number, dae: DAEBuilder): boolean {
  if (id1 === id2) return true;
  if (id1 < 0 || id2 < 0) return false;
  const k1 = dae.getExprKind(id1);
  const k2 = dae.getExprKind(id2);
  if (k1 !== k2) return false;
  if (k1 === ExprKind.Name) {
    return dae.getExprData1(id1) === dae.getExprData1(id2);
  }
  if (k1 === ExprKind.IntLiteral) {
    return dae.getExprData1(id1) === dae.getExprData1(id2);
  }
  if (k1 === ExprKind.RealLiteral) {
    return dae.getExprRealValue(id1) === dae.getExprRealValue(id2);
  }
  if (k1 === ExprKind.StringLiteral || k1 === ExprKind.BoolLiteral) {
    return dae.getExprData1(id1) === dae.getExprData1(id2);
  }
  if (k1 === ExprKind.Subscript) {
    const d1_1 = dae.getExprData1(id1);
    const d1_2 = dae.getExprData1(id2);
    const base1 = d1_1 !== 0 ? d1_1 : dae.getExprLeft(id1);
    const base2 = d1_2 !== 0 ? d1_2 : dae.getExprLeft(id2);
    if (!exprsEqual(base1, base2, dae)) return false;
    const count1 = d1_1 !== 0 ? dae.getExprRight(id1) : 1;
    const count2 = d1_2 !== 0 ? dae.getExprRight(id2) : 1;
    if (count1 !== count2) return false;
    if (d1_1 !== 0) {
      for (let i = 0; i < count1; i++) {
        const sub1 = i === 0 ? dae.getExprLeft(id1) : dae.getExprLeft(id1 + i);
        const sub2 = i === 0 ? dae.getExprLeft(id2) : dae.getExprLeft(id2 + i);
        if (!exprsEqual(sub1, sub2, dae)) return false;
      }
    } else {
      if (!exprsEqual(dae.getExprRight(id1), dae.getExprRight(id2), dae)) return false;
    }
    return true;
  }
  if (k1 === ExprKind.Unary || k1 === ExprKind.Negate) {
    return (
      dae.getExprData1(id1) === dae.getExprData1(id2) && exprsEqual(dae.getExprLeft(id1), dae.getExprLeft(id2), dae)
    );
  }
  if (k1 === ExprKind.Binary) {
    return (
      dae.getExprData1(id1) === dae.getExprData1(id2) &&
      exprsEqual(dae.getExprLeft(id1), dae.getExprLeft(id2), dae) &&
      exprsEqual(dae.getExprRight(id1), dae.getExprRight(id2), dae)
    );
  }
  return false;
}

export function isMinusOne(id: number, dae: DAEBuilder): boolean {
  if (id < 0) return false;
  const k = dae.getExprKind(id);
  if (k === ExprKind.IntLiteral && dae.getExprData1(id) === -1) return true;
  if (k === ExprKind.RealLiteral && dae.getExprRealValue(id) === -1.0) return true;
  if (k === ExprKind.Negate) {
    const inner = dae.getExprLeft(id);
    const ik = dae.getExprKind(inner);
    return (
      (ik === ExprKind.IntLiteral && dae.getExprData1(inner) === 1) ||
      (ik === ExprKind.RealLiteral && dae.getExprRealValue(inner) === 1.0)
    );
  }
  if (k === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate) {
    const inner = dae.getExprLeft(id);
    const ik = dae.getExprKind(inner);
    return (
      (ik === ExprKind.IntLiteral && dae.getExprData1(inner) === 1) ||
      (ik === ExprKind.RealLiteral && dae.getExprRealValue(inner) === 1.0)
    );
  }
  return false;
}

export function mulWithSimplification(leftId: number, rightId: number, dae: DAEBuilder): number {
  const lK = dae.getExprKind(leftId);
  const rK = dae.getExprKind(rightId);
  if (
    (lK === ExprKind.IntLiteral || lK === ExprKind.RealLiteral) &&
    (rK === ExprKind.IntLiteral || rK === ExprKind.RealLiteral)
  ) {
    const lVal = lK === ExprKind.IntLiteral ? dae.getExprData1(leftId) : dae.getExprRealValue(leftId);
    const rVal = rK === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
    const res = lVal * rVal;
    return lK === ExprKind.RealLiteral || rK === ExprKind.RealLiteral || !Number.isInteger(res)
      ? dae.addRealLiteral(res)
      : dae.addIntLiteral(res);
  }
  if (lK === ExprKind.RealLiteral && dae.getExprRealValue(leftId) === 0.0) {
    return isRealExpr(rightId, dae) ? dae.addRealLiteral(0.0) : dae.addIntLiteral(0);
  }
  if (rK === ExprKind.RealLiteral && dae.getExprRealValue(rightId) === 0.0) {
    return isRealExpr(leftId, dae) ? dae.addRealLiteral(0.0) : dae.addIntLiteral(0);
  }
  if (lK === ExprKind.IntLiteral && dae.getExprData1(leftId) === 0) {
    return isRealExpr(rightId, dae) ? dae.addRealLiteral(0.0) : dae.addIntLiteral(0);
  }
  if (rK === ExprKind.IntLiteral && dae.getExprData1(rightId) === 0) {
    return isRealExpr(leftId, dae) ? dae.addRealLiteral(0.0) : dae.addIntLiteral(0);
  }
  if (lK === ExprKind.RealLiteral && dae.getExprRealValue(leftId) === 1.0) return rightId;
  if (rK === ExprKind.RealLiteral && dae.getExprRealValue(rightId) === 1.0) return leftId;
  if (lK === ExprKind.IntLiteral && dae.getExprData1(leftId) === 1) return rightId;
  if (rK === ExprKind.IntLiteral && dae.getExprData1(rightId) === 1) return leftId;
  if (isMinusOne(leftId, dae)) return dae.addUnaryExpr(UnaryOp.Negate, rightId);
  if (isMinusOne(rightId, dae)) return dae.addUnaryExpr(UnaryOp.Negate, leftId);

  const lReal = isRealExpr(leftId, dae);
  const rReal = isRealExpr(rightId, dae);
  if (lReal && !rReal) {
    rightId = castToRealExpr(rightId, dae);
  } else if (!lReal && rReal) {
    leftId = castToRealExpr(leftId, dae);
  }

  const isOldFrontend = Boolean(dae.extensionMetadata?.isOldFrontend);
  if (isOldFrontend && exprsEqual(leftId, rightId, dae)) {
    const isReal = isRealExpr(leftId, dae);
    return dae.addBinaryExpr(BinOp.Pow, leftId, isReal ? dae.addRealLiteral(2.0) : dae.addIntLiteral(2));
  }
  return dae.addBinaryExpr(BinOp.Mul, leftId, rightId);
}

export function addWithFactoring(term1: number, term2: number, dae: DAEBuilder): number {
  const t1K = dae.getExprKind(term1);
  const t2K = dae.getExprKind(term2);
  if (
    (t1K === ExprKind.IntLiteral || t1K === ExprKind.RealLiteral) &&
    (t2K === ExprKind.IntLiteral || t2K === ExprKind.RealLiteral)
  ) {
    const v1 = t1K === ExprKind.IntLiteral ? dae.getExprData1(term1) : dae.getExprRealValue(term1);
    const v2 = t2K === ExprKind.IntLiteral ? dae.getExprData1(term2) : dae.getExprRealValue(term2);
    const res = v1 + v2;
    return t1K === ExprKind.RealLiteral || t2K === ExprKind.RealLiteral || !Number.isInteger(res)
      ? dae.addRealLiteral(res)
      : dae.addIntLiteral(res);
  }
  if (t1K === ExprKind.RealLiteral && dae.getExprRealValue(term1) === 0.0) return term2;
  if (t2K === ExprKind.RealLiteral && dae.getExprRealValue(term2) === 0.0) return term1;
  if (t1K === ExprKind.IntLiteral && dae.getExprData1(term1) === 0) return term2;
  if (t2K === ExprKind.IntLiteral && dae.getExprData1(term2) === 0) return term1;

  const getCoeffAndTarget = (id: number): { coeff: number; target: number } | null => {
    const k = dae.getExprKind(id);
    if (k === ExprKind.Binary && dae.getExprData1(id) === BinOp.Mul) {
      const l = dae.getExprLeft(id);
      const r = dae.getExprRight(id);
      const lK = dae.getExprKind(l);
      const rK = dae.getExprKind(r);
      if (lK === ExprKind.RealLiteral || lK === ExprKind.IntLiteral) {
        const val = lK === ExprKind.IntLiteral ? dae.getExprData1(l) : dae.getExprRealValue(l);
        return { coeff: val, target: r };
      }
      if (rK === ExprKind.RealLiteral || rK === ExprKind.IntLiteral) {
        const val = rK === ExprKind.IntLiteral ? dae.getExprData1(r) : dae.getExprRealValue(r);
        return { coeff: val, target: l };
      }
    }
    if (k === ExprKind.Unary && dae.getExprData1(id) === UnaryOp.Negate) {
      return { coeff: -1.0, target: dae.getExprLeft(id) };
    }
    if (k === ExprKind.Negate) {
      return { coeff: -1.0, target: dae.getExprLeft(id) };
    }
    return null;
  };

  const c1 = getCoeffAndTarget(term1);
  const c2 = getCoeffAndTarget(term2);
  if (c1 || c2) {
    const t1 = c1 ?? { coeff: 1.0, target: term1 };
    const t2 = c2 ?? { coeff: 1.0, target: term2 };
    if (exprsEqual(t1.target, t2.target, dae)) {
      const sumCoeff = t1.coeff + t2.coeff;
      if (sumCoeff === 0) return dae.addRealLiteral(0.0);
      if (sumCoeff === 1) return t1.target;
      if (sumCoeff === -1) return dae.addExpression(ExprKind.Negate, 0, t1.target);
      return mulWithSimplification(dae.addRealLiteral(sumCoeff), t1.target, dae);
    }
  }

  if (
    t1K === ExprKind.Binary &&
    dae.getExprData1(term1) === BinOp.Mul &&
    t2K === ExprKind.Binary &&
    dae.getExprData1(term2) === BinOp.Mul
  ) {
    const a = dae.getExprLeft(term1);
    const b = dae.getExprRight(term1);
    const c = dae.getExprLeft(term2);
    const d = dae.getExprRight(term2);
    if (exprsEqual(a, c, dae)) {
      const sumInner = dae.addBinaryExpr(BinOp.Add, b, d);
      return dae.addBinaryExpr(BinOp.Mul, a, sumInner);
    }
    if (exprsEqual(a, d, dae)) {
      const sumInner = dae.addBinaryExpr(BinOp.Add, b, c);
      return dae.addBinaryExpr(BinOp.Mul, a, sumInner);
    }
    if (exprsEqual(b, c, dae)) {
      const sumInner = dae.addBinaryExpr(BinOp.Add, a, d);
      return dae.addBinaryExpr(BinOp.Mul, b, sumInner);
    }
    if (exprsEqual(b, d, dae)) {
      const sumInner = dae.addBinaryExpr(BinOp.Add, a, c);
      return dae.addBinaryExpr(BinOp.Mul, b, sumInner);
    }
  }

  return dae.addBinaryExpr(BinOp.Add, term1, term2);
}

export function matrixOrVectorMul(leftId: number, rightId: number, dae: DAEBuilder): number {
  const lDims = getExprDims(leftId, dae);
  const rDims = getExprDims(rightId, dae);
  const lRank = lDims && lDims.length > 0 ? lDims.length : getArrayCtorRank(leftId, dae);
  const rRank = rDims && rDims.length > 0 ? rDims.length : getArrayCtorRank(rightId, dae);

  if (lRank === 1 && rRank === 2) {
    // Vector (1xK) * Matrix (KxM) -> Vector (1xM)
    const lElems = getArrayCtorElements(leftId, dae);
    const rRows = getArrayCtorElements(rightId, dae);
    const M =
      rDims && rDims.length >= 2 && rDims[1]! >= 0
        ? rDims[1]!
        : rRows.length > 0
          ? getArrayCtorElements(rRows[0]!, dae).length
          : 0;
    const K = lDims && lDims.length >= 1 && lDims[0]! >= 0 ? lDims[0]! : lElems.length;

    if (M === 0) {
      const res = dae.addArrayCtorExpr([]);
      if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
      (dae as any).exprArrayShapes.set(res, [0]);
      return res;
    }
    if (K === 0) {
      const zeroLit = dae.addRealLiteral(0.0);
      const resCols: number[] = [];
      for (let j = 0; j < M; j++) resCols.push(zeroLit);
      const res = dae.addArrayCtorExpr(resCols);
      if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
      (dae as any).exprArrayShapes.set(res, [M]);
      return res;
    }
    if (rRows.length > 0) {
      const resCols: number[] = [];
      for (let j = 0; j < M; j++) {
        let sumExpr: number | null = null;
        for (let k = 0; k < lElems.length; k++) {
          const rColsK = getArrayCtorElements(rRows[k]!, dae);
          const term = mulWithSimplification(lElems[k]!, rColsK[j]!, dae);
          sumExpr = sumExpr === null ? term : addWithFactoring(sumExpr, term, dae);
        }
        resCols.push(sumExpr ?? dae.addRealLiteral(0.0));
      }
      const res = dae.addArrayCtorExpr(resCols);
      if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
      (dae as any).exprArrayShapes.set(res, [M]);
      return res;
    }
  }

  if (lRank === 2 && rRank === 2) {
    // Matrix (NxK) * Matrix (KxM) -> Matrix (NxM)
    const lRows = getArrayCtorElements(leftId, dae);
    const rRows = getArrayCtorElements(rightId, dae);
    const N = lDims && lDims.length >= 1 && lDims[0]! >= 0 ? lDims[0]! : lRows.length;
    const M =
      rDims && rDims.length >= 2 && rDims[1]! >= 0
        ? rDims[1]!
        : rRows.length > 0
          ? getArrayCtorElements(rRows[0]!, dae).length
          : 0;
    const K =
      lDims && lDims.length >= 2 && lDims[1]! >= 0
        ? lDims[1]!
        : lRows.length > 0
          ? getArrayCtorElements(lRows[0]!, dae).length
          : rRows.length;

    if (N === 0) {
      const res = dae.addArrayCtorExpr([]);
      if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
      (dae as any).exprArrayShapes.set(res, [0, M]);
      return res;
    }
    if (M === 0) {
      const resRows: number[] = [];
      for (let i = 0; i < N; i++) {
        resRows.push(dae.addArrayCtorExpr([]));
      }
      const res = dae.addArrayCtorExpr(resRows);
      if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
      (dae as any).exprArrayShapes.set(res, [N, 0]);
      return res;
    }
    if (K === 0) {
      const zeroLit = dae.addRealLiteral(0.0);
      const resRows: number[] = [];
      for (let i = 0; i < N; i++) {
        const rowCols: number[] = [];
        for (let j = 0; j < M; j++) {
          rowCols.push(zeroLit);
        }
        resRows.push(dae.addArrayCtorExpr(rowCols));
      }
      const res = dae.addArrayCtorExpr(resRows);
      if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
      (dae as any).exprArrayShapes.set(res, [N, M]);
      return res;
    }
    if (lRows.length > 0 && rRows.length > 0) {
      const resRows: number[] = [];
      for (let i = 0; i < lRows.length; i++) {
        const lColsI = getArrayCtorElements(lRows[i]!, dae);
        const rowCols: number[] = [];
        for (let j = 0; j < M; j++) {
          let sumExpr: number | null = null;
          for (let k = 0; k < lColsI.length; k++) {
            const rColsK = getArrayCtorElements(rRows[k]!, dae);
            const term = mulWithSimplification(lColsI[k]!, rColsK[j]!, dae);
            sumExpr = sumExpr === null ? term : addWithFactoring(sumExpr, term, dae);
          }
          rowCols.push(sumExpr ?? dae.addRealLiteral(0.0));
        }
        resRows.push(dae.addArrayCtorExpr(rowCols));
      }
      const res = dae.addArrayCtorExpr(resRows);
      if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
      (dae as any).exprArrayShapes.set(res, [N, M]);
      return res;
    }
  }

  if (lRank === 2 && rRank === 1) {
    // Matrix (NxK) * Vector (Kx1) -> Vector (Nx1)
    const lRows = getArrayCtorElements(leftId, dae);
    const rElems = getArrayCtorElements(rightId, dae);
    const N = lDims && lDims.length >= 1 && lDims[0]! >= 0 ? lDims[0]! : lRows.length;
    const K =
      lDims && lDims.length >= 2 && lDims[1]! >= 0
        ? lDims[1]!
        : lRows.length > 0
          ? getArrayCtorElements(lRows[0]!, dae).length
          : rElems.length;

    if (N === 0) {
      const res = dae.addArrayCtorExpr([]);
      if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
      (dae as any).exprArrayShapes.set(res, [0]);
      return res;
    }
    if (K === 0) {
      const zeroLit = dae.addRealLiteral(0.0);
      const resElems: number[] = [];
      for (let i = 0; i < N; i++) resElems.push(zeroLit);
      const res = dae.addArrayCtorExpr(resElems);
      if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
      (dae as any).exprArrayShapes.set(res, [N]);
      return res;
    }
    const resElems: number[] = [];
    for (let i = 0; i < lRows.length; i++) {
      const lColsI = getArrayCtorElements(lRows[i]!, dae);
      let sumExpr: number | null = null;
      for (let k = 0; k < lColsI.length; k++) {
        const term = mulWithSimplification(lColsI[k]!, rElems[k]!, dae);
        sumExpr = sumExpr === null ? term : addWithFactoring(sumExpr, term, dae);
      }
      resElems.push(sumExpr ?? dae.addRealLiteral(0.0));
    }
    const res = dae.addArrayCtorExpr(resElems);
    if (!(dae as any).exprArrayShapes) (dae as any).exprArrayShapes = new Map<number, number[]>();
    (dae as any).exprArrayShapes.set(res, [N]);
    return res;
  }

  if (lRank === 1 && rRank === 1) {
    // Vector (1xK) * Vector (Kx1) -> Scalar
    const lElems = getArrayCtorElements(leftId, dae);
    const rElems = getArrayCtorElements(rightId, dae);
    const K = lDims && lDims.length >= 1 && lDims[0]! >= 0 ? lDims[0]! : lElems.length;
    if (K === 0) return dae.addRealLiteral(0.0);
    let sumExpr: number | null = null;
    for (let k = 0; k < lElems.length; k++) {
      const term = mulWithSimplification(lElems[k]!, rElems[k]!, dae);
      sumExpr = sumExpr === null ? term : addWithFactoring(sumExpr, term, dae);
    }
    return sumExpr ?? dae.addRealLiteral(0.0);
  }

  return addArrayBinaryExpr(BinOp.Mul, leftId, rightId, dae);
}

export function matrixPower(leftId: number, power: number, dae: DAEBuilder): number {
  const lRank = getArrayCtorRank(leftId, dae);
  if (lRank === 2) {
    const lRows = getArrayCtorElements(leftId, dae);
    const N = lRows.length;
    if (power === 0) {
      const rows: number[] = [];
      for (let i = 0; i < N; i++) {
        const cols: number[] = [];
        for (let j = 0; j < N; j++) {
          cols.push(dae.addRealLiteral(i === j ? 1.0 : 0.0));
        }
        rows.push(dae.addArrayCtorExpr(cols));
      }
      return dae.addArrayCtorExpr(rows);
    }
    if (power === 1) {
      return leftId;
    }
    if (power === 2) {
      return matrixOrVectorMul(leftId, leftId, dae);
    }
    let cur = leftId;
    for (let p = 2; p <= power; p++) {
      cur = matrixOrVectorMul(cur, leftId, dae);
    }
    return cur;
  }
  return dae.addBinaryExpr(BinOp.Pow, leftId, dae.addRealLiteral(power));
}

export function addArrayBinaryExpr(op: BinOp, leftId: number, rightId: number, dae: DAEBuilder): number {
  const leftKind = dae.getExprKind(leftId);
  const rightKind = dae.getExprKind(rightId);
  if (leftKind === ExprKind.ArrayCtor && rightKind === ExprKind.ArrayCtor) {
    const leftElems = getArrayCtorElements(leftId, dae);
    const rightElems = getArrayCtorElements(rightId, dae);
    if (leftElems.length === rightElems.length) {
      if (leftElems.length === 0) return dae.addArrayCtorExpr([]);
      const newElems = leftElems.map((e, i) => addArrayBinaryExpr(op, e, rightElems[i]!, dae));
      return dae.addArrayCtorExpr(newElems);
    }
  }
  if (op === BinOp.Add) {
    if (leftKind === ExprKind.RealLiteral && dae.getExprRealValue(leftId) === 0) return rightId;
    if (leftKind === ExprKind.IntLiteral && dae.getExprData1(leftId) === 0) return rightId;
    if (rightKind === ExprKind.RealLiteral && dae.getExprRealValue(rightId) === 0) return leftId;
    if (rightKind === ExprKind.IntLiteral && dae.getExprData1(rightId) === 0) return leftId;
  }
  if (op === BinOp.Sub) {
    if (rightKind === ExprKind.RealLiteral && dae.getExprRealValue(rightId) === 0) return leftId;
    if (rightKind === ExprKind.IntLiteral && dae.getExprData1(rightId) === 0) return leftId;
  }
  if (
    (leftKind === ExprKind.IntLiteral || leftKind === ExprKind.RealLiteral) &&
    (rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral)
  ) {
    const lVal = leftKind === ExprKind.IntLiteral ? dae.getExprData1(leftId) : dae.getExprRealValue(leftId);
    const rVal = rightKind === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
    let res: number | null = null;
    switch (op) {
      case BinOp.Add:
        res = lVal + rVal;
        break;
      case BinOp.Sub:
        res = lVal - rVal;
        break;
      case BinOp.Mul:
        res = lVal * rVal;
        break;
      case BinOp.Div:
        res = rVal !== 0 ? lVal / rVal : null;
        break;
    }
    if (res !== null) {
      if (
        op === BinOp.Div ||
        leftKind === ExprKind.RealLiteral ||
        rightKind === ExprKind.RealLiteral ||
        !Number.isInteger(res)
      ) {
        return dae.addRealLiteral(res);
      }
      return dae.addIntLiteral(res);
    }
  }
  return dae.addBinaryExpr(op, leftId, rightId);
}

export function broadcastElemBinOp(
  elemOp: BinOp,
  baseOp: BinOp,
  leftId: number,
  rightId: number,
  dae: DAEBuilder,
  flattener?: any,
  isTopLevel = false,
): number {
  const lK = dae.getExprKind(leftId);
  const rK = dae.getExprKind(rightId);
  if (lK === ExprKind.ArrayCtor && rK === ExprKind.ArrayCtor) {
    const lElems = getArrayCtorElements(leftId, dae);
    const rElems = getArrayCtorElements(rightId, dae);
    if (lElems.length === rElems.length && lElems.length > 0) {
      const newElems = lElems.map((e, i) => broadcastElemBinOp(elemOp, baseOp, e, rElems[i]!, dae, flattener, false));
      return dae.addArrayCtorExpr(newElems);
    }
  } else if (lK === ExprKind.ArrayCtor && rK !== ExprKind.ArrayCtor) {
    const lElems = getArrayCtorElements(leftId, dae);
    const newElems = lElems.map((e) => broadcastElemBinOp(elemOp, baseOp, e, rightId, dae, flattener, false));
    return dae.addArrayCtorExpr(newElems);
  } else if (lK !== ExprKind.ArrayCtor && rK === ExprKind.ArrayCtor) {
    const rElems = getArrayCtorElements(rightId, dae);
    if (flattener?.options?.omcCompatibility && (baseOp === BinOp.Add || baseOp === BinOp.Mul)) {
      const newElems = rElems.map((e) => broadcastElemBinOp(elemOp, baseOp, e, leftId, dae, flattener, false));
      return dae.addArrayCtorExpr(newElems);
    } else {
      const newElems = rElems.map((e) => broadcastElemBinOp(elemOp, baseOp, leftId, e, dae, flattener, false));
      return dae.addArrayCtorExpr(newElems);
    }
  }

  if (
    (lK === ExprKind.IntLiteral || lK === ExprKind.RealLiteral) &&
    (rK === ExprKind.IntLiteral || rK === ExprKind.RealLiteral)
  ) {
    const lVal = lK === ExprKind.IntLiteral ? dae.getExprData1(leftId) : dae.getExprRealValue(leftId);
    const rVal = rK === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
    let res: number | null = null;
    switch (baseOp) {
      case BinOp.Add:
        res = lVal + rVal;
        break;
      case BinOp.Sub:
        res = lVal - rVal;
        break;
      case BinOp.Mul:
        res = lVal * rVal;
        break;
      case BinOp.Div:
        res = rVal !== 0 ? lVal / rVal : null;
        break;
      case BinOp.Pow:
        res = Math.pow(lVal, rVal);
        break;
    }
    if (res !== null) {
      if (
        baseOp === BinOp.Div ||
        baseOp === BinOp.Pow ||
        lK === ExprKind.RealLiteral ||
        rK === ExprKind.RealLiteral ||
        !Number.isInteger(res)
      ) {
        return dae.addRealLiteral(res);
      }
      return dae.addIntLiteral(res);
    }
  }

  let l = leftId;
  let r = rightId;
  if (baseOp === BinOp.Div || baseOp === BinOp.Pow) {
    if (!isRealExpr(l, dae)) l = castToRealExpr(l, dae);
    if (!isRealExpr(r, dae)) r = castToRealExpr(r, dae);
  } else if (isRealExpr(l, dae) && !isRealExpr(r, dae)) {
    r = castToRealExpr(r, dae);
  } else if (!isRealExpr(l, dae) && isRealExpr(r, dae)) {
    l = castToRealExpr(l, dae);
  }
  const lDims = getExprDims(l, dae, flattener?.db);
  const rDims = getExprDims(r, dae, flattener?.db);
  const lIsArr = lDims !== null && lDims.length > 0;
  const rIsArr = rDims !== null && rDims.length > 0;
  if (flattener?.options?.omcCompatibility && (baseOp === BinOp.Add || baseOp === BinOp.Mul)) {
    if (!lIsArr && rIsArr) {
      [l, r] = [r, l];
    }
  }
  const useElemOp = isTopLevel && (lIsArr || rIsArr);
  return dae.addBinaryExpr(useElemOp ? elemOp : baseOp, l, r);
}

export function getOperatorNameForBinOp(op: BinOp): string | null {
  switch (op) {
    case BinOp.Add:
      return "'+'";
    case BinOp.Sub:
      return "'-'";
    case BinOp.Mul:
      return "'*'";
    case BinOp.Div:
      return "'/'";
    case BinOp.Pow:
      return "'^'";
    case BinOp.Eq:
      return "'=='";
    case BinOp.Neq:
      return "'<>'";
    case BinOp.Lt:
      return "'<'";
    case BinOp.Lte:
      return "'<='";
    case BinOp.Gt:
      return "'>'";
    case BinOp.Gte:
      return "'>='";
    case BinOp.And:
      return "'and'";
    case BinOp.Or:
      return "'or'";
    default:
      return null;
  }
}

export function areExpressionsEqual(dae: DAEBuilder, id1: number, id2: number): boolean {
  if (id1 === id2) return true;
  if (id1 < 0 || id2 < 0) return false;
  const k1 = dae.getExprKind(id1);
  const k2 = dae.getExprKind(id2);
  if (k1 !== k2) {
    if (
      (k1 === ExprKind.RealLiteral || k1 === ExprKind.IntLiteral) &&
      (k2 === ExprKind.RealLiteral || k2 === ExprKind.IntLiteral)
    ) {
      const v1 = k1 === ExprKind.RealLiteral ? dae.getExprRealValue(id1) : dae.getExprData1(id1);
      const v2 = k2 === ExprKind.RealLiteral ? dae.getExprRealValue(id2) : dae.getExprData1(id2);
      return v1 === v2;
    }
    return false;
  }
  switch (k1) {
    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
      return dae.getExprData1(id1) === dae.getExprData1(id2);
    case ExprKind.RealLiteral:
      return dae.getExprRealValue(id1) === dae.getExprRealValue(id2);
    case ExprKind.StringLiteral:
    case ExprKind.Name:
      return dae.interner.resolve(dae.getExprData1(id1)) === dae.interner.resolve(dae.getExprData1(id2));
    case ExprKind.Unary:
    case ExprKind.Negate:
    case ExprKind.Der:
    case ExprKind.Pre:
      return (
        dae.getExprData1(id1) === dae.getExprData1(id2) &&
        areExpressionsEqual(dae, dae.getExprLeft(id1), dae.getExprLeft(id2))
      );
    case ExprKind.Binary:
      return (
        dae.getExprData1(id1) === dae.getExprData1(id2) &&
        areExpressionsEqual(dae, dae.getExprLeft(id1), dae.getExprLeft(id2)) &&
        areExpressionsEqual(dae, dae.getExprRight(id1), dae.getExprRight(id2))
      );
    case ExprKind.Subscript: {
      if (dae.getExprRight(id1) !== dae.getExprRight(id2)) return false;
      if (!areExpressionsEqual(dae, dae.getExprData1(id1), dae.getExprData1(id2))) return false;
      const cnt = dae.getExprRight(id1);
      for (let i = 0; i < cnt; i++) {
        const s1 = i === 0 ? dae.getExprLeft(id1) : dae.getExprLeft(id1 + i);
        const s2 = i === 0 ? dae.getExprLeft(id2) : dae.getExprLeft(id2 + i);
        if (!areExpressionsEqual(dae, s1, s2)) return false;
      }
      return true;
    }
    case ExprKind.Call: {
      if (dae.interner.resolve(dae.getExprData1(id1)) !== dae.interner.resolve(dae.getExprData1(id2))) return false;
      if (dae.getExprRight(id1) !== dae.getExprRight(id2)) return false;
      const cnt = dae.getExprRight(id1);
      for (let i = 0; i < cnt; i++) {
        const a1 = i === 0 ? dae.getExprLeft(id1) : dae.getExprLeft(id1 + i);
        const a2 = i === 0 ? dae.getExprLeft(id2) : dae.getExprLeft(id2 + i);
        if (!areExpressionsEqual(dae, a1, a2)) return false;
      }
      return true;
    }
    case ExprKind.ArrayCtor: {
      if (dae.getExprData1(id1) !== dae.getExprData1(id2)) return false;
      const cnt = dae.getExprData1(id1);
      for (let i = 0; i < cnt; i++) {
        const a1 = i === 0 ? dae.getExprLeft(id1) : dae.getExprLeft(id1 + i);
        const a2 = i === 0 ? dae.getExprLeft(id2) : dae.getExprLeft(id2 + i);
        if (!areExpressionsEqual(dae, a1, a2)) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

export function findOperatorRecordComponentType(
  baseName: string,
  dae: DAEBuilder,
  db: QueryDB | undefined,
  flattener: any,
): { name: string; symId: SymbolId; isArray: boolean; arrayDim?: number } | null {
  if (!db) return null;
  const currentPrefix = (dae as any).currentPrefix ?? flattener?.currentPrefix;
  let vIdx = dae.getVarIdxByName(baseName);
  if (vIdx < 0 && currentPrefix) {
    vIdx = dae.getVarIdxByName(`${currentPrefix}.${baseName}`);
  }
  if (vIdx >= 0) {
    const cType = dae.getVarCustomType(vIdx);
    if (!cType) return null;
    const cleanType = cType.includes(".") ? cType.split(".").pop()! : cType;
    const classSym = db.byName(cleanType).find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
    if (classSym) {
      const shape = dae.getVarShape(vIdx);
      const isArray = Boolean(shape && shape.length > 0);
      const arrayDim = isArray ? shape[0] : 0;
      return { name: classSym.name, symId: classSym.id, isArray, arrayDim };
    }
    return null;
  }

  if (flattener?.currentFlatteningFunctionId) {
    const fnComps = db.childrenOf(flattener.currentFlatteningFunctionId).filter((c: any) => c.kind === "Component");
    const compSym = fnComps.find((c: any) => c.name?.replace(/\[.*\]$/, "") === baseName);
    if (compSym) {
      const compInst = db.query<any>("componentInstance", compSym.id);
      const typeSpec =
        compInst?.typeSpecifier ??
        (compSym.metadata as any)?.typeSpecifier ??
        db.query<string | null>("typeSpecifier", compSym.id);
      if (!typeSpec) return null;
      const cleanType = typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec;
      const classSym = db.byName(cleanType).find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
      if (classSym) {
        const dims = compInst?.arrayDimensions;
        const isArray = Boolean((dims && dims.length > 0) || (compSym.metadata as any)?.isArray);
        const arrayDim = dims && dims.length > 0 ? dims[0] : 0;
        return { name: classSym.name, symId: classSym.id, isArray, arrayDim };
      }
      return null;
    }
  }

  let compSym: any = null;
  if (flattener?.currentRootClassId) {
    const comps = db.childrenOf(flattener.currentRootClassId).filter((c: any) => c.kind === "Component");
    compSym = comps.find((c: any) => (c.name ? c.name.split("[")[0] : "") === baseName);
    if (!compSym) {
      const instComps = db.query<any[]>("instantiate", flattener.currentRootClassId);
      if (instComps) {
        compSym = instComps.find((c: any) => (c.name ? c.name.split("[")[0] : "") === baseName);
      }
    }
  }
  if (!compSym) {
    compSym = db.byName(baseName).find((e: any) => e.kind === "Component");
  }
  if (compSym) {
    const compInst = db.query<any>("componentInstance", compSym.id);
    const typeSpec =
      compInst?.typeSpecifier ??
      (compSym.metadata as any)?.typeSpecifier ??
      db.query<string | null>("typeSpecifier", compSym.id);
    if (typeSpec) {
      const cleanType = typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec;
      const classSym = db.byName(cleanType).find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
      if (classSym) {
        const dims = compInst?.arrayDimensions;
        const isArray = Boolean(
          (dims && dims.length > 0) || (compSym.metadata as any)?.isArray || compSym.name.includes("["),
        );
        const arrayDim = dims && dims.length > 0 ? dims[0] : 0;
        return { name: classSym.name, symId: classSym.id, isArray, arrayDim };
      }
    }
  }
  return null;
}

export function resolveOperatorRecord(
  exprId: number,
  cstNode: any,
  dae: DAEBuilder,
  db: QueryDB | undefined,
  flattener: any,
): { name: string; symId: SymbolId; isArray: boolean; arrayDim?: number } | null {
  if (!db) return null;

  const findCompType = (baseName: string) => findOperatorRecordComponentType(baseName, dae, db, flattener);

  const resolvePath = (pathStr: string) => {
    const parts = pathStr
      .split(".")
      .map((p) => p.split("[")[0].trim())
      .filter(Boolean);
    if (parts.length === 0) return null;
    let curr = findCompType(parts[0]!);
    if (!curr) return null;
    for (let i = 1; i < parts.length; i++) {
      const fieldName = parts[i]!;
      const children = db.childrenOf(curr.symId).filter((c: any) => c.kind === "Component");
      const fieldSym = children.find((c: any) => c.name === fieldName);
      if (!fieldSym) return null;
      const compInst = db.query<any>("componentInstance", fieldSym.id);
      const typeSpec =
        compInst?.typeSpecifier ??
        (fieldSym.metadata as any)?.typeSpecifier ??
        db.query<string | null>("typeSpecifier", fieldSym.id);
      if (!typeSpec) return null;
      const cleanType = typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec;
      const classSym = db.byName(cleanType).find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
      if (!classSym) return null;
      const dims = compInst?.arrayDimensions;
      const isArray = Boolean(
        (dims && dims.length > 0) || (fieldSym.metadata as any)?.isArray || fieldSym.name.includes("["),
      );
      const arrayDim = dims && dims.length > 0 ? dims[0] : 0;
      curr = { name: classSym.name, symId: classSym.id, isArray, arrayDim };
    }
    return curr;
  };

  if (cstNode) {
    let nodeText = cstNode.text?.trim() ?? "";
    while (nodeText.startsWith("(") && nodeText.endsWith(")")) {
      nodeText = nodeText.slice(1, -1).trim();
    }
    const isSubscripted = nodeText.endsWith("]");
    const res = resolvePath(nodeText);
    if (res) {
      return {
        name: res.name,
        symId: res.symId,
        isArray: isSubscripted ? false : res.isArray,
        arrayDim: res.arrayDim,
      };
    }
  }

  if (exprId >= 0) {
    const kind = dae.getExprKind(exprId);
    if (kind === ExprKind.Name) {
      const varName = dae.interner.resolve(dae.getExprData1(exprId));
      if (varName) {
        const isSubscripted = varName.endsWith("]");
        const res = resolvePath(varName);
        if (res) {
          return {
            name: res.name,
            symId: res.symId,
            isArray: isSubscripted ? false : res.isArray,
            arrayDim: res.arrayDim,
          };
        }
      }
    } else if (kind === ExprKind.Call) {
      const fnName = dae.interner.resolve(dae.getExprData1(exprId));
      if (fnName) {
        const baseClass = fnName.split(".")[0]!;
        const classSym = db
          .byName(baseClass)
          .find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
        if (classSym) {
          return { name: classSym.name, symId: classSym.id, isArray: false };
        }
      }
    }
  }

  return null;
}

export function coerceToOperatorRecord(
  argExprId: number,
  recSymId: SymbolId,
  recName: string,
  dae: DAEBuilder,
  db: QueryDB,
  flattener: any,
): number | null {
  const ctors = db.query<any[]>("operatorConstructors", recSymId);
  if (!ctors || ctors.length === 0) return null;

  for (const ctor of ctors) {
    if (ctor.inputParams && ctor.inputParams.length >= 1) {
      const p0 = ctor.inputParams[0];
      if (p0.typeSpec === "Real" || p0.typeSpec === "Integer") {
        let firstArg = argExprId;
        if (p0.typeSpec === "Real" && dae.getExprKind(argExprId) === ExprKind.IntLiteral) {
          firstArg = dae.addRealLiteral(dae.getExprData1(argExprId));
        }
        const callArgs: number[] = [firstArg];
        for (let i = 1; i < ctor.inputParams.length; i++) {
          const pi = ctor.inputParams[i];
          if (pi.hasDefault && pi.defaultValue !== undefined) {
            const defValNum = Number(pi.defaultValue);
            callArgs.push(isNaN(defValNum) ? dae.addRealLiteral(0.0) : dae.addRealLiteral(defValNum));
          } else {
            callArgs.push(dae.addRealLiteral(0.0));
          }
        }
        flattener?.usedOperatorFunctions?.set(ctor.qualifiedName, ctor.funcSymId);
        return dae.addCallExpr(ctor.qualifiedName, callArgs);
      }
    }
  }
  return null;
}

export function dispatchBinaryOperator(
  opName: string,
  leftId: number,
  rightId: number,
  leftNode: any,
  rightNode: any,
  dae: DAEBuilder,
  db: QueryDB,
  flattener: any,
): number | null {
  if (flattener && typeof flattener.hasOperatorRecords === "function") {
    const rootId = (flattener as any).currentRootClassId ?? (dae as any).currentClassId;
    if (rootId && !flattener.hasOperatorRecords(rootId)) {
      return null;
    }
  }

  const leftKind = dae.getExprKind(leftId);
  const rightKind = dae.getExprKind(rightId);
  const isLeftPrimitive =
    leftKind === ExprKind.RealLiteral ||
    leftKind === ExprKind.IntLiteral ||
    leftKind === ExprKind.BoolLiteral ||
    leftKind === ExprKind.StringLiteral;
  const isRightPrimitive =
    rightKind === ExprKind.RealLiteral ||
    rightKind === ExprKind.IntLiteral ||
    rightKind === ExprKind.BoolLiteral ||
    rightKind === ExprKind.StringLiteral;

  if (isLeftPrimitive && isRightPrimitive) {
    return null;
  }

  const leftRec = isLeftPrimitive ? null : resolveOperatorRecord(leftId, leftNode, dae, db, flattener);
  const rightRec = isRightPrimitive ? null : resolveOperatorRecord(rightId, rightNode, dae, db, flattener);
  if (!leftRec && !rightRec) return null;

  const recSym = (leftRec ?? rightRec)!;
  const ops = db.query<Map<string, any[]> | null>("operatorFunctions", recSym.symId);
  const cleanOp = opName.replace(/^'|'$/g, "");
  const rawCandidates: any[] = ops ? [...(ops.get(opName) ?? []), ...(ops.get(cleanOp) ?? [])] : [];
  if (rightRec && rightRec.symId !== leftRec?.symId) {
    const rOps = db.query<Map<string, any[]> | null>("operatorFunctions", rightRec.symId);
    if (rOps) {
      rawCandidates.push(...(rOps.get(opName) ?? []), ...(rOps.get(cleanOp) ?? []));
    }
  }
  const seenCandidates = new Set<string>();
  const candidates: any[] = [];
  for (const cand of rawCandidates) {
    if (!seenCandidates.has(cand.qualifiedName)) {
      seenCandidates.add(cand.qualifiedName);
      candidates.push(cand);
    }
  }

  const matched: { overload: any; finalLeftId: number; finalRightId: number }[] = [];

  const checkParamMatch = (
    param: any,
    rec: { name: string; symId: SymbolId; isArray: boolean } | null,
    argId: number,
  ): { matched: boolean; argId: number } => {
    if (param.isArray) {
      if (rec?.isArray) return { matched: true, argId };
      return { matched: false, argId };
    }
    if (rec) {
      if (rec.isArray) return { matched: false, argId };
      if (param.typeSpec === rec.name) return { matched: true, argId };
      return { matched: false, argId };
    }
    // Primitive argument (Real or Integer)
    if (param.typeSpec === "Real" || param.typeSpec === "Integer") {
      let finalArg = argId;
      if (param.typeSpec === "Real" && dae.getExprKind(argId) === ExprKind.IntLiteral) {
        finalArg = dae.addRealLiteral(dae.getExprData1(argId));
      }
      return { matched: true, argId: finalArg };
    }
    // Try implicit constructor coercion to target operator record
    const targetSym = db
      .byName(param.typeSpec)
      .find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
    if (targetSym) {
      const coerced = coerceToOperatorRecord(argId, targetSym.id, targetSym.name, dae, db, flattener);
      if (coerced !== null) {
        return { matched: true, argId: coerced };
      }
    }
    return { matched: false, argId };
  };

  for (const cand of candidates) {
    if (cand.inputParams.length !== 2) continue;
    const p0 = cand.inputParams[0];
    const p1 = cand.inputParams[1];

    const lRes = checkParamMatch(p0, leftRec, leftId);
    const rRes = checkParamMatch(p1, rightRec, rightId);

    if (lRes.matched && rRes.matched) {
      matched.push({ overload: cand, finalLeftId: lRes.argId, finalRightId: rRes.argId });
    }
  }

  if (matched.length === 1) {
    const m = matched[0]!;
    flattener?.usedOperatorFunctions?.set(m.overload.qualifiedName, m.overload.funcSymId);
    return dae.addCallExpr(m.overload.qualifiedName, [m.finalLeftId, m.finalRightId]);
  }

  if (matched.length > 1) {
    // If one candidate matched directly without coercion and others matched with coercion, prefer direct
    const directMatches = matched.filter((m) => {
      const p0 = m.overload.inputParams[0];
      const p1 = m.overload.inputParams[1];
      const lDirect = leftRec ? p0.typeSpec === leftRec.name : p0.typeSpec === "Real" || p0.typeSpec === "Integer";
      const rDirect = rightRec ? p1.typeSpec === rightRec.name : p1.typeSpec === "Real" || p1.typeSpec === "Integer";
      return lDirect && rDirect;
    });
    if (directMatches.length === 1) {
      const m = directMatches[0]!;
      flattener?.usedOperatorFunctions?.set(m.overload.qualifiedName, m.overload.funcSymId);
      return dae.addCallExpr(m.overload.qualifiedName, [m.finalLeftId, m.finalRightId]);
    }

    const candidateStrings = candidates.map((c) => {
      const params = c.inputParams.map((p: any) => `${p.typeSpec}${p.isArray ? "[:]" : ""} ${p.name}`).join(", ");
      return `  ${c.qualifiedName}(${params}) => ${c.outputType}`;
    });
    const exprText = `${leftNode?.text?.trim() ?? ""} ${cleanOp} ${rightNode?.text?.trim() ?? ""}`;
    let eqNode: any = leftNode;
    while (
      eqNode &&
      eqNode.type !== "simple_equation" &&
      eqNode.type !== "component_clause" &&
      eqNode.type !== "statement" &&
      eqNode.type !== "assignment_statement"
    ) {
      eqNode = eqNode.parent;
    }
    const diagNode = eqNode ?? leftNode;
    dae.diagnostics.push({
      severity: "error",
      code: ModelicaErrorCode.AMBIGUOUS_OPERATOR_OVERLOAD.code,
      message: `Ambiguous matching overloaded operator functions found for ${exprText}.\nCandidates are:\n${candidateStrings.join("\n")}`,
      range: {
        startByte: diagNode?.startIndex ?? diagNode?.startByte,
        endByte: diagNode?.endIndex ?? diagNode?.endByte,
        startPosition: diagNode?.startPosition,
        endPosition: diagNode?.endPosition,
      },
    });
    return -1;
  }

  // If no match, check if it's an array vectorization across elements (e.g. c1 = c2 - c3 or c1 = c1 * x)
  const isLeftArr = Boolean(leftRec?.isArray);
  const isRightArr = Boolean(rightRec?.isArray);
  if (isLeftArr || isRightArr) {
    const arrDim = leftRec?.arrayDim ?? rightRec?.arrayDim ?? 0;
    // Find a scalar overload that matches individual elements
    const scalarLeftRec = leftRec ? { ...leftRec, isArray: false } : null;
    const scalarRightRec = rightRec ? { ...rightRec, isArray: false } : null;

    let bestScalarOverload: any = null;
    for (const cand of candidates) {
      if (cand.inputParams.length !== 2) continue;
      const p0 = cand.inputParams[0];
      const p1 = cand.inputParams[1];
      if (p0.isArray || p1.isArray) continue;
      const lRes = checkParamMatch(p0, scalarLeftRec, leftId);
      const rRes = checkParamMatch(p1, scalarRightRec, rightId);
      if (lRes.matched && rRes.matched) {
        bestScalarOverload = cand;
        break;
      }
    }

    if (bestScalarOverload && arrDim >= 0) {
      if (arrDim === 0) {
        return dae.addArrayCtorExpr([]);
      }
      flattener?.usedOperatorFunctions?.set(bestScalarOverload.qualifiedName, bestScalarOverload.funcSymId);
      const leftBase = leftNode?.text?.trim() ?? "";
      const rightBase = rightNode?.text?.trim() ?? "";
      const elemCallIds: number[] = [];
      for (let i = 1; i <= arrDim; i++) {
        let elLeftId = leftId;
        let elRightId = rightId;
        if (isLeftArr) {
          elLeftId = dae.addExpression(ExprKind.Name, dae.interner.intern(`${leftBase}[${i}]`));
        } else if (leftRec === null) {
          const coerced = coerceToOperatorRecord(leftId, recSym.symId, recSym.name, dae, db, flattener);
          if (coerced !== null) elLeftId = coerced;
        }
        if (isRightArr) {
          elRightId = dae.addExpression(ExprKind.Name, dae.interner.intern(`${rightBase}[${i}]`));
        } else if (rightRec === null) {
          const coerced = coerceToOperatorRecord(rightId, recSym.symId, recSym.name, dae, db, flattener);
          if (coerced !== null) elRightId = coerced;
        }
        elemCallIds.push(dae.addCallExpr(bestScalarOverload.qualifiedName, [elLeftId, elRightId]));
      }
      return dae.addArrayCtorExpr(elemCallIds);
    }
  }

  // If no match and at least one is operator record:
  const getOperandTypeStr = (rec: any, argId: number): string => {
    if (rec) {
      return `${rec.name}${rec.isArray ? `[${rec.arrayDim ?? 0}]` : ""}`;
    }
    const t = inferArenaExprVarType(dae, argId);
    if (t === VarType.Integer || dae.getExprKind(argId) === ExprKind.IntLiteral) return "Integer";
    if (t === VarType.Boolean || dae.getExprKind(argId) === ExprKind.BoolLiteral) return "Boolean";
    if (t === VarType.String || dae.getExprKind(argId) === ExprKind.StringLiteral) return "String";
    return "Real";
  };
  const leftTypeStr = getOperandTypeStr(leftRec, leftId);
  const rightTypeStr = getOperandTypeStr(rightRec, rightId);
  const exprText = `${leftNode?.text?.trim() ?? ""} ${cleanOp} ${rightNode?.text?.trim() ?? ""}`;
  let eqNode: any = leftNode;
  while (
    eqNode &&
    eqNode.type !== "simple_equation" &&
    eqNode.type !== "component_clause" &&
    eqNode.type !== "statement" &&
    eqNode.type !== "assignment_statement"
  ) {
    eqNode = eqNode.parent;
  }
  const diagNode = eqNode ?? leftNode;
  dae.diagnostics.push({
    severity: "error",
    code: ModelicaErrorCode.CANNOT_RESOLVE_OPERATOR_TYPE.code,
    message: `Cannot resolve type of expression ${exprText}. The operands have types ${leftTypeStr}, ${rightTypeStr} in component <NO_COMPONENT>.`,
    range: {
      startByte: diagNode?.startIndex ?? diagNode?.startByte,
      endByte: diagNode?.endIndex ?? diagNode?.endByte,
      startPosition: diagNode?.startPosition,
      endPosition: diagNode?.endPosition,
    },
  });
  return -1;
}

export function dispatchUnaryOperator(
  opName: string,
  operandId: number,
  operandNode: any,
  dae: DAEBuilder,
  db: QueryDB,
  flattener: any,
): number | null {
  const rec = resolveOperatorRecord(operandId, operandNode, dae, db, flattener);
  if (!rec) return null;

  const ops = db.query<Map<string, any[]> | null>("operatorFunctions", rec.symId);
  if (!ops) return null;

  const cleanOp = opName.replace(/^'|'$/g, "");
  const rawCandidates: any[] = [...(ops.get(opName) ?? []), ...(ops.get(cleanOp) ?? [])];
  const seenCandidates = new Set<string>();
  const candidates: any[] = [];
  for (const cand of rawCandidates) {
    if (!seenCandidates.has(cand.qualifiedName)) {
      seenCandidates.add(cand.qualifiedName);
      candidates.push(cand);
    }
  }
  if (candidates.length === 0) return null;

  for (const cand of candidates) {
    if (cand.inputParams.length !== 1) continue;
    const p0 = cand.inputParams[0];
    if (p0.isArray && rec.isArray) {
      flattener?.usedOperatorFunctions?.set(cand.qualifiedName, cand.funcSymId);
      return dae.addCallExpr(cand.qualifiedName, [operandId]);
    }
    if (!p0.isArray && !rec.isArray && p0.typeSpec === rec.name) {
      flattener?.usedOperatorFunctions?.set(cand.qualifiedName, cand.funcSymId);
      return dae.addCallExpr(cand.qualifiedName, [operandId]);
    }
  }

  for (const cand of candidates) {
    if (cand.inputParams.length === 1) {
      flattener?.usedOperatorFunctions?.set(cand.qualifiedName, cand.funcSymId);
      return dae.addCallExpr(cand.qualifiedName, [operandId]);
    }
  }

  return null;
}

export function negateExpr(operandId: number, dae: DAEBuilder): number {
  if (operandId < 0) return operandId;
  const k = dae.getExprKind(operandId);
  if (k === ExprKind.Negate) {
    return dae.getExprLeft(operandId);
  }
  if (k === ExprKind.Unary && (dae.getExprData1(operandId) as UnaryOp) === UnaryOp.Negate) {
    return dae.getExprLeft(operandId);
  }
  if (k === ExprKind.IntLiteral) {
    return dae.addIntLiteral(-dae.getExprData1(operandId));
  }
  if (k === ExprKind.RealLiteral) {
    const val = -dae.getExprRealValue(operandId);
    return dae.addRealLiteral(val === 0 ? 0.0 : val);
  }
  if (k === ExprKind.ArrayCtor) {
    const elems = getArrayCtorElements(operandId, dae);
    return dae.addArrayCtorExpr(elems.map((e) => negateExpr(e, dae)));
  }
  if (k === ExprKind.Binary) {
    const binOp = dae.getExprData1(operandId) as BinOp;
    if (binOp === BinOp.Mul) {
      const leftId = dae.getExprLeft(operandId);
      const rightId = dae.getExprRight(operandId);
      return dae.addBinaryExpr(BinOp.Mul, negateExpr(leftId, dae), rightId);
    }
    if (binOp === BinOp.Div) {
      const leftId = dae.getExprLeft(operandId);
      const rightId = dae.getExprRight(operandId);
      return dae.addBinaryExpr(BinOp.Div, negateExpr(leftId, dae), rightId);
    }
  }
  return dae.addExpression(ExprKind.Negate, 0, operandId);
}
