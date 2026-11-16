// SPDX-License-Identifier: AGPL-3.0-or-later

export function isWsCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

export function skipWs(text: string, idx: number): number {
  let i = idx;
  while (i < text.length && isWsCode(text.charCodeAt(i))) i++;
  return i;
}

export function isDigitCode(code: number): boolean {
  return code >= 48 && code <= 57;
}

export function isAsciiLetterCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

export function isIdentStartCode(code: number): boolean {
  return isAsciiLetterCode(code) || code === 95;
}

export function isIdentContCode(code: number): boolean {
  return isIdentStartCode(code) || isDigitCode(code);
}

export function isQualifiedTokenCode(code: number): boolean {
  return (
    isIdentContCode(code) ||
    code === 45 || // -
    code === 58 || // :
    code === 35 || // #
    code === 46 || // .
    code === 47 // /
  );
}

/**
 * Reads an identifier starting at `idx`. Returns undefined if `text[idx]` is not an ident start.
 */
export function readIdentAt(text: string, idx: number): { token: string; next: number } | undefined {
  if (idx >= text.length || !isIdentStartCode(text.charCodeAt(idx))) return undefined;
  let i = idx + 1;
  while (i < text.length && isIdentContCode(text.charCodeAt(i))) i++;
  return { token: text.slice(idx, i), next: i };
}

/**
 * Extracts `[a-zA-Z0-9_]+` word spanning `offset`.
 */
export function extractWordAtOffset(text: string, offset: number): { token: string; start: number; end: number } {
  let start = offset;
  while (start > 0 && isIdentContCode(text.charCodeAt(start - 1))) start--;
  let end = offset;
  while (end < text.length && isIdentContCode(text.charCodeAt(end))) end++;
  return { token: text.slice(start, end).trim(), start, end };
}

/**
 * Extracts `[-a-zA-Z0-9_:#./]+` qualified token / URI spanning `offset`.
 */
export function extractQualifiedTokenAtOffset(
  text: string,
  offset: number,
  stripOuterColons = false,
): { token: string; start: number; end: number } {
  let start = offset;
  while (start > 0 && isQualifiedTokenCode(text.charCodeAt(start - 1))) start--;
  let end = offset;
  while (end < text.length && isQualifiedTokenCode(text.charCodeAt(end))) end++;
  let token = text.slice(start, end).trim();
  if (stripOuterColons) {
    let ts = 0;
    while (ts < token.length && token[ts] === ":") ts++;
    let te = token.length;
    while (te > ts && token[te - 1] === ":") te--;
    token = token.slice(ts, te);
  }
  return { token, start, end };
}

export function uriBasename(uri: string): string {
  const idx = uri.lastIndexOf("/");
  return idx !== -1 && idx + 1 < uri.length ? uri.slice(idx + 1) : uri;
}

export function extractLeafSymbolName(name: string): string {
  const dc = name.lastIndexOf("::");
  const dot = name.lastIndexOf(".");
  const cut = Math.max(dc !== -1 ? dc + 2 : -1, dot !== -1 ? dot + 1 : -1);
  return cut > 0 && cut < name.length ? name.slice(cut) : name;
}

export function stripNamespacePrefix(iri: string): string {
  const idx = iri.indexOf(":");
  return idx > 0 ? iri.slice(idx + 1) : iri;
}

export function splitLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      const end = i > start && text[i - 1] === "\r" ? i - 1 : i;
      lines.push(text.slice(start, end));
      start = i + 1;
    }
  }
  lines.push(text.slice(start));
  return lines;
}

export interface NumericSpan {
  text: string;
  start: number;
  end: number;
}

/**
 * Reads an unsigned or optionally signed numeric literal starting at `idx`.
 */
