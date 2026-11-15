// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Closed-Loop Compiler Verification Engine.
 *
 * Implements the 4 sequential verification gates:
 * 1. Gate 1: WASM GLR Syntax & CST Integrity
 * 2. Gate 2: QUDV SI-7 Physical Dimensional Calculus
 * 3. Gate 3: SMT Real Simplex & Octagon DBM Requirement Feasibility
 * 4. Gate 4: DAE Arena Structural Balance (N_eq == N_var) & BLT Causalization
 */

import {
  createSysML2QueryEngine,
  createSysML2WorkspaceIndex,
  extractSysML2Constraints,
  formatDimension,
  isDimensionless,
  loadEmbeddedKerMLStdlib,
  resolveTypeDimension,
  verifyConstraintSet,
  type ExtractedConstraint,
  type SMTRequirementCheckResult,
} from "@modelscript/sysml2";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { findCstNodesByType } from "../utils/ast-utils.js";

let cachedSysml2Parser: any = null;
let cachedModelicaParser: any = null;

const SI_UNIT_WORDS = new Set(["kg", "m", "s", "N", "Pa", "W", "J", "V", "A", "Ohm", "F", "H"]);
const MODELICA_DECL_SKIP_KEYWORDS = new Set(["model", "class", "package", "block", "import", "extends", "annotation"]);
const MODELICA_TYPE_QUALIFIERS = new Set(["public", "protected", "output", "discrete"]);

export function countChar(text: string, target: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === target) count++;
  }
  return count;
}

function isWsCode(code: number): boolean {
  return code === 32 || code === 9 || code === 13 || code === 10 || code === 11 || code === 12;
}

function isDigitCode(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isIdentStartCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

export function isIdentContCode(code: number): boolean {
  return isIdentStartCode(code) || isDigitCode(code);
}

function isAsciiLetterCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

export function isStrictIdentifier(text: string): boolean {
  if (!text || !isIdentStartCode(text.charCodeAt(0))) return false;
  for (let i = 1; i < text.length; i++) {
    if (!isIdentContCode(text.charCodeAt(i))) return false;
  }
  return true;
}

function isUpperStartIdent(text: string): boolean {
  if (!text) return false;
  const first = text.charCodeAt(0);
  if (first < 65 || first > 90) return false;
  for (let i = 1; i < text.length; i++) {
    if (!isIdentContCode(text.charCodeAt(i))) return false;
  }
  return true;
}

export function skipWs(text: string, idx: number): number {
  let i = idx;
  while (i < text.length && isWsCode(text.charCodeAt(i))) i++;
  return i;
}

function removeWs(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (!isWsCode(text.charCodeAt(i))) out += text[i];
  }
  return out;
}

function stripToIdentifierPath(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (isIdentContCode(ch.charCodeAt(0)) || ch === ".") out += ch;
  }
  return out;
}

export function findNextWordIndex(text: string, word: string, fromIndex = 0): number {
  if (!word) return -1;
  let pos = fromIndex;
  while (pos <= text.length - word.length) {
    const idx = text.indexOf(word, pos);
    if (idx === -1) return -1;
    const beforeOk = idx === 0 || !isIdentContCode(text.charCodeAt(idx - 1));
    const afterIdx = idx + word.length;
    const afterOk = afterIdx >= text.length || !isIdentContCode(text.charCodeAt(afterIdx));
    if (beforeOk && afterOk) return idx;
    pos = idx + 1;
  }
  return -1;
}

export function hasWordMatch(text: string, word: string): boolean {
  return findNextWordIndex(text, word, 0) !== -1;
}

function hasAnyWordMatch(text: string, words: readonly string[]): boolean {
  return words.some((w) => hasWordMatch(text, w));
}

function skipLeadingKeyword(text: string, kw: string): number {
  const start = skipWs(text, 0);
  if (!text.startsWith(kw, start)) return -1;
  const end = start + kw.length;
  if (end < text.length && isIdentContCode(text.charCodeAt(end))) return -1;
  return end;
}

export function readIdentAt(text: string, idx: number): { token: string; next: number } | undefined {
  if (idx >= text.length || !isIdentStartCode(text.charCodeAt(idx))) return undefined;
  let end = idx + 1;
  while (end < text.length && isIdentContCode(text.charCodeAt(end))) end++;
  return { token: text.slice(idx, end), next: end };
}

export function readDottedIdentAt(
  text: string,
  idx: number,
  allowColonColon = false,
): { token: string; next: number } | undefined {
  const first = readIdentAt(text, idx);
  if (!first) return undefined;
  let end = first.next;
  while (end < text.length) {
    if (text[end] === "." && end + 1 < text.length && isIdentStartCode(text.charCodeAt(end + 1))) {
      const seg = readIdentAt(text, end + 1);
      if (!seg) break;
      end = seg.next;
      continue;
    }
    if (
      allowColonColon &&
      text.startsWith("::", end) &&
      end + 2 < text.length &&
      isIdentStartCode(text.charCodeAt(end + 2))
    ) {
      const seg = readIdentAt(text, end + 2);
      if (!seg) break;
      end = seg.next;
      continue;
    }
    break;
  }
  return { token: text.slice(idx, end), next: end };
}

export function skipStringLiteral(text: string, quoteIdx: number): number {
  let i = quoteIdx + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === '"') return i + 1;
    i++;
  }
  return text.length;
}

export function findNextWordOutsideQuotes(text: string, word: string, fromIndex = 0): number {
  if (!word) return -1;
  let i = fromIndex;
  while (i <= text.length - word.length) {
    if (text[i] === '"') {
      i = skipStringLiteral(text, i);
      continue;
    }
    if (text.startsWith(word, i)) {
      const beforeOk = i === 0 || !isIdentContCode(text.charCodeAt(i - 1));
      const afterIdx = i + word.length;
      const afterOk = afterIdx >= text.length || !isIdentContCode(text.charCodeAt(afterIdx));
      if (beforeOk && afterOk) return i;
    }
    i++;
  }
  return -1;
}

export function splitSemicolonStatementsWithSpans(text: string): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  let stmtStart = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      i = skipStringLiteral(text, i);
      continue;
    }
    if (ch === ";") {
      const slice = text.slice(stmtStart, i).trim();
      if (slice.length > 0) {
        out.push({ text: slice, start: stmtStart, end: i });
      }
      stmtStart = i + 1;
    }
    i++;
  }
  const tail = text.slice(stmtStart).trim();
  if (tail.length > 0) {
    out.push({ text: tail, start: stmtStart, end: text.length });
  }
  return out;
}

export function splitSemicolonStatementsOutsideQuotes(text: string): string[] {
  return splitSemicolonStatementsWithSpans(text).map((s) => s.text);
}

export function extractModelicaClassNameFromText(
  text: string,
  allowedKinds: readonly string[] = ["model", "class", "block", "connector", "record"],
): string | undefined {
  let bestIdx = Number.MAX_SAFE_INTEGER;
  let bestKind = "";
  for (const kind of allowedKinds) {
    const idx = findNextWordOutsideQuotes(text, kind, 0);
    if (idx !== -1 && idx < bestIdx) {
      bestIdx = idx;
      bestKind = kind;
    }
  }
  if (!bestKind) return undefined;
  const nameStart = skipWs(text, bestIdx + bestKind.length);
  if (nameStart === bestIdx + bestKind.length) return undefined;
  return readIdentAt(text, nameStart)?.token;
}

export function findModelicaSectionSpan(
  text: string,
  sectionKeyword: "equation" | "algorithm",
): { kwStart: number; bodyStart: number; bodyEnd: number; endKwStart: number; endTermText: string } | undefined {
  const kwStart = findNextWordOutsideQuotes(text, sectionKeyword, 0);
  if (kwStart === -1) return undefined;
  const bodyStart = kwStart + sectionKeyword.length;

  const algIdx = sectionKeyword === "equation" ? findNextWordOutsideQuotes(text, "algorithm", bodyStart) : -1;
  const endIdx = findNextWordOutsideQuotes(text, "end", bodyStart);

  let bodyEnd = text.length;
  let endKwStart = text.length;
  let endTermText = "";

  if (algIdx !== -1 && (endIdx === -1 || algIdx < endIdx)) {
    bodyEnd = algIdx;
    endKwStart = algIdx;
    endTermText = "algorithm";
  } else if (endIdx !== -1) {
    bodyEnd = endIdx;
    endKwStart = endIdx;
    const afterEnd = skipWs(text, endIdx + 3);
    const id = readIdentAt(text, afterEnd);
    endTermText = id ? text.slice(endIdx, id.next) : "end";
  }

  return { kwStart, bodyStart, bodyEnd, endKwStart, endTermText };
}

function extractModelicaSectionSpan(text: string, sectionKeyword: "equation" | "algorithm"): string | undefined {
  const span = findModelicaSectionSpan(text, sectionKeyword);
  return span ? text.slice(span.bodyStart, span.bodyEnd) : undefined;
}

export function splitModelicaBeforeEquation(text: string): string {
  const eqIdx = findNextWordOutsideQuotes(text, "equation", 0);
  return eqIdx === -1 ? text : text.slice(0, eqIdx);
}

function hasFunctionCall(text: string, fnName: string): boolean {
  let pos = 0;
  while (pos < text.length) {
    const idx = findNextWordOutsideQuotes(text, fnName, pos);
    if (idx === -1) return false;
    const afterWs = skipWs(text, idx + fnName.length);
    if (text[afterWs] === "(") return true;
    pos = idx + fnName.length;
  }
  return false;
}

function pushModelicaEquations(sectionBody: string, out: string[]): void {
  for (const eq of splitSemicolonStatementsOutsideQuotes(sectionBody)) {
    if (hasFunctionCall(eq, "connect")) {
      out.push(eq, eq);
    } else if (eq.includes("=") || hasFunctionCall(eq, "der")) {
      out.push(eq);
    }
  }
}

function skipModelicaDottedType(text: string, idx: number): number | undefined {
  const first = readIdentAt(text, idx);
  if (!first) return undefined;
  let end = first.next;
  while (end < text.length) {
    const dotPos = skipWs(text, end);
    if (text[dotPos] !== ".") break;
    const nextStart = skipWs(text, dotPos + 1);
    const nextSeg = readIdentAt(text, nextStart);
    if (!nextSeg) break;
    end = nextSeg.next;
  }
  return end;
}

const MODELICA_CLASS_PREFIXES = new Set(["partial", "encapsulated", "expandable"]);
const MODELICA_CLASS_HEADERS = new Set([
  "model",
  "class",
  "block",
  "connector",
  "record",
  "type",
  "package",
  "function",
  "operator",
]);
const MODELICA_SECTION_HEADERS = new Set(["equation", "algorithm", "public", "protected"]);

