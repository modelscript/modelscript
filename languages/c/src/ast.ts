// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Procedural C AST, Lexer, and Parser.
 *
 * Fast zero-allocation tokenization and parsing for procedural C control blocks,
 * simulation equations, S-functions, and filter routines.
 */

export type CStmt =
  | {
      kind: "assign";
      target:
        | { type: "var"; name: string }
        | { type: "subscript"; arrayName: string; indexExpr: CExpr }
        | { type: "port"; portName: string };
      op: "=" | "+=" | "-=" | "*=" | "/=";
      expr: CExpr;
    }
  | {
      kind: "decl";
      varType: string;
      name: string;
      init?: CExpr | undefined;
    }
  | {
      kind: "if";
      condition: CExpr;
      thenBody: CStmt[];
      elseBody?: CStmt[] | undefined;
    }
  | {
      kind: "while";
      condition: CExpr;
      body: CStmt[];
    }
  | {
      kind: "for";
      init?: CStmt | undefined;
      condition?: CExpr | undefined;
      step?: CStmt | undefined;
      body: CStmt[];
    }
  | {
      kind: "call";
      callee: string;
      args: CExpr[];
    }
  | {
      kind: "return";
      expr?: CExpr | undefined;
    }
  | {
      kind: "break";
    }
  | {
      kind: "continue";
    };

export type CExpr =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "var"; name: string }
  | { kind: "port"; portName: string }
  | { kind: "special"; name: "TIME" | "DT" | "FIRST_STEP" }
  | { kind: "subscript"; arrayName: string; indexExpr: CExpr }
  | {
      kind: "binary";
      op:
        | "+"
        | "-"
        | "*"
        | "/"
        | "%"
        | "=="
        | "!="
        | "<"
        | "<="
        | ">"
        | ">="
        | "&&"
        | "||"
        | "&"
        | "|"
        | "^"
        | "<<"
        | ">>";
      left: CExpr;
      right: CExpr;
    }
  | { kind: "unary"; op: "!" | "-" | "~" | "+"; expr: CExpr }
  | { kind: "call"; callee: string; args: CExpr[] }
  | { kind: "math"; func: string; args: CExpr[] };

// =============================================================================
// Tokenizer
// =============================================================================

export type CTokenType =
  | "KEYWORD"
  | "TYPE"
  | "IDENT"
  | "PORT"
  | "NUMBER"
  | "STRING"
  | "OP"
  | "ASSIGN_OP"
  | "LPAREN"
  | "RPAREN"
  | "LBRACKET"
  | "RBRACKET"
  | "LBRACE"
  | "RBRACE"
  | "COMMA"
  | "SEMICOLON";

export interface CToken {
  type: CTokenType;
  value: string;
  line: number;
  col: number;
}

const C_KEYWORDS = new Set([
  "if",
  "else",
  "while",
  "do",
  "for",
  "return",
  "break",
  "continue",
  "sizeof",
  "typedef",
  "struct",
  "union",
  "enum",
  "true",
  "false",
  "NULL",
]);

const C_TYPES = new Set([
  "void",
  "char",
  "short",
  "int",
  "long",
  "float",
  "double",
  "signed",
  "unsigned",
  "bool",
  "size_t",
  "uint8_t",
  "uint16_t",
  "uint32_t",
  "int8_t",
  "int16_t",
  "int32_t",
  "real_T",
  "time_T",
]);

export const C_MATH_FUNCS = new Set([
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "exp",
  "log",
  "log10",
  "sqrt",
  "fabs",
  "pow",
  "fmin",
  "fmax",
  "floor",
  "ceil",
]);

