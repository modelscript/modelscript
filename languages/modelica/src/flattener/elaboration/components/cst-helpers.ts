// SPDX-License-Identifier: AGPL-3.0-or-later

import { ExprKind } from "@modelscript/dsl";
import { BinOp, DAEBuilder, UnifiedWorkspace, VarType, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { MAX_ARRAY_EXPANSION_LENGTH } from "../../../constants.js";
import { AnnotationEvaluator } from "../../../diagram/annotation-evaluator.js";
import { getShortClassSpecifierNode } from "../../../queries.js";
import {
  containsWholeWordOutsideStrings,
  evalDaeExpr,
  evaluateCSTNumber,
  extractEnumLiteralsFromCst,
  hasClassHeaderKeywordCst,
  isAsciiIdentContinue,
  isAsciiIdentStart,
  isAsciiWhitespaceCode,
  isDottedIdentifierChain,
  isIntegerTypeSpec,
  leadingIdentifierBeforeDot,
  parseArrayLiteralElements,
  parseNamedCallArgsFromText,
  resolveEnumType,
  resolveScopedName,
  splitTopLevel,
  stripComments,
} from "../../expressions/index.js";
import { type FlattenerCstNode } from "../../types.js";
import {
  asExtDae,
  getCstNode,
  getExtState,
  getSymMeta,
  type ComponentFlattener,
  type ParentModData,
  type ParsedArrayArgValue,
  type ResolveNameFn,
  type ResolveSimpleNameFn,
} from "./types.js";

export const ALIAS_CLASS_QUALIFIERS = new Set([
  "encapsulated",
  "partial",
  "replaceable",
  "final",
  "inner",
  "outer",
  "redeclare",
]);

export function hasReplaceablePrefixText(txt: string): boolean {
  return containsWholeWordOutsideStrings(stripComments(txt), "replaceable");
}

export function hasDotStarSuffix(text: string): boolean {
  const clean = stripComments(text);
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === ".") {
      let j = i + 1;
      while (j < clean.length && isAsciiWhitespaceCode(clean.charCodeAt(j))) j++;
      if (j < clean.length && clean[j] === "*") return true;
    }
  }
  return false;
}

/** Parses the trimmed interior of `enumeration(...)` into generic marker and literal names. */
export function parseEnumInnerLiterals(inner: string): { isGeneric: boolean; literals: string[] } {
  if (inner === ":") return { isGeneric: true, literals: [] };
  const literals = inner
    .split(",")
    .map((s) => {
      const t = s.trimStart();
      let k = 0;
      while (k < t.length && !isAsciiWhitespaceCode(t.charCodeAt(k))) k++;
      return t.slice(0, k);
    })
    .filter(Boolean);
  return { isGeneric: false, literals };
}

export function hasReplaceableOrRedeclarePackageHeader(headerText: string): boolean {
  const n = headerText.length;
  let hasPrefix = false;
  let i = 0;
  while (i < n) {
    const code = headerText.charCodeAt(i);
    if (isAsciiIdentStart(code) || (code >= 48 && code <= 57)) {
      const start = i++;
      while (i < n && isAsciiIdentContinue(headerText.charCodeAt(i))) i++;
      const word = headerText.slice(start, i);
      if (word === "replaceable" || word === "redeclare") hasPrefix = true;
      else if (word === "package" && hasPrefix) return true;
    } else if (isAsciiWhitespaceCode(code)) {
      i++;
    } else {
      hasPrefix = false;
      i++;
    }
  }
  return false;
}

export function extractShortTypeAliasTarget(cst: SyntaxNode | FlattenerCstNode | null | undefined): string | null {
  const text = stripComments(cst?.text ?? "").trim();
  if (!text) return null;
  if (hasClassHeaderKeywordCst(cst as SyntaxNode | null | undefined, "type")) {
    const shortSpec = getShortClassSpecifierNode(cst as SyntaxNode | null | undefined);
    if (shortSpec?.text) {
      const shortText = stripComments(shortSpec.text);
      const eqIdx = shortText.indexOf("=");
      if (eqIdx >= 0) {
        const rhs = shortText.slice(eqIdx + 1).trimStart();
        let i = 0;
        while (i < rhs.length && (isAsciiIdentContinue(rhs.charCodeAt(i)) || rhs[i] === ".")) i++;
        if (i > 0) return rhs.slice(0, i);
      }
    }
  }
  let pos = 0;
  const readWord = (): string => {
    while (pos < text.length && isAsciiWhitespaceCode(text.charCodeAt(pos))) pos++;
    const start = pos;
    while (pos < text.length && isAsciiIdentContinue(text.charCodeAt(pos))) pos++;
    return text.slice(start, pos);
  };
  let tok = readWord();
  while (ALIAS_CLASS_QUALIFIERS.has(tok)) {
    const prevPos = pos;
    tok = readWord();
    if (pos === prevPos) return null;
  }
  if (tok !== "type") return null;
  const aliasName = readWord();
  if (!aliasName) return null;
  while (pos < text.length && isAsciiWhitespaceCode(text.charCodeAt(pos))) pos++;
  if (text[pos] !== "=") return null;
  pos++;
  while (pos < text.length && isAsciiWhitespaceCode(text.charCodeAt(pos))) pos++;
  const start = pos;
  while (pos < text.length && (isAsciiIdentContinue(text.charCodeAt(pos)) || text[pos] === ".")) pos++;
  return pos > start ? text.slice(start, pos) : null;
}