export function readNumericLiteralAt(
  text: string,
  idx: number,
  options?: { allowSign?: boolean; allowUnitSuffix?: boolean },
): NumericSpan | undefined {
  let i = idx;
  if (options?.allowSign && i < text.length && (text[i] === "+" || text[i] === "-")) {
    i++;
  }
  const intStart = i;
  while (i < text.length && isDigitCode(text.charCodeAt(i))) i++;
  if (i === intStart) return undefined;
  if (i + 1 < text.length && text[i] === "." && isDigitCode(text.charCodeAt(i + 1))) {
    i++;
    while (i < text.length && isDigitCode(text.charCodeAt(i))) i++;
  }
  if (i < text.length && (text[i] === "e" || text[i] === "E")) {
    let exp = i + 1;
    if (exp < text.length && (text[exp] === "+" || text[exp] === "-")) exp++;
    const expDigits = exp;
    while (exp < text.length && isDigitCode(text.charCodeAt(exp))) exp++;
    if (exp > expDigits) i = exp;
  }
  if (options?.allowUnitSuffix && i < text.length && isAsciiLetterCode(text.charCodeAt(i))) {
    if (i + 1 >= text.length || !isIdentContCode(text.charCodeAt(i + 1))) {
      i++;
    }
  }
  return { text: text.slice(idx, i), start: idx, end: i };
}

/**
 * Scans all numeric literals (including signs, scientific notation, and optional single-letter SPICE suffixes)
 * in a line.
 */
export function scanNumericTokensInLine(line: string): NumericSpan[] {
  const out: NumericSpan[] = [];
  let i = 0;
  while (i < line.length) {
    const prevOk = i === 0 || !isIdentContCode(line.charCodeAt(i - 1));
    const isSignedStart =
      (line[i] === "+" || line[i] === "-") && i + 1 < line.length && isDigitCode(line.charCodeAt(i + 1));
    if (prevOk && (isDigitCode(line.charCodeAt(i)) || isSignedStart)) {
      const span = readNumericLiteralAt(line, i, { allowSign: true, allowUnitSuffix: true });
      if (span && (span.end >= line.length || !isIdentContCode(line.charCodeAt(span.end)))) {
        out.push(span);
        i = span.end;
        continue;
      }
    }
    i++;
  }
  return out;
}

/**
 * Finds the first `(= | := | :) <number>` assignment value in a line and returns the value span.
 */
export function findAssignedNumberInLine(
  line: string,
  options?: { allowSingleColon?: boolean; allowSign?: boolean; allowExponent?: boolean },
): NumericSpan | undefined {
  for (let i = 0; i < line.length; i++) {
    let afterOp = -1;
    if (line[i] === ":" && line[i + 1] === "=") {
      afterOp = i + 2;
    } else if (line[i] === "=") {
      afterOp = i + 1;
    } else if (options?.allowSingleColon && line[i] === ":") {
      afterOp = i + 1;
    }
    if (afterOp === -1) continue;
    const valStart = skipWs(line, afterOp);
    const span = readNumericLiteralAt(line, valStart, { allowSign: Boolean(options?.allowSign) });
    if (span) {
      if (!options?.allowExponent) {
        const eLow = span.text.indexOf("e");
        const eUp = span.text.indexOf("E");
        const ePos = eLow !== -1 && eUp !== -1 ? Math.min(eLow, eUp) : Math.max(eLow, eUp);
        if (ePos > 0) {
          return { text: span.text.slice(0, ePos), start: span.start, end: span.start + ePos };
        }
      }
      return span;
    }
  }
  return undefined;
}

/**
 * Finds `<varName>(...)? = <signed-number>` anywhere in `text`, returning the RHS numeric span.
 */
export function findScalarAssignmentValue(text: string, shortVar: string): NumericSpan | undefined {
  if (!shortVar) return undefined;
  let pos = 0;
  while (pos < text.length) {
    const idx = text.indexOf(shortVar, pos);
    if (idx === -1) return undefined;
    const beforeOk = idx === 0 || !isIdentContCode(text.charCodeAt(idx - 1));
    const endIdx = idx + shortVar.length;
    const afterOk = endIdx >= text.length || !isIdentContCode(text.charCodeAt(endIdx));
    if (beforeOk && afterOk) {
      let cur = skipWs(text, endIdx);
      if (text[cur] === "(") {
        const closeParen = text.indexOf(")", cur + 1);
        if (closeParen !== -1) {
          cur = skipWs(text, closeParen + 1);
        }
      }
      if (text[cur] === "=") {
        const valPos = skipWs(text, cur + 1);
        const span = readNumericLiteralAt(text, valPos, { allowSign: true });
        if (span) return span;
      }
    }
    pos = idx + shortVar.length;
  }
  return undefined;
}

