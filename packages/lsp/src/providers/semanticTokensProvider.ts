// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Connection,
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokensLegend,
  TextDocuments,
} from "vscode-languageserver";

import { parseCfdConfig } from "@modelscript/cfd";
import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";
import { parseFeaDeck } from "@modelscript/fea";
import { tokenizeFortran } from "@modelscript/fortran/ast";
import { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import type { CstNodeLike, CstParserLike, CstTreeLike } from "../utils/ast-utils.js";

const DEFAULT_TYPE_KEYWORDS = ["Real", "Integer", "Boolean", "String", "Natural"];

const tokenTypes = [
  "keyword",
  "type",
  "class",
  "variable",
  "parameter",
  "function",
  "string",
  "number",
  "operator",
  "comment",
  "namespace",
  "enumMember",
];

const tokenModifiers = ["declaration", "readonly"];

const TOKEN_TYPE_INDEX = new Map<string, number>(tokenTypes.map((t, i) => [t, i]));

const legend: SemanticTokensLegend = { tokenTypes, tokenModifiers };

export { legend };

interface RawSemanticToken {
  line: number;
  char: number;
  length: number;
  typeIndex: number;
  modifier: number;
}

/**
 * Maps flat UTF-16 character offsets to zero-based `(line, char)` coordinates
 * without duplicating per-handler line splitting.
 */
class LineIndex {
  private readonly lineStarts: number[];
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
    this.lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        this.lineStarts.push(i + 1);
      }
    }
  }

  public get lineCount(): number {
    return this.lineStarts.length;
  }

  public lineRange(lineIdx: number): { start: number; end: number } {
    const start = this.lineStarts[lineIdx] ?? this.text.length;
    const rawEnd = lineIdx + 1 < this.lineStarts.length ? this.lineStarts[lineIdx + 1]! - 1 : this.text.length;
    const end = rawEnd > start && this.text.charCodeAt(rawEnd - 1) === 13 ? rawEnd - 1 : rawEnd;
    return { start, end };
  }

  public positionAt(offset: number): { line: number; char: number } {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const start = this.lineStarts[mid]!;
      if (start <= clamped) {
        if (mid + 1 >= this.lineStarts.length || this.lineStarts[mid + 1]! > clamped) {
          return { line: mid, char: clamped - start };
        }
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return { line: 0, char: clamped };
  }
}

/**
 * Shared token buffer handling deduplication, sorting, overlap prevention, and multi-line emission.
 */
class TokenCollector {
  private readonly rawTokens: RawSemanticToken[] = [];
  private readonly seenPositions = new Set<string>();

  public push(line: number, char: number, length: number, typeName: string, modifier = 0): void {
    if (length <= 0 || line < 0 || char < 0) return;
    const typeIndex = TOKEN_TYPE_INDEX.get(typeName);
    if (typeIndex === undefined) return;
    const key = `${line}:${char}`;
    if (this.seenPositions.has(key)) return;
    this.seenPositions.add(key);
    this.rawTokens.push({ line, char, length, typeIndex, modifier });
  }

  public pushNode(node: CstNodeLike | null | undefined, typeName: string, modifier = 0): void {
    const start = node?.startPosition;
    const end = node?.endPosition;
    if (!start || !end) return;
    if (start.row === end.row) {
      this.push(start.row, start.column, end.column - start.column, typeName, modifier);
      return;
    }
    const text = String(node.text ?? "");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i]!;
      const len = rawLine.endsWith("\r") ? rawLine.length - 1 : rawLine.length;
      if (len > 0) {
        this.push(start.row + i, i === 0 ? start.column : 0, len, typeName, modifier);
      }
    }
  }

  public pushOffsetSpan(
    _text: string,
    lineIndex: LineIndex,
    startOffset: number,
    endOffset: number,
    typeName: string,
    modifier = 0,
  ): void {
    if (endOffset <= startOffset) return;
    const startPos = lineIndex.positionAt(startOffset);
    const endPos = lineIndex.positionAt(endOffset);
    if (startPos.line === endPos.line) {
      this.push(startPos.line, startPos.char, endPos.char - startPos.char, typeName, modifier);
      return;
    }
    for (let line = startPos.line; line <= endPos.line; line++) {
      const range = lineIndex.lineRange(line);
      const segStart = line === startPos.line ? startOffset : range.start;
      const segEnd = line === endPos.line ? Math.min(endOffset, range.end) : range.end;
      const len = segEnd - segStart;
      if (len > 0) {
        this.push(line, segStart - range.start, len, typeName, modifier);
      }
    }
  }

  public flushTo(builder: SemanticTokensBuilder): SemanticTokens {
    this.rawTokens.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.char - b.char));
    let lastLine = -1;
    let lastEndChar = -1;
    for (const token of this.rawTokens) {
      if (token.line > lastLine || token.char >= lastEndChar) {
        lastLine = token.line;
        lastEndChar = token.char + token.length;
        builder.push(token.line, token.char, token.length, token.typeIndex, token.modifier);
      }
    }
    return builder.build();
  }
}

function getChildren(node: CstNodeLike | null | undefined): readonly CstNodeLike[] {
  if (!node) return [];
  if (Array.isArray(node.children) && node.children.length > 0) {
    return node.children;
  }
  const count = node.childCount ?? 0;
  if (count <= 0 || typeof node.child !== "function") return [];
  const res: CstNodeLike[] = [];
  for (let i = 0; i < count; i++) {
    const c = node.child(i);
    if (c) res.push(c);
  }
  return res;
}

/**
 * Walks CST leaves in source order and invokes `emitGap` on every skipped `extras` gap
 * `[prevEndIndex, nextStartIndex)` so comments outside AST child nodes are classified
 * without ever scanning inside string literal or identifier leaves.
 */
function collectCstGapComments(
  rootNode: CstNodeLike,
  text: string,
  lineIndex: LineIndex,
  collector: TokenCollector,
  emitGap: (text: string, gapStart: number, gapEnd: number, lineIndex: LineIndex, collector: TokenCollector) => void,
): void {
  let cursor = 0;
  const visitLeaves = (node: CstNodeLike): void => {
    const children = getChildren(node);
    if (children.length === 0) {
      const start = typeof node.startIndex === "number" ? node.startIndex : cursor;
      const end = typeof node.endIndex === "number" ? node.endIndex : start;
      if (start > cursor) {
        emitGap(text, cursor, start, lineIndex, collector);
      }
      if (end > cursor) cursor = end;
      return;
    }
    for (const child of children) {
      visitLeaves(child);
    }
  };
  visitLeaves(rootNode);
  if (cursor < text.length) {
    emitGap(text, cursor, text.length, lineIndex, collector);
  }
}

function isIdentStart(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95;
}

function isIdentPart(ch: number): boolean {
  return isIdentStart(ch) || (ch >= 48 && ch <= 57);
}

function isDigit(ch: number): boolean {
  return ch >= 48 && ch <= 57;
}

function readNumberEnd(text: string, start: number, limit: number): number {
  let i = start;
  if (i < limit && (text[i] === "+" || text[i] === "-")) i++;
  let sawDigit = false;
  while (i < limit && isDigit(text.charCodeAt(i))) {
    sawDigit = true;
    i++;
  }
  if (i < limit && text[i] === ".") {
    const nextIsDigit = i + 1 < limit && isDigit(text.charCodeAt(i + 1));
    if (sawDigit || nextIsDigit) {
      i++;
      while (i < limit && isDigit(text.charCodeAt(i))) {
        sawDigit = true;
        i++;
      }
    }
  }
  if (!sawDigit) return -1;
  if (i < limit && (text[i] === "e" || text[i] === "E" || text[i] === "d" || text[i] === "D")) {
    let exp = i + 1;
    if (exp < limit && (text[exp] === "+" || text[exp] === "-")) exp++;
    if (exp < limit && isDigit(text.charCodeAt(exp))) {
      i = exp + 1;
      while (i < limit && isDigit(text.charCodeAt(i))) i++;
    }
  }
  return i;
}

function emitGapBlockComments(
  text: string,
  gapStart: number,
  gapEnd: number,
  lineIndex: LineIndex,
  collector: TokenCollector,
): void {
  let i = gapStart;
  while (i + 1 < gapEnd) {
    if (text[i] === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      const end = close !== -1 && close + 2 <= gapEnd ? close + 2 : gapEnd;
      collector.pushOffsetSpan(text, lineIndex, i, end, "comment");
      i = end;
    } else {
      i++;
    }
  }
}

