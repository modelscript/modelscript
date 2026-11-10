// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Tokenizer and Lexer for AMPL source text (.mod, .dat, .run).
 */

import type { SourceLocation, SourceRange } from "../types.js";

export type TokenType =
  | "KEYWORD"
  | "IDENTIFIER"
  | "NUMBER"
  | "STRING"
  | "OPERATOR"
  | "PUNCTUATION"
  | "EOF";

export interface Token {
  type: TokenType;
  value: string;
  numValue?: number | undefined;
  range: SourceRange;
}

export const AMPL_KEYWORDS = new Set([
  "set",
  "param",
  "var",
  "minimize",
  "maximize",
  "subject",
  "to",
  "s.t.",
  "node",
  "arc",
  "in",
  "within",
  "default",
  "dimen",
  "ordered",
  "circular",
  "binary",
  "integer",
  "semicont",
  "semiint",
  "symbolic",
  "sum",
  "prod",
  "min",
  "max",
  "forall",
  "exists",
  "count",
  "numberof",
  "if",
  "then",
  "else",
  "and",
  "or",
  "not",
  "union",
  "inter",
  "diff",
  "symdiff",
  "cross",
  "by",
  "mod",
  "div",
  "complements",
  "table",
  "check",
  "data",
  "model",
  "solve",
  "display",
  "printf",
  "let",
  "fix",
  "unfix",
  "drop",
  "restore",
  "objective",
  "reset",
  "option",
  "include",
  "for",
  "repeat",
  "while",
  "until",
  "break",
  "continue",
  "from",
  "obj",
  "coeff",
  "problem",
  "environ",
  "suffix",
  "function",
  "to_come",
  "net_in",
  "net_out",
  "infinity",
  "Infinity",
]);

export class AmplLexer {
  private input: string;
  private pos = 0;
  private line = 1;
  private col = 1;

  constructor(input: string) {
    this.input = input;
  }

