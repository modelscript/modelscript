// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - Array Comprehensions & Iterators.
 *
 * Implements Cartesian product expansion, nested reduction, implicit iterator
 * subscript discovery, and range-to-array-constructor lowering.
 */

import { ExprKind } from "@modelscript/dsl";
import { BinOp, DAEBuilder, VarType, type QueryDB } from "@modelscript/runtime";
import type { SyntaxNode } from "../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../errors.js";
import { getFlatteningState } from "../support/state.js";
import { getConstVal } from "./eval.js";

export function cartesianProduct<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>((acc, curr) => acc.flatMap((c) => curr.map((n) => [...c, n])), [[]]);
}

export function reduceNestedValues(values: number[], shape: number[], op: "sum" | "product"): number {
  if (shape.length <= 1) {
    if (op === "sum") return values.reduce((a, b) => a + b, 0);
    return values.reduce((a, b) => a * b, 1);
  }
  const innerDim = shape[shape.length - 1]!;
  const outerShape = shape.slice(0, -1);
  const outerCount = Math.floor(values.length / innerDim);
  const innerReduced: number[] = [];
  for (let i = 0; i < outerCount; i++) {
    const chunk = values.slice(i * innerDim, (i + 1) * innerDim);
    if (op === "sum") {
      innerReduced.push(chunk.reduce((a, b) => a + b, 0));
    } else {
      innerReduced.push(chunk.reduce((a, b) => a * b, 1));
    }
  }
  return reduceNestedValues(innerReduced, outerShape, op);
}

export function getEnclosingClauseRange(
  node: SyntaxNode | null | undefined,
  dae: DAEBuilder,
): { startByte: number; endByte: number; startPosition?: any; endPosition?: any } | undefined {
  const state = getFlatteningState(dae);
  if (state.currentCompClauseRange) {
    return state.currentCompClauseRange;
  }
  let curr = node;
  while (
    curr &&
    curr.type !== "component_clause" &&
    curr.type !== "simple_equation" &&
    curr.type !== "statement" &&
    curr.type !== "assignment_statement" &&
    curr.type !== "for_equation" &&
    curr.type !== "for_statement"
  ) {
    curr = curr.parent;
  }
  if (curr) {
    const startByte = curr.startIndex ?? curr.startByte;
    const endByte = curr.endIndex ?? curr.endByte;
    return {
      startByte,
      endByte,
      startPosition: curr.startPosition,
      endPosition: curr.endPosition,
    };
  }
  return undefined;
}

