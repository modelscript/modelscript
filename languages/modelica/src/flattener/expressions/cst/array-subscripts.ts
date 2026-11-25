// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - DAE expression copying, enum range evaluation, and array/subscript expansion.
 */

import { ExprKind } from "@modelscript/dsl";
import { StringWriter } from "@modelscript/dsl/utils";
import {
  ArenaDAEPrinter,
  BinOp,
  DAEBuilder,
  matchVarPath,
  Variability,
  VarType,
  type QueryDB,
  type SymbolId,
} from "@modelscript/runtime";
import type { SyntaxNode } from "../../../../src-gen/bindings.js";
import { isAsciiDigitsOnly } from "../../../ascii.js";
import { MAX_ARRAY_EXPANSION_LENGTH } from "../../../constants.js";
import { getNamedArrayShape } from "../../support/state.js";
import type { ComponentInstanceData, FlattenerCstNode } from "../../types.js";
import { castToRealExpr, evalDaeExpr, findIfElseExpr, inferArenaExprShapeAndType } from "../eval.js";
import { evaluateCSTNumber } from "./constant-eval.js";
import { flattenColonNodes, getArrayLiteralItems } from "./cst-traversal.js";
import { resolveEnumType } from "./enum-resolution.js";
import { stripLeadingDots, stripTrailingArraySubscripts } from "./text-scanning.js";

