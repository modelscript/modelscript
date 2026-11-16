// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import type { QueryEngine } from "@modelscript/runtime/wasm_query_engine.js";

// ---------------------------------------------------------------------------
// Shared Modelica Lexical & CST Helpers
// ---------------------------------------------------------------------------

const MODELICA_ELEMENT_PREFIXES = new Set(["redeclare", "final", "inner", "outer", "replaceable"]);

const MODELICA_COMPONENT_PREFIXES = new Set([
  "final",
  "inner",
  "outer",
  "replaceable",
  "redeclare",
  "flow",
  "stream",
  "discrete",
  "parameter",
  "constant",
  "input",
  "output",
]);

const MODELICA_CLASS_MODIFIERS = new Set(["encapsulated", "partial", "expandable"]);

const MODELICA_CLASS_KINDS = new Set([
  "class",
  "model",
  "record",
  "block",
  "connector",
  "package",
  "function",
  "type",
  "operator",
]);

const MODELICA_CLAUSE_STOP_KEYWORDS = new Set([...MODELICA_CLASS_KINDS, "within", "extends", "equation", "algorithm"]);

function isIdentStartChar(ch: string): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function isIdentChar(ch: string): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function isWsChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\v" || ch === "\f";
}

function skipWs(src: string, idx: number): number {
  let i = idx;
  while (i < src.length && isWsChar(src[i]!)) i++;
  return i;
}

function trimEndHorizontalWs(str: string): string {
  let end = str.length;
  while (end > 0 && (str[end - 1] === " " || str[end - 1] === "\t")) end--;
  return end === str.length ? str : str.slice(0, end);
}

function stripWs(str: string): string {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!;
    if (!isWsChar(ch)) out += ch;
  }
  return out;
}

function collapseWs(str: string): string {
  let out = "";
  let inWs = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!;
    if (isWsChar(ch)) {
      if (out.length > 0) inWs = true;
    } else {
      if (inWs) {
        out += " ";
        inWs = false;
      }
      out += ch;
    }
  }
  return out;
}

function normalizeHeaderWhitespace(str: string): string {
  return str
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function stripTrailingSemicolon(str: string): string {
  let s = str.trim();
  if (s.endsWith(";")) {
    s = s.slice(0, -1).trimEnd();
  }
  return s;
}

function normalizeTrailingSemicolon(str: string): string {
  const trimmed = str.trim();
  if (trimmed.endsWith(";")) {
    return `${trimmed.slice(0, -1).trimEnd()};`;
  }
  return trimmed;
}

function ensureTrailingSemicolon(str: string): string {
  const trimmed = str.trim();
  if (!trimmed) return "";
  return trimmed.endsWith(";") ? `${trimmed.slice(0, -1).trimEnd()};` : `${trimmed};`;
}

function splitQualifiedPath(str: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === ".") {
      if (i > start) parts.push(str.slice(start, i));
      start = i + 1;
    } else if (str[i] === ":" && str[i + 1] === ":") {
      if (i > start) parts.push(str.slice(start, i));
      start = i + 2;
      i++;
    }
  }
  if (start < str.length) parts.push(str.slice(start));
  return parts;
}

function isWordBoundaryAt(src: string, idx: number, len: number): boolean {
  const prev = idx > 0 ? src[idx - 1]! : "";
  const next = idx + len < src.length ? src[idx + len]! : "";
  return !isIdentChar(prev) && !isIdentChar(next);
}

function startsWithWordAt(src: string, idx: number, word: string, caseInsensitive = false): boolean {
  if (idx + word.length > src.length) return false;
  const slice = src.slice(idx, idx + word.length);
  const matches = caseInsensitive ? slice.toLowerCase() === word.toLowerCase() : slice === word;
  return matches && isWordBoundaryAt(src, idx, word.length);
}

function skipModelicaString(src: string, idx: number): number {
  if (src[idx] !== '"') return idx;
  let i = idx + 1;
  while (i < src.length) {
    if (src[i] === "\\") i += 2;
    else if (src[i] === '"') return i + 1;
    else i++;
  }
  return i;
}

function skipModelicaConcatString(src: string, idx: number): number {
  let i = skipModelicaString(src, idx);
  if (i === idx) return idx;
  while (true) {
    const plusIdx = skipWs(src, i);
    if (src[plusIdx] === "+") {
      const nextStr = skipWs(src, plusIdx + 1);
      if (src[nextStr] === '"') {
        i = skipModelicaString(src, nextStr);
        continue;
      }
    }
    break;
  }
  return i;
}

function skipModelicaTrivia(src: string, idx: number): number {
  let i = idx;
  const len = src.length;
  while (i < len) {
    const ch = src[i]!;
    if (isWsChar(ch)) {
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      i += 2;
      while (i < len && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < len && !(src[i] === "*" && src[i + 1] === "/")) i++;
      if (i < len) i += 2;
      continue;
    }
    break;
  }
  return i;
}

function readIdentAt(src: string, idx: number): { ident: string; end: number } | null {
  if (idx >= src.length) return null;
  if (src[idx] === "'") {
    let i = idx + 1;
    while (i < src.length) {
      if (src[i] === "\\") i += 2;
      else if (src[i] === "'") return { ident: src.slice(idx, i + 1), end: i + 1 };
      else i++;
    }
    return null;
  }
  if (!isIdentStartChar(src[idx]!)) return null;
  let end = idx + 1;
  while (end < src.length && isIdentChar(src[end]!)) end++;
  return { ident: src.slice(idx, end), end };
}

function readQualifiedNameAt(src: string, idx: number): { name: string; end: number } | null {
  let pos = idx;
  let prefix = "";
  if (src[pos] === ".") {
    prefix = ".";
    pos++;
  }
  const first = readIdentAt(src, pos);
  if (!first) return null;
  let end = first.end;
  let name = prefix + first.ident;
  while (end < src.length) {
    if (src[end] === ".") {
      const next = readIdentAt(src, end + 1);
      if (!next) break;
      name += `.${next.ident}`;
      end = next.end;
    } else if (src[end] === ":" && src[end + 1] === ":") {
      const next = readIdentAt(src, end + 2);
      if (!next) break;
      name += `::${next.ident}`;
      end = next.end;
    } else {
      break;
    }
  }
  return { name, end };
}

function findWordOutsideStringsComments(src: string, word: string, maxOffset = src.length): number {
  const limit = Math.min(src.length, maxOffset);
  let i = 0;
  while (i < limit) {
    const ch = src[i]!;
    if (ch === '"') {
      i = skipModelicaString(src, i);
      continue;
    }
    if (ch === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) {
      i = skipModelicaTrivia(src, i);
      continue;
    }
    if (startsWithWordAt(src, i, word)) {
      return i;
    }
    i++;
  }
  return -1;
}

function matchTrailingEndClass(src: string, className: string): number {
  let end = src.length;
  while (end > 0 && isWsChar(src[end - 1]!)) end--;
  if (end > 0 && src[end - 1] === ";") end--;
  while (end > 0 && isWsChar(src[end - 1]!)) end--;
  if (end < className.length) return -1;
  const nameStart = end - className.length;
  if (src.slice(nameStart, end) !== className) return -1;
  if (nameStart === 0 || !isWsChar(src[nameStart - 1]!)) return -1;
  let endKeywordEnd = nameStart;
  while (endKeywordEnd > 0 && isWsChar(src[endKeywordEnd - 1]!)) endKeywordEnd--;
  if (endKeywordEnd < 3) return -1;
  const endKeywordStart = endKeywordEnd - 3;
  if (src.slice(endKeywordStart, endKeywordEnd) !== "end") return -1;
  if (endKeywordStart > 0 && isIdentChar(src[endKeywordStart - 1]!)) return -1;
  return endKeywordStart;
}

function matchNestedLongClassStart(body: string, startIdx: number): { name: string; end: number } | null {
  if (startsWithWordAt(body, startIdx, "replaceable")) return null;
  let i = startIdx;
  while (i < body.length) {
    const tok = readIdentAt(body, i);
    if (!tok) return null;
    if (MODELICA_CLASS_MODIFIERS.has(tok.ident)) {
      const nextIdx = skipWs(body, tok.end);
      if (nextIdx === tok.end) return null;
      i = nextIdx;
      continue;
    }
    if ((tok.ident === "pure" || tok.ident === "impure") && startsWithWordAt(body, skipWs(body, tok.end), "function")) {
      i = skipWs(body, tok.end);
      continue;
    }
    if (!MODELICA_CLASS_KINDS.has(tok.ident)) return null;
    i = skipWs(body, tok.end);
    if (i === tok.end) return null;
    if (tok.ident === "operator") {
      const sub = readIdentAt(body, i);
      if (sub && (sub.ident === "record" || sub.ident === "function")) {
        const afterSub = skipWs(body, sub.end);
        if (afterSub === sub.end) return null;
        i = afterSub;
      }
    }
    const nameTok = readIdentAt(body, i);
    if (!nameTok) return null;
    const afterName = skipWs(body, nameTok.end);
    if (body[afterName] === "=") return null;
    return { name: nameTok.ident, end: nameTok.end };
  }
  return null;
}

function parseModelicaClausePrefixTokens(
  trimmedClause: string,
): { fullPrefix: string; typePrefix: string; typeSpecifier: string } | null {
  let idx = 0;
  const prefixes: string[] = [];
  while (idx < trimmedClause.length) {
    idx = skipWs(trimmedClause, idx);
    const tok = readIdentAt(trimmedClause, idx);
    if (tok) {
      const afterTok = skipWs(trimmedClause, tok.end);
      const hasSeparator = trimmedClause[afterTok] === "." || trimmedClause.startsWith("::", afterTok);
      if (!hasSeparator && MODELICA_COMPONENT_PREFIXES.has(tok.ident)) {
        prefixes.push(tok.ident);
        idx = tok.end;
        continue;
      }
    }
    const qual = readQualifiedNameAt(trimmedClause, idx);
    if (!qual) return null;
    const typePrefix = prefixes.join(" ");
    const typeSpecifier = qual.name;
    return {
      fullPrefix: typePrefix ? `${typePrefix} ${typeSpecifier}` : typeSpecifier,
      typePrefix,
      typeSpecifier,
    };
  }
  return null;
}

function extractTrailingModelicaString(src: string): string | null {
  let i = 0;
  const len = src.length;
  while (i < len) {
    const ch = src[i]!;
    if (ch === '"') {
      const chainEnd = skipModelicaConcatString(src, i);
      if (skipWs(src, chainEnd) === len) {
        return src.slice(i, chainEnd);
      }
      i = chainEnd;
      continue;
    }
    if (ch === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) {
      i = skipModelicaTrivia(src, i);
      continue;
    }
    i++;
  }
  return null;
}

function pushFormattedMemberLines(memberLines: string[], cleanedStmt: string): void {
  const stmtLines = cleanedStmt
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (stmtLines.length === 2 && stmtLines[1]!.startsWith('"')) {
    memberLines.push(`  ${stmtLines[0]} ${stmtLines[1]}`);
  } else if (stmtLines.length > 1) {
    memberLines.push(stmtLines.map((l, idx) => (idx === 0 ? `  ${l}` : `      ${l}`)).join("\n"));
  } else if (stmtLines.length === 1) {
    memberLines.push(`  ${stmtLines[0]}`);
  }
}

function assembleClassSignature(header: string, memberLines: string[], className: string): string {
  const MAX_MEMBERS = 15;
  let bodyLines = memberLines;
  if (memberLines.length > MAX_MEMBERS) {
    bodyLines = [
      ...memberLines.slice(0, MAX_MEMBERS),
      `  // ... (${memberLines.length - MAX_MEMBERS} more declarations)`,
    ];
  }
  if (bodyLines.length > 0) {
    return `${header}\n${bodyLines.join("\n")}\nend ${className};`;
  }
  return `${header}\nend ${className};`;
}

function getNodeStartOffset(node: SyntaxNode): number {
  return (node as any).startOffset ?? node.startIndex;
}

function getNodeEndOffset(node: SyntaxNode): number {
  return (node as any).endOffset ?? node.endIndex;
}

function findAncestorOrSelfByType(
  node: SyntaxNode | null,
  targetTypes: readonly string[],
  stopTypes: readonly string[] = [],
): SyntaxNode | null {
  let curr: SyntaxNode | null = node;
  let depth = 0;
  while (curr && depth < 16) {
    if (targetTypes.includes(curr.type)) return curr;
    if (stopTypes.includes(curr.type)) return null;
    curr = curr.parent;
    depth++;
  }
  return null;
}

function findModelicaClassSpecNode(classNode: SyntaxNode): SyntaxNode | null {
  const specWrapper = classNode.childForFieldName("class_specifier");
  if (specWrapper) {
    if (
      specWrapper.type === "long_class_specifier" ||
      specWrapper.type === "short_class_specifier" ||
      specWrapper.type === "der_class_specifier"
    ) {
      return specWrapper;
    }
    for (const child of specWrapper.namedChildren) {
      if (
        child.type === "long_class_specifier" ||
        child.type === "short_class_specifier" ||
        child.type === "der_class_specifier"
      ) {
        return child;
      }
    }
  }
  for (const child of classNode.namedChildren) {
    if (
      child.type === "long_class_specifier" ||
      child.type === "short_class_specifier" ||
      child.type === "der_class_specifier"
    ) {
      return child;
    }
  }
  return null;
}

function collectAnnotationClauseSpans(
  node: SyntaxNode,
  baseStart: number,
  out: Array<{ start: number; end: number }>,
): void {
  if (node.type === "annotation_clause") {
    out.push({
      start: Math.max(0, getNodeStartOffset(node) - baseStart),
      end: Math.max(0, getNodeEndOffset(node) - baseStart),
    });
    return;
  }
  for (const child of node.namedChildren) {
    collectAnnotationClauseSpans(child, baseStart, out);
  }
}

function stripAnnotationClausesFromCst(node: SyntaxNode, fallbackStripper: (s: string) => string): string {
  const text = node.text ?? "";
  if (!text) return "";
  if (node.hasError) return fallbackStripper(text);
  const baseStart = getNodeStartOffset(node);
  const spans: Array<{ start: number; end: number }> = [];
  collectAnnotationClauseSpans(node, baseStart, spans);
  if (spans.length === 0) return text;

  spans.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    const start = Math.max(cursor, Math.min(span.start, text.length));
    const end = Math.max(start, Math.min(span.end, text.length));
    out += text.slice(cursor, start);
    out = trimEndHorizontalWs(out);
    cursor = end;
  }
  out += text.slice(cursor);
  return out;
}

function collectClassAnnotationClauses(classNode: SyntaxNode): SyntaxNode[] {
  const specNode = findModelicaClassSpecNode(classNode);
  if (!specNode) return [];
  const results: SyntaxNode[] = [];
  if (specNode.type === "long_class_specifier") {
    const compNode = specNode.childForFieldName("composition");
    if (compNode) {
      for (const child of compNode.namedChildren) {
        if (child.type === "annotation_clause") {
          results.push(child);
        } else if (
          child.type === "element_list" ||
          child.type === "equation_section" ||
          child.type === "algorithm_section" ||
          child.type === "external_clause"
        ) {
          for (const sub of child.namedChildren) {
            if (sub.type === "annotation_clause") {
              results.push(sub);
            }
          }
        }
      }
    }
  } else if (specNode.type === "short_class_specifier" || specNode.type === "der_class_specifier") {
    const descNode = specNode.childForFieldName("description");
    if (descNode) {
      for (const child of descNode.namedChildren) {
        if (child.type === "annotation_clause") {
          results.push(child);
        }
      }
    }
  }
  return results;
}

function findElementModificationByName(classModNode: SyntaxNode | null, targetLower: string): SyntaxNode | null {
  if (!classModNode) return null;
  const stack: SyntaxNode[] = [classModNode];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    for (const child of curr.namedChildren) {
      if (child.type === "element_modification") {
        const modName = child.childForFieldName("name")?.text.trim().toLowerCase();
        if (modName === targetLower) return child;
      } else if (
        child.type === "argument_list" ||
        child.type === "argument" ||
        child.type === "element_modification_or_replaceable"
      ) {
        stack.push(child);
      }
    }
  }
  return null;
}

const IDENTIFIER_LEAF_NODE_TYPES = new Set([
  "identifier",
  "IDENT",
  "Identifier",
  "ID",
  "simple_name",
  "SimpleName",
  "name",
]);

function extractWordSpanAtOffset(
  text: string,
  byteOffset: number,
  cstRoot?: SyntaxNode | null,
): { word: string; start: number; end: number } | null {
  if (cstRoot && !cstRoot.hasError && text.length > 0) {
    const probeOffset =
      byteOffset < text.length && isIdentChar(text[byteOffset]!)
        ? byteOffset
        : byteOffset > 0 && isIdentChar(text[byteOffset - 1]!)
          ? byteOffset - 1
          : -1;
    if (probeOffset >= 0) {
      try {
        const leaf = cstRoot.descendantForIndex(probeOffset, probeOffset);
        if (leaf && !leaf.hasError && leaf.namedChildCount === 0 && IDENTIFIER_LEAF_NODE_TYPES.has(leaf.type)) {
          const s = getNodeStartOffset(leaf);
          const e = getNodeEndOffset(leaf);
          if (e > s && s >= 0 && e <= text.length && byteOffset >= s && byteOffset <= e) {
            let allIdent = true;
            for (let i = s; i < e; i++) {
              if (!isIdentChar(text[i]!)) {
                allIdent = false;
                break;
              }
            }
            if (allIdent) {
              return { word: text.slice(s, e), start: s, end: e };
            }
          }
        }
      } catch {
        // fallback to lexical scan
      }
    }
  }

  let ws = byteOffset;
  if (ws > 0 && (ws >= text.length || !isIdentChar(text[ws]!)) && isIdentChar(text[ws - 1]!)) {
    ws--;
  }
  while (ws > 0 && isIdentChar(text[ws - 1]!)) ws--;
  let we = ws;
  while (we < text.length && isIdentChar(text[we]!)) we++;
  if (ws >= we || byteOffset < ws || byteOffset > we) {
    return null;
  }
  return { word: text.slice(ws, we), start: ws, end: we };
}

function isQualifiedIdentChainSlice(text: string, start: number, end: number): boolean {
  if (start >= end || !isIdentChar(text[start]!) || !isIdentChar(text[end - 1]!)) return false;
  let i = start;
  while (i < end) {
    if (isIdentChar(text[i]!)) {
      i++;
      continue;
    }
    if (text[i] === "." && i > start && i + 1 < end && isIdentChar(text[i - 1]!) && isIdentChar(text[i + 1]!)) {
      i++;
      continue;
    }
    if (
      text[i] === ":" &&
      text[i + 1] === ":" &&
      i > start &&
      i + 2 < end &&
      isIdentChar(text[i - 1]!) &&
      isIdentChar(text[i + 2]!)
    ) {
      i += 2;
      continue;
    }
    return false;
  }
  return true;
}

