// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure CST and token-level helper utilities for the Modelica class flattener.
 */

import { UnifiedWorkspace } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../src-gen/bindings.js";
import { getShortClassSpecifierNode } from "../../queries.js";
import {
  cstHasError,
  extractFunctionCallArgExprNodesCst,
  firstAsciiToken,
  isAsciiDigitsOnly,
  isAsciiIdentContinue,
  isAsciiIdentifier,
  isAsciiIdentStart,
  isAsciiWhitespaceCode,
  stripLeadingDot,
  stripOuterDoubleQuotes,
  tokenizeCommentStrippedWords,
} from "../expressions/index.js";
import { type DiagnosticRange, getElementDiagRange } from "../support/range-utils.js";
import type { CstNodeLike } from "./types.js";

export const TRIVIA_COMMENT_TYPES = new Set(["comment", "line_comment", "block_comment"]);
export const PRIMITIVE_TYPE_WORDS = new Set(["Real", "Integer", "Boolean", "String"]);
export const CLASS_HEADER_PREFIX_WORDS = new Set([
  "final",
  "inner",
  "outer",
  "redeclare",
  "replaceable",
  "encapsulated",
  "partial",
  "expandable",
  "pure",
  "impure",
  "operator",
  "class",
  "model",
  "record",
  "block",
  "connector",
  "type",
  "package",
  "function",
  "uniontype",
]);

export function parseStandaloneMoCst(code: string): SyntaxNode | null {
  const parser = UnifiedWorkspace.getGlobalParser(".mo");
  if (!parser) return null;
  try {
    return (parser.parse(code)?.rootNode as SyntaxNode | null | undefined) ?? null;
  } catch {
    return null;
  }
}

export function collectCstLeafTokens(
  node: CstNodeLike | null | undefined,
  options?: { skipStrings?: boolean; skipDescription?: boolean },
): CstNodeLike[] {
  const out: CstNodeLike[] = [];
  if (!node) return out;
  const skipStrings = options?.skipStrings ?? true;
  const skipDescription = options?.skipDescription ?? false;
  const visit = (n: CstNodeLike): void => {
    const t = n.type ?? "";
    if (TRIVIA_COMMENT_TYPES.has(t)) return;
    if (skipStrings && (t === "string_literal" || t === "STRING")) return;
    if (skipDescription && (t === "description" || t === "description_string" || t === "annotation_clause")) return;
    if (!Array.isArray(n.children) || n.children.length === 0) {
      if (n.text?.trim()) out.push(n);
      return;
    }
    for (const c of n.children) visit(c);
  };
  visit(node);
  return out;
}

export function collectCstLeafTexts(
  node: CstNodeLike | null | undefined,
  options?: { skipStrings?: boolean; skipDescription?: boolean },
): string[] {
  return collectCstLeafTokens(node, options).map((n) => n.text!.trim());
}

export function findFirstCstNode(
  node: CstNodeLike | null | undefined,
  predicate: (n: CstNodeLike) => boolean,
): CstNodeLike | null {
  if (!node) return null;
  if (predicate(node)) return node;
  if (Array.isArray(node.children)) {
    for (const c of node.children) {
      const found = findFirstCstNode(c, predicate);
      if (found) return found;
    }
  }
  return null;
}

export function consumeStringOrCommentEnd(s: string, i: number): number {
  const ch = s[i];
  if (ch === '"' || ch === "'") {
    let j = i + 1;
    while (j < s.length) {
      if (s[j] === "\\") {
        j += 2;
        continue;
      }
      if (s[j] === ch) return j + 1;
      j++;
    }
    return s.length;
  }
  if (ch === "/" && s[i + 1] === "/") {
    let j = i + 2;
    while (j < s.length && s[j] !== "\n" && s[j] !== "\r") j++;
    return j;
  }
  if (ch === "/" && s[i + 1] === "*") {
    const closeIdx = s.indexOf("*/", i + 2);
    return closeIdx >= 0 ? closeIdx + 2 : s.length;
  }
  return -1;
}

