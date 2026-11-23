// SPDX-License-Identifier: AGPL-3.0-or-later

import { EsterelErrorCode } from "../errors.js";
import type {
  EsterelAwaitCase,
  EsterelModule,
  EsterelProgram,
  EsterelRelation,
  EsterelSignalDecl,
  EsterelSignalDirection,
  EsterelSignalExpr,
  EsterelSignalRenaming,
  EsterelStatement,
  EsterelSyntaxError,
  EsterelTrapHandler,
  SourceSpan,
} from "../types.js";

type TokenKind = "ident" | "number" | "string" | "symbol" | "eof";

interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  column: number;
  offset: number;
  endOffset: number;
}

const KEYWORDS = new Set([
  "module",
  "end",
  "input",
  "output",
  "inputoutput",
  "sensor",
  "relation",
  "signal",
  "in",
  "emit",
  "sustain",
  "present",
  "then",
  "else",
  "await",
  "immediate",
  "case",
  "do",
  "pause",
  "nothing",
  "halt",
  "loop",
  "each",
  "every",
  "abort",
  "weak",
  "when",
  "suspend",
  "trap",
  "handle",
  "exit",
  "run",
  "and",
  "or",
  "not",
  "tick",
  "pre",
  "combine",
  "with",
]);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const len = source.length;

  while (i < len) {
    const ch = source[i]!;

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      col++;
      continue;
    }
    if (ch === "\n") {
      i++;
      line++;
      col = 1;
      continue;
    }

    // Comments: %{ ... }% or % ... \n
    if (ch === "%") {
      if (source[i + 1] === "{") {
        i += 2;
        col += 2;
        while (i < len) {
          if (source[i] === "}" && source[i + 1] === "%") {
            i += 2;
            col += 2;
            break;
          }
          if (source[i] === "\n") {
            line++;
            col = 1;
          } else {
            col++;
          }
          i++;
        }
        continue;
      }
      while (i < len && source[i] !== "\n") {
        i++;
        col++;
      }
      continue;
    }

    const startLine = line;
    const startCol = col;
    const startOffset = i;

    // Two-character symbols
    const two = source.slice(i, i + 2);
    if (two === "||" || two === "=>" || two === ":=" || two === "<=" || two === ">=" || two === "<>") {
      tokens.push({
        kind: "symbol",
        value: two,
        line: startLine,
        column: startCol,
        offset: startOffset,
        endOffset: i + 2,
      });
      i += 2;
      col += 2;
      continue;
    }

    // Single-character symbols
    if (":;,[]()#./+-*=<>".includes(ch)) {
      tokens.push({
        kind: "symbol",
        value: ch,
        line: startLine,
        column: startCol,
        offset: startOffset,
        endOffset: i + 1,
      });
      i++;
      col++;
      continue;
    }

    // String literals
    if (ch === '"') {
      let str = "";
      i++;
      col++;
      while (i < len && source[i] !== '"') {
        if (source[i] === "\\" && i + 1 < len) {
          str += source[i + 1]!;
          i += 2;
          col += 2;
        } else {
          if (source[i] === "\n") {
            line++;
            col = 1;
          } else {
            col++;
          }
          str += source[i]!;
          i++;
        }
      }
      if (i < len && source[i] === '"') {
        i++;
        col++;
      }
      tokens.push({
        kind: "string",
        value: str,
        line: startLine,
        column: startCol,
        offset: startOffset,
        endOffset: i,
      });
      continue;
    }

    // Number literals
    if (ch >= "0" && ch <= "9") {
      let num = "";
      while (i < len && ((source[i]! >= "0" && source[i]! <= "9") || source[i] === ".")) {
        num += source[i]!;
        i++;
        col++;
      }
      tokens.push({
        kind: "number",
        value: num,
        line: startLine,
        column: startCol,
        offset: startOffset,
        endOffset: i,
      });
      continue;
    }

    // Identifiers & keywords
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      let id = "";
      while (
        i < len &&
        ((source[i]! >= "a" && source[i]! <= "z") ||
          (source[i]! >= "A" && source[i]! <= "Z") ||
          (source[i]! >= "0" && source[i]! <= "9") ||
          source[i] === "_")
      ) {
        id += source[i]!;
        i++;
        col++;
      }
      tokens.push({
        kind: "ident",
        value: id,
        line: startLine,
        column: startCol,
        offset: startOffset,
        endOffset: i,
      });
      continue;
    }

    // Unknown character: skip as symbol
    tokens.push({
      kind: "symbol",
      value: ch,
      line: startLine,
      column: startCol,
      offset: startOffset,
      endOffset: i + 1,
    });
    i++;
    col++;
  }

  tokens.push({
    kind: "eof",
    value: "",
    line,
    column: col,
    offset: len,
    endOffset: len,
  });
  return tokens;
}

