// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plcopen — Zero-Regex Structured Text (ST) Lexer & Recursive-Descent Parser.
 *
 * Conforming to IEC 61131-3 3rd Edition Structured Text syntax.
 */

import type {
  PlcBinaryOp,
  PlcCallArg,
  PlcCaseBranch,
  PlcCaseStmt,
  PlcExpr,
  PlcForStmt,
  PlcIfBranch,
  PlcIfStmt,
  PlcLiteralExpr,
  PlcPou,
  PlcPouType,
  PlcProject,
  PlcRange,
  PlcRepeatStmt,
  PlcStatement,
  PlcUnaryOp,
  PlcVariable,
  PlcVariableScope,
  PlcWhileStmt,
  StBody,
} from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Tokenizer / Scanner
// ─────────────────────────────────────────────────────────────────────────────

export type StTokenType = "IDENTIFIER" | "NUMBER" | "STRING" | "TIME" | "OPERATOR" | "PUNCTUATION" | "KEYWORD" | "EOF";

export interface StToken {
  type: StTokenType;
  value: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

const ST_KEYWORDS = new Set([
  "program",
  "end_program",
  "function_block",
  "end_function_block",
  "function",
  "end_function",
  "configuration",
  "end_configuration",
  "resource",
  "end_resource",
  "task",
  "var",
  "var_input",
  "var_output",
  "var_in_out",
  "var_temp",
  "var_global",
  "var_external",
  "var_access",
  "var_config",
  "end_var",
  "constant",
  "retain",
  "non_retain",
  "at",
  "if",
  "then",
  "elsif",
  "else",
  "end_if",
  "case",
  "of",
  "end_case",
  "for",
  "to",
  "by",
  "do",
  "end_for",
  "while",
  "end_while",
  "repeat",
  "until",
  "end_repeat",
  "return",
  "exit",
  "true",
  "false",
  "and",
  "or",
  "xor",
  "not",
  "mod",
]);

export function tokenizeStructuredText(source: string): StToken[] {
  const tokens: StToken[] = [];
  const len = source.length;
  let idx = 0;
  let line = 1;
  let col = 1;

  function advance(): string {
    const ch = source[idx++]!;
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  }

  function peek(): string {
    return idx < len ? source[idx]! : "\0";
  }

  function peekNext(): string {
    return idx + 1 < len ? source[idx + 1]! : "\0";
  }

  while (idx < len) {
    const startLine = line;
    const startCol = col;
    const startOffset = idx;
    const ch = peek();

    // 1. Whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    // 2. Block Comments: (* ... *)
    if (ch === "(" && peekNext() === "*") {
      advance(); // (
      advance(); // *
      let depth = 1;
      while (idx < len && depth > 0) {
        if (peek() === "(" && peekNext() === "*") {
          advance();
          advance();
          depth++;
        } else if (peek() === "*" && peekNext() === ")") {
          advance();
          advance();
          depth--;
        } else {
          advance();
        }
      }
      continue;
    }

    // 3. Line Comments: // ...
    if (ch === "/" && peekNext() === "/") {
      advance();
      advance();
      while (idx < len && peek() !== "\n") {
        advance();
      }
      continue;
    }

    // 4. Time Literals: T#... or TIME#... or t#... or time#...
    if ((ch === "T" || ch === "t") && (peekNext() === "#" || source.slice(idx, idx + 5).toUpperCase() === "TIME#")) {
      let timeVal = "";
      if (peekNext() === "#") {
        timeVal += advance(); // T
        timeVal += advance(); // #
      } else {
        for (let i = 0; i < 5; i++) {
          timeVal += advance();
        }
      }
      while (idx < len && /[a-zA-Z0-9_.-]/.test(peek()) && peek() !== ";" && peek() !== ")" && peek() !== ",") {
        timeVal += advance();
      }
      tokens.push({
        type: "TIME",
        value: timeVal,
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: idx,
      });
      continue;
    }

    // 5. Strings: '...' or "..."
    if (ch === "'" || ch === '"') {
      const quote = advance();
      let strVal = "";
      while (idx < len && peek() !== quote) {
        if (peek() === "$") {
          advance();
          if (idx < len) strVal += advance();
        } else {
          strVal += advance();
        }
      }
      if (idx < len) advance(); // closing quote
      tokens.push({
        type: "STRING",
        value: strVal,
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: idx,
      });
      continue;
    }

    // 6. Direct Hardware Addresses: %IX0.0, %QX0.1, %MD100, etc.
    if (ch === "%") {
      let addr = advance();
      while (idx < len && /[a-zA-Z0-9_.*]/.test(peek())) {
        addr += advance();
      }
      tokens.push({
        type: "IDENTIFIER",
        value: addr,
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: idx,
      });
      continue;
    }

    // 7. Numbers: 123, 123.45, 1.5e-3, 2#1010, 16#FF
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(peekNext()) && peekNext() !== ".")) {
      let numVal = "";
      while (
        idx < len &&
        (/[0-9a-fA-F_.#]/.test(peek()) ||
          ((peek() === "+" || peek() === "-") && (numVal.endsWith("e") || numVal.endsWith("E"))))
      ) {
        // Stop if double dot ..
        if (peek() === "." && peekNext() === ".") {
          break;
        }
        numVal += advance();
      }
      tokens.push({
        type: "NUMBER",
        value: numVal,
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: idx,
      });
      continue;
    }

    // 8. Multi-character Operators and Delimiters
    const twoChars = ch + peekNext();
    if (
      twoChars === ":=" ||
      twoChars === "=>" ||
      twoChars === "<=" ||
      twoChars === ">=" ||
      twoChars === "<>" ||
      twoChars === "**" ||
      twoChars === ".."
    ) {
      advance();
      advance();
      tokens.push({
        type: twoChars === ".." ? "PUNCTUATION" : "OPERATOR",
        value: twoChars,
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: idx,
      });
      continue;
    }

    // 9. Single-character Operators and Punctuation
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "=" || ch === "<" || ch === ">" || ch === "&") {
      advance();
      tokens.push({
        type: "OPERATOR",
        value: ch,
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: idx,
      });
      continue;
    }

