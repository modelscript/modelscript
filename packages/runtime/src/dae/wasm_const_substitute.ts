// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Algebraic & conditional expression simplification and constant substitution
 * over {@link DAEBuilder} linear-memory arenas.
 */

import { evaluateConstantArenaExpression } from "./wasm_const_eval.js";
import { BinOp, Causality, DAEBuilder, ExprKind, UnaryOp, Variability, VarType } from "./wasm_dae.js";
import {
  type ArenaConstantValue,
  type ArenaFoldParamLookup,
  type DAEBuilderFoldExtensions,
  arrayValueToArenaExpr,
  isArenaComplexValue,
  isLiteralMinusOne,
  isLiteralOne,
  isLiteralZero,
  isRealTypedArenaExpr,
} from "./wasm_fold_helpers.js";

/**
 * Simplifies an expression by resolving IfElse branches whose condition evaluates to constant.
 */
export function simplifyArenaIfElse(
  arena: DAEBuilder,
  exprId: number,
  paramMap?: ArenaFoldParamLookup,
  nameToIdx?: Map<string, number>,
  onlyConstants = false,
  allowFinalBoolParams = false,
): number {
  if (exprId < 0 || exprId >= arena.exprCount) return exprId;
  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.IfElse: {
      const condId = arena.getExprData1(exprId);
      let condVal = evaluateConstantArenaExpression(
        arena,
        condId,
        paramMap,
        nameToIdx,
        0,
        undefined,
        undefined,
        onlyConstants,
      );
      if (
        condVal === null &&
        allowFinalBoolParams &&
        onlyConstants &&
        condId >= 0 &&
        arena.getExprKind(condId) === ExprKind.Name
      ) {
        const cName = arena.interner.resolve(arena.getExprData1(condId));
        if (cName) {
          const allMap = paramMap?._allParamMap;
          const vIdx = nameToIdx ? nameToIdx.get(cName) : arena.getVarIdxByName(cName);
          if (
            vIdx !== undefined &&
            vIdx >= 0 &&
            arena.getVarType(vIdx) === VarType.Boolean &&
            arena.getVarVariability(vIdx) === Variability.Parameter &&
            arena.isVarFinal(vIdx)
          ) {
            if (allMap && allMap.has(cName)) {
              condVal = Boolean(allMap.get(cName));
            } else if (arena.isVarFixed(vIdx)) {
              condVal = arena.getVarStartValue(vIdx) !== 0;
            }
          }
        }
      }
      if (condVal !== null) {
        const isTrue = typeof condVal === "boolean" ? condVal : condVal !== 0;
        const branchId = isTrue ? arena.getExprLeft(exprId) : arena.getExprRight(exprId);
        return simplifyArenaIfElse(arena, branchId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      }
      const newCond = simplifyArenaIfElse(arena, condId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      const leftId = arena.getExprLeft(exprId);
      const rightId = arena.getExprRight(exprId);
      const newLeft = simplifyArenaIfElse(arena, leftId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      const newRight = simplifyArenaIfElse(arena, rightId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      if (newCond !== condId || newLeft !== leftId || newRight !== rightId) {
        return arena.addIfElseExpr(newCond, newLeft, newRight);
      }
      return exprId;
    }
    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId);
      const leftId = arena.getExprLeft(exprId);
      const newLeft = simplifyArenaIfElse(arena, leftId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      return newLeft !== leftId ? arena.addUnaryExpr(op, newLeft) : exprId;
    }
    case ExprKind.Negate: {
      const leftId = arena.getExprLeft(exprId);
      const newLeft = simplifyArenaIfElse(arena, leftId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      return newLeft !== leftId ? arena.addExpression(ExprKind.Negate, 0, newLeft) : exprId;
    }
    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId);
      const leftId = arena.getExprLeft(exprId);
      const rightId = arena.getExprRight(exprId);
      const newLeft = simplifyArenaIfElse(arena, leftId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      const newRight = simplifyArenaIfElse(arena, rightId, paramMap, nameToIdx, onlyConstants, allowFinalBoolParams);
      return newLeft !== leftId || newRight !== rightId ? arena.addBinaryExpr(op, newLeft, newRight) : exprId;
    }
    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const fnName = arena.interner.resolve(funcNameId) || "";
      const isComplexCall =
        allowFinalBoolParams || fnName === "Complex" || fnName.startsWith("Complex.") || fnName.includes(".Complex");
      const argCount = arena.getExprRight(exprId);
      let changed = false;
      const args: number[] = [];
      for (let i = 0; i < argCount; i++) {
        const argId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const newArg = simplifyArenaIfElse(arena, argId, paramMap, nameToIdx, onlyConstants, isComplexCall);
        if (newArg !== argId) changed = true;
        args.push(newArg);
      }
      if (changed) {
        return arena.addCallExpr(fnName, args);
      }
      return exprId;
    }
    case ExprKind.Subscript: {
      const baseId = arena.getExprData1(exprId);
      const subCount = arena.getExprRight(exprId);
      const newBase = simplifyArenaIfElse(arena, baseId, paramMap, nameToIdx, onlyConstants);
      let changed = newBase !== baseId;
      const subs: number[] = [];
      for (let i = 0; i < subCount; i++) {
        const subId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const newSub = simplifyArenaIfElse(arena, subId, paramMap, nameToIdx, onlyConstants);
        if (newSub !== subId) changed = true;
        subs.push(newSub);
      }
      return changed ? arena.addSubscriptExpr(newBase, subs) : exprId;
    }
    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      const redirect = arena.getExprRight(exprId);
      const baseId = redirect >= 0 ? redirect : exprId;
      let changed = false;
      const elems: number[] = [];
      for (let i = 0; i < count; i++) {
        const elemId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(baseId + i);
        const newElem = simplifyArenaIfElse(arena, elemId, paramMap, nameToIdx, onlyConstants);
        if (newElem !== elemId) changed = true;
        elems.push(newElem);
      }
      return changed ? arena.addArrayCtorExpr(elems) : exprId;
    }
    default:
      return exprId;
  }
}

