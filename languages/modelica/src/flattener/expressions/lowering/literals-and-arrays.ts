// SPDX-License-Identifier: AGPL-3.0-or-later

import { ExprKind } from "@modelscript/dsl";
import { ArenaDAEPrinter, DAEBuilder } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import { getFlatteningState, popLoopVar, pushLoopVar } from "../../support/state.js";
import type { LoweringContext } from "../../types.js";
import { getArrayCtorElements, getArrayCtorRank, negateExpr } from "../binary-ops.js";
import { expandColonToArrayCtor, findArraySubscriptsForIter } from "../comprehensions.js";
import {
  evaluateCSTNumber,
  expandVarToArrayCtor,
  flattenColonNodes,
  getArrayLiteralItems,
  getDaeDimSize,
  isInsideForIndex,
  isSignedAsciiNumberText,
  resolveEnumType,
  resolveScopedName,
  stripOuterDoubleQuotes,
} from "../cst-utils.js";
import { castToRealExpr, getExprDims, isRealExpr } from "../eval.js";

import { asDaeExt, asFlattenerExt } from "./helpers.js";
import type { LowerExprFn } from "./types.js";

export function lowerLiteralCSTExpression(node: SyntaxNode, dae: DAEBuilder): number | null {
  const type = node.type;
  // Real or Integer literal
  if (
    type === "unsigned_number" ||
    type === "unsigned_integer" ||
    type === "unsigned_real" ||
    type === "number_literal" ||
    type === "NumberLiteral" ||
    ((type.startsWith("/") || node.childCount === 0) && isSignedAsciiNumberText(node.text?.trim() ?? ""))
  ) {
    const text = node.text.trim();
    if (text.includes(".") || text.toLowerCase().includes("e")) {
      return dae.addRealLiteral(parseFloat(text));
    }
    const intVal = parseInt(text, 10);
    return isNaN(intVal) ? dae.addRealLiteral(parseFloat(text)) : dae.addIntLiteral(intVal);
  }

  // Boolean literal
  const rawType = stripOuterDoubleQuotes(type);
  const trimmedText = node.text?.trim() ?? "";
  if (
    rawType === "true" ||
    rawType === "false" ||
    rawType === "boolean_literal" ||
    trimmedText === "true" ||
    trimmedText === "false"
  ) {
    return dae.addExpression(ExprKind.BoolLiteral, rawType === "true" || trimmedText === "true" ? 1 : 0);
  }

  // String literal
  if (type === "string_literal" || type === "StringLiteral") {
    const raw = node.text.trim();
    const str = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    return dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(str));
  }

  // "time" keyword
  if (type === "time" || node.text.trim() === "time") {
    if (dae.classKind === "function") {
      let isDecl = false;
      let targetNode: SyntaxNode | null | undefined = node;
      let cur: SyntaxNode | null | undefined = node;
      while (cur) {
        if (cur.type === "component_clause") {
          isDecl = true;
          targetNode = cur;
          break;
        }
        if (cur.type === "component_declaration") {
          isDecl = true;
          targetNode = cur;
        }
        cur = cur.parent;
      }
      if (isDecl) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.BUILTIN_TIME_INVALID.code,
          message: "Built-in variable 'time' may only be used in a model or block.",
          range: {
            startPosition: targetNode.startPosition,
            endPosition: targetNode.endPosition,
          },
        });
      } else {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.BUILTIN_TIME_INVALID.code,
          message: "time is not allowed in a function.",
          range: {
            startPosition: node.startPosition,
            endPosition: node.endPosition,
          },
        });
      }
    }
    return dae.addExpression(ExprKind.Name, dae.interner.intern("time"));
  }

  // "end" keyword outside array subscripts
  if (type === "end" || (type === "identifier" && node.text?.trim() === "end") || node.text?.trim() === "end") {
    let inSubscript = false;
    let cur: SyntaxNode | null | undefined = node.parent;
    while (cur) {
      if (cur.type === "subscript" || cur.type === "array_subscripts") {
        inSubscript = true;
        break;
      }
      cur = cur.parent;
    }
    if (!inSubscript) {
      let targetNode: SyntaxNode | null | undefined = node;
      cur = node.parent;
      while (cur) {
        if (
          cur.type === "simple_equation" ||
          cur.type === "component_clause" ||
          cur.type === "component_declaration" ||
          cur.type === "statement" ||
          cur.type === "assignment_statement"
        ) {
          targetNode = cur;
          break;
        }
        cur = cur.parent;
      }
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.ILLEGAL_END_USAGE.code,
        message: ModelicaErrorCode.ILLEGAL_END_USAGE.message(),
        range: {
          startOffset: targetNode.startIndex ?? targetNode.startOffset,
          endOffset: targetNode.endIndex ?? targetNode.endOffset,
          startPosition: targetNode.startPosition,
          endPosition: targetNode.endPosition,
        },
      });
      return dae.addExpression(ExprKind.IntLiteral, 0);
    }
  }

  return null;
}

