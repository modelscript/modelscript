// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generic WASM Constant Folding & Algebraic Reduction Framework.
 * Operates directly on DAEBuilder and WebAssembly memory buffers.
 *
 * Subsystems are decomposed into focused modules under `packages/runtime/src/dae/`:
 * - `wasm_fold_helpers.ts`: shared types, math/matrix builtins, literal/type predicates
 * - `wasm_const_eval.ts`: compile-time constant expression evaluation
 * - `wasm_const_substitute.ts`: constant substitution and if-else / algebraic simplification
 * - `wasm_scalarize_helpers.ts`: array/matrix/record structural inspection helpers
 * - `wasm_scalarize.ts`: deferred batch scalarization pass
 */

import type { QueryDB, SymbolId } from "../runtime.js";
import { evaluateConstantArenaExpression } from "./wasm_const_eval.js";
import { simplifyArenaIfElse, substituteArenaConstants } from "./wasm_const_substitute.js";
import { Causality, DAEBuilder, EqKind, ExprKind, StmtKind, Variability, VarType } from "./wasm_dae.js";
import {
  type ArenaConstantValue,
  type ArenaFoldParamLookup,
  type ArenaFoldParamMap,
  type StructuredBodyEquation,
  arrayValueToArenaExpr,
  canPreFoldInWasm,
  isExprAlreadyLiteral,
} from "./wasm_fold_helpers.js";

export { evaluateConstantArenaExpression } from "./wasm_const_eval.js";
export { simplifyArenaIfElse, substituteArenaConstants } from "./wasm_const_substitute.js";
export {
  _getNegatedInner,
  type ArenaComplexValue,
  type ArenaConstantValue,
  type ArenaFoldParamLookup,
  type ArenaFoldParamMap,
} from "./wasm_fold_helpers.js";
export { scalarizeArena } from "./wasm_scalarize.js";
export {
  getMatrixDimensions,
  getMatrixElement,
  getNthExpr,
  hasArrayEquations,
  isArrayOfLength,
} from "./wasm_scalarize_helpers.js";

/**
 * In-place constant fold for a single equation in the arena.
 */
export function foldSingleArenaEquation(
  arena: DAEBuilder,
  eq: number,
  db?: QueryDB,
  scopeId?: SymbolId,
  omcCompatibility = false,
  paramMap?: Map<string, number>,
): boolean {
  if (eq < 0 || eq >= arena.eqCount) return false;
  const eqKind = arena.getEqKind(eq);
  if (
    !db &&
    !paramMap &&
    (eqKind === EqKind.Simple || eqKind === EqKind.InitialSimple || eqKind === EqKind.Array) &&
    canPreFoldInWasm(arena) &&
    typeof (arena.exports as { dae_simplifyAlgebraicExpr?: (p: number, id: number, onlyConst: boolean) => number })
      ?.dae_simplifyAlgebraicExpr === "function"
  ) {
    const simplifyWasm = (
      arena.exports as { dae_simplifyAlgebraicExpr: (p: number, id: number, onlyConst: boolean) => number }
    ).dae_simplifyAlgebraicExpr;
    const lhsExpr = arena.getEqLhs(eq);
    const origRhs = (arena as { getOrigEqRhs?: (eqIdx: number) => number }).getOrigEqRhs
      ? (arena as { getOrigEqRhs: (eqIdx: number) => number }).getOrigEqRhs(eq)
      : arena.getEqRhs(eq);
    const rhsExpr = origRhs >= 0 ? origRhs : arena.getEqRhs(eq);
    if (rhsExpr >= 0) {
      const simpRhs = simplifyWasm(arena.ptr, rhsExpr, omcCompatibility);
      if (simpRhs !== rhsExpr) arena.setEqRhs(eq, simpRhs);
      if (lhsExpr >= 0) {
        const lhsKind = arena.getExprKind(lhsExpr);
        if (lhsKind !== ExprKind.Name && lhsKind !== ExprKind.Der) {
          const simpLhs = simplifyWasm(arena.ptr, lhsExpr, omcCompatibility);
          if (simpLhs !== lhsExpr) arena.setEqLhs(eq, simpLhs);
        }
      }
      return true;
    }
  }

  const nameToIdx = new Map<string, number>();
  if (!paramMap) {
    paramMap = new Map<string, number>();
    for (let i = 0; i < arena.varCount; i++) {
      if (!arena.isVarRemoved(i)) {
        const v = arena.getVarVariability(i);
        const name = arena.getVarName(i);
        nameToIdx.set(name, i);
        if (v === Variability.Constant || (v === Variability.Parameter && arena.isVarFixed(i))) {
          paramMap.set(name, arena.getVarStartValue(i));
        }
      }
    }
  }

  if (eqKind === EqKind.Simple || eqKind === EqKind.InitialSimple || eqKind === EqKind.Array) {
    let lhsExpr = arena.getEqLhs(eq);
    const origRhs = arena.getOrigEqRhs(eq);
    let rhsExpr = origRhs >= 0 ? origRhs : arena.getEqRhs(eq);
    if (rhsExpr >= 0 && (arena.getExprKind(rhsExpr) !== ExprKind.ArrayCtor || !omcCompatibility)) {
      const foldedRhs = evaluateConstantArenaExpression(arena, rhsExpr, paramMap, nameToIdx, 0, db, scopeId);
      if (foldedRhs !== null) {
        let varType = VarType.Real;
        if (arena.getExprKind(lhsExpr) === ExprKind.Name) {
          const varName = arena.interner.resolve(arena.getExprData1(lhsExpr));
          let varIdx = nameToIdx.get(varName);
          if (varIdx === undefined) {
            const prefixMatch = `${varName}[`;
            for (const [k, idx] of nameToIdx) {
              if (k.startsWith(prefixMatch)) {
                varIdx = idx;
                break;
              }
            }
          }
          if (varIdx !== undefined) varType = arena.getVarType(varIdx);
        }
        let newRhs: number;
        if (Array.isArray(foldedRhs)) {
          newRhs = arrayValueToArenaExpr(arena, foldedRhs, varType);
        } else if (varType === VarType.Boolean && typeof foldedRhs === "boolean") {
          newRhs = arena.addBoolLiteral(foldedRhs);
        } else if (varType === VarType.Integer && typeof foldedRhs === "number") {
          newRhs = arena.addIntLiteral(Math.trunc(foldedRhs));
        } else if (varType === VarType.String || typeof foldedRhs === "string") {
          newRhs = arena.addStringLiteral(String(foldedRhs));
        } else if (typeof foldedRhs === "number") {
          newRhs = arena.addRealLiteral(foldedRhs);
        } else {
          newRhs = rhsExpr;
        }
        if (newRhs !== rhsExpr) {
          arena.setEqRhs(eq, newRhs);
          rhsExpr = newRhs;
        }
      }

      const simplifiedRhs = simplifyArenaIfElse(arena, rhsExpr, paramMap, nameToIdx);
      if (simplifiedRhs !== rhsExpr) {
        arena.setEqRhs(eq, simplifiedRhs);
        rhsExpr = simplifiedRhs;
      }
      const constMap = new Map<string, number>();
      for (let i = 0; i < arena.varCount; i++) {
        if (
          !arena.isVarRemoved(i) &&
          arena.getVarVariability(i) === Variability.Constant &&
          arena.getVarType(i) !== VarType.String &&
          arena.hasExplicitVarExpression(i)
        ) {
          constMap.set(arena.getVarName(i), arena.getVarStartValue(i));
        }
      }
      const constSubRhs = substituteArenaConstants(arena, rhsExpr, constMap, nameToIdx);
      if (constSubRhs !== rhsExpr) arena.setEqRhs(eq, constSubRhs);
      const simplifiedLhs = simplifyArenaIfElse(arena, lhsExpr, paramMap, nameToIdx);
      if (simplifiedLhs !== lhsExpr) arena.setEqLhs(eq, simplifiedLhs);
      const constSubLhs = substituteArenaConstants(arena, lhsExpr, constMap, nameToIdx);
      if (constSubLhs !== lhsExpr) arena.setEqLhs(eq, constSubLhs);
      return true;
    }
  }
  return false;
}

/**
 * In-place constant fold targeting only equations that reference a specific parameter.
 */