function extractQualifiedPrefixAtOffset(
  text: string,
  wordStart: number,
  wordEnd: number,
  cstRoot?: SyntaxNode | null,
): string {
  if (cstRoot && !cstRoot.hasError) {
    try {
      const leaf = cstRoot.descendantForIndex(wordStart, wordEnd);
      const qualNode = findAncestorOrSelfByType(
        leaf,
        ["type_specifier", "name", "component_reference", "QualifiedName", "FeatureChainExpression"],
        ["element", "equation_section", "algorithm_section", "composition", "class_definition", "stored_definition"],
      );
      if (qualNode && !qualNode.hasError) {
        let qStart = getNodeStartOffset(qualNode);
        if (qStart < wordEnd && text[qStart] === ".") qStart++;
        if (
          qStart >= 0 &&
          qStart <= wordStart &&
          wordEnd <= text.length &&
          isQualifiedIdentChainSlice(text, qStart, wordEnd)
        ) {
          return text.slice(qStart, wordEnd);
        }
      }
    } catch {
      // fallback to lexical backward scan
    }
  }

  let qStart = wordStart;
  while (qStart > 0) {
    if (text[qStart - 1] === "." && qStart >= 2 && isIdentChar(text[qStart - 2]!)) {
      qStart--;
      while (qStart > 0 && isIdentChar(text[qStart - 1]!)) qStart--;
    } else if (qStart >= 3 && text[qStart - 1] === ":" && text[qStart - 2] === ":" && isIdentChar(text[qStart - 3]!)) {
      qStart -= 2;
      while (qStart > 0 && isIdentChar(text[qStart - 1]!)) qStart--;
    } else {
      break;
    }
  }
  return text.slice(qStart, wordEnd);
}

function extractDotAccessVarBefore(before: string, cstRoot?: SyntaxNode | null): string | null {
  if (cstRoot && !cstRoot.hasError && before.length > 0) {
    try {
      const node = cstRoot.descendantForIndex(before.length - 1, before.length - 1);
      const compRef = findAncestorOrSelfByType(
        node,
        ["component_reference", "FeatureChainExpression"],
        ["equation", "statement", "element", "expression"],
      );
      if (compRef && !compRef.hasError) {
        const relEnd = Math.min(compRef.text.length, before.length - getNodeStartOffset(compRef));
        if (relEnd > 0) {
          const slice = compRef.text.slice(0, relEnd);
          const dotIdx = slice.lastIndexOf(".");
          if (dotIdx > 0) {
            const left = slice.slice(0, dotIdx).trim();
            const tok = readIdentAt(left, 0);
            if (tok && tok.end === left.length) {
              return tok.ident;
            }
          }
        }
      }
    } catch {
      // fallback to lexical backward scan
    }
  }

  let i = before.length;
  while (i > 0 && isIdentChar(before[i - 1]!)) i--;
  if (i < before.length && !isIdentStartChar(before[i]!)) {
    return null;
  }
  while (i > 0 && isWsChar(before[i - 1]!)) i--;
  if (i === 0 || before[i - 1] !== ".") return null;
  i--;
  while (i > 0 && isWsChar(before[i - 1]!)) i--;
  const varEnd = i;
  while (i > 0 && isIdentChar(before[i - 1]!)) i--;
  if (i >= varEnd || !isIdentStartChar(before[i]!)) return null;
  return before.slice(i, varEnd);
}

function isQualifiedTypeChar(ch: string): boolean {
  return isIdentChar(ch) || ch === "." || ch === ":";
}

function extractModificationTargetType(
  beforeParen: string,
  allowExtends: boolean,
  cstRoot?: SyntaxNode | null,
  parenOffset?: number,
): string | null {
  if (cstRoot && parenOffset !== undefined) {
    try {
      const probe = cstRoot.descendantForIndex(parenOffset, parenOffset);
      const classMod = findAncestorOrSelfByType(probe, ["class_modification"], ["element_list", "composition"]);
      const modNode = classMod?.parent?.type === "modification" ? classMod.parent : classMod;
      const declOrExt = modNode?.parent;
      if (declOrExt) {
        if (allowExtends && declOrExt.type === "extends_clause") {
          const targetNode = declOrExt.childForFieldName("type") ?? declOrExt.childForFieldName("name");
          if (targetNode && !targetNode.hasError) {
            const cleaned = stripWs(targetNode.text);
            if (cleaned) return cleaned;
          }
        }
        const declNode =
          declOrExt.type === "declaration" && declOrExt.parent?.type === "component_declaration"
            ? declOrExt.parent
            : declOrExt;
        if (declNode.type === "component_declaration" && declNode.parent?.type === "component_clause") {
          const typeNode = declNode.parent.childForFieldName("type_specifier");
          if (typeNode && !typeNode.hasError) {
            const cleaned = stripWs(typeNode.text);
            if (cleaned) return cleaned;
          }
        } else if (declNode.type === "component_clause1") {
          const typeNode = declNode.childForFieldName("type_specifier");
          if (typeNode && !typeNode.hasError) {
            const cleaned = stripWs(typeNode.text);
            if (cleaned) return cleaned;
          }
        }
      }
    } catch {
      // fallback to lexical backward scan
    }
  }

  let i = beforeParen.length;
  if (i === 0) return null;

  if (allowExtends) {
    const extTargetEnd = i;
    let j = i;
    while (j > 0 && isQualifiedTypeChar(beforeParen[j - 1]!)) j--;
    if (j < extTargetEnd && isIdentStartChar(beforeParen[j]!)) {
      let wsEnd = j;
      while (wsEnd > 0 && isWsChar(beforeParen[wsEnd - 1]!)) wsEnd--;
      if (
        wsEnd < j &&
        wsEnd >= 7 &&
        beforeParen.slice(wsEnd - 7, wsEnd) === "extends" &&
        (wsEnd === 7 || !isIdentChar(beforeParen[wsEnd - 8]!))
      ) {
        return beforeParen.slice(j, extTargetEnd);
      }
    }
  }

  // Optional trailing array subscripts: `[...]`
  if (i > 0 && beforeParen[i - 1] === "]") {
    const openBracket = beforeParen.lastIndexOf("[", i - 2);
    if (openBracket === -1) return null;
    i = openBracket;
    while (i > 0 && isWsChar(beforeParen[i - 1]!)) i--;
  }

  // Trailing identifier (`varName`)
  const varEnd = i;
  while (i > 0 && isIdentChar(beforeParen[i - 1]!)) i--;
  if (i >= varEnd || !isIdentStartChar(beforeParen[i]!)) return null;

  // At least one whitespace separator
  const wsEnd = i;
  while (i > 0 && isWsChar(beforeParen[i - 1]!)) i--;
  if (i >= wsEnd) return null;

  // Preceding qualified type name (`[a-zA-Z_][a-zA-Z0-9_.:]*`)
  const typeEnd = i;
  while (i > 0 && isQualifiedTypeChar(beforeParen[i - 1]!)) i--;
  if (i >= typeEnd || !isIdentStartChar(beforeParen[i]!)) return null;
  return beforeParen.slice(i, typeEnd);
}

function stripOuterQuotes(str: string): string {
  let start = 0;
  let end = str.length;
  if (end > start && str[start] === '"') start++;
  if (end > start && str[end - 1] === '"') end--;
  return str.slice(start, end);
}

function stripSysmlDocBlocks(src: string): string {
  let out = "";
  let i = 0;
  const len = src.length;
  while (i < len) {
    const ch = src[i]!;
    if (ch === '"' || ch === "'") {
      const q = ch;
      let j = i + 1;
      while (j < len) {
        if (src[j] === "\\") j += 2;
        else if (src[j] === q) {
          j++;
          break;
        } else j++;
      }
      out += src.slice(i, j);
      i = j;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      let j = i + 2;
      while (j < len && src[j] !== "\n") j++;
      out += src.slice(i, j);
      i = j;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const closeIdx = src.indexOf("*/", i + 2);
      const end = closeIdx === -1 ? len : closeIdx + 2;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "d" && startsWithWordAt(src, i, "doc")) {
      const afterDoc = skipWs(src, i + 3);
      if (src[afterDoc] === "/" && src[afterDoc + 1] === "*") {
        const closeIdx = src.indexOf("*/", afterDoc + 2);
        if (closeIdx !== -1) {
          let end = skipWs(src, closeIdx + 2);
          if (src[end] === ";") end++;
          i = end;
          continue;
        }
      }
    }
    out += ch;
    i++;
  }
  return out;
}

function stripTrailingStringCommentAndSemi(str: string, _declNode?: SyntaxNode | null): string {
  let s = str.trimEnd();
  if (s.endsWith(";")) {
    s = s.slice(0, -1).trimEnd();
  }
  if (s.endsWith('"')) {
    const openIdx = s.lastIndexOf('"', s.length - 2);
    if (openIdx !== -1) {
      let beforeQuote = s.slice(0, openIdx).trimEnd();
      if (beforeQuote.endsWith(";")) {
        beforeQuote = beforeQuote.slice(0, -1).trimEnd();
      }
      return beforeQuote.trim();
    }
  }
  return stripTrailingSemicolon(s);
}

function stripCommentBlockBody(rawBody: string): string {
  let start = 0;
  while (start < rawBody.length && rawBody[start] === "*") start++;
  return rawBody
    .slice(start)
    .split("\n")
    .map((line) => {
      let i = 0;
      while (i < line.length && isWsChar(line[i]!)) i++;
      if (line[i] === "*") {
        i++;
        if (i < line.length && isWsChar(line[i]!)) i++;
      } else {
        i = 0;
      }
      return line.slice(i).trimEnd();
    })
    .join("\n")
    .trim();
}

function extractLeadingCommentDoc(beforeDecl: string): string | null {
  const closeIdx = beforeDecl.lastIndexOf("*/");
  if (closeIdx !== -1) {
    const tail = beforeDecl.slice(closeIdx + 2);
    let sawNewline = false;
    let onlyIndent = true;
    for (let i = 0; i < tail.length; i++) {
      const ch = tail[i]!;
      if (ch === "\n") {
        if (sawNewline) {
          onlyIndent = false;
          break;
        }
        sawNewline = true;
      } else if (ch !== " " && ch !== "\t" && ch !== "\r") {
        onlyIndent = false;
        break;
      }
    }
    if (onlyIndent) {
      const openIdx = beforeDecl.lastIndexOf("/*", closeIdx);
      if (openIdx !== -1) {
        const rawComment = stripCommentBlockBody(beforeDecl.slice(openIdx + 2, closeIdx));
        if (rawComment && !rawComment.includes("SPDX-License-Identifier")) {
          return rawComment;
        }
      }
      return null;
    }
  }

  const linesBefore = beforeDecl.replaceAll("\r\n", "\n").split("\n");
  if (linesBefore.length > 0 && linesBefore[linesBefore.length - 1]!.trim() === "") {
    linesBefore.pop();
  }
  const docLines: string[] = [];
  for (let i = linesBefore.length - 1; i >= 0; i--) {
    const line = linesBefore[i]!.trim();
    if (line.startsWith("//")) {
      let j = 0;
      while (j < line.length && line[j] === "/") j++;
      if (j < line.length && isWsChar(line[j]!)) j++;
      const content = line.slice(j);
      if (content.includes("SPDX-License-Identifier")) break;
      docLines.unshift(content);
    } else {
      break;
    }
  }
  return docLines.length > 0 ? docLines.join("\n").trim() : null;
}

function extractSysmlDocBlockFromCst(node: SyntaxNode | null): string | null {
  if (!node) return null;
  const stack: SyntaxNode[] = [node];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (
      curr.type === "Documentation" ||
      curr.type === "documentation" ||
      curr.type === "doc_comment" ||
      curr.type === "documentation_comment"
    ) {
      const raw = curr.text ?? "";
      const openIdx = raw.indexOf("/*");
      const closeIdx = openIdx !== -1 ? raw.lastIndexOf("*/") : -1;
      if (openIdx !== -1 && closeIdx > openIdx + 1) {
        const cleaned = stripCommentBlockBody(raw.slice(openIdx + 2, closeIdx));
        if (cleaned) return cleaned;
      }
    }
    for (let i = curr.namedChildren.length - 1; i >= 0; i--) {
      stack.push(curr.namedChildren[i]!);
    }
  }
  return null;
}

function extractSysmlDocBlockContent(rawSpan: string): string | null {
  let i = 0;
  const len = rawSpan.length;
  while (i < len) {
    const ch = rawSpan[i]!;
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < len) {
        if (rawSpan[i] === "\\") i += 2;
        else if (rawSpan[i] === q) {
          i++;
          break;
        } else i++;
      }
      continue;
    }
    if (ch === "d" && startsWithWordAt(rawSpan, i, "doc")) {
      const afterDoc = skipWs(rawSpan, i + 3);
      if (rawSpan[afterDoc] === "/" && rawSpan[afterDoc + 1] === "*") {
        const closeIdx = rawSpan.indexOf("*/", afterDoc + 2);
        if (closeIdx !== -1) {
          const cleaned = stripCommentBlockBody(rawSpan.slice(afterDoc + 2, closeIdx));
          return cleaned || null;
        }
      }
    }
    i++;
  }
  return null;
}

