// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MIT DYNAMO System Dynamics Parser.
 *
 * Parses classic DYNAMO source decks (`.dyn`, `.dynamo`) containing:
 *   - `L` Level equations (`L POP.K=POP.J+(DT)*(BIRTH.JK-DEATH.JK)`)
 *   - `R` Rate equations (`R BIRTH.KL=POP.K*BR`)
 *   - `A` Auxiliary equations (`A RATIO.K=POP.K/CAP`)
 *   - `N` Initial equations (`N POP=1000`)
 *   - `C` Constant equations (`C BR=0.04, DR=0.02`)
 *   - `T` Table equations (`T BRTAB=0.04/0.035/0.028/0.02`)
 *   - `S` Supplementary equations (`S GROWTH.K=BIRTH.JK-DEATH.JK`)
 *   - `NOTE` / `*` comments
 *   - `SPEC` (`SPEC DT=0.25/LENGTH=100/PRTPER=5/PLTPER=2`)
 *   - `PRINT`, `PLOT`, `RUN` directives
 */

import type {
  DynamoEquation,
  DynamoEquationKind,
  DynamoExpr,
  DynamoModel,
  DynamoNote,
  DynamoParseError,
  DynamoPlotDirective,
  DynamoPlotEntry,
  DynamoPrintDirective,
  DynamoRunDirective,
  DynamoSourceSpan,
  DynamoSpec,
  DynamoTimeSubscript,
} from "../types.js";

const VALID_SUBSCRIPTS = new Set<string>(["K", "J", "JK", "KL"]);

interface ExprToken {
  type: "number" | "ident" | "op" | "lparen" | "rparen" | "comma" | "eof";
  text: string;
  subscript?: DynamoTimeSubscript | undefined;
  pos: number;
}

function tokenizeExpr(input: string): { tokens: ExprToken[]; error?: string } {
  const tokens: ExprToken[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i]!;
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }

    // Number literal (integer, decimal, scientific notation)
    if ((ch >= "0" && ch <= "9") || (ch === "." && i + 1 < len && input[i + 1]! >= "0" && input[i + 1]! <= "9")) {
      const start = i;
      while (i < len && input[i]! >= "0" && input[i]! <= "9") i++;
      if (i < len && input[i] === ".") {
        i++;
        while (i < len && input[i]! >= "0" && input[i]! <= "9") i++;
      }
      if (i < len && (input[i] === "e" || input[i] === "E")) {
        const expStart = i;
        i++;
        if (i < len && (input[i] === "+" || input[i] === "-")) i++;
        if (i < len && input[i]! >= "0" && input[i]! <= "9") {
          while (i < len && input[i]! >= "0" && input[i]! <= "9") i++;
        } else {
          i = expStart;
        }
      }
      tokens.push({ type: "number", text: input.slice(start, i), pos: start });
      continue;
    }

    // Identifier with optional DYNAMO time subscript (.K, .J, .JK, .KL)
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_") {
      const start = i;
      while (
        i < len &&
        ((input[i]! >= "A" && input[i]! <= "Z") ||
          (input[i]! >= "a" && input[i]! <= "z") ||
          (input[i]! >= "0" && input[i]! <= "9") ||
          input[i] === "_")
      ) {
        i++;
      }
      const name = input.slice(start, i).toUpperCase();
      let subscript: DynamoTimeSubscript | undefined;
      if (i < len && input[i] === ".") {
        const dotPos = i;
        i++;
        const subStart = i;
        while (i < len && ((input[i]! >= "A" && input[i]! <= "Z") || (input[i]! >= "a" && input[i]! <= "z"))) {
          i++;
        }
        const subRaw = input.slice(subStart, i).toUpperCase();
        if (VALID_SUBSCRIPTS.has(subRaw)) {
          subscript = subRaw as DynamoTimeSubscript;
        } else if (subRaw.length > 0) {
          return {
            tokens,
            error: `Unknown time subscript '.${subRaw}' on identifier '${name}' at column ${dotPos + 1}`,
          };
        } else {
          return {
            tokens,
            error: `Trailing '.' after identifier '${name}' at column ${dotPos + 1}`,
          };
        }
      }
      tokens.push({ type: "ident", text: name, subscript, pos: start });
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "lparen", text: "(", pos: i });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", text: ")", pos: i });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", text: ",", pos: i });
      i++;
      continue;
    }
    if (ch === "*" && i + 1 < len && input[i + 1] === "*") {
      tokens.push({ type: "op", text: "^", pos: i });
      i += 2;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      tokens.push({ type: "op", text: ch, pos: i });
      i++;
      continue;
    }

    return { tokens, error: `Unexpected character '${ch}' in expression at column ${i + 1}` };
  }

  tokens.push({ type: "eof", text: "", pos: len });
  return { tokens };
}

