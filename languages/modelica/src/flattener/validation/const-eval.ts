// SPDX-License-Identifier: AGPL-3.0-or-later

import { isSignedAsciiIntText, isSignedAsciiNumberText } from "../expressions/cst-utils.js";

export function evalSimpleConstRealText(exprText: string): string | null {
  const s = exprText.trim();
  if (!s) return null;
  // Already a numeric literal
  if (isSignedAsciiIntText(s) || isSignedAsciiNumberText(s)) return null;
  // Tokenize numbers, arithmetic ops (+ - * / ^), and parens
  let pos = 0;
  type Tok = { kind: "num"; val: number; isInt: boolean } | { kind: "op"; val: string };
  const toks: Tok[] = [];
  while (pos < s.length) {
    const ch = s[pos]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      pos++;
      continue;
    }
    if ("+-*/^()".includes(ch)) {
      toks.push({ kind: "op", val: ch });
      pos++;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let end = pos;
      let hasDotOrExp = false;
      while (end < s.length) {
        const c = s[end]!;
        if (c >= "0" && c <= "9") end++;
        else if (c === ".") {
          hasDotOrExp = true;
          end++;
        } else if ((c === "e" || c === "E") && end + 1 < s.length) {
          hasDotOrExp = true;
          end++;
          if (s[end] === "+" || s[end] === "-") end++;
        } else break;
      }
      const numStr = s.slice(pos, end);
      const v = Number(numStr);
      if (!Number.isFinite(v)) return null;
      toks.push({ kind: "num", val: v, isInt: !hasDotOrExp });
      pos = end;
      continue;
    }
    return null;
  }
  if (toks.length === 0) return null;
  let idx = 0;
  const peek = () => toks[idx];
  const parseExpr = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;
    while (peek()?.kind === "op" && (peek()!.val === "+" || peek()!.val === "-")) {
      const op = toks[idx++]!.val;
      const right = parseTerm();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };
  const parseTerm = (): number | null => {
    let left = parsePower();
    if (left === null) return null;
    while (peek()?.kind === "op" && (peek()!.val === "*" || peek()!.val === "/")) {
      const op = toks[idx++]!.val;
      const right = parsePower();
      if (right === null) return null;
      if (op === "/" && right === 0) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  };
  const parsePower = (): number | null => {
    const left = parseUnary();
    if (left === null) return null;
    if (peek()?.kind === "op" && peek()!.val === "^") {
      idx++;
      const right = parsePower();
      if (right === null) return null;
      return Math.pow(left, right);
    }
    return left;
  };
  const parseUnary = (): number | null => {
    if (peek()?.kind === "op" && (peek()!.val === "+" || peek()!.val === "-")) {
      const op = toks[idx++]!.val;
      const v = parseUnary();
      if (v === null) return null;
      return op === "-" ? -v : v;
    }
    if (peek()?.kind === "op" && peek()!.val === "(") {
      idx++;
      const inner = parseExpr();
      if (inner === null || peek()?.kind !== "op" || peek()!.val !== ")") return null;
      idx++;
      return inner;
    }
    const t = peek();
    if (t?.kind === "num") {
      idx++;
      return t.val;
    }
    return null;
  };
  const res = parseExpr();
  if (res === null || idx !== toks.length || !Number.isFinite(res)) return null;
  return Number.isInteger(res) ? res.toFixed(1) : String(res);
}

export function inferSimpleLiteralType(exprText: string): string | null {
  const t = exprText.trim();
  if (t === "true" || t === "false") return "Boolean";
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return "String";
  if (isSignedAsciiIntText(t)) return "Integer";
  if (isSignedAsciiNumberText(t)) return "Real";
  return null;
}
