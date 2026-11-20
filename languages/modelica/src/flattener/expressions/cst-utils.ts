// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - CST Expression Utilities.
 *
 * Scoped name resolution, constant number/enum evaluation, array indexing,
 * and string expression slicing helpers.
 */

import { ExprKind } from "@modelscript/dsl";
import { StringWriter } from "@modelscript/dsl/utils";
import {
  ArenaDAEPrinter,
  BinOp,
  DAEBuilder,
  matchVarPath,
  UnifiedWorkspace,
  Variability,
  VarType,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../src-gen/bindings.js";
import {
  collapseAsciiWhitespace,
  firstAsciiToken,
  isAsciiDigitsOnly,
  isAsciiIdentContinue,
  isAsciiIdentifier,
  isAsciiIdentStart,
  isAsciiWhitespaceCode,
} from "../../ascii.js";
import {
  BARE_SINGLE_LETTER_MODELICA_CONSTANTS,
  MAX_ARRAY_EXPANSION_LENGTH,
  MODELICA_CONSTANTS,
  MODELICA_EPS,
  MODELICA_SMALL,
} from "../../constants.js";
import { getShortClassSpecifierNode } from "../../queries.js";
import { getFlatteningState, getNamedArrayShape } from "../support/state.js";
import type { ComponentInstanceData } from "../types.js";
import {
  castToRealExpr,
  evalDaeExpr,
  findIfElseExpr,
  inferArenaExprShapeAndType,
  parseArrayLiteralElements,
} from "./eval.js";
import { getSymbolQualifiedName } from "./functions.js";

export {
  collapseAsciiWhitespace,
  firstAsciiToken,
  isAsciiDigitsOnly,
  isAsciiIdentContinue,
  isAsciiIdentifier,
  isAsciiIdentStart,
  isAsciiWhitespaceCode,
};

export interface CstNodeLike {
  type?: string;
  typeId?: number;
  text?: string;
  isNamed?: boolean;
  isMissing?: boolean;
  hasError?: boolean;
  children?: CstNodeLike[];
  namedChildren?: CstNodeLike[];
  childCount?: number;
  parent?: CstNodeLike | null;
  startIndex?: number;
  endIndex?: number;
  startOffset?: number;
  endOffset?: number;
  startPosition?: { row: number; column: number };
  endPosition?: { row: number; column: number };
  child?: (index: number) => CstNodeLike | null;
  childForFieldName?: (name: string) => CstNodeLike | null;
}

export function stripArraySubscripts(s: string): string {
  let result = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "[") {
      depth++;
    } else if (s[i] === "]") {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      result += s[i];
    }
  }
  return result;
}

export function stripComments(s: string): string {
  let result = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "/" && s[i + 1] === "/") {
      const nl = s.indexOf("\n", i + 2);
      i = nl === -1 ? s.length : nl + 1;
    } else if (s[i] === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end === -1 ? s.length : end + 2;
    } else {
      result += s[i];
      i++;
    }
  }
  return result;
}

export function stripCommentsAndStrings(s: string): string {
  let result = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "/" && s[i + 1] === "/") {
      const nl = s.indexOf("\n", i + 2);
      i = nl === -1 ? s.length : nl + 1;
    } else if (s[i] === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end === -1 ? s.length : end + 2;
    } else if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === "\\") {
          j += 2;
        } else if (s[j] === '"') {
          j++;
          break;
        } else {
          j++;
        }
      }
      i = j;
      result += " ";
    } else {
      result += s[i];
      i++;
    }
  }
  return result;
}

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
        let targetNode: any = node;
        let curr = node;
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

      let targetNode: any = node;
      let curr = node;
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

export function stripAnnotation(str: string): string {
  const needle = "annotation";
  let from = 0;
  while (from <= str.length - needle.length) {
    const idx = str.indexOf(needle, from);
    if (idx < 0) return str;
    const beforeOk = idx === 0 || !isAsciiIdentContinue(str.charCodeAt(idx - 1));
    const afterIdx = idx + needle.length;
    const afterOk = afterIdx === str.length || !isAsciiIdentContinue(str.charCodeAt(afterIdx));
    if (beforeOk && afterOk) {
      return str.slice(0, idx);
    }
    from = idx + 1;
  }
  return str;
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

export function generateArrayIndices(dims: number[]): string[] {
  if (dims.length === 0) return [""];
  if (dims.length === 1) return Array.from({ length: dims[0]! }, (_, i) => `[${i + 1}]`);
  const results: string[] = [];
  const gen = (dim: number, cur: number[]) => {
    if (dim >= dims.length) {
      results.push(`[${cur.join(",")}]`);
      return;
    }
    for (let i = 1; i <= dims[dim]!; i++) {
      gen(dim + 1, [...cur, i]);
    }
  };
  gen(0, []);
  return results;
}

export function generateArrayTuples(dims: number[]): number[][] {
  if (dims.length === 0) return [[]];
  if (dims.length === 1) return Array.from({ length: dims[0]! }, (_, i) => [i + 1]);
  const results: number[][] = [];
  const gen = (dim: number, cur: number[]) => {
    if (dim >= dims.length) {
      results.push([...cur]);
      return;
    }
    for (let i = 1; i <= dims[dim]!; i++) {
      gen(dim + 1, [...cur, i]);
    }
  };
  gen(0, []);
  return results;
}

export function getIndexedElementText(text: string, indices: number[]): string {
  let curr = text.trim();
  if (!curr.startsWith("{") || !curr.endsWith("}")) return curr;
  let depth = 0;
  let probe = curr;
  while (probe.startsWith("{") && probe.endsWith("}")) {
    depth++;
    const elems = parseArrayLiteralElements(probe);
    if (elems.length === 0 || elems[0] === probe) break;
    probe = elems[0]!;
  }
  const topElems = parseArrayLiteralElements(curr);
  const effectiveIndices =
    depth > 0 && depth < indices.length && topElems.length !== indices.length
      ? indices.slice(indices.length - depth)
      : indices;
  for (let i = 0; i < effectiveIndices.length; i++) {
    const idx = effectiveIndices[i]!;
    if (curr.startsWith("{") && curr.endsWith("}")) {
      const elems = parseArrayLiteralElements(curr);
      const k = idx - 1;
      if (k >= 0 && k < elems.length) {
        curr = elems[k]!.trim();
      } else {
        return curr;
      }
    } else {
      const remaining = effectiveIndices.slice(i);
      return `${curr}[${remaining.join(",")}]`;
    }
  }
  return curr;
}

function extractLiteralsFromEnumListNode(enumListNode: SyntaxNode | null | undefined): string[] {
  if (!enumListNode) return [];
  const lits: string[] = [];
  for (const c of enumListNode.children || []) {
    if (c.type === "enumeration_literal" || Cst.EnumerationLiteral.is(c)) {
      const identNode = c.children?.find((ch) => ch.type === "identifier") ?? c.child(0);
      const litText = identNode?.text?.trim() || firstAsciiToken(c.text ?? "");
      if (litText) lits.push(litText);
    }
  }
  return lits;
}

/** Parses an enum type definition or `enumeration(...)` specifier with the WASM parser to extract its literal names. */
export function parseEnumLiteralsText(rawText: string): string[] | null {
  const parser = UnifiedWorkspace.getGlobalParser(".mo");
  if (!parser) return null;
  const trimmed = rawText.trim();
  if (!trimmed) return null;
  const body = trimmed.endsWith(";") ? trimmed.slice(0, -1).trim() : trimmed;
  const src = body.startsWith("enumeration") ? `type _Tmp = ${body};` : `${body};`;
  const tree = parser.parse(src);
  if (!tree?.rootNode || cstHasError(tree.rootNode)) return null;
  const findEnumList = (n: SyntaxNode): SyntaxNode | null => {
    if (n.type === "enum_list") return n;
    for (const ch of n.children || []) {
      const found = findEnumList(ch);
      if (found) return found;
    }
    return null;
  };
  const enumList = findEnumList(tree.rootNode);
  const lits = extractLiteralsFromEnumListNode(enumList);
  return lits.length > 0 ? lits : null;
}

export function extractEnumLiteralsFromCst(cstNode: any, targetMeta?: any): string[] | null {
  if (Array.isArray(targetMeta?.literals) && targetMeta.literals.length > 0) {
    return targetMeta.literals;
  }
  const shortSpec = getShortClassSpecifierNode(cstNode);
  const enumListNode = shortSpec ? Cst.ShortClassSpecifier.enumList(shortSpec) : null;
  if (enumListNode) {
    const lits = extractLiteralsFromEnumListNode(enumListNode);
    if (lits.length > 0) return lits;
  }
  const cstText = stripComments(cstNode?.text ?? "").trim();
  if (cstText) {
    return parseEnumLiteralsText(cstText);
  }
  return null;
}

export function getBaseEnumSymbol(
  db: QueryDB,
  sym: SymbolEntry | null | undefined,
  visited = new Set<SymbolId>(),
): SymbolEntry | null {
  if (!sym || visited.has(sym.id)) return null;
  visited.add(sym.id);
  const meta = sym.metadata as any;
  if (Array.isArray(meta?.literals) && meta.literals.length > 0) {
    return sym;
  }
  if (sym.kind !== "Class" && sym.kind !== "Type") {
    return null;
  }
  const cst = db.cstNode(sym.id) as any;
  const directLits = extractEnumLiteralsFromCst(cst, meta);
  if (directLits && directLits.length > 0) {
    return sym;
  }
  let base = db.query<SymbolEntry | null>("resolvedBaseClass", sym.id);
  if (!base) {
    const extChild = db.childrenOf(sym.id).find((c) => c.kind === "Extends");
    if (extChild) {
      base = db.query<SymbolEntry | null>("resolvedBaseClass", extChild.id);
    }
  }
  if (!base && cst) {
    const shortSpec = getShortClassSpecifierNode(cst);
    const typeSpec =
      (shortSpec ? Cst.ShortClassSpecifier.typeSpecifier(shortSpec) : null) ??
      shortSpec?.children?.find((c: any) => c.type === "type_specifier" || c.type === "TypeSpecifier");
    const typeName = typeSpec?.text?.trim()?.split("[")[0]?.trim();
    if (typeName && typeName !== "enumeration") {
      const scopeId = sym.parentId ?? sym.id;
      const resolver = db.query<any>("resolveName", scopeId) ?? db.query<any>("resolveSimpleName", scopeId);
      base = resolver?.(typeName) ?? db.byName(typeName.split(".").pop()!)?.[0] ?? null;
    }
  }
  if (base && base.id !== sym.id) {
    return getBaseEnumSymbol(db, base, visited);
  }
  return null;
}

export function getSymbolEnumLiterals(db: QueryDB, sym: SymbolEntry): string[] | null {
  if ((sym as any)._cachedEnumLiterals !== undefined) {
    return (sym as any)._cachedEnumLiterals;
  }
  const baseSym = getBaseEnumSymbol(db, sym);
  if (!baseSym) {
    (sym as any)._cachedEnumLiterals = null;
    return null;
  }
  const meta = baseSym.metadata as any;
  if (Array.isArray(meta?.literals) && meta.literals.length > 0) {
    (sym as any)._cachedEnumLiterals = meta.literals;
    return meta.literals;
  }
  const cst = db.cstNode(baseSym.id) as any;
  const res = extractEnumLiteralsFromCst(cst, meta);
  (sym as any)._cachedEnumLiterals = res;
  return res;
}

export function flattenColonNodes(n: any): any[] {
  if (!n) return [];
  while (n.childCount === 1) n = n.child(0);
  if (n.childCount === 3 && Cst.kind(n.child(0)) === "(" && Cst.kind(n.child(2)) === ")") {
    return flattenColonNodes(n.child(1));
  }
  if (n.childCount === 3) {
    const op = stripOuterDoubleQuotes(n.child(1)?.text?.trim() ?? n.child(1)?.type ?? "");
    if (op === ":") {
      return [...flattenColonNodes(n.child(0)), ...flattenColonNodes(n.child(2))];
    }
  }
  return [n];
}

export function getArrayLiteralItems(node: SyntaxNode | null | undefined): any[] {
  if (!node) return [];
  if (node.type === "expression_list") {
    const items: any[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (!c) continue;
      if (Cst.kind(c) === ",") continue;
      items.push(c);
    }
    return items;
  }
  const text = node.text?.trim() ?? "";
  if (
    (node.child(0)?.text === "[" || text.startsWith("[")) &&
    (node.child(node.childCount - 1)?.text === "]" || text.endsWith("]"))
  ) {
    const rows: any[] = [];
    let hasSemicolon = false;
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (!c) continue;
      const norm = Cst.kind(c);
      if (norm === ";") {
        hasSemicolon = true;
        continue;
      }
      if (norm === "[" || norm === "]") continue;
      rows.push(c);
    }
    if (!hasSemicolon && rows.length === 1) {
      return getArrayLiteralItems(rows[0]);
    }
    return rows;
  }
  const items: any[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (n.type === "array_arguments" || n.type === "array_arguments_non_first") {
      if (n.child(0)) items.push(n.child(0));
      if (n.childCount >= 3) walk(n.child(2));
      return;
    }
    for (let i = 0; i < n.childCount; i++) {
      walk(n.child(i));
    }
  };
  walk(node);
  if (items.length === 0) {
    const collectFallback = (n: any) => {
      if (!n) return;
      const t = n.text?.trim() ?? "";
      if (t === "{" || t === "}" || t === ",") return;
      if (
        n.type === "expression" ||
        n.type === "primary" ||
        n.type === "unsigned_number" ||
        n.type === "unsigned_integer"
      ) {
        if (n.childCount === 1 && (n.child(0).type === "expression" || n.child(0).type === "primary")) {
          collectFallback(n.child(0));
          return;
        }
        items.push(n);
        return;
      }
      for (let i = 0; i < n.childCount; i++) collectFallback(n.child(i));
    };
    collectFallback(node);
  }
  return items;
}

export function resolveEnumType(
  typeName: string,
  scopeId: SymbolId | undefined,
  db: QueryDB | undefined,
): { sym: SymbolEntry; literals: string[]; qual: string } | null {
  if (!db) return null;
  const cleanName = stripLeadingDots(typeName).trim();
  if (!cleanName) return null;

  let resolvedSym: SymbolEntry | null = null;
  if (scopeId) {
    const resolver = db.query<any>("resolveName", scopeId) ?? db.query<any>("resolveSimpleName", scopeId);
    const res = resolver?.(cleanName);
    if (res && (res.kind === "Class" || res.kind === "Type")) {
      resolvedSym = res;
    }
  }

  const leaf = cleanName.includes(".") ? cleanName.split(".").pop()! : cleanName;
  const candidates: SymbolEntry[] = [];
  if (resolvedSym) {
    candidates.push(resolvedSym);
  } else {
    for (const cand of db.byName(leaf)) candidates.push(cand);
  }

  for (const cand of candidates) {
    const baseSym = getBaseEnumSymbol(db, cand);
    const lits = baseSym ? getSymbolEnumLiterals(db, baseSym) : null;
    if (baseSym && lits && lits.length > 0) {
      const candQual = getSymbolQualifiedName(db, cand.id);
      const qual = getSymbolQualifiedName(db, baseSym.id);
      if (cleanName.includes(".")) {
        if (
          !candQual.endsWith(cleanName) &&
          !cleanName.endsWith(candQual) &&
          !qual.endsWith(cleanName) &&
          !cleanName.endsWith(qual)
        ) {
          continue;
        }
      }
      return { sym: baseSym, literals: lits, qual };
    }
  }
  return null;
}

