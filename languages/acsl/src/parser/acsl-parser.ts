// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Deterministic, zero-wrapper-overhead ACSL (Advanced Continuous Simulation Language, 1975) parser.
 *
 * Supports classic ACSL syntax:
 *   - Sections: PROGRAM, INITIAL, DYNAMIC, DERIVATIVE, DISCRETE, TERMINAL, END
 *   - Declarations: CONSTANT, INTEGER, LOGICAL, ARRAY, TABLE, MACRO
 *   - Simulation controls: CINTERVAL, MAXTERVAL, ALGORITHM, DERIVT, TERMT, INTERVAL, VARIABLE
 *   - Hybrid/event constructs: SCHEDULE (.AT., .XZ., .XP., .XN.), PROCEDURAL
 *   - Integrators & operators: INTEG, LIMINT, REALPL, CMPXPL, LEDLAG, DELAY, PULSE, RAMP, STEP, BOUND, DEAD, QUANT, SW, ZHOLD
 *   - Comments: `!` to end of line; line continuations `&`; statement separator `$`
 */

import type {
  AcslAssignment,
  AcslDiscreteBlock,
  AcslExpr,
  AcslIntegratorSpec,
  AcslMacroDef,
  AcslProceduralBlock,
  AcslProgram,
  AcslScheduleStmt,
  AcslSectionKind,
  AcslSectionRecord,
  AcslSpan,
  AcslTermtStmt,
} from "../types.js";

interface LogicalLine {
  text: string;
  line: number;
  startOffset: number;
  endOffset: number;
}

type ExprTokKind = "num" | "ident" | "str" | "bool" | "op" | "lparen" | "rparen" | "comma" | "eof";

interface ExprTok {
  kind: ExprTokKind;
  text: string;
  numVal?: number;
  boolVal?: boolean;
}

function tokenizeExpr(input: string): ExprTok[] {
  const toks: ExprTok[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }

    // String literal '...' or "..."
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      let val = "";
      while (j < n && input[j] !== quote) {
        if (input[j] === "\\" && j + 1 < n) {
          val += input[j + 1]!;
          j += 2;
        } else {
          val += input[j]!;
          j++;
        }
      }
      if (j < n) j++;
      toks.push({ kind: "str", text: val });
      i = j;
      continue;
    }

    // Fortran/ACSL dotted operators & booleans: .TRUE., .FALSE., .EQ., .NE., .LT., .LE., .GT., .GE., .AND., .OR., .NOT.
    if (ch === ".") {
      const rest = input.slice(i);
      const dotMatch = rest.match(/^\.(TRUE|FALSE|EQ|NE|LT|LE|GT|GE|AND|OR|NOT)\./i);
      if (dotMatch) {
        const kw = dotMatch[1]!.toUpperCase();
        if (kw === "TRUE" || kw === "FALSE") {
          toks.push({ kind: "bool", text: dotMatch[0]!, boolVal: kw === "TRUE" });
        } else {
          toks.push({ kind: "op", text: `.${kw}.` });
        }
        i += dotMatch[0]!.length;
        continue;
      }
    }

    // Number literal (supports .5, 1.0, 1.0e-3, 1.0D-3)
    if ((ch >= "0" && ch <= "9") || (ch === "." && i + 1 < n && input[i + 1]! >= "0" && input[i + 1]! <= "9")) {
      const numMatch = input.slice(i).match(/^(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/);
      if (numMatch) {
        const raw = numMatch[0]!;
        const numVal = Number(raw.replace(/[dD]/, "e"));
        toks.push({ kind: "num", text: raw, numVal });
        i += raw.length;
        continue;
      }
    }

    // Identifier
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_") {
      let j = i + 1;
      while (
        j < n &&
        ((input[j]! >= "A" && input[j]! <= "Z") ||
          (input[j]! >= "a" && input[j]! <= "z") ||
          (input[j]! >= "0" && input[j]! <= "9") ||
          input[j] === "_")
      ) {
        j++;
      }
      toks.push({ kind: "ident", text: input.slice(i, j) });
      i = j;
      continue;
    }

    if (ch === "(") {
      toks.push({ kind: "lparen", text: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      toks.push({ kind: "rparen", text: ")" });
      i++;
      continue;
    }
    if (ch === ",") {
      toks.push({ kind: "comma", text: "," });
      i++;
      continue;
    }

    // Two-char operators
    const two = input.slice(i, i + 2);
    if (two === "**" || two === "==" || two === "/=" || two === "<=" || two === ">=") {
      toks.push({ kind: "op", text: two });
      i += 2;
      continue;
    }
    if (ch === "^") {
      toks.push({ kind: "op", text: "**" });
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "<" || ch === ">") {
      toks.push({ kind: "op", text: ch });
      i++;
      continue;
    }

    // Unknown character: skip safely
    i++;
  }

  toks.push({ kind: "eof", text: "" });
  return toks;
}