function stripLeadingModelicaHeader(stmt: string): string {
  let pos = skipWs(stmt, 0);
  while (pos < stmt.length) {
    const tok = readIdentAt(stmt, pos);
    if (!tok) break;
    if (MODELICA_CLASS_PREFIXES.has(tok.token)) {
      pos = skipWs(stmt, tok.next);
      continue;
    }
    if (tok.token === "initial") {
      const nextPos = skipWs(stmt, tok.next);
      const nextTok = readIdentAt(stmt, nextPos);
      if (nextTok && (nextTok.token === "equation" || nextTok.token === "algorithm")) {
        pos = skipWs(stmt, nextTok.next);
        continue;
      }
      break;
    }
    if (MODELICA_SECTION_HEADERS.has(tok.token)) {
      pos = skipWs(stmt, tok.next);
      continue;
    }
    if (MODELICA_CLASS_HEADERS.has(tok.token)) {
      let after = skipWs(stmt, tok.next);
      const nameTok = readIdentAt(stmt, after);
      if (!nameTok) break;
      after = skipWs(stmt, nameTok.next);
      if (stmt[after] === '"') {
        after = skipWs(stmt, skipStringLiteral(stmt, after));
      }
      pos = after;
      continue;
    }
    break;
  }
  return stmt.slice(pos);
}

function extractModelicaClauseDecls(
  clauseNode: any,
): Array<{ varName: string; mods: string; binding?: string | undefined }> {
  const out: Array<{ varName: string; mods: string; binding?: string | undefined }> = [];
  const compDecls = findCstNodesByType(clauseNode, "component_declaration");
  const declNodes = compDecls.length > 0 ? compDecls : findCstNodesByType(clauseNode, "declaration");
  for (const declNode of declNodes) {
    const innerDecl =
      declNode.type === "declaration" ? declNode : (findCstNodesByType(declNode, "declaration")[0] ?? declNode);
    const idNode =
      (innerDecl.children || []).find((gc: any) => gc.type === "identifier" || gc.type === "IDENT") ??
      findCstNodesByType(innerDecl, "identifier")[0] ??
      findCstNodesByType(innerDecl, "IDENT")[0];
    const varName = idNode?.text?.trim();
    if (!varName || !isStrictIdentifier(varName)) continue;
    const modNode =
      (innerDecl.children || []).find((gc: any) => gc.type === "modification") ??
      findCstNodesByType(declNode, "modification")[0];
    const parsedMod = parseModelicaModificationSpan(modNode?.text ?? "");
    out.push({ varName, mods: parsedMod.mods, binding: parsedMod.binding });
  }
  return out;
}

export function extractModelicaStateVarsFromDecls(declPart: string): string[] {
  const vars: string[] = [];
  for (const rawStmt of splitSemicolonStatementsOutsideQuotes(declPart)) {
    const stmt = stripLeadingModelicaHeader(rawStmt);
    const firstTok = readIdentAt(stmt, 0);
    if (firstTok && MODELICA_DECL_SKIP_KEYWORDS.has(firstTok.token)) {
      continue;
    }
    if (hasWordMatch(stmt, "parameter") || hasWordMatch(stmt, "constant") || hasWordMatch(stmt, "input")) {
      continue;
    }

    let pos = 0;
    while (pos < stmt.length) {
      const qual = readIdentAt(stmt, pos);
      if (qual && MODELICA_TYPE_QUALIFIERS.has(qual.token)) {
        const nextPos = skipWs(stmt, qual.next);
        if (nextPos > qual.next) {
          pos = nextPos;
          continue;
        }
      }
      break;
    }

    const afterType = skipModelicaDottedType(stmt, pos);
    if (afterType === undefined) continue;
    const declStart = skipWs(stmt, afterType);
    if (declStart === afterType) continue;

    let declEnd = declStart;
    while (declEnd < stmt.length) {
      const ch = stmt[declEnd]!;
      if (ch === "=" || ch === ";" || ch === "(") break;
      declEnd++;
    }
    if (declEnd <= declStart) continue;

    for (const part of stmt.slice(declStart, declEnd).split(",")) {
      const trimmed = part.trim();
      const ident = readIdentAt(trimmed, 0);
      if (ident && isStrictIdentifier(ident.token)) {
        vars.push(ident.token);
      }
    }
  }
  return vars;
}

export function findBracketedUnitAddMismatchSpan(
  expr: string,
): { u1: string; u2: string; u2Start: number; u2End: number } | undefined {
  let hasUnitWord = false;
  let scanPos = 0;
  while (scanPos < expr.length) {
    const id = readIdentAt(expr, scanPos);
    if (id) {
      if (SI_UNIT_WORDS.has(id.token)) {
        hasUnitWord = true;
        break;
      }
      scanPos = id.next;
    } else {
      scanPos++;
    }
  }
  if (!hasUnitWord) return undefined;

  let i = 0;
  while (i < expr.length) {
    if (expr[i] === "[") {
      let u1End = i + 1;
      while (u1End < expr.length && isAsciiLetterCode(expr.charCodeAt(u1End))) u1End++;
      if (u1End > i + 1 && expr[u1End] === "]") {
        const u1 = expr.slice(i + 1, u1End);
        let j = u1End + 1;
        while (j < expr.length && expr[j] !== "+" && expr[j] !== "[") j++;
        if (expr[j] === "+") {
          let k = j + 1;
          while (k < expr.length && expr[k] !== "[") k++;
          if (expr[k] === "[") {
            let u2End = k + 1;
            while (u2End < expr.length && isAsciiLetterCode(expr.charCodeAt(u2End))) u2End++;
            if (u2End > k + 1 && expr[u2End] === "]") {
              const u2 = expr.slice(k + 1, u2End);
              if (u1 !== u2) {
                return { u1, u2, u2Start: k, u2End: u2End + 1 };
              }
            }
          }
        }
      }
    }
    i++;
  }
  return undefined;
}

function findBracketedUnitAddMismatch(expr: string): { u1: string; u2: string } | undefined {
  const hit = findBracketedUnitAddMismatchSpan(expr);
  return hit ? { u1: hit.u1, u2: hit.u2 } : undefined;
}

function parseModelicaModificationSpan(modText: string): { mods: string; binding?: string | undefined } {
  const trimmed = modText.trim();
  if (!trimmed) return { mods: "" };
  let mods = "";
  let pos = 0;
  if (trimmed[0] === "(") {
    let depth = 0;
    let i = 0;
    while (i < trimmed.length) {
      const ch = trimmed[i]!;
      if (ch === '"') {
        i = skipStringLiteral(trimmed, i);
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          mods = trimmed.slice(1, i);
          pos = i + 1;
          break;
        }
      }
      i++;
    }
  }
  pos = skipWs(trimmed, pos);
  if (trimmed[pos] === "=") {
    const binding = trimmed.slice(pos + 1).trim();
    return binding ? { mods, binding } : { mods };
  }
  return { mods };
}

function extractModelicaTypedDeclsFromText(
  clean: string,
): Array<{ typeName: string; varName: string; rhs?: string | undefined }> {
  const out: Array<{ typeName: string; varName: string; rhs?: string | undefined }> = [];
  for (const rawStmt of splitSemicolonStatementsOutsideQuotes(clean)) {
    const stmt = stripLeadingModelicaHeader(rawStmt);
    let pos = 0;
    while (pos < stmt.length) {
      const qual = readIdentAt(stmt, pos);
      if (qual && MODELICA_TYPE_QUALIFIERS.has(qual.token)) {
        const nextPos = skipWs(stmt, qual.next);
        if (nextPos > qual.next) {
          pos = nextPos;
          continue;
        }
      }
      break;
    }
    const afterType = skipModelicaDottedType(stmt, pos);
    if (afterType === undefined) continue;
    const rawType = removeWs(stmt.slice(pos, afterType));
    const dotIdx = rawType.lastIndexOf(".");
    const shortType = dotIdx !== -1 ? rawType.slice(dotIdx + 1) : rawType;
    if (!isUpperStartIdent(shortType)) continue;
    const afterWs = skipWs(stmt, afterType);
    if (afterWs === afterType) continue;
    const varIdent = readIdentAt(stmt, afterWs);
    if (!varIdent) continue;
    const parsedMod = parseModelicaModificationSpan(stmt.slice(varIdent.next));
    out.push({ typeName: shortType, varName: varIdent.token, rhs: parsedMod.binding });
  }
  return out;
}

export function readSignedNumberAt(
  text: string,
  idx: number,
): { value: number; text: string; next: number } | undefined {
  let i = idx;
  if (i < text.length && (text[i] === "+" || text[i] === "-")) i++;
  const intStart = i;
  while (i < text.length && isDigitCode(text.charCodeAt(i))) i++;
  if (i === intStart) return undefined;
  if (i < text.length && text[i] === "." && i + 1 < text.length && isDigitCode(text.charCodeAt(i + 1))) {
    i++;
    while (i < text.length && isDigitCode(text.charCodeAt(i))) i++;
  }
  if (i < text.length && (text[i] === "e" || text[i] === "E")) {
    let expPos = i + 1;
    if (expPos < text.length && (text[expPos] === "+" || text[expPos] === "-")) expPos++;
    const expDigitsStart = expPos;
    while (expPos < text.length && isDigitCode(text.charCodeAt(expPos))) expPos++;
    if (expPos > expDigitsStart) i = expPos;
  }
  const numStr = text.slice(idx, i);
  const val = Number(numStr);
  return Number.isFinite(val) ? { value: val, text: numStr, next: i } : undefined;
}

function parseLeadingSignedNumber(text: string): number | undefined {
  const start = skipWs(text, 0);
  return readSignedNumberAt(text, start)?.value;
}

function extractNamedNumericAttr(mods: string, attrName: string): number | undefined {
  let pos = 0;
  while (pos < mods.length) {
    const idx = findNextWordIndex(mods, attrName, pos);
    if (idx === -1) return undefined;
    const eqPos = skipWs(mods, idx + attrName.length);
    if (mods[eqPos] === "=") {
      const valStart = skipWs(mods, eqPos + 1);
      const num = readSignedNumberAt(mods, valStart);
      if (num) return num.value;
    }
    pos = idx + attrName.length;
  }
  return undefined;
}

function extractModelicaParamDeclsFromText(
  clean: string,
): Array<{ name: string; mods: string; binding?: string | undefined }> {
  const out: Array<{ name: string; mods: string; binding?: string | undefined }> = [];
  for (const rawStmt of splitSemicolonStatementsOutsideQuotes(clean)) {
    const stmt = stripLeadingModelicaHeader(rawStmt);
    let pos = 0;
    const braceIdx = stmt.lastIndexOf("{");
    if (braceIdx !== -1) pos = skipWs(stmt, braceIdx + 1);

    const first = readIdentAt(stmt, pos);
    if (!first) continue;
    if (first.token === "parameter" || first.token === "constant") {
      pos = skipWs(stmt, first.next);
      if (pos === first.next) continue;
    }
    const typeEnd = skipModelicaDottedType(stmt, pos);
    if (typeEnd === undefined) continue;
    const typeTok = stmt.slice(pos, typeEnd);
    if (typeTok === "parameter" || typeTok === "constant") continue;

    const varStart = skipWs(stmt, typeEnd);
    if (varStart === typeEnd) continue;
    const varIdent = readIdentAt(stmt, varStart);
    if (!varIdent) continue;

    const parsedMod = parseModelicaModificationSpan(stmt.slice(varIdent.next));
    out.push({ name: varIdent.token, mods: parsedMod.mods, binding: parsedMod.binding });
  }
  return out;
}

