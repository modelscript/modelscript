// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/verilog-a — Zero-Regex Verilog-A / Verilog-AMS Lexer & Recursive-Descent Parser.
 *
 * Implements deterministic token-based parsing conforming to IEEE 1857 / Accellera Verilog-AMS.
 * Handles `include directives, module boundaries, electrical/thermal disciplines, parameters
 * with range bounds (from [min:max]), internal node allocations, and analog block contributions (<+).
 */

import type {
  PortDirection,
  VerilogAAnalogBlock,
  VerilogABranchAccess,
  VerilogADisciplineDecl,
  VerilogADocument,
  VerilogAExpr,
  VerilogAModule,
  VerilogAParameter,
  VerilogAParameterRange,
  VerilogAPort,
  VerilogAStatement,
  VerilogAVariable,
} from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Tokenizer / Scanner
// ─────────────────────────────────────────────────────────────────────────────

export type TokenType =
  | "IDENTIFIER"
  | "NUMBER"
  | "STRING"
  | "DIRECTIVE"
  | "OPERATOR"
  | "PUNCTUATION"
  | "KEYWORD"
  | "EOF";

export interface Token {
  type: TokenType;
  value: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

const KEYWORDS = new Set([
  "module",
  "endmodule",
  "inout",
  "input",
  "output",
  "electrical",
  "thermal",
  "magnetic",
  "rotational",
  "parameter",
  "real",
  "integer",
  "from",
  "inf",
  "analog",
  "begin",
  "end",
  "if",
  "else",
  "while",
  "for",
]);

export function tokenizeVerilogA(source: string): Token[] {
  const tokens: Token[] = [];
  const len = source.length;
  let idx = 0;
  let line = 1;
  let col = 1;

  function advance(): string {
    const ch = source[idx++] ?? "\0";
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  }

  function peek(): string {
    return idx < len ? (source[idx] ?? "\0") : "\0";
  }

  function peekNext(): string {
    return idx + 1 < len ? (source[idx + 1] ?? "\0") : "\0";
  }

  function isWhitespace(ch: string): boolean {
    return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
  }

  function isAlpha(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$";
  }

  function isAlphaNum(ch: string): boolean {
    return isAlpha(ch) || (ch >= "0" && ch <= "9");
  }

  function isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  while (idx < len) {
    const ch = peek();

    // Whitespace
    if (isWhitespace(ch)) {
      advance();
      continue;
    }

    // Single-line comment
    if (ch === "/" && peekNext() === "/") {
      advance();
      advance();
      while (idx < len && peek() !== "\n") {
        advance();
      }
      continue;
    }

    // Multi-line comment
    if (ch === "/" && peekNext() === "*") {
      advance();
      advance();
      while (idx < len) {
        if (peek() === "*" && peekNext() === "/") {
          advance();
          advance();
          break;
        }
        advance();
      }
      continue;
    }

    const startLine = line;
    const startCol = col;
    const startOff = idx;

    // Compiler Directives (`include, `define, etc.)
    if (ch === "`") {
      let val = advance();
      while (idx < len && isAlphaNum(peek())) {
        val += advance();
      }
      tokens.push({
        type: "DIRECTIVE",
        value: val,
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset: startOff,
        endOffset: idx,
      });
      continue;
    }

    // String literal
    if (ch === '"') {
      advance();
      let strVal = "";
      while (idx < len && peek() !== '"') {
        if (peek() === "\\" && idx + 1 < len) {
          advance();
          strVal += advance();
        } else {
          strVal += advance();
        }
      }
      if (peek() === '"') advance();
      tokens.push({
        type: "STRING",
        value: strVal,
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset: startOff,
        endOffset: idx,
      });
      continue;
    }

    // Numbers (decimal, scientific notation)
    if (isDigit(ch) || (ch === "." && isDigit(peekNext()))) {
      let numVal = "";
      while (idx < len && (isDigit(peek()) || peek() === ".")) {
        numVal += advance();
      }
      if (peek() === "e" || peek() === "E") {
        numVal += advance();
        if (peek() === "+" || peek() === "-") {
          numVal += advance();
        }
        while (idx < len && isDigit(peek())) {
          numVal += advance();
        }
      }
      tokens.push({
        type: "NUMBER",
        value: numVal,
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset: startOff,
        endOffset: idx,
      });
      continue;
    }

    // Identifiers and Keywords
    if (isAlpha(ch)) {
      let identVal = "";
      while (idx < len && isAlphaNum(peek())) {
        identVal += advance();
      }
      const type: TokenType = KEYWORDS.has(identVal) ? "KEYWORD" : "IDENTIFIER";
      tokens.push({
        type,
        value: identVal,
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset: startOff,
        endOffset: idx,
      });
      continue;
    }

    // Multi-character operators
    // '<+' (contribution)
    if (ch === "<" && peekNext() === "+") {
      advance();
      advance();
      tokens.push({
        type: "OPERATOR",
        value: "<+",
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset: startOff,
        endOffset: idx,
      });
      continue;
    }

    // '<=' or '>=' or '==' or '!='
    if (
      (ch === "<" && peekNext() === "=") ||
      (ch === ">" && peekNext() === "=") ||
      (ch === "=" && peekNext() === "=") ||
      (ch === "!" && peekNext() === "=") ||
      (ch === "&" && peekNext() === "&") ||
      (ch === "|" && peekNext() === "|")
    ) {
      const op = advance() + advance();
      tokens.push({
        type: "OPERATOR",
        value: op,
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset: startOff,
        endOffset: idx,
      });
      continue;
    }

    // Single character operators and punctuations
    const singleOpChars = "+-*/^<>=!";
    if (singleOpChars.includes(ch)) {
      tokens.push({
        type: "OPERATOR",
        value: advance(),
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset: startOff,
        endOffset: idx,
      });
      continue;
    }

    const punctChars = "(),;:{}[]";
    if (punctChars.includes(ch)) {
      tokens.push({
        type: "PUNCTUATION",
        value: advance(),
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset: startOff,
        endOffset: idx,
      });
      continue;
    }

    // Unknown char fallback
    tokens.push({
      type: "PUNCTUATION",
      value: advance(),
      startLine,
      startColumn: startCol,
      endLine: line,
      endColumn: col,
      startOffset: startOff,
      endOffset: idx,
    });
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
// Recursive-Descent Parser
// ─────────────────────────────────────────────────────────────────────────────