class ExprParser {
  private pos = 0;
  private readonly toks: ExprTok[];

  constructor(input: string) {
    this.toks = tokenizeExpr(input);
  }

  private peek(): ExprTok {
    return this.toks[this.pos] ?? { kind: "eof", text: "" };
  }

  private consume(): ExprTok {
    const t = this.peek();
    if (this.pos < this.toks.length - 1) this.pos++;
    return t;
  }

  parse(): AcslExpr {
    return this.parseOr();
  }

  private parseOr(): AcslExpr {
    let left = this.parseAnd();
    while (this.peek().kind === "op" && this.peek().text === ".OR.") {
      this.consume();
      const right = this.parseAnd();
      left = { kind: "binary", op: ".OR.", left, right };
    }
    return left;
  }

  private parseAnd(): AcslExpr {
    let left = this.parseNot();
    while (this.peek().kind === "op" && this.peek().text === ".AND.") {
      this.consume();
      const right = this.parseNot();
      left = { kind: "binary", op: ".AND.", left, right };
    }
    return left;
  }

  private parseNot(): AcslExpr {
    if (this.peek().kind === "op" && this.peek().text === ".NOT.") {
      this.consume();
      return { kind: "unary", op: ".NOT.", operand: this.parseNot() };
    }
    return this.parseRelational();
  }

