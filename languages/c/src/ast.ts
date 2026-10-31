// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Procedural C AST, Lexer, and Parser.
 *
 * Fast zero-allocation tokenization and parsing for procedural C control blocks,
 * simulation equations, S-functions, and filter routines.
 */

export interface CSwitchCase {
  values: CExpr[];
  isDefault?: boolean | undefined;
  body: CStmt[];
  hasBreak?: boolean | undefined;
  line?: number | undefined;
  col?: number | undefined;
}

export type CStmt =
  | {
      kind: "assign";
      target:
        | { type: "var"; name: string }
        | { type: "subscript"; arrayName: string; indexExpr: CExpr }
        | { type: "port"; portName: string }
        | { type: "deref"; pointerName: string };
      op: "=" | "+=" | "-=" | "*=" | "/=";
      expr: CExpr;
      line?: number | undefined;
      col?: number | undefined;
    }
  | {
      kind: "decl";
      varType: string;
      name: string;
      isPointer?: boolean | undefined;
      arraySize?: number | undefined;
      init?: CExpr | undefined;
      initElements?: CExpr[] | undefined;
      line?: number | undefined;
      col?: number | undefined;
    }
  | {
      kind: "if";
      condition: CExpr;
      thenBody: CStmt[];
      elseBody?: CStmt[] | undefined;
      line?: number | undefined;
      col?: number | undefined;
    }
  | {
      kind: "switch";
      expr: CExpr;
      cases: CSwitchCase[];
      line?: number | undefined;
      col?: number | undefined;
    }
  | {
      kind: "while";
      condition: CExpr;
      body: CStmt[];
      line?: number | undefined;
      col?: number | undefined;
    }
  | {
      kind: "for";
      init?: CStmt | undefined;
      condition?: CExpr | undefined;
      step?: CStmt | undefined;
      body: CStmt[];
      line?: number | undefined;
      col?: number | undefined;
    }
  | {
      kind: "call";
      callee: string;
      args: CExpr[];
      line?: number | undefined;
      col?: number | undefined;
    }
  | {
      kind: "return";
      expr?: CExpr | undefined;
      line?: number | undefined;
      col?: number | undefined;
    }
  | {
      kind: "break";
      line?: number | undefined;
      col?: number | undefined;
    }
  | {
      kind: "continue";
      line?: number | undefined;
      col?: number | undefined;
    }
  | {
      kind: "block";
      body: CStmt[];
      line: number;
      col?: number | undefined;
    }
  | {
      kind: "func";
      returnType: string;
      name: string;
      params: { type: string; name: string; isPointer?: boolean | undefined }[];
      body: CStmt[];
      line?: number | undefined;
      col?: number | undefined;
    };