export function extractEnumSpecifierFromText(
  raw: string,
  requireLeadingEquals: boolean,
  requireAtStart: boolean,
): { isGeneric: boolean; literals: string[] } | null {
  const text = stripComments(raw);
  if (!text) return null;
  const n = text.length;
  let openParen = -1;

  if (requireAtStart) {
    const trimmed = text.trimStart();
    if (!trimmed.startsWith("enumeration")) return null;
    let j = "enumeration".length;
    while (j < trimmed.length && isAsciiWhitespaceCode(trimmed.charCodeAt(j))) j++;
    if (trimmed[j] !== "(") return null;
    const closeParen = trimmed.indexOf(")", j + 1);
    if (closeParen < 0) return null;
    const inner = trimmed.slice(j + 1, closeParen).trim();
    return parseEnumInnerLiterals(inner);
  }

  let searchFrom = 0;
  if (requireLeadingEquals) {
    while (searchFrom < n) {
      const eqPos = text.indexOf("=", searchFrom);
      if (eqPos < 0) return null;
      let j = eqPos + 1;
      while (j < n && isAsciiWhitespaceCode(text.charCodeAt(j))) j++;
      if (text.startsWith("enumeration", j)) {
        j += "enumeration".length;
        while (j < n && isAsciiWhitespaceCode(text.charCodeAt(j))) j++;
        if (text[j] === "(") {
          openParen = j;
          break;
        }
      }
      searchFrom = eqPos + 1;
    }
  } else {
    while (searchFrom < n) {
      const enumPos = text.indexOf("enumeration", searchFrom);
      if (enumPos < 0) return null;
      let j = enumPos + "enumeration".length;
      while (j < n && isAsciiWhitespaceCode(text.charCodeAt(j))) j++;
      if (text[j] === "(") {
        openParen = j;
        break;
      }
      searchFrom = enumPos + 1;
    }
  }

  if (openParen < 0) return null;
  const closeParen = text.indexOf(")", openParen + 1);
  if (closeParen < 0) return null;
  const inner = text.slice(openParen + 1, closeParen).trim();
  return parseEnumInnerLiterals(inner);
}

export function extractEnumSpecifier(
  cst: SyntaxNode | FlattenerCstNode | null | undefined,
  requireLeadingEquals: boolean,
): { isGeneric: boolean; literals: string[] } | null {
  if (!cst) return null;
  if (!requireLeadingEquals) {
    const shortSpec = getShortClassSpecifierNode(cst as SyntaxNode);
    if (shortSpec) {
      const lits = extractEnumLiteralsFromCst(cst as SyntaxNode);
      if (lits) return { isGeneric: false, literals: lits };
    }
  }
  return extractEnumSpecifierFromText(cst.text ?? "", requireLeadingEquals, false);
}

export function findInstNameForArg(
  compClauseNode: SyntaxNode | FlattenerCstNode | null | undefined,
  argName: string,
): string | null {
  if (compClauseNode && Array.isArray(compClauseNode.children)) {
    const stack: FlattenerCstNode[] = [compClauseNode];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur?.type === "declaration") {
        const modNode = (cur.children || []).find((c) => c.type === "modification");
        if (modNode && containsWholeWordOutsideStrings(modNode.text ?? "", argName)) {
          const identNode = (cur.children || []).find((c) => c.type === "identifier");
          const identText = identNode?.text?.trim();
          if (identText) return identText;
        }
      }
      const chs = cur?.children;
      if (Array.isArray(chs)) {
        for (let i = chs.length - 1; i >= 0; i--) {
          const ch = chs[i];
          if (ch) stack.push(ch);
        }
      }
    }
  }
  const text = compClauseNode?.text;
  if (typeof text !== "string" || !argName) return null;
  for (let i = 0; i < text.length; i++) {
    if (!isAsciiIdentContinue(text.charCodeAt(i))) continue;
    const start = i;
    while (i < text.length && isAsciiIdentContinue(text.charCodeAt(i))) i++;
    let j = i;
    while (j < text.length && isAsciiWhitespaceCode(text.charCodeAt(j))) j++;
    if (text[j] === "(") {
      const closeParen = text.indexOf(")", j + 1);
      const spanEnd = closeParen >= 0 ? closeParen : text.length;
      if (text.slice(j + 1, spanEnd).includes(argName)) {
        return text.slice(start, i);
      }
    }
  }
  return null;
}