export function lowerParenOrArrayCSTExpression(
  node: SyntaxNode,
  dae: DAEBuilder,
  ctx: LoweringContext,
  lowerExpr: LowerExprFn,
): number | null {
  const { prefix = "", substitutions, imports, db, flattener } = ctx;
  const type = node.type;
  // Parenthesized expression: "(" expr ")" or tuple "( expr1, expr2, ... )"
  if (
    (type === "primary" ||
      type === "lhs_primary" ||
      type === "expression" ||
      type === "lhs_expression" ||
      type === "output_expression_list" ||
      type === "expression_list") &&
    (((node.child(0)?.type === "(" || node.child(0)?.text === "(" || node.child(0)?.type === '"("') &&
      (node.child(node.childCount - 1)?.type === ")" ||
        node.child(node.childCount - 1)?.text === ")" ||
        node.child(node.childCount - 1)?.type === '")"')) ||
      type === "output_expression_list" ||
      type === "expression_list")
  ) {
    const isParen =
      (node.child(0)?.type === "(" || node.child(0)?.text === "(" || node.child(0)?.type === '"("') &&
      (node.child(node.childCount - 1)?.type === ")" ||
        node.child(node.childCount - 1)?.text === ")" ||
        node.child(node.childCount - 1)?.type === '")"');
    const startIdx = isParen ? 1 : 0;
    const endIdx = isParen ? node.childCount - 1 : node.childCount;
    const exprNodes: SyntaxNode[] = [];
    for (let i = startIdx; i < endIdx; i++) {
      const c = node.child(i);
      if (!c) continue;
      const cText = c.text?.trim() ?? "";
      const cType = c.type ?? "";
      if (cText === "," || cType === "," || cType === '","') continue;
      if (cType === "output_expression_list" || cType === "expression_list") {
        for (let j = 0; j < c.childCount; j++) {
          const sub = c.child(j);
          if (sub && sub.text?.trim() !== "," && sub.type !== "," && sub.type !== '","') {
            exprNodes.push(sub);
          }
        }
      } else {
        exprNodes.push(c);
      }
    }
    if (exprNodes.length === 1) {
      return lowerExpr(exprNodes[0], dae, prefix, substitutions, imports, db, flattener);
    } else if (exprNodes.length > 1) {
      const tupleElemIds = exprNodes.map((e) => lowerExpr(e, dae, prefix, substitutions, imports, db, flattener, true));
      return dae.addTupleExpr(tupleElemIds);
    }
  }

  // Array constructor: { e1, e2, ... }
  if (
    (type === "primary" || type === "lhs_primary") &&
    (node.child(0)?.type === "{" || node.child(0)?.text === "{" || node.child(0)?.type === '"{"') &&
    (node.child(node.childCount - 1)?.type === "}" ||
      node.child(node.childCount - 1)?.text === "}" ||
      node.child(node.childCount - 1)?.type === '"}"')
  ) {
    const elementIds: number[] = [];
    for (let i = 1; i < node.childCount - 1; i++) {
      const c = node.child(i);
      if (c && (c.type === "expression" || c.type === "lhs_expression" || c.type === "array_arguments")) {
        if (c.type === "array_arguments") {
          const hasFor = (c.children || []).some((k) => k.type === "for" || k.text?.trim() === "for");
          if (hasFor) {
            const exprChild = c.child(0);
            const indicesNode = (c.children || []).find((k) => k.type === "for_indices");
            const forIndices = (indicesNode?.children || []).filter((k) => k.type === "for_index");
            if (exprChild && forIndices.length > 0) {
              const iters: { name: string; values: (number | string)[] }[] = [];
              for (const fi of forIndices) {
                const varName = Cst.ForIndex.variable(fi)?.text?.trim() || fi.child(0)?.text?.trim();
                if (!varName) continue;
                const rangeNode = Cst.ForIndex.range(fi) || fi.children?.find?.((k) => k.type === "expression");
                let values: (number | string)[] = [];
                let rangeResolved = false;
                const isImplicit = !rangeNode;
                if (rangeNode) {
                  const evalScopeId =
                    flattener?.currentClassId ??
                    flattener?.currentRootClassId ??
                    getFlatteningState(dae).currentClassId;
                  const rangeText = rangeNode.text?.trim() ?? "";
                  if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
                    const items = getArrayLiteralItems(rangeNode);
                    let allResolved = true;
                    for (const item of items) {
                      const v = evaluateCSTNumber(item, substitutions, evalScopeId, db, dae, prefix);
                      if (v !== null) values.push(v);
                      else allResolved = false;
                    }
                    if (allResolved) rangeResolved = true;
                  } else if (rangeText.includes(":")) {
                    const colonNodes = flattenColonNodes(rangeNode);
                    if (colonNodes.length >= 2) {
                      const s = evaluateCSTNumber(colonNodes[0], substitutions, evalScopeId, db, dae, prefix);
                      let e: number | null = null;
                      let step = 1;
                      if (colonNodes.length === 2) {
                        e = evaluateCSTNumber(colonNodes[1], substitutions, evalScopeId, db, dae, prefix);
                      } else if (colonNodes.length >= 3) {
                        step = evaluateCSTNumber(colonNodes[1], substitutions, evalScopeId, db, dae, prefix) ?? 1;
                        e = evaluateCSTNumber(colonNodes[2], substitutions, evalScopeId, db, dae, prefix);
                      }
                      if (s !== null && e !== null) {
                        rangeResolved = true;
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
                    } else {
                      const parts = rangeText.split(":");
                      const s = parseInt(parts[0]!.trim(), 10);
                      const e = parseInt(parts[parts.length - 1]!.trim(), 10);
                      if (!isNaN(s) && !isNaN(e)) {
                        rangeResolved = true;
                        for (let val = s; val <= e; val++) values.push(val);
                      }
                    }
                  }
                }
                if (values.length === 0 && !rangeResolved && rangeNode) {
                  const rangeText = rangeNode.text?.trim() ?? "";
                  const dimSize =
                    getDaeDimSize(prefix, rangeText, 0, dae, db) || getDaeDimSize("", rangeText, 0, dae, db);
                  if (dimSize > 0) {
                    values = Array.from({ length: dimSize }, (_, idx) => `${rangeText}[${idx + 1}]`);
                  }
                }
                if (values.length === 0 && !rangeResolved) {
                  values = findArraySubscriptsForIter(exprChild, varName, dae, db, prefix, isImplicit, fi);
                }
                if (values.length > 0 || rangeResolved) {
                  iters.push({ name: varName, values });
                }
              }

              if (iters.length === forIndices.length && iters.length >= 1) {
                for (const it of iters) pushLoopVar(flattener, it.name);
                try {
                  // Modelica 3.6 §10.4.2: {expr for i1 in r1, i2 in r2} === {{expr for i1 in r1} for i2 in r2}
                  const buildSubComprehension = (
                    dimIdx: number,
                    currentSubs: Map<string, number | string>,
                  ): number[] => {
                    const iter = iters[dimIdx]!;
                    const ids: number[] = [];
                    for (const val of iter.values) {
                      const nextSubs = new Map(currentSubs);
                      nextSubs.set(iter.name, val);
                      if (dimIdx === 0) {
                        ids.push(lowerExpr(exprChild, dae, prefix, nextSubs, imports, db, flattener));
                      } else {
                        ids.push(dae.addArrayCtorExpr(buildSubComprehension(dimIdx - 1, nextSubs)));
                      }
                    }
                    return ids;
                  };
                  elementIds.push(...buildSubComprehension(iters.length - 1, new Map(substitutions)));
                } finally {
                  for (const it of iters) popLoopVar(flattener, it.name);
                }
                continue;
              }
              const iterators: { name: string; rangeId: number }[] = [];
              for (const fi of forIndices) {
                const varName = (Cst.ForIndex.variable(fi)?.text?.trim() || fi.child(0)?.text?.trim() || "").trim();
                const rangeNode = Cst.ForIndex.range(fi) || fi.children?.find?.((k) => k.type === "expression");
                let rangeId = -1;
                if (rangeNode) {
                  rangeId = lowerExpr(rangeNode, dae, prefix, substitutions, imports, db, flattener);
                }
                if (varName) {
                  iterators.push({ name: varName, rangeId });
                }
              }
              if (iterators.length > 0) {
                for (const it of iterators) pushLoopVar(flattener, it.name);
                let bodyId: number;
                try {
                  bodyId = lowerExpr(exprChild, dae, prefix, substitutions, imports, db, flattener);
                } finally {
                  for (const it of iterators) popLoopVar(flattener, it.name);
                }
                return dae.addComprehensionExpr("array", bodyId, iterators);
              }
              continue;
            }
            continue;
          }
        }
        const collect = (n: SyntaxNode | null | undefined) => {
          if (!n) return;
          if (n.type === "expression") {
            elementIds.push(lowerExpr(n, dae, prefix, substitutions, imports, db, flattener));
            return;
          }
          for (let j = 0; j < n.childCount; j++) collect(n.child(j));
        };
        collect(c);
      }
    }
    if (elementIds.some((e) => isRealExpr(e, dae))) {
      for (let k = 0; k < elementIds.length; k++) {
        if (!isRealExpr(elementIds[k]!, dae)) {
          elementIds[k] = castToRealExpr(elementIds[k]!, dae);
        }
      }
    }
    return dae.addArrayCtorExpr(elementIds);
  }

  // Matrix / vector bracket constructor: [ e1; e2; ... ] or [ e1, e2, ... ]
  if (
    (type === "primary" || type === "lhs_primary") &&
    (node.child(0)?.type === "[" || node.child(0)?.text === "[" || node.child(0)?.type === '"["') &&
    (node.child(node.childCount - 1)?.type === "]" ||
      node.child(node.childCount - 1)?.text === "]" ||
      node.child(node.childCount - 1)?.type === '"]"')
  ) {
    const blocks: number[][] = [];
    let currentBlock: number[] = [];

    for (let i = 1; i < node.childCount - 1; i++) {
      const c = node.child(i);
      if (!c) continue;
      const text = c.text?.trim() ?? c.type;
      if (text === ";" || c.type === ";" || c.type === '";"') {
        if (currentBlock.length > 0) {
          blocks.push(currentBlock);
          currentBlock = [];
        }
        continue;
      }
      if (c.type === "expression_list" || c.type === "expression") {
        const collect = (n: SyntaxNode | null | undefined) => {
          if (!n) return;
          if (n.type === "expression") {
            const exprId = lowerExpr(n, dae, prefix, substitutions, imports, db, flattener);
            if (exprId >= 0) currentBlock.push(exprId);
            return;
          }
          for (let j = 0; j < n.childCount; j++) collect(n.child(j));
        };
        collect(c);
      }
    }
    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
    }

    if (blocks.length === 1 && blocks[0]!.length > 1) {
      const block = blocks[0]!;
      const rowCounts = block.map((item) => {
        const dims = getExprDims(item, dae, db);
        if (dims && dims.length >= 2) return dims[0]!;
        if (dims && dims.length === 1) return dims[0]!;
        const rank = getArrayCtorRank(item, dae);
        if (rank === 2) return getArrayCtorElements(item, dae).length;
        if (rank === 1) return getArrayCtorElements(item, dae).length;
        if (dae.getExprKind(item) === ExprKind.Call || dae.getExprKind(item) === ExprKind.Name) return -1;
        return 1;
      });
      const firstRowCount = rowCounts[0]!;
      const mismatchIdx = firstRowCount > 0 ? rowCounts.findIndex((r) => r > 0 && r !== firstRowCount) : -1;
      if (mismatchIdx !== -1) {
        let parentEq: SyntaxNode | null | undefined = node;
        while (parentEq && parentEq.type !== "simple_equation" && !parentEq.type?.endsWith("_equation")) {
          parentEq = parentEq.parent;
        }
        const diagNode = parentEq ?? node;
        const printer = new ArenaDAEPrinter({ write: () => {} }, dae, true);
        const item1Str = printer.printExprToString(block[0]!);
        const twoLit = dae.addIntLiteral(2);
        const promoted2 = dae.addCallExpr("promote", [block[mismatchIdx]!, twoLit]);
        const item2Str = printer.printExprToString(promoted2);
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
          message: `Arguments of concatenation comma operator have different sizes for the first dimension: ${item1Str} has dimension ${firstRowCount} and ${item2Str} has dimension ${rowCounts[mismatchIdx]}.`,
          range: {
            startOffset: diagNode?.startIndex ?? diagNode?.startOffset,
            endOffset: diagNode?.endIndex ?? diagNode?.endOffset,
            startPosition: diagNode?.startPosition,
            endPosition: diagNode?.endPosition,
          },
        });
        return -1;
      }
      const hasVectorOrDynamic = block.some((item) => {
        const dims = getExprDims(item, dae, db);
        if (dims && dims.length === 1) return true;
        const rank = getArrayCtorRank(item, dae);
        if (rank === 1) return true;
        if (rank === 0 && dae.getExprKind(item) === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(item));
          if (vName === "time") return false;
          const vIdx = vName ? dae.getVarIdxByName(vName) : -1;
          if (vIdx >= 0) {
            const shape = dae.getVarShape(vIdx);
            const shapeExprs = dae.getVarShapeExprs ? dae.getVarShapeExprs(vIdx) : null;
            return Boolean((shape && shape.length > 0) || (shapeExprs && shapeExprs.length > 0));
          }
        }
        return false;
      });
      if (hasVectorOrDynamic) {
        const twoLit = dae.addIntLiteral(2);
        const promoted = block.map((item) => {
          const dims = getExprDims(item, dae, db);
          if (dims && dims.length >= 2) return item;
          return dae.addCallExpr("promote", [item, twoLit]);
        });
        return dae.addCallExpr("cat", [twoLit, ...promoted]);
      }
    }

    const anySingleScalarBlock =
      blocks.length > 1 && blocks.some((b) => b.length === 1 && getArrayCtorRank(b[0]!, dae) === 0);
    const to2DRows = (item: number, blockLen: number): number[][] => {
      if (item < 0) return [];
      if (dae.getExprKind(item) === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(item));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) item = ctor;
        } else if (vName) {
          const vIdx = dae.getVarIdxByName(vName);
          if (vIdx >= 0) {
            const vExpr = asDaeExt(dae).getExplicitVarExpression
              ? asDaeExt(dae).getExplicitVarExpression(vIdx)
              : dae.getVarExpression(vIdx);
            if (vExpr != null && vExpr >= 0 && dae.getExprKind(vExpr) === ExprKind.ArrayCtor) {
              item = vExpr;
            }
          }
        }
      }
      const rank = getArrayCtorRank(item, dae);
      if (rank === 2) {
        const rows = getArrayCtorElements(item, dae);
        return rows.map((r) => getArrayCtorElements(r, dae));
      }
      if (rank === 1) {
        const elems = getArrayCtorElements(item, dae);
        if (elems.length === 0) return [];
        if (
          blockLen > 1 ||
          (blocks.length === 1 && blocks[0]?.length === 1) ||
          anySingleScalarBlock ||
          blocks.length > 1
        ) {
          return elems.map((e) => [e]);
        }
        return [elems];
      }
      return [[item]];
    };

    const rawMatrixRows: number[][] = [];
    for (const block of blocks) {
      if (block.length === 0) continue;
      const itemMatrices = block.map((it) => to2DRows(it, block.length));
      const maxRows = Math.max(...itemMatrices.map((m) => m.length));
      for (let r = 0; r < maxRows; r++) {
        const rowCols: number[] = [];
        for (const mat of itemMatrices) {
          if (r < mat.length) {
            rowCols.push(...mat[r]!);
          } else if (mat.length === 1) {
            rowCols.push(...mat[0]!);
          }
        }
        rawMatrixRows.push(rowCols);
      }
    }
    const matrixHasReal = rawMatrixRows.some((row) => row.some((e) => isRealExpr(e, dae)));
    const allMatrixRows = rawMatrixRows.map((row) =>
      dae.addArrayCtorExpr(matrixHasReal ? row.map((e) => (isRealExpr(e, dae) ? e : castToRealExpr(e, dae))) : row),
    );

    return dae.addArrayCtorExpr(allMatrixRows);
  }

  return null;
}