/**
 * Recursively substitute known constant variables in an expression with their literal values.
 */
const subConstRecordPrefixCache = new WeakMap<ArenaFoldParamLookup, Map<string, number[]>>();

function getSubRecordPrefixMap(nameToIdx: Map<string, number>, constMap: ArenaFoldParamLookup): Map<string, number[]> {
  let cached = subConstRecordPrefixCache.get(constMap);
  if (cached) return cached;
  cached = new Map<string, number[]>();
  for (const [vName, idx] of nameToIdx) {
    let dot = vName.indexOf(".");
    while (dot > 0) {
      const pfx = vName.slice(0, dot);
      if (!nameToIdx.has(pfx)) {
        let arr = cached.get(pfx);
        if (!arr) {
          arr = [];
          cached.set(pfx, arr);
        }
        arr.push(idx);
      }
      dot = vName.indexOf(".", dot + 1);
    }
  }
  subConstRecordPrefixCache.set(constMap, cached);
  return cached;
}

function tryInlineEvaluatedRecordCallArg(
  arena: DAEBuilder,
  recName: string,
  expectedTypeName: string | undefined,
  constMap: ArenaFoldParamLookup,
  nameToIdx: Map<string, number>,
): number {
  const childIndices = getSubRecordPrefixMap(nameToIdx, constMap).get(recName);
  if (!childIndices || childIndices.length === 0) return -1;
  const dotPrefix = `${recName}.`;
  const directFieldVals = new Map<string, { vIdx: number; val: ArenaConstantValue | undefined }>();
  for (const cIdx of childIndices) {
    if (arena.isVarRemoved(cIdx)) continue;
    const vn = arena.getVarName(cIdx);
    const vb = arena.getVarVariability(cIdx);
    if (vb !== Variability.Constant && vb !== Variability.Parameter) return -1;
    if (!constMap.has(vn)) return -1;
    const rel = vn.slice(dotPrefix.length);
    if (rel.includes(".") || rel.includes("[")) return -1;
    directFieldVals.set(rel, { vIdx: cIdx, val: constMap.get(vn) });
  }
  if (directFieldVals.size === 0) return -1;

  const isAutoCtor = (fn: DAEBuilder): boolean =>
    Boolean(fn.description?.startsWith("Automatically generated record constructor"));

  let matchedCtor: DAEBuilder | undefined;
  let matchedInputs: string[] | undefined;

  const checkCtorMatches = (fn: DAEBuilder): string[] | null => {
    const constSet = (fn as DAEBuilder & DAEBuilderFoldExtensions)._recordConstVarIndices;
    const inputs: string[] = [];
    for (let vi = 0; vi < fn.varCount; vi++) {
      if (fn.isVarRemoved(vi)) continue;
      const vName = fn.getVarName(vi);
      if (vName === "res") continue;
      if (fn.getVarCausality(vi) === Causality.Input || Boolean(constSet?.has(vi))) {
        inputs.push(vName);
      }
    }
    if (inputs.length !== directFieldVals.size) return null;
    for (const inp of inputs) {
      if (!directFieldVals.has(inp)) return null;
    }
    return inputs;
  };

  const preferredTypeName = (arena as DAEBuilder & DAEBuilderFoldExtensions).foldedRecordTypes?.get(recName);
  for (const candType of [preferredTypeName, expectedTypeName]) {
    if (!candType) continue;
    const directFn = arena.functions.get(candType);
    if (directFn && isAutoCtor(directFn)) {
      const m = checkCtorMatches(directFn);
      if (m) {
        matchedCtor = directFn;
        matchedInputs = m;
        break;
      }
    }
    for (const fn of new Set(arena.functions.values())) {
      if (!isAutoCtor(fn) || fn.name.includes("$")) continue;
      if (fn.name === candType || fn.name.endsWith(`.${candType}`)) {
        const m = checkCtorMatches(fn);
        if (m) {
          matchedCtor = fn;
          matchedInputs = m;
          break;
        }
      }
    }
    if (matchedCtor) break;
  }
  if (!matchedCtor) {
    for (const fn of new Set(arena.functions.values())) {
      if (!isAutoCtor(fn)) continue;
      if (fn.name.includes("$")) continue;
      const m = checkCtorMatches(fn);
      if (m) {
        matchedCtor = fn;
        matchedInputs = m;
        break;
      }
    }
  }
  if (!matchedCtor || !matchedInputs) return -1;

  const argExprIds: number[] = [];
  for (const inp of matchedInputs) {
    const entry = directFieldVals.get(inp)!;
    const vt = arena.getVarType(entry.vIdx);
    const v = entry.val;
    if (typeof v === "boolean") {
      argExprIds.push(arena.addBoolLiteral(v));
    } else if (typeof v === "number" && Number.isFinite(v)) {
      if (vt === VarType.Integer) argExprIds.push(arena.addIntLiteral(Math.trunc(v)));
      else if (vt === VarType.Boolean) argExprIds.push(arena.addBoolLiteral(v !== 0));
      else if (vt === VarType.Enumeration) return -1;
      else argExprIds.push(arena.addRealLiteral(v));
    } else if (typeof v === "string") {
      argExprIds.push(arena.addStringLiteral(v));
    } else {
      return -1;
    }
  }
  return arena.addCallExpr(matchedCtor.name, argExprIds);
}