const sharedComponentAnnotationEvaluator = new AnnotationEvaluator();
const componentHiddenCache = new WeakMap<object, Map<SymbolId, boolean>>();

export function findFirstExpressionCst(n: FlattenerCstNode | SyntaxNode | null | undefined): FlattenerCstNode | null {
  if (!n) return null;
  if (n.type === "expression") return n;
  const count = n.childCount ?? n.children?.length ?? 0;
  for (let i = 0; i < count; i++) {
    const c = n.child ? n.child(i) : n.children?.[i];
    if (!c) continue;
    const res = findFirstExpressionCst(c);
    if (res) return res;
  }
  return null;
}

export const EXPR_CST_NODE_TYPES = new Set([
  "expression",
  "if_expression",
  "simple_expression",
  "logical_expression",
  "logical_term",
  "logical_factor",
  "relation",
  "arithmetic_expression",
  "term",
  "factor",
  "primary",
  "component_reference",
  "unsigned_number",
  "unsigned_integer",
  "STRING",
  "false",
  "true",
]);

export function findBindingExprFromCst(
  bindNode: FlattenerCstNode | SyntaxNode | null | undefined,
): FlattenerCstNode | null {
  if (!bindNode) return null;
  if (bindNode.type && EXPR_CST_NODE_TYPES.has(bindNode.type)) {
    let cur: FlattenerCstNode = bindNode;
    while (
      cur.parent &&
      cur.parent.startIndex === cur.startIndex &&
      cur.parent.endIndex === cur.endIndex &&
      cur.parent.type &&
      EXPR_CST_NODE_TYPES.has(cur.parent.type)
    ) {
      cur = cur.parent;
    }
    return cur;
  }
  let modNode: FlattenerCstNode | null = null;
  if (bindNode.type === "modification" || bindNode.type === "modification_expression") {
    modNode = bindNode;
  } else {
    const findMod = (n: FlattenerCstNode | null | undefined): FlattenerCstNode | null => {
      if (!n) return null;
      if (n.type === "modification" || n.type === "modification_expression") return n;
      const count = n.childCount ?? n.children?.length ?? 0;
      for (let i = 0; i < count; i++) {
        const c = n.child ? n.child(i) : n.children?.[i];
        if (!c) continue;
        if (c.type === "modification" || c.type === "modification_expression") return c;
        if (
          c.type === "declaration" ||
          c.type === "component_declaration" ||
          c.type === "component_list" ||
          c.type === "component_clause"
        ) {
          const res = findMod(c);
          if (res) return res;
        }
      }
      return null;
    };
    modNode = findMod(bindNode);
  }
  if (modNode) {
    return findFirstExpressionCst(modNode) ?? modNode;
  }
  if (
    bindNode.type === "component_declaration" ||
    bindNode.type === "declaration" ||
    bindNode.type === "component_clause"
  ) {
    return null;
  }
  return findFirstExpressionCst(bindNode) ?? bindNode;
}

const STANDALONE_EXPR_CACHE_LIMIT = 512;
const standaloneExprCache = new Map<string, SyntaxNode | null>();

export function parseStandaloneExpressionCst(exprText: string): SyntaxNode | null {
  const trimmed = exprText.trim();
  if (!trimmed) return null;
  const cached = standaloneExprCache.get(trimmed);
  if (cached !== undefined) return cached;
  const parser = UnifiedWorkspace.getGlobalParser(".mo");
  if (!parser) return null;
  try {
    const dummyTree = parser.parse(`model _Tmp equation _x = ${trimmed}; end _Tmp;`);
    if (!dummyTree?.rootNode) return null;
    const findRhs = (n: SyntaxNode): SyntaxNode | null => {
      if (n.type === "simple_equation") return n.children?.find((c) => c.type === "expression") ?? null;
      for (const ch of n.children || []) {
        const r = findRhs(ch);
        if (r) return r;
      }
      return null;
    };
    const rootNode = dummyTree.rootNode as unknown as SyntaxNode;
    const res = findRhs(rootNode) ?? (findFirstExpressionCst(rootNode) as SyntaxNode | null);
    if (standaloneExprCache.size >= STANDALONE_EXPR_CACHE_LIMIT) {
      standaloneExprCache.clear();
    }
    standaloneExprCache.set(trimmed, res);
    return res;
  } catch {
    return null;
  }
}