function emitGapLineComments(
  markers: readonly string[],
  text: string,
  gapStart: number,
  gapEnd: number,
  lineIndex: LineIndex,
  collector: TokenCollector,
): void {
  let i = gapStart;
  while (i < gapEnd) {
    let matched = false;
    for (const marker of markers) {
      if (text.startsWith(marker, i) && i + marker.length <= gapEnd) {
        if (marker === "!" && text[i + 1] === "=") continue;
        let lineEnd = text.indexOf("\n", i);
        if (lineEnd === -1 || lineEnd > gapEnd) lineEnd = gapEnd;
        if (lineEnd > i && text.charCodeAt(lineEnd - 1) === 13) lineEnd--;
        collector.pushOffsetSpan(text, lineIndex, i, lineEnd, "comment");
        i = lineEnd + 1;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
}

// ---------------------------------------------------------------------------
// STEP (ISO-10303-21)
// ---------------------------------------------------------------------------

const STEP_SECTION_KEYWORDS = new Set(["ISO-10303-21", "HEADER", "DATA", "ENDSEC", "END-ISO-10303-21"]);

function isStepTree(tree: CstTreeLike | null | undefined): boolean {
  const rootType = tree?.rootNode?.type;
  return rootType === "StepFile" || rootType === "HeaderSection" || rootType === "DataSection";
}

function scanStepSpan(text: string, start: number, end: number, lineIndex: LineIndex, collector: TokenCollector): void {
  let i = start;
  while (i < end) {
    const ch = text[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      const commentEnd = close !== -1 && close + 2 <= end ? close + 2 : end;
      collector.pushOffsetSpan(text, lineIndex, i, commentEnd, "comment");
      i = commentEnd;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < end) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      collector.pushOffsetSpan(text, lineIndex, i, j, "string");
      i = j;
      continue;
    }
    if (ch === "#") {
      let j = i + 1;
      while (j < end && isDigit(text.charCodeAt(j))) j++;
      if (j > i + 1) {
        collector.pushOffsetSpan(text, lineIndex, i, j, "variable");
        i = j;
        continue;
      }
    }
    if (ch === "." && i + 1 < end && text.charCodeAt(i + 1) >= 65 && text.charCodeAt(i + 1) <= 90) {
      let j = i + 2;
      while (
        j < end &&
        ((text.charCodeAt(j) >= 65 && text.charCodeAt(j) <= 90) || isDigit(text.charCodeAt(j)) || text[j] === "_")
      ) {
        j++;
      }
      if (j < end && text[j] === ".") {
        collector.pushOffsetSpan(text, lineIndex, i, j + 1, "enumMember");
        i = j + 1;
        continue;
      }
    }
    const numEnd = readNumberEnd(text, i, end);
    if (numEnd > i) {
      collector.pushOffsetSpan(text, lineIndex, i, numEnd, "number");
      i = numEnd;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      let j = i + 1;
      while (
        j < end &&
        ((text.charCodeAt(j) >= 65 && text.charCodeAt(j) <= 90) ||
          isDigit(text.charCodeAt(j)) ||
          text[j] === "_" ||
          text[j] === "-")
      ) {
        j++;
      }
      const word = text.slice(i, j);
      if (STEP_SECTION_KEYWORDS.has(word)) {
        collector.pushOffsetSpan(text, lineIndex, i, j, "keyword");
        i = j;
        continue;
      }
      // STEP entity keywords are uppercase [A-Z][A-Z0-9_]* (without '-')
      const dashIdx = word.indexOf("-");
      const entityEnd = dashIdx !== -1 ? i + dashIdx : j;
      const entityWord = text.slice(i, entityEnd);
      if (entityWord.length >= 3 && !entityWord.includes("-")) {
        collector.pushOffsetSpan(text, lineIndex, i, entityEnd, "type");
      }
      i = Math.max(entityEnd, i + 1);
      continue;
    }
    i++;
  }
}

const MAX_STEP_SEMANTIC_CHARS = 262_144;

function computeStepSemanticTokens(
  builder: SemanticTokensBuilder,
  text: string,
  tree?: CstTreeLike | null,
): SemanticTokens {
  const collector = new TokenCollector();
  if (text.length > MAX_STEP_SEMANTIC_CHARS) {
    const slice = text.slice(0, MAX_STEP_SEMANTIC_CHARS);
    const sliceLineIndex = new LineIndex(slice);
    scanStepSpan(slice, 0, slice.length, sliceLineIndex, collector);
    return collector.flushTo(builder);
  }
  const lineIndex = new LineIndex(text);

  if (tree?.rootNode && isStepTree(tree)) {
    const visit = (node: CstNodeLike | null | undefined): void => {
      if (!node) return;
      if (node.type === "ERROR" || node.isError) {
        if (typeof node.startIndex === "number" && typeof node.endIndex === "number") {
          scanStepSpan(text, node.startIndex, node.endIndex, lineIndex, collector);
        }
        return;
      }
      const nodeText = String(node.text ?? "");
      if (node.type === "BLOCK_COMMENT" || node.type === "block_comment") {
        collector.pushNode(node, "comment");
        return;
      }
      if (node.type === "STRING") {
        collector.pushNode(node, "string");
        return;
      }
      if (node.type === "ENTITY_INSTANCE_NAME") {
        collector.pushNode(node, "variable");
        return;
      }
      if (node.type === "ENUMERATION") {
        collector.pushNode(node, "enumMember");
        return;
      }
      if (node.type === "INTEGER" || node.type === "REAL") {
        collector.pushNode(node, "number");
        return;
      }
      if (node.type === "KEYWORD") {
        collector.pushNode(node, STEP_SECTION_KEYWORDS.has(nodeText) ? "keyword" : "type");
        return;
      }
      const children = getChildren(node);
      if (children.length === 0) {
        const trimmed = nodeText.endsWith(";") ? nodeText.slice(0, -1) : nodeText;
        if (STEP_SECTION_KEYWORDS.has(trimmed) && node.startPosition) {
          collector.push(node.startPosition.row, node.startPosition.column, trimmed.length, "keyword");
        }
        return;
      }
      for (const child of children) {
        visit(child);
      }
    };

    visit(tree.rootNode);
    collectCstGapComments(tree.rootNode, text, lineIndex, collector, emitGapBlockComments);
    return collector.flushTo(builder);
  }

  scanStepSpan(text, 0, text.length, lineIndex, collector);
  return collector.flushTo(builder);
}

// ---------------------------------------------------------------------------
// CFD (SU2 & OpenFOAM)
// ---------------------------------------------------------------------------

const CFD_KNOWN_CONSTANTS = new Set([
  "INC_RANS",
  "RANS",
  "EULER",
  "NAVIER_STOKES",
  "SST",
  "SPALART_ALLMARAS",
  "DIRECT",
  "ADJOINT",
  "CONSTANT",
  "CONSTANT_VISCOSITY",
  "SUTHERLAND",
  "RMS_PRESSURE",
  "RMS_DENSITY",
  "RMS_ENERGY",
  "DRAG",
  "LIFT",
  "YES",
  "NO",
  "TRUE",
  "FALSE",
]);

function isOpenFoamDocument(text: string, uri?: string): boolean {
  if (uri && /\.(foam)($|\?|#)/i.test(uri)) return true;
  if (text.includes("FoamFile") || (text.includes("{") && text.includes(";"))) {
    try {
      return parseCfdConfig(text, "openfoam").dialect === "openfoam";
    } catch {
      return false;
    }
  }
  return false;
}

function isCfdCstTree(tree: any): boolean {
  const root = tree?.rootNode;
  if (!root || root.type !== "SourceFile") return false;
  return getChildren(root).some(
    (c) => c.type === "Directive" || c.type === "CommentLine" || c.type === "TupleValue" || c.type === "ScalarValue",
  );
}

function scanCfdLineRange(
  text: string,
  start: number,
  end: number,
  lineIndex: LineIndex,
  collector: TokenCollector,
  isOpenFoam: boolean,
): void {
  let i = start;
  let seenDirectiveKey = false;
  let afterEquals = false;

  while (i < end) {
    const ch = text[i]!;
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      seenDirectiveKey = false;
      afterEquals = false;
      i++;
      continue;
    }
    if (ch === "%" || ch === "#" || (ch === "/" && text[i + 1] === "/")) {
      let lineEnd = text.indexOf("\n", i);
      if (lineEnd === -1 || lineEnd > end) lineEnd = end;
      if (lineEnd > i && text.charCodeAt(lineEnd - 1) === 13) lineEnd--;
      collector.pushOffsetSpan(text, lineIndex, i, lineEnd, "comment");
      i = lineEnd;
      continue;
    }
    if (isOpenFoam && ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      const commentEnd = close !== -1 && close + 2 <= end ? close + 2 : end;
      collector.pushOffsetSpan(text, lineIndex, i, commentEnd, "comment");
      i = commentEnd;
      continue;
    }
    if (ch === "{" && text[i + 1] === "{") {
      const close = text.indexOf("}}", i + 2);
      if (close !== -1 && close + 2 <= end) {
        collector.pushOffsetSpan(text, lineIndex, i, close + 2, "variable");
        i = close + 2;
        continue;
      }
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < end) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === ch) {
          j++;
          break;
        }
        if (text[j] === "\n") break;
        j++;
      }
      collector.pushOffsetSpan(text, lineIndex, i, j, "string");
      i = j;
      continue;
    }
    if (ch === "=") {
      collector.pushOffsetSpan(text, lineIndex, i, i + 1, "operator");
      afterEquals = true;
      i++;
      continue;
    }
    if (",()+-*/^;{}".includes(ch)) {
      if (ch === ";" || ch === "{" || ch === "}") {
        seenDirectiveKey = false;
        afterEquals = false;
      }
      collector.pushOffsetSpan(text, lineIndex, i, i + 1, "operator");
      i++;
      continue;
    }
    const numEnd = readNumberEnd(text, i, end);
    if (numEnd > i) {
      collector.pushOffsetSpan(text, lineIndex, i, numEnd, "number");
      i = numEnd;
      continue;
    }
    if (isIdentStart(ch.charCodeAt(0))) {
      let j = i + 1;
      while (j < end && (isIdentPart(text.charCodeAt(j)) || (isOpenFoam && text[j] === "-"))) j++;
      const word = text.slice(i, j);
      let typeName = "keyword";
      if (!afterEquals && !seenDirectiveKey) {
        typeName = "keyword";
        seenDirectiveKey = true;
      } else if (CFD_KNOWN_CONSTANTS.has(word.toUpperCase())) {
        typeName = "type";
      } else if (afterEquals || seenDirectiveKey) {
        typeName = "parameter";
      }
      collector.pushOffsetSpan(text, lineIndex, i, j, typeName);
      i = j;
      continue;
    }
    i++;
  }
}