export function evaluateEnumRange(
  rangeNode: any,
  substitutions: Map<string, number | string> | undefined,
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
    let startText = stripLeadingDots(colonNodes[0].text?.trim() ?? "");
    let stopText = stripLeadingDots(colonNodes[colonNodes.length - 1].text?.trim() ?? "");
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
            const stepVal = evaluateCSTNumber(colonNodes[1], substitutions as any, scopeId, db, dae, prefix);
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

export function splitTopLevel(text: string, delimiter: string = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && (i === 0 || text[i - 1] !== "\\")) {
      inString = !inString;
      current += ch;
      continue;
    }
    if (!inString) {
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") depth--;
      else if (ch === delimiter && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function splitTopLevelArgs(text: string): string[] {
  return splitTopLevel(text, ",");
}

export function parseRawLiteralArg(argStr: string): any {
  const trimmed = argStr.trim();
  const num = Number(trimmed);
  if (!isNaN(num)) return num;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    const parts = splitTopLevelArgs(inner);
    const parsed = parts.map(parseRawLiteralArg);
    if (parsed.every((p) => p !== null)) return parsed;
  }
  return null;
}

export function formatArenaValForMod(val: any, targetType?: any): string {
  if (typeof val === "string") return JSON.stringify(val);
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") {
    if (targetType === VarType.Integer || targetType === "Integer") {
      return String(Math.round(val));
    }
    return Number.isInteger(val) ? `${val}.0` : String(val);
  }
  if (Array.isArray(val)) {
    return `{${val.map((v) => formatArenaValForMod(v, targetType)).join(", ")}}`;
  }
  return String(val);
}

export function evalArithmeticString(expr: string, allowFloat = false, subs?: Map<string, number>): number | null {
  let pos = 0;
  const len = expr.length;

  function skipWhitespace(): void {
    while (pos < len && expr.charCodeAt(pos) <= 32) pos++;
  }

  function parsePrimary(): number | null {
    skipWhitespace();
    if (pos >= len) return null;
    const ch = expr.charCodeAt(pos);
    if (ch === 43) {
      pos++;
      return parsePrimary();
    }
    if (ch === 45) {
      pos++;
      const val = parsePrimary();
      return val === null ? null : -val;
    }
    if (ch === 40) {
      pos++;
      const val = parseExpr();
      skipWhitespace();
      if (pos >= len || expr.charCodeAt(pos) !== 41) return null;
      pos++;
      return val;
    }
    if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95) {
      const idStart = pos;
      while (pos < len) {
        const c = expr.charCodeAt(pos);
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95) {
          pos++;
        } else {
          break;
        }
      }
      const fnName = expr.slice(idStart, pos);
      skipWhitespace();
      if (pos >= len || expr.charCodeAt(pos) !== 40) {
        if (subs && subs.has(fnName)) {
          const sv = subs.get(fnName);
          if (typeof sv === "number" && Number.isFinite(sv)) return sv;
        }
        return null;
      }
      pos++; // skip '('
      const args: number[] = [];
      skipWhitespace();
      if (pos < len && expr.charCodeAt(pos) !== 41) {
        while (true) {
          const argVal = parseExpr();
          if (argVal === null) return null;
          args.push(argVal);
          skipWhitespace();
          if (pos < len && expr.charCodeAt(pos) === 44) {
            pos++;
          } else {
            break;
          }
        }
      }
      if (pos >= len || expr.charCodeAt(pos) !== 41) return null;
      pos++; // skip ')'
      return evalScalarBuiltinCall(fnName, args);
    }
    const start = pos;
    while (pos < len) {
      const c = expr.charCodeAt(pos);
      if ((c >= 48 && c <= 57) || c === 46) {
        pos++;
      } else if ((c === 101 || c === 69) && pos > start) {
        pos++;
        if (pos < len && (expr.charCodeAt(pos) === 43 || expr.charCodeAt(pos) === 45)) {
          pos++;
        }
      } else {
        break;
      }
    }
    if (pos === start) return null;
    const num = Number(expr.slice(start, pos));
    return isNaN(num) ? null : num;
  }

  function parsePower(): number | null {
    const base = parsePrimary();
    if (base === null) return null;
    skipWhitespace();
    if (pos < len && expr.charCodeAt(pos) === 94) {
      pos++;
      const exp = parsePower();
      if (exp === null) return null;
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseMulDiv(): number | null {
    let left = parsePower();
    if (left === null) return null;
    while (pos < len) {
      skipWhitespace();
      if (pos >= len) break;
      const c = expr.charCodeAt(pos);
      if (c === 42) {
        pos++;
        const right = parsePower();
        if (right === null) return null;
        left = left * right;
      } else if (c === 47) {
        pos++;
        const right = parsePower();
        if (right === null || right === 0) return null;
        left = left / right;
      } else {
        break;
      }
    }
    return left;
  }

  function parseExpr(): number | null {
    let left = parseMulDiv();
    if (left === null) return null;
    while (pos < len) {
      skipWhitespace();
      if (pos >= len) break;
      const c = expr.charCodeAt(pos);
      if (c === 43) {
        pos++;
        const right = parseMulDiv();
        if (right === null) return null;
        left = left + right;
      } else if (c === 45) {
        pos++;
        const right = parseMulDiv();
        if (right === null) return null;
        left = left - right;
      } else {
        break;
      }
    }
    return left;
  }

  const res = parseExpr();
  skipWhitespace();
  if (res === null || pos < len) return null;
  return allowFloat ? res : Math.round(res);
}

export function evalArithmeticText(str: string, subs?: Map<string, number>, allowFloat = false): number | null {
  if (!str) return null;
  return evalArithmeticString(str.trim(), allowFloat, subs);
}

export function getVarPrefixSet(dae: DAEBuilder): Set<string> {
  const state = getFlatteningState(dae);
  let set = state.varPrefixSet;
  let lastCount = state.varPrefixCount ?? 0;
  if (!set) {
    set = new Set<string>();
    state.varPrefixSet = set;
    lastCount = 0;
  }
  const currCount = dae.varCount;
  if (lastCount < currCount) {
    for (let i = lastCount; i < currCount; i++) {
      if (dae.isVarRemoved(i)) continue;
      const name = dae.getVarName(i);
      let dotIdx = name.indexOf(".");
      while (dotIdx >= 0) {
        const p = name.slice(0, dotIdx);
        set.add(p);
        const brkIdx = p.indexOf("[");
        if (brkIdx >= 0) {
          set.add(p.slice(0, brkIdx));
        }
        dotIdx = name.indexOf(".", dotIdx + 1);
      }
      const brkIdx = name.indexOf("[");
      if (brkIdx >= 0) {
        set.add(name.slice(0, brkIdx));
      }
    }
    state.varPrefixCount = currCount;
  }
  return set;
}

export function getDaeArrayDimSize(dae: DAEBuilder, arrName: string, resolvedName: string, dim: number): number | null {
  const namedShape = getNamedArrayShape(dae, resolvedName) ?? getNamedArrayShape(dae, arrName);
  if (namedShape && namedShape.length >= dim && namedShape[dim - 1]! >= 0) {
    return namedShape[dim - 1]!;
  }
  const varIdx =
    dae.getVarIdxByName(resolvedName) >= 0 ? dae.getVarIdxByName(resolvedName) : dae.getVarIdxByName(arrName);
  if (varIdx >= 0) {
    const shape = dae.getVarShape(varIdx);
    if (shape && shape.length >= dim && shape[dim - 1]! >= 0) {
      return shape[dim - 1]!;
    }
  }
  const prefixSet = getVarPrefixSet(dae);
  if (!prefixSet.has(resolvedName) && !prefixSet.has(arrName)) {
    return null;
  }
  let maxDim = 0;
  const target = prefixSet.has(resolvedName) ? resolvedName : arrName;
  const prefixMatch = `${target}[`;
  const elemIndices = dae.getArrayElementIndices?.(target);
  if (elemIndices && elemIndices.length > 0) {
    for (let k = 0; k < elemIndices.length; k++) {
      const i = elemIndices[k]!;
      if (dae.isVarRemoved(i)) continue;
      const vn = dae.getVarName(i);
      if (vn.startsWith(prefixMatch)) {
        const rest = vn.slice(prefixMatch.length);
        const endBracket = rest.indexOf("]");
        if (endBracket >= 0) {
          const idxList = rest.slice(0, endBracket).split(",");
          if (dim >= 1 && dim <= idxList.length) {
            const val = parseInt(idxList[dim - 1]!.trim(), 10);
            if (!isNaN(val) && val > maxDim) maxDim = val;
          }
        }
      }
    }
    if (maxDim > 0) return maxDim;
  }
  for (let i = 0; i < dae.varCount; i++) {
    if (!dae.isVarRemoved(i)) {
      const vn = dae.getVarName(i);
      if (vn.startsWith(prefixMatch)) {
        const rest = vn.slice(prefixMatch.length);
        const endBracket = rest.indexOf("]");
        if (endBracket >= 0) {
          const idxList = rest.slice(0, endBracket).split(",");
          if (dim >= 1 && dim <= idxList.length) {
            const val = parseInt(idxList[dim - 1]!.trim(), 10);
            if (!isNaN(val) && val > maxDim) maxDim = val;
          }
        }
      }
    }
  }
  return maxDim > 0 ? maxDim : null;
}

const _evaluatingCSTNumbers = new Set<string>();
const _cstNumberMemo = new Map<string, number | null>();
let _cstCycleDetected = false;
let _externalEvalDepth = 0;

export function beginExternalCstEval(): void {
  _externalEvalDepth++;
}

export function endExternalCstEval(): void {
  if (--_externalEvalDepth <= 0) {
    _externalEvalDepth = 0;
    if (_evaluatingCSTNumbers.size === 0) {
      _cstNumberMemo.clear();
      _cstCycleDetected = false;
    }
  }
}

export function evaluateCSTNumber(
  node: SyntaxNode | string | null | undefined,
  subs?: Map<string, number>,
  scopeId?: SymbolId,
  db?: any,
  dae?: DAEBuilder,
  prefix = "",
): number | null {
  if (!node) return null;
  if (typeof node !== "string") {
    while (node && node.childCount === 1) {
      node = node.child(0);
    }
    if (!node) return null;
    if (node.childCount === 3 && Cst.kind(node.child(0)) === "(" && Cst.kind(node.child(2)) === ")") {
      return evaluateCSTNumber(node.child(1), subs, scopeId, db, dae, prefix);
    }
  }

  const rawNodeText = typeof node === "string" ? node : node.text;
  const text = (rawNodeText ? stripAnnotation(rawNodeText) : "").trim();
  if (text === "true") return 1;
  if (text === "false") return 0;
  if (subs && subs.has(text)) {
    const sv = subs.get(text)! as any;
    if (typeof sv === "number") return sv;
    if (typeof sv === "string" && sv.startsWith("expr:") && dae) {
      const ev = evalDaeExpr(Number(sv.slice(5)), dae);
      if (typeof ev === "number") return ev;
    }
    return null;
  }
  const num = parseInt(text, 10);
  if (!isNaN(num) && String(num) === text) return num;
  const floatNum = parseFloat(text);
  if (!isNaN(floatNum) && isSignedAsciiNumberText(text)) return floatNum;

  const evalCycleKey = `${subs?.size ? 1 : 0}:${scopeId ?? 0}:${prefix}:${text}`;
  const cached = _cstNumberMemo.get(evalCycleKey);
  if (cached !== undefined) return cached;
  if (_evaluatingCSTNumbers.has(evalCycleKey)) {
    _cstCycleDetected = true;
    return null;
  }
  _evaluatingCSTNumbers.add(evalCycleKey);
  try {
    const res = evaluateCSTNumberInner(node, text, subs, scopeId, db, dae, prefix);
    if (!_cstCycleDetected) {
      _cstNumberMemo.set(evalCycleKey, res);
    }
    return res;
  } finally {
    _evaluatingCSTNumbers.delete(evalCycleKey);
    if (_evaluatingCSTNumbers.size === 0 && _externalEvalDepth === 0) {
      _cstNumberMemo.clear();
      _cstCycleDetected = false;
    }
  }
}

function evaluateCSTNumberInner(
  node: SyntaxNode | string,
  text: string,
  subs?: Map<string, number>,
  scopeId?: SymbolId,
  db?: any,
  dae?: DAEBuilder,
  prefix = "",
): number | null {
  const ifCstCandidate = unwrapParenExprCst(
    typeof node === "string" ? (text.startsWith("if ") ? parseStandaloneExpressionCst(text) : null) : node,
  );
  if (ifCstCandidate && ifCstCandidate.type === "expression" && ifCstCandidate.child(0)?.text === "if") {
    let i = 0;
    while (i < ifCstCandidate.childCount) {
      const tok = ifCstCandidate.child(i)?.text;
      if (
        (tok === "if" || tok === "elseif") &&
        i + 3 < ifCstCandidate.childCount &&
        ifCstCandidate.child(i + 2)?.text === "then"
      ) {
        const condVal = evaluateCSTNumber(ifCstCandidate.child(i + 1)!, subs, scopeId, db, dae, prefix);
        if (condVal === null) break;
        if (condVal !== 0) {
          return evaluateCSTNumber(ifCstCandidate.child(i + 3)!, subs, scopeId, db, dae, prefix);
        }
        i += 4;
        continue;
      }
      if (tok === "else" && i + 1 < ifCstCandidate.childCount) {
        return evaluateCSTNumber(ifCstCandidate.child(i + 1)!, subs, scopeId, db, dae, prefix);
      }
      i++;
    }
  }

  const findInheritedModExpr = (
    startScopeId: SymbolId,
    targetName: string,
  ): { exprText: string; modScopeId: SymbolId } | null => {
    if (!db) return null;
    const visited = new Set<SymbolId>();
    const queue: SymbolId[] = [startScopeId];
    while (queue.length > 0) {
      const sid = queue.shift()!;
      if (visited.has(sid)) continue;
      visited.add(sid);
      const selfMod = db.query("effectiveModification", sid);
      const selfArg = selfMod?.args?.find(
        (a: any) => a && !a.isBreak && a.name === targetName && (a.value || a.bindingExpression),
      );
      if (selfArg) {
        const txt = (
          selfArg.value?.text ??
          selfArg.bindingExpression?.text ??
          (typeof selfArg.value?.value === "number" ? String(selfArg.value.value) : "")
        )?.trim();
        if (txt) return { exprText: txt, modScopeId: sid };
      }
      const extChildren = db.childrenOf?.(sid)?.filter((c: any) => c.kind === "Extends") ?? [];
      for (const ext of extChildren) {
        const extMod = db.query("extendsModificationParsed", ext.id);
        const matchingArg = extMod?.args?.find(
          (a: any) => a && !a.isBreak && a.name === targetName && (a.value || a.bindingExpression),
        );
        if (matchingArg) {
          const txt = (
            matchingArg.value?.text ??
            matchingArg.bindingExpression?.text ??
            (typeof matchingArg.value?.value === "number" ? String(matchingArg.value.value) : "")
          )?.trim();
          if (txt) return { exprText: txt, modScopeId: sid };
        }
        const baseCls: SymbolEntry | null = db.query("resolvedBaseClass", ext.id);
        if (baseCls && !visited.has(baseCls.id)) {
          queue.push(baseCls.id);
        }
      }
      const directBase: SymbolEntry | null = db.query("resolvedBaseClass", sid);
      if (directBase && !visited.has(directBase.id)) {
        queue.push(directBase.id);
      }
    }
    return null;
  };

  const evalArrayBindingDim = (rawBText: string, dim: number, evalSid: SymbolId | undefined): number | null => {
    const strippedB = stripAnnotation(rawBText).trim();
    const cleanB = (strippedB.startsWith("=") ? strippedB.slice(1) : strippedB).trim();
    if (dim === 1 && cleanB.startsWith("{") && cleanB.endsWith("}")) {
      const inner = cleanB.slice(1, -1).trim();
      return inner === "" ? 0 : parseArrayLiteralElements(cleanB).length;
    }
    const fillNode = unwrapParenExprCst(parseStandaloneExpressionCst(cleanB));
    if (fillNode?.type === "primary" && fillNode.childForFieldName("callee")?.text?.trim() === "fill") {
      const fillArgs = extractFunctionCallArgExprNodesCst(fillNode);
      if (fillArgs.length >= 1 + dim) {
        return evaluateCSTNumber(fillArgs[dim]!, subs, evalSid, db, dae, prefix);
      }
    }
    return null;
  };

  const resolveSizeCall = (arrName: string, dim: number): number | null => {
    if (dae) {
      const resolvedName = resolveScopedName(arrName, prefix, dae);
      const dimSize = getDaeArrayDimSize(dae, arrName, resolvedName, dim);
      if (dimSize !== null && dimSize > 0) return dimSize;
    }
    if (db) {
      if (scopeId !== undefined) {
        const modHit = findInheritedModExpr(scopeId, arrName);
        if (modHit) {
          const modDim = evalArrayBindingDim(modHit.exprText, dim, modHit.modScopeId);
          if (modDim !== null) return modDim;
        }
      }
      let sym: any = null;
      if (scopeId) {
        const res = db.query("resolveName", scopeId)?.(arrName) ?? db.query("resolveSimpleName", scopeId)?.(arrName);
        if (res) sym = res;
      }
      const syms = sym ? [sym] : db.byName(arrName);
      for (const s of syms) {
        if (dim === 1) {
          const lits = getSymbolEnumLiterals(db, s);
          if (lits) return lits.length;
        }
        const dims = db.query("arrayDimensions", s.id);
        if (dims && dims.length >= dim) {
          const d = dims[dim - 1];
          if (d?.kind === "literal" && typeof d.value === "number") return d.value;
        }
        const sMod = db.query("effectiveModification", s.id);
        const sBText = sMod?.bindingExpression?.text?.trim();
        if (sBText) {
          const bDim = evalArrayBindingDim(sBText, dim, scopeId ?? s.parentId ?? undefined);
          if (bDim !== null) return bDim;
        }
      }
    }
    return null;
  };

  const resolveIdentConstant = (ident: string, requireConstOrParamVariability: boolean): number | null => {
    if (ident === "true") return 1;
    if (ident === "false") return 0;
    if (subs && subs.has(ident)) {
      const sv = subs.get(ident)! as any;
      if (typeof sv === "number") return sv;
      if (typeof sv === "string" && sv.startsWith("expr:") && dae) {
        const ev = evalDaeExpr(Number(sv.slice(5)), dae);
        if (typeof ev === "number") return ev;
      }
      return null;
    }
    if (dae) {
      const resolved = resolveScopedName(ident, prefix, dae);
      let vIdx = dae.getVarIdxByName(resolved);
      if (vIdx < 0 && !requireConstOrParamVariability) vIdx = dae.getVarIdxByName(ident);
      if (vIdx >= 0) {
        const v = dae.getVarVariability(vIdx);
        if (!requireConstOrParamVariability || v === Variability.Constant || v === Variability.Parameter) {
          const bExpr = dae.getVarExpression(vIdx);
          if (bExpr !== undefined && bExpr >= 0) {
            const val = evalDaeExpr(bExpr, dae);
            if (typeof val === "number" && !isNaN(val)) return val;
            if (typeof val === "boolean") return val ? 1 : 0;
          }
          const startAttrExpr = dae.getVarAttrExprId?.(vIdx, "start");
          if (startAttrExpr !== undefined && startAttrExpr >= 0) {
            const val = evalDaeExpr(startAttrExpr, dae);
            if (typeof val === "number" && !isNaN(val)) return val;
            if (typeof val === "boolean") return val ? 1 : 0;
          }
          const startVal = dae.getVarStartValue(vIdx);
          if (
            startVal !== undefined &&
            !isNaN(startVal) &&
            (startVal !== 0 || (requireConstOrParamVariability && startAttrExpr !== undefined && startAttrExpr >= 0))
          ) {
            return startVal;
          }
        }
      }
      const pendingVals = (dae as any).pendingModValues as Map<string, number | boolean> | undefined;
      const fullKey = prefix ? `${prefix}.${ident}` : ident;
      if (pendingVals) {
        const pv = pendingVals.get(resolved) ?? pendingVals.get(fullKey);
        if (typeof pv === "number" && !isNaN(pv)) return pv;
        if (typeof pv === "boolean") return pv ? 1 : 0;
      }
      const pendingExprs = (dae as any).pendingModExprs as Map<string, string> | undefined;
      if (pendingExprs) {
        const pe = pendingExprs.get(resolved) ?? pendingExprs.get(fullKey);
        if (pe && pe !== ident && pe !== text) {
          const evalVal = evaluateCSTNumber(pe, subs, scopeId, db, dae, prefix);
          if (evalVal !== null) return evalVal;
        }
      }
    }
    if (db) {
      const state = dae ? getFlatteningState(dae) : null;
      const flat = state?.flattener ?? (dae as any)?.flattener;
      const rawEffScopeId = scopeId ?? flat?.currentClassId ?? flat?.currentRootClassId;
      const effScopeSym = rawEffScopeId !== undefined && db?.symbol ? db.symbol(rawEffScopeId) : undefined;
      const effScopeId =
        effScopeSym?.kind === "Component" && effScopeSym.parentId != null ? effScopeSym.parentId : rawEffScopeId;
      if (effScopeId !== undefined) {
        let resolvedIdent = ident;
        let redeclScopeId: SymbolId | undefined = undefined;
        if (ident.includes(".") && flat?.currentParentMods?.args) {
          const parts = ident.split(".");
          const firstSeg = parts[0]!;
          const parentRedecl = [...flat.currentParentMods.args]
            .reverse()
            .find((a: any) => a && !a.isBreak && a.name === firstSeg && a.redeclaredTypeSpecifier);
          if (parentRedecl?.redeclaredTypeSpecifier) {
            resolvedIdent = [parentRedecl.redeclaredTypeSpecifier, ...parts.slice(1)].join(".");
            const rawRedeclScope = parentRedecl.ownerClassId ?? parentRedecl.evaluationScopeId;
            const redeclSym = rawRedeclScope !== undefined && db?.symbol ? db.symbol(rawRedeclScope) : undefined;
            redeclScopeId =
              redeclSym?.kind === "Component" && redeclSym.parentId != null ? redeclSym.parentId : rawRedeclScope;
          }
        }
        if (resolvedIdent === ident && !ident.includes(".")) {
          let curScopeId: SymbolId | null | undefined = effScopeId;
          while (curScopeId !== undefined && curScopeId !== null) {
            const modHit = findInheritedModExpr(curScopeId, ident);
            if (modHit) {
              const bStr = modHit.exprText;
              if (bStr === "true") return 1;
              if (bStr === "false") return 0;
              const bVal = parseInt(bStr, 10);
              if (!isNaN(bVal) && String(bVal) === bStr) return bVal;
              if (bStr && bStr !== ident && bStr !== text) {
                const evalVal = evaluateCSTNumber(bStr, subs, curScopeId, db, dae, prefix);
                if (evalVal !== null) return evalVal;
              }
            }
            curScopeId = db.symbol?.(curScopeId)?.parentId;
          }
          const resolved =
            db.query("resolveName", effScopeId)?.(ident) ?? db.query("resolveSimpleName", effScopeId)?.(ident);
          if (resolved) {
            const mod = db.query("effectiveModification", resolved.id);
            if (mod?.bindingExpression?.text) {
              const bStr = stripAnnotation(mod.bindingExpression.text).trim();
              if (bStr === "true") return 1;
              if (bStr === "false") return 0;
              const bVal = parseInt(bStr, 10);
              if (!isNaN(bVal) && String(bVal) === bStr) return bVal;
              if (bStr && bStr !== ident && bStr !== text) {
                const evalVal = evaluateCSTNumber(bStr, subs, effScopeId, db, dae, prefix);
                if (evalVal !== null) return evalVal;
              }
            }
          }
        }
        const candidateScopes = [redeclScopeId, effScopeId, flat?.currentClassId, flat?.currentRootClassId].filter(
          (id, idx, arr): id is SymbolId => id != null && arr.indexOf(id) === idx,
        );
        for (const sId of candidateScopes) {
          const dbConst = lookupDbConstant(resolvedIdent, db, sId);
          if (dbConst && typeof dbConst.value === "number") {
            return dbConst.value;
          }
        }
        if (ident.includes(".")) {
          const idParts = resolvedIdent.split(".");
          const memberIdent = idParts.pop()!;
          const pkgPath = idParts.join(".");
          let pkgSym: SymbolEntry | null = null;
          for (const sId of candidateScopes) {
            const res = db.query("resolveName", sId)?.(pkgPath) ?? db.query("resolveSimpleName", sId)?.(pkgPath);
            if (res && (res.kind === "Class" || res.kind === "Package")) {
              pkgSym = res;
              break;
            }
          }
          if (!pkgSym) {
            pkgSym =
              db.byName(pkgPath.split(".").pop()!).find((e: any) => e.kind === "Class" || e.kind === "Package") ?? null;
          }
          if (pkgSym) {
            const visitedAliases = new Set<SymbolId>();
            while (pkgSym && !visitedAliases.has(pkgSym.id)) {
              visitedAliases.add(pkgSym.id);
              if (!getShortClassSpecifierNode(db.cstNode(pkgSym.id) as any)) break;
              const nextBase: SymbolEntry | null = db.query("resolvedBaseClass", pkgSym.id);
              if (nextBase) pkgSym = nextBase;
              else break;
            }
            if (pkgSym && memberIdent !== text) {
              const evalVal = evaluateCSTNumber(memberIdent, subs, pkgSym.id, db, dae, prefix);
              if (evalVal !== null) return evalVal;
            }
          }
        }
      }
    }
    return null;
  };

  const collectArrayCtorElements = (arrNode: SyntaxNode): SyntaxNode[] => {
    const out: SyntaxNode[] = [];
    const collect = (n: SyntaxNode): void => {
      if (n.type === "expression") {
        out.push(n);
        return;
      }
      if (n.type === "expression_list" || n.type === "array_arguments" || n.type === "array_arguments_non_first") {
        for (let i = 0; i < n.childCount; i++) {
          const ch = n.child(i);
          if (ch) collect(ch);
        }
        return;
      }
      for (let i = 0; i < n.childCount; i++) {
        const ch = n.child(i);
        if (ch) collect(ch);
      }
    };
    collect(arrNode);
    return out;
  };

  const evalCstExprNode = (rawExprNode: SyntaxNode, requireConstOrParam: boolean): number | null => {
    let cur = unwrapParenExprCst(rawExprNode);
    while (
      cur &&
      cur.childCount === 1 &&
      cur.type !== "component_reference" &&
      cur.type !== "identifier" &&
      cur.type !== "unsigned_number" &&
      cur.type !== "unsigned_integer" &&
      cur.type !== "unsigned_real"
    ) {
      const next = cur.child(0);
      if (!next) break;
      cur = unwrapParenExprCst(next);
    }
    if (!cur) return null;
    const rawCurText = cur.text?.trim() ?? "";
    if (rawCurText === "true") return 1;
    if (rawCurText === "false") return 0;
    if (subs && subs.has(rawCurText)) {
      const sv: unknown = subs.get(rawCurText);
      if (typeof sv === "number") return sv;
      if (typeof sv === "string" && sv.startsWith("expr:") && dae) {
        const ev = evalDaeExpr(Number(sv.slice(5)), dae);
        if (typeof ev === "number") return ev;
      }
      return null;
    }
    if (cur.type === "unsigned_number" || cur.type === "unsigned_integer" || cur.type === "unsigned_real") {
      const parsed = Number(rawCurText);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (cur.type === "expression" && cur.child(0)?.text === "if") {
      let i = 0;
      while (i < cur.childCount) {
        const tok = cur.child(i)?.text;
        if ((tok === "if" || tok === "elseif") && i + 3 < cur.childCount && cur.child(i + 2)?.text === "then") {
          const condVal = evalCstExprNode(cur.child(i + 1)!, requireConstOrParam);
          if (condVal === null) return null;
          if (condVal !== 0) {
            return evalCstExprNode(cur.child(i + 3)!, requireConstOrParam);
          }
          i += 4;
          continue;
        }
        if (tok === "else" && i + 1 < cur.childCount) {
          return evalCstExprNode(cur.child(i + 1)!, requireConstOrParam);
        }
        i++;
      }
      return null;
    }
    if (cur.type === "expression" && cur.childCount === 3) {
      const op = stripOuterDoubleQuotes(cur.child(1)?.text?.trim() ?? cur.child(1)?.type ?? "");
      const left = evalCstExprNode(cur.child(0)!, requireConstOrParam);
      const right = evalCstExprNode(cur.child(2)!, requireConstOrParam);
      if (left !== null && right !== null) {
        return evalBinaryNumericOp(op, left, right, true);
      }
      return null;
    }
    if (cur.type === "expression" && cur.childCount === 2) {
      const op = stripOuterDoubleQuotes(cur.child(0)?.text?.trim() ?? cur.child(0)?.type ?? "");
      const val = evalCstExprNode(cur.child(1)!, requireConstOrParam);
      if (val !== null) {
        if (op === "-") return -val;
        if (op === "+") return val;
        if (op === "not") return val === 0 ? 1 : 0;
      }
      return null;
    }
    if (cur.type === "primary") {
      const calleeText = stripLeadingDot(cur.childForFieldName("callee")?.text?.trim() ?? "");
      if (calleeText) {
        const argNodes = extractFunctionCallArgExprNodesCst(cur);
        if (calleeText === "size" && (argNodes.length === 1 || argNodes.length === 2)) {
          const arrName = stripLeadingDot(argNodes[0]!.text?.trim() ?? "");
          if (isDottedIdentifierChain(arrName)) {
            const dimVal = argNodes.length === 2 ? evalCstExprNode(argNodes[1]!, requireConstOrParam) : 1;
            if (dimVal !== null && Number.isInteger(dimVal)) {
              const sizeVal = resolveSizeCall(arrName, dimVal);
              if (sizeVal !== null) return sizeVal;
            }
          }
          return null;
        }
        if ((calleeText === "min" || calleeText === "max") && argNodes.length >= 1) {
          let elemNodes = argNodes;
          if (argNodes.length === 1) {
            const unwrappedArg = unwrapParenExprCst(argNodes[0]!);
            const firstTok = unwrappedArg?.child(0)?.text;
            if (unwrappedArg && (firstTok === "{" || firstTok === "[")) {
              elemNodes = collectArrayCtorElements(unwrappedArg);
            }
          }
          if (elemNodes.length > 0) {
            const vals: number[] = [];
            for (const elem of elemNodes) {
              const v = evalCstExprNode(elem, requireConstOrParam);
              if (v === null) {
                vals.length = 0;
                break;
              }
              vals.push(v);
            }
            if (vals.length > 0) {
              return calleeText === "min" ? Math.min(...vals) : Math.max(...vals);
            }
          }
          return null;
        }
        const evaledArgs: number[] = [];
        for (const arg of argNodes) {
          const av = evalCstExprNode(arg, requireConstOrParam);
          if (av === null) return null;
          evaledArgs.push(av);
        }
        return evalScalarBuiltinCall(calleeText, evaledArgs);
      }
    }
    if (cur.type === "component_reference" || cur.type === "identifier") {
      return resolveIdentConstant(rawCurText, requireConstOrParam);
    }
    if (cur.childCount === 0) {
      if (isSignedAsciiNumberText(rawCurText)) {
        const parsed = Number(rawCurText);
        return Number.isFinite(parsed) ? parsed : null;
      }
      if (
        isDottedIdentifierChain(stripLeadingDot(rawCurText)) ||
        (rawCurText.startsWith("'") && rawCurText.endsWith("'"))
      ) {
        return resolveIdentConstant(rawCurText, requireConstOrParam);
      }
    }
    return null;
  };

  const exprCst = typeof node === "string" ? parseStandaloneExpressionCst(text) : node;
  if (exprCst) {
    const strictVal = evalCstExprNode(exprCst, true);
    if (strictVal !== null) return strictVal;
    const unwrappedExpr = unwrapParenExprCst(exprCst);
    const isCompoundOp =
      unwrappedExpr !== null &&
      unwrappedExpr.type === "expression" &&
      (unwrappedExpr.childCount === 2 || unwrappedExpr.childCount === 3);
    if (isCompoundOp) {
      const relaxedVal = evalCstExprNode(exprCst, false);
      if (relaxedVal !== null) return relaxedVal;
    }
  } else {
    const directIdentVal = resolveIdentConstant(text, true);
    if (directIdentVal !== null) return directIdentVal;
    const arithVal = evalArithmeticText(text, subs, false);
    if (arithVal !== null) return arithVal;
  }

  return null;
}

export function resolveScopedName(
  name: string,
  prefix: string,
  dae: DAEBuilder,
  innerOuterComponents?: Set<string>,
  recordDiagnostics = false,
): string {
  const state = getFlatteningState(dae);
  const remapOuter = (candidate: string): string | null => {
    if (!state.outerToInner || state.outerToInner.size === 0) return null;
    if (state.outerToInner.has(candidate)) {
      const isStateOut = !state.isInsidePrevious && state.stateOutputVars?.has(candidate);
      if (!isStateOut) return state.outerToInner.get(candidate)!;
    }
    const baseCand = stripArraySubscripts(candidate);
    if (baseCand !== candidate && state.outerToInner.has(baseCand)) {
      const isStateOut = !state.isInsidePrevious && state.stateOutputVars?.has(baseCand);
      if (!isStateOut) {
        const mapped = state.outerToInner.get(baseCand)!;
        const candTail = extractTrailingBrackets(candidate);
        if (candTail && !mapped.endsWith("]")) return mapped + candTail;
        return mapped;
      }
    }
    let dot = candidate.lastIndexOf(".");
    while (dot > 0) {
      const sub = candidate.slice(0, dot);
      const baseSub = stripArraySubscripts(sub);
      const exactMapped = state.outerToInner.get(sub);
      const baseMapped = exactMapped === undefined ? state.outerToInner.get(baseSub) : undefined;
      const mapped = exactMapped ?? baseMapped;
      if (mapped) {
        const isStateOut =
          !state.isInsidePrevious && (state.stateOutputVars?.has(sub) || state.stateOutputVars?.has(baseSub));
        if (!isStateOut) {
          const subTail = exactMapped === undefined ? extractTrailingBrackets(sub) : "";
          const effectiveMapped = subTail && !mapped.endsWith("]") ? mapped + subTail : mapped;
          return effectiveMapped + candidate.slice(dot);
        }
      }
      dot = candidate.lastIndexOf(".", dot - 1);
    }
    return null;
  };
  if (state.outerToInner) {
    const mappedName = remapOuter(name);
    if (mappedName) return mappedName;
  }
  if (state.constantAliases?.has(name)) {
    return state.constantAliases.get(name)!;
  }
  const prefixedCandidate = prefix ? `${prefix}.${name}` : name;
  if (state.constantAliases?.has(prefixedCandidate)) {
    return state.constantAliases.get(prefixedCandidate)!;
  }
  if (!prefix) return name;
  const basePrefixedCandidate = stripArraySubscripts(prefixedCandidate);
  const initialPrefixSet = getVarPrefixSet(dae);
  const prefixedExistsInDae =
    dae.getVarIdxByName(prefixedCandidate) >= 0 ||
    dae.getVarIdxByName(basePrefixedCandidate) >= 0 ||
    initialPrefixSet.has(prefixedCandidate) ||
    initialPrefixSet.has(basePrefixedCandidate) ||
    dae.hasArrayElements(prefixedCandidate);
  if (!prefixedExistsInDae) {
    if (name.startsWith(prefix + ".")) return name;

    let anc = prefix;
    while (anc) {
      if (name.startsWith(anc + ".")) return name;
      const dot = anc.lastIndexOf(".");
      if (dot < 0) break;
      anc = anc.slice(0, dot);
    }
  }
  if (state.outerToInner) {
    const mappedFull = remapOuter(prefixedCandidate);
    if (mappedFull) return mappedFull;
  }

  const rootComp = name.split(".")[0]!.split("[")[0]!;
  const fullLocalRoot = `${prefix}.${rootComp}`;
  const isStateOutput = Boolean(state.stateOutputVars?.has(fullLocalRoot));
  const isInnerOuter = innerOuterComponents?.has(fullLocalRoot) || (Boolean(state.isInsidePrevious) && isStateOutput);

  const scopeDeclaredNames: Map<string, Set<string>> | undefined = state.scopeDeclaredNames;

  let resolvedName: string | null = null;
  if (!isInnerOuter) {
    const basePrefix = stripArraySubscripts(prefix);
    if (scopeDeclaredNames?.get(prefix)?.has(rootComp) || scopeDeclaredNames?.get(basePrefix)?.has(rootComp)) {
      resolvedName = `${prefix}.${name}`;
    } else {
      const prefixed = `${prefix}.${name}`;
      if (dae.getVarIdxByName(prefixed) >= 0) {
        resolvedName = prefixed;
      } else {
        const prefixSet = getVarPrefixSet(dae);
        if (prefixSet.has(prefixed)) {
          resolvedName = prefixed;
        }
      }
    }
  }

  if (!resolvedName) {
    // Walk up enclosing scopes
    let p: string | null = prefix.includes(".") ? prefix.split(".").slice(0, -1).join(".") : "";
    while (p !== null) {
      const target = p ? `${p}.${name}` : name;
      const isStateOut = Boolean(state.isInsidePrevious && state.stateOutputVars?.has(target));
      if (!isStateOut) {
        if (!isInnerOuter) {
          const vIdx = dae.getVarIdxByName(target);
          if (vIdx >= 0 && dae.getVarVariability(vIdx) === Variability.Constant) {
            resolvedName = target;
            break;
          }
          if (vIdx < 0 && dae.hasArrayElements(target)) {
            resolvedName = target;
            break;
          }
          if (vIdx >= 0 && dae.getVarVariability(vIdx) !== Variability.Constant) {
            const flattener = state.flattener;
            const currentClassId = flattener?.currentClassId ?? state.currentClassId;
            const currentRootClassId = flattener?.currentRootClassId ?? state.currentRootClassId;
            if (
              p === "" &&
              prefix !== "" &&
              currentClassId &&
              currentRootClassId &&
              currentClassId !== currentRootClassId
            ) {
              if (recordDiagnostics) {
                if (!state.outerNonConstantAccess) {
                  state.outerNonConstantAccess = [];
                }
                const exists = state.outerNonConstantAccess.some(
                  (e: any) => e.compName === prefix && e.varName === name && e.target === target,
                );
                if (!exists) {
                  state.outerNonConstantAccess.push({
                    compName: prefix,
                    varName: name,
                    target,
                    p,
                  });
                }
              }
              break;
            } else {
              resolvedName = target;
              break;
            }
          }
        } else {
          const baseP = stripArraySubscripts(p);
          if (scopeDeclaredNames?.get(p)?.has(rootComp) || scopeDeclaredNames?.get(baseP)?.has(rootComp)) {
            resolvedName = target;
            break;
          }
          if (dae.getVarIdxByName(target) >= 0) {
            resolvedName = target;
            break;
          }
          const prefixSet = getVarPrefixSet(dae);
          if (prefixSet.has(target)) {
            resolvedName = target;
            break;
          }
        }
      }
      p = p.includes(".") ? p.split(".").slice(0, -1).join(".") : p === "" ? null : "";
    }
  }

  if (!resolvedName && name.includes(".")) {
    const parts = name.split(".");
    if (parts.length >= 2 && !parts[0]!.includes("[")) {
      const withIdx1 = `${prefix}.${parts[0]}[1].${parts.slice(1).join(".")}`;
      if (dae.getVarIdxByName(withIdx1) >= 0) {
        resolvedName = withIdx1;
      }
    }
  }

  return resolvedName ?? (name.includes(".") ? name : `${prefix}.${name}`);
}

export function isIntegerTypeSpec(
  typeSpec: string | null | undefined,
  db?: QueryDB,
  visited = new Set<SymbolId>(),
  scopeId?: SymbolId,
): boolean {
  if (!typeSpec) return false;
  if (typeSpec === "Integer") return true;
  if (typeSpec === "Real" || typeSpec === "Boolean" || typeSpec === "String") return false;
  if (db) {
    let resolvedSym: SymbolEntry | null = null;
    if (scopeId) {
      const resolver = db.query<any>("resolveName", scopeId) ?? db.query<any>("resolveSimpleName", scopeId);
      const res = resolver?.(typeSpec);
      if (res && res.kind === "Class") resolvedSym = res;
    }
    const leaf = typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec;
    const matches = resolvedSym ? [resolvedSym] : db.byName(leaf);
    for (const tm of matches) {
      if (tm.kind === "Class") {
        if (visited.has(tm.id)) continue;
        visited.add(tm.id);
        const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", tm.id);
        if (baseClass && baseClass.name !== typeSpec) {
          if (isIntegerTypeSpec(baseClass.name, db, visited, tm.id)) return true;
        }
        const meta = tm.metadata as Record<string, unknown> | undefined;
        if (meta?.["baseType"] === "Integer" || meta?.["primitiveType"] === "Integer") return true;
        const isIntTypeRef = (rawType: string | null | undefined): boolean => {
          const clean = stripLeadingDot(rawType?.trim() ?? "");
          return (
            clean === "Integer" ||
            clean === "TypeInteger" ||
            clean === "Modelica.Icons.TypeInteger" ||
            clean.endsWith(".TypeInteger")
          );
        };
        const shortSpec = getShortClassSpecifierNode(db.cstNode(tm.id) as CstNodeLike | null);
        if (shortSpec && isIntTypeRef(shortSpec.childForFieldName?.("type_specifier")?.text)) return true;
        for (const extCh of db.childrenOf(tm.id) || []) {
          if (extCh.kind === "Extends") {
            const extType =
              (db.cstNode(extCh.id) as CstNodeLike | null)?.childForFieldName?.("type_specifier")?.text ?? extCh.name;
            if (isIntTypeRef(extType)) return true;
          }
        }
      }
    }
  }
  return false;
}

const KNOWN_MODELICA_CONSTANTS: Record<string, number> = MODELICA_CONSTANTS;

function canSubstituteBareSingleLetterConstant(
  ident: string,
  exprText: string,
  db?: QueryDB,
  scopeId?: SymbolId,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(BARE_SINGLE_LETTER_MODELICA_CONSTANTS, ident)) {
    return false;
  }
  if (exprText.includes("Modelica.Constants.")) {
    return true;
  }
  if (!db || scopeId === undefined) {
    return false;
  }
  const scopeSym = db.symbol(scopeId);
  if (scopeSym?.name === "Constants" || getSymbolQualifiedName(db, scopeId).endsWith("Constants")) {
    return true;
  }
  let hasConstantsImport = false;
  let curId: SymbolId | null | undefined = scopeId;
  const visited = new Set<SymbolId>();
  while (curId !== undefined && curId !== null && !visited.has(curId)) {
    visited.add(curId);
    const children = db.childrenOf(curId) || [];
    for (const ch of children) {
      if (ch.kind === "Component" && ch.name === ident) {
        return false;
      }
      if (ch.kind === "Import") {
        const impNode = db.cstNode(ch.id) as CstNodeLike | null;
        const impMetaPath = (ch.metadata as Record<string, unknown> | undefined)?.["path"];
        const rawImpName =
          impNode?.childForFieldName?.("name")?.text?.trim() ??
          (typeof impMetaPath === "string" ? impMetaPath : ch.name) ??
          "";
        const impSegs = stripLeadingDot(rawImpName)
          .split(".")
          .map((seg: string) => seg.trim());
        if (impSegs.includes("Constants")) {
          hasConstantsImport = true;
        }
      }
    }
    const baseSym = db.query<SymbolEntry | null>("resolvedBaseClass", curId);
    if (baseSym && !visited.has(baseSym.id)) {
      const baseChildren = db.childrenOf(baseSym.id) || [];
      if (baseChildren.some((ch) => ch.kind === "Component" && ch.name === ident)) {
        return false;
      }
    }
    curId = db.symbol(curId)?.parentId;
  }
  if (!hasConstantsImport) {
    return false;
  }
  const resolved =
    db.query<any>("resolveSimpleName", scopeId)?.(ident) ?? db.query<any>("resolveName", scopeId)?.(ident);
  if (resolved && resolved.kind === "Component") {
    const parentSym = resolved.parentId != null ? db.symbol(resolved.parentId) : null;
    if (parentSym?.name !== "Constants") {
      return false;
    }
  }
  return true;
}

const KNOWN_MATH_UNARY_FUNCS: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  log: Math.log,
  log10: Math.log10,
  sqrt: Math.sqrt,
  abs: Math.abs,
  from_degC: (x: number) => x + 273.15,
  to_degC: (x: number) => x - 273.15,
  from_bar: (x: number) => x * 1e5,
  to_bar: (x: number) => x * 1e-5,
};