export function readAsciiIdentEnd(s: string, i: number): number {
  if (i >= s.length || !isAsciiIdentStart(s.charCodeAt(i))) return i;
  let j = i + 1;
  while (j < s.length && isAsciiIdentContinue(s.charCodeAt(j))) j++;
  return j;
}

export function getClassHeaderWordsCst(cst: CstNodeLike | null | undefined): string[] {
  if (!cst) return [];
  if (cst.type === "class_definition" && Array.isArray(cst.children) && cst.children.length > 0) {
    const words: string[] = [];
    for (const ch of cst.children) {
      if (ch.type === "class_specifier") break;
      words.push(...tokenizeCommentStrippedWords(ch.text ?? ""));
    }
    if (words.length > 0) return words;
  }
  const pfxNode =
    Cst.ClassDefinition.classPrefixes(cst as unknown as SyntaxNode) ??
    cst.children?.find((c) => c.type === "class_prefixes");
  if (pfxNode) {
    return tokenizeCommentStrippedWords(pfxNode.text ?? "");
  }
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  const words: string[] = [];
  for (const tok of leaves) {
    if (!CLASS_HEADER_PREFIX_WORDS.has(tok)) break;
    words.push(tok);
  }
  return words;
}

export function hasClassPrefixWordCst(cst: CstNodeLike | null | undefined, word: string): boolean {
  return getClassHeaderWordsCst(cst).includes(word);
}

export function hasOperatorRecordPrefixCst(cst: CstNodeLike | null | undefined): boolean {
  const words = getClassHeaderWordsCst(cst);
  return words.some((w, i) => w === "operator" && words[i + 1] === "record");
}

export function cstHasUnqualifiedImportWildcard(importCst: CstNodeLike | null | undefined): boolean {
  const leaves = collectCstLeafTexts(importCst, { skipStrings: true, skipDescription: true });
  return leaves.some((t) => t === "*" || t === ".*");
}

export function collectDottedPrefixRootIdentsCst(cst: CstNodeLike | null | undefined): string[] {
  const out: string[] = [];
  if (!cst) return out;
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i + 2 < leaves.length; i++) {
    const a = leaves[i]!;
    if (isAsciiIdentifier(a) && leaves[i + 1] === "." && isAsciiIdentifier(leaves[i + 2]!)) {
      out.push(a);
    }
  }
  return out;
}

export function cstHasKeywordToken(cst: CstNodeLike | null | undefined, keyword: string): boolean {
  if (!cst) return false;
  const t = cst.type ?? "";
  if (TRIVIA_COMMENT_TYPES.has(t) || t === "string_literal" || t === "STRING") return false;
  if (!Array.isArray(cst.children) || cst.children.length === 0) {
    return cst.text?.trim() === keyword;
  }
  for (const c of cst.children) {
    if (cstHasKeywordToken(c, keyword)) return true;
  }
  return false;
}

export function hasUnsupportedTypeOrConnectorAliasCst(cst: CstNodeLike | null | undefined): boolean {
  if (!cst) return false;
  let found = false;
  const visit = (n: CstNodeLike): void => {
    if (found) return;
    if (n.type === "class_definition") {
      const words = getClassHeaderWordsCst(n);
      const isTypeOrConnector = words.includes("connector") || words.includes("type");
      if (isTypeOrConnector) {
        const shortSpec = getShortClassSpecifierNode(n as unknown as SyntaxNode);
        if (shortSpec && cstHasError(shortSpec)) {
          found = true;
          return;
        }
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(cst);
  return found;
}

export function hasNonStandardEnumKeywordCst(cst: CstNodeLike | null | undefined): boolean {
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i + 2 < leaves.length; i++) {
    if (
      leaves[i] === "enum" &&
      isAsciiIdentifier(leaves[i + 1]!) &&
      (leaves[i + 2] === "(" || leaves[i + 2] === "=" || leaves[i + 2] === ";")
    ) {
      return true;
    }
  }
  return false;
}

export function hasConnectionsOrEqualityConstraintCst(cst: CstNodeLike | null | undefined): boolean {
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i] === "equalityConstraint") return true;
    if (
      i + 2 < leaves.length &&
      leaves[i] === "Connections" &&
      leaves[i + 1] === "." &&
      isAsciiIdentifier(leaves[i + 2]!)
    ) {
      return true;
    }
  }
  return false;
}

