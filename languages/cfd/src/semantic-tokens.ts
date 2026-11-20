// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseCfdConfig } from "./dialects/index.js";

const TOKEN_TYPE_INDEX = new Map<string, number>([
  ["keyword", 0],
  ["type", 1],
  ["class", 2],
  ["variable", 3],
  ["parameter", 4],
  ["function", 5],
  ["string", 6],
  ["number", 7],
  ["operator", 8],
  ["comment", 9],
  ["namespace", 10],
  ["enumMember", 11],
]);

interface CstNodeLike {
  type: string;
  text?: string;
  isError?: boolean;
  startIndex?: number;
  endIndex?: number;
  startPosition?: { row: number; column: number };
  endPosition?: { row: number; column: number };
  children?: readonly CstNodeLike[];
  childCount?: number;
  child?: (index: number) => CstNodeLike | null | undefined;
}

class LineIndex {
  private readonly lineStarts: number[];
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
    this.lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
    }
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

class TokenCollector {
  private readonly rawTokens: Array<{
    line: number;
    char: number;
    length: number;
    typeIndex: number;
    modifier: number;
  }> = [];
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
      if (len > 0) this.push(start.row + i, i === 0 ? start.column : 0, len, typeName, modifier);
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
      if (len > 0) this.push(line, segStart - range.start, len, typeName, modifier);
    }
  }

  public buildData(): number[] {
    this.rawTokens.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.char - b.char));
    const data: number[] = [];
    let lastLine = -1;
    let lastEndChar = -1;
    let prevLine = 0;
    let prevChar = 0;
    for (const token of this.rawTokens) {
      if (token.line > lastLine || token.char >= lastEndChar) {
        lastLine = token.line;
        lastEndChar = token.char + token.length;
        const deltaLine = token.line - prevLine;
        const deltaChar = deltaLine === 0 ? token.char - prevChar : token.char;
        data.push(deltaLine, deltaChar, token.length, token.typeIndex, token.modifier);
        prevLine = token.line;
        prevChar = token.char;
      }
    }
    return data;
  }
}

function getChildren(node: CstNodeLike | null | undefined): readonly CstNodeLike[] {
  if (!node) return [];
  if (Array.isArray(node.children) && node.children.length > 0) return node.children;
  const count = node.childCount ?? 0;
  if (count <= 0 || typeof node.child !== "function") return [];
  const res: CstNodeLike[] = [];
  for (let i = 0; i < count; i++) {
    const c = node.child(i);
    if (c) res.push(c);
  }
  return res;
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

function collectCstGapLineComments(
  rootNode: CstNodeLike,
  text: string,
  lineIndex: LineIndex,
  collector: TokenCollector,
  markers: readonly string[],
): void {
  const emitGap = (gapStart: number, gapEnd: number) => {
    let i = gapStart;
    while (i < gapEnd) {
      let matched = false;
      for (const m of markers) {
        if (text.startsWith(m, i)) {
          let end = text.indexOf("\n", i);
          if (end === -1 || end > gapEnd) end = gapEnd;
          if (end > i && text.charCodeAt(end - 1) === 13) end--;
          collector.pushOffsetSpan(text, lineIndex, i, end, "comment");
          i = end;
          matched = true;
          break;
        }
      }
      if (!matched) i++;
    }
  };

  let cursor = 0;
  const visitLeaves = (node: CstNodeLike): void => {
    const children = getChildren(node);
    if (children.length === 0) {
      const start = typeof node.startIndex === "number" ? node.startIndex : cursor;
      const end = typeof node.endIndex === "number" ? node.endIndex : start;
      if (start > cursor) emitGap(cursor, start);
      if (end > cursor) cursor = end;
      return;
    }
    for (const child of children) visitLeaves(child);
  };
  visitLeaves(rootNode);
  if (cursor < text.length) emitGap(cursor, text.length);
}

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

function isCfdCstTree(tree: { rootNode?: CstNodeLike | null } | null | undefined): boolean {
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

/**
 * Computes LSP delta-encoded semantic token data for CFD configurations (SU2 & OpenFOAM).
 */
export function computeCfdSemanticTokensData(
  text: string,
  tree?: { rootNode?: CstNodeLike | null } | null,
  uri?: string,
): number[] {
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
    collectCstGapLineComments(tree.rootNode, text, lineIndex, collector, ["%", "//", "#"]);
    return collector.buildData();
  }

  try {
    parseCfdConfig(text, openFoam ? "openfoam" : "su2");
  } catch {
    // Ignore partial parse errors while editing
  }
  scanCfdLineRange(text, 0, text.length, lineIndex, collector, openFoam);
  return collector.buildData();
}
