// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - CST node traversal, unwrapping, standalone parsing, and call/binding extractors.
 */

import { UnifiedWorkspace } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../../src-gen/bindings.js";
import {
  collapseAsciiWhitespace,
  isAsciiIdentContinue,
  isAsciiIdentifier,
  isAsciiIdentStart,
  isAsciiWhitespaceCode,
} from "../../../ascii.js";
import { getShortClassSpecifierNode } from "../../../queries.js";
import type { FlattenerCstNode } from "../../types.js";
import {
  containsWholeWordOutsideStrings,
  isDottedIdentifierChain,
  stripComments,
  stripLeadingDot,
  stripOuterDoubleQuotes,
  tokenizeCommentStrippedWords,
} from "./text-scanning.js";

export function flattenColonNodes(n: SyntaxNode | FlattenerCstNode | null | undefined): SyntaxNode[] {
  if (!n) return [];
  let curr: SyntaxNode | null | undefined = n as SyntaxNode;
  while (curr && curr.childCount === 1) curr = curr.child(0);
  if (!curr) return [];
  if (curr.childCount === 3 && Cst.kind(curr.child(0)) === "(" && Cst.kind(curr.child(2)) === ")") {
    return flattenColonNodes(curr.child(1));
  }
  if (curr.childCount === 3) {
    const op = stripOuterDoubleQuotes(curr.child(1)?.text?.trim() ?? curr.child(1)?.type ?? "");
    if (op === ":") {
      return [...flattenColonNodes(curr.child(0)), ...flattenColonNodes(curr.child(2))];
    }
  }
  return [curr];
}

export function getArrayLiteralItems(node: SyntaxNode | FlattenerCstNode | null | undefined): SyntaxNode[] {
  if (!node) return [];
  const root = node as SyntaxNode;
  if (root.type === "expression_list") {
    const items: SyntaxNode[] = [];
    for (let i = 0; i < root.childCount; i++) {
      const c = root.child(i);
      if (!c) continue;
      if (Cst.kind(c) === ",") continue;
      items.push(c);
    }
    return items;
  }
  const text = root.text?.trim() ?? "";
  if (
    (root.child(0)?.text === "[" || text.startsWith("[")) &&
    (root.child(root.childCount - 1)?.text === "]" || text.endsWith("]"))
  ) {
    const rows: SyntaxNode[] = [];
    let hasSemicolon = false;
    for (let i = 0; i < root.childCount; i++) {
      const c = root.child(i);
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
  const items: SyntaxNode[] = [];
  const walk = (n: SyntaxNode | null | undefined) => {
    if (!n) return;
    if (n.type === "array_arguments" || n.type === "array_arguments_non_first") {
      const firstChild = n.child(0);
      if (firstChild) items.push(firstChild);
      if (n.childCount >= 3) walk(n.child(2));
      return;
    }
    for (let i = 0; i < n.childCount; i++) {
      walk(n.child(i));
    }
  };
  walk(root);
  if (items.length === 0) {
    const collectFallback = (n: SyntaxNode | null | undefined) => {
      if (!n) return;
      const t = n.text?.trim() ?? "";
      if (t === "{" || t === "}" || t === ",") return;
      if (
        n.type === "expression" ||
        n.type === "primary" ||
        n.type === "unsigned_number" ||
        n.type === "unsigned_integer"
      ) {
        const c0 = n.child(0);
        if (n.childCount === 1 && c0 && (c0.type === "expression" || c0.type === "primary")) {
          collectFallback(c0);
          return;
        }
        items.push(n);
        return;
      }
      for (let i = 0; i < n.childCount; i++) collectFallback(n.child(i));
    };
    collectFallback(root);
  }
  return items;
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
export function unwrapParenExprCst(node: SyntaxNode | FlattenerCstNode | null | undefined): SyntaxNode | null {
  let cur: SyntaxNode | null | undefined = node as SyntaxNode | null | undefined;
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
export function extractComponentNameFromClauseCst(
  compClauseNode: SyntaxNode | FlattenerCstNode | null | undefined,
): string | null {
  if (!compClauseNode) return null;
  const clause = compClauseNode as SyntaxNode;
  const compList =
    Cst.ComponentClause.componentList(clause) ?? clause.children.find((c) => c.type === "component_list") ?? null;
  const compDecl =
    (compList ? Cst.ComponentList.componentDeclaration(compList) : null) ??
    compList?.children.find((c) => c.type === "component_declaration") ??
    clause.children.find((c) => c.type === "component_declaration") ??
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
    const rootNode = tree?.rootNode as unknown as SyntaxNode | undefined;
    if (!rootNode || cstHasError(rootNode)) {
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
    const rhs = findRhs(rootNode);
    const valid =
      rhs && rhs.startOffset === prefix.length && rhs.endOffset <= prefix.length + trimmed.length ? rhs : null;
    if (standaloneExprCstCache.size >= STANDALONE_EXPR_CACHE_LIMIT) standaloneExprCstCache.clear();
    standaloneExprCstCache.set(trimmed, { tree, node: valid });
    return valid;
  } catch {
    return null;
  }
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