export function tokenizeC(text: string): CToken[] {
  const tokens: CToken[] = [];
  let i = 0;
  const n = text.length;
  let line = 1;
  let lineStart = 0;

  while (i < n) {
    const ch = text[i]!;

    // Newlines
    if (ch === "\n") {
      line++;
      i++;
      lineStart = i;
      continue;
    }

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Line comment //
    if (ch === "/" && i + 1 < n && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }

    // Block comment /* ... */
    if (ch === "/" && i + 1 < n && text[i + 1] === "*") {
      i += 2;
      while (i + 1 < n && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") {
          line++;
          lineStart = i + 1;
        }
        i++;
      }
      i += 2;
      continue;
    }

    const col = i - lineStart + 1;

    // Single-character delimiters
    if (ch === "(") {
      tokens.push({ type: "LPAREN", value: "(", line, col });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "RPAREN", value: ")", line, col });
      i++;
      continue;
    }
    if (ch === "[") {
      tokens.push({ type: "LBRACKET", value: "[", line, col });
      i++;
      continue;
    }
    if (ch === "]") {
      tokens.push({ type: "RBRACKET", value: "]", line, col });
      i++;
      continue;
    }
    if (ch === "{") {
      tokens.push({ type: "LBRACE", value: "{", line, col });
      i++;
      continue;
    }
    if (ch === "}") {
      tokens.push({ type: "RBRACE", value: "}", line, col });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "COMMA", value: ",", line, col });
      i++;
      continue;
    }
    if (ch === ";") {
      tokens.push({ type: "SEMICOLON", value: ";", line, col });
      i++;
      continue;
    }

    // Port reference (e.g. $In, $Out, $u)
    if (ch === "$") {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(text[j]!)) j++;
      tokens.push({ type: "PORT", value: text.slice(i + 1, j), line, col });
      i = j;
      continue;
    }

    // String literal "..."
    if (ch === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') {
        if (text[j] === "\\") j++;
        j++;
      }
      tokens.push({ type: "STRING", value: text.slice(i + 1, j), line, col });
      i = j + 1;
      continue;
    }

    // Numeric literal
    if (/[0-9]/.test(ch) || (ch === "." && i + 1 < n && /[0-9]/.test(text[i + 1]!))) {
      let j = i;
      while (j < n) {
        if (/[0-9.fFlLuU]/.test(text[j]!)) {
          j++;
        } else if ((text[j] === "e" || text[j] === "E") && j + 1 < n) {
          j++;
          if (text[j] === "+" || text[j] === "-") j++;
        } else {
          break;
        }
      }
      tokens.push({ type: "NUMBER", value: text.slice(i, j), line, col });
      i = j;
      continue;
    }

    // Multi-character assignment operators (+=, -=, *=, /=, %=)
    if (/[+\-*/%]/.test(ch) && i + 1 < n && text[i + 1] === "=") {
      tokens.push({ type: "ASSIGN_OP", value: text.slice(i, i + 2), line, col });
      i += 2;
      continue;
    }

    // Multi-character equality / relational / logical / shift operators (==, !=, <=, >=, &&, ||, <<, >>)
    if (i + 1 < n) {
      const two = text.slice(i, i + 2);
      if (["==", "!=", "<=", ">=", "&&", "||", "<<", ">>"].includes(two)) {
        tokens.push({ type: "OP", value: two, line, col });
        i += 2;
        continue;
      }
    }

    // Assignment operator =
    if (ch === "=") {
      tokens.push({ type: "ASSIGN_OP", value: "=", line, col });
      i++;
      continue;
    }

    // Single-character operators (+, -, *, /, %, <, >, !, ~, &, |, ^)
    if (/[+\-*/%<>!~&|^]/.test(ch)) {
      tokens.push({ type: "OP", value: ch, line, col });
      i++;
      continue;
    }

    // Identifier / Keyword / Type
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(text[j]!)) j++;
      const val = text.slice(i, j);
      if (C_KEYWORDS.has(val)) {
        tokens.push({ type: "KEYWORD", value: val, line, col });
      } else if (C_TYPES.has(val)) {
        tokens.push({ type: "TYPE", value: val, line, col });
      } else {
        tokens.push({ type: "IDENT", value: val, line, col });
      }
      i = j;
      continue;
    }

    // Unknown character skip
    i++;
  }

  return tokens;
}

// =============================================================================
// Recursive Descent Parser
// =============================================================================

export class CAstParser {
  private tokens: CToken[];
  private pos = 0;

  constructor(tokens: CToken[]) {
    this.tokens = tokens;
  }

  private peek(): CToken | undefined {
    return this.tokens[this.pos];
  }

  private next(): CToken | undefined {
    return this.tokens[this.pos++];
  }