function computeCfdSemanticTokens(
  builder: SemanticTokensBuilder,
  text: string,
  tree?: CstTreeLike | null,
  uri?: string,
): SemanticTokens {
  const collector = new TokenCollector();
  const lineIndex = new LineIndex(text);
  const openFoam = isOpenFoamDocument(text, uri);

  if (!openFoam && tree?.rootNode && isCfdCstTree(tree)) {
    const visit = (node: CstNodeLike | null | undefined, inDirectiveValue = false): void => {
      if (!node) return;
      if (node.type === "ERROR" || node.isError) {
        if (typeof node.startIndex === "number" && typeof node.endIndex === "number") {
          scanCfdLineRange(text, node.startIndex, node.endIndex, lineIndex, collector, false);
        }
        return;
      }
      if (node.type === "CommentLine") {
        collector.pushNode(node, "comment");
        return;
      }
      if (node.type === "EmbeddedExpression") {
        collector.pushNode(node, "variable");
        return;
      }
      if (node.type === "STRING") {
        collector.pushNode(node, "string");
        return;
      }
      if (node.type === "NUMBER") {
        collector.pushNode(node, "number");
        return;
      }
      if (node.type === "Directive") {
        let sawEquals = false;
        for (const child of getChildren(node)) {
          if (child.text === "=") {
            collector.pushNode(child, "operator");
            sawEquals = true;
          } else if (child.type === "IDENTIFIER" && !sawEquals) {
            collector.pushNode(child, "keyword");
          } else {
            visit(child, sawEquals);
          }
        }
        return;
      }
      if (node.type === "IDENTIFIER") {
        const up = String(node.text ?? "").toUpperCase();
        if (CFD_KNOWN_CONSTANTS.has(up)) {
          collector.pushNode(node, "type");
        } else {
          collector.pushNode(node, inDirectiveValue ? "parameter" : "keyword");
        }
        return;
      }
      const children = getChildren(node);
      if (children.length === 0) {
        if ("=,()+-*/^".includes(String(node.text ?? ""))) {
          collector.pushNode(node, "operator");
        }
        return;
      }
      for (const child of children) {
        visit(child, inDirectiveValue || node.type === "TupleValue" || node.type === "ScalarValue");
      }
    };

    visit(tree.rootNode, false);
    collectCstGapComments(tree.rootNode, text, lineIndex, collector, (src, gs, ge, li, col) =>
      emitGapLineComments(["%", "//", "#"], src, gs, ge, li, col),
    );
    return collector.flushTo(builder);
  }

  // Fallback for OpenFOAM dictionaries or cold start without WASM CST
  try {
    parseCfdConfig(text, openFoam ? "openfoam" : "su2");
  } catch {
    // Ignore partial parse errors while editing
  }
  scanCfdLineRange(text, 0, text.length, lineIndex, collector, openFoam);
  return collector.flushTo(builder);
}

// ---------------------------------------------------------------------------
// FEA (Abaqus/CalculiX .inp & NASTRAN .bdf)
// ---------------------------------------------------------------------------

const FEA_KNOWN_CONSTANTS = new Set([
  "C3D8",
  "C3D8R",
  "C3D20",
  "C3D20R",
  "C3D4",
  "C3D10",
  "C3D6",
  "S4",
  "S4R",
  "S3",
  "B31",
  "B32",
  "T3D2",
  "STATIC",
  "DYNAMIC",
  "FREQUENCY",
  "BUCKLE",
  "MODAL",
  "ISOTROPIC",
]);

function isBdfDocument(text: string, uri?: string): boolean {
  if (uri && /\.(bdf|dat)($|\?|#)/i.test(uri)) return true;
  let hasDollarCard = false;
  let hasStarCard = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("$")) {
      hasDollarCard = true;
    } else if (trimmed.startsWith("*") && trimmed.length > 1) {
      const c = trimmed.charCodeAt(1);
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
        hasStarCard = true;
        break;
      }
    }
  }
  return hasDollarCard && !hasStarCard;
}

function isFeaCstTree(tree: any): boolean {
  const root = tree?.rootNode;
  if (!root || root.type !== "SourceFile") return false;
  return getChildren(root).some((c) => c.type === "KeywordCard" || c.type === "DataLine" || c.type === "CommentLine");
}

function scanFeaRange(text: string, start: number, end: number, lineIndex: LineIndex, collector: TokenCollector): void {
  let i = start;
  while (i < end) {
    const pos = lineIndex.positionAt(i);
    const range = lineIndex.lineRange(pos.line);
    const lineStart = Math.max(start, range.start);
    const lineEnd = Math.min(end, range.end);
    const raw = text.slice(lineStart, lineEnd);
    const trimmed = raw.trimStart();
    if (!trimmed) {
      i = range.end + 1;
      continue;
    }
    const trimColOffset = lineStart + (raw.length - trimmed.length);
    if (trimmed.startsWith("**") || trimmed.startsWith("$") || trimmed.startsWith("#")) {
      collector.pushOffsetSpan(text, lineIndex, trimColOffset, lineEnd, "comment");
      i = range.end + 1;
      continue;
    }

    const isKeywordLine = trimmed.startsWith("*");
    let c = trimColOffset;
    let firstStarCard = isKeywordLine;

    while (c < lineEnd) {
      const ch = text[c]!;
      if (ch === " " || ch === "\t") {
        c++;
        continue;
      }
      if (ch === "$" || text.startsWith("**", c) || ch === "#") {
        collector.pushOffsetSpan(text, lineIndex, c, lineEnd, "comment");
        break;
      }
      if (firstStarCard && ch === "*") {
        let j = c + 1;
        while (j < lineEnd && (isIdentPart(text.charCodeAt(j)) || text[j] === " ")) {
          if (text[j] === " ") {
            let look = j + 1;
            while (look < lineEnd && text[look] === " ") look++;
            if (look >= lineEnd || !isIdentStart(text.charCodeAt(look))) break;
          }
          j++;
        }
        while (j > c + 1 && text[j - 1] === " ") j--;
        collector.pushOffsetSpan(text, lineIndex, c, j, "keyword");
        firstStarCard = false;
        c = j;
        continue;
      }
      if (ch === "{" && text[c + 1] === "{") {
        const close = text.indexOf("}}", c + 2);
        if (close !== -1 && close + 2 <= lineEnd) {
          collector.pushOffsetSpan(text, lineIndex, c, close + 2, "variable");
          c = close + 2;
          continue;
        }
      }
      if (ch === '"' || ch === "'") {
        let j = c + 1;
        while (j < lineEnd) {
          if (text[j] === "\\") {
            j += 2;
            continue;
          }
          if (text[j] === ch) {
            j++;
            break;
          }
          j++;
        }
        collector.pushOffsetSpan(text, lineIndex, c, j, "string");
        c = j;
        continue;
      }
      const numEnd = readNumberEnd(text, c, lineEnd);
      if (numEnd > c) {
        collector.pushOffsetSpan(text, lineIndex, c, numEnd, "number");
        c = numEnd;
        continue;
      }
      if ("=,()+-*/^".includes(ch)) {
        collector.pushOffsetSpan(text, lineIndex, c, c + 1, "operator");
        c++;
        continue;
      }
      if (isIdentStart(ch.charCodeAt(0))) {
        let j = c + 1;
        while (j < lineEnd && isIdentPart(text.charCodeAt(j))) j++;
        const word = text.slice(c, j);
        const typeName = FEA_KNOWN_CONSTANTS.has(word.toUpperCase())
          ? "type"
          : isKeywordLine
            ? "parameter"
            : "variable";
        collector.pushOffsetSpan(text, lineIndex, c, j, typeName);
        c = j;
        continue;
      }
      c++;
    }

    i = range.end + 1;
  }
}

function computeFeaSemanticTokens(
  builder: SemanticTokensBuilder,
  text: string,
  tree?: CstTreeLike | null,
  uri?: string,
): SemanticTokens {
  const collector = new TokenCollector();
  const lineIndex = new LineIndex(text);
  const bdf = isBdfDocument(text, uri);

  if (!bdf && tree?.rootNode && isFeaCstTree(tree)) {
    const visit = (node: CstNodeLike | null | undefined, ctx: "root" | "card" | "data" = "root"): void => {
      if (!node) return;
      if (node.type === "ERROR" || node.isError) {
        if (typeof node.startIndex === "number" && typeof node.endIndex === "number") {
          scanFeaRange(text, node.startIndex, node.endIndex, lineIndex, collector);
        }
        return;
      }
      if (node.type === "CommentLine") {
        collector.pushNode(node, "comment");
        return;
      }
      if (node.type === "EmbeddedExpression") {
        collector.pushNode(node, "variable");
        return;
      }
      if (node.type === "STRING") {
        collector.pushNode(node, "string");
        return;
      }
      if (node.type === "NUMBER") {
        collector.pushNode(node, "number");
        return;
      }
      if (node.type === "KeywordCard") {
        const children = getChildren(node);
        const first = children[0];
        const second = children[1];
        if (first?.type === "CARD_HEADER") {
          collector.pushNode(first, "keyword");
          for (let i = 1; i < children.length; i++) {
            visit(children[i], "card");
          }
          return;
        }
        if (
          first?.text === "*" &&
          second?.type === "CARD_NAME" &&
          typeof first.startIndex === "number" &&
          typeof second.endIndex === "number"
        ) {
          collector.pushOffsetSpan(text, lineIndex, first.startIndex, second.endIndex, "keyword");
          for (let i = 2; i < children.length; i++) {
            visit(children[i], "card");
          }
          return;
        }
      }
      if (node.type === "CARD_NAME" || node.type === "CARD_HEADER") {
        collector.pushNode(node, "keyword");
        return;
      }
      if (node.type === "IDENTIFIER") {
        const up = String(node.text ?? "").toUpperCase();
        if (FEA_KNOWN_CONSTANTS.has(up)) {
          collector.pushNode(node, "type");
        } else {
          collector.pushNode(node, ctx === "card" ? "parameter" : "variable");
        }
        return;
      }
      const nextCtx =
        node.type === "ParameterAssignment" || node.type === "OptionFlag"
          ? "card"
          : node.type === "DataLine" || node.type === "DataItem"
            ? "data"
            : ctx;
      const children = getChildren(node);
      if (children.length === 0) {
        if ("=,()+-*/^".includes(String(node.text ?? ""))) {
          collector.pushNode(node, "operator");
        }
        return;
      }
      for (const child of children) {
        visit(child, nextCtx);
      }
    };

    visit(tree.rootNode, "root");
    collectCstGapComments(tree.rootNode, text, lineIndex, collector, (src, gs, ge, li, col) =>
      emitGapLineComments(["**", "$", "#"], src, gs, ge, li, col),
    );
    return collector.flushTo(builder);
  }

  try {
    parseFeaDeck(text, bdf ? "bdf" : "inp");
  } catch {
    // Ignore incomplete deck during live edits
  }
  scanFeaRange(text, 0, text.length, lineIndex, collector);
  return collector.flushTo(builder);
}

// ---------------------------------------------------------------------------
// Fortran (Standard F77/F90/F95/F2008 & EMTDC Extensions)
// ---------------------------------------------------------------------------

const FORTRAN_KEYWORDS = new Set([
  "program",
  "subroutine",
  "function",
  "module",
  "end",
  "endif",
  "enddo",
  "if",
  "then",
  "else",
  "elseif",
  "do",
  "call",
  "return",
  "continue",
  "common",
  "parameter",
  "dimension",
  "implicit",
  "none",
  "intent",
  "in",
  "out",
  "inout",
  "save",
  "allocatable",
  "optional",
  "value",
  "kind",
  "len",
  "contains",
  "use",
  "select",
  "case",
  "default",
  "exit",
  "cycle",
]);