export function checkIfExprTypeMismatch(
  dae: DAEBuilder,
  exprId: number,
  node: SyntaxNode | null | undefined,
  compName: string,
  expectedDims?: number[] | null,
): boolean {
  if (exprId < 0) return false;
  const ifElseId = findIfElseExpr(dae, exprId);
  if (ifElseId < 0) {
    if (
      expectedDims &&
      expectedDims.length > 0 &&
      expectedDims.every((d) => d > 0) &&
      dae.getExprKind(exprId) === ExprKind.ArrayCtor
    ) {
      const info = inferArenaExprShapeAndType(dae, exprId);
      if (
        info.shape.length > 0 &&
        (info.shape.length !== expectedDims.length || info.shape.some((d, i) => d > 0 && d !== expectedDims[i]))
      ) {
        const out = new StringWriter();
        const p = new ArenaDAEPrinter(out, dae, true);
        p.printExpr(exprId);
        const exprStr = out.toString();
        const typeStr = `${info.typeName}[${info.shape.join(", ")}]`;
        let targetNode: FlattenerCstNode | null | undefined = node;
        let curr: FlattenerCstNode | null | undefined = node;
        while (curr) {
          if (curr.type === "component_clause") {
            targetNode = curr;
            break;
          }
          curr = curr.parent;
        }
        const startB = targetNode?.startIndex ?? targetNode?.startOffset ?? 0;
        const endB = targetNode?.endIndex ?? targetNode?.endOffset ?? 0;
        dae.diagnostics.push({
          severity: "error",
          message: `Array dimension mismatch, expression ${exprStr} has type ${typeStr}, expected array dimensions [${expectedDims.join(", ")}].`,
          range: {
            startOffset: startB,
            endOffset: endB,
            startPosition: targetNode?.startPosition,
            endPosition: targetNode?.endPosition,
          },
        });
        return true;
      }
    }
    return false;
  }

  let thenId = dae.getExprLeft(ifElseId);
  let elseId = dae.getExprRight(ifElseId);
  if (thenId >= 0 && elseId >= 0) {
    if (dae.getExprKind(thenId) === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(thenId));
      const exp = expandVarToArrayCtor(name, dae);
      if (exp !== null) thenId = exp;
    }
    if (dae.getExprKind(elseId) === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(elseId));
      const exp = expandVarToArrayCtor(name, dae);
      if (exp !== null) elseId = exp;
    }
    const thenInfo = inferArenaExprShapeAndType(dae, thenId);
    const elseInfo = inferArenaExprShapeAndType(dae, elseId);
    if (thenInfo.typeName === "Integer" && elseInfo.typeName === "Real") {
      thenId = castToRealExpr(thenId, dae);
      thenInfo.typeName = "Real";
    } else if (thenInfo.typeName === "Real" && elseInfo.typeName === "Integer") {
      elseId = castToRealExpr(elseId, dae);
      elseInfo.typeName = "Real";
    }
    const shapeMismatch =
      thenInfo.shape.length !== elseInfo.shape.length || thenInfo.shape.some((d, i) => d !== elseInfo.shape[i]);
    const typeMismatch = shapeMismatch || thenInfo.typeName !== elseInfo.typeName;
    if (typeMismatch) {
      const thenOut = new StringWriter();
      const p1 = new ArenaDAEPrinter(thenOut, dae, true);
      p1.printExpr(thenId);
      const thenStr = thenOut.toString();

      const elseOut = new StringWriter();
      const p2 = new ArenaDAEPrinter(elseOut, dae, true);
      p2.printExpr(elseId);
      const elseStr = elseOut.toString();

      const thenTypeStr = `${thenInfo.typeName}${thenInfo.shape.length > 0 ? `[${thenInfo.shape.join(", ")}]` : ""}`;
      const elseTypeStr = `${elseInfo.typeName}${elseInfo.shape.length > 0 ? `[${elseInfo.shape.join(", ")}]` : ""}`;

      let targetNode: FlattenerCstNode | null | undefined = node;
      let curr: FlattenerCstNode | null | undefined = node;
      while (curr) {
        if (curr.type === "component_clause") {
          targetNode = curr;
          break;
        }
        curr = curr.parent;
      }

      const tryEvalBool = (condExprId: number): boolean | null => {
        if (condExprId < 0) return null;
        const k = dae.getExprKind(condExprId);
        if (k === ExprKind.BoolLiteral) return Boolean(dae.getExprData1(condExprId));
        if (k === ExprKind.IntLiteral) return Boolean(dae.getExprData1(condExprId));
        if (k === ExprKind.Name) {
          const rawName = dae.interner.resolve(dae.getExprData1(condExprId));
          let varIdx = dae.findVar(rawName);
          if (varIdx === -1 && compName) {
            varIdx = dae.findVar(`${compName}.${rawName}`);
          }
          if (varIdx !== -1) {
            const bindingId = dae.getVarExpression(varIdx);
            if (bindingId !== undefined && bindingId !== -1 && bindingId !== condExprId) {
              const res = tryEvalBool(bindingId);
              if (res !== null) return res;
            }
            const val = dae.getVarStartValue(varIdx);
            if (dae.getVarType(varIdx) === VarType.Boolean && val !== undefined) {
              return Boolean(val);
            }
          }
        }
        return null;
      };

      const condId = dae.getExprData1(ifElseId);
      const condVal = tryEvalBool(condId);
      let message = `Type mismatch in if-expression in component ${compName}. True branch: ${thenStr} has type ${thenTypeStr}, false branch: ${elseStr} has type ${elseTypeStr}.`;
      if (condVal !== null) {
        const activeStr = condVal ? thenStr : elseStr;
        const activeTypeStr = condVal ? thenTypeStr : elseTypeStr;
        const expectedShape =
          expectedDims && expectedDims.length > 0 ? expectedDims : condVal ? elseInfo.shape : thenInfo.shape;
        const isShapeMismatch =
          expectedShape.length !== (condVal ? thenInfo.shape.length : elseInfo.shape.length) ||
          expectedShape.some((d, i) => d !== (condVal ? thenInfo.shape[i] : elseInfo.shape[i]));
        if (isShapeMismatch) {
          message = `Array dimension mismatch, expression ${activeStr} has type ${activeTypeStr}, expected array dimensions [${expectedShape.join(", ")}].`;
        }
      }

      const startB = targetNode?.startIndex ?? targetNode?.startOffset ?? 0;
      const endB = targetNode?.endIndex ?? targetNode?.endOffset ?? 0;
      dae.diagnostics.push({
        severity: "error",
        message,
        range: {
          startOffset: startB,
          endOffset: endB,
          startPosition: targetNode?.startPosition,
          endPosition: targetNode?.endPosition,
        },
      });
      return true;
    }
    if (dae.getExprKind(elseId) === ExprKind.IfElse) {
      return checkIfExprTypeMismatch(dae, elseId, node, compName, expectedDims);
    }
  }
  return false;
}

