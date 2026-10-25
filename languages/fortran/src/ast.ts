// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fortran Procedural AST, Lexer, and Parser.
 *
 * Translates procedural Fortran statements (IF/THEN/ELSE, assignments,
 * state machine storage, and intrinsic math) into a typed AST.
 */

export type FortranStmt =
  | {
      kind: "assign";
      target:
        | { type: "var"; name: string }
        | { type: "port"; portName: string }
        | { type: "state"; array: "storf" | "stori"; indexExpr: FortranExpr };
      expr: FortranExpr;
    }
  | {
      kind: "if";
      condition: FortranExpr;
      thenBody: FortranStmt[];
      elseBody?: FortranStmt[] | undefined;
    }
  | {
      kind: "call";
      subroutine: string;
      args: FortranExpr[];
    }
  | {
      kind: "stateAdvance";
      array: "storf" | "stori";
      delta: number;
    };

export type FortranExpr =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "var"; name: string }
  | { kind: "port"; portName: string }
  | { kind: "special"; name: "TIME" | "DELT" | "FIRSTSTEP" }
  | { kind: "state"; array: "storf" | "stori"; indexExpr: FortranExpr }
  | {
      kind: "binary";
      op: "+" | "-" | "*" | "/" | "^" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||";
      left: FortranExpr;
      right: FortranExpr;
    }
  | { kind: "unary"; op: "!" | "-"; expr: FortranExpr }
  | { kind: "math"; func: string; args: FortranExpr[] };

// =============================================================================
// Tokenizer
// =============================================================================

type TokenType = "KEYWORD" | "IDENT" | "STRING" | "PORT" | "NUMBER" | "OP" | "LPAREN" | "RPAREN" | "COMMA" | "ASSIGN";

export interface Token {
  type: TokenType;
  value: string;
}

const FORTRAN_KEYWORDS = new Set(["if", "then", "else", "elseif", "endif", "call", "true", "false"]);

const FORTRAN_MATH_FUNCS = new Set([
  "sqrt",
  "abs",
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
  "min",
  "max",
]);

export function tokenizeFortran(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i]!;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "LPAREN", value: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "RPAREN", value: ")" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "COMMA", value: "," });
      i++;
      continue;
    }

    // String literals ("..." or '...')
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let strVal = "";
      while (i < n && text[i] !== quote) {
        strVal += text[i]!;
        i++;
      }
      if (i < n && text[i] === quote) {
        i++;
      }
      tokens.push({ type: "STRING", value: strVal });
      continue;
    }

    // Port references starting with '$'
    if (ch === "$") {
      i++;
      let portName = "";
      while (i < n && /[A-Za-z0-9_]/.test(text[i]!)) {
        portName += text[i]!;
        i++;
      }
      tokens.push({ type: "PORT", value: portName });
      continue;
    }

    // Assignment or equality
    if (ch === "=") {
      if (text[i + 1] === "=") {
        tokens.push({ type: "OP", value: "==" });
        i += 2;
      } else {
        tokens.push({ type: "ASSIGN", value: "=" });
        i++;
      }
      continue;
    }

    // Multi-char operators: <=, >=, !=, &&, ||, **
    const two = text.slice(i, i + 2);
    if (["<=", ">=", "!=", "&&", "||", "**"].includes(two)) {
      tokens.push({ type: "OP", value: two === "**" ? "^" : two });
      i += 2;
      continue;
    }

    // Single-character operators: +, -, *, /, <, >, !
    if ("+-*/<>!".includes(ch)) {
      tokens.push({ type: "OP", value: ch });
      i++;
      continue;
    }

    // Fortran dot operators e.g. .AND., .OR., .NOT., .EQ., .NE., .GT., .GE., .LT., .LE.
    if (ch === ".") {
      const dotMatch = /^\.([A-Za-z]+)\./i.exec(text.slice(i));
      if (dotMatch) {
        const dotOp = dotMatch[1]!.toUpperCase();
        let mapped = "";
        switch (dotOp) {
          case "AND":
            mapped = "&&";
            break;
          case "OR":
            mapped = "||";
            break;
          case "NOT":
            mapped = "!";
            break;
          case "EQ":
            mapped = "==";
            break;
          case "NE":
            mapped = "!=";
            break;
          case "GT":
            mapped = ">";
            break;
          case "GE":
            mapped = ">=";
            break;
          case "LT":
            mapped = "<";
            break;
          case "LE":
            mapped = "<=";
            break;
          case "TRUE":
            tokens.push({ type: "KEYWORD", value: "true" });
            i += dotMatch[0].length;
            continue;
          case "FALSE":
            tokens.push({ type: "KEYWORD", value: "false" });
            i += dotMatch[0].length;
            continue;
        }
        if (mapped) {
          tokens.push({ type: "OP", value: mapped });
          i += dotMatch[0].length;
          continue;
        }
      }
    }

    // Numbers (integers, floats, scientific notation 1e-3, 1.0E6)
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(text[i + 1] ?? ""))) {
      let numStr = "";
      while (i < n && /[0-9.eE+-]/.test(text[i]!)) {
        if ((text[i] === "+" || text[i] === "-") && !/[eE]/.test(numStr.slice(-1))) {
          break;
        }
        numStr += text[i]!;
        i++;
      }
      tokens.push({ type: "NUMBER", value: numStr });
      continue;
    }

    // Identifiers & Keywords
    if (/[A-Za-z_]/.test(ch)) {
      let ident = "";
      while (i < n && /[A-Za-z0-9_]/.test(text[i]!)) {
        ident += text[i]!;
        i++;
      }
      const lower = ident.toLowerCase();
      if (FORTRAN_KEYWORDS.has(lower)) {
        tokens.push({ type: "KEYWORD", value: lower });
      } else {
        tokens.push({ type: "IDENT", value: ident });
      }
      continue;
    }

    // Skip unhandled characters
    i++;
  }

  return tokens;
}

