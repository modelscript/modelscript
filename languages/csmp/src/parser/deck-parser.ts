// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Recursive-descent parser for IBM System/360 CSMP & SCi CSSL-67 decks.
 *
 * Handles continuation lines (`...`), `*` comment cards, structural sections
 * (`INITIAL`, `DYNAMIC`, `TERMINAL`), `SORT`/`NOSORT` blocks, `PARAM`/`CONST`/`INCON`/`FIXED`,
 * `FUNCTION` tables, `MACRO`/`ENDMAC`, `PROCEDURE`/`ENDPRO`, `TIMER`, `METHOD`,
 * `PRINT`, `PRTPLT`, `END`, `STOP`, and full arithmetic/block expressions.
 */

import { CsmpErrorCode } from "../errors.js";
import type {
  CsmpAssignment,
  CsmpDataDecl,
  CsmpExpr,
  CsmpFunctionTable,
  CsmpMacroDef,
  CsmpParseError,
  CsmpProcedureDef,
  CsmpProgram,
  CsmpSectionKind,
  CsmpSortMode,
  CsmpSpan,
  CsmpTimerConfig,
} from "../types.js";

// ---------------------------------------------------------------------------
// Expression Tokenizer & Pratt/Recursive-Descent Parser
// ---------------------------------------------------------------------------

interface ExprToken {
  kind: "number" | "ident" | "op" | "lparen" | "rparen" | "comma" | "eof";
  text: string;
  pos: number;
}

