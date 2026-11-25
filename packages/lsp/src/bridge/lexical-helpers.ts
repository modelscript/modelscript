// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode } from "@modelscript/dsl";

export const MODELICA_ELEMENT_PREFIXES = new Set(["redeclare", "final", "inner", "outer", "replaceable"]);

export const MODELICA_COMPONENT_PREFIXES = new Set([
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

export const MODELICA_CLASS_MODIFIERS = new Set(["encapsulated", "partial", "expandable"]);

export const MODELICA_CLASS_KINDS = new Set([
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

export const MODELICA_CLAUSE_STOP_KEYWORDS = new Set([
  ...MODELICA_CLASS_KINDS,
  "within",
  "extends",
  "equation",
  "algorithm",
]);

export function isIdentStartChar(ch: string): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

export function isIdentChar(ch: string): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

export function isWsChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\v" || ch === "\f";
}

export function skipWs(src: string, idx: number): number {
  let i = idx;
  while (i < src.length && isWsChar(src[i]!)) i++;
  return i;
}

export function trimEndHorizontalWs(str: string): string {
  let end = str.length;
  while (end > 0 && (str[end - 1] === " " || str[end - 1] === "\t")) end--;
  return end === str.length ? str : str.slice(0, end);
}

export function stripWs(str: string): string {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!;
    if (!isWsChar(ch)) out += ch;
  }
  return out;
}

export function collapseWs(str: string): string {
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

export function normalizeHeaderWhitespace(str: string): string {
  return str
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

export function stripTrailingSemicolon(str: string): string {
  let s = str.trim();
  if (s.endsWith(";")) {
    s = s.slice(0, -1).trimEnd();
  }
  return s;
}

export function normalizeTrailingSemicolon(str: string): string {
  const trimmed = str.trim();
  if (trimmed.endsWith(";")) {
    return `${trimmed.slice(0, -1).trimEnd()};`;
  }
  return trimmed;
}

export function ensureTrailingSemicolon(str: string): string {
  const trimmed = str.trim();
  if (!trimmed) return "";
  return trimmed.endsWith(";") ? `${trimmed.slice(0, -1).trimEnd()};` : `${trimmed};`;
}

export function splitQualifiedPath(str: string): string[] {
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

export function isWordBoundaryAt(src: string, idx: number, len: number): boolean {
  const prev = idx > 0 ? src[idx - 1]! : "";
  const next = idx + len < src.length ? src[idx + len]! : "";
  return !isIdentChar(prev) && !isIdentChar(next);
}

export function startsWithWordAt(src: string, idx: number, word: string, caseInsensitive = false): boolean {
  if (idx + word.length > src.length) return false;
  const slice = src.slice(idx, idx + word.length);
  const matches = caseInsensitive ? slice.toLowerCase() === word.toLowerCase() : slice === word;
  return matches && isWordBoundaryAt(src, idx, word.length);
}

export function skipModelicaString(src: string, idx: number): number {
  if (src[idx] !== '"') return idx;
  let i = idx + 1;
  while (i < src.length) {
    if (src[i] === "\\") i += 2;
    else if (src[i] === '"') return i + 1;
    else i++;
  }
  return i;
}

export function skipModelicaConcatString(src: string, idx: number): number {
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

export function skipModelicaTrivia(src: string, idx: number): number {
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

export function readIdentAt(src: string, idx: number): { ident: string; end: number } | null {
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

export function readQualifiedNameAt(src: string, idx: number): { name: string; end: number } | null {
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

export function findWordOutsideStringsComments(src: string, word: string, maxOffset = src.length): number {
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

export function matchTrailingEndClass(src: string, className: string): number {
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

export function matchNestedLongClassStart(body: string, startIdx: number): { name: string; end: number } | null {
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

export function parseModelicaClausePrefixTokens(
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

export function extractTrailingModelicaString(src: string): string | null {
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

export function pushFormattedMemberLines(memberLines: string[], cleanedStmt: string): void {
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

export function assembleClassSignature(header: string, memberLines: string[], className: string): string {
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

export function stripOuterQuotes(str: string): string {
  let start = 0;
  let end = str.length;
  if (end > start && str[start] === '"') start++;
  if (end > start && str[end - 1] === '"') end--;
  return str.slice(start, end);
}

/**
 * Unescapes a Modelica string literal (or `"..." + "..."` concatenation) and strips outer quotes.
 */
export function unescapeModelicaString(raw: string): string {
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

export function stripSysmlDocBlocks(src: string): string {
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

export function stripTrailingStringCommentAndSemi(str: string, _declNode?: SyntaxNode | null): string {
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

export function stripCommentBlockBody(rawBody: string): string {
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

export function extractLeadingCommentDoc(beforeDecl: string): string | null {
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

export function extractSysmlDocBlockContent(rawSpan: string): string | null {
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
