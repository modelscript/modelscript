// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Recursive-descent + Pratt expression parser for Lustre (.lus, .ec).
 *
 * Supports `const`, `type`, `node`/`function`, `returns`, `var`, `let ... tel`,
 * `->`, `pre`, `when`, `current`, `merge`, `if ... then ... else`, `assert`,
 * `and`/`or`/`not`/`xor`/`div`/`mod`/`=>`, and `--` / `/* *\/` / `(* *)` comments.
 */

import type {
  LustreAssertion,
  LustreBinaryOp,
  LustreClock,
  LustreConstDecl,
  LustreEquation,
  LustreExpr,
  LustreNodeDecl,
  LustreProgram,
  LustreSpan,
  LustreSyntaxError,
  LustreType,
  LustreTypeDecl,
  LustreVarDecl,
} from "../types.js";

type TokenKind = "ident" | "int" | "real" | "keyword" | "op" | "punct" | "eof";

interface Token {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
}

const KEYWORDS = new Set([
  "const",
  "type",
  "node",
  "function",
  "returns",
  "var",
  "let",
  "tel",
  "if",
  "then",
  "else",
  "pre",
  "when",
  "current",
  "merge",
  "assert",
  "and",
  "or",
  "not",
  "xor",
  "div",
  "mod",
  "true",
  "false",
  "bool",
  "int",
  "real",
]);

function tokenize(source: string, errors: LustreSyntaxError[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = source.length;

  const advance = (): string => {
    const ch = source[i++]!;
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  };

  while (i < n) {
    const ch = source[i]!;

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    // Line comment: -- ...
    if (ch === "-" && source[i + 1] === "-") {
      while (i < n && source[i] !== "\n") advance();
      continue;
    }

    // Block comment: /* ... */
    if (ch === "/" && source[i + 1] === "*") {
      const start = i;
      const sLine = line;
      const sCol = col;
      advance();
      advance();
      let closed = false;
      while (i < n) {
        if (source[i] === "*" && source[i + 1] === "/") {
          advance();
          advance();
          closed = true;
          break;
        }
        advance();
      }
      if (!closed) {
        errors.push({
          message: "Unterminated block comment '/*'",
          span: { startOffset: start, endOffset: i, line: sLine, column: sCol, endLine: line, endColumn: col },
        });
      }
      continue;
    }

    // Pascal/Lustre block comment: (* ... *)
    if (ch === "(" && source[i + 1] === "*") {
      const start = i;
      const sLine = line;
      const sCol = col;
      advance();
      advance();
      let closed = false;
      while (i < n) {
        if (source[i] === "*" && source[i + 1] === ")") {
          advance();
          advance();
          closed = true;
          break;
        }
        advance();
      }
      if (!closed) {
        errors.push({
          message: "Unterminated block comment '(*'",
          span: { startOffset: start, endOffset: i, line: sLine, column: sCol, endLine: line, endColumn: col },
        });
      }
      continue;
    }

    const start = i;
    const sLine = line;
    const sCol = col;

    // Numbers (int or real)
    if (ch >= "0" && ch <= "9") {
      let isReal = false;
      while (i < n && source[i]! >= "0" && source[i]! <= "9") advance();
      if (i < n && source[i] === "." && source[i + 1] !== ".") {
        isReal = true;
        advance();
        while (i < n && source[i]! >= "0" && source[i]! <= "9") advance();
      }
      if (i < n && (source[i] === "e" || source[i] === "E")) {
        isReal = true;
        advance();
        if (i < n && (source[i] === "+" || source[i] === "-")) advance();
        while (i < n && source[i]! >= "0" && source[i]! <= "9") advance();
      }
      tokens.push({
        kind: isReal ? "real" : "int",
        text: source.slice(start, i),
        start,
        end: i,
        line: sLine,
        col: sCol,
        endLine: line,
        endCol: col,
      });
      continue;
    }

    // Identifiers & keywords
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      while (
        i < n &&
        ((source[i]! >= "a" && source[i]! <= "z") ||
          (source[i]! >= "A" && source[i]! <= "Z") ||
          (source[i]! >= "0" && source[i]! <= "9") ||
          source[i] === "_")
      ) {
        advance();
      }
      const text = source.slice(start, i);
      tokens.push({
        kind: KEYWORDS.has(text) ? "keyword" : "ident",
        text,
        start,
        end: i,
        line: sLine,
        col: sCol,
        endLine: line,
        endCol: col,
      });
      continue;
    }

    // Two-character operators
    const two = source.slice(i, i + 2);
    if (two === "->" || two === "=>" || two === "<>" || two === "<=" || two === ">=" || two === "!=") {
      advance();
      advance();
      tokens.push({
        kind: "op",
        text: two === "!=" ? "<>" : two,
        start,
        end: i,
        line: sLine,
        col: sCol,
        endLine: line,
        endCol: col,
      });
      continue;
    }

    // Single-character operators
    if ("+-*/=<>^".includes(ch)) {
      advance();
      tokens.push({
        kind: "op",
        text: ch,
        start,
        end: i,
        line: sLine,
        col: sCol,
        endLine: line,
        endCol: col,
      });
      continue;
    }

    // Punctuation
    if ("(),;:.[ ]".includes(ch)) {
      advance();
      tokens.push({
        kind: "punct",
        text: ch,
        start,
        end: i,
        line: sLine,
        col: sCol,
        endLine: line,
        endCol: col,
      });
      continue;
    }

    // Unknown character
    advance();
    errors.push({
      message: `Unexpected character '${ch}'`,
      span: { startOffset: start, endOffset: i, line: sLine, column: sCol, endLine: line, endColumn: col },
    });
  }

  tokens.push({
    kind: "eof",
    text: "",
    start: n,
    end: n,
    line,
    col,
    endLine: line,
    endCol: col,
  });
  return tokens;
}

