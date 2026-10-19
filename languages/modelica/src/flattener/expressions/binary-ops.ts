// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - Binary & Operator Expression Handling.
 *
 * Implements operator records dispatching, matrix/vector multiplication,
 * array binary broadcasting, arithmetic simplifications, and expression equivalence.
 */

import { ExprKind } from "@modelscript/dsl";
import { StringWriter } from "@modelscript/dsl/utils";
import {
  ArenaDAEPrinter,
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
import { getFlatteningState, setExprArrayShape } from "../support/state.js";
import { castToRealExpr, evalDaeExpr, getExprDims, isRealExpr } from "./eval.js";

export function exprReferencesRuntimeParameter(
  exprId: number,
  dae: DAEBuilder,
  visited: Set<number> = new Set(),
  includeInteger = false,
): boolean {
  if (exprId < 0 || visited.has(exprId)) return false;
  visited.add(exprId);
  const k = dae.getExprKind(exprId);
  if (k === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (!name) return false;
    const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
    const varIdx = dae.lookupVariable(name);
    if (varIdx >= 0) {
      const v = dae.getVarVariability(varIdx);
      if (v === Variability.Parameter && (!dae.isVarFinal(varIdx) || (isOldFrontend && name.includes(".")))) {
        if (includeInteger || dae.getVarType(varIdx) !== VarType.Integer) {
          return true;
        }
      }
    } else {
      const state = getFlatteningState(dae);
      const db: QueryDB | undefined = state.flattener?.db ?? state.db;
      if (db) {
        const leaf = (name.includes(".") ? name.split(".").pop()! : name).replace(/\[.*\]$/, "");
        for (const s of db.byName(leaf)) {
          if (s.kind === "Component" && db.query("variability", s.id) === "parameter") {
            const ts = db.query<string | null>("typeSpecifier", s.id);
            if (includeInteger || ts !== "Integer") {
              return true;
            }
          }
        }
      }
    }
    return false;
  }
  if (
    k === ExprKind.IntLiteral ||
    k === ExprKind.RealLiteral ||
    k === ExprKind.BoolLiteral ||
    k === ExprKind.StringLiteral ||
    k === ExprKind.Colon ||
    k === ExprKind.EnumLiteral
  ) {
    return false;
  }
  if (k === ExprKind.Binary) {
    const l = dae.getExprLeft(exprId);
    const r = dae.getExprRight(exprId);
    return (
      (l >= 0 && exprReferencesRuntimeParameter(l, dae, visited, includeInteger)) ||
      (r >= 0 && exprReferencesRuntimeParameter(r, dae, visited, includeInteger))
    );
  }
  if (k === ExprKind.Unary || k === ExprKind.Negate) {
    const l = dae.getExprLeft(exprId);
    return l >= 0 && exprReferencesRuntimeParameter(l, dae, visited, includeInteger);
  }
  if (k === ExprKind.IfElse) {
    const cond = dae.getExprData1(exprId);
    const thenE = dae.getExprLeft(exprId);
    const elseE = dae.getExprRight(exprId);
    return (
      (cond >= 0 && exprReferencesRuntimeParameter(cond, dae, visited, includeInteger)) ||
      (thenE >= 0 && exprReferencesRuntimeParameter(thenE, dae, visited, includeInteger)) ||
      (elseE >= 0 && exprReferencesRuntimeParameter(elseE, dae, visited, includeInteger))
    );
  }
  if (k === ExprKind.Der || k === ExprKind.Pre) {
    const arg = dae.getExprData1(exprId);
    return arg >= 0 && exprReferencesRuntimeParameter(arg, dae, visited, includeInteger);
  }
  if (k === ExprKind.Subscript) {
    const base = dae.getExprData1(exprId);
    if (base >= 0 && exprReferencesRuntimeParameter(base, dae, visited, includeInteger)) return true;
    const subCount = dae.getExprRight(exprId);
    for (let i = 0; i < subCount; i++) {
      const subId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
      if (subId >= 0 && exprReferencesRuntimeParameter(subId, dae, visited, includeInteger)) return true;
    }
    return false;
  }
  if (k === ExprKind.ArrayCtor || k === ExprKind.Tuple) {
    const count = dae.getExprData1(exprId);
    for (let i = 0; i < count; i++) {
      const elemId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
      if (elemId >= 0 && exprReferencesRuntimeParameter(elemId, dae, visited, includeInteger)) return true;
    }
    return false;
  }
  if (k === ExprKind.Call) {
    const count = dae.getExprRight(exprId);
    for (let i = 0; i < count; i++) {
      const argId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
      if (argId >= 0 && exprReferencesRuntimeParameter(argId, dae, visited, includeInteger)) return true;
    }
    return false;
  }
  return false;
}

export function exprReferencesEnumParameter(
  exprId: number,
  dae: DAEBuilder,
  visited: Set<number> = new Set(),
): boolean {
  if (exprId < 0 || visited.has(exprId)) return false;
  visited.add(exprId);
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
  if (
    k === ExprKind.IntLiteral ||
    k === ExprKind.RealLiteral ||
    k === ExprKind.BoolLiteral ||
    k === ExprKind.StringLiteral ||
    k === ExprKind.Colon ||
    k === ExprKind.EnumLiteral
  ) {
    return false;
  }
  if (k === ExprKind.Binary) {
    const l = dae.getExprLeft(exprId);
    const r = dae.getExprRight(exprId);
    return (
      (l >= 0 && exprReferencesEnumParameter(l, dae, visited)) ||
      (r >= 0 && exprReferencesEnumParameter(r, dae, visited))
    );
  }
  if (k === ExprKind.Unary || k === ExprKind.Negate) {
    const l = dae.getExprLeft(exprId);
    return l >= 0 && exprReferencesEnumParameter(l, dae, visited);
  }
  if (k === ExprKind.IfElse) {
    const cond = dae.getExprData1(exprId);
    const thenE = dae.getExprLeft(exprId);
    const elseE = dae.getExprRight(exprId);
    return (
      (cond >= 0 && exprReferencesEnumParameter(cond, dae, visited)) ||
      (thenE >= 0 && exprReferencesEnumParameter(thenE, dae, visited)) ||
      (elseE >= 0 && exprReferencesEnumParameter(elseE, dae, visited))
    );
  }
  if (k === ExprKind.Der || k === ExprKind.Pre) {
    const arg = dae.getExprData1(exprId);
    return arg >= 0 && exprReferencesEnumParameter(arg, dae, visited);
  }
  if (k === ExprKind.Subscript) {
    const base = dae.getExprData1(exprId);
    if (base >= 0 && exprReferencesEnumParameter(base, dae, visited)) return true;
    const subCount = dae.getExprRight(exprId);
    for (let i = 0; i < subCount; i++) {
      const subId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
      if (subId >= 0 && exprReferencesEnumParameter(subId, dae, visited)) return true;
    }
    return false;
  }
  if (k === ExprKind.ArrayCtor || k === ExprKind.Tuple) {
    const count = dae.getExprData1(exprId);
    for (let i = 0; i < count; i++) {
      const elemId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
      if (elemId >= 0 && exprReferencesEnumParameter(elemId, dae, visited)) return true;
    }
    return false;
  }
  if (k === ExprKind.Call) {
    const count = dae.getExprRight(exprId);
    for (let i = 0; i < count; i++) {
      const argId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
      if (argId >= 0 && exprReferencesEnumParameter(argId, dae, visited)) return true;
    }
    return false;
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
    const thenId = dae.getExprLeft(id);
    const elseId = dae.getExprRight(id);
    let thenElems = getArrayCtorElements(thenId, dae);
    let elseElems = getArrayCtorElements(elseId, dae);
    if (thenElems.length === 1 && dae.getExprKind(thenId) === ExprKind.Name) {
      const tName = dae.interner.resolve(dae.getExprData1(thenId));
      if (tName && dae.hasArrayElements(tName)) {
        const idxs = dae.getArrayElementIndices(tName);
        if (idxs.length > 1) {
          thenElems = idxs.map((vi) => dae.addExpression(ExprKind.Name, dae.interner.intern(dae.getVarName(vi))));
        }
      }
    }
    if (elseElems.length === 1 && thenElems.length > 1 && dae.getExprKind(elseId) === ExprKind.Call) {
      elseElems = thenElems.map((_, idx) => dae.addSubscriptExpr(elseId, [dae.addIntLiteral(idx + 1)]));
    } else if (thenElems.length === 1 && elseElems.length > 1 && dae.getExprKind(thenId) === ExprKind.Call) {
      thenElems = elseElems.map((_, idx) => dae.addSubscriptExpr(thenId, [dae.addIntLiteral(idx + 1)]));
    }
    if (
      thenElems.length === elseElems.length &&
      thenElems.length > 0 &&
      exprReferencesRuntimeParameter(condId, dae, new Set(), Boolean(dae.extensionMetadata?.["isOldFrontend"]))
    ) {
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
  if (kind !== ExprKind.ArrayCtor && kind !== ExprKind.Tuple) {
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
  return areExpressionsEqual(dae, id1, id2, false);
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
  if (isMinusOne(leftId, dae)) return negateExpr(rightId, dae);
  if (isMinusOne(rightId, dae)) return negateExpr(leftId, dae);

  const lIsDiv = lK === ExprKind.Binary && dae.getExprData1(leftId) === BinOp.Div;
  const rIsDiv = rK === ExprKind.Binary && dae.getExprData1(rightId) === BinOp.Div;
  if (lIsDiv && rIsDiv) {
    const lNum = dae.getExprLeft(leftId);
    const lDen = dae.getExprRight(leftId);
    const rNum = dae.getExprLeft(rightId);
    const rDen = dae.getExprRight(rightId);
    const newNum = mulWithSimplification(lNum, rNum, dae);
    const rDenKind = dae.getExprKind(rDen);
    let newDen: number;
    if (
      rDenKind === ExprKind.Call ||
      rDenKind === ExprKind.Name ||
      (rDenKind === ExprKind.Binary && dae.getExprKind(lDen) === ExprKind.Name)
    ) {
      newDen = mulWithSimplification(rDen, lDen, dae);
    } else {
      newDen = mulWithSimplification(lDen, rDen, dae);
    }
    return dae.addBinaryExpr(BinOp.Div, newNum, newDen);
  }
  if (lIsDiv) {
    const lNum = dae.getExprLeft(leftId);
    const lDen = dae.getExprRight(leftId);
    const newNum = mulWithSimplification(lNum, rightId, dae);
    return dae.addBinaryExpr(BinOp.Div, newNum, lDen);
  }
  if (rIsDiv) {
    const rNum = dae.getExprLeft(rightId);
    const rDen = dae.getExprRight(rightId);
    const newNum = mulWithSimplification(leftId, rNum, dae);
    return dae.addBinaryExpr(BinOp.Div, newNum, rDen);
  }

  const isNegNode = (id: number): boolean =>
    dae.getExprKind(id) === ExprKind.Negate ||
    (dae.getExprKind(id) === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate);
  if (isNegNode(leftId) && rK === ExprKind.Binary && dae.getExprData1(rightId) === BinOp.Pow) {
    const innerL = dae.getExprLeft(leftId);
    if (dae.getExprKind(innerL) === ExprKind.Binary && dae.getExprData1(innerL) === BinOp.Pow) {
      const lBase = dae.getExprLeft(innerL);
      const lExp = dae.getExprRight(innerL);
      const rBase = dae.getExprLeft(rightId);
      const rExp = dae.getExprRight(rightId);
      if (
        exprsEqual(lExp, rExp, dae) &&
        dae.getExprKind(lBase) === ExprKind.Binary &&
        dae.getExprData1(lBase) === BinOp.Div
      ) {
        const divNum = dae.getExprLeft(lBase);
        const divDen = dae.getExprRight(lBase);
        const isOne =
          (dae.getExprKind(divNum) === ExprKind.RealLiteral && dae.getExprRealValue(divNum) === 1.0) ||
          (dae.getExprKind(divNum) === ExprKind.IntLiteral && dae.getExprData1(divNum) === 1);
        if (isOne) {
          const combinedBase = dae.addBinaryExpr(BinOp.Div, rBase, divDen);
          const combinedPow = dae.addBinaryExpr(BinOp.Pow, combinedBase, lExp);
          return dae.addUnaryExpr(UnaryOp.Negate, combinedPow);
        }
      }
    }
  }

  const lReal = isRealExpr(leftId, dae);
  const rReal = isRealExpr(rightId, dae);
  if (lReal && !rReal) {
    rightId = castToRealExpr(rightId, dae);
  } else if (!lReal && rReal) {
    leftId = castToRealExpr(leftId, dae);
  }

  const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
  if (isOldFrontend && exprsEqual(leftId, rightId, dae)) {
    const isReal = isRealExpr(leftId, dae);
    return dae.addBinaryExpr(BinOp.Pow, leftId, isReal ? dae.addRealLiteral(2.0) : dae.addIntLiteral(2));
  }
  const curLK = dae.getExprKind(leftId);
  const curRK = dae.getExprKind(rightId);
  if (curLK === ExprKind.RealLiteral && isNegNode(rightId)) {
    const negVal = -dae.getExprRealValue(leftId);
    return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(negVal), dae.getExprLeft(rightId));
  }
  if (
    curLK === ExprKind.RealLiteral &&
    curRK === ExprKind.Binary &&
    dae.getExprData1(rightId) === BinOp.Mul &&
    isNegNode(dae.getExprLeft(rightId))
  ) {
    const negVal = -dae.getExprRealValue(leftId);
    const innerLeft = dae.getExprLeft(dae.getExprLeft(rightId));
    const innerRight = dae.getExprRight(rightId);
    return dae.addBinaryExpr(
      BinOp.Mul,
      dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(negVal), innerLeft),
      innerRight,
    );
  }
  const extractLeadingLit = (id: number): { litId: number; restId: number } | null => {
    if (id < 0 || dae.getExprKind(id) !== ExprKind.Binary || dae.getExprData1(id) !== BinOp.Mul) {
      return null;
    }
    const l = dae.getExprLeft(id);
    const r = dae.getExprRight(id);
    const lKind = dae.getExprKind(l);
    if (lKind === ExprKind.RealLiteral || lKind === ExprKind.IntLiteral) {
      return { litId: l, restId: r };
    }
    const sub = extractLeadingLit(l);
    if (sub) {
      return { litId: sub.litId, restId: dae.addBinaryExpr(BinOp.Mul, sub.restId, r) };
    }
    return null;
  };
  const isCurLLit = curLK === ExprKind.RealLiteral || curLK === ExprKind.IntLiteral;
  const isCurRLit = curRK === ExprKind.RealLiteral || curRK === ExprKind.IntLiteral;
  if (isCurLLit) {
    const subR = extractLeadingLit(rightId);
    if (subR) {
      return dae.addBinaryExpr(BinOp.Mul, mulWithSimplification(leftId, subR.litId, dae), subR.restId);
    }
  } else if (isCurRLit) {
    const subL = extractLeadingLit(leftId);
    if (subL) {
      return dae.addBinaryExpr(BinOp.Mul, mulWithSimplification(subL.litId, rightId, dae), subL.restId);
    }
  } else if (isOldFrontend) {
    const subR = extractLeadingLit(rightId);
    if (subR) {
      return dae.addBinaryExpr(BinOp.Mul, subR.litId, dae.addBinaryExpr(BinOp.Mul, leftId, subR.restId));
    }
  }
  if (
    (curRK === ExprKind.RealLiteral || curRK === ExprKind.IntLiteral) &&
    curLK !== ExprKind.RealLiteral &&
    curLK !== ExprKind.IntLiteral
  ) {
    return dae.addBinaryExpr(BinOp.Mul, rightId, leftId);
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

  if (
    (t2K === ExprKind.Negate || (t2K === ExprKind.Unary && (dae.getExprData1(term2) as UnaryOp) === UnaryOp.Negate)) &&
    dae.getExprKind(dae.getExprLeft(term2)) === ExprKind.Binary &&
    dae.getExprData1(dae.getExprLeft(term2)) === BinOp.Pow
  ) {
    return dae.addBinaryExpr(BinOp.Sub, term1, dae.getExprLeft(term2));
  }

  if (
    Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
    (t1K === ExprKind.Negate || (t1K === ExprKind.Unary && (dae.getExprData1(term1) as UnaryOp) === UnaryOp.Negate)) &&
    t2K !== ExprKind.Negate &&
    !(t2K === ExprKind.Unary && (dae.getExprData1(term2) as UnaryOp) === UnaryOp.Negate)
  ) {
    return dae.addBinaryExpr(BinOp.Sub, term2, dae.getExprLeft(term1));
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
      setExprArrayShape(dae, res, [0]);
      return res;
    }
    if (K === 0) {
      const zeroLit = dae.addRealLiteral(0.0);
      const resCols: number[] = [];
      for (let j = 0; j < M; j++) resCols.push(zeroLit);
      const res = dae.addArrayCtorExpr(resCols);
      setExprArrayShape(dae, res, [M]);
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
      setExprArrayShape(dae, res, [M]);
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
      setExprArrayShape(dae, res, [0, M]);
      return res;
    }
    if (M === 0) {
      const resRows: number[] = [];
      for (let i = 0; i < N; i++) {
        resRows.push(dae.addArrayCtorExpr([]));
      }
      const res = dae.addArrayCtorExpr(resRows);
      setExprArrayShape(dae, res, [N, 0]);
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
      setExprArrayShape(dae, res, [N, M]);
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
      setExprArrayShape(dae, res, [N, M]);
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
      setExprArrayShape(dae, res, [0]);
      return res;
    }
    if (K === 0) {
      const zeroLit = dae.addRealLiteral(0.0);
      const resElems: number[] = [];
      for (let i = 0; i < N; i++) resElems.push(zeroLit);
      const res = dae.addArrayCtorExpr(resElems);
      setExprArrayShape(dae, res, [N]);
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
    setExprArrayShape(dae, res, [N]);
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
    if (leftKind === ExprKind.StringLiteral && rightKind === ExprKind.StringLiteral) {
      const s1 = dae.interner.resolve(dae.getExprData1(leftId)) ?? "";
      const s2 = dae.interner.resolve(dae.getExprData1(rightId)) ?? "";
      return dae.addStringLiteral(s1 + s2);
    }
    if (leftKind === ExprKind.RealLiteral && dae.getExprRealValue(leftId) === 0) return rightId;
    if (leftKind === ExprKind.IntLiteral && dae.getExprData1(leftId) === 0) return rightId;
    if (rightKind === ExprKind.RealLiteral && dae.getExprRealValue(rightId) === 0) return leftId;
    if (rightKind === ExprKind.IntLiteral && dae.getExprData1(rightId) === 0) return leftId;
    if (
      rightKind === ExprKind.Negate ||
      (rightKind === ExprKind.Unary && (dae.getExprData1(rightId) as UnaryOp) === UnaryOp.Negate)
    ) {
      return dae.addBinaryExpr(BinOp.Sub, leftId, dae.getExprLeft(rightId));
    }
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
    const rDims = getExprDims(rightId, dae, flattener?.db);
    if (!rDims || rDims.length === 0) {
      const lElems = getArrayCtorElements(leftId, dae);
      const newElems = lElems.map((e) => broadcastElemBinOp(elemOp, baseOp, e, rightId, dae, flattener, false));
      return dae.addArrayCtorExpr(newElems);
    }
  } else if (lK !== ExprKind.ArrayCtor && rK === ExprKind.ArrayCtor) {
    const lDims = getExprDims(leftId, dae, flattener?.db);
    if (!lDims || lDims.length === 0) {
      const rElems = getArrayCtorElements(rightId, dae);
      const isStringOp = lK === ExprKind.StringLiteral || inferArenaExprVarType(dae, leftId) === VarType.String;
      if (!isStringOp && flattener?.options?.omcCompatibility && (baseOp === BinOp.Add || baseOp === BinOp.Mul)) {
        const newElems = rElems.map((e) => broadcastElemBinOp(elemOp, baseOp, e, leftId, dae, flattener, false));
        return dae.addArrayCtorExpr(newElems);
      } else {
        const newElems = rElems.map((e) => broadcastElemBinOp(elemOp, baseOp, leftId, e, dae, flattener, false));
        return dae.addArrayCtorExpr(newElems);
      }
    }
  }

  if (baseOp === BinOp.Add && lK === ExprKind.StringLiteral && rK === ExprKind.StringLiteral) {
    const s1 = dae.interner.resolve(dae.getExprData1(leftId)) ?? "";
    const s2 = dae.interner.resolve(dae.getExprData1(rightId)) ?? "";
    return dae.addStringLiteral(s1 + s2);
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
  const useElemOp =
    isTopLevel && (lIsArr || rIsArr) && !(lIsArr && rIsArr && (baseOp === BinOp.Add || baseOp === BinOp.Sub));
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

export function areExpressionsEqual(dae: DAEBuilder, id1: number, id2: number, allowNumericCoercion = true): boolean {
  if (id1 === id2) return true;
  if (id1 < 0 || id2 < 0) return false;
  const k1 = dae.getExprKind(id1);
  const k2 = dae.getExprKind(id2);
  if (k1 !== k2) {
    if (
      allowNumericCoercion &&
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
    case ExprKind.Name: {
      const d1 = dae.getExprData1(id1);
      const d2 = dae.getExprData1(id2);
      if (d1 === d2) return true;
      return dae.interner.resolve(d1) === dae.interner.resolve(d2);
    }
    case ExprKind.Unary:
    case ExprKind.Negate:
    case ExprKind.Der:
    case ExprKind.Pre:
      return (
        dae.getExprData1(id1) === dae.getExprData1(id2) &&
        areExpressionsEqual(dae, dae.getExprLeft(id1), dae.getExprLeft(id2), allowNumericCoercion)
      );
    case ExprKind.Binary:
      return (
        dae.getExprData1(id1) === dae.getExprData1(id2) &&
        areExpressionsEqual(dae, dae.getExprLeft(id1), dae.getExprLeft(id2), allowNumericCoercion) &&
        areExpressionsEqual(dae, dae.getExprRight(id1), dae.getExprRight(id2), allowNumericCoercion)
      );
    case ExprKind.IfElse:
    case ExprKind.Range:
      return (
        areExpressionsEqual(dae, dae.getExprData1(id1), dae.getExprData1(id2), allowNumericCoercion) &&
        areExpressionsEqual(dae, dae.getExprLeft(id1), dae.getExprLeft(id2), allowNumericCoercion) &&
        areExpressionsEqual(dae, dae.getExprRight(id1), dae.getExprRight(id2), allowNumericCoercion)
      );
    case ExprKind.Subscript: {
      const d1_1 = dae.getExprData1(id1);
      const d1_2 = dae.getExprData1(id2);
      const base1 = d1_1 !== 0 ? d1_1 : dae.getExprLeft(id1);
      const base2 = d1_2 !== 0 ? d1_2 : dae.getExprLeft(id2);
      if (!areExpressionsEqual(dae, base1, base2, allowNumericCoercion)) return false;
      const cnt1 = d1_1 !== 0 ? dae.getExprRight(id1) : 1;
      const cnt2 = d1_2 !== 0 ? dae.getExprRight(id2) : 1;
      if (cnt1 !== cnt2) return false;
      if (d1_1 !== 0 && d1_2 !== 0) {
        for (let i = 0; i < cnt1; i++) {
          const s1 = i === 0 ? dae.getExprLeft(id1) : dae.getExprLeft(id1 + i);
          const s2 = i === 0 ? dae.getExprLeft(id2) : dae.getExprLeft(id2 + i);
          if (!areExpressionsEqual(dae, s1, s2, allowNumericCoercion)) return false;
        }
      } else {
        const s1 = d1_1 !== 0 ? dae.getExprLeft(id1) : dae.getExprRight(id1);
        const s2 = d1_2 !== 0 ? dae.getExprLeft(id2) : dae.getExprRight(id2);
        if (!areExpressionsEqual(dae, s1, s2, allowNumericCoercion)) return false;
      }
      return true;
    }
    case ExprKind.Call: {
      const d1 = dae.getExprData1(id1);
      const d2 = dae.getExprData1(id2);
      if (d1 !== d2 && dae.interner.resolve(d1) !== dae.interner.resolve(d2)) return false;
      if (dae.getExprRight(id1) !== dae.getExprRight(id2)) return false;
      const cnt = dae.getExprRight(id1);
      for (let i = 0; i < cnt; i++) {
        const a1 = i === 0 ? dae.getExprLeft(id1) : dae.getExprLeft(id1 + i);
        const a2 = i === 0 ? dae.getExprLeft(id2) : dae.getExprLeft(id2 + i);
        if (!areExpressionsEqual(dae, a1, a2, allowNumericCoercion)) return false;
      }
      return true;
    }
    case ExprKind.ArrayCtor: {
      if (dae.getExprData1(id1) !== dae.getExprData1(id2)) return false;
      const cnt = dae.getExprData1(id1);
      for (let i = 0; i < cnt; i++) {
        const a1 = i === 0 ? dae.getExprLeft(id1) : dae.getExprLeft(id1 + i);
        const a2 = i === 0 ? dae.getExprLeft(id2) : dae.getExprLeft(id2 + i);
        if (!areExpressionsEqual(dae, a1, a2, allowNumericCoercion)) return false;
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
): {
  name: string;
  symId: SymbolId;
  isArray: boolean;
  arrayDim?: number | undefined;
  arrayDims?: number[] | undefined;
} | null {
  if (!db) return null;
  const extractDims = (rawDims: any): number[] | undefined => {
    if (!Array.isArray(rawDims) || rawDims.length === 0) return undefined;
    return rawDims.map((d: any) => (typeof d === "number" ? d : typeof d?.value === "number" ? d.value : 0));
  };
  const currentPrefix = getFlatteningState(dae, flattener).currentPrefix ?? flattener?.currentPrefix;
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
      const arrayDims = isArray ? [...shape] : undefined;
      const arrayDim = isArray ? shape[0] : 0;
      return { name: classSym.name, symId: classSym.id, isArray, arrayDim, arrayDims };
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
        const arrayDims = extractDims(compInst?.arrayDimensions);
        const isArray = Boolean((arrayDims && arrayDims.length > 0) || (compSym.metadata as any)?.isArray);
        const arrayDim = arrayDims && arrayDims.length > 0 ? arrayDims[0] : 0;
        return { name: classSym.name, symId: classSym.id, isArray, arrayDim, arrayDims };
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
        const arrayDims = extractDims(compInst?.arrayDimensions);
        const isArray = Boolean(
          (arrayDims && arrayDims.length > 0) || (compSym.metadata as any)?.isArray || compSym.name.includes("["),
        );
        const arrayDim = arrayDims && arrayDims.length > 0 ? arrayDims[0] : 0;
        return { name: classSym.name, symId: classSym.id, isArray, arrayDim, arrayDims };
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
): {
  name: string;
  symId: SymbolId;
  isArray: boolean;
  arrayDim?: number | undefined;
  arrayDims?: number[] | undefined;
} | null {
  if (!db) return null;
  if (exprId >= 0) {
    const kind = dae.getExprKind(exprId);
    if (
      kind === ExprKind.Binary ||
      kind === ExprKind.Der ||
      kind === ExprKind.RealLiteral ||
      kind === ExprKind.IntLiteral ||
      kind === ExprKind.BoolLiteral ||
      kind === ExprKind.StringLiteral
    ) {
      return null;
    }
  }

  const findCompType = (baseName: string) => findOperatorRecordComponentType(baseName, dae, db, flattener);

  const resolvePath = (
    pathStr: string,
  ): {
    name: string;
    symId: number;
    isArray: boolean;
    arrayDim?: number | undefined;
    arrayDims?: number[] | undefined;
  } | null => {
    if (!pathStr || !/^[a-zA-Z_]\w*(?:\s*\[[^\]]*\]|\.[a-zA-Z_]\w*)*$/.test(pathStr)) return null;
    const currentPrefix = getFlatteningState(dae, flattener).currentPrefix ?? flattener?.currentPrefix;
    let fullIdx = dae.getVarIdxByName(pathStr);
    if (fullIdx < 0 && currentPrefix) {
      fullIdx = dae.getVarIdxByName(`${currentPrefix}.${pathStr}`);
    }
    if (fullIdx >= 0 && !dae.getVarCustomType(fullIdx)) {
      return null;
    }
    const parts = pathStr
      .split(".")
      .map((p) => p.split("[")[0]!.trim())
      .filter(Boolean);
    if (parts.length === 0) return null;
    let curr: {
      name: string;
      symId: number;
      isArray: boolean;
      arrayDim?: number | undefined;
      arrayDims?: number[] | undefined;
    } | null = findCompType(parts[0]!);
    if (!curr) return null;
    for (let i = 1; i < parts.length; i++) {
      const fieldName = parts[i]!;
      const children: any[] = db.childrenOf(curr.symId).filter((c: any) => c.kind === "Component");
      const fieldSym: any = children.find((c: any) => c.name === fieldName);
      if (!fieldSym) return null;
      const compInst: any = db.query<any>("componentInstance", fieldSym.id);
      const typeSpec: string | null =
        compInst?.typeSpecifier ??
        (fieldSym.metadata as any)?.typeSpecifier ??
        db.query<string | null>("typeSpecifier", fieldSym.id);
      if (!typeSpec) return null;
      const cleanType: string = typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec;
      const classSym = db.byName(cleanType).find((e: any) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
      if (!classSym) return null;
      const rawDims: any = compInst?.arrayDimensions;
      const arrayDims: number[] | undefined =
        Array.isArray(rawDims) && rawDims.length > 0
          ? rawDims.map((d: any) => (typeof d === "number" ? d : typeof d?.value === "number" ? d.value : 0))
          : undefined;
      const isArray: boolean = Boolean(
        (arrayDims && arrayDims.length > 0) || (fieldSym.metadata as any)?.isArray || fieldSym.name.includes("["),
      );
      const arrayDim: number | undefined = arrayDims && arrayDims.length > 0 ? arrayDims[0] : 0;
      curr = { name: classSym.name, symId: classSym.id, isArray, arrayDim, arrayDims };
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
        arrayDims: isSubscripted ? undefined : res.arrayDims,
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
            arrayDims: isSubscripted ? undefined : res.arrayDims,
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
  _recName: string,
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
    const rootId = (flattener as any).currentRootClassId ?? getFlatteningState(dae, flattener).currentClassId;
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
    rec: { name: string; symId: SymbolId; isArray: boolean; arrayDims?: number[] | undefined } | null,
    argId: number,
  ): { matched: boolean; argId: number } => {
    if (param.isArray) {
      if (rec?.isArray && (!rec.arrayDims || rec.arrayDims.length <= 1)) return { matched: true, argId };
      return { matched: false, argId };
    }
    if (rec) {
      if (rec.isArray) return { matched: false, argId };
      const cleanTypeSpec = param.typeSpec?.replace(/^\./, "");
      if (cleanTypeSpec === rec.name || cleanTypeSpec?.split(".").pop() === rec.name) {
        return { matched: true, argId };
      }
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
    const cleanTargetSpec = param.typeSpec?.replace(/^\./, "") ?? "";
    const targetSym = db
      .byName(cleanTargetSpec)
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
      const lDirect = leftRec
        ? p0.typeSpec?.replace(/^\./, "") === leftRec.name
        : p0.typeSpec === "Real" || p0.typeSpec === "Integer";
      const rDirect = rightRec
        ? p1.typeSpec?.replace(/^\./, "") === rightRec.name
        : p1.typeSpec === "Real" || p1.typeSpec === "Integer";
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
        startOffset: diagNode?.startIndex ?? diagNode?.startOffset,
        endOffset: diagNode?.endIndex ?? diagNode?.endOffset,
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
    const scalarLeftRec = leftRec ? { ...leftRec, isArray: false, arrayDims: undefined } : null;
    const scalarRightRec = rightRec ? { ...rightRec, isArray: false, arrayDims: undefined } : null;

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

    if (
      cleanOp === "*" &&
      leftRec?.arrayDims?.length === 2 &&
      rightRec?.arrayDims?.length === 2 &&
      leftRec.arrayDims[1] === rightRec.arrayDims[0] &&
      leftRec.arrayDims[0]! > 0 &&
      leftRec.arrayDims[1]! > 0 &&
      rightRec.arrayDims[1]! > 0 &&
      bestScalarOverload
    ) {
      const M = leftRec.arrayDims[0]!;
      const K = leftRec.arrayDims[1]!;
      const N = rightRec.arrayDims[1]!;
      const addCandidates: any[] = ops ? [...(ops.get("'+'") ?? []), ...(ops.get("+") ?? [])] : [];
      const scalarAddOverload = addCandidates.find(
        (cand) =>
          cand.inputParams?.length === 2 &&
          !cand.inputParams[0].isArray &&
          !cand.inputParams[1].isArray &&
          checkParamMatch(cand.inputParams[0], scalarLeftRec, leftId).matched &&
          checkParamMatch(cand.inputParams[1], scalarRightRec, rightId).matched,
      );
      if (scalarAddOverload) {
        flattener?.usedOperatorFunctions?.set(bestScalarOverload.qualifiedName, bestScalarOverload.funcSymId);
        flattener?.usedOperatorFunctions?.set(scalarAddOverload.qualifiedName, scalarAddOverload.funcSymId);
        const leftBase = leftNode?.text?.trim() ?? "";
        const rightBase = rightNode?.text?.trim() ?? "";
        const rows: number[] = [];
        for (let i = 1; i <= M; i++) {
          const rowElems: number[] = [];
          for (let j = 1; j <= N; j++) {
            let acc = -1;
            for (let k = 1; k <= K; k++) {
              const lElem = dae.addExpression(ExprKind.Name, dae.interner.intern(`${leftBase}[${i},${k}]`));
              const rElem = dae.addExpression(ExprKind.Name, dae.interner.intern(`${rightBase}[${k},${j}]`));
              const term = dae.addCallExpr(bestScalarOverload.qualifiedName, [lElem, rElem]);
              acc = k === 1 ? term : dae.addCallExpr(scalarAddOverload.qualifiedName, [term, acc]);
            }
            rowElems.push(acc);
          }
          rows.push(dae.addArrayCtorExpr(rowElems));
        }
        const matExprId = dae.addArrayCtorExpr(rows);
        if (dae.extensionMetadata?.["isOldFrontend"]) {
          let compClauseNode: any = leftNode;
          while (compClauseNode && compClauseNode.type !== "component_clause") {
            compClauseNode = compClauseNode.parent;
          }
          let compName = flattener?.currentBindingCompName;
          if (!compName && compClauseNode?.text) {
            const m = /^\s*(?:[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*\s+)+([a-zA-Z_]\w*)/.exec(compClauseNode.text);
            if (m?.[1]) compName = m[1];
          }
          if (compClauseNode && compName) {
            const printer = new ArenaDAEPrinter(new StringWriter(), dae, true);
            const modStr = printer.printExprToString(matExprId);
            const fields = db.childrenOf(recSym.symId).filter((c: any) => c.kind === "Component");
            const fieldLines = fields.map((f: any) => {
              const fType =
                db.query<string | null>("typeSpecifier", f.id) ?? (f.metadata as any)?.typeSpecifier ?? "Real";
              return `  ${fType} ${f.name};`;
            });
            const recTypeBlock = `record ${recSym.name}\n${fieldLines.join("\n")}\nend ${recSym.name};[${M}, ${N}]`;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.code,
              message: `Type mismatch in modifier of component ${compName}, declared type ${recSym.name}[${M},${N}], got modifier ${modStr} of type ${recTypeBlock}.`,
              range: {
                startOffset: compClauseNode.startIndex ?? compClauseNode.startOffset,
                endOffset: compClauseNode.endIndex ?? compClauseNode.endOffset,
                startPosition: compClauseNode.startPosition,
                endPosition: compClauseNode.endPosition,
              },
            });
            return -1;
          }
        }
        return matExprId;
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
      startOffset: diagNode?.startIndex ?? diagNode?.startOffset,
      endOffset: diagNode?.endIndex ?? diagNode?.endOffset,
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
    if (
      binOp === BinOp.Sub &&
      Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
      !(
        dae.getExprKind(dae.getExprLeft(operandId)) === ExprKind.Binary &&
        dae.getExprData1(dae.getExprLeft(operandId)) === BinOp.Div
      )
    ) {
      const leftId = dae.getExprLeft(operandId);
      const rightId = dae.getExprRight(operandId);
      return dae.addBinaryExpr(BinOp.Sub, rightId, leftId);
    }
  }
  return dae.addExpression(ExprKind.Negate, 0, operandId);
}