function extractWithinPackageFromSource(fullText: string | null, cstRoot?: SyntaxNode | null): string | null {
  if (cstRoot && !cstRoot.hasError) {
    for (const child of cstRoot.namedChildren) {
      if (child.type === "within_clause" || child.type === "within") {
        const nameNode = child.childForFieldName("name") ?? child.namedChildren[0];
        if (nameNode) {
          const cleaned = stripWs(nameNode.text);
          if (cleaned) return cleaned;
        }
      }
    }
  }
  if (!fullText) return null;
  const prefix = fullText.slice(0, 300);
  let i = skipModelicaTrivia(prefix, 0);
  if (i < prefix.length && startsWithWordAt(prefix, i, "within")) {
    const namePos = skipWs(prefix, i + 6);
    if (namePos > i + 6) {
      const qual = readQualifiedNameAt(prefix, namePos);
      if (qual && qual.name && !qual.name.startsWith(".")) {
        const afterName = skipWs(prefix, qual.end);
        if (prefix[afterName] === ";") {
          return qual.name;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// LSP Protocol Types (minimal subset, avoids vscode-languageserver dep)
// ---------------------------------------------------------------------------

/** LSP SymbolKind enum (subset). */
export const enum LSPSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

/** Zero-based start and end line/character range in an LSP text document. */
export interface LSPRange {
  /** Zero-based start line and UTF-16 character offset. */
  start: { line: number; character: number };
  /** Zero-based end line and UTF-16 character offset. */
  end: { line: number; character: number };
}

/** URI and range identifying a specific span in a workspace document. */
export interface LSPLocation {
  /** Target document URI. */
  uri: string;
  /** Span within the target document. */
  range: LSPRange;
}

/** Hierarchical document symbol node for the Outline tree and breadcrumbs. */
export interface LSPDocumentSymbol {
  /** Display name of the symbol. */
  name: string;
  /** LSP symbol kind classification. */
  kind: LSPSymbolKind;
  /** Full enclosing range of the declaration. */
  range: LSPRange;
  /** Narrow identifier range highlighted when selecting the symbol. */
  selectionRange: LSPRange;
  /** Optional nested child symbols declared inside this symbol's scope. */
  children?: LSPDocumentSymbol[] | undefined;
}

/** Completion candidate item returned for `textDocument/completion`. */
export interface LSPCompletionItem {
  /** Identifier text inserted or displayed on completion. */
  label: string;
  /** LSP symbol classification icon. */
  kind: LSPSymbolKind;
  /** Optional short type or category detail string. */
  detail?: string | undefined;
}

/** Markdown hover card payload and optional highlighted token range. */
export interface LSPHover {
  /** Markdown-formatted hover documentation. */
  contents: string;
  /** Optional document range of the hovered symbol. */
  range?: LSPRange | undefined;
}

// ---------------------------------------------------------------------------
// Offset ↔ Position converter
// ---------------------------------------------------------------------------

/**
 * Converts byte offsets to LSP line/character positions.
 * Must be initialized with the source text.
 */
export class PositionIndex {
  /** Character offset of the start of each 0-indexed line. */
  private lineStarts: number[];
  /** UTF-8 byte offset of the start of each 0-indexed line. */
  private byteLineStarts: number[];
  /** Raw document source text. */
  private sourceText: string;
  /** Fast-path flag indicating whether the source contains only 7-bit ASCII characters. */
  private isPureAscii: boolean;

  /**
   * Builds a line-start lookup table for both character and UTF-8 byte offsets.
   *
   * @param sourceText - Full source text of the document.
   */
  constructor(sourceText: string) {
    this.sourceText = sourceText;
    this.lineStarts = [0];
    this.byteLineStarts = [0];

    let pureAscii = true;
    let byteOffset = 0;

    for (let i = 0; i < sourceText.length; i++) {
      const code = sourceText.charCodeAt(i);
      if (code > 0x7f) {
        pureAscii = false;
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < sourceText.length) {
          byteOffset += 4;
          i++; // Skip low surrogate
          continue;
        } else if (code <= 0x7ff) {
          byteOffset += 2;
        } else {
          byteOffset += 3;
        }
      } else {
        byteOffset += 1;
        if (code === 0x0a) {
          this.lineStarts.push(i + 1);
          this.byteLineStarts.push(byteOffset);
        }
      }
    }
    this.isPureAscii = pureAscii;
  }

  // ── Canonical character-offset API ──────────────────────────────────────

  /**
   * Convert a character offset to an LSP line/character position.
   * This is the preferred API — character offsets are the canonical
   * representation used by SyntaxNode.startOffset, SymbolEntry, etc.
   */
  charOffsetToPosition(charOffset: number): { line: number; character: number } {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid]! <= charOffset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return { line: lo, character: Math.max(0, charOffset - this.lineStarts[lo]!) };
  }

  /**
   * Get the underlying source text.
   */
  getSourceText(): string {
    return this.sourceText;
  }

  /**
   * Convert an LSP line/character position back to a character offset.
   */
  positionToCharOffset(line: number, character: number): number {
    if (line < 0 || line >= this.lineStarts.length) return 0;
    return Math.min(this.lineStarts[line]! + character, this.sourceText.length);
  }

  /**
   * Convert a character offset range to an LSP range.
   */
  rangeFromOffsets(startOffset: number, endOffset: number): LSPRange {
    return {
      start: this.charOffsetToPosition(startOffset),
      end: this.charOffsetToPosition(endOffset),
    };
  }

  // ── Deprecated byte-based API ───────────────────────────────────────────
  // These methods convert UTF-8 byte offsets to positions. Since the codebase
  // is migrating to character offsets everywhere, prefer the methods above.

  /** @deprecated Use {@link charOffsetToPosition} with character offsets instead. */
  offsetToPosition(offset: number): { line: number; character: number } {
    let lo = 0;
    let hi = this.byteLineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.byteLineStarts[mid]! <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    const byteDelta = offset - this.byteLineStarts[lo]!;
    if (this.isPureAscii || byteDelta <= 0) {
      return { line: lo, character: Math.max(0, byteDelta) };
    }

    const lineStartChar = this.lineStarts[lo]!;
    const nextLineStartChar = lo + 1 < this.lineStarts.length ? this.lineStarts[lo + 1]! : this.sourceText.length;
    let currByte = 0;
    let charIdx = lineStartChar;

    while (charIdx < nextLineStartChar && currByte < byteDelta) {
      const code = this.sourceText.charCodeAt(charIdx);
      if (code <= 0x7f) {
        currByte += 1;
        charIdx += 1;
      } else if (code >= 0xd800 && code <= 0xdbff && charIdx + 1 < nextLineStartChar) {
        currByte += 4;
        charIdx += 2;
      } else if (code <= 0x7ff) {
        currByte += 2;
        charIdx += 1;
      } else {
        currByte += 3;
        charIdx += 1;
      }
    }

    return { line: lo, character: charIdx - lineStartChar };
  }

  /** @deprecated Use {@link positionToCharOffset} instead. */
  positionToOffset(line: number, character: number): number {
    if (line < 0 || line >= this.lineStarts.length) return 0;
    if (this.isPureAscii) {
      return this.lineStarts[line]! + character;
    }

    const lineStartChar = this.lineStarts[line]!;
    const targetCharIdx = Math.min(lineStartChar + character, this.sourceText.length);
    let byteDelta = 0;

    for (let i = lineStartChar; i < targetCharIdx; i++) {
      const code = this.sourceText.charCodeAt(i);
      if (code <= 0x7f) {
        byteDelta += 1;
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < targetCharIdx) {
        byteDelta += 4;
        i++;
      } else if (code <= 0x7ff) {
        byteDelta += 2;
      } else {
        byteDelta += 3;
      }
    }

    return this.byteLineStarts[line]! + byteDelta;
  }

  /** Total number of lines in the source. */
  get lineCount(): number {
    return this.lineStarts.length;
  }
}

// ---------------------------------------------------------------------------
// LSP Bridge — Maps metascript internals to LSP protocol responses
// ---------------------------------------------------------------------------

/**
 * Maps the metascript runtime (SymbolIndex, QueryEngine, ScopeResolver)
 * to LSP protocol responses.
 *
 * This class translates between the internal representation
 * and the JSON-RPC protocol used by LSP clients.
 */
export interface LSPBridgeEnv {
  documentLSPBridges?: Map<string, LSPBridge>;
  documents?: { get(uri: string): { getText(): string } | undefined };
  sharedFs?: {
    readFile?(uri: string): string | undefined;
    read?(path: string): string | undefined;
  };
}

export class LSPBridge {
  /** Line/character position converter for the bound document. */
  public positions: PositionIndex;
  /** Canonical URI of the bound document. */
  private documentUri: string;
  /** Injected environment dependencies for cross-document and VFS resolution. */
  private env?: LSPBridgeEnv;

  /**
   * Creates a new `LSPBridge` for a document.
   * Supports both 4-argument `(index, engine, positions, documentUri)` and legacy
   * 5-argument `(index, engine, resolver, positions, documentUri)` signatures,
   * as well as 5-argument `(index, engine, positions, documentUri, env)`.
   */
  constructor(
    private index: SymbolIndex,
    private engine: QueryEngine,
    arg3?: any,
    arg4?: any,
    arg5?: any,
    arg6?: any,
  ) {
    if (typeof arg4 === "string") {
      // (index, engine, positions, documentUri, env?)
      this.positions =
        arg3 instanceof PositionIndex
          ? arg3
          : arg3 && typeof arg3.positionToCharOffset === "function"
            ? arg3
            : new PositionIndex(typeof arg3?.sourceText === "string" ? arg3.sourceText : "");
      this.documentUri = arg4;
      this.env = typeof arg5 === "object" && arg5 !== null && !("lineStarts" in arg5) ? arg5 : undefined;
    } else if (typeof arg5 === "string") {
      // Legacy: (index, engine, resolver, positions, documentUri, env?)
      this.positions =
        arg4 instanceof PositionIndex
          ? arg4
          : arg4 && typeof arg4.positionToCharOffset === "function"
            ? arg4
            : new PositionIndex(typeof arg4?.sourceText === "string" ? arg4.sourceText : "");
      this.documentUri = arg5;
      this.env = typeof arg6 === "object" && arg6 !== null ? arg6 : undefined;
    } else {
      this.positions =
        arg3 instanceof PositionIndex
          ? arg3
          : arg3 && typeof arg3.positionToCharOffset === "function"
            ? arg3
            : new PositionIndex(typeof arg3?.sourceText === "string" ? arg3.sourceText : "");
      this.documentUri = typeof arg4 === "string" ? arg4 : "";
      this.env = typeof arg5 === "object" && arg5 !== null ? arg5 : undefined;
    }
  }

  /** Injects or overrides the environment dependencies for this bridge. */
  public setEnv(env: LSPBridgeEnv): void {
    this.env = env;
  }

  /** Returns the injected environment dependencies, if configured. */
  public getEnv(): LSPBridgeEnv | undefined {
    return this.env;
  }

  /** Returns the underlying Salsa `QueryEngine` instance. */
  public getQueryEngine(): QueryEngine {
    return this.engine;
  }

  /** Returns the underlying `SymbolIndex` instance. */
  public getIndex(): SymbolIndex {
    return this.index;
  }

  /** Returns the URI of the document bound to this bridge. */
  public getDocumentUri(): string {
    return this.documentUri;
  }

  /** Re-entrancy guard for `resolveName` / `resolveSimpleName` (`name@scopeId`). */
  private activeResolveKeys = new Set<string>();
  /** Current recursion depth inside `resolveName` / `resolveSimpleName`. */
  private resolveDepth = 0;
  /** Re-entrancy guard for `resolveViaImportClause` (`importEntry.id`). */
  private activeImportIds = new Set<SymbolId>();
  /** Re-entrancy guard for `getInheritedMembers` (`typeId`). */
  private activeInheritedIds = new Set<SymbolId>();
  /** Re-entrancy guard for `resolveTypeOf` (`entry.id`). */
  private activeTypeOfIds = new Set<SymbolId>();
  /** Re-entrancy guard for `formatDeclaration` (`entry.id`). */
  private activeFormatIds = new Set<SymbolId>();
  /** Re-entrancy guard for `hoverEntry` (`entry.id`). */
  private activeHoverIds = new Set<SymbolId>();

  /** Checks whether a symbol entry represents a declaration rather than a reference or equation usage. */
  private isDecl(entry: SymbolEntry): boolean {
    return (
      entry.kind !== "Reference" &&
      entry.kind !== "ConnectEquation" &&
      entry.kind !== "FunctionCall" &&
      entry.kind !== "Extends" &&
      entry.kind !== "Import"
    );
  }

  /** Infers the active language ID of the document bound to this `LSPBridge`. */
  private getBridgeLanguage(): string {
    const uriLower = this.documentUri.toLowerCase();
    if (uriLower.endsWith(".sysml") || uriLower.endsWith(".sysml2")) return "sysml2";
    if (uriLower.endsWith(".mo") || uriLower.endsWith(".mos")) return "modelica";
    if (uriLower.endsWith(".scad")) return "scad";
    if (uriLower.endsWith(".step") || uriLower.endsWith(".stp") || uriLower.endsWith(".p21")) return "step";
    if (uriLower.endsWith(".reqif") || uriLower.endsWith(".reqifz")) return "reqif";
    if (uriLower.endsWith(".qif") || uriLower.endsWith(".qif.xml") || uriLower.endsWith(".qif.json")) return "qif";
    if (/\.(pscx|pslx|pswx|psmx)$/.test(uriLower)) return "pscad";
    if (/\.(raw|dyr|seq)$/.test(uriLower)) return "psse";
    for (const id of this.getDocumentSymbolIds()) {
      const sym = this.index.symbols.get(id);
      if (sym?.language) return sym.language.toLowerCase();
    }
    return "";
  }

  /** Checks whether a symbol entry is declared at the top-level of a file/workspace (or a synthetic foreign file root). */
  private isTopLevel(entry: SymbolEntry): boolean {
    if (entry.metadata?.["isPredefined"]) return true;
    if (entry.parentId === null || entry.parentId === undefined || entry.parentId === 0) return true;
    const parent = this.index.symbols.get(entry.parentId);
    if (!parent) return true;
    const pr = parent.ruleName ?? "";
    if (
      pr === "SourceFile" ||
      pr === "source_file" ||
      parent.kind === "SourceFile" ||
      pr === "scad_file" ||
      pr === "reqif_specification" ||
      pr === "step_product" ||
      pr === "pscad_library" ||
      pr === "pscad_project" ||
      pr === "qif_document" ||
      pr === "psse_case" ||
      pr === "psse_dyr_case"
    ) {
      return true;
    }
    return false;
  }

  /** Validates whether a global candidate `entry` is visible/compatible from the current bridge language. */
  private isCompatibleGlobalCandidate(entry: SymbolEntry): boolean {
    const entryLang = entry.language?.toLowerCase() ?? "";
    const bridgeLang = this.getBridgeLanguage();
    if (!entryLang || !bridgeLang || entryLang === bridgeLang) return true;
    const projTable = (
      this.index as {
        tggProjectionTable?: {
          getAllRules?: () => unknown[];
          canResolveAs?: (fromLang: string, target: SymbolEntry) => boolean;
        };
      }
    ).tggProjectionTable;
    if (projTable && typeof projTable.canResolveAs === "function") {
      const ruleCount = typeof projTable.getAllRules === "function" ? projTable.getAllRules().length : 1;
      if (ruleCount > 0) {
        return projTable.canResolveAs(bridgeLang, entry);
      }
    }
    return true;
  }

  /** Computes the dot-separated or `::`-separated qualified name for `entry` by walking its parent chain. */
  private getQualifiedName(entry: SymbolEntry, sep = "."): string {
    const parts: string[] = [];
    const seen = new Set<SymbolId>();
    let curr: SymbolEntry | undefined = entry;
    while (curr && !seen.has(curr.id)) {
      seen.add(curr.id);
      if (
        curr.name &&
        curr.name !== "<anonymous>" &&
        curr.ruleName !== "SourceFile" &&
        curr.ruleName !== "source_file"
      ) {
        parts.unshift(curr.name);
      }
      curr = curr.parentId !== null ? this.index.symbols.get(curr.parentId) : undefined;
    }
    return parts.join(sep);
  }

  /** Resolves a reference symbol entry to its target declaration(s). */
  private resolveRef(refEntry: SymbolEntry): SymbolEntry[] {
    if (this.isDecl(refEntry)) return [refEntry];
    const targetName =
      (typeof refEntry.metadata?.["typeSpecifier"] === "string" && refEntry.metadata["typeSpecifier"]) || refEntry.name;
    return this.resolveName(targetName, refEntry.parentId);
  }

  /**
   * Resolves a simple or qualified (`A.B.C` / `A::B::C`) identifier name starting from `scopeId`,
   * consulting Salsa `resolveSimpleName`, lexical scopes, import clauses, and global index lookup.
   */
  private resolveName(name: string, scopeId: SymbolId | null): SymbolEntry[] {
    const trimmed = name.trim();
    if (!trimmed || this.resolveDepth > 16) return [];

    const callKey = `qual:${trimmed}@${scopeId ?? "root"}`;
    if (this.activeResolveKeys.has(callKey)) return [];
    this.activeResolveKeys.add(callKey);
    this.resolveDepth++;

    try {
      const engFqn = this.engine as unknown as { ensureFQNIndexed?(fqn: string): void } | undefined;
      if (typeof engFqn?.ensureFQNIndexed === "function") {
        try {
          engFqn.ensureFQNIndexed(trimmed.replaceAll("::", "."));
        } catch {
          // ignore
        }
      }

      if (trimmed.includes(".") || trimmed.includes("::")) {
        const segments = splitQualifiedPath(trimmed);
        if (segments.length > 1) {
          const resolved = this.resolveQualifiedSegments(segments, scopeId);
          if (resolved.length > 0) return resolved;
        }
      }

      return this.resolveSimpleName(trimmed, scopeId);
    } finally {
      this.resolveDepth--;
      this.activeResolveKeys.delete(callKey);
    }
  }

  /** Resolves a single (unqualified) identifier name starting from `scopeId`. */
  private resolveSimpleName(name: string, scopeId: SymbolId | null): SymbolEntry[] {
    if (!name || this.resolveDepth > 16) return [];

    const simpleKey = `simple:${name}@${scopeId ?? "root"}`;
    if (this.activeResolveKeys.has(simpleKey)) return [];
    this.activeResolveKeys.add(simpleKey);
    this.resolveDepth++;

    try {
      if (scopeId !== null && this.engine && typeof this.engine.query === "function") {
        try {
          const resolver = this.engine.query<((n: string) => SymbolEntry | null) | null>("resolveSimpleName", scopeId);
          const resolved = typeof resolver === "function" ? resolver(name) : null;
          if (resolved && this.isDecl(resolved)) {
            return [resolved];
          }
        } catch {
          // fallback to lexical walk
        }
      }
      let current = scopeId;
      const visitedScopes = new Set<SymbolId>();
      while (current !== null && !visitedScopes.has(current)) {
        visitedScopes.add(current);
        const children = this.index.childrenOf.get(current) || [];
        for (const childId of children) {
          const entry = this.index.symbols.get(childId);
          if (entry && entry.name === name && this.isDecl(entry)) {
            return [entry];
          }
        }
        // Check Import clauses in this scope
        for (const childId of children) {
          const entry = this.index.symbols.get(childId);
          if (entry && entry.kind === "Import") {
            const imported = this.resolveViaImportClause(entry, name);
            if (imported.length > 0) return imported;
          }
        }
        const parent = this.index.symbols.get(current);
        current = parent?.parentId ?? null;
      }
      const globalIds = this.index.byName.get(name) || [];
      const sameLangResults: SymbolEntry[] = [];
      const foreignResults: SymbolEntry[] = [];
      const bridgeLang = this.getBridgeLanguage();
      for (const id of globalIds) {
        const entry = this.index.symbols.get(id);
        if (entry && this.isDecl(entry) && this.isTopLevel(entry) && this.isCompatibleGlobalCandidate(entry)) {
          if (!bridgeLang || !entry.language || entry.language.toLowerCase() === bridgeLang) {
            sameLangResults.push(entry);
          } else {
            foreignResults.push(entry);
          }
        }
      }
      return sameLangResults.length > 0 ? sameLangResults : foreignResults;
    } finally {
      this.resolveDepth--;
      this.activeResolveKeys.delete(simpleKey);
    }
  }

  /** Attempts to resolve `name` through an `Import` symbol entry (`import A.B.C`, `import X = A.B`, `import A.B.*`). */
  private resolveViaImportClause(importEntry: SymbolEntry, name: string): SymbolEntry[] {
    if (this.activeImportIds.has(importEntry.id) || this.resolveDepth > 16) return [];
    this.activeImportIds.add(importEntry.id);
    try {
      const meta = importEntry.metadata;
      const shortName = typeof meta?.["shortName"] === "string" ? meta["shortName"] : undefined;
      const pkgName = typeof meta?.["packageName"] === "string" ? meta["packageName"] : undefined;
      if (shortName && pkgName && shortName === name) {
        return this.resolveName(pkgName, null);
      }

      const rawNode = this.getEntryCstNode(importEntry);
      const importNode = findAncestorOrSelfByType(
        rawNode,
        ["import_clause"],
        ["element_list", "stored_definition", "program"],
      );
      if (importNode && !importNode.hasError) {
        const aliasNode = importNode.childForFieldName("alias");
        const nameNode = importNode.childForFieldName("name");
        const importListNode = importNode.childForFieldName("import_list");
        if (aliasNode && nameNode) {
          if (aliasNode.text.trim() === name) {
            return this.resolveName(stripWs(nameNode.text), null);
          }
          return [];
        }
        if (nameNode && importListNode) {
          const pkgPrefix = stripWs(nameNode.text);
          for (const item of importListNode.namedChildren) {
            if (item.text.trim() === name) {
              return this.resolveName(`${pkgPrefix}.${name}`, null);
            }
          }
          return [];
        }
        if (nameNode) {
          const targetName = stripWs(nameNode.text);
          const descNode = importNode.childForFieldName("description");
          const limitStart = descNode ? getNodeStartOffset(descNode) : getNodeEndOffset(importNode);
          const nameEnd = getNodeEndOffset(nameNode);
          const isWildcard = importNode.children.some((child) => {
            const cStart = getNodeStartOffset(child);
            const t = child.text.trim();
            return cStart >= nameEnd && cStart < limitStart && (t === ".*" || t === "*" || t === "::*");
          });
          if (isWildcard) {
            if (!targetName || targetName === name) return [];
            return this.resolveName(`${targetName}.${name}`, null);
          }
          const parts = splitQualifiedPath(targetName);
          if (parts.length > 1 && parts[parts.length - 1] === name) {
            return this.resolveName(targetName, null);
          }
          return [];
        }
      }

      // Fallback when CST is unavailable (e.g. unit test mocks) or has syntax errors
      const rawText = this.getEntrySourceSlice(importEntry, importEntry.startOffset, importEntry.endOffset);
      const src = (rawText || importEntry.name || "").trim();
      if (!src) return [];

      let idx = 0;
      if (startsWithWordAt(src, idx, "import")) {
        idx = skipWs(src, idx + "import".length);
      }

      const firstIdent = readIdentAt(src, idx);
      if (firstIdent) {
        const eqIdx = skipWs(src, firstIdent.end);
        if (src[eqIdx] === "=") {
          if (firstIdent.ident !== name) return [];
          const rhsStart = skipWs(src, eqIdx + 1);
          const rhs = readQualifiedNameAt(src, rhsStart);
          return rhs ? this.resolveName(rhs.name, null) : [];
        }
      }

      const pkgPath = readQualifiedNameAt(src, idx);
      if (!pkgPath) return [];
      const afterPkg = skipWs(src, pkgPath.end);

      // Selective import: `import Modelica.Units.SI.{Voltage, Current}`
      if (src[afterPkg] === "." && src[skipWs(src, afterPkg + 1)] === "{") {
        const braceStart = skipWs(src, afterPkg + 1) + 1;
        const braceEnd = src.indexOf("}", braceStart);
        const listSlice = braceEnd === -1 ? src.slice(braceStart) : src.slice(braceStart, braceEnd);
        for (const item of listSlice.split(",")) {
          if (item.trim() === name) {
            return this.resolveName(`${pkgPath.name}.${name}`, null);
          }
        }
        return [];
      }

      // Wildcard import: `import Modelica.Electrical.Analog.Sources.*` or `Pkg::*`
      if (
        src.startsWith(".*", afterPkg) ||
        src.startsWith("::*", afterPkg) ||
        (src[afterPkg] === "." && src[skipWs(src, afterPkg + 1)] === "*")
      ) {
        if (!pkgPath.name || pkgPath.name === name) return [];
        return this.resolveName(`${pkgPath.name}.${name}`, null);
      }

      // Qualified import: `import Modelica.Electrical.Analog.Sources.SineVoltage`
      const parts = splitQualifiedPath(pkgPath.name);
      if (parts.length > 1 && parts[parts.length - 1] === name) {
        return this.resolveName(pkgPath.name, null);
      }
      return [];
    } finally {
      this.activeImportIds.delete(importEntry.id);
    }
  }

  /**
   * Resolves a multi-segment path `segments` (e.g. `["Modelica", "Electrical", "Analog", "Sources", "SineVoltage"]`
   * or `["Vb", "p"]`) starting from `scopeId`.
   */
  private resolveQualifiedSegments(segments: string[], scopeId: SymbolId | null): SymbolEntry[] {
    if (segments.length === 0 || this.resolveDepth > 16) return [];
    const firstSeg = segments[0]!;
    const roots = this.resolveSimpleName(firstSeg, scopeId);

    const stepIntoMember = (container: SymbolEntry, memberName: string): SymbolEntry[] => {
      const matches: SymbolEntry[] = [];
      const seenIds = new Set<SymbolId>();
      const addMatch = (e: SymbolEntry) => {
        if (!seenIds.has(e.id) && this.isDecl(e)) {
          seenIds.add(e.id);
          matches.push(e);
        }
      };

      // 1. Direct children of container
      for (const child of this.getExportedChildren(container.id)) {
        if (child.name === memberName) addMatch(child);
      }
      if (matches.length > 0) return matches;

      // 2. Inherited members if container is a class/type and direct lookup did not match
      const isClassOrPackage =
        container.kind === "Class" ||
        container.kind === "Type" ||
        container.kind === "Interface" ||
        container.kind === "Struct" ||
        container.kind === "Package";

      if (isClassOrPackage) {
        for (const inherited of this.getInheritedMembers(container.id)) {
          if (inherited.name === memberName) addMatch(inherited);
        }
        return matches;
      }

      // 3. If container is a Component / Variable / Usage (not a class/package/function), step into its type
      if (container.kind !== "Function") {
        const typeDecl = this.resolveTypeOf(container);
        if (typeDecl && typeDecl.id !== container.id) {
          for (const child of this.getExportedChildren(typeDecl.id)) {
            if (child.name === memberName) addMatch(child);
          }
          if (matches.length === 0) {
            for (const inherited of this.getInheritedMembers(typeDecl.id)) {
              if (inherited.name === memberName) addMatch(inherited);
            }
          }
        }
      }

      return matches;
    };

    let currentCandidates = roots;
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i]!;
      const nextCandidates: SymbolEntry[] = [];
      for (const cand of currentCandidates) {
        nextCandidates.push(...stepIntoMember(cand, seg));
      }
      currentCandidates = nextCandidates;
      if (currentCandidates.length === 0) break;
    }

    if (currentCandidates.length > 0) {
      return currentCandidates;
    }

    // Fallback: match suffix against qualified names of global symbols matching the last segment
    const lastSeg = segments[segments.length - 1]!;
    const targetSuffix = segments.join(".");
    const globalIds = this.index.byName.get(lastSeg) || [];
    const suffixMatches: SymbolEntry[] = [];
    for (const id of globalIds) {
      const entry = this.index.symbols.get(id);
      if (entry && this.isDecl(entry)) {
        const fqn = this.getQualifiedName(entry, ".");
        if (fqn === targetSuffix || fqn.endsWith(`.${targetSuffix}`)) {
          suffixMatches.push(entry);
        }
      }
    }
    return suffixMatches;
  }

  /** Collects all declaration symbols lexically visible from `scopeId` up to the root scope. */
  private getVisibleSymbols(scopeId: SymbolId | null): SymbolEntry[] {
    const visible: SymbolEntry[] = [];
    const seenNames = new Set<string>();
    const visitedScopes = new Set<SymbolId>();
    let current = scopeId;
    while (current !== null && !visitedScopes.has(current)) {
      visitedScopes.add(current);
      const children = this.index.childrenOf.get(current) || [];
      for (const childId of children) {
        const entry = this.index.symbols.get(childId);
        if (entry && this.isDecl(entry) && !seenNames.has(entry.name)) {
          visible.push(entry);
          seenNames.add(entry.name);
        }
      }
      const parent = this.index.symbols.get(current);
      current = parent?.parentId ?? null;
    }
    const topLevel = this.index.childrenOf.get(null) || this.index.childrenOf.get(0) || [];
    for (const childId of topLevel) {
      const entry = this.index.symbols.get(childId);
      if (entry && this.isDecl(entry) && !seenNames.has(entry.name)) {
        visible.push(entry);
        seenNames.add(entry.name);
      }
    }
    return visible;
  }

  /**
   * Collects all inherited member declarations via BFS traversal of both `entry.inherits`
   * and child `Extends` clauses on `typeId`.
   */
  private getInheritedMembers(typeId: SymbolId): SymbolEntry[] {
    if (this.activeInheritedIds.has(typeId) || this.resolveDepth > 16) return [];
    const inherited: SymbolEntry[] = [];
    const seen = new Set<SymbolId>();
    const addedHere: SymbolId[] = [];
    const queue = [typeId];
    try {
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (seen.has(currentId) || this.activeInheritedIds.has(currentId)) continue;
        seen.add(currentId);
        this.activeInheritedIds.add(currentId);
        addedHere.push(currentId);

        const entry = this.index.symbols.get(currentId);
        if (!entry) continue;

        const baseNames = new Set<string>(entry.inherits || []);
        for (const child of this.getExportedChildren(currentId)) {
          if (child.kind === "Extends") {
            const extType =
              (typeof child.metadata?.["typeSpecifier"] === "string" && child.metadata["typeSpecifier"]) || child.name;
            if (extType) baseNames.add(extType);
          }
        }

        for (const inheritPath of baseNames) {
          let targetDecls = this.resolveName(inheritPath, currentId);
          if (targetDecls.length === 0) {
            targetDecls = this.resolveName(inheritPath, entry.parentId);
          }
          for (const target of targetDecls) {
            if (target.id === currentId || seen.has(target.id) || this.activeInheritedIds.has(target.id)) continue;
            queue.push(target.id);
            const children = this.getExportedChildren(target.id);
            for (const child of children) {
              if (this.isDecl(child)) {
                inherited.push(child);
              }
            }
          }
        }
      }
    } finally {
      for (const id of addedHere) {
        this.activeInheritedIds.delete(id);
      }
    }
    return inherited;
  }

  /** Finds all reference symbol entries across the index that resolve to `declId`. */
  private findRefs(declId: SymbolId): SymbolEntry[] {
    const decl = this.index.symbols.get(declId);
    if (!decl) return [];
    const matchingIds = this.index.byName.get(decl.name) || [];
    const refs: SymbolEntry[] = [];
    for (const id of matchingIds) {
      const entry = this.index.symbols.get(id);
      if (entry && !this.isDecl(entry)) {
        const resolved = this.resolveRef(entry);
        if (resolved.some((d) => d.id === declId)) {
          refs.push(entry);
        }
      }
    }
    return refs;
  }

  // =========================================================================
  // textDocument/documentSymbol
  // =========================================================================

  /**
   * Builds the hierarchical `LSPDocumentSymbol` outline tree for the bound document.
   */
  documentSymbols(): LSPDocumentSymbol[] {
    // Collect only symbols belonging to this document
    const docSymbols = new Set<SymbolId>();

    const normalize = (u: string) => {
      try {
        return decodeURIComponent(u).replace(/^[a-z0-9+-]+:\/\/?/, "/");
      } catch {
        return u;
      }
    };
    const targetNorm = normalize(this.documentUri);

    let docSymbolIds: SymbolId[] | undefined;
    if (this.index.symbolsByResource) {
      docSymbolIds = this.index.symbolsByResource.get(this.documentUri);
      if (!docSymbolIds || docSymbolIds.length === 0) {
        for (const [k, v] of this.index.symbolsByResource.entries()) {
          const kNorm = normalize(k);
          if (
            k === this.documentUri ||
            kNorm === targetNorm ||
            kNorm.endsWith(targetNorm) ||
            targetNorm.endsWith(kNorm)
          ) {
            docSymbolIds = v;
            break;
          }
        }
      }
    }

    if (docSymbolIds && docSymbolIds.length > 0) {
      for (const id of docSymbolIds) {
        const entry = this.index.symbols.get(id);
        if (!entry || entry.kind === "Reference" || entry.kind === "ConnectEquation" || entry.kind === "FunctionCall")
          continue;
        docSymbols.add(entry.id);
      }
    } else {
      // Fallback for older index format or if symbolsByResource missed it
      for (const entry of this.index.symbols.values()) {
        const resNorm = entry.resourceId ? normalize(entry.resourceId) : "";
        const matches =
          entry.resourceId === this.documentUri ||
          resNorm === targetNorm ||
          (resNorm && (resNorm.endsWith(targetNorm) || targetNorm.endsWith(resNorm)));
        if (!matches) continue;
        if (entry.kind === "Reference" || entry.kind === "ConnectEquation" || entry.kind === "FunctionCall") continue;
        docSymbols.add(entry.id);
      }
    }

    // Build hierarchy: group by parentId, reparenting orphans to null
    const childrenOf = new Map<SymbolId | null, SymbolEntry[]>();

    for (const id of docSymbols) {
      const entry = this.index.symbols.get(id)!;
      // If parent was filtered out (from a different file), treat as root
      const parentKey = entry.parentId !== null && docSymbols.has(entry.parentId) ? entry.parentId : null;
      const children = childrenOf.get(parentKey);
      if (children) {
        children.push(entry);
      } else {
        childrenOf.set(parentKey, [entry]);
      }
    }

    const visitedDocSymbolIds = new Set<SymbolId>();
    const buildLevel = (parentId: SymbolId | null): LSPDocumentSymbol[] => {
      if (parentId !== null) {
        if (visitedDocSymbolIds.has(parentId)) return [];
        visitedDocSymbolIds.add(parentId);
      }
      const entries = childrenOf.get(parentId) || [];
      return entries.map((entry) => {
        const fullStart = Math.min(entry.startOffset, entry.endOffset);
        const fullEnd = Math.max(entry.startOffset, entry.endOffset);
        let range = this.positions.rangeFromOffsets(fullStart, fullEnd);
        if (
          range.end.line < range.start.line ||
          (range.end.line === range.start.line && range.end.character < range.start.character)
        ) {
          range = { start: range.start, end: { ...range.start } };
        }

        let name = entry.name;
        if (!name || name === "<anonymous>") {
          try {
            const source = this.engine.cstText(fullStart, fullEnd, entry);
            if (source) {
              const firstLine = source.trim().split("\n")[0]!.trim();
              name = firstLine.length > 40 ? firstLine.substring(0, 37) + "..." : firstLine;
            }
          } catch {
            // fallback if engine doesn't support cstText
          }
        }
        if (!name) name = "anonymous";

        let selectionRange = range;
        const nameField =
          entry.fieldRanges?.["name"] ??
          (entry.fieldRanges ? entry.fieldRanges[entry.namePath] || entry.fieldRanges["identifier"] : undefined);
        if (nameField) {
          const nfStart = Math.min(nameField.startOffset, nameField.endOffset);
          const nfEnd = Math.max(nameField.startOffset, nameField.endOffset);
          const selStart = Math.max(fullStart, Math.min(nfStart, fullEnd));
          const selEnd = Math.max(selStart, Math.min(nfEnd, fullEnd));
          selectionRange = this.positions.rangeFromOffsets(selStart, selEnd);
        } else {
          const text = this.positions.getSourceText();
          if (text && entry.name && entry.name !== "<anonymous>") {
            const slice = text.slice(fullStart, Math.min(fullStart + 300, fullEnd));
            const idx = slice.indexOf(entry.name);
            if (idx !== -1) {
              const selStart = fullStart + idx;
              const selEnd = Math.min(selStart + entry.name.length, fullEnd);
              selectionRange = this.positions.rangeFromOffsets(selStart, selEnd);
            }
          }
        }

        // Validate & clamp selectionRange inside range so VS Code never throws selectionRange must be contained in fullRange
        let sStart = { ...selectionRange.start };
        let sEnd = { ...selectionRange.end };
        const isBefore = (a: { line: number; character: number }, b: { line: number; character: number }) =>
          a.line < b.line || (a.line === b.line && a.character < b.character);
        if (isBefore(sEnd, sStart)) sEnd = { ...sStart };
        if (isBefore(sStart, range.start)) sStart = { ...range.start };
        if (isBefore(range.end, sStart)) sStart = { ...range.end };
        if (isBefore(sEnd, sStart)) sEnd = { ...sStart };
        if (isBefore(range.end, sEnd)) sEnd = { ...range.end };
        if (isBefore(sEnd, sStart) || isBefore(sStart, range.start) || isBefore(range.end, sEnd)) {
          sStart = { ...range.start };
          sEnd = { ...range.end };
        }
        selectionRange = { start: sStart, end: sEnd };

        const symbol: LSPDocumentSymbol = {
          name,
          kind: this.mapSymbolKind(entry.kind),
          range,
          selectionRange,
          children: buildLevel(entry.id),
        };
        return symbol;
      });
    };

    return buildLevel(null);
  }

  // =========================================================================
  // textDocument/definition
  /**
   * Resolves the declaration location (`LSPLocation`) for the symbol at `byteOffset`.
   */
  definition(byteOffset: number, sourceText?: string): LSPLocation | null {
    const target = this.definitionRaw(byteOffset, sourceText);
    if (!target) return null;

    const targetUri = target.resourceId || this.documentUri;
    let targetPositions = this.positions;
    let text: string | undefined = sourceText ?? this.positions.getSourceText();

    if (target.resourceId && target.resourceId !== this.documentUri) {
      const otherBridge =
        this.env?.documentLSPBridges?.get(target.resourceId) ??
        (globalThis as any).documentLSPBridges?.get(target.resourceId);
      if (otherBridge?.positions) {
        targetPositions = otherBridge.positions;
        text = targetPositions.getSourceText();
      } else {
        const otherDocText =
          this.env?.documents?.get(target.resourceId)?.getText?.() ??
          (globalThis as any).documents?.get(target.resourceId)?.getText?.() ??
          this.env?.sharedFs?.readFile?.(target.resourceId) ??
          (globalThis as any).sharedFs?.readFile?.(target.resourceId);
        if (typeof otherDocText === "string") {
          targetPositions = new PositionIndex(otherDocText);
          text = otherDocText;
        } else {
          text = undefined;
        }
      }
    }

    const nameField =
      target.fieldRanges?.["name"] ??
      (target.fieldRanges ? target.fieldRanges[target.namePath] || target.fieldRanges["identifier"] : undefined);
    let startOff = target.startOffset;
    let endOff = target.endOffset;
    if (nameField) {
      startOff = nameField.startOffset;
      endOff = nameField.endOffset;
    } else if (text && target.name && target.name !== "<anonymous>") {
      const baseStart = target.startOffset;
      const baseEnd = target.endOffset;
      const slice = text.slice(baseStart, Math.min(baseStart + 300, baseEnd));
      const idx = slice.indexOf(target.name);
      if (idx !== -1) {
        startOff = baseStart + idx;
        endOff = startOff + target.name.length;
      }
    }

    return {
      uri: targetUri,
      range: targetPositions.rangeFromOffsets(startOff, endOff),
    };
  }

  /** Extracts the qualified identifier prefix up to `wordEnd` (e.g. `Modelica.Electrical.Analog` or `Vb.p`). */
  private extractQualifiedPrefix(
    text: string,
    wordStart: number,
    wordEnd: number,
    cstRoot?: SyntaxNode | null,
  ): string {
    return extractQualifiedPrefixAtOffset(text, wordStart, wordEnd, cstRoot);
  }

  /** Returns the raw resolved symbol entry, preserving cross-document resourceIds */
  definitionRaw(byteOffset: number, sourceText?: string): SymbolEntry | null {
    const text = sourceText ?? this.positions.getSourceText();
    let word = "";
    let qualifiedPrefix = "";
    if (text) {
      const cstRoot = this.getRootCstNode();
      const span = extractWordSpanAtOffset(text, byteOffset, cstRoot);
      if (!span) {
        return null;
      }
      word = span.word;
      qualifiedPrefix = this.extractQualifiedPrefix(text, span.start, span.end, cstRoot);
    }

    const refEntry = this.findEntryAtOffset(byteOffset);

    if (qualifiedPrefix && qualifiedPrefix !== word) {
      const scopeEntry = this.findScopeAtOffset(byteOffset);
      const scopeId = scopeEntry?.id ?? refEntry?.parentId ?? null;
      const qTargets = this.resolveName(qualifiedPrefix, scopeId);
      if (qTargets.length > 0) return qTargets[0]!;
    }

    if (!refEntry) return null;

    if (
      word &&
      (refEntry.kind === "Class" || refEntry.ruleName === "SourceFile" || refEntry.ruleName === "source_file")
    ) {
      const nameRange = refEntry.fieldRanges?.["name"];
      const isOverClassName = nameRange
        ? byteOffset >= nameRange.startOffset && byteOffset <= nameRange.endOffset
        : word === refEntry.name && byteOffset < refEntry.startOffset + 200;

      if (!isOverClassName) {
        // Cursor is inside the class body — resolve the word within this class scope
        const targets = this.resolveName(qualifiedPrefix || word, refEntry.id);
        if (targets.length > 0) return targets[0]!;
        return null;
      }
    } else if (word && refEntry.kind === "Component") {
      if (word !== refEntry.name) {
        // Cursor is on component type or modifier
        const targets = this.resolveName(qualifiedPrefix || word, refEntry.parentId);
        if (targets.length > 0) return targets[0]!;
        return null;
      }
    } else if (word && (refEntry.kind === "Extends" || refEntry.kind === "Import")) {
      const targets = this.resolveName(qualifiedPrefix || word, refEntry.parentId);
      if (targets.length > 0) return targets[0]!;
    }

    const targets = this.resolveRef(refEntry);
    if (targets.length === 0) return null;

    return targets[0]!;
  }

  // =========================================================================
  // textDocument/completion
  // =========================================================================

  /**
   * Computes context-sensitive completion candidates (`LSPCompletionItem[]`) at `byteOffset`,
   * supporting dot-access member completion, modification-argument completion, and lexical scope completion.
   */
  completion(byteOffset: number, sourceText?: string): LSPCompletionItem[] {
    // ------------------------------------------------------------------
    // Dot-access completion: "a." → resolve `a` to its type, show members
    // ------------------------------------------------------------------
    if (sourceText) {
      const before = sourceText.slice(0, byteOffset);
      const varName = extractDotAccessVarBefore(before, this.getRootCstNode());
      if (varName) {
        return this.completeDotAccess(varName, byteOffset);
      }

      // ----------------------------------------------------------------
      // Modification-context completion: "A a(|)" → show members of A
      // ----------------------------------------------------------------
      const modMembers = this.completeModificationContext(byteOffset, before);
      if (modMembers) return modMembers;
    }

    // ------------------------------------------------------------------
    // Normal scope-aware completion: show visible symbols in current scope
    // ------------------------------------------------------------------
    const scopeEntry = this.findScopeAtOffset(byteOffset);
    const scopeId = scopeEntry?.id ?? null;

    const visible = this.getVisibleSymbols(scopeId);
    const seen = new Set<string>();
    const results: LSPCompletionItem[] = [];
    for (const entry of visible) {
      if (!seen.has(entry.name)) {
        seen.add(entry.name);
        results.push({
          label: entry.name,
          kind: this.mapSymbolKind(entry.kind),
          detail: entry.kind,
        });
      }
    }
    return results;
  }

  /**
   * Resolve dot-access: given a variable name before ".", find its type
   * declaration and return its exported children as completions.
   *
   * Type resolution is fully language-agnostic using two generic strategies:
   *  1. Check metadata values — if the language stores a type name in any
   *     metadata field (e.g. Modelica's `typeSpecifier`), try resolving it.
   *  2. Check child Reference entries — if the language uses `ref()` to model
   *     type references (e.g. SysML2's `OwnedFeatureTyping`), those become
   *     child entries with kind "Reference" whose name is the type.
   */
  private completeDotAccess(varName: string, byteOffset: number): LSPCompletionItem[] {
    // 1. Find the enclosing scope
    const scopeEntry = this.findScopeAtOffset(byteOffset);
    const scopeId = scopeEntry?.id ?? null;

    // 2. Resolve `varName` lexically to find its declaration
    let varDecls = this.resolveName(varName, scopeId);

    // Fallback: global name search across the entire index.
    // This handles cases where tree-sitter parse errors (from incomplete text
    // during typing) corrupt the scope hierarchy, causing lexical resolution
    // to miss symbols that are actually in scope.
    if (varDecls.length === 0) {
      const globalIds = this.index.byName.get(varName);
      if (globalIds) {
        for (const id of globalIds) {
          const entry = this.index.symbols.get(id);
          if (
            entry &&
            this.isDecl(entry) &&
            (this.isTopLevel(entry) || !entry.resourceId || entry.resourceId === this.documentUri)
          ) {
            varDecls.push(entry);
          }
        }
      }
    }

    if (varDecls.length === 0) return [];

    const varDecl = varDecls[0]!;

    // 3. Resolve the type of the variable using generic strategies
    const typeDecl = this.resolveTypeOf(varDecl);
    if (typeDecl) {
      return this.membersOf(typeDecl);
    }

    // 4. If the variable itself is a scope (e.g. a class), show its members directly
    const children = this.getExportedChildren(varDecl.id);
    if (children.length > 0) {
      return children
        .filter((child) => this.isDecl(child))
        .map((child) => ({
          label: child.name,
          kind: this.mapSymbolKind(child.kind),
          detail: child.kind,
        }));
    }

    return [];
  }

  /**
   * Resolve the type of a symbol entry, language-agnostically.
   *
   * Strategy 1: Scan metadata values for strings that resolve to a known
   *   definition/class/type in the index. This covers Modelica-style metadata
   *   (e.g. `attributes: { typeSpecifier: self.typeSpecifier }`).
   *
   * Strategy 2: Look at child Reference entries. Languages using `ref()` for
   *   type annotations (e.g. SysML2's `OwnedFeatureTyping`) automatically get
   *   indexed Reference children whose name is the referenced type.
   */
  private resolveTypeOf(entry: SymbolEntry): SymbolEntry | null {
    if (
      this.activeTypeOfIds.has(entry.id) ||
      this.resolveDepth > 16 ||
      entry.kind === "Package" ||
      entry.kind === "Class" ||
      entry.kind === "Function"
    ) {
      return null;
    }
    this.activeTypeOfIds.add(entry.id);
    try {
      // Strategy 1: Prioritize explicit typeSpecifier / type metadata first
      if (entry.metadata) {
        const preferredKeys = ["typeSpecifier", "type", "className"];
        for (const key of preferredKeys) {
          const value = entry.metadata[key];
          if (typeof value === "string" && value.length > 0) {
            const typeDecls = this.resolveName(value, entry.parentId);
            if (typeDecls.length > 0 && this.isDecl(typeDecls[0]!)) {
              return typeDecls[0]!;
            }
          }
        }
        for (const [key, value] of Object.entries(entry.metadata)) {
          if (
            key === "description" ||
            key === "typePrefix" ||
            key === "classPrefixes" ||
            key === "classKind" ||
            key === "isPredefined"
          ) {
            continue;
          }
          if (typeof value === "string" && value.length > 0) {
            const typeDecls = this.resolveName(value, entry.parentId);
            if (typeDecls.length > 0 && this.isDecl(typeDecls[0]!)) {
              return typeDecls[0]!;
            }
          }
        }
      }

      // Strategy 2: Check child Reference entries (from ref() hooks)
      // Explicitly filter for `c.kind === "Reference"` so Extends/Import/ConnectEquation are never treated as type refs
      const childRefs = this.getExportedChildren(entry.id).filter((c) => c.kind === "Reference");
      for (const ref of childRefs) {
        if (ref.name && ref.name.length > 0) {
          // Try lexical resolution first, then global byName fallback
          const typeDecls = this.resolveName(ref.name, entry.parentId);
          if (typeDecls.length === 0) {
            const globalIds = this.index.byName.get(ref.name);
            if (globalIds) {
              for (const id of globalIds) {
                const globalEntry = this.index.symbols.get(id);
                if (
                  globalEntry &&
                  this.isDecl(globalEntry) &&
                  (globalEntry.kind === "Class" ||
                    globalEntry.kind === "Type" ||
                    globalEntry.kind === "Package" ||
                    globalEntry.kind === "Interface" ||
                    globalEntry.kind === "Struct" ||
                    globalEntry.kind === "Definition" ||
                    Boolean(globalEntry.metadata?.["isPredefined"]))
                ) {
                  typeDecls.push(globalEntry);
                }
              }
            }
          }
          if (typeDecls.length > 0 && this.isDecl(typeDecls[0]!)) {
            return typeDecls[0]!;
          }
        }
      }

      // Strategy 3: For Modelica components lacking metadata.typeSpecifier, inspect the clause prefix in source text
      if (entry.kind === "Component" || entry.kind === "Variable") {
        const clausePrefix = this.extractComponentClausePrefix(entry);
        if (clausePrefix?.typeSpecifier) {
          const typeDecls = this.resolveName(clausePrefix.typeSpecifier, entry.parentId);
          if (typeDecls.length > 0 && this.isDecl(typeDecls[0]!)) {
            return typeDecls[0]!;
          }
        }
      }

      return null;
    } finally {
      this.activeTypeOfIds.delete(entry.id);
    }
  }

  /**
   * Detect if the cursor is inside a class modification `(...)` and return
   * the members of the type being modified.
   *
   * Example: `A a(|)` → cursor is inside parens → show members of A.
   * Also handles nested: `A a(x(|))` → show members of x's type.
   */
  private completeModificationContext(byteOffset: number, before: string): LSPCompletionItem[] | null {
    // Count parentheses depth backwards from cursor to find if we're inside (...)
    let depth = 0;
    let parenPos = -1;
    for (let i = before.length - 1; i >= 0; i--) {
      const ch = before[i];
      if (ch === ")") depth++;
      if (ch === "(") {
        if (depth === 0) {
          parenPos = i;
          break;
        }
        depth--;
      }
    }
    if (parenPos < 0) return null;

    // Text before the opening paren — look for `TypeName varName (`
    const beforeParen = before.slice(0, parenPos).trimEnd();
    const typeName = extractModificationTargetType(beforeParen, false, this.getRootCstNode(), parenPos);
    if (!typeName) return null;

    // Resolve the type
    const scopeEntry = this.findScopeAtOffset(byteOffset);
    const scopeId = scopeEntry?.id ?? null;
    const typeDecls = this.resolveName(typeName, scopeId);
    if (typeDecls.length === 0) return null;

    return this.membersOf(typeDecls[0]!);
  }

  /**
   * Get completion items for all members (exported children + inherited) of a type.
   */
  private membersOf(typeEntry: SymbolEntry): LSPCompletionItem[] {
    const results: LSPCompletionItem[] = [];
    const seen = new Set<string>();

    // Direct children (exclude reference-site entries like extends clauses)
    for (const child of this.getExportedChildren(typeEntry.id)) {
      if (!this.isDecl(child)) continue;
      if (!seen.has(child.name)) {
        seen.add(child.name);
        results.push({
          label: child.name,
          kind: this.mapSymbolKind(child.kind),
          detail: child.kind,
        });
      }
    }

    // Inherited members via resolver
    const inherited = this.getInheritedMembers(typeEntry.id);
    for (const member of inherited) {
      if (!seen.has(member.name)) {
        seen.add(member.name);
        results.push({
          label: member.name,
          kind: this.mapSymbolKind(member.kind),
          detail: `${member.kind} (inherited)`,
        });
      }
    }

    // Foreign cross-language member projection via TggSymbolProjectionTable
    const bridgeLang = this.getBridgeLanguage();
    const projTable = (
      this.index as {
        tggProjectionTable?: {
          projectForeignSignature?: (
            cand: SymbolEntry,
            idx: SymbolIndex,
            tgtLang: string,
          ) => {
            members: Array<{
              name: string;
              projectedType: string;
              role: "port" | "parameter" | "attribute" | "component";
              direction?: string;
            }>;
          };
        };
      }
    ).tggProjectionTable;
    if (
      projTable?.projectForeignSignature &&
      typeEntry.language &&
      bridgeLang &&
      typeEntry.language.toLowerCase() !== bridgeLang.toLowerCase()
    ) {
      const projected = projTable.projectForeignSignature(typeEntry, this.index, bridgeLang);
      for (const m of projected.members) {
        if (!seen.has(m.name)) {
          seen.add(m.name);
          const dirPrefix = m.direction ? `${m.direction} ` : "";
          results.push({
            label: m.name,
            kind: m.role === "component" || m.role === "port" ? LSPSymbolKind.Property : LSPSymbolKind.Variable,
            detail: `${dirPrefix}${m.projectedType} (${m.role} · ${typeEntry.language})`,
          });
        }
      }
    }

    // Virtual completion members defined in metadata
    if (typeEntry.metadata?.["completionMembers"] && Array.isArray(typeEntry.metadata["completionMembers"])) {
      for (const name of typeEntry.metadata["completionMembers"]) {
        if (!seen.has(name) && typeof name === "string") {
          seen.add(name);
          results.push({
            label: name,
            kind: LSPSymbolKind.Property,
            detail: "Property (built-in)",
          });
        }
      }
    }

    return results;
  }

  /**
   * Get exported children of a symbol scope.
   * Uses the index's childrenOf map for O(1) lookup.
   */
  private getExportedChildren(scopeId: SymbolId): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    const childIds = this.index.childrenOf.get(scopeId);
    if (!childIds) return results;
    for (const childId of childIds) {
      const entry = this.index.symbols.get(childId);
      if (entry) results.push(entry);
    }
    return results;
  }

  // =========================================================================
  // textDocument/hover
  // =========================================================================

  /**
   * Computes Markdown hover documentation (`LSPHover`) for the symbol at `byteOffset`,
   * supporting modification-context attribute hover, qualified paths, class/component declarations,
   * doc comments, and predefined types.
   */
  hover(byteOffset: number, sourceText?: string): LSPHover | null {
    const text = sourceText ?? this.positions.getSourceText();
    if (text) {
      const modHover = this.hoverModificationContext(byteOffset, text);
      if (modHover) return modHover;
    }

    if (!text) return null;

    const cstRoot = this.getRootCstNode();
    const span = extractWordSpanAtOffset(text, byteOffset, cstRoot);
    if (!span) {
      return null;
    }

    const { word, start: wordStart, end: wordEnd } = span;
    const qualifiedPrefix = this.extractQualifiedPrefix(text, wordStart, wordEnd, cstRoot);
    const hoverRange = this.positions.rangeFromOffsets(wordStart, wordEnd);

    const entry = this.findEntryAtOffset(byteOffset);
    let targetDecl: SymbolEntry | null = null;

    // 1. If the hovered identifier is part of a dotted or `::`-qualified reference (e.g.
    //    `Modelica.Electrical.Analog.Sources.SineVoltage` or `Vb.p`), resolve the full prefix up to `wordEnd`.
    if (qualifiedPrefix && qualifiedPrefix !== word) {
      const scopeEntry = this.findScopeAtOffset(byteOffset);
      const scopeId = scopeEntry?.id ?? entry?.parentId ?? null;
      const qResolved = this.resolveName(qualifiedPrefix, scopeId);
      if (qResolved.length > 0) {
        targetDecl = qResolved[0]!;
      }
    }

    if (!targetDecl && entry) {
      if (
        entry.kind === "Class" ||
        entry.kind === "Package" ||
        entry.kind === "Module" ||
        entry.kind === "Namespace" ||
        entry.ruleName === "SourceFile" ||
        entry.ruleName === "source_file"
      ) {
        const nameRange = entry.fieldRanges?.["name"];
        const isOverClassName = nameRange
          ? wordStart >= nameRange.startOffset && wordEnd <= nameRange.endOffset
          : word === entry.name && wordStart < entry.startOffset + 200;

        if (isOverClassName) {
          targetDecl = entry;
        } else {
          // Inside class body — resolve the word within this class scope
          const resolved = this.resolveName(qualifiedPrefix || word, entry.id);
          if (resolved.length > 0) {
            targetDecl = resolved[0]!;
          }
        }
      } else if (entry.kind === "Component" || entry.kind === "Variable") {
        const nameRange = entry.fieldRanges?.["name"] ?? entry.fieldRanges?.[entry.namePath];
        const isOverCompName = nameRange
          ? wordStart >= nameRange.startOffset && wordEnd <= nameRange.endOffset
          : word === entry.name && qualifiedPrefix === word;
        if (isOverCompName) {
          targetDecl = entry;
        } else {
          const resolved = this.resolveName(qualifiedPrefix || word, entry.parentId);
          if (resolved.length > 0) {
            targetDecl = resolved[0]!;
          }
        }
      } else if (
        entry.kind === "Reference" ||
        entry.kind === "Extends" ||
        entry.kind === "Import" ||
        entry.kind === "ConnectEquation" ||
        entry.kind === "FunctionCall"
      ) {
        const resolved = this.resolveName(qualifiedPrefix || word, entry.parentId);
        if (resolved.length > 0) {
          targetDecl = resolved[0]!;
        } else {
          const refResolved = this.resolveRef(entry);
          if (refResolved.length > 0) {
            targetDecl = refResolved[0]!;
          }
        }
      } else if (word === entry.name) {
        targetDecl = entry;
      }
    }

    if (!targetDecl) {
      const scopeEntry = this.findScopeAtOffset(byteOffset);
      const scopeId = scopeEntry?.id ?? null;
      const resolved = this.resolveName(qualifiedPrefix || word, scopeId);
      if (resolved.length > 0) {
        targetDecl = resolved[0]!;
      }
    }

    if (!targetDecl) {
      // Check if word is a predefined type in the index
      const predefinedIds = this.index.byName.get(word);
      if (predefinedIds && predefinedIds.length > 0) {
        const candidate = this.index.symbols.get(predefinedIds[0]!);
        if (candidate?.metadata?.["isPredefined"]) {
          targetDecl = candidate;
        }
      }
    }

    if (!targetDecl) return null;

    const md = this.hoverEntry(targetDecl);
    if (!md) return null;

    return {
      contents: md,
      range: hoverRange,
    };
  }

  /**
   * Retrieves the source slice `[start, end]` for `entry` using the bound document, `QueryEngine.cstText`,
   * open workspace documents, or VFS fallback.
   */
  private getEntrySourceSlice(entry: SymbolEntry, start: number, end: number): string | null {
    if (start < 0 || end < start) return null;
    try {
      if (this.engine && typeof this.engine.cstText === "function") {
        const res = this.engine.cstText(start, end, entry);
        if (typeof res === "string" && res.length > 0) return res;
      }
    } catch {
      // ignore
    }

    const fullText = this.getEntryFullSourceText(entry);
    if (fullText && start <= fullText.length) {
      return fullText.slice(start, Math.min(end, fullText.length));
    }
    return null;
  }

  /**
   * Retrieves the full source file text for `entry` (or at least `[0, entryEnd]`).
   */
  private getEntryFullSourceText(entry: SymbolEntry): string | null {
    const uri = entry.resourceId || this.documentUri;
    if (!uri || uri === this.documentUri) {
      const localText = this.positions?.getSourceText?.();
      if (typeof localText === "string" && localText.length > 0) {
        return localText;
      }
    }

    if (uri) {
      const otherBridge = this.env?.documentLSPBridges?.get(uri) ?? (globalThis as any).documentLSPBridges?.get(uri);
      const otherBridgeText = otherBridge?.positions?.getSourceText?.();
      if (typeof otherBridgeText === "string" && otherBridgeText.length > 0) {
        return otherBridgeText;
      }
      const openDocText =
        this.env?.documents?.get(uri)?.getText?.() ?? (globalThis as any).documents?.get(uri)?.getText?.();
      if (typeof openDocText === "string" && openDocText.length > 0) {
        return openDocText;
      }
      const fsPath = uri.startsWith("file://") ? uri.substring(7) : uri;
      const sharedFs = this.env?.sharedFs ?? (globalThis as any).sharedFs;
      const sharedText =
        sharedFs?.readFile?.(uri) ??
        sharedFs?.read?.(fsPath) ??
        (uri.startsWith("sources/")
          ? sharedFs?.read?.(`/modelscript_registry/Modelica/4.1.0/${uri.substring("sources/".length)}`)
          : undefined);
      if (typeof sharedText === "string" && sharedText.length > 0) {
        return sharedText;
      }
    }

    try {
      if (this.engine && typeof this.engine.cstText === "function") {
        const full = this.engine.cstText(0, 10_000_000, entry);
        if (typeof full === "string" && full.length > 0) return full;
        const entryEnd = entry.endOffset ?? 0;
        if (entryEnd > 0) {
          const prefix = this.engine.cstText(0, entryEnd, entry);
          if (typeof prefix === "string" && prefix.length > 0) return prefix;
        }
      }
    } catch {
      // ignore
    }

    return null;
  }

  /**
   * Resolves the backing WASM CST `SyntaxNode` for `entry` when a parser tree is available
   * on the active `QueryEngine`, another open workspace bridge, or `env.documents`.
   */
  private getEntryCstNode(entry?: SymbolEntry | null): SyntaxNode | null {
    if (!entry) return null;
    type EngineCstAccess = {
      cstNode?(id: SymbolId): SyntaxNode | null | undefined;
      toQueryDB?(): { cstNode?(id: SymbolId): SyntaxNode | null | undefined } | null;
    };
    type BridgeGlobals = {
      documentLSPBridges?: Map<string, { engine?: unknown }>;
      documents?: Map<string, { tree?: { rootNode?: SyntaxNode } }>;
    };
    const globals = globalThis as unknown as BridgeGlobals;
    try {
      const eng = this.engine as unknown as EngineCstAccess | undefined;
      if (eng && typeof eng.cstNode === "function") {
        const node = eng.cstNode(entry.id);
        if (node && typeof node.type === "string") return node;
      }
      const db = eng && typeof eng.toQueryDB === "function" ? eng.toQueryDB() : null;
      if (db && typeof db.cstNode === "function") {
        const node = db.cstNode(entry.id);
        if (node && typeof node.type === "string") return node;
      }
      const uri = entry.resourceId || this.documentUri;
      if (uri) {
        const otherBridge = this.env?.documentLSPBridges?.get(uri) ?? globals.documentLSPBridges?.get(uri);
        const otherEng = (otherBridge as unknown as { engine?: unknown } | undefined)?.engine as
          | EngineCstAccess
          | undefined;
        if (otherEng && typeof otherEng.cstNode === "function") {
          const node = otherEng.cstNode(entry.id);
          if (node && typeof node.type === "string") return node;
        }
        const doc = this.env?.documents?.get(uri) ?? globals.documents?.get(uri);
        const root = (doc as { tree?: { rootNode?: SyntaxNode } } | undefined)?.tree?.rootNode;
        if (root && typeof root.descendantForIndex === "function" && entry.startOffset !== undefined) {
          const node = root.descendantForIndex(entry.startOffset, entry.endOffset ?? entry.startOffset);
          if (node && typeof node.type === "string") return node;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Resolves the root WASM CST `SyntaxNode` for `resourceUri` (or the bridge's bound document).
   */
  private getRootCstNode(resourceUri?: string): SyntaxNode | null {
    type EngineRootAccess = {
      tree?: { rootNode?: SyntaxNode };
      toQueryDB?(): { tree?: { rootNode?: SyntaxNode } } | null;
    };
    type BridgeGlobals = {
      documentLSPBridges?: Map<string, { engine?: unknown }>;
      documents?: Map<string, { tree?: { rootNode?: SyntaxNode } }>;
    };
    const globals = globalThis as unknown as BridgeGlobals;
    try {
      const eng = this.engine as unknown as EngineRootAccess | undefined;
      if (!resourceUri || resourceUri === this.documentUri) {
        const directRoot = eng?.tree?.rootNode ?? eng?.toQueryDB?.()?.tree?.rootNode;
        if (directRoot && typeof directRoot.descendantForIndex === "function") {
          return directRoot;
        }
      }
      const uri = resourceUri || this.documentUri;
      if (uri) {
        const otherBridge = this.env?.documentLSPBridges?.get(uri) ?? globals.documentLSPBridges?.get(uri);
        const otherEng = (otherBridge as unknown as { engine?: unknown } | undefined)?.engine as
          | EngineRootAccess
          | undefined;
        const otherRoot = otherEng?.tree?.rootNode ?? otherEng?.toQueryDB?.()?.tree?.rootNode;
        if (otherRoot && typeof otherRoot.descendantForIndex === "function") {
          return otherRoot;
        }
        const doc = this.env?.documents?.get(uri) ?? globals.documents?.get(uri);
        const docRoot = (doc as { tree?: { rootNode?: SyntaxNode } } | undefined)?.tree?.rootNode;
        if (docRoot && typeof docRoot.descendantForIndex === "function") {
          return docRoot;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Extracts the `type_prefix` and `type_specifier` from the enclosing Modelica `component_clause`
   * preceding `entry` when `entry` only spans `component_declaration` (e.g. `V(start=1) "..."`).
   */
  private extractComponentClausePrefix(
    entry: SymbolEntry,
  ): { fullPrefix: string; typePrefix: string; typeSpecifier: string; clauseStartOffset: number } | null {
    const rawNode = this.getEntryCstNode(entry);
    const clauseNode = findAncestorOrSelfByType(
      rawNode,
      ["component_clause", "component_clause1"],
      ["element_list", "composition", "class_definition", "stored_definition", "program"],
    );
    if (clauseNode && !clauseNode.hasError) {
      const elementNode = clauseNode.parent?.type === "element" ? clauseNode.parent : null;
      const prefixes: string[] = [];
      if (elementNode) {
        const clauseStart = getNodeStartOffset(clauseNode);
        for (const child of elementNode.children) {
          if (getNodeStartOffset(child) >= clauseStart) break;
          const kw = child.text.trim();
          if (MODELICA_ELEMENT_PREFIXES.has(kw)) {
            prefixes.push(kw);
          }
        }
      }
      const tpNode = clauseNode.childForFieldName("type_prefix");
      if (tpNode) {
        const tp = collapseWs(tpNode.text);
        if (tp) prefixes.push(tp);
      }
      const tsNode = clauseNode.childForFieldName("type_specifier");
      const typeSpecifier = tsNode ? collapseWs(tsNode.text) : "";
      if (typeSpecifier) {
        const typePrefix = collapseWs(prefixes.join(" "));
        const fullPrefix = typePrefix ? `${typePrefix} ${typeSpecifier}` : typeSpecifier;
        const outerNode = elementNode ?? clauseNode;
        return {
          fullPrefix,
          typePrefix,
          typeSpecifier,
          clauseStartOffset: getNodeStartOffset(outerNode),
        };
      }
    }

    const entryStart = entry.startOffset ?? 0;
    const fullText = this.getEntryFullSourceText(entry);
    if (!fullText || entryStart <= 0 || entryStart > fullText.length) return null;

    // Fallback: scan backwards from entryStart to find the start of the component_clause
    // (after the previous `;`, `{`, or class header string/name).
    const lookbackStart = Math.max(0, entryStart - 500);
    const before = fullText.slice(lookbackStart, entryStart);

    // Find the last statement boundary (`;`, `{`, or section keyword `public`/`protected`) at paren depth 0
    let depth = 0;
    let inString = false;
    let clauseRelStart = 0;
    for (let i = before.length - 1; i >= 0; i--) {
      const ch = before[i]!;
      if (ch === '"' && (i === 0 || before[i - 1] !== "\\")) {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === ")" || ch === "]" || ch === "}") depth++;
      else if (ch === "(" || ch === "[" || ch === "{") {
        if (depth === 0) {
          clauseRelStart = i + 1;
          break;
        }
        depth--;
      } else if (depth === 0 && ch === ";") {
        clauseRelStart = i + 1;
        break;
      }
    }

    let rawClauseBefore = before.slice(clauseRelStart);
    let clauseStartOffset = lookbackStart + clauseRelStart;

    // Strip leading comments and section keywords (`public`, `protected`)
    let leadingIdx = 0;
    while (leadingIdx < rawClauseBefore.length) {
      leadingIdx = skipModelicaTrivia(rawClauseBefore, leadingIdx);
      if (startsWithWordAt(rawClauseBefore, leadingIdx, "public")) {
        leadingIdx += "public".length;
        continue;
      }
      if (startsWithWordAt(rawClauseBefore, leadingIdx, "protected")) {
        leadingIdx += "protected".length;
        continue;
      }
      break;
    }
    if (leadingIdx > 0) {
      rawClauseBefore = rawClauseBefore.slice(leadingIdx);
      clauseStartOffset += leadingIdx;
    }

    const trimmedClause = rawClauseBefore.trim();
    if (!trimmedClause) {
      return {
        fullPrefix: "",
        typePrefix: "",
        typeSpecifier: "",
        clauseStartOffset: entryStart,
      };
    }

    const parsed = parseModelicaClausePrefixTokens(trimmedClause);
    if (!parsed) return null;

    // Avoid matching class header keywords (`model Foo`) if there was no `;` after class header
    if (!parsed.typePrefix && MODELICA_CLAUSE_STOP_KEYWORDS.has(parsed.typeSpecifier)) {
      // Look after the last newline in `rawClauseBefore` instead
      const lastNl = rawClauseBefore.lastIndexOf("\n");
      if (lastNl !== -1) {
        const lineBefore = rawClauseBefore.slice(lastNl + 1).trim();
        const lineParsed = parseModelicaClausePrefixTokens(lineBefore);
        if (lineParsed) {
          return {
            fullPrefix: lineParsed.fullPrefix,
            typePrefix: lineParsed.typePrefix,
            typeSpecifier: lineParsed.typeSpecifier,
            clauseStartOffset: clauseStartOffset + lastNl + 1,
          };
        }
      }
      return null;
    }

    return {
      fullPrefix: parsed.fullPrefix,
      typePrefix: parsed.typePrefix,
      typeSpecifier: parsed.typeSpecifier,
      clauseStartOffset,
    };
  }

  /**
   * Strips Modelica `annotation(...)` clauses from a declaration or statement string using
   * CST `annotation_clause` spans when available, falling back to string/comment-aware scanning.
   */
  private stripModelicaAnnotations(input: string, cstNode?: SyntaxNode): string {
    if (cstNode && !cstNode.hasError && (cstNode.text ?? "") === input) {
      return stripAnnotationClausesFromCst(cstNode, (text) => this.stripModelicaAnnotations(text));
    }
    let result = "";
    let i = 0;
    const len = input.length;
    while (i < len) {
      const ch = input[i]!;
      // String literal
      if (ch === '"') {
        const end = skipModelicaString(input, i);
        result += input.slice(i, end);
        i = end;
        continue;
      }
      // Line or block comment
      if (ch === "/" && (input[i + 1] === "/" || input[i + 1] === "*")) {
        const end = skipModelicaTrivia(input, i);
        result += input.slice(i, end);
        i = end;
        continue;
      }
      // Check for word `annotation` followed by `(`
      if (ch === "a" && startsWithWordAt(input, i, "annotation")) {
        let j = skipWs(input, i + "annotation".length);
        if (input[j] === "(") {
          // Advance to matching `)`
          let depth = 1;
          j++;
          while (j < len && depth > 0) {
            const inner = input[j]!;
            if (inner === '"') {
              j = skipModelicaString(input, j);
            } else if (inner === "/" && (input[j + 1] === "/" || input[j + 1] === "*")) {
              j = skipModelicaTrivia(input, j);
            } else if (inner === "(") {
              depth++;
              j++;
            } else if (inner === ")") {
              depth--;
              j++;
            } else {
              j++;
            }
          }
          // Trim trailing horizontal whitespace before `annotation`
          result = trimEndHorizontalWs(result);
          i = j;
          continue;
        }
      }
      result += ch;
      i++;
    }
    return result;
  }

  /**
   * Formats a clean, IDE-grade Modelica class/model/block/connector/record/function/type/package
   * declaration signature from CST nodes when available (or its raw CST source span as fallback),
   * keeping the class header, public `extends` clauses, and public parameter/port/component declarations
   * while stripping `annotation(...)` blocks and `protected`/`equation`/`algorithm` implementation sections.
   */
  private formatModelicaClassSignature(rawClassText: string, entry: SymbolEntry): string {
    const rawNode = this.getEntryCstNode(entry);
    const classNode = findAncestorOrSelfByType(
      rawNode,
      ["class_definition", "short_class_definition"],
      ["element_list", "stored_definition", "program"],
    );
    if (classNode && !classNode.hasError) {
      const specNode = findModelicaClassSpecNode(classNode);
      const specName = specNode?.childForFieldName("name")?.text.trim();
      if (specNode && (!specName || specName === entry.name)) {
        if (specNode.type === "short_class_specifier" || specNode.type === "der_class_specifier") {
          const stripped = stripAnnotationClausesFromCst(classNode, (s) => this.stripModelicaAnnotations(s));
          const normalized = collapseWs(stripped);
          const withSemi =
            rawClassText.trim().endsWith(";") && !normalized.endsWith(";") ? `${normalized};` : normalized;
          return normalizeTrailingSemicolon(withSemi);
        }

        if (specNode.type === "long_class_specifier") {
          const baseStart = getNodeStartOffset(classNode);
          const compNode = specNode.childForFieldName("composition");
          const headerEndNode =
            specNode.childForFieldName("description") ??
            specNode.childForFieldName("class_modification") ??
            specNode.childForFieldName("name") ??
            compNode;
          const headerRelEnd = headerEndNode
            ? headerEndNode === compNode
              ? getNodeStartOffset(compNode) - baseStart
              : getNodeEndOffset(headerEndNode) - baseStart
            : classNode.text.length;
          const clampedEnd = Math.max(0, Math.min(headerRelEnd, classNode.text.length));
          const header = normalizeHeaderWhitespace(classNode.text.slice(0, clampedEnd));

          const memberLines: string[] = [];
          if (compNode) {
            let inPublic = true;
            for (const child of compNode.children) {
              if (child.type === "public") {
                inPublic = true;
                continue;
              }
              if (child.type === "protected") {
                inPublic = false;
                continue;
              }
              if (
                child.type === "equation_section" ||
                child.type === "algorithm_section" ||
                child.type === "external_clause"
              ) {
                break;
              }
              if (child.type === "element_list" && inPublic) {
                for (const el of child.namedChildren) {
                  if (el.type === "annotation_clause") continue;
                  if (el.type === "element") {
                    if (el.childForFieldName("import_clause")) continue;
                    const nestedClass = el.childForFieldName("class_definition");
                    const isReplaceable = el.children.some(
                      (c) => c.type === "replaceable" || (!c.isNamed && c.text === "replaceable"),
                    );
                    if (nestedClass && !isReplaceable) {
                      const nestedSpec = findModelicaClassSpecNode(nestedClass);
                      if (nestedSpec?.type === "long_class_specifier") continue;
                    }
                  }
                  const stripped = stripAnnotationClausesFromCst(el, (s) => this.stripModelicaAnnotations(s));
                  const cleanedStmt = ensureTrailingSemicolon(stripped);
                  if (cleanedStmt && cleanedStmt !== ";" && !startsWithWordAt(cleanedStmt, 0, "import")) {
                    pushFormattedMemberLines(memberLines, cleanedStmt);
                  }
                }
              }
            }
          }

          return assembleClassSignature(header, memberLines, entry.name);
        }
      }
    }

    const trimmed = rawClassText.trim().replaceAll("\r\n", "\n");
    const trailingEndIdx = matchTrailingEndClass(trimmed, entry.name);

    // 1. Short class definition (e.g. `type Voltage = ElectricPotential;` or `type V = Real(...) "...";`)
    if (trailingEndIdx === -1) {
      const cleaned = collapseWs(this.stripModelicaAnnotations(trimmed));
      return normalizeTrailingSemicolon(cleaned);
    }

    // 2. Long class definition (`model Name "..." ... end Name;`)
    const withoutEnd = trimmed.slice(0, trailingEndIdx).trimEnd();

    // Locate the end of the class header (`[prefixes] classKind Name ["description"]`)
    const nameIdx = findWordOutsideStringsComments(withoutEnd, entry.name);
    if (nameIdx === -1) {
      return `${entry.metadata?.["classPrefixes"] || entry.metadata?.["classKind"] || "class"} ${entry.name}`;
    }

    let pos = nameIdx + entry.name.length;
    const afterName = skipWs(withoutEnd, pos);
    if (withoutEnd[afterName] === '"') {
      pos = skipModelicaConcatString(withoutEnd, afterName);
    }

    const header = normalizeHeaderWhitespace(withoutEnd.slice(0, pos));
    const body = withoutEnd.slice(pos);

    // Scan top-level statements inside `body`
    const memberLines: string[] = [];
    let i = 0;
    const bLen = body.length;
    let inPublic = true;
    let stmtStart = 0;
    let parenDepth = 0;
    let nestedClassDepth = 0;
    let nestedClassTargetEnd: string | null = null;

    while (i < bLen) {
      const ch = body[i]!;
      // Strings
      if (ch === '"') {
        i = skipModelicaString(body, i);
        continue;
      }
      // Line or block comment
      if (ch === "/" && (body[i + 1] === "/" || body[i + 1] === "*")) {
        i = skipModelicaTrivia(body, i);
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") {
        parenDepth++;
        i++;
        continue;
      }
      if (ch === ")" || ch === "]" || ch === "}") {
        parenDepth = Math.max(0, parenDepth - 1);
        i++;
        continue;
      }

      if (parenDepth === 0) {
        // Track nested long classes inside packages/models
        if (nestedClassDepth > 0) {
          if (startsWithWordAt(body, i, "end")) {
            let j = skipWs(body, i + "end".length);
            const idTok = readIdentAt(body, j);
            if (idTok && (!nestedClassTargetEnd || idTok.ident === nestedClassTargetEnd)) {
              j = skipWs(body, idTok.end);
              if (body[j] === ";") j++;
              nestedClassDepth = 0;
              nestedClassTargetEnd = null;
              i = j;
              stmtStart = i;
              continue;
            }
          }
          i++;
          continue;
        }

        // Check for top-level section keywords at statement start
        const leadingSlice = body.slice(stmtStart, i).trim();
        if (leadingSlice === "") {
          if (startsWithWordAt(body, i, "public")) {
            inPublic = true;
            i += "public".length;
            stmtStart = i;
            continue;
          }
          if (startsWithWordAt(body, i, "protected")) {
            inPublic = false;
            i += "protected".length;
            stmtStart = i;
            continue;
          }
          if (
            startsWithWordAt(body, i, "equation") ||
            startsWithWordAt(body, i, "algorithm") ||
            startsWithWordAt(body, i, "external")
          ) {
            break;
          }
          if (startsWithWordAt(body, i, "initial")) {
            const afterInit = skipWs(body, i + "initial".length);
            if (
              afterInit > i + "initial".length &&
              (startsWithWordAt(body, afterInit, "equation") || startsWithWordAt(body, afterInit, "algorithm"))
            ) {
              break;
            }
          }
          // Check if a nested long class starts here
          const nestedStart = matchNestedLongClassStart(body, i);
          if (nestedStart) {
            nestedClassDepth = 1;
            nestedClassTargetEnd = nestedStart.name;
            i = nestedStart.end;
            continue;
          }
        }

        if (ch === ";") {
          const rawStmt = body.slice(stmtStart, i + 1);
          stmtStart = i + 1;
          if (inPublic) {
            // Strip leading comments from statement
            const withoutLeadingComments = rawStmt.slice(skipModelicaTrivia(rawStmt, 0)).trim();
            const cleanedStmt = normalizeTrailingSemicolon(this.stripModelicaAnnotations(withoutLeadingComments));
            if (cleanedStmt && cleanedStmt !== ";" && !startsWithWordAt(cleanedStmt, 0, "import")) {
              pushFormattedMemberLines(memberLines, cleanedStmt);
            }
          }
        }
      }
      i++;
    }

    return assembleClassSignature(header, memberLines, entry.name);
  }

  /**
   * Formats a human-readable code signature for a `SymbolEntry` suitable for fenced code blocks in hover cards.
   */
  private formatDeclaration(entry: SymbolEntry): string {
    if (this.activeFormatIds.has(entry.id)) {
      return `${entry.kind.toLowerCase()} ${entry.name}`;
    }
    this.activeFormatIds.add(entry.id);
    try {
      const meta = entry.metadata;
      const lang = entry.language ?? (entry.resourceId?.endsWith(".sysml") ? "sysml" : "modelica");
      let declStr = "";

      if (meta?.["isPredefined"]) {
        const cKind = typeof meta["classKind"] === "string" ? meta["classKind"] : "type";
        declStr = `${cKind} ${entry.name}`;
        const attrs = meta["completionMembers"];
        if (Array.isArray(attrs) && attrs.length > 0) {
          declStr += `(\n`;
          const lines: string[] = [];
          for (const attr of attrs) {
            if (typeof attr === "string") {
              const val = meta[attr];
              if (val === "") {
                lines.push(`  ${attr}`);
              } else {
                const valStr = typeof val === "string" ? `"${val}"` : String(val);
                lines.push(`  ${attr} = ${valStr}`);
              }
            }
          }
          declStr += lines.join(",\n");
          declStr += `\n)`;
        }
        return declStr;
      }

      const entryStart = entry.startOffset ?? 0;
      const entryEnd = entry.endOffset ?? 0;
      const source = entryEnd > entryStart ? this.getEntrySourceSlice(entry, entryStart, entryEnd) : null;

      if (
        entry.kind === "Class" ||
        entry.kind === "Function" ||
        entry.kind === "Package" ||
        entry.kind === "Type" ||
        entry.kind === "Struct" ||
        entry.kind === "Interface"
      ) {
        if (source) {
          if (lang === "modelica") {
            return this.formatModelicaClassSignature(source, entry);
          }
          // For ModelScript / SysML v2 / OpenSCAD functions: extract signature up to `{`
          if (entry.kind === "Function") {
            const braceIdx = source.indexOf("{");
            if (braceIdx !== -1) {
              return source.slice(0, braceIdx).trim();
            }
          }
          // For SysML v2 / ModelScript definitions/structs: strip `doc /* ... */` blocks and cap lines
          const withoutDoc = stripSysmlDocBlocks(source).trim();
          const lines = withoutDoc
            .split("\n")
            .map((l) => l.trimEnd())
            .filter((l, idx, arr) => !(l.trim() === "" && idx > 0 && arr[idx - 1]!.trim() === ""));
          if (lines.length > 18) {
            return [...lines.slice(0, 16), "  // ...", lines[lines.length - 1]!].join("\n");
          }
          return lines.join("\n");
        }

        // Fallback when source text is unavailable: synthesize from metadata and indexed children
        const classPrefix =
          (meta && typeof meta["classPrefixes"] === "string" && meta["classPrefixes"]) ||
          (meta && typeof meta["classKind"] === "string" && meta["classKind"]) ||
          entry.kind.toLowerCase();
        const rawDesc = meta && typeof meta["description"] === "string" ? stripOuterQuotes(meta["description"]) : "";
        declStr = `${classPrefix} ${entry.name}${rawDesc ? ` "${rawDesc}"` : ""}`;

        const childLines: string[] = [];
        for (const child of this.getExportedChildren(entry.id)) {
          if (child.kind === "Extends") {
            const extType =
              (typeof child.metadata?.["typeSpecifier"] === "string" && child.metadata["typeSpecifier"]) || child.name;
            if (extType) childLines.push(`  extends ${extType};`);
          } else if (child.kind === "Component" || child.kind === "Variable") {
            childLines.push(`  ${this.formatDeclaration(child)};`);
          }
        }
        if (childLines.length > 0 && lang === "modelica") {
          const capped =
            childLines.length > 15
              ? [...childLines.slice(0, 15), `  // ... (${childLines.length - 15} more declarations)`]
              : childLines;
          return `${declStr}\n${capped.join("\n")}\nend ${entry.name};`;
        }
        return declStr;
      }

      // Component / Variable / Property / Field declaration
      if (source) {
        const declNode = lang === "modelica" ? this.getEntryCstNode(entry) : null;
        let cleaned = stripTrailingStringCommentAndSemi(
          stripSysmlDocBlocks(this.stripModelicaAnnotations(source, declNode ?? undefined)),
          declNode,
        );

        // In Modelica CST, `component_declaration` starts at the component name (`V(start=1)`)
        // while `parameter SI.Voltage` is on the parent `component_clause`.
        if (
          (entry.kind === "Component" || entry.kind === "Variable") &&
          (cleaned === entry.name ||
            cleaned.startsWith(`${entry.name}(`) ||
            cleaned.startsWith(`${entry.name}[`) ||
            cleaned.startsWith(`${entry.name} `) ||
            cleaned.startsWith(`${entry.name}=`))
        ) {
          const clausePrefix = this.extractComponentClausePrefix(entry);
          if (clausePrefix?.fullPrefix) {
            cleaned = `${clausePrefix.fullPrefix} ${cleaned}`;
          } else {
            let prefix = "";
            if (meta && typeof meta["typePrefix"] === "string" && meta["typePrefix"]) {
              prefix += `${meta["typePrefix"].trim()} `;
            } else {
              if (meta && typeof meta["causality"] === "string" && meta["causality"]) prefix += `${meta["causality"]} `;
              if (meta && typeof meta["variability"] === "string" && meta["variability"])
                prefix += `${meta["variability"]} `;
            }
            if (meta && typeof meta["typeSpecifier"] === "string" && meta["typeSpecifier"]) {
              prefix += `${meta["typeSpecifier"].trim()} `;
            }
            if (prefix) {
              cleaned = `${prefix}${cleaned}`;
            }
          }
        }
        return cleaned;
      }

      if (meta && typeof meta["typePrefix"] === "string" && meta["typePrefix"]) {
        declStr += `${meta["typePrefix"].trim()} `;
      } else {
        if (meta && typeof meta["causality"] === "string" && meta["causality"]) declStr += `${meta["causality"]} `;
        if (meta && typeof meta["variability"] === "string" && meta["variability"])
          declStr += `${meta["variability"]} `;
      }
      if (meta && typeof meta["typeSpecifier"] === "string" && meta["typeSpecifier"])
        declStr += `${meta["typeSpecifier"]} `;
      declStr += entry.name;

      return declStr;
    } finally {
      this.activeFormatIds.delete(entry.id);
    }
  }

  /**
   * Unescapes a Modelica string literal (or `"..." + "..."` concatenation) and strips outer quotes.
   */
  private unescapeModelicaString(raw: string): string {
    const trimmed = raw.trim();
    const parts: string[] = [];
    let i = 0;
    const len = trimmed.length;
    while (i < len) {
      while (i < len && (isWsChar(trimmed[i]!) || trimmed[i] === "+")) i++;
      if (trimmed[i] !== '"') break;
      i++;
      let buf = "";
      while (i < len) {
        if (trimmed[i] === "\\" && i + 1 < len) {
          const next = trimmed[i + 1]!;
          if (next === '"') buf += '"';
          else if (next === "\\") buf += "\\";
          else if (next === "n") buf += "\n";
          else if (next === "t") buf += "\t";
          else if (next === "r") buf += "\r";
          else buf += next;
          i += 2;
        } else if (trimmed[i] === '"') {
          i++;
          break;
        } else {
          buf += trimmed[i]!;
          i++;
        }
      }
      parts.push(buf);
    }
    if (parts.length > 0) return parts.join("");
    return stripOuterQuotes(trimmed);
  }

  /**
   * Converts Modelica `Documentation(info="<html>...</html>")` HTML into clean Markdown.
   */
  private modelicaHtmlToMarkdown(rawHtml: string): string {
    if (!rawHtml) return "";
    let html = rawHtml
      .replace(/<!DOCTYPE[^>]*>/gi, "")
      .replace(/<head(?:\s[^>]*)?>[\s\S]*?<\/head>/gi, "")
      .replace(/<\/?(?:html|body)(?:\s[^>]*)?>/gi, "")
      .trim();
    if (!html) return "";

    const decodeEntities = (s: string): string =>
      s
        .replace(/&nbsp;/gi, " ")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'")
        .replace(/&Omega;/g, "Ω")
        .replace(/&omega;/g, "ω")
        .replace(/&Delta;/g, "Δ")
        .replace(/&delta;/g, "δ")
        .replace(/&alpha;/gi, "α")
        .replace(/&beta;/gi, "β")
        .replace(/&gamma;/gi, "γ")
        .replace(/&epsilon;/gi, "ε")
        .replace(/&mu;/gi, "μ")
        .replace(/&pi;/gi, "π")
        .replace(/&phi;/g, "φ")
        .replace(/&Phi;/g, "Φ")
        .replace(/&tau;/gi, "τ")
        .replace(/&theta;/gi, "θ")
        .replace(/&lambda;/gi, "λ")
        .replace(/&sigma;/gi, "σ")
        .replace(/&rho;/gi, "ρ")
        .replace(/&eta;/gi, "η")
        .replace(/&deg;/gi, "°")
        .replace(/&plusmn;/gi, "±")
        .replace(/&times;/gi, "×")
        .replace(/&middot;/gi, "·")
        .replace(/&ndash;/gi, "–")
        .replace(/&mdash;/gi, "—")
        .replace(/&le;/gi, "≤")
        .replace(/&ge;/gi, "≥")
        .replace(/&ne;/gi, "≠")
        .replace(/&infin;/gi, "∞")
        .replace(/&rarr;/gi, "→")
        .replace(/&larr;/gi, "←")
        .replace(/&harr;/gi, "↔")
        .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&amp;/gi, "&");

    const stripHtmlTags = (s: string): string => {
      let prev: string;
      do {
        prev = s;
        s = s.replace(/<\/?[a-zA-Z][^>]*>/g, "");
      } while (s !== prev);
      return s;
    };

    const stripTagAndContent = (input: string, tagName: string): string => {
      let result = "";
      let cursor = 0;
      const lower = input.toLowerCase();
      const openPrefix = `<${tagName.toLowerCase()}`;
      const closeTag = `</${tagName.toLowerCase()}`;

      while (cursor < input.length) {
        const startIdx = lower.indexOf(openPrefix, cursor);
        if (startIdx === -1) {
          result += input.slice(cursor);
          break;
        }
        const afterPrefix = lower[startIdx + openPrefix.length];
        if (afterPrefix !== undefined && afterPrefix !== ">" && afterPrefix !== "/" && !/\s/.test(afterPrefix)) {
          result += input.slice(cursor, startIdx + openPrefix.length);
          cursor = startIdx + openPrefix.length;
          continue;
        }
        result += input.slice(cursor, startIdx);
        const openTagEnd = lower.indexOf(">", startIdx);
        if (openTagEnd === -1) {
          break;
        }
        if (lower[openTagEnd - 1] === "/") {
          cursor = openTagEnd + 1;
          continue;
        }
        const closeIdx = lower.indexOf(closeTag, openTagEnd + 1);
        if (closeIdx === -1) {
          break;
        }
        const closeTagEnd = lower.indexOf(">", closeIdx);
        if (closeTagEnd === -1) {
          break;
        }
        cursor = closeTagEnd + 1;
      }
      return result;
    };

    // 0. Strip script and style blocks completely
    html = stripTagAndContent(html, "script");
    html = stripTagAndContent(html, "style");

    // 1. Preserve <pre>...</pre> blocks as fenced code blocks
    const preBlocks: string[] = [];
    html = html.replace(/<pre(?:\s[^>]*)?>([\s\S]*?)<\/pre>/gi, (_m, inner) => {
      const cleanCode = decodeEntities(stripHtmlTags(inner)).trim();
      const idx = preBlocks.length;
      preBlocks.push(`\n\n\`\`\`modelica\n${cleanCode}\n\`\`\`\n\n`);
      return `\x00PRE_${idx}\x00`;
    });

    // 2. Strip <img> tags (e.g. modelica://.../image.png)
    html = html.replace(/<img\b[^>]*>/gi, "");

    // 3. Convert <a href="...">text</a>
    html = html.replace(/<a\s+[^>]*href=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, href, text) => {
      const cleanText = stripHtmlTags(text).trim();
      if (href.startsWith("http://") || href.startsWith("https://")) {
        return `[${cleanText || href}](${href})`;
      }
      return cleanText ? `\`${cleanText}\`` : `\`${href.replace(/^modelica:\/\//i, "")}\``;
    });

    // 4. Convert <table>...</table> to Markdown tables or bullet rows
    html = html.replace(/<table(?:\s[^>]*)?>([\s\S]*?)<\/table>/gi, (_m, tableInner) => {
      const rows: string[][] = [];
      const rowRegex = /<tr(?:\s[^>]*)?>([\s\S]*?)<\/tr>/gi;
      let rMatch: RegExpExecArray | null;
      while ((rMatch = rowRegex.exec(tableInner)) !== null) {
        const cells: string[] = [];
        const cellRegex = /<t[hd](?:\s[^>]*)?>([\s\S]*?)<\/t[hd]>/gi;
        let cMatch: RegExpExecArray | null;
        while ((cMatch = cellRegex.exec(rMatch[1]!)) !== null) {
          const cellText = decodeEntities(
            stripHtmlTags(
              cMatch[1]!
                .replace(/<(?:b|strong)(?:\s[^>]*)?>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**")
                .replace(/<(?:i|em|var)(?:\s[^>]*)?>([\s\S]*?)<\/(?:i|em|var)>/gi, "*$1*")
                .replace(/<(?:code|tt)(?:\s[^>]*)?>([\s\S]*?)<\/(?:code|tt)>/gi, "`$1`"),
            )
              .replace(/\s+/g, " ")
              .trim(),
          );
          cells.push(cellText.replace(/\\/g, "\\\\").replace(/\|/g, "\\|"));
        }
        if (cells.length > 0) rows.push(cells);
      }
      if (rows.length === 0) return "";
      const colCount = Math.max(...rows.map((r) => r.length));
      if (colCount >= 2 && rows.length >= 2) {
        const padRow = (r: string[]) => {
          const padded = [...r];
          while (padded.length < colCount) padded.push("");
          return `| ${padded.join(" | ")} |`;
        };
        const sep = `| ${Array(colCount).fill("---").join(" | ")} |`;
        return `\n\n${padRow(rows[0]!)}\n${sep}\n${rows.slice(1).map(padRow).join("\n")}\n\n`;
      }
      return `\n\n${rows.map((r) => `- ${r.join(" — ")}`).join("\n")}\n\n`;
    });

    // 5. Headings, inline styles, lists, paragraphs, and breaks
    html = html
      .replace(/<h[1-6](?:\s[^>]*)?>([\s\S]*?)<\/h[1-6]>/gi, (_m, inner) => {
        const hText = stripHtmlTags(inner).replace(/\s+/g, " ").trim();
        return hText ? `\n\n**${hText}**\n\n` : "";
      })
      .replace(/<(?:b|strong)(?:\s[^>]*)?>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**")
      .replace(/<(?:i|em|var)(?:\s[^>]*)?>([\s\S]*?)<\/(?:i|em|var)>/gi, "*$1*")
      .replace(/<(?:code|tt)(?:\s[^>]*)?>([\s\S]*?)<\/(?:code|tt)>/gi, "`$1`")
      .replace(/<sub(?:\s[^>]*)?>([\s\S]*?)<\/sub>/gi, "_$1")
      .replace(/<sup(?:\s[^>]*)?>([\s\S]*?)<\/sup>/gi, "^$1")
      .replace(/<dt(?:\s[^>]*)?>([\s\S]*?)<\/dt>/gi, (_m, inner) => `\n- **${inner.trim()}**: `)
      .replace(/<dd(?:\s[^>]*)?>([\s\S]*?)<\/dd>/gi, (_m, inner) => `${inner.trim()}\n`)
      .replace(/<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi, (_m, inner) => {
        const liText = inner.replace(/\s+/g, " ").trim();
        return liText ? `\n- ${liText}` : "";
      })
      .replace(/<\/?(?:ul|ol|dl)(?:\s[^>]*)?>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<hr\s*\/?>/gi, "\n\n---\n\n")
      .replace(/<\/?(?:p|div|blockquote)(?:\s[^>]*)?>/gi, "\n\n");
    html = stripHtmlTags(html);

    html = decodeEntities(html);

    // Normalize line whitespace
    const lines = html.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());
    let md = lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Restore <pre> code blocks
    for (let idx = 0; idx < preBlocks.length; idx++) {
      md = md.replace(`\x00PRE_${idx}\x00`, preBlocks[idx]!);
    }

    return md.replace(/\n{3,}/g, "\n\n").trim();
  }

  /**
   * Extracts the `Documentation(info="...")` HTML string from a Modelica class via its CST
   * `annotation_clause` nodes, falling back to string/comment-aware lexical scanning.
   */
  private extractModelicaDocumentationInfo(rawClassText: string, entry?: SymbolEntry): string | null {
    const rawNode = this.getEntryCstNode(entry);
    const classNode = findAncestorOrSelfByType(
      rawNode,
      ["class_definition", "short_class_definition"],
      ["element_list", "stored_definition", "program"],
    );
    if (classNode && !classNode.hasError) {
      const annNodes = collectClassAnnotationClauses(classNode);
      for (const annNode of annNodes) {
        const outerClassMod = annNode.namedChildren.find((c) => c.type === "class_modification") ?? null;
        const docMod = findElementModificationByName(outerClassMod, "documentation");
        if (!docMod) continue;
        const docClassMod = docMod.childForFieldName("modification")?.childForFieldName("class_modification") ?? null;
        const infoMod = findElementModificationByName(docClassMod, "info");
        if (!infoMod) continue;
        const modExpr = infoMod.childForFieldName("modification")?.childForFieldName("modification_expression");
        if (!modExpr) continue;
        const exprText = modExpr.text;
        const firstTokenIdx = skipModelicaTrivia(exprText, 0);
        if (exprText[firstTokenIdx] === '"') {
          return this.unescapeModelicaString(exprText.slice(firstTokenIdx));
        }
      }
      return null;
    }

    // Fallback when CST is unavailable (e.g. unit test mocks) or has syntax errors
    const len = rawClassText.length;
    let i = 0;
    while (i < len) {
      const ch = rawClassText[i]!;
      if (ch === '"') {
        i = skipModelicaString(rawClassText, i);
        continue;
      }
      if (ch === "/" && (rawClassText[i + 1] === "/" || rawClassText[i + 1] === "*")) {
        i = skipModelicaTrivia(rawClassText, i);
        continue;
      }
      if ((ch === "d" || ch === "D") && startsWithWordAt(rawClassText, i, "Documentation", true)) {
        let j = skipModelicaTrivia(rawClassText, i + "Documentation".length);
        if (rawClassText[j] === "(") {
          j++;
          let depth = 1;
          while (j < len && depth > 0) {
            const inner = rawClassText[j]!;
            if (inner === '"') {
              j = skipModelicaString(rawClassText, j);
              continue;
            }
            if (inner === "/" && (rawClassText[j + 1] === "/" || rawClassText[j + 1] === "*")) {
              j = skipModelicaTrivia(rawClassText, j);
              continue;
            }
            if (inner === "(") {
              depth++;
              j++;
              continue;
            }
            if (inner === ")") {
              depth--;
              j++;
              continue;
            }
            if (depth === 1 && (inner === "i" || inner === "I") && startsWithWordAt(rawClassText, j, "info", true)) {
              const afterInfo = skipModelicaTrivia(rawClassText, j + "info".length);
              if (rawClassText[afterInfo] === "=") {
                const strStart = skipModelicaTrivia(rawClassText, afterInfo + 1);
                if (rawClassText[strStart] === '"') {
                  const strEnd = skipModelicaConcatString(rawClassText, strStart);
                  return this.unescapeModelicaString(rawClassText.slice(strStart, strEnd));
                }
              }
            }
            j++;
          }
          i = j;
          continue;
        }
      }
      i++;
    }
    return null;
  }

  /**
   * Extracts the short description string (`"..."`) for a Modelica class or component.
   */
  private extractShortDescription(entry: SymbolEntry, rawSpan?: string | null): string | null {
    const metaDesc = entry.metadata?.["description"];
    if (typeof metaDesc === "string" && metaDesc.trim()) {
      const cleaned = this.unescapeModelicaString(metaDesc);
      if (cleaned) return cleaned;
    }

    const rawNode = this.getEntryCstNode(entry);
    if (entry.kind === "Class" || entry.kind === "Function" || entry.kind === "Package" || entry.kind === "Type") {
      const classNode = findAncestorOrSelfByType(
        rawNode,
        ["class_definition", "short_class_definition"],
        ["element_list", "stored_definition", "program"],
      );
      if (classNode && !classNode.hasError) {
        const specNode = findModelicaClassSpecNode(classNode);
        if (specNode?.type === "long_class_specifier") {
          const descStr = specNode.childForFieldName("description");
          return descStr ? this.unescapeModelicaString(descStr.text) : null;
        }
        if (specNode?.type === "short_class_specifier" || specNode?.type === "der_class_specifier") {
          const descContainer = specNode.childForFieldName("description");
          const descStr = descContainer?.namedChildren.find((c) => c.type === "description_string") ?? null;
          return descStr ? this.unescapeModelicaString(descStr.text) : null;
        }
      }
    } else if (entry.kind === "Component" || entry.kind === "Variable") {
      const compNode = findAncestorOrSelfByType(
        rawNode,
        ["component_declaration", "component_declaration1"],
        ["component_list", "component_clause", "element_list", "class_definition"],
      );
      if (compNode && !compNode.hasError) {
        const descContainer = compNode.childForFieldName("description");
        const descStr = descContainer?.namedChildren.find((c) => c.type === "description_string") ?? null;
        return descStr ? this.unescapeModelicaString(descStr.text) : null;
      }
    }

    const span = rawSpan !== undefined ? rawSpan : this.getEntrySourceSlice(entry, entry.startOffset, entry.endOffset);
    if (!span) return null;

    if (entry.kind === "Class" || entry.kind === "Function" || entry.kind === "Package" || entry.kind === "Type") {
      const headerSlice = span.slice(0, 600);
      const nameIdx = findWordOutsideStringsComments(headerSlice, entry.name);
      if (nameIdx !== -1 && nameIdx < 200) {
        const afterName = skipModelicaTrivia(span, nameIdx + entry.name.length);
        if (span[afterName] === '"') {
          const strEnd = skipModelicaConcatString(span, afterName);
          return this.unescapeModelicaString(span.slice(afterName, strEnd));
        }
      }
      if (span.length < 2000 && matchTrailingEndClass(span, entry.name) === -1) {
        const strippedAnn = stripTrailingSemicolon(this.stripModelicaAnnotations(span));
        const trailStr = extractTrailingModelicaString(strippedAnn);
        if (trailStr) {
          return this.unescapeModelicaString(trailStr);
        }
      }
      return null;
    }

    if (entry.kind === "Component" || entry.kind === "Variable") {
      const strippedAnn = stripTrailingSemicolon(this.stripModelicaAnnotations(span));
      const trailStr = extractTrailingModelicaString(strippedAnn);
      if (trailStr) {
        return this.unescapeModelicaString(trailStr);
      }
    }

    return null;
  }

  /**
   * Extracts leading `/** ... * /`, `/* ... * /`, or contiguous `//` doc comments immediately
   * preceding `entry` in its source file, as well as SysML v2 `doc /* ... * /` comments inside `rawSpan`.
   */
  private extractDocComments(entry: SymbolEntry, rawSpan?: string | null): string | null {
    const comments: string[] = [];

    // 1. Leading comments immediately preceding the declaration (or its component_clause)
    const fullText = this.getEntryFullSourceText(entry);
    if (fullText) {
      let declStart = entry.startOffset ?? 0;
      if (entry.kind === "Component" || entry.kind === "Variable") {
        const clausePrefix = this.extractComponentClausePrefix(entry);
        if (clausePrefix && clausePrefix.clauseStartOffset < declStart) {
          declStart = clausePrefix.clauseStartOffset;
        }
      }
      // Move back to the start of the line if only horizontal whitespace precedes `declStart`
      let lineStart = declStart;
      while (lineStart > 0 && (fullText[lineStart - 1] === " " || fullText[lineStart - 1] === "\t")) {
        lineStart--;
      }

      const beforeDecl = fullText.slice(Math.max(0, lineStart - 4000), lineStart);
      const leadingDoc = extractLeadingCommentDoc(beforeDecl);
      if (leadingDoc) {
        comments.push(leadingDoc);
      }
    }

    // 2. SysML v2 `doc /* ... */` inside the element body (CST first, lexical scan fallback)
    const entryNode = this.getEntryCstNode(entry);
    const cstDoc = extractSysmlDocBlockFromCst(entryNode);
    if (cstDoc) {
      if (!comments.includes(cstDoc)) {
        comments.push(cstDoc);
      }
    } else if (rawSpan) {
      const cleanedDoc = extractSysmlDocBlockContent(rawSpan);
      if (cleanedDoc && !comments.includes(cleanedDoc)) {
        comments.push(cleanedDoc);
      }
    }

    return comments.length > 0 ? comments.join("\n\n") : null;
  }

  /**
   * Determines the enclosing package/class qualified name for `entry` (from `parentId` or `within ...;`).
   */
  private getEnclosingScopeName(entry: SymbolEntry): string | null {
    if (entry.parentId !== null) {
      const parent = this.index.symbols.get(entry.parentId);
      if (parent && parent.name && parent.name !== "<anonymous>" && parent.ruleName !== "SourceFile") {
        const sep = entry.language === "sysml" || entry.resourceId?.endsWith(".sysml") ? "::" : ".";
        return this.getQualifiedName(parent, sep);
      }
    }
    const fullText = this.getEntryFullSourceText(entry);
    const withinName = extractWithinPackageFromSource(fullText, this.getRootCstNode(entry.resourceId));
    if (withinName) {
      return withinName;
    }
    return null;
  }

  /**
   * Renders Markdown hover text for a resolved `SymbolEntry`, including its full declaration
   * signature, description string, leading/inline doc comments, and Modelica `Documentation(info=...)`.
   */
  private hoverEntry(entry: SymbolEntry): string {
    if (this.activeHoverIds.has(entry.id)) {
      return `\`\`\`modelica\n${entry.kind.toLowerCase()} ${entry.name}\n\`\`\``;
    }
    this.activeHoverIds.add(entry.id);
    try {
      try {
        const hoverResult = this.engine.query<string>("hover", entry.id);
        if (hoverResult) return hoverResult;
      } catch {
        // No hover query defined — fall back to default
      }

      const lang = entry.language ?? (entry.resourceId?.endsWith(".sysml") ? "sysml" : "modelica");
      const declStr = this.formatDeclaration(entry);

      let md = `\`\`\`${lang}\n${declStr}\n\`\`\``;

      const entryStart = entry.startOffset ?? 0;
      const entryEnd = entry.endOffset ?? 0;
      const rawSpan = entryEnd > entryStart ? this.getEntrySourceSlice(entry, entryStart, entryEnd) : null;

      const docSections: string[] = [];

      // 1. Short description string (e.g. `"Sine voltage source"` or `"Amplitude of sine wave"`)
      const shortDesc = this.extractShortDescription(entry, rawSpan);
      if (shortDesc) {
        if (entry.kind === "Class" || entry.kind === "Function" || entry.kind === "Package" || entry.kind === "Type") {
          docSections.push(`**${shortDesc}**`);
        } else {
          docSections.push(shortDesc);
        }
      }

      // 2. Leading `/** ... */`, `/* ... */`, `//` doc comments, or SysML v2 `doc /* ... */`
      const docComments = this.extractDocComments(entry, rawSpan);
      if (docComments && docComments !== shortDesc) {
        docSections.push(docComments);
      }

      // 3. Modelica `annotation(Documentation(info="<html>...</html>"))`
      if (
        rawSpan &&
        (entry.kind === "Class" || entry.kind === "Function" || entry.kind === "Package" || entry.kind === "Type")
      ) {
        const docInfoHtml = this.extractModelicaDocumentationInfo(rawSpan, entry);
        if (docInfoHtml) {
          const docInfoMd = this.modelicaHtmlToMarkdown(docInfoHtml);
          if (docInfoMd && docInfoMd !== shortDesc) {
            docSections.push(docInfoMd);
          }
        }
      }

      // 4. For components/variables, include resolved type description & FQN when informative
      if (entry.kind === "Component" || entry.kind === "Variable") {
        const typeDecl = this.resolveTypeOf(entry);
        if (typeDecl && !typeDecl.metadata?.["isPredefined"]) {
          const sep = lang === "sysml" ? "::" : ".";
          const typeFqn = this.getQualifiedName(typeDecl, sep) || typeDecl.name;
          const typeDesc = this.extractShortDescription(typeDecl);
          if (typeDesc || typeFqn.includes(".") || typeFqn.includes("::")) {
            docSections.push(`*Type:* \`${typeFqn}\`${typeDesc ? ` — ${typeDesc}` : ""}`);
          }
        }
      }

      // 5. Enclosing package / class scope footer
      const enclosingScope = this.getEnclosingScopeName(entry);
      if (enclosingScope) {
        docSections.push(`*Defined in \`${enclosingScope}\`*`);
      }

      if (docSections.length > 0) {
        md += `\n\n---\n\n${docSections.join("\n\n")}`;
      }
      return md;
    } finally {
      this.activeHoverIds.delete(entry.id);
    }
  }

  /**
   * Resolves hover documentation when the cursor is over a modifier name inside a component modification `(...)`.
   */
  private hoverModificationContext(byteOffset: number, sourceText: string): LSPHover | null {
    const cstRoot = this.getRootCstNode();
    const span = extractWordSpanAtOffset(sourceText, byteOffset, cstRoot);
    if (!span) return null;
    const { word, start, end } = span;

    const before = sourceText.slice(0, start);
    let depth = 0;
    let parenPos = -1;
    for (let i = before.length - 1; i >= 0; i--) {
      const ch = before[i];
      if (ch === ")") depth++;
      if (ch === "(") {
        if (depth === 0) {
          parenPos = i;
          break;
        }
        depth--;
      }
    }
    if (parenPos < 0) return null;

    // Ensure the hovered identifier is on the left-hand side of a modification (not after `=`)
    const sinceOpenParen = before.slice(parenPos + 1);
    let innerDepth = 0;
    let lastCommaOrStart = 0;
    for (let i = 0; i < sinceOpenParen.length; i++) {
      const ch = sinceOpenParen[i];
      if (ch === "(" || ch === "[" || ch === "{") innerDepth++;
      else if (ch === ")" || ch === "]" || ch === "}") innerDepth = Math.max(0, innerDepth - 1);
      else if (innerDepth === 0 && ch === ",") lastCommaOrStart = i + 1;
    }
    const currentArgPrefix = sinceOpenParen.slice(lastCommaOrStart);
    if (currentArgPrefix.includes("=")) {
      return null;
    }

    const beforeParen = before.slice(0, parenPos).trimEnd();
    const typeName = extractModificationTargetType(beforeParen, true, cstRoot, parenPos);
    if (!typeName) return null;

    const scopeEntry = this.findScopeAtOffset(byteOffset);
    const scopeId = scopeEntry?.id ?? null;
    const typeDecls = this.resolveName(typeName, scopeId);
    if (typeDecls.length === 0) return null;

    const typeEntry = typeDecls[0]!;
    const hoverRange = this.positions.rangeFromOffsets(start, end);

    const children = this.getExportedChildren(typeEntry.id);
    for (const child of children) {
      if (child.name === word && this.isDecl(child)) {
        return { contents: this.hoverEntry(child), range: hoverRange };
      }
    }

    const inherited = this.getInheritedMembers(typeEntry.id);
    for (const member of inherited) {
      if (member.name === word) {
        return { contents: this.hoverEntry(member), range: hoverRange };
      }
    }

    if (typeEntry.metadata?.["completionMembers"] && Array.isArray(typeEntry.metadata["completionMembers"])) {
      if (typeEntry.metadata["completionMembers"].includes(word)) {
        const lang = typeEntry.language ?? "modelica";
        return {
          contents: `\`\`\`${lang}\n${word}\n\`\`\`\n---\nBuilt-in attribute of ${typeEntry.name}`,
          range: hoverRange,
        };
      }
    }

    return null;
  }

  // =========================================================================
  // textDocument/typeDefinition
  // =========================================================================

  /** Returns the raw symbol entry for the type of the element at the offset, preserving cross-document resourceIds */
  typeDefinitionRaw(byteOffset: number, sourceText?: string): SymbolEntry | null {
    const text = sourceText ?? this.positions.getSourceText();
    let word = "";
    if (text) {
      const span = extractWordSpanAtOffset(text, byteOffset, this.getRootCstNode());
      if (!span) {
        return null;
      }
      word = span.word;
    }

    const refEntry = this.findEntryAtOffset(byteOffset);
    if (!refEntry) return null;

    let targetDecl = refEntry;
    if (word && (refEntry.kind === "Class" || refEntry.ruleName === "SourceFile")) {
      const resolved = this.resolveName(word, refEntry.id);
      if (resolved.length > 0) {
        targetDecl = resolved[0]!;
      } else {
        return null;
      }
    } else {
      const resolved = this.resolveRef(refEntry);
      if (resolved.length > 0) {
        targetDecl = resolved[0]!;
      }
    }

    try {
      const typeResult = this.engine.query<SymbolEntry | null>("resolvedType", targetDecl.id);
      if (typeResult) return typeResult;
    } catch {
      // ignore
    }

    const children = this.getExportedChildren(targetDecl.id);
    const typeRef = children.find((c) => c.kind === "Reference");
    if (typeRef) {
      const typeResolved = this.resolveRef(typeRef);
      if (typeResolved.length > 0) return typeResolved[0]!;
    }
    return null;
  }

  // =========================================================================
  // textDocument/references & textDocument/rename (Workspace-wide access)
  // =========================================================================

  /** Collects cross-language counterpart symbol IDs bound to `symbolId` via `WasmQueryEngine` or `TggCorrespondenceIndexer`. */
  private collectCrossDomainCounterpartIds(symbolId: SymbolId): Set<SymbolId> {
    const peers = new Set<SymbolId>();
    const engCross = this.engine as unknown as { crossDomainBinding?(id: SymbolId): Set<SymbolId> } | undefined;
    if (typeof engCross?.crossDomainBinding === "function") {
      try {
        for (const bid of engCross.crossDomainBinding(symbolId)) {
          if (bid !== symbolId) peers.add(bid);
        }
      } catch {
        // ignore
      }
    }
    const corrIndexer = (
      this.index as {
        tggCorrespondenceIndexer?: {
          getSlotsForSymbol?: (id: SymbolId) => ReadonlySet<number>;
          hypergraph?: {
            getRecord?: (slot: number) => { isRemoved?: boolean; domainNodes?: Record<number, number> } | null;
          };
        };
      }
    ).tggCorrespondenceIndexer;
    if (corrIndexer && typeof corrIndexer.getSlotsForSymbol === "function") {
      for (const slot of corrIndexer.getSlotsForSymbol(symbolId)) {
        const rec = corrIndexer.hypergraph?.getRecord?.(slot);
        if (!rec || rec.isRemoved || !rec.domainNodes) continue;
        for (const memberId of Object.values(rec.domainNodes)) {
          if (typeof memberId === "number" && memberId !== symbolId) {
            peers.add(memberId);
          }
        }
      }
    }
    return peers;
  }

  /** Returns cross-language counterpart declarations aligned via TGG correspondence for the symbol at `byteOffset`. */
  counterpartDefinitionsRaw(byteOffset: number): SymbolEntry[] {
    const entry = this.findEntryAtOffset(byteOffset);
    if (!entry) return [];
    let targetDecl = entry;
    const resolved = this.resolveRef(entry);
    if (resolved.length > 0) {
      targetDecl = resolved[0]!;
    }
    const peerIds = this.collectCrossDomainCounterpartIds(targetDecl.id);
    if (entry.id !== targetDecl.id) {
      for (const pid of this.collectCrossDomainCounterpartIds(entry.id)) {
        peerIds.add(pid);
      }
    }
    const out: SymbolEntry[] = [];
    for (const pid of peerIds) {
      const sym = this.index.symbols.get(pid);
      if (sym && sym.resourceId && sym.resourceId !== this.documentUri) {
        out.push(sym);
      }
    }
    return out;
  }

  /** Returns raw symbol entries for references, preserving cross-document and cross-language resourceIds */
  findReferencesRaw(byteOffset: number): { declaration: SymbolEntry | null; references: SymbolEntry[] } {
    const entry = this.findEntryAtOffset(byteOffset);
    if (!entry) return { declaration: null, references: [] };

    let targetDecl = entry;

    // Is the user hovering over a usage/reference instead of the definition?
    // In SysML2, usage rule names end with "Usage" (e.g. "PartUsage"), but more generally
    // we can check if it resolves to something.
    const resolved = this.resolveRef(entry);
    if (resolved.length > 0) {
      targetDecl = resolved[0]!;
    }

    // Find all references mapping to the target declaration (workspace-wide) + cross-domain TGG peers
    const references = [...this.findRefs(targetDecl.id)];
    const seenRefIds = new Set<SymbolId>(references.map((r) => r.id));
    for (const peerId of this.collectCrossDomainCounterpartIds(targetDecl.id)) {
      const peerDecl = this.index.symbols.get(peerId);
      if (peerDecl && !seenRefIds.has(peerDecl.id)) {
        seenRefIds.add(peerDecl.id);
        references.push(peerDecl);
      }
      for (const peerRef of this.findRefs(peerId)) {
        if (!seenRefIds.has(peerRef.id)) {
          seenRefIds.add(peerRef.id);
          references.push(peerRef);
        }
      }
    }
    return { declaration: targetDecl, references };
  }

  /**
   * Returns `LSPLocation[]` for all references within the bound document to the symbol at `byteOffset`.
   */
  references(byteOffset: number): LSPLocation[] {
    const { references } = this.findReferencesRaw(byteOffset);

    // Note: The legacy references() method only maps entries belonging to THIS document
    // because this `positions` index is only valid for the current document.
    return references
      .filter((ref) => ref.resourceId === this.documentUri)
      .map((ref) => ({
        uri: this.documentUri,
        range: this.positions.rangeFromOffsets(ref.startOffset, ref.endOffset),
      }));
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Get the SymbolId list for the current document.
   * Uses the symbolsByResource index when available (O(1) lookup),
   * falling back to a full scan for older indices that lack it.
   */
  private getDocumentSymbolIds(): Iterable<SymbolId> {
    const normalize = (u: string) => {
      try {
        return decodeURIComponent(u).replace(/^[a-z0-9+-]+:\/\/?/, "/");
      } catch {
        return u;
      }
    };
    const targetNorm = normalize(this.documentUri);

    if (this.index.symbolsByResource) {
      let ids = this.index.symbolsByResource.get(this.documentUri);
      if (ids && ids.length > 0) return ids;
      for (const [k, v] of this.index.symbolsByResource.entries()) {
        const kNorm = normalize(k);
        if (
          k === this.documentUri ||
          kNorm === targetNorm ||
          kNorm.endsWith(targetNorm) ||
          targetNorm.endsWith(kNorm)
        ) {
          return v;
        }
      }
    }
    // Fallback: filter from all symbols (legacy path)
    const ids: SymbolId[] = [];
    for (const entry of this.index.symbols.values()) {
      const resNorm = entry.resourceId ? normalize(entry.resourceId) : "";
      if (
        entry.resourceId === this.documentUri ||
        resNorm === targetNorm ||
        (resNorm && (resNorm.endsWith(targetNorm) || targetNorm.endsWith(resNorm)))
      ) {
        ids.push(entry.id);
      }
    }
    return ids;
  }

  /** Find the narrowest symbol entry containing a byte offset. */
  private findEntryAtOffset(offset: number): SymbolEntry | null {
    let best: SymbolEntry | null = null;
    let bestSize = Infinity;

    for (const id of this.getDocumentSymbolIds()) {
      const entry = this.index.symbols.get(id);
      if (!entry) continue;
      const start = entry.startOffset;
      const end = entry.endOffset;
      if (start <= offset && offset < end) {
        const size = end - start;
        if (size < bestSize) {
          best = entry;
          bestSize = size;
        }
      }
    }

    return best;
  }

  /**
   * Find the innermost scope-creating symbol that contains the byte offset.
   * A scope-creating symbol is one that has children (i.e., a class/function def),
   * as opposed to leaf references or component declarations without children.
   */
  private findScopeAtOffset(offset: number): SymbolEntry | null {
    let best: SymbolEntry | null = null;
    let bestSize = Infinity;

    for (const id of this.getDocumentSymbolIds()) {
      const entry = this.index.symbols.get(id);
      if (!entry) continue;
      const start = entry.startOffset;
      const end = entry.endOffset;
      if (start <= offset && offset <= end) {
        const size = end - start;
        if (size < bestSize) {
          // Check if this entry is a scope-creator (has children in the index)
          const childIds = this.index.childrenOf.get(entry.id);
          if (childIds && childIds.length > 0) {
            best = entry;
            bestSize = size;
          }
        }
      }
    }

    return best;
  }

  /** Map a user-defined symbol kind string to an LSP SymbolKind number. */
  private mapSymbolKind(kind: string): LSPSymbolKind {
    const mapping: Record<string, LSPSymbolKind> = {
      Class: LSPSymbolKind.Class,
      Function: LSPSymbolKind.Function,
      Variable: LSPSymbolKind.Variable,
      Package: LSPSymbolKind.Package,
      Module: LSPSymbolKind.Module,
      Interface: LSPSymbolKind.Interface,
      Enum: LSPSymbolKind.Enum,
      Struct: LSPSymbolKind.Struct,
      Property: LSPSymbolKind.Property,
      Field: LSPSymbolKind.Field,
      Constant: LSPSymbolKind.Constant,
      Method: LSPSymbolKind.Method,
      Constructor: LSPSymbolKind.Constructor,
      Namespace: LSPSymbolKind.Namespace,
      Type: LSPSymbolKind.Interface,
    };
    return mapping[kind] ?? LSPSymbolKind.Variable;
  }

  /**
   * Update all internal references after an incremental update.
   */
  updateState(index: SymbolIndex, positions: PositionIndex): void {
    this.index = index;
    this.positions = positions;
  }
}