export function isIntegerArenaExpr(exprId: number, dae: DAEBuilder): boolean {
  if (exprId < 0) return false;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.IntLiteral) return true;
  if (kind === ExprKind.RealLiteral) return false;
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    const vIdx = dae.lookupVariable(name);
    if (vIdx >= 0) return dae.getVarType(vIdx) === VarType.Integer;
    const state = getExtState(dae);
    const flattener = state?.flattener as (ComponentFlattener & { loopVarValues?: Map<string, unknown> }) | undefined;
    if (
      state?.activeLoopVars?.has?.(name) ||
      flattener?.activeLoopVars?.has?.(name) ||
      state?.loopVars?.has?.(name) ||
      state?.loopVarValues?.has?.(name) ||
      flattener?.loopVarValues?.has?.(name)
    ) {
      return true;
    }
    if (state?.namedArrayTypes?.get?.(name) === VarType.Integer) {
      return true;
    }
    const db = state?.db ?? flattener?.db;
    if (db) {
      const leafName = name.includes(".") ? name.split(".").pop()! : name;
      const scopeIds = [
        state?.currentClassId,
        flattener?.currentClassId,
        state?.currentRootClassId,
        flattener?.currentRootClassId,
      ].filter((id): id is SymbolId => Boolean(id));
      for (const sId of scopeIds) {
        const resolved =
          db.query?.<ResolveSimpleNameFn | undefined>("resolveSimpleName", sId)?.(name) ??
          db.query?.<ResolveNameFn | undefined>("resolveName", sId)?.(name) ??
          (leafName !== name
            ? db.query?.<ResolveSimpleNameFn | undefined>("resolveSimpleName", sId)?.(leafName)
            : null);
        if (resolved && resolved.kind === "Component") {
          const tSpec = db.query?.<string | null>("typeSpecifier", resolved.id) ?? getSymMeta(resolved).typeSpecifier;
          if (tSpec && isIntegerTypeSpec(String(tSpec), db)) return true;
        }
      }
      const byNameSyms = (db.byName?.(leafName) ?? []).filter((s) => s.kind === "Component");
      if (byNameSyms.length > 0) {
        const scopedSyms =
          scopeIds.length > 0
            ? byNameSyms.filter((s) => s.parentId !== null && scopeIds.includes(s.parentId))
            : byNameSyms;
        const candidates = scopedSyms.length > 0 ? scopedSyms : byNameSyms;
        if (
          candidates.some((s) => {
            const tSpec = db.query?.<string | null>("typeSpecifier", s.id) ?? getSymMeta(s).typeSpecifier;
            return Boolean(tSpec && isIntegerTypeSpec(String(tSpec), db));
          })
        ) {
          return true;
        }
      }
      return false;
    }
    return name === "n" || name === "m";
  }
  if (kind === ExprKind.Binary) {
    const op = dae.getExprData1(exprId);
    if (op === BinOp.Add || op === BinOp.Sub || op === BinOp.Mul) {
      return isIntegerArenaExpr(dae.getExprLeft(exprId), dae) && isIntegerArenaExpr(dae.getExprRight(exprId), dae);
    }
  }
  return false;
}

export function hasFieldVariablesInDae(dae: DAEBuilder, prefixText: string): boolean {
  const dotPrefix = `${prefixText}.`;
  const extDae = asExtDae(dae);
  if (typeof extDae.hasVariablesWithPrefix === "function") {
    return Boolean(extDae.hasVariablesWithPrefix(dotPrefix));
  }
  for (let i = 0; i < dae.varCount; i++) {
    if (!dae.isVarRemoved(i) && dae.getVarName(i).startsWith(dotPrefix)) {
      return true;
    }
  }
  return false;
}

export function isReplaceablePackageIdentifier(
  ident: string,
  flattener: ComponentFlattener,
  dae: DAEBuilder,
  redeclPkgPrefix?: string | null,
  parentMods?: ParentModData | null,
  scopeClassId?: SymbolId | null,
): boolean {
  if (!ident) return false;
  if (redeclPkgPrefix && ident === redeclPkgPrefix) return true;
  if (ident === "Medium" || ident === "Medium1" || ident === "Medium2") return true;
  const state = getExtState(dae, flattener);
  for (const col of [state?.packageRedeclares, state?.classRedeclares, state?.ElementRedeclares]) {
    if (!col) continue;
    if (typeof col.has === "function" && col.has(ident)) return true;
    if (Array.isArray(col) && col.includes(ident)) return true;
  }
  if (
    parentMods?.args?.some(
      (a) => !a?.isBreak && a?.name === ident && (a?.isRedeclaration || a?.redeclaredTypeSpecifier),
    )
  ) {
    return true;
  }
  const db = flattener?.db;
  if (db) {
    const checkSymPkg = (sym: SymbolEntry | null | undefined): boolean => {
      if (!sym) return false;
      if (getSymMeta(sym).isReplaceable) return true;
      const cstNode = db.cstNode?.(sym.id) as SyntaxNode | null;
      const headerText = (cstNode?.parent?.type === "element" ? cstNode.parent.text : (cstNode?.text ?? "")).slice(
        0,
        200,
      );
      if (hasReplaceableOrRedeclarePackageHeader(headerText)) {
        return true;
      }
      return false;
    };
    const scopes = [
      scopeClassId,
      parentMods?.currentClassId,
      parentMods?.ownerClassId,
      flattener.currentClassId,
      flattener.currentRootClassId,
    ].filter((s): s is SymbolId => Boolean(s));
    for (const sId of scopes) {
      const resolved =
        db.query?.<ResolveSimpleNameFn | undefined>("resolveSimpleName", sId)?.(ident) ??
        db.query?.<ResolveNameFn | undefined>("resolveName", sId)?.(ident);
      if (checkSymPkg(resolved)) return true;
    }
  }
  return false;
}