export interface CrossDomainLineHints {
  cadCallPart?: string | undefined;
  cadAnyPart?: string | undefined;
  twin?: string | undefined;
}

export function isAsciiUpperCode(code: number): boolean {
  return code >= 65 && code <= 90;
}

export function stripFileExtension(fileName: string): string {
  const sep = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"));
  const dot = fileName.lastIndexOf(".");
  return dot > sep + 1 ? fileName.slice(0, dot) : fileName;
}

export function trimOuterChars(text: string, leadingChars: string, trailingChars: string): string {
  let start = 0;
  while (start < text.length && leadingChars.includes(text[start]!)) start++;
  let end = text.length;
  while (end > start && trailingChars.includes(text[end - 1]!)) end--;
  return text.slice(start, end);
}

export function trimTrailingChars(text: string, trailingChars: string): string {
  return trimOuterChars(text, "", trailingChars);
}

/**
 * Extracts the inner content of the first double-quoted (or single-quoted) literal,
 * respecting backslash escapes.
 */
export function extractFirstQuotedLiteral(text: string, allowSingleQuote = false): string | undefined {
  for (let i = 0; i < text.length; i++) {
    const q = text[i];
    if (q !== '"' && (!allowSingleQuote || q !== "'")) continue;
    let j = i + 1;
    while (j < text.length) {
      if (text[j] === "\\") {
        j += 2;
        continue;
      }
      if (text[j] === q) {
        return text.slice(i + 1, j);
      }
      j++;
    }
  }
  return undefined;
}

/**
 * Extracts `@mesh_source: <path>` directive targets without regex.
 */
export function extractMeshSourceDirectives(text: string): string[] {
  const results: string[] = [];
  const lower = text.toLowerCase();
  const marker = "@mesh_source:";
  let pos = 0;
  while (pos < lower.length) {
    const idx = lower.indexOf(marker, pos);
    if (idx === -1) break;
    const valStart = skipWs(text, idx + marker.length);
    let valEnd = valStart;
    while (valEnd < text.length && !isWsCode(text.charCodeAt(valEnd))) valEnd++;
    if (valEnd > valStart) {
      results.push(text.slice(valStart, valEnd));
    }
    pos = valEnd;
  }
  return results;
}

const MODELICA_DECL_KEYWORDS = new Set([
  "model",
  "class",
  "block",
  "record",
  "package",
  "connector",
  "function",
  "type",
  "operator",
  "optimization",
]);

/**
 * Finds the start offset of `(<modelica-keyword>) <className>` on word boundaries without regex.
 */
export function findModelicaClassKeywordOffset(text: string, className: string): number {
  if (!className) return -1;
  let i = 0;
  while (i < text.length) {
    if (isIdentStartCode(text.charCodeAt(i))) {
      const prevOk = i === 0 || !isIdentContCode(text.charCodeAt(i - 1));
      const kw = readIdentAt(text, i)!;
      if (prevOk && MODELICA_DECL_KEYWORDS.has(kw.token)) {
        const wsEnd = skipWs(text, kw.next);
        if (wsEnd > kw.next) {
          const nameTok = readIdentAt(text, wsEnd);
          if (nameTok && nameTok.token === className) {
            return i;
          }
        }
      }
      i = kw.next;
    } else {
      i++;
    }
  }
  return -1;
}

function skipModelicaWsAndComments(text: string, idx: number): number {
  let i = idx;
  while (i < text.length) {
    if (isWsCode(text.charCodeAt(i))) {
      i++;
    } else if (text.startsWith("//", i)) {
      const nl = text.indexOf("\n", i + 2);
      i = nl === -1 ? text.length : nl + 1;
    } else if (text.startsWith("/*", i)) {
      const close = text.indexOf("*/", i + 2);
      i = close === -1 ? text.length : close + 2;
    } else {
      break;
    }
  }
  return i;
}