const FORTRAN_TYPES = new Set([
  "real",
  "integer",
  "double",
  "precision",
  "logical",
  "complex",
  "character",
  "storf",
  "stori",
]);

const FORTRAN_INTRINSIC_FUNCS = new Set([
  "sqrt",
  "abs",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "exp",
  "log",
  "log10",
  "min",
  "max",
  "mod",
  "sign",
  "realpole",
  "delay1",
  "intgrl",
  "leadlag",
  "diff",
  "limiter",
  "limit",
  "hardlimit",
  "cmplx_polar",
  "sin_cos",
  "current_source",
  "e_branch",
]);

const FORTRAN_SPECIAL_CONSTANTS = new Set(["time", "delt", "firststep", "nstorf", "nstori"]);

const FORTRAN_LOGICAL_OPS = new Set([".and.", ".or.", ".not.", ".eq.", ".ne.", ".lt.", ".le.", ".gt.", ".ge."]);

const FORTRAN_OPERATORS = new Set([
  "::",
  "**",
  "==",
  "/=",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "=",
  "+",
  "-",
  "*",
  "/",
  "<",
  ">",
]);

function isFortranTree(tree: CstTreeLike | null | undefined): boolean {
  const rootType = tree?.rootNode?.type;
  return Boolean(
    tree?.rootNode &&
    rootType === "SourceFile" &&
    getChildren(tree.rootNode).some((c) => c.type === "ProgramUnit" || c.type === "Statement"),
  );
}

function isFixedFormCommentLine(trimmedLine: string): boolean {
  if (trimmedLine.length < 2) return false;
  const c0 = trimmedLine[0]!;
  if ((c0 === "C" || c0 === "c" || c0 === "*") && (trimmedLine[1] === " " || trimmedLine[1] === "\t")) {
    return !trimmedLine.toLowerCase().startsWith("call ");
  }
  return false;
}

function emitFortranEndCompoundNode(node: CstNodeLike, collector: TokenCollector): void {
  const txt = String(node.text ?? "");
  const startRow = node.startPosition?.row ?? 0;
  const startCol = node.startPosition?.column ?? 0;
  let i = 0;
  let wordIndex = 0;
  while (i < txt.length) {
    while (i < txt.length && (txt[i] === " " || txt[i] === "\t")) i++;
    if (i >= txt.length) break;
    let j = i + 1;
    while (j < txt.length && txt[j] !== " " && txt[j] !== "\t") j++;
    const typeName = wordIndex < 2 ? "keyword" : "function";
    collector.push(startRow, startCol + i, j - i, typeName, 0);
    wordIndex++;
    i = j;
  }
}

function emitFortranLexerSlice(
  text: string,
  line: number,
  lineStart: number,
  segStart: number,
  segEnd: number,
  collector: TokenCollector,
  routineNames: Set<string>,
  paramNames: Set<string>,
): void {
  const sub = text.slice(segStart, segEnd);
  const tokens = tokenizeFortran(sub);
  let cursor = segStart;
  let prevWordLower = "";

  for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
    const tok = tokens[tIdx]!;
    if (!tok.value) continue;
    const found = text.indexOf(tok.value, cursor);
    if (found === -1 || found >= segEnd) continue;
    const tokLen = tok.value.length;
    const col = found - lineStart;
    const lower = tok.value.toLowerCase();

    if (tok.type === "STRING") {
      collector.push(line, col, tokLen, "string");
    } else if (tok.type === "NUMBER") {
      collector.push(line, col, tokLen, "number");
    } else if (tok.type === "OP" || tok.type === "ASSIGN" || FORTRAN_LOGICAL_OPS.has(lower)) {
      collector.push(line, col, tokLen, "operator");
    } else if (tok.value.startsWith("$") || tok.type === "PORT") {
      collector.push(line, col, tokLen, "parameter");
    } else if (tok.value.startsWith("#")) {
      collector.push(line, col, tokLen, "keyword");
    } else if (tok.type === "KEYWORD" || FORTRAN_KEYWORDS.has(lower)) {
      collector.push(line, col, tokLen, "keyword");
      if (lower === "subroutine" || lower === "function" || lower === "program" || lower === "module") {
        const next = tokens[tIdx + 1];
        if (next?.type === "IDENT") routineNames.add(next.value.toLowerCase());
      }
      prevWordLower = lower;
    } else if (FORTRAN_TYPES.has(lower)) {
      collector.push(line, col, tokLen, "type");
      prevWordLower = lower;
    } else if (tok.type === "IDENT") {
      const isDeclHead =
        prevWordLower === "subroutine" ||
        prevWordLower === "function" ||
        prevWordLower === "program" ||
        prevWordLower === "module";
      if (isDeclHead) {
        routineNames.add(lower);
        collector.push(line, col, tokLen, "function", 1);
      } else if (prevWordLower === "call" || routineNames.has(lower) || FORTRAN_INTRINSIC_FUNCS.has(lower)) {
        collector.push(line, col, tokLen, "function");
      } else if (FORTRAN_SPECIAL_CONSTANTS.has(lower)) {
        collector.push(line, col, tokLen, "variable", 2);
      } else if (paramNames.has(lower)) {
        collector.push(line, col, tokLen, "parameter");
      } else {
        collector.push(line, col, tokLen, "variable");
      }
      prevWordLower = lower;
    }
    cursor = found + tokLen;
  }
}

function scanFortranErrorSpan(
  text: string,
  start: number,
  end: number,
  lineIndex: LineIndex,
  collector: TokenCollector,
  routineNames: Set<string>,
  paramNames: Set<string>,
): void {
  const startLine = lineIndex.positionAt(start).line;
  const endLine = lineIndex.positionAt(Math.max(start, end - 1)).line;
  for (let line = startLine; line <= endLine; line++) {
    const range = lineIndex.lineRange(line);
    const rawLine = text.slice(range.start, range.end);
    if (!rawLine.trim()) continue;

    // Column-0 fixed-form Fortran/EMTDC comment line (`C ...` or `* ...`)
    if (start <= range.start && isFixedFormCommentLine(rawLine)) {
      collector.push(line, 0, rawLine.length, "comment");
      continue;
    }

    const segStart = Math.max(start, range.start);
    const segEnd = Math.min(end, range.end);
    emitFortranLexerSlice(text, line, range.start, segStart, segEnd, collector, routineNames, paramNames);
  }
}

function computeFortranSemanticTokens(
  builder: SemanticTokensBuilder,
  text: string,
  tree?: CstTreeLike | null,
): SemanticTokens {
  const collector = new TokenCollector();
  const lineIndex = new LineIndex(text);
  const paramNames = new Set<string>();
  const routineNames = new Set<string>();

  if (tree?.rootNode && isFortranTree(tree)) {
    const hasIntentAttr = (declNode: CstNodeLike): boolean => {
      for (const child of getChildren(declNode)) {
        if (child.type === "AttributeSpec") {
          for (const g of getChildren(child)) {
            if (g.type === "INTENT_KEYWORD") return true;
          }
        }
      }
      return false;
    };

    const collectMetadata = (node: CstNodeLike | null | undefined): void => {
      if (!node) return;
      if (
        node.type === "ProgramDeclaration" ||
        node.type === "SubroutineDeclaration" ||
        node.type === "FunctionDeclaration" ||
        node.type === "ModuleDeclaration"
      ) {
        for (const child of getChildren(node)) {
          if (child.type === "IDENTIFIER") {
            routineNames.add(String(child.text ?? "").toLowerCase());
          } else if (child.type === "ParameterList") {
            for (const p of getChildren(child)) {
              if (p.type === "IDENTIFIER") {
                paramNames.add(String(p.text ?? "").toLowerCase());
              }
            }
          }
        }
      } else if (node.type === "DeclarationStatement" && hasIntentAttr(node)) {
        const collectDeclarators = (n: CstNodeLike): void => {
          if (n.type === "IDENTIFIER") {
            paramNames.add(String(n.text ?? "").toLowerCase());
            return;
          }
          for (const c of getChildren(n)) collectDeclarators(c);
        };
        for (const child of getChildren(node)) {
          if (child.type === "DeclaratorList") collectDeclarators(child);
        }
      }
      for (const child of getChildren(node)) collectMetadata(child);
    };

    collectMetadata(tree.rootNode);

    const visit = (node: CstNodeLike | null | undefined): void => {
      if (!node) return;
      if (node.type === "ERROR" || node.isError) {
        if (typeof node.startIndex === "number" && typeof node.endIndex === "number") {
          scanFortranErrorSpan(text, node.startIndex, node.endIndex, lineIndex, collector, routineNames, paramNames);
        }
        return;
      }

      const nType = node.type;
      const nText = String(node.text ?? "");
      const lower = nText.toLowerCase();

      if (
        nType === "PROGRAM_KEYWORD" ||
        nType === "SUBROUTINE_KEYWORD" ||
        nType === "FUNCTION_KEYWORD" ||
        nType === "MODULE_KEYWORD" ||
        nType === "IMPLICIT_KEYWORD" ||
        nType === "NONE_KEYWORD" ||
        nType === "INTENT_KEYWORD" ||
        nType === "INTENT_SPEC" ||
        nType === "CALL_KEYWORD" ||
        nType === "PARAMETER_KEYWORD"
      ) {
        collector.pushNode(node, "keyword");
        return;
      }
      if (nType === "END_PROGRAM" || nType === "END_SUBROUTINE" || nType === "END_FUNCTION" || nType === "END_MODULE") {
        emitFortranEndCompoundNode(node, collector);
        return;
      }
      if (nType === "TYPE_SPECIFIER") {
        collector.pushNode(node, "type");
        return;
      }
      if (nType === "PORT_IDENTIFIER" || nType === "PortRef") {
        collector.pushNode(node, "parameter");
        return;
      }
      if (nType === "STRING") {
        collector.pushNode(node, "string");
        return;
      }
      if (nType === "NUMBER") {
        collector.pushNode(node, "number");
        return;
      }
      if (nType === "IDENTIFIER") {
        const parentType = node.parent?.type;
        if (
          parentType === "ProgramDeclaration" ||
          parentType === "SubroutineDeclaration" ||
          parentType === "FunctionDeclaration" ||
          parentType === "ModuleDeclaration"
        ) {
          collector.pushNode(node, "function", 1);
          return;
        }
        if (parentType === "CallStatement" || routineNames.has(lower) || FORTRAN_INTRINSIC_FUNCS.has(lower)) {
          collector.pushNode(node, "function", 0);
          return;
        }
        if (parentType === "ParameterList") {
          collector.pushNode(node, "parameter", 0);
          return;
        }
        if (FORTRAN_SPECIAL_CONSTANTS.has(lower)) {
          collector.pushNode(node, "variable", 2);
          return;
        }
        if (paramNames.has(lower)) {
          collector.pushNode(node, "parameter", 0);
          return;
        }
        collector.pushNode(node, "variable", 0);
        return;
      }

      const children = getChildren(node);
      if (children.length === 0) {
        if (FORTRAN_OPERATORS.has(nType) || FORTRAN_LOGICAL_OPS.has(lower)) {
          collector.pushNode(node, "operator");
        } else if (lower === ".true." || lower === ".false." || FORTRAN_KEYWORDS.has(lower)) {
          collector.pushNode(node, "keyword");
        }
        return;
      }
      for (const child of children) {
        visit(child);
      }
    };

    visit(tree.rootNode);
    collectCstGapComments(tree.rootNode, text, lineIndex, collector, (src, gs, ge, li, col) =>
      emitGapLineComments(["!"], src, gs, ge, li, col),
    );
    return collector.flushTo(builder);
  }

  // Fallback using @modelscript/fortran's lexer when WASM CST is unavailable synchronously
  const lineCount = lineIndex.lineCount;
  for (let line = 0; line < lineCount; line++) {
    const range = lineIndex.lineRange(line);
    const rawLine = text.slice(range.start, range.end);
    if (!rawLine.trim()) continue;
    if (isFixedFormCommentLine(rawLine)) {
      collector.push(line, 0, rawLine.length, "comment");
      continue;
    }

    // Separate inline '!' comments outside strings
    let commentStart = -1;
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < rawLine.length; i++) {
      const ch = rawLine[i]!;
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === "!" && !inSingle && !inDouble && rawLine[i + 1] !== "=") {
        commentStart = i;
        break;
      }
    }
    const codeEnd = commentStart >= 0 ? range.start + commentStart : range.end;
    if (commentStart >= 0) {
      collector.push(line, commentStart, rawLine.length - commentStart, "comment");
    }
    emitFortranLexerSlice(text, line, range.start, range.start, codeEnd, collector, routineNames, paramNames);
  }
  return collector.flushTo(builder);
}

