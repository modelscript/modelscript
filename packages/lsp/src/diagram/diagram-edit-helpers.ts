// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode } from "@modelscript/dsl";
import { CstDocumentSession, CstTransaction, CstXmlAdapter } from "@modelscript/dsl/unparser";
import { getXmlWasmParser } from "@modelscript/dsl/xml";
import type { TextEdit } from "vscode-languageserver";
import type { PlacementItem } from "../diagramProtocol.js";

function isWsChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v";
}

function isWordTokenChar(ch: string): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

export function leadingWhitespaceOf(s: string): string {
  let i = 0;
  while (i < s.length && isWsChar(s[i]!)) i++;
  return s.slice(0, i);
}

export function findNextWordMatchIndex(text: string, word: string, fromIndex = 0): number {
  if (!word) return -1;
  const checkStart = isWordTokenChar(word[0]!);
  const checkEnd = isWordTokenChar(word[word.length - 1]!);
  let idx = text.indexOf(word, fromIndex);
  while (idx !== -1) {
    const beforeOk = !checkStart || idx === 0 || !isWordTokenChar(text[idx - 1]!);
    const afterPos = idx + word.length;
    const afterOk = !checkEnd || afterPos === text.length || !isWordTokenChar(text[afterPos]!);
    if (beforeOk && afterOk) return idx;
    idx = text.indexOf(word, idx + 1);
  }
  return -1;
}

export function findAllWordMatchIndices(text: string, word: string): number[] {
  const out: number[] = [];
  if (!word) return out;
  let pos = 0;
  while (pos <= text.length - word.length) {
    const idx = findNextWordMatchIndex(text, word, pos);
    if (idx === -1) break;
    out.push(idx);
    pos = idx + word.length;
  }
  return out;
}

export function hasWordMatch(text: string, word: string): boolean {
  return findNextWordMatchIndex(text, word, 0) !== -1;
}

export function expandEdgeTemplateText(
  edgeTemplate: unknown,
  source: string,
  target: string,
  sourcePort?: string,
  targetPort?: string,
): string {
  if (typeof edgeTemplate === "function") {
    const fn = edgeTemplate as (src: string, tgt: string, sp?: string, tp?: string) => unknown;
    const result = fn(source, target, sourcePort, targetPort);
    return typeof result === "string" ? result : "";
  }
  if (typeof edgeTemplate !== "string" || !edgeTemplate.trim()) {
    const src = sourcePort ? `${source}.${sourcePort}` : source;
    const tgt = targetPort ? `${target}.${targetPort}` : target;
    return `connect(${src}, ${tgt});`;
  }
  const sPort = sourcePort ?? "";
  const tPort = targetPort ?? "";
  let out = edgeTemplate;
  if (!sPort) {
    out = out.replaceAll(".${sourcePort}", "").replaceAll(".{{sourcePort}}", "").replaceAll(".{sourcePort}", "");
  }
  if (!tPort) {
    out = out.replaceAll(".${targetPort}", "").replaceAll(".{{targetPort}}", "").replaceAll(".{targetPort}", "");
  }
  return out
    .replaceAll("${source}", source)
    .replaceAll("{{source}}", source)
    .replaceAll("{source}", source)
    .replaceAll("${target}", target)
    .replaceAll("{{target}}", target)
    .replaceAll("{target}", target)
    .replaceAll("${sourcePort}", sPort)
    .replaceAll("{{sourcePort}}", sPort)
    .replaceAll("{sourcePort}", sPort)
    .replaceAll("${targetPort}", tPort)
    .replaceAll("{{targetPort}}", tPort)
    .replaceAll("{targetPort}", tPort);
}

function countEndpointMatches(text: string, node: string, port: string | undefined): number {
  if (!node) return 0;
  const indices = findAllWordMatchIndices(text, node);
  if (!port) return indices.length;
  let count = 0;
  for (const idx of indices) {
    let p = idx + node.length;
    while (p < text.length && (text[p] === " " || text[p] === "\t")) p++;
    if (text[p] === "." || text[p] === ":") {
      p++;
      while (p < text.length && (text[p] === " " || text[p] === "\t")) p++;
      if (text.startsWith(port, p)) {
        const after = p + port.length;
        if (after === text.length || !isWordTokenChar(text[after]!)) {
          count++;
        }
      }
    }
  }
  if (count === 0 && text.includes("<") && indices.length > 0 && hasWordMatch(text, port)) {
    return 1;
  }
  return count;
}

