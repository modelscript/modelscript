// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectCstLeaves,
  findMatchingBraceLeaf,
  findMatchingDelimiterLeaf,
  parseSysmlSource,
  sliceLeavesInRange,
  splitLinesCrLf,
  type CstLeaf,
} from "./cst-utils.js";

/**
 * SysML v2 / KerML Document Formatter.
 *
 * Provides syntax-aware, comment-preserving indentation, keyword alignment,
 * and whitespace normalization for .sysml and .kerml files.
 */

export interface SysMLFormatOptions {
  /** Number of spaces per indentation level (default: 2) */
  tabSize?: number | undefined;
  /** Whether to use spaces (true) or tabs (false) */
  insertSpaces?: boolean | undefined;
  /** Range formatting: start line (0-indexed, inclusive) */
  startLine?: number | undefined;
  /** Range formatting: end line (0-indexed, inclusive) */
  endLine?: number | undefined;
}

function isAsciiDigitChar(ch: string | undefined): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isUnitInnerLeafText(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 47; // '_' or '/'
    if (!ok) return false;
  }
  return text.length > 0;
}

function endsWithDigit(text: string): boolean {
  return text.length > 0 && isAsciiDigitChar(text[text.length - 1]);
}

function findInlineLineCommentStart(trimmedLine: string, lineLeaves: readonly CstLeaf[], trimOffset: number): number {
  let pos = 0;
  while (pos < trimmedLine.length) {
    const idx = trimmedLine.indexOf("//", pos);
    if (idx < 0) return -1;
    const absPos = trimOffset + idx;
    const insideString = lineLeaves.some(
      (leaf) => (leaf.text.startsWith('"') || leaf.text.startsWith("'")) && absPos >= leaf.start && absPos < leaf.end,
    );
    if (!insideString) return idx;
    pos = idx + 2;
  }
  return -1;
}

function formatLineLeaves(leaves: readonly CstLeaf[]): string {
  if (leaves.length === 0) return "";

  const spaceInsideCloseBrace = new Set<number>();
  const spaceInsideOpenBrace = new Set<number>();
  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i]!.text === "{") {
      const closeIdx = findMatchingBraceLeaf(leaves, i);
      if (closeIdx > i + 1) {
        spaceInsideOpenBrace.add(i);
        spaceInsideCloseBrace.add(closeIdx);
      }
    }
  }

  let out = "";
  for (let i = 0; i < leaves.length; i++) {
    const cur = leaves[i]!;
    if (i > 0) {
      const prev = leaves[i - 1]!;
      let needSpace = cur.start > prev.end;

      if (cur.text === "{" && prev.text !== "{") {
        needSpace = true;
      } else if (spaceInsideOpenBrace.has(i - 1)) {
        needSpace = true;
      } else if (spaceInsideCloseBrace.has(i)) {
        needSpace = true;
      } else if (cur.text === ":" || prev.text === ":") {
        needSpace = true;
      } else if (cur.text === "=" || prev.text === "=") {
        needSpace = true;
      } else if (cur.text === "[" && endsWithDigit(prev.text)) {
        const closeBracket = findMatchingDelimiterLeaf(leaves, i, "[", "]");
        if (
          closeBracket > i + 1 &&
          leaves.slice(i + 1, closeBracket).every((inner) => isUnitInnerLeafText(inner.text))
        ) {
          needSpace = true;
        }
      }

      if (cur.text === ";" && i === leaves.length - 1) {
        needSpace = false;
      }

      if (needSpace && !out.endsWith(" ")) {
        out += " ";
      }
    }
    out += cur.text;
  }
  return out;
}

function stripWhitespace(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c !== " " && c !== "\t" && c !== "\r" && c !== "\n") {
      out += c;
    }
  }
  return out;
}

export function formatSysmlSource(source: string, options: SysMLFormatOptions = {}): string {
  const tabSize = options.tabSize ?? 2;
  const indentStr = options.insertSpaces !== false ? " ".repeat(tabSize) : "\t";
  const lines = splitLinesCrLf(source);
  const normalizedSource = lines.join("\n");
  const allLeaves = collectCstLeaves(parseSysmlSource(normalizedSource));
  const formatted: string[] = [];

  let depth = 0;
  let inBlockComment = false;
  let lineOffset = 0;

  const start = options.startLine ?? 0;
  const end = options.endLine !== undefined ? Math.min(options.endLine, lines.length - 1) : lines.length - 1;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const currentLineStart = lineOffset;
    lineOffset += rawLine.length + 1;

    // Outside formatting range: keep verbatim
    if (i < start || i > end) {
      formatted.push(rawLine);
      continue;
    }

    const trimmed = rawLine.trim();

    if (!trimmed) {
      formatted.push("");
      continue;
    }

    // Handle multi-line block comments
    if (inBlockComment) {
      formatted.push(indentStr.repeat(depth) + trimmed);
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inBlockComment = true;
      formatted.push(indentStr.repeat(depth) + trimmed);
      continue;
    }

    const leadingWs = rawLine.length - rawLine.trimStart().length;
    const rawLineLeaves = sliceLeavesInRange(allLeaves, currentLineStart, currentLineStart + rawLine.length);

    // Strip inline single-line comment outside string leaves
    const commentIdx = findInlineLineCommentStart(trimmed, rawLineLeaves, currentLineStart + leadingWs);
    let codePart = trimmed;
    let lineComment = "";
    if (commentIdx !== -1) {
      lineComment = trimmed.slice(commentIdx);
      codePart = trimmed.slice(0, commentIdx).trim();
    }

    const codeEndAbs = currentLineStart + leadingWs + codePart.length;
    const codeLeaves = rawLineLeaves.filter((leaf) => leaf.end <= codeEndAbs);

    // Dedent leading closing braces
    if (codePart.startsWith("}")) {
      depth = Math.max(0, depth - 1);
    }

    let normalizedCode = codePart;
    if (normalizedCode) {
      const codeNoWs = stripWhitespace(codePart);
      const leavesNoWs = codeLeaves.map((l) => l.text).join("");
      if (codeLeaves.length > 0 && codeNoWs === leavesNoWs) {
        normalizedCode = formatLineLeaves(codeLeaves);
      }
    }

    const fullLine = lineComment ? (normalizedCode ? `${normalizedCode} ${lineComment}` : lineComment) : normalizedCode;
    formatted.push(indentStr.repeat(depth) + fullLine);

    // Calculate depth change from CST brace leaves (fallback to char count only on unparsed error fragments)
    let openCount = 0;
    let closeCount = 0;
    if (codeLeaves.length > 0 && stripWhitespace(codePart) === codeLeaves.map((l) => l.text).join("")) {
      for (const leaf of codeLeaves) {
        if (leaf.text === "{") openCount++;
        else if (leaf.text === "}") closeCount++;
      }
    } else {
      for (let c = 0; c < codePart.length; c++) {
        if (codePart[c] === "{") openCount++;
        else if (codePart[c] === "}") closeCount++;
      }
    }

    // If line started with `}`, we already decremented by 1 before writing
    const netChange = codePart.startsWith("}") ? openCount - (closeCount - 1) : openCount - closeCount;
    depth = Math.max(0, depth + netChange);
  }

  return formatted.join("\n");
}