export function foldTargetedParamEquations(
  arena: DAEBuilder,
  paramName: string,
  db?: QueryDB,
  scopeId?: SymbolId,
  omcCompatibility = false,
): void {
  const paramMap = new Map<string, number>();
  for (let i = 0; i < arena.varCount; i++) {
    if (!arena.isVarRemoved(i)) {
      const v = arena.getVarVariability(i);
      if (v === Variability.Constant || (v === Variability.Parameter && arena.isVarFixed(i))) {
        paramMap.set(arena.getVarName(i), arena.getVarStartValue(i));
      }
    }
  }

  // Update dependent parameters that reference paramName
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Constant || v === Variability.Parameter) {
      const name = arena.getVarName(i);
      if (name === paramName) continue;
      const exprId = arena.getVarExpression(i);
      if (typeof exprId === "number" && exprId >= 0) {
        if (arena.exprReferencesName(exprId, paramName)) {
          const evalVal = evaluateConstantArenaExpression(arena, exprId, paramMap, undefined, 0, db, scopeId);
          if (evalVal !== null && typeof evalVal === "number") {
            arena.setVarStartValue(i, evalVal);
            paramMap.set(name, evalVal);
          }
        }
      }
    }
  }

  const affectedEqs = arena.getEquationsReferencingParam(paramName);
  for (const eqIdx of affectedEqs) {
    foldSingleArenaEquation(arena, eqIdx, db, scopeId, omcCompatibility, paramMap);
  }
}

/**
 * Fold constant and parameter expressions in the arena to literal values
 * where possible. This is done iteratively until fixed point or maxIterations.
 */