  private parseRelational(): AcslExpr {
    let left = this.parseAdditive();
    const relOps = new Set([".EQ.", ".NE.", ".LT.", ".LE.", ".GT.", ".GE.", "==", "/=", "<", "<=", ">", ">="]);
    while (this.peek().kind === "op" && relOps.has(this.peek().text)) {
      const op = this.consume().text as Extract<AcslExpr, { kind: "binary" }>["op"];
      const right = this.parseAdditive();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseAdditive(): AcslExpr {
    let left = this.parseMultiplicative();
    while (this.peek().kind === "op" && (this.peek().text === "+" || this.peek().text === "-")) {
      const op = this.consume().text as "+" | "-";
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): AcslExpr {
    let left = this.parseUnary();
    while (this.peek().kind === "op" && (this.peek().text === "*" || this.peek().text === "/")) {
      const op = this.consume().text as "*" | "/";
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): AcslExpr {
    if (this.peek().kind === "op" && (this.peek().text === "+" || this.peek().text === "-")) {
      const op = this.consume().text as "+" | "-";
      return { kind: "unary", op, operand: this.parseUnary() };
    }
    return this.parsePower();
  }

  private parsePower(): AcslExpr {
    const left = this.parsePrimary();
    if (this.peek().kind === "op" && this.peek().text === "**") {
      this.consume();
      const right = this.parseUnary();
      return { kind: "binary", op: "**", left, right };
    }
    return left;
  }

  private parsePrimary(): AcslExpr {
    const tok = this.peek();
    if (tok.kind === "num") {
      this.consume();
      return { kind: "number", value: tok.numVal ?? 0 };
    }
    if (tok.kind === "bool") {
      this.consume();
      return { kind: "boolean", value: Boolean(tok.boolVal) };
    }
    if (tok.kind === "str") {
      this.consume();
      return { kind: "string", value: tok.text };
    }
    if (tok.kind === "lparen") {
      this.consume();
      const inner = this.parseOr();
      if (this.peek().kind === "rparen") this.consume();
      return inner;
    }
    if (tok.kind === "ident") {
      this.consume();
      if (this.peek().kind === "lparen") {
        this.consume();
        const args: AcslExpr[] = [];
        if (this.peek().kind !== "rparen" && this.peek().kind !== "eof") {
          args.push(this.parseOr());
          while (this.peek().kind === "comma") {
            this.consume();
            args.push(this.parseOr());
          }
        }
        if (this.peek().kind === "rparen") this.consume();
        return { kind: "call", callee: tok.text.toUpperCase(), args };
      }
      return { kind: "ident", name: tok.text };
    }
    // Fallback for malformed expression
    return { kind: "number", value: 0 };
  }
}

/**
 * Parses an ACSL expression string into a lightweight plain tagged object.
 */
export function parseAcslExpression(exprText: string): AcslExpr {
  const parser = new ExprParser(exprText.trim());
  return parser.parse();
}

/**
 * Splits a comma-separated list while respecting nested parentheses and quotes.
 */
function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote: string | null = null;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
    } else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail.length > 0) parts.push(tail);
  return parts;
}

/**
 * Strips `!` comments outside string literals.
 */
function stripComment(line: string): string {
  let inQuote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
    } else if (ch === "!") {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Splits physical source lines into logical ACSL statements, handling `!` comments,
 * `&` line continuations, and `$` multi-statement separators.
 */
function preprocessLines(source: string): LogicalLine[] {
  const rawLines = source.split(/\r?\n/);
  const logical: LogicalLine[] = [];
  let offset = 0;

  let accText = "";
  let accLine = 1;
  let accStart = 0;
  let continuing = false;

  for (let idx = 0; idx < rawLines.length; idx++) {
    const raw = rawLines[idx]!;
    const lineStart = offset;
    offset += raw.length + 1;

    const noComment = stripComment(raw);
    const trimmed = noComment.trim();

    if (!continuing) {
      if (trimmed.length === 0) continue;
      accLine = idx + 1;
      accStart = lineStart + (raw.length - raw.trimStart().length);
      accText = trimmed;
    } else {
      accText += " " + trimmed;
    }

    if (accText.endsWith("&")) {
      accText = accText.slice(0, -1).trimEnd();
      continuing = true;
      continue;
    }

    continuing = false;
    const lineEnd = lineStart + raw.length;

    // Split on `$` outside quotes
    let inQuote: string | null = null;
    let segStart = 0;
    for (let i = 0; i < accText.length; i++) {
      const ch = accText[i]!;
      if (inQuote) {
        if (ch === inQuote) inQuote = null;
      } else if (ch === "'" || ch === '"') {
        inQuote = ch;
      } else if (ch === "$") {
        const piece = accText.slice(segStart, i).trim();
        if (piece.length > 0) {
          logical.push({ text: piece, line: accLine, startOffset: accStart, endOffset: lineEnd });
        }
        segStart = i + 1;
      }
    }
    const lastPiece = accText.slice(segStart).trim();
    if (lastPiece.length > 0) {
      logical.push({ text: lastPiece, line: accLine, startOffset: accStart, endOffset: lineEnd });
    }
    accText = "";
  }

  if (continuing && accText.trim().length > 0) {
    logical.push({ text: accText.trim(), line: accLine, startOffset: accStart, endOffset: source.length });
  }

  return logical;
}

function makeSpan(l: LogicalLine): AcslSpan {
  return {
    startOffset: l.startOffset,
    endOffset: l.endOffset,
    line: l.line,
    column: 1,
  };
}

/**
 * Parses an ACSL source string into a flat, data-oriented `AcslProgram` representation.
 */
export function parseAcsl(source: string): AcslProgram {
  const lines = preprocessLines(source);
  const program: AcslProgram = {
    name: "ACSL_MODEL",
    source,
    sections: [],
    declarations: [],
    assignments: [],
    integrators: [],
    discreteBlocks: [],
    schedules: [],
    procedurals: [],
    tables: [],
    macros: [],
    termts: [],
    parseErrors: [],
  };

  interface StackEntry {
    kind: AcslSectionKind | "PROCEDURAL" | "MACRO";
    sectionRecord?: AcslSectionRecord;
    discreteBlock?: AcslDiscreteBlock;
    proceduralBlock?: AcslProceduralBlock;
    macroDef?: AcslMacroDef;
  }

  const stack: StackEntry[] = [];

  const currentSection = (): AcslSectionKind => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const k = stack[i]!.kind;
      if (k !== "PROCEDURAL" && k !== "MACRO") return k;
    }
    return "PROGRAM";
  };

