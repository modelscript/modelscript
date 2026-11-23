// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Structured ITU-T Z.100 SDL-88 Phrase Representation (SDL/PR) Parser.
 *
 * Parses SYSTEM / BLOCK / PROCESS / CHANNEL / SIGNALROUTE / CONNECT / SIGNAL /
 * DCL / TIMER / START / STATE / INPUT / OUTPUT / TASK / DECISION / NEXTSTATE /
 * SET / RESET / STOP and block comments into a typed `SdlSystemModel`.
 */

import type {
  SdlAction,
  SdlBlockDecl,
  SdlChannelDecl,
  SdlChannelPath,
  SdlConnectDecl,
  SdlDecisionBranch,
  SdlInputClause,
  SdlProcessDecl,
  SdlSignalDecl,
  SdlSignalRouteDecl,
  SdlSpan,
  SdlStateDecl,
  SdlSyntaxError,
  SdlSystemModel,
  SdlTerminator,
  SdlTimerDecl,
  SdlTransition,
  SdlVarDecl,
} from "../types.js";

type TokenKind = "word" | "number" | "string" | "symbol" | "eof";

interface Token {
  kind: TokenKind;
  value: string;
  upper: string;
  startOffset: number;
  endOffset: number;
  line: number;
  column: number;
}

function tokenizeSdl(source: string): { tokens: Token[]; errors: SdlSyntaxError[] } {
  const tokens: Token[] = [];
  const errors: SdlSyntaxError[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = source.length;

  const advance = (): string => {
    const ch = source[i++] ?? "";
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  };

  while (i < n) {
    const ch = source[i] ?? "";

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    // Block comment /* ... */
    if (ch === "/" && source[i + 1] === "*") {
      const startOffset = i;
      const startLine = line;
      const startCol = col;
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
          startOffset,
          endOffset: i,
          line: startLine,
          column: startCol,
          message: "Unterminated /* */ comment",
        });
      }
      continue;
    }

    // Line comment -- (optional SDL-92 convenience)
    if (ch === "-" && source[i + 1] === "-") {
      while (i < n && source[i] !== "\n") advance();
      continue;
    }

    const startOffset = i;
    const startLine = line;
    const startCol = col;

    // String literal '...' or "..."
    if (ch === "'" || ch === '"') {
      const quote = advance();
      let val = "";
      let closed = false;
      while (i < n) {
        const c = advance();
        if (c === quote) {
          if (source[i] === quote) {
            val += advance();
          } else {
            closed = true;
            break;
          }
        } else {
          val += c;
        }
      }
      if (!closed) {
        errors.push({
          startOffset,
          endOffset: i,
          line: startLine,
          column: startCol,
          message: "Unterminated string literal",
        });
      }
      tokens.push({
        kind: "string",
        value: val,
        upper: val.toUpperCase(),
        startOffset,
        endOffset: i,
        line: startLine,
        column: startCol,
      });
      continue;
    }

    // Number literal
    if (ch >= "0" && ch <= "9") {
      let val = "";
      while (i < n && ((source[i]! >= "0" && source[i]! <= "9") || source[i] === ".")) {
        val += advance();
      }
      if (i < n && (source[i] === "e" || source[i] === "E")) {
        val += advance();
        if (i < n && (source[i] === "+" || source[i] === "-")) val += advance();
        while (i < n && source[i]! >= "0" && source[i]! <= "9") val += advance();
      }
      tokens.push({
        kind: "number",
        value: val,
        upper: val.toUpperCase(),
        startOffset,
        endOffset: i,
        line: startLine,
        column: startCol,
      });
      continue;
    }

    // Identifier / Keyword
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_") {
      let val = "";
      while (
        i < n &&
        ((source[i]! >= "A" && source[i]! <= "Z") ||
          (source[i]! >= "a" && source[i]! <= "z") ||
          (source[i]! >= "0" && source[i]! <= "9") ||
          source[i] === "_")
      ) {
        val += advance();
      }
      tokens.push({
        kind: "word",
        value: val,
        upper: val.toUpperCase(),
        startOffset,
        endOffset: i,
        line: startLine,
        column: startCol,
      });
      continue;
    }

    // Multi-char operators: :=, /=, <=, >=, =>, //
    const two = source.slice(i, i + 2);
    if (two === ":=" || two === "/=" || two === "<=" || two === ">=" || two === "=>" || two === "//") {
      advance();
      advance();
      tokens.push({
        kind: "symbol",
        value: two,
        upper: two,
        startOffset,
        endOffset: i,
        line: startLine,
        column: startCol,
      });
      continue;
    }

    // Single-char symbol
    const sym = advance();
    tokens.push({
      kind: "symbol",
      value: sym,
      upper: sym,
      startOffset,
      endOffset: i,
      line: startLine,
      column: startCol,
    });
  }

  tokens.push({
    kind: "eof",
    value: "",
    upper: "",
    startOffset: n,
    endOffset: n,
    line,
    column: col,
  });

  return { tokens, errors };
}

