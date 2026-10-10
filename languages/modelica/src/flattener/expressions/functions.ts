// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - Function Call Lowering & Vectorization.
 *
 * Implements scalar function vectorization over array arguments, built-in function
 * evaluation/folding, outer/inner function resolution, and symbol naming.
 */

import { ExprKind } from "@modelscript/dsl";
import {
  Causality,
  DAEBuilder,
  evaluateArenaFunctionCall,
  VarType,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { getFlatteningState } from "../support/state.js";
import { getArrayCtorElements } from "./binary-ops.js";
import {
  addArenaValueAsExpr,
  castToRealExpr,
  evalDaeExpr,
  exprContainsNameRef,
  getExprDims,
  isRealExpr,
} from "./eval.js";

export const SCALAR_VECTORIZABLE_FUNCTIONS = new Map<string, { arity: number; fold?: (...args: number[]) => number }>([
  ["sin", { arity: 1, fold: Math.sin }],
  ["cos", { arity: 1, fold: Math.cos }],
  ["tan", { arity: 1, fold: Math.tan }],
  ["asin", { arity: 1, fold: Math.asin }],
  ["acos", { arity: 1, fold: Math.acos }],
  ["atan", { arity: 1, fold: Math.atan }],
  ["atan2", { arity: 2, fold: Math.atan2 }],
  ["sinh", { arity: 1, fold: Math.sinh }],
  ["cosh", { arity: 1, fold: Math.cosh }],
  ["tanh", { arity: 1, fold: Math.tanh }],
  ["exp", { arity: 1, fold: Math.exp }],
  ["log", { arity: 1, fold: Math.log }],
  ["log10", { arity: 1, fold: Math.log10 }],
  ["sqrt", { arity: 1, fold: Math.sqrt }],
  ["abs", { arity: 1, fold: Math.abs }],
  ["sign", { arity: 1, fold: Math.sign }],
  ["floor", { arity: 1, fold: Math.floor }],
  ["ceil", { arity: 1, fold: Math.ceil }],
  ["div", { arity: 2, fold: (a, b) => (b !== 0 ? Math.trunc(a / b) : (null as any)) }],
  ["rem", { arity: 2, fold: (a, b) => (b !== 0 ? a - Math.trunc(a / b) * b : (null as any)) }],
  ["mod", { arity: 2, fold: (a, b) => (b !== 0 ? a - Math.floor(a / b) * b : (null as any)) }],
]);

export function getSymbolQualifiedName(db: QueryDB, symId: SymbolId): string {
  const parts: string[] = [];
  let curr: SymbolEntry | null = db.symbol(symId);
  while (curr) {
    parts.unshift(curr.name);
    curr = curr.parentId !== null ? db.symbol(curr.parentId) : null;
  }
  return parts.join(".");
}

export function isEquationExpr(c: any): boolean {
  if (!c) return false;
  const t = c.type;
  return t === "expression" || t === "Expression" || t === "lhs_expression" || t === "LhsExpression";
}

export function isOuterFunctionSymbol(db: any, sym: any): boolean {
  if (!sym || !db) return false;
  const cst = db.cstNode(sym.id) as any;
  if (/\bouter\b/.test(cst?.text ?? "") || /\bouter\b/.test(cst?.parent?.text ?? "")) return true;
  if (sym.parentId) {
    const parentCst = db.cstNode(sym.parentId) as any;
    if (/\bouter\b/.test(parentCst?.text ?? "") || /\bouter\b/.test(parentCst?.parent?.text ?? "")) return true;
  }
  return false;
}

export function hasMatchingInnerFunction(db: any, flattener: any, name: string): boolean {
  if (!db || !name) return false;
  const shortName = name.includes(".") ? name.split(".").pop()! : name;
  const candidates = db.byName(shortName);
  if (!candidates) return false;
  return candidates.some((c: any) => {
    if (c.kind !== "Class" && c.kind !== "Function") return false;
    const cst = db.cstNode(c.id) as any;
    const hasInner = /\binner\b/.test(cst?.text ?? "") || /\binner\b/.test(cst?.parent?.text ?? "");
    if (!hasInner) return false;
    return !flattener?.isClassPartial?.(c.id);
  });
}

export function vectorizeFunctionCall(
  fnName: string,
  argExprIds: number[],
  dae: DAEBuilder,
  flattener?: any,
  db?: any,
): number | null {
  if (
    fnName === "subSample" ||
    fnName === "superSample" ||
    fnName === "sample" ||
    fnName === "noClock" ||
    fnName === "interval" ||
    fnName === "Integer" ||
    fnName === "Real" ||
    fnName === "Boolean" ||
    fnName === "String" ||
    fnName === "sum" ||
    fnName === "product" ||
    fnName === "min" ||
    fnName === "max" ||
    fnName === "fill" ||
    fnName === "zeros" ||
    fnName === "ones" ||
    fnName === "identity" ||
    fnName === "diagonal" ||
    fnName === "linspace" ||
    fnName === "cat"
  ) {
    return null;
  }
  const scalarBuiltin = SCALAR_VECTORIZABLE_FUNCTIONS.get(fnName);
  let isScalarFn = Boolean(scalarBuiltin);
  let fnDae: DAEBuilder | undefined;
  if (!isScalarFn) {
    const hasArrayArg = argExprIds.some((aid) => (getExprDims(aid, dae, db)?.length ?? 0) > 0);
    if (!hasArrayArg) return null;
    fnDae = dae.getFunction(fnName);
    if (!fnDae && flattener && db) {
      const parts = fnName.split(".");
      const fnBase = parts[parts.length - 1]!;
      let sym: any = null;
      const currentScopeId = flattener.currentClassId ?? (dae as any).currentClassId ?? flattener.currentRootClassId;
      if (currentScopeId) {
        const resolver = (
          fnName.includes(".")
            ? (db.query as any)("resolveName", currentScopeId)
            : (db.query as any)("resolveSimpleName", currentScopeId)
        ) as ((n: string) => any) | undefined;
        sym = resolver?.(fnName);
      }
      if (!sym) {
        sym = db
          .byName(fnBase)
          .find((e: any) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e));
      }
      if (sym && flattener.failedFunctionIds?.has(sym.id)) {
        return null;
      }
      if (sym && flattener.flattenFunction) {
        const qualifiedFnName = getSymbolQualifiedName(db, sym.id);
        flattener.calledFunctionSymIds?.add(sym.id);
        fnDae = flattener.flattenFunction(sym.id, qualifiedFnName, undefined, dae);
        if (fnDae && !fnDae.diagnostics.some((d: any) => d.severity === "error")) {
          dae.addFunction(qualifiedFnName, fnDae);
          dae.addFunction(fnName, fnDae);
          if (fnBase) dae.addFunction(fnBase, fnDae);
          if (fnDae.functions && fnDae.functions.size > 0) {
            for (const [nestedName, nestedFn] of fnDae.functions.entries()) {
              dae.addFunction(nestedName, nestedFn);
            }
          }
        } else {
          if (fnDae) {
            for (const d of fnDae.diagnostics) {
              if (d.severity === "error" && !dae.diagnostics.some((existing: any) => existing.message === d.message)) {
                dae.diagnostics.push(d);
              }
            }
          }
          fnDae = undefined;
        }
      }
    }
  }

  let inputShapes: number[][] = [];
  let allScalarInputs = true;
  if (scalarBuiltin) {
    isScalarFn = true;
    inputShapes = argExprIds.map(() => []);
  } else if (fnDae) {
    for (let i = 0; i < fnDae.varCount; i++) {
      if (fnDae.getVarCausality(i) === Causality.Input) {
        const shape = fnDae.getVarShape(i) ?? [];
        inputShapes.push(shape);
        if (shape.length > 0 || fnDae.getVarName(i).includes("[")) {
          allScalarInputs = false;
        }
      }
    }
  } else if (
    fnName === "backSample" ||
    fnName === "shiftSample" ||
    fnName === "hold" ||
    fnName === "subSample" ||
    fnName === "superSample"
  ) {
    isScalarFn = true;
    inputShapes = argExprIds.map(() => []);
  } else {
    return null;
  }

  const extraDimsPerArg: number[] = [];
  for (let i = 0; i < argExprIds.length; i++) {
    const expShape = inputShapes[i] ?? [];
    const actDims = getExprDims(argExprIds[i]!, dae, db) ?? [];
    const extra = actDims.length - expShape.length;
    if (extra < 0) return null;
    if (extra > 0) {
      const innerDims = actDims.slice(extra);
      const match = innerDims.every((d, idx) => expShape[idx] === -1 || expShape[idx] === d);
      if (!match) return null;
    }
    extraDimsPerArg.push(extra);
  }

  const argsWithExtraIndices: number[] = [];
  for (let i = 0; i < extraDimsPerArg.length; i++) {
    if (extraDimsPerArg[i]! > 0) {
      argsWithExtraIndices.push(i);
    }
  }

  if (argsWithExtraIndices.length === 0) return null;
  if (!allScalarInputs && argsWithExtraIndices.length > 1) return null;

  let arrLen = -1;
  let targetIdx = -1;
  if (allScalarInputs) {
    for (const idx of argsWithExtraIndices) {
      const id = argExprIds[idx]!;
      let len = -1;
      if (dae.getExprKind(id) === ExprKind.ArrayCtor) {
        len = dae.getExprData1(id);
      } else {
        const dims = getExprDims(id, dae, db);
        if (dims && dims.length > 0 && dims[0] > 0) {
          len = dims[0];
        }
      }
      if (len > 0) {
        if (arrLen === -1) arrLen = len;
        else if (arrLen !== len) return null;
      }
    }
  } else {
    targetIdx = argsWithExtraIndices[0]!;
    const id = argExprIds[targetIdx]!;
    if (dae.getExprKind(id) === ExprKind.ArrayCtor) {
      arrLen = dae.getExprData1(id);
    } else {
      const dims = getExprDims(id, dae, db);
      if (dims && dims.length > 0 && dims[0] > 0) {
        arrLen = dims[0];
      } else {
        return null;
      }
    }
  }
  if (arrLen < 0) {
    if (argsWithExtraIndices.length === 1 && isScalarFn) {
      const targetArgId = argExprIds[argsWithExtraIndices[0]!]!;
      const targetName =
        dae.getExprKind(targetArgId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(targetArgId)) : "";
      const state = getFlatteningState(dae);
      if (!state.tmpVarMap) state.tmpVarMap = new Map<string, string>();
      let tmpVarName = state.tmpVarMap.get(targetName);
      if (!tmpVarName) {
        const initialCounter = (state.linspaceCounter ?? 0) > 0 ? 5 : 0;
        const tmpVarNum =
          state.tmpVarCounter !== undefined ? ++state.tmpVarCounter : (state.tmpVarCounter = initialCounter);
        tmpVarName = `$tmpVar${tmpVarNum}`;
        state.tmpVarMap.set(targetName, tmpVarName);
      }
      const callArgs = argExprIds.map((aid, idx) =>
        idx === argsWithExtraIndices[0] ? dae.addNameExpr(tmpVarName) : aid,
      );
      const scalarCall = dae.addCallExpr(fnName, callArgs);
      return dae.addComprehensionExpr("array", scalarCall, [{ name: tmpVarName, rangeId: targetArgId }]);
    }
    return null;
  }

  const elemResults: number[] = [];
  for (let i = 0; i < arrLen; i++) {
    const subArgs: number[] = [];
    for (let j = 0; j < argExprIds.length; j++) {
      const argId = argExprIds[j]!;
      if (allScalarInputs) {
        if (extraDimsPerArg[j]! > 0) {
          if (dae.getExprKind(argId) === ExprKind.ArrayCtor) {
            const elems = getArrayCtorElements(argId, dae);
            subArgs.push(elems[i] ?? argId);
          } else {
            subArgs.push(dae.addSubscriptExpr(argId, [dae.addIntLiteral(i + 1)]));
          }
        } else {
          subArgs.push(argId);
        }
      } else {
        if (j === targetIdx) {
          if (dae.getExprKind(argId) === ExprKind.ArrayCtor) {
            const elems = getArrayCtorElements(argId, dae);
            subArgs.push(elems[i] ?? argId);
          } else {
            subArgs.push(dae.addSubscriptExpr(argId, [dae.addIntLiteral(i + 1)]));
          }
        } else {
          subArgs.push(argId);
        }
      }
    }

    let subHasExtra = false;
    for (let p = 0; p < subArgs.length; p++) {
      const expLen = inputShapes[p]?.length ?? 0;
      const actLen = (getExprDims(subArgs[p]!, dae, db) ?? []).length;
      if (actLen > expLen) {
        subHasExtra = true;
        break;
      }
    }

    if (subHasExtra) {
      const rec = vectorizeFunctionCall(fnName, subArgs, dae, flattener, db);
      if (rec !== null) {
        elemResults.push(rec);
        continue;
      }
    }

    if (scalarBuiltin?.fold) {
      const constVals: number[] = [];
      let allConst = true;
      for (const sa of subArgs) {
        if (exprContainsNameRef(sa, dae)) {
          allConst = false;
          break;
        }
        const v = evalDaeExpr(sa, dae);
        if (typeof v === "number") {
          constVals.push(v);
        } else {
          allConst = false;
          break;
        }
      }
      if (allConst && constVals.length === subArgs.length) {
        const folded = scalarBuiltin.fold(...constVals);
        if (folded !== null && typeof folded === "number" && isFinite(folded)) {
          const isIntOp =
            (fnName === "abs" || fnName === "sign" || fnName === "div" || fnName === "rem" || fnName === "mod") &&
            subArgs.every((a) => !isRealExpr(a, dae)) &&
            Number.isInteger(folded);
          elemResults.push(isIntOp ? dae.addIntLiteral(folded) : dae.addRealLiteral(folded));
          continue;
        }
      }
    } else if (fnDae) {
      const constVals: any[] = [];
      let allConst = true;
      for (const sa of subArgs) {
        if (exprContainsNameRef(sa, dae)) {
          allConst = false;
          break;
        }
        const v = evalDaeExpr(sa, dae);
        if (v !== null && v !== undefined) {
          constVals.push(v);
        } else {
          allConst = false;
          break;
        }
      }
      if (!fnDae.isImpure && allConst && constVals.length === subArgs.length) {
        try {
          const fnInternId = typeof fnName === "string" ? dae.interner.intern(fnName) : fnName;
          const outVal = evaluateArenaFunctionCall(
            dae,
            fnInternId,
            constVals,
            db,
            flattener?.currentRootClassId ?? undefined,
          );
          if (outVal !== null && outVal !== undefined) {
            (fnDae as any).wasCalled = true;
            for (const f of dae.functions.values()) {
              if (f.name === fnDae.name) {
                (f as any).wasCalled = true;
              }
            }
            let firstOutputType: VarType | null = null;
            for (let i = 0; i < fnDae.varCount; i++) {
              if (fnDae.getVarCausality(i) === Causality.Output) {
                firstOutputType = fnDae.getVarType(i);
                break;
              }
            }
            const inlinedId = addArenaValueAsExpr(dae, outVal, firstOutputType ?? undefined);
            if (inlinedId >= 0) {
              elemResults.push(inlinedId);
              continue;
            }
          }
        } catch {
          // ignore evaluation error and fall through
        }
      }
    }

    const shouldCastReal =
      fnName === "sin" ||
      fnName === "cos" ||
      fnName === "tan" ||
      fnName === "asin" ||
      fnName === "acos" ||
      fnName === "atan" ||
      fnName === "sinh" ||
      fnName === "cosh" ||
      fnName === "tanh" ||
      fnName === "exp" ||
      fnName === "log" ||
      fnName === "log10" ||
      fnName === "sqrt";
    let castedArgs = shouldCastReal ? subArgs.map((sa) => castToRealExpr(sa, dae)) : subArgs;
    if (fnDae && !shouldCastReal) {
      let inIdx = 0;
      castedArgs = [...castedArgs];
      for (let vi = 0; vi < fnDae.varCount; vi++) {
        if (fnDae.getVarCausality(vi) === Causality.Input) {
          if (inIdx < castedArgs.length) {
            const expectedType = fnDae.getVarType(vi);
            if (expectedType === VarType.Real && !fnDae.getVarCustomType(vi) && !isRealExpr(castedArgs[inIdx]!, dae)) {
              castedArgs[inIdx] = castToRealExpr(castedArgs[inIdx]!, dae);
            }
          }
          inIdx++;
        }
      }
    }
    elemResults.push(dae.addCallExpr(fnName, castedArgs));
  }

  return dae.addArrayCtorExpr(elemResults);
}