// =============================================================================
// AST Parser
// =============================================================================

export class FortranAstParser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  public parseProgram(): FortranStmt[] {
    const stmts: FortranStmt[] = [];
    while (this.pos < this.tokens.length) {
      const stmt = this.parseStatement();
      if (stmt) {
        stmts.push(stmt);
      }
    }
    return stmts;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    return this.tokens[this.pos++]!;
  }

  private checkKeyword(val: string): boolean {
    const tok = this.peek();
    return tok?.type === "KEYWORD" && tok.value.toLowerCase() === val.toLowerCase();
  }

  private parseStatement(): FortranStmt | null {
    const tok = this.peek();
    if (!tok) return null;

    // 1. IF Statement: IF (cond) THEN ... ELSE ... ENDIF or single-line IF (cond) stmt
    if (this.checkKeyword("if")) {
      this.consume(); // eat 'if'
      if (this.peek()?.type !== "LPAREN") return null;
      this.consume(); // eat '('
      const condition = this.parseExpr();
      if (this.peek()?.type === "RPAREN") {
        this.consume(); // eat ')'
      }

      // Check for block IF: 'THEN'
      if (this.checkKeyword("then")) {
        this.consume(); // eat 'then'
        const thenBody: FortranStmt[] = [];
        const elseBody: FortranStmt[] = [];
        let inElse = false;

        while (this.pos < this.tokens.length) {
          if (this.checkKeyword("endif")) {
            this.consume();
            break;
          } else if (this.checkKeyword("else")) {
            this.consume();
            inElse = true;
          } else if (this.checkKeyword("elseif")) {
            // Treat ELSEIF as nested ELSE { IF (c) THEN ... }
            this.consume();
            if (this.peek()?.type === "LPAREN") this.consume();
            const elseIfCond = this.parseExpr();
            if (this.peek()?.type === "RPAREN") this.consume();
            if (this.checkKeyword("then")) this.consume();
            const nested = this.parseBlockUntilEndif();
            elseBody.push({
              kind: "if",
              condition: elseIfCond,
              thenBody: nested.thenBody,
              elseBody: nested.elseBody,
            });
            break;
          } else {
            const innerStmt = this.parseStatement();
            if (innerStmt) {
              if (inElse) elseBody.push(innerStmt);
              else thenBody.push(innerStmt);
            }
          }
        }

        return {
          kind: "if",
          condition,
          thenBody,
          elseBody: elseBody.length > 0 ? elseBody : undefined,
        };
      } else {
        // Single-line IF: IF (cond) assignment/call
        const singleStmt = this.parseStatement();
        return {
          kind: "if",
          condition,
          thenBody: singleStmt ? [singleStmt] : [],
        };
      }
    }

    // 2. CALL Statement: CALL Subroutine(args)
    if (this.checkKeyword("call")) {
      this.consume(); // eat 'call'
      const subName = this.consume().value;
      const args: FortranExpr[] = [];
      if (this.peek()?.type === "LPAREN") {
        this.consume();
        while (this.pos < this.tokens.length && this.peek()?.type !== "RPAREN") {
          args.push(this.parseExpr());
          if (this.peek()?.type === "COMMA") {
            this.consume();
          }
        }
        if (this.peek()?.type === "RPAREN") this.consume();
      }
      return { kind: "call", subroutine: subName, args };
    }

    // 3. Assignment Statement: target = expr
    if (tok.type === "PORT") {
      this.consume();
      if (this.peek()?.type === "ASSIGN") {
        this.consume();
        const expr = this.parseExpr();
        return { kind: "assign", target: { type: "port", portName: tok.value }, expr };
      }
    } else if (tok.type === "IDENT") {
      const name = tok.value;
      const upper = name.toUpperCase();

      // Check state pointer advance: NSTORF = NSTORF + 1 or NSTORI = NSTORI + 1
      if ((upper === "NSTORF" || upper === "NSTORI") && this.tokens[this.pos + 1]?.type === "ASSIGN") {
        this.consume(); // eat name
        this.consume(); // eat '='
        // Parse the RHS expression
        this.parseExpr();
        const array = upper === "NSTORF" ? ("storf" as const) : ("stori" as const);
        return { kind: "stateAdvance", array, delta: 1 };
      }

      // Check array assignment: STORF(idx) = ... or STORI(idx) = ...
      if (upper === "STORF" || upper === "STORI") {
        this.consume();
        if (this.peek()?.type === "LPAREN") {
          this.consume();
          const indexExpr = this.parseExpr();
          if (this.peek()?.type === "RPAREN") this.consume();
          if (this.peek()?.type === "ASSIGN") {
            this.consume();
            const expr = this.parseExpr();
            const array = upper === "STORF" ? ("storf" as const) : ("stori" as const);
            return { kind: "assign", target: { type: "state", array, indexExpr }, expr };
          }
        }
      }

      // Standard variable assignment: Var = Expr
      this.consume();
      if (this.peek()?.type === "ASSIGN") {
        this.consume();
        const expr = this.parseExpr();
        return { kind: "assign", target: { type: "var", name }, expr };
      }
    }

    // Skip stray token
    this.consume();
    return null;
  }

  private parseBlockUntilEndif(): { thenBody: FortranStmt[]; elseBody?: FortranStmt[] | undefined } {
    const thenBody: FortranStmt[] = [];
    const elseBody: FortranStmt[] = [];
    let inElse = false;

    while (this.pos < this.tokens.length) {
      if (this.checkKeyword("endif")) {
        this.consume();
        break;
      } else if (this.checkKeyword("else")) {
        this.consume();
        inElse = true;
      } else {
        const stmt = this.parseStatement();
        if (stmt) {
          if (inElse) elseBody.push(stmt);
          else thenBody.push(stmt);
        }
      }
    }

    return { thenBody, elseBody: elseBody.length > 0 ? elseBody : undefined };
  }

  // ===========================================================================
  // Expression Parser (Precedence Climbing)
  // ===========================================================================

  public parseExpr(): FortranExpr {
    return this.parseLogicalOr();
  }

  private parseLogicalOr(): FortranExpr {
    let left = this.parseLogicalAnd();
    while (this.peek()?.type === "OP" && this.peek()?.value === "||") {
      this.consume();
      const right = this.parseLogicalAnd();
      left = { kind: "binary", op: "||", left, right };
    }
    return left;
  }

  private parseLogicalAnd(): FortranExpr {
    let left = this.parseEquality();
    while (this.peek()?.type === "OP" && this.peek()?.value === "&&") {
      this.consume();
      const right = this.parseEquality();
      left = { kind: "binary", op: "&&", left, right };
    }
    return left;
  }

  private parseEquality(): FortranExpr {
    let left = this.parseRelational();
    while (this.peek()?.type === "OP" && (this.peek()?.value === "==" || this.peek()?.value === "!=")) {
      const op = this.consume().value as "==" | "!=";
      const right = this.parseRelational();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseRelational(): FortranExpr {
    let left = this.parseAdditive();
    while (this.peek()?.type === "OP" && ["<", "<=", ">", ">="].includes(this.peek()?.value ?? "")) {
      const op = this.consume().value as "<" | "<=" | ">" | ">=";
      const right = this.parseAdditive();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseAdditive(): FortranExpr {
    let left = this.parseMultiplicative();
    while (this.peek()?.type === "OP" && (this.peek()?.value === "+" || this.peek()?.value === "-")) {
      const op = this.consume().value as "+" | "-";
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): FortranExpr {
    let left = this.parsePower();
    while (this.peek()?.type === "OP" && (this.peek()?.value === "*" || this.peek()?.value === "/")) {
      const op = this.consume().value as "*" | "/";
      const right = this.parsePower();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parsePower(): FortranExpr {
    let left = this.parseUnary();
    while (this.peek()?.type === "OP" && this.peek()?.value === "^") {
      this.consume();
      const right = this.parseUnary();
      left = { kind: "binary", op: "^", left, right };
    }
    return left;
  }

  private parseUnary(): FortranExpr {
    const tok = this.peek();
    if (tok?.type === "OP" && (tok.value === "!" || tok.value === "-")) {
      const op = this.consume().value as "!" | "-";
      return { kind: "unary", op, expr: this.parseUnary() };
    }
    if (tok?.type === "OP" && tok.value === "+") {
      this.consume();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FortranExpr {
    const tok = this.consume();
    if (!tok) return { kind: "number", value: 0 };

    if (tok.type === "LPAREN") {
      const inner = this.parseExpr();
      if (this.peek()?.type === "RPAREN") {
        this.consume();
      }
      return inner;
    }

    if (tok.type === "NUMBER") {
      return { kind: "number", value: parseFloat(tok.value) || 0 };
    }

    if (tok.type === "STRING") {
      return { kind: "string", value: tok.value };
    }

    if (tok.type === "KEYWORD") {
      if (tok.value === "true") return { kind: "boolean", value: true };
      if (tok.value === "false") return { kind: "boolean", value: false };
    }

    if (tok.type === "PORT") {
      return { kind: "port", portName: tok.value };
    }

    if (tok.type === "IDENT") {
      const upper = tok.value.toUpperCase();
      const lower = tok.value.toLowerCase();

      // Special EMTDC runtime identifiers
      if (upper === "TIME" || upper === "DELT" || upper === "FIRSTSTEP") {
        return { kind: "special", name: upper };
      }

      // State register reads: STORF(idx) or STORI(idx)
      if (upper === "STORF" || upper === "STORI") {
        if (this.peek()?.type === "LPAREN") {
          this.consume();
          const indexExpr = this.parseExpr();
          if (this.peek()?.type === "RPAREN") this.consume();
          return {
            kind: "state",
            array: upper === "STORF" ? "storf" : "stori",
            indexExpr,
          };
        }
      }

      // Math functions: e.g. sqrt(x), abs(x), sin(x)
      if (FORTRAN_MATH_FUNCS.has(lower)) {
        if (this.peek()?.type === "LPAREN") {
          this.consume();
          const args: FortranExpr[] = [];
          while (this.pos < this.tokens.length && this.peek()?.type !== "RPAREN") {
            args.push(this.parseExpr());
            if (this.peek()?.type === "COMMA") this.consume();
          }
          if (this.peek()?.type === "RPAREN") this.consume();
          return { kind: "math", func: lower, args };
        }
      }

      return { kind: "var", name: tok.value };
    }

    return { kind: "number", value: 0 };
  }
}

export function parseFortranScript(code: string): FortranStmt[] {
  const tokens = tokenizeFortran(code);
  const parser = new FortranAstParser(tokens);
  return parser.parseProgram();
}