export function copyExprBetweenDaes(
  src: DAEBuilder,
  srcId: number,
  dst: DAEBuilder,
  substitutions?: Map<string, number>,
  callPrefix?: string,
): number {
  if (srcId < 0) return -1;
  const kind = src.getExprKind(srcId);
  switch (kind) {
    case ExprKind.RealLiteral:
      return dst.addRealLiteral(src.getExprRealValue(srcId));
    case ExprKind.IntLiteral:
      return dst.addIntLiteral(src.getExprData1(srcId));
    case ExprKind.BoolLiteral:
      return dst.addBoolLiteral(src.getExprData1(srcId) !== 0);
    case ExprKind.StringLiteral:
      return dst.addStringLiteral(src.interner.resolve(src.getExprData1(srcId)) ?? "");
    case ExprKind.EnumLiteral:
      return dst.addEnumLiteral(src.getExprData1(srcId), src.interner.resolve(src.getExprLeft(srcId)) ?? "");
    case ExprKind.Name: {
      const name = src.interner.resolve(src.getExprData1(srcId)) ?? "";
      if (substitutions && substitutions.has(name)) {
        return substitutions.get(name)!;
      }
      if (callPrefix) {
        const prefixed = `${callPrefix}.${name}`;
        const vIdx = dst.getVarIdxByName(prefixed);
        if (vIdx >= 0) {
          const vExpr = dst.getVarExpression(vIdx);
          if (typeof vExpr === "number" && vExpr >= 0) {
            return copyExprBetweenDaes(dst, vExpr, dst, substitutions, callPrefix);
          }
          return dst.addNameExpr(prefixed);
        }
        if (dst.hasArrayElements(prefixed)) {
          const prefixMatch = `${prefixed}[`;
          const maxDims: number[] = [];
          for (let v = 0; v < dst.varCount; v++) {
            if (!dst.isVarRemoved(v)) {
              const n = dst.getVarName(v);
              if (n.startsWith(prefixMatch) && n.endsWith("]")) {
                const indices = n.slice(prefixMatch.length, -1).split(",").map(Number);
                for (let i = 0; i < indices.length; i++) {
                  const idx = indices[i];
                  if (idx !== undefined && !isNaN(idx)) {
                    while (maxDims.length <= i) maxDims.push(0);
                    if (idx > maxDims[i]!) maxDims[i] = idx;
                  }
                }
              }
            }
          }
          if (maxDims.length === 1 && maxDims[0]! > 0) {
            const elems: number[] = [];
            for (let el = 1; el <= maxDims[0]!; el++) {
              const elName = `${prefixed}[${el}]`;
              const elIdx = dst.getVarIdxByName(elName);
              const elExpr = elIdx >= 0 ? dst.getVarExpression(elIdx) : undefined;
              if (elExpr !== undefined && elExpr >= 0) {
                elems.push(elExpr);
              } else {
                elems.push(dst.addNameExpr(elName));
              }
            }
            return dst.addArrayCtorExpr(elems);
          }
          return dst.addNameExpr(prefixed);
        }
      }
      return dst.addNameExpr(name);
    }
    case ExprKind.Subscript: {
      const baseId = src.getExprData1(srcId);
      const subCount = src.getExprRight(srcId);
      const copiedBase = copyExprBetweenDaes(src, baseId, dst, substitutions, callPrefix);
      const subIds: number[] = [];
      for (let i = 0; i < subCount; i++) {
        const subExpr = i === 0 ? src.getExprLeft(srcId) : src.getExprLeft(srcId + i);
        subIds.push(copyExprBetweenDaes(src, subExpr, dst, substitutions, callPrefix));
      }
      return dst.addSubscriptExpr(copiedBase, subIds);
    }
    case ExprKind.Binary: {
      const op = src.getExprData1(srcId);
      const l = copyExprBetweenDaes(src, src.getExprLeft(srcId), dst, substitutions, callPrefix);
      const r = copyExprBetweenDaes(src, src.getExprRight(srcId), dst, substitutions, callPrefix);
      if (op === BinOp.Mul) {
        const lK = dst.getExprKind(l);
        const rK = dst.getExprKind(r);
        if (rK === ExprKind.RealLiteral && dst.getExprRealValue(r) === 1.0) return l;
        if (lK === ExprKind.RealLiteral && dst.getExprRealValue(l) === 1.0) return r;
        if (rK === ExprKind.IntLiteral && dst.getExprData1(r) === 1) return l;
        if (lK === ExprKind.IntLiteral && dst.getExprData1(l) === 1) return r;
        if (
          (rK === ExprKind.RealLiteral || rK === ExprKind.IntLiteral) &&
          lK !== ExprKind.RealLiteral &&
          lK !== ExprKind.IntLiteral
        ) {
          return dst.addBinaryExpr(op, r, l);
        }
      }
      return dst.addBinaryExpr(op, l, r);
    }
    case ExprKind.Unary: {
      const op = src.getExprData1(srcId);
      const operand = copyExprBetweenDaes(src, src.getExprLeft(srcId), dst, substitutions, callPrefix);
      return dst.addUnaryExpr(op, operand);
    }
    case ExprKind.Negate: {
      const operand = copyExprBetweenDaes(src, src.getExprLeft(srcId), dst, substitutions, callPrefix);
      return dst.addNegateExpr(operand);
    }
    case ExprKind.ArrayCtor: {
      const count = src.getExprData1(srcId);
      const elems: number[] = [];
      for (let i = 0; i < count; i++) {
        const eid = i === 0 ? src.getExprLeft(srcId) : src.getExprLeft(srcId + i);
        elems.push(copyExprBetweenDaes(src, eid, dst, substitutions, callPrefix));
      }
      return dst.addArrayCtorExpr(elems);
    }
    case ExprKind.Range: {
      const start = copyExprBetweenDaes(src, src.getExprData1(srcId), dst, substitutions, callPrefix);
      const stepId = src.getExprLeft(srcId);
      const step = stepId >= 0 ? copyExprBetweenDaes(src, stepId, dst, substitutions, callPrefix) : -1;
      const stop = copyExprBetweenDaes(src, src.getExprRight(srcId), dst, substitutions, callPrefix);
      return dst.addRangeExpr(start, step, stop);
    }
    case ExprKind.IfElse: {
      const cond = copyExprBetweenDaes(src, src.getExprData1(srcId), dst, substitutions, callPrefix);
      const thenE = copyExprBetweenDaes(src, src.getExprLeft(srcId), dst, substitutions, callPrefix);
      const elseE = copyExprBetweenDaes(src, src.getExprRight(srcId), dst, substitutions, callPrefix);
      return dst.addIfElseExpr(cond, thenE, elseE);
    }
    case ExprKind.Call: {
      const fnName = src.interner.resolve(src.getExprData1(srcId)) ?? "";
      const argCount = src.getExprRight(srcId);
      const args: number[] = [];
      for (let i = 0; i < argCount; i++) {
        const aid = i === 0 ? src.getExprLeft(srcId) : src.getExprLeft(srcId + i);
        args.push(copyExprBetweenDaes(src, aid, dst, substitutions, callPrefix));
      }
      return dst.addCallExpr(fnName, args);
    }
    case ExprKind.PartialFunc: {
      const pfn = src.interner.resolve(src.getExprData1(srcId)) ?? "";
      const pcount = src.getExprRight(srcId);
      const pArgs: number[] = [];
      for (let i = 0; i < pcount; i++) {
        const aid = src.getExprLeft(srcId + i);
        pArgs.push(copyExprBetweenDaes(src, aid, dst, substitutions, callPrefix));
      }
      return dst.addPartialFuncExpr(pfn, pArgs);
    }
    default:
      return -1;
  }
}