  private match(type: CTokenType, val?: string): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.type !== type) return false;
    if (val !== undefined && t.value !== val) return false;
    this.pos++;
    return true;
  }

  public parse(): CStmt[] {
    const stmts: CStmt[] = [];
    while (this.pos < this.tokens.length) {
      const s = this.parseStatement();
      if (s) stmts.push(s);
      else this.pos++;
    }
    return stmts;
  }

  private parseStatement(): CStmt | null {
    const t = this.peek();
    if (!t) return null;

    if (t.type === "SEMICOLON") {
      this.pos++;
      return null;
    }

    if (t.type === "KEYWORD") {
      if (t.value === "if") return this.parseIf();
      if (t.value === "while") return this.parseWhile();
      if (t.value === "for") return this.parseFor();
      if (t.value === "return") return this.parseReturn();
      if (t.value === "break") {
        this.pos++;
        this.match("SEMICOLON");
        return { kind: "break" };
      }
      if (t.value === "continue") {
        this.pos++;
        this.match("SEMICOLON");
        return { kind: "continue" };
      }
    }

    if (t.type === "TYPE") {
      return this.parseDeclaration();
    }

    if (t.type === "LBRACE") {
      // Compound block, flatten statements
      this.pos++;
      const inner: CStmt[] = [];
      while (this.pos < this.tokens.length && this.peek()?.type !== "RBRACE") {
        const s = this.parseStatement();
        if (s) inner.push(s);
      }
      this.match("RBRACE");
      return inner.length === 1 ? inner[0]! : { kind: "for", body: inner };
    }

    return this.parseAssignmentOrCall();
  }

  private parseIf(): CStmt {
    this.pos++; // consume 'if'
    this.match("LPAREN");
    const cond = this.parseExpression();
    this.match("RPAREN");

    const thenBody = this.parseBlockOrSingle();
    let elseBody: CStmt[] | undefined;

    if (this.peek()?.type === "KEYWORD" && this.peek()?.value === "else") {
      this.pos++; // consume 'else'
      elseBody = this.parseBlockOrSingle();
    }

    return {
      kind: "if",
      condition: cond,
      thenBody,
      elseBody,
    };
  }

  private parseWhile(): CStmt {
    this.pos++; // consume 'while'
    this.match("LPAREN");
    const cond = this.parseExpression();
    this.match("RPAREN");
    const body = this.parseBlockOrSingle();
    return { kind: "while", condition: cond, body };
  }

  private parseFor(): CStmt {
    this.pos++; // consume 'for'
    this.match("LPAREN");
    const init = this.parseStatement();
    let cond: CExpr | undefined;
    if (this.peek()?.type !== "SEMICOLON") {
      cond = this.parseExpression();
    }
    this.match("SEMICOLON");
    let step: CStmt | undefined;
    if (this.peek()?.type !== "RPAREN") {
      step = this.parseAssignmentOrCall(false) ?? undefined;
    }
    this.match("RPAREN");
    const body = this.parseBlockOrSingle();
    return { kind: "for", init: init ?? undefined, condition: cond, step: step ?? undefined, body };
  }

  private parseReturn(): CStmt {
    this.pos++; // consume 'return'
    let expr: CExpr | undefined;
    if (this.peek()?.type !== "SEMICOLON") {
      expr = this.parseExpression();
    }
    this.match("SEMICOLON");
    return { kind: "return", expr };
  }

  private parseBlockOrSingle(): CStmt[] {
    if (this.peek()?.type === "LBRACE") {
      this.pos++;
      const stmts: CStmt[] = [];
      while (this.pos < this.tokens.length && this.peek()?.type !== "RBRACE") {
        const s = this.parseStatement();
        if (s) stmts.push(s);
      }
      this.match("RBRACE");
      return stmts;
    }
    const single = this.parseStatement();
    return single ? [single] : [];
  }

  private parseDeclaration(): CStmt {
    const typeToken = this.next()!;
    while (this.peek()?.type === "OP" && this.peek()?.value === "*") {
      this.pos++; // Pointer specifier
    }
    const nameToken = this.match("IDENT") ? this.tokens[this.pos - 1]! : { value: "var" };
    let init: CExpr | undefined;
    if (this.peek()?.type === "ASSIGN_OP" && this.peek()?.value === "=") {
      this.pos++;
      init = this.parseExpression();
    }
    this.match("SEMICOLON");
    return {
      kind: "decl",
      varType: typeToken.value,
      name: nameToken.value,
      init,
    };
  }

  private parseAssignmentOrCall(consumeSemicolon = true): CStmt | null {
    const t = this.peek();
    if (!t) return null;

    // Port assignment $Port = expr;
    if (t.type === "PORT") {
      const portName = this.next()!.value;
      if (this.peek()?.type === "ASSIGN_OP") {
        const op = this.next()!.value as "=" | "+=" | "-=" | "*=" | "/=";
        const expr = this.parseExpression();
        if (consumeSemicolon) this.match("SEMICOLON");
        return { kind: "assign", target: { type: "port", portName }, op, expr };
      }
    }

    if (t.type === "IDENT") {
      const name = this.next()!.value;

      // Function call statement: callee(args);
      if (this.peek()?.type === "LPAREN") {
        this.pos++;
        const args: CExpr[] = [];
        while (this.pos < this.tokens.length && this.peek()?.type !== "RPAREN") {
          args.push(this.parseExpression());
          if (this.peek()?.type === "COMMA") this.pos++;
        }
        this.match("RPAREN");
        if (consumeSemicolon) this.match("SEMICOLON");
        return { kind: "call", callee: name, args };
      }

      // Array subscript assignment: arr[idx] = expr;
      if (this.peek()?.type === "LBRACKET") {
        this.pos++;
        const idx = this.parseExpression();
        this.match("RBRACKET");
        if (this.peek()?.type === "ASSIGN_OP") {
          const op = this.next()!.value as "=" | "+=" | "-=" | "*=" | "/=";
          const expr = this.parseExpression();
          if (consumeSemicolon) this.match("SEMICOLON");
          return { kind: "assign", target: { type: "subscript", arrayName: name, indexExpr: idx }, op, expr };
        }
      }

      // Variable assignment: x = expr;
      if (this.peek()?.type === "ASSIGN_OP") {
        const op = this.next()!.value as "=" | "+=" | "-=" | "*=" | "/=";
        const expr = this.parseExpression();
        if (consumeSemicolon) this.match("SEMICOLON");
        return { kind: "assign", target: { type: "var", name }, op, expr };
      }
    }

    // Skip to next semicolon
    if (consumeSemicolon) {
      while (this.pos < this.tokens.length && this.peek()?.type !== "SEMICOLON") {
        this.pos++;
      }
      this.match("SEMICOLON");
    }
    return null;
  }

  public parseExpression(): CExpr {
    return this.parseLogicalOr();
  }

  private parseLogicalOr(): CExpr {
    let left = this.parseLogicalAnd();
    while (this.peek()?.type === "OP" && this.peek()?.value === "||") {
      this.pos++;
      const right = this.parseLogicalAnd();
      left = { kind: "binary", op: "||", left, right };
    }
    return left;
  }

  private parseLogicalAnd(): CExpr {
    let left = this.parseEquality();
    while (this.peek()?.type === "OP" && this.peek()?.value === "&&") {
      this.pos++;
      const right = this.parseEquality();
      left = { kind: "binary", op: "&&", left, right };
    }
    return left;
  }

  private parseEquality(): CExpr {
    let left = this.parseRelational();
    while (this.peek()?.type === "OP" && ["==", "!="].includes(this.peek()!.value)) {
      const op = this.next()!.value as "==" | "!=";
      const right = this.parseRelational();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseRelational(): CExpr {
    let left = this.parseAdditive();
    while (this.peek()?.type === "OP" && ["<", "<=", ">", ">="].includes(this.peek()!.value)) {
      const op = this.next()!.value as "<" | "<=" | ">" | ">=";
      const right = this.parseAdditive();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseAdditive(): CExpr {
    let left = this.parseMultiplicative();
    while (this.peek()?.type === "OP" && ["+", "-"].includes(this.peek()!.value)) {
      const op = this.next()!.value as "+" | "-";
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): CExpr {
    let left = this.parseUnary();
    while (this.peek()?.type === "OP" && ["*", "/", "%"].includes(this.peek()!.value)) {
      const op = this.next()!.value as "*" | "/" | "%";
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): CExpr {
    const t = this.peek();
    if (t && t.type === "OP" && ["-", "!", "~", "+"].includes(t.value)) {
      this.pos++;
      const expr = this.parseUnary();
      return { kind: "unary", op: t.value as "!" | "-" | "~" | "+", expr };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): CExpr {
    const t = this.peek();
    if (!t) return { kind: "number", value: 0 };

    if (t.type === "NUMBER") {
      this.pos++;
      const val = parseFloat(t.value.replace(/[fFlLuU]/g, ""));
      return { kind: "number", value: isNaN(val) ? 0 : val };
    }

    if (t.type === "STRING") {
      this.pos++;
      return { kind: "string", value: t.value };
    }

    if (t.type === "PORT") {
      this.pos++;
      return { kind: "port", portName: t.value };
    }

    if (t.type === "KEYWORD") {
      if (t.value === "true") {
        this.pos++;
        return { kind: "boolean", value: true };
      }
      if (t.value === "false" || t.value === "NULL") {
        this.pos++;
        return { kind: "boolean", value: false };
      }
    }

    if (t.type === "IDENT") {
      const name = this.next()!.value;

      if (name === "TIME" || name === "DT" || name === "FIRST_STEP") {
        return { kind: "special", name };
      }

      // Function call or math intrinsic
      if (this.peek()?.type === "LPAREN") {
        this.pos++;
        const args: CExpr[] = [];
        while (this.pos < this.tokens.length && this.peek()?.type !== "RPAREN") {
          args.push(this.parseExpression());
          if (this.peek()?.type === "COMMA") this.pos++;
        }
        this.match("RPAREN");
        if (C_MATH_FUNCS.has(name.toLowerCase())) {
          return { kind: "math", func: name.toLowerCase(), args };
        }
        return { kind: "call", callee: name, args };
      }

      // Array subscript reference
      if (this.peek()?.type === "LBRACKET") {
        this.pos++;
        const idx = this.parseExpression();
        this.match("RBRACKET");
        return { kind: "subscript", arrayName: name, indexExpr: idx };
      }

      return { kind: "var", name };
    }

    if (t.type === "LPAREN") {
      this.pos++;
      const inner = this.parseExpression();
      this.match("RPAREN");
      return inner;
    }

    this.pos++;
    return { kind: "number", value: 0 };
  }
}

export function parseCScript(source: string): CStmt[] {
  const tokens = tokenizeC(source);
  const parser = new CAstParser(tokens);
  return parser.parse();
}
