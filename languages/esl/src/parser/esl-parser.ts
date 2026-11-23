// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Recursive-descent parser for ESL (European Space Agency Simulation Language, 1980s).
 *
 * Supports STUDY, MODEL, SUBMODEL, SEGMENT, PACKAGE, INITIAL, DYNAMIC, STEP, TERMINAL,
 * END, REAL/INTEGER/LOGICAL/CONSTANT declarations, prime derivative notation (`x'`),
 * `WHEN ... THEN ... END_WHEN`, `IF ... THEN ... ELSE ... END_IF`, submodel calls,
 * and `--` line comments.
 */

import type {
  EslBinaryOp,
  EslBlock,
  EslBlockKind,
  EslDataType,
  EslDeclaration,
  EslExpr,
  EslParameter,
  EslProgram,
  EslSectionKind,
  EslSourceSpan,
  EslStatement,
  EslSyntaxError,
} from "../types.js";

type TokenKind =
  "IDENT" | "NUMBER" | "STRING" | "PRIME" | "OP" | "LPAREN" | "RPAREN" | "COMMA" | "SEMI" | "COLON" | "NEWLINE" | "EOF";

interface Token {
  kind: TokenKind;
  value: string;
  upper: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

const BLOCK_KEYWORDS = new Set<string>(["STUDY", "MODEL", "SUBMODEL", "SEGMENT", "PACKAGE"]);
const SECTION_KEYWORDS = new Set<string>(["INITIAL", "DYNAMIC", "STEP", "TERMINAL"]);
const TYPE_KEYWORDS = new Set<string>(["REAL", "INTEGER", "LOGICAL", "CONSTANT"]);
const END_COMPOUND_KEYWORDS = new Set<string>(["END_STUDY", "END_MODEL", "END_SUBMODEL", "END_SEGMENT", "END_PACKAGE"]);

function tokenize(source: string): { tokens: Token[]; errors: EslSyntaxError[] } {
  const tokens: Token[] = [];
  const errors: EslSyntaxError[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const len = source.length;

  while (i < len) {
    const ch = source[i]!;

    // Spaces & tabs
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      col++;
      continue;
    }

    // Newlines
    if (ch === "\n") {
      tokens.push({
        kind: "NEWLINE",
        value: "\n",
        upper: "\n",
        line,
        column: col,
        startOffset: i,
        endOffset: i + 1,
      });
      i++;
      line++;
      col = 1;
      continue;
    }

    // ESL `--` line comment
    if (ch === "-" && source[i + 1] === "-") {
      while (i < len && source[i] !== "\n") {
        i++;
        col++;
      }
      continue;
    }

    const startOffset = i;
    const startLine = line;
    const startCol = col;

    // String literal
    if (ch === '"') {
      i++;
      col++;
      let str = "";
      while (i < len && source[i] !== '"' && source[i] !== "\n") {
        if (source[i] === "\\" && i + 1 < len) {
          i++;
          col++;
        }
        str += source[i]!;
        i++;
        col++;
      }
      if (source[i] === '"') {
        i++;
        col++;
      } else {
        errors.push({
          message: "Unterminated string literal",
          line: startLine,
          column: startCol,
          startOffset,
          endOffset: i,
        });
      }
      tokens.push({
        kind: "STRING",
        value: str,
        upper: str.toUpperCase(),
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Derivative prime `'` (not string)
    if (ch === "'") {
      let primes = "";
      while (i < len && source[i] === "'") {
        primes += "'";
        i++;
        col++;
      }
      tokens.push({
        kind: "PRIME",
        value: primes,
        upper: primes,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Number literal
    if ((ch >= "0" && ch <= "9") || (ch === "." && i + 1 < len && source[i + 1]! >= "0" && source[i + 1]! <= "9")) {
      let numStr = "";
      while (i < len && source[i]! >= "0" && source[i]! <= "9") {
        numStr += source[i]!;
        i++;
        col++;
      }
      if (i < len && source[i] === ".") {
        numStr += ".";
        i++;
        col++;
        while (i < len && source[i]! >= "0" && source[i]! <= "9") {
          numStr += source[i]!;
          i++;
          col++;
        }
      }
      if (i < len && (source[i] === "e" || source[i] === "E")) {
        numStr += source[i]!;
        i++;
        col++;
        if (i < len && (source[i] === "+" || source[i] === "-")) {
          numStr += source[i]!;
          i++;
          col++;
        }
        while (i < len && source[i]! >= "0" && source[i]! <= "9") {
          numStr += source[i]!;
          i++;
          col++;
        }
      }
      tokens.push({
        kind: "NUMBER",
        value: numStr,
        upper: numStr.toUpperCase(),
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Identifier / Keyword
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      let ident = "";
      while (
        i < len &&
        ((source[i]! >= "a" && source[i]! <= "z") ||
          (source[i]! >= "A" && source[i]! <= "Z") ||
          (source[i]! >= "0" && source[i]! <= "9") ||
          source[i] === "_")
      ) {
        ident += source[i]!;
        i++;
        col++;
      }
      tokens.push({
        kind: "IDENT",
        value: ident,
        upper: ident.toUpperCase(),
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Two-character operators
    const two = source.slice(i, i + 2);
    if (
      two === ":=" ||
      two === "**" ||
      two === "<=" ||
      two === ">=" ||
      two === "/=" ||
      two === "<>" ||
      two === "!=" ||
      two === "=="
    ) {
      i += 2;
      col += 2;
      tokens.push({
        kind: "OP",
        value: two,
        upper: two,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Single-character punctuation / operators
    i++;
    col++;
    if (ch === "(") {
      tokens.push({
        kind: "LPAREN",
        value: ch,
        upper: ch,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
    } else if (ch === ")") {
      tokens.push({
        kind: "RPAREN",
        value: ch,
        upper: ch,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
    } else if (ch === ",") {
      tokens.push({
        kind: "COMMA",
        value: ch,
        upper: ch,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
    } else if (ch === ";") {
      tokens.push({ kind: "SEMI", value: ch, upper: ch, line: startLine, column: startCol, startOffset, endOffset: i });
    } else if (ch === ":") {
      tokens.push({
        kind: "COLON",
        value: ch,
        upper: ch,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
    } else if ("+-*/=<>^".includes(ch)) {
      tokens.push({ kind: "OP", value: ch, upper: ch, line: startLine, column: startCol, startOffset, endOffset: i });
    } else {
      errors.push({
        message: `Unexpected character '${ch}'`,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
    }
  }

  tokens.push({
    kind: "EOF",
    value: "",
    upper: "",
    line,
    column: col,
    startOffset: len,
    endOffset: len,
  });

  return { tokens, errors };
}

function makeSpan(start: Token, end: Token): EslSourceSpan {
  return {
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column + Math.max(1, end.value.length),
    startOffset: start.startOffset,
    endOffset: end.endOffset,
  };
}

class EslParser {
  private pos = 0;
  private readonly tokens: Token[];
  public readonly errors: EslSyntaxError[];

  constructor(tokens: Token[], errors: EslSyntaxError[]) {
    this.tokens = tokens;
    this.errors = errors;
  }

  private peek(offset = 0): Token {
    const idx = Math.min(this.pos + offset, this.tokens.length - 1);
    return this.tokens[idx]!;
  }

  private advance(): Token {
    const tok = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  private skipSeparators(): void {
    while (this.peek().kind === "NEWLINE" || this.peek().kind === "SEMI") {
      this.advance();
    }
  }

  private skipNewlines(): void {
    while (this.peek().kind === "NEWLINE") {
      this.advance();
    }
  }

  private isKeyword(tok: Token, kw: string): boolean {
    return tok.kind === "IDENT" && tok.upper === kw;
  }

  private addError(tok: Token, message: string): void {
    this.errors.push({
      message,
      line: tok.line,
      column: tok.column,
      startOffset: tok.startOffset,
      endOffset: tok.endOffset,
    });
  }

  public parseProgram(source: string): EslProgram {
    const blocks: EslBlock[] = [];
    this.skipSeparators();

    while (this.peek().kind !== "EOF") {
      const tok = this.peek();
      if (tok.kind === "IDENT" && BLOCK_KEYWORDS.has(tok.upper)) {
        blocks.push(this.parseBlock());
      } else {
        // Anonymous implicit STUDY/MODEL wrapper if top-level statements appear without header
        const implicit = this.parseImplicitBlock();
        if (implicit) {
          blocks.push(implicit);
        } else {
          this.addError(tok, `Unexpected token '${tok.value}' at top level`);
          this.advance();
        }
      }
      this.skipSeparators();
    }

    const models = new Map<string, EslBlock>();
    const submodels = new Map<string, EslBlock>();
    const packages = new Map<string, EslBlock>();
    const segments = new Map<string, EslBlock>();
    const studies: EslBlock[] = [];

    const registerBlock = (b: EslBlock): void => {
      switch (b.kind) {
        case "MODEL":
          models.set(b.name, b);
          break;
        case "SUBMODEL":
          submodels.set(b.name, b);
          break;
        case "PACKAGE":
          packages.set(b.name, b);
          break;
        case "SEGMENT":
          segments.set(b.name, b);
          break;
        case "STUDY":
          studies.push(b);
          break;
      }
      for (const child of b.children) {
        registerBlock(child);
      }
    };

    for (const b of blocks) registerBlock(b);

    const primaryName = studies[0]?.name ?? Array.from(models.keys())[0] ?? blocks[0]?.name ?? "EslModel";

    return {
      name: primaryName,
      blocks,
      models,
      submodels,
      packages,
      segments,
      studies,
      syntaxErrors: this.errors,
      source,
    };
  }

  private parseImplicitBlock(): EslBlock | null {
    const startTok = this.peek();
    if (!(startTok.kind === "IDENT" && (TYPE_KEYWORDS.has(startTok.upper) || SECTION_KEYWORDS.has(startTok.upper)))) {
      return null;
    }
    const block: EslBlock = {
      kind: "MODEL",
      name: "AnonymousModel",
      hasEnd: true,
      parameters: [],
      declarations: [],
      initialStatements: [],
      dynamicStatements: [],
      stepStatements: [],
      terminalStatements: [],
      children: [],
      span: makeSpan(startTok, startTok),
    };
    this.parseBlockBody(block, false);
    block.span = makeSpan(startTok, this.peek(-1));
    return block;
  }

  private parseBlock(): EslBlock {
    const startTok = this.advance();
    const kind = startTok.upper as EslBlockKind;

    let name = kind === "STUDY" ? "MainStudy" : "Unnamed";
    if (
      this.peek().kind === "IDENT" &&
      !SECTION_KEYWORDS.has(this.peek().upper) &&
      !TYPE_KEYWORDS.has(this.peek().upper) &&
      !BLOCK_KEYWORDS.has(this.peek().upper) &&
      this.peek().upper !== "END"
    ) {
      name = this.advance().value;
    }

    const parameters: EslParameter[] = [];
    if (this.peek().kind === "LPAREN") {
      this.parseParameterList(parameters);
    }

    if (this.peek().kind === "SEMI" || this.peek().kind === "COLON") {
      this.advance();
    }

    const block: EslBlock = {
      kind,
      name,
      hasEnd: false,
      parameters,
      declarations: [],
      initialStatements: [],
      dynamicStatements: [],
      stepStatements: [],
      terminalStatements: [],
      children: [],
      span: makeSpan(startTok, startTok),
    };

    const endTok = this.parseBlockBody(block, true);
    block.span = makeSpan(startTok, endTok);
    return block;
  }

  private parseParameterList(out: EslParameter[]): void {
    this.advance(); // consume '('
    this.skipNewlines();
    let currentDir: "IN" | "OUT" | "INOUT" | undefined;
    let currentType: EslDataType | undefined;

    while (this.peek().kind !== "RPAREN" && this.peek().kind !== "EOF") {
      this.skipNewlines();
      const tok = this.peek();
      if (tok.kind === "IDENT" && (tok.upper === "IN" || tok.upper === "OUT" || tok.upper === "INOUT")) {
        currentDir = this.advance().upper as "IN" | "OUT" | "INOUT";
        continue;
      }
      if (tok.kind === "IDENT" && TYPE_KEYWORDS.has(tok.upper)) {
        currentType = this.advance().upper as EslDataType;
        if (this.peek().kind === "COLON") this.advance();
        continue;
      }
      if (tok.kind === "COLON") {
        this.advance();
        continue;
      }
      if (tok.kind === "IDENT") {
        const paramTok = this.advance();
        let dir = currentDir;
        let pType = currentType;
        if (this.peek().kind === "COLON") {
          this.advance();
          if (
            this.peek().kind === "IDENT" &&
            (this.peek().upper === "IN" || this.peek().upper === "OUT" || this.peek().upper === "INOUT")
          ) {
            dir = this.advance().upper as "IN" | "OUT" | "INOUT";
          }
          if (this.peek().kind === "IDENT" && TYPE_KEYWORDS.has(this.peek().upper)) {
            pType = this.advance().upper as EslDataType;
          }
        }
        out.push({
          name: paramTok.value,
          direction: dir,
          dataType: pType ?? "REAL",
          span: makeSpan(paramTok, paramTok),
        });
      } else if (tok.kind === "COMMA" || tok.kind === "SEMI") {
        if (tok.kind === "SEMI") {
          currentDir = undefined;
          currentType = undefined;
        }
        this.advance();
      } else {
        this.addError(tok, `Unexpected token '${tok.value}' in parameter list`);
        this.advance();
      }
      this.skipNewlines();
    }

    if (this.peek().kind === "RPAREN") {
      this.advance();
    } else {
      this.addError(this.peek(), "Expected ')' to close parameter list");
    }
  }

  private parseBlockBody(block: EslBlock, expectEnd: boolean): Token {
    let currentSection: EslSectionKind | null = null;
    let lastTok = this.peek();

    this.skipSeparators();
    while (this.peek().kind !== "EOF") {
      const tok = this.peek();

      // Block termination
      if (tok.kind === "IDENT" && (tok.upper === "END" || END_COMPOUND_KEYWORDS.has(tok.upper))) {
        if (!expectEnd) break;
        const endKwTok = this.advance();
        block.hasEnd = true;
        block.endKeyword = endKwTok.upper;
        lastTok = endKwTok;

        if (endKwTok.upper === "END") {
          // Optional block kind keyword (e.g. `END MODEL` or `END MODEL Foo`)
          if (this.peek().kind === "IDENT" && BLOCK_KEYWORDS.has(this.peek().upper)) {
            const kwTok = this.advance();
            block.endKeyword = `END ${kwTok.upper}`;
            lastTok = kwTok;
          }
          // Optional block name on same line
          if (this.peek().kind === "IDENT" && this.peek().line === endKwTok.line) {
            const nameTok = this.advance();
            block.endName = nameTok.value;
            lastTok = nameTok;
          }
        } else {
          // END_MODEL [name]
          if (this.peek().kind === "IDENT" && this.peek().line === endKwTok.line) {
            const nameTok = this.advance();
            block.endName = nameTok.value;
            lastTok = nameTok;
          }
        }
        if (this.peek().kind === "SEMI") {
          lastTok = this.advance();
        }
        return lastTok;
      }

      // Nested block inside STUDY/PACKAGE/MODEL
      if (tok.kind === "IDENT" && BLOCK_KEYWORDS.has(tok.upper)) {
        const child = this.parseBlock();
        block.children.push(child);
        lastTok = this.peek(-1);
        this.skipSeparators();
        continue;
      }

      // Section header: INITIAL, DYNAMIC, STEP, TERMINAL
      if (tok.kind === "IDENT" && SECTION_KEYWORDS.has(tok.upper)) {
        // Distinguish `STEP(...)` call from `STEP` section
        if (tok.upper === "STEP" && this.peek(1).kind === "LPAREN") {
          // It's a function call statement, fall through to statement
        } else {
          lastTok = this.advance();
          currentSection = tok.upper as EslSectionKind;
          if (this.peek().kind === "COLON") lastTok = this.advance();
          this.skipSeparators();
          continue;
        }
      }

      // Declarations: REAL, INTEGER, LOGICAL, CONSTANT
      if (tok.kind === "IDENT" && TYPE_KEYWORDS.has(tok.upper)) {
        const decls = this.parseDeclarationList();
        block.declarations.push(...decls);
        lastTok = this.peek(-1);
        this.skipSeparators();
        continue;
      }

      // Statements
      const stmt = this.parseStatement();
      if (stmt) {
        const targetList = this.getSectionList(block, currentSection ?? "DYNAMIC");
        targetList.push(stmt);
        lastTok = this.peek(-1);
      } else {
        this.addError(tok, `Unexpected token '${tok.value}' inside ${block.kind} '${block.name}'`);
        lastTok = this.advance();
      }
      this.skipSeparators();
    }

    return lastTok;
  }

  private getSectionList(block: EslBlock, section: EslSectionKind): EslStatement[] {
    switch (section) {
      case "INITIAL":
        return block.initialStatements;
      case "DYNAMIC":
        return block.dynamicStatements;
      case "STEP":
        return block.stepStatements;
      case "TERMINAL":
        return block.terminalStatements;
    }
  }

  private parseDeclarationList(): EslDeclaration[] {
    const startTok = this.advance();
    let isConstant = startTok.upper === "CONSTANT";
    let dataType: EslDataType = isConstant ? "CONSTANT" : (startTok.upper as EslDataType);

    if (
      isConstant &&
      this.peek().kind === "IDENT" &&
      TYPE_KEYWORDS.has(this.peek().upper) &&
      this.peek().upper !== "CONSTANT"
    ) {
      dataType = this.advance().upper as EslDataType;
    } else if (!isConstant && this.peek().kind === "IDENT" && this.peek().upper === "CONSTANT") {
      this.advance();
      isConstant = true;
    }

    if (this.peek().kind === "COLON") {
      this.advance();
    }

    const decls: EslDeclaration[] = [];
    while (this.peek().kind === "IDENT") {
      const nameTok = this.advance();
      let initialValue: EslExpr | undefined;
      let endTok = nameTok;

      if (this.peek().kind === "OP" && (this.peek().value === "=" || this.peek().value === ":=")) {
        this.advance();
        initialValue = this.parseExpression();
        endTok = this.peek(-1);
      }

      decls.push({
        name: nameTok.value,
        dataType,
        isConstant,
        initialValue,
        span: makeSpan(startTok, endTok),
      });

      if (this.peek().kind === "COMMA") {
        this.advance();
        this.skipNewlines();
        continue;
      }
      break;
    }

    if (this.peek().kind === "SEMI") {
      this.advance();
    }
    return decls;
  }

  private parseStatement(): EslStatement | null {
    const tok = this.peek();

    if (this.isKeyword(tok, "WHEN")) {
      return this.parseWhenStatement();
    }

    if (this.isKeyword(tok, "IF")) {
      return this.parseIfStatement();
    }

    if (this.isKeyword(tok, "TERMINATE")) {
      const startTok = this.advance();
      const cond = this.parseExpression();
      const endTok = this.peek(-1);
      if (this.peek().kind === "SEMI") this.advance();
      return {
        kind: "terminate",
        condition: cond,
        span: makeSpan(startTok, endTok),
      };
    }

    if (this.isKeyword(tok, "PREPARE") || this.isKeyword(tok, "PLOT") || this.isKeyword(tok, "PRINT")) {
      const startTok = this.advance();
      const kind = startTok.upper.toLowerCase() as "prepare" | "plot" | "print";
      if (this.peek().kind === "COLON") this.advance();
      const variables: string[] = [];
      while (this.peek().kind === "IDENT" && this.peek().line === startTok.line) {
        variables.push(this.advance().value);
        if (this.peek().kind === "COMMA") this.advance();
      }
      const endTok = this.peek(-1);
      if (this.peek().kind === "SEMI") this.advance();
      return {
        kind,
        variables,
        span: makeSpan(startTok, endTok),
      };
    }

    if (tok.kind === "IDENT") {
      const next = this.peek(1);

      // Derivative assignment: `x' = expr` or `x'' = expr`
      if (next.kind === "PRIME") {
        const nameTok = this.advance();
        const primeTok = this.advance();
        const opTok = this.peek();
        if (opTok.kind === "OP" && (opTok.value === "=" || opTok.value === ":=")) {
          this.advance();
          const value = this.parseExpression();
          const endTok = this.peek(-1);
          if (this.peek().kind === "SEMI") this.advance();
          return {
            kind: "assign",
            target: nameTok.value,
            isDerivative: true,
            derivativeOrder: primeTok.value.length,
            operator: opTok.value as "=" | ":=",
            value,
            span: makeSpan(nameTok, endTok),
          };
        }
        this.addError(opTok, `Expected '=' or ':=' after derivative '${nameTok.value}${primeTok.value}'`);
        return null;
      }

      // Variable assignment: `x = expr` or `x := expr`
      if (next.kind === "OP" && (next.value === "=" || next.value === ":=")) {
        const nameTok = this.advance();
        const opTok = this.advance();
        const value = this.parseExpression();
        const endTok = this.peek(-1);
        if (this.peek().kind === "SEMI") this.advance();
        return {
          kind: "assign",
          target: nameTok.value,
          isDerivative: false,
          derivativeOrder: 0,
          operator: opTok.value as "=" | ":=",
          value,
          span: makeSpan(nameTok, endTok),
        };
      }

      // Submodel call: `SUBMODEL_NAME(arg1, arg2, ...)`
      if (next.kind === "LPAREN") {
        const nameTok = this.advance();
        this.advance(); // consume '('
        const args: EslExpr[] = [];
        this.skipNewlines();
        while (this.peek().kind !== "RPAREN" && this.peek().kind !== "EOF") {
          args.push(this.parseExpression());
          if (this.peek().kind === "COMMA") {
            this.advance();
            this.skipNewlines();
          } else {
            break;
          }
        }
        let endTok = this.peek();
        if (this.peek().kind === "RPAREN") {
          endTok = this.advance();
        } else {
          this.addError(this.peek(), `Expected ')' to close call to '${nameTok.value}'`);
        }
        if (this.peek().kind === "SEMI") this.advance();
        return {
          kind: "submodel_call",
          callee: nameTok.value,
          args,
          span: makeSpan(nameTok, endTok),
        };
      }
    }

    return null;
  }

  private parseWhenStatement(): EslStatement {
    const startTok = this.advance(); // WHEN
    const condition = this.parseExpression();
    this.skipNewlines();

    if (this.isKeyword(this.peek(), "THEN")) {
      this.advance();
    } else {
      this.addError(this.peek(), "Expected 'THEN' after WHEN condition");
    }

    const body: EslStatement[] = [];
    const elseBody: EslStatement[] = [];
    let inElse = false;

    this.skipSeparators();
    while (this.peek().kind !== "EOF") {
      const tok = this.peek();
      if (this.isKeyword(tok, "END_WHEN")) {
        const endTok = this.advance();
        if (this.peek().kind === "SEMI") this.advance();
        return { kind: "when", condition, body, elseBody, span: makeSpan(startTok, endTok) };
      }
      if (this.isKeyword(tok, "END") && this.isKeyword(this.peek(1), "WHEN")) {
        this.advance();
        const endTok = this.advance();
        if (this.peek().kind === "SEMI") this.advance();
        return { kind: "when", condition, body, elseBody, span: makeSpan(startTok, endTok) };
      }
      if (this.isKeyword(tok, "ELSE")) {
        this.advance();
        inElse = true;
        this.skipSeparators();
        continue;
      }
      if (
        tok.kind === "IDENT" &&
        (SECTION_KEYWORDS.has(tok.upper) || BLOCK_KEYWORDS.has(tok.upper) || tok.upper === "END")
      ) {
        this.addError(tok, "Unterminated WHEN block: expected 'END_WHEN'");
        break;
      }
      const stmt = this.parseStatement();
      if (stmt) {
        (inElse ? elseBody : body).push(stmt);
      } else {
        this.addError(tok, `Unexpected token '${tok.value}' inside WHEN block`);
        this.advance();
      }
      this.skipSeparators();
    }

    return { kind: "when", condition, body, elseBody, span: makeSpan(startTok, this.peek(-1)) };
  }

  private parseIfStatement(): EslStatement {
    const startTok = this.advance(); // IF
    const condition = this.parseExpression();
    this.skipNewlines();

    if (this.isKeyword(this.peek(), "THEN")) {
      this.advance();
    } else {
      this.addError(this.peek(), "Expected 'THEN' after IF condition");
    }

    const thenBody: EslStatement[] = [];
    const elseBody: EslStatement[] = [];
    let inElse = false;

    this.skipSeparators();
    while (this.peek().kind !== "EOF") {
      const tok = this.peek();
      if (this.isKeyword(tok, "END_IF")) {
        const endTok = this.advance();
        if (this.peek().kind === "SEMI") this.advance();
        return { kind: "if", condition, thenBody, elseBody, span: makeSpan(startTok, endTok) };
      }
      if (this.isKeyword(tok, "END") && this.isKeyword(this.peek(1), "IF")) {
        this.advance();
        const endTok = this.advance();
        if (this.peek().kind === "SEMI") this.advance();
        return { kind: "if", condition, thenBody, elseBody, span: makeSpan(startTok, endTok) };
      }
      if (this.isKeyword(tok, "ELSE")) {
        this.advance();
        inElse = true;
        this.skipSeparators();
        continue;
      }
      if (this.isKeyword(tok, "ELSIF") || this.isKeyword(tok, "ELSEIF")) {
        // Desugar ELSIF into nested IF inside elseBody
        const nestedIf = this.parseElsifChain();
        elseBody.push(nestedIf);
        return { kind: "if", condition, thenBody, elseBody, span: makeSpan(startTok, this.peek(-1)) };
      }
      if (
        tok.kind === "IDENT" &&
        (SECTION_KEYWORDS.has(tok.upper) || BLOCK_KEYWORDS.has(tok.upper) || tok.upper === "END")
      ) {
        this.addError(tok, "Unterminated IF block: expected 'END_IF'");
        break;
      }
      const stmt = this.parseStatement();
      if (stmt) {
        (inElse ? elseBody : thenBody).push(stmt);
      } else {
        this.addError(tok, `Unexpected token '${tok.value}' inside IF block`);
        this.advance();
      }
      this.skipSeparators();
    }

    return { kind: "if", condition, thenBody, elseBody, span: makeSpan(startTok, this.peek(-1)) };
  }

  private parseElsifChain(): EslStatement {
    return this.parseIfStatement();
  }

  // ── Expression Parser ──

  private parseExpression(): EslExpr {
    if (this.isKeyword(this.peek(), "IF")) {
      const startTok = this.advance();
      const condition = this.parseOr();
      if (this.isKeyword(this.peek(), "THEN")) this.advance();
      const thenExpr = this.parseExpression();
      if (this.isKeyword(this.peek(), "ELSE")) this.advance();
      const elseExpr = this.parseExpression();
      if (this.isKeyword(this.peek(), "END_IF")) {
        this.advance();
      } else if (this.isKeyword(this.peek(), "END") && this.isKeyword(this.peek(1), "IF")) {
        this.advance();
        this.advance();
      }
      return {
        kind: "conditional",
        condition,
        thenExpr,
        elseExpr,
        span: makeSpan(startTok, this.peek(-1)),
      };
    }
    return this.parseOr();
  }

  private parseOr(): EslExpr {
    let left = this.parseAnd();
    while (this.isKeyword(this.peek(), "OR")) {
      this.advance();
      const right = this.parseAnd();
      left = {
        kind: "binary",
        op: "OR",
        left,
        right,
        span: {
          ...left.span,
          endLine: right.span.endLine,
          endColumn: right.span.endColumn,
          endOffset: right.span.endOffset,
        },
      };
    }
    return left;
  }

  private parseAnd(): EslExpr {
    let left = this.parseNot();
    while (this.isKeyword(this.peek(), "AND")) {
      this.advance();
      const right = this.parseNot();
      left = {
        kind: "binary",
        op: "AND",
        left,
        right,
        span: {
          ...left.span,
          endLine: right.span.endLine,
          endColumn: right.span.endColumn,
          endOffset: right.span.endOffset,
        },
      };
    }
    return left;
  }

  private parseNot(): EslExpr {
    if (this.isKeyword(this.peek(), "NOT")) {
      const tok = this.advance();
      const operand = this.parseNot();
      return {
        kind: "unary",
        op: "NOT",
        operand,
        span: {
          ...makeSpan(tok, tok),
          endLine: operand.span.endLine,
          endColumn: operand.span.endColumn,
          endOffset: operand.span.endOffset,
        },
      };
    }
    return this.parseComparison();
  }

  private parseComparison(): EslExpr {
    let left = this.parseAdditive();
    const relOps = new Set<string>(["=", "==", "/=", "<>", "!=", "<", "<=", ">", ">="]);
    while (this.peek().kind === "OP" && relOps.has(this.peek().value)) {
      const opTok = this.advance();
      const right = this.parseAdditive();
      left = {
        kind: "binary",
        op: opTok.value as EslBinaryOp,
        left,
        right,
        span: {
          ...left.span,
          endLine: right.span.endLine,
          endColumn: right.span.endColumn,
          endOffset: right.span.endOffset,
        },
      };
    }
    return left;
  }

  private parseAdditive(): EslExpr {
    let left = this.parseMultiplicative();
    while (this.peek().kind === "OP" && (this.peek().value === "+" || this.peek().value === "-")) {
      const opTok = this.advance();
      const right = this.parseMultiplicative();
      left = {
        kind: "binary",
        op: opTok.value as EslBinaryOp,
        left,
        right,
        span: {
          ...left.span,
          endLine: right.span.endLine,
          endColumn: right.span.endColumn,
          endOffset: right.span.endOffset,
        },
      };
    }
    return left;
  }

  private parseMultiplicative(): EslExpr {
    let left = this.parseUnary();
    while (this.peek().kind === "OP" && (this.peek().value === "*" || this.peek().value === "/")) {
      const opTok = this.advance();
      const right = this.parseUnary();
      left = {
        kind: "binary",
        op: opTok.value as EslBinaryOp,
        left,
        right,
        span: {
          ...left.span,
          endLine: right.span.endLine,
          endColumn: right.span.endColumn,
          endOffset: right.span.endOffset,
        },
      };
    }
    return left;
  }

  private parseUnary(): EslExpr {
    if (this.peek().kind === "OP" && (this.peek().value === "+" || this.peek().value === "-")) {
      const opTok = this.advance();
      const operand = this.parseUnary();
      return {
        kind: "unary",
        op: opTok.value as "+" | "-",
        operand,
        span: {
          ...makeSpan(opTok, opTok),
          endLine: operand.span.endLine,
          endColumn: operand.span.endColumn,
          endOffset: operand.span.endOffset,
        },
      };
    }
    return this.parsePower();
  }

  private parsePower(): EslExpr {
    let left = this.parsePrimary();
    if (this.peek().kind === "OP" && (this.peek().value === "**" || this.peek().value === "^")) {
      const opTok = this.advance();
      const right = this.parseUnary();
      left = {
        kind: "binary",
        op: opTok.value as EslBinaryOp,
        left,
        right,
        span: {
          ...left.span,
          endLine: right.span.endLine,
          endColumn: right.span.endColumn,
          endOffset: right.span.endOffset,
        },
      };
    }
    return left;
  }

  private parsePrimary(): EslExpr {
    const tok = this.peek();

    if (tok.kind === "NUMBER") {
      this.advance();
      return { kind: "number", value: Number(tok.value), span: makeSpan(tok, tok) };
    }

    if (tok.kind === "STRING") {
      this.advance();
      return { kind: "string", value: tok.value, span: makeSpan(tok, tok) };
    }

    if (tok.kind === "LPAREN") {
      this.advance();
      const expr = this.parseExpression();
      if (this.peek().kind === "RPAREN") {
        this.advance();
      } else {
        this.addError(this.peek(), "Expected ')' in parenthesized expression");
      }
      return expr;
    }

    if (tok.kind === "IDENT") {
      if (tok.upper === "TRUE") {
        this.advance();
        return { kind: "boolean", value: true, span: makeSpan(tok, tok) };
      }
      if (tok.upper === "FALSE") {
        this.advance();
        return { kind: "boolean", value: false, span: makeSpan(tok, tok) };
      }

      const nameTok = this.advance();

      // Derivative reference `x'` or `x''`
      if (this.peek().kind === "PRIME") {
        const primeTok = this.advance();
        return {
          kind: "derivative",
          target: nameTok.value,
          order: primeTok.value.length,
          span: makeSpan(nameTok, primeTok),
        };
      }

      // Function call `SIN(x)` or `LIMIT(-1, 1, u)`
      if (this.peek().kind === "LPAREN") {
        this.advance();
        const args: EslExpr[] = [];
        while (this.peek().kind !== "RPAREN" && this.peek().kind !== "EOF") {
          args.push(this.parseExpression());
          if (this.peek().kind === "COMMA") {
            this.advance();
          } else {
            break;
          }
        }
        let endTok = this.peek();
        if (this.peek().kind === "RPAREN") {
          endTok = this.advance();
        } else {
          this.addError(this.peek(), `Expected ')' in call to '${nameTok.value}'`);
        }
        return {
          kind: "call",
          callee: nameTok.value,
          args,
          span: makeSpan(nameTok, endTok),
        };
      }

      return { kind: "identifier", name: nameTok.value, span: makeSpan(nameTok, nameTok) };
    }

    this.addError(tok, `Unexpected token '${tok.value || "EOF"}' in expression`);
    if (tok.kind !== "EOF") this.advance();
    return { kind: "number", value: 0, span: makeSpan(tok, tok) };
  }
}

/**
 * Parses an ESL source file into an `EslProgram`.
 */
export function parseEsl(source: string): EslProgram {
  const { tokens, errors } = tokenize(source);
  const parser = new EslParser(tokens, errors);
  return parser.parseProgram(source);
}