function evalKnownConstantExprText(exprText: string, db?: QueryDB, scopeId?: SymbolId): number | null {
  const s = exprText.trim();
  if (!s) return null;
  if (Object.prototype.hasOwnProperty.call(KNOWN_MODELICA_CONSTANTS, s)) {
    return KNOWN_MODELICA_CONSTANTS[s]!;
  }
  if (canSubstituteBareSingleLetterConstant(s, s, db, scopeId)) {
    return BARE_SINGLE_LETTER_MODELICA_CONSTANTS[s]!;
  }
  const rootCst = parseStandaloneExpressionCst(s);
  if (!rootCst) {
    if (isSignedAsciiNumberText(s)) {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    if (Object.prototype.hasOwnProperty.call(KNOWN_MODELICA_CONSTANTS, s)) {
      return KNOWN_MODELICA_CONSTANTS[s]!;
    }
    return null;
  }

  const evalCstNode = (rawNode: SyntaxNode): number | null => {
    const cur = unwrapParenExprCst(rawNode);
    if (!cur) return null;
    if (cur.type === "unsigned_number" || cur.type === "unsigned_integer" || cur.type === "unsigned_real") {
      const n = Number(cur.text);
      return Number.isFinite(n) ? n : null;
    }
    if (cur.type === "expression" && cur.childCount === 2) {
      const op = stripOuterDoubleQuotes(cur.child(0)?.text?.trim() ?? cur.child(0)?.type ?? "");
      const val = evalCstNode(cur.child(1)!);
      if (val === null) return null;
      if (op === "+") return val;
      if (op === "-") return -val;
      return null;
    }
    if (cur.type === "expression" && cur.childCount === 3) {
      const op = stripOuterDoubleQuotes(cur.child(1)?.text?.trim() ?? cur.child(1)?.type ?? "");
      if (op !== "+" && op !== "-" && op !== "*" && op !== "/" && op !== "^") return null;
      const left = evalCstNode(cur.child(0)!);
      const right = evalCstNode(cur.child(2)!);
      if (left === null || right === null) return null;
      return evalBinaryNumericOp(op, left, right, false);
    }
    if (cur.type === "primary") {
      const calleeText = cur.childForFieldName("callee")?.text?.trim();
      if (calleeText) {
        const shortFn = stripMathPackagePrefix(stripLeadingDot(calleeText));
        const args = extractFunctionCallArgExprNodesCst(cur);
        if (shortFn === "atan2" && args.length === 2) {
          const arg1 = evalCstNode(args[0]!);
          const arg2 = evalCstNode(args[1]!);
          return arg1 !== null && arg2 !== null ? Math.atan2(arg1, arg2) : null;
        }
        if (args.length === 1) {
          const fn = KNOWN_MATH_UNARY_FUNCS[shortFn];
          if (!fn) return null;
          const arg1 = evalCstNode(args[0]!);
          return arg1 !== null ? fn(arg1) : null;
        }
        return null;
      }
    }
    if (cur.type === "component_reference" || cur.type === "identifier") {
      const ident = stripLeadingDot(cur.text.trim());
      if (Object.prototype.hasOwnProperty.call(KNOWN_MODELICA_CONSTANTS, ident)) {
        return KNOWN_MODELICA_CONSTANTS[ident]!;
      }
      if (canSubstituteBareSingleLetterConstant(ident, s, db, scopeId)) {
        return BARE_SINGLE_LETTER_MODELICA_CONSTANTS[ident]!;
      }
      return null;
    }
    return null;
  };

  const result = evalCstNode(rootCst);
  return result !== null && Number.isFinite(result) ? result : null;
}

/**
 * Domain-specific evaluator for Modelica media property functions (e.g. `specificEnthalpy_pTX`)
 * when resolving compile-time constant attributes during symbol table indexing.
 */
function evaluateMediumPropertyConstant(
  str: string,
  db: QueryDB,
  evalScope: SymbolId | undefined,
  isInteger: boolean,
  evalExprStr: (s: string) => { value: any; isInteger: boolean } | null,
): { value: number; isInteger: boolean } | null {
  if (!evalScope) return null;
  const callNode = unwrapParenExprCst(parseStandaloneExpressionCst(str));
  if (!callNode || callNode.type !== "primary") return null;
  const rawCallee = callNode.childForFieldName("callee")?.text?.trim() ?? "";
  let callPkgPrefix: string | undefined;
  if (rawCallee === "specificEnthalpy_pTX") {
    callPkgPrefix = undefined;
  } else if (rawCallee.endsWith(".specificEnthalpy_pTX")) {
    const pfx = rawCallee.slice(0, -".specificEnthalpy_pTX".length);
    if (!isDottedIdentifierChain(pfx)) return null;
    callPkgPrefix = pfx;
  } else {
    return null;
  }
  const argNodes = extractFunctionCallArgExprNodesCst(callNode);
  if (argNodes.length !== 3) return null;
  const tArg = argNodes[1]!.text.trim();
  let mediumScopeId: SymbolId | undefined = evalScope;
  if (callPkgPrefix) {
    const resolvedPkg =
      db.query<any>("resolveName", evalScope)?.(callPkgPrefix) ??
      db.query<any>("resolveSimpleName", evalScope)?.(callPkgPrefix) ??
      db
        .byName(callPkgPrefix.split(".").pop()!)
        .find(
          (s) =>
            (s.kind === "Class" || s.kind === "Package") &&
            (s.name === callPkgPrefix || getSymbolQualifiedName(db, s.id).endsWith(callPkgPrefix)),
        );
    if (resolvedPkg) {
      let pkgSym: SymbolEntry = resolvedPkg;
      const seenAliases = new Set<SymbolId>();
      while (pkgSym && !seenAliases.has(pkgSym.id)) {
        seenAliases.add(pkgSym.id);
        if (!getShortClassSpecifierNode(db.cstNode(pkgSym.id) as any)) break;
        const nextBase = db.query<SymbolEntry | null>("resolvedBaseClass", pkgSym.id);
        if (nextBase) pkgSym = nextBase;
        else break;
      }
      mediumScopeId = pkgSym.id;
    }
  } else {
    const fnSym =
      db.query<any>("resolveSimpleName", evalScope)?.("specificEnthalpy_pTX") ??
      db.query<any>("resolveName", evalScope)?.("specificEnthalpy_pTX");
    if (fnSym?.parentId != null) {
      mediumScopeId = fnSym.parentId;
    }
  }
  const lookupScopedMediumConst = (constName: string) => {
    if (callPkgPrefix) {
      const qualRes = lookupDbConstant(`${callPkgPrefix}.${constName}`, db, evalScope);
      if (qualRes && typeof qualRes.value === "number") return qualRes;
    }
    const rawScopes = callPkgPrefix ? [mediumScopeId, evalScope] : [evalScope, mediumScopeId];
    const startScopes = rawScopes.filter((id, idx, arr): id is SymbolId => id !== undefined && arr.indexOf(id) === idx);
    for (const sId of startScopes) {
      const queue: SymbolId[] = [sId];
      const visited = new Set<SymbolId>();
      while (queue.length > 0) {
        const curId = queue.shift()!;
        if (visited.has(curId)) continue;
        visited.add(curId);
        const direct = db.childrenOf(curId).find((ch) => ch.kind === "Component" && ch.name === constName);
        if (direct) {
          const val = extractDbConstantValue(direct, db, sId);
          if (val && typeof val.value === "number") return val;
        }
        const base = db.query<SymbolEntry | null>("resolvedBaseClass", curId);
        if (base && !visited.has(base.id)) queue.push(base.id);
        for (const ch of db.childrenOf(curId)) {
          if (ch.kind === "Extends") {
            const extBase = db.query<SymbolEntry | null>("resolvedBaseClass", ch.id);
            if (extBase && !visited.has(extBase.id)) queue.push(extBase.id);
          }
        }
      }
    }
    return null;
  };
  const cpRes = lookupScopedMediumConst("cp_const");
  const t0Res = lookupScopedMediumConst("T0");
  const tRes =
    evalExprStr(tArg) ??
    (callPkgPrefix && tArg.startsWith(`${callPkgPrefix}.`) && mediumScopeId
      ? lookupDbConstant(tArg.slice(callPkgPrefix.length + 1), db, mediumScopeId)
      : null) ??
    lookupDbConstant(tArg, db, (callPkgPrefix ? mediumScopeId : evalScope) ?? mediumScopeId ?? evalScope);
  if (
    cpRes &&
    typeof cpRes.value === "number" &&
    t0Res &&
    typeof t0Res.value === "number" &&
    tRes &&
    typeof tRes.value === "number"
  ) {
    const val = cpRes.value * (tRes.value - t0Res.value);
    return { value: val, isInteger: isInteger && Number.isInteger(val) };
  }
  return null;
}

export function extractDbConstantValue(
  c: SymbolEntry,
  db: QueryDB,
  ownerScopeId?: SymbolId,
): { value: any; isInteger: boolean; isBoolean?: boolean } | null {
  const variability = db.query<string | null>("variability", c.id);
  if (variability !== "constant") {
    return null;
  }
  const evalScope = ownerScopeId ?? c.parentId ?? undefined;
  const typeSpec = db.query<string | null>("typeSpecifier", c.id);
  const isBoolean = typeSpec === "Boolean";
  const isInteger = isIntegerTypeSpec(typeSpec, db, undefined, evalScope);
  const evalExprStr = (rawStr: string): { value: any; isInteger: boolean; isBoolean?: boolean } | null => {
    const str = stripAnnotation(rawStr).trim();
    if (!str) return null;
    if (str === "true") return { value: 1, isInteger: true, isBoolean: true };
    if (str === "false") return { value: 0, isInteger: true, isBoolean: true };
    if (str.startsWith('"') && str.endsWith('"') && !str.slice(1, -1).includes('"')) {
      return { value: str.slice(1, -1), isInteger: false };
    }
    const exprCst = unwrapParenExprCst(parseStandaloneExpressionCst(str));
    if (exprCst && exprCst.type === "expression" && exprCst.child(0)?.text === "if") {
      let idx = 0;
      let matchedBranch: SyntaxNode | null = null;
      while (idx < exprCst.childCount) {
        const tok = exprCst.child(idx)?.text;
        if (
          (tok === "if" || tok === "elseif") &&
          idx + 3 < exprCst.childCount &&
          exprCst.child(idx + 2)?.text === "then"
        ) {
          const condStr = exprCst.child(idx + 1)!.text.trim();
          const condVal =
            condStr === "true"
              ? 1
              : condStr === "false"
                ? 0
                : (lookupDbConstant(condStr, db, evalScope)?.value ?? evalExprStr(condStr)?.value ?? null);
          if (typeof condVal !== "number") break;
          if (condVal !== 0) {
            matchedBranch = exprCst.child(idx + 3)!;
            break;
          }
          idx += 4;
          continue;
        }
        if (tok === "else" && idx + 1 < exprCst.childCount) {
          matchedBranch = exprCst.child(idx + 1)!;
          break;
        }
        idx++;
      }
      if (matchedBranch) {
        return evalExprStr(matchedBranch.text.trim());
      }
    }
    if (exprCst && exprCst.type === "primary") {
      const calleeText = exprCst.childForFieldName("callee")?.text?.trim();
      const argNodes = calleeText ? extractFunctionCallArgExprNodesCst(exprCst) : [];
      if (calleeText === "size" && (argNodes.length === 1 || argNodes.length === 2)) {
        const targetText = argNodes[0]!.text.trim();
        const arrRes = lookupDbConstant(targetText, db, evalScope) ?? evalExprStr(targetText);
        if (arrRes && Array.isArray(arrRes.value)) {
          const dimRes = argNodes[1] ? evalExprStr(argNodes[1].text.trim()) : { value: 1 };
          const dimIdx = dimRes && typeof dimRes.value === "number" ? Math.round(dimRes.value) : 1;
          if (dimIdx === 1) {
            return { value: arrRes.value.length, isInteger: true };
          }
        }
      }
      if (calleeText === "fill" && argNodes.length === 2) {
        const elemRes = evalExprStr(argNodes[0]!.text.trim());
        const countRes = evalExprStr(argNodes[1]!.text.trim());
        if (
          elemRes &&
          (typeof elemRes.value === "number" || typeof elemRes.value === "string") &&
          countRes &&
          typeof countRes.value === "number"
        ) {
          const cnt = Math.round(countRes.value);
          if (cnt >= 0 && cnt <= MAX_ARRAY_EXPANSION_LENGTH) {
            return {
              value: Array(cnt).fill(elemRes.value),
              isInteger,
              ...(elemRes.isBoolean ? { isBoolean: true } : {}),
            };
          }
        }
      }
    }
    if (str.startsWith("{") && str.endsWith("}")) {
      const inner = str.slice(1, -1).trim();
      if (!inner) return { value: [], isInteger };
      const elemStrs = inner.split(",").map((s: string) => s.trim());
      const nums: number[] = [];
      let allNums = true;
      for (const es of elemStrs) {
        const n = parseFloat(es);
        if (isNaN(n)) {
          allNums = false;
          break;
        }
        nums.push(n);
      }
      if (allNums && nums.length > 0) {
        return { value: nums, isInteger };
      }
      const evaledElems: any[] = [];
      let allEvaled = true;
      for (const es of elemStrs) {
        const ev = evalExprStr(es);
        if (!ev || (typeof ev.value !== "number" && typeof ev.value !== "string")) {
          allEvaled = false;
          break;
        }
        evaledElems.push(ev.value);
      }
      if (allEvaled && evaledElems.length > 0) {
        return { value: evaledElems, isInteger };
      }
    }
    const num = parseFloat(str);
    if (!isNaN(num) && isSignedAsciiNumberText(str)) {
      return { value: num, isInteger: isInteger && Number.isInteger(num) };
    }
    if (isDottedIdentifierChain(stripLeadingDot(str))) {
      const chained = lookupDbConstant(str, db, evalScope);
      if (chained) {
        return {
          value: chained.value,
          isInteger: isInteger && chained.isInteger,
          ...(isBoolean || chained.isBoolean ? { isBoolean: true } : {}),
        };
      }
    }
    const knownVal = evalKnownConstantExprText(str, db, evalScope);
    if (knownVal !== null) {
      return { value: knownVal, isInteger: isInteger && Number.isInteger(knownVal) };
    }
    const mediumConst = evaluateMediumPropertyConstant(str, db, evalScope, isInteger, evalExprStr);
    if (mediumConst !== null) {
      return mediumConst;
    }
    let guardSet = (db as any)._inExtractDbConst as Set<SymbolId> | undefined;
    if (!guardSet) {
      guardSet = new Set();
      (db as any)._inExtractDbConst = guardSet;
    }
    if (!guardSet.has(c.id) && str !== c.name) {
      guardSet.add(c.id);
      try {
        const cstNum = evaluateCSTNumber(str, undefined, evalScope, db);
        if (cstNum !== null && !isNaN(cstNum)) {
          return { value: cstNum, isInteger: isInteger && Number.isInteger(cstNum) };
        }
      } finally {
        guardSet.delete(c.id);
      }
    }
    return null;
  };
  if (ownerScopeId && ownerScopeId !== c.parentId) {
    const ownerQueue: SymbolId[] = [ownerScopeId];
    const seenOwners = new Set<SymbolId>();
    while (ownerQueue.length > 0) {
      const curOwnerId = ownerQueue.shift()!;
      if (curOwnerId === c.parentId || seenOwners.has(curOwnerId)) continue;
      seenOwners.add(curOwnerId);
      const ownerMod = db.query<any>("effectiveModification", curOwnerId);
      const matchingOwnerArg = ownerMod?.args
        ? [...ownerMod.args].reverse().find((a: any) => a && !a.isBreak && a.name === c.name)
        : null;
      const ownerBText = (matchingOwnerArg?.value?.text ?? matchingOwnerArg?.bindingExpression?.text)?.trim();
      if (ownerBText) {
        const res = evalExprStr(ownerBText);
        if (res) return res;
      } else if (matchingOwnerArg?.value?.kind === "literal" && typeof matchingOwnerArg.value.value === "number") {
        return {
          value: matchingOwnerArg.value.value,
          isInteger: isInteger && Number.isInteger(matchingOwnerArg.value.value),
        };
      } else if (matchingOwnerArg?.value?.kind === "literal" && typeof matchingOwnerArg.value.value === "boolean") {
        return {
          value: matchingOwnerArg.value.value ? 1 : 0,
          isInteger: true,
          isBoolean: true,
        };
      } else if (matchingOwnerArg?.value?.kind === "literal" && typeof matchingOwnerArg.value.value === "string") {
        return {
          value: matchingOwnerArg.value.value,
          isInteger: false,
        };
      }
      for (const extChild of db.childrenOf(curOwnerId) || []) {
        if (extChild.kind !== "Extends") continue;
        const extModRaw = db.query<any>("extendsModificationParsed", extChild.id);
        const extArgs: any[] = Array.isArray(extModRaw) ? extModRaw : (extModRaw?.args ?? []);
        const matchingExtArg = [...extArgs].reverse().find((a: any) => a && !a.isBreak && a.name === c.name);
        const extBText = (matchingExtArg?.value?.text ?? matchingExtArg?.bindingExpression?.text)?.trim();
        if (extBText) {
          const res = evalExprStr(extBText) ?? lookupDbConstant(extBText, db, curOwnerId);
          if (res) return res;
        } else if (matchingExtArg?.value?.kind === "literal" && typeof matchingExtArg.value.value === "number") {
          return {
            value: matchingExtArg.value.value,
            isInteger: isInteger && Number.isInteger(matchingExtArg.value.value),
          };
        } else if (matchingExtArg?.value?.kind === "literal" && typeof matchingExtArg.value.value === "boolean") {
          return {
            value: matchingExtArg.value.value ? 1 : 0,
            isInteger: true,
            isBoolean: true,
          };
        } else if (matchingExtArg?.value?.kind === "literal" && typeof matchingExtArg.value.value === "string") {
          return {
            value: matchingExtArg.value.value,
            isInteger: false,
          };
        }
        const extBase = db.query<SymbolEntry | null>("resolvedBaseClass", extChild.id);
        if (extBase && extBase.id !== c.parentId && !seenOwners.has(extBase.id)) {
          ownerQueue.push(extBase.id);
        }
      }
      const ownerCst = db.cstNode(curOwnerId) as any;
      const shortSpec = getShortClassSpecifierNode(ownerCst);
      const argExprNode = extractModArgBindingExprCst(shortSpec, c.name);
      const argExprText = argExprNode ? stripAnnotation(argExprNode.text ?? "").trim() : "";
      if (argExprText && argExprText !== "break") {
        const res = evalExprStr(argExprText);
        if (res) return res;
      }
      const nextBase = db.query<SymbolEntry | null>("resolvedBaseClass", curOwnerId);
      if (nextBase && nextBase.id === c.parentId) {
        break;
      }
      if (nextBase && nextBase.id !== curOwnerId && !seenOwners.has(nextBase.id)) {
        ownerQueue.push(nextBase.id);
      }
      if (ownerQueue.length === 0) {
        const encParentId = db.symbol(curOwnerId)?.parentId;
        if (encParentId && encParentId !== c.parentId && !seenOwners.has(encParentId)) {
          ownerQueue.push(encParentId);
        }
      }
    }
  }
  const mod = db.query<any>("effectiveModification", c.id);
  const bText = mod?.bindingExpression?.text?.trim();
  if (bText) {
    const res = evalExprStr(bText);
    if (res) return res;
  }
  const cst = db.cstNode(c.id) as any;
  const bindingNode = extractBindingExprFromDeclCst(cst, c.name);
  const bindingText = bindingNode ? stripAnnotation(bindingNode.text ?? "").trim() : "";
  if (bindingText && bindingText !== "break") {
    const res = evalExprStr(bindingText);
    if (res) return res;
  }
  return null;
}

export function lookupDbConstant(
  fullName: string,
  db: QueryDB,
  rawScopeId?: SymbolId,
): { value: any; isInteger: boolean; isBoolean?: boolean } | null {
  const scopeSym = rawScopeId !== undefined ? db.symbol(rawScopeId) : undefined;
  const scopeId =
    scopeSym?.kind === "Component" && scopeSym.parentId !== null && scopeSym.parentId !== undefined
      ? scopeSym.parentId
      : rawScopeId;
  const rawFullName = fullName.trim();
  let cache = (db as any)._dbConstantCache as
    | Map<string, { value: any; isInteger: boolean; isBoolean?: boolean } | null>
    | undefined;
  if (!cache) {
    cache = new Map();
    (db as any)._dbConstantCache = cache;
  }
  const cacheKey = `${scopeId ?? 0}:${rawFullName}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }
  cache.set(cacheKey, null);

  const compute = (): { value: any; isInteger: boolean; isBoolean?: boolean } | null => {
    const subMatch = parseTrailingSingleIntSubscript(rawFullName);
    if (subMatch) {
      const arrRes = lookupDbConstant(subMatch.base, db, scopeId);
      if (arrRes && Array.isArray(arrRes.value)) {
        const idx = subMatch.index;
        if (idx >= 1 && idx <= arrRes.value.length) {
          return {
            value: arrRes.value[idx - 1],
            isInteger: arrRes.isInteger,
            ...(arrRes.isBoolean ? { isBoolean: true } : {}),
          };
        }
      }
    }
    const hasLeadingDot = rawFullName.startsWith(".");
    const cleanFullName = hasLeadingDot ? rawFullName.slice(1) : rawFullName;
    if (cleanFullName === "ModelicaServices.Machine.eps") {
      return { value: MODELICA_EPS, isInteger: false };
    }
    if (cleanFullName === "ModelicaServices.Machine.small") {
      return { value: MODELICA_SMALL, isInteger: false };
    }
    const parseModValText = (
      valTextRaw: string,
      forceIsInt?: boolean,
    ): { value: any; isInteger: boolean; isBoolean?: boolean } | null => {
      const valText = valTextRaw.trim();
      if (valText === "true") return { value: 1, isInteger: true, isBoolean: true };
      if (valText === "false") return { value: 0, isInteger: true, isBoolean: true };
      if (valText.startsWith('"') && valText.endsWith('"') && !valText.slice(1, -1).includes('"')) {
        return { value: valText.slice(1, -1), isInteger: false };
      }
      const num = parseFloat(valText);
      if (!isNaN(num) && isSignedAsciiNumberText(valText)) {
        return {
          value: num,
          isInteger: forceIsInt !== undefined ? forceIsInt : Number.isInteger(num) && !valText.includes("."),
        };
      }
      return null;
    };
    if (scopeId && !hasLeadingDot) {
      const parts = cleanFullName.split(".");
      const checkArgsList = (currArgsInit: any[]): { value: number | number[]; isInteger: boolean } | null => {
        let currArgs = currArgsInit;
        let matchedArg: any = null;
        for (let i = 0; i < parts.length; i++) {
          const bIdx = parts[i]!.indexOf("[");
          const seg = bIdx >= 0 ? parts[i]!.slice(0, bIdx) : parts[i]!;
          matchedArg = [...currArgs].reverse().find((a: any) => a && !a.isBreak && a.name === seg);
          if (!matchedArg) break;
          if (i < parts.length - 1) {
            if (matchedArg.redeclaredTypeSpecifier) {
              const nextName = [matchedArg.redeclaredTypeSpecifier, ...parts.slice(i + 1)].join(".");
              if (nextName !== cleanFullName) {
                const res =
                  lookupDbConstant(nextName, db, scopeId) ??
                  (matchedArg.evaluationScopeId && matchedArg.evaluationScopeId !== scopeId
                    ? lookupDbConstant(nextName, db, matchedArg.evaluationScopeId)
                    : null);
                if (res) return res;
              }
            }
            currArgs = matchedArg.nestedArgs ?? matchedArg.args ?? [];
          }
        }
        if (matchedArg) {
          const valObj = matchedArg.value ?? matchedArg.bindingExpression;
          const valText = typeof valObj === "string" ? valObj : (valObj?.text ?? String(valObj?.value ?? ""));
          const parsed = parseModValText(valText);
          if (parsed) return parsed;
        }
        return null;
      };
      const selfMod = db.query<any>("effectiveModification", scopeId);
      if (selfMod?.args) {
        const res = checkArgsList(selfMod.args);
        if (res) return res;
      }
      const children = db.childrenOf(scopeId) || [];
      for (const child of children) {
        if (child.kind !== "Extends") continue;
        const extModRaw = db.query<any>("extendsModificationParsed", child.id);
        const currArgs: any[] = Array.isArray(extModRaw) ? extModRaw : (extModRaw?.args ?? []);
        const res = checkArgsList(currArgs);
        if (res) return res;
      }
    }
    const parts = cleanFullName.split(".");
    if (parts.length === 0) return null;
    if (scopeId && parts.length === 1) {
      const targetName = hasLeadingDot ? rawFullName : cleanFullName;
      const resolver = db.query<any>("resolveName", scopeId) ?? db.query<any>("resolveSimpleName", scopeId);
      if (resolver) {
        const resolved = resolver(targetName);
        if (resolved && resolved.kind === "Component") {
          return extractDbConstantValue(resolved, db, scopeId);
        }
      }
      const extQueue: SymbolId[] = [scopeId];
      const seenExtBases = new Set<SymbolId>();
      while (extQueue.length > 0) {
        const curClsId = extQueue.shift()!;
        if (seenExtBases.has(curClsId)) continue;
        seenExtBases.add(curClsId);
        const directComp = db.childrenOf(curClsId).find((c) => c.kind === "Component" && c.name === targetName);
        if (directComp) {
          const res = extractDbConstantValue(directComp, db, scopeId);
          if (res) return res;
        }
        const baseRes = db.query<any>("resolveName", curClsId)?.(targetName);
        if (baseRes && baseRes.kind === "Component") {
          const res = extractDbConstantValue(baseRes, db, scopeId);
          if (res) return res;
        }
        const nextBase = db.query<SymbolEntry | null>("resolvedBaseClass", curClsId);
        if (nextBase && !seenExtBases.has(nextBase.id)) {
          extQueue.push(nextBase.id);
        }
        for (const ch of db.childrenOf(curClsId) || []) {
          if (ch.kind === "Extends") {
            const b = db.query<SymbolEntry | null>("resolvedBaseClass", ch.id);
            if (b && !seenExtBases.has(b.id)) {
              extQueue.push(b.id);
            }
          }
        }
      }
      const scopeResId = db.symbol(scopeId)?.resourceId;
      const candidates = db.byName(parts[0]!);
      for (const c of candidates) {
        if (c.kind === "Component" && c.resourceId === scopeResId) {
          const res = extractDbConstantValue(c, db);
          if (res) return res;
        }
      }
      return null;
    }
    if (parts.length >= 2) {
      const resolveThroughComponent = (
        compSym: SymbolEntry,
        startIdx = 1,
      ): { value: any; isInteger: boolean; isBoolean?: boolean } | null => {
        const compMod =
          db.query<any>("effectiveModification", compSym.id) ??
          db.query<any>("componentInstance", compSym.id)?.modification;
        const bindText = compMod?.bindingExpression?.text?.trim();
        if (bindText && isDottedIdentifierChain(stripLeadingDot(bindText)) && startIdx < parts.length) {
          const restPath = parts.slice(startIdx).join(".");
          const chainedRes = lookupDbConstant(`${bindText}.${restPath}`, db, compSym.parentId ?? scopeId);
          if (chainedRes) return chainedRes;
        }
        let currArgs: any[] = compMod?.args ? [...compMod.args] : [];
        let currComp: SymbolEntry | null = compSym;
        let currClassId: SymbolId | null = null;
        const resolveCompClassId = (cSym: SymbolEntry): SymbolId | null => {
          const ci = db.query<SymbolId | null>("classInstance", cSym.id);
          if (ci) return ci;
          const tSpec = db.query<string | null>("typeSpecifier", cSym.id);
          if (tSpec && cSym.parentId !== null) {
            const r =
              db.query<any>("resolveName", cSym.parentId)?.(tSpec) ??
              db.query<any>("resolveSimpleName", cSym.parentId)?.(tSpec);
            if (r && (r.kind === "Class" || r.kind === "Package")) return r.id;
          }
          return null;
        };
        currClassId = resolveCompClassId(compSym);
        for (let i = startIdx; i < parts.length; i++) {
          const bIdx = parts[i]!.indexOf("[");
          const seg = bIdx >= 0 ? parts[i]!.slice(0, bIdx) : parts[i]!;
          const matchedArg = currArgs.find((a: any) => a && !a.isBreak && a.name === seg);
          let memberSym: SymbolEntry | null = null;
          if (currClassId) {
            memberSym =
              db.query<any>("resolveSimpleName", currClassId)?.(seg) ??
              db.childrenOf(currClassId).find((c) => c.name === seg) ??
              null;
          }
          if (i === parts.length - 1) {
            if (matchedArg) {
              const valObj = matchedArg.value ?? matchedArg.bindingExpression;
              const valText = typeof valObj === "string" ? valObj : (valObj?.text ?? String(valObj?.value ?? ""));
              const memberTypeSpec = memberSym ? db.query<string | null>("typeSpecifier", memberSym.id) : null;
              const forceInt = memberTypeSpec
                ? isIntegerTypeSpec(memberTypeSpec, db, undefined, memberSym?.parentId ?? undefined)
                : undefined;
              const parsed = parseModValText(valText, forceInt);
              if (parsed) return parsed;
            }
            if (memberSym && memberSym.kind === "Component") {
              const res = extractDbConstantValue(memberSym, db, currClassId ?? undefined);
              if (res) return res;
            }
            return null;
          }
          if (matchedArg?.isRedeclaration && matchedArg.redeclaredTypeSpecifier) {
            const evalScope = matchedArg.evaluationScopeId ?? compSym.parentId ?? scopeId;
            const redeclTarget: SymbolEntry | null =
              (evalScope ? db.query<any>("resolveName", evalScope)?.(matchedArg.redeclaredTypeSpecifier) : null) ??
              db
                .byName(matchedArg.redeclaredTypeSpecifier.split(".").pop()!)
                .find((e) => e.kind === "Class" || e.kind === "Package") ??
              null;
            if (redeclTarget) {
              return lookupDbConstant(parts.slice(i + 1).join("."), db, redeclTarget.id);
            }
          }
          currArgs = matchedArg ? (matchedArg.nestedArgs ?? matchedArg.args ?? []) : [];
          if (memberSym && memberSym.kind === "Component") {
            currComp = memberSym;
            currClassId = resolveCompClassId(currComp);
          } else if (memberSym && (memberSym.kind === "Class" || memberSym.kind === "Package")) {
            currClassId = memberSym.id;
          } else {
            return null;
          }
        }
        return null;
      };
      const roots: SymbolEntry[] = [];
      if (scopeId) {
        const resolver = db.query<any>("resolveName", scopeId) ?? db.query<any>("resolveSimpleName", scopeId);
        const firstResolved = resolver?.(hasLeadingDot ? `.${parts[0]!}` : parts[0]!);
        if (firstResolved) {
          if (firstResolved.kind === "Component") {
            const compRes = resolveThroughComponent(firstResolved);
            if (compRes) return compRes;
          } else {
            roots.push(firstResolved);
          }
        }
      }
      for (const r of db.byName(parts[0]!)) {
        if (!roots.some((x) => x.id === r.id)) {
          roots.push(r);
        }
      }
      for (const root of roots) {
        if (root.kind === "Component") continue;
        if (hasLeadingDot && root.parentId !== null) continue;
        let currList: SymbolEntry[] = [root];
        let lastClassId: SymbolId | undefined = root.id;
        for (let i = 1; i < parts.length; i++) {
          const seg = parts[i]!;
          const nextList: SymbolEntry[] = [];
          for (const p of currList) {
            if (p.kind === "Component") {
              const compRes = resolveThroughComponent(p, i);
              if (compRes) return compRes;
              continue;
            }
            if (p.kind === "Class" || p.kind === "Package") {
              lastClassId = p.id;
            }
            for (const ch of db.childrenOf(p.id)) {
              if (ch.name === seg) {
                nextList.push(ch);
              }
            }
            if (nextList.length === 0) {
              const baseQueue: SymbolId[] = [];
              const seenBases = new Set<SymbolId>([p.id]);
              const directBase = db.query<SymbolEntry | null>("resolvedBaseClass", p.id);
              if (directBase && !seenBases.has(directBase.id)) baseQueue.push(directBase.id);
              for (const ch of db.childrenOf(p.id)) {
                if (ch.kind === "Extends") {
                  const extBase = db.query<SymbolEntry | null>("resolvedBaseClass", ch.id);
                  if (extBase && !seenBases.has(extBase.id)) baseQueue.push(extBase.id);
                }
              }
              while (baseQueue.length > 0 && nextList.length === 0) {
                const bid = baseQueue.shift()!;
                if (seenBases.has(bid)) continue;
                seenBases.add(bid);
                for (const ch of db.childrenOf(bid)) {
                  if (ch.name === seg) {
                    nextList.push(ch);
                  }
                }
                if (nextList.length === 0) {
                  const nextBase = db.query<SymbolEntry | null>("resolvedBaseClass", bid);
                  if (nextBase && !seenBases.has(nextBase.id)) baseQueue.push(nextBase.id);
                  for (const ch of db.childrenOf(bid)) {
                    if (ch.kind === "Extends") {
                      const extBase = db.query<SymbolEntry | null>("resolvedBaseClass", ch.id);
                      if (extBase && !seenBases.has(extBase.id)) baseQueue.push(extBase.id);
                    }
                  }
                }
              }
            }
          }
          currList = nextList;
          if (currList.length === 0) break;
        }
        for (const c of currList) {
          if (c.kind === "Component") {
            const res = extractDbConstantValue(c, db, lastClassId);
            if (res) return res;
          }
        }
      }
      return null;
    }
    const leafName = parts[parts.length - 1]!;
    const candidates = db.byName(leafName);
    for (const c of candidates) {
      if (c.kind === "Component") {
        if (hasLeadingDot && c.parentId !== null) continue;
        const res = extractDbConstantValue(c, db);
        if (res) return res;
      }
    }
    return null;
  };

  const result = compute();
  cache.set(cacheKey, result);
  return result;
}

export function getCompDeclSubEnumInfo(
  compSym: SymbolEntry,
  dimIdx: number,
  classId: SymbolId,
  db: QueryDB,
): { sym: SymbolEntry; literals: string[]; qual: string } | null {
  let cache = (compSym as any)._cachedDeclSubEnumInfo as
    | ({ sym: SymbolEntry; literals: string[]; qual: string } | null)[]
    | undefined;
  if (!cache) {
    cache = [];
    const cst = db.cstNode(compSym.id) as any;
    if (cst) {
      const findArraySubscripts = (n: any): any => {
        if (!n) return null;
        if (n.type === "array_subscripts") return n;
        for (const ch of n.children || []) {
          const res = findArraySubscripts(ch);
          if (res) return res;
        }
        return null;
      };
      const arrSubsNode = findArraySubscripts(cst);
      const declSubs = arrSubsNode?.children?.filter((c: any) => c.type === "subscript") ?? [];
      for (const ds of declSubs) {
        const dimSubText = ds.text?.trim() ?? "";
        if (!dimSubText || dimSubText === ":" || isAsciiDigitsOnly(dimSubText)) {
          cache.push(null);
        } else {
          cache.push(resolveEnumType(dimSubText, classId, db));
        }
      }
    }
    (compSym as any)._cachedDeclSubEnumInfo = cache;
  }
  return dimIdx < cache.length ? (cache[dimIdx] ?? null) : null;
}

export function getDaeDimSize(prefix: string, partIdent: string, dimIdx: number, dae: DAEBuilder, db?: any): number {
  const fullIdent = prefix ? `${prefix}.${partIdent}` : partIdent;
  const namedShape = getNamedArrayShape(dae, fullIdent) ?? getNamedArrayShape(dae, partIdent);
  if (namedShape && dimIdx >= 0 && dimIdx < namedShape.length && namedShape[dimIdx]! > 0) {
    return namedShape[dimIdx]!;
  }
  const directVarIdx =
    dae.lookupVariable(fullIdent) >= 0 ? dae.lookupVariable(fullIdent) : dae.lookupVariable(partIdent);
  if (directVarIdx >= 0) {
    const varShape = dae.getVarShape(directVarIdx);
    if (varShape && dimIdx >= 0 && dimIdx < varShape.length && varShape[dimIdx]! > 0) {
      return varShape[dimIdx]!;
    }
  }
  const hasFullFast = dae.getArrayElementIndices(fullIdent).length > 0;
  const matchedFastPrefix = hasFullFast ? fullIdent : partIdent;
  const fastIndices = hasFullFast ? dae.getArrayElementIndices(fullIdent) : dae.getArrayElementIndices(partIdent);
  if (fastIndices.length > 0) {
    let fastMax = 0;
    for (const vIdx of fastIndices) {
      if (dae.isVarRemoved(vIdx)) continue;
      const vn = dae.getVarName(vIdx);
      const b1 = vn.indexOf("[", matchedFastPrefix.length);
      const b2 = vn.indexOf("]", b1);
      if (b1 >= 0 && b2 > b1) {
        const idxList = vn.slice(b1 + 1, b2).split(",");
        if (dimIdx >= 0 && dimIdx < idxList.length) {
          const val = parseInt(idxList[dimIdx]!.trim(), 10);
          if (!isNaN(val) && val > fastMax) fastMax = val;
        }
      }
    }
    if (fastMax > 0) return fastMax;
  }
  let maxDim = 0;
  const target = `${partIdent}[`;
  const fullTarget = prefix ? `${prefix}.${partIdent}[` : target;
  for (let i = 0; i < dae.varCount; i++) {
    if (!dae.isVarRemoved(i)) {
      const vn = dae.getVarName(i);
      let pos = -1;
      if (vn.startsWith(fullTarget)) {
        pos = fullTarget.length - target.length;
      } else if (!prefix && vn.startsWith(target)) {
        pos = 0;
      } else if (prefix) {
        let p = prefix;
        while (p.includes(".")) {
          p = p.split(".").slice(0, -1).join(".");
          const ancestorTarget = `${p}.${partIdent}[`;
          if (vn.startsWith(ancestorTarget)) {
            pos = ancestorTarget.length - target.length;
            break;
          }
        }
        if (pos < 0 && vn.startsWith(target)) {
          pos = 0;
        }
      }
      if (pos >= 0) {
        const rest = vn.slice(pos + target.length);
        const endB = rest.indexOf("]");
        if (endB >= 0) {
          const idxList = rest.slice(0, endB).split(",");
          if (dimIdx >= 0 && dimIdx < idxList.length) {
            const val = parseInt(idxList[dimIdx]!.trim(), 10);
            if (!isNaN(val) && val > maxDim) {
              maxDim = val;
            }
          }
        }
      }
    }
  }
  if (maxDim > 0) return maxDim;
  let matchingCount = 0;
  for (let i = 0; i < dae.varCount; i++) {
    if (!dae.isVarRemoved(i)) {
      const vn = dae.getVarName(i);
      if (vn.startsWith(fullTarget) || (!prefix && vn.startsWith(target))) matchingCount++;
    }
  }
  if (matchingCount > 0) return matchingCount;
  if (db) {
    if (partIdent.startsWith(".")) partIdent = partIdent.slice(1);
    const cleanIdent = partIdent;
    const leafIdent = cleanIdent.includes(".") ? cleanIdent.split(".").pop()! : cleanIdent;
    const syms = db.byName(leafIdent);
    for (const s of syms) {
      const qName = getSymbolQualifiedName(db, s.id);
      if (qName === cleanIdent || s.name === cleanIdent || qName.endsWith(`.${cleanIdent}`)) {
        const dims = db.query("arrayDimensions", s.id);
        if (dims && dims.length > dimIdx) {
          const d = dims[dimIdx];
          if (typeof d === "number") return d;
          if (d?.kind === "literal" && typeof d.value === "number") return d.value;
        }
      }
    }
  }
  return 0;
}

export function getEnumLiteralIndex(text: string, db: any): number | null {
  const parts = text.split(".");
  const litName = parts.pop()!;
  const typeName = parts.length > 0 ? parts.pop()! : null;
  const candidateSyms = typeName
    ? db.byName(typeName)
    : db
        .byName(litName)
        .map((s: any) => (s.parentId !== null && s.parentId !== undefined ? db.symbol(s.parentId) : null))
        .filter((s: any) => s && s.kind === "Class");
  for (const s of candidateSyms as any[]) {
    const lits = extractEnumLiteralsFromCst(db.cstNode(s.id) as any, s.metadata);
    if (lits) {
      const idx = lits.indexOf(litName);
      if (idx >= 0) return idx + 1;
    }
  }
  return null;
}

export function getDaeArrayDimCount(prefix: string, partIdent: string, dae: DAEBuilder, db?: any): number | null {
  const resolved = resolveScopedName(partIdent, prefix, dae);
  const namedShape = getNamedArrayShape(dae, resolved) ?? getNamedArrayShape(dae, partIdent);
  if (namedShape && namedShape.length > 0) {
    return namedShape.length;
  }
  const elemIndices = dae.getArrayElementIndices(resolved);
  if (elemIndices.length > 0) {
    const vn = dae.getVarName(elemIndices[0]!);
    const b1 = vn.indexOf("[");
    const b2 = vn.indexOf("]");
    if (b1 >= 0 && b2 > b1) {
      return vn.slice(b1 + 1, b2).split(",").length;
    }
  }
  const elemIndicesUnscoped = dae.getArrayElementIndices(partIdent);
  if (elemIndicesUnscoped.length > 0) {
    const vn = dae.getVarName(elemIndicesUnscoped[0]!);
    const b1 = vn.indexOf("[");
    const b2 = vn.indexOf("]");
    if (b1 >= 0 && b2 > b1) {
      return vn.slice(b1 + 1, b2).split(",").length;
    }
  }
  const varIdx = dae.getVarIdxByName(resolved) >= 0 ? dae.getVarIdxByName(resolved) : dae.getVarIdxByName(partIdent);
  if (varIdx >= 0) {
    const shape = dae.getVarShape(varIdx);
    if (shape && shape.length > 0) {
      return shape.length;
    }
    const shapeExprs = dae.getVarShapeExprs(varIdx);
    if (shapeExprs && shapeExprs.length > 0) {
      return shapeExprs.length;
    }
    return 0;
  }
  if (db) {
    if (partIdent.includes(".")) {
      const dotIdx = partIdent.indexOf(".");
      const basePart = partIdent.slice(0, dotIdx);
      const restPart = partIdent.slice(dotIdx + 1);
      const baseResolved = prefix ? `${prefix}.${basePart}` : basePart;
      const baseVarIdx =
        dae.getVarIdxByName(baseResolved) >= 0 ? dae.getVarIdxByName(baseResolved) : dae.getVarIdxByName(basePart);
      if (baseVarIdx >= 0) {
        const cType = dae.getVarCustomType(baseVarIdx);
        if (cType) {
          const recLeaf = cType.split(".").pop()!;
          const recSym =
            db.byName(recLeaf).find((s: any) => s.kind === "Class" && getSymbolQualifiedName(db, s.id) === cType) ??
            db.byName(recLeaf).find((s: any) => s.kind === "Class");
          if (recSym) {
            const fieldSym = db.childrenOf(recSym.id).find((c: any) => c.name === restPart && c.kind === "Component");
            if (fieldSym) {
              const dims = db.query("arrayDimensions", fieldSym.id);
              if (dims && Array.isArray(dims) && dims.length > 0) {
                return dims.length;
              }
              return 0;
            }
          }
        }
      }
    }
    const syms = db.byName(partIdent);
    for (const s of syms) {
      if (s.kind === "Component") {
        const dims = db.query("arrayDimensions", s.id);
        if (dims && Array.isArray(dims) && dims.length > 0) {
          return dims.length;
        }
      }
    }
    if (syms.some((s: any) => s.kind === "Component")) {
      return 0;
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
          shapeExprs.some((se: any) =>
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

export function isInsideForIndex(node: SyntaxNode | null | undefined): boolean {
  let curr = node?.parent;
  while (curr) {
    if (curr.type === "for_index") return true;
    if (
      curr.type === "for_statement" ||
      curr.type === "for_equation" ||
      curr.type === "class_definition" ||
      curr.type === "statement" ||
      curr.type === "simple_equation" ||
      curr.type === "connect_equation" ||
      curr.type === "if_equation" ||
      curr.type === "when_equation"
    ) {
      break;
    }
    curr = curr.parent;
  }
  return false;
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

/** Checks whether `s` matches a signed decimal/scientific number literal without regexes. */
export function isSignedAsciiNumberText(s: string): boolean {
  const n = s.length;
  if (n === 0) return false;
  let i = 0;
  if (s[i] === "+" || s[i] === "-") i++;
  if (i >= n) return false;
  let intDigits = 0;
  while (i < n && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) {
    intDigits++;
    i++;
  }
  let fracDigits = 0;
  if (i < n && s[i] === ".") {
    i++;
    while (i < n && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) {
      fracDigits++;
      i++;
    }
  }
  if (intDigits === 0 && fracDigits === 0) return false;
  if (i < n && (s[i] === "e" || s[i] === "E")) {
    i++;
    if (i < n && (s[i] === "+" || s[i] === "-")) i++;
    let expDigits = 0;
    while (i < n && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) {
      expDigits++;
      i++;
    }
    if (expDigits === 0) return false;
  }
  return i === n;
}

/** Strips a single leading dot from a Modelica qualified name if present. */
export function stripLeadingDot(s: string): string {
  return s.startsWith(".") ? s.slice(1) : s;
}

/** Strips all leading dots from a Modelica path if present. */
export function stripLeadingDots(s: string): string {
  let i = 0;
  while (i < s.length && s[i] === ".") i++;
  return i > 0 ? s.slice(i) : s;
}

/** Strips a single leading and/or trailing `'` from a quoted Modelica operator/identifier. */
export function stripOuterSingleQuotes(s: string): string {
  let res = s;
  if (res.startsWith("'")) res = res.slice(1);
  if (res.endsWith("'")) res = res.slice(0, -1);
  return res;
}

/** Strips a single leading and/or trailing `"` from a string token. */
export function stripOuterDoubleQuotes(s: string): string {
  let res = s;
  if (res.startsWith('"')) res = res.slice(1);
  if (res.endsWith('"')) res = res.slice(0, -1);
  return res;
}

/** Strips a trailing `[...]` suffix from a component name if present (equivalent to `/\[.*\]$/`). */
export function stripTrailingArraySubscripts(s: string): string {
  if (!s.endsWith("]")) return s;
  const idx = s.indexOf("[");
  return idx >= 0 ? s.slice(0, idx) : s;
}

/** Extracts each flat `[...]` subscript substring (without nested brackets inside) in left-to-right order. */
export function extractBracketSubscripts(s: string): string[] {
  const out: string[] = [];
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "[") {
      start = i + 1;
    } else if (ch === "]" && start >= 0) {
      out.push(s.slice(start, i));
      start = -1;
    }
  }
  return out;
}

/**
 * Parses a scalarized DAE variable name of the form `base[i1, i2, ...]` where `base` has no brackets
 * and the subscript contains only decimal digits, commas, and whitespace.
 */
export function parseTrailingNumericSubscripts(s: string): { base: string; indices: number[] } | null {
  const openIdx = s.indexOf("[");
  if (openIdx <= 0 || !s.endsWith("]")) return null;
  const base = s.slice(0, openIdx);
  if (base.includes("]")) return null;
  const inner = s.slice(openIdx + 1, -1);
  if (inner.length === 0) return null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    const code = ch.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isSpace = ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\v" || ch === "\f";
    if (!isDigit && ch !== "," && !isSpace) return null;
  }
  const indices = inner.split(",").map((part) => Number.parseInt(part.trim(), 10));
  return { base, indices };
}

/**
 * Validates that a runtime component path string matches `[A-Za-z_]\w*(?:\s*\[[^\]]*\]|\.[A-Za-z_]\w*)*`.
 */
export function isValidDottedComponentPath(pathStr: string): boolean {
  const len = pathStr.length;
  if (len === 0 || !isAsciiIdentStart(pathStr.charCodeAt(0))) return false;
  let i = 1;
  while (i < len && isAsciiIdentContinue(pathStr.charCodeAt(i))) i++;
  while (i < len) {
    const ch = pathStr[i]!;
    if (ch === ".") {
      i++;
      if (i >= len || !isAsciiIdentStart(pathStr.charCodeAt(i))) return false;
      i++;
      while (i < len && isAsciiIdentContinue(pathStr.charCodeAt(i))) i++;
      continue;
    }
    let j = i;
    while (j < len) {
      const ws = pathStr[j]!;
      if (ws === " " || ws === "\t" || ws === "\n" || ws === "\r" || ws === "\v" || ws === "\f") {
        j++;
      } else {
        break;
      }
    }
    if (j >= len || pathStr[j] !== "[") return false;
    const closeIdx = pathStr.indexOf("]", j + 1);
    if (closeIdx < 0) return false;
    i = closeIdx + 1;
  }
  return true;
}

/** Checks iteratively whether a CST node or any descendant has a given node `type`. */
export function cstContainsNodeType(node: SyntaxNode | null | undefined, targetType: string): boolean {
  if (!node) return false;
  const stack: SyntaxNode[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.type === targetType) return true;
    const count = cur.childCount;
    for (let i = count - 1; i >= 0; i--) {
      const ch = cur.child(i);
      if (ch) stack.push(ch);
    }
  }
  return false;
}

/** Checks whether a CST subtree contains any syntax error or missing node. */
export function cstHasError(node: SyntaxNode | null | undefined): boolean {
  if (!node) return true;
  if (typeof node.hasError === "boolean") return node.hasError;
  const stack: SyntaxNode[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.type === "ERROR" || cur.isMissing) return true;
    const count = cur.childCount;
    for (let i = count - 1; i >= 0; i--) {
      const ch = cur.child(i);
      if (ch) stack.push(ch);
    }
  }
  return false;
}

