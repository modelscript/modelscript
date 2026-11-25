// SPDX-License-Identifier: AGPL-3.0-or-later

import { ExprKind } from "@modelscript/dsl";
import {
  ArenaDAEPrinter,
  BinOp,
  Causality,
  DAEBuilder,
  evaluateArenaExpression,
  evaluateArenaFunctionCall,
  inferArenaExprVarType,
  isAssignableType,
  StmtKind,
  UnaryOp,
  Variability,
  VarType,
  varTypeName,
  type ArenaValue,
  type DaeDiagnostic,
  type DaeDiagnosticRange,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { BUILTIN_FUNCTIONS } from "../../../builtins.js";
import { ModelicaErrorCode } from "../../../errors.js";
import { isScopeEncapsulated } from "../../../queries.js";
import { getElementDiagRange } from "../../support/range-utils.js";
import {
  getFlatteningState,
  getNamedArrayShape,
  popLoopVar,
  pushLoopVar,
  type FlatteningState,
} from "../../support/state.js";
import type { ComponentInstanceData, LoweringContext } from "../../types.js";
import {
  dispatchUnaryOperator,
  findOperatorRecordComponentType,
  getArrayCtorElements,
  resolveOperatorRecord,
} from "../binary-ops.js";
import { cartesianProduct, findArraySubscriptsForIter, reduceNestedValues } from "../comprehensions.js";
import {
  copyExprBetweenDaes,
  cstContainsNodeType,
  evaluateCSTNumber,
  evaluateEnumRange,
  expandVarToArrayCtor,
  extractBindingExprFromDeclCst,
  extractEnumLiteralsFromCst,
  flattenColonNodes,
  getArrayLiteralItems,
  isIntegerTypeSpec,
  resolveEnumType,
  resolveScopedName,
  stripLeadingDot,
  stripLeadingDots,
} from "../cst-utils.js";
import {
  addArenaValueAsExpr,
  castToRealExpr,
  evalDaeExpr,
  exprContainsNonConstantRef,
  getExprDims,
  isRealExpr,
} from "../eval.js";
import {
  getSymbolQualifiedName,
  hasMatchingInnerFunction,
  isOuterFunctionSymbol,
  SCALAR_VECTORIZABLE_FUNCTIONS,
  vectorizeFunctionCall,
} from "../functions.js";

import { lowerBuiltinFunctionCall } from "./builtin-calls.js";
import {
  asDaeExt,
  asFlattenerExt,
  asStateExt,
  extractExternalBuiltinCall,
  findLastItem,
  getDaeExtMeta,
  getModArgs,
  readLeadingAsciiIdentifier,
} from "./helpers.js";
import type {
  EffectiveModLike,
  EvalErrorLike,
  LowererDaeExt,
  LowerExprFn,
  NameResolver,
  OperatorFnData,
  SymbolMetaLike,
} from "./types.js";

export function lowerFunctionCallCSTExpression(
  node: SyntaxNode,
  dae: DAEBuilder,
  ctx: LoweringContext,
  state: FlatteningState,
  lowerExpr: LowerExprFn,
): number | null {
  const { prefix = "", substitutions, imports, db, flattener, tupleContext } = ctx;
  const type = node.type;
  // ============================================================================
  // Function Calls, Reductions, and Comprehensions
  // Handles:
  //   1. Reduction comprehensions: sum/product/min/max/array(expr for i in range, ...)
  //      with static Cartesian product unrolling or symbolic ComprehensionExpr fallback.
  //   2. Partial function applications (function f(...)) and higher-order type checking.
  //   3. Built-in mathematical, array, stream, clock, and homotopy operators.
  //   4. User-defined function resolution, default argument cycle detection, and inlining.
  // ============================================================================
  // Function call: component_reference "(" ... ")"
  if (
    type === "function_call" ||
    ((type === "primary" || type === "lhs_primary" || type === "statement" || type === "statement_or_procedure") &&
      node.childCount >= 2 &&
      (node.child(1)?.type === "function_call_args" || node.child(1)?.type === "("))
  ) {
    let fnName = node.child(0)?.text?.trim() ?? "";
    if (imports) {
      const parts = fnName.split(".");
      if (imports.has(parts[0]!)) {
        fnName = [imports.get(parts[0]!)!, ...parts.slice(1)].join(".");
      }
    }

    const argsNode = node.child(1);
    let argExprIds: number[] = [];
    const argNodes: SyntaxNode[] = [];
    const namedArgs = new Map<string, number>();
    if (argsNode) {
      const fArgsNode =
        argsNode.type === "function_arguments"
          ? argsNode
          : (argsNode.children || []).find((c) => c.type === "function_arguments");
      const hasComprehensionFor = Boolean(
        fArgsNode && (fArgsNode.children || []).some((c) => c.text === "for" || c.type === "for_indices"),
      );
      const cleanFn = fnName.startsWith(".") ? fnName.slice(1) : fnName;
      // Comprehension reduction: unroll static iterator ranges over the body expression
      // or emit a symbolic ComprehensionExpr when iterator bounds depend on runtime variables.
      if (
        hasComprehensionFor &&
        (cleanFn === "sum" || cleanFn === "product" || cleanFn === "min" || cleanFn === "max" || cleanFn === "array")
      ) {
        const fChildren = fArgsNode?.children || [];
        const forIdx = fChildren.findIndex((c) => c.text === "for" || c.type === "for");
        const bodyNode = forIdx > 0 ? fChildren[forIdx - 1]! : fChildren[0]!;
        const forIndicesNode = fChildren.find((c) => c.type === "for_indices");

        let baseCompName = "";
        const findCR = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
          if (!n) return null;
          if (n.type === "component_reference") return n;
          for (const c of n.children || []) {
            const found = findCR(c);
            if (found) return found;
          }
          return null;
        };
        const crNode = findCR(bodyNode);
        if (crNode) {
          baseCompName = crNode.text?.split(".")[0]?.split("[")[0]?.trim() ?? "";
        } else if (bodyNode?.text) {
          const leadingId = readLeadingAsciiIdentifier(bodyNode.text);
          if (leadingId) baseCompName = leadingId;
        }
        if (baseCompName) {
          const compType = findOperatorRecordComponentType(baseCompName, dae, db, flattener);
          if (compType) {
            const ops = db?.query<Map<string, OperatorFnData[]> | null>("operatorFunctions", compType.symId);
            if (cleanFn === "sum") {
              const plusOps = ops?.get("'+'") ?? ops?.get("+");
              if (plusOps && plusOps.length > 0) {
                const plusOp = plusOps[0]!;
                flattener?.usedOperatorFunctions?.set(plusOp.qualifiedName, plusOp.funcSymId);
              }
            } else if (cleanFn === "product") {
              const mulOps = ops?.get("'*'") ?? ops?.get("*");
              if (mulOps && mulOps.length > 0) {
                const mulOp = mulOps[0]!;
                flattener?.usedOperatorFunctions?.set(mulOp.qualifiedName, mulOp.funcSymId);
              }
            }
          }
        }

        const forIndices = (forIndicesNode?.children || []).filter((k) => k.type === "for_index");
        const iters: { name: string; values: (number | string)[]; sampleValue?: number | string | undefined }[] = [];
        for (const fi of forIndices) {
          const varName = (Cst.ForIndex.variable(fi)?.text?.trim() || fi.child(0)?.text?.trim() || "").trim();
          if (!varName) continue;
          const rangeNode = Cst.ForIndex.range(fi) || fi.children?.find?.((k) => k.type === "expression");
          let values: (number | string)[] = [];
          let rangeResolved = false;
          let sampleValue: number | string | undefined;
          const isImplicit = !rangeNode;
          if (rangeNode) {
            flattener?.lowerExpr?.(rangeNode, dae, prefix, substitutions);
            if (dae.diagnostics.some((d) => d.severity === "error")) {
              return -1;
            }
            const enumRange = evaluateEnumRange(
              rangeNode,
              substitutions,
              flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId,
              db,
              dae,
              prefix,
            );
            if (enumRange !== null) {
              values = enumRange;
              rangeResolved = true;
              if (enumRange.length === 0) {
                const cNodes = flattenColonNodes(rangeNode);
                if (cNodes.length >= 1) {
                  sampleValue = stripLeadingDots(cNodes[0]?.text?.trim() ?? "");
                }
              }
            } else {
              const colonNodes = flattenColonNodes(rangeNode);
              if (colonNodes.length >= 2) {
                const c0Text = colonNodes[0]?.text?.trim() ?? "";
                const c1Text = colonNodes[colonNodes.length - 1]?.text?.trim() ?? "";
                if (
                  colonNodes.length === 2 &&
                  (c0Text === "true" || c0Text === "false") &&
                  (c1Text === "true" || c1Text === "false")
                ) {
                  rangeResolved = true;
                  sampleValue = c0Text;
                  const b0 = c0Text === "true" ? 1 : 0;
                  const b1 = c1Text === "true" ? 1 : 0;
                  for (let b = b0; b <= b1; b++) {
                    values.push(b === 1 ? "true" : "false");
                  }
                } else {
                  const s = evaluateCSTNumber(colonNodes[0], substitutions, undefined, db, dae, prefix);
                  let e: number | null = null;
                  let step = 1;
                  if (colonNodes.length === 2) {
                    e = evaluateCSTNumber(colonNodes[1], substitutions, undefined, db, dae, prefix);
                  } else if (colonNodes.length >= 3) {
                    step = evaluateCSTNumber(colonNodes[1], substitutions, undefined, db, dae, prefix) ?? 1;
                    e = evaluateCSTNumber(colonNodes[2], substitutions, undefined, db, dae, prefix);
                  }
                  if (s !== null && e !== null) {
                    rangeResolved = true;
                    sampleValue = s;
                    if (step === 0 || Math.abs(step) < 1e-12) {
                      dae.diagnostics.push({
                        severity: "error",
                        code: ModelicaErrorCode.RANGE_STEP_TOO_SMALL.code,
                        message: ModelicaErrorCode.RANGE_STEP_TOO_SMALL.message(String(step)),
                        range: { startOffset: 0, endOffset: 0 },
                      });
                    } else {
                      for (let val = s; step > 0 ? val <= e : val >= e; val += step) values.push(val);
                    }
                  }
                }
              } else {
                const rangeText = rangeNode.text?.trim() ?? "";
                if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
                  const items = getArrayLiteralItems(rangeNode);
                  let allItemsResolved = true;
                  for (const item of items) {
                    const itemText = item.text?.trim() ?? "";
                    if (itemText === "true" || itemText === "false") {
                      values.push(itemText);
                      continue;
                    }
                    const v = evaluateCSTNumber(item, substitutions, undefined, db, dae, prefix);
                    if (v !== null) {
                      if (
                        itemText.includes(".") ||
                        itemText.includes("e") ||
                        itemText.includes("E") ||
                        !Number.isInteger(v)
                      ) {
                        values.push(`expr:${dae.addRealLiteral(v)}`);
                      } else {
                        values.push(v);
                      }
                    } else if (
                      (itemText.startsWith('"') && itemText.endsWith('"')) ||
                      (itemText.startsWith("{") && itemText.endsWith("}"))
                    ) {
                      const itemExprId = lowerExpr(item, dae, prefix, substitutions, imports, db, flattener);
                      if (itemExprId >= 0) {
                        values.push(`expr:${itemExprId}`);
                      } else {
                        allItemsResolved = false;
                        break;
                      }
                    } else {
                      allItemsResolved = false;
                      break;
                    }
                  }
                  if (!allItemsResolved) {
                    values = [];
                  } else {
                    rangeResolved = true;
                  }
                }
              }
            }
          }
          if (values.length === 0 && !rangeResolved) {
            values = findArraySubscriptsForIter(bodyNode, varName, dae, db, prefix, isImplicit, fi);
          }
          if (values.length > 0 || rangeResolved) {
            iters.push({ name: varName, values, sampleValue });
          }
        }

        let sampleBodyId = -1;
        if (cleanFn === "sum" || cleanFn === "product" || cleanFn === "min" || cleanFn === "max") {
          let eqNode: SyntaxNode | null | undefined = node;
          while (
            eqNode &&
            eqNode.type !== "simple_equation" &&
            eqNode.type !== "component_clause" &&
            eqNode.type !== "statement" &&
            eqNode.type !== "assignment_statement"
          ) {
            eqNode = eqNode.parent;
          }
          const diagNode = eqNode ?? node;
          const startB = diagNode?.startIndex ?? diagNode?.startOffset;
          const endB = diagNode?.endIndex ?? diagNode?.endOffset;
          const range =
            startB != null && endB != null
              ? {
                  startOffset: startB,
                  endOffset: endB,
                  startPosition: diagNode?.startPosition,
                  endPosition: diagNode?.endPosition,
                }
              : undefined;

          const testSubs = new Map(substitutions);
          if (iters.length > 0) {
            for (const it of iters) {
              const sv = it.values.length > 0 ? it.values[0]! : it.sampleValue;
              if (sv !== undefined) testSubs.set(it.name, sv);
            }
          }
          sampleBodyId = lowerExpr(bodyNode, dae, prefix, testSubs, imports, db, flattener);
          if (sampleBodyId >= 0) {
            const bKind = dae.getExprKind(sampleBodyId);
            let actualTypeName = "";
            let isArray = false;
            let isString = false;
            let isBoolean = false;

            if (bKind === ExprKind.StringLiteral) {
              actualTypeName = "String";
              isString = true;
            } else if (bKind === ExprKind.BoolLiteral) {
              actualTypeName = "Boolean";
              isBoolean = true;
            } else if (bKind === ExprKind.IntLiteral) {
              actualTypeName = "Integer";
            } else if (bKind === ExprKind.RealLiteral) {
              actualTypeName = "Real";
            } else if (bKind === ExprKind.ArrayCtor) {
              isArray = true;
              const count = dae.getExprData1(sampleBodyId);
              let elemType = "Integer";
              const firstElem = dae.getExprLeft(sampleBodyId);
              if (firstElem >= 0 && dae.getExprKind(firstElem) === ExprKind.RealLiteral) {
                elemType = "Real";
              }
              actualTypeName = `${elemType}[${count}]`;
            } else {
              const t = inferArenaExprVarType(dae, sampleBodyId);
              if (t === VarType.String) {
                actualTypeName = "String";
                isString = true;
              } else if (t === VarType.Boolean) {
                actualTypeName = "Boolean";
                isBoolean = true;
              } else if (t === VarType.Real) {
                actualTypeName = "Real";
              } else if (t === VarType.Integer) {
                actualTypeName = "Integer";
              }
              const dims = getExprDims(sampleBodyId, dae, db, flattener);
              if (dims && dims.length > 0) {
                isArray = true;
                actualTypeName = `${actualTypeName || "Integer"}[${dims.join(",")}]`;
              }
            }

            if (cleanFn === "min" || cleanFn === "max") {
              if (isString || isArray) {
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.REDUCTION_INVALID_EXPR_TYPE.code,
                  message: ModelicaErrorCode.REDUCTION_INVALID_EXPR_TYPE.message(
                    bodyNode.text?.trim() ?? "",
                    actualTypeName,
                    cleanFn,
                    "scalar enumeration, Boolean, Integer, or Real",
                  ),
                  range,
                });
                return -1;
              }
            } else if (cleanFn === "product") {
              if (isString || isBoolean || isArray) {
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.REDUCTION_INVALID_EXPR_TYPE.code,
                  message: ModelicaErrorCode.REDUCTION_INVALID_EXPR_TYPE.message(
                    bodyNode.text?.trim() ?? "",
                    actualTypeName,
                    "product",
                    "scalar Integer or Real",
                  ),
                  range,
                });
                return -1;
              }
            } else if (cleanFn === "sum") {
              if ((isString && !dae.extensionMetadata?.["isOldFrontend"]) || isBoolean) {
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.REDUCTION_INVALID_EXPR_TYPE.code,
                  message: ModelicaErrorCode.REDUCTION_INVALID_EXPR_TYPE.message(
                    bodyNode.text?.trim() ?? "",
                    actualTypeName,
                    "sum",
                    "Integer or Real, or operator record",
                  ),
                  range,
                });
                return -1;
              }
            }
          }
        }

        if (cleanFn === "array") {
          if (iters.length >= 1 && iters.length === forIndices.length) {
            for (const it of iters) pushLoopVar(flattener, it.name);
            try {
              // Modelica 3.6 §10.4.2: {expr for i1 in r1, i2 in r2} === {{expr for i1 in r1} for i2 in r2}
              const buildComprehensionDim = (dimIdx: number, currentSubs: Map<string, number | string>): number => {
                const iter = iters[dimIdx]!;
                const elemIds: number[] = [];
                for (const val of iter.values) {
                  const nextSubs = new Map(currentSubs);
                  nextSubs.set(iter.name, val);
                  if (dimIdx === 0) {
                    elemIds.push(lowerExpr(bodyNode, dae, prefix, nextSubs, imports, db, flattener));
                  } else {
                    elemIds.push(buildComprehensionDim(dimIdx - 1, nextSubs));
                  }
                }
                return dae.addArrayCtorExpr(elemIds);
              };
              return buildComprehensionDim(iters.length - 1, new Map(substitutions));
            } finally {
              for (const it of iters) popLoopVar(flattener, it.name);
            }
          }
        } else if (cleanFn === "sum" || cleanFn === "product") {
          if (iters.length > 0 && iters.length === forIndices.length) {
            if (iters.some((it) => it.values.length === 0)) {
              const isReal = sampleBodyId >= 0 && isRealExpr(sampleBodyId, dae);
              if (cleanFn === "sum") {
                return isReal ? dae.addRealLiteral(0.0) : dae.addIntLiteral(0);
              }
              return isReal ? dae.addRealLiteral(1.0) : dae.addIntLiteral(1);
            }
            const tuples = cartesianProduct(iters.map((it) => it.values));
            for (const it of iters) pushLoopVar(flattener, it.name);
            const terms: number[] = [];
            try {
              for (const tuple of tuples) {
                const newSubs = new Map(substitutions);
                for (let idx = 0; idx < iters.length; idx++) {
                  newSubs.set(iters[idx]!.name, tuple[idx]!);
                }
                terms.push(lowerExpr(bodyNode, dae, prefix, newSubs, imports, db, flattener));
              }
            } finally {
              for (const it of iters) popLoopVar(flattener, it.name);
            }

            if (
              cleanFn === "sum" &&
              terms.length > 0 &&
              terms.every((t) => t >= 0 && dae.getExprKind(t) === ExprKind.StringLiteral)
            ) {
              const strVal = terms.map((t) => dae.interner.resolve(dae.getExprData1(t)) ?? "").join("");
              return dae.addStringLiteral(strVal);
            }

            if (terms.length > 0 && terms.every((t) => t >= 0 && dae.getExprKind(t) === ExprKind.ArrayCtor)) {
              const firstLen = dae.getExprData1(terms[0]!);
              if (firstLen > 0 && terms.every((t) => dae.getExprData1(t) === firstLen)) {
                const reducedElemIds: number[] = [];
                let allElemsConst = true;
                for (let elemIdx = 0; elemIdx < firstLen; elemIdx++) {
                  const elemTerms: number[] = [];
                  const elemVals: number[] = [];
                  for (const t of terms) {
                    const elId = elemIdx === 0 ? dae.getExprLeft(t) : dae.getExprLeft(t + elemIdx);
                    elemTerms.push(elId);
                    const ev = evalDaeExpr(elId, dae);
                    if (typeof ev === "number") {
                      elemVals.push(ev);
                    } else {
                      allElemsConst = false;
                      break;
                    }
                  }
                  if (!allElemsConst) break;
                  const resVal =
                    cleanFn === "sum" ? elemVals.reduce((a, b) => a + b, 0) : elemVals.reduce((a, b) => a * b, 1);
                  const isAllInt =
                    elemVals.every((v) => Number.isInteger(v)) && elemTerms.every((et) => !isRealExpr(et, dae));
                  reducedElemIds.push(isAllInt ? dae.addIntLiteral(Math.round(resVal)) : dae.addRealLiteral(resVal));
                }
                if (allElemsConst && reducedElemIds.length === firstLen) {
                  return dae.addArrayCtorExpr(reducedElemIds);
                }
              }
            }

            const numValues: number[] = [];
            let allConstant = true;
            for (const termId of terms) {
              const ev = evalDaeExpr(termId, dae);
              if (typeof ev === "number") {
                numValues.push(ev);
              } else {
                allConstant = false;
                break;
              }
            }
            if (allConstant && numValues.length > 0) {
              const shape = iters.map((it) => it.values.length);
              const resVal = reduceNestedValues(numValues, shape, cleanFn === "sum" ? "sum" : "product");
              const isAllInteger =
                numValues.every((v) => Number.isInteger(v)) && terms.every((t) => !isRealExpr(t, dae));
              return isAllInteger ? dae.addIntLiteral(Math.round(resVal)) : dae.addRealLiteral(resVal);
            } else if (terms.length > 0) {
              const op = cleanFn === "sum" ? BinOp.Add : BinOp.Mul;
              let accId = terms[0]!;
              for (let idx = 1; idx < terms.length; idx++) {
                accId = dae.addBinaryExpr(op, accId, terms[idx]!);
              }
              return accId;
            }
          }
        } else if (cleanFn === "min" || cleanFn === "max") {
          if (iters.length > 0 && iters.length === forIndices.length) {
            if (iters.some((it) => it.values.length === 0)) {
              const bKind = sampleBodyId >= 0 ? dae.getExprKind(sampleBodyId) : -1;
              if (bKind === ExprKind.BoolLiteral || inferArenaExprVarType(dae, sampleBodyId) === VarType.Boolean) {
                return dae.addBoolLiteral(cleanFn === "min");
              }
              if (bKind === ExprKind.EnumLiteral) {
                const enumPath = dae.interner.resolve(dae.getExprLeft(sampleBodyId)) ?? "";
                const lastDot = enumPath.lastIndexOf(".");
                if (lastDot > 0) {
                  const pfx = enumPath.slice(0, lastDot);
                  const scopeId =
                    flattener?.currentClassId ??
                    flattener?.currentRootClassId ??
                    getFlatteningState(dae).currentClassId;
                  const enumInfo = resolveEnumType(pfx, scopeId, db);
                  if (enumInfo && enumInfo.literals.length > 0) {
                    const idx = cleanFn === "min" ? enumInfo.literals.length - 1 : 0;
                    let qual = enumInfo.qual;
                    const rootName =
                      (flattener?.currentRootClassId && db ? db.symbol(flattener.currentRootClassId)?.name : "") ||
                      asDaeExt(dae).className;
                    if (!dae.extensionMetadata?.["isOldFrontend"] && rootName && qual.startsWith(`${rootName}.`)) {
                      qual = qual.slice(rootName.length + 1);
                    }
                    return dae.addEnumLiteral(idx + 1, `${qual}.${enumInfo.literals[idx]}`);
                  }
                }
              }
              if (sampleBodyId >= 0 && isRealExpr(sampleBodyId, dae)) {
                return dae.addRealLiteral(cleanFn === "min" ? 8.777798510069901e304 : -8.777798510069901e304);
              }
              return dae.addExpression(
                ExprKind.Name,
                dae.interner.intern(cleanFn === "min" ? "4611686018427387903" : "-4611686018427387903"),
              );
            }

            const tuples = cartesianProduct(iters.map((it) => it.values));
            for (const it of iters) pushLoopVar(flattener, it.name);
            const terms: number[] = [];
            try {
              for (const tuple of tuples) {
                const newSubs = new Map(substitutions);
                for (let idx = 0; idx < iters.length; idx++) {
                  newSubs.set(iters[idx]!.name, tuple[idx]!);
                }
                terms.push(lowerExpr(bodyNode, dae, prefix, newSubs, imports, db, flattener));
              }
            } finally {
              for (const it of iters) popLoopVar(flattener, it.name);
            }

            if (terms.length > 0 && terms.every((t) => t >= 0 && dae.getExprKind(t) === ExprKind.EnumLiteral)) {
              let bestTerm = terms[0]!;
              let bestOrd = dae.getExprData1(bestTerm);
              for (let i = 1; i < terms.length; i++) {
                const ord = dae.getExprData1(terms[i]!);
                if (cleanFn === "min" ? ord < bestOrd : ord > bestOrd) {
                  bestOrd = ord;
                  bestTerm = terms[i]!;
                }
              }
              return bestTerm;
            }

            const evalVals = terms.map((t) => evalDaeExpr(t, dae));
            if (evalVals.length > 0 && evalVals.every((v) => typeof v === "boolean")) {
              const bools = evalVals as boolean[];
              return dae.addBoolLiteral(cleanFn === "min" ? bools.every(Boolean) : bools.some(Boolean));
            }
            if (evalVals.length > 0 && evalVals.every((v) => typeof v === "number")) {
              const nums = evalVals as number[];
              const resVal = cleanFn === "min" ? Math.min(...nums) : Math.max(...nums);
              const isAllInteger = nums.every((v) => Number.isInteger(v)) && terms.every((t) => !isRealExpr(t, dae));
              return isAllInteger ? dae.addIntLiteral(Math.round(resVal)) : dae.addRealLiteral(resVal);
            }
          }

          if (forIndices.length === 1) {
            const fi = forIndices[0]!;
            const rangeNode = Cst.ForIndex.range(fi) || fi.children?.find?.((k) => k.type === "expression");
            if (rangeNode) {
              const rangeText = rangeNode.text?.trim() ?? "";
              if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
                const items = getArrayLiteralItems(rangeNode);
                const varName = (Cst.ForIndex.variable(fi)?.text?.trim() || fi.child(0)?.text?.trim() || "").trim();
                if (bodyNode.text?.trim() === varName) {
                  let bestNum: number | null = null;
                  const nonConsts: number[] = [];
                  let hasFloat = false;
                  for (const it of items) {
                    const lId = lowerExpr(it, dae, prefix, substitutions, imports, db, flattener);
                    const ev = evalDaeExpr(lId, dae);
                    if (typeof ev === "number") {
                      if (!Number.isInteger(ev)) hasFloat = true;
                      if (bestNum === null) {
                        bestNum = ev;
                      } else {
                        bestNum = cleanFn === "max" ? Math.max(bestNum, ev) : Math.min(bestNum, ev);
                      }
                    } else {
                      nonConsts.push(lId);
                    }
                  }
                  if (bestNum !== null) {
                    const bestId = hasFloat ? dae.addRealLiteral(bestNum) : dae.addIntLiteral(bestNum);
                    if (nonConsts.length === 0) {
                      return bestId;
                    }
                    return dae.addCallExpr(cleanFn, [bestId, ...nonConsts]);
                  } else if (nonConsts.length > 0) {
                    if (nonConsts.length === 1) return nonConsts[0]!;
                    return dae.addCallExpr(cleanFn, nonConsts);
                  }
                }
              }
            }
          }
          if (iters.length === 1 && iters[0]!.values.length === 1) {
            const val = iters[0]!.values[0]!;
            const newSubs = new Map(substitutions);
            newSubs.set(iters[0]!.name, val);
            return lowerExpr(bodyNode, dae, prefix, newSubs, imports, db, flattener);
          }

          const iterators: { name: string; rangeId: number }[] = [];
          if (iters.length > 0) {
            for (const it of iters) {
              const rangeItems = it.values.map((v) =>
                typeof v === "number"
                  ? dae.addIntLiteral(v)
                  : typeof v === "string" && v.startsWith("expr:")
                    ? Number(v.slice(5))
                    : dae.addExpression(ExprKind.Name, dae.interner.intern(String(v))),
              );
              const evalRangeId = dae.addArrayCtorExpr(rangeItems);
              iterators.push({ name: it.name, rangeId: evalRangeId });
            }
          } else if (forIndicesNode) {
            for (const idxNode of forIndicesNode.children || []) {
              if (idxNode.type === "for_index") {
                const varNode = idxNode.childForFieldName?.("variable") ?? idxNode.child(0);
                const rangeNode = idxNode.childForFieldName?.("range") ?? idxNode.child(2) ?? idxNode.child(1);
                const varName = varNode?.text?.trim() ?? "";
                let rangeId = -1;
                if (rangeNode) {
                  rangeId = lowerExpr(rangeNode, dae, prefix, substitutions, imports, db, flattener);
                }
                if (varName) {
                  iterators.push({ name: varName, rangeId });
                }
              }
            }
          }
          for (const it of iterators) pushLoopVar(flattener, it.name);
          let bodyId: number;
          try {
            bodyId = lowerExpr(bodyNode, dae, prefix, substitutions, imports, db, flattener);
          } finally {
            for (const it of iterators) popLoopVar(flattener, it.name);
          }
          return dae.addComprehensionExpr(cleanFn, bodyId, iterators);
        }

        const iterators: { name: string; rangeId: number }[] = [];
        if (forIndicesNode) {
          for (const idxNode of forIndicesNode.children || []) {
            if (idxNode.type === "for_index") {
              const varNode = idxNode.childForFieldName?.("variable") ?? idxNode.child(0);
              const rangeNode = idxNode.childForFieldName?.("range") ?? idxNode.child(2) ?? idxNode.child(1);
              const varName = varNode?.text?.trim() ?? "";
              let rangeId = -1;
              if (rangeNode) {
                rangeId = lowerExpr(rangeNode, dae, prefix, substitutions, imports, db, flattener);
              }
              if (varName) {
                iterators.push({ name: varName, rangeId });
              }
            }
          }
        }
        const compState = getFlatteningState(dae);
        const realIterVars: string[] = [];
        for (const it of iterators) {
          pushLoopVar(flattener, it.name);
          if (isRealExpr(it.rangeId, dae)) {
            const rlv = (asStateExt(compState).realLoopVars ??= new Set<string>());
            rlv.add(it.name);
            realIterVars.push(it.name);
          }
        }
        let bodyId: number;
        try {
          bodyId = lowerExpr(bodyNode, dae, prefix, substitutions, imports, db, flattener);
        } finally {
          for (const it of iterators) popLoopVar(flattener, it.name);
          for (const rv of realIterVars) asStateExt(compState).realLoopVars?.delete(rv);
        }

        if (iterators.length > 1 && (cleanFn === "sum" || cleanFn === "product")) {
          let currBodyId = bodyId;
          for (const it of iterators) {
            currBodyId = dae.addComprehensionExpr(cleanFn, currBodyId, [it]);
          }
          return currBodyId;
        }
        return dae.addComprehensionExpr(cleanFn, bodyId, iterators);
      }

      const noArrayExpandForArgs =
        typeof fnName === "string" &&
        (fnName.startsWith("Connections.") ||
          fnName === "equalityConstraint" ||
          fnName.endsWith(".equalityConstraint"));
      const lowerPartialFuncNode = (pfNode: SyntaxNode): number => {
        const typeSpecNode = pfNode.children?.find((c) => c.type === "type_specifier") ?? pfNode.child(1);
        const passedFnName = typeSpecNode?.text?.trim() ?? "";
        const callingScope = flattener?.currentClassId ?? flattener?.currentRootClassId;
        const argFnSym =
          db && passedFnName
            ? callingScope
              ? (db.query<NameResolver | null>("resolveName", callingScope)?.(passedFnName) ??
                db
                  .byName(passedFnName.split(".").pop()!)
                  .find((e) => (e.kind === "Class" || e.kind === "Function") && flattener?.isFunctionSym?.(e)))
              : db
                  .byName(passedFnName.split(".").pop()!)
                  .find((e) => (e.kind === "Class" || e.kind === "Function") && flattener?.isFunctionSym?.(e))
            : null;
        const qualFnName = argFnSym && db ? getSymbolQualifiedName(db, argFnSym.id) : passedFnName;
        if (argFnSym && flattener?.flattenFunction && !dae.getFunction(qualFnName)) {
          const fnDae = flattener.flattenFunction(argFnSym.id, qualFnName, undefined, dae);
          if (fnDae) asDaeExt(fnDae).wasCalled = true;
        } else if (dae.getFunction(qualFnName)) {
          asDaeExt(dae.getFunction(qualFnName)!).wasCalled = true;
        }
        const boundArgIds: number[] = [];
        const walkNamed = (cn: SyntaxNode | null | undefined) => {
          if (!cn) return;
          if (cn.type === "named_argument") {
            let valChild = cn.child(2) ?? cn.child(1);
            if (valChild && valChild.type === "function_argument" && valChild.childCount === 1) {
              valChild = valChild.child(0);
            }
            if (valChild) {
              const bId = lowerExpr(
                valChild,
                dae,
                prefix,
                substitutions,
                imports,
                db,
                flattener,
                false,
                noArrayExpandForArgs,
              );
              if (bId >= 0) boundArgIds.push(bId);
            }
            return;
          }
          for (let k = 0; k < (cn.childCount ?? 0); k++) {
            walkNamed(cn.child(k));
          }
        };
        walkNamed(pfNode);
        return dae.addPartialFuncExpr(qualFnName, boundArgIds);
      };
      const collectArgs = (n: SyntaxNode | null | undefined) => {
        if (!n) return;
        if (n.type === "named_argument") {
          const propName = n.child(0)?.text?.trim();
          let exprChild = n.child(2) ?? n.child(1);
          if (exprChild && exprChild.type === "function_argument" && exprChild.childCount === 1) {
            exprChild = exprChild.child(0);
          }
          if (propName && exprChild) {
            let exprId = -1;
            if (exprChild.type === "function_partial_application") {
              exprId = lowerPartialFuncNode(exprChild);
            } else {
              exprId = lowerExpr(
                exprChild,
                dae,
                prefix,
                substitutions,
                imports,
                db,
                flattener,
                false,
                noArrayExpandForArgs,
              );
            }
            namedArgs.set(propName, exprId);
            argNodes.push(exprChild);
            return;
          }
        }
        if (n.type === "function_partial_application") {
          argNodes.push(n);
          argExprIds.push(lowerPartialFuncNode(n));
          return;
        }
        if (n.type === "function_argument") {
          const firstChild = n.child(0);
          if (firstChild && firstChild.type === "function_partial_application") {
            argNodes.push(firstChild);
            argExprIds.push(lowerPartialFuncNode(firstChild));
            return;
          }
        }
        if (n.type === "expression") {
          argNodes.push(n);
          argExprIds.push(
            lowerExpr(n, dae, prefix, substitutions, imports, db, flattener, false, noArrayExpandForArgs),
          );
          return;
        }
        for (let i = 0; i < n.childCount; i++) {
          collectArgs(n.child(i));
        }
      };
      const state = getFlatteningState(dae);
      const prevInsidePrevious = state.isInsidePrevious;
      const prevInsideClock = state.isInsideClock;
      if (fnName === "previous") {
        state.isInsidePrevious = true;
      }
      if (fnName === "Clock") {
        state.isInsideClock = true;
      }
      try {
        collectArgs(argsNode);
      } finally {
        state.isInsidePrevious = prevInsidePrevious;
        state.isInsideClock = prevInsideClock;
      }
    }
    if (fnName === "integer" && argExprIds.length === 1) {
      const a0 = argExprIds[0]!;
      const kind = dae.getExprKind(a0);
      if (kind === ExprKind.RealLiteral) {
        return dae.addIntLiteral(Math.floor(dae.getExprRealValue(a0)));
      }
      if (kind === ExprKind.IntLiteral) {
        return a0;
      }
    }
    const cleanFnName = typeof fnName === "string" ? stripLeadingDots(fnName) : "";

    if (cstContainsNodeType(node.child(0), "array_subscripts")) {
      const callText = node.child(0)?.text?.trim() ?? cleanFnName;
      let cur: SyntaxNode | null | undefined = node;
      while (
        cur &&
        cur.type !== "component_clause" &&
        cur.type !== "simple_equation" &&
        cur.type !== "statement" &&
        cur.type !== "assignment_statement"
      ) {
        cur = cur.parent;
      }
      const diagRange = getElementDiagRange(cur ?? node);
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_CALL_CONTAINS_SUBSCRIPTS.code,
        message: ModelicaErrorCode.FUNCTION_CALL_CONTAINS_SUBSCRIPTS.message(callText),
        range: diagRange,
      });
      return -1;
    }

    if (db && (cleanFnName.endsWith(".constructor") || cleanFnName.endsWith(".destructor"))) {
      const parts = cleanFnName.split(".");
      parts.pop(); // remove constructor / destructor
      const parentName = parts.join(".");
      const parentSym = flattener?.currentClassId
        ? (db.query<NameResolver | null>("resolveName", flattener.currentClassId)?.(parentName) ??
          db.byName(parts[parts.length - 1]!).find((e) => e.kind === "Class"))
        : db.byName(parts[parts.length - 1]!).find((e) => e.kind === "Class");
      if (parentSym) {
        const extendsExtObj = db
          .childrenOf(parentSym.id)
          ?.some((c) => c.kind === "Extends" && c.name === "ExternalObject");
        if (extendsExtObj) {
          const scopeName = flattener?.currentClassId ? (db.symbol(flattener.currentClassId)?.name ?? "") : "";
          let callRange: DaeDiagnosticRange | undefined = undefined;
          if (node) {
            let n: SyntaxNode | null | undefined = node;
            while (n && n.type !== "component_clause" && n.parent) {
              if (n.type === "statement" || n.type === "function_call") break;
              n = n.parent;
            }
            const diagNode = n?.type === "component_clause" ? n : node;
            callRange = {
              startPosition: diagNode.startPosition,
              endPosition: diagNode.endPosition,
              startOffset: diagNode.startIndex ?? diagNode.startOffset,
              endOffset: diagNode.endIndex ?? diagNode.endOffset,
            };
          }
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
            message: `Function ${cleanFnName} not found in scope ${scopeName}.`,
            range: callRange,
          });
          return -1;
        }
      }
    }

    if (db && flattener && cleanFnName) {
      let calledFnSym: SymbolEntry | null = null;
      const fnEncScope = flattener?.currentFunctionEnclosingScope ?? null;
      if (fnEncScope && !cleanFnName.includes(".")) {
        const encScopeFn = db.query<(n: string) => SymbolEntry | null>("resolveName", fnEncScope)?.(cleanFnName);
        if (
          encScopeFn &&
          (encScopeFn.kind === "Class" || encScopeFn.kind === "Function") &&
          flattener.isFunctionSym?.(encScopeFn)
        ) {
          calledFnSym = encScopeFn;
        }
      }
      if (!calledFnSym && flattener.currentClassId) {
        const resolver =
          db.query<NameResolver | null>("resolveName", flattener.currentClassId) ??
          db.query<NameResolver | null>("resolveSimpleName", flattener.currentClassId);
        if (resolver) calledFnSym = resolver(cleanFnName) ?? null;
      }
      if (!calledFnSym && flattener.currentRootClassId) {
        const resolver =
          db.query<NameResolver | null>("resolveName", flattener.currentRootClassId) ??
          db.query<NameResolver | null>("resolveSimpleName", flattener.currentRootClassId);
        if (resolver) calledFnSym = resolver(cleanFnName) ?? null;
      }
      if (!calledFnSym) {
        const parts = cleanFnName.split(".");
        const fnBase = parts[parts.length - 1]!;
        const candidates = db.byName(fnBase).filter((e) => {
          if (e.kind !== "Class" && e.kind !== "Function") return false;
          if (!flattener.isFunctionSym?.(e)) return false;
          if (parts.length > 1) {
            const qual = getSymbolQualifiedName(db, e.id);
            return qual === cleanFnName || qual.endsWith("." + cleanFnName);
          }
          return parts.length === 1;
        });
        if (candidates.length > 0) {
          if (parts.length === 1) {
            calledFnSym =
              candidates.find((e) => getSymbolQualifiedName(db, e.id) === `Modelica.Math.${fnBase}`) ??
              candidates.find((e) => !getSymbolQualifiedName(db, e.id).includes("ComplexMath")) ??
              (SCALAR_VECTORIZABLE_FUNCTIONS.has(fnBase) ? null : (candidates[0] ?? null));
          } else {
            calledFnSym = candidates[0] ?? null;
          }
        }
      }
      const isOuterFn = isOuterFunctionSymbol(db, calledFnSym);
      const hasInnerMatch = isOuterFn && hasMatchingInnerFunction(db, flattener, calledFnSym?.name ?? cleanFnName);
      if (calledFnSym) {
        const currentParentMods = flattener?.currentParentMods;
        const redeclArg = findLastItem(
          getModArgs(currentParentMods),
          (a) =>
            !a.isBreak &&
            (a.name === cleanFnName || a.name === cleanFnName.split(".").pop()) &&
            Boolean(a.isRedeclaration || a.isRedeclare || a.redeclaredTypeSpecifier),
        );
        if (redeclArg?.redeclaredTypeSpecifier) {
          const ownerScopeId = redeclArg.ownerClassId ?? currentParentMods?.ownerClassId ?? flattener?.currentClassId;
          const redeclTarget =
            (ownerScopeId
              ? db.query<(n: string) => SymbolEntry | null>(
                  "resolveName",
                  ownerScopeId,
                )?.(redeclArg.redeclaredTypeSpecifier)
              : null) ??
            (flattener?.currentClassId
              ? db.query<(n: string) => SymbolEntry | null>(
                  "resolveName",
                  flattener.currentClassId,
                )?.(redeclArg.redeclaredTypeSpecifier)
              : null) ??
            db
              .byName(redeclArg.redeclaredTypeSpecifier)
              .find((e) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e));
          if (redeclTarget) {
            calledFnSym = redeclTarget;
          }
        } else if (cleanFnName.includes(".")) {
          const pkgPrefix = cleanFnName.split(".")[0]!;
          const fnRest = cleanFnName.split(".").slice(1).join(".");
          const pkgRedecl = findLastItem(
            getModArgs(currentParentMods),
            (a) =>
              !a.isBreak &&
              a.name === pkgPrefix &&
              Boolean((a.isRedeclaration || a.isRedeclare || a.redeclaredTypeSpecifier) && a.redeclaredTypeSpecifier),
          );
          if (pkgRedecl?.redeclaredTypeSpecifier) {
            const evalScopeId =
              pkgRedecl.evaluationScopeId ??
              pkgRedecl.ownerClassId ??
              currentParentMods?.ownerClassId ??
              flattener?.currentClassId ??
              flattener?.currentRootClassId;
            const pkgSpec = stripLeadingDots(String(pkgRedecl.redeclaredTypeSpecifier));
            const pkgTarget =
              (evalScopeId
                ? db.query<(n: string) => SymbolEntry | null>("resolveName", evalScopeId)?.(pkgSpec)
                : null) ??
              (flattener?.currentRootClassId
                ? db.query<(n: string) => SymbolEntry | null>("resolveName", flattener.currentRootClassId)?.(pkgSpec)
                : null) ??
              db.byName(pkgSpec.split(".").pop()!).find((e) => e.kind === "Class" || e.kind === "Package");
            if (pkgTarget) {
              const fnInPkg = db.query<(n: string) => SymbolEntry | null>("resolveName", pkgTarget.id)?.(fnRest);
              if (fnInPkg) {
                calledFnSym = fnInPkg;
              }
            }
          }
        }
      }
      if (calledFnSym && flattener.isClassPartial?.(calledFnSym.id) && !(isOuterFn && hasInnerMatch)) {
        let callRange: DaeDiagnosticRange | undefined = undefined;
        if (node) {
          let n: SyntaxNode | null | undefined = node;
          while (n && n.type !== "component_clause" && n.parent) {
            if (n.type === "statement" || n.type === "function_call") break;
            n = n.parent;
          }
          if (n && n.type === "component_clause") {
            callRange = {
              startPosition: n.startPosition,
              endPosition: n.endPosition,
              startOffset: n.startIndex ?? n.startOffset,
              endOffset: n.endIndex ?? n.endOffset,
            };
          } else {
            callRange = {
              startPosition: node.startPosition,
              endPosition: node.endPosition,
              startOffset: node.startIndex ?? node.startOffset,
              endOffset: node.endIndex ?? node.endOffset,
            };
          }
        }
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.CALLED_FUNCTION_PARTIAL.code,
          message: ModelicaErrorCode.CALLED_FUNCTION_PARTIAL.message(calledFnSym.name || cleanFnName),
          range: callRange,
        });
        return -1;
      }

      if (calledFnSym && flattener.failedFunctionIds?.has(calledFnSym.id)) {
        if (flattener.invalidInterfaceFunctionIds?.has(calledFnSym.id)) {
          const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"] || flattener?.options?.isOldFrontend);
          if (isOldFrontend && getDaeExtMeta(dae)?.hasOldInstOption) {
            let cur: SyntaxNode | null | undefined = node;
            while (
              cur &&
              cur.type !== "component_clause" &&
              cur.type !== "simple_equation" &&
              cur.type !== "statement" &&
              cur.type !== "assignment_statement"
            ) {
              cur = cur.parent;
            }
            const diagRange = getElementDiagRange(cur ?? node);
            const scopeName = flattener.currentClassId ? (db.symbol(flattener.currentClassId)?.name ?? "") : "";
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
              message: `Class ${cleanFnName} not found in scope ${scopeName} (looking for a function or record).`,
              range: diagRange,
            });
          }
        }
        return -1;
      }

      if (calledFnSym) {
        const fnChildren = db.childrenOf(calledFnSym.id);
        const inputParams = (fnChildren || []).filter((c) => {
          if (c.kind !== "Component") return false;
          const ci = db.query<ComponentInstanceData>("componentInstance", c.id);
          return ci?.causality === "input";
        });

        for (let i = 0; i < inputParams.length && i < argNodes.length; i++) {
          const param = inputParams[i]!;
          const paramCi = db.query<ComponentInstanceData>("componentInstance", param.id);
          const paramTypeName = paramCi?.typeSpecifier;
          if (paramTypeName) {
            const paramTarget =
              db.query<NameResolver | null>("resolveName", calledFnSym.id)?.(paramTypeName) ??
              db
                .byName(paramTypeName.split(".").pop()!)
                .find((e) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e)) ??
              db.byName(paramTypeName.split(".").pop()!).find((e) => e.kind === "Class");
            const isParamFunction = paramTarget && flattener.isFunctionSym?.(paramTarget);
            if (isParamFunction) {
              const argNode = argNodes[i];
              let passedFnName = "";
              const boundParamNames = new Set<string>();
              if (argNode?.type === "function_partial_application") {
                const typeSpecNode = argNode.children?.find((c) => c.type === "type_specifier") ?? argNode.child(1);
                passedFnName = typeSpecNode?.text?.trim() ?? "";
                const collectBoundNames = (cn: SyntaxNode | null | undefined) => {
                  if (!cn) return;
                  if (cn.type === "named_argument") {
                    const bName = cn.child(0)?.text?.trim();
                    if (bName) boundParamNames.add(bName);
                    return;
                  }
                  for (let k = 0; k < (cn.childCount ?? 0); k++) collectBoundNames(cn.child(k));
                };
                collectBoundNames(argNode);
              } else {
                passedFnName = argNode?.text?.trim() ?? "";
              }

              const callingScope = flattener.currentClassId ?? flattener.currentRootClassId;
              const argFnSym = callingScope
                ? (db.query<NameResolver | null>("resolveName", callingScope)?.(passedFnName) ??
                  db
                    .byName(passedFnName.split(".").pop()!)
                    .find((e) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e)))
                : db
                    .byName(passedFnName.split(".").pop()!)
                    .find((e) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e));

              if (argFnSym && flattener.isFunctionSym?.(argFnSym)) {
                const getFnSig = (sym: SymbolEntry, excludeNames?: Set<string>) => {
                  const instIds = db.query<SymbolId[]>("instantiate", sym.id);
                  const chs =
                    instIds && instIds.length > 0
                      ? instIds.map((id) => db.symbol(id)).filter((s): s is SymbolEntry => Boolean(s))
                      : db.childrenOf(sym.id) || [];
                  const inParams: {
                    name: string;
                    type: string;
                    hasDefault: boolean;
                    defaultVal?: string | undefined;
                  }[] = [];
                  const outParams: { name: string; type: string }[] = [];
                  for (const ch of chs) {
                    if (ch.kind === "Component") {
                      if (excludeNames?.has(ch.name)) continue;
                      const ci = db.query<ComponentInstanceData>("componentInstance", ch.id);
                      const cst = db.cstNode(ch.id) as SyntaxNode | null | undefined;
                      const bindingText = extractBindingExprFromDeclCst(cst, ch.name)?.text?.trim();
                      const ciBindingText = ci?.modification?.bindingExpression?.text?.trim();
                      const resolvedDefault =
                        ciBindingText && ciBindingText !== "break"
                          ? ciBindingText
                          : bindingText && bindingText !== "break"
                            ? bindingText
                            : undefined;
                      const hasDefault = Boolean(ci?.modification?.bindingExpression || resolvedDefault !== undefined);
                      const defaultVal: string | undefined = hasDefault ? resolvedDefault : undefined;
                      const t = ci?.typeSpecifier ?? "Real";
                      if (ci?.causality === "input") {
                        inParams.push({ name: ch.name, type: t, hasDefault, defaultVal });
                      } else if (ci?.causality === "output") {
                        outParams.push({ name: ch.name, type: t });
                      }
                    }
                  }
                  return { inParams, outParams };
                };

                const expectedSig = getFnSig(paramTarget);
                const actualSig = getFnSig(argFnSym, boundParamNames);

                let isCompatible = true;
                if (actualSig.inParams.filter((p) => !p.hasDefault).length > expectedSig.inParams.length) {
                  isCompatible = false;
                } else {
                  for (let j = 0; j < expectedSig.inParams.length; j++) {
                    if (j >= actualSig.inParams.length) {
                      isCompatible = false;
                      break;
                    }
                    if (expectedSig.inParams[j]!.type !== actualSig.inParams[j]!.type) {
                      isCompatible = false;
                      break;
                    }
                  }
                  if (isCompatible && expectedSig.outParams.length !== actualSig.outParams.length) {
                    isCompatible = false;
                  }
                }

                if (!isCompatible) {
                  let cur: SyntaxNode | null | undefined = node;
                  while (
                    cur &&
                    cur.type !== "component_clause" &&
                    cur.type !== "simple_equation" &&
                    cur.type !== "statement" &&
                    cur.type !== "assignment_statement"
                  ) {
                    cur = cur.parent;
                  }
                  const diagRange = getElementDiagRange(cur ?? node);
                  const fnQual = getSymbolQualifiedName(db, calledFnSym.id);
                  const argQual = getSymbolQualifiedName(db, argFnSym.id);
                  const paramQual = getSymbolQualifiedName(db, paramTarget.id);

                  const isOldFrontend = Boolean(
                    dae.extensionMetadata?.["isOldFrontend"] || flattener?.options?.isOldFrontend,
                  );

                  const formatInParam = (
                    p: { name: string; type: string; hasDefault: boolean; defaultVal?: string | undefined },
                    hasAlgorithm: boolean,
                  ) => {
                    let tStr = p.type;
                    if (hasAlgorithm && (p.type === "Integer" || p.type === "Real" || p.type === "Boolean")) {
                      tStr = `#${p.type}`;
                    }
                    if (p.hasDefault && isOldFrontend) {
                      return `${tStr} ${p.name} := ${p.defaultVal ?? "1"}`;
                    }
                    return `${tStr} ${p.name}`;
                  };

                  const formatSig = (
                    sym: SymbolEntry,
                    prefixName: string,
                    sig: {
                      inParams: { name: string; type: string; hasDefault: boolean; defaultVal?: string | undefined }[];
                      outParams: { name: string; type: string }[];
                    },
                  ) => {
                    const hasAlg = cstContainsNodeType(
                      db.cstNode(sym.id) as SyntaxNode | null | undefined,
                      "algorithm_section",
                    );
                    const inStr = sig.inParams.map((p) => formatInParam(p, hasAlg)).join(", ");
                    let outStr = "";
                    if (sig.outParams.length === 0) {
                      outStr = isOldFrontend ? " => #NORETCALL#" : " => ()";
                    } else {
                      const outHasAlg = hasAlg && isOldFrontend;
                      outStr =
                        " => " +
                        sig.outParams
                          .map(
                            (o) =>
                              `${outHasAlg && (o.type === "Integer" || o.type === "Real" || o.type === "Boolean") ? `#${o.type}` : o.type} ${o.name}`,
                          )
                          .join(", ");
                    }
                    return `${prefixName}<function>(${inStr})${outStr}`;
                  };

                  const argPrefix = argQual.includes(".")
                    ? argQual.startsWith(".")
                      ? argQual
                      : `.${argQual}`
                    : argQual;
                  const paramPrefix = paramQual.includes(".")
                    ? paramQual.startsWith(".")
                      ? paramQual
                      : `.${paramQual}`
                    : param.name;

                  const actualSigStr = formatSig(argFnSym, argPrefix, actualSig);
                  const expectedSigStr = formatSig(paramTarget, paramPrefix, expectedSig);

                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                    message: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(
                      `${fnQual}(${param.name}=${argQual})`,
                      String(i + 1),
                      actualSigStr,
                      expectedSigStr,
                    ),
                    range: diagRange,
                  });
                  return -1;
                }
              }
            }

            const isParamExtObj =
              paramTarget &&
              db.childrenOf(paramTarget.id)?.some((c) => c.kind === "Extends" && c.name === "ExternalObject");
            if (isParamExtObj) {
              const argNode = argNodes[i];
              const argText = argNode?.text?.trim() ?? "";
              const argSym = flattener.currentClassId
                ? (db.query<NameResolver | null>("resolveName", flattener.currentClassId)?.(argText) ??
                  db.byName(argText).find((e) => e.kind === "Component"))
                : null;
              if (argSym) {
                const argCi = db.query<ComponentInstanceData>("componentInstance", argSym.id);
                const argTypeName = argCi?.typeSpecifier;
                const argTarget = argTypeName
                  ? (db.query<NameResolver | null>("resolveName", flattener.currentClassId!)?.(argTypeName) ??
                    db.byName(argTypeName.split(".").pop()!).find((e) => e.kind === "Class"))
                  : null;
                if (argTarget && argTarget.id !== paramTarget.id) {
                  let cur: SyntaxNode | null | undefined = node;
                  while (
                    cur &&
                    cur.type !== "component_clause" &&
                    cur.type !== "simple_equation" &&
                    cur.type !== "statement" &&
                    cur.type !== "assignment_statement"
                  ) {
                    cur = cur.parent;
                  }
                  const diagRange = getElementDiagRange(cur ?? node);
                  const fnQual = getSymbolQualifiedName(db, calledFnSym.id);
                  const argQual = getSymbolQualifiedName(db, argTarget.id);
                  const paramQual = getSymbolQualifiedName(db, paramTarget.id);
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                    message: `Type mismatch for positional argument ${i + 1} in ${fnQual}(${param.name}=${argText}). The argument has type:\n  ExternalObject ${argQual}\nexpected type:\n  ExternalObject ${paramQual}`,
                    range: diagRange,
                  });
                  return -1;
                }
              }
            }
          }
        }
      }
    }

    const builtinRes = lowerBuiltinFunctionCall({
      node,
      fnName,
      cleanFnName,
      argsNode,
      argExprIds,
      argNodes,
      namedArgs,
      dae,
      ctx,
      state,
      lowerExpr,
    });
    if (builtinRes !== null) return builtinRes;

    // 1. Inlined '0' operator call: Complex.'0'()
    if (fnName.endsWith(".'0'") || fnName.endsWith(".0") || cleanFnName.endsWith(".'0'")) {
      const recName = cleanFnName.split(".")[0]!;
      const recSym = db?.byName(recName).find((e) => e.kind === "Class" && flattener?.isOperatorRecordSym?.(e));
      if (recSym && db) {
        const ops = db.query<Map<string, OperatorFnData[]> | null>("operatorFunctions", recSym.id);
        const zeroOps = ops?.get("'0'") ?? ops?.get("0");
        if (zeroOps && zeroOps.length > 0 && zeroOps[0]?.isInline) {
          const comps = db.childrenOf(recSym.id).filter((c) => c.kind === "Component");
          let args: number[];
          if (comps && comps.length > 0) {
            args = comps.map((comp) => {
              const compInst = db.query<ComponentInstanceData | null>("componentInstance", comp.id);
              const typeSpec =
                compInst?.typeSpecifier ??
                (comp.metadata as SymbolMetaLike | undefined)?.typeSpecifier ??
                db.query<string | null>("typeSpecifier", comp.id);
              if (typeSpec === "Integer" || isIntegerTypeSpec(typeSpec, db)) {
                return dae.addIntLiteral(0);
              } else if (typeSpec === "Boolean") {
                return dae.addBoolLiteral(false);
              } else if (typeSpec === "String") {
                return dae.addStringLiteral("");
              } else {
                return dae.addRealLiteral(0.0);
              }
            });
          } else {
            args = [dae.addRealLiteral(0.0), dae.addRealLiteral(0.0)];
          }
          return dae.addCallExpr(recName, args);
        }
      }
    }

    // 1.5. Unary operator function calls: not(c), -(c), +(c), abs(c)
    if ((cleanFnName === "not" || cleanFnName === "'not'") && argExprIds.length === 1) {
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'not'", argExprIds[0]!, argNodes[0], dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
      return dae.addExpression(ExprKind.Unary, UnaryOp.Not, argExprIds[0]!);
    }
    if ((cleanFnName === "-" || cleanFnName === "'-'") && argExprIds.length === 1) {
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'-'", argExprIds[0]!, argNodes[0], dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
    }
    if ((cleanFnName === "+" || cleanFnName === "'+'") && argExprIds.length === 1) {
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'+'", argExprIds[0]!, argNodes[0], dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
    }
    if ((cleanFnName === "abs" || cleanFnName === "'abs'") && argExprIds.length === 1) {
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'abs'", argExprIds[0]!, argNodes[0], dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
    }

    // 2. String(c, ...) operator
    if (cleanFnName === "String" && argExprIds.length >= 1) {
      const rec = resolveOperatorRecord(argExprIds[0]!, argNodes[0], dae, db, flattener);
      if (rec) {
        const ops = db?.query<Map<string, OperatorFnData[]> | null>("operatorFunctions", rec.symId);
        const strOps = ops?.get("'String'") ?? ops?.get("String");
        if (strOps && strOps.length > 0) {
          const strOverload = strOps[0]!;
          flattener?.usedOperatorFunctions?.set(strOverload.qualifiedName, strOverload.funcSymId);
          return dae.addCallExpr(strOverload.qualifiedName, argExprIds);
        }
      }
      if (argExprIds.length === 1 && dae.getExprKind(argExprIds[0]!) === ExprKind.EnumLiteral) {
        const enumPath = dae.interner.resolve(dae.getExprLeft(argExprIds[0]!));
        const litShort = enumPath.includes(".") ? enumPath.split(".").pop()! : enumPath;
        return dae.addStringLiteral(litShort);
      }
      if (argExprIds.length === 1 && namedArgs.size === 0 && dae.getExprKind(argExprIds[0]!) === ExprKind.IntLiteral) {
        return dae.addStringLiteral(String(dae.getExprData1(argExprIds[0]!)));
      }
      if (argExprIds.length === 1 && isRealExpr(argExprIds[0]!, dae)) {
        if (namedArgs.has("format")) {
          argExprIds.push(namedArgs.get("format")!);
        } else if (
          (dae.extensionMetadata?.["isOldFrontend"] ||
            flattener?.currentRootDae?.extensionMetadata?.["isOldFrontend"]) &&
          namedArgs.has("significantDigits") &&
          !namedArgs.has("minimumLength") &&
          !namedArgs.has("leftJustified")
        ) {
          argExprIds.push(namedArgs.get("significantDigits")!);
        } else {
          argExprIds.push(namedArgs.get("significantDigits") ?? dae.addIntLiteral(6));
          argExprIds.push(namedArgs.get("minimumLength") ?? dae.addIntLiteral(0));
          argExprIds.push(namedArgs.get("leftJustified") ?? dae.addBoolLiteral(true));
        }
      } else if (
        argExprIds.length === 1 &&
        dae.getExprKind(argExprIds[0]!) !== ExprKind.IntLiteral &&
        dae.getExprKind(argExprIds[0]!) !== ExprKind.BoolLiteral &&
        dae.getExprKind(argExprIds[0]!) !== ExprKind.StringLiteral
      ) {
        if (namedArgs.has("format")) {
          argExprIds.push(namedArgs.get("format")!);
        } else {
          argExprIds.push(namedArgs.get("minimumLength") ?? dae.addIntLiteral(0));
          argExprIds.push(namedArgs.get("leftJustified") ?? dae.addBoolLiteral(true));
        }
      }
      return dae.addCallExpr("String", argExprIds);
    }

    // 2b. Enumeration constructor: E(intVal) or AE(intVal)
    if (argExprIds.length === 1 && db && flattener && cleanFnName) {
      let targetTypeName = cleanFnName;
      const currentParentMods = flattener?.currentParentMods;
      const redeclArg = getModArgs(currentParentMods)?.find(
        (a) =>
          !a.isBreak &&
          (a.name === cleanFnName || a.name === cleanFnName.split(".").pop()) &&
          Boolean(a.isRedeclaration || a.isRedeclare || a.redeclaredTypeSpecifier),
      );
      if (redeclArg?.redeclaredTypeSpecifier) {
        targetTypeName = redeclArg.redeclaredTypeSpecifier;
      }

      const ownerScopeId = currentParentMods?.ownerClassId ?? flattener?.currentClassId;
      let enumSym = ownerScopeId
        ? db.query<(n: string) => SymbolEntry | null>("resolveName", ownerScopeId)?.(targetTypeName)
        : null;
      if (!enumSym && flattener?.currentClassId) {
        enumSym = db.query<(n: string) => SymbolEntry | null>(
          "resolveName",
          flattener.currentClassId,
        )?.(targetTypeName);
      }
      if (!enumSym) {
        const byN = db.byName(targetTypeName.split(".").pop()!);
        if (byN.length > 0) enumSym = byN[0]!;
      }
      if (enumSym) {
        const targetMeta = enumSym.metadata as SymbolMetaLike | undefined;
        const isEnum =
          targetMeta?.classPrefixes === "enumeration" ||
          targetMeta?.isEnumeration ||
          Boolean((db.cstNode(enumSym.id) as SyntaxNode | null | undefined)?.text?.includes("enumeration("));
        if (isEnum) {
          let val: number | null = null;
          if (dae.getExprKind(argExprIds[0]!) === ExprKind.IntLiteral) {
            val = dae.getExprData1(argExprIds[0]!);
          } else {
            const evalRes = evaluateArenaExpression(dae, argExprIds[0]!);
            if (typeof evalRes === "number" && Number.isInteger(evalRes)) {
              val = evalRes;
            }
          }
          if (val !== null) {
            const enumLits = extractEnumLiteralsFromCst(
              db.cstNode(enumSym.id) as SyntaxNode | null | undefined,
              targetMeta,
            );
            if (enumLits && val >= 1 && val <= enumLits.length) {
              const litName = enumLits[val - 1]!;
              const parts: string[] = [enumSym.name];
              let curr = enumSym.parentId ? db.symbol(enumSym.parentId) : null;
              while (curr && curr.id !== flattener?.currentRootClassId && curr.parentId !== null) {
                parts.unshift(curr.name);
                curr = db.symbol(curr.parentId);
              }
              const enumPrefix = parts.join(".");
              const fullLit = enumPrefix ? `${enumPrefix}.${litName}` : litName;
              return dae.addEnumLiteral(val, fullLit);
            }
          }
        }
      }
    }

    // 2.7. Builtin getInstanceName() function
    if ((fnName === "getInstanceName" || cleanFnName === "getInstanceName") && argExprIds.length === 0) {
      const rootName =
        flattener?.currentRootClassName ||
        (flattener?.currentRootClassId && db ? (db.symbol(flattener.currentRootClassId)?.name ?? "") : "") ||
        (dae.name ? dae.name.split(".").pop()! : "");
      const instPath = prefix ? (rootName ? `${rootName}.${prefix}` : prefix) : rootName;
      return dae.addStringLiteral(instPath);
    }

    const hadLeadingDot = typeof fnName === "string" && fnName.startsWith(".");

    // 3. Overloaded constructor: Complex(...)
    if (db && flattener && cleanFnName && !hadLeadingDot) {
      const recSym = db.byName(cleanFnName).find((e) => e.kind === "Class" && flattener.isOperatorRecordSym?.(e));
      if (recSym) {
        const ctors = db.query<OperatorFnData[] | null>("operatorConstructors", recSym.id);
        if (ctors && ctors.length > 0) {
          for (const ctor of ctors) {
            const inParams = ctor.inputParams || [];
            let canMatch = true;
            const finalArgs: number[] = [];
            if (namedArgs.size > 0) {
              for (const param of inParams) {
                const pType = param.typeSpec ? stripLeadingDot(param.typeSpec) : undefined;
                if (namedArgs.has(param.name)) {
                  const aid = namedArgs.get(param.name)!;
                  finalArgs.push(pType === "Real" ? castToRealExpr(aid, dae) : aid);
                } else if (param.hasDefault && param.defaultValue !== undefined) {
                  const num = Number(param.defaultValue);
                  finalArgs.push(isNaN(num) ? dae.addRealLiteral(0.0) : dae.addRealLiteral(num));
                } else {
                  canMatch = false;
                  break;
                }
              }
            } else if (argExprIds.length <= inParams.length) {
              for (let p = 0; p < inParams.length; p++) {
                if (p < argExprIds.length) {
                  const aid = argExprIds[p]!;
                  const akind = dae.getExprKind(aid);
                  const pType = inParams[p]?.typeSpec ? stripLeadingDot(inParams[p]!.typeSpec!) : undefined;
                  if (
                    (akind === ExprKind.RealLiteral || akind === ExprKind.IntLiteral) &&
                    pType !== "Real" &&
                    pType !== "Integer"
                  ) {
                    canMatch = false;
                    break;
                  }
                  finalArgs.push(pType === "Real" && akind !== ExprKind.ArrayCtor ? castToRealExpr(aid, dae) : aid);
                } else {
                  const param = inParams[p]!;
                  if (param.hasDefault && param.defaultValue !== undefined) {
                    const num = Number(param.defaultValue);
                    finalArgs.push(isNaN(num) ? dae.addRealLiteral(0.0) : dae.addRealLiteral(num));
                  } else {
                    canMatch = false;
                    break;
                  }
                }
              }
            } else {
              canMatch = false;
            }

            if (canMatch) {
              flattener.usedOperatorFunctions?.set(ctor.qualifiedName, ctor.funcSymId);
              return dae.addCallExpr(ctor.qualifiedName, finalArgs);
            }
          }

          // MLS §14.2.1: Default constructor is hidden when overloaded constructor is defined.
          const candidateLines = ctors
            .map((c) => {
              const paramsStr = (c.inputParams || []).map((p) => `${p.typeSpec} ${p.name}`).join(", ");
              return `  ${c.qualifiedName}(${paramsStr}) => ${cleanFnName}`;
            })
            .join("\n");

          const formatArg = (aid: number): string => {
            const k = dae.getExprKind(aid);
            if (k === ExprKind.RealLiteral) {
              const val = dae.getExprRealValue(aid);
              return `/*Real*/ ${Number.isInteger(val) ? val.toFixed(1) : val}`;
            }
            if (k === ExprKind.IntLiteral) {
              return String(dae.getExprData1(aid));
            }
            return dae.interner.resolve(dae.getExprData1(aid)) || "";
          };
          const formattedArgs = argExprIds.map(formatArg).join(", ");
          const callStr = `${cleanFnName}(${formattedArgs})`;

          let eqNode: SyntaxNode | null | undefined = node;
          while (
            eqNode &&
            eqNode.type !== "simple_equation" &&
            eqNode.type !== "component_clause" &&
            eqNode.type !== "statement" &&
            eqNode.type !== "assignment_statement"
          ) {
            eqNode = eqNode.parent;
          }
          const diagNode = eqNode ?? node;
          const startB = diagNode?.startIndex ?? diagNode?.startOffset;
          const endB = diagNode?.endIndex ?? diagNode?.endOffset;

          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.NO_MATCHING_OPERATOR_FUNCTION.code,
            message: `No matching function found for ${callStr}.\nCandidates are:\n${candidateLines}`,
            range: startB != null && endB != null ? { startOffset: startB, endOffset: endB } : undefined,
          });
          return -1;
        }
      }
    }

    const hasParentRedecl = Boolean(
      asDaeExt(dae)?.specializedPrefix ||
      flattener?.currentParentMods?.specializedPkgPrefix ||
      getModArgs(flattener?.currentParentMods)?.some(
        (a) =>
          !a.isBreak &&
          Boolean(a.isRedeclaration || a.isRedeclare || a.redeclaredTypeSpecifier) &&
          (a.name === cleanFnName ||
            a.name === cleanFnName.split(".")[0] ||
            (!cleanFnName.includes(".") &&
              (a.name === cleanFnName || Boolean(prefix && dae.classKind !== "function")))),
      ),
    );

    let matchingFnSym: SymbolEntry | null = null;
    const isBuiltinOp =
      !cleanFnName.includes(".") &&
      (SCALAR_VECTORIZABLE_FUNCTIONS.has(cleanFnName) || BUILTIN_FUNCTIONS.has(cleanFnName));
    let fnDae =
      isBuiltinOp || hasParentRedecl || (fnName.startsWith(".") && !cleanFnName.includes("."))
        ? undefined
        : (dae.getFunction(fnName) ?? (cleanFnName ? dae.getFunction(cleanFnName) : undefined));
    if (
      !fnDae &&
      !isBuiltinOp &&
      !hasParentRedecl &&
      cleanFnName &&
      !cleanFnName.includes(".") &&
      !fnName.startsWith(".")
    ) {
      fnDae = dae.getFunction(cleanFnName);
    }
    if (dae.classKind === "function" && getFlatteningState(dae).functionParameterNames?.has(cleanFnName)) {
      return dae.addCallExpr(cleanFnName, argExprIds);
    }
    if (fnName.startsWith(".")) {
      fnName = cleanFnName;
    }
    const fnDaeAlias = fnDae ? asDaeExt(fnDae).aliasTo : undefined;
    if (fnDae && fnDaeAlias) {
      fnName = fnDaeAlias;
      fnDae = undefined;
    }
    if (fnDae && fnDae.externalDecl && fnDae.externalDecl.includes('"builtin"')) {
      const extCall = extractExternalBuiltinCall(fnDae.externalDecl);
      fnName = extCall ? extCall.fnName : fnDae.name.split(".").pop()!;
      fnDae = undefined;
    }
    if (fnDae && flattener && db) {
      const currentScope = flattener.currentClassId ?? flattener.currentRootClassId;
      const resolved = currentScope
        ? db.query<(n: string) => SymbolEntry | null>("resolveName", currentScope)?.(cleanFnName)
        : null;
      if (resolved && (flattener.isExternalObject?.(resolved.id) || flattener.isRecordSym?.(resolved))) {
        fnDae = undefined;
      } else if (fnDae) {
        asDaeExt(fnDae).wasCalled = true;
        const fnDaeSymId = asDaeExt(fnDae).symId;
        if (fnDaeSymId) flattener.calledFunctionSymIds?.add(fnDaeSymId);
      }
    }
    if (
      !fnDae &&
      flattener &&
      db &&
      cleanFnName &&
      cleanFnName !== "String" &&
      cleanFnName !== "Real" &&
      cleanFnName !== "Integer" &&
      cleanFnName !== "Boolean" &&
      cleanFnName !== "print"
    ) {
      const parts = cleanFnName.split(".");
      const fnBase = parts[parts.length - 1]!;
      let specializedQualifiedName: string | null = null;
      let aliasCloneFnName: string | null = null;
      let enclosingScopeId: SymbolId | undefined = undefined;
      let componentInstancePrefix: string | undefined = asDaeExt(dae)?.componentPrefix;
      let componentSpecializedPrefix: string | undefined = asDaeExt(dae)?.specializedPrefix;

      // 1. Check if parentMods redeclared this function (e.g. RedeclareFunction1.mo)
      const currentParentMods = flattener?.currentParentMods;
      const redeclArg = findLastItem(
        getModArgs(currentParentMods),
        (a) =>
          !a.isBreak &&
          (a.name === cleanFnName || (parts.length === 1 && a.name === parts[0])) &&
          Boolean(a.isRedeclaration || a.isRedeclare || a.redeclaredTypeSpecifier),
      );
      if (redeclArg?.redeclaredTypeSpecifier) {
        const rawRedeclSpec = stripLeadingDots(String(redeclArg.redeclaredTypeSpecifier));
        const ownerScopeId = redeclArg.ownerClassId ?? currentParentMods?.ownerClassId ?? flattener?.currentClassId;
        const evalScopeId = redeclArg.evaluationScopeId ?? ownerScopeId;
        const redeclTarget =
          (evalScopeId
            ? db.query<(n: string) => SymbolEntry | null>("resolveName", evalScopeId)?.(rawRedeclSpec)
            : null) ??
          (ownerScopeId && ownerScopeId !== evalScopeId
            ? db.query<(n: string) => SymbolEntry | null>("resolveName", ownerScopeId)?.(rawRedeclSpec)
            : null) ??
          (flattener?.currentClassId
            ? db.query<(n: string) => SymbolEntry | null>("resolveName", flattener.currentClassId)?.(rawRedeclSpec)
            : null) ??
          (flattener?.currentRootClassId
            ? db.query<(n: string) => SymbolEntry | null>("resolveName", flattener.currentRootClassId)?.(rawRedeclSpec)
            : null) ??
          db
            .byName(rawRedeclSpec.split(".").pop()!)
            .find((e) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e));
        if (redeclTarget) {
          matchingFnSym = redeclTarget;
          const ownerClassSym = ownerScopeId ? db.symbol(ownerScopeId) : null;
          const ownerName = ownerClassSym?.name ?? "";
          if (dae.classKind === "function") {
            const daeRest =
              componentSpecializedPrefix && dae.name.startsWith(`${componentSpecializedPrefix}.`)
                ? dae.name.slice(componentSpecializedPrefix.length + 1)
                : "";
            if (componentSpecializedPrefix && daeRest.includes(".") && asDaeExt(dae).isShortFunc) {
              specializedQualifiedName = `${componentSpecializedPrefix}.${redeclArg.name}`;
              if (ownerName) {
                aliasCloneFnName = `${componentSpecializedPrefix}.${ownerName}.${redeclArg.name}`;
              }
            } else {
              specializedQualifiedName = `${dae.name}.${redeclArg.name}`;
              if (componentSpecializedPrefix && asDaeExt(dae).shortBaseFuncName) {
                aliasCloneFnName = `${componentSpecializedPrefix}.${asDaeExt(dae).shortBaseFuncName}.${redeclArg.name}`;
              }
            }
            enclosingScopeId = asDaeExt(dae).enclosingScopeId ?? ownerScopeId;
          } else if (ownerName) {
            specializedQualifiedName = `${ownerName}.${redeclArg.name}`;
            enclosingScopeId = ownerScopeId;
          }
        }
      }

      // 2. Check if cleanFnName is a qualified call on a package/class or component (e.g. B.usePart, n1.f)
      if (!matchingFnSym && parts.length > 1) {
        const prefixStr = parts.slice(0, -1).join(".");
        const fnBaseName = parts[parts.length - 1]!;
        const currentScope = flattener?.currentClassId ?? flattener?.currentRootClassId;
        const aliasPrefixSym =
          currentScope && parts.length === 2
            ? (db
                .childrenOf(currentScope)
                .find((c) => c.name === parts[0] && (c.kind === "Class" || c.kind === "Package")) ?? null)
            : null;
        let prefixSym = currentScope
          ? db.query<(n: string) => SymbolEntry | null>("resolveName", currentScope)?.(prefixStr)
          : null;
        if (!prefixSym) {
          prefixSym = db.byName(parts[0]!).find((e) => e.kind === "Class" || e.kind === "Package") ?? null;
          for (let pIdx = 1; pIdx < parts.length - 1 && prefixSym; pIdx++) {
            prefixSym =
              db.query<(n: string) => SymbolEntry | null>("resolveName", prefixSym.id)?.(parts[pIdx]!) ?? null;
          }
        }
        if (prefixSym) {
          if (prefixSym.kind === "Component") {
            const compClassId =
              db.query<SymbolId | null>("classInstance", prefixSym.id) ??
              (() => {
                const ci = db.query<ComponentInstanceData>("componentInstance", prefixSym.id);
                const tSpec = ci?.typeSpecifier;
                return tSpec
                  ? (((currentScope ?? prefixSym.parentId)
                      ? db.query<NameResolver | null>("resolveName", (currentScope ?? prefixSym.parentId)!)?.(tSpec)?.id
                      : null) ??
                      db.byName(tSpec.split(".").pop()!).find((e) => e.kind === "Class")?.id ??
                      null)
                  : null;
              })();
            if (compClassId) {
              const memberFn = db.query<(n: string) => SymbolEntry | null>("resolveName", compClassId)?.(fnBaseName);
              if (
                memberFn &&
                (memberFn.kind === "Class" || memberFn.kind === "Function") &&
                flattener.isFunctionSym?.(memberFn)
              ) {
                matchingFnSym = memberFn;
                const classQual = getSymbolQualifiedName(db, compClassId);
                const compPrefix = prefix ? `${prefix}.${prefixStr}` : prefixStr;
                const compMod = db.query<EffectiveModLike | null>("effectiveModification", prefixSym.id);
                const hasCompMod = Boolean(compMod?.args && compMod.args.length > 0);
                const specPrefix = hasCompMod ? `${classQual}$${compPrefix.replaceAll(".", "$")}` : classQual;
                specializedQualifiedName = `${specPrefix}.${fnBaseName}`;
                enclosingScopeId = compClassId;
                componentInstancePrefix = compPrefix;
                componentSpecializedPrefix = hasCompMod ? specPrefix : undefined;
              }
            }
          } else {
            const effectivePrefixSym = aliasPrefixSym ?? prefixSym;
            const outerPkgRedeclCandidate = findLastItem(
              getModArgs(currentParentMods),
              (a) =>
                !a.isBreak &&
                a.name === prefixStr &&
                Boolean((a.isRedeclaration || a.isRedeclare || a.redeclaredTypeSpecifier) && a.redeclaredTypeSpecifier),
            );
            let preResolvedRedeclPkgSym: SymbolEntry | null = null;
            if (outerPkgRedeclCandidate?.redeclaredTypeSpecifier) {
              const pkgSpec = stripLeadingDots(String(outerPkgRedeclCandidate.redeclaredTypeSpecifier));
              let pkgScopeId =
                outerPkgRedeclCandidate.evaluationScopeId ??
                outerPkgRedeclCandidate.ownerClassId ??
                currentScope ??
                flattener?.currentRootClassId;
              if (pkgScopeId && db.symbol(pkgScopeId)?.kind === "Component") {
                pkgScopeId = db.symbol(pkgScopeId)?.parentId ?? flattener?.currentRootClassId;
              }
              preResolvedRedeclPkgSym =
                (pkgScopeId
                  ? pkgSpec.includes(".")
                    ? db.query<(n: string) => SymbolEntry | null>("resolveName", pkgScopeId)?.(pkgSpec)
                    : db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", pkgScopeId)?.(pkgSpec)
                  : null) ??
                (flattener?.currentRootClassId
                  ? pkgSpec.includes(".")
                    ? db.query<(n: string) => SymbolEntry | null>(
                        "resolveName",
                        flattener.currentRootClassId,
                      )?.(pkgSpec)
                    : db.query<(n: string) => SymbolEntry | null>(
                        "resolveSimpleName",
                        flattener.currentRootClassId,
                      )?.(pkgSpec)
                  : null) ??
                db.byName(pkgSpec.split(".").pop()!).find((e) => e.kind === "Class" || e.kind === "Package") ??
                null;
            }
            const memberFn =
              db.query<(n: string) => SymbolEntry | null>("resolveName", prefixSym.id)?.(fnBaseName) ??
              (preResolvedRedeclPkgSym
                ? db.query<(n: string) => SymbolEntry | null>("resolveName", preResolvedRedeclPkgSym.id)?.(fnBaseName)
                : null);
            if (
              memberFn &&
              (memberFn.kind === "Class" || memberFn.kind === "Function") &&
              (flattener.isFunctionSym?.(memberFn) ||
                flattener.isExternalObject?.(memberFn.id) ||
                flattener.isRecordSym?.(memberFn))
            ) {
              const prefixMod =
                db.query<EffectiveModLike | null>("effectiveModification", effectivePrefixSym.id) ??
                db.query<EffectiveModLike | null>("effectiveModification", prefixSym.id);
              const prefixRedeclArg = prefixMod?.args?.find(
                (a) => !a.isBreak && a.name === fnBaseName && (a.isRedeclaration || a.redeclaredTypeSpecifier),
              );
              const intermediateFnName = prefixRedeclArg?.redeclaredTypeSpecifier ?? memberFn.name;
              const pkgRedeclArg = findLastItem(
                getModArgs(currentParentMods),
                (a) =>
                  !a.isBreak &&
                  (a.name === intermediateFnName || a.name === memberFn.name) &&
                  Boolean(a.isRedeclaration || a.isRedeclare || a.redeclaredTypeSpecifier),
              );
              const outerPkgRedeclArg = !pkgRedeclArg ? outerPkgRedeclCandidate : null;
              const redeclaredPkgSym: SymbolEntry | null = outerPkgRedeclArg ? preResolvedRedeclPkgSym : null;
              const targetSpec = pkgRedeclArg?.redeclaredTypeSpecifier ?? prefixRedeclArg?.redeclaredTypeSpecifier;
              let lookupScopeId =
                pkgRedeclArg?.evaluationScopeId ??
                effectivePrefixSym.parentId ??
                prefixSym.parentId ??
                flattener?.currentRootClassId;
              if (lookupScopeId && db.symbol(lookupScopeId)?.kind === "Component") {
                lookupScopeId = db.symbol(lookupScopeId)?.parentId ?? flattener?.currentRootClassId;
              }
              const pkgRedeclTarget = targetSpec
                ? ((lookupScopeId
                    ? targetSpec.includes(".")
                      ? db.query<(n: string) => SymbolEntry | null>("resolveName", lookupScopeId)?.(targetSpec)
                      : db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", lookupScopeId)?.(targetSpec)
                    : null) ??
                  (flattener?.currentRootClassId
                    ? targetSpec.includes(".")
                      ? db.query<(n: string) => SymbolEntry | null>(
                          "resolveName",
                          flattener.currentRootClassId,
                        )?.(targetSpec)
                      : db.query<(n: string) => SymbolEntry | null>(
                          "resolveSimpleName",
                          flattener.currentRootClassId,
                        )?.(targetSpec)
                    : null) ??
                  db
                    .byName(targetSpec.split(".").pop()!)
                    .find((e) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e)))
                : redeclaredPkgSym
                  ? db.query<(n: string) => SymbolEntry | null>("resolveName", redeclaredPkgSym.id)?.(fnBaseName)
                  : null;
              if (pkgRedeclTarget) {
                matchingFnSym = pkgRedeclTarget;
                const compConcreteClassId =
                  currentParentMods?.currentClassId ?? currentParentMods?.ownerClassId ?? currentScope;
                const ownerQual =
                  redeclaredPkgSym && compConcreteClassId && db.symbol(compConcreteClassId)?.kind === "Class"
                    ? getSymbolQualifiedName(db, compConcreteClassId)
                    : effectivePrefixSym.parentId
                      ? getSymbolQualifiedName(db, effectivePrefixSym.parentId)
                      : getSymbolQualifiedName(db, effectivePrefixSym.id);
                const rootQual = flattener.currentRootClassId
                  ? getSymbolQualifiedName(db, flattener.currentRootClassId)
                  : ownerQual;
                const specPkgPrefix =
                  prefix && (pkgRedeclArg || outerPkgRedeclArg)
                    ? dae.extensionMetadata?.["isOldFrontend"]
                      ? `${ownerQual}$${prefix.replaceAll(".", "$")}.${prefixStr}`
                      : `${rootQual}.${prefix}.${prefixStr}`
                    : `${ownerQual}.${prefixStr}`;
                specializedQualifiedName = `${specPkgPrefix}.${fnBaseName}`;
                enclosingScopeId = redeclaredPkgSym?.id ?? pkgRedeclTarget.parentId ?? undefined;
                if (redeclaredPkgSym && prefix) {
                  componentSpecializedPrefix = specPkgPrefix;
                }
              } else {
                matchingFnSym = memberFn;
                const prefixQual = getSymbolQualifiedName(db, effectivePrefixSym.id);
                specializedQualifiedName = `${prefixQual}.${fnBaseName}`;
                enclosingScopeId = effectivePrefixSym.id;
                componentInstancePrefix = undefined;
                componentSpecializedPrefix = undefined;
              }
            }
          }
        }
      }

      // 3. Check if cleanFnName is an unqualified call in the current enclosing scope (e.g. part(a) inside B.usePart)
      if (!matchingFnSym && parts.length === 1) {
        // 3a. First check the enclosing scope for inherited functions (redeclare function extends).
        // When flattening an inherited function (e.g., usePart from A in B's scope),
        // the enclosing scope (B) may have redeclared sibling functions that should
        // take priority over the ones inherited from the original parent (A).
        const fnEncScope = flattener?.currentFunctionEnclosingScope ?? null;
        if (fnEncScope) {
          const encScopeFn = db.query<(n: string) => SymbolEntry | null>("resolveName", fnEncScope)?.(cleanFnName);
          if (
            encScopeFn &&
            (encScopeFn.kind === "Class" || encScopeFn.kind === "Function") &&
            (flattener.isFunctionSym?.(encScopeFn) || flattener.isRecordSym?.(encScopeFn))
          ) {
            const encScopeQual = componentSpecializedPrefix ?? getSymbolQualifiedName(db, fnEncScope);
            if (!(SCALAR_VECTORIZABLE_FUNCTIONS.has(cleanFnName) && encScopeQual.includes("ComplexMath"))) {
              matchingFnSym = encScopeFn;
              const encScopeSym = db.symbol(fnEncScope);
              if (encScopeSym && (encScopeSym.kind === "Class" || encScopeSym.kind === "Package")) {
                specializedQualifiedName = `${encScopeQual}.${cleanFnName}`;
                enclosingScopeId = fnEncScope;
              }
            }
          }
        }

        if (!matchingFnSym && currentParentMods?.packageScopeId && currentParentMods?.specializedPkgPrefix) {
          const pkgFn =
            db.query<(n: string) => SymbolEntry | null>(
              "resolveSimpleName",
              currentParentMods.packageScopeId,
            )?.(cleanFnName) ??
            db.query<(n: string) => SymbolEntry | null>("resolveName", currentParentMods.packageScopeId)?.(cleanFnName);
          if (
            pkgFn &&
            (pkgFn.kind === "Class" || pkgFn.kind === "Function") &&
            (flattener.isFunctionSym?.(pkgFn) || flattener.isRecordSym?.(pkgFn))
          ) {
            matchingFnSym = pkgFn;
            componentSpecializedPrefix = currentParentMods.specializedPkgPrefix;
            componentInstancePrefix =
              typeof currentParentMods["specializedPkgInstPrefix"] === "string"
                ? currentParentMods["specializedPkgInstPrefix"]
                : undefined;
            specializedQualifiedName = `${currentParentMods.specializedPkgPrefix}.${cleanFnName}`;
            enclosingScopeId = currentParentMods.packageScopeId;
          }
        }

        // 3b. Fallback: check the current scope (function or class being flattened)
        if (!matchingFnSym) {
          const currentScope = flattener?.currentClassId ?? flattener?.currentFlatteningFunctionId;
          if (currentScope) {
            const inScopeFn = db.query<(n: string) => SymbolEntry | null>("resolveName", currentScope)?.(cleanFnName);
            if (inScopeFn && inScopeFn.kind === "Component") {
              const compCi = db.query<ComponentInstanceData>("componentInstance", inScopeFn.id);
              const tSpec = compCi?.typeSpecifier;
              const targetSym = tSpec
                ? (db.query<NameResolver | null>("resolveName", currentScope)?.(tSpec) ??
                  db
                    .byName(tSpec.split(".").pop()!)
                    .find((e) => (e.kind === "Class" || e.kind === "Function") && flattener.isFunctionSym?.(e)))
                : null;
              if (targetSym && flattener.isFunctionSym?.(targetSym)) {
                return dae.addCallExpr(cleanFnName, argExprIds);
              }
            }
            if (
              inScopeFn &&
              (inScopeFn.kind === "Class" || inScopeFn.kind === "Function") &&
              (flattener.isFunctionSym?.(inScopeFn) || flattener.isRecordSym?.(inScopeFn))
            ) {
              const inScopeQual = getSymbolQualifiedName(db, inScopeFn.id);
              if (!(SCALAR_VECTORIZABLE_FUNCTIONS.has(cleanFnName) && inScopeQual.includes("ComplexMath"))) {
                matchingFnSym = inScopeFn;
              }
              const rawScopeId = flattener?.currentClassId;
              let qualScopeId = rawScopeId;
              if (qualScopeId) {
                const scopeSym = db.symbol(qualScopeId);
                if (scopeSym && flattener.isFunctionSym?.(scopeSym)) {
                  qualScopeId = scopeSym.parentId ?? qualScopeId;
                }
              }
              if (qualScopeId) {
                const scopeSym = db.symbol(qualScopeId);
                if (scopeSym && (scopeSym.kind === "Class" || scopeSym.kind === "Package")) {
                  const isClassAncestor = (
                    ancestorId: SymbolId,
                    descendantId: SymbolId,
                    visited = new Set<SymbolId>(),
                  ): boolean => {
                    if (ancestorId === descendantId) return true;
                    if (visited.has(descendantId)) return false;
                    visited.add(descendantId);
                    const extendsChildren = db.childrenOf(descendantId).filter((c) => c.kind === "Extends");
                    for (const ext of extendsChildren) {
                      const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
                      const baseTargets = baseClass ? [baseClass] : db.byName(ext.name);
                      for (const target of baseTargets) {
                        if (target.id === ancestorId || isClassAncestor(ancestorId, target.id, visited)) {
                          return true;
                        }
                      }
                    }
                    return false;
                  };

                  const isLocalToCurrentFn = Boolean(
                    rawScopeId && rawScopeId !== qualScopeId && inScopeFn.parentId === rawScopeId,
                  );
                  const isDirectChild = inScopeFn.parentId === qualScopeId || isLocalToCurrentFn;
                  const isInherited =
                    inScopeFn.parentId != null &&
                    (isClassAncestor(inScopeFn.parentId, qualScopeId) ||
                      Boolean(
                        rawScopeId && rawScopeId !== qualScopeId && isClassAncestor(inScopeFn.parentId, rawScopeId),
                      ));
                  if (isDirectChild || isInherited) {
                    const isOldFeFn = Boolean(
                      dae.extensionMetadata?.["isOldFrontend"] ||
                      flattener?.isOldFrontend ||
                      flattener?.currentRootDae?.extensionMetadata?.["isOldFrontend"],
                    );
                    if (!componentSpecializedPrefix && prefix && dae.classKind !== "function") {
                      if (!isOldFeFn && flattener?.currentRootClassId) {
                        const rootQual = getSymbolQualifiedName(db, flattener.currentRootClassId);
                        if (rootQual) {
                          componentSpecializedPrefix = `${rootQual}.${prefix}`;
                          componentInstancePrefix = prefix;
                        }
                      } else if (
                        getModArgs(currentParentMods)?.some(
                          (a) => !a.isBreak && Boolean(a.isRedeclaration || a.isRedeclare || a.redeclaredTypeSpecifier),
                        )
                      ) {
                        const baseQual = getSymbolQualifiedName(db, qualScopeId);
                        componentSpecializedPrefix = `${baseQual}$${prefix.replaceAll(".", "$")}`;
                        componentInstancePrefix = prefix;
                      }
                    } else if (
                      dae.classKind === "function" &&
                      isLocalToCurrentFn &&
                      asDaeExt(dae)?.enclosingScopeId &&
                      qualScopeId !== asDaeExt(dae).enclosingScopeId
                    ) {
                      componentSpecializedPrefix = undefined;
                      componentInstancePrefix = undefined;
                    }
                    const scopeQual = componentSpecializedPrefix ?? getSymbolQualifiedName(db, qualScopeId);
                    specializedQualifiedName = `${scopeQual}.${cleanFnName}`;
                    enclosingScopeId = qualScopeId;
                  }
                }
              }
            }
          }
        }
      }

      // 4. Fallback to existing search
      const isEncapsulatedScope = flattener?.currentClassId ? isScopeEncapsulated(db, flattener.currentClassId) : false;
      if (!matchingFnSym && (!isEncapsulatedScope || hadLeadingDot)) {
        const candidates = db.byName(fnBase).filter((e) => {
          if (e.kind !== "Class") return false;
          if (parts.length > 1) {
            const qual = getSymbolQualifiedName(db, e.id);
            return qual === cleanFnName || qual.endsWith("." + cleanFnName);
          }
          return parts.length === 1;
        });
        if (candidates.length > 0) {
          if (parts.length === 1) {
            matchingFnSym = SCALAR_VECTORIZABLE_FUNCTIONS.has(fnBase)
              ? null
              : (candidates.find((e) => getSymbolQualifiedName(db, e.id) === `Modelica.Math.${fnBase}`) ??
                candidates.find((e) => !getSymbolQualifiedName(db, e.id).includes("ComplexMath")) ??
                candidates[0] ??
                null);
          } else {
            matchingFnSym = candidates[0] ?? null;
          }
        }
      }

      if (matchingFnSym && flattener.isExternalObject?.(matchingFnSym.id)) {
        const qualifiedName = getSymbolQualifiedName(db, matchingFnSym.id);
        const ctorName = `${qualifiedName}.constructor`;
        flattener.usedExternalObjects?.add(matchingFnSym.id);
        return dae.addCallExpr(ctorName, argExprIds);
      }
      if (matchingFnSym && (flattener.isRecordSym?.(matchingFnSym) || flattener.isOperatorRecordSym?.(matchingFnSym))) {
        const targetCtorName =
          specializedQualifiedName && specializedQualifiedName.includes("$") ? specializedQualifiedName : undefined;
        if (!targetCtorName) {
          flattener.usedRecordSymIds?.add(matchingFnSym.id);
          if (matchingFnSym.name) flattener.usedRecordNames?.add(matchingFnSym.name);
        }
        let ctorFn = targetCtorName
          ? dae.getFunction(targetCtorName)
          : (dae.getFunction(cleanFnName) ?? dae.getFunction(fnName));
        const extFlattener = asFlattenerExt(flattener);
        if (!ctorFn && extFlattener?.generateRecordConstructorFor) {
          ctorFn =
            extFlattener.generateRecordConstructorFor(
              matchingFnSym,
              dae,
              flattener.currentRootClassId,
              targetCtorName,
            ) ?? undefined;
        }
        if (ctorFn) {
          fnDae = ctorFn;
          fnName = targetCtorName ?? (ctorFn.name || cleanFnName);
        }
      } else if (matchingFnSym && flattener.isFunctionSym?.(matchingFnSym)) {
        const isOuterFn = isOuterFunctionSymbol(db, matchingFnSym);
        const hasInnerMatch = isOuterFn && hasMatchingInnerFunction(db, flattener, matchingFnSym.name ?? fnName);
        if (flattener.isClassPartial?.(matchingFnSym.id) && !(isOuterFn && hasInnerMatch)) {
          let callRange: DaeDiagnosticRange | undefined = undefined;
          if (node) {
            let n: SyntaxNode | null | undefined = node;
            while (n && n.type !== "component_clause" && n.parent) {
              if (n.type === "statement" || n.type === "function_call") break;
              n = n.parent;
            }
            if (n && n.type === "component_clause") {
              callRange = {
                startPosition: n.startPosition,
                endPosition: n.endPosition,
                startOffset: n.startIndex ?? n.startOffset,
                endOffset: n.endIndex ?? n.endOffset,
              };
            } else {
              callRange = {
                startPosition: node.startPosition,
                endPosition: node.endPosition,
                startOffset: node.startIndex ?? node.startOffset,
                endOffset: node.endIndex ?? node.endOffset,
              };
            }
          }
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CALLED_FUNCTION_PARTIAL.code,
            message: ModelicaErrorCode.CALLED_FUNCTION_PARTIAL.message(matchingFnSym.name || fnName),
            range: callRange,
          });
          return -1;
        }
        if (flattener.invalidInterfaceFunctionIds?.has(matchingFnSym.id)) {
          const scopeName = (flattener.currentRootClassId ? db.symbol(flattener.currentRootClassId)?.name : "") ?? "";
          let callRange: DaeDiagnosticRange | undefined = undefined;
          if (node) {
            let n: SyntaxNode | null | undefined = node;
            while (n && n.type !== "component_clause" && n.parent) {
              if (n.type === "statement" || n.type === "function_call") break;
              n = n.parent;
            }
            if (n && n.type === "component_clause") {
              callRange = {
                startPosition: n.startPosition,
                endPosition: n.endPosition,
              };
            } else {
              callRange = {
                startPosition: node.startPosition,
                endPosition: node.endPosition,
              };
            }
          }
          if (dae.extensionMetadata?.["isOldFrontend"]) {
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
              message: ModelicaErrorCode.CLASS_NOT_FOUND.message(cleanFnName, scopeName),
              range: callRange,
            });
          }
          return dae.addCallExpr(fnName, argExprIds);
        }
        const qualifiedFnName = specializedQualifiedName ?? getSymbolQualifiedName(db, matchingFnSym.id);
        flattener.calledFunctionSymIds?.add(matchingFnSym.id);
        const isRecursiveCall = Boolean(flattener.activeFlatteningFunctionIds?.has(matchingFnSym.id));
        const prevCompPrefix = asFlattenerExt(flattener)!.currentFunctionComponentPrefix;
        const prevSpecPrefix = asFlattenerExt(flattener)!.currentFunctionSpecializedPrefix;
        asFlattenerExt(flattener)!.currentFunctionComponentPrefix = componentInstancePrefix;
        asFlattenerExt(flattener)!.currentFunctionSpecializedPrefix = componentSpecializedPrefix;
        let fn: DAEBuilder;
        try {
          fn = isRecursiveCall
            ? (dae.getFunction(qualifiedFnName) ?? dae.getFunction(cleanFnName) ?? dae.getFunction(fnName) ?? dae)
            : (flattener.flattenFunction?.(matchingFnSym.id, qualifiedFnName, undefined, dae, enclosingScopeId) ?? dae);
        } finally {
          asFlattenerExt(flattener)!.currentFunctionComponentPrefix = prevCompPrefix;
          asFlattenerExt(flattener)!.currentFunctionSpecializedPrefix = prevSpecPrefix;
        }
        if (isRecursiveCall) {
          asDaeExt(fn).isRecursive = true;
        }
        asDaeExt(fn).symId = matchingFnSym.id;
        if (fn.diagnostics.some((d) => d.severity === "error")) {
          for (const d of fn.diagnostics) {
            (d as DaeDiagnostic & { fromFunction?: boolean }).fromFunction = true;
            if (!dae.diagnostics.some((existing) => existing.message === d.message)) {
              dae.diagnostics.push(d);
            }
          }
          flattener.failedFunctionIds?.add(matchingFnSym.id);
          const hasInterfaceError = fn.diagnostics.some(
            (d) =>
              d.severity === "error" &&
              d.code !== ModelicaErrorCode.EXTERNAL_WITH_ALGORITHM.code &&
              d.code !== ModelicaErrorCode.CYCLIC_FUNCTION_COMPONENTS.code &&
              !d.message.includes("looking for a function or record"),
          );
          if (hasInterfaceError) {
            flattener.invalidInterfaceFunctionIds?.add(matchingFnSym.id);
            const scopeName = (flattener.currentRootClassId ? db.symbol(flattener.currentRootClassId)?.name : "") ?? "";
            let callRange: DaeDiagnosticRange | undefined = undefined;
            if (node) {
              let n: SyntaxNode | null | undefined = node;
              while (n && n.type !== "component_clause" && n.parent) {
                if (n.type === "statement" || n.type === "function_call") break;
                n = n.parent;
              }
              if (n && n.type === "component_clause") {
                callRange = {
                  startPosition: n.startPosition,
                  endPosition: n.endPosition,
                };
              } else {
                callRange = {
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                };
              }
            }
            if (dae.extensionMetadata?.["isOldFrontend"]) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
                message: ModelicaErrorCode.CLASS_NOT_FOUND.message(cleanFnName, scopeName),
                range: callRange,
              });
            }
          }
          return dae.addCallExpr(fnName, argExprIds);
        }
        const fnAlias = asDaeExt(fn).aliasTo;
        if (fnAlias) {
          fnName = fnAlias;
          fnDae = undefined;
        } else {
          const isBuiltinExt = Boolean(fn.externalDecl && fn.externalDecl.includes('"builtin"'));
          if (!isBuiltinExt) {
            dae.addFunction(qualifiedFnName, fn);
            if (!specializedQualifiedName) {
              dae.addFunction(cleanFnName, fn);
              dae.addFunction(fnName, fn);
              if (
                parts.length === 1 &&
                fnBase &&
                !SCALAR_VECTORIZABLE_FUNCTIONS.has(fnBase) &&
                !BUILTIN_FUNCTIONS.has(fnBase)
              ) {
                dae.addFunction(fnBase, fn);
              }
            }
            let rootDae: LowererDaeExt = asDaeExt(flattener?.currentRootDae ?? dae);
            while (rootDae.parentDae) rootDae = rootDae.parentDae;
            rootDae.addFunction(qualifiedFnName, fn);
            if (aliasCloneFnName && !rootDae.functions.has(aliasCloneFnName)) {
              const aliasFn = fn.clone();
              aliasFn.name = aliasCloneFnName;
              asDaeExt(aliasFn).wasCalled = true;
              dae.addFunction(aliasCloneFnName, aliasFn);
              rootDae.addFunction(aliasCloneFnName, aliasFn);
            }
            if (fn.functions && fn.functions.size > 0) {
              for (const [nestedName, nestedFn] of fn.functions.entries()) {
                rootDae.addFunction(nestedName, nestedFn);
              }
            }
            fnDae = fn;
            fnName = qualifiedFnName;
          } else {
            const extCall = extractExternalBuiltinCall(fn.externalDecl!);
            fnName = extCall ? extCall.fnName : fnBase || fn.name.split(".").pop()!;
            fnDae = undefined;
          }
        }
        if (qualifiedFnName.startsWith("Modelica.Math.")) {
          const mathBase = qualifiedFnName.slice("Modelica.Math.".length);
          if (
            mathBase === "sin" ||
            mathBase === "cos" ||
            mathBase === "tan" ||
            mathBase === "asin" ||
            mathBase === "acos" ||
            mathBase === "atan" ||
            mathBase === "atan2" ||
            mathBase === "sinh" ||
            mathBase === "cosh" ||
            mathBase === "tanh" ||
            mathBase === "exp" ||
            mathBase === "log" ||
            mathBase === "log10" ||
            mathBase === "sqrt"
          ) {
            fnName = mathBase;
            fnDae = undefined;
          }
        }
      } else if (!matchingFnSym) {
        const isBuiltin =
          SCALAR_VECTORIZABLE_FUNCTIONS.has(cleanFnName) ||
          (!cleanFnName.includes(".") && SCALAR_VECTORIZABLE_FUNCTIONS.has(fnBase)) ||
          BUILTIN_FUNCTIONS.has(cleanFnName) ||
          (!cleanFnName.includes(".") && BUILTIN_FUNCTIONS.has(fnBase)) ||
          cleanFnName === "size" ||
          cleanFnName === "ndims" ||
          cleanFnName === "min" ||
          cleanFnName === "max" ||
          cleanFnName === "sum" ||
          cleanFnName === "product" ||
          cleanFnName === "cross" ||
          cleanFnName === "skew" ||
          cleanFnName === "array" ||
          cleanFnName === "zeros" ||
          cleanFnName === "ones" ||
          cleanFnName === "fill" ||
          cleanFnName === "identity" ||
          cleanFnName === "diagonal" ||
          cleanFnName === "linspace" ||
          cleanFnName === "transpose" ||
          cleanFnName === "symmetric" ||
          cleanFnName === "cat" ||
          cleanFnName === "inStream" ||
          cleanFnName === "actualStream" ||
          cleanFnName === "spatialDistribution" ||
          cleanFnName === "cardinality" ||
          cleanFnName === "homotopy" ||
          cleanFnName === "semiLinear" ||
          cleanFnName === "delay" ||
          cleanFnName === "smooth" ||
          cleanFnName === "sample" ||
          cleanFnName === "reinit" ||
          cleanFnName === "assert" ||
          cleanFnName === "terminate" ||
          cleanFnName === "initial" ||
          cleanFnName === "terminal" ||
          cleanFnName === "div" ||
          cleanFnName === "mod" ||
          cleanFnName === "rem" ||
          cleanFnName === "String" ||
          cleanFnName === "Real" ||
          cleanFnName === "Integer" ||
          cleanFnName === "Boolean";
        if (!isBuiltin) {
          const scopeId = flattener.currentFlatteningFunctionId ?? flattener.currentRootClassId;
          const scopeName = (scopeId ? db.symbol(scopeId)?.name : "") ?? "";
          let callRange: DaeDiagnosticRange | undefined = undefined;
          if (node) {
            let n: SyntaxNode | null | undefined = node;
            while (n && n.type !== "component_clause" && n.parent) {
              if (n.type === "statement" || n.type === "function_call") break;
              n = n.parent;
            }
            if (n && n.type === "component_clause") {
              callRange = {
                startPosition: n.startPosition,
                endPosition: n.endPosition,
              };
            } else {
              callRange = {
                startPosition: node.startPosition,
                endPosition: node.endPosition,
              };
            }
          }
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
            message: ModelicaErrorCode.CLASS_NOT_FOUND.message(cleanFnName, scopeName),
            range: callRange,
          });
          return -1;
        }
      }
    }

    // ==========================================================================
    // User-Defined Function Parameter Binding, Default Argument Cycle Detection,
    // Compile-Time Constant Evaluation, and Single-Assignment Inlining
    // ==========================================================================
    if (fnDae) {
      if (flattener?.options?.omcCompatibility) {
        // Check for cyclic dependencies in default arguments by constructing a dependency graph
        // over omitted input parameters and running a DFS cycle detector (hasCycle).
        const unfilledDefaults = new Map<string, Set<string>>();
        const positionalCount = argExprIds.length;
        let inCount = 0;
        for (let i = 0; i < fnDae.varCount; i++) {
          if (fnDae.getVarCausality(i) === Causality.Input) {
            const inputName = fnDae.getVarName(i);
            const isProvided = namedArgs.has(inputName) || inCount < positionalCount;
            inCount++;
            if (!isProvided) {
              const defExprId = fnDae.getVarExpression(i);
              if (typeof defExprId === "number" && defExprId >= 0) {
                const names = fnDae.collectExprVarNames(defExprId);
                unfilledDefaults.set(inputName, names);
              }
            }
          }
        }
        if (unfilledDefaults.size > 1) {
          const visited = new Set<string>();
          const inStack = new Set<string>();
          let cycleArg: string | null = null;
          const hasCycle = (curr: string): boolean => {
            visited.add(curr);
            inStack.add(curr);
            const neighbors = unfilledDefaults.get(curr);
            if (neighbors) {
              for (const next of neighbors) {
                if (next === curr) continue;
                const rawCallPrefix = cleanFnName.includes(".")
                  ? cleanFnName.slice(0, cleanFnName.lastIndexOf("."))
                  : "";
                const callPrefix =
                  rawCallPrefix && prefix ? resolveScopedName(rawCallPrefix, prefix, dae) : rawCallPrefix;
                const isOuterVar =
                  (callPrefix &&
                    (dae.getVarIdxByName(`${callPrefix}.${next}`) >= 0 ||
                      dae.getVarIdxByName(`${callPrefix}.${next}[1]`) >= 0)) ||
                  dae.getVarIdxByName(next) >= 0 ||
                  dae.getVarIdxByName(`${next}[1]`) >= 0;
                if (isOuterVar) {
                  continue;
                }
                if (unfilledDefaults.has(next)) {
                  if (inStack.has(next)) {
                    cycleArg = next;
                    return true;
                  }
                  if (!visited.has(next) && hasCycle(next)) {
                    return true;
                  }
                }
              }
            }
            inStack.delete(curr);
            return false;
          };
          for (const name of unfilledDefaults.keys()) {
            if (!visited.has(name) && hasCycle(name)) break;
          }
          if (cycleArg) {
            let callRange: DaeDiagnosticRange | undefined = undefined;
            if (node) {
              let n: SyntaxNode | null | undefined = node;
              while (n && n.type !== "component_clause" && n.parent) {
                if (n.type === "statement" || n.type === "function_call") break;
                n = n.parent;
              }
              if (n && n.type === "component_clause") {
                callRange = {
                  startPosition: n.startPosition,
                  endPosition: n.endPosition,
                };
              } else {
                callRange = {
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                };
              }
            }
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.FUNCTION_DEFAULT_ARG_CYCLE.code,
              message: ModelicaErrorCode.FUNCTION_DEFAULT_ARG_CYCLE.message(cycleArg),
              range: callRange,
            });
            return -1;
          }
        }
      }

      // Bind formal input parameters in declaration order from named arguments, positional arguments,
      // or default binding expressions cloned from fnDae into the caller DAE via copyExprBetweenDaes.
      const positionalArgs = [...argExprIds];
      const newArgExprIds: number[] = [];
      const inputSubstitutions = new Map<string, number>();
      const structuralInputNames = new Set<string>();
      for (let vi = 0; vi < fnDae.varCount; vi++) {
        const sExprs = fnDae.getVarShapeExprs ? fnDae.getVarShapeExprs(vi) : null;
        if (sExprs) {
          for (const seId of sExprs) {
            if (seId >= 0) {
              for (const nm of fnDae.collectExprVarNames(seId)) {
                structuralInputNames.add(nm);
              }
            }
          }
        }
      }
      let prePosIdx = 0;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Input) {
          const inputName = fnDae.getVarName(i);
          let preAid: number | undefined = undefined;
          if (namedArgs.has(inputName)) {
            preAid = namedArgs.get(inputName)!;
          } else if (prePosIdx < positionalArgs.length) {
            preAid = positionalArgs[prePosIdx];
            prePosIdx++;
          }
          if (preAid !== undefined && preAid >= 0) {
            let substVal = preAid;
            const expectedShape = fnDae.getVarShape(i) ?? [];
            const cVal = evalDaeExpr(preAid, dae);
            if (cVal !== null) {
              if (expectedShape.length === 0 && typeof cVal === "number") {
                const foldedId = addArenaValueAsExpr(dae, cVal);
                if (foldedId >= 0) substVal = foldedId;
              } else if (expectedShape.length > 0 && Array.isArray(cVal)) {
                const foldedId = addArenaValueAsExpr(dae, cVal);
                if (foldedId >= 0) substVal = foldedId;
              }
            }
            const expectedType = fnDae.getVarType(i);
            const expectedCustomType = fnDae.getVarCustomType(i);
            const providedType = inferArenaExprVarType(dae, substVal);
            const preDims = getExprDims(substVal, dae, flattener?.db) ?? [];
            if (
              expectedType === VarType.Real &&
              !expectedCustomType &&
              expectedShape.length === preDims.length &&
              (providedType === VarType.Integer || providedType === null)
            ) {
              substVal = castToRealExpr(substVal, dae);
            }
            inputSubstitutions.set(inputName, substVal);
          }
        }
      }
      let posIdx = 0;
      let emitShapeMismatchDiag: (() => void) | null = null;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Input) {
          const inputName = fnDae.getVarName(i);
          let aid: number | undefined = undefined;
          let argNode: SyntaxNode | undefined = undefined;
          let isFromDefault = false;
          if (namedArgs.has(inputName)) {
            aid = namedArgs.get(inputName)!;
          } else if (posIdx < positionalArgs.length) {
            aid = positionalArgs[posIdx];
            argNode = argNodes[posIdx];
            posIdx++;
          } else if (flattener?.options?.omcCompatibility) {
            const defExprId = fnDae.getVarExpression(i);
            if (typeof defExprId === "number" && defExprId >= 0) {
              const rawCallPrefix = cleanFnName.includes(".") ? cleanFnName.slice(0, cleanFnName.lastIndexOf(".")) : "";
              const callPrefix =
                rawCallPrefix && prefix ? resolveScopedName(rawCallPrefix, prefix, dae) : rawCallPrefix;
              const defId = copyExprBetweenDaes(fnDae, defExprId, dae, inputSubstitutions, callPrefix);
              if (defId >= 0) {
                aid = defId;
                isFromDefault = true;
              }
            }
          }
          if (aid !== undefined && aid >= 0) {
            let substVal = aid;
            const expectedShape = fnDae.getVarShape(i) ?? [];
            const cVal = evalDaeExpr(aid, dae);
            if (cVal !== null) {
              if (expectedShape.length === 0 && typeof cVal === "number") {
                const foldedId = addArenaValueAsExpr(dae, cVal);
                if (foldedId >= 0) substVal = foldedId;
              } else if (expectedShape.length > 0 && Array.isArray(cVal)) {
                const foldedId = addArenaValueAsExpr(dae, cVal);
                if (foldedId >= 0) substVal = foldedId;
              }
            }
            if (structuralInputNames.has(inputName) && fnDae.getVarType(i) === VarType.Integer && substVal !== aid) {
              aid = substVal;
            } else if (
              isFromDefault &&
              substVal !== aid &&
              dae.getExprKind(aid) === ExprKind.Call &&
              dae.interner.resolve(dae.getExprData1(aid)) === "fill"
            ) {
              aid = substVal;
            }
            inputSubstitutions.set(inputName, substVal);
            let actualDims = getExprDims(aid, dae, flattener?.db) ?? [];
            if (
              actualDims.length === 0 &&
              expectedShape.length > 0 &&
              dae.getExprKind(aid) === ExprKind.Name &&
              flattener?.db
            ) {
              const vName = dae.interner.resolve(dae.getExprData1(aid)) ?? "";
              const simpleName = vName.includes(".") ? vName.split(".").pop()! : vName;
              const scopeId = flattener.currentClassId ?? flattener.currentRootClassId;
              const resolver = scopeId
                ? (flattener.db.query<NameResolver | null>("resolveName", scopeId) ??
                  flattener.db.query<NameResolver | null>("resolveSimpleName", scopeId))
                : null;
              const sym =
                resolver?.(vName) ??
                resolver?.(simpleName) ??
                flattener.db.byName(simpleName)?.find((s) => s.kind === "Component");
              if (sym && sym.kind === "Component") {
                const rawDims = flattener.db.query<unknown[] | null>("arrayDimensions", sym.id);
                if (Array.isArray(rawDims) && rawDims.length === expectedShape.length) {
                  actualDims = rawDims.map(() => -1);
                }
              }
              // Handle array-of-components field projection (e.g. `compositeStep.suspend.reset`
              // where `suspend[nSuspend]` is an array and `reset` is a scalar field) before
              // sibling components have been instantiated in `dae`.
              if (actualDims.length === 0 && vName.includes(".") && dae.getVarIdxByName(vName) < 0) {
                const segs = vName.split(".");
                for (let si = segs.length - 2; si >= 0; si--) {
                  const seg = segs[si]!;
                  if (!seg || seg.includes("[")) continue;
                  const segSym = resolver?.(seg) ?? flattener.db.byName(seg)?.find((s) => s.kind === "Component");
                  if (segSym && segSym.kind === "Component") {
                    const segDims = flattener.db.query<unknown[] | null>("arrayDimensions", segSym.id);
                    if (Array.isArray(segDims) && segDims.length > 0) {
                      actualDims = [...actualDims, ...segDims.map(() => -1)];
                      if (actualDims.length >= expectedShape.length) break;
                    }
                  }
                }
              }
            }
            const isColonDim = (d: number) => d === -1;
            const shapeMatches =
              expectedShape.length === actualDims.length &&
              expectedShape.every(
                (ed, idx) => isColonDim(ed) || isColonDim(actualDims[idx]!) || ed === actualDims[idx]!,
              );
            if (!shapeMatches) {
              if (!emitShapeMismatchDiag) {
                emitShapeMismatchDiag = () => {
                  const printer = new ArenaDAEPrinter({ write: () => {} }, dae, true);
                  const callArgsStr = positionalArgs.map((paId) => printer.printExprToString(paId)).join(", ");
                  const callExpr = `${cleanFnName || fnName}(${callArgsStr})`;

                  let retTypeStr = "Real";
                  for (let vi = 0; vi < fnDae.varCount; vi++) {
                    if (fnDae.getVarCausality(vi) === Causality.Output) {
                      const vt = fnDae.getVarType(vi);
                      retTypeStr =
                        vt === VarType.Integer
                          ? "Integer"
                          : vt === VarType.Boolean
                            ? "Boolean"
                            : vt === VarType.String
                              ? "String"
                              : "Real";
                      break;
                    }
                  }

                  const callArgSigParts: string[] = [];
                  const candArgSigParts: string[] = [];
                  let inP = 0;
                  for (let vi = 0; vi < fnDae.varCount; vi++) {
                    if (fnDae.getVarCausality(vi) === Causality.Input) {
                      const pName = fnDae.getVarName(vi);
                      const expType = fnDae.getVarType(vi);
                      const expShape = fnDae.getVarShape(vi) ?? [];
                      const expTypeName =
                        expType === VarType.Integer
                          ? "Integer"
                          : expType === VarType.Boolean
                            ? "Boolean"
                            : expType === VarType.String
                              ? "String"
                              : "Real";
                      const expShapeStr = expShape.length > 0 ? `[${expShape.join(", ")}]` : "";
                      candArgSigParts.push(`${expTypeName}${expShapeStr} ${pName}`);

                      const provId = positionalArgs[inP];
                      if (provId !== undefined) {
                        const provType = inferArenaExprVarType(dae, provId);
                        const provDims = getExprDims(provId, dae, flattener?.db) ?? [];
                        const provTypeName =
                          provType === VarType.Integer
                            ? "Integer"
                            : provType === VarType.Boolean
                              ? "Boolean"
                              : provType === VarType.String
                                ? "String"
                                : "Real";
                        const provDimsStr = provDims.length > 0 ? `[${provDims.join(", ")}]` : "";
                        callArgSigParts.push(`${provTypeName}${provDimsStr} ${pName}`);
                      }
                      inP++;
                    }
                  }

                  const callSig = `.${cleanFnName || fnName}<function>(${callArgSigParts.join(", ")}) => ${retTypeStr} in component <NO COMPONENT>`;
                  const candidateSig = `.${cleanFnName || fnName}<function>(${candArgSigParts.join(", ")}) => ${retTypeStr}`;

                  const startB = node.startIndex ?? node.startOffset;
                  const endB = node.endIndex ?? node.endOffset;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.NO_MATCHING_FUNCTION.code,
                    message: ModelicaErrorCode.NO_MATCHING_FUNCTION.message(callExpr, callSig, candidateSig),
                    range:
                      startB != null && endB != null
                        ? {
                            startOffset: startB,
                            endOffset: endB,
                            startPosition: node.startPosition,
                            endPosition: node.endPosition,
                          }
                        : undefined,
                  });
                };
              }
            }

            const expectedType = fnDae.getVarType(i);
            const expectedCustomType = fnDae.getVarCustomType(i);
            const providedType = inferArenaExprVarType(dae, aid);
            let finalType = providedType;
            if (
              shapeMatches &&
              expectedType === VarType.Real &&
              !expectedCustomType &&
              (providedType === VarType.Integer || providedType === null)
            ) {
              aid = castToRealExpr(aid, dae);
              finalType = VarType.Real;
            }
            if (
              finalType !== null &&
              !isAssignableType(finalType, expectedType, { intEnumConversion: flattener?.options?.intEnumConversion })
            ) {
              let eqNode: SyntaxNode | null | undefined = node;
              while (
                eqNode &&
                eqNode.type !== "simple_equation" &&
                eqNode.type !== "component_clause" &&
                eqNode.type !== "statement" &&
                eqNode.type !== "assignment_statement"
              ) {
                eqNode = eqNode.parent;
              }
              const diagNode = eqNode ?? node;
              const startB = diagNode?.startIndex ?? diagNode?.startOffset;
              const endB = diagNode?.endIndex ?? diagNode?.endOffset;
              const argText = argNode?.text?.trim() ?? "...";
              const callText = `${cleanFnName || fnName}(${inputName}=${argText})`;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                message: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(
                  callText,
                  String(newArgExprIds.length + 1),
                  varTypeName(finalType),
                  varTypeName(expectedType),
                ),
                range: {
                  startOffset: startB,
                  endOffset: endB,
                  startPosition: diagNode?.startPosition,
                  endPosition: diagNode?.endPosition,
                },
              });
              return -1;
            }
            newArgExprIds.push(aid);
          }
        }
      }
      if (emitShapeMismatchDiag) {
        const vecId = vectorizeFunctionCall(cleanFnName || fnName, newArgExprIds, dae, flattener, db, fnDae);
        if (vecId !== null) {
          asDaeExt(fnDae).wasCalled = true;
          return vecId;
        }
        (emitShapeMismatchDiag as () => void)();
        return -1;
      }
      argExprIds = newArgExprIds;
    }

    // Verify that formal parameters declared with `constant` variability receive constant arguments
    if (fnDae && !asDaeExt(fnDae).isOperatorRecord && !fnDae.description?.includes("record constructor")) {
      let inputParamIdx = 0;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Input) {
          const reqVariability = fnDae.getVarVariability(i);
          if (reqVariability === Variability.Constant) {
            const actualArgId = argExprIds[inputParamIdx];
            if (actualArgId !== undefined && exprContainsNonConstantRef(actualArgId, dae)) {
              const paramName = fnDae.getVarName(i);
              const argNode = argNodes[inputParamIdx];
              const argText = argNode?.text?.trim() ?? dae.interner.resolve(dae.getExprData1(actualArgId)) ?? "";
              const funcName = cleanFnName || fnDae.name;

              let compClause: SyntaxNode | null | undefined = node;
              while (
                compClause &&
                compClause.type !== "component_clause" &&
                compClause.type !== "simple_equation" &&
                !compClause.type?.endsWith("_equation") &&
                compClause.type !== "statement"
              ) {
                compClause = compClause.parent;
              }
              const diagNode = compClause ?? node;
              const startB = diagNode?.startIndex ?? diagNode?.startOffset;
              const endB = diagNode?.endIndex ?? diagNode?.endOffset;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.FUNCTION_ARG_VARIABILITY.code,
                message: ModelicaErrorCode.FUNCTION_ARG_VARIABILITY.message(paramName, argText, funcName, "constant"),
                range: {
                  startOffset: startB,
                  endOffset: endB,
                  startPosition: diagNode?.startPosition,
                  endPosition: diagNode?.endPosition,
                },
              });
              return -1;
            }
          }
          inputParamIdx++;
        }
      }
    }

    if (
      flattener?.options?.omcCompatibility &&
      fnDae &&
      fnDae.name.endsWith("Vectors.interpolate") &&
      argExprIds.length > 0
    ) {
      const firstArg = argExprIds[0];
      if (firstArg !== undefined && firstArg >= 0 && dae.getExprKind(firstArg) === ExprKind.ArrayCtor) {
        const elems = getArrayCtorElements(firstArg, dae);
        const literalElems: number[] = [];
        let allLiterals = true;
        for (const e of elems) {
          const val = evalDaeExpr(e, dae);
          if (typeof val === "number") {
            literalElems.push(dae.addRealLiteral(val));
          } else {
            allLiterals = false;
            break;
          }
        }
        if (allLiterals && literalElems.length === elems.length) {
          argExprIds[0] = dae.addArrayCtorExpr(literalElems);
        }
      }
    }

    // Attempt compile-time constant evaluation (evaluateArenaFunctionCall) when all arguments
    // are constant, or inline single-assignment pure functions (isEarlyInline).
    if (fnDae && !asDaeExt(fnDae).isOperatorRecord && !fnDae.description?.includes("record constructor")) {
      let hasOutputExpr = false;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Output) {
          const expr = fnDae.getVarExpression(i);
          if (typeof expr === "number" && expr >= 0) {
            hasOutputExpr = true;
            break;
          }
        }
      }

      let allConstant = true;
      const constArgs: ArenaValue[] = [];
      for (const aid of argExprIds) {
        let evalAid = aid;
        if (dae.getExprKind(aid) === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(aid));
          const expanded = vName ? expandVarToArrayCtor(vName, dae) : null;
          if (expanded !== null) evalAid = expanded;
        }
        if (
          exprContainsNonConstantRef(evalAid, dae) &&
          !(fnDae.name.endsWith("Vectors.normalize") && dae.getExprKind(evalAid) === ExprKind.ArrayCtor)
        ) {
          allConstant = false;
          break;
        }
        const cVal = evalDaeExpr(evalAid, dae);
        if (cVal === null) {
          allConstant = false;
          break;
        }
        constArgs.push(cVal);
      }

      if (
        flattener?.options?.omcCompatibility &&
        Boolean(getDaeExtMeta(dae)?.hasOldInstOption) &&
        !asDaeExt(fnDae).isBeingFlattened &&
        !asDaeExt(fnDae).isRecursive &&
        (!asDaeExt(fnDae).symId || !flattener?.activeFlatteningFunctionIds?.has(asDaeExt(fnDae).symId!)) &&
        fnDae.eqCount === 0 &&
        fnDae.algorithmSections.length === 0 &&
        !fnDae.externalDecl &&
        !fnDae.name.endsWith("Utilities.automaticLocalSeed") &&
        !hasOutputExpr &&
        argExprIds.every((aid) => evalDaeExpr(aid, dae) !== null)
      ) {
        let firstOutputType: VarType | null = null;
        let firstOutputHasArrayDims = false;
        let outputCount = 0;
        for (let i = 0; i < fnDae.varCount; i++) {
          if (fnDae.getVarCausality(i) === Causality.Output) {
            if (outputCount === 0) {
              firstOutputType = fnDae.getVarType(i);
              firstOutputHasArrayDims = (fnDae.getVarShape(i)?.length ?? 0) > 0;
            }
            outputCount++;
          }
        }
        if (
          outputCount === 1 &&
          firstOutputType !== null &&
          !firstOutputHasArrayDims &&
          cleanFnName !== "equalityConstraint"
        ) {
          asDaeExt(fnDae).wasCalled = true;
          if (firstOutputType === VarType.Integer) return dae.addIntLiteral(0);
          if (firstOutputType === VarType.Boolean) return dae.addBoolLiteral(false);
          if (firstOutputType === VarType.String) return dae.addStringLiteral("");
          return dae.addRealLiteral(0.0);
        }
      }

      if (
        allConstant &&
        !asDaeExt(fnDae).isExplicitImpure &&
        !asDaeExt(fnDae).isBeingFlattened &&
        !asDaeExt(fnDae).isRecursive &&
        (!asDaeExt(fnDae).symId || !flattener?.activeFlatteningFunctionIds?.has(asDaeExt(fnDae).symId!))
      ) {
        try {
          const fnInternId = typeof fnName === "string" ? dae.interner.intern(fnName) : fnName;
          const outVal = evaluateArenaFunctionCall(
            dae,
            fnInternId,
            constArgs,
            db,
            flattener?.currentRootClassId ?? undefined,
          );
          if (outVal !== null && outVal !== undefined && !(typeof outVal === "number" && Number.isNaN(outVal))) {
            asDaeExt(fnDae).wasCalled = true;
            let outputCount = 0;
            let firstOutputType: VarType | null = null;
            let firstOutputCustomType: string | null = null;
            let firstOutputIsScalar = true;
            const outputTypes: VarType[] = [];
            for (let i = 0; i < fnDae.varCount; i++) {
              if (fnDae.getVarCausality(i) === Causality.Output) {
                if (outputCount === 0) {
                  firstOutputType = fnDae.getVarType(i);
                  firstOutputCustomType = fnDae.getVarCustomType(i) ?? null;
                  firstOutputIsScalar = (fnDae.getVarShape(i)?.length ?? 0) === 0;
                }
                outputTypes.push(fnDae.getVarType(i));
                outputCount++;
              }
            }
            if (tupleContext && Array.isArray(outVal) && outputCount > 1) {
              const tupleElemExprIds: number[] = [];
              for (let i = 0; i < outVal.length; i++) {
                const elemId = addArenaValueAsExpr(dae, outVal[i], outputTypes[i] ?? undefined);
                if (elemId >= 0) tupleElemExprIds.push(elemId);
              }
              if (tupleElemExprIds.length === outVal.length) {
                return dae.addTupleExpr(tupleElemExprIds);
              }
            }
            const firstVal = Array.isArray(outVal) && outputCount > 1 ? outVal[0] : outVal;
            if (firstOutputCustomType && firstOutputIsScalar && Array.isArray(firstVal)) {
              const leafCtor = firstOutputCustomType.includes(".")
                ? firstOutputCustomType.split(".").pop()!
                : firstOutputCustomType;
              let ctorFn =
                dae.getFunction(firstOutputCustomType) ??
                dae.getFunction(leafCtor) ??
                fnDae.getFunction(firstOutputCustomType) ??
                fnDae.getFunction(leafCtor);
              if (!ctorFn) {
                const suffix = `.${leafCtor}`;
                for (const sDae of [fnDae, dae, asDaeExt(dae).parentDae]) {
                  if (!sDae?.functions) continue;
                  for (const candFn of sDae.functions.values()) {
                    if (
                      candFn.description?.includes("record constructor") &&
                      (candFn.name === firstOutputCustomType ||
                        candFn.name === leafCtor ||
                        candFn.name.endsWith(suffix))
                    ) {
                      ctorFn = candFn;
                      break;
                    }
                  }
                  if (ctorFn) break;
                }
              }
              const fieldTypes: VarType[] = [];
              if (ctorFn) {
                for (let vi = 0; vi < ctorFn.varCount; vi++) {
                  if (!ctorFn.isVarRemoved(vi) && ctorFn.getVarCausality(vi) === Causality.Input) {
                    fieldTypes.push(ctorFn.getVarType(vi));
                  }
                }
              }
              const ctorElemIds = firstVal.map((v, idx) => addArenaValueAsExpr(dae, v, fieldTypes[idx]));
              if (ctorElemIds.every((id) => id >= 0)) {
                return dae.addCallExpr(ctorFn?.name || firstOutputCustomType, ctorElemIds);
              }
            }
            const inlinedId = addArenaValueAsExpr(dae, firstVal, firstOutputType ?? undefined);
            if (inlinedId >= 0) return inlinedId;
          }
        } catch (err: unknown) {
          const evalErr = err as EvalErrorLike | null | undefined;
          if (
            evalErr?.code === 4009 ||
            evalErr?.message?.includes("causes a cyclic dependency") ||
            evalErr?.message?.includes("assert triggered:") ||
            evalErr?.message?.includes("limit (--eval")
          ) {
            let compClause: SyntaxNode | null | undefined = node;
            while (compClause && compClause.type !== "component_clause") {
              compClause = compClause.parent;
            }
            const diagNode = compClause ?? node;
            const startB = evalErr.range?.startOffset ?? diagNode?.startIndex ?? diagNode?.startOffset;
            const endB = evalErr.range?.endOffset ?? diagNode?.endIndex ?? diagNode?.endOffset;
            dae.diagnostics.push({
              severity: "error",
              code: evalErr?.code ?? 0,
              message: evalErr.message ?? "",
              range: {
                startOffset: startB,
                endOffset: endB,
                startPosition: evalErr.range?.startPosition ?? diagNode?.startPosition,
                endPosition: evalErr.range?.endPosition ?? diagNode?.endPosition,
              },
            });
            return -1;
          }
          // ignore evaluation error and fall back to call expression
        }
      }

      if (
        !asDaeExt(fnDae).isExplicitImpure &&
        !asDaeExt(fnDae).isBeingFlattened &&
        !asDaeExt(fnDae).isRecursive &&
        (!asDaeExt(fnDae).symId || !flattener?.activeFlatteningFunctionIds?.has(asDaeExt(fnDae).symId!)) &&
        asDaeExt(fnDae).isEarlyInline &&
        fnDae.stmtCount === 1 &&
        fnDae.getStmtKind(0) === StmtKind.Assignment
      ) {
        const subs = new Map<string, number>();
        let inputIdx = 0;
        for (let i = 0; i < fnDae.varCount; i++) {
          if (fnDae.getVarCausality(i) === Causality.Input) {
            const inName = fnDae.getVarName(i);
            if (inputIdx < argExprIds.length) {
              subs.set(inName, argExprIds[inputIdx]!);
            }
            inputIdx++;
          }
        }
        const rhsExprId = fnDae.getStmtLeft(0);
        if (rhsExprId >= 0) {
          const inlinedId = copyExprBetweenDaes(fnDae, rhsExprId, dae, subs);
          if (inlinedId >= 0) {
            asDaeExt(fnDae).wasInlined = true;
            return inlinedId;
          }
        }
      }
      let outCount = 0;
      for (let i = 0; i < fnDae.varCount; i++) {
        if (fnDae.getVarCausality(i) === Causality.Output) outCount++;
      }
      let targetFnCallName =
        fnDae.externalDecl && fnDae.externalDecl.includes('"builtin"')
          ? typeof fnName === "string"
            ? fnName
            : fnDae.name.split(".").pop()!
          : fnDae.name;
      if (dae.extensionMetadata?.["isOldFrontend"] && fnDae.externalDecl) {
        const extCall = extractExternalBuiltinCall(fnDae.externalDecl);
        if (extCall && extCall.hasNonEmptyArg && (extCall.fnName === "sin" || extCall.fnName === "cos")) {
          targetFnCallName = extCall.fnName;
        }
      }
      const isOldFeForArgs = Boolean(
        dae.extensionMetadata?.["isOldFrontend"] ||
        flattener?.isOldFrontend ||
        flattener?.currentRootDae?.extensionMetadata?.["isOldFrontend"],
      );
      const tryCollapseWholeArrayArg = (argId: number): number => {
        if (isOldFeForArgs || dae.getExprKind(argId) !== ExprKind.ArrayCtor) return argId;
        const elems = getArrayCtorElements(argId, dae);
        if (elems.length === 0) return argId;
        // 1D whole-array check: {base[1], ..., base[N]}
        if (dae.getExprKind(elems[0]!) === ExprKind.Name) {
          const firstName = dae.interner.resolve(dae.getExprData1(elems[0]!));
          const m = firstName?.match(/^(.+)\[1\]$/);
          if (!m) return argId;
          const base = m[1]!;
          for (let i = 0; i < elems.length; i++) {
            if (dae.getExprKind(elems[i]!) !== ExprKind.Name) return argId;
            if (dae.interner.resolve(dae.getExprData1(elems[i]!)) !== `${base}[${i + 1}]`) return argId;
          }
          // Ensure it's the whole array (not a slice like v[1:2] of a larger array)
          if (dae.getVarIdxByName(`${base}[${elems.length + 1}]`) >= 0) return argId;
          return dae.addExpression(ExprKind.Name, dae.interner.intern(base));
        }
        // 2D whole-array check: {{base[1,1], ..., base[1,C]}, ..., {base[R,1], ..., base[R,C]}}
        if (dae.getExprKind(elems[0]!) === ExprKind.ArrayCtor) {
          const row0 = getArrayCtorElements(elems[0]!, dae);
          if (row0.length === 0 || dae.getExprKind(row0[0]!) !== ExprKind.Name) return argId;
          const firstName = dae.interner.resolve(dae.getExprData1(row0[0]!));
          const m = firstName?.match(/^(.+)\[1,1\]$/);
          if (!m) return argId;
          const base = m[1]!;
          const numRows = elems.length;
          const numCols = row0.length;
          for (let r = 0; r < numRows; r++) {
            if (dae.getExprKind(elems[r]!) !== ExprKind.ArrayCtor) return argId;
            const row = getArrayCtorElements(elems[r]!, dae);
            if (row.length !== numCols) return argId;
            for (let c = 0; c < numCols; c++) {
              if (dae.getExprKind(row[c]!) !== ExprKind.Name) return argId;
              if (dae.interner.resolve(dae.getExprData1(row[c]!)) !== `${base}[${r + 1},${c + 1}]`) return argId;
            }
          }
          if (
            dae.getVarIdxByName(`${base}[${numRows + 1},1]`) >= 0 ||
            dae.getVarIdxByName(`${base}[1,${numCols + 1}]`) >= 0
          ) {
            return argId;
          }
          return dae.addExpression(ExprKind.Name, dae.interner.intern(base));
        }
        return argId;
      };
      let inIdx = 0;
      for (let vi = 0; vi < fnDae.varCount; vi++) {
        if (fnDae.getVarCausality(vi) === Causality.Input) {
          if (inIdx < argExprIds.length) {
            argExprIds[inIdx] = tryCollapseWholeArrayArg(argExprIds[inIdx]!);
            const expectedType = fnDae.getVarType(vi);
            if (expectedType === VarType.Real && !fnDae.getVarCustomType(vi) && !isRealExpr(argExprIds[inIdx]!, dae)) {
              argExprIds[inIdx] = castToRealExpr(argExprIds[inIdx]!, dae);
            }
          }
          inIdx++;
        }
      }
      let callExprId = dae.addCallExpr(targetFnCallName, argExprIds);
      if (outCount > 1 && !tupleContext) {
        callExprId = dae.addSubscriptExpr(callExprId, [dae.addIntLiteral(1)]);
      }
      return callExprId;
    }

    if (cleanFnName === "assert") {
      let eqNode: SyntaxNode | null | undefined = node;
      while (
        eqNode &&
        eqNode.type !== "simple_equation" &&
        eqNode.type !== "component_clause" &&
        eqNode.type !== "statement" &&
        eqNode.type !== "assignment_statement"
      ) {
        eqNode = eqNode.parent;
      }
      const diagNode = eqNode ?? node;
      const startB = diagNode?.startIndex ?? diagNode?.startOffset;
      const endB = diagNode?.endIndex ?? diagNode?.endOffset;
      const range =
        startB != null && endB != null
          ? {
              startOffset: startB,
              endOffset: endB,
              startPosition: diagNode?.startPosition,
              endPosition: diagNode?.endPosition,
            }
          : undefined;

      // Arg 1: condition: Boolean
      if (argExprIds.length >= 1) {
        const aid0 = argExprIds[0]!;
        const t0 = inferArenaExprVarType(dae, aid0);
        if (t0 !== null && t0 !== VarType.Boolean) {
          const actualType = varTypeName(t0);
          const argText = argNodes[0]?.text?.trim() ?? "...";
          const callText = `assert(condition=${argText})`;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(callText, "1", actualType, "Boolean"),
            range,
          });
          return -1;
        }
      }

      // Arg 2: message: String
      if (argExprIds.length >= 2) {
        const aid1 = argExprIds[1]!;
        const t1 = inferArenaExprVarType(dae, aid1);
        if (t1 !== null && t1 !== VarType.String) {
          const actualType = varTypeName(t1);
          const argText = argNodes[1]?.text?.trim() ?? "...";
          const callText = `assert(message=${argText})`;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(callText, "2", actualType, "String"),
            range,
          });
          return -1;
        }
      }

      // Arg 3: level: enumeration AssertionLevel(warning, error)
      if (argExprIds.length >= 3) {
        const aid2 = argExprIds[2]!;
        const t2 = inferArenaExprVarType(dae, aid2);
        if (t2 !== null && t2 !== VarType.Enumeration) {
          const actualType = varTypeName(t2);
          const argText = argNodes[2]?.text?.trim() ?? "...";
          const callText = `assert(level=${argText})`;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(
              callText,
              "3",
              actualType,
              "enumeration AssertionLevel(warning, error)",
            ),
            range,
          });
          return -1;
        }

        // Check variability: must be parameter or constant
        const argText = argNodes[2]?.text?.trim() ?? "";
        let vIdx = -1;
        if (dae.getExprKind(aid2) === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(aid2));
          vIdx = vName ? dae.getVarIdxByName(vName) : -1;
          if (vIdx < 0 && prefix && vName) vIdx = dae.getVarIdxByName(`${prefix}.${vName}`);
        }
        if (vIdx < 0 && argText) {
          vIdx = dae.getVarIdxByName(argText);
          if (vIdx < 0 && prefix) vIdx = dae.getVarIdxByName(`${prefix}.${argText}`);
        }
        if (vIdx >= 0) {
          const v = dae.getVarVariability(vIdx);
          if (v !== Variability.Parameter && v !== Variability.Constant) {
            const varbStr =
              v === Variability.Continuous && dae.getVarType(vIdx) === VarType.Real ? "continuous" : "discrete";
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.FUNCTION_ARG_VARIABILITY.code,
              message: ModelicaErrorCode.FUNCTION_ARG_VARIABILITY.message(
                "level",
                argText,
                "assert",
                "parameter",
                varbStr,
              ),
              range,
            });
            return -1;
          }
        }
      }
    }

    if (cleanFnName === "terminate") {
      let eqNode: SyntaxNode | null | undefined = node;
      while (
        eqNode &&
        eqNode.type !== "simple_equation" &&
        eqNode.type !== "component_clause" &&
        eqNode.type !== "statement" &&
        eqNode.type !== "assignment_statement"
      ) {
        eqNode = eqNode.parent;
      }
      const diagNode = eqNode ?? node;
      const startB = diagNode?.startIndex ?? diagNode?.startOffset;
      const endB = diagNode?.endIndex ?? diagNode?.endOffset;
      const range =
        startB != null && endB != null
          ? {
              startOffset: startB,
              endOffset: endB,
              startPosition: diagNode?.startPosition,
              endPosition: diagNode?.endPosition,
            }
          : undefined;

      if (argExprIds.length >= 1) {
        const aid0 = argExprIds[0]!;
        const t0 = inferArenaExprVarType(dae, aid0);
        if (t0 !== null && t0 !== VarType.String) {
          const actualType = varTypeName(t0);
          const argText = argNodes[0]?.text?.trim() ?? "...";
          const callText = `terminate(message=${argText})`;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(callText, "1", actualType, "String"),
            range,
          });
          return -1;
        }
      }
    }

    const cleanFn = cleanFnName || (typeof fnName === "string" ? (fnName.split(".").pop() ?? "") : fnName);
    if (
      cleanFn === "div" ||
      cleanFn === "rem" ||
      cleanFn === "mod" ||
      cleanFn === "integer" ||
      SCALAR_VECTORIZABLE_FUNCTIONS.has(cleanFn)
    ) {
      let allConstant = true;
      const constArgs: number[] = [];
      for (const aid of argExprIds) {
        if (exprContainsNonConstantRef(aid, dae)) {
          allConstant = false;
          break;
        }
        const cVal = evalDaeExpr(aid, dae);
        if (typeof cVal !== "number") {
          allConstant = false;
          break;
        }
        constArgs.push(cVal);
      }
      if (allConstant && constArgs.length === argExprIds.length) {
        if (cleanFn === "integer" && constArgs.length === 1) {
          return dae.addIntLiteral(Math.floor(constArgs[0]!));
        }
        if (cleanFn === "div" && constArgs.length === 2) {
          const res = constArgs[1] !== 0 ? Math.trunc(constArgs[0]! / constArgs[1]!) : 0;
          const isInt =
            inferArenaExprVarType(dae, argExprIds[0]!) === VarType.Integer &&
            inferArenaExprVarType(dae, argExprIds[1]!) === VarType.Integer;
          return isInt ? dae.addIntLiteral(res) : dae.addRealLiteral(res);
        }
        if (cleanFn === "rem" && constArgs.length === 2) {
          const res =
            constArgs[1] !== 0 ? constArgs[0]! - Math.trunc(constArgs[0]! / constArgs[1]!) * constArgs[1]! : 0;
          const isInt =
            inferArenaExprVarType(dae, argExprIds[0]!) === VarType.Integer &&
            inferArenaExprVarType(dae, argExprIds[1]!) === VarType.Integer;
          return isInt ? dae.addIntLiteral(res) : dae.addRealLiteral(res);
        }
        if (cleanFn === "mod" && constArgs.length === 2) {
          const res =
            constArgs[1] !== 0 ? constArgs[0]! - Math.floor(constArgs[0]! / constArgs[1]!) * constArgs[1]! : 0;
          const isInt =
            inferArenaExprVarType(dae, argExprIds[0]!) === VarType.Integer &&
            inferArenaExprVarType(dae, argExprIds[1]!) === VarType.Integer;
          return isInt ? dae.addIntLiteral(res) : dae.addRealLiteral(res);
        }
        const scalarBuiltin = SCALAR_VECTORIZABLE_FUNCTIONS.get(cleanFn);
        if (scalarBuiltin?.fold && constArgs.length === scalarBuiltin.arity) {
          if ((cleanFn === "acos" || cleanFn === "asin") && (constArgs[0]! < -1 || constArgs[0]! > 1)) {
            let cur: SyntaxNode | null | undefined = node;
            while (
              cur &&
              cur.type !== "component_clause" &&
              cur.type !== "simple_equation" &&
              cur.type !== "statement" &&
              cur.type !== "assignment_statement"
            ) {
              cur = cur.parent;
            }
            const diagRange = getElementDiagRange(cur ?? node);
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
              message: `Argument ${constArgs[0]} of ${cleanFn} is out of range (-1 <= x <= 1)`,
              range: diagRange,
            });
            return -1;
          }
          const val = scalarBuiltin.fold(...constArgs);
          const isInt =
            cleanFn === "sign" || (cleanFn === "abs" && inferArenaExprVarType(dae, argExprIds[0]!) === VarType.Integer);
          if (val !== null) return isInt ? dae.addIntLiteral(Math.round(val)) : dae.addRealLiteral(val);
        }
      } else if ((cleanFn === "div" || cleanFn === "rem" || cleanFn === "mod") && argExprIds.length === 2) {
        if (isRealExpr(argExprIds[0]!, dae) && !isRealExpr(argExprIds[1]!, dae)) {
          argExprIds[1] = castToRealExpr(argExprIds[1]!, dae);
        } else if (!isRealExpr(argExprIds[0]!, dae) && isRealExpr(argExprIds[1]!, dae)) {
          argExprIds[0] = castToRealExpr(argExprIds[0]!, dae);
        }
      } else if ((cleanFn === "integer" || cleanFn === "floor" || cleanFn === "ceil") && argExprIds.length === 1) {
        if (!isRealExpr(argExprIds[0]!, dae)) {
          argExprIds[0] = castToRealExpr(argExprIds[0]!, dae);
        }
      }
    }
    if (
      cleanFn === "sqrt" &&
      argExprIds.length === 1 &&
      Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
      argExprIds[0]! >= 0 &&
      dae.getExprKind(argExprIds[0]!) === ExprKind.Call &&
      dae.interner.resolve(dae.getExprData1(argExprIds[0]!)) === "sqrt" &&
      dae.getExprRight(argExprIds[0]!) === 1
    ) {
      const innerArg = dae.getExprLeft(argExprIds[0]!);
      return dae.addBinaryExpr(BinOp.Pow, innerArg, dae.addRealLiteral(0.25));
    }
    if (cleanFn === "noEvent" && argExprIds.length === 1 && flattener?.options?.omcCompatibility) {
      const innerId = argExprIds[0]!;
      if (innerId >= 0 && dae.getExprKind(innerId) === ExprKind.Binary) {
        const innerOp = dae.getExprData1(innerId);
        if (
          innerOp === BinOp.Add ||
          innerOp === BinOp.Sub ||
          innerOp === BinOp.Mul ||
          innerOp === BinOp.Div ||
          innerOp === BinOp.Pow
        ) {
          return innerId;
        }
      }
    }
    if ((cleanFn === "inStream" || cleanFn === "actualStream") && argExprIds.length === 1) {
      const innerId = argExprIds[0]!;
      if (innerId >= 0 && dae.getExprKind(innerId) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(innerId));
        const arrShape = vName ? getNamedArrayShape(dae, vName) : null;
        if (arrShape && arrShape.some((d) => d === 0)) {
          return dae.addArrayCtorExpr([]);
        }
      }
      if (innerId >= 0 && dae.getExprKind(innerId) === ExprKind.ArrayCtor) {
        const count = dae.getExprData1(innerId);
        if (count === 0) return innerId;
        const elems: number[] = [];
        for (let i = 0; i < count; i++) {
          const eId = i === 0 ? dae.getExprLeft(innerId) : dae.getExprLeft(innerId + i);
          elems.push(dae.addCallExpr(cleanFn, [eId]));
        }
        return dae.addArrayCtorExpr(elems);
      }
    }

    if (db && fnName) {
      let fnSym: SymbolEntry | null = null;
      if (flattener?.currentRootClassId) {
        const resolver =
          db.query<NameResolver | null>("resolveName", flattener.currentRootClassId) ??
          db.query<NameResolver | null>("resolveSimpleName", flattener.currentRootClassId);
        if (resolver) fnSym = resolver(fnName) ?? null;
      }
      if (!fnSym) {
        fnSym =
          db.byName(fnName).find((s) => {
            if (s.kind !== "Function" && s.kind !== "Class") return false;
            if (SCALAR_VECTORIZABLE_FUNCTIONS.has(fnName)) {
              const qual = getSymbolQualifiedName(db, s.id);
              if (qual.includes("ComplexMath")) return false;
            }
            return true;
          }) ?? null;
      }
      const isOuterFn = isOuterFunctionSymbol(db, fnSym);
      const hasInnerMatch = isOuterFn && hasMatchingInnerFunction(db, flattener, fnSym?.name ?? fnName);
      if (fnSym && flattener?.isClassPartial?.(fnSym.id) && !(isOuterFn && hasInnerMatch)) {
        let cur: SyntaxNode | null | undefined = node;
        while (
          cur &&
          cur.type !== "simple_equation" &&
          cur.type !== "component_clause" &&
          cur.type !== "statement" &&
          cur.type !== "assignment_statement" &&
          cur.parent
        ) {
          cur = cur.parent;
        }
        const diagNode = cur ?? node;
        const startB = diagNode?.startIndex ?? diagNode?.startOffset;
        const endB = diagNode?.endIndex ?? diagNode?.endOffset;
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.CALLED_FUNCTION_PARTIAL.code,
          message: ModelicaErrorCode.CALLED_FUNCTION_PARTIAL.message(fnName),
          range:
            startB != null && endB != null
              ? {
                  startOffset: startB,
                  endOffset: endB,
                  startPosition: diagNode?.startPosition,
                  endPosition: diagNode?.endPosition,
                }
              : undefined,
        });
        return -1;
      }
    }

    return dae.addCallExpr(fnName, argExprIds);
  }

  return null;
}
