// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode } from "@modelscript/dsl";
import {
  isIdentChar,
  isIdentStartChar,
  isWsChar,
  readIdentAt,
  readQualifiedNameAt,
  skipModelicaString,
  skipModelicaTrivia,
  skipWs,
  startsWithWordAt,
  stripCommentBlockBody,
  stripWs,
  trimEndHorizontalWs,
} from "./lexical-helpers.js";

export type SyntaxNodeWithOffsets = SyntaxNode & { startOffset?: number; endOffset?: number };

export function getNodeStartOffset(node: SyntaxNode): number {
  return (node as SyntaxNodeWithOffsets).startOffset ?? node.startIndex;
}

export function getNodeEndOffset(node: SyntaxNode): number {
  return (node as SyntaxNodeWithOffsets).endOffset ?? node.endIndex;
}

export function findAncestorOrSelfByType(
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

export function findModelicaClassSpecNode(classNode: SyntaxNode): SyntaxNode | null {
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

export function collectAnnotationClauseSpans(
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

export function stripAnnotationClausesFromCst(node: SyntaxNode, fallbackStripper: (s: string) => string): string {
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

/**
 * Strips Modelica `annotation(...)` clauses from a declaration or statement string using
 * CST `annotation_clause` spans when available, falling back to string/comment-aware scanning.
 */
export function stripModelicaAnnotations(input: string, cstNode?: SyntaxNode): string {
  if (cstNode && !cstNode.hasError && (cstNode.text ?? "") === input) {
    return stripAnnotationClausesFromCst(cstNode, (text) => stripModelicaAnnotations(text));
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

export function collectClassAnnotationClauses(classNode: SyntaxNode): SyntaxNode[] {
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

export function findElementModificationByName(classModNode: SyntaxNode | null, targetLower: string): SyntaxNode | null {
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

export function extractWordSpanAtOffset(
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

export function isQualifiedIdentChainSlice(text: string, start: number, end: number): boolean {
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

export function extractQualifiedPrefixAtOffset(
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

export function extractDotAccessVarBefore(before: string, cstRoot?: SyntaxNode | null): string | null {
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

export function extractModificationTargetType(
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

export function extractSysmlDocBlockFromCst(node: SyntaxNode | null): string | null {
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

export function extractWithinPackageFromSource(fullText: string | null, cstRoot?: SyntaxNode | null): string | null {
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
  const i = skipModelicaTrivia(prefix, 0);
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