/**
 * Unwraps single-child expression wrappers and parenthesized `( expr )` primary nodes down to the
 * inner core CST expression node.
 */
export function unwrapParenExprCst(node: SyntaxNode | null | undefined): SyntaxNode | null {
  let cur: SyntaxNode | null | undefined = node;
  while (cur) {
    if (cur.childCount === 3 && cur.child(0)?.text === "(" && cur.child(2)?.text === ")") {
      cur = cur.child(1);
      continue;
    }
    if (
      cur.childCount === 1 &&
      cur.type !== "component_reference" &&
      cur.type !== "identifier" &&
      cur.type !== "unsigned_integer" &&
      cur.type !== "unsigned_real" &&
      cur.type !== "string_literal"
    ) {
      cur = cur.child(0);
      continue;
    }
    break;
  }
  return cur ?? null;
}

/** Extracts the first declared component identifier name directly from a `component_clause` CST node. */
export function extractComponentNameFromClauseCst(compClauseNode: SyntaxNode | null | undefined): string | null {
  if (!compClauseNode) return null;
  const compList =
    Cst.ComponentClause.componentList(compClauseNode) ??
    compClauseNode.children.find((c) => c.type === "component_list") ??
    null;
  const compDecl =
    (compList ? Cst.ComponentList.componentDeclaration(compList) : null) ??
    compList?.children.find((c) => c.type === "component_declaration") ??
    compClauseNode.children.find((c) => c.type === "component_declaration") ??
    null;
  const decl =
    (compDecl ? Cst.ComponentDeclaration.declaration(compDecl) : null) ??
    compDecl?.children.find((c) => c.type === "declaration") ??
    null;
  const ident =
    (decl ? Cst.Declaration.name(decl) : null) ??
    decl?.childForFieldName("name") ??
    decl?.children.find((c) => c.type === "identifier") ??
    null;
  const text = ident?.text?.trim();
  return text || null;
}

