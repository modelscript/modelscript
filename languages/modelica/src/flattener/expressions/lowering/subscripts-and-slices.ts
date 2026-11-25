// SPDX-License-Identifier: AGPL-3.0-or-later

import { ExprKind } from "@modelscript/dsl";
import {
  DAEBuilder,
  inferArenaExprVarType,
  VarType,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import { getElementDiagRange } from "../../support/range-utils.js";
import type { ComponentInstanceData, FlattenerHostLike, LoweringContext } from "../../types.js";
import { getArrayCtorElements } from "../binary-ops.js";
import { evaluateCSTNumber, getDaeDimSize, isDottedIdentifierChain } from "../cst-utils.js";

import { asDaeExt } from "./helpers.js";
import type { CrefSubscriptEntry, LowerExprFn } from "./types.js";

export function lowerNonCrefSubscriptExpression(
  node: SyntaxNode,
  dae: DAEBuilder,
  ctx: LoweringContext,
  lowerExpr: LowerExprFn,
): number | null {
  const { prefix = "", substitutions, imports, db, flattener } = ctx;
  const type = node.type;
  // Subscript expression: arr[i] (for non-component_reference nodes; component_reference handles its own subscripts)
  if (
    type !== "component_reference" &&
    node.childCount >= 2 &&
    node.child(node.childCount - 1)?.type === "array_subscripts"
  ) {
    const hasTupleChild = (node.children || []).some((c) => c.type === "output_expression_list");
    if (hasTupleChild) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.TUPLE_SUBSCRIPT_NOT_ALLOWED?.code ?? 5016,
        message: "Tuple expression can not be subscripted.",
        range: {
          startOffset: node.startIndex ?? node.startOffset,
          endOffset: node.endIndex ?? node.endOffset,
          startPosition: node.startPosition,
          endPosition: node.endPosition,
        },
      });
      return -1;
    }
    const firstCh = node.child(0);
    const isParenSubscript =
      (firstCh?.type === "(" || firstCh?.text === "(" || firstCh?.type === '"("') && node.childCount >= 4;
    const baseNode = isParenSubscript ? node.child(1) : firstCh;
    const subsNode = node.child(node.childCount - 1)!;
    const baseName = isParenSubscript ? "" : (baseNode?.text?.trim() ?? "");

    // Evaluate subscripts
    const subVals: (number | string)[] = [];
    let allNumeric = true;
    for (let i = 0; i < subsNode.childCount; i++) {
      const c = subsNode.child(i);
      if (c && (c.type === "subscript" || c.type === "expression")) {
        const expr = c.children?.find((k) => k.type === "expression") ?? c;
        const exprText = expr?.text?.trim() ?? "";
        const evaluatedNum = evaluateCSTNumber(expr, substitutions, undefined, undefined, dae);
        if (evaluatedNum !== null) {
          subVals.push(evaluatedNum);
        } else {
          const subId = lowerExpr(expr, dae, prefix, substitutions, imports, db, flattener);
          if (subId >= 0 && dae.getExprKind(subId) === ExprKind.IntLiteral) {
            subVals.push(dae.getExprData1(subId));
          } else {
            allNumeric = false;
            subVals.push(exprText);
          }
        }
      }
    }

    const isIdentifierBase = isDottedIdentifierChain(baseName);
    if (allNumeric && subVals.length > 0 && isIdentifierBase) {
      let candidate = `${baseName}[${subVals.join(",")}]`;
      if (prefix && !candidate.startsWith(prefix) && !candidate.includes(".")) {
        candidate = `${prefix}.${candidate}`;
      }
      return dae.addExpression(ExprKind.Name, dae.interner.intern(candidate));
    }

    const baseId = lowerExpr(baseNode, dae, prefix, substitutions, imports, db, flattener, false, true);
    if (allNumeric && subVals.length > 0 && baseId >= 0 && dae.getExprKind(baseId) === ExprKind.ArrayCtor) {
      let currId = baseId;
      let resolvedAll = true;
      for (const sv of subVals) {
        const idx = typeof sv === "number" ? sv : Number(sv);
        if (!Number.isInteger(idx) || dae.getExprKind(currId) !== ExprKind.ArrayCtor) {
          resolvedAll = false;
          break;
        }
        const elems = getArrayCtorElements(currId, dae);
        if (idx >= 1 && idx <= elems.length) {
          currId = elems[idx - 1]!;
        } else {
          resolvedAll = false;
          break;
        }
      }
      if (resolvedAll && currId >= 0) {
        return currId;
      }
    }
    const subIds: number[] = [];
    for (let i = 0; i < subsNode.childCount; i++) {
      const c = subsNode.child(i);
      if (c && (c.type === "subscript" || c.type === "expression")) {
        const expr = c.children?.find((k) => k.type === "expression") ?? c;
        const sid = lowerExpr(expr, dae, prefix, substitutions, imports, db, flattener);
        const skind = dae.getExprKind(sid);
        const stype = inferArenaExprVarType(dae, sid);
        if (skind === ExprKind.StringLiteral || stype === VarType.String) {
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
          const subText = expr?.text?.trim() ?? "";
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            message: `Subscript '${subText}' has type String, expected type Integer.`,
            range: diagRange,
          });
          return -1;
        }
        subIds.push(sid);
      }
    }
    return dae.addSubscriptExpr(baseId, subIds);
  }

  return null;
}