export function extractReplaceablePackagePrefix(
  exprText: string,
  flattener: ComponentFlattener,
  dae: DAEBuilder,
  redeclPkgPrefix?: string | null,
  parentMods?: ParentModData | null,
  scopeClassId?: SymbolId | null,
): string | null {
  const firstSeg = leadingIdentifierBeforeDot(exprText.trim());
  if (!firstSeg) return null;
  return isReplaceablePackageIdentifier(firstSeg, flattener, dae, redeclPkgPrefix, parentMods, scopeClassId)
    ? firstSeg
    : null;
}

export function parseComprehensionInner(inner: string): { body: string; iter: string; range: string } | null {
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (depth === 0) {
      if (
        (i === 0 || isAsciiWhitespaceCode(inner.charCodeAt(i - 1))) &&
        inner.startsWith("for", i) &&
        (i + 3 === inner.length || isAsciiWhitespaceCode(inner.charCodeAt(i + 3)))
      ) {
        const body = inner.slice(0, i).trim();
        const rest = inner.slice(i + 3).trim();
        if (rest.length > 0 && isAsciiIdentStart(rest.charCodeAt(0))) {
          let k = 1;
          while (k < rest.length && isAsciiIdentContinue(rest.charCodeAt(k))) k++;
          if (k < rest.length && isAsciiWhitespaceCode(rest.charCodeAt(k))) {
            let m = k + 1;
            while (m < rest.length && isAsciiWhitespaceCode(rest.charCodeAt(m))) m++;
            if (rest.startsWith("in", m) && m + 2 < rest.length && isAsciiWhitespaceCode(rest.charCodeAt(m + 2))) {
              const range = rest.slice(m + 3).trim();
              if (range.length > 0) {
                return { body, iter: rest.slice(0, k), range };
              }
            }
          }
        }
      }
    }
  }
  return null;
}

export function parseBraceComprehension(text: string): { body: string; iter: string; range: string } | null {
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  return parseComprehensionInner(text.slice(1, -1).trim());
}

export function parseArrayComprehension(text: string): { body: string; iter: string; range: string } | null {
  if (!text.startsWith("array")) return null;
  let openParen = 5;
  while (openParen < text.length && isAsciiWhitespaceCode(text.charCodeAt(openParen))) openParen++;
  if (openParen >= text.length || text[openParen] !== "(") return null;
  const closeParen = text.lastIndexOf(")");
  if (closeParen <= openParen) return null;
  return parseComprehensionInner(text.slice(openParen + 1, closeParen).trim());
}