export function foldArenaConstants(
  arena: DAEBuilder,
  db?: QueryDB,
  scopeId?: SymbolId,
  omcCompatibility = false,
  maxIterations = 100,
): number {
  let wasmFolded = 0;
  const wasmEligible = !db && canPreFoldInWasm(arena);
  if (wasmEligible) {
    wasmFolded = arena.exports.dae_foldConstantsEx(arena.ptr, maxIterations, omcCompatibility) as number;
    if (wasmFolded > 0 && typeof arena.exports.dae_getVarAttrExpr === "function") {
      const getAttr = arena.exports.dae_getVarAttrExpr as (p: number, v: number, k: number) => number;
      for (let i = 0; i < arena.varCount; i++) {
        if (arena.isVarRemoved(i)) continue;
        const v = arena.getVarVariability(i);
        if (v !== Variability.Constant && v !== Variability.Parameter) continue;
        const wasmBind = getAttr(arena.ptr, i, 7 /* VarAttrKind.Binding */) >>> 0;
        if (wasmBind !== 0xffffffff && wasmBind < arena.exprCount && wasmBind !== arena.getVarExpression(i)) {
          arena.setVarExpression(i, wasmBind);
        }
      }
    }
    const extMeta = (arena as { extensionMetadata?: Record<string, unknown> }).extensionMetadata;
    const hasEvalParams =
      extMeta?.["evaluatedParams"] instanceof Set && (extMeta["evaluatedParams"] as Set<string>).size > 0;
    if (!omcCompatibility && wasmFolded > 0 && arena.stmtCount === 0 && !extMeta?.["isOldFrontend"] && !hasEvalParams) {
      return wasmFolded;
    }
  }

  // Residual TypeScript pass handles fixed=false parameters, arrays, strings, records, statements, and Salsa db functions

  const nameToIdx = new Map<string, number>();
  const bindingIndices: number[] = [];
  const attrVarIndices: number[] = [];
  for (let i = 0; i < arena.varCount; i++) {
    if (!arena.isVarRemoved(i)) {
      const name = arena.getVarName(i);
      nameToIdx.set(name, i);
      const v = arena.getVarVariability(i);
      const exprId = arena.getVarExpression(i);
      if (v === Variability.Constant || v === Variability.Parameter || (exprId !== undefined && exprId >= 0)) {
        bindingIndices.push(i);
      }
      if (arena.getVarAttrExprIds(i) !== undefined) {
        attrVarIndices.push(i);
      }
    }
  }

  const pendingRecordPrefixes = new Set<string>();
  for (let eq = 0; eq < arena.eqCount; eq++) {
    if (arena.isEqRemoved(eq) || arena.getEqKind(eq) !== EqKind.Simple) continue;
    const l = arena.getEqLhs(eq);
    const r = arena.getEqRhs(eq);
    if (l < 0 || r < 0) continue;
    if (arena.getExprKind(l) === ExprKind.Name && arena.getExprKind(r) === ExprKind.Call) {
      const recName = arena.interner.resolve(arena.getExprData1(l));
      if (recName && !nameToIdx.has(recName)) {
        pendingRecordPrefixes.add(recName);
      }
    }
  }
  const isPendingRecordField = (varName: string): boolean => {
    if (pendingRecordPrefixes.size === 0) return false;
    for (const rec of pendingRecordPrefixes) {
      if (varName.startsWith(`${rec}.`) || varName.startsWith(`${rec}[`)) return true;
    }
    return false;
  };

  const isOldFrontendFold = Boolean(
    (arena as { extensionMetadata?: Record<string, unknown> }).extensionMetadata?.["isOldFrontend"],
  );
  const evalParamsMeta = (arena as { extensionMetadata?: Record<string, unknown> }).extensionMetadata?.[
    "evaluatedParams"
  ] as Set<string> | undefined;
  const filteredEvalMeta = evalParamsMeta ? [...evalParamsMeta].filter((n) => !isPendingRecordField(n)) : [];
  const forwardEvalNames = new Set<string>(filteredEvalMeta);
  const evaluatedParamNames = new Set<string>(filteredEvalMeta);
  if (!isOldFrontendFold) {
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      if (arena.getVarVariability(i) === Variability.Parameter && arena.isVarEvaluate(i)) {
        const pname = arena.getVarName(i);
        if (isPendingRecordField(pname)) continue;
        forwardEvalNames.add(pname);
        evaluatedParamNames.add(pname);
        if (!arena.isVarFinal(i)) {
          arena.setVarFinal(i, true);
        }
      }
    }
    if (evaluatedParamNames.size > 0) {
      const collectExprVarNames = (exprId: number, out: Set<string>, depth = 0): void => {
        if (exprId < 0 || depth > 64) return;
        const kind = arena.getExprKind(exprId);
        switch (kind) {
          case ExprKind.Name: {
            const n = arena.interner.resolve(arena.getExprData1(exprId));
            if (n) out.add(n);
            break;
          }
          case ExprKind.Binary:
            collectExprVarNames(arena.getExprLeft(exprId), out, depth + 1);
            collectExprVarNames(arena.getExprRight(exprId), out, depth + 1);
            break;
          case ExprKind.Unary:
          case ExprKind.Negate:
            collectExprVarNames(arena.getExprLeft(exprId), out, depth + 1);
            break;
          case ExprKind.Der:
          case ExprKind.Pre:
            collectExprVarNames(arena.getExprData1(exprId), out, depth + 1);
            break;
          case ExprKind.Range: {
            collectExprVarNames(arena.getExprData1(exprId), out, depth + 1);
            const rStep = arena.getExprLeft(exprId);
            if (rStep >= 0) collectExprVarNames(rStep, out, depth + 1);
            collectExprVarNames(arena.getExprRight(exprId), out, depth + 1);
            break;
          }
          case ExprKind.IfElse:
            collectExprVarNames(arena.getExprData1(exprId), out, depth + 1);
            collectExprVarNames(arena.getExprLeft(exprId), out, depth + 1);
            collectExprVarNames(arena.getExprRight(exprId), out, depth + 1);
            break;
          case ExprKind.Call: {
            const argc = arena.getExprRight(exprId);
            for (let a = 0; a < argc; a++) {
              const aId = a === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + a);
              collectExprVarNames(aId, out, depth + 1);
            }
            break;
          }
          case ExprKind.Subscript: {
            const baseId = arena.getExprData1(exprId);
            const subCount = arena.getExprRight(exprId);
            collectExprVarNames(baseId, out, depth + 1);
            for (let s = 0; s < subCount; s++) {
              const sId = s === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + s);
              collectExprVarNames(sId, out, depth + 1);
            }
            break;
          }
          case ExprKind.ArrayCtor: {
            const count = arena.getExprData1(exprId);
            const redirect = arena.getExprRight(exprId);
            const base = redirect >= 0 ? redirect : exprId;
            for (let e = 0; e < count; e++) {
              const elemId = e === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(base + e);
              collectExprVarNames(elemId, out, depth + 1);
            }
            break;
          }
          default:
            break;
        }
      };

      const expandNameRefs = (refs: Set<string>): string[] => {
        const expanded: string[] = [];
        for (const r of refs) {
          if (nameToIdx.has(r)) {
            expanded.push(r);
          } else {
            const pfx = `${r}[`;
            for (const cand of nameToIdx.keys()) {
              if (cand.startsWith(pfx)) expanded.push(cand);
            }
          }
        }
        return expanded;
      };

      let evalPropagated = true;
      let evalPass = 0;
      while (evalPropagated && evalPass < 16) {
        evalPropagated = false;
        evalPass++;
        for (const i of bindingIndices) {
          if (arena.isVarRemoved(i)) continue;
          if (arena.getVarVariability(i) !== Variability.Parameter || !arena.isVarFixed(i)) continue;
          const exprId = arena.getVarExpression(i);
          if (exprId === undefined || exprId < 0) continue;
          const name = arena.getVarName(i);
          const refs = new Set<string>();
          collectExprVarNames(exprId, refs);
          if (refs.size === 0) continue;
          const expandedRefs = expandNameRefs(refs);
          if (evaluatedParamNames.has(name)) {
            for (const r of expandedRefs) {
              const rIdx = nameToIdx.get(r);
              if (
                rIdx !== undefined &&
                arena.getVarVariability(rIdx) === Variability.Parameter &&
                arena.isVarFixed(rIdx) &&
                (arena.getVarExpression(rIdx) ?? -1) >= 0
              ) {
                if (!arena.isVarFinal(rIdx)) arena.setVarFinal(rIdx, true);
                if (!evaluatedParamNames.has(r)) {
                  evaluatedParamNames.add(r);
                  forwardEvalNames.add(r);
                  evalPropagated = true;
                } else if (!forwardEvalNames.has(r)) {
                  forwardEvalNames.add(r);
                  evalPropagated = true;
                }
              }
            }
          } else {
            // Forward Evaluate propagation: fixed Parameter whose binding depends solely on Constants + evaluated params
            let allKnown = true;
            let hasEvalDep = false;
            for (const rawRef of refs) {
              if (rawRef === "time") {
                allKnown = false;
                break;
              }
              const rawIdx = nameToIdx.get(rawRef);
              if (rawIdx !== undefined) {
                const rv = arena.getVarVariability(rawIdx);
                if (rv === Variability.Constant) continue;
                if (rv === Variability.Parameter && forwardEvalNames.has(rawRef)) {
                  hasEvalDep = true;
                  continue;
                }
                allKnown = false;
                break;
              }
              const arrPfx = `${rawRef}[`;
              let matchedElem = false;
              for (const [cand, cIdx] of nameToIdx) {
                if (!cand.startsWith(arrPfx)) continue;
                matchedElem = true;
                const cv = arena.getVarVariability(cIdx);
                if (cv === Variability.Constant) continue;
                if (cv === Variability.Parameter && forwardEvalNames.has(cand)) {
                  hasEvalDep = true;
                  continue;
                }
                allKnown = false;
                break;
              }
              if (!matchedElem || !allKnown) {
                allKnown = false;
                break;
              }
            }
            if (
              allKnown &&
              hasEvalDep &&
              arena.getExprKind(exprId) === ExprKind.Name &&
              (arena.getVarType(i) !== VarType.Real || arena.isVarFinal(i))
            ) {
              if (!arena.isVarFinal(i)) arena.setVarFinal(i, true);
              forwardEvalNames.add(name);
              evaluatedParamNames.add(name);
              evalPropagated = true;
            }
          }
        }
      }
    }
  }

  const paramMap: ArenaFoldParamMap = new Map<string, ArenaConstantValue>();
  const constMap: ArenaFoldParamMap = new Map<string, ArenaConstantValue>();
  const finalParamOrConstMap: ArenaFoldParamMap = new Map<string, ArenaConstantValue>();
  const rootShortClassName = arena.name ? arena.name.split(".").pop()! : "";
  const computeInstanceName = (fullName: string): string => {
    if (!rootShortClassName) return "";
    const lastDot = fullName.lastIndexOf(".");
    return lastDot > 0 ? `${rootShortClassName}.${fullName.slice(0, lastDot)}` : rootShortClassName;
  };

  let changed = true;
  let iterations = 0;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // 1. Update parameter map from current constant and parameter variables
    paramMap.clear();
    const bindMemo: Map<number, ArenaConstantValue> = (paramMap._bindMemo ??= new Map());
    bindMemo.clear();
    constMap.clear();
    finalParamOrConstMap.clear();
    for (const i of bindingIndices) {
      if (arena.isVarRemoved(i)) continue;
      const v = arena.getVarVariability(i);
      const name = arena.getVarName(i);
      if (isPendingRecordField(name)) continue;
      if (v === Variability.Discrete || (arena.getVarCausality(i) === Causality.Input && !name.includes("."))) {
        continue;
      }
      if (v === Variability.Parameter && !arena.isVarFixed(i)) {
        continue;
      }
      const exprId = arena.getVarExpression(i);
      if (typeof exprId === "number" && exprId >= 0) {
        paramMap._instanceName = computeInstanceName(name);
        const evalVal = evaluateConstantArenaExpression(arena, exprId, paramMap, nameToIdx, 0, db, scopeId);
        if (evalVal !== null) {
          let foldedValue: ArenaConstantValue | null = evalVal;
          const match = name.match(/\[([\d,]+)\]$/);
          if (match && Array.isArray(foldedValue)) {
            const indices = match[1]!.split(",").map(Number);
            let current: ArenaConstantValue | undefined = foldedValue;
            for (const idx of indices) {
              if (Array.isArray(current) && idx >= 1 && idx <= current.length) {
                current = current[idx - 1];
              } else {
                foldedValue = null;
                break;
              }
            }
            if (foldedValue !== null) {
              foldedValue = current ?? null;
            }
          }
          const canFoldFinalParam =
            v === Variability.Constant ||
            (v === Variability.Parameter &&
              arena.isVarFinal(i) &&
              evaluateConstantArenaExpression(arena, exprId, finalParamOrConstMap, nameToIdx, 0, db, scopeId, true) !==
                null);
          if (typeof foldedValue === "number") {
            paramMap.set(name, foldedValue);
            if (v === Variability.Constant) constMap.set(name, foldedValue);
            if (canFoldFinalParam) {
              finalParamOrConstMap.set(name, foldedValue);
            }
            if (arena.getVarStartValue(i) !== foldedValue) {
              arena.setVarStartValue(i, foldedValue);
              changed = true;
            }
            continue;
          } else if (typeof foldedValue === "boolean") {
            const numVal = foldedValue ? 1.0 : 0.0;
            paramMap.set(name, numVal);
            if (v === Variability.Constant) constMap.set(name, numVal);
            if (canFoldFinalParam) {
              finalParamOrConstMap.set(name, numVal);
            }
            if (arena.getVarStartValue(i) !== numVal) {
              arena.setVarStartValue(i, numVal);
              changed = true;
            }
            continue;
          } else if (typeof foldedValue === "string") {
            paramMap.set(name, foldedValue);
            if (v === Variability.Constant) constMap.set(name, foldedValue);
            if (canFoldFinalParam) {
              finalParamOrConstMap.set(name, foldedValue);
            }
            continue;
          }
        }
      }
      if (v === Variability.Constant) {
        if (arena.getVarType(i) !== VarType.String && arena.hasExplicitVarExpression(i)) {
          paramMap.set(name, arena.getVarStartValue(i));
          constMap.set(name, arena.getVarStartValue(i));
          finalParamOrConstMap.set(name, arena.getVarStartValue(i));
        }
      } else if (
        v === Variability.Parameter &&
        arena.isVarFinal(i) &&
        (typeof exprId !== "number" || exprId < 0) &&
        arena.hasExplicitVarExpression(i)
      ) {
        finalParamOrConstMap.set(name, arena.getVarStartValue(i));
      }
    }

    // 2. Fold variable binding expressions
    const loopConstPlusEvalMap =
      !isOldFrontendFold && evaluatedParamNames.size > 0
        ? new Map<string, ArenaConstantValue>([
            ...constMap,
            ...[...paramMap.entries()].filter(([k]) => evaluatedParamNames.has(k)),
          ])
        : constMap;
    for (const i of bindingIndices) {
      if (arena.isVarRemoved(i)) continue;
      if (isPendingRecordField(arena.getVarName(i))) continue;
      const v = arena.getVarVariability(i);
      if (v !== Variability.Constant && v !== Variability.Parameter && !omcCompatibility) continue;
      if (v === Variability.Parameter && !arena.isVarFixed(i)) continue;

      const exprId = arena.getExplicitVarExpression(i);
      if (exprId !== undefined && exprId >= 0) {
        const isFinalParamNewInst =
          omcCompatibility &&
          v === Variability.Parameter &&
          (arena.isVarFinal(i) || arena.isVarProtected(i)) &&
          !arena.extensionMetadata?.["isOldFrontend"];
        const evalVal = evaluateConstantArenaExpression(
          arena,
          exprId,
          isFinalParamNewInst ? finalParamOrConstMap : omcCompatibility ? loopConstPlusEvalMap : paramMap,
          nameToIdx,
          0,
          db,
          scopeId,
          omcCompatibility,
        );
        if (evalVal !== null) {
          let foldedValue: ArenaConstantValue | null = evalVal;
          const match = arena.getVarName(i).match(/\[([\d,]+)\]$/);
          if (match && Array.isArray(foldedValue)) {
            const indices = match[1]!.split(",").map(Number);
            let current: ArenaConstantValue | undefined = foldedValue;
            for (const idx of indices) {
              if (Array.isArray(current) && idx >= 1 && idx <= current.length) {
                current = current[idx - 1];
              } else {
                foldedValue = null;
                break;
              }
            }
            if (foldedValue !== null) {
              foldedValue = current ?? null;
            }
          }
          if (typeof foldedValue === "number") {
            const vType = arena.getVarType(i);
            if (vType === VarType.Boolean) {
              const litId = arena.addExpression(ExprKind.BoolLiteral, foldedValue !== 0 ? 1 : 0);
              arena.setVarExpression(i, litId);
            } else if (vType !== VarType.Enumeration) {
              const litId =
                vType === VarType.Integer ? arena.addIntLiteral(foldedValue) : arena.addRealLiteral(foldedValue);
              arena.setVarExpression(i, litId);
            }
            if (arena.getVarStartValue(i) !== foldedValue) {
              arena.setVarStartValue(i, foldedValue);
              changed = true;
            }
            paramMap.set(arena.getVarName(i), foldedValue);
            if (v === Variability.Constant) constMap.set(arena.getVarName(i), foldedValue);
            if (v === Variability.Constant || (v === Variability.Parameter && arena.isVarFinal(i))) {
              finalParamOrConstMap.set(arena.getVarName(i), foldedValue);
            }
          } else if (typeof foldedValue === "boolean") {
            const litId = arena.addExpression(ExprKind.BoolLiteral, foldedValue ? 1 : 0);
            arena.setVarExpression(i, litId);
            const numVal = foldedValue ? 1.0 : 0.0;
            if (arena.getVarStartValue(i) !== numVal) {
              arena.setVarStartValue(i, numVal);
              changed = true;
            }
            paramMap.set(arena.getVarName(i), numVal);
            if (v === Variability.Constant) constMap.set(arena.getVarName(i), numVal);
            if (v === Variability.Constant || (v === Variability.Parameter && arena.isVarFinal(i))) {
              finalParamOrConstMap.set(arena.getVarName(i), numVal);
            }
          } else if (typeof foldedValue === "string") {
            const litId = arena.addStringLiteral(foldedValue);
            arena.setVarExpression(i, litId);
            paramMap.set(arena.getVarName(i), foldedValue);
            if (v === Variability.Constant) constMap.set(arena.getVarName(i), foldedValue);
            if (v === Variability.Constant || (v === Variability.Parameter && arena.isVarFinal(i))) {
              finalParamOrConstMap.set(arena.getVarName(i), foldedValue);
            }
          } else if (!match && Array.isArray(foldedValue) && arena.getExprKind(exprId) !== ExprKind.ArrayCtor) {
            const arrExpr = arrayValueToArenaExpr(arena, foldedValue, arena.getVarType(i));
            if (arrExpr !== exprId) {
              arena.setVarExpression(i, arrExpr);
              changed = true;
            }
          }
        } else if (arena.getExprKind(exprId) === ExprKind.Subscript) {
          const subbed = substituteArenaConstants(arena, exprId, constMap, nameToIdx);
          if (subbed !== exprId) {
            arena.setVarExpression(i, subbed);
            changed = true;
          }
        }
      }
    }

    // Fold variable attributes (e.g. start = x0[1])
    const isOldFrontend = Boolean(arena.extensionMetadata?.["isOldFrontend"]);
    for (const i of attrVarIndices) {
      if (arena.isVarRemoved(i)) continue;
      const attrs = arena.getVarAttrExprIds(i);
      if (!attrs) continue;
      const vAttr = arena.getVarVariability(i);
      const hasConstOrParamBinding =
        (vAttr === Variability.Constant || (vAttr === Variability.Parameter && arena.isVarFixed(i))) &&
        (arena.getVarExpression(i) ?? -1) >= 0;
      for (const [attrName, attrExprId] of attrs.entries()) {
        if (attrExprId >= 0) {
          if (attrName === "start" && attrExprId === arena.getVarExpression(i)) {
            continue;
          }
          if (attrName === "start" && !hasConstOrParamBinding) {
            const numStartVal = evaluateConstantArenaExpression(
              arena,
              attrExprId,
              paramMap,
              nameToIdx,
              0,
              db,
              scopeId,
              false,
            );
            if (
              typeof numStartVal === "number" &&
              Number.isFinite(numStartVal) &&
              arena.getVarStartValue(i) !== numStartVal
            ) {
              arena.setVarStartValue(i, numStartVal);
            }
          }
          if (omcCompatibility) {
            if (attrName === "start" && isOldFrontend && arena.getExprKind(attrExprId) === ExprKind.Binary) {
              continue;
            }
            if (
              arena.getExprKind(attrExprId) === ExprKind.Name &&
              (attrName === "start" ||
                (isOldFrontend && (attrName === "nominal" || attrName === "min" || attrName === "max")))
            ) {
              const refName = arena.interner.resolve(arena.getExprData1(attrExprId));
              const refIdx = refName ? nameToIdx.get(refName) : undefined;
              if (
                refIdx !== undefined &&
                arena.getVarVariability(refIdx) === Variability.Parameter &&
                (!arena.isVarFinal(refIdx) || isOldFrontend)
              ) {
                continue;
              }
            }
          }
          const isIfAttr =
            omcCompatibility &&
            arena.getExprKind(attrExprId) === ExprKind.IfElse &&
            attrName !== "fixed" &&
            attrName !== "stateSelect";
          const attrFoldMap = isIfAttr ? (isOldFrontend ? constMap : finalParamOrConstMap) : paramMap;
          const evalVal = evaluateConstantArenaExpression(arena, attrExprId, attrFoldMap, nameToIdx, 0, db, scopeId);
          if (evalVal !== null && !isExprAlreadyLiteral(arena, attrExprId, evalVal)) {
            const varType = arena.getVarType(i);
            const ssLiterals = ["never", "avoid", "default", "prefer", "always"];
            let literalId: number;
            if (
              attrName === "stateSelect" &&
              typeof evalVal === "number" &&
              evalVal >= 1 &&
              evalVal <= ssLiterals.length
            ) {
              literalId = arena.addEnumLiteral(evalVal, `StateSelect.${ssLiterals[evalVal - 1]}`);
            } else if (attrName === "fixed" && (typeof evalVal === "boolean" || typeof evalVal === "number")) {
              literalId = arena.addBoolLiteral(Boolean(evalVal));
            } else if (varType === VarType.Integer && typeof evalVal === "number") {
              literalId = arena.addIntLiteral(Math.trunc(evalVal));
            } else if (varType === VarType.Boolean && typeof evalVal === "boolean") {
              literalId = arena.addBoolLiteral(evalVal);
            } else if (varType === VarType.Enumeration) {
              continue;
            } else if (typeof evalVal === "number") {
              literalId = arena.addRealLiteral(evalVal);
            } else {
              continue;
            }
            if (literalId !== attrExprId) {
              if (
                omcCompatibility &&
                !isOldFrontendFold &&
                (attrName === "min" || attrName === "max") &&
                arena.isVarFlow(i) &&
                arena.getExprKind(attrExprId) === ExprKind.IfElse
              ) {
                const collectCondRefs = (eId: number, visitedSet: Set<number>, depth = 0): void => {
                  if (eId < 0 || eId >= arena.exprCount || depth > 24 || visitedSet.has(eId)) return;
                  visitedSet.add(eId);
                  const k = arena.getExprKind(eId);
                  if (k === ExprKind.Name) {
                    const refName = arena.interner.resolve(arena.getExprData1(eId));
                    const rIdx = refName ? nameToIdx.get(refName) : undefined;
                    if (
                      refName &&
                      rIdx !== undefined &&
                      !arena.isVarRemoved(rIdx) &&
                      arena.getVarVariability(rIdx) === Variability.Parameter &&
                      arena.getVarType(rIdx) !== VarType.Real
                    ) {
                      if (!arena.isVarFinal(rIdx)) arena.setVarFinal(rIdx, true);
                      evaluatedParamNames.add(refName);
                      const rb = arena.getVarExpression(rIdx);
                      if (typeof rb === "number" && rb >= 0) collectCondRefs(rb, visitedSet, depth + 1);
                    }
                    return;
                  }
                  if (k === ExprKind.Binary) {
                    collectCondRefs(arena.getExprLeft(eId), visitedSet, depth + 1);
                    collectCondRefs(arena.getExprRight(eId), visitedSet, depth + 1);
                  } else if (k === ExprKind.Unary || k === ExprKind.Negate) {
                    collectCondRefs(arena.getExprLeft(eId), visitedSet, depth + 1);
                  } else if (k === ExprKind.IfElse) {
                    collectCondRefs(arena.getExprData1(eId), visitedSet, depth + 1);
                    collectCondRefs(arena.getExprLeft(eId), visitedSet, depth + 1);
                    collectCondRefs(arena.getExprRight(eId), visitedSet, depth + 1);
                  } else if (k === ExprKind.Call) {
                    const argc = arena.getExprRight(eId);
                    for (let a = 0; a < argc; a++) {
                      const aId = a === 0 ? arena.getExprLeft(eId) : arena.getExprLeft(eId + a);
                      collectCondRefs(aId, visitedSet, depth + 1);
                    }
                  } else if (k === ExprKind.Subscript) {
                    collectCondRefs(arena.getExprData1(eId), visitedSet, depth + 1);
                    const sc = arena.getExprRight(eId);
                    for (let s = 0; s < sc; s++) {
                      const sId = s === 0 ? arena.getExprLeft(eId) : arena.getExprLeft(eId + s);
                      collectCondRefs(sId, visitedSet, depth + 1);
                    }
                  }
                };
                collectCondRefs(arena.getExprData1(attrExprId), new Set<number>());
              }
              arena.setVarAttr(i, attrName, literalId);
              if (attrName === "fixed") {
                arena.setVarFixed(i, Boolean(evalVal));
              } else if (
                attrName === "start" &&
                !hasConstOrParamBinding &&
                typeof evalVal === "number" &&
                Number.isFinite(evalVal)
              ) {
                arena.setVarStartValue(i, evalVal);
              }
              changed = true;
            }
          } else if (isIfAttr) {
            const subId = substituteArenaConstants(arena, attrExprId, constMap, nameToIdx);
            if (subId !== attrExprId) {
              arena.setVarAttr(i, attrName, subId);
              changed = true;
            }
          }
        }
      }
    }
  }

  // 3. Fold equations once after variable parameters/constants have converged
  const constPlusEvalMap: ArenaFoldParamMap =
    !isOldFrontendFold && evaluatedParamNames.size > 0
      ? new Map<string, ArenaConstantValue>([
          ...constMap,
          ...[...paramMap.entries()].filter(([k]) => evaluatedParamNames.has(k)),
        ])
      : constMap;
  const eqFoldMap: ArenaFoldParamMap = omcCompatibility ? constPlusEvalMap : paramMap;
  const ifElseFoldMap: ArenaFoldParamMap = omcCompatibility ? constPlusEvalMap : paramMap;
  const eqSubMap: ArenaFoldParamMap = (arena as { extensionMetadata?: { evaluateAllParameters?: boolean } })
    .extensionMetadata?.evaluateAllParameters
    ? finalParamOrConstMap
    : constPlusEvalMap;
  const assertEvalMap = omcCompatibility && !isOldFrontendFold ? constPlusEvalMap : constMap;
  if (omcCompatibility && !isOldFrontendFold) {
    eqSubMap._allParamMap = paramMap;
    ifElseFoldMap._allParamMap = paramMap;
  }
  for (let eq = 0; eq < arena.eqCount; eq++) {
    const eqKind = arena.getEqKind(eq);
    if (eqKind === EqKind.Simple || eqKind === EqKind.InitialSimple || eqKind === EqKind.Array) {
      let lhsExpr = arena.getEqLhs(eq);
      let rhsExpr = arena.getEqRhs(eq);
      const eqLhsName =
        lhsExpr >= 0 && arena.getExprKind(lhsExpr) === ExprKind.Name
          ? arena.interner.resolve(arena.getExprData1(lhsExpr)) || ""
          : "";
      const eqInstName = computeInstanceName(eqLhsName);
      eqFoldMap._instanceName = eqInstName;
      eqSubMap._instanceName = eqInstName;
      const rhsKind = rhsExpr >= 0 ? arena.getExprKind(rhsExpr) : -1;
      const isCall =
        rhsKind === ExprKind.Call ||
        (rhsKind === ExprKind.Subscript &&
          arena.getExprKind(
            arena.getExprData1(rhsExpr) !== 0 ? arena.getExprData1(rhsExpr) : arena.getExprLeft(rhsExpr),
          ) === ExprKind.Call);
      const isGen = Boolean(arena.extensionMetadata?.["isGen"]);
      const currentEqFoldMap = isCall && (!omcCompatibility || isGen) ? paramMap : eqFoldMap;
      const currentOnlyConstants = isCall && (!omcCompatibility || isGen) ? false : omcCompatibility;
      const lhsKind = lhsExpr >= 0 ? arena.getExprKind(lhsExpr) : -1;
      if (
        rhsExpr >= 0 &&
        rhsKind !== ExprKind.EnumLiteral &&
        lhsKind !== ExprKind.EnumLiteral &&
        (arena.getExprKind(rhsExpr) !== ExprKind.ArrayCtor || !omcCompatibility || isCall)
      ) {
        let foldedRhs = evaluateConstantArenaExpression(
          arena,
          rhsExpr,
          currentEqFoldMap,
          nameToIdx,
          0,
          db,
          scopeId,
          currentOnlyConstants,
        );
        if (foldedRhs !== null) {
          let varType = VarType.Real;
          let skipScalarFold = false;
          if (lhsKind === ExprKind.Name) {
            const varName = arena.interner.resolve(arena.getExprData1(lhsExpr));
            let varIdx = nameToIdx
              ? (nameToIdx.get(varName) ?? nameToIdx.get(`${varName}[1]`) ?? nameToIdx.get(`${varName}[1,1]`))
              : arena.getVarIdxByName(varName) >= 0
                ? arena.getVarIdxByName(varName)
                : arena.getVarIdxByName(`${varName}[1]`);
            if (varIdx === undefined || varIdx < 0) {
              const prefixMatch = `${varName}[`;
              if (nameToIdx) {
                for (const [k, idx] of nameToIdx) {
                  if (k.startsWith(prefixMatch)) {
                    varIdx = idx;
                    break;
                  }
                }
              } else {
                for (let vi = 0; vi < arena.varCount; vi++) {
                  if (!arena.isVarRemoved(vi) && arena.getVarName(vi).startsWith(prefixMatch)) {
                    varIdx = vi;
                    break;
                  }
                }
              }
            }
            if (varIdx !== undefined && varIdx >= 0) {
              varType = arena.getVarType(varIdx);
            } else {
              skipScalarFold = true;
            }
          } else if (lhsKind === ExprKind.Tuple && isCall && Array.isArray(foldedRhs)) {
            const tupleCount = arena.getExprData1(lhsExpr);
            if (tupleCount > 0 && foldedRhs.length === tupleCount) {
              const outElems: number[] = [];
              let allValid = true;
              for (let ti = 0; ti < tupleCount; ti++) {
                const lhsElem = arena.getExprLeft(lhsExpr + ti);
                let elemType = VarType.Real;
                if (lhsElem >= 0 && arena.getExprKind(lhsElem) === ExprKind.Name) {
                  const elemName = arena.interner.resolve(arena.getExprData1(lhsElem));
                  if (elemName && elemName !== "_") {
                    const eIdx = nameToIdx
                      ? (nameToIdx.get(elemName) ??
                        nameToIdx.get(`${elemName}[1]`) ??
                        nameToIdx.get(`${elemName}[1,1]`))
                      : arena.getVarIdxByName(elemName) >= 0
                        ? arena.getVarIdxByName(elemName)
                        : arena.getVarIdxByName(`${elemName}[1]`);
                    if (eIdx !== undefined && eIdx >= 0) {
                      elemType = arena.getVarType(eIdx);
                    }
                  }
                }
                const fv = foldedRhs[ti];
                if (Array.isArray(fv)) {
                  outElems.push(arrayValueToArenaExpr(arena, fv, elemType));
                } else if (elemType === VarType.Boolean && typeof fv === "boolean") {
                  outElems.push(arena.addBoolLiteral(fv));
                } else if (elemType === VarType.Integer && typeof fv === "number" && Number.isFinite(fv)) {
                  outElems.push(arena.addIntLiteral(Math.trunc(fv)));
                } else if (elemType === VarType.String || typeof fv === "string") {
                  outElems.push(arena.addStringLiteral(String(fv)));
                } else if (typeof fv === "number" && Number.isFinite(fv)) {
                  outElems.push(arena.addRealLiteral(fv));
                } else if (typeof fv === "boolean") {
                  outElems.push(arena.addBoolLiteral(fv));
                } else {
                  allValid = false;
                  break;
                }
              }
              if (allValid && outElems.length === tupleCount) {
                let nonWildcardIdx = -1;
                let nonWildcardCount = 0;
                for (let ti = 0; ti < tupleCount; ti++) {
                  const lhsElem = arena.getExprLeft(lhsExpr + ti);
                  let isWild = lhsElem < 0;
                  if (!isWild && arena.getExprKind(lhsElem) === ExprKind.Name) {
                    const elemName = arena.interner.resolve(arena.getExprData1(lhsElem));
                    if (!elemName || elemName === "_") isWild = true;
                  }
                  if (!isWild) {
                    nonWildcardIdx = ti;
                    nonWildcardCount++;
                  }
                }
                if (nonWildcardCount === 1 && nonWildcardIdx >= 0) {
                  const singleLhs = arena.getExprLeft(lhsExpr + nonWildcardIdx);
                  const singleRhs = outElems[nonWildcardIdx]!;
                  arena.setEqLhs(eq, singleLhs);
                  arena.setEqRhs(eq, singleRhs);
                  rhsExpr = singleRhs;
                } else {
                  const tupleRhs = arena.addTupleExpr(outElems);
                  arena.setEqRhs(eq, tupleRhs);
                  rhsExpr = tupleRhs;
                }
              }
            }
            continue;
          } else if (lhsKind !== ExprKind.Subscript) {
            skipScalarFold = true;
          }

          if (!skipScalarFold && varType !== VarType.Enumeration && !isExprAlreadyLiteral(arena, rhsExpr, foldedRhs)) {
            let newRhs: number;
            if (Array.isArray(foldedRhs)) {
              newRhs =
                !isCall && !omcCompatibility && rhsKind === ExprKind.Binary
                  ? rhsExpr
                  : arrayValueToArenaExpr(arena, foldedRhs, varType);
            } else if (varType === VarType.Boolean && typeof foldedRhs === "boolean") {
              newRhs = arena.addBoolLiteral(foldedRhs);
            } else if (varType === VarType.Integer && typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
              newRhs = arena.addIntLiteral(Math.trunc(foldedRhs));
            } else if (varType === VarType.String || typeof foldedRhs === "string") {
              newRhs = arena.addStringLiteral(String(foldedRhs));
            } else if (typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
              newRhs = arena.addRealLiteral(foldedRhs);
            } else if (typeof foldedRhs === "boolean") {
              newRhs = arena.addBoolLiteral(foldedRhs);
            } else {
              newRhs = rhsExpr;
            }

            if (newRhs !== rhsExpr) {
              arena.setEqRhs(eq, newRhs);
              rhsExpr = newRhs;
            }
          }
        }
      }

      if (rhsExpr >= 0 && rhsKind !== ExprKind.EnumLiteral && lhsKind !== ExprKind.EnumLiteral) {
        const simplifiedRhs = simplifyArenaIfElse(arena, rhsExpr, ifElseFoldMap, nameToIdx, omcCompatibility);
        if (simplifiedRhs !== rhsExpr) {
          arena.setEqRhs(eq, simplifiedRhs);
          rhsExpr = simplifiedRhs;
        }
        const constSubRhs = substituteArenaConstants(arena, rhsExpr, eqSubMap, nameToIdx);
        if (constSubRhs !== rhsExpr) {
          arena.setEqRhs(eq, constSubRhs);
        }
        if (lhsKind !== ExprKind.Name && lhsKind !== ExprKind.Der) {
          const simplifiedLhs = simplifyArenaIfElse(arena, lhsExpr, ifElseFoldMap, nameToIdx, omcCompatibility);
          if (simplifiedLhs !== lhsExpr) {
            arena.setEqLhs(eq, simplifiedLhs);
            lhsExpr = simplifiedLhs;
          }
          const constSubLhs = substituteArenaConstants(arena, lhsExpr, eqSubMap, nameToIdx);
          if (constSubLhs !== lhsExpr) {
            arena.setEqLhs(eq, constSubLhs);
          }
        }
      }
    } else if (eqKind === EqKind.When) {
      const meta = arena.getWhenEquationMeta(eq);
      if (meta) {
        const foldWhenCond = (condExprId: number): number => {
          if (condExprId < 0) return condExprId;
          let cur = condExprId;
          const foldedCond = evaluateConstantArenaExpression(
            arena,
            cur,
            eqFoldMap,
            nameToIdx,
            0,
            db,
            scopeId,
            omcCompatibility,
          );
          if (typeof foldedCond === "boolean" && !isExprAlreadyLiteral(arena, cur, foldedCond)) {
            cur = arena.addBoolLiteral(foldedCond);
          }
          const simplified = simplifyArenaIfElse(arena, cur, ifElseFoldMap, nameToIdx, omcCompatibility);
          if (simplified !== cur) cur = simplified;
          const subbed = substituteArenaConstants(arena, cur, eqSubMap, nameToIdx);
          if (subbed !== cur) cur = subbed;
          return cur;
        };
        const foldWhenBody = (list: { kind: EqKind; lhsExprId: number; rhsExprId: number }[]) => {
          for (const bodyEq of list) {
            if (bodyEq.kind !== EqKind.Simple) continue;
            if (bodyEq.rhsExprId >= 0) {
              const foldedRhs = evaluateConstantArenaExpression(
                arena,
                bodyEq.rhsExprId,
                eqFoldMap,
                nameToIdx,
                0,
                db,
                scopeId,
                omcCompatibility,
              );

              if (foldedRhs !== null && !isExprAlreadyLiteral(arena, bodyEq.rhsExprId, foldedRhs)) {
                let varType = VarType.Real;
                if (arena.getExprKind(bodyEq.lhsExprId) === ExprKind.Name) {
                  const varName = arena.interner.resolve(arena.getExprData1(bodyEq.lhsExprId));
                  const varIdx = nameToIdx.get(varName);
                  if (varIdx !== undefined) {
                    varType = arena.getVarType(varIdx);
                  }
                }

                let newRhs: number;
                if (Array.isArray(foldedRhs)) {
                  newRhs = arrayValueToArenaExpr(arena, foldedRhs, varType);
                } else if (varType === VarType.Boolean && typeof foldedRhs === "boolean") {
                  newRhs = arena.addBoolLiteral(foldedRhs);
                } else if (varType === VarType.Integer && typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
                  newRhs = arena.addIntLiteral(Math.trunc(foldedRhs));
                } else if (varType === VarType.String || typeof foldedRhs === "string") {
                  newRhs = arena.addStringLiteral(String(foldedRhs));
                } else if (typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
                  newRhs = arena.addRealLiteral(foldedRhs);
                } else if (typeof foldedRhs === "boolean") {
                  newRhs = arena.addBoolLiteral(foldedRhs);
                } else {
                  newRhs = bodyEq.rhsExprId;
                }

                if (newRhs !== bodyEq.rhsExprId) {
                  bodyEq.rhsExprId = newRhs;
                }
              }

              const simplifiedRhs = simplifyArenaIfElse(
                arena,
                bodyEq.rhsExprId,
                ifElseFoldMap,
                nameToIdx,
                omcCompatibility,
              );
              if (simplifiedRhs !== bodyEq.rhsExprId) {
                bodyEq.rhsExprId = simplifiedRhs;
              }
              const constSub = substituteArenaConstants(arena, bodyEq.rhsExprId, eqSubMap, nameToIdx);
              if (constSub !== bodyEq.rhsExprId) {
                bodyEq.rhsExprId = constSub;
              }
            }
          }
        };

        const newCond = foldWhenCond(meta.conditionExprId);
        if (newCond !== meta.conditionExprId) {
          meta.conditionExprId = newCond;
          arena.setEqLhs(eq, newCond);
        }
        foldWhenBody(meta.bodyEquations);
        for (const ew of meta.elseWhenClauses) {
          ew.conditionExprId = foldWhenCond(ew.conditionExprId);
          foldWhenBody(ew.bodyEquations);
        }
        if (meta.elseEquations) {
          foldWhenBody(meta.elseEquations);
        }
      }
    } else if (eqKind === EqKind.If) {
      const meta = arena.getIfEquationMeta(eq);
      if (meta) {
        const foldIfCond = (condExprId: number): number => {
          if (condExprId < 0) return condExprId;
          let cur = simplifyArenaIfElse(arena, condExprId, ifElseFoldMap, nameToIdx, omcCompatibility);
          cur = substituteArenaConstants(arena, cur, eqSubMap, nameToIdx);
          const v = evaluateConstantArenaExpression(arena, cur, eqFoldMap, nameToIdx, 0, db, scopeId, omcCompatibility);
          if (typeof v === "boolean") return arena.addBoolLiteral(v);
          return cur;
        };
        const foldEqList = (list: StructuredBodyEquation[]) => {
          for (let bi = list.length - 1; bi >= 0; bi--) {
            const bodyEq = list[bi]!;
            if (bodyEq.kind === EqKind.If) {
              if (bodyEq.lhsExprId >= 0) {
                bodyEq.lhsExprId = foldIfCond(bodyEq.lhsExprId);
              }
              if (Array.isArray(bodyEq.thenEquations)) foldEqList(bodyEq.thenEquations);
              for (const c of bodyEq.elseIfClauses || []) {
                if (c.conditionExprId >= 0) {
                  c.conditionExprId = foldIfCond(c.conditionExprId);
                }
                if (Array.isArray(c.bodyEquations)) foldEqList(c.bodyEquations);
              }
              if (Array.isArray(bodyEq.elseEquations)) foldEqList(bodyEq.elseEquations);
              continue;
            }
            if (bodyEq.kind === EqKind.FunctionCall || bodyEq.kind === EqKind.InitialFunctionCall) {
              if (bodyEq.lhsExprId >= 0) {
                const subCall = substituteArenaConstants(arena, bodyEq.lhsExprId, eqSubMap, nameToIdx);
                if (subCall !== bodyEq.lhsExprId) bodyEq.lhsExprId = subCall;
                if (arena.getExprKind(bodyEq.lhsExprId) === ExprKind.Call) {
                  const fnName = arena.interner.resolve(arena.getExprData1(bodyEq.lhsExprId));
                  if (fnName === "assert" && arena.getExprRight(bodyEq.lhsExprId) >= 2) {
                    const condVal = evaluateConstantArenaExpression(
                      arena,
                      arena.getExprLeft(bodyEq.lhsExprId),
                      assertEvalMap,
                      nameToIdx,
                      0,
                      db,
                      scopeId,
                      omcCompatibility,
                    );
                    if (condVal === true) {
                      list.splice(bi, 1);
                    }
                  }
                }
              }
              continue;
            }
            if (bodyEq.kind !== EqKind.Simple && bodyEq.kind !== EqKind.InitialSimple) continue;
            if (bodyEq.rhsExprId >= 0) {
              let foldedRhs = evaluateConstantArenaExpression(
                arena,
                bodyEq.rhsExprId,
                eqFoldMap,
                nameToIdx,
                0,
                db,
                scopeId,
                omcCompatibility,
              );

              if (foldedRhs !== null && !isExprAlreadyLiteral(arena, bodyEq.rhsExprId, foldedRhs)) {
                let varType = VarType.Real;
                if (arena.getExprKind(bodyEq.lhsExprId) === ExprKind.Name) {
                  const varName = arena.interner.resolve(arena.getExprData1(bodyEq.lhsExprId));
                  const varIdx = nameToIdx.get(varName);
                  if (varIdx !== undefined) {
                    varType = arena.getVarType(varIdx);
                  }
                }

                let newRhs: number;
                if (Array.isArray(foldedRhs)) {
                  newRhs = arrayValueToArenaExpr(arena, foldedRhs, varType);
                } else if (varType === VarType.Boolean && typeof foldedRhs === "boolean") {
                  newRhs = arena.addBoolLiteral(foldedRhs);
                } else if (varType === VarType.Integer && typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
                  newRhs = arena.addIntLiteral(Math.trunc(foldedRhs));
                } else if (varType === VarType.String || typeof foldedRhs === "string") {
                  newRhs = arena.addStringLiteral(String(foldedRhs));
                } else if (typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
                  newRhs = arena.addRealLiteral(foldedRhs);
                } else if (typeof foldedRhs === "boolean") {
                  newRhs = arena.addBoolLiteral(foldedRhs);
                } else {
                  newRhs = bodyEq.rhsExprId;
                }

                if (newRhs !== bodyEq.rhsExprId) {
                  bodyEq.rhsExprId = newRhs;
                }
              }

              const simplifiedRhs = simplifyArenaIfElse(
                arena,
                bodyEq.rhsExprId,
                ifElseFoldMap,
                nameToIdx,
                omcCompatibility,
              );
              if (simplifiedRhs !== bodyEq.rhsExprId) {
                bodyEq.rhsExprId = simplifiedRhs;
              }
              const constSub = substituteArenaConstants(arena, bodyEq.rhsExprId, eqSubMap, nameToIdx);
              if (constSub !== bodyEq.rhsExprId) {
                bodyEq.rhsExprId = constSub;
              }
            }
          }
        };
        if (meta.conditionExprId >= 0) {
          const fc = foldIfCond(meta.conditionExprId);
          if (fc !== meta.conditionExprId) {
            meta.conditionExprId = fc;
            arena.setEqLhs(eq, fc);
          }
        }
        foldEqList(meta.thenEquations);
        for (const clause of meta.elseIfClauses) {
          if (clause.conditionExprId >= 0) {
            clause.conditionExprId = foldIfCond(clause.conditionExprId);
          }
          foldEqList(clause.bodyEquations);
        }
        if (meta.elseEquations) {
          foldEqList(meta.elseEquations);
        }
      }
    } else if (eqKind === EqKind.For || eqKind === EqKind.InitialFor) {
      const meta = arena.getForEquationMeta(eq);
      if (meta) {
        if (meta.rangeExprId >= 0) {
          const constSubRange = substituteArenaConstants(arena, meta.rangeExprId, eqSubMap, nameToIdx);
          if (constSubRange !== meta.rangeExprId) {
            meta.rangeExprId = constSubRange;
          }
        }
        const foldForEqList = (list: StructuredBodyEquation[]) => {
          for (const bodyEq of list) {
            if (bodyEq.kind === EqKind.If) {
              if (Array.isArray(bodyEq.thenEquations)) foldForEqList(bodyEq.thenEquations);
              for (const c of bodyEq.elseIfClauses || []) {
                if (Array.isArray(c.bodyEquations)) foldForEqList(c.bodyEquations);
              }
              if (Array.isArray(bodyEq.elseEquations)) foldForEqList(bodyEq.elseEquations);
              continue;
            }
            if (
              (bodyEq.kind === EqKind.For || bodyEq.kind === EqKind.InitialFor) &&
              Array.isArray(bodyEq.bodyEquations)
            ) {
              if (bodyEq.rhsExprId >= 0) {
                bodyEq.rhsExprId = substituteArenaConstants(arena, bodyEq.rhsExprId, eqSubMap, nameToIdx);
              }
              foldForEqList(bodyEq.bodyEquations);
              continue;
            }
            if (bodyEq.lhsExprId >= 0) {
              bodyEq.lhsExprId = substituteArenaConstants(arena, bodyEq.lhsExprId, eqSubMap, nameToIdx);
            }
            if (bodyEq.rhsExprId >= 0) {
              bodyEq.rhsExprId = substituteArenaConstants(arena, bodyEq.rhsExprId, eqSubMap, nameToIdx);
            }
          }
        };
        foldForEqList(meta.bodyEquations);
      }
    } else if (eqKind === EqKind.FunctionCall || eqKind === EqKind.InitialFunctionCall) {
      let callId = arena.getEqLhs(eq);
      if (callId >= 0) {
        let curCall = simplifyArenaIfElse(arena, callId, ifElseFoldMap, nameToIdx, omcCompatibility);
        curCall = substituteArenaConstants(arena, curCall, eqSubMap, nameToIdx);
        if (curCall !== callId) {
          arena.setEqLhs(eq, curCall);
          callId = curCall;
        }
        if (arena.getExprKind(callId) === ExprKind.Call) {
          const fnName = arena.interner.resolve(arena.getExprData1(callId));
          if (fnName === "assert" && arena.getExprRight(callId) >= 2) {
            if (omcCompatibility && !isOldFrontendFold && arena.getExprRight(callId) >= 3) {
              const levelArg = arena.getExprLeft(callId + 2);
              if (levelArg >= 0 && arena.getExprKind(levelArg) === ExprKind.Name) {
                const levelName = arena.interner.resolve(arena.getExprData1(levelArg));
                let curIdx = levelName ? nameToIdx.get(levelName) : undefined;
                let resolvedEnumExpr = -1;
                for (let hop = 0; hop < 4 && curIdx !== undefined; hop++) {
                  if (
                    arena.getVarVariability(curIdx) !== Variability.Parameter ||
                    !arena.isVarFixed(curIdx) ||
                    arena.getVarType(curIdx) !== VarType.Enumeration
                  ) {
                    break;
                  }
                  if (!arena.isVarFinal(curIdx)) arena.setVarFinal(curIdx, true);
                  const bExpr = arena.getVarExpression(curIdx);
                  if (bExpr === undefined || bExpr < 0) break;
                  const bk = arena.getExprKind(bExpr);
                  if (bk === ExprKind.EnumLiteral) {
                    resolvedEnumExpr = bExpr;
                    break;
                  } else if (bk === ExprKind.Name) {
                    const nextName = arena.interner.resolve(arena.getExprData1(bExpr));
                    curIdx = nextName ? nameToIdx.get(nextName) : undefined;
                  } else {
                    break;
                  }
                }
                if (resolvedEnumExpr >= 0) {
                  const newArgs: number[] = [];
                  const argc = arena.getExprRight(callId);
                  for (let ai = 0; ai < argc; ai++) {
                    newArgs.push(ai === 2 ? resolvedEnumExpr : arena.getExprLeft(callId + ai));
                  }
                  callId = arena.addCallExpr(fnName, newArgs);
                  arena.setEqLhs(eq, callId);
                }
              }
            }
            const condArg = arena.getExprLeft(callId);
            const condVal = evaluateConstantArenaExpression(
              arena,
              condArg,
              assertEvalMap,
              nameToIdx,
              0,
              db,
              scopeId,
              omcCompatibility,
            );
            if (condVal === true) {
              arena.removeEquation(eq);
            }
          }
        }
      }
    }
  }

  // Fold constant expressions, evaluated parameters, and algorithm control expressions across statements,
  // respecting for-loop iterator shadowing of outer constants/parameters.
  const shadowedByStmt = new Map<number, ReadonlySet<string>>();
  const foldStmtAt = (s: number, activeSubMap: ArenaFoldParamLookup, shadowed: ReadonlySet<string>): number => {
    if (s < 0 || s >= arena.stmtCount) return s + 1;
    if (shadowed.size > 0) shadowedByStmt.set(s, shadowed);
    const sk = arena.getStmtKind(s);
    if (sk === StmtKind.For) {
      const rangeId = arena.getStmtLeft(s);
      if (rangeId >= 0) {
        const subRange = substituteArenaConstants(arena, rangeId, activeSubMap, nameToIdx);
        if (subRange !== rangeId) arena.setStmtLeft(s, subRange);
      }
      const indexNameRaw = arena.interner.resolve(arena.getStmtData1(s));
      const indexName = indexNameRaw?.startsWith("\0loop\0") ? indexNameRaw.substring(6) : indexNameRaw;
      let bodySubMap: ArenaFoldParamLookup = activeSubMap;
      let bodyShadowed = shadowed;
      if (indexName) {
        if (!shadowed.has(indexName)) {
          const nextShadowed = new Set(shadowed);
          nextShadowed.add(indexName);
          bodyShadowed = nextShadowed;
        }
        if (activeSubMap.has(indexName) || bodyShadowed !== shadowed) {
          const nextSubMap: ArenaFoldParamMap = new Map(activeSubMap);
          nextSubMap.delete(indexName);
          if (activeSubMap._allParamMap) nextSubMap._allParamMap = activeSubMap._allParamMap;
          nextSubMap._shadowed = bodyShadowed;
          bodySubMap = nextSubMap;
        }
      }
      const bodyCount = arena.getStmtRight(s);
      let next = s + 1;
      for (let i = 0; i < bodyCount && next < arena.stmtCount; i++) {
        next = foldStmtAt(next, bodySubMap, bodyShadowed);
      }
      return next;
    }
    if (sk === StmtKind.ProcedureCall) {
      const callId = arena.getStmtData1(s);
      if (callId >= 0) {
        let curCall = simplifyArenaIfElse(arena, callId, ifElseFoldMap, nameToIdx, omcCompatibility);
        curCall = substituteArenaConstants(arena, curCall, activeSubMap, nameToIdx);
        if (curCall !== callId) arena.setStmtData1(s, curCall);
      }
      return s + 1;
    }
    if (sk === StmtKind.If || sk === StmtKind.While || sk === StmtKind.When || sk === StmtKind.Block) {
      const condId = arena.getStmtData1(s);
      if (condId >= 0) {
        let curCond = simplifyArenaIfElse(arena, condId, ifElseFoldMap, nameToIdx, omcCompatibility);
        curCond = substituteArenaConstants(arena, curCond, activeSubMap, nameToIdx);
        if (curCond !== condId) arena.setStmtData1(s, curCond);
      }
      const childCount =
        sk === StmtKind.While || sk === StmtKind.Block
          ? arena.getStmtLeft(s)
          : arena.getStmtLeft(s) + arena.getStmtRight(s);
      let next = s + 1;
      for (let i = 0; i < childCount && next < arena.stmtCount; i++) {
        next = foldStmtAt(next, activeSubMap, shadowed);
      }
      return next;
    }
    if (sk === StmtKind.Assignment) {
      const rhsExpr = arena.getStmtLeft(s);
      if (rhsExpr >= 0) {
        let curRhs = simplifyArenaIfElse(arena, rhsExpr, ifElseFoldMap, nameToIdx, omcCompatibility);
        curRhs = substituteArenaConstants(arena, curRhs, activeSubMap, nameToIdx);
        if (curRhs !== rhsExpr) arena.setStmtLeft(s, curRhs);
      }
      return s + 1;
    }
    if (sk === StmtKind.ComplexAssignment) {
      const rhsExpr = arena.getStmtLeft(s);
      if (rhsExpr >= 0) {
        let curRhs = simplifyArenaIfElse(arena, rhsExpr, ifElseFoldMap, nameToIdx, omcCompatibility);
        curRhs = substituteArenaConstants(arena, curRhs, activeSubMap, nameToIdx);
        if (curRhs !== rhsExpr) arena.setStmtLeft(s, curRhs);
      }
      const tcount = arena.getStmtData1(s);
      return s + 1 + (tcount > 0 ? tcount : 0);
    }
    return s + 1;
  };

  for (let s = 0; s < arena.stmtCount;) {
    s = foldStmtAt(s, eqSubMap, new Set<string>());
  }

  // Fold constant function calls and constant array constructors in algorithm assignment statements
  for (const sec of arena.algorithmSections) {
    const end = sec.start + sec.count;
    for (let s = sec.start; s < end; s++) {
      if (arena.getStmtKind(s) !== StmtKind.Assignment) continue;
      const lhsExpr = arena.getStmtData1(s);
      const rhsExpr = arena.getStmtLeft(s);
      if (lhsExpr < 0 || rhsExpr < 0) continue;
      const rhsKind = arena.getExprKind(rhsExpr);
      if (rhsKind !== ExprKind.Call && rhsKind !== ExprKind.ArrayCtor) continue;
      const lhsKind = arena.getExprKind(lhsExpr);
      if (lhsKind !== ExprKind.Name && lhsKind !== ExprKind.Subscript) continue;
      const shadowed = shadowedByStmt.get(s);
      if (shadowed && shadowed.size > 0) {
        const exprRefsShadowed = (eId: number, depth = 0): boolean => {
          if (eId < 0 || depth > 32) return false;
          const ek = arena.getExprKind(eId);
          if (ek === ExprKind.Name) {
            const nm = arena.interner.resolve(arena.getExprData1(eId));
            return Boolean(nm && shadowed.has(nm));
          }
          if (ek === ExprKind.Call) {
            const argCount = arena.getExprRight(eId);
            for (let ai = 0; ai < argCount; ai++) {
              if (exprRefsShadowed(arena.getExprLeft(eId + ai), depth + 1)) return true;
            }
            return false;
          }
          if (ek === ExprKind.ArrayCtor) {
            const count = arena.getExprData1(eId);
            for (let ei = 0; ei < count; ei++) {
              if (exprRefsShadowed(arena.getExprLeft(eId + ei), depth + 1)) return true;
            }
            return false;
          }
          return (
            exprRefsShadowed(arena.getExprLeft(eId), depth + 1) || exprRefsShadowed(arena.getExprRight(eId), depth + 1)
          );
        };
        if (exprRefsShadowed(rhsExpr)) continue;
      }
      const foldedRhs = evaluateConstantArenaExpression(
        arena,
        rhsExpr,
        eqFoldMap,
        nameToIdx,
        0,
        db,
        scopeId,
        omcCompatibility,
      );
      if (foldedRhs === null || isExprAlreadyLiteral(arena, rhsExpr, foldedRhs)) continue;
      let varType = VarType.Real;
      if (lhsKind === ExprKind.Name) {
        const varName = arena.interner.resolve(arena.getExprData1(lhsExpr));
        const varIdx = nameToIdx.get(varName) ?? nameToIdx.get(`${varName}[1]`) ?? nameToIdx.get(`${varName}[1,1]`);
        if (varIdx !== undefined && varIdx >= 0) {
          varType = arena.getVarType(varIdx);
        }
      }
      if (varType === VarType.Enumeration) continue;
      let newRhs = rhsExpr;
      if (Array.isArray(foldedRhs)) {
        newRhs = arrayValueToArenaExpr(arena, foldedRhs, varType);
      } else if (varType === VarType.Boolean && typeof foldedRhs === "boolean") {
        newRhs = arena.addBoolLiteral(foldedRhs);
      } else if (varType === VarType.Integer && typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
        newRhs = arena.addIntLiteral(Math.trunc(foldedRhs));
      } else if (varType === VarType.String || typeof foldedRhs === "string") {
        newRhs = arena.addStringLiteral(String(foldedRhs));
      } else if (typeof foldedRhs === "number" && Number.isFinite(foldedRhs)) {
        newRhs = arena.addRealLiteral(foldedRhs);
      } else if (typeof foldedRhs === "boolean") {
        newRhs = arena.addBoolLiteral(foldedRhs);
      }
      if (newRhs !== rhsExpr) {
        arena.setStmtLeft(s, newRhs);
      }
    }
  }

  return iterations + (wasmFolded > 0 ? 1 : 0);
}
