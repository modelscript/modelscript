// SPDX-License-Identifier: AGPL-3.0-or-later

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

function collectCstGapBlockComments(
  rootNode: CstNodeLike,
  text: string,
  lineIndex: LineIndex,
  collector: TokenCollector,
): void {
  let cursor = 0;
  const visitLeaves = (node: CstNodeLike): void => {
    const children = getChildren(node);
    if (children.length === 0) {
      const start = typeof node.startIndex === "number" ? node.startIndex : cursor;
      const end = typeof node.endIndex === "number" ? node.endIndex : start;
      if (start > cursor) emitGapBlockComments(text, cursor, start, lineIndex, collector);
      if (end > cursor) cursor = end;
      return;
    }
    for (const child of children) visitLeaves(child);
  };
  visitLeaves(rootNode);
  if (cursor < text.length) emitGapBlockComments(text, cursor, text.length, lineIndex, collector);
}

const STEP_SECTION_KEYWORDS = new Set(["ISO-10303-21", "HEADER", "DATA", "ENDSEC", "END-ISO-10303-21"]);
const MAX_STEP_SEMANTIC_CHARS = 262_144;

function isStepTree(tree: { rootNode?: CstNodeLike | null } | null | undefined): boolean {
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

/**
 * Computes LSP delta-encoded semantic token data for ISO-10303-21 STEP documents.
 */
export function computeStepSemanticTokensData(text: string, tree?: { rootNode?: CstNodeLike | null } | null): number[] {
  const collector = new TokenCollector();
  if (text.length > MAX_STEP_SEMANTIC_CHARS) {
    const slice = text.slice(0, MAX_STEP_SEMANTIC_CHARS);
    const sliceLineIndex = new LineIndex(slice);
    scanStepSpan(slice, 0, slice.length, sliceLineIndex, collector);
    return collector.buildData();
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
      for (const child of children) visit(child);
    };

    visit(tree.rootNode);
    collectCstGapBlockComments(tree.rootNode, text, lineIndex, collector);
    return collector.buildData();
  }

  scanStepSpan(text, 0, text.length, lineIndex, collector);
  return collector.buildData();
}
