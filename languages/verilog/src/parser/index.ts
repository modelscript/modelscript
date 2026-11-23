// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE 1364 Verilog-1995/2001 Recursive-Descent Parser.
 *
 * Parses modules, ANSI & non-ANSI port declarations, wire/reg/integer/tri/parameter/localparam,
 * bit-vector ranges [msb:lsb], continuous assignments, always @(posedge/negedge/*), initial,
 * begin/end, if/else, case/casex/casez, blocking (=) & non-blocking (<=) assignments,
 * IEEE 1364 gate primitives, hierarchical module instantiations, sized literals (4'b1010, 8'hFF),
 * and // / /* *\/ comments.
 */

import { VerilogErrorCode } from "../errors.js";
import type {
  BitRange,
  NetKind,
  PortDirection,
  SensitivityItem,
  SourceSpan,
  VerilogAssignItem,
  VerilogDesign,
  VerilogDiagnostic,
  VerilogExpr,
  VerilogGateItem,
  VerilogGateType,
  VerilogModule,
  VerilogModuleInstItem,
  VerilogPortConnection,
  VerilogStmt,
} from "../types.js";

type TokenKind = "ident" | "number" | "string" | "op" | "punct" | "eof";

interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

const GATE_TYPES = new Set<string>([
  "and",
  "nand",
  "or",
  "nor",
  "xor",
  "xnor",
  "buf",
  "not",
  "bufif0",
  "bufif1",
  "notif0",
  "notif1",
]);

const MULTI_CHAR_OPS = [
  "===",
  "!==",
  "<<<",
  ">>>",
  "<=",
  ">=",
  "==",
  "!=",
  "&&",
  "||",
  "<<",
  ">>",
  "~&",
  "~|",
  "~^",
  "^~",
];

function tokenize(source: string, diagnostics: VerilogDiagnostic[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = source.length;

  const advance = (count: number = 1): void => {
    for (let k = 0; k < count; k++) {
      if (source[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  };

  while (i < n) {
    const ch = source[i]!;

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    // Line comment
    if (ch === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") advance();
      continue;
    }

    // Block comment
    if (ch === "/" && source[i + 1] === "*") {
      const startLine = line;
      const startCol = col;
      const startOff = i;
      advance(2);
      let closed = false;
      while (i < n) {
        if (source[i] === "*" && source[i + 1] === "/") {
          advance(2);
          closed = true;
          break;
        }
        advance();
      }
      if (!closed) {
        diagnostics.push({
          code: VerilogErrorCode.SYNTAX_ERROR.code,
          rule: VerilogErrorCode.SYNTAX_ERROR.rule,
          severity: "error",
          message: VerilogErrorCode.SYNTAX_ERROR.message("unterminated block comment"),
          line: startLine,
          column: startCol,
          startOffset: startOff,
          endOffset: i,
        });
      }
      continue;
    }

    // Compiler directive (e.g., `timescale 1ns/1ps) — skip to end of line
    if (ch === "`") {
      while (i < n && source[i] !== "\n") advance();
      continue;
    }

    const startLine = line;
    const startCol = col;
    const startOff = i;

    // String literal
    if (ch === '"') {
      advance();
      let val = "";
      while (i < n && source[i] !== '"') {
        if (source[i] === "\\" && i + 1 < n) {
          val += source[i + 1]!;
          advance(2);
        } else {
          val += source[i]!;
          advance();
        }
      }
      if (i < n && source[i] === '"') advance();
      tokens.push({
        kind: "string",
        value: val,
        line: startLine,
        column: startCol,
        startOffset: startOff,
        endOffset: i,
      });
      continue;
    }

    // Sized or unsized numeric literal (e.g., 4'b1010, 8'hFF, 'd12, 42, 4'sb1010)
    if ((ch >= "0" && ch <= "9") || (ch === "'" && i + 1 < n && /[sSbBoOdDhH]/.test(source[i + 1]!))) {
      let raw = "";
      if (ch >= "0" && ch <= "9") {
        while (i < n && ((source[i]! >= "0" && source[i]! <= "9") || source[i] === "_")) {
          raw += source[i]!;
          advance();
        }
      }
      if (i < n && source[i] === "'") {
        raw += "'";
        advance();
        if (i < n && (source[i] === "s" || source[i] === "S")) {
          raw += source[i]!;
          advance();
        }
        if (i < n && /[bBoOdDhH]/.test(source[i]!)) {
          raw += source[i]!;
          advance();
          while (i < n && /[0-9a-fA-FxXzZ?_]/.test(source[i]!)) {
            raw += source[i]!;
            advance();
          }
        }
      }
      tokens.push({
        kind: "number",
        value: raw,
        line: startLine,
        column: startCol,
        startOffset: startOff,
        endOffset: i,
      });
      continue;
    }

    // Identifier or keyword (also allow $system_task)
    if (/[A-Za-z_$]/.test(ch)) {
      let ident = "";
      while (i < n && /[A-Za-z0-9_$]/.test(source[i]!)) {
        ident += source[i]!;
        advance();
      }
      tokens.push({
        kind: "ident",
        value: ident,
        line: startLine,
        column: startCol,
        startOffset: startOff,
        endOffset: i,
      });
      continue;
    }

    // Multi-char operators
    let matchedOp = false;
    for (const op of MULTI_CHAR_OPS) {
      if (source.startsWith(op, i)) {
        advance(op.length);
        tokens.push({ kind: "op", value: op, line: startLine, column: startCol, startOffset: startOff, endOffset: i });
        matchedOp = true;
        break;
      }
    }
    if (matchedOp) continue;

    // Single-char operators & punctuation
    if ("+-*/%&|^~!<>?=".includes(ch)) {
      advance();
      tokens.push({ kind: "op", value: ch, line: startLine, column: startCol, startOffset: startOff, endOffset: i });
      continue;
    }
    if ("()[],;:@#.{}".includes(ch)) {
      advance();
      tokens.push({ kind: "punct", value: ch, line: startLine, column: startCol, startOffset: startOff, endOffset: i });
      continue;
    }

    // Unknown character
    diagnostics.push({
      code: VerilogErrorCode.SYNTAX_ERROR.code,
      rule: VerilogErrorCode.SYNTAX_ERROR.rule,
      severity: "error",
      message: VerilogErrorCode.SYNTAX_ERROR.message(`unexpected character '${ch}'`),
      line: startLine,
      column: startCol,
      startOffset: startOff,
      endOffset: startOff + 1,
    });
    advance();
  }

  tokens.push({ kind: "eof", value: "", line, column: col, startOffset: n, endOffset: n });
  return tokens;
}

function tokenSpan(tok: Token): SourceSpan {
  return {
    line: tok.line,
    column: tok.column,
    startOffset: tok.startOffset,
    endOffset: tok.endOffset,
  };
}

function parseNumericLiteral(tok: Token): VerilogExpr {
  const raw = tok.value;
  const tickIdx = raw.indexOf("'");
  if (tickIdx === -1) {
    const clean = raw.replace(/_/g, "");
    const num = Number.parseInt(clean, 10);
    return {
      kind: "number",
      raw,
      base: "d",
      digits: clean,
      numericValue: Number.isFinite(num) ? num : undefined,
      span: tokenSpan(tok),
    };
  }
  const widthStr = raw.slice(0, tickIdx).replace(/_/g, "");
  const width = widthStr.length > 0 ? Number.parseInt(widthStr, 10) : undefined;
  let rest = raw.slice(tickIdx + 1);
  let signed = false;
  if (rest.startsWith("s") || rest.startsWith("S")) {
    signed = true;
    rest = rest.slice(1);
  }
  const baseChar = (rest[0] ?? "d").toLowerCase() as "b" | "o" | "d" | "h";
  const digits = rest.slice(1).replace(/_/g, "");
  let numericValue: number | undefined;
  if (!/[xXzZ?]/.test(digits) && digits.length > 0) {
    const radix = baseChar === "b" ? 2 : baseChar === "o" ? 8 : baseChar === "h" ? 16 : 10;
    const parsed = Number.parseInt(digits, radix);
    if (Number.isFinite(parsed)) numericValue = parsed;
  }
  return {
    kind: "number",
    raw,
    width,
    base: baseChar,
    signed,
    digits,
    numericValue,
    span: tokenSpan(tok),
  };
}

class VerilogParser {
  private readonly tokens: Token[];
  private pos = 0;
  private readonly diagnostics: VerilogDiagnostic[];

  constructor(tokens: Token[], diagnostics: VerilogDiagnostic[]) {
    this.tokens = tokens;
    this.diagnostics = diagnostics;
  }

  private peek(offset: number = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private advance(): Token {
    const tok = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  private is(value: string, offset: number = 0): boolean {
    return this.peek(offset).value === value;
  }

  private match(value: string): boolean {
    if (this.is(value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(value: string, context: string): Token {
    const tok = this.peek();
    if (tok.value === value) return this.advance();
    this.error(tok, `expected '${value}' ${context}, found '${tok.value || "EOF"}'`);
    return tok;
  }

  private error(tok: Token, detail: string): void {
    this.diagnostics.push({
      code: VerilogErrorCode.SYNTAX_ERROR.code,
      rule: VerilogErrorCode.SYNTAX_ERROR.rule,
      severity: "error",
      message: VerilogErrorCode.SYNTAX_ERROR.message(detail),
      line: tok.line,
      column: tok.column,
      startOffset: tok.startOffset,
      endOffset: tok.endOffset,
    });
  }

  parseDesign(): VerilogModule[] {
    const modules: VerilogModule[] = [];
    while (this.peek().kind !== "eof") {
      if (this.is("module") || this.is("macromodule")) {
        modules.push(this.parseModule());
      } else {
        this.error(this.peek(), `unexpected token '${this.peek().value}' at top level`);
        this.advance();
      }
    }
    return modules;
  }

  private parseModule(): VerilogModule {
    const startTok = this.advance(); // module
    const nameTok = this.peek();
    const name = nameTok.kind === "ident" ? this.advance().value : "unnamed_module";
    if (nameTok.kind !== "ident") {
      this.error(nameTok, "expected module identifier");
    }

    const mod: VerilogModule = {
      name,
      portOrder: [],
      ports: new Map(),
      nets: new Map(),
      parameters: new Map(),
      items: [],
      duplicateDecls: [],
      span: tokenSpan(startTok),
    };

    // Optional ANSI parameter port list: #(parameter WIDTH = 8, ...)
    if (this.is("#") && this.is("(", 1)) {
      this.advance(); // #
      this.advance(); // (
      while (!this.is(")") && this.peek().kind !== "eof") {
        this.match("parameter");
        this.match("localparam");
        this.match("integer");
        this.match("signed");
        const range = this.is("[") ? this.parseBitRange(mod) : undefined;
        const pNameTok = this.advance();
        this.expect("=", "in parameter declaration");
        const val = this.parseExpr();
        if (mod.parameters.has(pNameTok.value)) {
          mod.duplicateDecls.push({ name: pNameTok.value, kind: "parameter", span: tokenSpan(pNameTok) });
        } else {
          mod.parameters.set(pNameTok.value, {
            name: pNameTok.value,
            isLocal: false,
            range,
            value: val,
            span: tokenSpan(pNameTok),
          });
        }
        if (!this.match(",")) break;
      }
      this.expect(")", "closing module parameter list");
    }

    // Optional port list: (a, b, c) or (input wire [3:0] a, output reg y)
    if (this.match("(")) {
      let lastDir: PortDirection | undefined;
      let lastNetKind: NetKind | undefined;
      let lastSigned = false;
      let lastRange: BitRange | undefined;

      while (!this.is(")") && this.peek().kind !== "eof") {
        if (this.is("input") || this.is("output") || this.is("inout")) {
          const dir = this.advance().value as PortDirection;
          let netKind: NetKind | undefined;
          if (this.is("wire") || this.is("reg") || this.is("tri") || this.is("integer")) {
            netKind = this.advance().value as NetKind;
          }
          const signed = this.match("signed");
          const range = this.is("[") ? this.parseBitRange(mod) : undefined;
          const pTok = this.advance();
          lastDir = dir;
          lastNetKind = netKind;
          lastSigned = signed;
          lastRange = range;
          this.registerPort(mod, pTok.value, dir, netKind, signed, range, tokenSpan(pTok));
        } else if (lastDir !== undefined && this.peek().kind === "ident") {
          const pTok = this.advance();
          this.registerPort(mod, pTok.value, lastDir, lastNetKind, lastSigned, lastRange, tokenSpan(pTok));
        } else if (this.peek().kind === "ident") {
          const pTok = this.advance();
          if (mod.portOrder.includes(pTok.value)) {
            mod.duplicateDecls.push({ name: pTok.value, kind: "port", span: tokenSpan(pTok) });
          } else {
            mod.portOrder.push(pTok.value);
          }
        } else {
          this.error(this.peek(), `unexpected token '${this.peek().value}' in port list`);
          this.advance();
        }
        if (!this.match(",")) break;
      }
      this.expect(")", "closing module port list");
    }

    this.expect(";", "after module header");

    // Module body
    while (!this.is("endmodule") && this.peek().kind !== "eof") {
      if (this.is("input") || this.is("output") || this.is("inout")) {
        this.parsePortDeclStmt(mod);
      } else if (this.is("wire") || this.is("reg") || this.is("tri") || this.is("integer")) {
        this.parseNetDeclStmt(mod);
      } else if (this.is("parameter") || this.is("localparam")) {
        this.parseParamDeclStmt(mod);
      } else if (this.is("assign")) {
        mod.items.push(this.parseAssignStmt());
      } else if (this.is("always")) {
        mod.items.push(this.parseAlwaysBlock());
      } else if (this.is("initial")) {
        mod.items.push(this.parseInitialBlock());
      } else if (GATE_TYPES.has(this.peek().value)) {
        mod.items.push(this.parseGateInst());
      } else if (this.peek().kind === "ident") {
        mod.items.push(this.parseModuleInst());
      } else if (this.match(";")) {
        // empty item
      } else {
        this.error(this.peek(), `unexpected token '${this.peek().value}' in module '${mod.name}'`);
        this.advance();
      }
    }

    const endTok = this.expect("endmodule", `closing module '${mod.name}'`);
    mod.span.endOffset = endTok.endOffset;
    return mod;
  }

  private registerPort(
    mod: VerilogModule,
    name: string,
    direction: PortDirection,
    netKind: NetKind | undefined,
    signed: boolean,
    range: BitRange | undefined,
    span: SourceSpan,
  ): void {
    if (mod.ports.has(name)) {
      mod.duplicateDecls.push({ name, kind: "port", span });
      return;
    }
    if (!mod.portOrder.includes(name)) {
      mod.portOrder.push(name);
    }
    mod.ports.set(name, { name, direction, netKind, signed, range, span });
    if (netKind && !mod.nets.has(name)) {
      mod.nets.set(name, { name, kind: netKind, signed, range, span });
    }
  }

  private parsePortDeclStmt(mod: VerilogModule): void {
    const dir = this.advance().value as PortDirection;
    let netKind: NetKind | undefined;
    if (this.is("wire") || this.is("reg") || this.is("tri") || this.is("integer")) {
      netKind = this.advance().value as NetKind;
    }
    const signed = this.match("signed");
    const range = this.is("[") ? this.parseBitRange(mod) : undefined;
    while (this.peek().kind === "ident") {
      const pTok = this.advance();
      this.registerPort(mod, pTok.value, dir, netKind, signed, range, tokenSpan(pTok));
      if (!this.match(",")) break;
    }
    this.expect(";", "after port declaration");
  }

  private parseNetDeclStmt(mod: VerilogModule): void {
    const kind = this.advance().value as NetKind;
    const signed = this.match("signed");
    const range = this.is("[") ? this.parseBitRange(mod) : kind === "integer" ? { msb: 31, lsb: 0 } : undefined;
    while (this.peek().kind === "ident") {
      const nTok = this.advance();
      const arraySize = this.is("[") ? this.parseBitRange(mod) : undefined;
      let initialValue: VerilogExpr | undefined;
      if (this.match("=")) {
        initialValue = this.parseExpr();
      }
      if (mod.nets.has(nTok.value)) {
        mod.duplicateDecls.push({ name: nTok.value, kind: "net", span: tokenSpan(nTok) });
      } else {
        mod.nets.set(nTok.value, {
          name: nTok.value,
          kind,
          signed,
          range,
          arraySize,
          initialValue,
          span: tokenSpan(nTok),
        });
        // Update port metadata if this net declaration refines a non-ANSI port
        const existingPort = mod.ports.get(nTok.value);
        if (existingPort) {
          existingPort.netKind = kind;
          if (!existingPort.range && range) existingPort.range = range;
        }
      }
      if (!this.match(",")) break;
    }
    this.expect(";", "after net/variable declaration");
  }

  private parseParamDeclStmt(mod: VerilogModule): void {
    const isLocal = this.advance().value === "localparam";
    this.match("integer");
    this.match("signed");
    const range = this.is("[") ? this.parseBitRange(mod) : undefined;
    while (this.peek().kind === "ident") {
      const pTok = this.advance();
      this.expect("=", "in parameter declaration");
      const value = this.parseExpr();
      if (mod.parameters.has(pTok.value)) {
        mod.duplicateDecls.push({ name: pTok.value, kind: "parameter", span: tokenSpan(pTok) });
      } else {
        mod.parameters.set(pTok.value, {
          name: pTok.value,
          isLocal,
          range,
          value,
          span: tokenSpan(pTok),
        });
      }
      if (!this.match(",")) break;
    }
    this.expect(";", "after parameter declaration");
  }

  private evalConstExpr(expr: VerilogExpr, mod: VerilogModule): number {
    if (expr.kind === "number" && expr.numericValue !== undefined) return expr.numericValue;
    if (expr.kind === "identifier") {
      const p = mod.parameters.get(expr.name);
      if (p) return this.evalConstExpr(p.value, mod);
      return 0;
    }
    if (expr.kind === "unary") {
      const v = this.evalConstExpr(expr.operand, mod);
      return expr.op === "-" ? -v : v;
    }
    if (expr.kind === "binary") {
      const l = this.evalConstExpr(expr.left, mod);
      const r = this.evalConstExpr(expr.right, mod);
      if (expr.op === "+") return l + r;
      if (expr.op === "-") return l - r;
      if (expr.op === "*") return l * r;
      if (expr.op === "/" && r !== 0) return Math.trunc(l / r);
    }
    return 0;
  }

  private parseBitRange(mod: VerilogModule): BitRange {
    this.expect("[", "starting bit range");
    const msbExpr = this.parseExpr();
    this.expect(":", "in bit range");
    const lsbExpr = this.parseExpr();
    this.expect("]", "closing bit range");
    return {
      msb: this.evalConstExpr(msbExpr, mod),
      lsb: this.evalConstExpr(lsbExpr, mod),
    };
  }

  private parseAssignStmt(): VerilogAssignItem {
    const startTok = this.advance(); // assign
    let delay: number | undefined;
    if (this.match("#")) {
      const dTok = this.advance();
      delay = Number.parseFloat(dTok.value);
    }
    const lhs = this.parseExpr();
    this.expect("=", "in continuous assignment");
    const rhs = this.parseExpr();
    const endTok = this.expect(";", "after continuous assignment");
    return {
      kind: "assign",
      lhs,
      rhs,
      delay,
      span: { ...tokenSpan(startTok), endOffset: endTok.endOffset },
    };
  }

  private parseAlwaysBlock(): { kind: "always"; sensitivity: SensitivityItem[]; body: VerilogStmt; span: SourceSpan } {
    const startTok = this.advance(); // always
    const sensitivity: SensitivityItem[] = [];
    if (this.match("@")) {
      if (this.match("*")) {
        sensitivity.push({ kind: "wildcard" });
      } else if (this.match("(")) {
        if (this.match("*")) {
          sensitivity.push({ kind: "wildcard" });
        } else {
          while (!this.is(")") && this.peek().kind !== "eof") {
            if (this.is("posedge") || this.is("negedge")) {
              const edgeTok = this.advance();
              const sigTok = this.advance();
              sensitivity.push({
                kind: edgeTok.value as "posedge" | "negedge",
                signal: sigTok.value,
                span: tokenSpan(sigTok),
              });
            } else if (this.peek().kind === "ident") {
              const sigTok = this.advance();
              sensitivity.push({ kind: "signal", signal: sigTok.value, span: tokenSpan(sigTok) });
            } else {
              this.advance();
            }
            if (!this.match("or") && !this.match(",")) {
              if (!this.is(")")) break;
            }
          }
        }
        this.expect(")", "closing sensitivity list");
      }
    }
    const body = this.parseStmt();
    return {
      kind: "always",
      sensitivity,
      body,
      span: { ...tokenSpan(startTok), endOffset: body.span.endOffset },
    };
  }

  private parseInitialBlock(): { kind: "initial"; body: VerilogStmt; span: SourceSpan } {
    const startTok = this.advance(); // initial
    const body = this.parseStmt();
    return {
      kind: "initial",
      body,
      span: { ...tokenSpan(startTok), endOffset: body.span.endOffset },
    };
  }

  private parseStmt(): VerilogStmt {
    const tok = this.peek();

    if (this.match(";")) {
      return { kind: "empty", span: tokenSpan(tok) };
    }

    if (this.match("begin")) {
      let label: string | undefined;
      if (this.match(":")) {
        label = this.advance().value;
      }
      const statements: VerilogStmt[] = [];
      while (!this.is("end") && this.peek().kind !== "eof") {
        statements.push(this.parseStmt());
      }
      const endTok = this.expect("end", "closing begin block");
      return {
        kind: "block",
        label,
        statements,
        span: { ...tokenSpan(tok), endOffset: endTok.endOffset },
      };
    }

    if (this.match("if")) {
      this.expect("(", "after if");
      const condition = this.parseExpr();
      this.expect(")", "closing if condition");
      const consequent = this.parseStmt();
      let alternate: VerilogStmt | undefined;
      if (this.match("else")) {
        alternate = this.parseStmt();
      }
      return {
        kind: "if",
        condition,
        consequent,
        alternate,
        span: { ...tokenSpan(tok), endOffset: (alternate ?? consequent).span.endOffset },
      };
    }

    if (this.is("case") || this.is("casex") || this.is("casez")) {
      const variant = this.advance().value as "case" | "casex" | "casez";
      this.expect("(", `after ${variant}`);
      const expression = this.parseExpr();
      this.expect(")", `closing ${variant} expression`);
      const items: Array<{ patterns: VerilogExpr[]; isDefault: boolean; statement: VerilogStmt; span: SourceSpan }> =
        [];
      while (!this.is("endcase") && this.peek().kind !== "eof") {
        const itemTok = this.peek();
        if (this.match("default")) {
          this.match(":");
          const statement = this.parseStmt();
          items.push({ patterns: [], isDefault: true, statement, span: tokenSpan(itemTok) });
        } else {
          const patterns: VerilogExpr[] = [this.parseExpr()];
          while (this.match(",")) {
            patterns.push(this.parseExpr());
          }
          this.expect(":", "after case pattern");
          const statement = this.parseStmt();
          items.push({ patterns, isDefault: false, statement, span: tokenSpan(itemTok) });
        }
      }
      const endTok = this.expect("endcase", `closing ${variant}`);
      return {
        kind: "case",
        variant,
        expression,
        items,
        span: { ...tokenSpan(tok), endOffset: endTok.endOffset },
      };
    }

    // System task call (e.g. $display(...); $finish;) — parse and ignore as empty stmt
    if (tok.kind === "ident" && tok.value.startsWith("$")) {
      this.advance();
      if (this.match("(")) {
        let depth = 1;
        while (depth > 0 && this.peek().kind !== "eof") {
          if (this.is("(")) depth++;
          else if (this.is(")")) depth--;
          this.advance();
        }
      }
      const endTok = this.expect(";", "after system task");
      return { kind: "empty", span: { ...tokenSpan(tok), endOffset: endTok.endOffset } };
    }

    // Procedural assignment: lhs = rhs; or lhs <= rhs;
    const lhs = this.parseLValue();
    if (this.match("<=")) {
      const rhs = this.parseExpr();
      const endTok = this.expect(";", "after non-blocking assignment");
      return {
        kind: "nonblocking_assign",
        lhs,
        rhs,
        span: { ...tokenSpan(tok), endOffset: endTok.endOffset },
      };
    }
    if (this.match("=")) {
      const rhs = this.parseExpr();
      const endTok = this.expect(";", "after blocking assignment");
      return {
        kind: "blocking_assign",
        lhs,
        rhs,
        span: { ...tokenSpan(tok), endOffset: endTok.endOffset },
      };
    }

    this.error(this.peek(), `expected '=' or '<=' in procedural statement, found '${this.peek().value}'`);
    while (!this.is(";") && !this.is("end") && this.peek().kind !== "eof") this.advance();
    this.match(";");
    return { kind: "empty", span: tokenSpan(tok) };
  }

  private parseGateInst(): VerilogGateItem {
    const gateTok = this.advance();
    const gateType = gateTok.value as VerilogGateType;
    let delay: number | undefined;
    if (this.match("#")) {
      if (this.match("(")) {
        const dTok = this.advance();
        delay = Number.parseFloat(dTok.value);
        while (!this.is(")") && this.peek().kind !== "eof") this.advance();
        this.expect(")", "closing gate delay");
      } else {
        const dTok = this.advance();
        delay = Number.parseFloat(dTok.value);
      }
    }
    let instanceName: string | undefined;
    if (this.peek().kind === "ident") {
      instanceName = this.advance().value;
    }
    this.expect("(", "opening gate port list");
    const ports: VerilogExpr[] = [];
    while (!this.is(")") && this.peek().kind !== "eof") {
      ports.push(this.parseExpr());
      if (!this.match(",")) break;
    }
    this.expect(")", "closing gate port list");
    const endTok = this.expect(";", "after gate instantiation");
    return {
      kind: "gate",
      gateType,
      instanceName,
      delay,
      ports,
      span: { ...tokenSpan(gateTok), endOffset: endTok.endOffset },
    };
  }

  private parseModuleInst(): VerilogModuleInstItem {
    const typeTok = this.advance();
    const paramOverrides: Array<{ name?: string | undefined; expr: VerilogExpr }> = [];
    if (this.match("#")) {
      this.expect("(", "opening parameter override list");
      while (!this.is(")") && this.peek().kind !== "eof") {
        if (this.match(".")) {
          const pName = this.advance().value;
          this.expect("(", "opening named parameter override");
          const expr = this.parseExpr();
          this.expect(")", "closing named parameter override");
          paramOverrides.push({ name: pName, expr });
        } else {
          paramOverrides.push({ expr: this.parseExpr() });
        }
        if (!this.match(",")) break;
      }
      this.expect(")", "closing parameter override list");
    }

    const instTok = this.peek().kind === "ident" ? this.advance() : typeTok;
    this.expect("(", `opening port connections for instance '${instTok.value}'`);
    const connections: VerilogPortConnection[] = [];
    while (!this.is(")") && this.peek().kind !== "eof") {
      const cTok = this.peek();
      if (this.match(".")) {
        const portName = this.advance().value;
        this.expect("(", `opening named port connection '.${portName}'`);
        const expr = this.parseExpr();
        this.expect(")", `closing named port connection '.${portName}'`);
        connections.push({ portName, expr, span: tokenSpan(cTok) });
      } else {
        const expr = this.parseExpr();
        connections.push({ expr, span: tokenSpan(cTok) });
      }
      if (!this.match(",")) break;
    }
    this.expect(")", `closing port connections for instance '${instTok.value}'`);
    const endTok = this.expect(";", `after module instantiation '${instTok.value}'`);
    return {
      kind: "instantiation",
      moduleType: typeTok.value,
      instanceName: instTok.value,
      paramOverrides,
      connections,
      span: { ...tokenSpan(typeTok), endOffset: endTok.endOffset },
    };
  }

  private parseLValue(): VerilogExpr {
    if (this.is("{")) return this.parseConcatOrReplicate();
    return this.parsePostfix();
  }

  private parseExpr(): VerilogExpr {
    return this.parseTernary();
  }

  private parseTernary(): VerilogExpr {
    const cond = this.parseLogicalOr();
    if (this.match("?")) {
      const consequent = this.parseExpr();
      this.expect(":", "in ternary expression");
      const alternate = this.parseExpr();
      return {
        kind: "ternary",
        condition: cond,
        consequent,
        alternate,
        span: { ...cond.span, endOffset: alternate.span.endOffset },
      };
    }
    return cond;
  }

  private parseLogicalOr(): VerilogExpr {
    let left = this.parseLogicalAnd();
    while (this.match("||")) {
      const right = this.parseLogicalAnd();
      left = { kind: "binary", op: "||", left, right, span: { ...left.span, endOffset: right.span.endOffset } };
    }
    return left;
  }

  private parseLogicalAnd(): VerilogExpr {
    let left = this.parseBitwiseOr();
    while (this.match("&&")) {
      const right = this.parseBitwiseOr();
      left = { kind: "binary", op: "&&", left, right, span: { ...left.span, endOffset: right.span.endOffset } };
    }
    return left;
  }

  private parseBitwiseOr(): VerilogExpr {
    let left = this.parseBitwiseXor();
    while (this.match("|")) {
      const right = this.parseBitwiseXor();
      left = { kind: "binary", op: "|", left, right, span: { ...left.span, endOffset: right.span.endOffset } };
    }
    return left;
  }

  private parseBitwiseXor(): VerilogExpr {
    let left = this.parseBitwiseAnd();
    while (this.is("^") || this.is("~^") || this.is("^~")) {
      const op = this.advance().value as "^" | "~^" | "^~";
      const right = this.parseBitwiseAnd();
      left = { kind: "binary", op, left, right, span: { ...left.span, endOffset: right.span.endOffset } };
    }
    return left;
  }

  private parseBitwiseAnd(): VerilogExpr {
    let left = this.parseEquality();
    while (this.match("&")) {
      const right = this.parseEquality();
      left = { kind: "binary", op: "&", left, right, span: { ...left.span, endOffset: right.span.endOffset } };
    }
    return left;
  }

  private parseEquality(): VerilogExpr {
    let left = this.parseRelational();
    while (this.is("==") || this.is("!=") || this.is("===") || this.is("!==")) {
      const op = this.advance().value as "==" | "!=" | "===" | "!==";
      const right = this.parseRelational();
      left = { kind: "binary", op, left, right, span: { ...left.span, endOffset: right.span.endOffset } };
    }
    return left;
  }

  private parseRelational(): VerilogExpr {
    let left = this.parseShift();
    while (this.is("<") || this.is("<=") || this.is(">") || this.is(">=")) {
      const op = this.advance().value as "<" | "<=" | ">" | ">=";
      const right = this.parseShift();
      left = { kind: "binary", op, left, right, span: { ...left.span, endOffset: right.span.endOffset } };
    }
    return left;
  }

  private parseShift(): VerilogExpr {
    let left = this.parseAdditive();
    while (this.is("<<") || this.is(">>") || this.is("<<<") || this.is(">>>")) {
      const op = this.advance().value as "<<" | ">>" | "<<<" | ">>>";
      const right = this.parseAdditive();
      left = { kind: "binary", op, left, right, span: { ...left.span, endOffset: right.span.endOffset } };
    }
    return left;
  }

  private parseAdditive(): VerilogExpr {
    let left = this.parseMultiplicative();
    while (this.is("+") || this.is("-")) {
      const op = this.advance().value as "+" | "-";
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right, span: { ...left.span, endOffset: right.span.endOffset } };
    }
    return left;
  }

  private parseMultiplicative(): VerilogExpr {
    let left = this.parseUnary();
    while (this.is("*") || this.is("/") || this.is("%")) {
      const op = this.advance().value as "*" | "/" | "%";
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right, span: { ...left.span, endOffset: right.span.endOffset } };
    }
    return left;
  }

  private parseUnary(): VerilogExpr {
    const tok = this.peek();
    if (
      tok.kind === "op" &&
      (tok.value === "+" ||
        tok.value === "-" ||
        tok.value === "!" ||
        tok.value === "~" ||
        tok.value === "&" ||
        tok.value === "~&" ||
        tok.value === "|" ||
        tok.value === "~|" ||
        tok.value === "^" ||
        tok.value === "~^" ||
        tok.value === "^~")
    ) {
      const op = this.advance().value as "+" | "-" | "!" | "~" | "&" | "~&" | "|" | "~|" | "^" | "~^" | "^~";
      const operand = this.parseUnary();
      return { kind: "unary", op, operand, span: { ...tokenSpan(tok), endOffset: operand.span.endOffset } };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): VerilogExpr {
    let expr = this.parsePrimary();
    while (this.match("[")) {
      const first = this.parseExpr();
      if (this.match(":")) {
        const second = this.parseExpr();
        const endTok = this.expect("]", "closing bit slice");
        expr = {
          kind: "slice",
          target: expr,
          msb: first,
          lsb: second,
          span: { ...expr.span, endOffset: endTok.endOffset },
        };
      } else {
        const endTok = this.expect("]", "closing bit index");
        expr = {
          kind: "index",
          target: expr,
          index: first,
          span: { ...expr.span, endOffset: endTok.endOffset },
        };
      }
    }
    return expr;
  }

  private parseConcatOrReplicate(): VerilogExpr {
    const startTok = this.expect("{", "starting concatenation");
    const first = this.parseExpr();
    if (this.match("{")) {
      // Replication: {count{e1, e2, ...}}
      const elements: VerilogExpr[] = [this.parseExpr()];
      while (this.match(",")) {
        elements.push(this.parseExpr());
      }
      this.expect("}", "closing inner replication brace");
      const endTok = this.expect("}", "closing outer replication brace");
      return {
        kind: "replicate",
        count: first,
        elements,
        span: { ...tokenSpan(startTok), endOffset: endTok.endOffset },
      };
    }
    const elements: VerilogExpr[] = [first];
    while (this.match(",")) {
      elements.push(this.parseExpr());
    }
    const endTok = this.expect("}", "closing concatenation");
    return {
      kind: "concat",
      elements,
      span: { ...tokenSpan(startTok), endOffset: endTok.endOffset },
    };
  }

  private parsePrimary(): VerilogExpr {
    const tok = this.peek();

    if (tok.kind === "number") {
      this.advance();
      return parseNumericLiteral(tok);
    }

    if (tok.kind === "ident") {
      this.advance();
      return { kind: "identifier", name: tok.value, span: tokenSpan(tok) };
    }

    if (this.match("(")) {
      const inner = this.parseExpr();
      this.expect(")", "closing parenthesized expression");
      return inner;
    }

    if (this.is("{")) {
      return this.parseConcatOrReplicate();
    }

    this.error(tok, `unexpected token '${tok.value || "EOF"}' in expression`);
    this.advance();
    return {
      kind: "number",
      raw: "1'bx",
      width: 1,
      base: "b",
      digits: "x",
      span: tokenSpan(tok),
    };
  }
}

/**
 * Parses IEEE 1364 Verilog source text into a structured `VerilogDesign`.
 */
export function parseVerilog(source: string): VerilogDesign {
  const syntaxErrors: VerilogDiagnostic[] = [];
  const tokens = tokenize(source, syntaxErrors);
  const parser = new VerilogParser(tokens, syntaxErrors);
  const modules = parser.parseDesign();
  return { modules, syntaxErrors, sourceText: source };
}