export type CExpr =
  | { kind: "number"; value: number; raw?: string | undefined; line?: number | undefined; col?: number | undefined }
  | { kind: "string"; value: string; line?: number | undefined; col?: number | undefined }
  | {
      kind: "boolean";
      value: boolean;
      isNull?: boolean | undefined;
      line?: number | undefined;
      col?: number | undefined;
    }
  | { kind: "var"; name: string; line?: number | undefined; col?: number | undefined }
  | { kind: "port"; portName: string; line?: number | undefined; col?: number | undefined }
  | { kind: "special"; name: "TIME" | "DT" | "FIRST_STEP"; line?: number | undefined; col?: number | undefined }
  | { kind: "subscript"; arrayName: string; indexExpr: CExpr; line?: number | undefined; col?: number | undefined }
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
      line?: number | undefined;
      col?: number | undefined;
    }
  | { kind: "unary"; op: "!" | "-" | "~" | "+"; expr: CExpr; line?: number | undefined; col?: number | undefined }
  | {
      kind: "ternary";
      cond: CExpr;
      thenExpr: CExpr;
      elseExpr: CExpr;
      line?: number | undefined;
      col?: number | undefined;
    }
  | {
      kind: "cast";
      targetType: string;
      expr: CExpr;
      line?: number | undefined;
      col?: number | undefined;
    }
  | {
      kind: "deref";
      expr: CExpr;
      line?: number | undefined;
      col?: number | undefined;
    }
  | {
      kind: "addressof";
      varName: string;
      line?: number | undefined;
      col?: number | undefined;
    }
  | { kind: "call"; callee: string; args: CExpr[]; line?: number | undefined; col?: number | undefined }
  | { kind: "math"; func: string; args: CExpr[]; line?: number | undefined; col?: number | undefined };

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
  "switch",
  "case",
  "default",
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
  "const",
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

    // Multi-character equality / relational / logical / shift / inc-dec operators (==, !=, <=, >=, &&, ||, <<, >>, ++, --)
    if (i + 1 < n) {
      const two = text.slice(i, i + 2);
      if (["==", "!=", "<=", ">=", "&&", "||", "<<", ">>", "++", "--"].includes(two)) {
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

    // Single-character operators (+, -, *, /, %, <, >, !, ~, &, |, ^, ?, :)
    if (/[+\-*/%<>!~&|^?:]/.test(ch)) {
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

  private peek(offset = 0): CToken | undefined {
    return this.tokens[this.pos + offset];
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
      if (t.value === "switch") return this.parseSwitch();
      if (t.value === "while") return this.parseWhile();
      if (t.value === "for") return this.parseFor();
      if (t.value === "return") return this.parseReturn();
      if (t.value === "break") {
        this.pos++;
        this.match("SEMICOLON");
        return { kind: "break", line: t.line, col: t.col };
      }
      if (t.value === "continue") {
        this.pos++;
        this.match("SEMICOLON");
        return { kind: "continue", line: t.line, col: t.col };
      }
      if (t.value === "const" && this.peek(1)?.type === "TYPE") {
        this.pos++; // consume 'const' qualifier before type
        return this.parseDeclaration();
      }
    }

    if (t.type === "TYPE") {
      return this.parseDeclaration();
    }

    if (t.type === "LBRACE") {
      // Compound block
      const open = this.next()!;
      const inner: CStmt[] = [];
      while (this.pos < this.tokens.length && this.peek()?.type !== "RBRACE") {
        const s = this.parseStatement();
        if (s) inner.push(s);
      }
      this.match("RBRACE");
      return { kind: "block", body: inner, line: open.line, col: open.col };
    }

    return this.parseAssignmentOrCall();
  }

  private parseIf(): CStmt {
    const kw = this.next()!; // consume 'if'
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
      line: kw.line,
      col: kw.col,
    };
  }

  private parseSwitch(): CStmt {
    const kw = this.next()!; // consume 'switch'
    this.match("LPAREN");
    const expr = this.parseExpression();
    this.match("RPAREN");
    this.match("LBRACE");

    const cases: CSwitchCase[] = [];
    while (this.pos < this.tokens.length && this.peek()?.type !== "RBRACE") {
      const tok = this.peek();
      if (!tok) break;

      if (tok.type === "KEYWORD" && (tok.value === "case" || tok.value === "default")) {
        const values: CExpr[] = [];
        let isDefault = false;
        const caseLine = tok.line;
        const caseCol = tok.col;

        // Collect consecutive `case X:` or `default:` labels sharing a body
        while (this.peek()?.type === "KEYWORD" && (this.peek()?.value === "case" || this.peek()?.value === "default")) {
          const labelTok = this.next()!;
          if (labelTok.value === "case") {
            values.push(this.parseExpression());
          } else {
            isDefault = true;
          }
          this.match("OP", ":");
        }

        const body: CStmt[] = [];
        let hasBreak = false;
        while (this.pos < this.tokens.length && this.peek()?.type !== "RBRACE") {
          const nextTok = this.peek();
          if (nextTok?.type === "KEYWORD" && (nextTok.value === "case" || nextTok.value === "default")) {
            break;
          }
          const s = this.parseStatement();
          if (s) {
            if (s.kind === "break") {
              hasBreak = true;
            }
            body.push(s);
          } else {
            this.pos++;
          }
        }

        cases.push({
          values,
          isDefault,
          body,
          hasBreak,
          line: caseLine,
          col: caseCol,
        });
      } else {
        this.pos++;
      }
    }

    this.match("RBRACE");
    return {
      kind: "switch",
      expr,
      cases,
      line: kw.line,
      col: kw.col,
    };
  }

  private parseWhile(): CStmt {
    const kw = this.next()!; // consume 'while'
    this.match("LPAREN");
    const cond = this.parseExpression();
    this.match("RPAREN");
    const body = this.parseBlockOrSingle();
    return { kind: "while", condition: cond, body, line: kw.line, col: kw.col };
  }

  private parseFor(): CStmt {
    const kw = this.next()!; // consume 'for'
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
    return {
      kind: "for",
      init: init ?? undefined,
      condition: cond,
      step: step ?? undefined,
      body,
      line: kw.line,
      col: kw.col,
    };
  }

  private parseReturn(): CStmt {
    const kw = this.next()!; // consume 'return'
    let expr: CExpr | undefined;
    if (this.peek()?.type !== "SEMICOLON") {
      expr = this.parseExpression();
    }
    this.match("SEMICOLON");
    return { kind: "return", expr, line: kw.line, col: kw.col };
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

  private parseDeclaration(): CStmt | null {
    const typeToken = this.next()!;
    let varType = typeToken.value;
    // Consume multi-word C type specifiers (e.g., `unsigned int`, `long double`)
    while (this.peek()?.type === "TYPE") {
      varType += ` ${this.next()!.value}`;
    }

    let isPointer = false;
    while (this.peek()?.type === "OP" && this.peek()?.value === "*") {
      this.pos++; // Pointer specifier
      isPointer = true;
    }
    const nameToken = this.match("IDENT")
      ? this.tokens[this.pos - 1]!
      : { value: "var", line: typeToken.line, col: typeToken.col };

    // Function declaration or definition: Type name(params) { ... }
    if (this.peek()?.type === "LPAREN") {
      this.pos++; // consume '('
      const params: { type: string; name: string; isPointer?: boolean | undefined }[] = [];
      while (this.pos < this.tokens.length && this.peek()?.type !== "RPAREN") {
        if (this.peek()?.type === "KEYWORD" && this.peek()?.value === "const") {
          this.pos++;
        }
        let pType = "double";
        if (this.peek()?.type === "TYPE" || this.peek()?.type === "IDENT") {
          pType = this.next()!.value;
          while (this.peek()?.type === "TYPE") {
            pType += ` ${this.next()!.value}`;
          }
        }
        let paramIsPtr = false;
        while (this.peek()?.type === "OP" && this.peek()?.value === "*") {
          this.pos++;
          paramIsPtr = true;
        }
        if (this.peek()?.type === "IDENT") {
          const pName = this.next()!.value;
          params.push({ type: pType, name: pName, ...(paramIsPtr ? { isPointer: true } : {}) });
        }
        if (this.peek()?.type === "COMMA") {
          this.pos++;
        } else {
          break;
        }
      }
      this.match("RPAREN");
      if (this.peek()?.type === "SEMICOLON") {
        this.pos++;
        return null;
      }
      const body = this.parseBlockOrSingle();
      return {
        kind: "func",
        returnType: varType,
        name: nameToken.value,
        params,
        body,
        line: typeToken.line,
        col: typeToken.col,
      };
    }

    // Optional array dimension: Type arr[N]
    let arraySize: number | undefined;
    if (this.peek()?.type === "LBRACKET") {
      this.pos++;
      if (this.peek()?.type !== "RBRACKET") {
        const sizeExpr = this.parseExpression();
        if (sizeExpr.kind === "number") {
          arraySize = Math.max(0, Math.trunc(sizeExpr.value));
        }
      }
      this.match("RBRACKET");
    }

    let init: CExpr | undefined;
    let initElements: CExpr[] | undefined;
    if (this.peek()?.type === "ASSIGN_OP" && this.peek()?.value === "=") {
      this.pos++;
      if (this.peek()?.type === "LBRACE") {
        this.pos++;
        initElements = [];
        while (this.pos < this.tokens.length && this.peek()?.type !== "RBRACE") {
          initElements.push(this.parseExpression());
          if (this.peek()?.type === "COMMA") this.pos++;
        }
        this.match("RBRACE");
        if (arraySize === undefined) {
          arraySize = initElements.length;
        }
      } else {
        init = this.parseExpression();
      }
    }
    this.match("SEMICOLON");
    return {
      kind: "decl",
      varType,
      name: nameToken.value,
      ...(isPointer ? { isPointer: true } : {}),
      ...(arraySize !== undefined ? { arraySize } : {}),
      init,
      ...(initElements !== undefined ? { initElements } : {}),
      line: nameToken.line,
      col: nameToken.col,
    };
  }

  private parseAssignmentOrCall(consumeSemicolon = true): CStmt | null {
    const t = this.peek();
    if (!t) return null;

    // Pointer dereference assignment: *p = expr;
    if (t.type === "OP" && t.value === "*" && this.peek(1)?.type === "IDENT") {
      const starTok = this.next()!;
      const ptrName = this.next()!.value;
      if (this.peek()?.type === "ASSIGN_OP") {
        const op = this.next()!.value as "=" | "+=" | "-=" | "*=" | "/=";
        const expr = this.parseExpression();
        if (consumeSemicolon) this.match("SEMICOLON");
        return {
          kind: "assign",
          target: { type: "deref", pointerName: ptrName },
          op,
          expr,
          line: starTok.line,
          col: starTok.col,
        };
      }
    }

    // Prefix ++var or --var
    if (t.type === "OP" && (t.value === "++" || t.value === "--")) {
      const opTok = this.next()!;
      if (this.peek()?.type === "IDENT") {
        const name = this.next()!.value;
        if (consumeSemicolon) this.match("SEMICOLON");
        return {
          kind: "assign",
          target: { type: "var", name },
          op: opTok.value === "++" ? "+=" : "-=",
          expr: { kind: "number", value: 1, line: opTok.line, col: opTok.col },
          line: opTok.line,
          col: opTok.col,
        };
      }
    }

    // Port assignment $Port = expr;
    if (t.type === "PORT") {
      const portTok = this.next()!;
      const portName = portTok.value;
      if (this.peek()?.type === "ASSIGN_OP") {
        const op = this.next()!.value as "=" | "+=" | "-=" | "*=" | "/=";
        const expr = this.parseExpression();
        if (consumeSemicolon) this.match("SEMICOLON");
        return {
          kind: "assign",
          target: { type: "port", portName },
          op,
          expr,
          line: portTok.line,
          col: portTok.col,
        };
      }
    }

    if (t.type === "IDENT") {
      const idTok = this.next()!;
      const name = idTok.value;

      // Postfix var++ or var--
      if (this.peek()?.type === "OP" && (this.peek()?.value === "++" || this.peek()?.value === "--")) {
        const opTok = this.next()!;
        if (consumeSemicolon) this.match("SEMICOLON");
        return {
          kind: "assign",
          target: { type: "var", name },
          op: opTok.value === "++" ? "+=" : "-=",
          expr: { kind: "number", value: 1, line: opTok.line, col: opTok.col },
          line: idTok.line,
          col: idTok.col,
        };
      }

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
        return { kind: "call", callee: name, args, line: idTok.line, col: idTok.col };
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
          return {
            kind: "assign",
            target: { type: "subscript", arrayName: name, indexExpr: idx },
            op,
            expr,
            line: idTok.line,
            col: idTok.col,
          };
        }
      }

      // Variable assignment: x = expr;
      if (this.peek()?.type === "ASSIGN_OP") {
        const op = this.next()!.value as "=" | "+=" | "-=" | "*=" | "/=";
        const expr = this.parseExpression();
        if (consumeSemicolon) this.match("SEMICOLON");
        return { kind: "assign", target: { type: "var", name }, op, expr, line: idTok.line, col: idTok.col };
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
    return this.parseTernary();
  }

  private parseTernary(): CExpr {
    const cond = this.parseLogicalOr();
    if (this.peek()?.type === "OP" && this.peek()?.value === "?") {
      const qTok = this.next()!;
      const thenExpr = this.parseExpression();
      this.match("OP", ":");
      const elseExpr = this.parseTernary();
      return {
        kind: "ternary",
        cond,
        thenExpr,
        elseExpr,
        line: cond.line ?? qTok.line,
        col: cond.col ?? qTok.col,
      };
    }
    return cond;
  }

  private parseLogicalOr(): CExpr {
    let left = this.parseLogicalAnd();
    while (this.peek()?.type === "OP" && this.peek()?.value === "||") {
      const opTok = this.next()!;
      const right = this.parseLogicalAnd();
      left = { kind: "binary", op: "||", left, right, line: left.line ?? opTok.line, col: left.col ?? opTok.col };
    }
    return left;
  }

  private parseLogicalAnd(): CExpr {
    let left = this.parseBitwiseOr();
    while (this.peek()?.type === "OP" && this.peek()?.value === "&&") {
      const opTok = this.next()!;
      const right = this.parseBitwiseOr();
      left = { kind: "binary", op: "&&", left, right, line: left.line ?? opTok.line, col: left.col ?? opTok.col };
    }
    return left;
  }

  private parseBitwiseOr(): CExpr {
    let left = this.parseBitwiseXor();
    while (this.peek()?.type === "OP" && this.peek()?.value === "|") {
      const opTok = this.next()!;
      const right = this.parseBitwiseXor();
      left = { kind: "binary", op: "|", left, right, line: left.line ?? opTok.line, col: left.col ?? opTok.col };
    }
    return left;
  }

  private parseBitwiseXor(): CExpr {
    let left = this.parseBitwiseAnd();
    while (this.peek()?.type === "OP" && this.peek()?.value === "^") {
      const opTok = this.next()!;
      const right = this.parseBitwiseAnd();
      left = { kind: "binary", op: "^", left, right, line: left.line ?? opTok.line, col: left.col ?? opTok.col };
    }
    return left;
  }

  private parseBitwiseAnd(): CExpr {
    let left = this.parseEquality();
    while (this.peek()?.type === "OP" && this.peek()?.value === "&") {
      const opTok = this.next()!;
      const right = this.parseEquality();
      left = { kind: "binary", op: "&", left, right, line: left.line ?? opTok.line, col: left.col ?? opTok.col };
    }
    return left;
  }

  private parseEquality(): CExpr {
    let left = this.parseRelational();
    while (this.peek()?.type === "OP" && ["==", "!="].includes(this.peek()!.value)) {
      const opTok = this.next()!;
      const op = opTok.value as "==" | "!=";
      const right = this.parseRelational();
      left = { kind: "binary", op, left, right, line: left.line ?? opTok.line, col: left.col ?? opTok.col };
    }
    return left;
  }

  private parseRelational(): CExpr {
    let left = this.parseShift();
    while (this.peek()?.type === "OP" && ["<", "<=", ">", ">="].includes(this.peek()!.value)) {
      const opTok = this.next()!;
      const op = opTok.value as "<" | "<=" | ">" | ">=";
      const right = this.parseShift();
      left = { kind: "binary", op, left, right, line: left.line ?? opTok.line, col: left.col ?? opTok.col };
    }
    return left;
  }

  private parseShift(): CExpr {
    let left = this.parseAdditive();
    while (this.peek()?.type === "OP" && ["<<", ">>"].includes(this.peek()!.value)) {
      const opTok = this.next()!;
      const op = opTok.value as "<<" | ">>";
      const right = this.parseAdditive();
      left = { kind: "binary", op, left, right, line: left.line ?? opTok.line, col: left.col ?? opTok.col };
    }
    return left;
  }

  private parseAdditive(): CExpr {
    let left = this.parseMultiplicative();
    while (this.peek()?.type === "OP" && ["+", "-"].includes(this.peek()!.value)) {
      const opTok = this.next()!;
      const op = opTok.value as "+" | "-";
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right, line: left.line ?? opTok.line, col: left.col ?? opTok.col };
    }
    return left;
  }

  private parseMultiplicative(): CExpr {
    let left = this.parseUnary();
    while (this.peek()?.type === "OP" && ["*", "/", "%"].includes(this.peek()!.value)) {
      const opTok = this.next()!;
      const op = opTok.value as "*" | "/" | "%";
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right, line: opTok.line, col: opTok.col };
    }
    return left;
  }

  private parseUnary(): CExpr {
    const t = this.peek();

    // C-style type cast: (type)expr or (const type *)expr
    if (t?.type === "LPAREN") {
      let look = 1;
      if (this.peek(look)?.type === "KEYWORD" && this.peek(look)?.value === "const") {
        look++;
      }
      if (this.peek(look)?.type === "TYPE") {
        const typeParts: string[] = [];
        while (this.peek(look)?.type === "TYPE") {
          typeParts.push(this.peek(look)!.value);
          look++;
        }
        while (this.peek(look)?.type === "OP" && this.peek(look)?.value === "*") {
          typeParts.push("*");
          look++;
        }
        if (this.peek(look)?.type === "RPAREN") {
          this.pos += look + 1; // consume '(...)'
          const expr = this.parseUnary();
          return {
            kind: "cast",
            targetType: typeParts.join(" "),
            expr,
            line: t.line,
            col: t.col,
          };
        }
      }
    }

    // Pointer dereference: *expr
    if (t && t.type === "OP" && t.value === "*") {
      this.pos++;
      const expr = this.parseUnary();
      return { kind: "deref", expr, line: t.line, col: t.col };
    }

    // Address-of: &var
    if (t && t.type === "OP" && t.value === "&" && this.peek(1)?.type === "IDENT") {
      this.pos++;
      const idTok = this.next()!;
      return { kind: "addressof", varName: idTok.value, line: t.line, col: t.col };
    }

    if (t && t.type === "OP" && ["-", "!", "~", "+"].includes(t.value)) {
      this.pos++;
      const expr = this.parseUnary();
      return { kind: "unary", op: t.value as "!" | "-" | "~" | "+", expr, line: t.line, col: t.col };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): CExpr {
    const t = this.peek();
    if (!t) return { kind: "number", value: 0 };

    if (t.type === "NUMBER") {
      this.pos++;
      const val = parseFloat(t.value.replace(/[fFlLuU]/g, ""));
      return { kind: "number", value: isNaN(val) ? 0 : val, raw: t.value, line: t.line, col: t.col };
    }

    if (t.type === "STRING") {
      this.pos++;
      return { kind: "string", value: t.value, line: t.line, col: t.col };
    }

    if (t.type === "PORT") {
      this.pos++;
      return { kind: "port", portName: t.value, line: t.line, col: t.col };
    }

    if (t.type === "KEYWORD") {
      if (t.value === "true") {
        this.pos++;
        return { kind: "boolean", value: true, line: t.line, col: t.col };
      }
      if (t.value === "false" || t.value === "NULL") {
        this.pos++;
        return { kind: "boolean", value: false, isNull: t.value === "NULL", line: t.line, col: t.col };
      }
    }

    if (t.type === "IDENT") {
      const idTok = this.next()!;
      const name = idTok.value;

      if (name === "TIME" || name === "DT" || name === "FIRST_STEP") {
        return { kind: "special", name, line: idTok.line, col: idTok.col };
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
          return { kind: "math", func: name.toLowerCase(), args, line: idTok.line, col: idTok.col };
        }
        return { kind: "call", callee: name, args, line: idTok.line, col: idTok.col };
      }

      // Array subscript reference
      if (this.peek()?.type === "LBRACKET") {
        this.pos++;
        const idx = this.parseExpression();
        this.match("RBRACKET");
        return { kind: "subscript", arrayName: name, indexExpr: idx, line: idTok.line, col: idTok.col };
      }

      return { kind: "var", name, line: idTok.line, col: idTok.col };
    }

    if (t.type === "LPAREN") {
      this.pos++;
      const inner = this.parseExpression();
      this.match("RPAREN");
      return inner;
    }

    this.pos++;
    return { kind: "number", value: 0, line: t.line, col: t.col };
  }
}

export function parseCScript(source: string): CStmt[] {
  const tokens = tokenizeC(source);
  const parser = new CAstParser(tokens);
  return parser.parse();
}