export function evaluateComprehensionRangeValues(
  rangeExpr: string,
  flattener: ComponentFlattener,
  dae: DAEBuilder,
  prefix: string,
  scopeId?: SymbolId,
): string[] | null {
  const rTrim = rangeExpr.trim();
  if (!rTrim) return null;
  if (rTrim.startsWith("{") && rTrim.endsWith("}")) {
    const elems = parseArrayLiteralElements(rTrim).map((e) => e.trim());
    return elems.length > 0 ? elems : null;
  }
  if (rTrim === "Boolean") {
    return ["false", "true"];
  }
  const colonParts = splitTopLevel(rTrim, ":");
  if (colonParts.length === 2 || colonParts.length === 3) {
    const evalNumPart = (p: string): number | null => {
      const t = p.trim();
      const direct = Number(t);
      if (!isNaN(direct) && t !== "") return direct;
      const scopedName = prefix ? `${prefix}.${t}` : t;
      const vIdx = dae.lookupVariable(scopedName) >= 0 ? dae.lookupVariable(scopedName) : dae.lookupVariable(t);
      if (vIdx >= 0) {
        const sv = dae.getVarExpression(vIdx);
        const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(vIdx);
        if (typeof val === "number" && !isNaN(val)) return val;
      }
      const cstNum = evaluateCSTNumber(t, undefined, scopeId, flattener.db, dae, prefix);
      if (typeof cstNum === "number" && !isNaN(cstNum)) return cstNum;
      const ev = flattener.db?.evaluate?.(t, scopeId);
      if (typeof ev === "number" && !isNaN(ev)) return ev;
      return null;
    };
    const startVal = evalNumPart(colonParts[0]!);
    const stepVal = colonParts.length === 3 ? evalNumPart(colonParts[1]!) : 1;
    const stopVal = evalNumPart(colonParts[colonParts.length - 1]!);
    if (startVal !== null && stepVal !== null && stopVal !== null && stepVal !== 0) {
      const values: string[] = [];
      const maxLen = MAX_ARRAY_EXPANSION_LENGTH;
      if (stepVal > 0) {
        for (let v = startVal; v <= stopVal + 1e-12 && values.length < maxLen; v += stepVal) {
          values.push(String(Number.isInteger(v) ? v : Number(v.toPrecision(15))));
        }
      } else {
        for (let v = startVal; v >= stopVal - 1e-12 && values.length < maxLen; v += stepVal) {
          values.push(String(Number.isInteger(v) ? v : Number(v.toPrecision(15))));
        }
      }
      return values.length > 0 ? values : null;
    }
  }
  const enumInfo = resolveEnumType(rTrim, scopeId, flattener.db);
  if (enumInfo && enumInfo.literals.length > 0) {
    return enumInfo.literals.map((l) => `${enumInfo.qual}.${l}`);
  }
  return null;
}

export function parseModelicaArrayArg(
  raw: string,
  dae: DAEBuilder,
  flattener: ComponentFlattener,
  prefix?: string,
  scopeId?: SymbolId,
): ParsedArrayArgValue | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
  const elems = parseArrayLiteralElements(trimmed);
  const parsed: ParsedArrayArgValue[] = [];
  for (const el of elems) {
    const et = el.trim();
    if (et.startsWith("{") && et.endsWith("}")) {
      const sub = parseModelicaArrayArg(et, dae, flattener, prefix, scopeId);
      if (sub === undefined) return undefined;
      parsed.push(sub);
      continue;
    }
    if (et === "true") {
      parsed.push(true);
      continue;
    }
    if (et === "false") {
      parsed.push(false);
      continue;
    }
    if (et.startsWith('"') && et.endsWith('"')) {
      parsed.push(et.slice(1, -1));
      continue;
    }
    const num = Number(et);
    if (!isNaN(num) && et !== "") {
      parsed.push(num);
      continue;
    }
    const scoped = prefix ? `${prefix}.${et}` : et;
    let vIdx = dae.lookupVariable(scoped);
    if (vIdx < 0) vIdx = dae.lookupVariable(et);
    if (vIdx >= 0) {
      const sv = dae.getVarExpression(vIdx);
      const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(vIdx);
      if (val !== null && val !== undefined) {
        parsed.push(val as ParsedArrayArgValue);
        continue;
      }
    }
    const cstNum = evaluateCSTNumber(et, undefined, scopeId, flattener.db, dae, prefix);
    if (typeof cstNum === "number" && !isNaN(cstNum)) {
      parsed.push(cstNum);
      continue;
    }
    const ev = flattener.db?.evaluate?.(et, scopeId);
    if (ev !== null && ev !== undefined) {
      parsed.push(ev as ParsedArrayArgValue);
      continue;
    }
    return undefined;
  }
  return parsed;
}

export function canonicalizeOldFrontendExpr(
  exprId: number,
  varType: number,
  dae: DAEBuilder,
  forceOldStyle = false,
): number {
  if (exprId < 0) return exprId;
  const isOld = Boolean(dae.extensionMetadata?.["isOldFrontend"]) || forceOldStyle;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.Binary) {
    const op = dae.getExprData1(exprId);
    const left = dae.getExprLeft(exprId);
    const right = dae.getExprRight(exprId);
    if (
      op === BinOp.Sub &&
      dae.getExprKind(left) === ExprKind.Name &&
      dae.getExprKind(right) === ExprKind.IntLiteral &&
      (isOld || varType === VarType.Integer)
    ) {
      const k = dae.getExprData1(right);
      if (k > 0) {
        const negLitId = dae.addIntLiteral(-k);
        return dae.addBinaryExpr(BinOp.Add, negLitId, left);
      }
    }
    if (op === BinOp.Div && varType === VarType.Real) {
      let newLeft = left;
      let newRight = canonicalizeOldFrontendExpr(right, VarType.Integer, dae, isOld);
      if (dae.getExprKind(newLeft) === ExprKind.Name && isIntegerArenaExpr(newLeft, dae)) {
        newLeft = dae.addCallExpr("/*Real*/", [newLeft]);
      }
      if (
        (dae.getExprKind(newRight) === ExprKind.Name && isIntegerArenaExpr(newRight, dae)) ||
        (isOld && isIntegerArenaExpr(newRight, dae))
      ) {
        newRight = dae.addCallExpr("/*Real*/", [newRight]);
      }
      if (newLeft !== left || newRight !== right) {
        return dae.addBinaryExpr(BinOp.Div, newLeft, newRight);
      }
    }
  }
  return exprId;
}