function tokenSpan(tok: Token): LustreSpan {
  return {
    startOffset: tok.start,
    endOffset: tok.end,
    line: tok.line,
    column: tok.col,
    endLine: tok.endLine,
    endColumn: tok.endCol,
  };
}

function mergeSpan(a: LustreSpan, b: LustreSpan): LustreSpan {
  return {
    startOffset: a.startOffset,
    endOffset: b.endOffset,
    line: a.line,
    column: a.column,
    endLine: b.endLine,
    endColumn: b.endColumn,
  };
}

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly errors: LustreSyntaxError[],
  ) {}

  private peek(offset = 0): Token {
    const idx = Math.min(this.pos + offset, this.tokens.length - 1);
    return this.tokens[idx]!;
  }

  private next(): Token {
    const tok = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  private at(text: string): boolean {
    return this.peek().text === text && this.peek().kind !== "eof";
  }

  private match(text: string): Token | undefined {
    if (this.at(text)) return this.next();
    return undefined;
  }

  private expect(text: string): Token {
    if (this.at(text)) return this.next();
    const tok = this.peek();
    this.errors.push({
      message: `Expected '${text}', found '${tok.kind === "eof" ? "<eof>" : tok.text}'`,
      span: tokenSpan(tok),
    });
    return tok;
  }

  private expectIdent(context: string): Token {
    const tok = this.peek();
    if (tok.kind === "ident") return this.next();
    this.errors.push({
      message: `Expected identifier in ${context}, found '${tok.kind === "eof" ? "<eof>" : tok.text}'`,
      span: tokenSpan(tok),
    });
    return tok;
  }

  public parseProgram(source: string): LustreProgram {
    const consts: LustreConstDecl[] = [];
    const types: LustreTypeDecl[] = [];
    const nodes: LustreNodeDecl[] = [];

    while (this.peek().kind !== "eof") {
      const tok = this.peek();
      if (tok.text === "const") {
        this.parseConstSection(consts);
      } else if (tok.text === "type") {
        this.parseTypeSection(types);
      } else if (tok.text === "node" || tok.text === "function") {
        nodes.push(this.parseNodeDecl());
      } else {
        this.errors.push({
          message: `Unexpected top-level token '${tok.text}'`,
          span: tokenSpan(tok),
        });
        this.next();
      }
    }

    return {
      consts,
      types,
      nodes,
      syntaxErrors: this.errors,
      source,
    };
  }

  private parseConstSection(out: LustreConstDecl[]): void {
    this.expect("const");
    let parsedAny = false;
    while (this.peek().kind === "ident") {
      parsedAny = true;
      const nameTok = this.next();
      let type: LustreType | undefined;
      let value: LustreExpr | undefined;
      if (this.match(":")) {
        type = this.parseType();
      }
      if (this.match("=")) {
        value = this.parseExpr();
      }
      const endTok = this.expect(";");
      out.push({
        name: nameTok.text,
        type,
        value,
        span: mergeSpan(tokenSpan(nameTok), tokenSpan(endTok)),
      });
    }
    if (!parsedAny) {
      const tok = this.peek();
      this.errors.push({
        message: "Expected constant declaration after 'const'",
        span: tokenSpan(tok),
      });
    }
  }

  private parseTypeSection(out: LustreTypeDecl[]): void {
    this.expect("type");
    let parsedAny = false;
    while (this.peek().kind === "ident") {
      parsedAny = true;
      const nameTok = this.next();
      let alias: LustreType | undefined;
      if (this.match("=")) {
        alias = this.parseType();
      }
      const endTok = this.expect(";");
      out.push({
        name: nameTok.text,
        alias,
        span: mergeSpan(tokenSpan(nameTok), tokenSpan(endTok)),
      });
    }
    if (!parsedAny) {
      const tok = this.peek();
      this.errors.push({
        message: "Expected type declaration after 'type'",
        span: tokenSpan(tok),
      });
    }
  }

  private parseType(): LustreType {
    const tok = this.peek();
    let base: LustreType;
    if (tok.text === "bool" || tok.text === "int" || tok.text === "real") {
      this.next();
      base = { kind: "base", name: tok.text };
    } else if (tok.kind === "ident") {
      this.next();
      base = { kind: "named", name: tok.text };
    } else {
      this.errors.push({
        message: `Expected type name, found '${tok.kind === "eof" ? "<eof>" : tok.text}'`,
        span: tokenSpan(tok),
      });
      base = { kind: "base", name: "int" };
    }

    while (this.match("^")) {
      const sizeTok = this.peek();
      if (sizeTok.kind === "int") {
        this.next();
        base = { kind: "array", element: base, size: Number.parseInt(sizeTok.text, 10) };
      } else {
        this.errors.push({
          message: `Expected integer array size after '^', found '${sizeTok.text}'`,
          span: tokenSpan(sizeTok),
        });
        break;
      }
    }
    return base;
  }

  private parseClock(): LustreClock {
    let clk: LustreClock = { kind: "base" };
    while (this.match("when")) {
      let negated = false;
      if (this.match("not")) {
        negated = true;
      }
      if (this.match("(")) {
        if (this.match("not")) negated = !negated;
        const clkVar = this.expectIdent("clock expression");
        this.expect(")");
        clk = { kind: "on", clockVar: clkVar.text, negated, parent: clk };
      } else {
        const clkVar = this.expectIdent("clock expression");
        clk = { kind: "on", clockVar: clkVar.text, negated, parent: clk };
      }
    }
    return clk;
  }

  private parseVarDeclList(role: "input" | "output" | "local", stopToken: string): LustreVarDecl[] {
    const vars: LustreVarDecl[] = [];
    while (this.peek().kind !== "eof" && !this.at(stopToken)) {
      if (role === "local" && (this.at("let") || this.at("tel"))) break;
      const firstTok = this.peek();
      if (firstTok.kind !== "ident") {
        if (this.at(";")) {
          this.next();
          continue;
        }
        break;
      }

      const nameTokens: Token[] = [this.next()];
      while (this.match(",")) {
        nameTokens.push(this.expectIdent("variable declaration"));
      }
      this.expect(":");
      const varType = this.parseType();
      const clock = this.parseClock();
      const endTok = this.peek();
      for (const nt of nameTokens) {
        vars.push({
          name: nt.text,
          type: varType,
          clock,
          role,
          span: mergeSpan(tokenSpan(nt), tokenSpan(endTok)),
        });
      }

      if (this.match(";")) {
        continue;
      } else {
        break;
      }
    }
    return vars;
  }

  private parseNodeDecl(): LustreNodeDecl {
    const startTok = this.next(); // 'node' or 'function'
    const kind = startTok.text === "function" ? "function" : "node";
    const nameTok = this.expectIdent(`${kind} declaration`);

    this.expect("(");
    const inputs = this.parseVarDeclList("input", ")");
    this.expect(")");

    this.expect("returns");
    this.expect("(");
    const outputs = this.parseVarDeclList("output", ")");
    this.expect(")");
    this.match(";");

    const locals: LustreVarDecl[] = [];
    if (this.match("var")) {
      locals.push(...this.parseVarDeclList("local", "let"));
    }

    this.expect("let");
    const equations: LustreEquation[] = [];
    const assertions: LustreAssertion[] = [];

    while (this.peek().kind !== "eof" && !this.at("tel")) {
      if (this.at("assert")) {
        const aTok = this.next();
        const expr = this.parseExpr();
        const semi = this.expect(";");
        assertions.push({ expr, span: mergeSpan(tokenSpan(aTok), tokenSpan(semi)) });
      } else if (this.at("(")) {
        const lStart = this.next();
        const lhs: string[] = [];
        if (this.peek().kind === "ident") {
          lhs.push(this.next().text);
          while (this.match(",")) {
            lhs.push(this.expectIdent("tuple LHS").text);
          }
        }
        this.expect(")");
        this.expect("=");
        const rhs = this.parseExpr();
        const semi = this.expect(";");
        equations.push({ lhs, rhs, span: mergeSpan(tokenSpan(lStart), tokenSpan(semi)) });
      } else if (this.peek().kind === "ident") {
        const lhsTok = this.next();
        const lhs: string[] = [lhsTok.text];
        while (this.match(",")) {
          lhs.push(this.expectIdent("equation LHS").text);
        }
        this.expect("=");
        const rhs = this.parseExpr();
        const semi = this.expect(";");
        equations.push({ lhs, rhs, span: mergeSpan(tokenSpan(lhsTok), tokenSpan(semi)) });
      } else {
        const bad = this.next();
        this.errors.push({
          message: `Unexpected token '${bad.text}' in 'let ... tel' body`,
          span: tokenSpan(bad),
        });
      }
    }

    const telTok = this.expect("tel");
    if (!this.match(";")) {
      this.match(".");
    }

    return {
      kind,
      name: nameTok.text,
      inputs,
      outputs,
      locals,
      equations,
      assertions,
      span: mergeSpan(tokenSpan(startTok), tokenSpan(telTok)),
    };
  }

  // ── Pratt / Precedence-Climbing Expression Parser ──────────────────────────

  private parseExpr(): LustreExpr {
    return this.parseFollowedBy();
  }

  private parseFollowedBy(): LustreExpr {
    const left = this.parseIfExpr();
    if (this.match("->")) {
      const right = this.parseFollowedBy(); // right-associative
      return { kind: "binary", op: "->", left, right, span: mergeSpan(left.span, right.span) };
    }
    return left;
  }

  private parseIfExpr(): LustreExpr {
    if (this.at("if")) {
      const ifTok = this.next();
      const cond = this.parseExpr();
      this.expect("then");
      const thenExpr = this.parseExpr();
      this.expect("else");
      const elseExpr = this.parseExpr();
      return { kind: "if", cond, thenExpr, elseExpr, span: mergeSpan(tokenSpan(ifTok), elseExpr.span) };
    }
    return this.parseImplies();
  }

  private parseImplies(): LustreExpr {
    const left = this.parseOr();
    if (this.match("=>")) {
      const right = this.parseImplies();
      return { kind: "binary", op: "=>", left, right, span: mergeSpan(left.span, right.span) };
    }
    return left;
  }

  private parseOr(): LustreExpr {
    let left = this.parseAnd();
    while (this.at("or") || this.at("xor")) {
      const op = this.next().text as LustreBinaryOp;
      const right = this.parseAnd();
      left = { kind: "binary", op, left, right, span: mergeSpan(left.span, right.span) };
    }
    return left;
  }

  private parseAnd(): LustreExpr {
    let left = this.parseNot();
    while (this.at("and")) {
      this.next();
      const right = this.parseNot();
      left = { kind: "binary", op: "and", left, right, span: mergeSpan(left.span, right.span) };
    }
    return left;
  }

  private parseNot(): LustreExpr {
    if (this.at("not")) {
      const tok = this.next();
      const operand = this.parseNot();
      return { kind: "unary", op: "not", operand, span: mergeSpan(tokenSpan(tok), operand.span) };
    }
    return this.parseRelational();
  }

  private parseRelational(): LustreExpr {
    let left = this.parseWhen();
    while (this.at("=") || this.at("<>") || this.at("<") || this.at("<=") || this.at(">") || this.at(">=")) {
      const op = this.next().text as LustreBinaryOp;
      const right = this.parseWhen();
      left = { kind: "binary", op, left, right, span: mergeSpan(left.span, right.span) };
    }
    return left;
  }

  private parseWhen(): LustreExpr {
    let left = this.parseAddSub();
    while (this.match("when")) {
      let right: LustreExpr;
      if (this.at("not")) {
        const notTok = this.next();
        const clkExpr = this.parsePrimary();
        right = { kind: "unary", op: "not", operand: clkExpr, span: mergeSpan(tokenSpan(notTok), clkExpr.span) };
      } else {
        right = this.parseAddSub();
      }
      left = { kind: "binary", op: "when", left, right, span: mergeSpan(left.span, right.span) };
    }
    return left;
  }

  private parseAddSub(): LustreExpr {
    let left = this.parseMulDiv();
    while (this.at("+") || this.at("-")) {
      const op = this.next().text as LustreBinaryOp;
      const right = this.parseMulDiv();
      left = { kind: "binary", op, left, right, span: mergeSpan(left.span, right.span) };
    }
    return left;
  }

  private parseMulDiv(): LustreExpr {
    let left = this.parseUnary();
    while (this.at("*") || this.at("/") || this.at("div") || this.at("mod")) {
      const op = this.next().text as LustreBinaryOp;
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right, span: mergeSpan(left.span, right.span) };
    }
    return left;
  }

  private parseUnary(): LustreExpr {
    if (this.at("-") || this.at("pre") || this.at("current")) {
      const tok = this.next();
      const op = tok.text as "-" | "pre" | "current";
      const operand = this.parseUnary();
      return { kind: "unary", op, operand, span: mergeSpan(tokenSpan(tok), operand.span) };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): LustreExpr {
    let expr = this.parsePrimary();
    while (this.match("[")) {
      const index = this.parseExpr();
      const close = this.expect("]");
      expr = { kind: "index", array: expr, index, span: mergeSpan(expr.span, tokenSpan(close)) };
    }
    return expr;
  }

  private parsePrimary(): LustreExpr {
    const tok = this.peek();

    if (tok.text === "true" || tok.text === "false") {
      this.next();
      return { kind: "bool", value: tok.text === "true", span: tokenSpan(tok) };
    }

    if (tok.kind === "int") {
      this.next();
      return { kind: "int", value: Number.parseInt(tok.text, 10), span: tokenSpan(tok) };
    }

    if (tok.kind === "real") {
      this.next();
      return { kind: "real", value: Number.parseFloat(tok.text), span: tokenSpan(tok) };
    }

    // merge clk (true -> e1) (false -> e2) OR merge clk (e1) (e2) OR merge(clk, e1, e2)
    if (tok.text === "merge") {
      const mTok = this.next();
      if (this.match("(")) {
        const clkTok = this.expectIdent("merge clock");
        this.expect(",");
        const tExpr = this.parseExpr();
        this.expect(",");
        const fExpr = this.parseExpr();
        const close = this.expect(")");
        return {
          kind: "merge",
          clockVar: clkTok.text,
          trueExpr: tExpr,
          falseExpr: fExpr,
          span: mergeSpan(tokenSpan(mTok), tokenSpan(close)),
        };
      }
      const clkTok = this.expectIdent("merge clock");
      const parseMergeBranch = (): LustreExpr => {
        if (this.match("(")) {
          if ((this.at("true") || this.at("false")) && this.peek(1).text === "->") {
            this.next();
            this.next();
          }
          const e = this.parseExpr();
          this.expect(")");
          return e;
        }
        return this.parsePrimary();
      };
      const trueExpr = parseMergeBranch();
      const falseExpr = parseMergeBranch();
      return {
        kind: "merge",
        clockVar: clkTok.text,
        trueExpr,
        falseExpr,
        span: mergeSpan(tokenSpan(mTok), falseExpr.span),
      };
    }

    // Built-in numeric casts: int(e) / real(e)
    if ((tok.text === "int" || tok.text === "real") && this.peek(1).text === "(") {
      this.next();
      this.expect("(");
      const args: LustreExpr[] = [];
      if (!this.at(")")) {
        args.push(this.parseExpr());
        while (this.match(",")) {
          args.push(this.parseExpr());
        }
      }
      const close = this.expect(")");
      return { kind: "call", callee: tok.text, args, span: mergeSpan(tokenSpan(tok), tokenSpan(close)) };
    }

    // Identifier or node call
    if (tok.kind === "ident") {
      this.next();
      if (this.match("(")) {
        const args: LustreExpr[] = [];
        if (!this.at(")")) {
          args.push(this.parseExpr());
          while (this.match(",")) {
            args.push(this.parseExpr());
          }
        }
        const close = this.expect(")");
        return { kind: "call", callee: tok.text, args, span: mergeSpan(tokenSpan(tok), tokenSpan(close)) };
      }
      return { kind: "var", name: tok.text, span: tokenSpan(tok) };
    }

    // Parenthesized expression or tuple
    if (this.at("(")) {
      const open = this.next();
      const first = this.parseExpr();
      if (this.match(",")) {
        const elements: LustreExpr[] = [first];
        elements.push(this.parseExpr());
        while (this.match(",")) {
          elements.push(this.parseExpr());
        }
        const close = this.expect(")");
        return { kind: "tuple", elements, span: mergeSpan(tokenSpan(open), tokenSpan(close)) };
      }
      this.expect(")");
      return first;
    }

    // Array literal [e1, e2, ...]
    if (this.at("[")) {
      const open = this.next();
      const elements: LustreExpr[] = [];
      if (!this.at("]")) {
        elements.push(this.parseExpr());
        while (this.match(",")) {
          elements.push(this.parseExpr());
        }
      }
      const close = this.expect("]");
      return { kind: "array", elements, span: mergeSpan(tokenSpan(open), tokenSpan(close)) };
    }

    this.errors.push({
      message: `Unexpected token '${tok.kind === "eof" ? "<eof>" : tok.text}' in expression`,
      span: tokenSpan(tok),
    });
    if (tok.kind !== "eof") this.next();
    return { kind: "int", value: 0, span: tokenSpan(tok) };
  }
}

/**
 * Parses Lustre source code into a typed `LustreProgram` AST with full spans and syntax diagnostics.
 */
export function parseLustre(source: string): LustreProgram {
  const errors: LustreSyntaxError[] = [];
  const tokens = tokenize(source, errors);
  const parser = new Parser(tokens, errors);
  return parser.parseProgram(source);
}
