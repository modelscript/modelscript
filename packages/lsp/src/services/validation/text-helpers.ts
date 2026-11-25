// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryEngine, SyntaxNode, UnifiedWorkspace } from "@modelscript/runtime";
import type { Range } from "vscode-languageserver";

export interface WasmLintDiagnostic {
  startOffset?: number;
  endOffset?: number;
  range?: Range;
  message?: string;
  code?: string | number;
  lintName?: string;
  severity?: number;
}

export interface EngineLintDiagnosticLike {
  startOffset: number;
  endOffset: number;
  severity: "error" | "warning" | "info" | string;
  code?: string | number | undefined;
  lintName?: string | undefined;
  message: string;
}

export type ValidationQueryEngine = QueryEngine & {
  preflight?: (symbolIds: number[], phases: string[]) => Promise<void> | void;
  setCancellationChecker?: (fn: (() => boolean) | null, pollInterval?: number) => void;
  runAllLintsAsync?: (
    uri: string,
    shouldYield: () => Promise<boolean>,
    viewport?: { startOffset?: number | undefined; endOffset?: number | undefined },
  ) => Promise<EngineLintDiagnosticLike[]>;
};

export interface SharedContextWorkspaceBridge {
  attachExternalUnifiedWorkspace?: (uw: UnifiedWorkspace) => void;
  syncExternalWorkspace?: () => void;
  __attachedExternalUw?: unknown;
}

export interface PolyglotTreeLike {
  rootNode?: SyntaxNode | null | undefined;
}

export function isWsChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v";
}

export function findFirstNonWsIndex(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (!isWsChar(line[i]!)) return i;
  }
  return -1;
}

export function isAsciiLetter(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

export function isIdentStartChar(ch: string): boolean {
  return isAsciiLetter(ch) || ch === "_";
}

export function isWordTokenChar(ch: string): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return isIdentStartChar(ch) || (c >= 48 && c <= 57);
}

export function isChainTokenChar(ch: string): boolean {
  return isWordTokenChar(ch) || ch === "." || ch === ":";
}

export function extractDigitsOnly(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) out += s[i]!;
  }
  return out;
}

export function splitLinesPreserve(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      const end = i > start && text.charCodeAt(i - 1) === 13 ? i - 1 : i;
      lines.push(text.slice(start, end));
      start = i + 1;
    }
  }
  lines.push(text.slice(start));
  return lines;
}

export function stripFileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
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

export function hasWordMatch(text: string, word: string): boolean {
  return findNextWordMatchIndex(text, word, 0) !== -1;
}

export function hasConnectCallPrefix(stmtPrefix: string): boolean {
  let pos = 0;
  while (pos < stmtPrefix.length) {
    const idx = findNextWordMatchIndex(stmtPrefix, "connect", pos);
    if (idx === -1) return false;
    let p = idx + "connect".length;
    while (p < stmtPrefix.length && isWsChar(stmtPrefix[p]!)) p++;
    if (stmtPrefix[p] === "(") return true;
    pos = idx + "connect".length;
  }
  return false;
}

export function collectCstNodesByTypes(root: SyntaxNode | null | undefined, types: string[]): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  if (!root) return out;
  const typeSet = new Set(types);
  const visit = (n: SyntaxNode) => {
    if (typeSet.has(n.type)) out.push(n);
    for (const ch of n.children || []) visit(ch);
  };
  visit(root);
  return out;
}

export function stripLeadingKeywordPrefixes(text: string, phrases: string[]): string {
  const trimmed = text.trimStart();
  for (const phrase of phrases) {
    const words = phrase.split(" ").filter(Boolean);
    let p = 0;
    let matched = true;
    for (let wIdx = 0; wIdx < words.length; wIdx++) {
      const w = words[wIdx]!;
      while (p < trimmed.length && isWsChar(trimmed[p]!)) p++;
      if (!trimmed.startsWith(w, p)) {
        matched = false;
        break;
      }
      p += w.length;
      if (p >= trimmed.length || !isWsChar(trimmed[p]!)) {
        matched = false;
        break;
      }
      while (p < trimmed.length && isWsChar(trimmed[p]!)) p++;
    }
    if (matched) return trimmed.slice(p);
  }
  return text;
}

export function extractLeadingNumericAfterEquals(text: string): number | null {
  const eq = text.indexOf("=");
  if (eq === -1) return null;
  let p = eq + 1;
  while (p < text.length && isWsChar(text[p]!)) p++;
  const start = p;
  let sawDigit = false;
  while (p < text.length) {
    const c = text.charCodeAt(p);
    if (c >= 48 && c <= 57) {
      sawDigit = true;
      p++;
    } else if (text[p] === ".") {
      p++;
    } else {
      break;
    }
  }
  if (!sawDigit) return null;
  const num = parseFloat(text.slice(start, p));
  return Number.isFinite(num) ? num : null;
}

export function extractParameterRealLine(line: string, targetName: string): { value: number; nameCol: number } | null {
  let p = 0;
  const skipWs = () => {
    while (p < line.length && isWsChar(line[p]!)) p++;
  };
  const expectWord = (w: string): number | null => {
    skipWs();
    if (!line.startsWith(w, p)) return null;
    const end = p + w.length;
    if (end < line.length && isWordTokenChar(line[end]!)) return null;
    const start = p;
    p = end;
    return start;
  };
  if (expectWord("parameter") === null) return null;
  if (expectWord("Real") === null) return null;
  const nameCol = expectWord(targetName);
  if (nameCol === null) return null;
  skipWs();
  if (line[p] !== "=") return null;
  p++;
  skipWs();
  const start = p;
  let sawDigit = false;
  while (p < line.length) {
    const c = line.charCodeAt(p);
    if (c >= 48 && c <= 57) {
      sawDigit = true;
      p++;
    } else if (line[p] === ".") {
      p++;
    } else {
      break;
    }
  }
  if (!sawDigit) return null;
  const value = parseFloat(line.slice(start, p));
  return Number.isFinite(value) ? { value, nameCol } : null;
}

const isXmlTagIdentChar = (ch: string) => isWordTokenChar(ch) || ch === ":" || ch === "-";
const isGeneralTokenChar = (ch: string) => isChainTokenChar(ch) || ch === "-";

export function measureSyntaxTokenLength(lineText: string, startCol: number): number {
  if (startCol >= lineText.length) return 0;
  const ch = lineText[startCol]!;
  if (ch === "<") {
    let p = startCol + 1;
    if (lineText[p] === "/") p++;
    const tagStart = p;
    while (p < lineText.length && isXmlTagIdentChar(lineText[p]!)) p++;
    if (p > tagStart) return p - startCol;
  }
  if (ch === "[") {
    const close = lineText.indexOf("]", startCol + 1);
    if (close !== -1) return close - startCol + 1;
  }
  if (ch === "$") {
    let p = startCol + 1;
    while (p < lineText.length && isWordTokenChar(lineText[p]!)) p++;
    if (p > startCol + 1) return p - startCol;
  }
  let p = startCol;
  while (p < lineText.length && isGeneralTokenChar(lineText[p]!)) p++;
  return p - startCol;
}