/**
 * Attempts to lower a partially subscripted hierarchical component reference (e.g., `arr.field`
 * or `arr[1].subArr`) into either an explicit nested `ArrayCtor` tree or a synthetic nested
 * `array(... for $i in 1:N)` comprehension across all unsubscripted (sliced) dimensions.
 */
export function tryLowerSlicedCref(
  rawParts: { ident: string; hasSubscripts: boolean; subscripts: CrefSubscriptEntry[] }[],
  dae: DAEBuilder,
  prefix: string,
  db?: QueryDB,
  flattener?: FlattenerHostLike,
): { exprId: number; shape: number[] } | null {
  if (rawParts.length < 2 || !db) return null;

  interface PartInfo {
    ident: string;
    existingSubStrs: string[];
    slicedDims: number[];
  }
  const partInfos: PartInfo[] = [];
  let currentClassId: SymbolId | null = null;

  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i]!;
    const existingSubStrs = part.subscripts.map(
      (s) => s.scalarText ?? (s.values?.[0] !== undefined ? String(s.values[0]) : s.text),
    );

    if (i === 0) {
      let compSym: SymbolEntry | null = null;
      let compInst: ComponentInstanceData | null = null;
      let dims: number[] = [];

      const fnSymId = flattener?.currentFlatteningFunctionId ?? asDaeExt(dae)?.symId;
      if (fnSymId) {
        const children = db.childrenOf(fnSymId) || [];
        compSym = children.find((c) => c.name === part.ident && c.kind === "Component") ?? null;
      }
      if (!compSym && flattener?.currentClassId) {
        const children = db.childrenOf(flattener.currentClassId) || [];
        compSym = children.find((c) => c.name === part.ident && c.kind === "Component") ?? null;
      }
      if (!compSym && flattener?.currentRootClassId) {
        const children = db.childrenOf(flattener.currentRootClassId) || [];
        compSym = children.find((c) => c.name === part.ident && c.kind === "Component") ?? null;
      }
      const vIdx =
        dae.getVarIdxByName(part.ident) >= 0 ? dae.getVarIdxByName(part.ident) : dae.lookupVariable(part.ident);
      if (!compSym && vIdx < 0) {
        const syms = db.byName(part.ident);
        compSym = syms?.find((c) => c.kind === "Component") ?? null;
      }

      if (compSym) {
        compInst = db.query<ComponentInstanceData | null>("componentInstance", compSym.id);
        if (compInst?.arrayDimensions && compInst.arrayDimensions.length > 0) {
          dims = compInst.arrayDimensions;
        }
      }

      if (dims.length === 0) {
        if (vIdx >= 0) {
          const s = dae.getVarShape(vIdx);
          if (s && s.length > 0 && s.every((d: number) => d > 0)) {
            dims = s;
          }
        }
        if (dims.length === 0 && dae.hasArrayElements(part.ident)) {
          const dimSize = getDaeDimSize(prefix, part.ident, 0, dae, db);
          if (dimSize > 0) dims = [dimSize];
        }
      }

      const providedCount = part.subscripts.length;
      const sliced = providedCount < dims.length ? dims.slice(providedCount) : [];
      partInfos.push({ ident: part.ident, existingSubStrs, slicedDims: sliced });

      currentClassId = compInst?.classInstance ?? null;
      if (!currentClassId) {
        const typeName = compInst?.typeSpecifier ?? (vIdx >= 0 ? dae.getVarCustomType(vIdx) : null);
        if (typeName) {
          const leafTypeName = typeName.includes(".") ? typeName.split(".").pop()! : typeName;
          const syms = db.byName(leafTypeName);
          const found = syms?.find((s) => s.kind === "Class" || s.kind === "Record" || s.kind === "Package");
          if (found) currentClassId = found.id;
        }
      }
    } else {
      if (!currentClassId) return null;
      const children: SymbolEntry[] = db.childrenOf(currentClassId) || [];
      const childSym: SymbolEntry | undefined = children.find((c) => c.name === part.ident && c.kind === "Component");
      if (!childSym) return null;

      const childInst: ComponentInstanceData | null = db.query<ComponentInstanceData | null>(
        "componentInstance",
        childSym.id,
      );
      const dims: number[] = childInst?.arrayDimensions ?? [];
      const providedCount = part.subscripts.length;
      const sliced = providedCount < dims.length ? dims.slice(providedCount) : [];
      partInfos.push({ ident: part.ident, existingSubStrs, slicedDims: sliced });

      currentClassId = childInst?.classInstance ?? null;
      if (!currentClassId && childInst?.typeSpecifier) {
        const leafTypeName = childInst.typeSpecifier.includes(".")
          ? childInst.typeSpecifier.split(".").pop()!
          : childInst.typeSpecifier;
        const syms = db.byName(leafTypeName);
        const found = syms?.find((s) => s.kind === "Class" || s.kind === "Record" || s.kind === "Package");
        if (found) currentClassId = found.id;
      }
    }
  }

  const allSlicedDims: number[] = [];
  for (const p of partInfos) allSlicedDims.push(...p.slicedDims);
  if (allSlicedDims.length === 0) return null;

  const N = allSlicedDims.length;
  let dimIdx = 0;
  const partStrs: string[] = [];
  for (const p of partInfos) {
    if (p.slicedDims.length > 0) {
      const iters: string[] = [];
      for (let d = 0; d < p.slicedDims.length; d++) {
        iters.push(`$i${N - 1 - dimIdx}`);
        dimIdx++;
      }
      const combined = [...p.existingSubStrs, ...iters];
      partStrs.push(`${p.ident}[${combined.join(",")}]`);
    } else if (p.existingSubStrs.length > 0) {
      partStrs.push(`${p.ident}[${p.existingSubStrs.join(",")}]`);
    } else {
      partStrs.push(p.ident);
    }
  }

  if (
    allSlicedDims.length >= 1 &&
    partInfos.slice(0, -1).every((p) => p.slicedDims.length === 0) &&
    !rawParts.some((p) => p.hasSubscripts)
  ) {
    const basePrefixStr = partInfos
      .slice(0, -1)
      .map((p) => p.ident)
      .join(".");
    const leafIdent = partInfos[partInfos.length - 1]!.ident;
    const buildCtor = (depth: number, idxs: number[]): number => {
      const dimSize = allSlicedDims[depth]!;
      const elemIds: number[] = [];
      for (let idx = 1; idx <= dimSize; idx++) {
        const nextIdxs = [...idxs, idx];
        if (depth === allSlicedDims.length - 1) {
          elemIds.push(dae.addNameExpr(`${basePrefixStr}.${leafIdent}[${nextIdxs.join(",")}]`));
        } else {
          elemIds.push(buildCtor(depth + 1, nextIdxs));
        }
      }
      return dae.addArrayCtorExpr(elemIds);
    };
    return { exprId: buildCtor(0, []), shape: allSlicedDims };
  }

  const targetExprStr = partStrs.join(".");
  let currExprId = dae.addNameExpr(targetExprStr);
  for (let k = N - 1; k >= 0; k--) {
    const iterName = `$i${N - 1 - k}`;
    const dimSize = allSlicedDims[k]!;
    const rangeId = dae.addRange(dae.addIntLiteral(1), dae.addIntLiteral(dimSize));
    currExprId = dae.addComprehensionExpr("array", currExprId, [{ name: iterName, rangeId }]);
  }

  return { exprId: currExprId, shape: allSlicedDims };
}