/** Extracts top-level argument expression CST nodes from a Modelica call `primary` or `function_call_args`. */
export function extractFunctionCallArgExprNodesCst(callNode: SyntaxNode | null | undefined): SyntaxNode[] {
  if (!callNode) return [];
  const argsNode =
    callNode.type === "function_call_args"
      ? callNode
      : (callNode.childForFieldName("args") ?? callNode.children.find((c) => c.type === "function_call_args") ?? null);
  if (!argsNode) return [];
  const out: SyntaxNode[] = [];
  const collectArgList = (listNode: SyntaxNode | null | undefined): void => {
    if (!listNode) return;
    for (const ch of listNode.children) {
      if (ch.type === "function_argument") {
        const expr = ch.children.find((gc) => gc.type === "expression") ?? ch.child(0);
        if (expr) out.push(expr);
      } else if (ch.type === "named_argument") {
        const val = ch.childForFieldName("value") ?? ch.children.find((gc) => gc.type === "function_argument");
        const expr = val?.children.find((gc) => gc.type === "expression") ?? val?.child(0) ?? val;
        if (expr) out.push(expr);
      } else if (
        ch.type === "function_arguments" ||
        ch.type === "function_arguments_non_first" ||
        ch.type === "named_arguments"
      ) {
        collectArgList(ch);
      }
    }
  };
  const fnArgs = argsNode.children.find((c) => c.type === "function_arguments");
  if (fnArgs) collectArgList(fnArgs);
  return out;
}