function statementMatchesEndpoints(
  text: string,
  src: string,
  srcPort: string | undefined,
  tgt: string,
  tgtPort: string | undefined,
): boolean {
  const srcCount = countEndpointMatches(text, src, srcPort);
  if (srcCount === 0) return false;
  if (src === tgt && (srcPort ?? "") === (tgtPort ?? "")) {
    return srcCount >= 2;
  }
  return countEndpointMatches(text, tgt, tgtPort) > 0;
}

function findStatementEndLine(maskedLines: string[], startLine: number): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inQuote: string | null = null;

  for (let j = startLine; j < maskedLines.length; j++) {
    const line = maskedLines[j]!;
    let sawTopLevelSemi = false;
    for (let k = 0; k < line.length; k++) {
      const ch = line[k]!;
      if (inQuote) {
        if (ch === "\\" && k + 1 < line.length) {
          k++;
        } else if (ch === inQuote) {
          inQuote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        continue;
      }
      if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
      else if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
      else if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      else if (ch === ";" && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        sawTopLevelSemi = true;
      }
    }

    if (sawTopLevelSemi) return j;
    if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      const nextLine = j + 1 < maskedLines.length ? maskedLines[j + 1]!.trimStart() : "";
      if (nextLine.startsWith("annotation") && nextLine.length > 10 && !isWordTokenChar(nextLine[10]!)) {
        continue;
      }
      return j;
    }
  }
  return maskedLines.length - 1;
}

const CST_CONNECTION_NODE_TYPES = new Set([
  "connect_clause",
  "connect_equation",
  "connection",
  "connection_usage",
  "connection_statement",
  "connection_clause",
  "edge_statement",
  "flow_statement",
  "link_statement",
]);

const CST_STATEMENT_WRAPPER_TYPES = new Set(["equation", "equation_statement", "statement", "element"]);

const CST_NON_CODE_SUBTREE_TYPES = new Set([
  "comment",
  "string_comment",
  "line_comment",
  "block_comment",
  "annotation",
  "annotation_clause",
  "string_literal",
  "STRING",
  "string",
]);

const CST_IDENT_LEAF_TYPES = new Set([
  "ident",
  "IDENT",
  "identifier",
  "IDENTIFIER",
  "ID",
  "id",
  "name",
  "simple_name",
  "symbol",
]);

