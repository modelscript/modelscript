// SPDX-License-Identifier: AGPL-3.0-or-later

import { tokenizeFortran } from "./ast.js";

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
  parent?: CstNodeLike | null;
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

function isFortranTree(tree: { rootNode?: CstNodeLike | null } | null | undefined): boolean {
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

    if (start <= range.start && isFixedFormCommentLine(rawLine)) {
      collector.push(line, 0, rawLine.length, "comment");
      continue;
    }

    const segStart = Math.max(start, range.start);
    const segEnd = Math.min(end, range.end);
    emitFortranLexerSlice(text, line, range.start, segStart, segEnd, collector, routineNames, paramNames);
  }
}

/**
 * Computes LSP delta-encoded semantic token data for Fortran (F77/F90/F95/F2008 & EMTDC extensions).
 */
export function computeFortranSemanticTokensData(
  text: string,
  tree?: { rootNode?: CstNodeLike | null } | null,
): number[] {
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
      for (const child of children) visit(child);
    };

    visit(tree.rootNode);
    collectCstGapLineComments(tree.rootNode, text, lineIndex, collector, ["!"]);
    return collector.buildData();
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
  return collector.buildData();
}