function extractModelicaAssertCalls(text: string): Array<{ expr: string; msg: string }> {
  const calls: Array<{ expr: string; msg: string }> = [];
  let pos = 0;
  while (pos < text.length) {
    const idx = findNextWordOutsideQuotes(text, "assert", pos);
    if (idx === -1) break;
    const openParen = skipWs(text, idx + 6);
    if (text[openParen] !== "(") {
      pos = idx + 6;
      continue;
    }
    let depth = 0;
    let i = openParen + 1;
    let firstComma = -1;
    let closeParen = -1;
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === '"') {
        i = skipStringLiteral(text, i);
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") {
        if (depth === 0) {
          closeParen = i;
          break;
        }
        depth--;
      } else if (ch === "," && depth === 0 && firstComma === -1) {
        firstComma = i;
      }
      i++;
    }
    if (firstComma !== -1 && closeParen > firstComma) {
      const expr = text.slice(openParen + 1, firstComma).trim();
      const msgStart = skipWs(text, firstComma + 1);
      if (text[msgStart] === '"') {
        const msgEnd = skipStringLiteral(text, msgStart);
        if (msgEnd > msgStart + 2) {
          const msg = text.slice(msgStart + 1, msgEnd - 1);
          calls.push({ expr, msg });
        }
      }
    }
    pos = (closeParen !== -1 ? closeParen : openParen) + 1;
  }
  return calls;
}

function tokenizeModelicaBoolExpr(expr: string): string[] | null {
  const tokens: string[] = [];
  let i = 0;
  const twoCharOps = new Set(["<=", ">=", "==", "!=", "<>", "&&", "||"]);
  const oneCharOps = new Set(["<", ">", "!", "=", "+", "-", "*", "/", "%", "(", ")"]);

  while (i < expr.length) {
    i = skipWs(expr, i);
    if (i >= expr.length) break;
    const two = expr.slice(i, i + 2);
    if (twoCharOps.has(two)) {
      tokens.push(two);
      i += 2;
      continue;
    }
    const ch = expr[i]!;
    if (oneCharOps.has(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    const ident = readIdentAt(expr, i);
    if (ident) {
      tokens.push(ident.token);
      i = ident.next;
      continue;
    }
    if (isDigitCode(ch.charCodeAt(0))) {
      const num = readSignedNumberAt(expr, i);
      if (num) {
        tokens.push(num.text);
        i = num.next;
        continue;
      }
    }
    return null;
  }
  return tokens;
}

export function extractFirstBraceBlock(
  text: string,
  fromIndex = 0,
): { body: string; openIdx: number; closeIdx: number } | undefined {
  let openIdx = -1;
  let i = fromIndex;
  while (i < text.length) {
    if (text[i] === '"') {
      i = skipStringLiteral(text, i);
      continue;
    }
    if (text[i] === "{") {
      openIdx = i;
      break;
    }
    i++;
  }
  if (openIdx === -1) return undefined;
  let depth = 1;
  i = openIdx + 1;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      i = skipStringLiteral(text, i);
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { body: text.slice(openIdx + 1, i), openIdx, closeIdx: i };
      }
    }
    i++;
  }
  return undefined;
}

function hasSysmlAttrInitializer(attrText: string): boolean {
  let i = 0;
  while (i < attrText.length) {
    const ch = attrText[i]!;
    if (ch === '"') {
      i = skipStringLiteral(attrText, i);
      continue;
    }
    if (ch === "{" || ch === ";") return false;
    if (ch === "=") return true;
    i++;
  }
  return false;
}

function hasConstraintEqualityOrBound(body: string): boolean {
  let i = 0;
  while (i < body.length) {
    const ch = body[i]!;
    if (ch === '"') {
      i = skipStringLiteral(body, i);
      continue;
    }
    if (ch === "=") {
      return i > 0 && i + 1 < body.length;
    }
    i++;
  }
  return false;
}

export function parseSysmlComparisonConstraint(
  body: string,
): { lhs: string; operator: "<=" | ">=" | "==" | "<" | ">"; rhs: number } | undefined {
  let i = 0;
  while (i < body.length) {
    const lhsIdent = readDottedIdentAt(body, i, false);
    if (lhsIdent) {
      const opStart = skipWs(body, lhsIdent.next);
      const two = body.slice(opStart, opStart + 2);
      const one = body[opStart];
      let op: "<=" | ">=" | "==" | "<" | ">" | undefined;
      let opEnd = opStart;
      if (two === "<=" || two === ">=" || two === "==") {
        op = two;
        opEnd += 2;
      } else if (one === "<" || one === ">") {
        op = one;
        opEnd += 1;
      }
      if (op) {
        const rhsStart = skipWs(body, opEnd);
        if (rhsStart < body.length && isDigitCode(body.charCodeAt(rhsStart))) {
          const num = readSignedNumberAt(body, rhsStart);
          if (num) {
            return { lhs: lhsIdent.token, operator: op, rhs: num.value };
          }
        }
      }
      i = lhsIdent.next;
    } else {
      i++;
    }
  }
  return undefined;
}

function parseSysmlNumericAttrNode(attrNode: any): { name: string; value: number } | undefined {
  const nameNode =
    attrNode.childForFieldName?.("declaredName") ?? attrNode.children?.find((c: any) => c.type === "Name");
  const name = nameNode?.text?.trim();
  const txt = attrNode.text || "";
  const eqIdx = txt.indexOf("=");
  if (!name || eqIdx === -1) return undefined;
  const valStart = skipWs(txt, eqIdx + 1);
  if (valStart >= txt.length || !isDigitCode(txt.charCodeAt(valStart))) return undefined;
  const num = readSignedNumberAt(txt, valStart);
  return num ? { name, value: num.value } : undefined;
}

export function extractSysmlAttributesFromText(text: string): Array<{
  name: string;
  typeName?: string | undefined;
  hasInitializer: boolean;
  valueText?: string | undefined;
  stmtStart: number;
  stmtEnd: number;
}> {
  const out: Array<{
    name: string;
    typeName?: string | undefined;
    hasInitializer: boolean;
    valueText?: string | undefined;
    stmtStart: number;
    stmtEnd: number;
  }> = [];
  let pos = 0;
  while (pos < text.length) {
    const idx = findNextWordOutsideQuotes(text, "attribute", pos);
    if (idx === -1) break;
    const nameStart = skipWs(text, idx + 9);
    if (nameStart === idx + 9) {
      pos = idx + 9;
      continue;
    }
    const nameIdent = readIdentAt(text, nameStart);
    if (!nameIdent) {
      pos = idx + 9;
      continue;
    }
    const colonPos = skipWs(text, nameIdent.next);
    if (text[colonPos] !== ":") {
      pos = nameIdent.next;
      continue;
    }
    const typeStart = skipWs(text, colonPos + 1);
    const typeIdent = readDottedIdentAt(text, typeStart, true);
    if (!typeIdent) {
      pos = colonPos + 1;
      continue;
    }
    let scan = typeIdent.next;
    let eqPos = -1;
    let semiPos = -1;
    while (scan < text.length) {
      const ch = text[scan]!;
      if (ch === '"') {
        scan = skipStringLiteral(text, scan);
        continue;
      }
      if (
        ch === "{" ||
        (ch === "\n" && eqPos === -1 && semiPos === -1 && text.slice(typeIdent.next, scan).trim().length > 0)
      ) {
        // stop at block opener without initializer
        if (ch === "{") break;
      }
      if (ch === "=" && eqPos === -1) eqPos = scan;
      if (ch === ";") {
        semiPos = scan;
        break;
      }
      scan++;
    }
    if (semiPos !== -1) {
      const valueText = eqPos !== -1 ? text.slice(eqPos + 1, semiPos).trim() : undefined;
      out.push({
        name: nameIdent.token,
        typeName: typeIdent.token,
        hasInitializer: eqPos !== -1,
        valueText,
        stmtStart: idx,
        stmtEnd: semiPos + 1,
      });
      pos = semiPos + 1;
    } else {
      pos = typeIdent.next;
    }
  }
  return out;
}

export function extractSysmlBraceConstraintsFromText(text: string): Array<{
  name?: string | undefined;
  hasAssert: boolean;
  body: string;
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
}> {
  const out: Array<{
    name?: string | undefined;
    hasAssert: boolean;
    body: string;
    start: number;
    end: number;
    bodyStart: number;
    bodyEnd: number;
  }> = [];
  let pos = 0;
  while (pos < text.length) {
    const idx = findNextWordOutsideQuotes(text, "constraint", pos);
    if (idx === -1) break;
    let hasAssert = false;
    let start = idx;
    let back = idx - 1;
    while (back >= 0 && isWsCode(text.charCodeAt(back))) back--;
    if (back >= 5 && text.slice(back - 5, back + 1) === "assert") {
      const assertStart = back - 5;
      if (assertStart === 0 || !isIdentContCode(text.charCodeAt(assertStart - 1))) {
        hasAssert = true;
        start = assertStart;
      }
    }

    let cursor = skipWs(text, idx + 10);
    let name: string | undefined;
    const maybeName = readIdentAt(text, cursor);
    if (maybeName) {
      name = maybeName.token;
      cursor = skipWs(text, maybeName.next);
    }
    if (text[cursor] === "{") {
      const block = extractFirstBraceBlock(text, cursor);
      if (block) {
        let end = block.closeIdx + 1;
        if (text[end] === ";") end++;
        out.push({
          name,
          hasAssert,
          body: block.body,
          start,
          end,
          bodyStart: block.openIdx + 1,
          bodyEnd: block.closeIdx,
        });
        pos = end;
        continue;
      }
    }
    pos = idx + 10;
  }
  return out;
}

function extractSysmlReqAttrBoundsFromText(text: string): Array<{ reqName: string; attrName: string; value: number }> {
  const out: Array<{ reqName: string; attrName: string; value: number }> = [];
  let pos = 0;
  while (pos < text.length) {
    const idx = findNextWordOutsideQuotes(text, "requirement", pos);
    if (idx === -1) break;
    let cursor = skipWs(text, idx + 11);
    const maybeDef = readIdentAt(text, cursor);
    if (maybeDef?.token === "def") {
      cursor = skipWs(text, maybeDef.next);
    }
    const reqIdent = readIdentAt(text, cursor);
    if (!reqIdent) {
      pos = idx + 11;
      continue;
    }
    const braceStart = skipWs(text, reqIdent.next);
    if (text[braceStart] === "{") {
      const block = extractFirstBraceBlock(text, braceStart);
      if (block) {
        for (const attr of extractSysmlAttributesFromText(block.body)) {
          if (attr.hasInitializer && attr.valueText) {
            const num = parseLeadingSignedNumber(attr.valueText);
            if (num !== undefined && attr.valueText.trim().length > 0) {
              out.push({ reqName: reqIdent.token, attrName: attr.name, value: num });
            }
          }
        }
        pos = block.closeIdx + 1;
        continue;
      }
    }
    pos = idx + 11;
  }
  return out;
}

export type ClosedLoopLanguage = "sysml2" | "sysml" | "modelica";