export function findArraySubscriptsForIter(
  exprNode: any,
  iterName: string,
  dae: DAEBuilder,
  db?: QueryDB,
  prefix?: string,
  isImplicit = false,
  clauseNode?: any,
): (number | string)[] {
  interface SubscriptOccurrence {
    baseName: string;
    dimension: number;
    count: number;
    subs: (number | string)[];
    found: boolean;
  }
  const occurrences: SubscriptOccurrence[] = [];

  const search = (n: any) => {
    if (!n) return;
    if (Array.isArray(n)) {
      for (const item of n) search(item);
      return;
    }
    if (!isImplicit && occurrences.length > 0) return;
    if (
      n.type === "component_reference" ||
      (n.childCount >= 2 && n.child(n.childCount - 1)?.type === "array_subscripts")
    ) {
      const subsNode = (n.children || []).find((c: any) => c.type === "array_subscripts") ?? n.child(n.childCount - 1);
      if (subsNode && subsNode.type === "array_subscripts") {
        let subIdx = 0;
        for (let i = 0; i < subsNode.childCount; i++) {
          const sc = subsNode.child(i);
          if (sc.type === "subscript" || sc.type === "expression") {
            if (sc.text?.trim() === iterName) {
              let baseName = "";
              for (const ch of n.children || []) {
                if (ch === subsNode || ch.type === "array_subscripts") break;
                if (ch.type === "identifier" || ch.type === "name") {
                  baseName = baseName ? `${baseName}.${ch.text?.trim()}` : (ch.text?.trim() ?? "");
                }
              }
              if (!baseName) baseName = n.child(0)?.text?.trim() ?? "";
              if (baseName.startsWith(".")) baseName = baseName.slice(1);

              const daePrefixes = [prefix ? `${prefix}.${baseName}[` : `${baseName}[`, `${baseName}[`];
              const distinctSubs = new Set<string>();
              for (const daePrefix of daePrefixes) {
                for (let v = 0; v < dae.varCount; v++) {
                  if (dae.isVarRemoved(v)) continue;
                  const vName = dae.getVarName(v);
                  if (vName.startsWith(daePrefix)) {
                    const after = vName.slice(daePrefix.length);
                    const closing = after.indexOf("]");
                    if (closing >= 0) {
                      const subPart = after.slice(0, closing);
                      const tupleParts = subPart.split(",");
                      if (tupleParts.length > subIdx) {
                        distinctSubs.add(tupleParts[subIdx]!.trim());
                      }
                    }
                  }
                }
                if (distinctSubs.size > 0) break;
              }
              let subs: (number | string)[] = [];
              let found = distinctSubs.size > 0;
              if (distinctSubs.size > 0) {
                subs = [...distinctSubs].map((s) => (/^\d+$/.test(s) ? parseInt(s, 10) : s));
              } else if (db) {
                const parts = baseName.split(".");
                let pkgOrClass: any = null;
                const currentScopeId =
                  (dae as any).currentClassId ??
                  (dae as any).flattener?.currentClassId ??
                  (dae as any).flattener?.currentRootClassId;
                if (currentScopeId) {
                  const resolver =
                    db.query<any>("resolveName", currentScopeId) ?? db.query<any>("resolveSimpleName", currentScopeId);
                  const res = resolver?.(parts[0]!);
                  if (res && (res.kind === "Class" || res.kind === "Package")) {
                    pkgOrClass = res;
                  }
                }
                if (!pkgOrClass) {
                  const matches = db.byName(parts[0]!);
                  pkgOrClass = matches.find((e: any) => e.kind === "Class" || e.kind === "Package");
                }
                if (pkgOrClass) {
                  found = true;
                  if (pkgOrClass && parts.length > 1) {
                    const member = db.childrenOf(pkgOrClass.id).find((c) => c.name === parts[1]);
                    if (member) {
                      const dims = db.query<number[] | null>("resolvedArrayDimensions", member.id);
                      if (dims && dims.length > subIdx && dims[subIdx]! > 0) {
                        subs = Array.from({ length: dims[subIdx]! }, (_, k) => k + 1);
                      }
                    }
                  }
                }
              }
              if (!found) {
                for (const p of [prefix ? `${prefix}.${baseName}` : baseName, baseName]) {
                  if (dae.getVarIdxByName(p) >= 0 || dae.hasArrayElements(p)) {
                    found = true;
                    break;
                  }
                }
              }
              occurrences.push({
                baseName,
                dimension: subIdx + 1,
                count: subs.length,
                subs,
                found,
              });
              if (!isImplicit) return;
            }
            subIdx++;
          }
        }
        return;
      }
    }
    for (let i = 0; i < n.childCount; i++) search(n.child(i));
  };
  search(exprNode);

  if (isImplicit) {
    const state = getFlatteningState(dae);
    const notFound = occurrences.find((o) => !o.found);
    if (notFound) {
      const compRange = state.currentCompClauseRange ?? getEnclosingClauseRange(clauseNode ?? exprNode, dae);
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
        message: `Variable ${notFound.baseName} not found in scope .`,
        range: compRange,
      });
      return [];
    }
    if (occurrences.length === 0) {
      const compRange = state.currentCompClauseRange ?? getEnclosingClauseRange(clauseNode ?? exprNode, dae);
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.IMPLICIT_ITERATOR_SUBSCRIPT_MISSING.code,
        message: ModelicaErrorCode.IMPLICIT_ITERATOR_SUBSCRIPT_MISSING.message(iterName),
        range: compRange,
      });
      return [];
    }
    const first = occurrences[0]!;
    for (let i = 1; i < occurrences.length; i++) {
      const curr = occurrences[i]!;
      if (curr.count !== first.count) {
        const compRange = state.currentCompClauseRange ?? getEnclosingClauseRange(clauseNode ?? exprNode, dae);
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.IMPLICIT_ITERATION_DIM_MISMATCH.code,
          message: ModelicaErrorCode.IMPLICIT_ITERATION_DIM_MISMATCH.message(
            String(curr.dimension),
            curr.baseName,
            String(first.dimension),
            first.baseName,
          ),
          range: compRange,
        });
        return [];
      }
    }
    return first.subs;
  }

  return occurrences.length > 0 ? occurrences[0]!.subs : [];
}