export function lowerStandaloneExpression(
  flattener: ComponentFlattener,
  exprText: string,
  dae: DAEBuilder,
  bindingPrefix: string | undefined,
  compName?: string,
  varType?: number,
): number | null {
  const rhsNode = parseStandaloneExpressionCst(exprText);
  if (!rhsNode) return null;
  const prevCompName = flattener.currentBindingCompName;
  flattener.currentBindingCompName = compName;
  const diagCountBefore = dae.diagnostics.length;
  try {
    const parsedId = flattener.lowerExpr(rhsNode, dae, bindingPrefix);
    if (parsedId >= 0) {
      return varType !== undefined ? canonicalizeOldFrontendExpr(parsedId, varType, dae) : parsedId;
    }
    return null;
  } catch {
    return null;
  } finally {
    dae.diagnostics.length = diagCountBefore;
    flattener.currentBindingCompName = prevCompName;
  }
}

export function tryScalarizeIfSizeBindingCst(
  rawExprCst: SyntaxNode | FlattenerCstNode | null | undefined,
  bText: string,
  idxTuple: number[],
  bindingPrefix: string | undefined,
  dae: DAEBuilder,
): number | null {
  if (idxTuple.length === 0) return null;
  const rootNode = rawExprCst ?? parseStandaloneExpressionCst(bText);
  if (!rootNode) return null;
  const findIfExpr = (n: FlattenerCstNode | null | undefined): FlattenerCstNode | null => {
    if (!n) return null;
    if (n.type === "if_expression") return n;
    if (
      n.type === "expression" ||
      n.type === "simple_expression" ||
      n.type === "primary" ||
      n.type === "output_expression_list"
    ) {
      for (const c of n.children || []) {
        const found = findIfExpr(c);
        if (found) return found;
      }
    }
    return null;
  };
  const ifNode = findIfExpr(rootNode);
  if (!ifNode) return null;
  const exprChildren = (ifNode.children || []).filter(
    (c) =>
      c.type === "expression" ||
      c.type === "simple_expression" ||
      c.type === "logical_expression" ||
      c.type === "relation",
  );
  if (exprChildren.length < 3) return null;
  const condText = (exprChildren[0]?.text ?? "").trim();
  const thenText = (exprChildren[1]?.text ?? "").trim();
  const elseText = (exprChildren[exprChildren.length - 1]?.text ?? "").trim();
  const eqEqIdx = condText.lastIndexOf("==");
  const sizeCall =
    eqEqIdx > 0 && condText.slice(eqEqIdx + 2).trim() === "1"
      ? parseNamedCallArgsFromText(condText.slice(0, eqEqIdx))
      : null;
  if (!sizeCall || sizeCall.callee !== "size") return null;
  const sizeCommaIdx = sizeCall.argsText.indexOf(",");
  if (sizeCommaIdx < 0 || sizeCall.argsText.indexOf(",", sizeCommaIdx + 1) >= 0) return null;
  const arrName = sizeCall.argsText.slice(0, sizeCommaIdx).trim();
  const dimArg = sizeCall.argsText.slice(sizeCommaIdx + 1).trim();
  if (!isDottedIdentifierChain(arrName) || dimArg !== "1") return null;
  const resolvedArr = resolveScopedName(arrName, bindingPrefix ?? "", dae);
  const hasSecond = dae.getVarIdxByName(`${resolvedArr}[2]`) >= 0;
  const branchText = !hasSecond ? thenText : elseText;
  const onesClose = branchText.startsWith("ones(") ? branchText.indexOf(")", 5) : -1;
  const afterOnes = onesClose > 0 ? branchText.slice(onesClose + 1).trimStart() : "";
  const rhsMul = afterOnes.startsWith("*") ? afterOnes.slice(1).trim() : "";
  if (rhsMul === `${arrName}[1]`) {
    return dae.addExpression(ExprKind.Name, dae.interner.intern(`${resolvedArr}[1]`));
  }
  if (branchText === arrName) {
    const targetIdx = hasSecond ? idxTuple[0] : 1;
    return dae.addExpression(ExprKind.Name, dae.interner.intern(`${resolvedArr}[${targetIdx}]`));
  }
  return null;
}