export interface GateDiagnostic {
  gate: 1 | 2 | 3 | 4;
  gateName: "WASM GLR Syntax" | "QUDV Physical Dimensions" | "SMT Requirement Feasibility" | "DAE Structural Balance";
  severity: "error" | "warning";
  message: string;
  line?: number | undefined;
  column?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  code?: string | undefined;
  sourceContext?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface GateVerificationResult {
  gate: 1 | 2 | 3 | 4;
  gateName: "WASM GLR Syntax" | "QUDV Physical Dimensions" | "SMT Requirement Feasibility" | "DAE Structural Balance";
  passed: boolean;
  diagnostics: GateDiagnostic[];
  metadata?:
    | {
        astNodeCount?: number | undefined;
        inferredDimensions?: Record<string, string> | undefined;
        checkedFeatures?: number | undefined;
        isConsistent?: boolean | undefined;
        conflictingRequirements?: string[] | undefined;
        unsatCore?: string[] | undefined;
        numVariables?: number | undefined;
        numEquations?: number | undefined;
        numConstraints?: number | undefined;
        degreesOfFreedom?: number | undefined;
        isBalanced?: boolean | undefined;
        bltBlocksCount?: number | undefined;
        status?: string | undefined;
      }
    | undefined;
}

export interface ClosedLoopCandidateVerification {
  allPassed: boolean;
  gates: GateVerificationResult[];
  summary: string;
  timestamp: string;
}

export interface VerifyCandidateOptions {
  parser?: import("../utils/ast-utils.js").CstParserLike | null | undefined;
  targetGates?: (1 | 2 | 3 | 4)[] | undefined;
  documentUri?: string | undefined;
}

/**
 * Resolves a default WASM parser for the specified language.
 */
export async function getWasmParserForLanguage(
  lang: ClosedLoopLanguage,
): Promise<import("../utils/ast-utils.js").CstParserLike | null> {
  const norm = lang.toLowerCase();
  const plugin = globalLanguageRegistry.getPluginById(norm === "sysml" ? "sysml2" : norm);
  if (plugin?.parser) return plugin.parser;

  if (norm === "sysml2" || norm === "sysml") {
    if (cachedSysml2Parser) return cachedSysml2Parser;
    try {
      const { createRequire } = await import("node:module");
      const req = createRequire(import.meta.url);
      let wasmPath: string | undefined;
      try {
        wasmPath = req.resolve("@modelscript/sysml2/parser.wasm");
      } catch {
        try {
          wasmPath = req.resolve("@modelscript/sysml2/dist/parser.wasm");
        } catch {
          const path = await import("node:path");
          const fs = await import("node:fs");
          const cwd = typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : "/";
          const candidate = path.resolve(cwd, "languages/sysml2/dist/parser.wasm");
          if (fs.existsSync(candidate)) wasmPath = candidate;
        }
      }
      if (wasmPath) {
        const { createWasmParser } = await import("@modelscript/dsl/bindings");
        const { parser } = await createWasmParser(wasmPath);
        cachedSysml2Parser = parser;
        return parser;
      }
    } catch {
      // ignore
    }
  } else if (norm === "modelica") {
    if (cachedModelicaParser) return cachedModelicaParser;
    try {
      const { createRequire } = await import("node:module");
      const req = createRequire(import.meta.url);
      let wasmPath: string | undefined;
      try {
        wasmPath = req.resolve("@modelscript/modelica/parser.wasm");
      } catch {
        try {
          wasmPath = req.resolve("@modelscript/modelica/dist/parser.wasm");
        } catch {
          const path = await import("node:path");
          const fs = await import("node:fs");
          const cwd = typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : "/";
          const candidate = path.resolve(cwd, "languages/modelica/dist/parser.wasm");
          if (fs.existsSync(candidate)) wasmPath = candidate;
        }
      }
      if (wasmPath) {
        const { createWasmParser } = await import("@modelscript/dsl/bindings");
        const { parser } = await createWasmParser(wasmPath);
        cachedModelicaParser = parser;
        return parser;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Gate 1: WASM GLR Syntax Parser & CST Integrity
 */
export async function verifyGate1Syntax(
  code: string,
  language: ClosedLoopLanguage,
  parserOverride?: any,
): Promise<{ result: GateVerificationResult; tree?: any }> {
  const diagnostics: GateDiagnostic[] = [];
  const parser = parserOverride ?? (await getWasmParserForLanguage(language));

  if (!parser) {
    // If no parser is loadable in current environment, do a structural sanity check
    const openBraces = countChar(code, "{");
    const closeBraces = countChar(code, "}");
    if (openBraces !== closeBraces) {
      diagnostics.push({
        gate: 1,
        gateName: "WASM GLR Syntax",
        severity: "error",
        message: `Mismatched brace delimiters: found ${openBraces} '{' vs ${closeBraces} '}'.`,
      });
    }
    return {
      result: {
        gate: 1,
        gateName: "WASM GLR Syntax",
        passed: diagnostics.length === 0,
        diagnostics,
        metadata: { status: "Structural fallback parser used" },
      },
    };
  }

  let tree: any = null;
  try {
    tree = parser.parse(code);
  } catch (err: any) {
    diagnostics.push({
      gate: 1,
      gateName: "WASM GLR Syntax",
      severity: "error",
      message: `Fatal parser exception: ${err?.message ?? String(err)}`,
    });
    return {
      result: {
        gate: 1,
        gateName: "WASM GLR Syntax",
        passed: false,
        diagnostics,
      },
    };
  }

  if (!tree || !tree.rootNode) {
    diagnostics.push({
      gate: 1,
      gateName: "WASM GLR Syntax",
      severity: "error",
      message: "Parser produced an empty syntax tree.",
    });
    return {
      result: {
        gate: 1,
        gateName: "WASM GLR Syntax",
        passed: false,
        diagnostics,
      },
    };
  }

  let nodeCount = 0;
  const walk = (node: any) => {
    if (!node) return;
    nodeCount++;
    const hasErr = typeof node.hasError === "function" ? node.hasError() : Boolean(node.hasError);
    if (!hasErr && node.type !== "ERROR") return;

    const isMissing = typeof node.isMissing === "function" ? node.isMissing() : Boolean(node.isMissing);
    const isError = node.type === "ERROR" || isMissing;

    if (isError) {
      const pos = node.startPosition || { row: 0, column: 0 };
      const snippet = node.text ? node.text.trim() : "";
      diagnostics.push({
        gate: 1,
        gateName: "WASM GLR Syntax",
        severity: "error",
        message: isMissing
          ? `Missing expected syntax token at line ${pos.row + 1}, column ${pos.column + 1}.`
          : `Syntax error near '${snippet || "<unknown>"}' at line ${pos.row + 1}, column ${pos.column + 1}.`,
        line: pos.row + 1,
        column: pos.column + 1,
        startOffset: node.startIndex ?? node.startOffset,
        endOffset: node.endIndex ?? node.endOffset,
        sourceContext: snippet,
      });
    }

    const children = node.children || [];
    for (const child of children) {
      walk(child);
    }
  };

  walk(tree.rootNode);

  // Check delimiter balance
  const openBraces = countChar(code, "{");
  const closeBraces = countChar(code, "}");
  if (openBraces !== closeBraces) {
    diagnostics.push({
      gate: 1,
      gateName: "WASM GLR Syntax",
      severity: "error",
      message: `Syntax error: unbalanced braces (found ${openBraces} '{' vs ${closeBraces} '}').`,
    });
  }

  // Fallback: if tree.rootNode indicates an error but no node was explicitly flagged
  if (
    diagnostics.length === 0 &&
    (typeof tree.rootNode.hasError === "function" ? tree.rootNode.hasError() : Boolean(tree.rootNode.hasError))
  ) {
    diagnostics.push({
      gate: 1,
      gateName: "WASM GLR Syntax",
      severity: "error",
      message: "Syntax error detected in model declaration.",
    });
  }

  return {
    result: {
      gate: 1,
      gateName: "WASM GLR Syntax",
      passed: diagnostics.length === 0,
      diagnostics,
      metadata: { astNodeCount: nodeCount },
    },
    tree,
  };
}

/**
 * Flattens a Modelica candidate model into a DAEBuilder arena using the native
 * @modelscript/modelica Context.flattenArena pipeline when available.
 */
async function flattenModelicaCandidate(
  code: string,
  documentUri = "file:///candidate/model.mo",
  lspContext?: {
    parserService?: {
      sharedContext?: {
        load?(code: string, path: string): void;
        flattenArena?(
          className: string,
          x?: unknown,
          path?: string,
        ):
          | (import("@modelscript/runtime").DAEBuilder & { getVarUnit?(i: number): string | undefined })
          | null
          | undefined;
      };
    };
  },
  existingTree?: import("../utils/ast-utils.js").CstTreeLike | null,
): Promise<{
  arena: (import("@modelscript/runtime").DAEBuilder & { getVarUnit?(i: number): string | undefined }) | null;
  className: string;
  ctx: unknown;
  tree?: import("../utils/ast-utils.js").CstTreeLike | null;
} | null> {
  let localTree: import("../utils/ast-utils.js").CstTreeLike | null = existingTree ?? null;
  let createdLocalTree = false;
  try {
    const uri = documentUri.endsWith(".mo") ? documentUri : "file:///candidate/model.mo";
    const filePath = uri.startsWith("file://") ? uri.slice("file://".length) : uri;
    const parser = await getWasmParserForLanguage("modelica");
    if (!localTree && parser) {
      localTree = parser.parse(code);
      createdLocalTree = true;
    }

    const cstClassNode = localTree?.rootNode
      ? findCstNodesByType(localTree.rootNode, "class_definition")[0]
      : undefined;
    const cstIdNode = cstClassNode ? findCstNodesByType(cstClassNode, "identifier")[0] : undefined;
    const className = cstIdNode?.text?.trim() || extractModelicaClassNameFromText(stripComments(code));
    if (!className) {
      if (createdLocalTree) localTree?.delete?.();
      return null;
    }

    // If lspContext exposes an initialized sharedContext, try it first
    const sharedCtx = lspContext?.parserService?.sharedContext;
    if (sharedCtx && typeof sharedCtx.load === "function" && typeof sharedCtx.flattenArena === "function") {
      try {
        sharedCtx.load(code, filePath);
        const arena = sharedCtx.flattenArena(className, undefined, filePath);
        if (arena) return { arena, className, ctx: sharedCtx, tree: localTree };
      } catch {
        // Fall through to isolated Context
      }
    }

    if (!parser) {
      return localTree ? { arena: null, className, ctx: null, tree: localTree } : null;
    }

    const { Context } = await import("@modelscript/modelica");
    Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);

    const memFiles = new Map<string, string>([[filePath, code]]);
    const memFs = {
      readFile: (p: string) => memFiles.get(p) ?? "",
      exists: (p: string) => memFiles.has(p),
      readDir: () => [] as string[],
      isDir: () => false,
    };

    const ctx = new Context(memFs as unknown as ConstructorParameters<typeof Context>[0], undefined, undefined, {
      loadStdlib: false,
    });
    ctx.load(code, filePath);
    const arena = ctx.flattenArena(className, undefined, filePath) as
      | (import("@modelscript/runtime").DAEBuilder & { getVarUnit?(i: number): string | undefined })
      | null
      | undefined;
    return { arena: arena ?? null, className, ctx, tree: localTree };
  } catch {
    if (createdLocalTree) localTree?.delete?.();
    return null;
  }
}

/**
 * Gate 2: QUDV SI-7 Dimensional Calculus
 */
export async function verifyGate2Dimensions(
  code: string,
  language: ClosedLoopLanguage,
  tree?: any,
  documentUri = "file:///candidate/model.sysml",
): Promise<GateVerificationResult> {
  const diagnostics: GateDiagnostic[] = [];
  const inferredDims: Record<string, string> = {};

  const norm = language.toLowerCase();
  if (norm === "sysml2" || norm === "sysml") {
    if (!tree) {
      return {
        gate: 2,
        gateName: "QUDV Physical Dimensions",
        passed: true,
        diagnostics: [],
        metadata: { status: "Skipped: no CST tree available" },
      };
    }

    const ws = createSysML2WorkspaceIndex();
    loadEmbeddedKerMLStdlib(ws);

    ws.register(documentUri, () => tree.rootNode);
    const unified = ws.getIndex({ eager: true });
    const qe = createSysML2QueryEngine(unified, tree);
    const db = qe.toQueryDB();

    let checkedCount = 0;

    // Collect all symbol entries
    const entries: any[] = [];
    if (unified.symbols instanceof Map) {
      for (const entry of unified.symbols.values()) entries.push(entry);
    } else if (Array.isArray((unified as any).symbols)) {
      for (const entry of (unified as any).symbols as any[]) entries.push(entry);
    } else if (typeof (unified as any).symbols === "object" && (unified as any).symbols !== null) {
      for (const entry of Object.values((unified as any).symbols)) entries.push(entry);
    }

    // 1. Check all symbol entries for dimensional assignment errors
    for (const entry of entries) {
      if (!entry) continue;
      if (entry.resourceId && entry.resourceId !== documentUri) continue;
      checkedCount++;

      // Check dimensional assignment lint
      try {
        const assignDiag = (qe as any).fetch("lint__dimensionalAssignment", entry.id);
        if (assignDiag && (assignDiag as any).message) {
          diagnostics.push({
            gate: 2,
            gateName: "QUDV Physical Dimensions",
            severity: "error",
            message: (assignDiag as any).message,
            startOffset: (assignDiag as any).range?.startOffset,
            endOffset: (assignDiag as any).range?.endOffset,
            metadata: { featureName: entry.name, rule: "dimensionalAssignment" },
          });
        }
      } catch {
        // query hook not registered or evaluation error
      }

      // Check constraint dimensional lint
      if (
        entry.ruleName === "AssertConstraintUsage" ||
        entry.ruleName === "ConstraintUsage" ||
        entry.ruleName === "ConstraintDefinition"
      ) {
        try {
          const constrDiag = (qe as any).fetch("lint__dimensionalConstraint", entry.id);
          if (constrDiag && (constrDiag as any).message) {
            diagnostics.push({
              gate: 2,
              gateName: "QUDV Physical Dimensions",
              severity: "error",
              message: (constrDiag as any).message,
              startOffset: (constrDiag as any).range?.startOffset,
              endOffset: (constrDiag as any).range?.endOffset,
              metadata: { constraintName: entry.name, rule: "dimensionalConstraint" },
            });
          }
        } catch {
          // ignore
        }
      }

      // Check connection dimensional lint
      if (entry.ruleName === "ConnectionUsage") {
        try {
          const connDiag = (qe as any).fetch("lint__connectionDimensionalConsistency", entry.id);
          if (connDiag && (connDiag as any).message) {
            diagnostics.push({
              gate: 2,
              gateName: "QUDV Physical Dimensions",
              severity: "error",
              message: (connDiag as any).message,
              startOffset: (connDiag as any).range?.startOffset,
              endOffset: (connDiag as any).range?.endOffset,
              metadata: { connectionName: entry.name, rule: "connectionDimensionalConsistency" },
            });
          }
        } catch {
          // ignore
        }
      }

      // Record known resolved type dimensions for metadata
      if (entry.name) {
        const dim = resolveTypeDimension(db, entry.name);
        if (dim && !isDimensionless(dim)) {
          inferredDims[entry.name] = formatDimension(dim);
        }
      }
    }

    return {
      gate: 2,
      gateName: "QUDV Physical Dimensions",
      passed: diagnostics.length === 0,
      diagnostics,
      metadata: {
        checkedFeatures: checkedCount,
        inferredDimensions: inferredDims,
      },
    };
  } else if (norm === "modelica") {
    let checkedFeatures = 0;

    // 0. Real Modelica arena flattening + SI unit checking via @modelscript/modelica
    const flattened = await flattenModelicaCandidate(code, documentUri, undefined, tree);
    if (flattened?.arena) {
      try {
        const { parseUnit, checkEquationUnits, formatSIUnit, unitDivide, unitMultiply } =
          await import("@modelscript/modelica");
        const { EqKind, ExprKind, BinOp } = await import("@modelscript/runtime");
        const arena = flattened.arena;
        const varUnits = new Map<number, any>();

        for (let i = 0; i < arena.varCount; i++) {
          checkedFeatures++;
          const vName = arena.getVarName(i);
          const unitAttrId = arena.getVarAttr?.(i, "unit");
          let uStr: string | undefined;
          if (unitAttrId !== undefined && unitAttrId >= 0 && arena.getExprKind(unitAttrId) === ExprKind.StringLiteral) {
            uStr = arena.interner?.resolve?.(arena.getExprData1(unitAttrId));
          } else if (typeof arena.getVarUnit === "function") {
            uStr = arena.getVarUnit(i);
          }
          if (uStr) {
            const parsed = parseUnit(uStr);
            if (parsed) {
              varUnits.set(i, parsed);
              inferredDims[vName] = formatSIUnit(parsed);
            }
          }
        }

        const timeUnit = parseUnit("s");
        const inferArenaExprUnit = (exprId: number): any => {
          if (exprId < 0 || exprId >= arena.exprCount) return null;
          const kind = arena.getExprKind(exprId);
          if (kind === ExprKind.Name) {
            const nameStr = arena.interner?.resolve?.(arena.getExprData1(exprId));
            const vId = nameStr ? arena.lookupVariable(nameStr) : -1;
            return vId >= 0 ? (varUnits.get(vId) ?? null) : null;
          }
          if (kind === ExprKind.Der) {
            const inner = inferArenaExprUnit(arena.getExprData1(exprId));
            return inner && timeUnit ? unitDivide(inner, timeUnit) : null;
          }
          if (kind === ExprKind.Negate || kind === ExprKind.Unary) {
            return inferArenaExprUnit(arena.getExprLeft(exprId));
          }
          if (kind === ExprKind.Binary) {
            const op = arena.getExprData1(exprId);
            const lu = inferArenaExprUnit(arena.getExprLeft(exprId));
            const ru = inferArenaExprUnit(arena.getExprRight(exprId));
            if (op === BinOp.Add || op === BinOp.Sub) {
              if (lu && ru && !checkEquationUnits(lu, ru)) {
                diagnostics.push({
                  gate: 2,
                  gateName: "QUDV Physical Dimensions",
                  severity: "error",
                  message: `Dimensional mismatch in Modelica binary expression: cannot combine [${formatSIUnit(lu)}] and [${formatSIUnit(ru)}].`,
                });
              }
              return lu ?? ru;
            }
            if (op === BinOp.Mul) {
              return lu && ru ? unitMultiply(lu, ru) : null;
            }
            if (op === BinOp.Div) {
              return lu && ru ? unitDivide(lu, ru) : null;
            }
          }
          return null;
        };

        // Check variable binding expressions against declared unit
        for (let i = 0; i < arena.varCount; i++) {
          const declUnit = varUnits.get(i);
          if (!declUnit) continue;
          const bindExpr = arena.getVarExpression(i);
          if (bindExpr !== undefined && bindExpr >= 0) {
            const rhsUnit = inferArenaExprUnit(bindExpr);
            if (rhsUnit && !checkEquationUnits(declUnit, rhsUnit)) {
              const vName = arena.getVarName(i);
              diagnostics.push({
                gate: 2,
                gateName: "QUDV Physical Dimensions",
                severity: "error",
                message: `Dimensional mismatch in binding for '${vName}': declared unit [${formatSIUnit(declUnit)}] is incompatible with [${formatSIUnit(rhsUnit)}].`,
                metadata: { featureName: vName },
              });
            }
          }
        }

        // Check simple equations LHS vs RHS units
        for (let e = 0; e < arena.eqCount; e++) {
          if (arena.getEqKind(e) === EqKind.Simple) {
            const lhsUnit = inferArenaExprUnit(arena.getEqLhs(e));
            const rhsUnit = inferArenaExprUnit(arena.getEqRhs(e));
            if (lhsUnit && rhsUnit && !checkEquationUnits(lhsUnit, rhsUnit)) {
              diagnostics.push({
                gate: 2,
                gateName: "QUDV Physical Dimensions",
                severity: "error",
                message: `Dimensional mismatch in Modelica equation: LHS unit [${formatSIUnit(lhsUnit)}] is incompatible with RHS unit [${formatSIUnit(rhsUnit)}].`,
              });
            }
          }
        }
      } catch {
        // Fall through to additional source checks
      }
    }

    // 1. Check unit bracket additions: e.g. 5[m] + 10[s]
    const cleanModelica2 = stripComments(code);
    for (const rawStmt of splitSemicolonStatementsOutsideQuotes(cleanModelica2)) {
      const stmt = stripLeadingModelicaHeader(rawStmt);
      const eqPos = stmt.indexOf("=");
      if (eqPos <= 0) continue;
      const lhsTok = stmt.slice(0, eqPos).trim();
      if (!isStrictIdentifier(lhsTok)) continue;
      const expr = stmt.slice(eqPos + 1).trim();
      const mismatch = findBracketedUnitAddMismatch(expr);
      if (mismatch) {
        diagnostics.push({
          gate: 2,
          gateName: "QUDV Physical Dimensions",
          severity: "error",
          message: `Dimensional mismatch in Modelica expression '${expr}': cannot add unit [${mismatch.u1}] to [${mismatch.u2}].`,
        });
      }
    }

    // 2. Check SI unit type incompatibilities via CST first, falling back to zero-regex text scan
    const varTypes = new Map<string, string>();
    const varAssignments: { varName: string; declaredType: string; rhs: string }[] = [];
    const mRoot2 = tree?.rootNode ?? flattened?.tree?.rootNode;
    let usedCst2 = false;

    if (mRoot2) {
      for (const clauseNode of findCstNodesByType(mRoot2, "component_clause")) {
        const typeNode =
          findCstNodesByType(clauseNode, "type_specifier")[0] ??
          findCstNodesByType(clauseNode, "name")[0] ??
          findCstNodesByType(clauseNode, "type_name")[0];
        const rawType = removeWs(typeNode?.text ?? "");
        const lastDot = rawType.lastIndexOf(".");
        const shortType = lastDot !== -1 ? rawType.slice(lastDot + 1) : rawType;
        if (!shortType || !isUpperStartIdent(shortType)) continue;

        for (const decl of extractModelicaClauseDecls(clauseNode)) {
          usedCst2 = true;
          varTypes.set(decl.varName, shortType);
          if (decl.binding) {
            varAssignments.push({ varName: decl.varName, declaredType: shortType, rhs: decl.binding });
          }
        }
      }
    }

    if (!tree) {
      flattened?.tree?.delete?.();
    }

    if (!usedCst2) {
      for (const dm of extractModelicaTypedDeclsFromText(cleanModelica2)) {
        varTypes.set(dm.varName, dm.typeName);
        if (dm.rhs) {
          varAssignments.push({ varName: dm.varName, declaredType: dm.typeName, rhs: dm.rhs });
        }
      }
    }

    const incompatiblePairs: Record<string, string[]> = {
      Length: ["Mass", "Time", "Voltage", "Current", "Pressure", "Temperature", "Power"],
      Mass: ["Length", "Time", "Voltage", "Current", "Pressure", "Temperature", "Power"],
      Time: ["Length", "Mass", "Voltage", "Current", "Pressure", "Temperature", "Power"],
      Voltage: ["Length", "Mass", "Time", "Current", "Pressure", "Temperature"],
      Current: ["Length", "Mass", "Time", "Voltage", "Pressure", "Temperature"],
      Pressure: ["Length", "Mass", "Time", "Voltage", "Current"],
    };

    for (const { varName, declaredType, rhs } of varAssignments) {
      const rhsVar = stripToIdentifierPath(rhs);
      const rhsType = varTypes.get(rhsVar);
      if (rhsType && incompatiblePairs[declaredType]?.includes(rhsType)) {
        diagnostics.push({
          gate: 2,
          gateName: "QUDV Physical Dimensions",
          severity: "error",
          message: `Dimensional mismatch: cannot assign '${rhsVar}' of type ${rhsType} to '${varName}' of type ${declaredType}.`,
          metadata: { featureName: varName, declaredType, rhsType },
        });
      }
    }

    return {
      gate: 2,
      gateName: "QUDV Physical Dimensions",
      passed: diagnostics.length === 0,
      diagnostics,
      metadata: {
        checkedFeatures: checkedFeatures || varTypes.size,
        inferredDimensions: inferredDims,
      },
    };
  }

  return {
    gate: 2,
    gateName: "QUDV Physical Dimensions",
    passed: true,
    diagnostics: [],
  };
}

/**
 * Gate 3: SMT Real Simplex & Requirement Feasibility
 */
export async function verifyGate3Requirements(
  code: string,
  language: ClosedLoopLanguage,
  tree?: any,
  documentUri = "file:///candidate/model.sysml",
): Promise<GateVerificationResult> {
  const diagnostics: GateDiagnostic[] = [];
  const norm = language.toLowerCase();

  if (norm === "sysml2" || norm === "sysml") {
    let constraints: ExtractedConstraint[] = [];

    if (tree) {
      const ws = createSysML2WorkspaceIndex();
      loadEmbeddedKerMLStdlib(ws);
      ws.register(documentUri, () => tree.rootNode);
      const unified = ws.getIndex({ eager: true });
      const qe = createSysML2QueryEngine(unified, tree);
      const db = qe.toQueryDB();
      constraints = extractSysML2Constraints(db) || [];
    }

    // Also parse explicit inline constraints from CST / source if queryDB didn't extract any
    if (constraints.length === 0) {
      if (tree?.rootNode) {
        const cNodes = [
          ...findCstNodesByType(tree.rootNode, "AssertConstraintUsage"),
          ...findCstNodesByType(tree.rootNode, "ConstraintUsage"),
        ];
        for (const cNode of cNodes) {
          const block = extractFirstBraceBlock(cNode.text || "");
          if (!block) continue;
          const comp = parseSysmlComparisonConstraint(block.body);
          if (comp) {
            const nameNode =
              cNode.childForFieldName?.("declaredName") ?? cNode.children?.find((c: any) => c.type === "Name");
            constraints.push({
              ...comp,
              expression: block.body.trim(),
              source: "sysml2",
              requirementName: nameNode?.text?.trim() || "inlineConstraint",
            });
          }
        }
      } else {
        for (const block of extractSysmlBraceConstraintsFromText(code)) {
          const comp = parseSysmlComparisonConstraint(block.body);
          if (comp) {
            constraints.push({
              ...comp,
              expression: block.body.trim(),
              source: "sysml2",
              requirementName: block.name || "inlineConstraint",
            });
          }
        }
      }
    }

    // Inline requirement bounds: requirement attributes initialized with numeric limits
    if (tree?.rootNode) {
      const reqNodes = [
        ...findCstNodesByType(tree.rootNode, "RequirementUsage"),
        ...findCstNodesByType(tree.rootNode, "RequirementDefinition"),
      ];
      for (const reqNode of reqNodes) {
        const reqNameNode =
          reqNode.childForFieldName?.("declaredName") ?? reqNode.children?.find((c: any) => c.type === "Name");
        const reqName = reqNameNode?.text?.trim();
        for (const attrNode of findCstNodesByType(reqNode, "AttributeUsage")) {
          const parsedAttr = parseSysmlNumericAttrNode(attrNode);
          if (parsedAttr) {
            constraints.push({
              lhs: parsedAttr.name,
              operator: "<=",
              rhs: parsedAttr.value,
              expression: `${parsedAttr.name} <= ${parsedAttr.value}`,
              source: "sysml2",
              requirementName: reqName,
            });
          }
        }
      }
    } else {
      for (const bound of extractSysmlReqAttrBoundsFromText(code)) {
        constraints.push({
          lhs: bound.attrName,
          operator: "<=",
          rhs: bound.value,
          expression: `${bound.attrName} <= ${bound.value}`,
          source: "sysml2",
          requirementName: bound.reqName,
        });
      }
    }

    if (constraints.length === 0) {
      return {
        gate: 3,
        gateName: "SMT Requirement Feasibility",
        passed: true,
        diagnostics: [],
        metadata: { isConsistent: true, numConstraints: 0 },
      };
    }

    const checkResult: SMTRequirementCheckResult = verifyConstraintSet(constraints);

    if (!checkResult.isConsistent) {
      for (const violated of checkResult.violatedConstraints) {
        diagnostics.push({
          gate: 3,
          gateName: "SMT Requirement Feasibility",
          severity: "error",
          message: `SMT Requirement Conflict in '${violated.requirementName ?? "system constraint"}': ${violated.reason} (Expression: '${violated.expression}').`,
          metadata: {
            requirementName: violated.requirementName,
            expression: violated.expression,
          },
        });
      }

      return {
        gate: 3,
        gateName: "SMT Requirement Feasibility",
        passed: false,
        diagnostics,
        metadata: {
          isConsistent: false,
          conflictingRequirements: checkResult.conflictingRequirements,
          unsatCore: checkResult.conflictingRequirements,
        },
      };
    }

    return {
      gate: 3,
      gateName: "SMT Requirement Feasibility",
      passed: true,
      diagnostics: [],
      metadata: {
        isConsistent: true,
        numConstraints: constraints.length,
      },
    };
  } else if (norm === "modelica") {
    // Modelica parameter, bound, and assertion consistency using real arena + SMT check
    const boundVars = new Map<string, number>();
    const modelicaConstraints: ExtractedConstraint[] = [];

    const flattened = await flattenModelicaCandidate(code, documentUri, undefined, tree);
    if (flattened?.arena) {
      try {
        const { EqKind, ExprKind, evaluateArenaExpression } = await import("@modelscript/runtime");
        const arena = flattened.arena;
        const evalCtx = new Map<string, number>();
        evalCtx.set("time", 0);

        for (let i = 0; i < arena.varCount; i++) {
          const vName = arena.getVarName(i);
          const bindExpr = arena.getVarExpression(i);
          let val: number | undefined;
          if (bindExpr !== undefined && bindExpr >= 0) {
            const evaluated = evaluateArenaExpression(arena, bindExpr, evalCtx);
            if (typeof evaluated === "number" && Number.isFinite(evaluated)) {
              val = evaluated;
            }
          } else {
            val = arena.getVarStartValue(i);
          }
          if (val !== undefined && Number.isFinite(val)) {
            evalCtx.set(vName, val);
            boundVars.set(vName, val);
          }
        }

        // Evaluate assert function call equations directly in the flattened DAE arena
        for (let e = 0; e < arena.eqCount; e++) {
          if (arena.getEqKind(e) === EqKind.FunctionCall) {
            const callExpr = arena.getEqLhs(e);
            if (callExpr >= 0 && arena.getExprKind(callExpr) === ExprKind.Call) {
              const funcName = arena.interner?.resolve?.(arena.getExprData1(callExpr));
              if (funcName === "assert") {
                const condExpr = arena.getExprLeft(callExpr);
                const condVal = evaluateArenaExpression(arena, condExpr, evalCtx);
                if (condVal === false || condVal === 0) {
                  const msgVal =
                    arena.getExprRight(callExpr) >= 2
                      ? evaluateArenaExpression(arena, arena.getExprLeft(callExpr + 1), evalCtx)
                      : "Assertion failed";
                  diagnostics.push({
                    gate: 3,
                    gateName: "SMT Requirement Feasibility",
                    severity: "error",
                    message: `Infeasible Modelica assertion in flattened DAE: ${String(msgVal)}`,
                  });
                }
              }
            }
          }
        }
      } catch {
        // Continue with source-level parameter and constraint extraction
      }
    }

    const clean = stripComments(code);
    const paramDecls: Array<{ name: string; mods: string; binding?: string | undefined }> = [];
    const assertCalls: Array<{ expr: string; msg: string }> = [];

    const mRoot3 = tree?.rootNode ?? flattened?.tree?.rootNode;
    if (mRoot3) {
      for (const clauseNode of findCstNodesByType(mRoot3, "component_clause")) {
        for (const decl of extractModelicaClauseDecls(clauseNode)) {
          paramDecls.push({ name: decl.varName, mods: decl.mods, binding: decl.binding });
        }
      }
      for (const callNode of findCstNodesByType(mRoot3, "function_call")) {
        const callText = callNode.text || "";
        if (callText.trimStart().startsWith("assert")) {
          assertCalls.push(...extractModelicaAssertCalls(callText));
        }
      }
    }
    if (!tree) {
      flattened?.tree?.delete?.();
    }

    if (!mRoot3 || paramDecls.length === 0) {
      paramDecls.push(...extractModelicaParamDeclsFromText(clean));
    }
    if (!mRoot3 || assertCalls.length === 0) {
      assertCalls.push(...extractModelicaAssertCalls(clean));
    }

    for (const pm of paramDecls) {
      const { name: vName, mods, binding } = pm;
      if (binding !== undefined) {
        const val = parseLeadingSignedNumber(binding);
        if (val !== undefined && Number.isFinite(val)) {
          boundVars.set(vName, val);
          modelicaConstraints.push({
            lhs: vName,
            operator: "==",
            rhs: val,
            expression: `${vName} == ${val}`,
            source: "modelica",
            requirementName: `${vName}_binding`,
          });
        }
      }
      const minVal = extractNamedNumericAttr(mods, "min");
      if (minVal !== undefined && Number.isFinite(minVal)) {
        modelicaConstraints.push({
          lhs: vName,
          operator: ">=",
          rhs: minVal,
          expression: `${vName} >= ${minVal}`,
          source: "modelica",
          requirementName: `${vName}_min`,
        });
      }
      const maxVal = extractNamedNumericAttr(mods, "max");
      if (maxVal !== undefined && Number.isFinite(maxVal)) {
        modelicaConstraints.push({
          lhs: vName,
          operator: "<=",
          rhs: maxVal,
          expression: `${vName} <= ${maxVal}`,
          source: "modelica",
          requirementName: `${vName}_max`,
        });
      }
    }

    if (modelicaConstraints.length > 0) {
      const smtCheck = verifyConstraintSet(modelicaConstraints);
      if (!smtCheck.isConsistent) {
        for (const v of smtCheck.violatedConstraints) {
          diagnostics.push({
            gate: 3,
            gateName: "SMT Requirement Feasibility",
            severity: "error",
            message: `Infeasible Modelica parameter bound '${v.expression}': ${v.reason}`,
          });
        }
      }
    }

    for (const am of assertCalls) {
      const evalResult = evaluateModelicaBooleanExpr(am.expr, boundVars);
      if (evalResult === false && diagnostics.length === 0) {
        diagnostics.push({
          gate: 3,
          gateName: "SMT Requirement Feasibility",
          severity: "error",
          message: `Infeasible Modelica assertion '${am.expr}': ${am.msg}`,
        });
      }
    }

    return {
      gate: 3,
      gateName: "SMT Requirement Feasibility",
      passed: diagnostics.length === 0,
      diagnostics,
      metadata: {
        isConsistent: diagnostics.length === 0,
        numConstraints: modelicaConstraints.length,
      },
    };
  }

  return {
    gate: 3,
    gateName: "SMT Requirement Feasibility",
    passed: true,
    diagnostics: [],
  };
}

function evaluateModelicaBooleanExpr(expr: string, boundVars: ReadonlyMap<string, number>): boolean | null {
  try {
    const trimmed = expr.trim();
    if (trimmed === "false") return false;
    if (trimmed === "true") return true;

    const tokens = tokenizeModelicaBoolExpr(expr);
    if (!tokens) return null;

    let pos = 0;
    const peek = () => tokens[pos];
    const consume = () => tokens[pos++];

    function parseOr(): number | boolean {
      let left = parseAnd();
      while (peek() === "||" || peek() === "or") {
        consume();
        const right = parseAnd();
        left = Boolean(left) || Boolean(right);
      }
      return left;
    }

    function parseAnd(): number | boolean {
      let left = parseEquality();
      while (peek() === "&&" || peek() === "and") {
        consume();
        const right = parseEquality();
        left = Boolean(left) && Boolean(right);
      }
      return left;
    }

    function parseEquality(): number | boolean {
      let left = parseRelational();
      while (peek() === "==" || peek() === "=" || peek() === "!=" || peek() === "<>") {
        const op = consume();
        const right = parseRelational();
        left = op === "!=" || op === "<>" ? left !== right : left === right;
      }
      return left;
    }

    function parseRelational(): number | boolean {
      let left = parseAdd();
      while (peek() === "<" || peek() === "<=" || peek() === ">" || peek() === ">=") {
        const op = consume();
        const right = parseAdd();
        if (typeof left !== "number" || typeof right !== "number") return false;
        if (op === "<") left = left < right;
        else if (op === "<=") left = left <= right;
        else if (op === ">") left = left > right;
        else if (op === ">=") left = left >= right;
      }
      return left;
    }

    function parseAdd(): number | boolean {
      let left = parseMul();
      while (peek() === "+" || peek() === "-") {
        const op = consume();
        const right = parseMul();
        if (typeof left !== "number" || typeof right !== "number") return false;
        left = op === "+" ? left + right : left - right;
      }
      return left;
    }

    function parseMul(): number | boolean {
      let left = parseUnary();
      while (peek() === "*" || peek() === "/" || peek() === "%") {
        const op = consume();
        const right = parseUnary();
        if (typeof left !== "number" || typeof right !== "number") return false;
        if (op === "*") left = left * right;
        else if (op === "/") left = right === 0 ? 0 : left / right;
        else if (op === "%") left = right === 0 ? 0 : left % right;
      }
      return left;
    }

    function parseUnary(): number | boolean {
      const tok = peek();
      if (tok === "!" || tok === "not") {
        consume();
        return !parseUnary();
      }
      if (tok === "-") {
        consume();
        const val = parseUnary();
        return typeof val === "number" ? -val : 0;
      }
      if (tok === "+") {
        consume();
        return parseUnary();
      }
      return parsePrimary();
    }

    function parsePrimary(): number | boolean {
      const tok = consume();
      if (!tok) throw new Error("Unexpected end of expression");
      if (tok === "(") {
        const res = parseOr();
        if (consume() !== ")") throw new Error("Missing closing paren");
        return res;
      }
      if (tok === "true") return true;
      if (tok === "false") return false;
      const num = Number(tok);
      if (!Number.isNaN(num)) return num;
      if (boundVars.has(tok)) return boundVars.get(tok)!;
      throw new Error(`Unbound identifier ${tok}`);
    }

    const result = parseOr();
    if (pos !== tokens.length) return null;
    return Boolean(result);
  } catch {
    return null;
  }
}

function stripComments(source: string): string {
  let result = "";
  let i = 0;
  const len = source.length;
  while (i < len) {
    const ch = source[i];
    if (ch === '"') {
      result += ch;
      i++;
      while (i < len) {
        const c = source[i];
        result += c;
        if (c === "\\") {
          i++;
          if (i < len) result += source[i];
        } else if (c === '"') {
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (ch === "/" && i + 1 < len) {
      const next = source[i + 1];
      if (next === "/") {
        i += 2;
        while (i < len && source[i] !== "\n" && source[i] !== "\r") {
          i++;
        }
        continue;
      }
      if (next === "*") {
        i += 2;
        while (i + 1 < len && !(source[i] === "*" && source[i + 1] === "/")) {
          i++;
        }
        i += 2;
        continue;
      }
    }
    result += ch;
    i++;
  }
  return result;
}

/**
 * Compute maximum bipartite matching (equation -> variable) and Tarjan SCC BLT blocks.
 */
function analyzeBipartiteAndBLT(
  variables: string[],
  equationStrings: string[],
): { matchedCount: number; bltBlocksCount: number; unmatchedVars: string[] } {
  const nVars = variables.length;
  const nEqs = equationStrings.length;
  const adj: number[][] = Array.from({ length: nEqs }, () => []);

  for (let e = 0; e < nEqs; e++) {
    const eqText = equationStrings[e]!;
    for (let v = 0; v < nVars; v++) {
      const varName = variables[v]!;
      if (hasWordMatch(eqText, varName)) {
        adj[e]!.push(v);
      }
    }
    // If an equation references no recognized variable directly (e.g. connect), allow fallback edges
    if (adj[e]!.length === 0 && nVars > 0) {
      for (let v = 0; v < nVars; v++) adj[e]!.push(v);
    }
  }

  // Augmenting path bipartite matching
  const matchVarToEq = new Int32Array(nVars).fill(-1);
  const matchEqToVar = new Int32Array(nEqs).fill(-1);

  const dfsAugment = (eqIdx: number, visited: Uint8Array): boolean => {
    for (const vIdx of adj[eqIdx]!) {
      if (visited[vIdx]) continue;
      visited[vIdx] = 1;
      if (matchVarToEq[vIdx] === -1 || dfsAugment(matchVarToEq[vIdx]!, visited)) {
        matchVarToEq[vIdx] = eqIdx;
        matchEqToVar[eqIdx] = vIdx;
        return true;
      }
    }
    return false;
  };

  let matchedCount = 0;
  for (let e = 0; e < nEqs; e++) {
    const visited = new Uint8Array(nVars);
    if (dfsAugment(e, visited)) {
      matchedCount++;
    }
  }

  const unmatchedVars: string[] = [];
  for (let v = 0; v < nVars; v++) {
    if (matchVarToEq[v] === -1) unmatchedVars.push(variables[v]!);
  }

  // Tarjan's Strongly Connected Components (SCC) for BLT decomposition on matched equations
  let index = 0;
  const indices = new Int32Array(nEqs).fill(-1);
  const lowlink = new Int32Array(nEqs).fill(-1);
  const onStack = new Uint8Array(nEqs);
  const stack: number[] = [];
  let sccCount = 0;

  const strongConnect = (e: number) => {
    indices[e] = index;
    lowlink[e] = index;
    index++;
    stack.push(e);
    onStack[e] = 1;

    for (const v of adj[e]!) {
      const targetEq = matchVarToEq[v]!;
      if (targetEq >= 0 && targetEq !== e) {
        if (indices[targetEq] === -1) {
          strongConnect(targetEq);
          lowlink[e] = Math.min(lowlink[e]!, lowlink[targetEq]!);
        } else if (onStack[targetEq]) {
          lowlink[e] = Math.min(lowlink[e]!, indices[targetEq]!);
        }
      }
    }

    if (lowlink[e] === indices[e]) {
      sccCount++;
      while (stack.length > 0) {
        const w = stack.pop()!;
        onStack[w] = 0;
        if (w === e) break;
      }
    }
  };

  for (let e = 0; e < nEqs; e++) {
    if (indices[e] === -1) strongConnect(e);
  }

  return {
    matchedCount,
    bltBlocksCount: sccCount > 0 ? sccCount : nEqs,
    unmatchedVars,
  };
}

/**
 * Gate 4: DAE Arena Structural Balance & BLT Causalization
 */
export async function verifyGate4DAEBalance(
  code: string,
  language: ClosedLoopLanguage,
  _tree?: any,
  _lspContext?: any,
): Promise<GateVerificationResult> {
  const diagnostics: GateDiagnostic[] = [];
  const norm = language.toLowerCase();

  if (norm === "modelica") {
    // 0. Flatten into real DAEBuilder arena and run performBltTransformationArena when available
    const flattened = await flattenModelicaCandidate(code, "file:///candidate/model.mo", _lspContext, _tree);
    let arenaVars: string[] = [];
    let arenaEqCount = 0;
    let arenaBltBlocksCount: number | undefined;

    if (flattened?.arena) {
      try {
        const { Variability, Causality, EqKind, initBltWasm, performBltTransformationArena } =
          await import("@modelscript/runtime");
        const arena = flattened.arena;
        for (let i = 0; i < arena.varCount; i++) {
          const variability = arena.getVarVariability(i);
          const causality = arena.getVarCausality(i);
          if (
            variability !== Variability.Parameter &&
            variability !== Variability.Constant &&
            causality !== Causality.Input
          ) {
            arenaVars.push(arena.getVarName(i));
          }
        }
        for (let e = 0; e < arena.eqCount; e++) {
          const kind = arena.getEqKind(e);
          if (kind === EqKind.Connect) {
            arenaEqCount += 2;
          } else if (kind !== EqKind.FunctionCall) {
            arenaEqCount += 1;
          }
        }
        if (arenaVars.length > 0 && arenaEqCount === arenaVars.length) {
          try {
            await initBltWasm();
            const blt = performBltTransformationArena(arena);
            if (blt && Array.isArray(blt.blocks) && blt.blocks.length > 0) {
              arenaBltBlocksCount = blt.blocks.length;
            }
          } catch {
            // Fallback to bipartite/SCC analysis below
          }
        }
      } catch {
        // Fall through to CST/declaration extraction if runtime BLT is unavailable
      }
    }

    // Robust Modelica equation & variable structural balance
    const cleanCode = stripComments(code);
    const declaredVars = new Set<string>(arenaVars);
    const mRoot = _tree?.rootNode ?? flattened?.tree?.rootNode;
    const equationStrings: string[] = [];

    if (mRoot) {
      const visitCst = (node: any) => {
        if (node.type === "component_clause") {
          const prefixNodes = findCstNodesByType(node, "type_prefix");
          const isNonState =
            (node.children || []).some((c: any) => {
              const t = c.type ?? "";
              return t === "parameter" || t === "constant" || t === "input";
            }) || prefixNodes.some((p: any) => hasAnyWordMatch(p.text ?? "", ["parameter", "constant", "input"]));
          if (!isNonState) {
            for (const decl of extractModelicaClauseDecls(node)) {
              declaredVars.add(decl.varName);
            }
          }
        } else if (node.type === "equation_section") {
          const rawSection = node.text ?? "";
          const bodyStart = skipLeadingKeyword(rawSection, "equation");
          if (bodyStart >= 0) {
            pushModelicaEquations(rawSection.slice(bodyStart), equationStrings);
          }
        }
        if (Array.isArray(node.children)) {
          for (const child of node.children) visitCst(child);
        }
      };
      visitCst(mRoot);
    }

    if (!_tree) {
      flattened?.tree?.delete?.();
    }

    if (!mRoot || declaredVars.size === 0) {
      const declPart = splitModelicaBeforeEquation(cleanCode);
      for (const id of extractModelicaStateVarsFromDecls(declPart)) {
        declaredVars.add(id);
      }
    }

    if (equationStrings.length === 0) {
      const eqSectionBody = extractModelicaSectionSpan(cleanCode, "equation");
      if (eqSectionBody) {
        pushModelicaEquations(eqSectionBody, equationStrings);
      }
    }

    const eqCount = Math.max(arenaEqCount, equationStrings.length);
    const varCount = declaredVars.size;

    if (varCount > 0 || eqCount > 0) {
      if (eqCount !== varCount) {
        const diff = eqCount - varCount;
        diagnostics.push({
          gate: 4,
          gateName: "DAE Structural Balance",
          severity: "error",
          message: `DAE structurally unbalanced: found ${eqCount} equations for ${varCount} dynamic variables (${
            diff > 0 ? `overdetermined by +${diff}` : `underdetermined by ${diff}`
          }).`,
          metadata: { numEquations: eqCount, numVariables: varCount, degreesOfFreedom: varCount - eqCount },
        });

        return {
          gate: 4,
          gateName: "DAE Structural Balance",
          passed: false,
          diagnostics,
          metadata: {
            numEquations: eqCount,
            numVariables: varCount,
            degreesOfFreedom: varCount - eqCount,
            isBalanced: false,
          },
        };
      }
    }

    // Perform bipartite matching & Tarjan SCC BLT block decomposition
    const {
      matchedCount,
      bltBlocksCount: fallbackBltCount,
      unmatchedVars,
    } = analyzeBipartiteAndBLT([...declaredVars], equationStrings);
    const bltBlocksCount = arenaBltBlocksCount ?? fallbackBltCount;

    if (varCount > 0 && matchedCount < varCount) {
      diagnostics.push({
        gate: 4,
        gateName: "DAE Structural Balance",
        severity: "error",
        message: `DAE structurally singular: ${unmatchedVars.length} variable(s) (${unmatchedVars.join(", ")}) could not be matched to an independent equation.`,
        metadata: {
          numEquations: eqCount,
          numVariables: varCount,
          matchedCount,
          unmatchedVars,
        },
      });
      return {
        gate: 4,
        gateName: "DAE Structural Balance",
        passed: false,
        diagnostics,
        metadata: {
          numEquations: eqCount,
          numVariables: varCount,
          degreesOfFreedom: varCount - matchedCount,
          isBalanced: false,
          bltBlocksCount,
        },
      };
    }

    return {
      gate: 4,
      gateName: "DAE Structural Balance",
      passed: true,
      diagnostics: [],
      metadata: {
        numEquations: eqCount,
        numVariables: varCount,
        degreesOfFreedom: 0,
        isBalanced: true,
        bltBlocksCount,
      },
    };
  } else if (norm === "sysml2" || norm === "sysml") {
    // Check parametric equations in SysML v2 via CST first, falling back to zero-regex text scan
    const uninitializedAttrs: string[] = [];
    const equations: string[] = [];

    let localSysmlTree: any = null;
    try {
      let sysmlRoot = _tree?.rootNode;
      if (!sysmlRoot) {
        const sysmlParser = await getWasmParserForLanguage("sysml2");
        if (sysmlParser) {
          localSysmlTree = sysmlParser.parse(code);
          sysmlRoot = localSysmlTree?.rootNode;
        }
      }

      if (sysmlRoot) {
        for (const attrNode of findCstNodesByType(sysmlRoot, "AttributeUsage")) {
          const nameNode =
            attrNode.childForFieldName?.("declaredName") ?? attrNode.children?.find((c: any) => c.type === "Name");
          const attrName = nameNode?.text?.trim();
          const attrText = attrNode.text || "";
          if (attrName && !hasSysmlAttrInitializer(attrText)) {
            uninitializedAttrs.push(attrName);
          }
        }

        const constraintNodes = [
          ...findCstNodesByType(sysmlRoot, "AssertConstraintUsage"),
          ...findCstNodesByType(sysmlRoot, "ConstraintUsage"),
        ];
        for (const cNode of constraintNodes) {
          const braceSpan = extractFirstBraceBlock(cNode.text || "");
          if (braceSpan) {
            const body = braceSpan.body.trim();
            if (hasConstraintEqualityOrBound(body)) {
              equations.push(body);
            }
          }
        }
      } else {
        for (const attr of extractSysmlAttributesFromText(code)) {
          if (!attr.hasInitializer) {
            uninitializedAttrs.push(attr.name);
          }
        }
        for (const cBlock of extractSysmlBraceConstraintsFromText(code)) {
          if (hasConstraintEqualityOrBound(cBlock.body)) {
            equations.push(cBlock.body.trim());
          }
        }
      }
    } finally {
      localSysmlTree?.delete?.();
    }

    if (uninitializedAttrs.length > 0 && equations.length > 0) {
      if (uninitializedAttrs.length !== equations.length) {
        const diff = equations.length - uninitializedAttrs.length;
        diagnostics.push({
          gate: 4,
          gateName: "DAE Structural Balance",
          severity: "error",
          message: `SysML v2 parametric constraint system unbalanced: ${equations.length} equations for ${
            uninitializedAttrs.length
          } unknown state variables (${diff > 0 ? "overdetermined" : "underdetermined"}).`,
          metadata: {
            numEquations: equations.length,
            numVariables: uninitializedAttrs.length,
            degreesOfFreedom: uninitializedAttrs.length - equations.length,
          },
        });

        return {
          gate: 4,
          gateName: "DAE Structural Balance",
          passed: false,
          diagnostics,
          metadata: {
            numEquations: equations.length,
            numVariables: uninitializedAttrs.length,
            degreesOfFreedom: uninitializedAttrs.length - equations.length,
            isBalanced: false,
          },
        };
      }
    }

    return {
      gate: 4,
      gateName: "DAE Structural Balance",
      passed: true,
      diagnostics: [],
      metadata: {
        isBalanced: true,
        numEquations: equations.length,
        numVariables: uninitializedAttrs.length,
        status: "Static architecture and parametric constraints structurally balanced",
      },
    };
  }

  return {
    gate: 4,
    gateName: "DAE Structural Balance",
    passed: true,
    diagnostics: [],
    metadata: { isBalanced: true },
  };
}

/**
 * Main Closed-Loop Verification Engine.
 */
export class ClosedLoopCompilerEngine {
  constructor(public readonly lspContext?: any) {}

  /**
   * Runs candidate code through the 4 verification gates.
   * Gate 1 certifies syntax and CST structure; once certified,
   * semantic gates (2: Dimensions, 3: SMT Feasibility, 4: DAE Balance)
   * execute concurrently to return a complete, aggregated diagnostic vector.
   */
  public async verifyCandidate(
    code: string,
    language: ClosedLoopLanguage = "sysml2",
    options?: VerifyCandidateOptions,
  ): Promise<ClosedLoopCandidateVerification> {
    const targetGates = new Set(options?.targetGates ?? [1, 2, 3, 4]);
    const gates: GateVerificationResult[] = [];
    const docUri = options?.documentUri ?? "file:///candidate/model.sysml";

    // --- Gate 1: Syntax (Prerequisite for semantic CST analysis) ---
    let tree: any = null;
    try {
      if (targetGates.has(1)) {
        const g1 = await verifyGate1Syntax(code, language, options?.parser);
        gates.push(g1.result);
        tree = g1.tree;
        if (!g1.result.passed) {
          return {
            allPassed: false,
            gates,
            summary: `Failed at Gate 1 (WASM GLR Syntax) with ${g1.result.diagnostics.length} syntax errors.`,
            timestamp: new Date().toISOString(),
          };
        }
      }

      // --- Gates 2, 3, 4: Semantic Verification Gates (Evaluated Concurrently) ---
      const semanticTasks: Promise<GateVerificationResult>[] = [];
      if (targetGates.has(2)) {
        semanticTasks.push(verifyGate2Dimensions(code, language, tree, docUri));
      }
      if (targetGates.has(3)) {
        semanticTasks.push(verifyGate3Requirements(code, language, tree, docUri));
      }
      if (targetGates.has(4)) {
        semanticTasks.push(verifyGate4DAEBalance(code, language, tree, this.lspContext));
      }

      if (semanticTasks.length > 0) {
        const semanticResults = await Promise.all(semanticTasks);
        for (const res of semanticResults) {
          gates.push(res);
        }
      }

      const failedGates = gates.filter((g) => !g.passed);
      if (failedGates.length > 0) {
        const totalDiags = failedGates.reduce((sum, g) => sum + g.diagnostics.length, 0);
        const gateLabels = failedGates.map((g) => `Gate ${g.gate} (${g.gateName})`).join(", ");
        return {
          allPassed: false,
          gates,
          summary: `Failed at ${gateLabels} with ${totalDiags} total diagnostic${totalDiags === 1 ? "" : "s"}.`,
          timestamp: new Date().toISOString(),
        };
      }

      return {
        allPassed: true,
        gates,
        summary: `All ${gates.length} verification gates certified successfully.`,
        timestamp: new Date().toISOString(),
      };
    } finally {
      tree?.delete?.();
    }
  }
}