export function lowerFallbackCSTExpression(
  node: SyntaxNode,
  dae: DAEBuilder,
  ctx: LoweringContext,
  lowerExpr: LowerExprFn,
): number {
  const { prefix = "", substitutions, db, flattener } = ctx;
  // Unwrap any remaining single-child CST wrapper node before raw-text fallback
  if (node.childCount === 1 && node.child(0) && (node.child(0)!.childCount > 0 || node.child(0)!.type !== node.type)) {
    return lowerExpr(node.child(0), dae, ctx);
  }
  if (
    node.childCount === 3 &&
    (node.child(0)?.type === "(" || node.child(0)?.text?.trim() === "(") &&
    (node.child(2)?.type === ")" || node.child(2)?.text?.trim() === ")") &&
    node.child(1)
  ) {
    return lowerExpr(node.child(1), dae, ctx);
  }

  // Fallback: treat raw text as Name (after checking structural array/range/unary/paren forms)
  let fallback = node.text ? node.text.trim() : "";
  if (fallback.startsWith("{") && fallback.endsWith("}")) {
    const items = getArrayLiteralItems(node);
    if (items.length > 0 || fallback.slice(1, -1).trim() === "") {
      const elemIds = items.map((it) => lowerExpr(it, dae, ctx));
      if (elemIds.some((e) => isRealExpr(e, dae))) {
        for (let k = 0; k < elemIds.length; k++) {
          if (!isRealExpr(elemIds[k]!, dae)) {
            elemIds[k] = castToRealExpr(elemIds[k]!, dae);
          }
        }
      }
      return dae.addArrayCtorExpr(elemIds);
    }
  }
  if (fallback.includes(":") && !fallback.startsWith('"')) {
    const colonNodes = flattenColonNodes(node);
    if (colonNodes.length === 2 || colonNodes.length === 3) {
      const isForIndex = isInsideForIndex(node);
      const startId = lowerExpr(colonNodes[0], dae, ctx);
      const stepId = colonNodes.length === 3 ? lowerExpr(colonNodes[1], dae, ctx) : -1;
      const stopId = lowerExpr(colonNodes[colonNodes.length - 1], dae, ctx);
      const isAnyReal = isRealExpr(startId, dae) || (stepId >= 0 && isRealExpr(stepId, dae)) || isRealExpr(stopId, dae);
      const effStartId = isAnyReal ? castToRealExpr(startId, dae) : startId;
      const effStepId = stepId >= 0 ? (isAnyReal ? castToRealExpr(stepId, dae) : stepId) : -1;
      const effStopId = isAnyReal ? castToRealExpr(stopId, dae) : stopId;
      const rangeId = dae.addExpression(ExprKind.Range, effStartId, effStepId, effStopId);
      const expanded = !isForIndex ? expandColonToArrayCtor(rangeId, dae) : null;
      return expanded !== null ? expanded : rangeId;
    }
  }
  if (fallback.startsWith("(") && fallback.endsWith(")")) {
    let depth = 0;
    let inQuotes = false;
    let quoteChar = "";
    let outerBalanced = true;
    for (let i = 0; i < fallback.length; i++) {
      const ch = fallback[i]!;
      if (inQuotes) {
        if (ch === "\\" && i + 1 < fallback.length) {
          i++;
          continue;
        }
        if (ch === quoteChar) inQuotes = false;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuotes = true;
        quoteChar = ch;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
        if (depth === 0 && i < fallback.length - 1) {
          outerBalanced = false;
          break;
        }
      }
    }
    if (outerBalanced && depth === 0) {
      const innerText = fallback.slice(1, -1).trim();
      const extF1 = asFlattenerExt(flattener);
      if (extF1 && typeof extF1.lowerStandaloneText === "function") {
        const lowered = extF1.lowerStandaloneText(innerText, dae, prefix, substitutions);
        if (typeof lowered === "number" && lowered >= 0) return lowered;
      }
      fallback = innerText;
    }
  }
  if ((fallback.startsWith("-") || fallback.startsWith("+")) && fallback.length > 1) {
    const isNeg = fallback.startsWith("-");
    if (node.childCount >= 2 && node.child(node.childCount - 1)) {
      const innerId = lowerExpr(node.child(node.childCount - 1), dae, ctx);
      if (innerId >= 0) return isNeg ? negateExpr(innerId, dae) : innerId;
    }
    const extF2 = asFlattenerExt(flattener);
    if (extF2 && typeof extF2.lowerStandaloneText === "function") {
      const innerId = extF2.lowerStandaloneText(fallback.slice(1).trim(), dae, prefix, substitutions);
      if (typeof innerId === "number" && innerId >= 0) return isNeg ? negateExpr(innerId, dae) : innerId;
    }
  }
  if (substitutions && substitutions.has(fallback)) {
    const sVal = substitutions.get(fallback)!;
    if (typeof sVal === "number") return dae.addIntLiteral(sVal);
    if (typeof sVal === "string" && sVal.startsWith("expr:")) return Number(sVal.slice(5));
    if (sVal === "true" || sVal === "false") return dae.addExpression(ExprKind.BoolLiteral, sVal === "true" ? 1 : 0);
    if (typeof sVal === "string" && sVal.includes(".")) {
      const lastDot = sVal.lastIndexOf(".");
      const pfx = sVal.slice(0, lastDot);
      const lit = sVal.slice(lastDot + 1);
      const scopeId =
        flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId;
      const enumInfo = resolveEnumType(pfx, scopeId, db);
      if (enumInfo) {
        const idx = enumInfo.literals.indexOf(lit);
        if (idx >= 0) {
          let qual = enumInfo.qual;
          const rootName =
            (flattener?.currentRootClassId && db ? db.symbol(flattener.currentRootClassId)?.name : "") ||
            asDaeExt(dae).className;
          if (!dae.extensionMetadata?.["isOldFrontend"] && rootName && qual.startsWith(`${rootName}.`)) {
            qual = qual.slice(rootName.length + 1);
          }
          return dae.addEnumLiteral(idx + 1, `${qual}.${lit}`);
        }
      }
    }
    return dae.addExpression(ExprKind.Name, dae.interner.intern(sVal));
  }
  if (flattener?.activeLoopVars?.has(fallback)) {
    return dae.addExpression(ExprKind.Name, dae.interner.intern(fallback));
  }
  if (fallback.startsWith('"') && fallback.endsWith('"')) {
    return dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(fallback.slice(1, -1)));
  }
  fallback = resolveScopedName(fallback, prefix, dae, getFlatteningState(dae, flattener).innerOuterComponents);
  return dae.addExpression(ExprKind.Name, dae.interner.intern(fallback));
}