  const currentDiscrete = (): AcslDiscreteBlock | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.discreteBlock) return stack[i]!.discreteBlock;
    }
    return undefined;
  };

  const currentProcedural = (): AcslProceduralBlock | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.proceduralBlock) return stack[i]!.proceduralBlock;
    }
    return undefined;
  };

  const currentMacro = (): AcslMacroDef | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.macroDef) return stack[i]!.macroDef;
    }
    return undefined;
  };

  for (const l of lines) {
    const stmt = l.text;
    const upper = stmt.toUpperCase();
    const span = makeSpan(l);

    // Inside MACRO body until MACRO END
    const activeMacro = currentMacro();
    if (activeMacro) {
      if (/^MACRO\s+END\b/i.test(stmt) || /^END\s+MACRO\b/i.test(stmt) || upper === "END") {
        stack.pop();
      } else {
        activeMacro.body.push(stmt);
      }
      continue;
    }

    // PROGRAM [name]
    const progMatch = stmt.match(/^PROGRAM(?:\s+([A-Za-z_][A-Za-z0-9_]*))?/i);
    if (progMatch && (upper === "PROGRAM" || /^PROGRAM\s+/i.test(stmt))) {
      if (progMatch[1]) program.name = progMatch[1];
      const rec: AcslSectionRecord = {
        ...span,
        kind: "PROGRAM",
        name: program.name,
        parentKind: stack.length > 0 ? currentSection() : undefined,
        closed: false,
      };
      program.sections.push(rec);
      stack.push({ kind: "PROGRAM", sectionRecord: rec });
      continue;
    }

    // MACRO name(p1, p2)
    const macroMatch = stmt.match(/^MACRO\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([^)]*)\))?/i);
    if (macroMatch) {
      const params = macroMatch[2]
        ? macroMatch[2]
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean)
        : [];
      const macroDef: AcslMacroDef = {
        ...span,
        name: macroMatch[1]!,
        params,
        body: [],
      };
      program.macros.push(macroDef);
      stack.push({ kind: "MACRO", macroDef });
      continue;
    }

    // Section headers: INITIAL, DYNAMIC, DERIVATIVE, TERMINAL
    const secMatch = stmt.match(/^(INITIAL|DYNAMIC|DERIVATIVE|TERMINAL)(?:\s+([A-Za-z_][A-Za-z0-9_]*))?$/i);
    if (secMatch) {
      const kind = secMatch[1]!.toUpperCase() as AcslSectionKind;
      const rec: AcslSectionRecord = {
        ...span,
        kind,
        name: secMatch[2],
        parentKind: stack.length > 0 ? currentSection() : undefined,
        closed: false,
      };
      program.sections.push(rec);
      stack.push({ kind, sectionRecord: rec });
      continue;
    }

    // DISCRETE [name]
    const discMatch = stmt.match(/^DISCRETE(?:\s+([A-Za-z_][A-Za-z0-9_]*))?$/i);
    if (discMatch) {
      const name = discMatch[1] ?? `DISCRETE_${program.discreteBlocks.length + 1}`;
      const rec: AcslSectionRecord = {
        ...span,
        kind: "DISCRETE",
        name,
        parentKind: stack.length > 0 ? currentSection() : undefined,
        closed: false,
      };
      const block: AcslDiscreteBlock = {
        ...span,
        name,
        assignments: [],
        schedules: [],
      };
      program.sections.push(rec);
      program.discreteBlocks.push(block);
      stack.push({ kind: "DISCRETE", sectionRecord: rec, discreteBlock: block });
      continue;
    }

    // PROCEDURAL(out1, out2 = in1, in2)
    const procMatch = stmt.match(/^PROCEDURAL(?:\s*\(([^)]*)\))?$/i);
    if (procMatch) {
      const inner = procMatch[1] ?? "";
      const [outPart, inPart] = inner.split("=");
      const outputs = (outPart ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const inputs = (inPart ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const proc: AcslProceduralBlock = {
        ...span,
        outputs,
        inputs,
        assignments: [],
        section: currentSection(),
      };
      program.procedurals.push(proc);
      stack.push({ kind: "PROCEDURAL", proceduralBlock: proc });
      continue;
    }

    // END [sectionName]
    const endMatch = stmt.match(/^END(?:\s+([A-Za-z_][A-Za-z0-9_]*))?$/i);
    if (endMatch) {
      if (stack.length === 0) {
        program.parseErrors.push({
          ...span,
          code: "ACSL1002",
          message: `Unexpected END terminator with no open section`,
        });
        continue;
      }
      const top = stack.pop()!;
      if (top.sectionRecord) {
        top.sectionRecord.closed = true;
        top.sectionRecord.endOffset = span.endOffset;
      }
      continue;
    }

    // CINTERVAL name = expr
    const cintMatch = stmt.match(/^CINTERVAL\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/i);
    if (cintMatch) {
      const expr = parseAcslExpression(cintMatch[2]!);
      program.cinterval = { name: cintMatch[1]!, expr, span };
      program.declarations.push({
        ...span,
        kind: "CONSTANT",
        name: cintMatch[1]!,
        initialValue: expr,
        section: currentSection(),
      });
      continue;
    }

    // MAXTERVAL name = expr
    const maxtMatch = stmt.match(/^MAXTERVAL\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/i);
    if (maxtMatch) {
      const expr = parseAcslExpression(maxtMatch[2]!);
      program.maxterval = { name: maxtMatch[1]!, expr, span };
      program.declarations.push({
        ...span,
        kind: "CONSTANT",
        name: maxtMatch[1]!,
        initialValue: expr,
        section: currentSection(),
      });
      continue;
    }

    // ALGORITHM ialg = N
    const algMatch = stmt.match(/^ALGORITHM\s+(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*)?([+-]?\d+)$/i);
    if (algMatch) {
      program.algorithm = { code: Number(algMatch[1]!), span };
      continue;
    }

    // DERIVT [=] name
    const derivtMatch = stmt.match(/^DERIVT(?:\s*=\s*|\s+)([A-Za-z_][A-Za-z0-9_]*)$/i);
    if (derivtMatch) {
      program.derivt = { name: derivtMatch[1]!, span };
      continue;
    }

    // INTERVAL name = expr (inside DISCRETE)
    const intervalMatch = stmt.match(/^INTERVAL\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/i);
    if (intervalMatch) {
      const disc = currentDiscrete();
      const expr = parseAcslExpression(intervalMatch[2]!);
      if (disc) {
        disc.intervalVar = intervalMatch[1]!;
        disc.intervalExpr = expr;
      }
      program.declarations.push({
        ...span,
        kind: "CONSTANT",
        name: intervalMatch[1]!,
        initialValue: expr,
        section: currentSection(),
      });
      continue;
    }

    // VARIABLE t = 0.0
    const varTimeMatch = stmt.match(/^VARIABLE\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*(.+))?$/i);
    if (varTimeMatch) {
      program.declarations.push({
        ...span,
        kind: "REAL",
        name: varTimeMatch[1]!,
        initialValue: varTimeMatch[2] ? parseAcslExpression(varTimeMatch[2]) : { kind: "number", value: 0 },
        section: currentSection(),
      });
      continue;
    }

    // NSTEPS nstp = 10
    const nstepsMatch = stmt.match(/^NSTEPS\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/i);
    if (nstepsMatch) {
      program.declarations.push({
        ...span,
        kind: "INTEGER",
        name: nstepsMatch[1]!,
        initialValue: parseAcslExpression(nstepsMatch[2]!),
        section: currentSection(),
      });
      continue;
    }

    // TERMT(cond [, 'msg'])
    const termtMatch = stmt.match(/^TERMT\s*\((.*)\)$/i);
    if (termtMatch) {
      const parts = splitTopLevelCommas(termtMatch[1]!);
      const condText = parts[0] ?? "";
      const msgExpr = parts[1] ? parseAcslExpression(parts[1]) : undefined;
      const termt: AcslTermtStmt = {
        ...span,
        condition: condText.length > 0 ? parseAcslExpression(condText) : { kind: "boolean", value: false },
        message: msgExpr && msgExpr.kind === "string" ? msgExpr.value : undefined,
        section: currentSection(),
      };
      program.termts.push(termt);
      continue;
    }

    // SCHEDULE target .AT.|.XZ.|.XP.|.XN. expr
    const schedMatch = stmt.match(/^SCHEDULE\s+([A-Za-z_][A-Za-z0-9_]*)\s+\.(AT|XZ|XP|XN)\.\s+(.+)$/i);
    if (schedMatch) {
      const sched: AcslScheduleStmt = {
        ...span,
        targetDiscrete: schedMatch[1]!,
        triggerKind: schedMatch[2]!.toUpperCase() as "AT" | "XZ" | "XP" | "XN",
        expr: parseAcslExpression(schedMatch[3]!),
        section: currentSection(),
      };
      program.schedules.push(sched);
      const disc = currentDiscrete();
      if (disc) disc.schedules.push(sched);
      continue;
    }

    // TABLE name, dims, npts / bp1, bp2, ..., val1, val2, ... /
    const tableMatch = stmt.match(/^TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(\d+)\s*,\s*(\d+)\s*\/([^/]*)\//i);
    if (tableMatch) {
      const name = tableMatch[1]!;
      const dims = Number(tableMatch[2]!);
      const npts = Number(tableMatch[3]!);
      const nums = tableMatch[4]!
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s.replace(/[dD]/, "e")));
      const breakpoints = nums.slice(0, npts);
      const values = nums.slice(npts);
      program.tables.push({
        ...span,
        name,
        dimensions: dims,
        breakpoints,
        values,
        section: currentSection(),
      });
      continue;
    }

    // ARRAY name(dim1, ...) [= v1, v2, ...]
    const arrayStmtMatch = stmt.match(/^ARRAY\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]+)\)(?:\s*=\s*(.+))?$/i);
    if (arrayStmtMatch) {
      const dims = arrayStmtMatch[2]!
        .split(",")
        .map((d) => Number(d.trim()))
        .filter((d) => Number.isFinite(d));
      const vals = arrayStmtMatch[3]
        ? arrayStmtMatch[3]
            .split(",")
            .map((v) => Number(v.trim().replace(/[dD]/, "e")))
            .filter((v) => Number.isFinite(v))
        : undefined;
      program.declarations.push({
        ...span,
        kind: "ARRAY",
        name: arrayStmtMatch[1]!,
        arrayDimensions: dims,
        arrayValues: vals,
        section: currentSection(),
      });
      continue;
    }

    // Declarations: CONSTANT, INTEGER, LOGICAL, REAL, ARRAY
    const declMatch = stmt.match(/^(CONSTANT|INTEGER|LOGICAL|REAL|ARRAY)\s+(.+)$/i);
    if (declMatch) {
      const kind = declMatch[1]!.toUpperCase() as "CONSTANT" | "INTEGER" | "LOGICAL" | "REAL" | "ARRAY";
      const items = splitTopLevelCommas(declMatch[2]!);
      for (const item of items) {
        // Array syntax: name(dim1, dim2) [= v1, v2]
        const arrItem = item.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]+)\)(?:\s*=\s*(.+))?$/);
        if (arrItem) {
          const dims = arrItem[2]!
            .split(",")
            .map((d) => Number(d.trim()))
            .filter((d) => Number.isFinite(d));
          const vals = arrItem[3]
            ? arrItem[3]
                .split(",")
                .map((v) => Number(v.trim().replace(/[dD]/, "e")))
                .filter((v) => Number.isFinite(v))
            : undefined;
          program.declarations.push({
            ...span,
            kind: "ARRAY",
            name: arrItem[1]!,
            arrayDimensions: dims,
            arrayValues: vals,
            section: currentSection(),
          });
          continue;
        }

        const assignItem = item.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*(.+))?$/);
        if (assignItem) {
          program.declarations.push({
            ...span,
            kind,
            name: assignItem[1]!,
            initialValue: assignItem[2] ? parseAcslExpression(assignItem[2]) : undefined,
            section: currentSection(),
          });
        } else {
          program.parseErrors.push({
            ...span,
            code: "ACSL1001",
            message: `Invalid ${kind} declaration item '${item}'`,
          });
        }
      }
      continue;
    }

    // Assignment: lhs [= rhs] (supports array index lhs(i) = rhs)
    const assignMatch = stmt.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([^)]+)\))?\s*=\s*(.+)$/);
    if (assignMatch) {
      const target = assignMatch[1]!;
      const indexExpr = assignMatch[2] ? parseAcslExpression(assignMatch[2]) : undefined;
      const rhsExpr = parseAcslExpression(assignMatch[3]!);
      const sec = currentSection();
      const disc = currentDiscrete();
      const proc = currentProcedural();

      const assignment: AcslAssignment = {
        ...span,
        target,
        indexExpr,
        expr: rhsExpr,
        section: sec,
        blockName: disc?.name,
        procedural: proc !== undefined,
      };
      program.assignments.push(assignment);
      if (disc) disc.assignments.push(assignment);
      if (proc) proc.assignments.push(assignment);

      // Detect INTEG(deriv, ic) or LIMINT(deriv, ic, lo, hi)
      if (rhsExpr.kind === "call" && (rhsExpr.callee === "INTEG" || rhsExpr.callee === "LIMINT")) {
        const integ: AcslIntegratorSpec = {
          ...span,
          stateVar: target,
          derivativeExpr: rhsExpr.args[0] ?? { kind: "number", value: 0 },
          initialCondExpr: rhsExpr.args[1],
          operator: rhsExpr.callee,
          lowerBoundExpr: rhsExpr.callee === "LIMINT" ? rhsExpr.args[2] : undefined,
          upperBoundExpr: rhsExpr.callee === "LIMINT" ? rhsExpr.args[3] : undefined,
          section: sec,
        };
        program.integrators.push(integ);
      }
      continue;
    }

    // Unrecognized statement -> syntax error
    program.parseErrors.push({
      ...span,
      code: "ACSL1001",
      message: `Unrecognized ACSL statement '${stmt.slice(0, 60)}'`,
    });
  }

  // Any unclosed sections on the stack produce ACSL1002
  for (const unclosed of stack) {
    program.parseErrors.push({
      startOffset: unclosed.sectionRecord?.startOffset ?? 0,
      endOffset: unclosed.sectionRecord?.endOffset ?? source.length,
      line: unclosed.sectionRecord?.line ?? 1,
      column: 1,
      code: "ACSL1002",
      message: `Missing END terminator for '${unclosed.kind}' section`,
    });
  }

  return program;
}
