// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createOpenDriveDiagramBackend,
  createPscadDiagramBackend,
  createPsseDiagramBackend,
  createSimulinkDiagramBackend,
  createSpiceDiagramBackend,
  createSspDiagramBackend,
} from "./diagrams/index.js";
//
// Unified Diagram API dispatch layer.
// Routes diagram requests to language-specific backends (Modelica / SysML2)
// based on the document URI. This replaces the per-method if-branching that
// was previously scattered across 12 handlers in browserServerMain.ts.

import { buildDiagramFromDSL, buildPolyglotDiagram } from "@modelscript/diagram/builder";
import type { FileSystemBridge } from "@modelscript/diagram/fs-bridge";
import { parseLayout, SidecarLayoutStorage } from "@modelscript/diagram/layout-storage";
import { compileDiagramConfigToPolyglot, CstUnparser, type SyntaxNode } from "@modelscript/dsl";
import { buildFortranDiagramFromCst, maskFortranFixedCommentsAndPreprocessor } from "@modelscript/fortran";
import { buildScadDiagramFromCst } from "@modelscript/scad";
import type { TextEdit } from "vscode-languageserver";
import {
  computeModelicaComponentDropEdits,
  resolveCrossLanguageComponentDrop,
  resolveGenericComponentDrop,
} from "./cross-language-drop.js";
import type {
  ComponentPropertyData,
  DiagramApplyEditsParams,
  DiagramApplyEditsResult,
  DiagramData,
  DiagramDrillDownParams,
  DiagramDrillDownResult,
  DiagramGetComponentPropertiesParams,
  DiagramGetDataParams,
  DiagramGetPaletteParams,
  DiagramPalette,
  PlacementItem,
  PropertyFieldConfig,
} from "./diagramProtocol.js";
import { globalLanguageRegistry } from "./registry/LanguageRegistry.js";
import type { CstParserLike } from "./utils/ast-utils.js";

import { computeMinimalTextEdit, deduplicateAndSort, type DiagramBackend } from "./diagramProtocol.js";
export { computeMinimalTextEdit, deduplicateAndSort, type DiagramBackend };

import {
  ModelicaDiagramBackend as ModelicaDiagramBackendCore,
  processDiagramEditBatch as processDiagramEditBatchCore,
  type ModelicaBackendDeps,
} from "@modelscript/modelica/diagram";

export type { ModelicaBackendDeps };

const lspModelicaCrossLanguageDrop = {
  resolveCrossLanguageComponentDrop,
  computeModelicaComponentDropEdits,
};

export class ModelicaDiagramBackend extends ModelicaDiagramBackendCore {
  constructor(deps: ModelicaBackendDeps) {
    super(deps.crossLanguageDrop ? deps : { ...deps, crossLanguageDrop: lspModelicaCrossLanguageDrop });
  }
}

export function processDiagramEditBatch(
  request: DiagramApplyEditsParams,
  classInstance: any,
  docText: string,
  unifiedIndex?: any,
  dropIconOptions?: Parameters<typeof processDiagramEditBatchCore>[4],
): DiagramApplyEditsResult {
  const opts = dropIconOptions?.crossLanguageDrop
    ? dropIconOptions
    : { ...dropIconOptions, crossLanguageDrop: lspModelicaCrossLanguageDrop };
  return processDiagramEditBatchCore(request, classInstance, docText, unifiedIndex, opts);
}

export { Owl2DiagramBackend, type Owl2BackendDeps } from "@modelscript/owl2/diagram";
export { SysML2DiagramBackend, type SysML2BackendDeps } from "@modelscript/sysml2";

// ── Generic DSL Diagram Backend ──

export interface GenericDSLBackendDeps {
  getDocumentText: (uri: string) => string | undefined;
  getDiagramConfig?: ((uri: string) => any) | undefined;
  getSyntaxNames?: ((uri: string) => Record<number, string> | string[] | undefined) | undefined;
  getRawAstData?: ((uri: string) => { nodes: any[]; edges: any[] } | null) | undefined;
  getSymbolIndex?: ((uri: string) => any) | undefined;
  getUnifiedIndex?: (() => any) | undefined;
  getScopeResolver?: ((uri: string) => any) | undefined;
  getParser?: ((langId: string) => CstParserLike | undefined) | undefined;
  layoutStorage?: SidecarLayoutStorage | undefined;
  fsBridge?: FileSystemBridge | undefined;
}

function isWsChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v";
}

function isWordTokenChar(ch: string): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function leadingWhitespaceOf(s: string): string {
  let i = 0;
  while (i < s.length && isWsChar(s[i]!)) i++;
  return s.slice(0, i);
}