// ---------------------------------------------------------------------------
// OWL 2 (Functional-Style Syntax CST, OWL/XML Cst via parseXmlSync, & Turtle)
// ---------------------------------------------------------------------------

const OWL2_KEYWORDS = new Set([
  "Prefix",
  "Ontology",
  "Import",
  "Declaration",
  "Class",
  "Datatype",
  "ObjectProperty",
  "DataProperty",
  "AnnotationProperty",
  "NamedIndividual",
  "Annotation",
  "SubClassOf",
  "EquivalentClasses",
  "DisjointClasses",
  "DisjointUnion",
  "SubObjectPropertyOf",
  "ObjectPropertyChain",
  "EquivalentObjectProperties",
  "DisjointObjectProperties",
  "InverseObjectProperties",
  "ObjectPropertyDomain",
  "ObjectPropertyRange",
  "FunctionalObjectProperty",
  "InverseFunctionalObjectProperty",
  "ReflexiveObjectProperty",
  "IrreflexiveObjectProperty",
  "SymmetricObjectProperty",
  "AsymmetricObjectProperty",
  "TransitiveObjectProperty",
  "SubDataPropertyOf",
  "EquivalentDataProperties",
  "DisjointDataProperties",
  "DataPropertyDomain",
  "DataPropertyRange",
  "FunctionalDataProperty",
  "DatatypeDefinition",
  "HasKey",
  "SameIndividual",
  "DifferentIndividuals",
  "ClassAssertion",
  "ObjectPropertyAssertion",
  "NegativeObjectPropertyAssertion",
  "DataPropertyAssertion",
  "NegativeDataPropertyAssertion",
  "AnnotationAssertion",
  "SubAnnotationPropertyOf",
  "AnnotationPropertyDomain",
  "AnnotationPropertyRange",
  "ObjectIntersectionOf",
  "ObjectUnionOf",
  "ObjectComplementOf",
  "ObjectOneOf",
  "ObjectSomeValuesFrom",
  "ObjectAllValuesFrom",
  "ObjectHasValue",
  "ObjectHasSelf",
  "ObjectMinCardinality",
  "ObjectMaxCardinality",
  "ObjectExactCardinality",
  "ObjectInverseOf",
  "DataIntersectionOf",
  "DataUnionOf",
  "DataComplementOf",
  "DataOneOf",
  "DataSomeValuesFrom",
  "DataAllValuesFrom",
  "DataHasValue",
  "DataMinCardinality",
  "DataMaxCardinality",
  "DataExactCardinality",
  "DatatypeRestriction",
]);

interface Owl2EntityRoles {
  classes: Set<string>;
  properties: Set<string>;
  individuals: Set<string>;
  datatypes: Set<string>;
}

function classifyOwl2Iri(iri: string, roles: Owl2EntityRoles): "type" | "class" | "function" | "enumMember" {
  const colonIdx = iri.indexOf(":");
  const prefix = colonIdx >= 0 ? iri.slice(0, colonIdx) : "";
  const local = colonIdx >= 0 ? iri.slice(colonIdx + 1) : iri;
  if (
    roles.datatypes.has(iri) ||
    prefix === "xsd" ||
    prefix === "rdfs" ||
    prefix === "rdf" ||
    iri === "owl:Thing" ||
    iri === "owl:Nothing"
  ) {
    return "type";
  }
  if (roles.classes.has(iri)) return "class";
  if (roles.properties.has(iri)) return "function";
  if (roles.individuals.has(iri)) return "enumMember";
  if (local.length > 0 && local[0]! >= "A" && local[0]! <= "Z") return "class";
  return "function";
}

function isOwl2CstTree(tree: any): boolean {
  const rootType = tree?.rootNode?.type;
  return rootType === "OntologyDocument" || rootType === "Ontology" || rootType === "PrefixDeclaration";
}

function emitOwl2XmlTokens(text: string, lineIndex: LineIndex, collector: TokenCollector): void {
  // Emit XML comments outside/between elements cleanly
  let c = 0;
  while (c < text.length) {
    const start = text.indexOf("<!--", c);
    if (start === -1) break;
    const endIdx = text.indexOf("-->", start + 4);
    const end = endIdx !== -1 ? endIdx + 3 : text.length;
    collector.pushOffsetSpan(text, lineIndex, start, end, "comment");
    c = end;
  }

  const doc = parseXmlSync(text);
  const visitEl = (el: XmlElement): void => {
    // Open tag name `<Name ...>`
    const openNameStart = el.start + 1;
    const openNameEnd = openNameStart + el.name.length;
    collector.pushOffsetSpan(text, lineIndex, openNameStart, openNameEnd, "keyword");

    for (const attr of el.attributes) {
      collector.pushOffsetSpan(text, lineIndex, attr.start, attr.start + attr.name.length, "parameter");
      collector.pushOffsetSpan(
        text,
        lineIndex,
        Math.max(attr.start, attr.valueStart - 1),
        Math.min(attr.end, attr.valueEnd + 1),
        "string",
      );
    }

    for (const child of el.children) {
      visitEl(child);
    }

    if (!el.selfClosing && el.closeStart >= 0 && el.closeStart + 2 + el.name.length <= el.end) {
      collector.pushOffsetSpan(text, lineIndex, el.closeStart + 2, el.closeStart + 2 + el.name.length, "keyword");
    }
  };
  if (doc.root) visitEl(doc.root);
}

function emitOwl2LiteralLeaf(node: any, text: string, lineIndex: LineIndex, collector: TokenCollector): void {
  const leafText = String(node.text ?? "");
  const startOffset = node.startIndex;
  const caret = leafText.indexOf("^^");
  if (caret !== -1) {
    collector.pushOffsetSpan(text, lineIndex, startOffset, startOffset + caret, "string");
    collector.pushOffsetSpan(text, lineIndex, startOffset + caret, startOffset + caret + 2, "operator");
    collector.pushOffsetSpan(text, lineIndex, startOffset + caret + 2, startOffset + leafText.length, "type");
    return;
  }
  collector.pushNode(node, "string");
}