/**
 * Checks whether `text` begins with a Modelica class/within header (`within`, `model`, `pure function`, etc.).
 */
export function hasModelicaClassDefPrefix(text: string): boolean {
  const start = skipModelicaWsAndComments(text, 0);
  const first = readIdentAt(text, start);
  if (!first) return false;
  if (first.token === "within" || MODELICA_DECL_KEYWORDS.has(first.token)) {
    return true;
  }
  if (first.token === "pure" || first.token === "impure") {
    const nextStart = skipModelicaWsAndComments(text, first.next);
    const second = readIdentAt(text, nextStart);
    return second?.token === "function";
  }
  return false;
}

function readQuotedAttrInSpan(
  text: string,
  attrNamesLower: string[],
  limitEnd: number,
  allowSingleQuote = false,
): string | undefined {
  const lower = text.slice(0, limitEnd).toLowerCase();
  for (const attr of attrNamesLower) {
    let pos = 0;
    while (pos < lower.length) {
      const idx = lower.indexOf(attr, pos);
      if (idx === -1) break;
      const prevOk = idx === 0 || !isIdentContCode(lower.charCodeAt(idx - 1));
      const afterName = idx + attr.length;
      if (prevOk && !isIdentContCode(lower.charCodeAt(afterName))) {
        let cur = skipWs(text, afterName);
        if (text[cur] === "=") {
          cur = skipWs(text, cur + 1);
          const q = text[cur];
          if (q === '"' || (allowSingleQuote && q === "'")) {
            const qEnd = text.indexOf(q, cur + 1);
            if (qEnd !== -1 && qEnd <= limitEnd) {
              return text.slice(cur + 1, qEnd);
            }
          }
        }
      }
      pos = afterName;
    }
  }
  return undefined;
}

/**
 * Scans `text` for `<callName>(... <attr>=["']val["'] ...)` without regex.
 */
export function extractNamedCallAttr(
  text: string,
  callNameLower: string,
  attrNamesLower: string[],
  allowSingleQuote = false,
): string | undefined {
  const lower = text.toLowerCase();
  let pos = 0;
  while (pos < lower.length) {
    const idx = lower.indexOf(callNameLower, pos);
    if (idx === -1) break;
    const prevOk = idx === 0 || !isIdentContCode(lower.charCodeAt(idx - 1));
    const afterName = skipWs(text, idx + callNameLower.length);
    if (prevOk && text[afterName] === "(") {
      const closeIdx = text.indexOf(")", afterName + 1);
      if (closeIdx !== -1) {
        const val = readQuotedAttrInSpan(
          text.slice(afterName + 1, closeIdx),
          attrNamesLower,
          closeIdx - afterName - 1,
          allowSingleQuote,
        );
        if (val !== undefined) return val;
      }
    }
    pos = idx + callNameLower.length;
  }
  return undefined;
}

/**
 * Zero-regex extractor for CAD visual viewer annotations (`CAD(...)`)
 * and deprecated explicit `twin`/`counterpart`/`implements` override attributes on a line.
 */
export function extractCrossDomainLineHints(lineText: string): CrossDomainLineHints {
  const hints: CrossDomainLineHints = {};

  // 1. CAD(uri="...", feature/part="...") visual asset / explicit CAD annotation
  const callVal = extractNamedCallAttr(lineText, "cad", ["feature", "part"]);
  if (callVal) {
    hints.cadCallPart = callVal;
    hints.cadAnyPart = callVal;
  }

  // 2. Legacy explicit twin="..." / counterpart="..." / implements="..." override
  hints.twin = readQuotedAttrInSpan(lineText, ["twin", "counterpart", "implements"], lineText.length);

  return hints;
}

const BIOMEDICAL_CONTEXT_TERMS = ["ventricle", "atrium", "myocardium", "pacemaker", "cannula", "catheter", "stent"];

export function hasBiomedicalContext(text: string): boolean {
  const lower = text.toLowerCase();
  return BIOMEDICAL_CONTEXT_TERMS.some((term) => lower.includes(term));
}

