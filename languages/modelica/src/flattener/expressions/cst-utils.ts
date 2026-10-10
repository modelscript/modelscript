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
import { getFlatteningState } from "../support/state.js";
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

export function checkIfExprTypeMismatch(
  dae: DAEBuilder,
  exprId: number,
  node: SyntaxNode | null | undefined,
  compName: string,
): boolean {
  if (exprId < 0) return false;
  const ifElseId = findIfElseExpr(dae, exprId);
  if (ifElseId < 0) return false;

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
        const expectedShape = condVal ? elseInfo.shape : thenInfo.shape;
        const isShapeMismatch =
          expectedShape.length !== (condVal ? thenInfo.shape.length : elseInfo.shape.length) ||
          expectedShape.some((d, i) => d !== (condVal ? thenInfo.shape[i] : elseInfo.shape[i]));
        if (isShapeMismatch) {
          message = `Array dimension mismatch, expression ${activeStr} has type ${activeTypeStr}, expected array dimensions [${expectedShape.join(", ")}].`;
        }
      }

      const startB = targetNode?.startIndex ?? targetNode?.startByte ?? 0;
      const endB = targetNode?.endIndex ?? targetNode?.endByte ?? 0;
      dae.diagnostics.push({
        severity: "error",
        message,
        range: {
          startByte: startB,
          endByte: endB,
          startPosition: targetNode?.startPosition,
          endPosition: targetNode?.endPosition,
        },
      });
      return true;
    }
    if (dae.getExprKind(elseId) === ExprKind.IfElse) {
      return checkIfExprTypeMismatch(dae, elseId, node, compName);
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
              if (elIdx >= 0 && dst.getVarExpression(elIdx) >= 0) {
                elems.push(dst.getVarExpression(elIdx));
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
      if (srcId === 20) {
        console.log("copy srcId 20: l=", l, "kind=", dst.getExprKind(l), "r=", r, "kind=", dst.getExprKind(r));
      }
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
    probe = elems[0];
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
    return enumMatch[1]
      .split(",")
      .map((x: string) => x.trim().split(/\s+/)[0])
      .filter(Boolean);
  }
  return null;
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
    const cst = db.cstNode(cand.id) as any;
    const lits = extractEnumLiteralsFromCst(cst, cand.metadata);
    if (lits && lits.length > 0) {
      const qual = getSymbolQualifiedName(db, cand.id);
      if (cleanName.includes(".")) {
        if (!qual.endsWith(cleanName) && !cleanName.endsWith(qual)) continue;
      }
      return { sym: cand, literals: lits, qual };
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

export function evalArithmeticString(expr: string): number | null {
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
    const start = pos;
    while (pos < len) {
      const c = expr.charCodeAt(pos);
      if ((c >= 48 && c <= 57) || c === 46) {
        pos++;
      } else {
        break;
      }
    }
    if (pos === start) return null;
    const num = Number(expr.slice(start, pos));
    return isNaN(num) ? null : num;
  }

  function parseMulDiv(): number | null {
    let left = parsePrimary();
    if (left === null) return null;
    while (pos < len) {
      skipWhitespace();
      if (pos >= len) break;
      const c = expr.charCodeAt(pos);
      if (c === 42) {
        pos++;
        const right = parsePrimary();
        if (right === null) return null;
        left = left * right;
      } else if (c === 47) {
        pos++;
        const right = parsePrimary();
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
  return Math.round(res);
}

export function evalArithmeticText(str: string, subs?: Map<string, number>): number | null {
  if (!str) return null;
  let s = str.trim();
  if (subs && subs.size > 0) {
    s = s.replace(/\b[a-zA-Z_]\w*\b/g, (id) => {
      const v = subs.get(id);
      return v !== undefined ? String(v) : id;
    });
  }
  return evalArithmeticString(s);
}

export function getVarPrefixSet(dae: DAEBuilder): Set<string> {
  let set = (dae as any)._varPrefixSet as Set<string> | undefined;
  let lastCount = (dae as any)._varPrefixCount ?? 0;
  if (!set) {
    set = new Set<string>();
    (dae as any)._varPrefixSet = set;
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
    (dae as any)._varPrefixCount = currCount;
  }
  return set;
}

export function getDaeArrayDimSize(dae: DAEBuilder, arrName: string, resolvedName: string, dim: number): number | null {
  const namedShape =
    (dae as any).getNamedArrayShape?.(resolvedName) ??
    (dae as any).namedArrayShapes?.get(resolvedName) ??
    (dae as any).getNamedArrayShape?.(arrName) ??
    (dae as any).namedArrayShapes?.get(arrName);
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
    while (node.childCount === 1) {
      node = node.child(0);
    }
    if (node.childCount === 3 && Cst.kind(node.child(0)) === "(" && Cst.kind(node.child(2)) === ")") {
      return evaluateCSTNumber(node.child(1), subs, scopeId, db, dae, prefix);
    }
  }

  const text = (typeof node === "string" ? node : node.text)?.trim() ?? "";
  if (subs && subs.has(text)) return subs.get(text)!;
  const num = parseInt(text, 10);
  if (!isNaN(num) && String(num) === text) return num;
  const floatNum = parseFloat(text);
  if (!isNaN(floatNum) && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return floatNum;

  const sizeMatch = text.match(/^size\(\s*([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*,\s*(\d+)\s*\)$/);
  if (sizeMatch && dae) {
    const arrName = sizeMatch[1];
    const dim = parseInt(sizeMatch[2], 10);
    const resolvedName = resolveScopedName(arrName, prefix, dae);
    const dimSize = getDaeArrayDimSize(dae, arrName, resolvedName, dim);
    if (dimSize !== null && dimSize > 0) return dimSize;
    if (db) {
      let sym: any = null;
      if (scopeId) {
        const resolver = db.query("resolveName", scopeId) ?? db.query("resolveSimpleName", scopeId);
        if (resolver) {
          const res = resolver(arrName);
          if (res) sym = res;
        }
      }
      const syms = sym ? [sym] : db.byName(arrName);
      for (const s of syms) {
        const dims = db.query("arrayDimensions", s.id);
        if (dims && dims.length >= dim) {
          const d = dims[dim - 1];
          if (d?.kind === "literal" && typeof d.value === "number") return d.value;
        }
      }
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

  if (dae) {
    const resolved = resolveScopedName(text, prefix, dae);
    const vIdx = dae.getVarIdxByName(resolved);
    if (vIdx >= 0) {
      const v = dae.getVarVariability(vIdx);
      if (v === Variability.Constant || v === Variability.Parameter) {
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
        if (startVal !== undefined && !isNaN(startVal) && (startVal !== 0 || startAttrExpr !== undefined))
          return startVal;
      }
    }
  }

  if (scopeId !== undefined && db) {
    const resolver = db.query("resolveSimpleName", scopeId);
    if (resolver) {
      const resolved = resolver(text);
      if (resolved) {
        const mod = db.query("effectiveModification", resolved.id);
        if (mod?.bindingExpression?.text) {
          const bVal = parseInt(mod.bindingExpression.text.trim(), 10);
          if (!isNaN(bVal)) return bVal;
        }
      }
    }
  }

  if (/[+\-*/]/.test(text)) {
    let exprStr = text;
    exprStr = exprStr.replace(/size\(\s*([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*,\s*(\d+)\s*\)/g, (_, arrName, dimStr) => {
      const dim = parseInt(dimStr, 10);
      if (dae) {
        const resolvedName = resolveScopedName(arrName, prefix, dae);
        const dimSize = getDaeArrayDimSize(dae, arrName, resolvedName, dim);
        if (dimSize !== null && dimSize > 0) return String(dimSize);
      }
      if (db) {
        let sym: any = null;
        if (scopeId) {
          const resolver = db.query("resolveName", scopeId) ?? db.query("resolveSimpleName", scopeId);
          if (resolver) {
            const res = resolver(arrName);
            if (res) sym = res;
          }
        }
        const syms = sym ? [sym] : db.byName(arrName);
        for (const s of syms) {
          const dims = db.query("arrayDimensions", s.id);
          if (dims && dims.length >= dim) {
            const d = dims[dim - 1];
            if (d?.kind === "literal" && typeof d.value === "number") return String(d.value);
          }
        }
      }
      return _;
    });

    exprStr = exprStr.replace(/\b([a-zA-Z_]\w*)\b/g, (match) => {
      if (subs && subs.has(match)) return String(subs.get(match)!);
      if (dae) {
        const resolved = resolveScopedName(match, prefix, dae);
        let vIdx = dae.getVarIdxByName(resolved);
        if (vIdx < 0) vIdx = dae.getVarIdxByName(match);
        if (vIdx >= 0) {
          const bExpr = dae.getVarExpression(vIdx);
          if (bExpr !== undefined && bExpr >= 0) {
            const val = evalDaeExpr(bExpr, dae);
            if (typeof val === "number") return String(val);
          }
          const startVal = dae.getVarStartValue(vIdx);
          if (startVal !== 0) return String(startVal);
        }
      }
      if (scopeId !== undefined && db) {
        const resolver = db.query("resolveSimpleName", scopeId);
        if (resolver) {
          const resolved = resolver(match);
          if (resolved) {
            const mod = db.query("effectiveModification", resolved.id);
            if (mod?.bindingExpression?.text) {
              const bVal = parseInt(mod.bindingExpression.text.trim(), 10);
              if (!isNaN(bVal)) return String(bVal);
            }
          }
        }
      }
      return match;
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
  if (state.outerToInner) {
    if (state.outerToInner.has(name)) {
      return state.outerToInner.get(name)!;
    }
    const full = prefix ? `${prefix}.${name}` : name;
    if (state.outerToInner.has(full)) {
      return state.outerToInner.get(full)!;
    }
  }
  if (state.constantAliases?.has(name)) {
    return state.constantAliases.get(name)!;
  }
  const prefixedCandidate = prefix ? `${prefix}.${name}` : name;
  if (state.constantAliases?.has(prefixedCandidate)) {
    return state.constantAliases.get(prefixedCandidate)!;
  }
  if (!prefix) return name;
  if (name.startsWith(prefix + ".")) return name;

  let anc = prefix;
  while (anc) {
    if (name.startsWith(anc + ".")) return name;
    const dot = anc.lastIndexOf(".");
    if (dot < 0) break;
    anc = anc.slice(0, dot);
  }

  const rootComp = name.split(".")[0].split("[")[0];
  const fullLocalRoot = `${prefix}.${rootComp}`;
  const isStateOutput = Boolean(state.stateOutputVars?.has(fullLocalRoot));
  const isInnerOuter = innerOuterComponents?.has(fullLocalRoot) || (Boolean(state.isInsidePrevious) && isStateOutput);

  const scopeDeclaredNames: Map<string, Set<string>> | undefined =
    state.scopeDeclaredNames ?? (dae as any).scopeDeclaredNames;

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
            const flattener = (state as any)?.flattener ?? (dae as any).flattener;
            const db = (state as any)?.db ?? (dae as any).db ?? flattener?.db;
            const currentClassId = flattener?.currentClassId ?? (dae as any).currentClassId;
            const currentRootClassId = flattener?.currentRootClassId ?? (dae as any).currentRootClassId;
            const currentClassSym = currentClassId && db ? db.symbol(currentClassId) : null;
            const isInnerClass = Boolean(
              currentClassId &&
              currentRootClassId &&
              currentClassId !== currentRootClassId &&
              currentClassSym?.parentId &&
              db?.symbol(currentClassSym.parentId)?.kind === "Class",
            );
            if (isInnerClass) {
              if (recordDiagnostics) {
                if (!state.outerNonConstantAccess) {
                  state.outerNonConstantAccess = [];
                  (dae as any).outerNonConstantAccess = state.outerNonConstantAccess;
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
    if (parts.length >= 2 && !parts[0].includes("[")) {
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
        if (meta?.baseType === "Integer" || meta?.primitiveType === "Integer") return true;
        const cst = db.cstNode(tm.id) as any;
        const txt = cst?.text ?? "";
        if (/\b(?:extends\s+)?(?:Modelica\.Icons\.)?TypeInteger\b/.test(txt) || /\bextends\s+Integer\b/.test(txt))
          return true;
      }
    }
  }
  return false;
}

export function extractDbConstantValue(
  c: SymbolEntry,
  db: QueryDB,
): { value: number | number[]; isInteger: boolean } | null {
  const variability = db.query<string | null>("variability", c.id);
  if (variability !== "constant") {
    return null;
  }
  const typeSpec = db.query<string | null>("typeSpecifier", c.id);
  const isInteger = isIntegerTypeSpec(typeSpec, db, undefined, c.parentId ?? undefined);
  const mod = db.query<any>("effectiveModification", c.id);
  const bText = mod?.bindingExpression?.text?.trim();
  if (bText) {
    if (bText.startsWith("{") && bText.endsWith("}")) {
      const inner = bText.slice(1, -1).trim();
      const elemStrs = inner.split(",").map((s) => s.trim());
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
    }
    const num = parseFloat(bText);
    if (!isNaN(num) && /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(bText)) {
      return { value: num, isInteger: isInteger && Number.isInteger(num) };
    }
  }
  const cst = db.cstNode(c.id) as any;
  const cstText = cst?.text ?? "";
  // Strip attributes in parentheses so min=0 inside (min=0) doesn't match the binding '='
  const strippedCstText = cstText.replace(/\([^)]*\)/g, " ");
  const eqMatch = strippedCstText.match(/=\s*([^;,]+)/);
  if (eqMatch) {
    const mText = eqMatch[1].trim();
    if (mText.startsWith("{") && mText.endsWith("}")) {
      const inner = mText.slice(1, -1).trim();
      const elemStrs = inner.split(",").map((s) => s.trim());
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
    }
    const num = parseFloat(mText);
    if (!isNaN(num) && /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(mText)) {
      return { value: num, isInteger: isInteger && Number.isInteger(num) };
    }
  }
  return null;
}

export function lookupDbConstant(
  fullName: string,
  db: QueryDB,
  scopeId?: SymbolId,
): { value: number | number[]; isInteger: boolean } | null {
  if (fullName.startsWith(".")) fullName = fullName.slice(1);
  if (scopeId) {
    const resolver = db.query<any>("resolveName", scopeId) ?? db.query<any>("resolveSimpleName", scopeId);
    if (resolver) {
      const resolved = resolver(fullName);
      if (resolved && resolved.kind === "Component") {
        const res = extractDbConstantValue(resolved, db);
        if (res) return res;
      }
    }
  }
  const parts = fullName.split(".");
  if (parts.length === 0) return null;
  const leafName = parts[parts.length - 1];
  const candidates = db.byName(leafName);
  for (const c of candidates) {
    if (c.kind === "Component") {
      let curr: SymbolEntry | null = c;
      let match = true;
      for (let i = parts.length - 1; i >= 0; i--) {
        if (!curr || curr.name !== parts[i]) {
          match = false;
          break;
        }
        if (i > 0) {
          curr = curr.parentId !== null ? db.symbol(curr.parentId) : null;
        }
      }
      if (match) {
        const res = extractDbConstantValue(c, db);
        if (res) return res;
      }
    }
  }
  return null;
}

export function getDaeDimSize(prefix: string, partIdent: string, dimIdx: number, dae: DAEBuilder, db?: any): number {
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
      if (shape && shape.length > 0 && shape.every((d) => d > 0)) {
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
    const varExpr = dae.addExpression(ExprKind.Name, dae.interner.intern(dae.getVarName(matchingIndices[i]!)));
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