export function evaluateEnumRange(
  rangeNode: SyntaxNode | FlattenerCstNode | null | undefined,
  substitutions: ReadonlyMap<string, number | string> | undefined,
  scopeId: SymbolId | undefined,
  db: QueryDB | undefined,
  dae?: DAEBuilder,
  prefix?: string,
): string[] | null {
  if (!rangeNode || !db) return null;

  const rangeText = rangeNode.text?.trim() ?? "";
  if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
    const items = getArrayLiteralItems(rangeNode);
    if (items.length > 0) {
      const lits: string[] = [];
      for (const item of items) {
        let t = stripLeadingDots(item.text?.trim() ?? "");
        if (substitutions && substitutions.has(t)) {
          const s = substitutions.get(t);
          if (typeof s === "string") t = s;
        }
        const lastDot = t.lastIndexOf(".");
        if (lastDot > 0) {
          const lit = t.slice(lastDot + 1).trim();
          const pfx = t.slice(0, lastDot).trim();
          const info = resolveEnumType(pfx, scopeId, db);
          if (info && info.literals.includes(lit)) {
            lits.push(`${info.qual}.${lit}`);
            continue;
          }
        }
        return null;
      }
      if (lits.length > 0) return lits;
    }
  }

  const colonNodes = flattenColonNodes(rangeNode);
  if (colonNodes.length >= 2) {
    let startText = stripLeadingDots(colonNodes[0]!.text?.trim() ?? "");
    let stopText = stripLeadingDots(colonNodes[colonNodes.length - 1]!.text?.trim() ?? "");
    if (substitutions && substitutions.has(startText)) {
      const s = substitutions.get(startText);
      if (typeof s === "string") startText = s;
    }
    if (substitutions && substitutions.has(stopText)) {
      const s = substitutions.get(stopText);
      if (typeof s === "string") stopText = s;
    }
    const lastDotStart = startText.lastIndexOf(".");
    const lastDotStop = stopText.lastIndexOf(".");
    if (lastDotStart > 0 && lastDotStop > 0) {
      const startLit = startText.slice(lastDotStart + 1).trim();
      const stopLit = stopText.slice(lastDotStop + 1).trim();
      const startPrefix = startText.slice(0, lastDotStart).trim();
      const stopPrefix = stopText.slice(0, lastDotStop).trim();
      const enumInfo = resolveEnumType(startPrefix, scopeId, db) ?? resolveEnumType(stopPrefix, scopeId, db);
      if (enumInfo) {
        const { literals, qual } = enumInfo;
        const startIdx = literals.indexOf(startLit);
        const stopIdx = literals.indexOf(stopLit);
        if (startIdx >= 0 && stopIdx >= 0) {
          let step = 1;
          if (colonNodes.length >= 3) {
            const stepVal = evaluateCSTNumber(colonNodes[1], substitutions, scopeId, db, dae, prefix);
            if (typeof stepVal === "number" && stepVal !== 0) step = stepVal;
          }
          const result: string[] = [];
          for (let i = startIdx; step > 0 ? i <= stopIdx : i >= stopIdx; i += step) {
            result.push(`${qual}.${literals[i]}`);
          }
          return result;
        }
      }
    }
    return null;
  }

  // Single node (e.g. `for i in E`)
  let typeText = stripLeadingDots(rangeNode.text?.trim() ?? "");
  if (substitutions && substitutions.has(typeText)) {
    const s = substitutions.get(typeText);
    if (typeof s === "string") typeText = s;
  }
  const enumInfo = resolveEnumType(typeText, scopeId, db);
  if (enumInfo) {
    return enumInfo.literals.map((l) => `${enumInfo.qual}.${l}`);
  }
  if (dae) {
    const candidates = prefix ? [`${prefix}.${typeText}`, typeText] : [typeText];
    for (const cand of candidates) {
      if (dae.hasArrayElements(cand)) {
        const elemIndices = dae.getArrayElementIndices(cand);
        if (elemIndices.length > 0) {
          const enumLits: string[] = [];
          let allEnum = true;
          for (const eIdx of elemIndices) {
            const vExpr = dae.getVarExpression(eIdx);
            if (vExpr !== undefined && vExpr >= 0 && dae.getExprKind(vExpr) === ExprKind.EnumLiteral) {
              const litPath = dae.interner.resolve(dae.getExprLeft(vExpr));
              if (litPath) {
                enumLits.push(litPath);
                continue;
              }
            }
            allEnum = false;
            break;
          }
          if (allEnum && enumLits.length > 0) {
            return enumLits;
          }
        }
      }
    }
  }
  return null;
}