class EsterelParser {
  private readonly tokens: Token[];
  private pos = 0;
  private readonly errors: EsterelSyntaxError[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token {
    const idx = Math.min(this.pos + offset, this.tokens.length - 1);
    return this.tokens[idx]!;
  }

  private prev(): Token {
    const idx = Math.max(0, this.pos - 1);
    return this.tokens[idx]!;
  }

  private advance(): Token {
    const tok = this.peek();
    if (this.pos < this.tokens.length - 1) {
      this.pos++;
    }
    return tok;
  }

  private isEof(): boolean {
    return this.peek().kind === "eof";
  }

  private check(value: string): boolean {
    const t = this.peek();
    return t.kind !== "eof" && t.value === value;
  }

  private checkKeyword(kw: string): boolean {
    const t = this.peek();
    return t.kind === "ident" && t.value === kw;
  }

  private match(value: string): boolean {
    if (this.check(value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchKeyword(kw: string): boolean {
    if (this.checkKeyword(kw)) {
      this.advance();
      return true;
    }
    return false;
  }

  private spanFrom(start: Token, end: Token = this.prev()): SourceSpan {
    return {
      startLine: start.line,
      startColumn: start.column,
      endLine: end.line,
      endColumn: end.column + Math.max(1, end.endOffset - end.offset),
      startOffset: start.offset,
      endOffset: end.endOffset,
    };
  }

  private addError(code: string, message: string, tok: Token = this.peek()): void {
    this.errors.push({
      code,
      message,
      line: tok.line,
      column: tok.column,
      offset: tok.offset,
    });
  }

  private expectIdentifier(context: string): string {
    const t = this.peek();
    if (t.kind === "ident" && !KEYWORDS.has(t.value)) {
      this.advance();
      return t.value;
    }
    if (t.kind === "ident") {
      // Recover gracefully if keyword used where identifier expected
      this.addError(
        EsterelErrorCode.SYNTAX_ERROR.code,
        EsterelErrorCode.SYNTAX_ERROR.message(`unexpected keyword '${t.value}' in ${context}`),
        t,
      );
      this.advance();
      return t.value;
    }
    this.addError(
      EsterelErrorCode.SYNTAX_ERROR.code,
      EsterelErrorCode.SYNTAX_ERROR.message(`expected identifier in ${context}, found '${t.value || "EOF"}'`),
      t,
    );
    return "_missing";
  }

  parseProgram(source: string): EsterelProgram {
    const modules: EsterelModule[] = [];
    while (!this.isEof()) {
      if (this.checkKeyword("module")) {
        modules.push(this.parseModule());
      } else {
        const tok = this.peek();
        this.addError(
          EsterelErrorCode.SYNTAX_ERROR.code,
          EsterelErrorCode.SYNTAX_ERROR.message(`expected 'module', found '${tok.value || "EOF"}'`),
          tok,
        );
        this.advance();
      }
    }
    return { modules, errors: this.errors, source };
  }

  private parseModule(): EsterelModule {
    const startTok = this.advance(); // 'module'
    const name = this.expectIdentifier("module declaration");
    if (!this.match(":")) {
      this.addError(
        EsterelErrorCode.SYNTAX_ERROR.code,
        EsterelErrorCode.SYNTAX_ERROR.message(`expected ':' after module name '${name}'`),
      );
    }

    const signals: EsterelSignalDecl[] = [];
    const relations: EsterelRelation[] = [];

    // Parse interface declarations
    while (!this.isEof() && !this.checkKeyword("end")) {
      if (
        this.checkKeyword("input") ||
        this.checkKeyword("output") ||
        this.checkKeyword("inputoutput") ||
        this.checkKeyword("sensor")
      ) {
        this.parseSignalDeclList(signals);
      } else if (this.checkKeyword("relation")) {
        this.parseRelationDecl(relations);
      } else {
        break;
      }
    }

    // Parse body
    let body: EsterelStatement;
    if (this.checkKeyword("end") || this.isEof()) {
      const t = this.peek();
      body = { kind: "nothing", span: this.spanFrom(t, t) };
    } else {
      body = this.parseParallel();
    }

    // Optional trailing semicolon
    this.match(";");

    // Closing `end module` or `end`
    if (this.matchKeyword("end")) {
      this.matchKeyword("module");
      this.match(".");
    } else {
      this.addError(
        EsterelErrorCode.UNMATCHED_BLOCK.code,
        EsterelErrorCode.UNMATCHED_BLOCK.message(`module ${name}`),
        startTok,
      );
    }

    return {
      name,
      signals,
      relations,
      body,
      span: this.spanFrom(startTok),
    };
  }

  private parseSignalDeclList(out: EsterelSignalDecl[]): void {
    const dirTok = this.advance();
    const direction = dirTok.value as EsterelSignalDirection;

    while (!this.isEof()) {
      const sigTok = this.peek();
      const sigName = this.expectIdentifier(`${direction} signal declaration`);
      let initialValue: string | undefined;
      let valueType: string | undefined;
      let combineOp: string | undefined;

      if (this.match(":=")) {
        initialValue = this.parseSimpleValue();
      }
      if (this.match(":")) {
        if (this.matchKeyword("combine")) {
          valueType = this.expectIdentifier("combine type");
          if (this.matchKeyword("with")) {
            combineOp = this.advance().value;
          }
        } else {
          valueType = this.expectIdentifier("signal type");
        }
      }

      out.push({
        name: sigName,
        direction,
        valueType,
        initialValue,
        combineOp,
        span: this.spanFrom(sigTok),
      });

      if (!this.match(",")) break;
    }

    this.match(";");
  }

  private parseRelationDecl(out: EsterelRelation[]): void {
    const startTok = this.advance(); // 'relation'
    while (!this.isEof() && !this.check(";")) {
      const relStart = this.peek();
      const first = this.expectIdentifier("relation declaration");
      if (this.match("#")) {
        const sigs = [first];
        do {
          sigs.push(this.expectIdentifier("exclusion relation"));
        } while (this.match("#"));
        out.push({
          kind: "exclusion",
          signals: sigs,
          span: this.spanFrom(relStart),
        });
      } else if (this.match("=>")) {
        const rhs = this.expectIdentifier("implication relation");
        out.push({
          kind: "implication",
          signals: [first, rhs],
          span: this.spanFrom(relStart),
        });
      } else {
        this.addError(
          EsterelErrorCode.SYNTAX_ERROR.code,
          EsterelErrorCode.SYNTAX_ERROR.message(`expected '#' or '=>' in relation after '${first}'`),
          startTok,
        );
        break;
      }

      if (!this.match(",")) break;
    }
    this.match(";");
  }

  private parseSimpleValue(): string {
    const parts: string[] = [];
    if (this.check("-") || this.check("+")) {
      parts.push(this.advance().value);
    }
    if (!this.isEof() && !this.check(",") && !this.check(";") && !this.check(":") && !this.check(")")) {
      parts.push(this.advance().value);
    }
    return parts.join("");
  }

  private isStatementTerminator(): boolean {
    if (this.isEof()) return true;
    const t = this.peek();
    if (t.value === "]" || t.value === ")") return true;
    if (t.kind === "ident") {
      return (
        t.value === "end" ||
        t.value === "else" ||
        t.value === "when" ||
        t.value === "each" ||
        t.value === "handle" ||
        t.value === "case"
      );
    }
    return false;
  }

  private parseParallel(): EsterelStatement {
    const start = this.peek();
    const first = this.parseSequence();
    if (!this.check("||")) return first;

    const branches: EsterelStatement[] = [first];
    while (this.match("||")) {
      branches.push(this.parseSequence());
    }
    return {
      kind: "par",
      branches,
      span: this.spanFrom(start),
    };
  }

  private parseSequence(): EsterelStatement {
    const start = this.peek();
    const first = this.parsePrimaryStmt();
    const stmts: EsterelStatement[] = [first];

    while (this.match(";")) {
      if (this.isStatementTerminator() || this.check("||")) break;
      stmts.push(this.parsePrimaryStmt());
    }

    if (stmts.length === 1) return first;
    return {
      kind: "seq",
      statements: stmts,
      span: this.spanFrom(start),
    };
  }

  private parsePrimaryStmt(): EsterelStatement {
    const tok = this.peek();

    // Grouped block `[ ... ]` or `( ... )`
    if (this.match("[")) {
      const inner = this.parseParallel();
      if (!this.match("]")) {
        this.addError(EsterelErrorCode.UNMATCHED_BLOCK.code, EsterelErrorCode.UNMATCHED_BLOCK.message("["), tok);
      }
      return inner;
    }

    if (this.match("(")) {
      const inner = this.parseParallel();
      if (!this.match(")")) {
        this.addError(EsterelErrorCode.UNMATCHED_BLOCK.code, EsterelErrorCode.UNMATCHED_BLOCK.message("("), tok);
      }
      return inner;
    }

    if (this.matchKeyword("nothing")) {
      return { kind: "nothing", span: this.spanFrom(tok) };
    }

    if (this.matchKeyword("pause")) {
      return { kind: "pause", span: this.spanFrom(tok) };
    }

    if (this.matchKeyword("halt")) {
      return { kind: "halt", span: this.spanFrom(tok) };
    }

    if (this.matchKeyword("emit")) {
      const signal = this.expectIdentifier("emit statement");
      let value: string | undefined;
      if (this.match("(")) {
        value = this.parseParenthesizedExprText();
      }
      return { kind: "emit", signal, value, span: this.spanFrom(tok) };
    }

    if (this.matchKeyword("sustain")) {
      const signal = this.expectIdentifier("sustain statement");
      let value: string | undefined;
      if (this.match("(")) {
        value = this.parseParenthesizedExprText();
      }
      return { kind: "sustain", signal, value, span: this.spanFrom(tok) };
    }

    if (this.matchKeyword("present")) {
      return this.parsePresent(tok);
    }

    if (this.matchKeyword("await")) {
      return this.parseAwait(tok);
    }

    if (this.matchKeyword("loop")) {
      return this.parseLoop(tok);
    }

    if (this.matchKeyword("every")) {
      return this.parseEvery(tok);
    }

    if (this.matchKeyword("weak")) {
      if (!this.matchKeyword("abort")) {
        this.addError(
          EsterelErrorCode.SYNTAX_ERROR.code,
          EsterelErrorCode.SYNTAX_ERROR.message("expected 'abort' after 'weak'"),
        );
      }
      return this.parseAbort(tok, true);
    }

    if (this.matchKeyword("abort")) {
      return this.parseAbort(tok, false);
    }

    if (this.matchKeyword("suspend")) {
      return this.parseSuspend(tok);
    }

    if (this.matchKeyword("trap")) {
      return this.parseTrap(tok);
    }

    if (this.matchKeyword("exit")) {
      const trapName = this.expectIdentifier("exit statement");
      return { kind: "exit", trapName, span: this.spanFrom(tok) };
    }

    if (this.matchKeyword("signal")) {
      return this.parseLocalSignal(tok);
    }

    if (this.matchKeyword("run")) {
      return this.parseRun(tok);
    }

    // Unexpected token recovery
    this.addError(
      EsterelErrorCode.SYNTAX_ERROR.code,
      EsterelErrorCode.SYNTAX_ERROR.message(`unexpected token '${tok.value || "EOF"}' in statement`),
      tok,
    );
    this.advance();
    return { kind: "nothing", span: this.spanFrom(tok) };
  }

  private parseParenthesizedExprText(): string {
    let depth = 1;
    const parts: string[] = [];
    while (!this.isEof() && depth > 0) {
      const t = this.advance();
      if (t.value === "(") {
        depth++;
        parts.push(t.value);
      } else if (t.value === ")") {
        depth--;
        if (depth > 0) parts.push(t.value);
      } else {
        parts.push(t.value);
      }
    }
    return parts.join(" ");
  }

  private parsePresent(startTok: Token): EsterelStatement {
    const expr = this.parseSignalExpr();
    let thenBranch: EsterelStatement = { kind: "nothing", span: this.spanFrom(startTok) };
    let elseBranch: EsterelStatement | undefined;

    if (this.matchKeyword("then")) {
      thenBranch = this.parseParallel();
    }

    if (this.matchKeyword("else")) {
      elseBranch = this.parseParallel();
    }

    if (this.matchKeyword("end")) {
      this.matchKeyword("present");
    } else {
      this.addError(
        EsterelErrorCode.UNMATCHED_BLOCK.code,
        EsterelErrorCode.UNMATCHED_BLOCK.message("present"),
        startTok,
      );
    }

    return {
      kind: "present",
      expr,
      thenBranch,
      elseBranch,
      span: this.spanFrom(startTok),
    };
  }

  private parseAwait(startTok: Token): EsterelStatement {
    // Multi-case await: `await case ... end`
    if (this.checkKeyword("case")) {
      const cases: EsterelAwaitCase[] = [];
      while (this.matchKeyword("case")) {
        const caseStart = this.prev();
        const immediate = this.matchKeyword("immediate");
        let count: number | undefined;
        if (this.peek().kind === "number") {
          count = parseInt(this.advance().value, 10);
        }
        const expr = this.parseSignalExpr();
        let body: EsterelStatement | undefined;
        if (this.matchKeyword("do")) {
          body = this.parseParallel();
        }
        cases.push({
          immediate,
          count,
          expr,
          body,
          span: this.spanFrom(caseStart),
        });
      }
      if (this.matchKeyword("end")) {
        this.matchKeyword("await");
      } else {
        this.addError(
          EsterelErrorCode.UNMATCHED_BLOCK.code,
          EsterelErrorCode.UNMATCHED_BLOCK.message("await"),
          startTok,
        );
      }
      const firstCase = cases[0];
      return {
        kind: "await",
        immediate: firstCase?.immediate ?? false,
        count: firstCase?.count,
        expr: firstCase?.expr ?? { kind: "tick", span: this.spanFrom(startTok) },
        cases,
        span: this.spanFrom(startTok),
      };
    }

    const immediate = this.matchKeyword("immediate");
    let count: number | undefined;
    if (this.peek().kind === "number") {
      count = parseInt(this.advance().value, 10);
    }
    const expr = this.parseSignalExpr();
    let body: EsterelStatement | undefined;
    if (this.matchKeyword("do")) {
      body = this.parseParallel();
      if (this.matchKeyword("end")) {
        this.matchKeyword("await");
      } else {
        this.addError(
          EsterelErrorCode.UNMATCHED_BLOCK.code,
          EsterelErrorCode.UNMATCHED_BLOCK.message("await"),
          startTok,
        );
      }
    }

    return {
      kind: "await",
      immediate,
      count,
      expr,
      body,
      span: this.spanFrom(startTok),
    };
  }

  private parseLoop(startTok: Token): EsterelStatement {
    const body = this.parseParallel();
    if (this.matchKeyword("each")) {
      const eachExpr = this.parseSignalExpr();
      return {
        kind: "loop",
        body,
        eachExpr,
        span: this.spanFrom(startTok),
      };
    }
    if (this.matchKeyword("end")) {
      this.matchKeyword("loop");
    } else {
      this.addError(EsterelErrorCode.UNMATCHED_BLOCK.code, EsterelErrorCode.UNMATCHED_BLOCK.message("loop"), startTok);
    }
    return {
      kind: "loop",
      body,
      span: this.spanFrom(startTok),
    };
  }

  private parseEvery(startTok: Token): EsterelStatement {
    const immediate = this.matchKeyword("immediate");
    const expr = this.parseSignalExpr();
    if (!this.matchKeyword("do")) {
      this.addError(
        EsterelErrorCode.SYNTAX_ERROR.code,
        EsterelErrorCode.SYNTAX_ERROR.message("expected 'do' in 'every' statement"),
      );
    }
    const body = this.parseParallel();
    if (this.matchKeyword("end")) {
      this.matchKeyword("every");
    } else {
      this.addError(EsterelErrorCode.UNMATCHED_BLOCK.code, EsterelErrorCode.UNMATCHED_BLOCK.message("every"), startTok);
    }
    return {
      kind: "every",
      immediate,
      expr,
      body,
      span: this.spanFrom(startTok),
    };
  }

  private parseAbort(startTok: Token, weak: boolean): EsterelStatement {
    const body = this.parseParallel();
    if (!this.matchKeyword("when")) {
      this.addError(
        EsterelErrorCode.SYNTAX_ERROR.code,
        EsterelErrorCode.SYNTAX_ERROR.message("expected 'when' in 'abort' statement"),
      );
    }
    const immediate = this.matchKeyword("immediate");
    let count: number | undefined;
    if (this.peek().kind === "number") {
      count = parseInt(this.advance().value, 10);
    }
    const expr = this.parseSignalExpr();
    let handler: EsterelStatement | undefined;
    if (this.matchKeyword("do")) {
      handler = this.parseParallel();
      if (this.matchKeyword("end")) {
        if (weak) this.matchKeyword("weak");
        this.matchKeyword("abort");
      } else {
        this.addError(
          EsterelErrorCode.UNMATCHED_BLOCK.code,
          EsterelErrorCode.UNMATCHED_BLOCK.message(weak ? "weak abort" : "abort"),
          startTok,
        );
      }
    } else if (this.checkKeyword("end")) {
      // Allow optional `end` / `end abort` when not followed by `module`
      if (this.peek(1).value !== "module") {
        this.advance();
        if (weak) this.matchKeyword("weak");
        this.matchKeyword("abort");
      }
    }

    return {
      kind: "abort",
      weak,
      body,
      immediate,
      count,
      expr,
      handler,
      span: this.spanFrom(startTok),
    };
  }

  private parseSuspend(startTok: Token): EsterelStatement {
    const body = this.parseParallel();
    if (!this.matchKeyword("when")) {
      this.addError(
        EsterelErrorCode.SYNTAX_ERROR.code,
        EsterelErrorCode.SYNTAX_ERROR.message("expected 'when' in 'suspend' statement"),
      );
    }
    const immediate = this.matchKeyword("immediate");
    const expr = this.parseSignalExpr();
    if (this.checkKeyword("end") && this.peek(1).value !== "module") {
      this.advance();
      this.matchKeyword("suspend");
    }
    return {
      kind: "suspend",
      body,
      immediate,
      expr,
      span: this.spanFrom(startTok),
    };
  }

  private parseTrap(startTok: Token): EsterelStatement {
    const traps: string[] = [];
    do {
      traps.push(this.expectIdentifier("trap declaration"));
    } while (this.match(","));

    if (!this.matchKeyword("in")) {
      this.addError(
        EsterelErrorCode.SYNTAX_ERROR.code,
        EsterelErrorCode.SYNTAX_ERROR.message("expected 'in' after trap declarations"),
      );
    }

    const body = this.parseParallel();
    const handlers: EsterelTrapHandler[] = [];

    while (this.matchKeyword("handle")) {
      const hStart = this.prev();
      const trapName = this.expectIdentifier("handle clause");
      if (!this.matchKeyword("do")) {
        this.addError(
          EsterelErrorCode.SYNTAX_ERROR.code,
          EsterelErrorCode.SYNTAX_ERROR.message(`expected 'do' after 'handle ${trapName}'`),
        );
      }
      const hBody = this.parseParallel();
      handlers.push({
        trapName,
        body: hBody,
        span: this.spanFrom(hStart),
      });
    }

    if (this.matchKeyword("end")) {
      this.matchKeyword("trap");
    } else {
      this.addError(EsterelErrorCode.UNMATCHED_BLOCK.code, EsterelErrorCode.UNMATCHED_BLOCK.message("trap"), startTok);
    }

    return {
      kind: "trap",
      traps,
      body,
      handlers,
      span: this.spanFrom(startTok),
    };
  }

  private parseLocalSignal(startTok: Token): EsterelStatement {
    const signals: EsterelSignalDecl[] = [];
    do {
      const sigTok = this.peek();
      const name = this.expectIdentifier("local signal declaration");
      let initialValue: string | undefined;
      let valueType: string | undefined;
      if (this.match(":=")) {
        initialValue = this.parseSimpleValue();
      }
      if (this.match(":")) {
        valueType = this.expectIdentifier("local signal type");
      }
      signals.push({
        name,
        direction: "inputoutput",
        valueType,
        initialValue,
        span: this.spanFrom(sigTok),
      });
    } while (this.match(","));

    if (!this.matchKeyword("in")) {
      this.addError(
        EsterelErrorCode.SYNTAX_ERROR.code,
        EsterelErrorCode.SYNTAX_ERROR.message("expected 'in' after local signal declaration"),
      );
    }

    const body = this.parseParallel();

    if (this.matchKeyword("end")) {
      this.matchKeyword("signal");
    } else {
      this.addError(
        EsterelErrorCode.UNMATCHED_BLOCK.code,
        EsterelErrorCode.UNMATCHED_BLOCK.message("signal"),
        startTok,
      );
    }

    return {
      kind: "signal",
      signals,
      body,
      span: this.spanFrom(startTok),
    };
  }

  private parseRun(startTok: Token): EsterelStatement {
    const moduleName = this.expectIdentifier("run statement");
    const renamings: EsterelSignalRenaming[] = [];

    if (this.match("[")) {
      while (!this.isEof() && !this.check("]")) {
        this.matchKeyword("signal");
        const actual = this.expectIdentifier("run signal renaming");
        if (this.match("/")) {
          const formal = this.expectIdentifier("run formal signal");
          renamings.push({ formal, actual });
        }
        if (!this.match(",") && !this.match(";")) break;
      }
      this.match("]");
    }

    return {
      kind: "run",
      moduleName,
      renamings,
      span: this.spanFrom(startTok),
    };
  }

  private parseSignalExpr(): EsterelSignalExpr {
    return this.parseSignalOr();
  }

  private parseSignalOr(): EsterelSignalExpr {
    let left = this.parseSignalAnd();
    while (this.matchKeyword("or")) {
      const right = this.parseSignalAnd();
      left = {
        kind: "or",
        left,
        right,
        span: {
          startLine: left.span.startLine,
          startColumn: left.span.startColumn,
          endLine: right.span.endLine,
          endColumn: right.span.endColumn,
          startOffset: left.span.startOffset,
          endOffset: right.span.endOffset,
        },
      };
    }
    return left;
  }

  private parseSignalAnd(): EsterelSignalExpr {
    let left = this.parseSignalNot();
    while (this.matchKeyword("and")) {
      const right = this.parseSignalNot();
      left = {
        kind: "and",
        left,
        right,
        span: {
          startLine: left.span.startLine,
          startColumn: left.span.startColumn,
          endLine: right.span.endLine,
          endColumn: right.span.endColumn,
          startOffset: left.span.startOffset,
          endOffset: right.span.endOffset,
        },
      };
    }
    return left;
  }

  private parseSignalNot(): EsterelSignalExpr {
    if (this.matchKeyword("not")) {
      const start = this.prev();
      const operand = this.parseSignalNot();
      return {
        kind: "not",
        operand,
        span: {
          startLine: start.line,
          startColumn: start.column,
          endLine: operand.span.endLine,
          endColumn: operand.span.endColumn,
          startOffset: start.offset,
          endOffset: operand.span.endOffset,
        },
      };
    }
    return this.parseSignalPrimary();
  }

  private parseSignalPrimary(): EsterelSignalExpr {
    const tok = this.peek();
    if (this.match("(")) {
      const inner = this.parseSignalExpr();
      this.match(")");
      return inner;
    }
    if (this.matchKeyword("tick")) {
      return { kind: "tick", span: this.spanFrom(tok) };
    }
    const name = this.expectIdentifier("signal expression");
    return { kind: "signal", name, span: this.spanFrom(tok) };
  }
}

/**
 * Parses Esterel source text into an `EsterelProgram` AST with syntax error recovery.
 */
export function parseEsterel(source: string): EsterelProgram {
  const tokens = tokenize(source);
  const parser = new EsterelParser(tokens);
  return parser.parseProgram(source);
}