export function isStepExtensionPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".step") || lower.endsWith(".stp") || lower.endsWith(".p21");
}

/**
 * Parses STEP entity reference tokens like `#123` or `cad://assy.step#123`.
 */
export function parseStepReferenceToken(cand: string): { targetFile?: string; entityNum: string } | undefined {
  const hashIdx = cand.indexOf("#");
  if (hashIdx === -1) return undefined;
  let digitEnd = hashIdx + 1;
  while (digitEnd < cand.length && isDigitCode(cand.charCodeAt(digitEnd))) digitEnd++;
  if (digitEnd === hashIdx + 1) return undefined;
  const entityNum = cand.slice(hashIdx + 1, digitEnd);

  let prefix = cand.slice(0, hashIdx);
  const lowerPrefix = prefix.toLowerCase();
  if (lowerPrefix.startsWith("cad://")) prefix = prefix.slice(6);
  else if (lowerPrefix.startsWith("file://")) prefix = prefix.slice(7);

  if (prefix && isStepExtensionPath(prefix)) {
    return { targetFile: prefix, entityNum };
  }
  return { entityNum };
}

export function countChar(text: string, ch: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ch) count++;
  }
  return count;
}

export function leadingWhitespace(line: string): string {
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t" || isWsCode(line.charCodeAt(i)))) i++;
  return line.slice(0, i);
}

export function stripAnyPrefix(text: string, prefixes: string[]): string {
  for (const p of prefixes) {
    if (text.startsWith(p)) return text.slice(p.length);
  }
  return text;
}

const MODELICA_TYPE_QUALIFIERS = new Set(["flow", "stream", "discrete", "parameter", "constant", "input", "output"]);

/**
 * Extracts leading type specifier from a Modelica component declaration line
 * after optional prefix keywords (`flow`, `parameter`, etc.).
 */
export function extractModelicaTypeFromDeclLine(declLine: string): string | undefined {
  let pos = skipWs(declLine, 0);
  while (pos < declLine.length) {
    const tok = readIdentAt(declLine, pos);
    if (!tok) return undefined;
    if (MODELICA_TYPE_QUALIFIERS.has(tok.token)) {
      const nextPos = skipWs(declLine, tok.next);
      if (nextPos === tok.next) return undefined;
      pos = nextPos;
      continue;
    }
    let end = tok.next;
    while (end < declLine.length && (declLine[end] === "." || isIdentContCode(declLine.charCodeAt(end)))) {
      end++;
    }
    const wsAfter = skipWs(declLine, end);
    if (wsAfter === end) return undefined;
    return declLine.slice(pos, end).trim();
  }
  return undefined;
}

/**
 * Extracts `within <Package.Path>;` from a Modelica file header without regex.
 */
export function extractWithinPackageName(text: string): string | undefined {
  for (const line of splitLines(text)) {
    const start = skipWs(line, 0);
    if (!line.startsWith("within", start)) continue;
    const afterKw = start + 6;
    if (afterKw < line.length && isIdentContCode(line.charCodeAt(afterKw))) continue;
    const pkgStart = skipWs(line, afterKw);
    let pkgEnd = pkgStart;
    while (pkgEnd < line.length && (isIdentContCode(line.charCodeAt(pkgEnd)) || line.charCodeAt(pkgEnd) === 46)) {
      pkgEnd++;
    }
    if (pkgEnd > pkgStart) {
      const semi = skipWs(line, pkgEnd);
      if (line[semi] === ";") {
        return line.slice(pkgStart, pkgEnd).trim();
      }
    }
  }
  return undefined;
}

const SAFE_PKG_NESTED_KEYWORDS = new Set(["model", "block", "connector", "function", "package", "record", "type"]);

/**
 * Locates `package <Name>` and the first top-of-line nested Modelica class definition offset.
 */