function scanOwl2FunctionalSpan(
  text: string,
  start: number,
  end: number,
  lineIndex: LineIndex,
  collector: TokenCollector,
  roles: Owl2EntityRoles,
  isDeclContext: boolean,
): void {
  let i = start;
  while (i < end) {
    const ch = text[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "#" || (ch === "/" && text[i + 1] === "/")) {
      let lineEnd = text.indexOf("\n", i);
      if (lineEnd === -1 || lineEnd > end) lineEnd = end;
      if (lineEnd > i && text.charCodeAt(lineEnd - 1) === 13) lineEnd--;
      collector.pushOffsetSpan(text, lineIndex, i, lineEnd, "comment");
      i = lineEnd;
      continue;
    }
    if (ch === "<") {
      const close = text.indexOf(">", i + 1);
      if (close !== -1 && close < end) {
        collector.pushOffsetSpan(text, lineIndex, i, close + 1, "string");
        i = close + 1;
        continue;
      }
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < end) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      collector.pushOffsetSpan(text, lineIndex, i, j, "string");
      i = j;
      continue;
    }
    if (ch === "^" && text[i + 1] === "^") {
      collector.pushOffsetSpan(text, lineIndex, i, i + 2, "operator");
      i += 2;
      continue;
    }
    if (ch === ":") {
      let j = i + 1;
      while (j < end && (isIdentPart(text.charCodeAt(j)) || text[j] === "." || text[j] === "-")) j++;
      if (j > i + 1) {
        const iri = text.slice(i, j);
        const tokenType = classifyOwl2Iri(iri, roles);
        const mod = isDeclContext && tokenType !== "type" ? 1 : 0;
        collector.pushOffsetSpan(text, lineIndex, i, j, tokenType, mod);
        i = j;
        continue;
      }
    }
    const numEnd = readNumberEnd(text, i, end);
    if (numEnd > i) {
      collector.pushOffsetSpan(text, lineIndex, i, numEnd, "number");
      i = numEnd;
      continue;
    }
    if (isIdentStart(ch.charCodeAt(0))) {
      let j = i + 1;
      while (j < end && (isIdentPart(text.charCodeAt(j)) || text[j] === "." || text[j] === "-")) j++;
      if (j < end && text[j] === ":") {
        let k = j + 1;
        while (k < end && (isIdentPart(text.charCodeAt(k)) || text[k] === "." || text[k] === "-")) k++;
        if (k === j + 1) {
          // Prefix name like `owl:` in `Prefix(owl:=...)`
          collector.pushOffsetSpan(text, lineIndex, i, k, "namespace", 1);
        } else {
          const iri = text.slice(i, k);
          const tokenType = classifyOwl2Iri(iri, roles);
          const mod = isDeclContext && tokenType !== "type" ? 1 : 0;
          collector.pushOffsetSpan(text, lineIndex, i, k, tokenType, mod);
        }
        i = k;
        continue;
      }
      const word = text.slice(i, j);
      if (OWL2_KEYWORDS.has(word) || word === "@prefix" || word === "prefix" || word === "base") {
        collector.pushOffsetSpan(text, lineIndex, i, j, "keyword");
      }
      i = j;
      continue;
    }
    i++;
  }
}

function collectOwl2RolesFromText(text: string): Owl2EntityRoles {
  const roles: Owl2EntityRoles = {
    classes: new Set<string>(),
    properties: new Set<string>(),
    individuals: new Set<string>(),
    datatypes: new Set<string>(),
  };
  let pos = 0;
  const isWsCode = (code: number): boolean =>
    code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11;
  const readHeadToken = (from: number): { word: string; afterOpenParen: number } | null => {
    let i = from;
    while (i < text.length && isWsCode(text.charCodeAt(i))) i++;
    const wStart = i;
    if (i < text.length && isIdentStart(text.charCodeAt(i))) {
      i++;
      while (i < text.length && isIdentPart(text.charCodeAt(i))) i++;
    }
    const word = text.slice(wStart, i);
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
    if (text[i] === "(") return { word, afterOpenParen: i + 1 };
    return null;
  };
  const readArgs = (from: number): string[] => {
    const args: string[] = [];
    let i = from;
    while (i < text.length && text[i] !== ")") {
      while (i < text.length && isWsCode(text.charCodeAt(i))) i++;
      if (i >= text.length || text[i] === ")" || text[i] === "(") break;
      const start = i;
      while (i < text.length && !isWsCode(text.charCodeAt(i)) && text[i] !== "(" && text[i] !== ")") i++;
      if (i > start) args.push(text.slice(start, i));
    }
    return args;
  };

  while (pos < text.length) {
    const idx = text.indexOf("(", pos);
    if (idx === -1) break;
    // Walk backward to get keyword before '('
    let kEnd = idx;
    while (kEnd > 0 && (text[kEnd - 1] === " " || text[kEnd - 1] === "\t")) kEnd--;
    let kStart = kEnd;
    while (kStart > 0 && isIdentPart(text.charCodeAt(kStart - 1))) kStart--;
    const kw = text.slice(kStart, kEnd);

    if (kw === "Declaration") {
      const inner = readHeadToken(idx + 1);
      if (inner) {
        const innerArgs = readArgs(inner.afterOpenParen);
        const iri = innerArgs[0];
        if (iri) {
          if (inner.word === "Class") roles.classes.add(iri);
          else if (inner.word === "Datatype") roles.datatypes.add(iri);
          else if (
            inner.word === "ObjectProperty" ||
            inner.word === "DataProperty" ||
            inner.word === "AnnotationProperty"
          ) {
            roles.properties.add(iri);
          } else if (inner.word === "NamedIndividual") {
            roles.individuals.add(iri);
          }
        }
      }
    } else if (kw === "SubClassOf") {
      const args = readArgs(idx + 1);
      if (args[0] && !OWL2_KEYWORDS.has(args[0])) roles.classes.add(args[0]);
      if (args[1] && !OWL2_KEYWORDS.has(args[1])) roles.classes.add(args[1]);
    } else if (kw === "ClassAssertion") {
      const args = readArgs(idx + 1);
      if (args[0] && !OWL2_KEYWORDS.has(args[0])) roles.classes.add(args[0]);
      if (args[1] && !OWL2_KEYWORDS.has(args[1])) roles.individuals.add(args[1]);
    } else if (kw === "ObjectPropertyDomain" || kw === "ObjectPropertyRange" || kw === "DataPropertyDomain") {
      const args = readArgs(idx + 1);
      if (args[0] && !OWL2_KEYWORDS.has(args[0])) roles.properties.add(args[0]);
      if (args[1] && !OWL2_KEYWORDS.has(args[1])) roles.classes.add(args[1]);
    } else if (kw === "DataPropertyRange") {
      const args = readArgs(idx + 1);
      if (args[0] && !OWL2_KEYWORDS.has(args[0])) roles.properties.add(args[0]);
      if (args[1] && !OWL2_KEYWORDS.has(args[1])) roles.datatypes.add(args[1]);
    } else if (kw === "ObjectPropertyAssertion") {
      const args = readArgs(idx + 1);
      if (args[0] && !OWL2_KEYWORDS.has(args[0])) roles.properties.add(args[0]);
      if (args[1] && !OWL2_KEYWORDS.has(args[1])) roles.individuals.add(args[1]);
      if (args[2] && !OWL2_KEYWORDS.has(args[2])) roles.individuals.add(args[2]);
    } else if (kw === "DataPropertyAssertion") {
      const args = readArgs(idx + 1);
      if (args[0] && !OWL2_KEYWORDS.has(args[0])) roles.properties.add(args[0]);
      if (args[1] && !OWL2_KEYWORDS.has(args[1])) roles.individuals.add(args[1]);
    }
    pos = idx + 1;
  }
  return roles;
}