export function substituteArenaConstants(
  arena: DAEBuilder,
  exprId: number,
  constMap: ArenaFoldParamLookup,
  nameToIdx?: Map<string, number>,
): number {
  if (exprId < 0 || exprId >= arena.exprCount) return exprId;
  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      const varName = arena.interner.resolve(nameId);
      if ((constMap as { _shadowed?: ReadonlySet<string> } | undefined)?._shadowed?.has(varName)) {
        return exprId;
      }
      if (constMap.has(varName)) {
        const val = constMap.get(varName)!;
        const varIdx = nameToIdx?.get(varName);
        const varType = varIdx !== undefined ? arena.getVarType(varIdx) : VarType.Real;
        if (varType === VarType.Integer && typeof val === "number") {
          return arena.addIntLiteral(Math.trunc(val));
        } else if (varType === VarType.Boolean) {
          return arena.addBoolLiteral(Boolean(val));
        } else if (varType === VarType.Real && typeof val === "number") {
          return arena.addRealLiteral(val);
        } else if (varType === VarType.String && typeof val === "string") {
          return arena.addStringLiteral(val);
        }
        return exprId;
      }
      return exprId;
    }
    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId);
      const left = substituteArenaConstants(arena, arena.getExprLeft(exprId), constMap, nameToIdx);
      const right = substituteArenaConstants(arena, arena.getExprRight(exprId), constMap, nameToIdx);
      const newBinId =
        left !== arena.getExprLeft(exprId) || right !== arena.getExprRight(exprId)
          ? arena.addBinaryExpr(op, left, right)
          : exprId;
      if (op !== BinOp.Colon) {
        const lKind = left >= 0 ? arena.getExprKind(left) : -1;
        const rKind = right >= 0 ? arena.getExprKind(right) : -1;
        const canFoldBin =
          lKind !== ExprKind.Name &&
          lKind !== ExprKind.Der &&
          lKind !== ExprKind.Pre &&
          lKind !== ExprKind.Binary &&
          rKind !== ExprKind.Name &&
          rKind !== ExprKind.Der &&
          rKind !== ExprKind.Pre &&
          rKind !== ExprKind.Binary;
        const folded = canFoldBin
          ? evaluateConstantArenaExpression(arena, newBinId, constMap, nameToIdx, 0, undefined, undefined, true)
          : null;
        if (typeof folded === "number") {
          if (
            op === BinOp.Div ||
            op === BinOp.ElemDiv ||
            isRealTypedArenaExpr(arena, left, nameToIdx) ||
            isRealTypedArenaExpr(arena, right, nameToIdx)
          ) {
            return arena.addRealLiteral(folded);
          }
          return Number.isInteger(folded) ? arena.addIntLiteral(folded) : arena.addRealLiteral(folded);
        }
        if (typeof folded === "boolean") {
          return arena.addBoolLiteral(folded);
        }

        // Algebraic simplifications when one operand is constant
        if (op === BinOp.Mul) {
          if (isLiteralZero(arena, left)) return left;
          if (isLiteralZero(arena, right)) return right;
          if (isLiteralOne(arena, left)) return right;
          if (isLiteralOne(arena, right)) return left;
          if (isLiteralMinusOne(arena, left)) {
            return arena.addUnaryExpr(UnaryOp.Negate, right);
          }
          if (isLiteralMinusOne(arena, right)) {
            return arena.addUnaryExpr(UnaryOp.Negate, left);
          }
          // Fold associative scalar constants: (c1 * x) * c2 -> (c1 * c2) * x and c1 * (c2 * x) -> (c1 * c2) * x
          const getNumLit = (id: number): { val: number; isReal: boolean } | null => {
            const k = arena.getExprKind(id);
            if (k === ExprKind.RealLiteral) return { val: arena.getExprRealValue(id), isReal: true };
            if (k === ExprKind.IntLiteral) return { val: arena.getExprData1(id), isReal: false };
            return null;
          };
          const lLit = getNumLit(left);
          const rLit = getNumLit(right);
          const mkNum = (val: number, isReal: boolean): number =>
            isReal ? arena.addRealLiteral(val) : arena.addIntLiteral(Math.trunc(val));
          if (rLit && arena.getExprKind(left) === ExprKind.Binary && arena.getExprData1(left) === BinOp.Mul) {
            const la = arena.getExprLeft(left);
            const lb = arena.getExprRight(left);
            const laLit = getNumLit(la);
            const lbLit = getNumLit(lb);
            if (laLit) {
              return arena.addBinaryExpr(BinOp.Mul, mkNum(laLit.val * rLit.val, laLit.isReal || rLit.isReal), lb);
            }
            if (lbLit) {
              return arena.addBinaryExpr(BinOp.Mul, mkNum(lbLit.val * rLit.val, lbLit.isReal || rLit.isReal), la);
            }
          } else if (lLit && arena.getExprKind(right) === ExprKind.Binary && arena.getExprData1(right) === BinOp.Mul) {
            const ra = arena.getExprLeft(right);
            const rb = arena.getExprRight(right);
            const raLit = getNumLit(ra);
            const rbLit = getNumLit(rb);
            if (raLit) {
              return arena.addBinaryExpr(BinOp.Mul, mkNum(lLit.val * raLit.val, lLit.isReal || raLit.isReal), rb);
            }
            if (rbLit) {
              return arena.addBinaryExpr(BinOp.Mul, mkNum(lLit.val * rbLit.val, lLit.isReal || rbLit.isReal), ra);
            }
          }
        } else if (op === BinOp.Add) {
          if (isLiteralZero(arena, left)) return right;
          if (isLiteralZero(arena, right)) return left;
          if (
            left !== arena.getExprLeft(exprId) &&
            arena.getExprKind(left) === ExprKind.Unary &&
            (arena.getExprData1(left) as UnaryOp) === UnaryOp.Negate
          ) {
            return arena.addBinaryExpr(BinOp.Sub, right, arena.getExprLeft(left));
          }
        } else if (op === BinOp.Sub) {
          if (isLiteralZero(arena, right)) return left;
          if (isLiteralZero(arena, left)) {
            return arena.addUnaryExpr(UnaryOp.Negate, right);
          }
        } else if (op === BinOp.Div) {
          if (isLiteralOne(arena, right)) return left;
        } else if ((op === BinOp.Pow || op === BinOp.ElemPow) && isLiteralOne(arena, right)) {
          return left;
        }
      }
      return newBinId;
    }
    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId);
      const left = substituteArenaConstants(arena, arena.getExprLeft(exprId), constMap, nameToIdx);
      const newUnId = left !== arena.getExprLeft(exprId) ? arena.addUnaryExpr(op, left) : exprId;
      const lKind = left >= 0 ? arena.getExprKind(left) : -1;
      const folded =
        lKind !== ExprKind.Name && lKind !== ExprKind.Der && lKind !== ExprKind.Pre && lKind !== ExprKind.Binary
          ? evaluateConstantArenaExpression(arena, newUnId, constMap, nameToIdx, 0, undefined, undefined, true)
          : null;
      if (typeof folded === "number") {
        if (isRealTypedArenaExpr(arena, left, nameToIdx)) {
          return arena.addRealLiteral(folded);
        }
        return Number.isInteger(folded) ? arena.addIntLiteral(folded) : arena.addRealLiteral(folded);
      }
      if (typeof folded === "boolean") {
        return arena.addBoolLiteral(folded);
      }
      return newUnId;
    }
    case ExprKind.Negate: {
      const left = substituteArenaConstants(arena, arena.getExprLeft(exprId), constMap, nameToIdx);
      const newNegId = left !== arena.getExprLeft(exprId) ? arena.addExpression(ExprKind.Negate, 0, left) : exprId;
      const lKind = left >= 0 ? arena.getExprKind(left) : -1;
      const folded =
        lKind !== ExprKind.Name && lKind !== ExprKind.Der && lKind !== ExprKind.Pre && lKind !== ExprKind.Binary
          ? evaluateConstantArenaExpression(arena, newNegId, constMap, nameToIdx, 0, undefined, undefined, true)
          : null;
      if (typeof folded === "number") {
        if (isRealTypedArenaExpr(arena, left, nameToIdx)) {
          return arena.addRealLiteral(folded);
        }
        return Number.isInteger(folded) ? arena.addIntLiteral(folded) : arena.addRealLiteral(folded);
      }
      return newNegId;
    }
    case ExprKind.Der: {
      const data1 = substituteArenaConstants(arena, arena.getExprData1(exprId), constMap, nameToIdx);
      const k = arena.getExprKind(data1);
      if (k === ExprKind.RealLiteral || k === ExprKind.IntLiteral) {
        return arena.addRealLiteral(0.0);
      }
      if (k === ExprKind.Name) {
        const name = arena.interner.resolve(arena.getExprData1(data1));
        const idx = nameToIdx ? nameToIdx.get(name) : arena.getVarIdxByName(name);
        if (idx !== undefined && idx >= 0) {
          const v = arena.getVarVariability(idx);
          if (v === Variability.Constant || v === Variability.Parameter) {
            return arena.addRealLiteral(0.0);
          }
        }
      }
      if (k === ExprKind.Subscript) {
        const baseId = arena.getExprData1(data1);
        if (baseId >= 0 && arena.getExprKind(baseId) === ExprKind.Name) {
          const name = arena.interner.resolve(arena.getExprData1(baseId));
          const idx = nameToIdx ? nameToIdx.get(name) : arena.getVarIdxByName(name);
          if (idx !== undefined && idx >= 0) {
            const v = arena.getVarVariability(idx);
            if (v === Variability.Constant || v === Variability.Parameter) {
              return arena.addRealLiteral(0.0);
            }
          }
        }
      }
      if (data1 !== arena.getExprData1(exprId)) {
        return arena.addDerExpr(data1);
      }
      return exprId;
    }
    case ExprKind.Pre: {
      const data1 = substituteArenaConstants(arena, arena.getExprData1(exprId), constMap, nameToIdx);
      if (data1 !== arena.getExprData1(exprId)) {
        return arena.addPreExpr(data1);
      }
      return exprId;
    }
    case ExprKind.IfElse: {
      const cond = substituteArenaConstants(arena, arena.getExprData1(exprId), constMap, nameToIdx);
      const left = substituteArenaConstants(arena, arena.getExprLeft(exprId), constMap, nameToIdx);
      const right = substituteArenaConstants(arena, arena.getExprRight(exprId), constMap, nameToIdx);
      const condKind = arena.getExprKind(cond);
      if (condKind === ExprKind.BoolLiteral) {
        return arena.getExprData1(cond) !== 0 ? left : right;
      }
      if (condKind === ExprKind.IntLiteral) {
        return arena.getExprData1(cond) !== 0 ? left : right;
      }
      if (
        cond !== arena.getExprData1(exprId) ||
        left !== arena.getExprLeft(exprId) ||
        right !== arena.getExprRight(exprId)
      ) {
        return arena.addIfElseExpr(cond, left, right);
      }
      return exprId;
    }
    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const fnName = arena.interner.resolve(funcNameId) || "";
      const argCount = arena.getExprRight(exprId);
      const calledFnDae = arena.functions.size > 0 ? arena.functions.get(fnName) : undefined;
      let calledFnInputTypes: string[] | undefined;
      if (calledFnDae) {
        calledFnInputTypes = [];
        for (let vi = 0; vi < calledFnDae.varCount; vi++) {
          if (!calledFnDae.isVarRemoved(vi) && calledFnDae.getVarCausality(vi) === Causality.Input) {
            calledFnInputTypes.push(calledFnDae.getVarCustomType(vi) ?? "");
          }
        }
      }
      let anyChanged = false;
      const args: number[] = [];
      const allParamMap = constMap._allParamMap;
      for (let i = 0; i < argCount; i++) {
        const argExprId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const curIsStructuralClocked =
          i >= 1 &&
          (fnName === "shiftSample" || fnName === "subSample" || fnName === "superSample" || fnName === "backSample");
        const curIsClockSolver = i === 1 && fnName === "Clock";
        let preserveClockParam = false;
        if (i === 0 && fnName === "Clock" && argExprId >= 0 && arena.getExprKind(argExprId) === ExprKind.Name) {
          const argName = arena.interner.resolve(arena.getExprData1(argExprId));
          const vIdx = argName ? (nameToIdx ? nameToIdx.get(argName) : arena.getVarIdxByName(argName)) : undefined;
          if (vIdx !== undefined && vIdx >= 0 && arena.getVarVariability(vIdx) === Variability.Parameter) {
            preserveClockParam = true;
          }
        }
        let inlinedRec = -1;
        if (
          !preserveClockParam &&
          calledFnDae &&
          constMap.size > 0 &&
          nameToIdx &&
          nameToIdx.size > 0 &&
          arena.functions.size > 0 &&
          argExprId >= 0 &&
          arena.getExprKind(argExprId) === ExprKind.Name
        ) {
          const argName = arena.interner.resolve(arena.getExprData1(argExprId));
          if (argName && !nameToIdx.has(argName)) {
            inlinedRec = tryInlineEvaluatedRecordCallArg(
              arena,
              argName,
              calledFnInputTypes?.[i] || undefined,
              constMap,
              nameToIdx,
            );
          }
        }
        let subMap = constMap;
        if (allParamMap && argExprId >= 0) {
          if (curIsStructuralClocked) {
            subMap = allParamMap;
            if (arena.getExprKind(argExprId) === ExprKind.Name) {
              const argName = arena.interner.resolve(arena.getExprData1(argExprId));
              const vIdx = argName ? (nameToIdx ? nameToIdx.get(argName) : arena.getVarIdxByName(argName)) : undefined;
              if (
                vIdx !== undefined &&
                vIdx >= 0 &&
                arena.getVarVariability(vIdx) === Variability.Parameter &&
                arena.isVarFixed(vIdx) &&
                !arena.isVarFinal(vIdx)
              ) {
                arena.setVarFinal(vIdx, true);
              }
            }
          } else if (curIsClockSolver && arena.getExprKind(argExprId) === ExprKind.Name) {
            const argName = arena.interner.resolve(arena.getExprData1(argExprId));
            const vIdx = argName ? (nameToIdx ? nameToIdx.get(argName) : arena.getVarIdxByName(argName)) : undefined;
            if (
              vIdx !== undefined &&
              vIdx >= 0 &&
              arena.getVarVariability(vIdx) === Variability.Parameter &&
              arena.isVarFixed(vIdx) &&
              arena.getVarType(vIdx) === VarType.String
            ) {
              if (!arena.isVarFinal(vIdx)) arena.setVarFinal(vIdx, true);
              subMap = allParamMap;
            }
          }
        }
        const newArg =
          inlinedRec >= 0
            ? inlinedRec
            : preserveClockParam
              ? argExprId
              : substituteArenaConstants(arena, argExprId, subMap, nameToIdx);
        args.push(newArg);
        if (newArg !== argExprId) anyChanged = true;
      }
      if (fnName === "der" && args.length >= 1) {
        const arg0 = args[0]!;
        const k = arena.getExprKind(arg0);
        if (k === ExprKind.RealLiteral || k === ExprKind.IntLiteral) {
          return arena.addRealLiteral(0.0);
        }
        if (k === ExprKind.Name) {
          const name = arena.interner.resolve(arena.getExprData1(arg0));
          const idx = nameToIdx ? nameToIdx.get(name) : arena.getVarIdxByName(name);
          if (idx !== undefined && idx >= 0) {
            const v = arena.getVarVariability(idx);
            if (v === Variability.Constant || v === Variability.Parameter) {
              return arena.addRealLiteral(0.0);
            }
          }
        }
      }
      const callId = anyChanged ? arena.addCallExpr(fnName, args) : exprId;
      if (
        args.length === 0 &&
        (fnName === "Modelica.Mechanics.MultiBody.Frames.nullRotation" || fnName === "Frames.nullRotation") &&
        Boolean((arena.extensionMetadata as Record<string, unknown> | undefined)?.["omcCompatibility"])
      ) {
        const mkRow = (a: number, b: number, c: number) =>
          arena.addArrayCtorExpr([arena.addRealLiteral(a), arena.addRealLiteral(b), arena.addRealLiteral(c)]);
        const matT = arena.addArrayCtorExpr([mkRow(1.0, 0.0, 0.0), mkRow(0.0, 1.0, 0.0), mkRow(0.0, 0.0, 1.0)]);
        const vecW = mkRow(0.0, 0.0, 0.0);
        return arena.addCallExpr("Modelica.Mechanics.MultiBody.Frames.Orientation", [matT, vecW]);
      }
      const folded = evaluateConstantArenaExpression(arena, callId, constMap, nameToIdx, 0, undefined, undefined, true);
      if (
        isArenaComplexValue(folded) &&
        Number.isFinite(folded.re) &&
        Number.isFinite(folded.im) &&
        (fnName === "Complex.'constructor'.fromReal" || fnName.endsWith(".Complex.'constructor'.fromReal"))
      ) {
        return arena.addCallExpr("Complex", [arena.addRealLiteral(folded.re), arena.addRealLiteral(folded.im)]);
      }
      if (
        Array.isArray(folded) &&
        (fnName === "Modelica.Math.Vectors.normalize" ||
          fnName.endsWith(".Vectors.normalize") ||
          fnName === "Modelica.Math.Vectors.normalizeWithAssert" ||
          fnName.endsWith(".Vectors.normalizeWithAssert"))
      ) {
        return arrayValueToArenaExpr(arena, folded, VarType.Real);
      }
      if (typeof folded === "number") {
        if (fnName === "/*Real*/" || fnName === "Real" || isRealTypedArenaExpr(arena, callId, nameToIdx)) {
          return arena.addRealLiteral(folded);
        }
        return Number.isInteger(folded) ? arena.addIntLiteral(folded) : arena.addRealLiteral(folded);
      }
      if (typeof folded === "boolean") {
        return arena.addBoolLiteral(folded);
      }
      if (typeof folded === "string") {
        return arena.addStringLiteral(folded);
      }
      return callId;
    }
    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      let anyChanged = false;
      const elements: number[] = [];
      for (let i = 0; i < count; i++) {
        const elemId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const newElem = substituteArenaConstants(arena, elemId, constMap, nameToIdx);
        elements.push(newElem);
        if (newElem !== elemId) anyChanged = true;
      }
      if (anyChanged) {
        return arena.addArrayCtorExpr(elements);
      }
      return exprId;
    }
    case ExprKind.Range: {
      const origStart = arena.getExprData1(exprId);
      const origStep = arena.getExprLeft(exprId);
      const origStop = arena.getExprRight(exprId);
      const start = substituteArenaConstants(arena, origStart, constMap, nameToIdx);
      const step = origStep >= 0 ? substituteArenaConstants(arena, origStep, constMap, nameToIdx) : -1;
      const stop = substituteArenaConstants(arena, origStop, constMap, nameToIdx);
      if (start !== origStart || (origStep >= 0 && step !== origStep) || stop !== origStop) {
        return arena.addRange(start, stop, step);
      }
      return exprId;
    }
    case ExprKind.Subscript: {
      const baseExprId = arena.getExprData1(exprId);
      const subCount = arena.getExprRight(exprId);
      let newBase = substituteArenaConstants(arena, baseExprId, constMap, nameToIdx);
      let anyChanged = newBase !== baseExprId;
      const newSubs: number[] = [];
      for (let i = 0; i < subCount; i++) {
        const subId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const newSub = substituteArenaConstants(arena, subId, constMap, nameToIdx);
        newSubs.push(newSub);
        if (newSub !== subId) anyChanged = true;
      }
      let elemVarType: VarType | undefined;
      if (
        (subCount === 1 || subCount === 2) &&
        nameToIdx &&
        newBase === baseExprId &&
        arena.getExprKind(baseExprId) === ExprKind.Name
      ) {
        const baseName = arena.interner.resolve(arena.getExprData1(baseExprId));
        if (baseName && !nameToIdx.has(baseName)) {
          const resolveConstElemExpr = (elemVarIdx: number, elemKey: string): number => {
            const vt = arena.getVarType(elemVarIdx);
            const elemBind = arena.getVarExpression(elemVarIdx);
            if (elemBind !== undefined && elemBind >= 0) {
              const ek = arena.getExprKind(elemBind);
              if (
                ek === ExprKind.RealLiteral ||
                ek === ExprKind.IntLiteral ||
                ek === ExprKind.BoolLiteral ||
                ek === ExprKind.StringLiteral ||
                ek === ExprKind.EnumLiteral
              ) {
                return elemBind;
              }
              if (
                ek === ExprKind.Negate ||
                (ek === ExprKind.Unary && arena.getExprData1(elemBind) === UnaryOp.Negate)
              ) {
                const inner = arena.getExprLeft(elemBind);
                const ik = inner >= 0 ? arena.getExprKind(inner) : -1;
                if (ik === ExprKind.RealLiteral || ik === ExprKind.IntLiteral) {
                  return elemBind;
                }
              }
            }
            if (constMap.has(elemKey)) {
              const cv = constMap.get(elemKey)!;
              if (vt === VarType.Integer && typeof cv === "number") return arena.addIntLiteral(Math.trunc(cv));
              if (vt === VarType.Boolean) return arena.addBoolLiteral(Boolean(cv));
              if (vt === VarType.Real && typeof cv === "number") return arena.addRealLiteral(cv);
            }
            return -1;
          };

          const firstIdx = subCount === 1 ? nameToIdx.get(`${baseName}[1]`) : undefined;
          if (firstIdx !== undefined && arena.getVarVariability(firstIdx) === Variability.Constant) {
            elemVarType = arena.getVarType(firstIdx);
            const elemIds: number[] = [];
            let k = 1;
            let allConst = true;
            while (k <= 2048) {
              const elemKey = `${baseName}[${k}]`;
              const elemVarIdx = nameToIdx.get(elemKey);
              if (elemVarIdx === undefined) break;
              if (arena.getVarVariability(elemVarIdx) !== Variability.Constant) {
                allConst = false;
                break;
              }
              const elemExpr = resolveConstElemExpr(elemVarIdx, elemKey);
              if (elemExpr < 0) {
                allConst = false;
                break;
              }
              elemIds.push(elemExpr);
              k++;
            }
            if (allConst && elemIds.length > 0) {
              newBase = arena.addArrayCtorExpr(elemIds);
              anyChanged = true;
            }
          } else if (firstIdx === undefined) {
            const prefix = `${baseName}[`;
            const flatElems: number[] = [];
            const rowMap = new Map<string, number[]>();
            let dims = 0;
            let count = 0;
            let allConst = true;
            const splitIndexParts = (inside: string): string[] => {
              const parts: string[] = [];
              let inQuote = false;
              let start = 0;
              for (let p = 0; p < inside.length; p++) {
                const ch = inside[p];
                if (ch === "'") inQuote = !inQuote;
                else if (ch === "," && !inQuote) {
                  parts.push(inside.slice(start, p).trim());
                  start = p + 1;
                }
              }
              parts.push(inside.slice(start).trim());
              return parts;
            };
            for (const [key, elemVarIdx] of nameToIdx) {
              if (!key.startsWith(prefix)) continue;
              if (arena.isVarRemoved(elemVarIdx)) continue;
              const rest = key.slice(prefix.length);
              const closeIdx = rest.indexOf("]");
              if (closeIdx < 0 || closeIdx !== rest.length - 1) {
                allConst = false;
                break;
              }
              if (arena.getVarVariability(elemVarIdx) !== Variability.Constant) {
                allConst = false;
                break;
              }
              if (elemVarType === undefined) elemVarType = arena.getVarType(elemVarIdx);
              const elemExpr = resolveConstElemExpr(elemVarIdx, key);
              if (elemExpr < 0) {
                allConst = false;
                break;
              }
              const parts = splitIndexParts(rest.slice(0, closeIdx));
              if (dims === 0) dims = parts.length;
              if (parts.length !== dims || (dims !== 1 && dims !== 2)) {
                allConst = false;
                break;
              }
              count++;
              if (count > 2048) {
                allConst = false;
                break;
              }
              if (dims === 1) {
                flatElems.push(elemExpr);
              } else {
                const rowKey = parts[0]!;
                let row = rowMap.get(rowKey);
                if (!row) {
                  row = [];
                  rowMap.set(rowKey, row);
                }
                row.push(elemExpr);
              }
            }
            if (allConst && count > 0) {
              if (dims === 1 && subCount === 1 && flatElems.length > 0) {
                newBase = arena.addArrayCtorExpr(flatElems);
                anyChanged = true;
              } else if (dims === 2 && rowMap.size > 0) {
                const rows = [...rowMap.values()];
                const rowLen = rows[0]!.length;
                if (rowLen > 0 && rows.every((r) => r.length === rowLen)) {
                  const rowExprIds = rows.map((r) => arena.addArrayCtorExpr(r));
                  newBase = arena.addArrayCtorExpr(rowExprIds);
                  anyChanged = true;
                }
              }
            }
          }
        }
      }
      const subExprId = anyChanged ? arena.addSubscriptExpr(newBase, newSubs) : exprId;
      const folded = evaluateConstantArenaExpression(
        arena,
        subExprId,
        constMap,
        nameToIdx,
        0,
        undefined,
        undefined,
        true,
      );
      if (elemVarType !== VarType.Enumeration) {
        if (typeof folded === "number" && Number.isFinite(folded)) {
          if (elemVarType === VarType.Integer && Number.isInteger(folded)) {
            return arena.addIntLiteral(folded);
          }
          return arena.addRealLiteral(folded);
        }
        if (typeof folded === "boolean") {
          return arena.addBoolLiteral(folded);
        }
      }
      return subExprId;
    }
    case ExprKind.Comprehension: {
      const fnId = arena.getExprData1(exprId);
      const bodyId = arena.getExprLeft(exprId);
      const iterCount = arena.getExprRight(exprId);
      const iters: { iterNameId: number; rangeExprId: number }[] = [];
      let shadowed = false;
      let changed = false;
      let mutableInnerMap: Map<string, ArenaConstantValue> | null = null;
      for (let i = 0; i < iterCount; i++) {
        const iterSlot = exprId + 1 + i;
        const iterNameId = arena.getExprData1(iterSlot);
        const iterVarName = arena.interner.resolve(iterNameId);
        const rangeExprId = arena.getExprLeft(iterSlot);
        const curMap: ArenaFoldParamLookup = mutableInnerMap ?? constMap;
        const newRangeExprId = shadowed ? rangeExprId : substituteArenaConstants(arena, rangeExprId, curMap, nameToIdx);
        if (newRangeExprId !== rangeExprId) changed = true;
        if (iterVarName && curMap.has(iterVarName)) {
          if (!mutableInnerMap) mutableInnerMap = new Map(constMap);
          mutableInnerMap.delete(iterVarName);
        }
        iters.push({ iterNameId, rangeExprId: newRangeExprId });
      }
      const newBodyId = substituteArenaConstants(arena, bodyId, mutableInnerMap ?? constMap, nameToIdx);
      if (newBodyId !== bodyId) changed = true;
      if (!changed) return exprId;
      const compId = arena.addExpression(ExprKind.Comprehension, fnId, newBodyId, iters.length);
      for (const iter of iters) {
        arena.addExpression(ExprKind.Tuple, iter.iterNameId, iter.rangeExprId, 0);
      }
      return compId;
    }
    default:
      return exprId;
  }
}