export function extractModelicaPackageAndNestedSplit(
  text: string,
): { pkgName: string; nestedOffset: number } | undefined {
  let pkgName: string | undefined;
  let searchFrom = -1;
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf("package", i);
    if (idx === -1) return undefined;
    const prevOk = idx === 0 || !isIdentContCode(text.charCodeAt(idx - 1));
    const afterKw = idx + 7;
    if (prevOk && afterKw < text.length && isWsCode(text.charCodeAt(afterKw))) {
      const wsEnd = skipWs(text, afterKw);
      const nameTok = readIdentAt(text, wsEnd);
      if (nameTok) {
        pkgName = nameTok.token;
        searchFrom = nameTok.next;
        break;
      }
    }
    i = afterKw;
  }
  if (!pkgName || searchFrom < 0) return undefined;

  let lineStart = text.indexOf("\n", searchFrom);
  while (lineStart !== -1) {
    let cur = lineStart + 1;
    while (cur < text.length && (text[cur] === " " || text[cur] === "\t")) cur++;
    const kw = readIdentAt(text, cur);
    if (kw && SAFE_PKG_NESTED_KEYWORDS.has(kw.token)) {
      let ws = kw.next;
      while (ws < text.length && (text[ws] === " " || text[ws] === "\t")) ws++;
      if (ws > kw.next) {
        const cls = readIdentAt(text, ws);
        if (cls) {
          return { pkgName, nestedOffset: lineStart };
        }
      }
    }
    lineStart = text.indexOf("\n", lineStart + 1);
  }
  return undefined;
}

/**
 * Extracts `uses(Pkg(version="1.2.3"))` entries from a Modelica annotation without regex.
 */
export function extractModelicaUsesDeps(text: string): Array<{ name: string; version: string }> {
  const deps: Array<{ name: string; version: string }> = [];
  let scan = 0;
  while (scan < text.length) {
    const idx = text.indexOf("uses", scan);
    if (idx === -1) break;
    const prevOk = idx === 0 || !isIdentContCode(text.charCodeAt(idx - 1));
    const openPos = skipWs(text, idx + 4);
    if (prevOk && !isIdentContCode(text.charCodeAt(idx + 4)) && text[openPos] === "(") {
      let depth = 1;
      let endIdx = openPos + 1;
      while (endIdx < text.length && depth > 0) {
        if (text[endIdx] === "(") depth++;
        else if (text[endIdx] === ")") depth--;
        endIdx++;
      }
      const body = text.slice(openPos + 1, Math.max(openPos + 1, endIdx - 1));
      let p = 0;
      while (p < body.length) {
        const pkgTok = readIdentAt(body, p);
        if (!pkgTok) {
          p++;
          continue;
        }
        const argOpen = skipWs(body, pkgTok.next);
        if (body[argOpen] === "(") {
          const argClose = body.indexOf(")", argOpen + 1);
          if (argClose !== -1) {
            const ver = readQuotedAttrInSpan(body.slice(argOpen + 1, argClose), ["version"], argClose - argOpen - 1);
            if (ver) {
              deps.push({ name: pkgTok.token, version: ver });
            }
            p = argClose + 1;
            continue;
          }
        }
        p = pkgTok.next;
      }
      break;
    }
    scan = idx + 4;
  }
  return deps;
}

/**
 * Extracts `@LibraryDependency { ... }` / `@ComplianceProfile { ... }` metadata without regex.
 */
export function extractSysmlAtAnnotationDeps(
  text: string,
  marker: string,
  nameKeys: string[],
): Array<{ name: string; version: string }> {
  const deps: Array<{ name: string; version: string }> = [];
  let pos = 0;
  while (pos < text.length) {
    const idx = text.indexOf(marker, pos);
    if (idx === -1) break;
    const braceOpen = skipWs(text, idx + marker.length);
    if (text[braceOpen] === "{") {
      const braceClose = text.indexOf("}", braceOpen + 1);
      if (braceClose !== -1) {
        const body = text.slice(braceOpen + 1, braceClose);
        const pkgName = readQuotedAttrInSpan(body, nameKeys, body.length);
        if (pkgName) {
          const ver = readQuotedAttrInSpan(body, ["version"], body.length) ?? "1.0.0";
          deps.push({ name: pkgName, version: ver });
        }
        pos = braceClose + 1;
        continue;
      }
    }
    pos = idx + marker.length;
  }
  return deps;
}