class SdlParserCursor {
  private pos = 0;
  public readonly errors: SdlSyntaxError[];

  constructor(
    private readonly tokens: Token[],
    initialErrors: SdlSyntaxError[],
  ) {
    this.errors = [...initialErrors];
  }

  peek(offset = 0): Token {
    const idx = Math.min(this.pos + offset, this.tokens.length - 1);
    return this.tokens[idx]!;
  }

  atEof(): boolean {
    return this.peek().kind === "eof";
  }

  next(): Token {
    const tok = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  isKeyword(kw: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === "word" && t.upper === kw;
  }

  isSymbol(sym: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === "symbol" && t.value === sym;
  }

  matchKeyword(kw: string): Token | undefined {
    if (this.isKeyword(kw)) return this.next();
    return undefined;
  }

  matchSymbol(sym: string): Token | undefined {
    if (this.isSymbol(sym)) return this.next();
    return undefined;
  }

  expectSemi(): void {
    this.matchSymbol(";");
  }

  addError(tok: Token, message: string): void {
    this.errors.push({
      startOffset: tok.startOffset,
      endOffset: tok.endOffset,
      line: tok.line,
      column: tok.column,
      message,
    });
  }

  spanFrom(start: Token, end?: Token): SdlSpan {
    const e = end ?? this.tokens[Math.max(0, this.pos - 1)] ?? start;
    return {
      startOffset: start.startOffset,
      endOffset: e.endOffset,
      line: start.line,
      column: start.column,
    };
  }

  /** Collects tokens until a terminator symbol (e.g. `;` or `,` or `)`) respecting parentheses. */
  readExprUntil(stopSymbols: Set<string>, stopKeywords?: Set<string>): string {
    const parts: string[] = [];
    let depth = 0;
    while (!this.atEof()) {
      const t = this.peek();
      if (depth === 0) {
        if (t.kind === "symbol" && stopSymbols.has(t.value)) break;
        if (stopKeywords && t.kind === "word" && stopKeywords.has(t.upper)) break;
      }
      if (t.kind === "symbol" && t.value === "(") depth++;
      else if (t.kind === "symbol" && t.value === ")") {
        if (depth === 0) break;
        depth--;
      }
      const consumed = this.next();
      parts.push(consumed.kind === "string" ? `'${consumed.value}'` : consumed.value);
    }
    return parts.join(" ").trim();
  }
}

function parseSignalList(c: SdlParserCursor): SdlSignalDecl[] {
  const start = c.next(); // SIGNAL
  const signals: SdlSignalDecl[] = [];
  while (!c.atEof() && !c.isSymbol(";")) {
    const nameTok = c.peek();
    if (nameTok.kind !== "word") {
      c.addError(nameTok, `Expected signal name, found '${nameTok.value}'`);
      break;
    }
    c.next();
    const sorts: string[] = [];
    if (c.matchSymbol("(")) {
      while (!c.atEof() && !c.isSymbol(")")) {
        const sortTok = c.next();
        if (sortTok.kind === "word") sorts.push(sortTok.value);
        c.matchSymbol(",");
      }
      c.matchSymbol(")");
    }
    signals.push({
      name: nameTok.value,
      parameterSorts: sorts,
      ...c.spanFrom(start, nameTok),
    });
    if (!c.matchSymbol(",")) break;
  }
  c.expectSemi();
  return signals;
}

function parseChannelPaths(c: SdlParserCursor, stopKeywords: Set<string>): SdlChannelPath[] {
  const paths: SdlChannelPath[] = [];
  while (!c.atEof()) {
    if (c.peek().kind === "word" && stopKeywords.has(c.peek().upper)) break;
    if (!c.matchKeyword("FROM")) break;
    const fromTok = c.next();
    c.matchKeyword("TO");
    const toTok = c.next();
    const signals: string[] = [];
    if (c.matchKeyword("WITH")) {
      while (!c.atEof() && !c.isSymbol(";")) {
        const sig = c.next();
        if (sig.kind === "word") signals.push(sig.value);
        if (!c.matchSymbol(",")) break;
      }
    }
    c.expectSemi();
    paths.push({ from: fromTok.value, to: toTok.value, signals });
  }
  return paths;
}

function parseChannel(c: SdlParserCursor): SdlChannelDecl {
  const start = c.next(); // CHANNEL
  const nameTok = c.peek().kind === "word" ? c.next() : start;
  let noDelay = false;
  if (c.matchKeyword("NODELAY")) {
    noDelay = true;
  }
  const paths = parseChannelPaths(c, new Set(["ENDCHANNEL", "BLOCK", "CHANNEL", "SIGNAL", "ENDSYSTEM"]));
  let endTok = nameTok;
  if (c.matchKeyword("ENDCHANNEL")) {
    if (c.peek().kind === "word" && !c.isSymbol(";")) endTok = c.next();
    c.expectSemi();
  } else {
    c.addError(c.peek(), `Expected ENDCHANNEL for channel '${nameTok.value}'`);
  }
  return {
    name: nameTok.value,
    noDelay,
    delaySeconds: noDelay ? 0 : 0.01,
    paths,
    ...c.spanFrom(start, endTok),
  };
}

function parseSignalRoute(c: SdlParserCursor): SdlSignalRouteDecl {
  const start = c.next(); // SIGNALROUTE
  const nameTok = c.peek().kind === "word" ? c.next() : start;
  const paths = parseChannelPaths(
    c,
    new Set(["ENDSIGNALROUTE", "SIGNALROUTE", "CONNECT", "PROCESS", "SIGNAL", "ENDBLOCK"]),
  );
  if (c.matchKeyword("ENDSIGNALROUTE")) {
    if (c.peek().kind === "word") c.next();
    c.expectSemi();
  }
  return {
    name: nameTok.value,
    paths,
    ...c.spanFrom(start),
  };
}

function parseConnect(c: SdlParserCursor): SdlConnectDecl {
  const start = c.next(); // CONNECT
  const chTok = c.next();
  c.matchKeyword("AND");
  const routes: string[] = [];
  while (!c.atEof() && !c.isSymbol(";")) {
    const r = c.next();
    if (r.kind === "word") routes.push(r.value);
    if (!c.matchSymbol(",")) break;
  }
  c.expectSemi();
  return {
    channel: chTok.value,
    signalRoutes: routes,
    ...c.spanFrom(start),
  };
}

function parseDcl(c: SdlParserCursor): SdlVarDecl[] {
  const start = c.next(); // DCL
  const vars: SdlVarDecl[] = [];
  while (!c.atEof() && !c.isSymbol(";")) {
    const names: Token[] = [];
    while (!c.atEof()) {
      const tok = c.peek();
      if (tok.kind !== "word") break;
      names.push(c.next());
      if (!c.matchSymbol(",")) break;
    }
    if (names.length === 0) break;
    // Last token in names may actually be the sort if there were no commas: DCL x Integer := 0;
    let sort = "Integer";
    let varNames = names;
    if (names.length >= 2 && !c.isSymbol(",") && !c.isSymbol(":=")) {
      // Wait: if we had `DCL x, y Integer;`, after y there is no comma, next token is Integer!
      const nextTok = c.peek();
      if (nextTok.kind === "word") {
        sort = c.next().value;
      } else {
        sort = names[names.length - 1]!.value;
        varNames = names.slice(0, -1);
      }
    } else if (c.peek().kind === "word") {
      sort = c.next().value;
    }
    let initialValue: string | undefined;
    if (c.matchSymbol(":=")) {
      initialValue = c.readExprUntil(new Set([";", ","]));
    }
    for (const nt of varNames) {
      vars.push({
        name: nt.value,
        sort,
        ...(initialValue !== undefined ? { initialValue } : {}),
        ...c.spanFrom(start, nt),
      });
    }
    if (!c.matchSymbol(",")) break;
  }
  c.expectSemi();
  return vars;
}

function parseTimer(c: SdlParserCursor): SdlTimerDecl[] {
  const start = c.next(); // TIMER
  const timers: SdlTimerDecl[] = [];
  while (!c.atEof() && !c.isSymbol(";")) {
    const nameTok = c.peek();
    if (nameTok.kind !== "word") break;
    c.next();
    const sorts: string[] = [];
    if (c.matchSymbol("(")) {
      while (!c.atEof() && !c.isSymbol(")")) {
        const s = c.next();
        if (s.kind === "word") sorts.push(s.value);
        c.matchSymbol(",");
      }
      c.matchSymbol(")");
    }
    let defaultDuration: number | undefined;
    if (c.matchSymbol(":=")) {
      const numStr = c.readExprUntil(new Set([";", ","]));
      const parsed = Number(numStr);
      if (!Number.isNaN(parsed)) defaultDuration = parsed;
    }
    timers.push({
      name: nameTok.value,
      parameterSorts: sorts,
      ...(defaultDuration !== undefined ? { defaultDuration } : {}),
      ...c.spanFrom(start, nameTok),
    });
    if (!c.matchSymbol(",")) break;
  }
  c.expectSemi();
  return timers;
}

function parseParenArgs(c: SdlParserCursor): string[] {
  const args: string[] = [];
  if (!c.matchSymbol("(")) return args;
  while (!c.atEof() && !c.isSymbol(")")) {
    const expr = c.readExprUntil(new Set([",", ")"]));
    if (expr.length > 0) args.push(expr);
    if (!c.matchSymbol(",")) break;
  }
  c.matchSymbol(")");
  return args;
}

const TRANSITION_STOP_KEYWORDS = new Set(["INPUT", "STATE", "ENDSTATE", "ENDPROCESS", "ENDDECISION", "ELSE", "START"]);

function parseTransition(c: SdlParserCursor, inDecisionBranch = false): SdlTransition {
  const start = c.peek();
  const actions: SdlAction[] = [];
  let terminator: SdlTerminator | undefined;

  while (!c.atEof()) {
    const t = c.peek();
    if (t.kind === "word" && TRANSITION_STOP_KEYWORDS.has(t.upper)) {
      break;
    }
    if (inDecisionBranch && t.kind === "symbol" && t.value === "(") {
      // Next decision branch `(cond):`
      break;
    }

    if (c.isKeyword("OUTPUT")) {
      const outStart = c.next();
      const sigTok = c.next();
      const args = parseParenArgs(c);
      let to: string | undefined;
      let via: string | undefined;
      while (!c.atEof() && !c.isSymbol(";")) {
        if (c.matchKeyword("TO")) {
          to = c.next().value;
        } else if (c.matchKeyword("VIA")) {
          via = c.next().value;
        } else {
          break;
        }
      }
      c.expectSemi();
      actions.push({
        kind: "output",
        signal: sigTok.value,
        args,
        ...(to !== undefined ? { to } : {}),
        ...(via !== undefined ? { via } : {}),
        span: c.spanFrom(outStart),
      });
      continue;
    }

    if (c.isKeyword("TASK")) {
      const taskStart = c.next();
      const rawText = c.readExprUntil(new Set([";"]));
      c.expectSemi();
      const assignments: Array<{ target: string; expression: string }> = [];
      for (const part of rawText.split(",")) {
        const trimmed = part.trim();
        const assignIdx = trimmed.indexOf(":=");
        if (assignIdx > 0) {
          assignments.push({
            target: trimmed.slice(0, assignIdx).trim(),
            expression: trimmed.slice(assignIdx + 2).trim(),
          });
        }
      }
      actions.push({
        kind: "task",
        assignments,
        rawText,
        span: c.spanFrom(taskStart),
      });
      continue;
    }

    if (c.isKeyword("SET")) {
      const setStart = c.next();
      const args = parseParenArgs(c);
      c.expectSemi();
      const durationExpr = args[0] ?? "NOW + 1.0";
      const timerRaw = args[1] ?? "";
      const timerName = timerRaw.split("(")[0]?.trim() ?? timerRaw;
      actions.push({
        kind: "set",
        durationExpr,
        timer: timerName,
        args: args.slice(2),
        span: c.spanFrom(setStart),
      });
      continue;
    }

    if (c.isKeyword("RESET")) {
      const resetStart = c.next();
      const args = parseParenArgs(c);
      c.expectSemi();
      const timerRaw = args[0] ?? "";
      const timerName = timerRaw.split("(")[0]?.trim() ?? timerRaw;
      actions.push({
        kind: "reset",
        timer: timerName,
        args: args.slice(1),
        span: c.spanFrom(resetStart),
      });
      continue;
    }

    if (c.isKeyword("DECISION")) {
      const decStart = c.next();
      const question = c.readExprUntil(new Set([";"]));
      c.expectSemi();
      const branches: SdlDecisionBranch[] = [];
      while (!c.atEof() && !c.isKeyword("ENDDECISION")) {
        const bStart = c.peek();
        if (c.matchKeyword("ELSE")) {
          c.matchSymbol(":");
          const body = parseTransition(c, true);
          branches.push({
            condition: "ELSE",
            isElse: true,
            actions: body.actions,
            ...(body.terminator !== undefined ? { terminator: body.terminator } : {}),
            span: c.spanFrom(bStart),
          });
        } else if (c.matchSymbol("(")) {
          const cond = c.readExprUntil(new Set([")"]));
          c.matchSymbol(")");
          c.matchSymbol(":");
          const body = parseTransition(c, true);
          branches.push({
            condition: cond,
            isElse: false,
            actions: body.actions,
            ...(body.terminator !== undefined ? { terminator: body.terminator } : {}),
            span: c.spanFrom(bStart),
          });
        } else {
          c.addError(c.peek(), `Unexpected token '${c.peek().value}' inside DECISION`);
          c.next();
        }
      }
      if (!c.matchKeyword("ENDDECISION")) {
        c.addError(c.peek(), "Missing ENDDECISION");
      }
      c.expectSemi();
      actions.push({
        kind: "decision",
        question,
        branches,
        span: c.spanFrom(decStart),
      });
      continue;
    }

    if (c.isKeyword("NEXTSTATE")) {
      const nsStart = c.next();
      const targetTok = c.next();
      c.expectSemi();
      terminator = {
        kind: "nextstate",
        targetState: targetTok.value,
        span: c.spanFrom(nsStart, targetTok),
      };
      break;
    }

    if (c.isKeyword("STOP")) {
      const stopStart = c.next();
      c.expectSemi();
      terminator = {
        kind: "stop",
        span: c.spanFrom(stopStart),
      };
      break;
    }

    if (c.matchSymbol(";")) continue;

    // Unexpected token in transition
    c.addError(t, `Unexpected token '${t.value}' in transition`);
    c.next();
  }

  return {
    actions,
    ...(terminator !== undefined ? { terminator } : {}),
    ...c.spanFrom(start),
  };
}

function parseState(c: SdlParserCursor): SdlStateDecl {
  const start = c.next(); // STATE
  const names: string[] = [];
  while (!c.atEof() && !c.isSymbol(";")) {
    const t = c.next();
    if (t.kind === "word" || t.value === "*") names.push(t.value);
    if (!c.matchSymbol(",")) break;
  }
  c.expectSemi();

  const inputs: SdlInputClause[] = [];
  while (!c.atEof() && !c.isKeyword("ENDSTATE") && !c.isKeyword("STATE") && !c.isKeyword("ENDPROCESS")) {
    if (c.isKeyword("INPUT")) {
      const inStart = c.next();
      const sigTok = c.next();
      const variables: string[] = [];
      if (c.matchSymbol("(")) {
        while (!c.atEof() && !c.isSymbol(")")) {
          const v = c.next();
          if (v.kind === "word") variables.push(v.value);
          if (!c.matchSymbol(",")) break;
        }
        c.matchSymbol(")");
      }
      c.expectSemi();
      const transition = parseTransition(c);
      inputs.push({
        signal: sigTok.value,
        variables,
        transition,
        ...c.spanFrom(inStart),
      });
    } else if (c.matchSymbol(";")) {
      continue;
    } else {
      c.addError(c.peek(), `Unexpected token '${c.peek().value}' inside STATE '${names.join(", ")}'`);
      c.next();
    }
  }

  if (c.matchKeyword("ENDSTATE")) {
    if (c.peek().kind === "word" && !c.isSymbol(";")) c.next();
    c.expectSemi();
  }

  return {
    names,
    inputs,
    ...c.spanFrom(start),
  };
}

function parseProcess(c: SdlParserCursor): SdlProcessDecl {
  const start = c.next(); // PROCESS
  const nameTok = c.peek().kind === "word" ? c.next() : start;
  let initialInstances = 1;
  let maxInstances: number | undefined;
  if (c.matchSymbol("(")) {
    const initStr = c.readExprUntil(new Set([",", ")"]));
    if (initStr.length > 0 && !Number.isNaN(Number(initStr))) {
      initialInstances = Number(initStr);
    }
    if (c.matchSymbol(",")) {
      const maxStr = c.readExprUntil(new Set([")"]));
      if (maxStr.length > 0 && !Number.isNaN(Number(maxStr))) {
        maxInstances = Number(maxStr);
      }
    }
    c.matchSymbol(")");
  }
  c.expectSemi();

  const variables: SdlVarDecl[] = [];
  const timers: SdlTimerDecl[] = [];
  let startTransition: SdlTransition | undefined;
  const states: SdlStateDecl[] = [];

  while (!c.atEof() && !c.isKeyword("ENDPROCESS") && !c.isKeyword("ENDBLOCK") && !c.isKeyword("ENDSYSTEM")) {
    if (c.isKeyword("DCL")) {
      variables.push(...parseDcl(c));
    } else if (c.isKeyword("TIMER")) {
      timers.push(...parseTimer(c));
    } else if (c.isKeyword("START")) {
      c.next();
      c.expectSemi();
      startTransition = parseTransition(c);
    } else if (c.isKeyword("STATE")) {
      states.push(parseState(c));
    } else if (c.matchSymbol(";")) {
      continue;
    } else {
      c.addError(c.peek(), `Unexpected token '${c.peek().value}' inside PROCESS '${nameTok.value}'`);
      c.next();
    }
  }

  let endTok = nameTok;
  if (c.matchKeyword("ENDPROCESS")) {
    if (c.peek().kind === "word" && !c.isSymbol(";")) endTok = c.next();
    c.expectSemi();
  } else {
    c.addError(c.peek(), `Missing ENDPROCESS for process '${nameTok.value}'`);
  }

  return {
    name: nameTok.value,
    initialInstances,
    ...(maxInstances !== undefined ? { maxInstances } : {}),
    variables,
    timers,
    ...(startTransition !== undefined ? { start: startTransition } : {}),
    states,
    ...c.spanFrom(start, endTok),
  };
}

function parseBlock(c: SdlParserCursor): SdlBlockDecl {
  const start = c.next(); // BLOCK
  const nameTok = c.peek().kind === "word" ? c.next() : start;
  c.expectSemi();

  const signals: SdlSignalDecl[] = [];
  const signalRoutes: SdlSignalRouteDecl[] = [];
  const connects: SdlConnectDecl[] = [];
  const processes: SdlProcessDecl[] = [];

  while (!c.atEof() && !c.isKeyword("ENDBLOCK") && !c.isKeyword("ENDSYSTEM")) {
    if (c.isKeyword("SIGNAL")) {
      signals.push(...parseSignalList(c));
    } else if (c.isKeyword("SIGNALROUTE")) {
      signalRoutes.push(parseSignalRoute(c));
    } else if (c.isKeyword("CONNECT")) {
      connects.push(parseConnect(c));
    } else if (c.isKeyword("PROCESS")) {
      processes.push(parseProcess(c));
    } else if (c.matchSymbol(";")) {
      continue;
    } else {
      c.addError(c.peek(), `Unexpected token '${c.peek().value}' inside BLOCK '${nameTok.value}'`);
      c.next();
    }
  }

  let endTok = nameTok;
  if (c.matchKeyword("ENDBLOCK")) {
    if (c.peek().kind === "word" && !c.isSymbol(";")) endTok = c.next();
    c.expectSemi();
  } else {
    c.addError(c.peek(), `Missing ENDBLOCK for block '${nameTok.value}'`);
  }

  return {
    name: nameTok.value,
    signals,
    signalRoutes,
    connects,
    processes,
    ...c.spanFrom(start, endTok),
  };
}

/**
 * Parses an ITU-T Z.100 SDL-88 Phrase Representation (`.sdl`, `.pr`) specification.
 */
export function parseSdl(source: string): SdlSystemModel {
  const { tokens, errors } = tokenizeSdl(source);
  const c = new SdlParserCursor(tokens, errors);

  const signals: SdlSignalDecl[] = [];
  const channels: SdlChannelDecl[] = [];
  const blocks: SdlBlockDecl[] = [];
  const extraSystems: Array<{ name: string; span: SdlSpan }> = [];

  let systemName = "UnnamedSystem";
  let systemStart = c.peek();
  let systemEnd = systemStart;
  let seenSystem = false;

  while (!c.atEof()) {
    if (c.isKeyword("SYSTEM")) {
      const start = c.next();
      const nameTok = c.peek().kind === "word" ? c.next() : start;
      c.expectSemi();
      if (!seenSystem) {
        seenSystem = true;
        systemName = nameTok.value;
        systemStart = start;
      } else {
        extraSystems.push({ name: nameTok.value, span: c.spanFrom(start, nameTok) });
      }

      while (!c.atEof() && !c.isKeyword("ENDSYSTEM")) {
        if (c.isKeyword("SIGNAL")) {
          signals.push(...parseSignalList(c));
        } else if (c.isKeyword("CHANNEL")) {
          channels.push(parseChannel(c));
        } else if (c.isKeyword("BLOCK")) {
          blocks.push(parseBlock(c));
        } else if (c.matchSymbol(";")) {
          continue;
        } else {
          c.addError(c.peek(), `Unexpected token '${c.peek().value}' inside SYSTEM '${nameTok.value}'`);
          c.next();
        }
      }

      if (c.matchKeyword("ENDSYSTEM")) {
        if (c.peek().kind === "word" && !c.isSymbol(";")) systemEnd = c.next();
        c.expectSemi();
      } else {
        c.addError(c.peek(), `Missing ENDSYSTEM for system '${nameTok.value}'`);
      }
    } else if (c.matchSymbol(";")) {
      continue;
    } else {
      c.addError(c.peek(), `Expected SYSTEM declaration, found '${c.peek().value}'`);
      c.next();
    }
  }

  return {
    name: systemName,
    span: c.spanFrom(systemStart, systemEnd),
    signals,
    channels,
    blocks,
    extraSystems,
    syntaxErrors: c.errors,
  };
}
