// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Parser for AMPL Data (.dat) files.
 */

import type { AmplData, SetElement } from "../types.js";
import { AmplLexer, type Token } from "./ampl-lexer.js";

export class AmplDatParser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokensOrInput: Token[] | string) {
    if (typeof tokensOrInput === "string") {
      this.tokens = new AmplLexer(tokensOrInput).tokenize();
    } else {
      this.tokens = tokensOrInput;
    }
  }

  public parse(): AmplData {
    const data: AmplData = {
      sets: new Map(),
      params: new Map(),
    };

    while (!this.isAtEnd()) {
      if (this.matchKeyword("set")) {
        this.parseSetData(data);
      } else if (this.matchKeyword("param")) {
        this.parseParamData(data);
      } else if (this.matchPunctuation(";")) {
        // empty statement
      } else {
        this.advance();
      }
    }

    return data;
  }

  private parseSetData(data: AmplData): void {
    const name = this.consumeWord("Expected set name").value;
    const elements: SetElement[] = [];

    // Optional attributes or subscript before `:=`
    while (!this.checkOperator(":=") && !this.checkPunctuation(";") && !this.isAtEnd()) {
      this.advance();
    }

    if (this.matchOperator(":=")) {
      while (!this.checkPunctuation(";") && !this.isAtEnd()) {
        if (this.checkPunctuation("(")) {
          // Tuple: (a, b, c)
          this.advance();
          const tuple: (string | number)[] = [];
          while (!this.checkPunctuation(")") && !this.isAtEnd()) {
            if (this.peek().type === "NUMBER") {
              tuple.push(this.advance().numValue!);
            } else if (this.isWordOrString(this.peek())) {
              tuple.push(this.advance().value);
            } else if (this.matchPunctuation(",")) {
              continue;
            } else {
              break;
            }
          }
          this.consumePunctuation(")", "Expected ')' after tuple");
          elements.push(tuple);
        } else if (this.peek().type === "NUMBER") {
          elements.push(this.advance().numValue!);
        } else if (this.isWordOrString(this.peek())) {
          elements.push(this.advance().value);
        } else if (this.matchPunctuation(",")) {
          continue;
        } else {
          break;
        }
      }
    }

    this.consumePunctuation(";", "Expected ';' after set data");
    data.sets.set(name, elements);
  }

  private parseParamData(data: AmplData): void {
    // Syntax variant A: `param: colParam1 colParam2 := row1 v1 v2 row2 v3 v4 ;`
    if (this.matchPunctuation(":")) {
      this.parseMultiParamTable(data);
      return;
    }

    // Optional `(tr)` flag for transposed matrix
    let isTransposed = false;
    if (this.checkPunctuation("(")) {
      this.advance();
      if (this.peek().value === "tr") {
        isTransposed = true;
        this.advance();
      }
      this.consumePunctuation(")", "Expected ')'");
    }

    const name = this.consumeWord("Expected parameter name").value;

    let paramMap = data.params.get(name);
    if (!paramMap) {
      paramMap = new Map();
      data.params.set(name, paramMap);
    }

    // Optional `default <val>`
    let defaultVal: number | string | undefined;
    if (this.matchKeyword("default")) {
      const defTok = this.peek();
      if (defTok.type === "NUMBER") {
        defaultVal = this.advance().numValue!;
      } else if (this.isWordOrString(defTok)) {
        defaultVal = this.advance().value;
      }
    }

    // Optional `(tr)` after name
    if (this.checkPunctuation("(")) {
      this.advance();
      if (this.peek().value === "tr") {
        isTransposed = true;
        this.advance();
      }
      this.consumePunctuation(")", "Expected ')'");
    }

    // Syntax variant B: 2D table `param cost : c1 c2 c3 := r1 v1 v2 v3 ... ;`
    if (this.matchPunctuation(":")) {
      const colHeaders: string[] = [];
      while (!this.checkOperator(":=") && !this.checkPunctuation(";") && !this.isAtEnd()) {
        const tok = this.peek();
        if (tok.type === "NUMBER" || this.isWordOrString(tok)) {
          colHeaders.push(tok.value);
          this.advance();
        } else {
          break;
        }
      }
      this.consumeOperator(":=", "Expected ':=' after table column headers");

      while (!this.checkPunctuation(";") && !this.isAtEnd()) {
        const rowTok = this.peek();
        if (rowTok.type === "PUNCTUATION" && rowTok.value === ";") break;
        const rowHeader = this.advance().value;

        for (const colHeader of colHeaders) {
          if (this.checkPunctuation(";") || this.isAtEnd()) break;
          const valTok = this.peek();
          let val: number | string = 0;
          if (valTok.type === "NUMBER") {
            val = this.advance().numValue!;
          } else if (valTok.value === "-" && this.peekNext().type === "NUMBER") {
            this.advance();
            val = -this.advance().numValue!;
          } else if (this.isWordOrString(valTok)) {
            val = this.advance().value;
          } else if (valTok.value === ".") {
            this.advance();
            val = defaultVal ?? 0;
          }

          if (isTransposed) {
            paramMap.set(`${colHeader},${rowHeader}`, val);
          } else {
            paramMap.set(`${rowHeader},${colHeader}`, val);
          }
        }
      }

      this.consumePunctuation(";", "Expected ';' after table parameter data");
      return;
    }

    // Syntax variant C: Flat map `param name := k1 v1 k2 v2 ... ;` or scalar `param name := 42;` or slice `[*, *, k]`
    if (this.matchOperator(":=")) {
      if (this.peek().type === "NUMBER" && this.peekNext().value === ";") {
        const num = this.advance().numValue!;
        paramMap.set("", num);
        this.consumePunctuation(";", "Expected ';'");
        return;
      }
      if (this.peek().value === "-" && this.peekNext().type === "NUMBER" && (this.tokens[this.pos + 2]?.value === ";")) {
        this.advance();
        const num = -this.advance().numValue!;
        paramMap.set("", num);
        this.consumePunctuation(";", "Expected ';'");
        return;
      }

      let activeSlice: string[] | undefined;

      while (!this.checkPunctuation(";") && !this.isAtEnd()) {
        // Check for slice header `[*, *, k]: c1 c2 :=` or `[k, *]`
        if (this.matchPunctuation("[")) {
          const sliceParts: string[] = [];
          while (!this.checkPunctuation("]") && !this.isAtEnd()) {
            if (this.matchPunctuation(",")) continue;
            sliceParts.push(this.advance().value);
          }
          this.consumePunctuation("]", "Expected ']' after slice template");
          activeSlice = sliceParts;

          // If followed by `:` it's a 2D sub-table under this slice
          if (this.matchPunctuation(":")) {
            const colHeaders: string[] = [];
            while (!this.checkOperator(":=") && !this.checkPunctuation(";") && !this.isAtEnd()) {
              colHeaders.push(this.advance().value);
            }
            this.consumeOperator(":=", "Expected ':=' after slice table headers");
            while (
              !this.checkPunctuation(";") &&
              !this.checkPunctuation("[") &&
              !this.isAtEnd()
            ) {
              const rowHeader = this.advance().value;
              for (const colHeader of colHeaders) {
                if (this.checkPunctuation(";") || this.checkPunctuation("[") || this.isAtEnd()) break;
                let val: number | string = 0;
                if (this.peek().type === "NUMBER") val = this.advance().numValue!;
                else if (this.peek().value === "-" && this.peekNext().type === "NUMBER") {
                  this.advance();
                  val = -this.advance().numValue!;
                } else if (this.peek().value === ".") {
                  this.advance();
                  val = defaultVal ?? 0;
                } else {
                  val = this.advance().value;
                }
                const fullTuple: string[] = [];
                let starIdx = 0;
                for (const sp of activeSlice) {
                  if (sp === "*") {
                    fullTuple.push(starIdx === 0 ? rowHeader : colHeader);
                    starIdx++;
                  } else {
                    fullTuple.push(sp);
                  }
                }
                paramMap.set(fullTuple.join(","), val);
              }
            }
            continue;
          }
        }

        let key = "";
        if (this.checkPunctuation("(")) {
          this.advance();
          const tuple: string[] = [];
          while (!this.checkPunctuation(")") && !this.isAtEnd()) {
            if (this.peek().type === "NUMBER" || this.isWordOrString(this.peek())) {
              tuple.push(this.advance().value);
            } else if (this.matchPunctuation(",")) {
              continue;
            } else {
              break;
            }
          }
          this.consumePunctuation(")", "Expected ')' after tuple key");
          key = tuple.join(",");
        } else {
          key = this.advance().value;
        }

        if (activeSlice) {
          const keyParts = key.split(",");
          let kpIdx = 0;
          const expanded = activeSlice.map((sp) => (sp === "*" ? (keyParts[kpIdx++] ?? "") : sp));
          key = expanded.join(",");
        }

        if (this.checkPunctuation(";") || this.isAtEnd()) break;

        const valTok = this.peek();
        let val: number | string = 0;
        if (valTok.type === "NUMBER") {
          val = this.advance().numValue!;
        } else if (valTok.value === "-" && this.peekNext().type === "NUMBER") {
          this.advance();
          val = -this.advance().numValue!;
        } else if (this.isWordOrString(valTok)) {
          val = this.advance().value;
        }
        paramMap.set(key, val);
      }
    }

    this.consumePunctuation(";", "Expected ';' after parameter data");
  }

  private parseMultiParamTable(data: AmplData): void {
    let setName: string | undefined;
    const paramNames: string[] = [];

    // Support optional `SETNAME : col1 col2 :=`
    if (this.isWordOrString(this.peek()) && this.peekNext().value === ":") {
      setName = this.advance().value;
      this.advance(); // consume ':'
      if (!data.sets.has(setName)) {
        data.sets.set(setName, []);
      }
    }

    while (!this.checkOperator(":=") && !this.checkPunctuation(";") && !this.isAtEnd()) {
      paramNames.push(this.consumeWord("Expected parameter column name").value);
    }
    this.consumeOperator(":=", "Expected ':=' after parameter column list");

    for (const p of paramNames) {
      if (!data.params.has(p)) {
        data.params.set(p, new Map());
      }
    }

    while (!this.checkPunctuation(";") && !this.isAtEnd()) {
      const rowKey = this.advance().value;
      if (setName) {
        data.sets.get(setName)!.push(rowKey);
      }
      for (const p of paramNames) {
        if (this.checkPunctuation(";") || this.isAtEnd()) break;
        const valTok = this.peek();
        let val: number | string = 0;
        if (valTok.type === "NUMBER") {
          val = this.advance().numValue!;
        } else if (valTok.value === "-" && this.peekNext().type === "NUMBER") {
          this.advance();
          val = -this.advance().numValue!;
        } else if (this.isWordOrString(valTok)) {
          val = this.advance().value;
        }
        data.params.get(p)!.set(rowKey, val);
      }
    }

    this.consumePunctuation(";", "Expected ';' after multi-parameter table");
  }

  // ── Helper methods ──

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: "EOF", value: "", range: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } };
  }

  private peekNext(): Token {
    return this.tokens[this.pos + 1] ?? { type: "EOF", value: "", range: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } };
  }

  private previous(): Token {
    return this.tokens[this.pos - 1]!;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.pos++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === "EOF";
  }

  private isWordOrString(tok: Token): boolean {
    return tok.type === "IDENTIFIER" || tok.type === "STRING" || tok.type === "KEYWORD";
  }

  private consumeWord(message: string): Token {
    const tok = this.peek();
    if (tok.type === "IDENTIFIER" || tok.type === "KEYWORD") return this.advance();
    throw new Error(`${message}. Found '${tok.value}' at line ${tok.range.start.line}, column ${tok.range.start.column}`);
  }

  private matchKeyword(val: string): boolean {
    if (this.peek().type === "KEYWORD" && this.peek().value.toLowerCase() === val.toLowerCase()) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchOperator(val: string): boolean {
    if (this.peek().type === "OPERATOR" && this.peek().value === val) {
      this.advance();
      return true;
    }
    return false;
  }

  private checkOperator(val: string): boolean {
    return this.peek().type === "OPERATOR" && this.peek().value === val;
  }

  private matchPunctuation(val: string): boolean {
    if (this.peek().type === "PUNCTUATION" && this.peek().value === val) {
      this.advance();
      return true;
    }
    return false;
  }

  private checkPunctuation(val: string): boolean {
    return this.peek().type === "PUNCTUATION" && this.peek().value === val;
  }

  private consumeOperator(val: string, message: string): Token {
    if (this.checkOperator(val)) return this.advance();
    throw new Error(`${message}. Found '${this.peek().value}' at line ${this.peek().range.start.line}, column ${this.peek().range.start.column}`);
  }

  private consumePunctuation(val: string, message: string): Token {
    if (this.checkPunctuation(val)) return this.advance();
    throw new Error(`${message}. Found '${this.peek().value}' at line ${this.peek().range.start.line}, column ${this.peek().range.start.column}`);
  }
}

export function parseAmplData(input: string): AmplData {
  return new AmplDatParser(input).parse();
}
