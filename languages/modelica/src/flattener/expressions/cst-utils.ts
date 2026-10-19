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
  Variability,
  VarType,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../src-gen/bindings.js";
import { getShortClassSpecifierNode } from "../../queries.js";
import { getFlatteningState, getNamedArrayShape } from "../support/state.js";
import {
  castToRealExpr,
  evalDaeExpr,
  findIfElseExpr,
  inferArenaExprShapeAndType,
  parseArrayLiteralElements,
} from "./eval.js";
import { getSymbolQualifiedName } from "./functions.js";

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

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export function extractEnumLiteralsFromCst(cstNode: any, targetMeta?: any): string[] | null {
  if (Array.isArray(targetMeta?.literals) && targetMeta.literals.length > 0) {
    return targetMeta.literals;
  }
  const shortSpec = getShortClassSpecifierNode(cstNode);
  const enumListNode = shortSpec ? Cst.ShortClassSpecifier.enumList(shortSpec) : null;
  if (enumListNode) {
    const lits: string[] = [];
    for (const c of enumListNode.children || []) {
      if (c.type === "enumeration_literal" || Cst.EnumerationLiteral.is(c)) {
        const litText = c.text?.trim()?.split(/\s+/)[0];
        if (litText) lits.push(litText);
      }
    }
    if (lits.length > 0) return lits;
  }
  const cstText = cstNode?.text ?? "";
  const enumMatch = /enumeration\s*\(([^)]+)\)/.exec(cstText);
  if (enumMatch) {
    return enumMatch[1]!
      .split(",")
      .map((x: string) => x.trim().split(/\s+/)[0]!)
      .filter(Boolean);
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
    const op = (n.child(1)?.text?.trim() ?? n.child(1)?.type ?? "").replace(/^"|"$/g, "");
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
  const cleanName = typeName.replace(/^\.+/, "").trim();
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
        let t = (item.text?.trim() ?? "").replace(/^\.+/, "");
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
    let startText = (colonNodes[0].text?.trim() ?? "").replace(/^\.+/, "");
    let stopText = (colonNodes[colonNodes.length - 1].text?.trim() ?? "").replace(/^\.+/, "");
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
  let typeText = (rangeNode.text?.trim() ?? "").replace(/^\.+/, "");
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

export function evalArithmeticString(expr: string, allowFloat = false): number | null {
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
      if (pos >= len || expr.charCodeAt(pos) !== 40) return null;
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
  let s = str.trim();
  if (subs && subs.size > 0) {
    s = s.replace(/\b[a-zA-Z_]\w*\b/g, (id) => {
      const v = subs.get(id);
      return v !== undefined ? String(v) : id;
    });
  }
  return evalArithmeticString(s, allowFloat);
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

  const text = (typeof node === "string" ? node : node.text)?.replace(/\s*\bannotation\b[\s\S]*$/, "")?.trim() ?? "";
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
  if (!isNaN(floatNum) && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return floatNum;

  const evalCycleKey = `${scopeId ?? 0}:${prefix}:${text}`;
  if (_evaluatingCSTNumbers.has(evalCycleKey)) return null;
  _evaluatingCSTNumbers.add(evalCycleKey);
  try {
    return evaluateCSTNumberInner(node, text, subs, scopeId, db, dae, prefix);
  } finally {
    _evaluatingCSTNumbers.delete(evalCycleKey);
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
  if (text.startsWith("if ")) {
    const normalizedIf = text.replace(/\belseif\b/g, "else if");
    const ifMatch = normalizedIf.match(/^if\s+(.+?)\s+then\s+(.+?)\s+else\s+([\s\S]+)$/);
    if (ifMatch) {
      const condVal = evaluateCSTNumber(ifMatch[1]!.trim(), subs, scopeId, db, dae, prefix);
      if (condVal !== null) {
        return evaluateCSTNumber(
          condVal !== 0 ? ifMatch[2]!.trim() : ifMatch[3]!.trim(),
          subs,
          scopeId,
          db,
          dae,
          prefix,
        );
      }
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
    const cleanB = rawBText
      .replace(/\s*\bannotation\b[\s\S]*$/, "")
      .replace(/^=/, "")
      .trim();
    if (dim === 1 && cleanB.startsWith("{") && cleanB.endsWith("}")) {
      const inner = cleanB.slice(1, -1).trim();
      return inner === "" ? 0 : parseArrayLiteralElements(cleanB).length;
    }
    const fillMatch = cleanB.match(/^fill\s*\(([\s\S]+)\)$/);
    if (fillMatch) {
      const fillArgs = parseArrayLiteralElements(`{${fillMatch[1]!}}`);
      if (fillArgs.length >= 1 + dim) {
        return evaluateCSTNumber(fillArgs[dim]!.trim(), subs, evalSid, db, dae, prefix);
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
          }
          const startAttrExpr = dae.getVarAttrExprId?.(vIdx, "start");
          if (startAttrExpr !== undefined && startAttrExpr >= 0) {
            const val = evalDaeExpr(startAttrExpr, dae);
            if (typeof val === "number" && !isNaN(val)) return val;
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
              const bStr = mod.bindingExpression.text.replace(/\s*\bannotation\b[\s\S]*$/, "").trim();
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

  const sizeMatch = text.match(/^size\(\s*([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*(?:,\s*(\d+))?\s*\)$/);
  if (sizeMatch) {
    const arrName = sizeMatch[1]!;
    const dim = sizeMatch[2] ? parseInt(sizeMatch[2], 10) : 1;
    const sizeVal = resolveSizeCall(arrName, dim);
    if (sizeVal !== null) return sizeVal;
  }

  const minMaxMatch = text.match(/^(min|max)\s*\(\s*[[{]?\s*([^()[{}]+?)\s*[\]}]?\s*\)$/);
  if (minMaxMatch) {
    const fn = minMaxMatch[1]!;
    const argsList = minMaxMatch[2]!.split(",").map((s) => s.trim());
    const argVals: number[] = [];
    for (const argStr of argsList) {
      const av = evaluateCSTNumber(argStr, subs, scopeId, db, dae, prefix);
      if (av === null) {
        argVals.length = 0;
        break;
      }
      argVals.push(av);
    }
    if (argVals.length > 0) {
      return fn === "min" ? Math.min(...argVals) : Math.max(...argVals);
    }
  }

  // Binary expression
  if (typeof node !== "string" && node.childCount === 3 && node.type === "expression") {
    const op = (node.child(1)?.text?.trim() ?? node.child(1)?.type ?? "").replace(/^"|"$/g, "");
    const left = evaluateCSTNumber(node.child(0), subs, scopeId, db, dae, prefix);
    const right = evaluateCSTNumber(node.child(2), subs, scopeId, db, dae, prefix);
    if (left !== null && right !== null) {
      if (op === "+") return left + right;
      if (op === "-") return left - right;
      if (op === "*") return left * right;
      if (op === "/") return right !== 0 ? Math.floor(left / right) : null;
    }
  }

  // Unary expression
  if (typeof node !== "string" && node.childCount === 2 && node.type === "expression") {
    const op = (node.child(0)?.text?.trim() ?? "").replace(/^"|"$/g, "");
    const val = evaluateCSTNumber(node.child(1), subs, scopeId, db, dae, prefix);
    if (val !== null) {
      if (op === "-") return -val;
      if (op === "+") return val;
    }
  }

  const directIdentVal = resolveIdentConstant(text, true);
  if (directIdentVal !== null) return directIdentVal;

  if (/[+\-*/]/.test(text)) {
    let exprStr = text;
    exprStr = exprStr.replace(
      /size\(\s*([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*,\s*(\d+)\s*\)/g,
      (full, arrName, dimStr) => {
        const dim = parseInt(dimStr, 10);
        const sizeVal = resolveSizeCall(arrName, dim);
        return sizeVal !== null ? String(sizeVal) : full;
      },
    );

    exprStr = exprStr.replace(/\b([a-zA-Z_]\w*)\b/g, (match) => {
      const identVal = resolveIdentConstant(match, false);
      return identVal !== null ? String(identVal) : match;
    });

    const arithVal = evalArithmeticText(exprStr);
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
    const baseCand = candidate.replace(/\[[^\]]*\]/g, "");
    if (baseCand !== candidate && state.outerToInner.has(baseCand)) {
      const isStateOut = !state.isInsidePrevious && state.stateOutputVars?.has(baseCand);
      if (!isStateOut) {
        const mapped = state.outerToInner.get(baseCand)!;
        const candTail = candidate.match(/(\[[^\]]*\])+$/)?.[0] ?? "";
        if (candTail && !mapped.endsWith("]")) return mapped + candTail;
        return mapped;
      }
    }
    let dot = candidate.lastIndexOf(".");
    while (dot > 0) {
      const sub = candidate.slice(0, dot);
      const baseSub = sub.replace(/\[[^\]]*\]/g, "");
      const exactMapped = state.outerToInner.get(sub);
      const baseMapped = exactMapped === undefined ? state.outerToInner.get(baseSub) : undefined;
      const mapped = exactMapped ?? baseMapped;
      if (mapped) {
        const isStateOut =
          !state.isInsidePrevious && (state.stateOutputVars?.has(sub) || state.stateOutputVars?.has(baseSub));
        if (!isStateOut) {
          const subTail = exactMapped === undefined ? (sub.match(/(\[[^\]]*\])+$/)?.[0] ?? "") : "";
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
          const baseP = p.replace(/\[[^\]]+\]/g, "");
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
        const cst = db.cstNode(tm.id) as any;
        const txt = cst?.text ?? "";
        if (/\b(?:extends\s+)?(?:Modelica\.Icons\.)?TypeInteger\b/.test(txt) || /\bextends\s+Integer\b/.test(txt))
          return true;
      }
    }
  }
  return false;
}

const KNOWN_MODELICA_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  "Modelica.Constants.pi": Math.PI,
  "Constants.pi": Math.PI,
  e: Math.E,
  "Modelica.Constants.e": Math.E,
  "Constants.e": Math.E,
  "Modelica.Constants.c": 299792458,
  "Constants.c": 299792458,
  g_n: 9.80665,
  "Modelica.Constants.g_n": 9.80665,
  "Constants.g_n": 9.80665,
  "Modelica.Constants.G": 6.6743e-11,
  "Constants.G": 6.6743e-11,
  "Modelica.Constants.q": 1.602176634e-19,
  "Constants.q": 1.602176634e-19,
  "Modelica.Constants.h": 6.62607015e-34,
  "Constants.h": 6.62607015e-34,
  "Modelica.Constants.k": 1.380649e-23,
  "Constants.k": 1.380649e-23,
  N_A: 6.02214076e23,
  "Modelica.Constants.N_A": 6.02214076e23,
  "Constants.N_A": 6.02214076e23,
  "Modelica.Constants.F": 1.602176634e-19 * 6.02214076e23,
  "Constants.F": 1.602176634e-19 * 6.02214076e23,
  "Modelica.Constants.R": 1.380649e-23 * 6.02214076e23,
  "Constants.R": 1.380649e-23 * 6.02214076e23,
  mu_0: 4 * Math.PI * 1.00000000055e-7,
  "Modelica.Constants.mu_0": 4 * Math.PI * 1.00000000055e-7,
  "Constants.mu_0": 4 * Math.PI * 1.00000000055e-7,
  epsilon_0: 1 / (4 * Math.PI * 1.00000000055e-7 * 299792458 * 299792458),
  "Modelica.Constants.epsilon_0": 1 / (4 * Math.PI * 1.00000000055e-7 * 299792458 * 299792458),
  "Constants.epsilon_0": 1 / (4 * Math.PI * 1.00000000055e-7 * 299792458 * 299792458),
  sigma: 5.670374419e-8,
  "Modelica.Constants.sigma": 5.670374419e-8,
  "Constants.sigma": 5.670374419e-8,
  R_inf: 10973731.56816,
  "Modelica.Constants.R_inf": 10973731.56816,
  "Constants.R_inf": 10973731.56816,
  T_zero: -273.15,
  "Modelica.Constants.T_zero": -273.15,
  "Constants.T_zero": -273.15,
  eps: Number.EPSILON,
  "Modelica.Constants.eps": Number.EPSILON,
  "Constants.eps": Number.EPSILON,
  "ModelicaServices.Machine.eps": Number.EPSILON,
  small: Number.MIN_VALUE,
  "Modelica.Constants.small": Number.MIN_VALUE,
  "Constants.small": Number.MIN_VALUE,
  "ModelicaServices.Machine.small": Number.MIN_VALUE,
  inf: 1e60,
  "Modelica.Constants.inf": 1e60,
  "Constants.inf": 1e60,
  "ModelicaServices.Machine.inf": 1e60,
  Integer_inf: 2147483647,
  "Modelica.Constants.Integer_inf": 2147483647,
  "Constants.Integer_inf": 2147483647,
  "ModelicaServices.Machine.Integer_inf": 2147483647,
};

const BARE_SINGLE_LETTER_MODELICA_CONSTANTS: Record<string, number> = {
  c: 299792458,
  G: 6.6743e-11,
  q: 1.602176634e-19,
  h: 6.62607015e-34,
  k: 1.380649e-23,
  F: 1.602176634e-19 * 6.02214076e23,
  R: 1.380649e-23 * 6.02214076e23,
};

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
        const impText = (db.cstNode(ch.id) as any)?.text ?? ch.name ?? "";
        if (/\b(?:Modelica\.)?Constants\b/.test(impText)) {
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
  let pos = 0;
  const skipWs = () => {
    while (pos < s.length && /\s/.test(s[pos]!)) pos++;
  };
  const parseExpr = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;
    while (true) {
      skipWs();
      const ch = s[pos];
      if (ch === "+" || ch === "-") {
        pos++;
        const right = parseTerm();
        if (right === null) return null;
        left = ch === "+" ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  };
  const parseTerm = (): number | null => {
    let left = parsePower();
    if (left === null) return null;
    while (true) {
      skipWs();
      const ch = s[pos];
      if (ch === "*" || ch === "/") {
        pos++;
        const right = parsePower();
        if (right === null) return null;
        if (ch === "/" && right === 0) return null;
        left = ch === "*" ? left * right : left / right;
      } else {
        break;
      }
    }
    return left;
  };
  const parsePower = (): number | null => {
    const base = parseUnary();
    if (base === null) return null;
    skipWs();
    if (s[pos] === "^") {
      pos++;
      const exp = parsePower();
      if (exp === null) return null;
      return Math.pow(base, exp);
    }
    return base;
  };
  const parseUnary = (): number | null => {
    skipWs();
    if (s[pos] === "+") {
      pos++;
      return parseUnary();
    }
    if (s[pos] === "-") {
      pos++;
      const v = parseUnary();
      return v === null ? null : -v;
    }
    return parsePrimary();
  };
  const parsePrimary = (): number | null => {
    skipWs();
    if (s[pos] === "(") {
      pos++;
      const val = parseExpr();
      skipWs();
      if (s[pos] !== ")") return null;
      pos++;
      return val;
    }
    const numMatch = s.slice(pos).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (numMatch) {
      pos += numMatch[0].length;
      const n = Number(numMatch[0]);
      return Number.isNaN(n) ? null : n;
    }
    const idMatch = s.slice(pos).match(/^[a-zA-Z_][a-zA-Z0-9_.]*/);
    if (idMatch) {
      const ident = idMatch[0];
      pos += ident.length;
      skipWs();
      if (s[pos] === "(") {
        pos++;
        const arg1 = parseExpr();
        if (arg1 === null) return null;
        skipWs();
        const shortFn = ident.replace(/^(?:Modelica\.)?(?:Math|SIunits\.Conversions)\./, "");
        if (s[pos] === "," && shortFn === "atan2") {
          pos++;
          const arg2 = parseExpr();
          if (arg2 === null) return null;
          skipWs();
          if (s[pos] !== ")") return null;
          pos++;
          return Math.atan2(arg1, arg2);
        }
        if (s[pos] !== ")") return null;
        pos++;
        const fn = KNOWN_MATH_UNARY_FUNCS[shortFn];
        if (!fn) return null;
        return fn(arg1);
      }
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
  const result = parseExpr();
  skipWs();
  if (result === null || pos !== s.length || !Number.isFinite(result)) {
    return null;
  }
  return result;
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
    const str = rawStr.replace(/\s*\bannotation\b[\s\S]*$/, "").trim();
    if (!str) return null;
    if (str === "true") return { value: 1, isInteger: true, isBoolean: true };
    if (str === "false") return { value: 0, isInteger: true, isBoolean: true };
    if (str.startsWith('"') && str.endsWith('"') && !str.slice(1, -1).includes('"')) {
      return { value: str.slice(1, -1), isInteger: false };
    }
    const ifMatch = str.match(/^if\s+(.+?)\s+then\s+(.+?)\s+else\s+(.+)$/);
    if (ifMatch) {
      const condStr = ifMatch[1]!.trim();
      const thenStr = ifMatch[2]!.trim();
      const elseStr = ifMatch[3]!.trim();
      const condVal =
        condStr === "true"
          ? 1
          : condStr === "false"
            ? 0
            : (lookupDbConstant(condStr, db, evalScope)?.value ?? evalExprStr(condStr)?.value ?? null);
      if (typeof condVal === "number") {
        return evalExprStr(condVal !== 0 ? thenStr : elseStr);
      }
    }
    const sizeMatch = str.match(/^size\s*\(\s*([^,)]+)(?:\s*,\s*([^,)]+))?\s*\)$/);
    if (sizeMatch) {
      const arrRes = lookupDbConstant(sizeMatch[1]!.trim(), db, evalScope) ?? evalExprStr(sizeMatch[1]!.trim());
      if (arrRes && Array.isArray(arrRes.value)) {
        const dimRes = sizeMatch[2] ? evalExprStr(sizeMatch[2]!.trim()) : { value: 1 };
        const dimIdx = dimRes && typeof dimRes.value === "number" ? Math.round(dimRes.value) : 1;
        if (dimIdx === 1) {
          return { value: arrRes.value.length, isInteger: true };
        }
      }
    }
    const fillMatch = str.match(/^fill\s*\(\s*([^,]+)\s*,\s*([^,)]+)\s*\)$/);
    if (fillMatch) {
      const elemRes = evalExprStr(fillMatch[1]!.trim());
      const countRes = evalExprStr(fillMatch[2]!.trim());
      if (
        elemRes &&
        (typeof elemRes.value === "number" || typeof elemRes.value === "string") &&
        countRes &&
        typeof countRes.value === "number"
      ) {
        const cnt = Math.round(countRes.value);
        if (cnt >= 0 && cnt <= 1000) {
          return {
            value: Array(cnt).fill(elemRes.value),
            isInteger,
            ...(elemRes.isBoolean ? { isBoolean: true } : {}),
          };
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
    if (!isNaN(num) && /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(str)) {
      return { value: num, isInteger: isInteger && Number.isInteger(num) };
    }
    if (/^\.?[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(str)) {
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
    const specEnthMatch = str.match(
      /^(?:([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\.)?specificEnthalpy_pTX\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)$/,
    );
    if (specEnthMatch && evalScope) {
      const callPkgPrefix = specEnthMatch[1]?.trim();
      const stripNamed = (s: string) => s.replace(/^[a-zA-Z_]\w*\s*=\s*/, "").trim();
      const tArg = stripNamed(specEnthMatch[3]!);
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
        const startScopes = rawScopes.filter(
          (id, idx, arr): id is SymbolId => id !== undefined && arr.indexOf(id) === idx,
        );
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
        const primaryScope = callPkgPrefix ? mediumScopeId : (evalScope ?? mediumScopeId);
        return (
          (primaryScope ? lookupDbConstant(constName, db, primaryScope) : null) ??
          (mediumScopeId ? lookupDbConstant(constName, db, mediumScopeId) : null) ??
          lookupDbConstant(constName, db, evalScope)
        );
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
      const ownerCstText = (shortSpec?.text ?? "").replace(/\s*\bannotation\b[\s\S]*$/, "");
      const parenIdx = ownerCstText.indexOf("(");
      if (parenIdx >= 0) {
        const modSlice = ownerCstText.slice(parenIdx);
        const argMatch = modSlice.match(new RegExp(`\\b${c.name}\\s*=\\s*([^,)]+)`));
        if (argMatch) {
          const res = evalExprStr(argMatch[1]!.trim());
          if (res) return res;
        }
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
  const cstText = cst?.text ?? "";
  // Strip attributes in parentheses so min=0 inside (min=0) doesn't match the binding '='
  const strippedCstText = cstText.replace(/\s*\bannotation\b[\s\S]*$/, "").replace(/\([^)]*\)/g, " ");
  const eqMatch = strippedCstText.match(/=\s*([^;,]+)/);
  if (eqMatch) {
    const res = evalExprStr(eqMatch[1].trim());
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
    const subMatch = rawFullName.match(/^(.+)\[(\d+)\]$/);
    if (subMatch) {
      const arrRes = lookupDbConstant(subMatch[1]!, db, scopeId);
      if (arrRes && Array.isArray(arrRes.value)) {
        const idx = parseInt(subMatch[2]!, 10);
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
      if (!isNaN(num) && /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(valText)) {
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
          const seg = parts[i]!.replace(/\[.*\]$/, "");
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
      ): { value: number | number[]; isInteger: boolean } | null => {
        const compMod =
          db.query<any>("effectiveModification", compSym.id) ??
          db.query<any>("componentInstance", compSym.id)?.modification;
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
        for (let i = 1; i < parts.length; i++) {
          const seg = parts[i]!.replace(/\[.*\]$/, "");
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
            if (p.kind === "Class" || p.kind === "Package") {
              lastClassId = p.id;
            }
            for (const ch of db.childrenOf(p.id)) {
              if (ch.name === seg) {
                nextList.push(ch);
              }
            }
            if (nextList.length === 0) {
              let base = db.query<SymbolEntry | null>("resolvedBaseClass", p.id);
              const seenBases = new Set<SymbolId>([p.id]);
              while (base && !seenBases.has(base.id) && nextList.length === 0) {
                seenBases.add(base.id);
                for (const ch of db.childrenOf(base.id)) {
                  if (ch.name === seg) {
                    nextList.push(ch);
                  }
                }
                base = db.query<SymbolEntry | null>("resolvedBaseClass", base.id);
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
        if (!dimSubText || dimSubText === ":" || /^\d+$/.test(dimSubText)) {
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
  for (let i = 0; i < dae.varCount; i++) {
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
              : Boolean(se && !/^\d+$/.test(String(se).trim())),
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