function computeOwl2SemanticTokens(
  builder: SemanticTokensBuilder,
  text: string,
  tree?: CstTreeLike | null,
  uri?: string,
): SemanticTokens {
  const collector = new TokenCollector();
  const lineIndex = new LineIndex(text);

  if ((uri && /\.owx($|\?|#)/i.test(uri)) || text.trimStart().startsWith("<")) {
    emitOwl2XmlTokens(text, lineIndex, collector);
    return collector.flushTo(builder);
  }

  if (tree?.rootNode && isOwl2CstTree(tree)) {
    const roles: Owl2EntityRoles = {
      classes: new Set<string>(),
      properties: new Set<string>(),
      individuals: new Set<string>(),
      datatypes: new Set<string>(),
    };

    const getChildIris = (node: CstNodeLike): string[] => {
      const iris: string[] = [];
      for (const child of getChildren(node)) {
        if (child.type === "IRI") iris.push(String(child.text ?? ""));
      }
      return iris;
    };

    const collectRolesFromCst = (node: CstNodeLike | null | undefined): void => {
      if (!node) return;
      const children = getChildren(node);
      if (node.type === "Declaration") {
        for (const entity of children) {
          const iri = getChildIris(entity)[0];
          if (!iri) continue;
          if (entity.type === "ClassEntity") roles.classes.add(iri);
          else if (entity.type === "DatatypeEntity") roles.datatypes.add(iri);
          else if (
            entity.type === "ObjectPropertyEntity" ||
            entity.type === "DataPropertyEntity" ||
            entity.type === "AnnotationPropertyEntity"
          ) {
            roles.properties.add(iri);
          } else if (entity.type === "NamedIndividualEntity") roles.individuals.add(iri);
        }
      } else if (node.type === "SubClassOfAxiom") {
        // GLR recovery can parse unrecognized axioms like AnnotationAssertion into SubClassOfAxiom
        const headKw = String(children[0]?.text ?? "");
        if (headKw === "SubClassOf") {
          for (const iri of getChildIris(node)) roles.classes.add(iri);
        }
      } else if (node.type === "ClassAssertionAxiom") {
        const iris = getChildIris(node);
        if (iris[0]) roles.classes.add(iris[0]);
        if (iris[1]) roles.individuals.add(iris[1]);
      } else if (
        node.type === "ObjectPropertyDomainAxiom" ||
        node.type === "ObjectPropertyRangeAxiom" ||
        node.type === "DataPropertyDomainAxiom"
      ) {
        const iris = getChildIris(node);
        if (iris[0]) roles.properties.add(iris[0]);
        if (iris[1]) roles.classes.add(iris[1]);
      } else if (node.type === "DataPropertyRangeAxiom") {
        const iris = getChildIris(node);
        if (iris[0]) roles.properties.add(iris[0]);
        if (iris[1]) roles.datatypes.add(iris[1]);
      } else if (node.type === "ObjectPropertyAssertionAxiom") {
        const iris = getChildIris(node);
        if (iris[0]) roles.properties.add(iris[0]);
        if (iris[1]) roles.individuals.add(iris[1]);
        if (iris[2]) roles.individuals.add(iris[2]);
      } else if (node.type === "DataPropertyAssertionAxiom") {
        const iris = getChildIris(node);
        if (iris[0]) roles.properties.add(iris[0]);
        if (iris[1]) roles.individuals.add(iris[1]);
      }
      for (const child of children) collectRolesFromCst(child);
    };

    collectRolesFromCst(tree.rootNode);

    const visit = (node: CstNodeLike | null | undefined, inDeclaration: boolean): void => {
      if (!node) return;
      const nType = node.type;
      const nText = String(node.text ?? "");

      if (nType === "ERROR" || node.isError) {
        if (typeof node.startIndex === "number" && typeof node.endIndex === "number") {
          const errChildren = getChildren(node);
          if (nText.startsWith('"') && errChildren.length === 1 && getChildren(errChildren[0]).length === 0) {
            emitOwl2LiteralLeaf(node, text, lineIndex, collector);
          } else {
            scanOwl2FunctionalSpan(text, node.startIndex, node.endIndex, lineIndex, collector, roles, inDeclaration);
          }
        }
        return;
      }

      if (nType === "PrefixName") {
        collector.pushNode(node, "namespace", 1);
        return;
      }
      if (nType === "FullIRI") {
        collector.pushNode(node, "string");
        return;
      }
      if (nType === "AbbreviatedIRI") {
        const tokenType = classifyOwl2Iri(nText, roles);
        const mod = inDeclaration && tokenType !== "type" ? 1 : 0;
        collector.pushNode(node, tokenType, mod);
        return;
      }
      if (nType === "TypedLiteral" || nType === "StringLiteral" || nText.startsWith('"')) {
        if (getChildren(node).length === 0 || nType === "TypedLiteral") {
          emitOwl2LiteralLeaf(node, text, lineIndex, collector);
          return;
        }
      }
      if (nType === "INTEGER" || nType === "DECIMAL" || nType === "FLOAT") {
        collector.pushNode(node, "number");
        return;
      }
      if (nText === "^^") {
        collector.pushNode(node, "operator");
        return;
      }

      const nextDecl = inDeclaration || nType === "Declaration";
      const children = getChildren(node);
      if (children.length === 0) {
        if (OWL2_KEYWORDS.has(nText)) {
          collector.pushNode(node, "keyword");
        }
        return;
      }
      for (const child of children) {
        visit(child, nextDecl);
      }
    };

    visit(tree.rootNode, false);
    collectCstGapComments(tree.rootNode, text, lineIndex, collector, (src, gs, ge, li, col) =>
      emitGapLineComments(["#", "//"], src, gs, ge, li, col),
    );
    return collector.flushTo(builder);
  }

  // Fallback for Turtle (.ttl) or FSS without loaded WASM CST
  const roles = collectOwl2RolesFromText(text);
  scanOwl2FunctionalSpan(text, 0, text.length, lineIndex, collector, roles, false);
  return collector.flushTo(builder);
}

// ---------------------------------------------------------------------------
// SysML v2
// ---------------------------------------------------------------------------

const sysml2StructuralKeywords = new Set([
  "package",
  "library",
  "standard",
  "part",
  "actor",
  "stakeholder",
  "attribute",
  "port",
  "connection",
  "interface",
  "allocation",
  "action",
  "state",
  "constraint",
  "requirement",
  "concern",
  "case",
  "analysis",
  "verification",
  "use",
  "view",
  "viewpoint",
  "rendering",
  "enumeration",
  "occurrence",
  "item",
  "calculation",
  "metadata",
  "flow",
  "connect",
  "def",
]);

const sysml2ControlKeywords = new Set([
  "if",
  "else",
  "then",
  "while",
  "for",
  "loop",
  "return",
  "import",
  "alias",
  "about",
  "accept",
  "after",
  "all",
  "as",
  "assign",
  "assert",
  "assume",
  "at",
  "bind",
  "by",
  "chains",
  "collect",
  "decide",
  "default",
  "defined",
  "dependency",
  "do",
  "doc",
  "done",
  "emit",
  "entry",
  "exhibit",
  "expose",
  "filter",
  "first",
  "fork",
  "frame",
  "from",
  "hastype",
  "intersect",
  "include",
  "istype",
  "join",
  "merge",
  "message",
  "multiplicity",
  "namespace",
  "nonunique",
  "objective",
  "of",
  "on",
  "ordered",
  "perform",
  "private",
  "protected",
  "public",
  "readonly",
  "redefines",
  "ref",
  "render",
  "rep",
  "require",
  "satisfy",
  "send",
  "snapshot",
  "specializes",
  "stakeholder",
  "subject",
  "subsets",
  "succession",
  "timeslice",
  "to",
  "transition",
  "union",
  "until",
  "variant",
  "variation",
  "verify",
  "via",
  "when",
  "in",
  "out",
  "inout",
  "abstract",
  "derived",
  "end",
  "individual",
  "parallel",
]);

const sysml2BuiltinTypes = new Set([
  "Boolean",
  "Integer",
  "Real",
  "String",
  "Natural",
  "Positive",
  "NaturalNumber",
  "Number",
  "ScalarValues",
  "Any",
  "Anything",
  "DataValue",
]);

function computeSysML2SemanticTokens(
  builder: SemanticTokensBuilder,
  text: string,
  getSysml2Parser: () => CstParserLike | null | undefined,
  isSysml2ParserReady: () => boolean,
): SemanticTokens {
  const sysmlParser = getSysml2Parser();
  if (!isSysml2ParserReady() || !sysmlParser) {
    return builder.build();
  }

  let tree;
  try {
    tree = sysmlParser.parse(text);
  } catch {
    return builder.build();
  }
  if (!tree) {
    return builder.build();
  }

  const collector = new TokenCollector();

  const definitionTypes = new Set([
    "PartDefinition",
    "AttributeDefinition",
    "PortDefinition",
    "ConnectionDefinition",
    "InterfaceDefinition",
    "AllocationDefinition",
    "ActionDefinition",
    "StateDefinition",
    "ConstraintDefinition",
    "RequirementDefinition",
    "ConcernDefinition",
    "CaseDefinition",
    "AnalysisCaseDefinition",
    "VerificationCaseDefinition",
    "ViewDefinition",
    "ViewpointDefinition",
    "RenderingDefinition",
    "CalculationDefinition",
    "EnumerationDefinition",
    "OccurrenceDefinition",
    "ItemDefinition",
    "FlowDefinition",
    "MetadataDefinition",
  ]);

  const usageTypes = new Set([
    "PartUsage",
    "AttributeUsage",
    "PortUsage",
    "ConnectionUsage",
    "InterfaceUsage",
    "AllocationUsage",
    "ActionUsage",
    "StateUsage",
    "ConstraintUsage",
    "RequirementUsage",
    "ConcernUsage",
    "CaseUsage",
    "AnalysisCaseUsage",
    "VerificationCaseUsage",
    "ViewUsage",
    "ViewpointUsage",
    "RenderingUsage",
    "CalculationUsage",
    "EnumerationUsage",
    "OccurrenceUsage",
    "ItemUsage",
    "FlowUsage",
    "MetadataUsage",
    "ReferenceUsage",
    "DefaultReferenceUsage",
  ]);

  const traverse = (node: any) => {
    let tokenType: string | null = null;
    let modifier = 0;

    const nodeType = node.type;
    const nodeText = node.text;

    if (nodeType === "declaredName" || nodeType === "name") {
      const parent = node.parent;
      if (parent && definitionTypes.has(parent.type)) {
        tokenType = "type";
        modifier = 1;
      } else if (parent && usageTypes.has(parent.type)) {
        tokenType = "variable";
        modifier = 1;
      } else if (parent?.type === "Package" || parent?.type === "LibraryPackage") {
        tokenType = "namespace";
        modifier = 1;
      } else {
        tokenType = "variable";
      }
    } else if (nodeType === "qualifiedName" || nodeType === "identification") {
      // Skip — traverse children
    } else if (sysml2StructuralKeywords.has(nodeText) && node.childCount === 0) {
      tokenType = "keyword";
    } else if (sysml2ControlKeywords.has(nodeText) && node.childCount === 0) {
      tokenType = "keyword";
    } else if (sysml2BuiltinTypes.has(nodeText) && node.childCount === 0) {
      tokenType = "type";
    } else if (nodeType === "comment" || nodeType === "line_comment" || nodeType === "block_comment") {
      tokenType = "comment";
    } else if (nodeType === "string_literal" || nodeType === "regular_expression") {
      tokenType = "string";
    } else if (nodeType === "integer_literal" || nodeType === "real_literal") {
      tokenType = "number";
    } else if (["+", "-", "*", "/", "=", "<", ">", "<=", ">=", "==", "!="].includes(nodeType)) {
      tokenType = "operator";
    }

    if (tokenType !== null) {
      collector.pushNode(node, tokenType, modifier);
    }

    for (const child of node.children) {
      traverse(child);
    }
  };

  try {
    traverse(tree.rootNode);
  } finally {
    (tree as { delete?(): void }).delete?.();
  }

  return collector.flushTo(builder);
}

// ---------------------------------------------------------------------------
// Provider Registration
// ---------------------------------------------------------------------------

function extractUriExtension(uri: string): string {
  const cleanUri = uri.split(/[?#]/)[0] || "";
  const dot = cleanUri.lastIndexOf(".");
  if (dot === -1) return ".mo";
  const slash = Math.max(cleanUri.lastIndexOf("/"), cleanUri.lastIndexOf("\\"));
  return dot > slash ? cleanUri.slice(dot) : ".mo";
}

function getModelicaClauseVariability(clause: CstNodeLike | null | undefined): "constant" | "parameter" | null {
  if (!clause) return null;
  let variability: "constant" | "parameter" | null = null;
  for (const child of getChildren(clause)) {
    if (child.type === "type_prefix" || child.type === "TypePrefix") {
      const stack = getChildren(child);
      if (stack.length === 0) {
        if (child.text === "constant") return "constant";
        if (child.text === "parameter") variability = "parameter";
      } else {
        for (const kw of stack) {
          if (kw.text === "constant") return "constant";
          if (kw.text === "parameter") variability = "parameter";
        }
      }
    } else if (child.text === "constant") {
      return "constant";
    } else if (child.text === "parameter") {
      variability = "parameter";
    }
  }
  return variability;
}

interface DocumentTreeEntryLike {
  tree?: CstTreeLike | null;
  text?: string;
}

export function registerSemanticTokensProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  getDocumentTree: (uri: string) => DocumentTreeEntryLike | CstTreeLike | null | undefined,
  getSysml2Parser: () => CstParserLike | null | undefined,
  isSysml2ParserReady: () => boolean,
  parseFallback?: (ext: string, text: string) => DocumentTreeEntryLike | CstTreeLike | null | undefined,
  ensureParserLoaded?: (languageIdOrUri: string) => Promise<void>,
) {
  const tokensCache = new Map<string, { version: number; tokens: SemanticTokens }>();

  documents.onDidClose((e) => {
    tokensCache.delete(e.document.uri);
  });

  function resolveDocumentTree(
    textDocument: TextDocument,
    text: string,
  ): { tree: CstTreeLike | null | undefined; ownsFallbackTree: boolean } {
    const docTree = getDocumentTree(textDocument.uri);
    let tree: CstTreeLike | null | undefined =
      docTree && typeof docTree === "object" && "tree" in docTree
        ? docTree.tree
        : (docTree as CstTreeLike | null | undefined);
    const treeText = docTree && typeof docTree === "object" && "text" in docTree ? docTree.text : tree?.sourceCode;
    let ownsFallbackTree = false;

    if ((!tree || !tree.rootNode || (treeText && treeText !== text)) && parseFallback) {
      try {
        const ext = extractUriExtension(textDocument.uri);
        const fallbackTree = parseFallback(ext, text);
        if (fallbackTree) {
          tree =
            typeof fallbackTree === "object" && "tree" in fallbackTree
              ? fallbackTree.tree
              : (fallbackTree as CstTreeLike);
          ownsFallbackTree = true;
        }
      } catch {
        // Ignore parse fallback error; callers handle missing tree
      }
    }
    return { tree, ownsFallbackTree };
  }

  function computeSemanticTokens(textDocument: TextDocument): SemanticTokens {
    const cached = tokensCache.get(textDocument.uri);
    if (cached && cached.version === textDocument.version) {
      return cached.tokens;
    }

    const builder = new SemanticTokensBuilder();
    const text = textDocument.getText();
    const cleanUri = textDocument.uri.split(/[?#]/)[0] || "";

    if (
      textDocument.uri.endsWith(".sysml") ||
      textDocument.uri.endsWith(".sysml2") ||
      textDocument.languageId === "sysml" ||
      textDocument.languageId === "sysml2"
    ) {
      return computeSysML2SemanticTokens(builder, text, getSysml2Parser, isSysml2ParserReady);
    }

    const { tree, ownsFallbackTree } = resolveDocumentTree(textDocument, text);
    try {
      const cacheResult = (tokens: SemanticTokens): SemanticTokens => {
        tokensCache.set(textDocument.uri, { version: textDocument.version, tokens });
        return tokens;
      };

      if (/\.(step|stp|p21)$/i.test(cleanUri) || textDocument.languageId === "step") {
        return cacheResult(computeStepSemanticTokens(builder, text, tree));
      }

      if (/\.(cfg|cfgt|su2|cfd)$/i.test(cleanUri) || textDocument.languageId === "cfd") {
        return cacheResult(computeCfdSemanticTokens(builder, text, tree, textDocument.uri));
      }

      if (/\.(inp|inpt|bdf|fea)$/i.test(cleanUri) || textDocument.languageId === "fea") {
        return cacheResult(computeFeaSemanticTokens(builder, text, tree, textDocument.uri));
      }

      if (/\.(f|for|f77|f90|f95|f03|f08)$/i.test(cleanUri) || textDocument.languageId === "fortran") {
        return cacheResult(computeFortranSemanticTokens(builder, text, tree));
      }

      if (/\.(owl|owl2|ofn|fss|owx|ttl)$/i.test(cleanUri) || textDocument.languageId === "owl2") {
        return cacheResult(computeOwl2SemanticTokens(builder, text, tree, textDocument.uri));
      }

      if (!tree || !tree.rootNode) {
        return builder.build();
      }

      const isModelica = textDocument.languageId === "modelica" || cleanUri.toLowerCase().endsWith(".mo");

      // Try WASM-compiled semantic tokens (lsp_semanticTokens_full) for polyglot languages
      if (!isModelica) {
        try {
          const rootPtr = typeof tree.rootNode.getPtr === "function" ? tree.rootNode.getPtr() : undefined;
          const runtime = tree.runtime ?? tree.rootNode.runtime;
          const wasmTokens: Uint32Array | undefined =
            typeof tree.getSemanticTokens === "function"
              ? tree.getSemanticTokens()
              : rootPtr && typeof runtime?.getSemanticTokens === "function"
                ? runtime.getSemanticTokens(rootPtr, text)
                : undefined;
          if (wasmTokens && wasmTokens.length >= 5) {
            let curLine = 0;
            let curChar = 0;
            for (let i = 0; i + 4 < wasmTokens.length; i += 5) {
              const dLine = wasmTokens[i]!;
              const dChar = wasmTokens[i + 1]!;
              const len = wasmTokens[i + 2]!;
              const tType = wasmTokens[i + 3]!;
              const tMod = wasmTokens[i + 4]!;
              curLine += dLine;
              curChar = dLine === 0 ? curChar + dChar : dChar;
              if (len > 0) {
                builder.push(curLine, curChar, len, tType, tMod);
              }
            }
            return cacheResult(builder.build());
          }
        } catch {
          // Fall back to CST traversal below
        }
      }

      const collector = new TokenCollector();
      const plugin = globalLanguageRegistry.getPluginForUri(textDocument.uri);
      const typeKws = (plugin?.monarch?.typeKeywords as string[]) ?? DEFAULT_TYPE_KEYWORDS;
      const langKws = new Set<string>((plugin?.monarch?.keywords as string[]) ?? []);

      const traverseTree = (node: CstNodeLike) => {
        let tokenType: string | null = null;
        let modifier = 0;

        if (node.type === "IDENT" || node.type === "identifier" || node.type === "IDENTIFIER") {
          const parent = node.parent;
          let p = parent;
          while (p && (p.type === "Name" || p.type === "name" || p.type === "component_reference")) {
            p = p.parent;
          }

          let inError = false;
          let curr = node.parent;
          while (curr) {
            if (curr.type === "ERROR" || curr.isError) {
              inError = true;
              break;
            }
            curr = curr.parent;
          }

          if (typeKws.includes(node.text)) {
            tokenType = "type";
          } else if (!isModelica && langKws.has(node.text)) {
            tokenType = "keyword";
          } else if (inError) {
            tokenType = "variable";
          } else if (
            p?.type === "LongClassSpecifier" ||
            p?.type === "long_class_specifier" ||
            p?.type === "ShortClassSpecifier" ||
            p?.type === "short_class_specifier" ||
            p?.type === "DerClassSpecifier" ||
            p?.type === "der_class_specifier"
          ) {
            tokenType = "class";
            modifier = 1;
          } else if (
            p?.type === "WithinDirective" ||
            p?.type === "within_clause" ||
            p?.type === "ExtendsClause" ||
            p?.type === "extends_clause" ||
            p?.type === "TypeSpecifier" ||
            p?.type === "type_specifier"
          ) {
            tokenType = "type";
          } else if (p?.type === "Declaration" || p?.type === "component_declaration" || p?.type === "declaration") {
            let clause: CstNodeLike | null | undefined = p;
            while (
              clause &&
              clause.type !== "component_clause" &&
              clause.type !== "ComponentClause" &&
              clause.type !== "element"
            ) {
              clause = clause.parent;
            }
            const variability = getModelicaClauseVariability(clause);
            if (variability === "constant") {
              tokenType = "parameter";
              modifier = 3;
            } else if (variability === "parameter") {
              tokenType = "parameter";
              modifier = 1;
            } else {
              tokenType = "variable";
              modifier = 1;
            }
          } else if (parent?.type === "Argument") {
            tokenType = "parameter";
          } else if (parent?.type === "ModuleDeclaration" || parent?.type === "FunctionDeclaration") {
            tokenType = "function";
            modifier = 1;
          } else if (parent?.type === "VariableDeclaration") {
            tokenType = "variable";
            modifier = 1;
          } else if (
            parent?.type === "function_call" ||
            p?.type === "function_call" ||
            parent?.type === "function_call_args" ||
            parent?.type === "ModuleCall" ||
            parent?.type === "FunctionCall"
          ) {
            tokenType = "function";
          } else {
            tokenType = "variable";
          }
        } else if (node.type === "STRING" || node.type === "string_literal" || node.type === "description_string") {
          tokenType = "string";
        } else if (
          node.type === "UNSIGNED_INTEGER" ||
          node.type === "UNSIGNED_REAL" ||
          node.type === "unsigned_integer" ||
          node.type === "unsigned_real" ||
          node.type === "NUMBER"
        ) {
          tokenType = "number";
        } else if (node.type === "BOOLEAN") {
          tokenType = "keyword";
        } else if (
          node.type === "comment" ||
          node.type === "line_comment" ||
          node.type === "block_comment" ||
          node.type === "COMMENT"
        ) {
          tokenType = "comment";
        } else if (["+", "-", "*", "/", "=", "<", ">", "<=", ">=", "==", "<>", "!="].includes(node.type)) {
          tokenType = "operator";
        } else if (!isModelica && (!node.children || node.children.length === 0)) {
          if (typeKws.includes(node.text)) {
            tokenType = "type";
          } else if (langKws.has(node.text)) {
            tokenType = "keyword";
          } else if (
            node.parent &&
            /^(BooleanOp|TransformOp|ExtrudeOp|.*Primitive)$/.test(node.parent.type) &&
            /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(node.text)
          ) {
            tokenType = "function";
          }
        }

        if (tokenType !== null) {
          collector.pushNode(node, tokenType, modifier);
          if (
            node.type === "IDENTIFIER" ||
            node.type === "NUMBER" ||
            node.type === "STRING" ||
            node.type === "BOOLEAN" ||
            node.type === "COMMENT"
          ) {
            return;
          }
        }

        for (const child of node.children || []) {
          traverseTree(child);
        }
      };

      traverseTree(tree.rootNode);
      if (!isModelica) {
        const lineIndex = new LineIndex(text);
        collectCstGapComments(tree.rootNode, text, lineIndex, collector, (src, gs, ge, li, col) => {
          emitGapBlockComments(src, gs, ge, li, col);
          emitGapLineComments(["//"], src, gs, ge, li, col);
        });
      }
      return cacheResult(collector.flushTo(builder));
    } finally {
      if (ownsFallbackTree) {
        tree?.delete?.();
      }
    }
  }

  connection.onRequest("textDocument/semanticTokens/full", (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return { data: [] };
    }
    if (ensureParserLoaded && !getDocumentTree(document.uri)) {
      return ensureParserLoaded(document.languageId || document.uri).then(
        () => computeSemanticTokens(document),
        () => computeSemanticTokens(document),
      );
    }
    return computeSemanticTokens(document);
  });
}