const STANDALONE_EXPR_CACHE_LIMIT = 512;
const standaloneExprCstCache = new Map<string, { tree: unknown; node: SyntaxNode | null }>();

/**
 * Parses a standalone Modelica expression string with the native WASM GLR parser (caching up to 512
 * parsed expressions with their backing `Tree`). Returns `null` if no parser is registered or if the
 * expression fails to parse cleanly.
 */
export function parseStandaloneExpressionCst(exprText: string): SyntaxNode | null {
  const trimmed = exprText.trim();
  if (!trimmed) return null;
  const cached = standaloneExprCstCache.get(trimmed);
  if (cached !== undefined) return cached.node;
  const parser = UnifiedWorkspace.getGlobalParser(".mo");
  if (!parser) return null;
  try {
    const prefix = "model _Tmp equation _x = ";
    const suffix = "; end _Tmp;";
    const tree = parser.parse(`${prefix}${trimmed}${suffix}`);
    if (!tree?.rootNode || cstHasError(tree.rootNode)) {
      if (standaloneExprCstCache.size >= STANDALONE_EXPR_CACHE_LIMIT) standaloneExprCstCache.clear();
      standaloneExprCstCache.set(trimmed, { tree, node: null });
      return null;
    }
    const findRhs = (n: SyntaxNode): SyntaxNode | null => {
      if (n.type === "simple_equation") {
        return n.children.find((c) => c.type === "expression") ?? null;
      }
      for (const ch of n.children) {
        const res = findRhs(ch);
        if (res) return res;
      }
      return null;
    };
    const rhs = findRhs(tree.rootNode);
    const valid =
      rhs && rhs.startOffset === prefix.length && rhs.endOffset <= prefix.length + trimmed.length ? rhs : null;
    if (standaloneExprCstCache.size >= STANDALONE_EXPR_CACHE_LIMIT) standaloneExprCstCache.clear();
    standaloneExprCstCache.set(trimmed, { tree, node: valid });
    return valid;
  } catch {
    return null;
  }
}