  public tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.input.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.input.length) break;

      const locStart = this.currentLoc();
      const ch = this.input[this.pos];
      if (!ch) break;

      // Multi-character operators or special tokens
      const next2 = this.input.slice(this.pos, this.pos + 2);
      const next3 = this.input.slice(this.pos, this.pos + 3);
      const next4 = this.input.slice(this.pos, this.pos + 4);

      if (next4.toLowerCase() === "s.t.") {
        this.advance(4);
        tokens.push({
          type: "KEYWORD",
          value: "s.t.",
          range: { start: locStart, end: this.currentLoc() },
        });
        continue;
      }

      if (next4 === "<==>") {
        this.advance(4);
        tokens.push({
          type: "OPERATOR",
          value: "<==>",
          range: { start: locStart, end: this.currentLoc() },
        });
        continue;
      }

      if (next3 === "==>" || next3 === "<->") {
        this.advance(3);
        tokens.push({
          type: "OPERATOR",
          value: next3,
          range: { start: locStart, end: this.currentLoc() },
        });
        continue;
      }

      if (
        next2 === ":=" ||
        next2 === ".." ||
        next2 === "<=" ||
        next2 === ">=" ||
        next2 === "==" ||
        next2 === "<>" ||
        next2 === "!=" ||
        next2 === "**" ||
        next2 === "<<" ||
        next2 === ">>" ||
        next2 === "<-" ||
        next2 === "->"
      ) {
        this.advance(2);
        tokens.push({
          type: "OPERATOR",
          value: next2,
          range: { start: locStart, end: this.currentLoc() },
        });
        continue;
      }

      if (ch === "(" || ch === ")" || ch === "[" || ch === "]" || ch === "{" || ch === "}" || ch === "," || ch === ":" || ch === ";") {
        this.advance(1);
        tokens.push({
          type: "PUNCTUATION",
          value: ch,
          range: { start: locStart, end: this.currentLoc() },
        });
        continue;
      }

      if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^" || ch === "<" || ch === ">" || ch === "=" || ch === "~" || ch === "!") {
        this.advance(1);
        tokens.push({
          type: "OPERATOR",
          value: ch,
          range: { start: locStart, end: this.currentLoc() },
        });
        continue;
      }

      // Strings ('...' or "...")
      if (ch === '"' || ch === "'") {
        const quote = ch;
        this.advance(1);
        let strVal = "";
        while (this.pos < this.input.length && this.input[this.pos] !== quote) {
          if (this.input[this.pos] === "\\" && this.pos + 1 < this.input.length) {
            this.advance(1);
            const esc = this.input[this.pos];
            if (esc === "n") strVal += "\n";
            else if (esc === "t") strVal += "\t";
            else if (esc === "r") strVal += "\r";
            else strVal += esc;
          } else {
            strVal += this.input[this.pos];
          }
          this.advance(1);
        }
        if (this.pos < this.input.length && this.input[this.pos] === quote) {
          this.advance(1);
        }
        tokens.push({
          type: "STRING",
          value: strVal,
          range: { start: locStart, end: this.currentLoc() },
        });
        continue;
      }

      // Numbers
      if (this.isDigit(ch) || (ch === "." && this.pos + 1 < this.input.length && this.isDigit(this.input[this.pos + 1]))) {
        let numStr = "";
        let hasDot = false;
        while (this.pos < this.input.length) {
          const cur = this.input[this.pos];
          if (this.isDigit(cur)) {
            numStr += cur;
            this.advance(1);
          } else if (cur === "." && !hasDot && this.isDigit(this.input[this.pos + 1])) {
            hasDot = true;
            numStr += cur;
            this.advance(1);
          } else {
            break;
          }
        }
        // Exponent e.g. 1e-4, 2.5E+3
        if (this.pos < this.input.length && (this.input[this.pos] === "e" || this.input[this.pos] === "E")) {
          numStr += this.input[this.pos];
          this.advance(1);
          if (this.pos < this.input.length && (this.input[this.pos] === "+" || this.input[this.pos] === "-")) {
            numStr += this.input[this.pos];
            this.advance(1);
          }
          while (this.pos < this.input.length && this.isDigit(this.input[this.pos])) {
            numStr += this.input[this.pos];
            this.advance(1);
          }
        }
        const val = Number.parseFloat(numStr);
        tokens.push({
          type: "NUMBER",
          value: numStr,
          numValue: val,
          range: { start: locStart, end: this.currentLoc() },
        });
        continue;
      }

      // Identifiers and Keywords
      if (this.isIdentStart(ch)) {
        let idStr = "";
        while (this.pos < this.input.length && this.isIdentPart(this.input[this.pos])) {
          idStr += this.input[this.pos];
          this.advance(1);
        }
        const lower = idStr.toLowerCase();
        if (AMPL_KEYWORDS.has(idStr) || AMPL_KEYWORDS.has(lower)) {
          tokens.push({
            type: "KEYWORD",
            value: lower,
            range: { start: locStart, end: this.currentLoc() },
          });
        } else {
          tokens.push({
            type: "IDENTIFIER",
            value: idStr,
            range: { start: locStart, end: this.currentLoc() },
          });
        }
        continue;
      }

      // Fallback: single unknown char (e.g. '.')
      this.advance(1);
      tokens.push({
        type: "OPERATOR",
        value: ch ?? "",
        range: { start: locStart, end: this.currentLoc() },
      });
    }

    const endLoc = this.currentLoc();
    tokens.push({
      type: "EOF",
      value: "",
      range: { start: endLoc, end: endLoc },
    });
    return tokens;
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === " " || ch === "\t" || ch === "\r") {
        this.advance(1);
      } else if (ch === "\n") {
        this.line++;
        this.col = 1;
        this.pos++;
      } else if (ch === "#") {
        // Line comment
        while (this.pos < this.input.length && this.input[this.pos] !== "\n") {
          this.advance(1);
        }
      } else if (ch === "/" && this.pos + 1 < this.input.length && this.input[this.pos + 1] === "*") {
        // Block comment
        this.advance(2);
        while (this.pos < this.input.length) {
          if (this.input[this.pos] === "*" && this.pos + 1 < this.input.length && this.input[this.pos + 1] === "/") {
            this.advance(2);
            break;
          }
          if (this.input[this.pos] === "\n") {
            this.line++;
            this.col = 1;
            this.pos++;
          } else {
            this.advance(1);
          }
        }
      } else {
        break;
      }
    }
  }

  private advance(count: number): void {
    this.pos += count;
    this.col += count;
  }

  private currentLoc(): SourceLocation {
    return {
      line: this.line,
      column: this.col,
      offset: this.pos,
    };
  }

  private isDigit(ch: string | undefined): boolean {
    if (!ch) return false;
    const c = ch.charCodeAt(0);
    return c >= 48 && c <= 57;
  }

  private isIdentStart(ch: string | undefined): boolean {
    if (!ch) return false;
    const c = ch.charCodeAt(0);
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
  }

  private isIdentPart(ch: string | undefined): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch) || ch === "-";
  }
}