export class VerilogAParser {
  private tokens: Token[];
  private current = 0;
  private uri?: string | undefined;

  constructor(source: string, uri?: string | undefined) {
    this.tokens = tokenizeVerilogA(source);
    this.uri = uri;
  }

  private peek(): Token {
    return (
      this.tokens[this.current] ??
      this.tokens[this.tokens.length - 1] ?? {
        type: "EOF",
        value: "",
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 1,
        startOffset: 0,
        endOffset: 0,
      }
    );
  }

  private lastToken(): Token {
    return (
      this.tokens[Math.max(0, this.current - 1)] ??
      this.tokens[0] ?? {
        type: "EOF",
        value: "",
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 1,
        startOffset: 0,
        endOffset: 0,
      }
    );
  }

  private isAtEnd(): boolean {
    return this.peek().type === "EOF";
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.lastToken();
  }

  private check(value: string): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().value === value;
  }

  private match(...values: string[]): boolean {
    for (const val of values) {
      if (this.check(val)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private consume(expected: string, errorMessage?: string): Token {
    if (this.check(expected)) {
      return this.advance();
    }
    const tok = this.peek();
    throw new Error(
      errorMessage ??
        `Expected '${expected}' but found '${tok.value}' at line ${tok.startLine}, col ${tok.startColumn}.`,
    );
  }

  private consumeType(expectedType: TokenType, errorMessage?: string): Token {
    if (this.peek().type === expectedType) {
      return this.advance();
    }
    const tok = this.peek();
    throw new Error(
      errorMessage ??
        `Expected token of type ${expectedType} but found '${tok.value}' (${tok.type}) at line ${tok.startLine}, col ${tok.startColumn}.`,
    );
  }

  public parse(): VerilogADocument {
    const includes: string[] = [];
    const modules: VerilogAModule[] = [];

    const firstToken = this.peek();

    while (!this.isAtEnd()) {
      if (this.peek().type === "DIRECTIVE") {
        const dir = this.advance();
        if (dir.value === "`include") {
          if (this.peek().type === "STRING") {
            includes.push(this.advance().value);
          }
        } else {
          // Skip other directives and arguments until end of line
          while (!this.isAtEnd() && this.peek().startLine === dir.startLine) {
            this.advance();
          }
        }
        continue;
      }

      if (this.check("module")) {
        modules.push(this.parseModule());
        continue;
      }

      // Skip unexpected top-level token
      this.advance();
    }

    const lastTok = this.current > 0 ? this.lastToken() : firstToken;

    return {
      uri: this.uri,
      modules,
      includes,
      sourceRange: {
        startLine: firstToken.startLine,
        startColumn: firstToken.startColumn,
        endLine: lastTok.endLine,
        endColumn: lastTok.endColumn,
        startOffset: firstToken.startOffset,
        endOffset: lastTok.endOffset,
      },
    };
  }

  private parseModule(): VerilogAModule {
    const moduleTok = this.consume("module");
    const nameTok = this.advance();
    const portNames: string[] = [];

    if (this.match("(")) {
      if (!this.check(")")) {
        do {
          if (this.peek().type === "IDENTIFIER") {
            portNames.push(this.advance().value);
          }
        } while (this.match(","));
      }
      this.consume(")");
    }
    this.consume(";");

    const ports: VerilogAPort[] = [];
    const disciplines: VerilogADisciplineDecl[] = [];
    const parameters: VerilogAParameter[] = [];
    const variables: VerilogAVariable[] = [];
    const internalNodes: string[] = [];
    let analogBlock: VerilogAAnalogBlock | undefined;

    while (!this.isAtEnd() && !this.check("endmodule")) {
      if (this.check("inout") || this.check("input") || this.check("output")) {
        const dirTok = this.advance();
        const dir = dirTok.value as PortDirection;
        const startTok = dirTok;
        const declNames: string[] = [];
        do {
          if (this.peek().type === "IDENTIFIER") {
            declNames.push(this.advance().value);
          }
        } while (this.match(","));
        const endTok = this.consume(";");

        for (const pname of declNames) {
          ports.push({
            name: pname,
            direction: dir,
            sourceRange: {
              startLine: startTok.startLine,
              startColumn: startTok.startColumn,
              endLine: endTok.endLine,
              endColumn: endTok.endColumn,
              startOffset: startTok.startOffset,
              endOffset: endTok.endOffset,
            },
          });
        }
        continue;
      }

      if (this.check("electrical") || this.check("thermal") || this.check("magnetic") || this.check("rotational")) {
        const discTok = this.advance();
        const disc = discTok.value;
        const nodes: string[] = [];
        do {
          if (this.peek().type === "IDENTIFIER") {
            const n = this.advance().value;
            nodes.push(n);
            if (!portNames.includes(n) && !internalNodes.includes(n)) {
              internalNodes.push(n);
            }
          }
        } while (this.match(","));
        const endTok = this.consume(";");

        disciplines.push({
          discipline: disc,
          nodes,
          sourceRange: {
            startLine: discTok.startLine,
            startColumn: discTok.startColumn,
            endLine: endTok.endLine,
            endColumn: endTok.endColumn,
            startOffset: discTok.startOffset,
            endOffset: endTok.endOffset,
          },
        });
        continue;
      }

      if (this.check("parameter")) {
        parameters.push(this.parseParameter());
        continue;
      }

      if (this.check("real") || this.check("integer")) {
        const typeTok = this.advance();
        const vtype = typeTok.value as "real" | "integer";
        do {
          if (this.peek().type === "IDENTIFIER") {
            const vname = this.advance().value;
            let initVal: number | undefined;
            if (this.match("=")) {
              initVal = Number.parseFloat(this.advance().value);
            }
            variables.push({
              name: vname,
              type: vtype,
              initialValue: initVal,
              sourceRange: {
                startLine: typeTok.startLine,
                startColumn: typeTok.startColumn,
                endLine: typeTok.endLine,
                endColumn: typeTok.endColumn,
                startOffset: typeTok.startOffset,
                endOffset: typeTok.endOffset,
              },
            });
          }
        } while (this.match(","));
        this.consume(";");
        continue;
      }

      if (this.check("analog")) {
        analogBlock = this.parseAnalogBlock();
        continue;
      }

      // Skip unhandled items
      this.advance();
    }

    const endTok = this.consume("endmodule");

    // Assign disciplines to ports
    for (const port of ports) {
      for (const disc of disciplines) {
        if (disc.nodes.includes(port.name)) {
          port.discipline = disc.discipline;
          break;
        }
      }
    }

    return {
      name: nameTok.value,
      ports,
      disciplines,
      parameters,
      variables,
      internalNodes,
      analogBlock,
      sourceRange: {
        startLine: moduleTok.startLine,
        startColumn: moduleTok.startColumn,
        endLine: endTok.endLine,
        endColumn: endTok.endColumn,
        startOffset: moduleTok.startOffset,
        endOffset: endTok.endOffset,
      },
    };
  }

  private parseParameter(): VerilogAParameter {
    const startTok = this.consume("parameter");
    let paramType: "real" | "integer" | "string" = "real";

    if (this.check("real")) {
      this.advance();
      paramType = "real";
    } else if (this.check("integer")) {
      this.advance();
      paramType = "integer";
    } else if (this.check("string")) {
      this.advance();
      paramType = "string";
    }

    const nameTok = this.consumeType("IDENTIFIER", "Expected parameter name");
    this.consume("=");

    let defaultVal: number | string = 0;
    if (this.peek().type === "NUMBER") {
      defaultVal = Number.parseFloat(this.advance().value);
    } else if (this.peek().type === "STRING") {
      defaultVal = this.advance().value;
    } else if (this.check("-")) {
      this.advance();
      defaultVal = -Number.parseFloat(this.advance().value);
    } else {
      defaultVal = Number.parseFloat(this.advance().value);
    }

    let rangeSpec: VerilogAParameterRange | undefined;
    if (this.match("from")) {
      const minInc = this.match("[");
      if (!minInc) this.consume("(");

      let minVal: number | undefined;
      if (this.check("inf") || this.check("-inf")) {
        this.advance();
      } else if (this.peek().type === "NUMBER") {
        minVal = Number.parseFloat(this.advance().value);
      }

      this.consume(":");

      let maxVal: number | undefined;
      if (this.check("inf") || this.check("+inf")) {
        this.advance();
      } else if (this.peek().type === "NUMBER") {
        maxVal = Number.parseFloat(this.advance().value);
      }

      const maxInc = this.match("]");
      if (!maxInc) this.consume(")");

      rangeSpec = {
        min: minVal,
        max: maxVal,
        minInclusive: minInc,
        maxInclusive: maxInc,
      };
    }

    const endTok = this.consume(";");

    return {
      name: nameTok.value,
      type: paramType,
      defaultValue: defaultVal,
      rangeSpec,
      sourceRange: {
        startLine: startTok.startLine,
        startColumn: startTok.startColumn,
        endLine: endTok.endLine,
        endColumn: endTok.endColumn,
        startOffset: startTok.startOffset,
        endOffset: endTok.endOffset,
      },
    };
  }

  private parseAnalogBlock(): VerilogAAnalogBlock {
    const startTok = this.consume("analog");
    const stmts: VerilogAStatement[] = [];

    if (this.match("begin")) {
      while (!this.isAtEnd() && !this.check("end")) {
        const stmt = this.parseStatement();
        if (stmt) stmts.push(stmt);
      }
      this.consume("end");
    } else {
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }

    const lastTok = this.lastToken();

    return {
      statements: stmts,
      sourceRange: {
        startLine: startTok.startLine,
        startColumn: startTok.startColumn,
        endLine: lastTok.endLine,
        endColumn: lastTok.endColumn,
        startOffset: startTok.startOffset,
        endOffset: lastTok.endOffset,
      },
    };
  }

  private parseStatement(): VerilogAStatement | null {
    if (this.check("begin")) {
      const startTok = this.advance();
      const stmts: VerilogAStatement[] = [];
      while (!this.isAtEnd() && !this.check("end")) {
        const s = this.parseStatement();
        if (s) stmts.push(s);
      }
      const endTok = this.consume("end");
      return {
        kind: "block",
        statements: stmts,
        sourceRange: {
          startLine: startTok.startLine,
          startColumn: startTok.startColumn,
          endLine: endTok.endLine,
          endColumn: endTok.endColumn,
          startOffset: startTok.startOffset,
          endOffset: endTok.endOffset,
        },
      };
    }

    if (this.check("if")) {
      const ifTok = this.advance();
      this.consume("(");
      const cond = this.parseExpression();
      this.consume(")");

      const thenStmt = this.parseStatement();
      const thenList: VerilogAStatement[] = thenStmt ? [thenStmt] : [];

      let elseList: VerilogAStatement[] | undefined;
      if (this.match("else")) {
        const elseStmt = this.parseStatement();
        if (elseStmt) elseList = [elseStmt];
      }

      const endTok = this.lastToken();

      return {
        kind: "if",
        condition: cond,
        thenBranch: thenList,
        elseBranch: elseList,
        sourceRange: {
          startLine: ifTok.startLine,
          startColumn: ifTok.startColumn,
          endLine: endTok.endLine,
          endColumn: endTok.endColumn,
          startOffset: ifTok.startOffset,
          endOffset: endTok.endOffset,
        },
      };
    }

    // Contribution statement or Assignment
    if (this.peek().type === "IDENTIFIER") {
      const firstTok = this.peek();

      // Check if this is a branch access V(...), I(...), Temp(...), Pwr(...), etc.
      if (
        (firstTok.value === "V" ||
          firstTok.value === "I" ||
          firstTok.value === "Potential" ||
          firstTok.value === "Flow" ||
          firstTok.value === "Temp" ||
          firstTok.value === "Pwr" ||
          firstTok.value === "Phi" ||
          firstTok.value === "MMF" ||
          firstTok.value === "Omega" ||
          firstTok.value === "Tau") &&
        this.tokens[this.current + 1]?.value === "("
      ) {
        const branch = this.parseBranchAccess();
        if (this.match("<+")) {
          const rhs = this.parseExpression();
          const endTok = this.consume(";");
          return {
            kind: "contribution",
            lhs: branch,
            rhs,
            sourceRange: {
              startLine: branch.sourceRange.startLine,
              startColumn: branch.sourceRange.startColumn,
              endLine: endTok.endLine,
              endColumn: endTok.endColumn,
              startOffset: branch.sourceRange.startOffset,
              endOffset: endTok.endOffset,
            },
          };
        }
      }

      // Variable assignment: id = expr;
      const idTok = this.advance();
      if (this.match("=")) {
        const rhs = this.parseExpression();
        const endTok = this.consume(";");
        return {
          kind: "assignment",
          variable: idTok.value,
          rhs,
          sourceRange: {
            startLine: idTok.startLine,
            startColumn: idTok.startColumn,
            endLine: endTok.endLine,
            endColumn: endTok.endColumn,
            startOffset: idTok.startOffset,
            endOffset: endTok.endOffset,
          },
        };
      }
    }

    // Skip unparsed statement to next semicolon
    while (!this.isAtEnd() && !this.check(";")) {
      this.advance();
    }
    if (this.check(";")) this.advance();
    return null;
  }

  private parseBranchAccess(): VerilogABranchAccess {
    const natTok = this.advance();
    const nat = natTok.value as VerilogABranchAccess["nature"];
    this.consume("(");
    const n1Tok = this.consumeType("IDENTIFIER", "Expected node identifier in branch access");
    let n2: string | undefined;
    if (this.match(",")) {
      const n2Tok = this.consumeType("IDENTIFIER", "Expected second node identifier");
      n2 = n2Tok.value;
    }
    const endTok = this.consume(")");

    return {
      nature: nat,
      node1: n1Tok.value,
      node2: n2,
      sourceRange: {
        startLine: natTok.startLine,
        startColumn: natTok.startColumn,
        endLine: endTok.endLine,
        endColumn: endTok.endColumn,
        startOffset: natTok.startOffset,
        endOffset: endTok.endOffset,
      },
    };
  }

  private parseExpression(): VerilogAExpr {
    return this.parseLogicalOr();
  }

  private parseLogicalOr(): VerilogAExpr {
    let expr = this.parseLogicalAnd();
    while (this.match("||")) {
      const op = "||";
      const right = this.parseLogicalAnd();
      expr = {
        kind: "binary",
        op,
        left: expr,
        right,
        sourceRange: {
          startLine: expr.sourceRange.startLine,
          startColumn: expr.sourceRange.startColumn,
          endLine: right.sourceRange.endLine,
          endColumn: right.sourceRange.endColumn,
          startOffset: expr.sourceRange.startOffset,
          endOffset: right.sourceRange.endOffset,
        },
      };
    }
    return expr;
  }

  private parseLogicalAnd(): VerilogAExpr {
    let expr = this.parseEquality();
    while (this.match("&&")) {
      const op = "&&";
      const right = this.parseEquality();
      expr = {
        kind: "binary",
        op,
        left: expr,
        right,
        sourceRange: {
          startLine: expr.sourceRange.startLine,
          startColumn: expr.sourceRange.startColumn,
          endLine: right.sourceRange.endLine,
          endColumn: right.sourceRange.endColumn,
          startOffset: expr.sourceRange.startOffset,
          endOffset: right.sourceRange.endOffset,
        },
      };
    }
    return expr;
  }

  private parseEquality(): VerilogAExpr {
    let expr = this.parseRelational();
    while (this.match("==", "!=")) {
      const op = this.lastToken().value as "==" | "!=";
      const right = this.parseRelational();
      expr = {
        kind: "binary",
        op,
        left: expr,
        right,
        sourceRange: {
          startLine: expr.sourceRange.startLine,
          startColumn: expr.sourceRange.startColumn,
          endLine: right.sourceRange.endLine,
          endColumn: right.sourceRange.endColumn,
          startOffset: expr.sourceRange.startOffset,
          endOffset: right.sourceRange.endOffset,
        },
      };
    }
    return expr;
  }

  private parseRelational(): VerilogAExpr {
    let expr = this.parseAdditive();
    while (this.match("<", "<=", ">", ">=")) {
      const op = this.lastToken().value as "<" | "<=" | ">" | ">=";
      const right = this.parseAdditive();
      expr = {
        kind: "binary",
        op,
        left: expr,
        right,
        sourceRange: {
          startLine: expr.sourceRange.startLine,
          startColumn: expr.sourceRange.startColumn,
          endLine: right.sourceRange.endLine,
          endColumn: right.sourceRange.endColumn,
          startOffset: expr.sourceRange.startOffset,
          endOffset: right.sourceRange.endOffset,
        },
      };
    }
    return expr;
  }

  private parseAdditive(): VerilogAExpr {
    let expr = this.parseMultiplicative();
    while (this.match("+", "-")) {
      const op = this.lastToken().value as "+" | "-";
      const right = this.parseMultiplicative();
      expr = {
        kind: "binary",
        op,
        left: expr,
        right,
        sourceRange: {
          startLine: expr.sourceRange.startLine,
          startColumn: expr.sourceRange.startColumn,
          endLine: right.sourceRange.endLine,
          endColumn: right.sourceRange.endColumn,
          startOffset: expr.sourceRange.startOffset,
          endOffset: right.sourceRange.endOffset,
        },
      };
    }
    return expr;
  }

  private parseMultiplicative(): VerilogAExpr {
    let expr = this.parseUnary();
    while (this.match("*", "/")) {
      const op = this.lastToken().value as "*" | "/";
      const right = this.parseUnary();
      expr = {
        kind: "binary",
        op,
        left: expr,
        right,
        sourceRange: {
          startLine: expr.sourceRange.startLine,
          startColumn: expr.sourceRange.startColumn,
          endLine: right.sourceRange.endLine,
          endColumn: right.sourceRange.endColumn,
          startOffset: expr.sourceRange.startOffset,
          endOffset: right.sourceRange.endOffset,
        },
      };
    }
    return expr;
  }

  private parseUnary(): VerilogAExpr {
    if (this.match("-", "+", "!")) {
      const opTok = this.lastToken();
      const op = opTok.value as "+" | "-" | "!";
      const right = this.parseUnary();
      return {
        kind: "unary",
        op,
        argument: right,
        sourceRange: {
          startLine: opTok.startLine,
          startColumn: opTok.startColumn,
          endLine: right.sourceRange.endLine,
          endColumn: right.sourceRange.endColumn,
          startOffset: opTok.startOffset,
          endOffset: right.sourceRange.endOffset,
        },
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): VerilogAExpr {
    const tok = this.peek();

    if (tok.type === "NUMBER") {
      this.advance();
      return {
        kind: "number",
        value: Number.parseFloat(tok.value),
        raw: tok.value,
        sourceRange: {
          startLine: tok.startLine,
          startColumn: tok.startColumn,
          endLine: tok.endLine,
          endColumn: tok.endColumn,
          startOffset: tok.startOffset,
          endOffset: tok.endOffset,
        },
      };
    }

    if (tok.type === "IDENTIFIER") {
      // Check branch access V(...), I(...), Temp(...), Pwr(...), etc.
      if (
        (tok.value === "V" ||
          tok.value === "I" ||
          tok.value === "Potential" ||
          tok.value === "Flow" ||
          tok.value === "Temp" ||
          tok.value === "Pwr" ||
          tok.value === "Phi" ||
          tok.value === "MMF" ||
          tok.value === "Omega" ||
          tok.value === "Tau") &&
        this.tokens[this.current + 1]?.value === "("
      ) {
        const branch = this.parseBranchAccess();
        return {
          kind: "branch_access",
          nature: branch.nature,
          node1: branch.node1,
          node2: branch.node2,
          sourceRange: branch.sourceRange,
        };
      }

      // Check function call: ident(arg1, arg2...)
      if (this.tokens[this.current + 1]?.value === "(") {
        const funcTok = this.advance();
        this.consume("(");
        const args: VerilogAExpr[] = [];
        if (!this.check(")")) {
          do {
            args.push(this.parseExpression());
          } while (this.match(","));
        }
        const endTok = this.consume(")");
        return {
          kind: "call",
          func: funcTok.value,
          args,
          sourceRange: {
            startLine: funcTok.startLine,
            startColumn: funcTok.startColumn,
            endLine: endTok.endLine,
            endColumn: endTok.endColumn,
            startOffset: funcTok.startOffset,
            endOffset: endTok.endOffset,
          },
        };
      }

      // Regular identifier / variable / parameter
      this.advance();
      return {
        kind: "identifier",
        name: tok.value,
        sourceRange: {
          startLine: tok.startLine,
          startColumn: tok.startColumn,
          endLine: tok.endLine,
          endColumn: tok.endColumn,
          startOffset: tok.startOffset,
          endOffset: tok.endOffset,
        },
      };
    }

    if (this.match("(")) {
      const openParen = this.lastToken();
      const expr = this.parseExpression();
      const closeParen = this.consume(")");
      return {
        ...expr,
        sourceRange: {
          startLine: openParen.startLine,
          startColumn: openParen.startColumn,
          endLine: closeParen.endLine,
          endColumn: closeParen.endColumn,
          startOffset: openParen.startOffset,
          endOffset: closeParen.endOffset,
        },
      };
    }

    throw new Error(`Unexpected token '${tok.value}' (${tok.type}) at line ${tok.startLine}, col ${tok.startColumn}.`);
  }
}

export function parseVerilogA(source: string, uri?: string | undefined): VerilogADocument {
  const parser = new VerilogAParser(source, uri);
  return parser.parse();
}