/** Evaluates a binary Modelica numeric/relational/logical operator over two numeric values (`true=1, false=0`). */
export function evalBinaryNumericOp(op: string, left: number, right: number, integerDivision = false): number | null {
  switch (op) {
    case "+":
    case ".+":
      return left + right;
    case "-":
    case ".-":
      return left - right;
    case "*":
    case ".*":
      return left * right;
    case "/":
    case "./":
      if (right === 0) return null;
      return integerDivision ? Math.floor(left / right) : left / right;
    case "^":
    case ".^":
      return Math.pow(left, right);
    case ">":
      return left > right ? 1 : 0;
    case ">=":
      return left >= right ? 1 : 0;
    case "<":
      return left < right ? 1 : 0;
    case "<=":
      return left <= right ? 1 : 0;
    case "==":
      return left === right ? 1 : 0;
    case "<>":
      return left !== right ? 1 : 0;
    case "and":
      return left !== 0 && right !== 0 ? 1 : 0;
    case "or":
      return left !== 0 || right !== 0 ? 1 : 0;
    default:
      return null;
  }
}

/** Checks whether `s` is a non-empty dot-separated chain of ASCII identifiers (`A(.B)*`). */
export function isDottedIdentifierChain(s: string): boolean {
  if (!s) return false;
  const parts = s.split(".");
  for (const part of parts) {
    if (!isAsciiIdentifier(part)) return false;
  }
  return true;
}

/** Extracts all trailing balanced `[...]` bracket groups from the end of `s` (e.g., `a[1][2]` -> `[1][2]`). */
export function extractTrailingBrackets(s: string): string {
  let tailStart = s.length;
  while (tailStart > 0 && s[tailStart - 1] === "]") {
    const open = s.lastIndexOf("[", tailStart - 1);
    if (open === -1) break;
    tailStart = open;
  }
  return s.slice(tailStart);
}

/** Parses `base[N]` with a single non-empty unsigned integer subscript at the end of `s`. */
export function parseTrailingSingleIntSubscript(s: string): { base: string; index: number } | null {
  if (!s.endsWith("]")) return null;
  const open = s.lastIndexOf("[");
  if (open <= 0) return null;
  const base = s.slice(0, open);
  if (base.includes("\n") || base.includes("\r")) return null;
  const inner = s.slice(open + 1, -1);
  if (!isAsciiDigitsOnly(inner)) return null;
  return { base, index: Number.parseInt(inner, 10) };
}

const KNOWN_MATH_PKG_PREFIXES = [
  "Modelica.Math.",
  "Math.",
  "Modelica.SIunits.Conversions.",
  "SIunits.Conversions.",
  "Modelica.Units.Conversions.",
  "Units.Conversions.",
  "Cv.",
  "Conversions.",
];

/** Strips a known Modelica math or unit conversion package qualifier from `ident`. */
export function stripMathPackagePrefix(ident: string): string {
  for (const prefix of KNOWN_MATH_PKG_PREFIXES) {
    if (ident.startsWith(prefix)) return ident.slice(prefix.length);
  }
  return ident;
}

/** Returns the length of an unsigned decimal/scientific number starting at `start` in `s`, or `0`. */
export function readUnsignedNumberLength(s: string, start: number): number {
  const n = s.length;
  let i = start;
  let intDigits = 0;
  while (i < n && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) {
    intDigits++;
    i++;
  }
  let fracDigits = 0;
  if (i < n && s[i] === ".") {
    i++;
    while (i < n && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) {
      fracDigits++;
      i++;
    }
  }
  if (intDigits === 0 && fracDigits === 0) return 0;
  if (i < n && (s[i] === "e" || s[i] === "E")) {
    const expMarker = i;
    i++;
    if (i < n && (s[i] === "+" || s[i] === "-")) i++;
    let expDigits = 0;
    while (i < n && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) {
      expDigits++;
      i++;
    }
    if (expDigits === 0) i = expMarker;
  }
  return i - start;
}

/** Evaluates Modelica scalar integer/real builtin functions over pre-evaluated numeric arguments. */
export function evalScalarBuiltinCall(fnName: string, args: number[]): number | null {
  if (args.length === 1) {
    const a0 = args[0]!;
    switch (fnName) {
      case "abs":
        return Math.abs(a0);
      case "ceil":
        return Math.ceil(a0);
      case "floor":
      case "integer":
        return Math.floor(a0);
      case "sign":
        return Math.sign(a0);
    }
  } else if (args.length === 2) {
    const a0 = args[0]!;
    const a1 = args[1]!;
    switch (fnName) {
      case "min":
        return Math.min(a0, a1);
      case "max":
        return Math.max(a0, a1);
      case "div":
        return a1 !== 0 ? Math.trunc(a0 / a1) : null;
      case "mod":
        return a1 !== 0 ? a0 - Math.floor(a0 / a1) * a1 : null;
      case "rem":
        return a1 !== 0 ? a0 % a1 : null;
    }
  }
  return null;
}

function getBindingExprFromModificationCst(modNode: SyntaxNode | null | undefined): SyntaxNode | null {
  if (!modNode || modNode.type !== "modification") return null;
  const modExpr =
    modNode.childForFieldName("modification_expression") ??
    modNode.children.find((c) => c.type === "modification_expression") ??
    null;
  if (!modExpr) return null;
  return modExpr.children.find((c) => c.type === "expression") ?? modExpr;
}

/** Extracts the `modification_expression` (`= expr`) CST node from a declaration or component clause CST node. */
export function extractBindingExprFromDeclCst(
  declOrCompNode: SyntaxNode | null | undefined,
  compName?: string,
): SyntaxNode | null {
  if (!declOrCompNode) return null;
  const findInDecl = (declNode: SyntaxNode): SyntaxNode | null => {
    if (compName) {
      const nameNode = declNode.childForFieldName("name") ?? declNode.children.find((c) => c.type === "identifier");
      if (nameNode && nameNode.text.trim() !== compName) return null;
    }
    const modNode =
      declNode.childForFieldName("modification") ?? declNode.children.find((c) => c.type === "modification");
    return getBindingExprFromModificationCst(modNode);
  };
  if (declOrCompNode.type === "declaration") return findInDecl(declOrCompNode);
  if (declOrCompNode.type === "component_declaration") {
    const decl =
      declOrCompNode.childForFieldName("declaration") ?? declOrCompNode.children.find((c) => c.type === "declaration");
    return decl ? findInDecl(decl) : null;
  }
  const stack: SyntaxNode[] = [declOrCompNode];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.type === "declaration") {
      const found = findInDecl(cur);
      if (found) return found;
      continue;
    }
    for (let i = cur.childCount - 1; i >= 0; i--) {
      const ch = cur.child(i);
      if (ch) stack.push(ch);
    }
  }
  return null;
}

/** Extracts the `= expr` CST binding for argument `argName` inside a `class_modification` / `short_class_specifier`. */
export function extractModArgBindingExprCst(
  ownerOrShortSpecNode: SyntaxNode | null | undefined,
  argName: string,
): SyntaxNode | null {
  if (!ownerOrShortSpecNode || !argName) return null;
  const classMod =
    ownerOrShortSpecNode.type === "class_modification"
      ? ownerOrShortSpecNode
      : (ownerOrShortSpecNode.childForFieldName("class_modification") ??
        ownerOrShortSpecNode.children.find((c) => c.type === "class_modification") ??
        null);
  if (!classMod) return null;
  const stack: SyntaxNode[] = [classMod];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.type === "element_modification") {
      const nameNode = cur.childForFieldName("name") ?? cur.children.find((c) => c.type === "name");
      if (nameNode?.text?.trim() === argName) {
        const modNode = cur.childForFieldName("modification") ?? cur.children.find((c) => c.type === "modification");
        const expr = getBindingExprFromModificationCst(modNode);
        if (expr) return expr;
      }
      continue;
    }
    for (let i = cur.childCount - 1; i >= 0; i--) {
      const ch = cur.child(i);
      if (ch) stack.push(ch);
    }
  }
  return null;
}

/** Checks whether `s` is an optional sign followed by one or more ASCII decimal digits. */
export function isSignedAsciiIntText(s: string, allowPlus = true): boolean {
  if (!s) return false;
  let start = 0;
  if (s[0] === "-" || (allowPlus && s[0] === "+")) start = 1;
  return start < s.length && isAsciiDigitsOnly(s.slice(start));
}

/** Removes all ASCII whitespace characters from `s`. */
export function stripAsciiWhitespace(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (!isAsciiWhitespaceCode(s.charCodeAt(i))) {
      out += s[i];
    }
  }
  return out;
}

/** Strips Modelica comments and splits remaining tokens by ASCII whitespace. */
export function tokenizeCommentStrippedWords(s: string): string[] {
  const collapsed = collapseAsciiWhitespace(stripComments(s));
  return collapsed ? collapsed.split(" ") : [];
}

/**
 * Extracts referenced root variable identifiers from an expression CST node,
 * ignoring dotted field qualifiers and string literals, and optionally skipping `size(...)`.
 */
export function collectReferencedRootIdentsFromExprCst(
  exprCst: SyntaxNode | null | undefined,
  options?: { skipSizeCalls?: boolean },
): string[] {
  if (!exprCst) return [];
  const skipSizeCalls = options?.skipSizeCalls ?? false;
  const result: string[] = [];
  const stack: SyntaxNode[] = [exprCst];

  while (stack.length > 0) {
    const cur = stack.pop()!;
    const t = cur.type;

    if (t === "string_literal" || t === "STRING" || t === "comment" || t === "line_comment" || t === "block_comment") {
      continue;
    }

    if (skipSizeCalls && t === "function_call") {
      const callee = cur.childForFieldName("function") ?? cur.children[0];
      if (callee?.text?.trim() === "size") {
        continue;
      }
    }

    if (t === "component_reference") {
      let baseIdent: string | null = null;
      for (let i = 0; i < cur.childCount; i++) {
        const ch = cur.child(i);
        if (!ch) continue;
        if (!baseIdent && ch.type === "identifier") {
          baseIdent = ch.text.trim();
        } else if (ch.type === "array_subscripts") {
          stack.push(ch);
        }
      }
      if (!baseIdent) {
        const raw = stripLeadingDot(cur.text.trim());
        let end = 0;
        if (raw.length > 0 && isAsciiIdentStart(raw.charCodeAt(0))) {
          end = 1;
          while (end < raw.length && isAsciiIdentContinue(raw.charCodeAt(end))) end++;
          baseIdent = raw.slice(0, end);
        }
      }
      if (baseIdent) result.push(baseIdent);
      continue;
    }

    if (t === "identifier" || (cur.childCount === 0 && isAsciiIdentifier(cur.text))) {
      const idText = cur.text.trim();
      if (idText) result.push(idText);
      continue;
    }

    for (let i = cur.childCount - 1; i >= 0; i--) {
      const ch = cur.child(i);
      if (ch) stack.push(ch);
    }
  }

  return result;
}