/**
 * Checks whether a component declaration carries an `annotation(HideResult = true)`,
 * caching the evaluated boolean per `(QueryDB, SymbolId)` pair.
 *
 * @param flattener - Active component flattener context.
 * @param elemId - Symbol ID of the component declaration.
 * @returns `true` if `HideResult` is enabled on the component or its enclosing clause.
 */
export function isComponentHidden(flattener: ComponentFlattener, elemId: SymbolId): boolean {
  const dbKey = flattener.db as unknown as object;
  let dbMap = componentHiddenCache.get(dbKey);
  if (dbMap) {
    const cached = dbMap.get(elemId);
    if (cached !== undefined) return cached;
  } else {
    dbMap = new Map<SymbolId, boolean>();
    componentHiddenCache.set(dbKey, dbMap);
  }

  const cst = getCstNode(flattener.db, elemId);
  if (!cst) {
    dbMap.set(elemId, false);
    return false;
  }
  let curr: SyntaxNode | null = cst;
  while (curr && curr.type !== "component_declaration" && curr.type !== "component_clause") {
    curr = curr.parent;
  }
  if (!curr) curr = cst;
  const rawText = (curr?.text ?? cst?.text ?? "").toLowerCase();
  if (!rawText.includes("hideresult")) {
    dbMap.set(elemId, false);
    return false;
  }
  const hideRes =
    sharedComponentAnnotationEvaluator.evaluate(curr, "hideresult") ??
    sharedComponentAnnotationEvaluator.evaluate(cst, "hideresult");
  let result = false;
  if (hideRes !== null && hideRes !== undefined) {
    if (typeof hideRes === "boolean") result = hideRes;
    else if (typeof hideRes === "object" && "value" in hideRes && hideRes.value !== undefined) {
      result = Boolean(hideRes.value);
    } else result = true;
  }
  dbMap.set(elemId, result);
  return result;
}

/**
 * Extracts the unquoted Modelica description string (e.g., `"Capacitor voltage"`)
 * attached to a component declaration CST node, or returns `null` if none is present.
 *
 * @param elemCst - CST node of the component declaration.
 * @returns Unquoted description string, or `null` if absent or empty (`""`).
 */
export function extractDescription(elemCst: SyntaxNode | FlattenerCstNode | null | undefined): string | null {
  if (!elemCst) return null;
  let curr: FlattenerCstNode | null | undefined = elemCst;
  let targetNode: FlattenerCstNode | null = null;
  while (curr && curr.type !== "component_clause" && curr.type !== "class_definition") {
    if (
      curr.type === "component_declaration" ||
      curr.type === "component_declaration1" ||
      Cst.ComponentDeclaration.is(curr as SyntaxNode)
    ) {
      targetNode = curr;
      break;
    }
    curr = curr.parent;
  }
  if (!targetNode) targetNode = elemCst;

  const findDescNode = (node: FlattenerCstNode | null | undefined): FlattenerCstNode | null => {
    if (!node) return null;
    for (const c of node.children || []) {
      if (
        c.type === "description_string" ||
        c.type === "string_literal" ||
        c.type === "comment" ||
        Cst.DescriptionString.is(c as SyntaxNode)
      ) {
        return c;
      }
      if (c.type === "description" || Cst.Description.is(c as SyntaxNode)) {
        for (const ch of c.children || []) {
          if (
            ch.type === "description_string" ||
            ch.type === "string_literal" ||
            ch.type === "comment" ||
            Cst.DescriptionString.is(ch as SyntaxNode)
          ) {
            return ch;
          }
        }
      }
    }
    return null;
  };

  const descNode = findDescNode(targetNode) ?? findDescNode(targetNode.parent) ?? findDescNode(elemCst);
  if (descNode) {
    const t = descNode.text?.trim() ?? "";
    if (t && t !== '""') {
      return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
    }
  }
  return null;
}

/**
 * Evaluates a CST node or expression text to a compile-time numeric value in `scopeId`.
 *
 * Delegates directly to {@link evaluateCSTNumber} using `flattener.db` and optional loop
 * variable substitutions (`subs`) and `DAEBuilder` bindings (`dae`).
 *
 * @param flattener - Active component flattener context.
 * @param node - CST node or raw expression string to evaluate.
 * @param scopeId - Enclosing class or package symbol ID for lexical name resolution.
 * @param subs - Optional map of active loop iterator variable bindings.
 * @param dae - Optional `DAEBuilder` for resolving already-flattened parameter/constant bindings.
 * @returns Evaluated finite number, or `null` if non-numeric or unresolvable.
 */
export function evaluateCSTToNumber(
  flattener: ComponentFlattener,
  node: SyntaxNode | string | null | undefined,
  scopeId: SymbolId,
  subs?: Map<string, number>,
  dae?: DAEBuilder,
): number | null {
  return evaluateCSTNumber(node, subs, scopeId, flattener.db, dae);
}