class ExprParser {
  private readonly tokens: ExprToken[];
  private idx = 0;

  constructor(tokens: ExprToken[]) {
    this.tokens = tokens;
  }

  private peek(): ExprToken {
    return this.tokens[this.idx] ?? { type: "eof", text: "", pos: 0 };
  }

  private consume(): ExprToken {
    const tok = this.peek();
    if (this.idx < this.tokens.length) this.idx++;
    return tok;
  }

  public parse(): DynamoExpr {
    const expr = this.parseAddSub();
    const next = this.peek();
    if (next.type !== "eof") {
      throw new Error(`Unexpected token '${next.text}' in expression`);
    }
    return expr;
  }

  private parseAddSub(): DynamoExpr {
    let left = this.parseMulDiv();
    while (this.peek().type === "op" && (this.peek().text === "+" || this.peek().text === "-")) {
      const op = this.consume().text as "+" | "-";
      const right = this.parseMulDiv();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMulDiv(): DynamoExpr {
    let left = this.parsePower();
    while (this.peek().type === "op" && (this.peek().text === "*" || this.peek().text === "/")) {
      const op = this.consume().text as "*" | "/";
      const right = this.parsePower();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parsePower(): DynamoExpr {
    const base = this.parseUnary();
    if (this.peek().type === "op" && this.peek().text === "^") {
      this.consume();
      const exponent = this.parsePower();
      return { kind: "binary", op: "^", left: base, right: exponent };
    }
    return base;
  }

  private parseUnary(): DynamoExpr {
    if (this.peek().type === "op" && (this.peek().text === "+" || this.peek().text === "-")) {
      const op = this.consume().text as "+" | "-";
      const operand = this.parseUnary();
      return { kind: "unary", op, operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): DynamoExpr {
    const tok = this.peek();
    if (tok.type === "number") {
      this.consume();
      const value = Number(tok.text);
      if (Number.isNaN(value)) {
        throw new Error(`Invalid numeric literal '${tok.text}'`);
      }
      return { kind: "number", value };
    }

    if (tok.type === "ident") {
      this.consume();
      if (this.peek().type === "lparen") {
        this.consume(); // '('
        const args: DynamoExpr[] = [];
        if (this.peek().type !== "rparen") {
          args.push(this.parseAddSub());
          while (this.peek().type === "comma") {
            this.consume();
            args.push(this.parseAddSub());
          }
        }
        if (this.peek().type !== "rparen") {
          throw new Error(`Missing closing ')' in call to '${tok.text}'`);
        }
        this.consume(); // ')'
        return { kind: "call", name: tok.text, args };
      }
      return { kind: "var", name: tok.text, subscript: tok.subscript };
    }

    if (tok.type === "lparen") {
      this.consume();
      const inner = this.parseAddSub();
      if (this.peek().type !== "rparen") {
        throw new Error("Missing closing ')' in parenthesized expression");
      }
      this.consume();
      return inner;
    }

    throw new Error(`Expected expression, found '${tok.text || "end of line"}'`);
  }
}

/**
 * Parses a standalone DYNAMO arithmetic expression string into a `DynamoExpr`.
 */
export function parseDynamoExpr(input: string): { expr?: DynamoExpr; error?: string } {
  const { tokens, error } = tokenizeExpr(input);
  if (error) return { error };
  try {
    const parser = new ExprParser(tokens);
    return { expr: parser.parse() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Collects all variable references (with optional subscripts) appearing in a `DynamoExpr`.
 */
export function extractExprRefs(
  expr: DynamoExpr | undefined,
  out: Array<{ name: string; subscript?: DynamoTimeSubscript | undefined }> = [],
): Array<{ name: string; subscript?: DynamoTimeSubscript | undefined }> {
  if (!expr) return out;
  switch (expr.kind) {
    case "number":
      return out;
    case "var":
      out.push({ name: expr.name, subscript: expr.subscript });
      return out;
    case "unary":
      return extractExprRefs(expr.operand, out);
    case "binary":
      extractExprRefs(expr.left, out);
      extractExprRefs(expr.right, out);
      return out;
    case "call":
      for (const arg of expr.args) extractExprRefs(arg, out);
      return out;
  }
}

interface RawLine {
  text: string;
  line: number;
  startOffset: number;
  endOffset: number;
}

/**
 * Joins classic DYNAMO continuation lines (`X` or `X1` prefix) onto the preceding logical statement.
 */
function mergeLogicalLines(source: string): RawLine[] {
  const lines = source.split(/\r?\n/);
  const result: RawLine[] = [];
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const startOffset = offset;
    const endOffset = offset + raw.length;
    offset = endOffset + 1;

    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;

    // Continuation card: X <expr> or X1 <expr>
    const contMatch = /^\s*X[0-9]?\s+(.*)$/i.exec(raw);
    if (contMatch && result.length > 0) {
      const prev = result[result.length - 1]!;
      prev.text = `${prev.text} ${contMatch[1]!.trim()}`;
      prev.endOffset = endOffset;
      continue;
    }

    result.push({
      text: trimmed,
      line: i + 1,
      startOffset,
      endOffset,
    });
  }

  return result;
}

function parseLhs(lhsRaw: string): {
  name: string;
  subscript?: DynamoTimeSubscript | undefined;
  error?: string;
} {
  const trimmed = lhsRaw.trim();
  const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z]+))?$/.exec(trimmed);
  if (!m) {
    return { name: trimmed.toUpperCase(), error: `Invalid left-hand side '${trimmed}'` };
  }
  const name = m[1]!.toUpperCase();
  const subRaw = m[2]?.toUpperCase();
  if (subRaw !== undefined && !VALID_SUBSCRIPTS.has(subRaw)) {
    return {
      name,
      error: `Invalid time subscript '.${subRaw}' on left-hand side '${trimmed}'`,
    };
  }
  return { name, subscript: subRaw as DynamoTimeSubscript | undefined };
}

function parseTableValues(rhs: string): { values: number[]; error?: string } {
  const parts = rhs
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    return { values: [], error: "Table equation requires at least one numeric value" };
  }
  const values: number[] = [];
  for (const part of parts) {
    const num = Number(part);
    if (Number.isNaN(num)) {
      return { values, error: `Invalid numeric value '${part}' in table definition` };
    }
    values.push(num);
  }
  return { values };
}

function parseSpecLine(body: string, span: DynamoSourceSpan, spec: DynamoSpec, errors: DynamoParseError[]): void {
  spec.span = span;
  const parts = body
    .split(/[/,]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) {
      errors.push({ message: `Malformed SPEC assignment '${part}'`, span });
      continue;
    }
    const key = part.slice(0, eqIdx).trim().toUpperCase();
    const valStr = part.slice(eqIdx + 1).trim();
    const val = Number(valStr);
    if (Number.isNaN(val)) {
      errors.push({ message: `Non-numeric SPEC value '${valStr}' for '${key}'`, span });
      continue;
    }
    if (key === "DT") spec.dt = val;
    else if (key === "LENGTH") spec.length = val;
    else if (key === "PRTPER") spec.prtper = val;
    else if (key === "PLTPER") spec.pltper = val;
    else spec.extra[key] = val;
  }
}

function parsePrintLine(body: string, span: DynamoSourceSpan): DynamoPrintDirective {
  const vars: string[] = [];
  for (const seg of body.split(/[/,]/)) {
    const cleaned = seg
      .trim()
      .replace(/^\d+\)\s*/, "")
      .replace(/\.[A-Za-z]+$/, "")
      .trim();
    if (cleaned.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(cleaned)) {
      vars.push(cleaned.toUpperCase());
    }
  }
  return { variables: vars, raw: body.trim(), span };
}

function parsePlotLine(body: string, span: DynamoSourceSpan): DynamoPlotDirective {
  const entries: DynamoPlotEntry[] = [];
  // Match VAR=SYM(MIN,MAX) or VAR=SYM or VAR
  const segments = body.split("/");
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const m =
      /^([A-Za-z_][A-Za-z0-9_]*)(?:=([A-Za-z0-9_*$#@]))?(?:\(\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?|\*)\s*,\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?|\*)\s*\))?/.exec(
        trimmed,
      );
    if (m) {
      const min = m[3] && m[3] !== "*" ? Number(m[3]) : undefined;
      const max = m[4] && m[4] !== "*" ? Number(m[4]) : undefined;
      entries.push({
        variable: m[1]!.toUpperCase(),
        symbol: m[2],
        min,
        max,
      });
    }
  }
  return { entries, raw: body.trim(), span };
}

/**
 * Parses a MIT DYNAMO source string into a structured `DynamoModel`.
 */
export function parseDynamo(source: string, modelName = "DynamoModel"): DynamoModel {
  const equations: DynamoEquation[] = [];
  const notes: DynamoNote[] = [];
  const prints: DynamoPrintDirective[] = [];
  const plots: DynamoPlotDirective[] = [];
  const runs: DynamoRunDirective[] = [];
  const errors: DynamoParseError[] = [];
  const spec: DynamoSpec = { extra: {} };

  let inferredName = modelName;
  let sawFirstNote = false;

  const logicalLines = mergeLogicalLines(source);

  for (const item of logicalLines) {
    const span: DynamoSourceSpan = {
      line: item.line,
      column: 1,
      startOffset: item.startOffset,
      endOffset: item.endOffset,
    };
    const text = item.text;

    // '*' comment line
    if (text.startsWith("*")) {
      const noteText = text.slice(1).trim();
      notes.push({ text: noteText, span });
      if (!sawFirstNote && noteText.length > 0 && modelName === "DynamoModel") {
        sawFirstNote = true;
        const candidate = noteText.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
        if (candidate.length > 0 && /^[A-Za-z]/.test(candidate)) {
          inferredName = candidate.slice(0, 48);
        }
      }
      continue;
    }

    // Keyword directives: NOTE, SPEC, PRINT, PLOT, RUN
    const kwMatch = /^(NOTE|SPEC|PRINT|PLOT|RUN)(?:\s+(.*))?$/i.exec(text);
    if (kwMatch) {
      const kw = kwMatch[1]!.toUpperCase();
      const body = (kwMatch[2] ?? "").trim();
      if (kw === "NOTE") {
        notes.push({ text: body, span });
        if (!sawFirstNote && body.length > 0 && modelName === "DynamoModel") {
          sawFirstNote = true;
          const candidate = body.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
          if (candidate.length > 0 && /^[A-Za-z]/.test(candidate)) {
            inferredName = candidate.slice(0, 48);
          }
        }
      } else if (kw === "SPEC") {
        parseSpecLine(body, span, spec, errors);
      } else if (kw === "PRINT") {
        prints.push(parsePrintLine(body, span));
      } else if (kw === "PLOT") {
        plots.push(parsePlotLine(body, span));
      } else if (kw === "RUN") {
        runs.push({ name: body || undefined, span });
      }
      continue;
    }

    // Equation line: <KIND> <LHS>=<RHS>
    const eqMatch = /^([LRANCTS])\s+(.*)$/i.exec(text);
    if (!eqMatch) {
      errors.push({
        message: `Unrecognized DYNAMO statement '${text.slice(0, 40)}'`,
        span,
      });
      continue;
    }

    const kind = eqMatch[1]!.toUpperCase() as DynamoEquationKind;
    const body = eqMatch[2]!.trim();

    // Multiple comma-separated constants on a single C card: C A=1, B=2
    if (kind === "C" && body.includes(",")) {
      const assignments = body.split(",");
      for (const assign of assignments) {
        const trimmedAssign = assign.trim();
        if (!trimmedAssign) continue;
        const eqIdx = trimmedAssign.indexOf("=");
        if (eqIdx === -1) {
          errors.push({ message: `Missing '=' in constant equation '${trimmedAssign}'`, span });
          continue;
        }
        const lhsInfo = parseLhs(trimmedAssign.slice(0, eqIdx));
        if (lhsInfo.error) {
          errors.push({ message: lhsInfo.error, span });
        }
        const rhsRaw = trimmedAssign.slice(eqIdx + 1).trim();
        const parsed = parseDynamoExpr(rhsRaw);
        if (parsed.error) {
          errors.push({ message: parsed.error, span });
        }
        equations.push({
          kind,
          name: lhsInfo.name,
          subscript: lhsInfo.subscript,
          expr: parsed.expr,
          rawRhs: rhsRaw,
          span,
        });
      }
      continue;
    }

    const eqIdx = body.indexOf("=");
    if (eqIdx === -1) {
      errors.push({ message: `Missing '=' in '${kind}' equation '${body}'`, span });
      continue;
    }

    const lhsRaw = body.slice(0, eqIdx).trim();
    const rhsRaw = body.slice(eqIdx + 1).trim();
    const lhsInfo = parseLhs(lhsRaw);
    if (lhsInfo.error) {
      errors.push({ message: lhsInfo.error, span });
    }

    if (kind === "T") {
      const tableRes = parseTableValues(rhsRaw);
      if (tableRes.error) {
        errors.push({ message: tableRes.error, span });
      }
      equations.push({
        kind,
        name: lhsInfo.name,
        subscript: lhsInfo.subscript,
        tableValues: tableRes.values,
        rawRhs: rhsRaw,
        span,
      });
      continue;
    }

    const parsed = parseDynamoExpr(rhsRaw);
    if (parsed.error) {
      errors.push({ message: parsed.error, span });
    }

    equations.push({
      kind,
      name: lhsInfo.name,
      subscript: lhsInfo.subscript,
      expr: parsed.expr,
      rawRhs: rhsRaw,
      span,
    });
  }

  return {
    name: inferredName,
    equations,
    notes,
    spec,
    prints,
    plots,
    runs,
    errors,
  };
}