export function isDefinitelyScalarExpr(id: number, dae: DAEBuilder): boolean {
  if (id < 0) return false;
  const k = dae.getExprKind(id);
  if (
    k === ExprKind.IntLiteral ||
    k === ExprKind.RealLiteral ||
    k === ExprKind.BoolLiteral ||
    k === ExprKind.StringLiteral
  ) {
    return true;
  }
  if (k === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(id));
    if (!name || dae.hasArrayElements(name)) return false;
    const vIdx = dae.getVarIdxByName(name);
    if (vIdx >= 0) {
      const shape = dae.getVarShape(vIdx);
      return !shape || shape.length === 0;
    }
    return false;
  }
  if (k === ExprKind.Subscript) {
    return true;
  }
  if (k === ExprKind.Unary || k === ExprKind.Negate) {
    return isDefinitelyScalarExpr(dae.getExprLeft(id), dae);
  }
  if (k === ExprKind.Binary) {
    return isDefinitelyScalarExpr(dae.getExprLeft(id), dae) && isDefinitelyScalarExpr(dae.getExprRight(id), dae);
  }
  return false;
}

export function expandVarToArrayCtor(baseName: string, dae: DAEBuilder): number | null {
  const matchingIndices: number[] = [];
  const parsedIndices: number[][] = [];
  const labelMaps: Map<string, number>[] = [];
  const candidateIndices = dae.getArrayElementIndices ? dae.getArrayElementIndices(baseName) : [];
  for (const i of candidateIndices) {
    if (!dae.isVarRemoved(i)) {
      const vn = dae.getVarName(i);
      const idxs = matchVarPath(vn, baseName, labelMaps);
      if (idxs && idxs.length > 0) {
        matchingIndices.push(i);
        parsedIndices.push(idxs);
      }
    }
  }
  if (matchingIndices.length === 0) {
    const vIdx = dae.getVarIdxByName(baseName);
    if (vIdx >= 0) {
      const shape = dae.getVarShape(vIdx);
      const shapeExprs = dae.getVarShapeExprs ? dae.getVarShapeExprs(vIdx) : null;
      const hasSymbolicDim =
        dae.classKind === "function" &&
        Boolean(
          shapeExprs &&
          shapeExprs.some((se: number | string) =>
            typeof se === "number"
              ? se >= 0 && dae.getExprKind(se) !== ExprKind.IntLiteral
              : Boolean(se && !isAsciiDigitsOnly(String(se).trim())),
          ),
        );
      if (!hasSymbolicDim && shape && shape.length > 0 && shape.every((d) => d > 0)) {
        const baseExpr = dae.addNameExpr(baseName);
        const buildCtorForShape = (currentDim: number, currentIndices: number[]): number => {
          if (currentDim === shape.length) {
            return dae.addSubscriptExpr(
              baseExpr,
              currentIndices.map((i) => dae.addIntLiteral(i)),
            );
          }
          const childExprs: number[] = [];
          const dimSize = shape[currentDim]!;
          for (let i = 1; i <= dimSize; i++) {
            childExprs.push(buildCtorForShape(currentDim + 1, [...currentIndices, i]));
          }
          return dae.addArrayCtorExpr(childExprs);
        };
        return buildCtorForShape(0, []);
      }
    }
    return null;
  }

  const rank = parsedIndices[0]!.length;
  if (!parsedIndices.every((p) => p.length === rank)) return null;

  const maxDims: number[] = new Array(rank).fill(0);
  const table = new Map<string, number>();
  for (let i = 0; i < matchingIndices.length; i++) {
    const idxs = parsedIndices[i]!;
    for (let d = 0; d < rank; d++) {
      if (idxs[d]! > maxDims[d]!) maxDims[d] = idxs[d]!;
    }
    const mIdx = matchingIndices[i]!;
    let varExpr = -1;
    if (dae.getVarVariability(mIdx) === Variability.Constant) {
      const cExprId = dae.getVarExpression(mIdx);
      if (cExprId !== undefined && cExprId >= 0) {
        const ck = dae.getExprKind(cExprId);
        if (ck === ExprKind.RealLiteral) varExpr = dae.addRealLiteral(dae.getExprRealValue(cExprId));
        else if (ck === ExprKind.IntLiteral) varExpr = dae.addIntLiteral(dae.getExprData1(cExprId));
        else if (ck === ExprKind.BoolLiteral) varExpr = dae.addBoolLiteral(dae.getExprData1(cExprId) !== 0);
      }
    }
    if (varExpr < 0) {
      varExpr = dae.addExpression(ExprKind.Name, dae.interner.intern(dae.getVarName(mIdx)));
    }
    table.set(idxs.join(","), varExpr);
  }

  const buildCtor = (currentDim: number, currentIndices: number[]): number => {
    if (currentDim === rank) {
      const key = currentIndices.join(",");
      const expr = table.get(key);
      if (expr !== undefined) return expr;
      return dae.addRealLiteral(0.0);
    }
    const childExprs: number[] = [];
    const dimSize = maxDims[currentDim]!;
    for (let i = 1; i <= dimSize; i++) {
      childExprs.push(buildCtor(currentDim + 1, [...currentIndices, i]));
    }
    return dae.addArrayCtorExpr(childExprs);
  };

  return buildCtor(0, []);
}