export function findImplicitArrayDim(bodyNodes: any[], iterName: string, dae: DAEBuilder): number | null {
  let foundDim: number | null = null;
  const search = (n: any) => {
    if (!n || foundDim !== null) return;
    if (
      n.type === "component_reference" ||
      (n.childCount >= 2 && n.child(n.childCount - 1)?.type === "array_subscripts")
    ) {
      const subsNode = (n.children || []).find((c: any) => c.type === "array_subscripts") ?? n.child(n.childCount - 1);
      if (subsNode && subsNode.type === "array_subscripts") {
        for (let i = 0; i < subsNode.childCount; i++) {
          const sc = subsNode.child(i);
          if (sc.type === "subscript" || sc.type === "expression") {
            if (sc.text?.trim() === iterName) {
              const baseName = n.child(0)?.text?.trim();
              if (baseName) {
                let count = 0;
                for (let k = 1; ; k++) {
                  if (dae.getVarIdxByName(`${baseName}[${k}]`) >= 0) {
                    count++;
                  } else {
                    break;
                  }
                }
                if (count > 0) {
                  foundDim = count;
                  return;
                }
              }
            }
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      search(n.child(i));
    }
  };
  for (const b of bodyNodes) {
    search(b);
    if (foundDim !== null) break;
  }
  return foundDim;
}

export function expandColonToArrayCtor(exprId: number, dae: DAEBuilder, varType?: VarType): number | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  let startVal: number | null = null;
  let stepVal = 1;
  let stopVal: number | null = null;

  if (kind === ExprKind.Range) {
    const startId = dae.getExprData1(exprId);
    const stepId = dae.getExprLeft(exprId);
    const stopId = dae.getExprRight(exprId);
    startVal = getConstVal(startId, dae);
    stepVal = stepId >= 0 ? (getConstVal(stepId, dae) ?? 1) : 1;
    stopVal = getConstVal(stopId, dae);
  } else if (kind === ExprKind.Binary && dae.getExprData1(exprId) === BinOp.Colon) {
    const leftId = dae.getExprLeft(exprId);
    const rightId = dae.getExprRight(exprId);

    if (dae.getExprKind(leftId) === ExprKind.Binary && dae.getExprData1(leftId) === BinOp.Colon) {
      const startId = dae.getExprLeft(leftId);
      const stepId = dae.getExprRight(leftId);
      startVal = getConstVal(startId, dae);
      stepVal = getConstVal(stepId, dae) ?? 1;
      stopVal = getConstVal(rightId, dae);
    } else {
      startVal = getConstVal(leftId, dae);
      stopVal = getConstVal(rightId, dae);
    }
  } else {
    return null;
  }

  if (startVal !== null && stopVal !== null) {
    if (stepVal === 0 || Math.abs(stepVal) < 1e-12) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.RANGE_STEP_TOO_SMALL.code,
        message: ModelicaErrorCode.RANGE_STEP_TOO_SMALL.message(String(stepVal)),
        range: { startByte: 0, endByte: 0 },
      });
      return null;
    }
    const count = Math.max(0, Math.floor((stopVal - startVal) / stepVal + 1e-9) + 1);
    if (count > 100000) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.RANGE_STEP_TOO_SMALL.code,
        message: ModelicaErrorCode.RANGE_STEP_TOO_SMALL.message(String(stepVal)),
        range: { startByte: 0, endByte: 0 },
      });
      return null;
    }
    const elemIds: number[] = [];
    const isReal =
      varType === VarType.Real ||
      !Number.isInteger(startVal) ||
      !Number.isInteger(stepVal) ||
      !Number.isInteger(stopVal);
    for (let i = 0; i < count; i++) {
      const v = startVal + i * stepVal;
      elemIds.push(isReal ? dae.addRealLiteral(v) : dae.addIntLiteral(Math.round(v)));
    }
    return dae.addArrayCtorExpr(elemIds);
  }
  return null;
}