export function offsetToLspPosition(docText: string, offset: number): { line: number; character: number } {
  let line = 0;
  let character = 0;
  const limit = Math.min(Math.max(0, offset), docText.length);
  for (let i = 0; i < limit; i++) {
    if (docText[i] === "\r") {
      line++;
      character = 0;
      if (i + 1 < limit && docText[i + 1] === "\n") i++;
    } else if (docText[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return { line, character };
}

function getSyntaxChildren(node: SyntaxNode): SyntaxNode[] {
  if (Array.isArray(node.children)) return node.children;
  if (Array.isArray(node.namedChildren)) return node.namedChildren;
  return [];
}

function getSyntaxNodeText(node: SyntaxNode, docText: string): string {
  if (typeof node.text === "string" && node.text.length > 0) return node.text;
  if (
    typeof node.startIndex === "number" &&
    typeof node.endIndex === "number" &&
    node.endIndex >= node.startIndex &&
    node.startIndex >= 0
  ) {
    return docText.slice(node.startIndex, node.endIndex);
  }
  return "";
}

export function findBestCstNodeForSpan(root: SyntaxNode, startOffset: number, endOffset: number): SyntaxNode | null {
  if (typeof root.descendantForIndex === "function") {
    try {
      const hit = root.descendantForIndex(startOffset, endOffset);
      if (hit && hit.startIndex <= startOffset && hit.endIndex >= endOffset) {
        return hit;
      }
    } catch {
      // Fallback to manual traversal below
    }
  }
  let best: SyntaxNode | null = root.startIndex <= startOffset && root.endIndex >= endOffset ? root : null;
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (curr.startIndex > startOffset || curr.endIndex < endOffset) continue;
    if (!best || curr.endIndex - curr.startIndex <= best.endIndex - best.startIndex) {
      best = curr;
    }
    const kids = getSyntaxChildren(curr);
    for (let i = kids.length - 1; i >= 0; i--) {
      const child = kids[i];
      if (child) stack.push(child);
    }
  }
  return best;
}

function isConnectionCstNode(node: SyntaxNode): boolean {
  const t = (node.type || "").toLowerCase();
  if (!t) return false;
  if (CST_CONNECTION_NODE_TYPES.has(t)) return true;
  if (
    getSyntaxChildren(node).length > 0 &&
    (t.endsWith("_connect_clause") || t.endsWith("_connection") || t.endsWith("connection_statement"))
  ) {
    return true;
  }
  return false;
}

function extractConnectionCodeText(node: SyntaxNode, docText: string): string {
  const kids = getSyntaxChildren(node);
  if (kids.length === 0) return getSyntaxNodeText(node, docText);
  const parts: string[] = [];
  for (const child of kids) {
    const cType = child.type || "";
    if (CST_NON_CODE_SUBTREE_TYPES.has(cType)) continue;
    parts.push(getSyntaxNodeText(child, docText));
  }
  return parts.join(" ");
}

export function findMatchingConnectionCstNode(
  root: SyntaxNode,
  docText: string,
  src: string,
  srcPort: string | undefined,
  tgt: string,
  tgtPort: string | undefined,
): SyntaxNode | null {
  const stack: Array<{ node: SyntaxNode; parent: SyntaxNode | null }> = [{ node: root, parent: null }];
  while (stack.length > 0) {
    const { node, parent } = stack.pop()!;
    if (!node || typeof node !== "object") continue;
    if (isConnectionCstNode(node)) {
      const codeText = extractConnectionCodeText(node, docText);
      if (statementMatchesEndpoints(codeText, src, srcPort, tgt, tgtPort)) {
        if (parent && CST_STATEMENT_WRAPPER_TYPES.has((parent.type || "").toLowerCase())) {
          const siblingConns = getSyntaxChildren(parent).filter((c) => isConnectionCstNode(c));
          if (siblingConns.length === 1) {
            return parent;
          }
        }
        return node;
      }
      continue;
    }
    const kids = getSyntaxChildren(node);
    for (let i = kids.length - 1; i >= 0; i--) {
      const child = kids[i];
      if (child) stack.push({ node: child, parent: node });
    }
  }
  return null;
}

export function collectIdentifierNodesInCstScope(
  scopeNode: SyntaxNode,
  docText: string,
  targetName: string,
): SyntaxNode[] {
  const results: SyntaxNode[] = [];
  const seen = new Set<string>();
  const stack: SyntaxNode[] = [scopeNode];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (!curr || typeof curr !== "object") continue;
    const t = curr.type || "";
    if (CST_NON_CODE_SUBTREE_TYPES.has(t)) continue;

    const kids = getSyntaxChildren(curr);
    if (kids.length === 0) {
      if (typeof curr.startIndex === "number" && typeof curr.endIndex === "number" && curr.endIndex > curr.startIndex) {
        const text = getSyntaxNodeText(curr, docText);
        const isIdentType = CST_IDENT_LEAF_TYPES.has(t) || Boolean((curr as { isNamed?: boolean }).isNamed);
        if (text === targetName && isIdentType) {
          const isQualifiedMember =
            !targetName.includes(".") && curr.startIndex > 0 && docText[curr.startIndex - 1] === ".";
          if (!isQualifiedMember) {
            const key = `${curr.startIndex}:${curr.endIndex}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push(curr);
            }
          }
        }
      }
      continue;
    }

    for (let i = kids.length - 1; i >= 0; i--) {
      const child = kids[i];
      if (child) stack.push(child);
    }
  }
  return results;
}

export function findMatchingEdgeStatement(
  maskedLines: string[],
  src: string,
  srcPort: string | undefined,
  tgt: string,
  tgtPort: string | undefined,
): { startLine: number; endLine: number } | null {
  for (let i = 0; i < maskedLines.length; i++) {
    const line = maskedLines[i]!;
    if (!line.trim()) continue;
    if (statementMatchesEndpoints(line, src, srcPort, tgt, tgtPort)) {
      const endLine = findStatementEndLine(maskedLines, i);
      return { startLine: i, endLine };
    }
    const trimmed = line.trimStart();
    if ((trimmed.startsWith("connect") || hasWordMatch(line, src)) && (line.includes("(") || line.includes("{"))) {
      const endLine = findStatementEndLine(maskedLines, i);
      if (endLine > i) {
        const joined = maskedLines.slice(i, endLine + 1).join("\n");
        if (statementMatchesEndpoints(joined, src, srcPort, tgt, tgtPort)) {
          return { startLine: i, endLine };
        }
      }
    }
  }
  return null;
}

export function extractTrailingAnnotationClause(stmtText: string): string | null {
  const matches = findAllWordMatchIndices(stmtText, "annotation");
  for (let m = matches.length - 1; m >= 0; m--) {
    const startIdx = matches[m]!;
    let p = startIdx + "annotation".length;
    while (p < stmtText.length && isWsChar(stmtText[p]!)) p++;
    if (stmtText[p] !== "(") continue;
    let depth = 0;
    let inQuote: string | null = null;
    for (let k = p; k < stmtText.length; k++) {
      const ch = stmtText[k]!;
      if (inQuote) {
        if (ch === "\\" && k + 1 < stmtText.length) k++;
        else if (ch === inQuote) inQuote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          let endIdx = k + 1;
          while (endIdx < stmtText.length && isWsChar(stmtText[endIdx]!)) endIdx++;
          return stmtText.slice(startIdx, stmtText[endIdx] === ";" ? endIdx + 1 : k + 1);
        }
      }
    }
  }
  return null;
}

export function findParamAssignmentValueSpan(
  maskedLine: string,
  paramName: string,
): { startCol: number; endCol: number } | null {
  if (!paramName) return null;
  let searchFrom = 0;
  while (searchFrom < maskedLine.length) {
    const idx = findNextWordMatchIndex(maskedLine, paramName, searchFrom);
    if (idx === -1) return null;
    // Do not match qualified sub-segments like `foo.R` when looking for `R` unless `paramName` contains `.`
    if (!paramName.includes(".") && idx > 0 && maskedLine[idx - 1] === ".") {
      searchFrom = idx + paramName.length;
      continue;
    }
    let p = idx + paramName.length;
    while (p < maskedLine.length && (maskedLine[p] === " " || maskedLine[p] === "\t")) p++;
    const sep = maskedLine[p];
    if (sep !== "=" && sep !== ":") {
      searchFrom = idx + paramName.length;
      continue;
    }
    if (sep === "=" && maskedLine[p + 1] === "=") {
      searchFrom = idx + paramName.length;
      continue;
    }
    p++;
    if (sep === ":" && maskedLine[p] === "=") p++;
    while (p < maskedLine.length && (maskedLine[p] === " " || maskedLine[p] === "\t")) p++;
    const startCol = p;
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let inQuote: string | null = null;
    let endCol = maskedLine.length;
    for (let k = startCol; k < maskedLine.length; k++) {
      const ch = maskedLine[k]!;
      if (inQuote) {
        if (ch === "\\" && k + 1 < maskedLine.length) k++;
        else if (ch === inQuote) inQuote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        continue;
      }
      if (ch === "(") parenDepth++;
      else if (ch === ")") {
        if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
          endCol = k;
          break;
        }
        parenDepth--;
      } else if (ch === "{") braceDepth++;
      else if (ch === "}") {
        if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
          endCol = k;
          break;
        }
        braceDepth--;
      } else if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      else if ((ch === "," || ch === ";") && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        endCol = k;
        break;
      }
    }
    while (endCol > startCol && (maskedLine[endCol - 1] === " " || maskedLine[endCol - 1] === "\t")) {
      endCol--;
    }
    if (endCol > startCol) {
      return { startCol, endCol };
    }
    searchFrom = idx + paramName.length;
  }
  return null;
}

function isKeyStartChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function isKeyBodyChar(ch: string): boolean {
  return isWordTokenChar(ch) || ch === "." || ch === "-";
}

function isKvStopChar(ch: string): boolean {
  return ch === '"' || ch === "'" || ch === "," || ch === ";" || ch === ")" || ch === "}" || ch === ">" || isWsChar(ch);
}

export function extractKeyValuePairsFromLine(line: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    const prevOk = i === 0 || !isWordTokenChar(line[i - 1]!);
    if (!prevOk || !isKeyStartChar(ch)) {
      i++;
      continue;
    }
    const keyStart = i;
    i++;
    while (i < line.length && isKeyBodyChar(line[i]!)) i++;
    const key = line.slice(keyStart, i);
    let p = i;
    while (p < line.length && isWsChar(line[p]!)) p++;
    if (p >= line.length || (line[p] !== "=" && line[p] !== ":")) {
      continue;
    }
    p++;
    while (p < line.length && isWsChar(line[p]!)) p++;
    if (p < line.length && (line[p] === '"' || line[p] === "'")) p++;
    const valStart = p;
    while (p < line.length && !isKvStopChar(line[p]!)) p++;
    if (p > valStart) {
      out.push({ key, value: line.slice(valStart, p) });
      i = p;
    }
  }
  return out;
}

function findSectionClosingLine(lines: string[], sectionName: string): number | null {
  let inSection = false;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inSection) {
      const idx = findNextWordMatchIndex(line, sectionName);
      if (idx !== -1) {
        inSection = true;
        for (const ch of line.substring(idx)) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
        }
      }
    } else {
      for (const ch of line) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth <= 0) {
            return i;
          }
        }
      }
    }
  }
  return null;
}

function isXmlPrefixChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 45;
}

function matchesClosingTagAt(line: string, pos: number, targetLower: string): boolean {
  const end = pos + targetLower.length;
  if (end > line.length || line.slice(pos, end).toLowerCase() !== targetLower) {
    return false;
  }
  let q = end;
  while (q < line.length && isWsChar(line[q]!)) q++;
  return q < line.length && line[q] === ">";
}

function findXmlClosingTagIndex(line: string, targetSection: string): number {
  const targetLower = targetSection.toLowerCase();
  let searchFrom = 0;
  while (searchFrom < line.length) {
    const start = line.indexOf("</", searchFrom);
    if (start === -1) return -1;
    const afterSlash = start + 2;
    if (matchesClosingTagAt(line, afterSlash, targetLower)) {
      return start;
    }
    let prefixEnd = afterSlash;
    while (prefixEnd < line.length && isXmlPrefixChar(line[prefixEnd]!)) {
      prefixEnd++;
    }
    if (
      prefixEnd > afterSlash &&
      prefixEnd < line.length &&
      line[prefixEnd] === ":" &&
      matchesClosingTagAt(line, prefixEnd + 1, targetLower)
    ) {
      return start;
    }
    searchFrom = afterSlash;
  }
  return -1;
}

export function insertIntoSectionOrRoot(
  lines: string[],
  allEdits: TextEdit[],
  content: string,
  targetSection?: string,
  docText?: string,
): void {
  if (targetSection) {
    // CST-first path for XML documents (handles normal tags, self-closing `<robot/>` expansion,
    // and error-recovered unclosed containers across all ~20 XML languages in GenericDSLDiagramBackend)
    const rawXml = docText ?? lines.join("\n");
    if (rawXml.trimStart().startsWith("<")) {
      let xmlParser: unknown = null;
      try {
        xmlParser = getXmlWasmParser();
      } catch {
        xmlParser = null;
      }
      const session = new CstDocumentSession({
        uri: "file:///generic-xml-section.xml",
        text: rawXml,
        parser: xmlParser as never,
        xmlFallback: true,
      });
      try {
        const root = session.rootNode;
        const wantLower = targetSection.toLowerCase();
        const containerEl = root
          ? (CstXmlAdapter.findElements(root, rawXml, (_n, tag) => {
              const lower = tag.toLowerCase();
              return lower === wantLower || lower.endsWith(`:${wantLower}`);
            })[0] ?? null)
          : null;
        if (containerEl) {
          const tx = new CstTransaction(session);
          if (CstXmlAdapter.appendChild(tx, containerEl, content.trim())) {
            const cstEdits = tx.commit().edits;
            if (cstEdits.length > 0) {
              allEdits.push(...cstEdits);
              return;
            }
          }
        }
      } finally {
        session.dispose();
      }
    }

    for (let i = lines.length - 1; i >= 0; i--) {
      const idx = findXmlClosingTagIndex(lines[i]!, targetSection);
      if (idx !== -1) {
        allEdits.push({
          range: {
            start: { line: i, character: idx },
            end: { line: i, character: idx },
          },
          newText: "\n  " + content.trim() + "\n",
        });
        return;
      }
    }
    const secLine = findSectionClosingLine(lines, targetSection);
    if (secLine !== null) {
      allEdits.push({
        range: {
          start: { line: secLine, character: 0 },
          end: { line: secLine, character: 0 },
        },
        newText: "    " + content.trim() + "\n",
      });
      return;
    } else {
      let insertLine = lines.length;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i]!.trim() === "}") {
          insertLine = i;
          break;
        }
      }
      allEdits.push({
        range: {
          start: { line: insertLine, character: 0 },
          end: { line: insertLine, character: 0 },
        },
        newText: `  ${targetSection} {\n    ${content.trim()}\n  }\n`,
      });
      return;
    }
  }

  let insertLine = lines.length;
  let indentPrefix = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trim();
    if (trimmed === "}") {
      insertLine = i;
      indentPrefix = "  ";
      break;
    }
  }
  if (insertLine === lines.length) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i]!.trim();
      if (!trimmed) continue;
      if (/^END$/i.test(trimmed)) {
        insertLine = i;
      }
      break;
    }
  }
  allEdits.push({
    range: {
      start: { line: insertLine, character: 0 },
      end: { line: insertLine, character: 0 },
    },
    newText: indentPrefix + content.trim() + "\n",
  });
}

/**
 * Replaces comment content (// line comments and /* block comments * /) with whitespace,
 * preserving exact string lengths, line numbers, and character column indices.
 */
export function maskComments(text: string): string {
  let inBlockComment = false;
  let inLineComment = false;
  let inString: string | null = null;
  const chars = text.split("");

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = i + 1 < chars.length ? chars[i + 1] : "";

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
      } else if (ch !== "\r") {
        chars[i] = " ";
      }
    } else if (inBlockComment) {
      if (ch === "*" && next === "/") {
        chars[i] = " ";
        chars[i + 1] = " ";
        i++;
        inBlockComment = false;
      } else if (ch !== "\n" && ch !== "\r") {
        chars[i] = " ";
      }
    } else if (inString) {
      if (ch === "\\") {
        // Escape next character inside string
        i++;
      } else if (ch === inString) {
        inString = null;
      }
    } else {
      if (ch === '"' || ch === "'") {
        inString = ch;
      } else if (ch === "/" && next === "/") {
        inLineComment = true;
        chars[i] = " ";
        chars[i + 1] = " ";
        i++;
      } else if (ch === "/" && next === "*") {
        inBlockComment = true;
        chars[i] = " ";
        chars[i + 1] = " ";
        i++;
      }
    }
  }

  return chars.join("");
}

function findBalancedCloseSimple(text: string, openIndex: number): number {
  const openCh = text[openIndex];
  const closeCh = openCh === "(" ? ")" : openCh === "{" ? "}" : openCh === "[" ? "]" : "";
  if (!closeCh) return -1;
  let depth = 0;
  let inQuote: string | null = null;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuote) {
      if (ch === "\\" && i + 1 < text.length) {
        i++;
        continue;
      }
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isWordCharCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 // _
  );
}

function skipWs(text: string, idx: number): number {
  let i = idx;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch !== " " && ch !== "\t" && ch !== "\r" && ch !== "\n") break;
    i++;
  }
  return i;
}

function isWordBoundaryAt(text: string, index: number, len: number): boolean {
  if (len === 0) return false;
  const startsWord = isWordCharCode(text.charCodeAt(index));
  const endsWord = isWordCharCode(text.charCodeAt(index + len - 1));
  if (startsWord && index > 0 && isWordCharCode(text.charCodeAt(index - 1))) return false;
  if (endsWord && index + len < text.length && isWordCharCode(text.charCodeAt(index + len))) return false;
  return true;
}

function scanOutsideStrings(text: string, visitor: (index: number) => boolean): void {
  let inQuote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuote) {
      if (ch === "\\" && i + 1 < text.length) {
        i++;
        continue;
      }
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (visitor(i) === true) return;
  }
}

function hasWordTokenOutsideStrings(text: string, token: string): boolean {
  if (!token) return false;
  let found = false;
  scanOutsideStrings(text, (i) => {
    if (text.startsWith(token, i) && isWordBoundaryAt(text, i, token.length)) {
      found = true;
      return true;
    }
    return false;
  });
  return found;
}

const NON_DECLARATION_LINE_PREFIX = /^(?:import|connect|extends|equation|algorithm|end|return|\/\/|\/\*|\*|#|--)\b/i;

function isLikelyNonDeclarationReference(maskedLine: string): boolean {
  const trimmed = maskedLine.trimStart();
  if (!trimmed) return true;
  if (NON_DECLARATION_LINE_PREFIX.test(trimmed)) return true;
  return false;
}

function findInlinePlacementSpan(line: string): { start: number; end: number } | null {
  let layoutSpan: { start: number; end: number } | null = null;
  scanOutsideStrings(line, (i) => {
    if (!line.startsWith("@layout", i)) return false;
    const parenIdx = skipWs(line, i + 7);
    if (line[parenIdx] !== "(") return false;
    const closeIdx = findBalancedCloseSimple(line, parenIdx);
    if (closeIdx !== -1) {
      layoutSpan = { start: i, end: closeIdx + 1 };
      return true;
    }
    return false;
  });
  if (layoutSpan) return layoutSpan;

  let annotSpan: { start: number; end: number } | null = null;
  scanOutsideStrings(line, (i) => {
    if (!line.startsWith("annotation", i) || !isWordBoundaryAt(line, i, 10)) return false;
    const outerParen = skipWs(line, i + 10);
    if (line[outerParen] !== "(") return false;
    const placementStart = skipWs(line, outerParen + 1);
    if (!line.startsWith("Placement", placementStart) || !isWordBoundaryAt(line, placementStart, 9)) return false;
    const innerParen = skipWs(line, placementStart + 9);
    if (line[innerParen] !== "(") return false;
    const closeIdx = findBalancedCloseSimple(line, outerParen);
    if (closeIdx !== -1) {
      annotSpan = { start: i, end: closeIdx + 1 };
      return true;
    }
    return false;
  });
  return annotSpan;
}

export function emitInlinePlacementEdit(
  item: PlacementItem,
  lines: string[],
  maskedLines: string[],
  formatPlacement: ((x: number, y: number, width?: number, height?: number, rotation?: number) => string) | undefined,
  allEdits: TextEdit[],
  appendAtEolIfNoSemi: boolean,
): void {
  let targetLineIdx = -1;
  let fallbackLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const masked = maskedLines[i]!;
    if (!hasWordTokenOutsideStrings(masked, item.name)) continue;
    if (fallbackLineIdx === -1) fallbackLineIdx = i;
    if (isLikelyNonDeclarationReference(masked)) continue;
    targetLineIdx = i;
    break;
  }
  const i = targetLineIdx !== -1 ? targetLineIdx : fallbackLineIdx;
  if (i === -1) return;

  const line = lines[i]!;
  const placementStr = formatPlacement
    ? formatPlacement(item.x, item.y, item.width, item.height, item.rotation)
    : `@layout(x=${Math.round(item.x)}, y=${Math.round(item.y)})`;

  const span = findInlinePlacementSpan(line);
  if (span) {
    allEdits.push({
      range: {
        start: { line: i, character: span.start },
        end: { line: i, character: span.end },
      },
      newText: placementStr,
    });
  } else {
    const semiIdx = line.lastIndexOf(";");
    if (semiIdx !== -1) {
      allEdits.push({
        range: {
          start: { line: i, character: semiIdx },
          end: { line: i, character: semiIdx },
        },
        newText: ` ${placementStr}`,
      });
    } else if (appendAtEolIfNoSemi) {
      allEdits.push({
        range: {
          start: { line: i, character: line.length },
          end: { line: i, character: line.length },
        },
        newText: ` ${placementStr}`,
      });
    }
  }
}

export function replaceBalancedBracesField(text: string, fieldName: string, newInner: string): string {
  if (!fieldName) return text;
  let openBraceIdx = -1;
  scanOutsideStrings(text, (i) => {
    if (!text.startsWith(fieldName, i) || !isWordBoundaryAt(text, i, fieldName.length)) return false;
    const eqIdx = skipWs(text, i + fieldName.length);
    if (text[eqIdx] !== "=") return false;
    const braceIdx = skipWs(text, eqIdx + 1);
    if (text[braceIdx] !== "{") return false;
    openBraceIdx = braceIdx;
    return true;
  });
  if (openBraceIdx === -1) return text;
  const closeBraceIdx = findBalancedCloseSimple(text, openBraceIdx);
  if (closeBraceIdx === -1) return text;
  return `${text.slice(0, openBraceIdx + 1)}${newInner}${text.slice(closeBraceIdx)}`;
}
