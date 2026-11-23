// SPDX-License-Identifier: AGPL-3.0-or-later

import type { VhdlSpan } from "../types.js";

export type VhdlTokenKind = "ident" | "number" | "char" | "string" | "bitString" | "symbol" | "eof";

export interface VhdlToken {
  kind: VhdlTokenKind;
  value: string;
  lower: string;
  span: VhdlSpan;
}

const TWO_CHAR_SYMBOLS = new Set(["<=", ":=", "=>", "/=", ">=", "**", "<>"]);
const ONE_CHAR_SYMBOLS = new Set(["(", ")", ";", ":", ",", ".", "+", "-", "*", "/", "&", "=", "<", ">", "|", "'"]);

/**
 * Case-preserving, case-insensitive-ready lexer for VHDL-87/93 source text.
 * Skips whitespace and `--` line comments.
 */
export function tokenizeVhdl(source: string): VhdlToken[] {
  const tokens: VhdlToken[] = [];
  const len = source.length;
  let i = 0;
  let line = 1;
  let col = 1;

  const advance = (): string => {
    const ch = source[i] ?? "";
    i++;
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  };

  while (i < len) {
    const ch = source[i] ?? "";

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    // Line comment: -- ...
    if (ch === "-" && source[i + 1] === "-") {
      while (i < len && source[i] !== "\n") {
        advance();
      }
      continue;
    }

    const startOffset = i;
    const startLine = line;
    const startCol = col;

    // Bit-string literal: B"...", O"...", X"..."
    if ((ch === "B" || ch === "b" || ch === "O" || ch === "o" || ch === "X" || ch === "x") && source[i + 1] === '"') {
      const base = advance().toUpperCase();
      advance(); // opening "
      let body = "";
      while (i < len && source[i] !== '"') {
        body += advance();
      }
      if (i < len && source[i] === '"') advance();
      tokens.push({
        kind: "bitString",
        value: `${base}"${body}"`,
        lower: `${base.toLowerCase()}"${body.toLowerCase()}"`,
        span: { line: startLine, column: startCol, endLine: line, endColumn: col, startOffset, endOffset: i },
      });
      continue;
    }

    // Character literal: '0', '1', 'Z', etc.
    // Distinguish from attribute tick (`clk'event`): char literal has single char followed by `'`
    // AND previous token is not an identifier or `)` (unless previous is operator/delimiter/keyword)
    const prev = tokens[tokens.length - 1];
    const prevIsExprEnd =
      prev !== undefined &&
      ((prev.kind === "ident" &&
        ![
          "and",
          "or",
          "nand",
          "nor",
          "xor",
          "xnor",
          "not",
          "when",
          "else",
          "then",
          "is",
          "return",
          "after",
          "to",
          "downto",
          "in",
          "others",
        ].includes(prev.lower)) ||
        (prev.kind === "symbol" && prev.value === ")"));

    if (ch === "'" && !prevIsExprEnd && i + 2 < len && source[i + 2] === "'") {
      advance(); // opening '
      const c = advance();
      advance(); // closing '
      tokens.push({
        kind: "char",
        value: c,
        lower: c.toLowerCase(),
        span: { line: startLine, column: startCol, endLine: line, endColumn: col, startOffset, endOffset: i },
      });
      continue;
    }

    // String / bit-vector literal: "..."
    if (ch === '"') {
      advance();
      let str = "";
      while (i < len) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            advance();
            str += advance();
            continue;
          }
          advance();
          break;
        }
        str += advance();
      }
      tokens.push({
        kind: "string",
        value: str,
        lower: str.toLowerCase(),
        span: { line: startLine, column: startCol, endLine: line, endColumn: col, startOffset, endOffset: i },
      });
      continue;
    }

    // Identifiers / keywords
    if (/[A-Za-z_]/.test(ch)) {
      let ident = "";
      while (i < len && /[A-Za-z0-9_]/.test(source[i] ?? "")) {
        ident += advance();
      }
      tokens.push({
        kind: "ident",
        value: ident,
        lower: ident.toLowerCase(),
        span: { line: startLine, column: startCol, endLine: line, endColumn: col, startOffset, endOffset: i },
      });
      continue;
    }

    // Numeric literals (integer, real, based like 16#FF#)
    if (/[0-9]/.test(ch)) {
      let num = "";
      while (i < len && /[0-9_]/.test(source[i] ?? "")) {
        num += advance();
      }
      if (source[i] === "." && /[0-9]/.test(source[i + 1] ?? "")) {
        num += advance();
        while (i < len && /[0-9_]/.test(source[i] ?? "")) {
          num += advance();
        }
      }
      if (source[i] === "#") {
        num += advance();
        while (i < len && /[0-9A-Fa-f_.]/.test(source[i] ?? "")) {
          num += advance();
        }
        if (source[i] === "#") num += advance();
      }
      if ((source[i] === "e" || source[i] === "E") && /[0-9+-]/.test(source[i + 1] ?? "")) {
        num += advance();
        if (source[i] === "+" || source[i] === "-") num += advance();
        while (i < len && /[0-9_]/.test(source[i] ?? "")) {
          num += advance();
        }
      }
      tokens.push({
        kind: "number",
        value: num,
        lower: num.toLowerCase(),
        span: { line: startLine, column: startCol, endLine: line, endColumn: col, startOffset, endOffset: i },
      });
      continue;
    }

    // Two-character symbols
    const two = source.slice(i, i + 2);
    if (TWO_CHAR_SYMBOLS.has(two)) {
      advance();
      advance();
      tokens.push({
        kind: "symbol",
        value: two,
        lower: two,
        span: { line: startLine, column: startCol, endLine: line, endColumn: col, startOffset, endOffset: i },
      });
      continue;
    }

    // Single-character symbols
    if (ONE_CHAR_SYMBOLS.has(ch)) {
      advance();
      tokens.push({
        kind: "symbol",
        value: ch,
        lower: ch,
        span: { line: startLine, column: startCol, endLine: line, endColumn: col, startOffset, endOffset: i },
      });
      continue;
    }

    // Unknown character: emit as symbol so parser can report syntax error gracefully
    advance();
    tokens.push({
      kind: "symbol",
      value: ch,
      lower: ch,
      span: { line: startLine, column: startCol, endLine: line, endColumn: col, startOffset, endOffset: i },
    });
  }

  tokens.push({
    kind: "eof",
    value: "",
    lower: "",
    span: { line, column: col, endLine: line, endColumn: col, startOffset: len, endOffset: len },
  });

  return tokens;
}