/** Trims `s`, removes a single leading `=`, and trims again. */
export function stripLeadingEquals(s: string): string {
  const t = s.trim();
  return t.startsWith("=") ? t.slice(1).trim() : t;
}

/** Removes a single leading `-` and any immediately following whitespace. */
export function stripLeadingMinusWs(s: string): string {
  return s.startsWith("-") ? s.slice(1).trimStart() : s;
}

/** Inserts a single space after commas followed immediately by non-whitespace. */
export function spaceAfterCommas(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    out += ch;
    if (ch === "," && i + 1 < s.length && !isAsciiWhitespaceCode(s.charCodeAt(i + 1))) {
      out += " ";
    }
  }
  return out;
}

/** Extracts whole ASCII identifiers (or dotted chains when `includeDots` is true) from `s`. */
export function extractAsciiIdentifiers(s: string, includeDots = false): string[] {
  const out: string[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (isAsciiIdentStart(c)) {
      const start = i++;
      while (i < n && isAsciiIdentContinue(s.charCodeAt(i))) i++;
      if (includeDots) {
        while (i + 1 < n && s[i] === "." && isAsciiIdentStart(s.charCodeAt(i + 1))) {
          i++;
          while (i < n && isAsciiIdentContinue(s.charCodeAt(i))) i++;
        }
      }
      out.push(s.slice(start, i));
    } else if (c >= 48 && c <= 57) {
      i++;
      while (i < n && isAsciiIdentContinue(s.charCodeAt(i))) i++;
    } else {
      i++;
    }
  }
  return out;
}

/** Counts whole-word occurrences of `target` outside string literals and Modelica comments. */
export function countWordOccurrencesOutsideStrings(text: string, target: string, stopAfterOne = false): number {
  if (!text || !target) return 0;
  const n = text.length;
  const tLen = target.length;
  let count = 0;
  let i = 0;
  while (i < n) {
    const ch = text[i]!;
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i + 2);
      i = nl === -1 ? n : nl + 1;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else if (ch === '"') {
      i++;
      while (i < n) {
        if (text[i] === "\\") i += 2;
        else if (text[i] === '"') {
          i++;
          break;
        } else {
          i++;
        }
      }
    } else if (
      text.startsWith(target, i) &&
      (i === 0 || !isAsciiIdentContinue(text.charCodeAt(i - 1))) &&
      (i + tLen === n || !isAsciiIdentContinue(text.charCodeAt(i + tLen)))
    ) {
      count++;
      if (stopAfterOne) return 1;
      i += tLen;
    } else {
      i++;
    }
  }
  return count;
}

/** Returns true if `target` appears as a whole word/dotted-token outside string literals and comments. */
export function containsWholeWordOutsideStrings(text: string, target: string): boolean {
  return countWordOccurrencesOutsideStrings(text, target, true) > 0;
}

/** Replaces whole-word occurrences of `word` outside string literals and comments. */
export function replaceWordOutsideStrings(
  text: string,
  word: string,
  replacement: string,
  skipDottedAccess = true,
): string {
  if (!text || !word) return text;
  const n = text.length;
  const wLen = word.length;
  let out = "";
  let i = 0;
  while (i < n) {
    const ch = text[i]!;
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i + 2);
      const end = nl === -1 ? n : nl + 1;
      out += text.slice(i, end);
      i = end;
    } else if (ch === "/" && text[i + 1] === "*") {
      const endIdx = text.indexOf("*/", i + 2);
      const end = endIdx === -1 ? n : endIdx + 2;
      out += text.slice(i, end);
      i = end;
    } else if (ch === '"') {
      const start = i++;
      while (i < n) {
        if (text[i] === "\\") i += 2;
        else if (text[i] === '"') {
          i++;
          break;
        } else {
          i++;
        }
      }
      out += text.slice(start, i);
    } else if (
      text.startsWith(word, i) &&
      (i === 0 || !isAsciiIdentContinue(text.charCodeAt(i - 1))) &&
      (i + wLen === n || !isAsciiIdentContinue(text.charCodeAt(i + wLen))) &&
      !(skipDottedAccess && i > 0 && text[i - 1] === ".")
    ) {
      out += replacement;
      i += wLen;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Parses a call expression `<callee>(<args>)` whose outer `(` closes at the end of trimmed `s`. */
export function parseNamedCallArgsFromText(s: string): { callee: string; argsText: string } | null {
  const t = s.trim();
  if (!t.endsWith(")")) return null;
  let i = 0;
  while (i < t.length) {
    const ch = t[i]!;
    const code = t.charCodeAt(i);
    if (isAsciiIdentContinue(code) || ch === "." || ch === "$") {
      i++;
    } else {
      break;
    }
  }
  if (i === 0) return null;
  const callee = t.slice(0, i);
  let j = i;
  while (j < t.length && isAsciiWhitespaceCode(t.charCodeAt(j))) j++;
  if (j >= t.length || t[j] !== "(") return null;
  let depth = 0;
  let inStr = false;
  for (let k = j; k < t.length; k++) {
    const ch = t[k]!;
    if (inStr) {
      if (ch === "\\") k++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        if (k !== t.length - 1) return null;
        return { callee, argsText: t.slice(j + 1, k) };
      }
    }
  }
  return null;
}

/** Parses `size(<ident>, <digits>)` into `{ target, dim, dimStr }`, or returns null. */
export function parseSizeCallIdentDim(s: string): { target: string; dim: number; dimStr: string } | null {
  const call = parseNamedCallArgsFromText(s);
  if (!call || call.callee !== "size") return null;
  const commaIdx = call.argsText.indexOf(",");
  if (commaIdx < 0 || call.argsText.indexOf(",", commaIdx + 1) >= 0) return null;
  const target = call.argsText.slice(0, commaIdx).trim();
  const dimStr = call.argsText.slice(commaIdx + 1).trim();
  if (!isAsciiIdentifier(target) || !isAsciiDigitsOnly(dimStr)) return null;
  return { target, dim: Number(dimStr), dimStr };
}

/** Parses a named call/modification argument `name = expr` (rejecting `==`). */
export function parseNamedArgAssignment(s: string): { name: string; valueText: string } | null {
  const t = s.trim();
  if (t.length === 0 || !isAsciiIdentStart(t.charCodeAt(0))) return null;
  let i = 1;
  while (i < t.length && isAsciiIdentContinue(t.charCodeAt(i))) i++;
  const name = t.slice(0, i);
  while (i < t.length && isAsciiWhitespaceCode(t.charCodeAt(i))) i++;
  if (i >= t.length || t[i] !== "=" || t[i + 1] === "=") return null;
  const valueText = t.slice(i + 1);
  if (valueText.length === 0) return null;
  return { name, valueText };
}

/** Checks `ident([subscripts])(.ident([subscripts]))*` with either numeric comma lists or arbitrary non-empty subscripts. */
export function isDottedComponentRefWithSubscripts(s: string, numericOnlySubscripts = true): boolean {
  const len = s.length;
  if (len === 0 || !isAsciiIdentStart(s.charCodeAt(0))) return false;
  let i = 1;
  while (i < len && isAsciiIdentContinue(s.charCodeAt(i))) i++;
  while (i < len) {
    if (s[i] === "[") {
      const closeIdx = s.indexOf("]", i + 1);
      if (closeIdx <= i + 1) return false;
      const inner = s.slice(i + 1, closeIdx);
      if (numericOnlySubscripts) {
        const parts = inner.split(",");
        for (const p of parts) {
          if (!isAsciiDigitsOnly(p)) return false;
        }
      }
      i = closeIdx + 1;
      if (i >= len) return true;
    }
    if (s[i] !== ".") return false;
    i++;
    if (i >= len || !isAsciiIdentStart(s.charCodeAt(i))) return false;
    i++;
    while (i < len && isAsciiIdentContinue(s.charCodeAt(i))) i++;
  }
  return true;
}

/** Parses `<ident> [ <subscript> ]` at the full-string level. */
export function parseIdentSubscriptText(s: string): { base: string; subscript: string } | null {
  if (s.length === 0 || !isAsciiIdentStart(s.charCodeAt(0)) || !s.endsWith("]")) return null;
  let i = 1;
  while (i < s.length && isAsciiIdentContinue(s.charCodeAt(i))) i++;
  const base = s.slice(0, i);
  while (i < s.length && isAsciiWhitespaceCode(s.charCodeAt(i))) i++;
  if (i >= s.length || s[i] !== "[") return null;
  const inner = s.slice(i + 1, -1);
  if (inner.includes("]")) return null;
  return { base, subscript: inner };
}

/** Returns leading identifier before a dot (`foo.bar` -> `foo`), or null. */
export function leadingIdentifierBeforeDot(s: string): string | null {
  const dotIdx = s.indexOf(".");
  if (dotIdx <= 0) return null;
  const head = s.slice(0, dotIdx);
  return isAsciiIdentifier(head) ? head : null;
}

/** Returns the first `[ident]` identifier inside `s`, or null. */
export function firstBracketedIdentifier(s: string): string | null {
  let pos = 0;
  while (pos < s.length) {
    const open = s.indexOf("[", pos);
    if (open < 0) return null;
    const close = s.indexOf("]", open + 1);
    if (close < 0) return null;
    const inner = s.slice(open + 1, close);
    if (isAsciiIdentifier(inner)) return inner;
    pos = open + 1;
  }
  return null;
}

/** Returns true if `s` contains `[:]` or `[:,:]` with optional whitespace inside brackets. */
export function hasColonSubscript(s: string, allowMultiDim = false): boolean {
  let pos = 0;
  while (pos < s.length) {
    const open = s.indexOf("[", pos);
    if (open < 0) return false;
    const close = s.indexOf("]", open + 1);
    if (close > open) {
      const inner = s.slice(open + 1, close);
      const parts = allowMultiDim ? inner.split(",") : [inner];
      if (parts.length > 0 && parts.every((p) => p.trim() === ":")) return true;
    }
    pos = open + 1;
  }
  return false;
}

/** Parses `<dottedIdentA> - <dottedIdentB>` into `[a, b]`, or returns null. */
export function parseBinaryIdentSubtraction(s: string): [string, string] | null {
  const minusIdx = s.indexOf("-");
  if (minusIdx <= 0) return null;
  if (s.indexOf("-", minusIdx + 1) >= 0) return null;
  const lhs = s.slice(0, minusIdx).trim();
  const rhs = s.slice(minusIdx + 1).trim();
  if (!isDottedIdentifierChain(lhs) || !isDottedIdentifierChain(rhs)) return null;
  return [lhs, rhs];
}

/** Splits `s` on `{`, `}`, and `,`, trims tokens, and omits empty entries. */
export function splitBraceCommasAndTrim(s: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i <= s.length; i++) {
    const ch = i < s.length ? s[i] : ",";
    if (ch === "{" || ch === "}" || ch === ",") {
      const tok = s.slice(start, i).trim();
      if (tok) out.push(tok);
      start = i + 1;
    }
  }
  return out;
}

/** Returns true if trimmed `s` starts with an optional sign and `digits.digits`. */
export function startsWithSignedDecimalFloat(s: string): boolean {
  let i = 0;
  if (s[i] === "+" || s[i] === "-") i++;
  let intDigits = 0;
  while (i < s.length && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) {
    intDigits++;
    i++;
  }
  if (intDigits === 0 || i >= s.length || s[i] !== ".") return false;
  i++;
  return i < s.length && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57;
}

/** Extracts call target names (`ident` or `pkg.fn`) from Modelica CST or expression text outside strings/comments. */
export function extractCallTargetsFromExpr(text: string, cst?: SyntaxNode | null, requireDot = false): string[] {
  const out: string[] = [];
  if (cst) {
    const stack: SyntaxNode[] = [cst];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const t = cur.type;
      if (
        t === "string_literal" ||
        t === "STRING" ||
        t === "comment" ||
        t === "line_comment" ||
        t === "block_comment"
      ) {
        continue;
      }
      if (t === "function_call" || (t === "primary" && cur.children.some((c) => c.type === "function_call_args"))) {
        const calleeNode =
          cur.childForFieldName?.("function") ??
          cur.children.find((c) => c.type === "component_reference" || c.type === "name" || c.type === "identifier") ??
          cur.children[0];
        const rawCallee = calleeNode?.text?.trim() ?? "";
        const cleanCallee = stripLeadingDot(rawCallee);
        if (cleanCallee && (!requireDot || cleanCallee.includes(".")) && isDottedIdentifierChain(cleanCallee)) {
          out.push(cleanCallee);
        }
      }
      for (let i = cur.childCount - 1; i >= 0; i--) {
        const ch = cur.child(i);
        if (ch) stack.push(ch);
      }
    }
    if (out.length > 0) return out;
  }

  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i + 2);
      i = nl === -1 ? n : nl + 1;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else if (ch === '"') {
      i++;
      while (i < n) {
        if (text[i] === "\\") i += 2;
        else if (text[i] === '"') {
          i++;
          break;
        } else {
          i++;
        }
      }
    } else if (isAsciiIdentStart(text.charCodeAt(i)) && (i === 0 || !isAsciiIdentContinue(text.charCodeAt(i - 1)))) {
      const start = i++;
      while (i < n && isAsciiIdentContinue(text.charCodeAt(i))) i++;
      while (i + 1 < n && text[i] === "." && isAsciiIdentStart(text.charCodeAt(i + 1))) {
        i++;
        while (i < n && isAsciiIdentContinue(text.charCodeAt(i))) i++;
      }
      const cand = text.slice(start, i);
      let j = i;
      while (j < n && isAsciiWhitespaceCode(text.charCodeAt(j))) j++;
      if (j < n && text[j] === "(" && (!requireDot || cand.includes("."))) {
        out.push(cand);
      }
    } else if (text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) {
      i++;
      while (i < n && isAsciiIdentContinue(text.charCodeAt(i))) i++;
    } else {
      i++;
    }
  }
  return out;
}

/** Checks via CST (or token fallback) whether `classCst` has an enumeration short-class specifier. */
export function isEnumClassDefCst(cstNode: SyntaxNode | null | undefined): boolean {
  if (!cstNode) return false;
  const shortSpec = getShortClassSpecifierNode(cstNode);
  if (shortSpec) {
    if (Cst.ShortClassSpecifier.enumList(shortSpec)) return true;
    for (const c of shortSpec.children || []) {
      if (c.text === "enumeration" || c.type === "enum_list") return true;
    }
  }
  const clean = collapseAsciiWhitespace(stripComments(cstNode.text ?? ""));
  const eqIdx = clean.indexOf("=");
  if (eqIdx > 0) {
    const rhs = clean.slice(eqIdx + 1).trimStart();
    if (rhs.startsWith("enumeration")) {
      const after = rhs.slice("enumeration".length).trimStart();
      if (after.startsWith("(")) return true;
    }
  }
  return false;
}

/** Collects header keyword tokens (`partial`, `type`, `model`, `record`, `block`, `connector`, `package`, `function`) from a class CST node. */
export function hasClassHeaderKeywordCst(cstNode: SyntaxNode | null | undefined, keyword: string): boolean {
  if (!cstNode) return false;
  if (cstNode.type === "class_definition") {
    for (const c of cstNode.children || []) {
      if (c.type === "class_specifier") break;
      if (c.text === keyword) return true;
      if (c.type === "class_prefixes" || c.type === "class_prefix") {
        for (const sub of c.children || []) {
          if (sub.text === keyword) return true;
        }
        const words = tokenizeCommentStrippedWords(c.text ?? "");
        if (words.includes(keyword)) return true;
      }
    }
    return false;
  }
  const words = tokenizeCommentStrippedWords(cstNode.text ?? "");
  for (const w of words) {
    if (w === keyword) return true;
    if (w === "=" || w === ";") break;
  }
  return false;
}

/** Checks whether `classCst` contains an equation-section assignment involving whole identifier `name = ...`. */
export function hasEquationAssignmentForNameCst(classCst: SyntaxNode | null | undefined, name: string): boolean {
  if (!classCst || !name) return false;
  const stack: SyntaxNode[] = [classCst];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.type === "equation_section" || cur.type === "initial_equation_section") {
      const innerStack: SyntaxNode[] = [cur];
      while (innerStack.length > 0) {
        const node = innerStack.pop()!;
        if (node.type === "simple_equation") {
          const lhs = node.child(0);
          if (lhs && containsWholeWordOutsideStrings(lhs.text ?? "", name)) {
            return true;
          }
          continue;
        }
        for (let i = node.childCount - 1; i >= 0; i--) {
          const ch = node.child(i);
          if (ch) innerStack.push(ch);
        }
      }
      continue;
    }
    for (let i = cur.childCount - 1; i >= 0; i--) {
      const ch = cur.child(i);
      if (ch) stack.push(ch);
    }
  }
  return false;
}

/**
 * Expands Modelica `Text(textString=...)` dynamic macros (`%%`, `%name`, `%class`, `%comment`, `%{expr}`, `%ident`)
 * in a single left-to-right pass without intermediate placeholders or regular expressions.
 */
export function expandModelicaTextMacros(
  rawText: string,
  nameText: string,
  classText: string,
  commentText: string,
  evaluateExpr: (expr: string) => string,
): string {
  let out = "";
  let i = 0;
  const n = rawText.length;
  while (i < n) {
    const ch = rawText[i]!;
    if (ch !== "%" || i + 1 >= n) {
      out += ch;
      i++;
      continue;
    }
    const next = rawText[i + 1]!;
    if (next === "%") {
      out += "%";
      i += 2;
      continue;
    }
    if (next === "{") {
      const closeIdx = rawText.indexOf("}", i + 2);
      if (closeIdx >= 0) {
        out += evaluateExpr(rawText.slice(i + 2, closeIdx));
        i = closeIdx + 1;
        continue;
      }
    }
    if (isAsciiIdentContinue(rawText.charCodeAt(i + 1))) {
      let end = i + 2;
      while (end < n && isAsciiIdentContinue(rawText.charCodeAt(end))) end++;
      const ident = rawText.slice(i + 1, end);
      if (ident === "name") out += nameText;
      else if (ident === "class") out += classText;
      else if (ident === "comment") out += commentText;
      else out += evaluateExpr(ident);
      i = end;
      continue;
    }
    out += "%";
    i++;
  }
  return out;
}