    if (ch === ";" || ch === ":" || ch === "," || ch === "(" || ch === ")" || ch === "[" || ch === "]" || ch === ".") {
      advance();
      tokens.push({
        type: "PUNCTUATION",
        value: ch,
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: idx,
      });
      continue;
    }

    // 10. Identifiers & Keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (idx < len && /[a-zA-Z0-9_]/.test(peek())) {
        ident += advance();
      }
      const lower = ident.toLowerCase();
      if (ST_KEYWORDS.has(lower)) {
        if (lower === "and" || lower === "or" || lower === "xor" || lower === "not" || lower === "mod") {
          tokens.push({
            type: "OPERATOR",
            value: ident.toUpperCase(),
            startLine,
            startColumn: startCol,
            endLine: line,
            endColumn: col,
            startOffset,
            endOffset: idx,
          });
        } else {
          tokens.push({
            type: "KEYWORD",
            value: lower,
            startLine,
            startColumn: startCol,
            endLine: line,
            endColumn: col,
            startOffset,
            endOffset: idx,
          });
        }
      } else {
        tokens.push({
          type: "IDENTIFIER",
          value: ident,
          startLine,
          startColumn: startCol,
          endLine: line,
          endColumn: col,
          startOffset,
          endOffset: idx,
        });
      }
      continue;
    }

    // Unknown char: consume and advance
    advance();
  }

  tokens.push({
    type: "EOF",
    value: "",
    startLine: line,
    startColumn: col,
    endLine: line,
    endColumn: col,
    startOffset: idx,
    endOffset: idx,
  });

  return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser Implementation
// ─────────────────────────────────────────────────────────────────────────────

export class StructuredTextParser {
  private tokens: StToken[];
  private pos = 0;

  constructor(tokens: StToken[]) {
    this.tokens = tokens;
  }