function findNextWordMatchIndex(text: string, word: string, fromIndex = 0): number {
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

function findAllWordMatchIndices(text: string, word: string): number[] {
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

function hasWordMatch(text: string, word: string): boolean {
  return findNextWordMatchIndex(text, word, 0) !== -1;
}

function expandEdgeTemplateText(
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

function offsetToLspPosition(docText: string, offset: number): { line: number; character: number } {
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

function findBestCstNodeForSpan(root: SyntaxNode, startOffset: number, endOffset: number): SyntaxNode | null {
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

function findMatchingConnectionCstNode(
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

function collectIdentifierNodesInCstScope(scopeNode: SyntaxNode, docText: string, targetName: string): SyntaxNode[] {
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

function findMatchingEdgeStatement(
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

function extractTrailingAnnotationClause(stmtText: string): string | null {
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

function findParamAssignmentValueSpan(
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

function extractKeyValuePairsFromLine(line: string): Array<{ key: string; value: string }> {
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

function insertIntoSectionOrRoot(lines: string[], allEdits: TextEdit[], content: string, targetSection?: string) {
  if (targetSection) {
    const escaped = targetSection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const xmlCloseRe = new RegExp(`</(?:[A-Za-z0-9_-]+:)?${escaped}\\s*>`, "i");
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = xmlCloseRe.exec(lines[i]!);
      if (m) {
        allEdits.push({
          range: {
            start: { line: i, character: m.index },
            end: { line: i, character: m.index },
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

/**
 * Generic diagram backend for any DSL defined via @modelscript/dsl.
 * Uses declarative grammar diagram configuration and SidecarLayoutStorage.
 */
export class GenericDSLDiagramBackend implements DiagramBackend {
  private readonly defaultLayoutStorage: SidecarLayoutStorage;
  private readonly layoutStorageCache = new Map<string, SidecarLayoutStorage>();

  constructor(private readonly deps: GenericDSLBackendDeps) {
    this.defaultLayoutStorage =
      deps.layoutStorage ??
      new SidecarLayoutStorage({
        fsBridge: deps.fsBridge,
      });
  }

  getLayoutStorage(uri: string): SidecarLayoutStorage {
    if (this.deps.layoutStorage) return this.deps.layoutStorage;
    const cached = this.layoutStorageCache.get(uri);
    if (cached) return cached;

    const config = this.deps.getDiagramConfig?.(uri);
    const sidecarConfig = config?.placement?.sidecar;
    const storage = sidecarConfig
      ? new SidecarLayoutStorage({
          ...sidecarConfig,
          fsBridge: this.deps.fsBridge,
        })
      : this.defaultLayoutStorage;

    this.layoutStorageCache.set(uri, storage);
    return storage;
  }

  async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
    const docText = this.deps.getDocumentText(params.uri);
    const config = this.deps.getDiagramConfig?.(params.uri);
    const symbolIndex = this.deps.getSymbolIndex?.(params.uri);
    const resolver = this.deps.getScopeResolver?.(params.uri);

    let diagramData: any = null;

    if (symbolIndex && config) {
      const { graphicsConfig, options } = compileDiagramConfigToPolyglot(config);
      diagramData = buildPolyglotDiagram(
        symbolIndex,
        graphicsConfig as Parameters<typeof buildPolyglotDiagram>[1],
        params.uri,
        resolver,
        params.diagramType ?? "All",
        options as Parameters<typeof buildPolyglotDiagram>[5],
      );
    } else {
      const syntaxNames = this.deps.getSyntaxNames?.(params.uri);
      const rawData = this.deps.getRawAstData?.(params.uri) ?? { nodes: [], edges: [] };

      if (!docText && rawData.nodes.length === 0) return null;

      diagramData = buildDiagramFromDSL(rawData, config, syntaxNames, params.diagramType, docText);
    }

    if ((!diagramData || !Array.isArray(diagramData.nodes) || diagramData.nodes.length === 0) && docText) {
      const plugin = globalLanguageRegistry.getPluginForUri(params.uri, docText);
      const isScad = /\.scad($|\?|#)/i.test(params.uri) || plugin?.id === "scad";

      const makeStyledPorts = () => ({
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: { r: 4, magnet: true, stroke: "#0284c7", fill: "#ffffff", strokeWidth: 1.5 },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: { r: 4, magnet: true, stroke: "#0284c7", fill: "#ffffff", strokeWidth: 1.5 },
            },
          },
        },
        items: [
          { id: "in", group: "in" },
          { id: "out", group: "out" },
        ],
      });

      const makeStyledNode = (opts: {
        id: string;
        name: string;
        kind: string;
        stereotype: string;
        subtitle?: string | undefined;
        entries?: string[] | undefined;
        stroke: string;
        fill: string;
        headerFill?: string | undefined;
        x?: number | undefined;
        y?: number | undefined;
      }) => {
        const entries = opts.entries ?? [];
        const hasEntries = entries.length > 0;
        const subtitle = opts.subtitle?.trim() || "";
        const HEADER_H = subtitle ? 54 : 40;
        const LINE_H = 16;
        const maxTextLen = Math.max(
          opts.name.length * 8.5 + 36,
          opts.stereotype.length * 7.5 + 32,
          subtitle.length * 6.8 + 32,
          ...entries.map((e) => e.length * 7.2 + 36),
        );
        const width = Math.min(320, Math.max(185, Math.ceil(maxTextLen)));
        const height = hasEntries ? HEADER_H + entries.length * LINE_H + 12 : subtitle ? 62 : 48;

        const markup: { tagName: string; selector: string }[] = [
          { tagName: "rect", selector: "body" },
          ...(hasEntries
            ? [
                { tagName: "path", selector: "headerBody" },
                { tagName: "line", selector: "headerSep" },
              ]
            : []),
          { tagName: "text", selector: "stereotype" },
          { tagName: "text", selector: "label" },
          ...(subtitle ? [{ tagName: "text", selector: "subtitle" }] : []),
        ];

        const headerPath = `M 0 6 A 6 6 0 0 1 6 0 L ${width - 6} 0 A 6 6 0 0 1 ${width} 6 L ${width} ${HEADER_H} L 0 ${HEADER_H} Z`;
        const attrs: Record<string, Record<string, unknown>> = {
          body: {
            fill: hasEntries ? "#ffffff" : opts.fill,
            stroke: opts.stroke,
            strokeWidth: 1.5,
            rx: 6,
            ry: 6,
            refWidth: "100%",
            refHeight: "100%",
          },
          ...(hasEntries
            ? {
                headerBody: {
                  d: headerPath,
                  fill: opts.headerFill ?? opts.fill,
                  stroke: "none",
                },
                headerSep: {
                  x1: 0,
                  y1: HEADER_H,
                  x2: width,
                  y2: HEADER_H,
                  stroke: opts.stroke,
                  strokeWidth: 1,
                },
              }
            : {}),
          stereotype: {
            text: `«${opts.stereotype}»`,
            fill: opts.stroke,
            fontSize: 10,
            fontStyle: "italic",
            textAnchor: "middle",
            textVerticalAnchor: "top",
            refX: 0.5,
            refY: 6,
          },
          label: {
            text: opts.name,
            fill: "#0f172a",
            fontSize: 12,
            fontWeight: "bold",
            textAnchor: "middle",
            textVerticalAnchor: "top",
            refX: 0.5,
            refY: 21,
          },
          ...(subtitle
            ? {
                subtitle: {
                  text: subtitle.length > 42 ? `${subtitle.slice(0, 39)}...` : subtitle,
                  fill: "#475569",
                  fontSize: 10,
                  fontFamily: "monospace",
                  textAnchor: "middle",
                  textVerticalAnchor: "top",
                  refX: 0.5,
                  refY: 38,
                },
              }
            : {}),
        };

        for (let i = 0; i < entries.length; i++) {
          const sel = `entry_${i}`;
          markup.push({ tagName: "text", selector: sel });
          attrs[sel] = {
            text: entries[i]!,
            fill: "#1e293b",
            fontSize: 11,
            fontFamily: "monospace",
            textAnchor: "start",
            textVerticalAnchor: "top",
            refX: 14,
            refY: HEADER_H + 6 + i * LINE_H,
          };
        }

        return {
          id: opts.id,
          name: opts.name,
          label: subtitle ? `${opts.name}\n${subtitle}` : opts.name,
          kind: opts.kind,
          x: opts.x ?? 80,
          y: opts.y ?? 80,
          width,
          height,
          rotation: 0,
          autoLayout: true,
          shape: "rect",
          markup,
          attrs,
          ports: makeStyledPorts(),
          properties: {
            className: opts.kind,
            name: opts.name,
            description: subtitle,
          },
        };
      };

      const makeStyledEdge = (id: string, source: string, target: string, dashed = false, labelText?: string) => ({
        id,
        source,
        target,
        sourcePort: "out",
        targetPort: "in",
        attrs: {
          line: {
            stroke: dashed ? "#0d9488" : "#64748b",
            strokeWidth: 1.5,
            ...(dashed ? { strokeDasharray: "5 3" } : {}),
            targetMarker: {
              name: "block",
              width: 8,
              height: 6,
            },
          },
        },
        ...(labelText
          ? {
              labels: [
                {
                  attrs: {
                    label: {
                      text: labelText,
                      fill: "#475569",
                      fontSize: 10,
                    },
                  },
                },
              ],
            }
          : {}),
      });

      const nodes: any[] = [];
      const edges: any[] = [];

      // Dedicated OpenSCAD (.scad) CSG Constructive Solid Geometry Tree & Parametric Diagram Builder
      if (isScad) {
        try {
          const cachedOrProvided = this.deps.getParser?.("scad") ?? plugin?.parser;
          const scadParser = cachedOrProvided ?? (await (await import("@modelscript/scad")).getScadParser());
          const tree = scadParser?.parse?.(docText);
          if (tree?.rootNode) {
            buildScadDiagramFromCst(tree.rootNode, makeStyledNode, makeStyledEdge, nodes, edges);
          }
        } catch {
          // If SCAD WASM parser cannot be loaded, allow downstream fallbacks if any
        }
      }

      // Dedicated Fortran (.f, .for, .f77, .f90, .f95, .f03, .f08) Dataflow & Block Schematic Builder
      const isFortran = /\.(f|for|f77|f90|f95|f03|f08)($|\?|#)/i.test(params.uri) || plugin?.id === "fortran";
      if (nodes.length === 0 && isFortran) {
        try {
          const maskedFortran = maskFortranFixedCommentsAndPreprocessor(docText);
          const cachedOrProvided = this.deps.getParser?.("fortran") ?? plugin?.parser;
          const fortranParser = cachedOrProvided ?? (await (await import("@modelscript/fortran")).getFortranParser());
          const tree = fortranParser?.parse?.(maskedFortran);
          if (tree?.rootNode) {
            buildFortranDiagramFromCst(tree.rootNode, makeStyledNode, makeStyledEdge, nodes, edges);
          }
        } catch {
          // If Fortran WASM parser cannot be loaded, allow downstream fallbacks if any
        }
      }

      if (nodes.length === 0 && plugin?.customHandlers?.symbols) {
        try {
          const syms = plugin.customHandlers.symbols(docText) ?? [];
          let idx = 0;
          const visitSym = (
            sym:
              | {
                  name?: string;
                  kind?: unknown;
                  detail?: unknown;
                  children?: unknown[];
                }
              | null
              | undefined,
            parentId?: string,
          ) => {
            if (!sym || !sym.name) return;
            const nodeId = parentId ? `${parentId}.${sym.name}` : sym.name;
            if (!nodes.some((n) => n.id === nodeId)) {
              const col = idx % 3;
              const row = Math.floor(idx / 3);
              idx++;
              const kindStr = String(sym.kind ?? "component");
              nodes.push(
                makeStyledNode({
                  id: nodeId,
                  name: sym.name,
                  kind: kindStr,
                  stereotype: kindStr.toLowerCase(),
                  subtitle: sym.detail ? String(sym.detail) : undefined,
                  stroke: "#0284c7",
                  fill: "#f0f9ff",
                  x: 80 + col * 240,
                  y: 80 + row * 130,
                }),
              );
            }
            if (parentId) {
              edges.push(makeStyledEdge(`edge_${parentId}_${nodeId}`, parentId, nodeId));
            }
            if (Array.isArray(sym.children)) {
              for (const child of sym.children) {
                visitSym(
                  child as {
                    name?: string;
                    kind?: unknown;
                    detail?: unknown;
                    children?: unknown[];
                  },
                  nodeId,
                );
              }
            }
          };
          for (const s of syms) {
            visitSym(s);
          }
          if (edges.length === 0 && nodes.length > 1) {
            for (let i = 0; i < nodes.length - 1; i++) {
              edges.push(makeStyledEdge(`edge_${i}_${i + 1}`, nodes[i]!.id, nodes[i + 1]!.id));
            }
          }
        } catch {
          // fall through to structural line synthesis
        }
      }

      if (nodes.length === 0) {
        const hasGrammarOrSymbols = Boolean(
          config ||
          isScad ||
          isFortran ||
          plugin?.customHandlers?.symbols ||
          plugin?.languageDef?.diagram ||
          plugin?.id === "modelica" ||
          plugin?.id === "sysml2" ||
          plugin?.id === "owl2",
        );
        if (!hasGrammarOrSymbols) {
          const langLabel = plugin?.name || plugin?.id || "this file type";
          throw new Error(`Diagram view is not supported for ${langLabel}.`);
        }
      }

      diagramData = {
        nodes,
        edges,
        coordinateSystem: null,
        diagramBackground: null,
      };
    }

    if (!diagramData) return null;

    if (params.sidecarContent) {
      try {
        const storage = this.getLayoutStorage(params.uri);
        const parser = (storage as any).options?.parse ?? parseLayout;
        const parsed = parser(params.sidecarContent);
        if (parsed) {
          (storage as any).cache?.set(params.uri, parsed);
        }
      } catch {
        // ignore
      }
    }

    // Merge persisted layout if available
    const layout = await this.getLayoutStorage(params.uri).loadLayout(params.uri);
    if (layout && diagramData) {
      for (const node of diagramData.nodes) {
        const nodeName = (node as any).name || node.properties?.description;
        const el = layout.elements[node.id] || (nodeName && layout.elements[nodeName]);
        if (el) {
          node.x = el.x;
          node.y = el.y;
          if (el.width) node.width = el.width;
          if (el.height) node.height = el.height;
          node.autoLayout = false;
        }
      }
    }

    return diagramData as any;
  }

  getComponentProperties(params: DiagramGetComponentPropertiesParams): ComponentPropertyData | null {
    const config = this.deps.getDiagramConfig?.(params.uri);
    const propConfig = (config as any)?.properties;
    if (propConfig) {
      const className = params.className || "Component";

      // 1. Dynamic in-model discovery hook
      if (typeof propConfig.inModelDiscovery?.extractSchema === "function") {
        try {
          const symIndex = this.deps.getSymbolIndex?.(params.uri);
          const rawAst = this.deps.getRawAstData?.(params.uri);
          const dynamicSchema = propConfig.inModelDiscovery.extractSchema(rawAst, params.componentName, symIndex);
          if (dynamicSchema) {
            const dynamicValues =
              typeof propConfig.inModelDiscovery.extractValues === "function"
                ? propConfig.inModelDiscovery.extractValues(rawAst, params.componentName, symIndex)
                : { name: params.componentName };
            return {
              className,
              name: params.componentName,
              description: "",
              parameters: [],
              schema: dynamicSchema,
              values: dynamicValues || { name: params.componentName },
            };
          }
        } catch (e) {
          console.error("[diagram] inModelDiscovery.extractSchema error:", e);
        }
      }

      // 2. Static schema lookup fallback
      const schema =
        propConfig.entities?.[className] ||
        (propConfig.entities && Object.keys(propConfig.entities).length > 0
          ? Object.values(propConfig.entities)[0]
          : undefined);
      if (schema) {
        return {
          className,
          name: params.componentName,
          description: "",
          parameters: [],
          schema,
          values: { name: params.componentName },
        };
      }
    }

    // 3. Universal source-text parameter extraction fallback
    const docText = this.deps.getDocumentText(params.uri);
    const parameters: ComponentPropertyData["parameters"] = [];
    const values: Record<string, any> = { name: params.componentName };
    const fields: PropertyFieldConfig[] = [];
    if (docText) {
      const lines = docText.replaceAll("\r\n", "\n").split("\n");
      const targetName = params.componentName.split(".").pop() ?? params.componentName;
      let startLine = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes(targetName)) {
          startLine = i;
          break;
        }
      }
      const windowEnd = Math.min(lines.length, startLine + 12);
      const seenKeys = new Set<string>();
      for (let i = startLine; i < windowEnd; i++) {
        const line = lines[i]!;
        for (const { key: k, value: v } of extractKeyValuePairsFromLine(line)) {
          if (seenKeys.has(k)) continue;
          seenKeys.add(k);
          parameters.push({ name: k, value: v, description: `Parameter '${k}'` });
          values[k] = v;
          fields.push({
            key: k,
            label: k,
            kind: !isNaN(Number(v)) ? "number" : "string",
            defaultValue: !isNaN(Number(v)) ? Number(v) : v,
          });
        }
      }
    }

    return {
      className: params.className || "Component",
      name: params.componentName,
      description: "",
      parameters,
      schema:
        fields.length > 0
          ? {
              title: params.componentName,
              tabs: [{ id: "general", label: "General", groups: [{ id: "params", label: "Parameters", fields }] }],
            }
          : undefined,
      values,
    };
  }

  getPalette(params: DiagramGetPaletteParams): DiagramPalette | null {
    const config = this.deps.getDiagramConfig?.(params.uri);
    if (config?.palette?.categories) {
      return { categories: config.palette.categories };
    }
    return null;
  }

  async drillDown(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> {
    const symbolIndex = this.deps.getSymbolIndex?.(params.uri);
    const targetName = params.className || params.componentName;
    if (!targetName) return null;

    let targetUri = params.uri;
    if (symbolIndex) {
      for (const [, sym] of symbolIndex.symbols) {
        if (sym.name === targetName) {
          if (sym.resourceId) targetUri = sym.resourceId;
          break;
        }
      }
    }

    const breadcrumbs = [
      { id: "root", label: "Root", uri: params.uri },
      { id: params.nodeId || targetName, label: targetName, uri: targetUri },
    ];

    const childData = await this.getData({
      uri: targetUri,
      className: targetName,
    });

    return {
      targetUri,
      targetClassName: targetName,
      breadcrumbs,
      data: childData ?? null,
    };
  }

  private resolveSymbolEntry(
    symbolIndex:
      | {
          byName?: Map<string, number[]>;
          symbols?: Map<
            number,
            { id: number; name: string; startOffset?: number; endOffset?: number; parentId?: number }
          >;
        }
      | null
      | undefined,
    name: string,
  ): { id: number; name: string; startOffset?: number; endOffset?: number; parentId?: number } | null {
    if (!symbolIndex || !name) return null;
    const candidateIds: number[] = symbolIndex.byName?.get?.(name) ?? [];
    for (const id of candidateIds) {
      const sym = symbolIndex.symbols?.get?.(id);
      if (sym) return sym;
    }
    if (symbolIndex.symbols?.values) {
      for (const sym of symbolIndex.symbols.values()) {
        if (sym?.name === name) return sym;
      }
    }
    return null;
  }

  private resolveChildSymbolEntry(
    symbolIndex:
      | {
          childrenOf?: Map<number, number[]>;
          symbols?: Map<
            number,
            { id: number; name: string; startOffset?: number; endOffset?: number; parentId?: number }
          >;
        }
      | null
      | undefined,
    parentEntry: { id: number } | null | undefined,
    name: string,
  ): { id: number; name: string; startOffset?: number; endOffset?: number; parentId?: number } | null {
    if (!symbolIndex || !parentEntry || !name) return null;
    const childIds: number[] = symbolIndex.childrenOf?.get?.(parentEntry.id) ?? [];
    for (const cid of childIds) {
      const sym = symbolIndex.symbols?.get?.(cid);
      if (sym?.name === name) return sym;
    }
    return null;
  }

  async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
    const allEdits: TextEdit[] = [];
    const itemsToSave: any[] = [];
    const docText = this.deps.getDocumentText(params.uri);
    const maskedText = docText !== undefined ? maskComments(docText) : undefined;
    const lines = docText !== undefined ? docText.split("\n") : [];
    const maskedLines = maskedText !== undefined ? maskedText.split("\n") : [];
    const config = this.deps.getDiagramConfig?.(params.uri);
    const mutations = config?.mutations;
    const symbolIndex = this.deps.getSymbolIndex?.(params.uri);
    let cachedCstRoot: SyntaxNode | null | undefined = undefined;
    const getCstRoot = (): SyntaxNode | null => {
      if (cachedCstRoot !== undefined) return cachedCstRoot;
      cachedCstRoot = null;
      if (docText === undefined || !this.deps.getParser) return null;
      const ext = (params.uri || "").split(".").pop()?.split("?")[0] || "";
      const langHint = config?.language || config?.name || ext;
      const parser = this.deps.getParser(langHint) ?? (ext && ext !== langHint ? this.deps.getParser(ext) : undefined);
      try {
        const tree = parser?.parse?.(docText) as { rootNode?: SyntaxNode } | undefined;
        cachedCstRoot = tree?.rootNode ?? null;
      } catch {
        cachedCstRoot = null;
      }
      return cachedCstRoot;
    };

    const cleanUriLower = (params.uri || "").split("?")[0]!.toLowerCase();
    const isKnownNonModelicaExt =
      /\.(scad|sysml2?|spice|cir|sp|ssp|ssd|reqif|mdzip|mdxml|xmi|arxml|adm|cmd|acf|spck|sim|mbs|xodr|urdf|sdf|xacro|vhdl?|sv|v|f90|c|cpp|h|py|json|xml|yaml|yml)$/.test(
        cleanUriLower,
      );

    for (const action of params.actions) {
      switch (action.type) {
        case "move": {
          const moveItems: PlacementItem[] = Array.isArray(action.items)
            ? action.items
            : (action as any).nodeId && (action as any).position
              ? [
                  {
                    name: String((action as any).nodeId),
                    x: (action as any).position.x,
                    y: (action as any).position.y,
                    width: (action as any).width ?? (action as any).size?.width ?? 0,
                    height: (action as any).height ?? (action as any).size?.height ?? 0,
                  },
                ]
              : [];
          if (config?.placement?.persistence === "inline" && docText !== undefined) {
            for (const item of moveItems) {
              emitInlinePlacementEdit(item, lines, maskedLines, config.placement.formatPlacement, allEdits, true);
            }
          } else {
            itemsToSave.push(...moveItems);
          }
          break;
        }
        case "resize":
        case "rotate": {
          if (config?.placement?.persistence === "inline" && docText !== undefined) {
            emitInlinePlacementEdit(action.item, lines, maskedLines, config.placement.formatPlacement, allEdits, false);
          } else {
            itemsToSave.push(action.item);
          }
          break;
        }
        case "connect": {
          const edgeTemplate =
            (action.edgeType && mutations?.edgeTemplates?.[action.edgeType]) ||
            mutations?.edgeTemplate ||
            mutations?.createEdge;
          if (!edgeTemplate && isKnownNonModelicaExt) {
            break;
          }
          const edgeText = expandEdgeTemplateText(
            edgeTemplate,
            action.source,
            action.target,
            action.sourcePort,
            action.targetPort,
          );

          if (docText !== undefined && edgeText) {
            const targetSection =
              action.section || mutations?.sections?.edge || mutations?.insertionSection || mutations?.defaultSection;
            insertIntoSectionOrRoot(lines, allEdits, edgeText, targetSection);
          }

          if (action.points && action.points.length > 0) {
            await this.getLayoutStorage(params.uri).updatePositions(params.uri, [
              {
                name: action.source,
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                rotation: 0,
                edges: [{ source: action.source, target: action.target, points: action.points }],
                connectedOnly: true,
              },
            ]);
          }
          break;
        }
        case "disconnect": {
          if (docText !== undefined && !isKnownNonModelicaExt) {
            const cstRoot = getCstRoot();
            if (cstRoot) {
              const connNode = findMatchingConnectionCstNode(
                cstRoot,
                docText,
                action.source,
                action.sourcePort,
                action.target,
                action.targetPort,
              );
              if (connNode && connNode.endIndex > connNode.startIndex) {
                const delRes = CstUnparser.deleteDeclaration(docText, cstRoot, {
                  startOffset: connNode.startIndex,
                  endOffset: connNode.endIndex,
                });
                if (delRes) {
                  allEdits.push({ range: delRes.edit.range, newText: "" });
                  break;
                }
              }
            }
            const matchSpan = findMatchingEdgeStatement(
              maskedLines,
              action.source,
              action.sourcePort,
              action.target,
              action.targetPort,
            );
            if (matchSpan) {
              allEdits.push({
                range: {
                  start: { line: matchSpan.startLine, character: 0 },
                  end: { line: matchSpan.endLine + 1, character: 0 },
                },
                newText: "",
              });
            }
          }
          break;
        }
        case "reconnect": {
          if (docText !== undefined) {
            const cstRoot = getCstRoot();
            const cstConnNode = cstRoot
              ? findMatchingConnectionCstNode(
                  cstRoot,
                  docText,
                  action.oldSource,
                  action.oldSourcePort,
                  action.oldTarget,
                  action.oldTargetPort,
                )
              : null;
            const matchSpan =
              cstConnNode && cstConnNode.endIndex > cstConnNode.startIndex
                ? {
                    startLine: cstConnNode.startPosition
                      ? cstConnNode.startPosition.row
                      : offsetToLspPosition(docText, cstConnNode.startIndex).line,
                    endLine: cstConnNode.endPosition
                      ? cstConnNode.endPosition.row
                      : offsetToLspPosition(docText, Math.max(cstConnNode.startIndex, cstConnNode.endIndex - 1)).line,
                  }
                : findMatchingEdgeStatement(
                    maskedLines,
                    action.oldSource,
                    action.oldSourcePort,
                    action.oldTarget,
                    action.oldTargetPort,
                  );
            const edgeTemplate =
              (action.edgeType && mutations?.edgeTemplates?.[action.edgeType]) ||
              mutations?.edgeTemplate ||
              mutations?.createEdge;
            if (typeof edgeTemplate !== "function" && typeof edgeTemplate !== "string" && isKnownNonModelicaExt) {
              break;
            }

            if (matchSpan) {
              const { startLine: i, endLine } = matchSpan;
              const line = lines[i]!;
              let newEdgeText = "";

              if (typeof edgeTemplate === "function" || typeof edgeTemplate === "string") {
                newEdgeText = expandEdgeTemplateText(
                  edgeTemplate,
                  action.newSource,
                  action.newTarget,
                  action.newSourcePort,
                  action.newTargetPort,
                );
              } else {
                const src = action.newSourcePort ? `${action.newSource}.${action.newSourcePort}` : action.newSource;
                const tgt = action.newTargetPort ? `${action.newTarget}.${action.newTargetPort}` : action.newTarget;
                const fullOldStatement = lines.slice(i, endLine + 1).join("\n");
                const existingAnnot = extractTrailingAnnotationClause(fullOldStatement) ?? ";";

                if (action.points && action.points.length > 0) {
                  const ptsStr = action.points.map((p) => `{${p.x}, ${p.y}}`).join(", ");
                  if (existingAnnot.includes("points")) {
                    const updatedAnnot = replaceBalancedBracesField(existingAnnot, "points", ptsStr);
                    newEdgeText = `connect(${src}, ${tgt}) ${updatedAnnot.trim()}`;
                  } else if (existingAnnot.startsWith("annotation")) {
                    newEdgeText = `connect(${src}, ${tgt}) ${existingAnnot.trim()}`;
                  } else {
                    newEdgeText = `connect(${src}, ${tgt}) annotation(Line(points={${ptsStr}}));`;
                  }
                } else {
                  newEdgeText = `connect(${src}, ${tgt})${existingAnnot.startsWith("annotation") ? ` ${existingAnnot.trim()}` : ";"}`;
                }
              }

              const indent = leadingWhitespaceOf(line);
              allEdits.push({
                range: {
                  start: { line: i, character: 0 },
                  end: { line: endLine, character: lines[endLine]!.length },
                },
                newText: indent + newEdgeText.trim(),
              });
            } else {
              const edgeText = expandEdgeTemplateText(
                edgeTemplate,
                action.newSource,
                action.newTarget,
                action.newSourcePort,
                action.newTargetPort,
              );
              const targetSection =
                action.section || mutations?.sections?.edge || mutations?.insertionSection || mutations?.defaultSection;
              insertIntoSectionOrRoot(lines, allEdits, edgeText, targetSection);
            }
          }
          break;
        }
        case "addComponent": {
          const priorEditText = allEdits.map((e) => e.newText).join("\n");
          const resolvedGeneric = resolveGenericComponentDrop({
            uri: params.uri,
            rawClassName: action.className,
            docText: priorEditText ? `${docText ?? ""}\n${priorEditText}` : (docText ?? ""),
            instanceName: action.name,
            symbolIndex: this.deps.getUnifiedIndex?.() ?? this.deps.getSymbolIndex?.(params.uri) ?? null,
          });
          const resolvedClassName = resolvedGeneric.className;
          const uniqueName = resolvedGeneric.instanceName;

          let nodeText = "";
          if (typeof mutations?.createNode === "function") {
            nodeText = mutations.createNode(resolvedClassName, uniqueName, action.x, action.y);
          } else if (typeof mutations?.nodeTemplate === "function") {
            nodeText = mutations.nodeTemplate(resolvedClassName, uniqueName);
          } else if (typeof mutations?.nodeTemplate === "string") {
            nodeText = mutations.nodeTemplate
              .replaceAll("${className}", resolvedClassName)
              .replaceAll("${name}", uniqueName);
          } else if (!isKnownNonModelicaExt) {
            nodeText = `${resolvedClassName} ${uniqueName};\n`;
          }

          if (docText !== undefined && nodeText) {
            const targetSection = action.section || mutations?.sections?.node || mutations?.defaultSection;
            insertIntoSectionOrRoot(lines, allEdits, nodeText, targetSection);
          }

          itemsToSave.push({
            name: uniqueName,
            x: Math.round(action.x),
            y: Math.round(action.y),
            width: 120,
            height: 60,
            rotation: 0,
          });
          break;
        }
        case "deleteComponents": {
          const hasExplicitMutations = Boolean(
            mutations?.createNode || mutations?.nodeTemplate || mutations?.deleteEntity,
          );
          if (docText !== undefined && (!isKnownNonModelicaExt || hasExplicitMutations)) {
            const cstRoot = getCstRoot();
            for (const name of action.names) {
              const entry = this.resolveSymbolEntry(symbolIndex, name);
              if (
                entry &&
                entry.startOffset != null &&
                entry.endOffset != null &&
                entry.endOffset > entry.startOffset
              ) {
                const delRes = CstUnparser.deleteDeclaration(docText, cstRoot, entry);
                if (delRes) {
                  allEdits.push({ range: delRes.edit.range, newText: "" });
                  continue;
                }
              }
              for (let i = 0; i < lines.length; i++) {
                if (hasWordMatch(maskedLines[i]!, name)) {
                  allEdits.push({
                    range: {
                      start: { line: i, character: 0 },
                      end: { line: i + 1, character: 0 },
                    },
                    newText: "",
                  });
                  break;
                }
              }
            }
          }
          break;
        }
        case "moveEdge": {
          for (const e of action.edges) {
            await this.getLayoutStorage(params.uri).updatePositions(params.uri, [
              {
                name: e.source,
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                rotation: 0,
                edges: [{ source: e.source, target: e.target, points: e.points }],
                connectedOnly: true,
              },
            ]);
          }
          break;
        }
        case "updateName": {
          if (action.oldName && action.newName) {
            await this.getLayoutStorage(params.uri).renameElement(params.uri, action.oldName, action.newName);
          }
          if (docText !== undefined && maskedLines.length > 0 && action.oldName && action.newName) {
            const entry = this.resolveSymbolEntry(symbolIndex, action.oldName);
            const parentSym = entry?.parentId != null ? symbolIndex?.symbols?.get?.(entry.parentId) : null;
            const cstRoot = getCstRoot();
            if (cstRoot) {
              const scopeNode =
                parentSym &&
                parentSym.startOffset != null &&
                parentSym.endOffset != null &&
                parentSym.endOffset > parentSym.startOffset
                  ? (findBestCstNodeForSpan(cstRoot, parentSym.startOffset, parentSym.endOffset) ?? cstRoot)
                  : cstRoot;
              const idNodes = collectIdentifierNodesInCstScope(scopeNode, docText, action.oldName);
              if (idNodes.length > 0) {
                for (const idNode of idNodes) {
                  if (idNode.startPosition && idNode.endPosition) {
                    const patchRes = CstUnparser.patchAndUnparse({
                      target: idNode,
                      replaceText: action.newName,
                    });
                    allEdits.push({
                      range: patchRes.edit.range,
                      newText: patchRes.edit.newText,
                    });
                  } else {
                    allEdits.push({
                      range: {
                        start: offsetToLspPosition(docText, idNode.startIndex),
                        end: offsetToLspPosition(docText, idNode.endIndex),
                      },
                      newText: action.newName,
                    });
                  }
                }
                break;
              }
            }
            let scopeStartLine = 0;
            let scopeEndLine = lines.length - 1;
            if (
              parentSym &&
              parentSym.startOffset != null &&
              parentSym.endOffset != null &&
              parentSym.endOffset > parentSym.startOffset
            ) {
              // Limit word matches to the enclosing parent declaration lines
              let lineStartIdx = 0;
              let offset = 0;
              for (let li = 0; li < lines.length; li++) {
                const nextOffset = offset + lines[li]!.length + 1;
                if (offset <= parentSym.startOffset && parentSym.startOffset < nextOffset) {
                  scopeStartLine = li;
                }
                if (offset <= parentSym.endOffset && parentSym.endOffset <= nextOffset) {
                  scopeEndLine = li;
                  break;
                }
                offset = nextOffset;
                lineStartIdx++;
              }
              void lineStartIdx;
            }
            for (let i = scopeStartLine; i <= scopeEndLine && i < lines.length; i++) {
              for (const col of findAllWordMatchIndices(maskedLines[i]!, action.oldName)) {
                allEdits.push({
                  range: {
                    start: { line: i, character: col },
                    end: { line: i, character: col + action.oldName.length },
                  },
                  newText: action.newName,
                });
              }
            }
          }
          break;
        }
        case "updateParameter":
        case "updateProperty": {
          const paramName =
            action.type === "updateProperty"
              ? (action.key ?? (action as any).propertyName ?? (action as any).parameter)
              : action.parameter;
          const paramVal = action.value;
          if (docText !== undefined && paramName && paramVal !== undefined) {
            const mutator = config?.properties?.mutator;
            if (typeof mutator?.updateProperty === "function") {
              try {
                const prevVal = (action as any).previousValue;
                const rawAst = this.deps.getRawAstData?.(params.uri);
                let customEdits = mutator.updateProperty(rawAst ?? docText, action.name, paramName, paramVal, prevVal);
                if (!customEdits) {
                  customEdits = (mutator.updateProperty as any)(action.name, paramName, paramVal, docText);
                }
                if (Array.isArray(customEdits) && customEdits.length > 0) {
                  allEdits.push(...customEdits);
                  break;
                }
              } catch (e) {
                console.error("[diagram] mutator.updateProperty error:", e);
              }
            } else if (typeof mutator?.updateModifier === "function") {
              try {
                const customEdits = mutator.updateModifier(docText, action.name, paramName, paramVal);
                if (Array.isArray(customEdits) && customEdits.length > 0) {
                  allEdits.push(...customEdits);
                  break;
                }
              } catch (e) {
                console.error("[diagram] mutator.updateModifier error:", e);
              }
            }

            // Canonical CST Unparser writeback via SymbolIndex declaration/child entry
            const compEntry = action.name ? this.resolveSymbolEntry(symbolIndex, action.name) : null;
            const targetEntry = this.resolveChildSymbolEntry(symbolIndex, compEntry, paramName) ?? compEntry;
            if (targetEntry) {
              const cstRes = CstUnparser.patchWritebackValue(docText, getCstRoot(), targetEntry, String(paramVal));
              if (cstRes) {
                allEdits.push({
                  range: cstRes.edit.range,
                  newText: cstRes.edit.newText,
                });
                break;
              }
            }

            let matched = false;
            const searchWindow = (startLine: number, endLine: number): boolean => {
              for (let l = startLine; l < endLine; l++) {
                const valSpan = findParamAssignmentValueSpan(maskedLines[l]!, paramName);
                if (valSpan) {
                  allEdits.push({
                    range: {
                      start: { line: l, character: valSpan.startCol },
                      end: { line: l, character: valSpan.endCol },
                    },
                    newText: String(paramVal),
                  });
                  return true;
                }
              }
              return false;
            };

            if (action.name) {
              for (let i = 0; i < lines.length && !matched; i++) {
                if (hasWordMatch(maskedLines[i]!, action.name)) {
                  matched = searchWindow(i, Math.min(lines.length, i + 6));
                }
              }
            }

            if (!matched) {
              matched = searchWindow(0, lines.length);
            }

            // If not matched, try appending new modifier to component declaration
            if (!matched && action.name) {
              for (let i = 0; i < lines.length; i++) {
                if (hasWordMatch(maskedLines[i]!, action.name)) {
                  const openParen = lines[i]!.indexOf("(", lines[i]!.indexOf(action.name));
                  const closeParen = lines[i]!.lastIndexOf(")");
                  if (openParen !== -1 && closeParen !== -1 && closeParen > openParen) {
                    const hasArgs = lines[i]!.substring(openParen + 1, closeParen).trim().length > 0;
                    allEdits.push({
                      range: {
                        start: { line: i, character: closeParen },
                        end: { line: i, character: closeParen },
                      },
                      newText: `${hasArgs ? ", " : ""}${paramName} = ${paramVal}`,
                    });
                    break;
                  }
                }
              }
            }
          }
          break;
        }
      }
    }

    let sidecarUri: string | undefined;
    let sidecarContent: string | undefined;
    if (itemsToSave.length > 0) {
      const storage = this.getLayoutStorage(params.uri);
      await storage.updatePositions(params.uri, itemsToSave);
      const updatedLayout = await storage.loadLayout(params.uri);
      if (updatedLayout) {
        sidecarUri = storage.getSidecarUri(params.uri);
        const serialize = (storage as any).options?.serialize ?? ((l: any) => JSON.stringify(l, null, 2) + "\n");
        try {
          sidecarContent = serialize(updatedLayout);
        } catch {
          // ignore
        }
      }
    }

    return {
      seq: params.seq,
      edits: allEdits,
      renderHint: allEdits.length > 0 ? "immediate" : itemsToSave.length > 0 ? "none" : "immediate",
      sidecarUri,
      sidecarContent,
    };
  }
}

// ── Dispatch Factory ──

export interface DiagramDispatchDeps {
  modelica?: DiagramBackend | undefined;
  sysml2?: DiagramBackend | undefined;
  generic?: DiagramBackend | undefined;
  owl2?: DiagramBackend | undefined;
  simulink?: DiagramBackend | undefined;
  spice?: DiagramBackend | undefined;
  opendrive?: DiagramBackend | undefined;
  simpack?: DiagramBackend | undefined;
  gensys?: DiagramBackend | undefined;
  adams?: DiagramBackend | undefined;
  urdf?: DiagramBackend | undefined;
  getUnifiedIndex?: (() => any) | undefined;
  customBackends?: Map<string | RegExp, DiagramBackend> | undefined;
}

export function getUnifiedIndexFromDeps(backends: DiagramDispatchDeps): any {
  return (
    backends.getUnifiedIndex?.() ??
    (backends.modelica as any)?.deps?.getUnifiedIndex?.() ??
    (backends.sysml2 as any)?.deps?.getUnifiedIndex?.() ??
    (backends.generic as any)?.deps?.getUnifiedIndex?.() ??
    null
  );
}

const DOMAIN_BUILDERS: Record<string, (text: string, params: DiagramGetDataParams) => Promise<unknown>> = {
  simpack: async (text) => {
    const { parseSpckXml, parseSimDeck, buildSimpackDiagram } = await import("@modelscript/simpack");
    const isXml = text.trimStart().startsWith("<");
    const model = isXml ? parseSpckXml(text) : parseSimDeck(text);
    return buildSimpackDiagram(model);
  },
  gensys: async (text) => {
    const { parseGensysDeck, buildGensysDiagram } = await import("@modelscript/gensys");
    return buildGensysDiagram(parseGensysDeck(text));
  },
  adams: async (text) => {
    const { parseAdams, buildAdamsDiagram } = await import("@modelscript/adams");
    return buildAdamsDiagram(parseAdams(text));
  },
  urdf: async (text) => {
    const { parseUrdf, buildUrdfDiagram } = await import("@modelscript/urdf");
    return buildUrdfDiagram(parseUrdf(text));
  },
  aspen: async (text) => {
    const { parseAspen } = await import("@modelscript/aspen");
    const { buildAspenDiagram } = await import("@modelscript/diagram/aspen-diagram-builder");
    return buildAspenDiagram(parseAspen(text) as any);
  },
  swmm: async (text) => {
    const { parseSwmm } = await import("@modelscript/swmm");
    const { buildSwmmDiagram } = await import("@modelscript/diagram/swmm-diagram-builder");
    return buildSwmmDiagram(parseSwmm(text) as any);
  },
  eclipse: async (text) => {
    const { parseEclipse } = await import("@modelscript/eclipse");
    const { buildEclipseDiagram } = await import("@modelscript/diagram/eclipse-diagram-builder");
    return buildEclipseDiagram(parseEclipse(text) as any);
  },
  jsbsim: async (text) => {
    const { parseJsbsim } = await import("@modelscript/jsbsim");
    const { buildJsbsimDiagram } = await import("@modelscript/diagram/jsbsim-diagram-builder");
    const doc = parseJsbsim(text) as any;
    return buildJsbsimDiagram(doc.fdm ?? doc);
  },
  lps: async (text) => {
    const { parseLps } = await import("@modelscript/lps");
    const { buildLpsDiagram } = await import("@modelscript/diagram/lps-diagram-builder");
    return buildLpsDiagram(parseLps(text) as any);
  },
  olga: async (text) => {
    const { parseOpi } = await import("@modelscript/olga");
    const { buildOlgaDiagram } = await import("@modelscript/diagram/olga-diagram-builder");
    return buildOlgaDiagram(parseOpi(text) as any);
  },
  opendss: async (text) => {
    const { parseOpenDss } = await import("@modelscript/opendss");
    const { buildOpenDssDiagram } = await import("@modelscript/diagram/opendss-diagram-builder");
    return buildOpenDssDiagram(parseOpenDss(text) as any);
  },
  gridlabd: async (text) => {
    const { parseGridlabd, projectGridlabdToOpenDss } = await import("@modelscript/gridlabd");
    const { parseOpenDss } = await import("@modelscript/opendss");
    const { buildOpenDssDiagram } = await import("@modelscript/diagram/opendss-diagram-builder");
    const dss = projectGridlabdToOpenDss(parseGridlabd(text));
    return buildOpenDssDiagram(parseOpenDss(dss) as Parameters<typeof buildOpenDssDiagram>[0]);
  },
  cyme: async (text) => {
    const { parseCyme, projectCymeToOpenDss } = await import("@modelscript/cyme");
    const { parseOpenDss } = await import("@modelscript/opendss");
    const { buildOpenDssDiagram } = await import("@modelscript/diagram/opendss-diagram-builder");
    const dss = projectCymeToOpenDss(parseCyme(text));
    return buildOpenDssDiagram(parseOpenDss(dss) as Parameters<typeof buildOpenDssDiagram>[0]);
  },
  powerworld: async (text, params) => {
    const { parsePowerWorldAux, parseIeeeCdf, projectPowerWorldToPsseRaw } = await import("@modelscript/powerworld");
    const { parseRaw, solvePowerFlow } = await import("@modelscript/psse");
    const { buildPsseDiagram } = await import("@modelscript/diagram/psse-diagram-builder");
    const isCdf = params.uri.toLowerCase().endsWith(".cdf") || text.toUpperCase().includes("BUS DATA FOLLOWS");
    const model = isCdf ? parseIeeeCdf(text) : parsePowerWorldAux(text);
    const parsed = parseRaw(projectPowerWorldToPsseRaw(model));
    const pf = parsed.buses.size > 0 ? solvePowerFlow(parsed) : undefined;
    return buildPsseDiagram(
      parsed as Parameters<typeof buildPsseDiagram>[0],
      pf as Parameters<typeof buildPsseDiagram>[1],
    );
  },
  pypsa: async (text) => {
    const [{ buildPypsaDiagramInput }, { buildPsseDiagram }] = await Promise.all([
      import("@modelscript/pypsa"),
      import("@modelscript/diagram/psse-diagram-builder"),
    ]);
    return buildPsseDiagram(await buildPypsaDiagramInput(text));
  },
  openscenario: async (text) => {
    const { parseOpenScenario } = await import("@modelscript/openscenario");
    const { buildOpenScenarioDiagram } = await import("@modelscript/diagram/openscenario-diagram-builder");
    return buildOpenScenarioDiagram(parseOpenScenario(text) as any);
  },
  psse: async (text, params) => {
    const [{ buildPsseDiagramInput }, { buildPsseDiagram }] = await Promise.all([
      import("@modelscript/psse"),
      import("@modelscript/diagram/psse-diagram-builder"),
    ]);
    const { model, powerFlow } = await buildPsseDiagramInput(text, params.uri);
    return buildPsseDiagram(model, powerFlow);
  },
  relap5: async (text) => {
    const { parseRelap5 } = await import("@modelscript/relap5");
    const { buildRelap5Diagram } = await import("@modelscript/diagram/relap5-diagram-builder");
    return buildRelap5Diagram(parseRelap5(text) as any);
  },
  sbml: async (text) => {
    const { parseSbml } = await import("@modelscript/sbml");
    const { buildSbmlDiagram } = await import("@modelscript/diagram/sbml-diagram-builder");
    const doc = parseSbml(text) as any;
    return buildSbmlDiagram(doc.model ?? doc);
  },
  touchstone: async (text) => {
    const { parseTouchstone } = await import("@modelscript/touchstone");
    const { buildTouchstoneDiagram } = await import("@modelscript/diagram/touchstone-diagram-builder");
    const doc = parseTouchstone(text) as any;
    return buildTouchstoneDiagram({ portCount: doc.numPorts ?? doc.portCount ?? 2, ...doc });
  },
  easy5: async (text) => {
    const { parseEasy5 } = await import("@modelscript/easy5");
    const { buildEasy5Diagram } = await import("@modelscript/diagram/easy5-diagram-builder");
    return buildEasy5Diagram(parseEasy5(text));
  },
  rocets: async (text) => {
    const { parseRocetsDeck } = await import("@modelscript/rocets");
    const { buildRocetsDiagram } = await import("@modelscript/diagram/rocets-diagram-builder");
    return buildRocetsDiagram(parseRocetsDeck(text));
  },
  gtsuite: async (text, params) => {
    const { parseGtmModel, buildGtSuiteDiagramData } = await import("@modelscript/gtsuite");
    return buildGtSuiteDiagramData(parseGtmModel(text, params.uri));
  },
  ssp: async (text) => {
    const { parseSsd, buildSspDiagramData } = (await import("@modelscript/ssp")) as any;
    return typeof buildSspDiagramData === "function" ? buildSspDiagramData(parseSsd(text)) : null;
  },
  autosar: async (text) => {
    const { parseArxml } = await import("@modelscript/autosar");
    const { buildAutosarDiagram } = await import("@modelscript/diagram/autosar-diagram-builder");
    return buildAutosarDiagram(parseArxml(text) as never);
  },
  "verilog-a": async (text) => {
    const { parseVerilogA } = await import("@modelscript/verilog-a");
    const { buildVerilogADiagram } = await import("@modelscript/diagram/verilog-a-diagram-builder");
    return buildVerilogADiagram(parseVerilogA(text) as never);
  },
  plcopen: async (text, params) => {
    const { parsePlcopen } = await import("@modelscript/plcopen");
    const { buildPlcopenDiagram } = await import("@modelscript/diagram/plcopen-diagram-builder");
    return buildPlcopenDiagram(parsePlcopen(text, params.uri) as never).diagram;
  },
  oscal: async (text, params) => {
    const { parseOscal } = await import("@modelscript/oscal");
    const { buildOscalDiagram } = await import("@modelscript/diagram/oscal-diagram-builder");
    const doc = parseOscal(text, params.uri);
    return buildOscalDiagram(doc as any);
  },
};

/**
 * Creates a dispatch object that routes diagram requests to the
 * appropriate language backend based on the document URI.
 */
export function createDiagramDispatch(backends: DiagramDispatchDeps) {
  const custom = backends.customBackends ?? new Map<string | RegExp, DiagramBackend>();

  function getBackend(uri: string): DiagramBackend {
    for (const [matcher, backend] of custom.entries()) {
      if (typeof matcher === "string" && uri.endsWith(matcher)) return backend;
      if (matcher instanceof RegExp && matcher.test(uri)) return backend;
    }
    if (uri.endsWith(".raw") || uri.endsWith(".dyr")) {
      return createPsseDiagramBackend(backends);
    }
    if (uri.endsWith(".pscx") || uri.endsWith(".pslx") || uri.endsWith(".pswx") || uri.endsWith(".psmx")) {
      return createPscadDiagramBackend(backends);
    }
    const plugin = globalLanguageRegistry.getPluginForUri(uri);
    if (plugin?.diagramBackend) {
      return plugin.diagramBackend;
    }
    if (uri.endsWith(".sysml") && backends.sysml2) return backends.sysml2;
    if (uri.endsWith(".mo") && backends.modelica) return backends.modelica;
    if (
      backends.owl2 &&
      (uri.endsWith(".owl") ||
        uri.endsWith(".owl2") ||
        uri.endsWith(".ofn") ||
        uri.endsWith(".owx") ||
        uri.endsWith(".ttl"))
    ) {
      return backends.owl2;
    }
    if (uri.endsWith(".ssd") || uri.endsWith(".ssp")) {
      return createSspDiagramBackend(backends);
    }
    if (uri.endsWith(".slx") || uri.endsWith(".mdl")) {
      return backends.simulink ?? createSimulinkDiagramBackend(backends);
    }
    if (uri.endsWith(".cir") || uri.endsWith(".sp") || uri.endsWith(".spice")) {
      return backends.spice ?? createSpiceDiagramBackend(backends);
    }
    if (uri.endsWith(".xodr") || uri.endsWith(".opendrive")) {
      return backends.opendrive ?? createOpenDriveDiagramBackend(backends);
    }
    const readKinematicSource = async (targetUri: string): Promise<string | null> => {
      const memText =
        (backends.generic as any)?.deps?.getDocumentText?.(targetUri) ??
        (backends.modelica as any)?.deps?.getDocumentText?.(targetUri);
      if (typeof memText === "string") return memText;
      try {
        const fs = await import("node:fs");
        const { fileURLToPath } = await import("node:url");
        const filePath = targetUri.startsWith("file://") ? fileURLToPath(targetUri) : targetUri;
        return await fs.promises.readFile(filePath, "utf-8");
      } catch {
        // ignore fs errors
      }
      return null;
    };

    const formatKinematicDiagramData = async (rawDiagram: any, targetUri: string): Promise<DiagramData> => {
      const cells = Array.isArray(rawDiagram?.cells) ? rawDiagram.cells : [];
      const nodes = Array.isArray(rawDiagram?.nodes) ? rawDiagram.nodes : cells.filter((c: any) => c.shape !== "edge");
      const edges = Array.isArray(rawDiagram?.edges) ? rawDiagram.edges : cells.filter((c: any) => c.shape === "edge");

      // Merge any persisted sidecar layout positions so drag/move edits persist
      try {
        const storage = (backends.generic as any)?.getLayoutStorage?.(targetUri);
        const layout = storage ? await storage.loadLayout(targetUri) : null;
        if (layout?.elements) {
          for (const node of nodes) {
            const nodeName = (node as any).name || node.label || node.id;
            const el = layout.elements[node.id] || (nodeName && layout.elements[nodeName]);
            if (el) {
              node.x = el.x;
              node.y = el.y;
              if (node.position) {
                node.position.x = el.x;
                node.position.y = el.y;
              }
              if (el.width) node.width = el.width;
              if (el.height) node.height = el.height;
            }
          }
        }
      } catch {
        // ignore layout storage errors
      }

      return {
        nodes,
        edges,
        coordinateSystem: null,
        diagramBackground: null,
        cells: cells.length > 0 ? cells : [...nodes, ...edges],
        readOnly: true,
        metadata: {
          ...rawDiagram?.metadata,
          readOnly: true,
          layoutEditable: Boolean(backends.generic),
        },
      } as any;
    };

    const domainBackendCache = new Map<string, DiagramBackend>();

    const createDomainBuilderBackend = (
      buildFn: (text: string, params: DiagramGetDataParams) => Promise<any>,
      domainName?: string,
    ): DiagramBackend => ({
      async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
        try {
          const text = await readKinematicSource(params.uri);
          if (!text) return null;
          const rawDiagram = await buildFn(text, params);
          if (rawDiagram) {
            const formatted = await formatKinematicDiagramData(rawDiagram, params.uri);
            if (formatted.nodes && formatted.nodes.length > 0) {
              return formatted;
            }
          }
        } catch (err) {
          console.error(`[Diagram] Error building diagram for ${params.uri} (${domainName ?? "domain"}):`, err);
          return {
            nodes: [],
            edges: [],
            coordinateSystem: null,
            diagramBackground: null,
            readOnly: true,
            metadata: {
              error: err instanceof Error ? err.message : String(err),
              readOnly: true,
              domain: domainName,
            },
          } as any;
        }
        return {
          nodes: [],
          edges: [],
          coordinateSystem: null,
          diagramBackground: null,
          readOnly: true,
          metadata: {
            readOnly: true,
            domain: domainName,
          },
        } as any;
      },
      async getComponentProperties(params: DiagramGetComponentPropertiesParams): Promise<ComponentPropertyData | null> {
        return backends.generic ? await backends.generic.getComponentProperties(params) : null;
      },
      async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
        const hasMutations = Boolean(
          (
            backends.generic as { deps?: { getDiagramConfig?: (u: string) => { mutations?: unknown } } } | undefined
          )?.deps?.getDiagramConfig?.(params.uri)?.mutations,
        );
        if (hasMutations && backends.generic) {
          return await backends.generic.applyEdits(params);
        }
        const spatialActions = params.actions.filter(
          (a) => a.type === "move" || a.type === "resize" || a.type === "rotate" || a.type === "moveEdge",
        );
        if (spatialActions.length < params.actions.length) {
          console.warn(
            `[Diagram] Cannot apply structural edits: ${domainName ?? "domain"} diagram for ${params.uri} only supports layout persistence.`,
          );
        }
        if (spatialActions.length > 0 && backends.generic) {
          const genericRes = await backends.generic.applyEdits({ ...params, actions: spatialActions });
          return {
            seq: params.seq,
            edits: genericRes?.edits ?? [],
            sidecarContent: genericRes?.sidecarContent,
            renderHint: genericRes?.renderHint ?? "none",
          };
        }
        return { seq: params.seq, edits: [], renderHint: "none" };
      },
    });

    const pluginId = plugin?.id?.toLowerCase() || (/\.oscal(\.(json|ya?ml|xml))?$/i.test(uri) ? "oscal" : undefined);
    if (pluginId) {
      if ((backends as Record<string, unknown>)[pluginId]) {
        return (backends as Record<string, unknown>)[pluginId] as DiagramBackend;
      }
      const pluginBuilder = plugin?.customHandlers?.buildDiagram;
      const builder = pluginBuilder
        ? (text: string, params: DiagramGetDataParams) => Promise.resolve(pluginBuilder(text, params))
        : DOMAIN_BUILDERS[pluginId];
      if (builder) {
        let cached = domainBackendCache.get(pluginId);
        if (!cached) {
          cached = createDomainBuilderBackend(builder, pluginId);
          domainBackendCache.set(pluginId, cached);
        }
        return cached;
      }
    }

    return backends.generic ?? backends.modelica ?? (backends.sysml2 as any);
  }

  return {
    getBackend,
    registerBackend(matcher: string | RegExp, backend: DiagramBackend) {
      custom.set(matcher, backend);
    },

    async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
      return await getBackend(params.uri).getData(params);
    },

    async getComponentProperties(params: DiagramGetComponentPropertiesParams): Promise<ComponentPropertyData | null> {
      return await getBackend(params.uri).getComponentProperties(params);
    },

    async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
      // Expand high-level `pasteSubgraph` actions into atomic `addComponent` + `connect` actions
      // so every language backend gets topology-preserving copy/paste automatically.
      const expandedActions: DiagramApplyEditsParams["actions"] = [];
      let pasteCounter = Date.now() % 10000;
      for (const action of params.actions) {
        if (action.type === "pasteSubgraph") {
          const generatedNames: string[] = [];
          for (const node of action.nodes) {
            const shortType = (node.className.split(".").pop() || "comp").replace(/[^A-Za-z0-9_]/g, "");
            const base = shortType.charAt(0).toLowerCase() + shortType.slice(1);
            const genName = `${base}_${++pasteCounter}`;
            generatedNames.push(genName);
            expandedActions.push({
              type: "addComponent",
              className: node.className,
              name: genName,
              x: node.x,
              y: node.y,
              rotation: node.rotation,
              parameters: node.parameters,
            });
          }
          for (const edge of action.edges) {
            const srcName = generatedNames[edge.sourceIdx];
            const tgtName = generatedNames[edge.targetIdx];
            if (!srcName || !tgtName) continue;
            expandedActions.push({
              type: "connect",
              source: edge.sourcePort ? `${srcName}.${edge.sourcePort}` : srcName,
              target: edge.targetPort ? `${tgtName}.${edge.targetPort}` : tgtName,
              sourcePort: edge.sourcePort,
              targetPort: edge.targetPort,
            });
          }
        } else {
          expandedActions.push(action);
        }
      }
      return await getBackend(params.uri).applyEdits({ ...params, actions: expandedActions });
    },

    async getPalette(params: DiagramGetPaletteParams): Promise<DiagramPalette | null> {
      const backend = getBackend(params.uri);
      return backend.getPalette ? await backend.getPalette(params) : null;
    },

    async drillDown(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> {
      const backend = getBackend(params.uri);
      return backend.drillDown ? await backend.drillDown(params) : null;
    },

    supports(uri: string): boolean {
      for (const matcher of custom.keys()) {
        if (typeof matcher === "string" ? uri.includes(matcher) : matcher.test(uri)) {
          return true;
        }
      }
      const plugin = globalLanguageRegistry.getPluginForUri(uri);
      const pluginId = plugin?.id?.toLowerCase() || (/\.oscal(\.(json|ya?ml|xml))?$/i.test(uri) ? "oscal" : undefined);
      if (pluginId) {
        if ((backends as Record<string, unknown>)[pluginId]) return true;
        if (plugin?.customHandlers?.buildDiagram || DOMAIN_BUILDERS[pluginId]) return true;
      }
      if (uri.endsWith(".mo") || pluginId === "modelica") return true;
      if (uri.endsWith(".sysml") || pluginId === "sysml2") return true;
      if (uri.endsWith(".owl") || uri.endsWith(".ofn") || uri.endsWith(".owx") || pluginId === "owl2") {
        return true;
      }
      if (/\.scad($|\?|#)/i.test(uri) || plugin?.id === "scad") return true;
      if (/\.(f|for|f77|f90|f95|f03|f08)($|\?|#)/i.test(uri) || plugin?.id === "fortran") return true;
      if (plugin?.customHandlers?.symbols) return true;
      const config = (backends.generic as any)?.deps?.getDiagramConfig?.(uri);
      if (config) return true;
      return false;
    },
  };
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

function emitInlinePlacementEdit(
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

function replaceBalancedBracesField(text: string, fieldName: string, newInner: string): string {
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