export function cstHasWholeSliceAssign(cst: CstNodeLike | null | undefined): boolean {
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i < leaves.length; i++) {
    if (
      i + 3 < leaves.length &&
      leaves[i] === "[" &&
      leaves[i + 1] === ":" &&
      leaves[i + 2] === "]" &&
      leaves[i + 3] === "="
    ) {
      return true;
    }
    if (i + 1 < leaves.length && leaves[i] === "[:]" && leaves[i + 1] === "=") {
      return true;
    }
  }
  return false;
}

export function isDecimalFloatTokenText(s: string): boolean {
  const dotIdx = s.indexOf(".");
  if (dotIdx <= 0 || dotIdx >= s.length - 1) return false;
  const intPart = s.slice(0, dotIdx);
  if (!isAsciiDigitsOnly(intPart)) return false;
  return s.charCodeAt(dotIdx + 1) >= 48 && s.charCodeAt(dotIdx + 1) <= 57;
}

export function cstHasFloatFillArg(cst: CstNodeLike | null | undefined): boolean {
  if (!cst) return false;
  let found = false;
  const visit = (n: CstNodeLike): void => {
    if (found) return;
    if (
      n.type === "function_call" ||
      (n.type === "primary" && n.children?.some((c) => c.type === "function_call_args"))
    ) {
      const callee = n.children?.find((c) => c.type === "component_reference" || c.type === "identifier");
      if (callee?.text?.trim() === "fill") {
        const argNodes = extractFunctionCallArgExprNodesCst(n as unknown as SyntaxNode);
        if (argNodes.length >= 2) {
          const arg2Leaves = collectCstLeafTexts(argNodes[1], { skipStrings: true });
          if (arg2Leaves.some((t) => isDecimalFloatTokenText(t))) {
            found = true;
            return;
          }
        }
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(cst);
  if (found) return true;
  // Token-level fallback if call wasn't structured
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i + 4 < leaves.length; i++) {
    if (leaves[i] === "fill" && leaves[i + 1] === "(") {
      let depth = 1;
      let argIdx = 0;
      for (let j = i + 2; j < leaves.length && depth > 0; j++) {
        const t = leaves[j]!;
        if (t === "(") depth++;
        else if (t === ")") depth--;
        else if (t === "," && depth === 1) argIdx++;
        else if (depth === 1 && argIdx === 1 && isDecimalFloatTokenText(t)) return true;
      }
    }
  }
  return false;
}

export function cstHasExternalLanguage(cst: CstNodeLike | null | undefined, lang: string): boolean {
  if (!cst) return false;
  const want = lang.toLowerCase();
  let found = false;
  const visit = (n: CstNodeLike): void => {
    if (found) return;
    if (n.type === "external_clause") {
      const langNode = n.children?.find(
        (c) => c.type === "language_specification" || c.type === "string_literal" || c.type === "STRING",
      );
      if (langNode && stripOuterDoubleQuotes(langNode.text?.trim() ?? "").toLowerCase() === want) {
        found = true;
        return;
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(cst);
  if (found) return true;
  const leaves = collectCstLeafTexts(cst, { skipStrings: false });
  for (let i = 0; i + 1 < leaves.length; i++) {
    if (leaves[i] === "external" && leaves[i + 1]!.startsWith('"')) {
      if (stripOuterDoubleQuotes(leaves[i + 1]!).toLowerCase() === want) return true;
    }
  }
  return false;
}

export function cstHasLeadingDotAfterEqOrParen(cst: CstNodeLike | null | undefined): boolean {
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i + 1 < leaves.length; i++) {
    if (leaves[i] !== "=" && leaves[i] !== "(") continue;
    const next = leaves[i + 1]!;
    if (next === "." && i + 2 < leaves.length && isAsciiIdentifier(leaves[i + 2]!)) {
      return true;
    }
    if (next.startsWith(".") && isAsciiIdentifier(next.slice(1))) {
      return true;
    }
  }
  return false;
}

export function cstHasComponentMethodCall(cst: CstNodeLike | null | undefined, compNames: Set<string>): boolean {
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i + 3 < leaves.length; i++) {
    if (
      compNames.has(leaves[i]!) &&
      leaves[i + 1] === "." &&
      isAsciiIdentifier(leaves[i + 2]!) &&
      leaves[i + 3] === "("
    ) {
      return true;
    }
  }
  return false;
}

export function cstHasEqualsRhsIdent(cst: CstNodeLike | null | undefined, idents: Set<string>): boolean {
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i + 1 < leaves.length; i++) {
    if (leaves[i] === "=" && idents.has(leaves[i + 1]!)) {
      return true;
    }
  }
  return false;
}

export function cstHasExternalBuiltinOrDerivative(cst: CstNodeLike | null | undefined): boolean {
  if (!cst) return false;
  if (cstHasExternalLanguage(cst, "builtin")) return true;
  let found = false;
  const visit = (n: CstNodeLike): void => {
    if (found) return;
    if (n.type === "element_modification") {
      const nameNode = n.children?.find((c) => c.type === "name" || c.type === "identifier");
      if (nameNode?.text?.trim() === "derivative") {
        found = true;
        return;
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(cst);
  return found;
}

export function optStringContainsFlag(rawOpt: string, flag: string): boolean {
  const unquoted = stripOuterDoubleQuotes(rawOpt.trim());
  let start = 0;
  for (let i = 0; i <= unquoted.length; i++) {
    const ch = unquoted[i];
    if (i === unquoted.length || ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === ",") {
      if (i > start && unquoted.slice(start, i) === flag) return true;
      start = i + 1;
    }
  }
  return false;
}

export function cstDirectNodeHasCommandLineFlag(
  node: CstNodeLike,
  flag: string,
  stopAtNestedClasses: boolean,
): boolean {
  const visit = (n: CstNodeLike): boolean => {
    if (stopAtNestedClasses && n !== node && n.type === "class_definition") return false;
    if (n.type === "element_modification") {
      const nameNode = n.children?.find((c) => c.type === "name" || c.type === "identifier");
      if (nameNode?.text?.trim() === "__OpenModelica_commandLineOptions") {
        const modNode = n.children?.find((c) => c.type === "modification" || c.type === "modification_expression");
        const strNode = findFirstCstNode(modNode ?? n, (c) => c.type === "string_literal" || c.type === "STRING");
        if (strNode?.text && optStringContainsFlag(strNode.text, flag)) {
          return true;
        }
      }
    }
    for (const c of n.children ?? []) {
      if (visit(c)) return true;
    }
    return false;
  };
  return visit(node);
}

export function hasCommandLineFlagInCst(cst: CstNodeLike | null | undefined, flag: string): boolean {
  if (!cst) return false;
  return cstDirectNodeHasCommandLineFlag(cst, flag, true);
}

export function hasNestedCommandLineFlagCst(cst: CstNodeLike | null | undefined, flag: string): boolean {
  if (!cst) return false;
  let found = false;
  const visit = (n: CstNodeLike): void => {
    if (found) return;
    if (n !== cst && n.type === "class_definition") {
      if (cstDirectNodeHasCommandLineFlag(n, flag, false)) {
        found = true;
        return;
      }
      return;
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(cst);
  return found;
}

export function findRedeclareTypeSpecRangeCst(
  rootCst: CstNodeLike | null | undefined,
  name: string,
  redeclaredTypeSpecifier: string,
): DiagnosticRange | undefined {
  if (!rootCst) return undefined;
  const cleanSpec = stripLeadingDot(redeclaredTypeSpecifier);
  let matchedNode: CstNodeLike | null = null;
  const visit = (n: CstNodeLike): void => {
    if (matchedNode) return;
    if (n.type === "element_redeclaration") {
      const leaves = collectCstLeafTexts(n, { skipStrings: true });
      const redeclIdx = leaves.indexOf("redeclare");
      const typeIdx = redeclIdx >= 0 ? leaves.indexOf("type", redeclIdx + 1) : -1;
      const eqIdx = typeIdx >= 0 ? leaves.indexOf("=", typeIdx + 1) : -1;
      const nameIdx = typeIdx >= 0 ? leaves.indexOf(name, typeIdx + 1) : -1;
      const hasBlockingToken =
        typeIdx > redeclIdx &&
        leaves
          .slice(redeclIdx + 1, typeIdx)
          .some(
            (tok) =>
              tok === "=" ||
              tok === ";" ||
              tok === "function" ||
              tok === "model" ||
              tok === "block" ||
              tok === "record" ||
              tok === "connector" ||
              tok === "package",
          );
      if (!hasBlockingToken && nameIdx > typeIdx && (eqIdx < 0 || nameIdx < eqIdx)) {
        const typeNode = findFirstCstNode(n, (c) => {
          if (c.type !== "type_specifier" && c.type !== "name") return false;
          const t = stripLeadingDot(c.text?.trim() ?? "");
          return t === cleanSpec || t.endsWith(`.${cleanSpec}`);
        });
        if (typeNode) {
          matchedNode = n;
          return;
        }
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(rootCst);
  return matchedNode ? getElementDiagRange(matchedNode) : undefined;
}

export function findRedeclareSameNameRangeCst(
  extCst: CstNodeLike | null | undefined,
  name: string,
): DiagnosticRange | undefined {
  if (!extCst) return undefined;
  let matched: CstNodeLike | null = null;
  const visit = (n: CstNodeLike): void => {
    if (matched) return;
    if (n.type === "element_redeclaration") {
      const leaves = collectCstLeafTexts(n, { skipStrings: true });
      if (leaves.includes(name)) {
        matched = n;
        return;
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(extCst);
  return getElementDiagRange(matched ?? extCst);
}

export function stripTrailingSemicolon(s: string): string {
  const trimmed = s.trim();
  return trimmed.endsWith(";") ? trimmed.slice(0, -1).trimEnd() : trimmed;
}

export function sliceIfMatchesNodeText(wrapped: string, node: CstNodeLike | null | undefined): [number, number] | null {
  if (!node) return null;
  const s = node.startIndex ?? node.startOffset;
  const e = node.endIndex ?? node.endOffset;
  if (typeof s !== "number" || typeof e !== "number") return null;
  if (wrapped.slice(s, e) !== (node.text ?? "")) return null;
  return [s, e];
}

export function findComponentClausePartsInText(text: string): {
  wrapped: string;
  base: string;
  typeSpec: [number, number];
  typeArr: [number, number] | null;
  compIdent: [number, number];
  compArr: [number, number] | null;
} | null {
  const base = stripTrailingSemicolon(text);
  const prefix = "model _M\n  ";
  const wrapped = `${prefix}${base};\nend _M;`;
  const root = parseStandaloneMoCst(wrapped);
  if (!root) return null;
  const clause = findFirstCstNode(root, (n) => n.type === "component_clause" || n.type === "component_clause1");
  if (!clause || cstHasError(clause as unknown as SyntaxNode)) return null;
  const typeSpecNode = clause.children?.find((c) => c.type === "type_specifier");
  const typeArrNode = clause.children?.find((c) => c.type === "array_subscripts") ?? null;
  const declNode = findFirstCstNode(clause, (n) => n.type === "declaration");
  const identNode = declNode?.children?.find((c) => c.type === "identifier") ?? null;
  const compArrNode = declNode?.children?.find((c) => c.type === "array_subscripts") ?? null;
  const ts = sliceIfMatchesNodeText(wrapped, typeSpecNode);
  const ci = sliceIfMatchesNodeText(wrapped, identNode);
  if (!ts || !ci) return null;
  const ta = sliceIfMatchesNodeText(wrapped, typeArrNode);
  const ca = sliceIfMatchesNodeText(wrapped, compArrNode);
  return { wrapped, base, typeSpec: ts, typeArr: ta, compIdent: ci, compArr: ca };
}

export function mergeArrayDimText(firstDim: string, secondDim: string): string {
  const a = firstDim.trim();
  const b = secondDim.trim();
  if (a.startsWith("[") && a.endsWith("]") && b.startsWith("[") && b.endsWith("]")) {
    return `[${a.slice(1, -1)}, ${b.slice(1, -1)}]`;
  }
  return `${a}${b}`;
}

export function moveTypeArrayDimToCompName(text: string): string {
  const info = findComponentClausePartsInText(text);
  if (!info || !info.typeArr) return text;
  const [taS, taE] = info.typeArr;
  const [ciS, ciE] = info.compIdent;
  if (taE > ciS) return text;
  const typeDimTxt = info.wrapped.slice(taS, taE);
  const pLen = "model _M\n  ".length;
  const relTaS = taS - pLen;
  const relTaE = taE - pLen;
  const relCiE = ciE - pLen;
  if (!info.compArr) {
    const before = info.base.slice(0, relTaS).trimEnd();
    const mid = info.base.slice(relTaE, relCiE).trimStart();
    const after = info.base.slice(relCiE);
    return `${before} ${mid}${typeDimTxt}${after}`;
  }
  const [caS, caE] = info.compArr;
  const relCaS = caS - pLen;
  const relCaE = caE - pLen;
  const compDimTxt = info.wrapped.slice(caS, caE);
  const before = info.base.slice(0, relTaS).trimEnd();
  const mid = info.base.slice(relTaE, relCaS).trimStart();
  const after = info.base.slice(relCaE);
  return `${before} ${mid}${mergeArrayDimText(typeDimTxt, compDimTxt)}${after}`;
}

export function moveCompArrayDimToTypeName(text: string): string {
  const info = findComponentClausePartsInText(text);
  if (!info || !info.compArr) return text;
  const [, tsE] = info.typeSpec;
  const [caS, caE] = info.compArr;
  if (tsE > caS) return text;
  const compDimTxt = info.wrapped.slice(caS, caE);
  const pLen = "model _M\n  ".length;
  const relTsE = tsE - pLen;
  const relCaS = caS - pLen;
  const relCaE = caE - pLen;
  if (!info.typeArr) {
    return `${info.base.slice(0, relTsE)}${compDimTxt}${info.base.slice(relTsE, relCaS)}${info.base.slice(relCaE)}`;
  }
  const [taS, taE] = info.typeArr;
  const relTaS = taS - pLen;
  const relTaE = taE - pLen;
  const typeDimTxt = info.wrapped.slice(taS, taE);
  return `${info.base.slice(0, relTaS)}${mergeArrayDimText(typeDimTxt, compDimTxt)}${info.base.slice(relTaE, relCaS)}${info.base.slice(relCaE)}`;
}

export function replaceAliasDotPrefix(text: string, alias: string, target: string): { text: string; changed: boolean } {
  let out = "";
  let changed = false;
  let i = 0;
  while (i < text.length) {
    const skipEnd = consumeStringOrCommentEnd(text, i);
    if (skipEnd > i) {
      out += text.slice(i, skipEnd);
      i = skipEnd;
      continue;
    }
    const idEnd = readAsciiIdentEnd(text, i);
    if (idEnd > i) {
      const word = text.slice(i, idEnd);
      const prevChar = i > 0 ? text[i - 1] : "";
      if (word === alias && prevChar !== "." && text[idEnd] === ".") {
        out += target;
        changed = true;
      } else {
        out += word;
      }
      i = idEnd;
      continue;
    }
    out += text[i]!;
    i++;
  }
  return { text: changed ? out : text, changed };
}

export function startsWithPrimitiveTypeWord(text: string): boolean {
  const trimmed = text.trimStart();
  const tok = firstAsciiToken(trimmed);
  return PRIMITIVE_TYPE_WORDS.has(tok) && trimmed[tok.length] !== ".";
}

export function dotPrefixPrimitiveTypeWords(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const skipEnd = consumeStringOrCommentEnd(text, i);
    if (skipEnd > i) {
      out += text.slice(i, skipEnd);
      i = skipEnd;
      continue;
    }
    const idEnd = readAsciiIdentEnd(text, i);
    if (idEnd > i) {
      const word = text.slice(i, idEnd);
      const prevChar = i > 0 ? text[i - 1] : "";
      if (PRIMITIVE_TYPE_WORDS.has(word) && prevChar !== ".") {
        out += `.${word}`;
      } else {
        out += word;
      }
      i = idEnd;
      continue;
    }
    out += text[i]!;
    i++;
  }
  return out;
}

export function startsWithDottedIdentifierPair(text: string): boolean {
  let i = 0;
  while (i < text.length && isAsciiWhitespaceCode(text.charCodeAt(i))) i++;
  if (i >= text.length || text[i] === ".") return false;
  const end1 = readAsciiIdentEnd(text, i);
  if (end1 === i || text[end1] !== ".") return false;
  const end2 = readAsciiIdentEnd(text, end1 + 1);
  return end2 > end1 + 1;
}

export function formatParenModArgEquals(text: string): string {
  let out = "";
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const skipEnd = consumeStringOrCommentEnd(text, i);
    if (skipEnd > i) {
      out += text.slice(i, skipEnd);
      i = skipEnd;
      continue;
    }
    const ch = text[i]!;
    if (ch === "(") {
      depth++;
      out += ch;
      i++;
      continue;
    }
    if (ch === ")") {
      if (depth > 0) depth--;
      out += ch;
      i++;
      continue;
    }
    if (depth > 0 && ch === "=") {
      const prev = i > 0 ? text[i - 1]! : "";
      const next = text[i + 1] ?? "";
      if (prev !== "=" && prev !== "!" && prev !== "<" && prev !== ">" && prev !== ":" && next !== "=") {
        while (out.length > 0 && (out[out.length - 1] === " " || out[out.length - 1] === "\t")) {
          out = out.slice(0, -1);
        }
        out += " = ";
        i++;
        while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

export function parseComponentDeclTokensCst(
  rawFallback: string,
  stripDescAndAnn: boolean,
  isTrivialTrueCond: (n: CstNodeLike | null | undefined) => boolean,
): string[] | null {
  const base = stripTrailingSemicolon(rawFallback);
  if (!base) return null;
  const root = parseStandaloneMoCst(`model _M\n  ${base};\nend _M;`);
  if (!root) return null;
  const clause = findFirstCstNode(root, (n) => n.type === "component_clause" || n.type === "component_clause1");
  if (!clause || cstHasError(clause as unknown as SyntaxNode)) return null;
  const tokens: string[] = [];
  const collect = (n: CstNodeLike): void => {
    const t = n.type ?? "";
    if (TRIVIA_COMMENT_TYPES.has(t)) return;
    if (isTrivialTrueCond(n)) return;
    if (
      stripDescAndAnn &&
      (t === "comment" ||
        t === "Comment" ||
        t === "string_comment" ||
        t === "StringComment" ||
        t === "description" ||
        t === "Description" ||
        t === "description_string" ||
        t === "DescriptionString" ||
        t === "annotation" ||
        t === "Annotation" ||
        t === "annotation_clause")
    ) {
      return;
    }
    if (!Array.isArray(n.children) || n.children.length === 0) {
      const txt = n.text?.trim();
      if (txt && txt !== ";") tokens.push(txt);
      return;
    }
    for (const c of n.children) collect(c);
  };
  collect(clause);
  return tokens;
}

export function extractBuiltinSinCosCalleeCst(externalDecl: string): "sin" | "cos" | null {
  const base = stripTrailingSemicolon(externalDecl);
  if (!base) return null;
  const root = parseStandaloneMoCst(`function _f\n  ${base};\nend _f;`);
  if (!root) return null;
  const ext = findFirstCstNode(root, (n) => n.type === "external_clause");
  if (!ext) return null;
  const langNode = ext.children?.find(
    (c) => c.type === "language_specification" || c.type === "string_literal" || c.type === "STRING",
  );
  const langStr = langNode ? stripOuterDoubleQuotes(langNode.text?.trim() ?? "") : "";
  if (langStr !== "builtin" && langStr !== "C") return null;
  const extCall = findFirstCstNode(ext, (n) => n.type === "external_function_call");
  if (!extCall) return null;
  if (langStr === "C" && /\(\s*\)/.test(extCall.text ?? "")) return null;
  const leaves = collectCstLeafTexts(extCall, { skipStrings: true });
  const eqIdx = leaves.indexOf("=");
  const callee = eqIdx >= 0 ? leaves[eqIdx + 1] : leaves[0];
  return callee === "sin" || callee === "cos" ? callee : null;
}

export function findDeclElementModificationValueCst(
  modRoot: CstNodeLike | null | undefined,
  modName: string,
): string | undefined {
  if (!modRoot) return undefined;
  let found: string | undefined;
  const visit = (n: CstNodeLike): void => {
    if (found !== undefined) return;
    if (n !== modRoot && n.type === "class_definition") return;
    if (n.type === "element_modification" || n.type === "named_argument") {
      const nameNode = n.children?.find((c) => c.type === "name" || c.type === "identifier");
      if (nameNode?.text?.trim() === modName) {
        const modNode = n.children?.find((c) => c.type === "modification") ?? n;
        const valNode =
          modNode.children?.find(
            (c) =>
              c.type === "modification_expression" ||
              c.type === "expression" ||
              c.type === "simple_expression" ||
              c.type === "string_literal" ||
              c.type === "STRING",
          ) ??
          (() => {
            const kids = modNode.children ?? [];
            const eqIdx = kids.findIndex((c) => c.text?.trim() === "=");
            return eqIdx >= 0 ? kids.slice(eqIdx + 1).find((c) => c.type !== "comment") : undefined;
          })();
        if (valNode?.text) {
          found = valNode.text.trim();
          return;
        }
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(modRoot);
  return found;
}

export function extractNamedOrModArgValueCst(valText: string, fieldName: string): string | undefined {
  let trimmed = valText.trim();
  if (trimmed.startsWith("=")) trimmed = trimmed.slice(1).trim();
  if (!trimmed) return undefined;
  const identEnd = readAsciiIdentEnd(trimmed, 0);
  let afterIdent = identEnd;
  while (afterIdent < trimmed.length && isAsciiWhitespaceCode(trimmed.charCodeAt(afterIdent))) afterIdent++;
  const declSnippet = trimmed.startsWith("(")
    ? `_T _x${trimmed}`
    : identEnd > 0 && trimmed[afterIdent] === "("
      ? `_T _x = ${trimmed}`
      : `_T _x(${trimmed})`;
  const root = parseStandaloneMoCst(`model _M\n  ${declSnippet};\nend _M;`);
  if (!root) return undefined;
  const targetNode = findFirstCstNode(root, (n) => n.type === "component_clause" || n.type === "class_definition");
  return findDeclElementModificationValueCst(targetNode ?? root, fieldName);
}

export function extractFirstDeclToken(text: string | undefined): string {
  if (!text) return "";
  const trimmed = text.trimStart();
  if (!trimmed) return "";
  if (trimmed.startsWith("'")) {
    const end = consumeStringOrCommentEnd(trimmed, 0);
    return trimmed.slice(0, end);
  }
  return firstAsciiToken(trimmed);
}