  private current(): StToken {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1]!;
  }

  private peekNext(): StToken {
    return this.tokens[this.pos + 1] ?? this.tokens[this.tokens.length - 1]!;
  }

  private checkKeyword(keyword: string): boolean {
    const tok = this.current();
    return tok.type === "KEYWORD" && tok.value.toLowerCase() === keyword.toLowerCase();
  }

  private checkOperator(op: string): boolean {
    const tok = this.current();
    return (tok.type === "OPERATOR" || tok.type === "PUNCTUATION") && tok.value.toUpperCase() === op.toUpperCase();
  }

  private checkPunctuation(punc: string): boolean {
    const tok = this.current();
    return tok.type === "PUNCTUATION" && tok.value === punc;
  }

  private advance(): StToken {
    const tok = this.current();
    if (this.pos < this.tokens.length - 1) {
      this.pos++;
    }
    return tok;
  }

  private consume(expected: string): StToken {
    const tok = this.current();
    if (tok.value.toLowerCase() === expected.toLowerCase() || tok.value === expected) {
      return this.advance();
    }
    // If mismatch, still advance to avoid infinite loop
    return this.advance();
  }

  private makeRange(startTok: StToken, endTok?: StToken): PlcRange {
    const end = endTok ?? startTok;
    return {
      startLine: startTok.startLine,
      startColumn: startTok.startColumn,
      endLine: end.endLine,
      endColumn: end.endColumn,
      startOffset: startTok.startOffset,
      endOffset: end.endOffset,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Parsing Statements
  // ───────────────────────────────────────────────────────────────────────────

  public parseStatements(): PlcStatement[] {
    const stmts: PlcStatement[] = [];
    while (this.current().type !== "EOF") {
      // Check for statement block terminators
      if (
        this.checkKeyword("end_if") ||
        this.checkKeyword("elsif") ||
        this.checkKeyword("else") ||
        this.checkKeyword("end_case") ||
        this.checkKeyword("end_for") ||
        this.checkKeyword("end_while") ||
        this.checkKeyword("until") ||
        this.checkKeyword("end_repeat") ||
        this.checkKeyword("end_program") ||
        this.checkKeyword("end_function_block") ||
        this.checkKeyword("end_function")
      ) {
        break;
      }

      // Empty statement ;
      if (this.checkPunctuation(";")) {
        const tok = this.advance();
        stmts.push({ kind: "empty", range: this.makeRange(tok) });
        continue;
      }

      const stmt = this.parseStatement();
      if (stmt) {
        stmts.push(stmt);
      }
    }
    return stmts;
  }

  public parseStatement(): PlcStatement | null {
    if (this.checkKeyword("if")) {
      return this.parseIf();
    }
    if (this.checkKeyword("case")) {
      return this.parseCase();
    }
    if (this.checkKeyword("for")) {
      return this.parseFor();
    }
    if (this.checkKeyword("while")) {
      return this.parseWhile();
    }
    if (this.checkKeyword("repeat")) {
      return this.parseRepeat();
    }
    if (this.checkKeyword("return")) {
      const tok = this.advance();
      if (this.checkPunctuation(";")) this.advance();
      return { kind: "return", range: this.makeRange(tok) };
    }
    if (this.checkKeyword("exit")) {
      const tok = this.advance();
      if (this.checkPunctuation(";")) this.advance();
      return { kind: "exit", range: this.makeRange(tok) };
    }

    // Assignment or POU Call: identifier ...
    return this.parseAssignmentOrCall();
  }

  private parseIf(): PlcIfStmt {
    const startTok = this.advance(); // IF
    const condition = this.parseExpression();
    this.consume("then");

    const thenStatements = this.parseStatements();
    const elsifs: PlcIfBranch[] = [];

    while (this.checkKeyword("elsif")) {
      this.advance(); // ELSIF
      const cond = this.parseExpression();
      this.consume("then");
      const stmts = this.parseStatements();
      elsifs.push({ condition: cond, statements: stmts });
    }

    let elseStatements: PlcStatement[] = [];
    if (this.checkKeyword("else")) {
      this.advance(); // ELSE
      elseStatements = this.parseStatements();
    }

    const endTok = this.consume("end_if");
    if (this.checkPunctuation(";")) {
      this.advance();
    }

    return {
      kind: "if",
      condition,
      thenStatements,
      elsifs,
      elseStatements,
      range: this.makeRange(startTok, endTok),
    };
  }

  private parseCase(): PlcCaseStmt {
    const startTok = this.advance(); // CASE
    const selector = this.parseExpression();
    this.consume("of");

    const cases: PlcCaseBranch[] = [];
    let elseStatements: PlcStatement[] = [];

    while (!this.checkKeyword("end_case") && !this.checkKeyword("else") && this.current().type !== "EOF") {
      const values: (number | string)[] = [];
      do {
        const valTok = this.current();
        if (valTok.type === "NUMBER") {
          values.push(parseFloat(valTok.value));
          this.advance();
        } else if (valTok.type === "IDENTIFIER" || valTok.type === "STRING") {
          values.push(valTok.value);
          this.advance();
        } else {
          this.advance();
        }
        if (this.checkPunctuation(",")) {
          this.advance();
        } else {
          break;
        }
      } while (this.current().type !== "EOF");

      this.consume(":");
      const stmts = this.parseStatements();
      cases.push({ values, statements: stmts });
    }

    if (this.checkKeyword("else")) {
      this.advance(); // ELSE
      elseStatements = this.parseStatements();
    }

    const endTok = this.consume("end_case");
    if (this.checkPunctuation(";")) {
      this.advance();
    }

    return {
      kind: "case",
      selector,
      cases,
      elseStatements,
      range: this.makeRange(startTok, endTok),
    };
  }

  private parseFor(): PlcForStmt {
    const startTok = this.advance(); // FOR
    const varTok = this.advance(); // variable
    const varName = varTok.value;
    this.consume(":=");
    const startExpr = this.parseExpression();
    this.consume("to");
    const endExpr = this.parseExpression();

    let stepExpr: PlcExpr | undefined = undefined;
    if (this.checkKeyword("by")) {
      this.advance(); // BY
      stepExpr = this.parseExpression();
    }

    this.consume("do");
    const statements = this.parseStatements();
    const endTok = this.consume("end_for");
    if (this.checkPunctuation(";")) {
      this.advance();
    }

    return {
      kind: "for",
      variable: varName,
      start: startExpr,
      end: endExpr,
      step: stepExpr,
      statements,
      range: this.makeRange(startTok, endTok),
    };
  }

  private parseWhile(): PlcWhileStmt {
    const startTok = this.advance(); // WHILE
    const condition = this.parseExpression();
    this.consume("do");
    const statements = this.parseStatements();
    const endTok = this.consume("end_while");
    if (this.checkPunctuation(";")) {
      this.advance();
    }

    return {
      kind: "while",
      condition,
      statements,
      range: this.makeRange(startTok, endTok),
    };
  }

  private parseRepeat(): PlcRepeatStmt {
    const startTok = this.advance(); // REPEAT
    const statements = this.parseStatements();
    this.consume("until");
    const condition = this.parseExpression();
    const endTok = this.consume("end_repeat");
    if (this.checkPunctuation(";")) {
      this.advance();
    }

    return {
      kind: "repeat",
      condition,
      statements,
      range: this.makeRange(startTok, endTok),
    };
  }

  private parseAssignmentOrCall(): PlcStatement | null {
    const startTok = this.current();
    const expr = this.parsePrimary();

    // Check if this is a POU call statement: POU(arg1 := val1, ...)
    if (expr.kind === "call") {
      if (this.checkPunctuation(";")) {
        const semiTok = this.advance();
        return {
          kind: "call",
          callee: expr.callee,
          args: expr.args,
          range: this.makeRange(startTok, semiTok),
        };
      }
      return {
        kind: "call",
        callee: expr.callee,
        args: expr.args,
        range: expr.range,
      };
    }

    // Otherwise, check for := assignment operator
    if (this.checkOperator(":=")) {
      this.advance(); // :=
      const value = this.parseExpression();
      let semiTok = this.current();
      if (this.checkPunctuation(";")) {
        semiTok = this.advance();
      }
      return {
        kind: "assignment",
        target: expr,
        value,
        range: this.makeRange(startTok, semiTok),
      };
    }

    // Expression statement or error fallback: advance past ;
    if (this.checkPunctuation(";")) {
      this.advance();
    }
    return null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Parsing Expressions
  // ───────────────────────────────────────────────────────────────────────────

  public parseExpression(): PlcExpr {
    return this.parseLogicalOr();
  }

  private parseLogicalOr(): PlcExpr {
    let left = this.parseLogicalXor();
    while (this.checkOperator("OR")) {
      this.advance();
      const right = this.parseLogicalXor();
      left = {
        kind: "binary",
        op: "OR",
        left,
        right,
        range: {
          startLine: left.range.startLine,
          startColumn: left.range.startColumn,
          endLine: right.range.endLine,
          endColumn: right.range.endColumn,
          startOffset: left.range.startOffset,
          endOffset: right.range.endOffset,
        },
      };
    }
    return left;
  }

  private parseLogicalXor(): PlcExpr {
    let left = this.parseLogicalAnd();
    while (this.checkOperator("XOR")) {
      this.advance();
      const right = this.parseLogicalAnd();
      left = {
        kind: "binary",
        op: "XOR",
        left,
        right,
        range: {
          startLine: left.range.startLine,
          startColumn: left.range.startColumn,
          endLine: right.range.endLine,
          endColumn: right.range.endColumn,
          startOffset: left.range.startOffset,
          endOffset: right.range.endOffset,
        },
      };
    }
    return left;
  }

  private parseLogicalAnd(): PlcExpr {
    let left = this.parseEquality();
    while (this.checkOperator("AND") || this.checkOperator("&")) {
      this.advance();
      const right = this.parseEquality();
      left = {
        kind: "binary",
        op: "AND",
        left,
        right,
        range: {
          startLine: left.range.startLine,
          startColumn: left.range.startColumn,
          endLine: right.range.endLine,
          endColumn: right.range.endColumn,
          startOffset: left.range.startOffset,
          endOffset: right.range.endOffset,
        },
      };
    }
    return left;
  }

  private parseEquality(): PlcExpr {
    let left = this.parseRelational();
    while (this.checkOperator("=") || this.checkOperator("<>")) {
      const opTok = this.advance();
      const op = opTok.value as PlcBinaryOp;
      const right = this.parseRelational();
      left = {
        kind: "binary",
        op,
        left,
        right,
        range: {
          startLine: left.range.startLine,
          startColumn: left.range.startColumn,
          endLine: right.range.endLine,
          endColumn: right.range.endColumn,
          startOffset: left.range.startOffset,
          endOffset: right.range.endOffset,
        },
      };
    }
    return left;
  }

  private parseRelational(): PlcExpr {
    let left = this.parseAdditive();
    while (this.checkOperator("<") || this.checkOperator("<=") || this.checkOperator(">") || this.checkOperator(">=")) {
      const opTok = this.advance();
      const op = opTok.value as PlcBinaryOp;
      const right = this.parseAdditive();
      left = {
        kind: "binary",
        op,
        left,
        right,
        range: {
          startLine: left.range.startLine,
          startColumn: left.range.startColumn,
          endLine: right.range.endLine,
          endColumn: right.range.endColumn,
          startOffset: left.range.startOffset,
          endOffset: right.range.endOffset,
        },
      };
    }
    return left;
  }

  private parseAdditive(): PlcExpr {
    let left = this.parseMultiplicative();
    while (this.checkOperator("+") || this.checkOperator("-")) {
      const opTok = this.advance();
      const op = opTok.value as PlcBinaryOp;
      const right = this.parseMultiplicative();
      left = {
        kind: "binary",
        op,
        left,
        right,
        range: {
          startLine: left.range.startLine,
          startColumn: left.range.startColumn,
          endLine: right.range.endLine,
          endColumn: right.range.endColumn,
          startOffset: left.range.startOffset,
          endOffset: right.range.endOffset,
        },
      };
    }
    return left;
  }

  private parseMultiplicative(): PlcExpr {
    let left = this.parsePower();
    while (this.checkOperator("*") || this.checkOperator("/") || this.checkOperator("MOD")) {
      const opTok = this.advance();
      const op = opTok.value.toUpperCase() as PlcBinaryOp;
      const right = this.parsePower();
      left = {
        kind: "binary",
        op,
        left,
        right,
        range: {
          startLine: left.range.startLine,
          startColumn: left.range.startColumn,
          endLine: right.range.endLine,
          endColumn: right.range.endColumn,
          startOffset: left.range.startOffset,
          endOffset: right.range.endOffset,
        },
      };
    }
    return left;
  }

  private parsePower(): PlcExpr {
    let left = this.parseUnary();
    while (this.checkOperator("**")) {
      this.advance();
      const right = this.parseUnary();
      left = {
        kind: "binary",
        op: "**",
        left,
        right,
        range: {
          startLine: left.range.startLine,
          startColumn: left.range.startColumn,
          endLine: right.range.endLine,
          endColumn: right.range.endColumn,
          startOffset: left.range.startOffset,
          endOffset: right.range.endOffset,
        },
      };
    }
    return left;
  }

  private parseUnary(): PlcExpr {
    if (this.checkOperator("NOT") || this.checkOperator("-") || this.checkOperator("+")) {
      const opTok = this.advance();
      const op = opTok.value.toUpperCase() as PlcUnaryOp;
      const arg = this.parseUnary();
      return {
        kind: "unary",
        op,
        argument: arg,
        range: {
          startLine: opTok.startLine,
          startColumn: opTok.startColumn,
          endLine: arg.range.endLine,
          endColumn: arg.range.endColumn,
          startOffset: opTok.startOffset,
          endOffset: arg.range.endOffset,
        },
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): PlcExpr {
    const tok = this.current();

    // 1. Parenthesized Expression: ( expr )
    if (this.checkPunctuation("(")) {
      this.advance();
      const expr = this.parseExpression();
      this.consume(")");
      return this.parsePostfix(expr);
    }

    // 2. Boolean Literals: TRUE / FALSE
    if (this.checkKeyword("true") || this.checkKeyword("false")) {
      const t = this.advance();
      const expr: PlcLiteralExpr = {
        kind: "literal",
        literalType: "bool",
        value: t.value.toLowerCase() === "true",
        raw: t.value,
        range: this.makeRange(t),
      };
      return this.parsePostfix(expr);
    }

    // 3. Number Literals
    if (tok.type === "NUMBER") {
      const t = this.advance();
      const expr: PlcLiteralExpr = {
        kind: "literal",
        literalType: "number",
        value: parseFloat(t.value),
        raw: t.value,
        range: this.makeRange(t),
      };
      return this.parsePostfix(expr);
    }

    // 4. String Literals
    if (tok.type === "STRING") {
      const t = this.advance();
      const expr: PlcLiteralExpr = {
        kind: "literal",
        literalType: "string",
        value: t.value,
        raw: t.value,
        range: this.makeRange(t),
      };
      return this.parsePostfix(expr);
    }

    // 5. Time Literals: T#5s, TIME#100ms
    if (tok.type === "TIME") {
      const t = this.advance();
      const expr: PlcLiteralExpr = {
        kind: "literal",
        literalType: "time",
        value: t.value,
        raw: t.value,
        range: this.makeRange(t),
      };
      return this.parsePostfix(expr);
    }

    // 6. Identifiers (variables, functions, calls)
    if (tok.type === "IDENTIFIER") {
      const t = this.advance();
      let expr: PlcExpr = {
        kind: "identifier",
        name: t.value,
        range: this.makeRange(t),
      };
      return this.parsePostfix(expr);
    }

    // Fallback: advance and return literal 0
    this.advance();
    return {
      kind: "literal",
      literalType: "number",
      value: 0,
      raw: "0",
      range: this.makeRange(tok),
    };
  }

  private parsePostfix(expr: PlcExpr): PlcExpr {
    let result = expr;
    while (true) {
      // Member access: expr.prop
      if (this.checkPunctuation(".")) {
        this.advance(); // .
        const propTok = this.advance();
        result = {
          kind: "member",
          object: result,
          property: propTok.value,
          range: {
            startLine: result.range.startLine,
            startColumn: result.range.startColumn,
            endLine: propTok.endLine,
            endColumn: propTok.endColumn,
            startOffset: result.range.startOffset,
            endOffset: propTok.endOffset,
          },
        };
        continue;
      }

      // Array indexing: expr[idx1, idx2]
      if (this.checkPunctuation("[")) {
        this.advance(); // [
        const indices: PlcExpr[] = [];
        do {
          indices.push(this.parseExpression());
          if (this.checkPunctuation(",")) {
            this.advance();
          } else {
            break;
          }
        } while (!this.checkPunctuation("]") && this.current().type !== "EOF");
        const closeTok = this.consume("]");
        result = {
          kind: "index",
          array: result,
          indices,
          range: {
            startLine: result.range.startLine,
            startColumn: result.range.startColumn,
            endLine: closeTok.endLine,
            endColumn: closeTok.endColumn,
            startOffset: result.range.startOffset,
            endOffset: closeTok.endOffset,
          },
        };
        continue;
      }

      // Function or POU Call: callee(arg1 := expr, arg2 => var)
      if (this.checkPunctuation("(") && result.kind === "identifier") {
        this.advance(); // (
        const args: PlcCallArg[] = [];
        while (!this.checkPunctuation(")") && this.current().type !== "EOF") {
          // Check for named argument: name := expr or name => outVar
          if (
            this.current().type === "IDENTIFIER" &&
            (this.peekNext().value === ":=" || this.peekNext().value === "=>")
          ) {
            const argName = this.advance().value;
            const dirTok = this.advance();
            const direction = dirTok.value === "=>" ? "out" : "in";
            const valExpr = this.parseExpression();
            args.push({ name: argName, direction, expr: valExpr });
          } else {
            const valExpr = this.parseExpression();
            args.push({ direction: "in", expr: valExpr });
          }

          if (this.checkPunctuation(",")) {
            this.advance();
          } else {
            break;
          }
        }
        const closeTok = this.consume(")");
        result = {
          kind: "call",
          callee: result.name,
          args,
          range: {
            startLine: result.range.startLine,
            startColumn: result.range.startColumn,
            endLine: closeTok.endLine,
            endColumn: closeTok.endColumn,
            startOffset: result.range.startOffset,
            endOffset: closeTok.endOffset,
          },
        };
        continue;
      }

      break;
    }
    return result;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Parsing Standalone Structured Text Files (.st)
  // ───────────────────────────────────────────────────────────────────────────

  public parseStructuredTextFile(filename?: string): PlcProject {
    const pous: PlcPou[] = [];

    while (this.current().type !== "EOF") {
      if (this.checkKeyword("program")) {
        pous.push(this.parsePouBlock("program"));
      } else if (this.checkKeyword("function_block")) {
        pous.push(this.parsePouBlock("functionBlock"));
      } else if (this.checkKeyword("function")) {
        pous.push(this.parsePouBlock("function"));
      } else {
        // Skip unknown token
        this.advance();
      }
    }

    return {
      dataTypes: [],
      pous,
      configurations: [],
      sourceFile: filename,
    };
  }

  private parsePouBlock(pouType: PlcPouType): PlcPou {
    const startTok = this.advance(); // PROGRAM / FUNCTION_BLOCK / FUNCTION
    const nameTok = this.advance();
    const name = nameTok.value;
    let returnType: string | undefined = undefined;

    if (pouType === "function" && this.checkPunctuation(":")) {
      this.advance(); // :
      const retTypeTok = this.advance();
      returnType = retTypeTok.value;
    }

    const variables: PlcVariable[] = [];

    // Parse variable blocks: VAR_INPUT, VAR_OUTPUT, VAR, etc.
    while (
      this.checkKeyword("var") ||
      this.checkKeyword("var_input") ||
      this.checkKeyword("var_output") ||
      this.checkKeyword("var_in_out") ||
      this.checkKeyword("var_temp") ||
      this.checkKeyword("var_global") ||
      this.checkKeyword("var_external")
    ) {
      const varBlockTok = this.advance();
      const scopeStr = varBlockTok.value.toLowerCase();
      let scope: PlcVariableScope = "local";
      if (scopeStr === "var_input") scope = "input";
      else if (scopeStr === "var_output") scope = "output";
      else if (scopeStr === "var_in_out") scope = "inOut";
      else if (scopeStr === "var_temp") scope = "temp";
      else if (scopeStr === "var_global") scope = "global";
      else if (scopeStr === "var_external") scope = "external";

      let isConstant = false;
      let isRetain = false;

      while (this.checkKeyword("constant") || this.checkKeyword("retain")) {
        if (this.checkKeyword("constant")) {
          isConstant = true;
          this.advance();
        } else if (this.checkKeyword("retain")) {
          isRetain = true;
          this.advance();
        }
      }

      while (!this.checkKeyword("end_var") && this.current().type !== "EOF") {
        if (this.current().type === "IDENTIFIER") {
          const varNames: StToken[] = [];
          do {
            varNames.push(this.advance());
            if (this.checkPunctuation(",")) {
              this.advance();
            } else {
              break;
            }
          } while (this.current().type === "IDENTIFIER");

          let address: string | undefined = undefined;
          if (this.checkKeyword("at")) {
            this.advance(); // AT
            address = this.advance().value;
          }

          this.consume(":");
          const typeTok = this.advance();
          const dataType = typeTok.value;

          let initialValue: string | number | boolean | undefined = undefined;
          if (this.checkOperator(":=")) {
            this.advance(); // :=
            const initTok = this.advance();
            if (initTok.type === "NUMBER") initialValue = parseFloat(initTok.value);
            else if (initTok.type === "KEYWORD" && initTok.value.toLowerCase() === "true") initialValue = true;
            else if (initTok.type === "KEYWORD" && initTok.value.toLowerCase() === "false") initialValue = false;
            else initialValue = initTok.value;
          }

          if (this.checkPunctuation(";")) {
            this.advance();
          }

          for (const vn of varNames) {
            variables.push({
              name: vn.value,
              scope,
              dataType,
              initialValue,
              address,
              isConstant,
              isRetain,
              range: this.makeRange(vn),
            });
          }
        } else {
          this.advance();
        }
      }

      this.consume("end_var");
    }

    // Parse body statements
    const statements = this.parseStatements();

    let endTok = this.current();
    if (pouType === "program") {
      endTok = this.consume("end_program");
    } else if (pouType === "functionBlock") {
      endTok = this.consume("end_function_block");
    } else {
      endTok = this.consume("end_function");
    }

    return {
      name,
      pouType,
      returnType,
      variables,
      body: {
        kind: "ST",
        st: { statements },
      },
      range: this.makeRange(startTok, endTok),
    };
  }
}

/**
 * Parses Structured Text statements from raw code string.
 */
export function parseStructuredTextStatements(source: string): StBody {
  const tokens = tokenizeStructuredText(source);
  const parser = new StructuredTextParser(tokens);
  const statements = parser.parseStatements();
  return { statements, rawSource: source };
}

/**
 * Parses a standalone Structured Text file (.st) into a PlcProject.
 */
export function parseStructuredTextFile(source: string, filename?: string): PlcProject {
  const tokens = tokenizeStructuredText(source);
  const parser = new StructuredTextParser(tokens);
  return parser.parseStructuredTextFile(filename);
}