function tokenizeExpr(input: string): ExprToken[] {
  const tokens: ExprToken[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }

    // Number literal (supports 1.5, .5, 1e-3, 1.2D+4)
    if ((ch >= "0" && ch <= "9") || (ch === "." && i + 1 < n && input[i + 1]! >= "0" && input[i + 1]! <= "9")) {
      const start = i;
      while (i < n && input[i]! >= "0" && input[i]! <= "9") i++;
      if (i < n && input[i] === ".") {
        i++;
        while (i < n && input[i]! >= "0" && input[i]! <= "9") i++;
      }
      if (i < n && (input[i] === "e" || input[i] === "E" || input[i] === "d" || input[i] === "D")) {
        const expStart = i;
        i++;
        if (i < n && (input[i] === "+" || input[i] === "-")) i++;
        const digitsStart = i;
        while (i < n && input[i]! >= "0" && input[i]! <= "9") i++;
        if (i === digitsStart) {
          i = expStart;
        }
      }
      tokens.push({ kind: "number", text: input.slice(start, i), pos: start });
      continue;
    }

    // Identifier
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_") {
      const start = i;
      while (
        i < n &&
        ((input[i]! >= "A" && input[i]! <= "Z") ||
          (input[i]! >= "a" && input[i]! <= "z") ||
          (input[i]! >= "0" && input[i]! <= "9") ||
          input[i] === "_")
      ) {
        i++;
      }
      tokens.push({ kind: "ident", text: input.slice(start, i), pos: start });
      continue;
    }

    // Operators & punctuation
    if (ch === "*" && i + 1 < n && input[i + 1] === "*") {
      tokens.push({ kind: "op", text: "**", pos: i });
      i += 2;
      continue;
    }
    if (ch === "^") {
      tokens.push({ kind: "op", text: "**", pos: i });
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "op", text: ch, pos: i });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen", text: "(", pos: i });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen", text: ")", pos: i });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma", text: ",", pos: i });
      i++;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${i + 1}`);
  }

  tokens.push({ kind: "eof", text: "", pos: n });
  return tokens;
}

class ExprParser {
  private readonly tokens: ExprToken[];
  private idx = 0;

  constructor(input: string) {
    this.tokens = tokenizeExpr(input);
  }

  private peek(): ExprToken {
    return this.tokens[this.idx] ?? { kind: "eof", text: "", pos: 0 };
  }

  private next(): ExprToken {
    const tok = this.peek();
    if (this.idx < this.tokens.length - 1) this.idx++;
    return tok;
  }

  parse(): CsmpExpr {
    const expr = this.parseAdditive();
    if (this.peek().kind !== "eof") {
      throw new Error(`Unexpected token '${this.peek().text}'`);
    }
    return expr;
  }

  private parseAdditive(): CsmpExpr {
    let left = this.parseMultiplicative();
    while (this.peek().kind === "op" && (this.peek().text === "+" || this.peek().text === "-")) {
      const op = this.next().text as "+" | "-";
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): CsmpExpr {
    let left = this.parseUnary();
    while (this.peek().kind === "op" && (this.peek().text === "*" || this.peek().text === "/")) {
      const op = this.next().text as "*" | "/";
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): CsmpExpr {
    if (this.peek().kind === "op" && (this.peek().text === "+" || this.peek().text === "-")) {
      const op = this.next().text as "+" | "-";
      const operand = this.parseUnary();
      return { kind: "unary", op, operand };
    }
    return this.parsePower();
  }

  private parsePower(): CsmpExpr {
    const base = this.parsePrimary();
    if (this.peek().kind === "op" && this.peek().text === "**") {
      this.next();
      const exp = this.parseUnary();
      return { kind: "binary", op: "**", left: base, right: exp };
    }
    return base;
  }

  private parsePrimary(): CsmpExpr {
    const tok = this.peek();
    if (tok.kind === "number") {
      this.next();
      const normalized = tok.text.replace(/[dD]/, "e");
      const value = Number(normalized);
      if (Number.isNaN(value)) {
        throw new Error(`Invalid numeric literal '${tok.text}'`);
      }
      return { kind: "number", value };
    }
    if (tok.kind === "ident") {
      this.next();
      const upper = tok.text.toUpperCase();
      if (this.peek().kind === "lparen") {
        this.next(); // consume '('
        const args: CsmpExpr[] = [];
        if (this.peek().kind !== "rparen") {
          args.push(this.parseAdditive());
          while (this.peek().kind === "comma") {
            this.next();
            args.push(this.parseAdditive());
          }
        }
        if (this.peek().kind !== "rparen") {
          throw new Error(`Expected ')' after arguments to '${upper}'`);
        }
        this.next(); // consume ')'
        return { kind: "call", callee: upper, args };
      }
      return { kind: "ident", name: upper };
    }
    if (tok.kind === "lparen") {
      this.next();
      const inner = this.parseAdditive();
      if (this.peek().kind !== "rparen") {
        throw new Error("Expected closing ')'");
      }
      this.next();
      return inner;
    }
    throw new Error(`Expected expression, found '${tok.text || "end of line"}'`);
  }
}

export function parseCsmpExpression(input: string): CsmpExpr {
  return new ExprParser(input).parse();
}

// ---------------------------------------------------------------------------
// Logical Line Joining & Comment Stripping
// ---------------------------------------------------------------------------

interface LogicalLine {
  text: string;
  line: number;
  startOffset: number;
  endOffset: number;
}

function collectLogicalLines(source: string): LogicalLine[] {
  const rawLines = source.split(/\r?\n/);
  const result: LogicalLine[] = [];
  let offset = 0;

  let pendingText = "";
  let pendingLine = 1;
  let pendingStartOffset = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? "";
    const lineNum = i + 1;
    const lineStart = offset;
    const lineEnd = offset + raw.length;
    offset = lineEnd + 1; // approximate newline

    const trimmed = raw.trim();
    // Classic CSMP/360 comment card starts with '*' in column 1 (or leading spaces + '*')
    if (
      !pendingText &&
      (trimmed.length === 0 || trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("!"))
    ) {
      continue;
    }

    // Strip inline // or ! comments (but not inside TITLE)
    let effective = raw;
    if (!/^\s*TITLE\b/i.test(effective)) {
      const slashIdx = effective.indexOf("//");
      if (slashIdx >= 0) effective = effective.slice(0, slashIdx);
      const bangIdx = effective.indexOf("!");
      if (bangIdx >= 0) effective = effective.slice(0, bangIdx);
    }

    const effTrimmed = effective.trim();
    if (!pendingText && effTrimmed.length === 0) continue;

    if (!pendingText) {
      pendingLine = lineNum;
      pendingStartOffset = lineStart;
    }

    // CSMP/360 continuation marker `...` at end of line
    if (effTrimmed.endsWith("...")) {
      pendingText += (pendingText ? " " : "") + effTrimmed.slice(0, -3).trim();
    } else {
      const combined = pendingText ? `${pendingText} ${effTrimmed}` : effTrimmed;
      result.push({
        text: combined,
        line: pendingLine,
        startOffset: pendingStartOffset,
        endOffset: lineEnd,
      });
      pendingText = "";
    }
  }

  if (pendingText) {
    result.push({
      text: pendingText,
      line: pendingLine,
      startOffset: pendingStartOffset,
      endOffset: offset,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Data Declaration Helpers (PARAM, CONST, INCON, TIMER, FUNCTION)
// ---------------------------------------------------------------------------

function parseNumberLiteral(raw: string): number {
  const norm = raw.trim().replace(/[dD]/, "e");
  return Number(norm);
}

/**
 * Splits a comma-separated list respecting balanced parentheses.
 */
function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail.length > 0) parts.push(tail);
  return parts;
}

function parseDataAssignments(
  body: string,
  kind: "PARAM" | "CONST" | "INCON",
  span: CsmpSpan,
  errors: CsmpParseError[],
): CsmpDataDecl[] {
  const decls: CsmpDataDecl[] = [];
  const items = splitTopLevelCommas(body);
  for (const item of items) {
    const eqIdx = item.indexOf("=");
    if (eqIdx < 0) {
      errors.push({
        code: CsmpErrorCode.SYNTAX_ERROR.id,
        message: CsmpErrorCode.SYNTAX_ERROR.message(`Expected 'NAME=VALUE' in ${kind} declaration, found '${item}'`),
        span,
      });
      continue;
    }
    const name = item.slice(0, eqIdx).trim().toUpperCase();
    const valStr = item.slice(eqIdx + 1).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      errors.push({
        code: CsmpErrorCode.SYNTAX_ERROR.id,
        message: CsmpErrorCode.SYNTAX_ERROR.message(`Invalid identifier '${name}' in ${kind} declaration`),
        span,
      });
      continue;
    }
    if (valStr.startsWith("(") && valStr.endsWith(")")) {
      const inner = valStr.slice(1, -1);
      const nums = splitTopLevelCommas(inner).map(parseNumberLiteral);
      if (nums.length === 0 || nums.some((n) => Number.isNaN(n))) {
        errors.push({
          code: CsmpErrorCode.SYNTAX_ERROR.id,
          message: CsmpErrorCode.SYNTAX_ERROR.message(`Invalid value list '${valStr}' for '${name}'`),
          span,
        });
        continue;
      }
      decls.push({ kind, name, value: nums[0]!, values: nums, span });
    } else {
      const num = parseNumberLiteral(valStr);
      if (Number.isNaN(num)) {
        errors.push({
          code: CsmpErrorCode.SYNTAX_ERROR.id,
          message: CsmpErrorCode.SYNTAX_ERROR.message(`Invalid numeric value '${valStr}' for '${name}'`),
          span,
        });
        continue;
      }
      decls.push({ kind, name, value: num, span });
    }
  }
  return decls;
}

function parseFunctionTable(body: string, span: CsmpSpan, errors: CsmpParseError[]): CsmpFunctionTable | undefined {
  const eqIdx = body.indexOf("=");
  if (eqIdx < 0) {
    errors.push({
      code: CsmpErrorCode.SYNTAX_ERROR.id,
      message: CsmpErrorCode.SYNTAX_ERROR.message(`Expected 'NAME = (x1, y1), ...' in FUNCTION declaration`),
      span,
    });
    return undefined;
  }
  const name = body.slice(0, eqIdx).trim().toUpperCase();
  const rhs = body.slice(eqIdx + 1).trim();
  const cleaned = rhs.replace(/[()]/g, " ");
  const rawTokens = cleaned
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const rawValues: number[] = [];
  for (const tok of rawTokens) {
    const n = parseNumberLiteral(tok);
    if (Number.isNaN(n)) {
      errors.push({
        code: CsmpErrorCode.SYNTAX_ERROR.id,
        message: CsmpErrorCode.SYNTAX_ERROR.message(`Invalid number '${tok}' in FUNCTION '${name}'`),
        span,
      });
      return undefined;
    }
    rawValues.push(n);
  }
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < rawValues.length; i += 2) {
    points.push({ x: rawValues[i]!, y: rawValues[i + 1]! });
  }
  return { name, points, rawValues, span };
}

function parseHeaderSignature(body: string): { outputs: string[]; name: string; inputs: string[] } | undefined {
  const eqIdx = body.indexOf("=");
  if (eqIdx < 0) return undefined;
  const outPart = body.slice(0, eqIdx).trim();
  const rhsPart = body.slice(eqIdx + 1).trim();
  const callMatch = rhsPart.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)$/);
  if (!callMatch) return undefined;

  const outputs = outPart
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  const name = callMatch[1]!.toUpperCase();
  const inputs = callMatch[2]!
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  return { outputs, name, inputs };
}

// ---------------------------------------------------------------------------
// Main CSMP / CSSL-67 Deck Parser
// ---------------------------------------------------------------------------

/**
 * Parses an IBM System/360 CSMP or SCi CSSL-67 deck into a structured `CsmpProgram`.
 */
export function parseCsmpDeck(source: string): CsmpProgram {
  const parameters = new Map<string, CsmpDataDecl>();
  const constants = new Map<string, CsmpDataDecl>();
  const incons = new Map<string, CsmpDataDecl>();
  const allDataDecls: CsmpDataDecl[] = [];
  const fixedVars = new Set<string>();
  const functionTables = new Map<string, CsmpFunctionTable>();
  const macros = new Map<string, CsmpMacroDef>();
  const procedures: CsmpProcedureDef[] = [];
  const initialStatements: CsmpAssignment[] = [];
  const dynamicStatements: CsmpAssignment[] = [];
  const terminalStatements: CsmpAssignment[] = [];
  const timer: CsmpTimerConfig = { raw: {} };
  const printVars: string[] = [];
  const prtpltVars: string[] = [];
  const errors: CsmpParseError[] = [];

  let title = "Untitled CSMP Model";
  let method: string | undefined;
  let methodSpan: CsmpSpan | undefined;
  let hasEnd = false;
  let hasStop = false;

  let currentSection: CsmpSectionKind = "DYNAMIC";
  let currentSortMode: CsmpSortMode = "SORT";
  let activeMacro: CsmpMacroDef | null = null;
  let activeProcedure: CsmpProcedureDef | null = null;

  const lines = collectLogicalLines(source);

  for (const ll of lines) {
    const span: CsmpSpan = {
      line: ll.line,
      column: 1,
      startOffset: ll.startOffset,
      endOffset: ll.endOffset,
    };
    const text = ll.text.trim();
    if (!text) continue;

    // Extract leading keyword
    const kwMatch = text.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.*))?$/);
    const keyword = kwMatch ? kwMatch[1]!.toUpperCase() : "";
    const rest = kwMatch?.[2]?.trim() ?? "";

    // Check if it's an assignment (e.g. X = INTGRL(...)) rather than a keyword directive
    const isAssignment = /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(text);

    if (!isAssignment) {
      switch (keyword) {
        case "TITLE":
          title = rest || title;
          continue;

        case "INITIAL":
          currentSection = "INITIAL";
          currentSortMode = "NOSORT";
          continue;

        case "DYNAMIC":
          currentSection = "DYNAMIC";
          currentSortMode = "SORT";
          continue;

        case "TERMINAL":
          currentSection = "TERMINAL";
          currentSortMode = "NOSORT";
          continue;

        case "SORT":
          currentSortMode = "SORT";
          continue;

        case "NOSORT":
          currentSortMode = "NOSORT";
          continue;

        case "PARAM":
        case "PARAMETER": {
          const decls = parseDataAssignments(rest, "PARAM", span, errors);
          for (const d of decls) {
            allDataDecls.push(d);
            if (!parameters.has(d.name)) parameters.set(d.name, d);
          }
          continue;
        }

        case "CONST":
        case "CONSTANT": {
          const decls = parseDataAssignments(rest, "CONST", span, errors);
          for (const d of decls) {
            allDataDecls.push(d);
            if (!constants.has(d.name)) constants.set(d.name, d);
          }
          continue;
        }

        case "INCON": {
          const decls = parseDataAssignments(rest, "INCON", span, errors);
          for (const d of decls) {
            allDataDecls.push(d);
            if (!incons.has(d.name)) incons.set(d.name, d);
          }
          continue;
        }

        case "FIXED": {
          for (const v of rest.split(/[\s,]+/)) {
            const name = v.trim().toUpperCase();
            if (name) fixedVars.add(name);
          }
          continue;
        }

        case "FUNCTION": {
          const tbl = parseFunctionTable(rest, span, errors);
          if (tbl) functionTables.set(tbl.name, tbl);
          continue;
        }

        case "MACRO": {
          if (activeMacro) {
            errors.push({
              code: CsmpErrorCode.MISMATCHED_MACRO.id,
              message: CsmpErrorCode.MISMATCHED_MACRO.message(
                `Nested MACRO started while '${activeMacro.name}' is still open`,
              ),
              span,
            });
          }
          const sig = parseHeaderSignature(rest);
          if (!sig) {
            errors.push({
              code: CsmpErrorCode.SYNTAX_ERROR.id,
              message: CsmpErrorCode.SYNTAX_ERROR.message(`Invalid MACRO header '${text}'`),
              span,
            });
            continue;
          }
          activeMacro = {
            name: sig.name,
            outputs: sig.outputs,
            inputs: sig.inputs,
            body: [],
            closed: false,
            span,
          };
          macros.set(sig.name, activeMacro);
          continue;
        }

        case "ENDMAC":
        case "ENDMACRO": {
          if (!activeMacro) {
            errors.push({
              code: CsmpErrorCode.MISMATCHED_MACRO.id,
              message: CsmpErrorCode.MISMATCHED_MACRO.message("ENDMAC encountered without matching MACRO"),
              span,
            });
          } else {
            activeMacro.closed = true;
            activeMacro = null;
          }
          continue;
        }

        case "PROCEDURE": {
          if (activeProcedure) {
            errors.push({
              code: CsmpErrorCode.MISMATCHED_PROCEDURE.id,
              message: CsmpErrorCode.MISMATCHED_PROCEDURE.message("Nested PROCEDURE started before previous ENDPRO"),
              span,
            });
          }
          const sig = parseHeaderSignature(rest);
          if (!sig) {
            errors.push({
              code: CsmpErrorCode.SYNTAX_ERROR.id,
              message: CsmpErrorCode.SYNTAX_ERROR.message(`Invalid PROCEDURE header '${text}'`),
              span,
            });
            continue;
          }
          activeProcedure = {
            outputs: sig.outputs,
            inputs: sig.inputs,
            body: [],
            closed: false,
            section: currentSection,
            span,
          };
          procedures.push(activeProcedure);
          continue;
        }

        case "ENDPRO":
        case "ENDPROCEDURE": {
          if (!activeProcedure) {
            errors.push({
              code: CsmpErrorCode.MISMATCHED_PROCEDURE.id,
              message: CsmpErrorCode.MISMATCHED_PROCEDURE.message("ENDPRO encountered without matching PROCEDURE"),
              span,
            });
          } else {
            activeProcedure.closed = true;
            activeProcedure = null;
          }
          continue;
        }

        case "TIMER": {
          timer.span = span;
          const items = splitTopLevelCommas(rest);
          for (const item of items) {
            const eqIdx = item.indexOf("=");
            if (eqIdx < 0) {
              errors.push({
                code: CsmpErrorCode.SYNTAX_ERROR.id,
                message: CsmpErrorCode.SYNTAX_ERROR.message(`Expected KEY=VALUE in TIMER directive, found '${item}'`),
                span,
              });
              continue;
            }
            const k = item.slice(0, eqIdx).trim().toUpperCase();
            const v = parseNumberLiteral(item.slice(eqIdx + 1).trim());
            if (Number.isNaN(v)) {
              errors.push({
                code: CsmpErrorCode.SYNTAX_ERROR.id,
                message: CsmpErrorCode.SYNTAX_ERROR.message(`Invalid TIMER value for '${k}'`),
                span,
              });
              continue;
            }
            timer.raw[k] = v;
            if (k === "FINTIM") timer.fintim = v;
            else if (k === "DELT") timer.delt = v;
            else if (k === "PRDEL") timer.prdel = v;
            else if (k === "OUTDEL") timer.outdel = v;
            else if (k === "DELMIN") timer.delmin = v;
            else if (k === "DELMAX") timer.delmax = v;
          }
          continue;
        }

        case "METHOD": {
          method = rest.split(/[\s,]+/)[0]?.toUpperCase() ?? "";
          methodSpan = span;
          continue;
        }

        case "PRINT": {
          for (const v of rest.split(/[\s,]+/)) {
            const name = v.trim().toUpperCase();
            if (name) printVars.push(name);
          }
          continue;
        }

        case "PRTPLT": {
          // Supports PRTPLT X, Y or PRTPLT X(Y, Z)
          const cleaned = rest.replace(/[()]/g, ",");
          for (const v of cleaned.split(/[\s,]+/)) {
            const name = v.trim().toUpperCase();
            if (name) prtpltVars.push(name);
          }
          continue;
        }

        case "END":
        case "ENDJOB":
          hasEnd = true;
          continue;

        case "STOP":
          hasStop = true;
          continue;

        case "CONTINUE":
        case "RESET":
        case "LABEL":
        case "RANGE":
        case "RELERR":
        case "ABSERR":
        case "PREPAR":
        case "RENAME":
          continue;

        default:
          break;
      }
    }

    // Parse assignment statement: TARGET = EXPR
    const eqIdx = text.indexOf("=");
    if (eqIdx > 0) {
      const target = text.slice(0, eqIdx).trim().toUpperCase();
      const rawExpr = text.slice(eqIdx + 1).trim();
      if (!/^[A-Z_][A-Z0-9_]*$/.test(target)) {
        errors.push({
          code: CsmpErrorCode.SYNTAX_ERROR.id,
          message: CsmpErrorCode.SYNTAX_ERROR.message(`Invalid assignment target '${target}'`),
          span,
        });
        continue;
      }
      try {
        const expr = parseCsmpExpression(rawExpr);
        const stmt: CsmpAssignment = {
          target,
          expr,
          rawExpr,
          section: currentSection,
          sortMode: currentSortMode,
          span,
        };
        if (activeMacro) {
          activeMacro.body.push(stmt);
        } else if (activeProcedure) {
          activeProcedure.body.push(stmt);
        } else if (currentSection === "INITIAL") {
          initialStatements.push(stmt);
        } else if (currentSection === "TERMINAL") {
          terminalStatements.push(stmt);
        } else {
          dynamicStatements.push(stmt);
        }
      } catch (err: unknown) {
        errors.push({
          code: CsmpErrorCode.SYNTAX_ERROR.id,
          message: CsmpErrorCode.SYNTAX_ERROR.message(err instanceof Error ? err.message : String(err)),
          span,
        });
      }
      continue;
    }

    // Unknown statement
    errors.push({
      code: CsmpErrorCode.SYNTAX_ERROR.id,
      message: CsmpErrorCode.SYNTAX_ERROR.message(`Unrecognized statement '${text}'`),
      span,
    });
  }

  // Check for unclosed MACRO or PROCEDURE
  if (activeMacro) {
    errors.push({
      code: CsmpErrorCode.MISMATCHED_MACRO.id,
      message: CsmpErrorCode.MISMATCHED_MACRO.message(`MACRO '${activeMacro.name}' is missing closing ENDMAC`),
      span: activeMacro.span,
    });
  }
  if (activeProcedure) {
    errors.push({
      code: CsmpErrorCode.MISMATCHED_PROCEDURE.id,
      message: CsmpErrorCode.MISMATCHED_PROCEDURE.message("PROCEDURE block is missing closing ENDPRO"),
      span: activeProcedure.span,
    });
  }

  return {
    title,
    parameters,
    constants,
    incons,
    allDataDecls,
    fixedVars,
    functionTables,
    macros,
    procedures,
    initialStatements,
    dynamicStatements,
    terminalStatements,
    timer,
    method,
    methodSpan,
    printVars,
    prtpltVars,
    hasEnd,
    hasStop,
    errors,
  };
}