/**
 * Resolves a dotted component member reference whose path traverses an array component
 * (such as `rs.resistor.LossPower` -> `smee.rs.resistor[1..3].LossPower`) into an `ArrayCtor`
 * expression ID, checking `DAEBuilder` first and falling back to `QueryDB` when the target
 * array component has not yet been elaborated into the DAE.
 */
export function expandDottedArrayMemberRef(
  rawName: string,
  prefix: string,
  dae: DAEBuilder,
  db?: QueryDB,
  currentClassId?: SymbolId | null,
  rootClassId?: SymbolId | null,
  evaluateCSTNum?: typeof evaluateCSTNumber,
): { isArray: boolean; ctorId: number | null } {
  const candidates =
    prefix && !rawName.startsWith(`${prefix}.`) && rawName !== prefix ? [`${prefix}.${rawName}`, rawName] : [rawName];
  for (const cand of candidates) {
    if (dae.hasArrayElements(cand)) {
      return { isArray: true, ctorId: expandVarToArrayCtor(cand, dae) };
    }
    const namedShape = getNamedArrayShape(dae, cand);
    if (namedShape && namedShape.length > 0) {
      return { isArray: true, ctorId: namedShape.some((d) => d === 0) ? dae.addArrayCtorExpr([]) : null };
    }
  }

  if (!db || !rawName.includes(".")) {
    return { isArray: false, ctorId: null };
  }

  const resolveClassAtPrefix = (pfx: string): SymbolId | null => {
    const startId = rootClassId ?? currentClassId ?? null;
    if (!pfx || startId === null) return currentClassId ?? rootClassId ?? null;
    let cid: SymbolId | null = startId;
    for (const seg of pfx.split(".")) {
      const segName = stripTrailingArraySubscripts(seg);
      if (!segName || cid === null) return null;
      const els: SymbolId[] = db.query<SymbolId[]>("instantiate", cid) ?? [];
      const foundId: SymbolId | undefined = els.find((eid: SymbolId) => db.symbol(eid)?.name === segName);
      if (foundId === undefined) return null;
      const nextCls = db.query<SymbolId | { id?: SymbolId | null } | null>("classInstance", foundId);
      const nextCid: SymbolId | null | undefined = typeof nextCls === "number" ? nextCls : nextCls?.id;
      if (nextCid === undefined || nextCid === null) return null;
      cid = nextCid;
    }
    return cid;
  };

  const relName = prefix && rawName.startsWith(`${prefix}.`) ? rawName.slice(prefix.length + 1) : rawName;
  const startClassId = resolveClassAtPrefix(prefix) ?? currentClassId ?? rootClassId ?? null;
  if (startClassId === null) return { isArray: false, ctorId: null };

  let currClassId: SymbolId | null = startClassId;
  let hasAnyArraySegment = false;
  let currentEntries: { path: string; coords: number[] }[] = [{ path: prefix || "", coords: [] }];
  let modMap = new Map<string, { expr: string; evalPrefix: string }>();

  const evalDimExpr = (dimText: string, clsId: SymbolId, ownerPrefix: string): number | null => {
    const clean = dimText.trim();
    if (isAsciiDigitsOnly(clean)) return parseInt(clean, 10);
    const tryLookup = (varRef: string): number | null => {
      for (const cand of [
        ownerPrefix ? `${ownerPrefix}.${varRef}` : varRef,
        prefix ? `${prefix}.${varRef}` : varRef,
        varRef,
      ]) {
        const vIdx = dae.lookupVariable(cand);
        if (vIdx >= 0) {
          const vExpr = dae.getVarExpression(vIdx);
          if (vExpr !== undefined && vExpr >= 0) {
            const val = evalDaeExpr(vExpr, dae);
            if (typeof val === "number" && Number.isInteger(val) && val >= 0) return val;
          }
        }
      }
      return null;
    };
    const directVal = tryLookup(clean);
    if (directVal !== null) return directVal;
    const mapped = modMap.get(clean);
    if (mapped) {
      if (isAsciiDigitsOnly(mapped.expr)) return parseInt(mapped.expr, 10);
      const mappedVal = tryLookup(mapped.expr);
      if (mappedVal !== null) return mappedVal;
      const evalMapped = (evaluateCSTNum ?? evaluateCSTNumber)(
        mapped.expr,
        undefined,
        clsId,
        db,
        dae,
        mapped.evalPrefix,
      );
      if (typeof evalMapped === "number" && Number.isInteger(evalMapped) && evalMapped >= 0) return evalMapped;
    }
    const evalRes = (evaluateCSTNum ?? evaluateCSTNumber)(clean, undefined, clsId, db, dae, ownerPrefix);
    if (typeof evalRes === "number" && Number.isInteger(evalRes) && evalRes >= 0) return evalRes;
    return null;
  };

  for (const part of relName.split(".")) {
    if (currClassId === null) return { isArray: hasAnyArraySegment, ctorId: null };
    const cleanPart = stripTrailingArraySubscripts(part);
    const hasExplicitSub = part.includes("[");
    const els: SymbolId[] = db.query<SymbolId[]>("instantiate", currClassId) ?? [];
    const compId: SymbolId | undefined = els.find((eid: SymbolId) => db.symbol(eid)?.name === cleanPart);
    if (compId === undefined) return { isArray: hasAnyArraySegment, ctorId: null };

    const rawDims = !hasExplicitSub
      ? db.query<Array<string | { text?: string | undefined }> | null>("arrayDimensions", compId)
      : null;
    const ownerPrefix = currentEntries[0]?.path || prefix;
    const nextModMap = new Map<string, { expr: string; evalPrefix: string }>();
    const compData = db.query<ComponentInstanceData | null>("componentInstance", compId);
    for (const a of compData?.modification?.args ?? []) {
      if (!a?.isBreak && a?.name && a?.value?.text) {
        nextModMap.set(a.name, { expr: a.value.text.trim(), evalPrefix: ownerPrefix });
      }
    }

    if (rawDims && rawDims.length > 0) {
      hasAnyArraySegment = true;
      const dimSizes: number[] = [];
      for (const rd of rawDims) {
        const dText = typeof rd === "string" ? rd : rd?.text?.trim();
        const sz = dText ? evalDimExpr(dText, currClassId, ownerPrefix) : null;
        if (sz === null || sz < 0) {
          return { isArray: true, ctorId: null };
        }
        if (sz === 0) {
          return { isArray: true, ctorId: dae.addArrayCtorExpr([]) };
        }
        dimSizes.push(sz);
      }
      const totalNew = dimSizes.reduce((acc, d) => acc * d, 1);
      if (currentEntries.length * totalNew > MAX_ARRAY_EXPANSION_LENGTH) {
        return { isArray: true, ctorId: null };
      }
      const tuples: number[][] = [[]];
      for (const d of dimSizes) {
        const expanded: number[][] = [];
        for (const t of tuples) {
          for (let k = 1; k <= d; k++) expanded.push([...t, k]);
        }
        tuples.splice(0, tuples.length, ...expanded);
      }
      const nextEntries: { path: string; coords: number[] }[] = [];
      for (const ent of currentEntries) {
        const segBase = ent.path ? `${ent.path}.${cleanPart}` : cleanPart;
        for (const t of tuples) {
          nextEntries.push({
            path: `${segBase}[${t.join(",")}]`,
            coords: [...ent.coords, ...t],
          });
        }
      }
      currentEntries = nextEntries;
    } else {
      currentEntries = currentEntries.map((ent) => ({
        path: ent.path ? `${ent.path}.${part}` : part,
        coords: ent.coords,
      }));
    }

    modMap = nextModMap;
    const nextCls = db.query<SymbolId | { id?: SymbolId | null } | null>("classInstance", compId);
    currClassId =
      nextCls !== null && nextCls !== undefined ? (typeof nextCls === "number" ? nextCls : (nextCls.id ?? null)) : null;
  }

  if (!hasAnyArraySegment || currentEntries.length === 0) {
    return { isArray: false, ctorId: null };
  }
  const rank = currentEntries[0]!.coords.length;
  if (rank <= 1) {
    return {
      isArray: true,
      ctorId: dae.addArrayCtorExpr(currentEntries.map((e) => dae.addNameExpr(e.path))),
    };
  }
  const maxDims = new Array(rank).fill(0);
  const byCoord = new Map<string, number>();
  for (const ent of currentEntries) {
    for (let d = 0; d < rank; d++) {
      if (ent.coords[d]! > maxDims[d]!) maxDims[d] = ent.coords[d]!;
    }
    byCoord.set(ent.coords.join(","), dae.addNameExpr(ent.path));
  }
  const buildNested = (dim: number, prefixCoords: number[]): number => {
    if (dim === rank) return byCoord.get(prefixCoords.join(",")) ?? dae.addRealLiteral(0.0);
    const items: number[] = [];
    for (let k = 1; k <= maxDims[dim]!; k++) items.push(buildNested(dim + 1, [...prefixCoords, k]));
    return dae.addArrayCtorExpr(items);
  };
  return { isArray: true, ctorId: buildNested(0, []) };
}
